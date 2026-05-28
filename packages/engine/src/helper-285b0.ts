/**
 * helper-285b0.ts — replica `FUN_000285B0` (30 istr, 0x58 byte).
 *
 *
 *
 * **Disasm 0x285B0..0x28606** (30 istr):
 *
 *   000285b0  movem.l {A2 D2},-(SP)               ; save A2, D2 (8 byte)
 *   000285b4  movea.l (0xc,SP),A2                 ; A2 = arg1 = objPtr
 *   000285b8  move.b  (0x13,SP),D2b               ; D2.b = arg2 low byte (mode)
 *   000285bc  move.b  D2b,D0b
 *   000285be  ext.w   D0w                         ; D0.w = sext_b(D2.b) [signed!]
 *   000285c0  add.w   D0w,D0w                     ; D0.w *= 2 (word byte offset, signed)
 *   000285c2  movea.l #0x23cd4,A0                 ; A0 = ROM_SCORE_TABLE base
 *   000285c8  move.w  (0x0,A0,D0w*0x1),D0w        ; D0.w = ROM[0x23CD4 + D0.w]
 *   000285cc  ext.l   D0                          ; D0 = sext_w(D0.w) → long
 *   000285ce  move.l  D0,-(SP)                    ; push score value
 *   000285d0  move.l  A2,-(SP)                    ; push objPtr
 *   000285d2  jsr     0x00028608.l                ; objectAccumFlag28608(objPtr, score)
 *   000285d8  move.b  D2b,D0b
 *   000285da  ext.w   D0w                         ; again sext_b(D2.b)
 *   000285dc  asl.w   #0x2,D0w                    ; D0.w *= 4 (long byte offset, signed)
 *   000285de  movea.l #0x23cf6,A0                 ; A0 = ROM_PTR_TABLE base
 *   000285e4  move.l  (0x0,A0,D0w*0x1),(0xd4,A2) ; *(objPtr+0xD4) = ROM[0x23CF6 + D0.w]
 *   000285ea  clr.b   D0b                         ; D0.b = 0
 *   000285ec  move.b  D0b,(0x70,A2)               ; *(objPtr+0x70) = 0
 *   000285f0  move.b  D0b,(0x68,A2)               ; *(objPtr+0x68) = 0
 *   000285f4  move.b  #-0x1,(0x69,A2)             ; *(objPtr+0x69) = 0xFF
 *   000285fa  move.b  #0x1,(0xd8,A2)              ; *(objPtr+0xD8) = 0x01
 *   00028600  addq.l  0x8,SP                      ; pop 2 args
 *   00028602  movem.l (SP)+,{D2 A2}               ; restore
 *   00028606  rts
 *
 *   - `arg1Long` → A2 = `objPtr` (absolute workRam address of object struct).
 *   - `arg2Long` → D2.b = `modeByte` (low byte; normal range 0..16; trattato
 *     come signed byte per l'indexing nelle table ROM).
 *
 * **ROM tables** (read from RomImage @ program[addr]):
 *   - Score word table @ 0x23CD4 — 17 signed words (mode 0..16):
 *       [0]=250, [1]=500, ..., [13]=6000, [14..16]=0
 *   - Pointer long table @ 0x23CF6 — 17 ROM long pointers (mode 0..16):
 *       [0]=0x00022386, ..., [16]=0x00022446
 *
 * **Side effects** (workRam — all relative to `objPtr - 0x400000`):
 *   - `*(objPtr + 0xBC)` (long) — incremented by score value via objectAccumFlag28608
 *   - `workRam[0x39C]` (byte) — dirty bitmap OR'd via objectAccumFlag28608
 *   - `*(objPtr + 0xD4)` (long) — set to ROM pointer from table
 *   - `*(objPtr + 0x70)` (byte) — cleared to 0
 *   - `*(objPtr + 0x68)` (byte) — cleared to 0
 *   - `*(objPtr + 0x69)` (byte) — set to 0xFF
 *   - `*(objPtr + 0xD8)` (byte) — set to 0x01
 *
 * **Callers** (8):
 *   FUN_00015BD0 @ 0x00015C20
 *   FUN_000121B8 @ 0x00012694
 *   FUN_0001365C @ 0x000137E8
 *   FUN_0001924E @ 0x00019352
 *   FUN_000251DE @ 0x00025366
 *   FUN_000253EC @ 0x00025552, 0x00025592, 0x000258F0
 */

