/**
 * Port of ROM routine `FUN_00002404`.
 *
 * Initializes a 56-entry motion-object grid in one 0x200-byte sprite-RAM bank.
 * `arg1` selects the bank (`SPRITE_RAM_BASE + (arg1 << 9)`) and is also written
 * to AV-control MMIO as `arg1 << 3`. The routine fills four 56-word streams:
 * Y coordinates, code/index words, X coordinates, and link indices.
 *
 * ROM tables at `0x2468` and `0x24D8` provide raw Y/X coordinates. Coordinate
 * words are shifted by five because the MOKAM unit is 1/32 pixel. The `dbf`
 * loop runs 56 iterations, and D1 link indices start at 1.
 */

import type { GameState } from "./state.js";
import type { RomImage } from "./bus.js";

// ─── Constants / addresses ────────────────────────────────────────────────

/** Absolute M68K SPRITE_RAM_BASE (`0xA02000`). */
export const SPRITE_RAM_BASE_ADDR = 0x00a02000 as const;

export const MMIO_AV_CONTROL_ADDR = 0x00860000 as const;

export const TABLE_Y_ROM_ADDR = 0x00002468 as const;

export const TABLE_X_ROM_ADDR = 0x000024d8 as const;

export const ROM_CODE_BIAS_ADDR = 0x0001006a as const;

export const NUM_SLOTS = 56 as const;

/** Dimensione di un bank MO in byte (= 64 × 4 word = 0x200). */
export const MO_BANK_SIZE = 0x200 as const;

export const MO_FIELD_Y_OFF = 0x000 as const;
export const MO_FIELD_CODE_OFF = 0x080 as const;
export const MO_FIELD_X_OFF = 0x100 as const;
export const MO_FIELD_LINK_OFF = 0x180 as const;

// ─── Stub injection ───────────────────────────────────────────────────────

/**
 * Stub injection for MMIO 0x860000 writes (not reflected in spriteRam
 *
 *   `addr = 0x860000` and `valueWord = (arg1 << 3) & 0xFFFF`.
 */
export interface MoGridInit2404Subs {
  onMmioWrite?: (addr: number, valueWord: number) => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────

/** Read big-endian 16-bit word da una Uint8Array a offset arbitrario. */
function readWordBE(buf: Uint8Array, off: number): number {
  const hi = buf[off] ?? 0;
  const lo = buf[off + 1] ?? 0;
  return ((hi << 8) | lo) & 0xffff;
}

/** Write big-endian 16-bit word in spriteRam at arbitrary offset (no-op if
  */
function writeWordBE(buf: Uint8Array, off: number, value: number): void {
  const v = value & 0xffff;
  if (off < 0 || off + 1 >= buf.length) return;
  buf[off] = (v >>> 8) & 0xff;
  buf[off + 1] = v & 0xff;
}


/**
 * Replica `FUN_00002404` — Motion Object grid initializer.
 *
 *
 * @param state  GameState. Modificato: `state.spriteRam` (224 byte nel bank
 *               0x1006A.
 *               - bank offset = `(arg1 << 9) & 0xFFFFFFFF` (long shift)
 *               - MMIO write   = `(arg1 << 3) & 0xFFFF`     (word di long)
 *               - code field   = `(arg1 + ROM[0x1006A].w) & 0xFFFF`
 * @param subs   Stub injection opzionali (vedi {@link MoGridInit2404Subs}).
 *
 *
 *     32-bit. Mirror it with `>>> 0`.
 *     grows from 0 to 0x6E in steps of 2. For each `i` from 0 to 55:
 *       slot_offset    = bank_off + i*2
 *       table_index    = 55 - i
 *       link_index     = i + 1
 */
export function moGridInit2404(
  state: GameState,
  rom: RomImage,
  arg1: number,
  subs: MoGridInit2404Subs = {},
): void {
  const onMmio = subs.onMmioWrite;

  const arg1Long = arg1 >>> 0;

  // 1. MMIO AV-control = (arg1 << 3) word.
  //    M68k: `asl.l #0x3, D0; move.w D0w, (0x860000)`. Il word write prende
  //    i 16 bit bassi del long shift.
  const mmioVal = ((arg1Long << 3) >>> 0) & 0xffff;
  onMmio?.(MMIO_AV_CONTROL_ADDR, mmioVal);

  // 2. Bank offset = arg1 << 9 (cumulativo: <<3 poi <<6 = <<9 long).
  const bankOffsetLong = ((arg1Long << 9) >>> 0) >>> 0;
  // SPRITE_RAM_BASE_ADDR e state.spriteRam parte da 0).
  const bankOff = bankOffsetLong;

  const codeBias = readWordBE(rom.program, ROM_CODE_BIAS_ADDR);

  // 4. 56-iteration loop. M68k iter 1..56 maps to:
  //      slot_pos     = bank_off + (i-1)*2  (i=1..56)
  //      table_index  = 56 - i
  //      link_index   = i
  //    Reformulated as loop i=0..55 with TS-friendly indices:
  //      slot_pos     = bank_off + i*2
  //      table_index  = 55 - i
  //      link_index   = i + 1
  for (let i = 0; i < NUM_SLOTS; i++) {
    const slotPos = bankOff + i * 2;
    const tableIdx = NUM_SLOTS - 1 - i;
    const linkIdx = i + 1;

    // 4a. code/idx field @ +0x80
    //     M68k: D0 long = arg1; D0w += ROM[0x1006A].w; move.w D0w,(0x80,A0)
    //     The word add wraps mod 0x10000 (D0 high bits remain arg1>>16).
    //     The word write stores only the low 16 bits.
    const codeWord = (arg1Long + codeBias) & 0xffff;
    writeWordBE(state.spriteRam, slotPos + MO_FIELD_CODE_OFF, codeWord);

    // 4b. link index field @ +0x180
    //     M68k: move.w D1w,(0x180,A0). D1 starts at 1 and increments each iter.
    writeWordBE(
      state.spriteRam,
      slotPos + MO_FIELD_LINK_OFF,
      linkIdx & 0xffff,
    );

    // 4c. X coord field @ +0x100
    //     M68k: D0w = TABLE_X[tableIdx]; D0w += 0x10; D0w <<= 5; move.w D0w,(0x100,A0)
    //     with wrap mod 0x10000.
    const xRaw = readWordBE(rom.program, TABLE_X_ROM_ADDR + tableIdx * 2);
    const xCoord = (((xRaw + 0x10) & 0xffff) << 5) & 0xffff;
    writeWordBE(state.spriteRam, slotPos + MO_FIELD_X_OFF, xCoord);

    // 4d. Y coord field @ +0x000
    //     M68k: D0w = TABLE_Y[tableIdx]; D0w <<= 5; move.w D0w,(A0)+
    const yRaw = readWordBE(rom.program, TABLE_Y_ROM_ADDR + tableIdx * 2);
    const yCoord = (yRaw << 5) & 0xffff;
    writeWordBE(state.spriteRam, slotPos + MO_FIELD_Y_OFF, yCoord);
  }
}
