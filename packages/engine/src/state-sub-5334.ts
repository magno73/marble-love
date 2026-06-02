/**
 * state-sub-5334.ts - port of `FUN_00005334` (42 bytes).
 *
 * Reads bytes at `0x00401F98` and `0x00401F99`, sign-extends each to a 32-bit
 * long, and passes them together with the caller-provided long:
 *
 *   FUN_52DA( signExt32(byte @ 0x401F98),    // arg1 (long)
 *             signExt32(byte @ 0x401F99),    // arg2 (long)
 *             argLong )                      // arg3 (long, pass-through)
 *
 * has no link-frame of its own).
 *
 * **Disasm 0x5334..0x535D** (42 byte = 0x2A):
 *
 *   move.l (0x4,SP),D0           ; D0 = argLong (caller pushed a long arg)
 *   move.l D0,-(SP)              ; push arg3 (argLong)
 *   move.b (0x00401F99).l,D0b    ; D0b = byte @ 0x401F99
 *   ext.w  D0w                   ; sign-extend byte→word
 *   ext.l  D0                    ; sign-extend word→long
 *   move.l D0,-(SP)              ; push arg2 (signExt32 byte 0x401F99)
 *   move.b (0x00401F98).l,D0b    ; D0b = byte @ 0x401F98
 *   ext.w  D0w
 *   ext.l  D0
 *   move.l D0,-(SP)              ; push arg1 (signExt32 byte 0x401F98)
 *   lea    (0xC,SP),SP           ; pop 3 long args (12 bytes), does not touch D0
 *
 * **Sign extension**: `ext.w` on signed byte (-128..127) yields a word with the
 * same value. The TS equivalent is `(byte << 24) >> 24`, then unsigned-cast
 * with `>>> 0`.
 *
 * Exposed as callback `inner` (default `() => 0`) so tests can substitute that
 * subsystem; the differential test currently uses the binary implementation
 * through Musashi.
 *
 * **Side effects**:
 *     MMIO and does not alter RNG.
 *     Other effects are handled separately by its future port.
 *
 *     FUN_52DA suggests two small integers plus one long. It may be a composite
 *     slot/index dispatch, but confirmation requires separate analysis; this
 *     helper only preserves the observed argument setup exactly.
 *
 */

import type { GameState } from "./state.js";

// ─── MMIO/work RAM addresses ─────────────────────────────────────────────

/** Absolute base of the work RAM (M68k: 0x400000..0x401FFF, 8 KB). */
const WORK_RAM_BASE = 0x00400000;

export const ARG1_BYTE_ADDR = 0x00401f98 as const;

export const ARG2_BYTE_ADDR = 0x00401f99 as const;

// ─── Types ───────────────────────────────────────────────────────────────

/**
 * Signature of the callee `FUN_000052DA`. Receives 3 unsigned longs (0..0xFFFFFFFF):
 *   - `arg1` = signExt32 of the byte @ 0x401F98
 *   - `arg2` = signExt32 of the byte @ 0x401F99
 *   - `arg3` = argLong pass-through from the caller of FUN_5334
 *
 */
export type Sub5334Inner = (
  arg1: number,
  arg2: number,
  arg3: number,
) => number;

// ─── Utility: sign-extend byte → int32 ───────────────────────────────────

/**
 * Sign-extend a byte (0..0xFF) to an M68k long (32-bit int), returned as an
 * unsigned 32-bit value (0..0xFFFFFFFF).
 *
 *   `move.b ...,D0b`        → D0 lower-byte = byte (D0 high preserved? No: in
 *                              other 24 bits unchanged — but here the caller
 *                              makes that irrelevant).
 *   `ext.w D0w`             → D0w = signExt(D0b)  (word, 16 bit)
 *   `ext.l D0`              → D0  = signExt(D0w)  (long, 32 bit)
 *
 *   byte 0x00 → 0x00000000
 *   byte 0x01 → 0x00000001
 *   byte 0x7F → 0x0000007F
 *   byte 0x80 → 0xFFFFFF80
 *   byte 0xFF → 0xFFFFFFFF
 */
function signExtByteToU32(b: number): number {
  return (((b & 0xff) << 24) >> 24) >>> 0;
}

// ─── Replica ──────────────────────────────────────────────────────────────

/**
 *
 *                 as arg3 to `inner`.
 * @param inner    Callback that models `FUN_00005334`'s callee `FUN_000052DA`.
 *
 * Note of low-level fidelity:
 *     of the M68k `ext.w`/`ext.l`.
 *     independent.
 *     exactly that of `inner` (clamped to uint32).
 *     D2..D7 / A2..A6 beyond those of the callee).
 */
export function stateSub5334(
  state: GameState,
  argLong: number,
  inner: Sub5334Inner = () => 0,
): number {
  const off98 = (ARG1_BYTE_ADDR - WORK_RAM_BASE) >>> 0; // 0x1F98
  const off99 = (ARG2_BYTE_ADDR - WORK_RAM_BASE) >>> 0; // 0x1F99

  const byte98 = state.workRam[off98] ?? 0;
  const byte99 = state.workRam[off99] ?? 0;

  // Sign-extend byte → unsigned32 (matches the M68k `ext.w`/`ext.l`).
  const arg1 = signExtByteToU32(byte98);
  const arg2 = signExtByteToU32(byte99);
  const arg3 = argLong >>> 0;

  // Tail-call the callee with the 3 prepared longs.
  return inner(arg1, arg2, arg3) >>> 0;
}
