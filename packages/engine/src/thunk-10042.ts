/**
 * thunk-10042.ts — `FUN_00010042` replica (6-byte thunk).
 *
 * Disasm:
 *   00010042  jmp 0x00028468.l
 *
 * `jsr 0x10042` immediately falls through to `FUN_00028468`.
 *
 * Xref:
 *   - 0x00000BC2 (UNCONDITIONAL_CALL) → only caller.
 */

import type { GameState } from "./state.js";
import {
  trackballClampFlags28468,
  type TrackballClampFlags28468Inputs,
} from "./trackball-clamp-flags-28468.js";

export const FUN_10042_ADDR = 0x00010042 as const;

/**
 *
 * Delegates entirely to `trackballClampFlags28468` (FUN_00028468).
 *
 * @param state GameState (workRam mutated by the target function).
 * @param inputs MMIO bag passed to `trackballClampFlags28468`.
 * @returns signed long (D0), matching FUN_00028468.
 */
export function thunk10042(
  state: GameState,
  inputs: TrackballClampFlags28468Inputs,
): number {
  return trackballClampFlags28468(state, inputs);
}

export { thunk10042 as FUN_00010042 };