import type { GameState } from "./state.js";
import type { RomImage } from "./bus.js";
import { objectAccumFlag28608 } from "./object-accum-flag-28608.js";

// ─── Address constants ─────────────────────────────────────────────────────

export const HELPER_285B0_ADDR = 0x000285b0 as const;

/** Absolute base of work RAM. */
const WORK_RAM_BASE = 0x00400000 as const;

/** ROM word table base (17 entries × 2 bytes = score values per mode). */
const ROM_SCORE_TABLE_ADDR = 0x00023cd4 as const;

/** ROM pointer table base (17 entries × 4 bytes = ROM address per mode). */
const ROM_PTR_TABLE_ADDR = 0x00023cf6 as const;

/**
 * Fallback score table (17 signed word entries, mode 0..16).
 * Used when ROM image not provided and modeByte is in [0..16].
 * Source: ghidra_project/marble_program.bin @ 0x23CD4.
 */
const FALLBACK_SCORE_TABLE: readonly number[] = [
  250, 500, 750, 1000, 1500, 2000, 2500, 3000, 3500, 4000, 4500, 5000, 5500,
  6000, 0, 0, 0,
] as const;

/**
 * Fallback pointer table (17 long entries, mode 0..16).
 * Used when ROM image not provided and modeByte is in [0..16].
 * Source: ghidra_project/marble_program.bin @ 0x23CF6.
 */
const FALLBACK_PTR_TABLE: readonly number[] = [
  0x00022386, 0x00022392, 0x0002239e, 0x000223aa, 0x000223b6, 0x000223c2,
  0x000223ce, 0x000223da, 0x000223e6, 0x000223f2, 0x000223fe, 0x0002240a,
  0x00022416, 0x00022422, 0x0002242e, 0x0002243a, 0x00022446,
] as const;

// ─── Helpers ───────────────────────────────────────────────────────────────

/** Write big-endian long into workRam at workRam-relative byte offset `off`. */
function writeLongBE(r: Uint8Array, off: number, value: number): void {
  const v = value >>> 0;
  r[off] = (v >>> 24) & 0xff;
  r[off + 1] = (v >>> 16) & 0xff;
  r[off + 2] = (v >>> 8) & 0xff;
  r[off + 3] = v & 0xff;
}

/** Read big-endian signed word from ROM at absolute address `addr`. */
function readRomSignedWord(rom: RomImage, addr: number): number {
  const raw =
    (((rom.program[addr] ?? 0) << 8) | (rom.program[addr + 1] ?? 0)) & 0xffff;
  // sign-extend to 32-bit
  return raw & 0x8000 ? (raw | 0xffff0000) | 0 : raw;
}

/** Read big-endian unsigned long from ROM at absolute address `addr`. */
function readRomLong(rom: RomImage, addr: number): number {
  return (
    (((rom.program[addr] ?? 0) << 24) |
      ((rom.program[addr + 1] ?? 0) << 16) |
      ((rom.program[addr + 2] ?? 0) << 8) |
      (rom.program[addr + 3] ?? 0)) >>>
    0
  );
}

// ─── Main function ─────────────────────────────────────────────────────────

/**
 *
 *
 *
 * @param state    GameState (mutates workRam in place).
 *                 (e.g. `0x400018 + idx*0xE2`).
 * @param subs     Sub injection for `objectAccumFlag28608` (default: TS replica).
 */
