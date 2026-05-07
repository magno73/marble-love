/**
 * state-sub-2818.ts — state-machine wrapper for `FUN_00002818`.
 *
 * `FUN_2818` is used by the root game-state machine when a slot reaches
 * state 6. The binary body is the backward alpha-string shift routine,
 * already replicated in `string-shift.ts`; this module exposes the
 * state-sub-facing wrapper.
 */

import type { GameState } from "./state.js";
import type { RomImage } from "./bus.js";
import { shiftStringChainBackward } from "./string-shift.js";

export interface StateSub2818Subs {
  // Reserved for symmetry with other state-sub modules. FUN_2818 has no JSR.
}

export function stateSub2818(
  state: GameState,
  rom: RomImage,
  argLong: number,
  _subs?: StateSub2818Subs,
): void {
  shiftStringChainBackward(state, rom, argLong >>> 0);
}

export const STATE_SUB_2818_ADDR = 0x00002818 as const;
