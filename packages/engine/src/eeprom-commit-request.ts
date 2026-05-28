/**
 * Bit-perfect port of `FUN_00003FC6`.
 *
 * This is a consume/pace-check wrapper around the counter scaler implemented
 * in `eepromCommit`. The inherited name mentions EEPROM because the original
 * thunk was labelled that way during reverse engineering, but this routine
 * only touches work RAM counters used by the sound/effect pacing path.
 *
 * Control flow:
 * - query the read-only `FUN_3F3E` rate helper, yielding 0 or 1..4;
 * - return 1 immediately when `(arg.w * rate.w) & 0xffff` is zero;
 * - otherwise run `FUN_3F78` (`eepromCommit`) to drain and scale the budget;
 * - return 0 if the budget is below `signext(arg.w) * 12`;
 * - otherwise subtract the low product byte from `0x401FF5` and return 1.
 *
 * The caller pushes a long, but the 68k routine reads only its low word at
 * `(0xE,SP)`. Parity is covered by `test-eeprom-commit-request-parity.ts`.
 */

import type { GameState } from "./state.js";
import { eepromCommit } from "./eeprom-commit.js";

/** Work RAM offset of `0x401FF5` relative to base `0x400000`. */
const ACC_FF5_OFF = 0x1ff5;

/** WorkRam offset del long pointer @ 0x401FFC. */
const PTR_FFC_OFF = 0x1ffc;

/** RAM base. */
const WORK_RAM_BASE = 0x400000;

/** Status threshold at which `FUN_3F3E` returns 0. */
const STATUS_EXIT_THRESHOLD = 0xe0;

/** Final scale multiplier from `muls.w #0xC,D0`. */
const SCALE_MUL = 0xc;

/**
 * Bit-perfect copy of the internal `FUN_00003F3E` rate query.
 *
 * It reads the player struct pointer from `0x401FFC`, validates the status
 * byte at `ptr+0xA` against the complement byte at `ptr+0xB`, then returns 0
 * for status values >= 0xE0 or `(status & 3) + 1` otherwise.
 */
function helperFun3F3E(state: GameState): number {
  const r = state.workRam;

  const ptr =
    (((r[PTR_FFC_OFF] ?? 0) << 24) |
      ((r[PTR_FFC_OFF + 1] ?? 0) << 16) |
      ((r[PTR_FFC_OFF + 2] ?? 0) << 8) |
      (r[PTR_FFC_OFF + 3] ?? 0)) >>>
    0;
  const ptrOff = (ptr - WORK_RAM_BASE) >>> 0;

  let d2 = (r[ptrOff + 0xa] ?? 0) & 0xff;
  const notB = ~(r[ptrOff + 0xb] ?? 0) & 0xff;
  if (d2 !== notB) d2 = 0;

  if (d2 >= STATUS_EXIT_THRESHOLD) {
    return 0;
  }
  return (d2 & 3) + 1;
}

/**
 * Bit-perfect port of `FUN_00003FC6`.
 *
 * Wrapper "consume / pace-check":
 * @param state Game state mutated only on the paths that call `eepromCommit`
 *              or subtract from `0x401FF5`.
 * @param arg 32-bit caller argument; only `arg & 0xffff` is observed.
 * @returns D0 as an unsigned long, either 0 or 1.
 */
export function eepromCommitRequest(state: GameState, arg: number): number {
  const r = state.workRam;

  // D2.w = arg low word; D3.w receives the same value.
  const d2w = arg & 0xffff;
  const d3wInitial = d2w;

  // First JSR -> FUN_3F3E: read-only rate query.
  const rate = helperFun3F3E(state) & 0xffff;

  // mulu.w D0w,D3: D3.l = D3.w * D0.w (32-bit unsigned product).
  const d3l = ((d3wInitial * rate) >>> 0) & 0xffffffff;

  // `move.w D3w,D3w; bne work` tests the low product word.
  if ((d3l & 0xffff) === 0) {
    // `moveq #1,D0`: return 1 without calling `FUN_3F78`.
    return 1;
  }

  // Second JSR -> FUN_3F78: full drain-and-scale routine.
  const budget = eepromCommit(state) >>> 0;

  // move.l D0,D1: D1 = budget (long).
  // move.w D2w,D0w: D0.w = arg.w (D0 alto = budget alto post-jsr).
  // ext.l D0: D0.l = signext(D0.w) = signext(arg.w).
  // muls.w #0xC,D0: D0.l = (int16)(arg.w) * 12 (signed long product).
  const argSignedW = (d2w & 0x8000) !== 0 ? d2w - 0x10000 : d2w;
  const d0Signed = (argSignedW * SCALE_MUL) | 0;

  // cmp.l D0,D1: flags = D1 - D0 (signed long compare).
  // `eepromCommit` yields 0..0x12C in this path, so signed and unsigned order
  // are equivalent for the budget value.
  const d1Signed = budget | 0;
  if (d1Signed < d0Signed) {
    // `moveq #0,D0`: return without the extra accumulator subtract.
    return 0;
  }

  // move.b D3b,D0b; sub.b D0b,(0x401FF5).l: byte @ 0x401FF5 -= D3.b modulo 256.
  const d3b = d3l & 0xff;
  const accOld = (r[ACC_FF5_OFF] ?? 0) & 0xff;
  r[ACC_FF5_OFF] = (accOld - d3b) & 0xff;

  // `moveq #1,D0`.
  return 1;
}
