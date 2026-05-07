/**
 * tilemap-span-builder-1aa38.ts — replica `FUN_0001AA38`.
 *
 * Builds/normalizes one scratch row used by `FUN_1A444` before the final
 * `FUN_1A9CC` playfield pack. The routine walks 21 or 22 8-byte cells at the
 * supplied scratch address and writes a bsearch-derived word into each cell's
 * first slot.
 */

import type { RomImage } from "./bus.js";
import { bsearchTable1ABD4 } from "./bsearch-table-1abd4.js";
import type { GameState } from "./state.js";

export const TILEMAP_SPAN_BUILDER_1AA38_ADDR = 0x0001aa38 as const;

const WORK_RAM_BASE = 0x00400000 as const;
const WORK_RAM_END = 0x00402000 as const;
const STATE_PTR_OFF = 0x0474 as const;
const ROM_PAIR_TABLE = 0x0001ec28 as const;

export interface TilemapSpanBuilder1AA38Subs {
  bsearchTable1ABD4?: (targetLong: number) => number;
}

function u16(v: number): number {
  return v & 0xffff;
}

function i16(v: number): number {
  const w = v & 0xffff;
  return w & 0x8000 ? w - 0x10000 : w;
}

function readU8(state: GameState, rom: RomImage, abs: number): number {
  const a = abs >>> 0;
  if (a >= WORK_RAM_BASE && a < WORK_RAM_END) return state.workRam[a - WORK_RAM_BASE] ?? 0;
  return rom.program[a] ?? 0;
}

function readU16(state: GameState, rom: RomImage, abs: number): number {
  return ((readU8(state, rom, abs) << 8) | readU8(state, rom, (abs + 1) >>> 0)) & 0xffff;
}

function readU32(state: GameState, rom: RomImage, abs: number): number {
  return (
    ((readU16(state, rom, abs) << 16) | readU16(state, rom, (abs + 2) >>> 0)) >>>
    0
  );
}

function writeU16(state: GameState, abs: number, value: number): void {
  const a = abs >>> 0;
  if (a < WORK_RAM_BASE || a + 1 >= WORK_RAM_END) return;
  const off = a - WORK_RAM_BASE;
  const v = value & 0xffff;
  state.workRam[off] = (v >>> 8) & 0xff;
  state.workRam[off + 1] = v & 0xff;
}

function addWord(value: number, delta: number): number {
  return i16((value + delta) & 0xffff);
}

function signedLt(a: number, b: number): boolean {
  return i16(a) < i16(b);
}

function signedGt(a: number, b: number): boolean {
  return i16(a) > i16(b);
}

function signedLe(a: number, b: number): boolean {
  return i16(a) <= i16(b);
}

function findPackedOffset(state: GameState, rom: RomImage, baseAbs: number, packed: number): number {
  let a1 = baseAbs >>> 0;
  while (true) {
    const sentinelProbe = readU32(state, rom, a1);
    a1 = (a1 + 4) >>> 0;
    if (sentinelProbe === 0xffffffff) break;
    if (readU32(state, rom, a1) === (packed >>> 0)) break;
  }
  return i16((a1 - baseAbs) & 0xffff);
}

export function buildTilemapSpan1AA38(
  state: GameState,
  rom: RomImage,
  bitLong: number,
  rowWordLong: number,
  scratchAddr: number,
  subs?: TilemapSpanBuilder1AA38Subs,
): void {
  const bit = bitLong & 0xffff;
  const rowWord = i16(rowWordLong);
  let a2 = scratchAddr >>> 0;
  const stateStruct = readU32(state, rom, WORK_RAM_BASE + STATE_PTR_OFF);
  const packedTableBase = readU32(state, rom, stateStruct);
  const search = subs?.bsearchTable1ABD4 ?? ((targetLong: number): number => bsearchTable1ABD4(state, targetLong));

  let d2 = 0x16;
  while (true) {
    d2 = i16(d2 - 1);
    if (d2 <= 0) {
      if (d2 < 0) break;
      if (bit !== 0) {
        writeU16(state, a2, 0);
        break;
      }
    }

    let a3 = i16(readU16(state, rom, a2));
    let a4 = i16(readU16(state, rom, (a2 + 2) >>> 0));
    let a5 = i16(readU16(state, rom, (a2 + 4) >>> 0));
    let a6 = i16(readU16(state, rom, (a2 + 6) >>> 0));
    a2 = (a2 + 8) >>> 0;

    const lower = i16(rowWord - 0x40);
    const upper = i16(rowWord + 0x40);
    let target: number | undefined;
    let transform = false;

    for (const value of [a3, a4, a5, a6]) {
      if (value !== 0 && signedLt(value, 0x1000)) {
        target = value;
        break;
      }
    }

    if (target === undefined) {
      for (const value of [a3, a4, a5, a6]) {
        if (value !== 0 && (signedGt(lower, value) || signedLe(upper, value))) {
          transform = true;
          break;
        }
      }
    }

    if (target === undefined && !transform) {
      if (a3 === a4 && a4 === a5 && a5 === a6) {
        target = a3 === 0 ? 0 : i16(a3 - rowWord + 0xf040);
      } else {
        let d4 = a3;
        let d5 = a3;
        if (d4 !== a4) d5 = a4;
        else if (d4 !== a5) d5 = a5;
        else if (d4 !== a6) d5 = a6;

        if ((a5 !== d4 && a5 !== d5) || (a6 !== d4 && a6 !== d5)) {
          transform = true;
        } else {
          let d0: number;
          let d3: number;
          if (signedLe(d4, d5)) {
            d0 = d5;
            d3 = d4 === 0 ? 0x1000 : i16(d5 - d4);
          } else {
            d0 = d4;
            d3 = d5 === 0 ? 0x1000 : i16(d4 - d5);
          }

          if (d3 === 0x1000) {
            d3 = 0x1f;
          } else if (signedGt(d3, 0x60)) {
            transform = true;
          } else {
            d3 = i16(readU16(state, rom, ROM_PAIR_TABLE + u16(d3) * 2));
            if (signedLt(d3, 0)) {
              transform = true;
            } else {
              let d1 = i16(d0 - rowWord + 0x40);
              d1 = u16(d1 + u16(d3 << 7));
              if (d0 === a4) d1 = u16(d1 + 0x1000);
              if (d0 === a5) d1 = u16(d1 + 0x2000);
              if (d0 === a6) d1 = u16(d1 + 0x4000);
              if (d0 === a3) d1 = u16(d1 + 0x8000);
              target = i16(d1);
            }
          }
        }
      }
    }

    if (target === undefined) {
      const delta = i16(0x80 - rowWord);
      if (a4 !== 0) a4 = addWord(a4, delta);
      if (a5 !== 0) a5 = addWord(a5, delta);
      if (a6 !== 0) a6 = addWord(a6, delta);
      if (a3 !== 0) a3 = addWord(a3, delta);

      const high = u16(u16(a4 << 8) + a5);
      const low = u16(u16(a6 << 8) + a3);
      const packed = ((high << 16) | low) >>> 0;
      target = findPackedOffset(state, rom, packedTableBase, packed);
    }

    const found = search(target);
    writeU16(state, (a2 - 8) >>> 0, found);
  }
}
