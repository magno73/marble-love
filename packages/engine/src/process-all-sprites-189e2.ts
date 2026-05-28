/**
 * Port of ROM routine `FUN_000189E2`.
 *
 * When gate word `0x400394` is zero, iterates active sprite entries starting at
 * `0x40098C` with stride 0xC and calls `computeSpriteCoords_v1` for each entry
 * up to count word `0x400396`. The original byte loop would have overflow edge
 * cases for huge counts; game callers keep the count small.
 */

import type { GameState } from "./state.js";
import { computeSpriteCoords_v1 } from "./sprite-coords.js";

/** Work RAM base used to derive relative offsets. */
const WORK_RAM_BASE = 0x400000;

const SPRITE_TABLE_BASE_ABS = 0x40098c;
const SPRITE_TABLE_STRIDE = 0xc;
const GATE_FLAG_OFF = 0x394; // word @ 0x400394
const COUNT_OFF = 0x396; // word @ 0x400396

/** Read big-endian u16 from a workRam offset. */
function readU16(state: GameState, off: number): number {
  return (((state.workRam[off] ?? 0) << 8) | (state.workRam[off + 1] ?? 0)) & 0xffff;
}

/**
 * Calls `computeSpriteCoords_v1` for each entry when gate `*0x400394` is clear.
 *
 *
 * Uses a standard `for i in [0..count)` loop over `0x40098C + i * 0xC`.
 */
export function processAllSprites(state: GameState): void {
  // tst.w (0x400394).l: skip when gate != 0.
  const gate = readU16(state, GATE_FLAG_OFF);
  if (gate !== 0) {
    return;
  }

  // Loop body: counter byte -> sign-extended word -> cmp.w with count word.
  const count = readU16(state, COUNT_OFF);
  for (let i = 0; i < count; i++) {
    const entryAddr = (SPRITE_TABLE_BASE_ABS + i * SPRITE_TABLE_STRIDE) >>> 0;
    computeSpriteCoords_v1(state, entryAddr);
  }
}

/**
 * Test hook for callers that need to observe each entry without invoking
 * `computeSpriteCoords_v1`.
 *
 */
export function processAllSpritesWith(
  state: GameState,
  onEntry: (state: GameState, entryAddr: number) => void,
): void {
  const gate = readU16(state, GATE_FLAG_OFF);
  if (gate !== 0) {
    return;
  }
  const count = readU16(state, COUNT_OFF);
  for (let i = 0; i < count; i++) {
    const entryAddr = (SPRITE_TABLE_BASE_ABS + i * SPRITE_TABLE_STRIDE) >>> 0;
    onEntry(state, entryAddr);
  }
}

/** Constants exposed for testing/inspection. */
export const SPRITE_TABLE_BASE = SPRITE_TABLE_BASE_ABS;
export const SPRITE_TABLE_ENTRY_STRIDE = SPRITE_TABLE_STRIDE;
export const GATE_FLAG_ADDR = WORK_RAM_BASE + GATE_FLAG_OFF;
export const COUNT_ADDR = WORK_RAM_BASE + COUNT_OFF;
