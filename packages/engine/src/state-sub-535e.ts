/**
 * state-sub-535e.ts - port of `FUN_0000535E` (42 bytes).
 *
 * Forwards two sign-extended global bytes plus one caller long from the stack
 * to `FUN_00005388`. This mirrors `state-sub-5334.ts`.
 *
 * **Disasm 0x535E..0x5387** (42 byte):
 *
 *   move.l (0x4,SP),D0           ; D0 = caller arg long
 *   move.l D0,-(SP)              ; push arg -> becomes (0x10,SP) for the callee
 *   move.b (0x00401F99).l,D0b    ; D0b = byte @ 0x401F99
 *   ext.w  D0w                   ; sign-extend byte → word
 *   ext.l  D0                    ; sign-extend word → long
 *   move.l D0,-(SP)              ; push byte99 (signed long) -> (0x0C,SP) callee
 *   move.b (0x00401F98).l,D0b    ; D0b = byte @ 0x401F98
 *   ext.w  D0w
 *   ext.l  D0                    ; signed long
 *   move.l D0,-(SP)              ; push byte98 (signed long) -> (0x08,SP) callee
 *   lea    (0xC,SP),SP           ; pop 3 long
 *   rts                          ; D0 = FUN_5388 return value
 *
 *   - `0x5900`: arg = another computed long
 *   - `0x5B96`: arg = another computed long
 *
 *   These trampolines are likely "signed-byte pair + value" formatters delegated
 *   to two different callee implementations.
 *
 *
 * **Sign-extension semantics**:
 *   `move.b -> ext.w -> ext.l`. For byte `0xFF`, `D0 = 0xFFFFFFFF` (-1 long).
 *   For byte `0x80`, `D0 = 0xFFFFFF80` (-128). For byte `0x7F`, `D0 = 0x7F`.
 *   The TS port uses `(byte << 24) >> 24` (signed shift), then `>>> 0` for the
 *   unsigned 32-bit representation used by nearby modules.
 *
 *
 */

import type { GameState } from "./state.js";

export const GLOBAL_BYTE_98_ADDR = 0x00401f98 as const;

export const GLOBAL_BYTE_99_ADDR = 0x00401f99 as const;

/** WORK RAM base used to derive offsets into `state.workRam`. */
const WORK_RAM_BASE = 0x00400000;

/**
 * Signature of the inner sub (FUN_00005388). Receives `(byte98_signed_long,
 */
export type Sub535ECallee = (
  byte98: number,
  byte99: number,
  arg: number,
) => number;

/**
 * Sign-extend a byte (0..0xFF) to an M68k long (0..0xFFFFFFFF) with bit 7 as sign.
 *
 * `byte 0x7F → 0x0000007F`, `byte 0x80 → 0xFFFFFF80`, `byte 0xFF →
 * 0xFFFFFFFF`. Equivalente a `(b << 24) >> 24` (signed shift right) seguito
 * da `>>> 0`.
 */
function signExtendByteToLong(b: number): number {
  return (((b & 0xff) << 24) >> 24) >>> 0;
}

/**
 *
 * to the `inner` callback.
 *
 * @param state  GameState. Reads only `workRam[0x1F98]` and `workRam[0x1F99]`.
 * @param inner  Callback modeling `FUN_00005388`. Default = `() => 0`.
 *
 * Note of low-level fidelity:
 *     The unsigned 32-bit representation matches M68k long semantics.
 *     The globals are read once each and are not mutated between reads.
 *     The caller arg is propagated as an unsigned long; negative inputs wrap
 *     through two's-complement long representation.
 */
export function stateSub535E(
  state: GameState,
  arg: number,
  inner: Sub535ECallee = () => 0,
): number {
  const r = state.workRam;
  // Absolute offsets -> workRam-relative offsets (base 0x400000).
  const off98 = (GLOBAL_BYTE_98_ADDR - WORK_RAM_BASE) >>> 0;
  const off99 = (GLOBAL_BYTE_99_ADDR - WORK_RAM_BASE) >>> 0;

  const byte99Signed = signExtendByteToLong(r[off99] ?? 0);
  const byte98Signed = signExtendByteToLong(r[off98] ?? 0);

  // Normalizza arg a unsigned long.
  const argU = arg >>> 0;

  // jsr inner(byte98, byte99, arg) — order matches stack push of binary
  // (callee vede arg1=(0x4,SP)=byte98, arg2=(0x8,SP)=byte99, arg3=(0xC,SP)=arg).
  return inner(byte98Signed, byte99Signed, argU) >>> 0;
}
