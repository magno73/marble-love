/**
 * string-trim.ts — `FUN_00028F28` (58 byte) + `FUN_000172C2` (74 byte).
 *
 * - **FUN_28F28 — `trimTrailingSpace(strPtr, maxLen)`**: walka string fino
 *   a primo space o maxLen. Se trova space prima di maxLen, lo azzera.
 *
 * - **FUN_172C2 — `findLastActiveSlot()`**: scansiona array a 0x401482
 *   con stride 0x42, 7 entries. Returns address dell'ultima entry con
 *   byte +0x18 non-zero, o -1.
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
