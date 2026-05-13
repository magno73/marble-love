/**
 * level-init-16f6c.ts — replica `FUN_00016F6C`.
 *
 * Initializes the level row decode path from the descriptor pointer stored at
 * `0x400474`. The body computes the same row pointers and destination ring
 * addresses as the 68k code, then dispatches `FUN_1A668` once per visible row.
 */

import type { RomImage } from "./bus.js";
import type { GameState } from "./state.js";
import { decodeBitstream1A668 } from "./decode-bitstream-1a668.js";
import { levelHelper2FFB8 } from "./level-helper-2ffb8.js";

const WORK_RAM_BASE = 0x00400000;
const WORK_RAM_END = 0x00402000;
const ROM_END = 0x00088000;

export const LEVEL_INIT_16F6C_ADDR = 0x00016f6c as const;

export interface LevelInit16F6CSubs {
  fun_2ffb8?: (argLong: number) => void;
  fun_2ff40?: (argLong: number) => void;
  fun_1a668?: (outAbs: number, ctrlAbs: number, extAbs: number) => void;
}

function readU8Abs(state: GameState, rom: RomImage, abs: number): number {
  const a = abs >>> 0;
  if (a >= WORK_RAM_BASE && a < WORK_RAM_END) return state.workRam[a - WORK_RAM_BASE] ?? 0;
  if (a < ROM_END) return rom.program[a] ?? 0;
  return 0;
}

function readU16Abs(state: GameState, rom: RomImage, abs: number): number {
  return ((readU8Abs(state, rom, abs) << 8) | readU8Abs(state, rom, abs + 1)) & 0xffff;
}

function readU32Abs(state: GameState, rom: RomImage, abs: number): number {
  return ((((readU8Abs(state, rom, abs) << 24) |
    (readU8Abs(state, rom, abs + 1) << 16) |
    (readU8Abs(state, rom, abs + 2) << 8) |
    readU8Abs(state, rom, abs + 3)) >>> 0));
}

function signExtendWord(value: number): number {
  const v = value & 0xffff;
  return (v & 0x8000) !== 0 ? v - 0x10000 : v;
}

function asrWord(value: number, bits: number): number {
  return (signExtendWord(value) >> bits) & 0xffff;
}

function resetIndirectTerrainTable(state: GameState): void {
  // FUN_16F6C/FUN_2FF40 refreshes the low indirect terrain entries before a
  // new level starts. These words are mutated by scroll patches during the
  // prior attract segment; carrying them into mode 0 raises the marble terrain
  // projection by 0x0d and stalls the long demo scroll.
  for (let i = 0; i < 9; i++) {
    const off = 0x076e + i * 2;
    state.workRam[off] = 0xf0;
    state.workRam[off + 1] = 0x40;
  }
}

export function levelInit16F6C(
  state: GameState,
  rom: RomImage,
  subs: LevelInit16F6CSubs = {},
): void {
  const fun2ffb8 = subs.fun_2ffb8 ?? ((argLong: number): void => { levelHelper2FFB8(rom, argLong); });
  const fun2ff40 = subs.fun_2ff40 ?? ((): void => undefined);
  const fun1a668 = subs.fun_1a668 ?? ((outAbs: number, ctrlAbs: number, extAbs: number): void => {
    decodeBitstream1A668(state, rom, outAbs, ctrlAbs, extAbs);
  });

  const arg664 = signExtendWord(readU16Abs(state, rom, 0x00400664));
  fun2ffb8(arg664);

  const arg662 = signExtendWord(readU16Abs(state, rom, 0x00400662));
  fun2ff40(arg662);
  resetIndirectTerrainTable(state);

  const statePtr = readU32Abs(state, rom, 0x00400474);
  let ctrlListAbs = readU32Abs(state, rom, statePtr + 0x04);
  let extListAbs = readU32Abs(state, rom, statePtr + 0x2a);
  let rowCount = 0x20;
  let outAbs = 0x00a00006;

  if (readU16Abs(state, rom, 0x00400394) === 4) {
    const d1 = signExtendWord(asrWord(readU16Abs(state, rom, statePtr + 0x12), 3)) - 1;
    ctrlListAbs = (ctrlListAbs + d1 * 2) >>> 0;
    extListAbs = (extListAbs + d1) >>> 0;
    rowCount = (rowCount + 1) & 0xff;
    outAbs = (outAbs - 0x80) >>> 0;
    if (outAbs < 0x00a00000) outAbs = (outAbs + 0x2000) >>> 0;
  }

  for (let row = 0; row !== rowCount; row = (row + 1) & 0xff) {
    const extByte = readU8Abs(state, rom, extListAbs);
    extListAbs = (extListAbs + 1) >>> 0;
    const extAbs = (0x0002be18 + extByte) >>> 0;
    const ctrlWord = signExtendWord(readU16Abs(state, rom, ctrlListAbs));
    ctrlListAbs = (ctrlListAbs + 2) >>> 0;
    const ctrlAbs = (0x000800e4 + ctrlWord) >>> 0;

    fun1a668(outAbs, ctrlAbs, extAbs);

    outAbs = (outAbs + 0x80) >>> 0;
    if (outAbs > 0x00a01fff) outAbs = (outAbs - 0x2000) >>> 0;
  }

  fun2ffb8(arg662);
}

export { levelInit16F6C as FUN_00016F6C };
