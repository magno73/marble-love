/**
 * scroll-flag-helper-f6a.ts — domain alias for `FUN_00000F6A`.
 *
 * The implementation already lives in `event-flags.ts` as
 * `detectRisingEdgesAndPass`; this module gives the heavily-called scroll
 * helper its own address/name for call-site wireup and parity tracking.
 */

import type { GameState } from "./state.js";
import { detectRisingEdgesAndPass } from "./event-flags.js";

export const SCROLL_FLAG_HELPER_F6A_ADDR = 0x00000f6a as const;

export function scrollFlagHelperF6A(state: GameState): number {
  return detectRisingEdgesAndPass(state);
}

export { scrollFlagHelperF6A as FUN_00000F6A };
