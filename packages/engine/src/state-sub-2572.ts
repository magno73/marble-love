/**
 * state-sub-2572.ts — state-machine wrapper for `FUN_00002572`.
 *
 * `FUN_2572` is the render-string-chain routine used by state==2 and Branch A
 * dispatch. The pure renderer body already lives in `string-render.ts`; this
 * module exposes the state-sub-facing wrapper.
 */

import type { RomImage } from "./bus.js";
import type { GameState } from "./state.js";
import { renderStringChain } from "./string-render.js";

export interface StateSub2572Subs {
  // FUN_2572 is a leaf; reserved for symmetry with other state-sub modules.
}

export function stateSub2572(
  state: GameState,
  rom: RomImage,
  arg1Long: number,
  arg2Long: number,
  _subs?: StateSub2572Subs,
): number {
  return renderStringChain(state, rom, arg1Long >>> 0, arg2Long) >>> 0;
}

export const STATE_SUB_2572_ADDR = 0x00002572 as const;
