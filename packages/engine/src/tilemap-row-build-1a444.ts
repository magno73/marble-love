/**
 * tilemap-row-build-1a444.ts — skeleton replica of `FUN_0001A444`.
 *
 * Heavy decode helpers (`FUN_2FFB8`, `FUN_1AD54`, `FUN_1AA38`) are exposed as
 * injectable callbacks and default to no-op, matching parity tests with those
 * binary JSRs patched to `rts`. The final `FUN_1A9CC` pack remains real and
 * writes into `state.playfieldRam`.
 */

import type { RomImage } from "./bus.js";
import type { GameState } from "./state.js";
import { packTilemapEntries1A9CC } from "./tilemap-entry-pack-1a9cc.js";

export const TILEMAP_ROW_BUILD_1A444_ADDR = 0x0001a444 as const;

const STATE_PTR_OFF = 0x0474 as const;
const ROW_ARG_BASE_OFF = 0x0478 as const;
const BINSEARCH_BASE_PTR_OFF = 0x065a as const;
const BINSEARCH_END_PTR_OFF = 0x065e as const;
const GLOBAL_0662_OFF = 0x0662 as const;
const TICK_03F0_OFF = 0x03f0 as const;
const SCRATCH_BASE = 0x00400a9c as const;
const SCRATCH_BASE_OFF = 0x0a9c as const;
const SCRATCH_CLEAR_LONGS = 0x420 as const;
const PF_ROW_OFFSET_TABLE = 0x1eb3a as const;

export interface TilemapRowBuild1A444Subs {
  fun_2ffb8?: (argLong: number) => void;
  fun_1ad54?: (args: {
    destLong: number;
    xLong: number;
    yLong: number;
    heightLong: number;
    bitLong: number;
  }) => void;
  fun_1aa38?: (args: { bitLong: number; rowWordLong: number; scratchAddr: number }) => void;
  fun_1a9cc?: (destOffsetInPlayfield: number, sourceAddr: number) => void;
}

function readU8(state: GameState, off: number): number {
  return state.workRam[off] ?? 0;
}

function writeU8(state: GameState, off: number, value: number): void {
  state.workRam[off] = value & 0xff;
}

function readU16(state: GameState, off: number): number {
  return ((state.workRam[off] ?? 0) << 8) | (state.workRam[off + 1] ?? 0);
}

function readI16(state: GameState, off: number): number {
  const w = readU16(state, off);
  return w & 0x8000 ? w - 0x10000 : w;
}

function writeU32(state: GameState, off: number, value: number): void {
  const v = value >>> 0;
  state.workRam[off] = (v >>> 24) & 0xff;
  state.workRam[off + 1] = (v >>> 16) & 0xff;
  state.workRam[off + 2] = (v >>> 8) & 0xff;
  state.workRam[off + 3] = v & 0xff;
}

function readU32(state: GameState, off: number): number {
  return (
    (((state.workRam[off] ?? 0) << 24) |
      ((state.workRam[off + 1] ?? 0) << 16) |
      ((state.workRam[off + 2] ?? 0) << 8) |
      (state.workRam[off + 3] ?? 0)) >>>
    0
  );
}

function offFromAbs(addr: number): number {
  return (addr >>> 0) - 0x00400000;
}

function readRomI16(rom: RomImage, addr: number): number {
  const w = ((rom.program[addr] ?? 0) << 8) | (rom.program[addr + 1] ?? 0);
  return w & 0x8000 ? w - 0x10000 : w;
}

function readRomU8(rom: RomImage, addr: number): number {
  return rom.program[addr] ?? 0;
}

