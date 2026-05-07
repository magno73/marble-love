/**
 * state-sub-2cd4.ts — state-machine wrapper for `FUN_00002CD4`.
 *
 * `FUN_2CD4` is the state==3 incremental render condition: render one
 * character from a string entry and return the next state byte (0 or 3).
 */

import type { RomImage } from "./bus.js";
import type { GameState } from "./state.js";
import { stepRenderState3 } from "./string-step.js";

export interface StateSub2CD4Subs {
  // FUN_2CD4 is a leaf; reserved for symmetry with other state-sub modules.
}

export function stateSub2CD4(
  state: GameState,
  rom: RomImage,
  arg1Long: number,
  arg2Long: number,
  arg3Long: number,
  _subs?: StateSub2CD4Subs,
): number {
  return stepRenderState3(state, rom, arg1Long >>> 0, arg2Long, arg3Long & 0xff) & 0xff;
}

export const STATE_SUB_2CD4_ADDR = 0x00002cd4 as const;
