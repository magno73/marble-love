/**
 * level-dispatcher-helper-18fd0.ts — semantic wrapper for `FUN_00018FD0`.
 *
 * The underlying helper expands `(count,value)` word pairs from the current
 * level descriptor's source pointer into workRam row args at `0x400478`.
 */

import type { RomImage } from "./bus.js";
import { rleExpand } from "./rle-expand.js";
import type { GameState } from "./state.js";

export const LEVEL_DISPATCHER_HELPER_18FD0_ADDR = 0x00018fd0 as const;

export function levelDispatcherHelper18FD0(state: GameState, rom: RomImage): void {
  rleExpand(state, rom);
}
