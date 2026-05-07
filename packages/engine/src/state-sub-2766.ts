/**
 * state-sub-2766.ts — state-machine wrapper for `FUN_00002766`.
 *
 * `FUN_2766` is used by the root game-state machine when a slot reaches
 * state 5. The underlying binary body is the forward alpha-string shift
 * routine, already replicated in `string-shift.ts`; this module exposes it
 * with the state-sub naming/pattern used by the scheduler work.
 */

import type { GameState } from "./state.js";
import type { RomImage } from "./bus.js";
import { shiftStringChainForward } from "./string-shift.js";

export interface StateSub2766Subs {
  // Reserved for symmetry with other state-sub modules. FUN_2766 has no JSR.
}

/**
 * Replica `FUN_00002766` for state-machine state 5.
 *
 * @param state GameState, mutates `alphaRam` through the string shift.
 * @param rom ROM image for lookup tables and linked-list reads.
 * @param argLong pointer to the string/animation struct.
 * @param _subs reserved, currently unused.
 */
export function stateSub2766(
  state: GameState,
  rom: RomImage,
  argLong: number,
  _subs?: StateSub2766Subs,
): void {
  shiftStringChainForward(state, rom, argLong >>> 0);
}

export const STATE_SUB_2766_ADDR = 0x00002766 as const;
