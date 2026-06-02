/**
 * Three helpers for scripted multi-step palette swaps:
 *
 *   - **`paletteQueuePush(state, value)`** <-> `FUN_00026B66`
 *     Pushes one command byte into a 4-slot circular queue at
 *     `0x40040C-0x40040F` with u32 pointer `0x400408`.
 *
 *   - **`paletteQueueDrain(state, rom)`** <-> `FUN_00026B88`
 *     For each popped byte:
 *       1. Index in u32 lookup table @ ROM `0x20AE4` → command descriptor ptr
 *       2. Read descriptor: count (byte 0), pal-table-offset (byte 1), data (bytes 2..)
 *       3. For the in 0..count-1: deref u32 in palette pointer table
 *          @ ROM `0x20840 + pal_offset + i*4` → palette destination addr.
 *          Write u16 BE data[i] to that destination.
 *
 *   - **`paletteQueueScheduler3(state)`** <-> `FUN_00026D4E` (palette anim 3)
 *     Pushes command `*0x40045E + 12` into the queue.
 *
 */

import type { GameState } from "./state.js";
import type { RomImage } from "./bus.js";

// ─── Constants ────────────────────────────────────────────────────────────

/** Pointer u32 BE to next-free slot in palette queue. */
export const PAL_QUEUE_PTR_ADDR = 0x400408 as const;

export const PAL_QUEUE_HEAD = 0x40040C as const;

/** Queue tail (clamp upper bound). */
export const PAL_QUEUE_TAIL = 0x40040F as const;

/** ROM lookup table u32: command_byte → palette descriptor pointer. */
export const PAL_CMD_DESCRIPTOR_TABLE_ROM = 0x20ae4 as const;

/** ROM palette pointer table (descriptors point at offsets within this base). */
export const PAL_DEST_PTR_TABLE_ROM = 0x20840 as const;

/** Scheduler 3 counters in Work RAM. */
export const SCHED3_LOW_CTR = 0x400460 as const;  // primary counter
export const SCHED3_HIGH_CTR = 0x40045e as const; // secondary counter

// ─── Helpers ──────────────────────────────────────────────────────────────

function readU32BE(buf: Uint8Array, offset: number): number {
  return (
    ((buf[offset] ?? 0) << 24) |
    ((buf[offset + 1] ?? 0) << 16) |
    ((buf[offset + 2] ?? 0) << 8) |
    (buf[offset + 3] ?? 0)
  ) >>> 0;
}

function writeU32BE(buf: Uint8Array, offset: number, value: number): void {
  buf[offset] = (value >>> 24) & 0xff;
  buf[offset + 1] = (value >>> 16) & 0xff;
  buf[offset + 2] = (value >>> 8) & 0xff;
  buf[offset + 3] = value & 0xff;
}

function readU16BE(buf: Uint8Array, offset: number): number {
  return (((buf[offset] ?? 0) << 8) | (buf[offset + 1] ?? 0)) & 0xffff;
}

function writeU16BE(buf: Uint8Array, offset: number, value: number): void {
  buf[offset] = (value >>> 8) & 0xff;
  buf[offset + 1] = value & 0xff;
}

function sext8_i32(byte: number): number {
  return ((byte & 0xff) << 24) >> 24;
}

/** Mapping unified address → state buffer (workRam, colorRam, ...). */
function writeMemoryU16(state: GameState, addr: number, value: number): void {
  if (addr >= 0x400000 && addr < 0x402000) {
    writeU16BE(state.workRam, addr - 0x400000, value);
  } else if (addr >= 0xb00000 && addr < 0xb00800) {
    writeU16BE(state.colorRam, addr - 0xb00000, value);
  }
  // Other ranges: ignored for now (PF/MO/Alpha RAM, MMIO)
}

// ─── Push (FUN_26B66) ─────────────────────────────────────────────────────

/**
 * Push byte command to palette queue. Replica of `FUN_00026B66`.
 *
 * Logic:
 *   ptr = *0x400408
 *   *ptr = value.b
 *   ptr += 1
 *   if ptr > 0x40040F: ptr = 0x40040F  (clamp)
 *   *0x400408 = ptr
 */
export function paletteQueuePush(state: GameState, value: number): void {
  const ptrOff = PAL_QUEUE_PTR_ADDR - 0x400000;
  let nextFree = readU32BE(state.workRam, ptrOff);

  const slotOff = nextFree - 0x400000;
  if (slotOff >= 0 && slotOff < state.workRam.length) {
    state.workRam[slotOff] = value & 0xff;
  }

  nextFree = (nextFree + 1) >>> 0;
  if (nextFree > PAL_QUEUE_TAIL) nextFree = PAL_QUEUE_TAIL;

  writeU32BE(state.workRam, ptrOff, nextFree);
}

// ─── Drain (FUN_26B88) ────────────────────────────────────────────────────

/**
 * Drain palette queue. Replica of `FUN_00026B88`.
 *
 *   1. cmd_byte = *(--ptr)
 *   2. descriptor_ptr = *(rom + 0x20AE4 + sext_w(cmd_byte) * 4)
 *   3. count = sext_w(*descriptor_ptr)        (byte 0 of descriptor)
 *   4. pal_offset = sext_l(*(descriptor_ptr+1)) * 4   (byte 1)
 *   5. data_ptr = descriptor_ptr + 2
 *   6. for i in 0..count-1:
 *        pal_table_entry = rom + 0x20840 + pal_offset + i*4
 *        pal_dest = *pal_table_entry        (u32 BE)
 *        *pal_dest = *data_ptr (u16 BE), data_ptr += 2
 */
