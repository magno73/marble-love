/**
 * object-accum-flag-28608.ts — replica `FUN_00028608`.
 *
 * Disassembly (7 instr, 0x1C byte):
 *   00028608  movea.l (0x4,SP),A0          ; A0 = arg1: objPtr (absolute)
 *   0002860c  move.l  (0x8,SP),D0          ; D0 = arg2: value (long, signed)
 *   00028610  add.l   D0,(0xbc,A0)         ; *(A0 + 0xBC) += D0  [accumulator]
 *   00028614  moveq   0x1,D0               ; D0 = 1
 *   00028616  move.b  (0x19,A0),D1b        ; D1.byte = *(A0 + 0x19)  [flag index]
 *   0002861a  asl.l   D1,D0               ; D0 = 1 << D1  (M68k asl.l: shift count mod 64)
 *   0002861c  or.b    D0b,(0x0040039c).l  ; workRam[0x39C] |= D0.byte  [set dirty bit]
 *   00028622  rts
 *
 * Semantics:
 *   1. Adds `value` (signed 32-bit long) to the long accumulator field at
 *      offset 0xBC within the object struct pointed to by `objPtr`.
 *   2. Reads the flag index byte from offset 0x19 within the same struct.
 *   3. Sets bit `(1 << flagIdx) & 0xFF` in the global dirty bitmap byte at
 *      workRam offset 0x39C (absolute 0x40039C).
 *
 * This is the "addToObjectAccumAndFlag" helper referenced in the player-slot
 * iteration loop (`FUN_118D2` @ 0x11A56), which passes the absolute slot
 * pointer and a clamped score × 100 value.
 *
 * Callers (6 refs):
 *   FUN_000118D2 @ 0x00011A56  (playerSlotIter118D2, second slot loop)
 *   FUN_0001924E @ 0x0001935E
 *   FUN_000261BC @ 0x0002627A
 *   FUN_000285B0 @ 0x000285D2
 *   FUN_00018A88 @ 0x00018C5A
 *
 * workRam layout (offsets relative to 0x400000):
 *   objOff = objPtr - 0x400000
 *   accumOff = objOff + 0xBC  (long, big-endian)
 *   flagIdxOff = objOff + 0x19  (byte)
 *   dirtyBitmapOff = 0x39C  (byte)
 */

import type { GameState } from "./state.js";

// ─── Address constants ─────────────────────────────────────────────────────

export const OBJECT_ACCUM_FLAG_28608_ADDR = 0x00028608 as const;

/** Absolute base of work RAM. */
const WORK_RAM_BASE = 0x00400000 as const;

/** Offset within object struct of the long accumulator field. */
const OBJ_ACCUM_OFF = 0xbc as const;

/** Offset within object struct of the flag-index byte. */
const OBJ_FLAG_IDX_OFF = 0x19 as const;

/** workRam offset of the global dirty-bitmap byte (absolute 0x40039C). */
const DIRTY_BITMAP_OFF = 0x39c as const;

// ─── Helpers ───────────────────────────────────────────────────────────────

/** Read big-endian long from workRam at byte offset `off`. */
function readLongBE(r: Uint8Array, off: number): number {
  return (
    (((r[off] ?? 0) << 24) |
      ((r[off + 1] ?? 0) << 16) |
      ((r[off + 2] ?? 0) << 8) |
      (r[off + 3] ?? 0)) >>>
    0
  );
}

/** Write big-endian long into workRam at byte offset `off`. */
function writeLongBE(r: Uint8Array, off: number, value: number): void {
  const v = value >>> 0;
  r[off] = (v >>> 24) & 0xff;
  r[off + 1] = (v >>> 16) & 0xff;
  r[off + 2] = (v >>> 8) & 0xff;
  r[off + 3] = v & 0xff;
}

// ─── Main function ─────────────────────────────────────────────────────────

/**
 * Replica bit-perfect of `FUN_00028608`.
 *
 * Adds `value` to the long accumulator at `*(objPtr + 0xBC)` in workRam,
 * then sets bit `(1 << flagIdx) & 0xFF` in the dirty-bitmap byte at
 * workRam[0x39C], where `flagIdx` is the byte read from `*(objPtr + 0x19)`.
 *
 * @param state   GameState (workRam mutated in-place).
 * @param objPtr  Absolute address of the object struct (e.g. 0x400018 + idx*0xE2).
 * @param value   Signed 32-bit long to add to the accumulator.
 */
export function objectAccumFlag28608(
  state: GameState,
  objPtr: number,
  value: number,
): void {
  const r = state.workRam;
  const objOff = (objPtr - WORK_RAM_BASE) >>> 0;

  // add.l D0,(0xBC,A0): *(objPtr + 0xBC) += value  (32-bit wrap)
  const accumOff = objOff + OBJ_ACCUM_OFF;
  const prev = readLongBE(r, accumOff);
  const next = (prev + value) >>> 0; // unsigned 32-bit wrap (same as M68k add.l)
  writeLongBE(r, accumOff, next);

  // move.b (0x19,A0),D1b ; asl.l D1,D0 ; or.b D0b,(0x40039C).l
  const flagIdx = (r[objOff + OBJ_FLAG_IDX_OFF] ?? 0) & 0xff;
  // M68k asl.l with count=D1: shift count is taken mod 64. For flagIdx in
  // 0..7 (expected range), (1 << flagIdx) fits in a byte. We replicated the
  // `or.b D0b` which uses only the low 8 bits of D0 after the shift.
  const shiftCount = flagIdx & 0x3f; // mod 64 per M68k
  const bitMask = ((1 << shiftCount) >>> 0) & 0xff;
  r[DIRTY_BITMAP_OFF] = ((r[DIRTY_BITMAP_OFF] ?? 0) | bitMask) & 0xff;
}
