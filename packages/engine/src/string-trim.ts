/**
 * string-trim.ts - `FUN_00028F28` (58 bytes) + `FUN_000172C2` (74 bytes).
 *
 * - **FUN_28F28 - `trimTrailingSpace(strPtr, maxLen)`**: walks the string until
 *   the first space or maxLen. If it finds a space before maxLen, it clears it.
 *
 * - **FUN_172C2 - `findLastActiveSlot()`**: scans the array at 0x401482 with
 *   stride 0x42, 7 entries. Returns the address of the last entry with
 *   byte +0x18 non-zero, or -1.
 */

import type { GameState } from "./state.js";

export function trimTrailingSpace(state: GameState, strAddr: number, maxLen: number): void {
  const r = state.workRam;
  const baseOff = strAddr - 0x400000;
  let d2 = 0;
  while (true) {
    const ch = r[(baseOff + d2) >>> 0] ?? 0;
    if (ch === 0x20) break;
    if ((d2 | 0) >= (maxLen | 0)) break;
    d2++;
  }
  if ((d2 | 0) < (maxLen | 0)) {
    const ch = r[(baseOff + d2) >>> 0] ?? 0;
    if (ch === 0x20) {
      r[(baseOff + d2) >>> 0] = 0;
    }
  }
}

const STRUCT_BASE_ADDR = 0x401482;
const STRUCT_STRIDE = 0x42;

export function findLastActiveSlot(state: GameState): number {
  const r = state.workRam;
  const baseOff = STRUCT_BASE_ADDR - 0x400000;
  let result = 0xffffffff; // -1 long
  for (let d2 = 0; d2 < 7; d2++) {
    const off = baseOff + d2 * STRUCT_STRIDE;
    const byteAt18 = r[off + 0x18] ?? 0;
    if (byteAt18 === 0) {
      result = (STRUCT_BASE_ADDR + d2 * STRUCT_STRIDE) >>> 0;
    }
  }
  return result;
}