export function paletteQueueDrain(state: GameState, rom: RomImage): void {
  const ptrOff = PAL_QUEUE_PTR_ADDR - 0x400000;

  while (true) {
    const ptr = readU32BE(state.workRam, ptrOff);
    if (ptr === 0) return; // empty

    // `cmpa.l (A2), A1; bcc skip` = skip if A1 >= *A2 (unsigned).
    // A1 = 0x40040C (head), *A2 = ptr. Skip if head >= ptr.
    if (PAL_QUEUE_HEAD >= ptr) return;

    // *A2 -= 1 (decrement)
    const newPtr = (ptr - 1) >>> 0;
    writeU32BE(state.workRam, ptrOff, newPtr);

    // Read byte at decremented ptr
    const cmdByteOff = newPtr - 0x400000;
    if (cmdByteOff < 0 || cmdByteOff >= state.workRam.length) return;
    const cmdByte = state.workRam[cmdByteOff] ?? 0;

    // Disassembly:
    //   D0.b = cmd_byte
    //   ext.w D0     → D0.w = sext_w(D0.b)
    //   asl.w #2 D0  → D0.w << 2 (word op, may wrap within 16 bits)
    //   movea.l (0, A0, D0.w*1), A3 → index using sext_l(D0.w)
    // Effectively: index = sext_l((sext_w(byte) << 2) & 0xFFFF)

    // The shift is .w (word), so values can wrap within 16 bits. Then sign-extend.
    const cmdWord = sext8_i32(cmdByte) & 0xffff; // word value
    const shiftedWord = (cmdWord << 2) & 0xffff; // shift within word, wraps
    const finalIndex = (shiftedWord & 0x8000) ? shiftedWord - 0x10000 : shiftedWord; // sext_l

    const descriptorPtrAddr = (PAL_CMD_DESCRIPTOR_TABLE_ROM + finalIndex) >>> 0;

    // Read u32 from ROM at descriptorPtrAddr
    if (descriptorPtrAddr + 4 > rom.program.length) return;
    const descriptorPtr = readU32BE(rom.program, descriptorPtrAddr);

    // Read descriptor: byte 0 = count, byte 1 = pal_offset
    if (descriptorPtr + 2 > rom.program.length) continue;
    const count = sext8_i32(rom.program[descriptorPtr] ?? 0);
    const palOffsetByte = rom.program[descriptorPtr + 1] ?? 0;
    const palOffset = (sext8_i32(palOffsetByte) << 2) >>> 0;

    let dataPtr = descriptorPtr + 2;

    for (let i = 0; i < count; i++) {
      // pal_table_entry = rom @ (0x20840 + pal_offset + i*4)
      const palTableEntryAddr = (PAL_DEST_PTR_TABLE_ROM + palOffset + i * 4) >>> 0;
      if (palTableEntryAddr + 4 > rom.program.length) break;
      const palDest = readU32BE(rom.program, palTableEntryAddr);

      // Read u16 BE from data_ptr
      if (dataPtr + 2 > rom.program.length) break;
      const value = readU16BE(rom.program, dataPtr);
      dataPtr += 2;

      // Write to palette dest (in colorRam if 0xB00000-0xB007FF range)
      writeMemoryU16(state, palDest, value);
    }
  }
}

// ─── Scheduler 3 (FUN_26D4E) ──────────────────────────────────────────────

/**
 * Replica of `FUN_00026D4E` — palette anim scheduler 3.
 *
 * Logic:
 *   if signed(*0x400460) < 0: return  (disabled)
 *   *0x400460 += 1
 *   if signed(*0x400460) > 6:
 *     *0x400460 = 0
 *     *0x40045E += 1
 *     if signed(*0x40045E) > 5: *0x40045E = 0
 *     paletteQueuePush(sext_l(*0x40045E) + 12)
 *
 */
export function paletteAnim3Tick(state: GameState): void {
  const lowOff = SCHED3_LOW_CTR - 0x400000;
  const highOff = SCHED3_HIGH_CTR - 0x400000;

  const lowVal = state.workRam[lowOff] ?? 0;
  const lowSigned = sext8_i32(lowVal);

  // blt.w skip: signed less than 0 → skip
  if (lowSigned < 0) return;

  // *0x400460 += 1
  let newLow = (lowVal + 1) & 0xff;

  // cmpi.b #0x6, *; ble skip — skip if signed *0x400460 <= 6
  const newLowSigned = sext8_i32(newLow);
  if (newLowSigned <= 6) {
    state.workRam[lowOff] = newLow;
    return;
  }

  // Reset low
  newLow = 0;
  state.workRam[lowOff] = newLow;

  // Increment high
  let newHigh = ((state.workRam[highOff] ?? 0) + 1) & 0xff;
  // cmpi.b #0x5, *; ble skip — clear if signed > 5
  if (sext8_i32(newHigh) > 5) newHigh = 0;
  state.workRam[highOff] = newHigh;

  // sext_l(*0x40045E) + 12 → push
  const cmdValue = sext8_i32(newHigh) + 12;
  paletteQueuePush(state, cmdValue & 0xff);
}
