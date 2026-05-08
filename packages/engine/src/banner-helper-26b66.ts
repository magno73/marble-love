/**
 * banner-helper-26b66.ts — named main-loop entrypoint for `FUN_00026B66`.
 *
 * The routine pushes the low byte of its stack argument into the palette queue
 * and clamps the queue pointer at `0x40040F`.
 */

import type { GameState } from "./state.js";
import { paletteQueuePush } from "./palette-queue.js";

export const BANNER_HELPER_26B66_ADDR = 0x00026b66 as const;

export function bannerHelper26B66(state: GameState, argLong: number): void {
  paletteQueuePush(state, argLong);
}

export { bannerHelper26B66 as FUN_00026B66 };
