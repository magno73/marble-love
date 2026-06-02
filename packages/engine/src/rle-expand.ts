/**
 * rle-expand.ts — replica `FUN_00018FD0` (42 byte): RLE-style expand.
 *
 * Expands a list of (count, value) word pairs into an array of words.
 *
 * Logic:
 *   A0 = *(*0x400474 + 0xC) (long pointer to compressed source)
 *   A1 = 0x400478 (destination)
 *   loop:
 *     D2 = *(A0)+ (count, word)
 *     if D2 == 0: exit
 *     D1 = *(A0)+ (value, word)
 *     write D1 to *(A1)+ for D2 iterations
 *     restart loop
 */

import type { RomImage } from "./bus.js";
import type { GameState } from "./state.js";

const SRC_PTR_PTR_OFF = 0x474; // *0x400474 → ptr to header struct
const DST_OFF = 0x478;          // 0x400478
const WORK_RAM_BASE = 0x00400000;
const WORK_RAM_END = 0x00402000;

function readWorkU32(state: GameState, off: number): number {
  const r = state.workRam;
  return (
    (((r[off] ?? 0) << 24) |
      ((r[off + 1] ?? 0) << 16) |
      ((r[off + 2] ?? 0) << 8) |
      (r[off + 3] ?? 0)) >>>
    0
  );
}

function readAbsU8(state: GameState, rom: RomImage | undefined, abs: number): number {
  const a = abs >>> 0;
  if (a >= WORK_RAM_BASE && a < WORK_RAM_END) return state.workRam[a - WORK_RAM_BASE] ?? 0;
  return rom?.program[a] ?? 0;
}

function readAbsU16(state: GameState, rom: RomImage | undefined, abs: number): number {
  return ((readAbsU8(state, rom, abs) << 8) | readAbsU8(state, rom, (abs + 1) >>> 0)) & 0xffff;
}

function readAbsU32(state: GameState, rom: RomImage | undefined, abs: number): number {
  return ((readAbsU16(state, rom, abs) << 16) | readAbsU16(state, rom, (abs + 2) >>> 0)) >>> 0;
}

export function rleExpand(state: GameState, rom?: RomImage): void {
  const r = state.workRam;
  // A0 = *(*0x400474 + 0xC)
  const ptrPtr = readWorkU32(state, SRC_PTR_PTR_OFF);
  let a0 = readAbsU32(state, rom, (ptrPtr + 0x0c) >>> 0);
  let a1Off = DST_OFF;

  // Safety bound
  let safety = 1024;
  while (safety-- > 0) {
    const d2 = readAbsU16(state, rom, a0);
    a0 = (a0 + 2) >>> 0;
    if (d2 === 0) return;
    const d1 = readAbsU16(state, rom, a0);
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