export function buildTilemapRows1A444(
  state: GameState,
  rom: RomImage,
  subs?: TilemapRowBuild1A444Subs,
): void {
  const stateStruct = readU32(state, STATE_PTR_OFF);
  const stateStructOff = offFromAbs(stateStruct);
  const entryCount = readI16(state, stateStructOff + 0x1a);
  const listPtr = readU32(state, stateStructOff + 0x08);
  let listOff = offFromAbs(listPtr);

  const index24 = readI16(state, stateStructOff + 0x24);
  const basePtr = readU32(state, BINSEARCH_BASE_PTR_OFF);
  const d2 = (basePtr + index24 * 2) >>> 0;
  writeU32(state, BINSEARCH_END_PTR_OFF, (d2 - 2) >>> 0);

  let d4 = -0x18;
  let lastWord = 0;

  while (true) {
    d4 = ((d4 + 0x18) << 16) >> 16;
    const y = ((d4 + 0x15) << 16) >> 16;
    const x = (((d4 >> 1) + 0x15) << 16) >> 16;
    let height = 0x18;
    const limit = readI16(state, stateStructOff + 0x18) - 0x18;
    if (d4 > limit) height = (readI16(state, stateStructOff + 0x18) - d4) << 16 >> 16;

    for (let i = 0; i < SCRATCH_CLEAR_LONGS; i++) writeU32(state, SCRATCH_BASE_OFF + i * 4, 0);

    const destStart = readU32(state, stateStructOff + 0x1c);
    const levelIndex = readU16(state, 0x0394);
    const lookup = readRomU8(rom, 0x24994 + levelIndex);
    subs?.fun_2ffb8?.((lookup & 0x80) !== 0 ? lookup - 0x100 : lookup);

    let pendingBits = 0;
    for (let d3 = 0; d3 < entryCount; d3++) {
      writeU8(state, TICK_03F0_OFF, (readU8(state, TICK_03F0_OFF) + 1) & 0xff);
      if ((d3 & 0x0f) === 0) {
        pendingBits = readU16(state, listOff);
        listOff += 2;
      }
      const bit = (pendingBits >> (d3 & 0x0f)) & 1;
      subs?.fun_1ad54?.({ destLong: destStart + d3 * 8, xLong: y, yLong: x, heightLong: height, bitLong: bit });
    }

    while (true) {
      lastWord = readU16(state, listOff);
      listOff += 2;
      const masked = lastWord & 0xfffe;
      if (masked === 0xfffe) break;

      const low = lastWord & 0xff;
      const high = (lastWord >> 8) & 0xff;
      const index = (((high * 0x16) << 16) >>> 0) + low + 0x16 * 8;
      const targetOff = SCRATCH_BASE_OFF + index;
      const value = readU16(state, listOff);
      listOff += 2;
      state.workRam[targetOff] = (value >>> 8) & 0xff;
      state.workRam[targetOff + 1] = value & 0xff;
    }

    subs?.fun_2ffb8?.(readI16(state, GLOBAL_0662_OFF));

    let scratchAddr = SCRATCH_BASE;
    let rowArgOff = ROW_ARG_BASE_OFF;
    for (let d3 = 0; d3 < height; d3++) {
      writeU8(state, TICK_03F0_OFF, (readU8(state, TICK_03F0_OFF) + 1) & 0xff);
      const rowWord = readI16(state, rowArgOff);
      rowArgOff += 2;
      subs?.fun_1aa38?.({ bitLong: d3 & 1, rowWordLong: rowWord, scratchAddr });
      scratchAddr = (scratchAddr + 0xb0) >>> 0;
    }

    let sourceAddr = SCRATCH_BASE;
    const rows = height >> 1;
    for (let d3 = 0; d3 < rows; d3++) {
      const tableIndex = ((d4 >> 1) + d3) * 2;
      const destOffset = readRomI16(rom, PF_ROW_OFFSET_TABLE + tableIndex);
      if (subs?.fun_1a9cc) subs.fun_1a9cc(destOffset, sourceAddr);
      else packTilemapEntries1A9CC(state, destOffset, sourceAddr);
      sourceAddr = (sourceAddr + 0x160) >>> 0;
    }

    if ((lastWord & 0xffff) === 0xffff) break;
  }

  const clearLongs = Math.trunc((0x00401c48 - SCRATCH_BASE) / 4);
  for (let i = 0; i < clearLongs; i++) writeU32(state, SCRATCH_BASE_OFF + i * 4, 0);
}
