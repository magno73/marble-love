/**
 * clear-alpha-tiles-28c7e.ts — entrypoint wrapper for `FUN_00028C7E`.
 *
 * `FUN_28C7E` takes one stack long whose low word is interpreted as a start
 * row, multiplies it by 64, then clears alpha tile words through tile 0x780.
 * The main-loop-init callsites push zero, so this dedicated helper models the
 * observed no-argument hook by clearing from row 0.
 */

import type { GameState } from "./state.js";
import { clearAlphaTilesFromIndex } from "./alpha-tilemap.js";

export const CLEAR_ALPHA_TILES_28C7E_ADDR = 0x00028c7e as const;

export function clearAlphaTiles28C7E(state: GameState): void {
  clearAlphaTilesFromIndex(state, 0);
}

export { clearAlphaTiles28C7E as FUN_00028C7E };
