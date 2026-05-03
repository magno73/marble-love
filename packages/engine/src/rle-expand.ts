/**
 * rle-expand.ts — replica `FUN_00018FD0` (42 byte): RLE-style expand.
 *
 * Espande una lista (count, value) word pairs in un array di word.
 *
 * Logica:
 *   A0 = *(*0x400474 + 0xC) (long pointer to compressed source)
 *   A1 = 0x400478 (destination)
 *   loop:
 *     D2 = *(A0)+ (count, word)
 *     if D2 == 0: exit
 *     D1 = *(A0)+ (value, word)
 *     write D1 to *(A1)+ for D2 iterations
 *     restart loop
 */

import type { GameState } from "./state.js";

const SRC_PTR_PTR_OFF = 0x474; // *0x400474 → ptr to header struct
const DST_OFF = 0x478;          // 0x400478

export function rleExpand(state: GameState): void {
  const r = state.workRam;
  // A0 = *(*0x400474 + 0xC)
  const ptrPtr =
    (((r[SRC_PTR_PTR_OFF] ?? 0) << 24) |
      ((r[SRC_PTR_PTR_OFF + 1] ?? 0) << 16) |
      ((r[SRC_PTR_PTR_OFF + 2] ?? 0) << 8) |
      (r[SRC_PTR_PTR_OFF + 3] ?? 0)) >>> 0;
  const headerOff = (ptrPtr - 0x400000 + 0xC) >>> 0;
  let a0 =
    (((r[headerOff] ?? 0) << 24) |
      ((r[headerOff + 1] ?? 0) << 16) |
      ((r[headerOff + 2] ?? 0) << 8) |
      (r[headerOff + 3] ?? 0)) >>> 0;
  let a1Off = DST_OFF;

  // Safety bound
  let safety = 1024;
  while (safety-- > 0) {
    const a0Off = (a0 - 0x400000) >>> 0;
    const d2 = ((r[a0Off] ?? 0) << 8) | (r[a0Off + 1] ?? 0);
    a0 = (a0 + 2) >>> 0;
    if (d2 === 0) return;
    const d1HiOff = (a0 - 0x400000) >>> 0;
    const d1 = ((r[d1HiOff] ?? 0) << 8) | (r[d1HiOff + 1] ?? 0);
    a0 = (a0 + 2) >>> 0;
    // Inner loop: write d1 to *A1++ for d2 word iterations
    let d0 = 0;
    while (d0 < d2) {
      r[a1Off] = (d1 >>> 8) & 0xff;
      r[a1Off + 1] = d1 & 0xff;
      a1Off += 2;
      d0++;
    }
  }
}