export function helper285B0(
  state: GameState,
  objPtr: number,
  modeLong: number,
  rom?: RomImage,
  subs?: {
    objectAccumFlag28608?: (
      state: GameState,
      objPtr: number,
      value: number,
    ) => void;
  },
): void {
  const r = state.workRam;
  const objOff = (objPtr - WORK_RAM_BASE) >>> 0;

  // D2.b = low byte of modeLong (M68k: move.b (0x13,SP),D2b)
  const modeByte = modeLong & 0xff;

  // M68k ext.w on a byte register: sign-extend 8-bit to 16-bit.
  // modeByte 0x00..0x7F → positive (0..127)
  // modeByte 0x80..0xFF → negative (−128..−1)
  const modeWordSigned = modeByte & 0x80 ? (modeByte | 0xffffff00) | 0 : modeByte;

  // ── Step 1: look up score in ROM score table ─────────────────────────────
  // add.w D0w,D0w → word byte offset = modeWordSigned * 2
  // move.w (0x0,A0,D0w*0x1),D0w → read signed word at ROM[0x23CD4 + offset]
  // ext.l D0 → sign-extend to long
  let scoreValue: number;
  if (rom !== undefined) {
    const wordByteOffset = (modeWordSigned * 2) & 0xffff; // 16-bit signed offset
    const wordAddr = (ROM_SCORE_TABLE_ADDR + ((wordByteOffset << 16) >> 16)) >>> 0;
    scoreValue = readRomSignedWord(rom, wordAddr);
  } else if (modeWordSigned >= 0 && modeWordSigned < FALLBACK_SCORE_TABLE.length) {
    // Fast path for normal range without ROM
    const raw = FALLBACK_SCORE_TABLE[modeWordSigned] ?? 0;
    scoreValue = (raw << 16) >> 16; // ensure signed 32-bit
  } else {
    // Out-of-range without ROM: undefined behaviour; return 0 as safe default
    scoreValue = 0;
  }

  // ── Step 2: call objectAccumFlag28608(objPtr, scoreValue) ────────────────
  const accumFn = subs?.objectAccumFlag28608 ?? objectAccumFlag28608;
  accumFn(state, objPtr, scoreValue);

  // ── Step 3: look up ROM pointer from pointer table ───────────────────────
  // asl.w #0x2,D0w → long byte offset = modeWordSigned * 4
  // move.l (0x0,A0,D0w*0x1),(0xd4,A2) → *(objPtr+0xD4) = ROM[0x23CF6 + offset]
  let romPtr: number;
  if (rom !== undefined) {
    const longByteOffset = (modeWordSigned * 4) & 0xffff; // 16-bit signed offset
    const longAddr = (ROM_PTR_TABLE_ADDR + ((longByteOffset << 16) >> 16)) >>> 0;
    romPtr = readRomLong(rom, longAddr);
  } else if (modeWordSigned >= 0 && modeWordSigned < FALLBACK_PTR_TABLE.length) {
    // Fast path for normal range without ROM
    romPtr = FALLBACK_PTR_TABLE[modeWordSigned] ?? 0;
  } else {
    romPtr = 0;
  }

  // Write ROM pointer to *(objPtr + 0xD4)
  writeLongBE(r, objOff + 0xd4, romPtr);

  // ── Steps 4-7: initialize object state fields ────────────────────────────
  // clr.b D0b; move.b D0b,(0x70,A2)  → *(objPtr+0x70) = 0
  r[objOff + 0x70] = 0x00;
  // move.b D0b,(0x68,A2)              → *(objPtr+0x68) = 0
  r[objOff + 0x68] = 0x00;
  // move.b #-0x1,(0x69,A2)            → *(objPtr+0x69) = 0xFF
  r[objOff + 0x69] = 0xff;
  // move.b #0x1,(0xd8,A2)             → *(objPtr+0xD8) = 0x01
  r[objOff + 0xd8] = 0x01;
}

// ─── Address accessors (for ROM table address queries) ─────────────────────

/** ROM address of the score word table used by this helper. */
export const HELPER_285B0_SCORE_TABLE_ADDR = ROM_SCORE_TABLE_ADDR;

/** ROM address of the ROM pointer table used by this helper. */
export const HELPER_285B0_PTR_TABLE_ADDR = ROM_PTR_TABLE_ADDR;
