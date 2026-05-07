/**
 * level-dispatcher-16ec6.ts — observable replica of `FUN_00016EC6`.
 *
 * `FUN_16EC6` selects the current level descriptor, updates a handful of
 * workRam globals, then dispatches the row builder (`FUN_1A444`). Heavy helper
 * JSRs are injectable and default to no-op, matching parity tests where those
 * targets are patched to `rts`.
 */

import type { RomImage } from "./bus.js";
import { levelDispatcherHelper18FD0 } from "./level-dispatcher-helper-18fd0.js";
import { levelHelper2FFB8 } from "./level-helper-2ffb8.js";
import { buildTilemapRows1A444 } from "./tilemap-row-build-1a444.js";
import type { GameState } from "./state.js";

export const LEVEL_DISPATCHER_16EC6_ADDR = 0x00016ec6 as const;

const WORK_RAM_BASE = 0x00400000 as const;
const WORK_RAM_END = 0x00402000 as const;

const LEVEL_INDEX_OFF = 0x0394 as const;
const STATE_PTR_OFF = 0x0474 as const;
const BINSEARCH_BASE_PTR_OFF = 0x065a as const;
const TABLE_VALUE_0662_OFF = 0x0662 as const;
const TABLE_VALUE_0664_OFF = 0x0664 as const;
const LEVEL_TIMER_OFF = 0x097c as const;

const LEVEL_PTR_TABLE = 0x0002be00 as const;
const TABLE_239A0 = 0x000239a0 as const;
const TABLE_239AC = 0x000239ac as const;

export interface LevelDispatcher16EC6Subs {
  fun_2ffb8?: (argLong: number) => void;
  fun_2ff28?: (argLong: number) => void;
  fun_18fd0?: () => void;
  fun_1a444?: () => void;
}

function readU16(state: GameState, off: number): number {
  return (((state.workRam[off] ?? 0) << 8) | (state.workRam[off + 1] ?? 0)) & 0xffff;
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

function writeU16(state: GameState, off: number, value: number): void {
  const v = value & 0xffff;
  state.workRam[off] = (v >>> 8) & 0xff;
  state.workRam[off + 1] = v & 0xff;
}

function writeU32(state: GameState, off: number, value: number): void {
  const v = value >>> 0;
  state.workRam[off] = (v >>> 24) & 0xff;
  state.workRam[off + 1] = (v >>> 16) & 0xff;
  state.workRam[off + 2] = (v >>> 8) & 0xff;
  state.workRam[off + 3] = v & 0xff;
}

function signExtendWord(word: number): number {
  const w = word & 0xffff;
  return w & 0x8000 ? (w | 0xffff0000) >> 0 : w;
}

function readRomU16(rom: RomImage, addr: number): number {
  return (((rom.program[addr] ?? 0) << 8) | (rom.program[addr + 1] ?? 0)) & 0xffff;
}

function readRomU32(rom: RomImage, addr: number): number {
  return (
    (((rom.program[addr] ?? 0) << 24) |
      ((rom.program[addr + 1] ?? 0) << 16) |
      ((rom.program[addr + 2] ?? 0) << 8) |
      (rom.program[addr + 3] ?? 0)) >>>
    0
  );
}

function readAbsU16(state: GameState, rom: RomImage, addr: number): number {
  const a = addr >>> 0;
  if (a >= WORK_RAM_BASE && a < WORK_RAM_END) return readU16(state, a - WORK_RAM_BASE);
  return readRomU16(rom, a);
}

function readAbsU32(state: GameState, rom: RomImage, addr: number): number {
  const a = addr >>> 0;
  if (a >= WORK_RAM_BASE && a < WORK_RAM_END) return readU32(state, a - WORK_RAM_BASE);
  return readRomU32(rom, a);
}

/**
 * Replica `FUN_00016EC6`.
 *
 * Observable side effects:
 * - `workRam[0x0474..0x0477]` current level descriptor pointer.
 * - `workRam[0x0662..0x0665]` level table values.
 * - `workRam[0x065a..0x065d]` pointer from descriptor +0x26.
 * - `workRam[0x097c..0x097f]` sign-extended timer/bonus value.
 */
export function levelDispatcher16EC6(
  state: GameState,
  rom: RomImage,
  subs?: LevelDispatcher16EC6Subs,
): void {
  const fun2ffb8 = subs?.fun_2ffb8 ?? ((argLong: number): void => { levelHelper2FFB8(rom, argLong); });
  const fun18fd0 = subs?.fun_18fd0 ?? ((): void => { levelDispatcherHelper18FD0(state, rom); });
  const levelIndex = readU16(state, LEVEL_INDEX_OFF);
  const tableIndex = (levelIndex << 2) >>> 0;
  const statePtr = readRomU32(rom, LEVEL_PTR_TABLE + tableIndex);
  writeU32(state, STATE_PTR_OFF, statePtr);

  const tableValue662 = readRomU16(rom, TABLE_239A0 + levelIndex * 2);
  writeU16(state, TABLE_VALUE_0662_OFF, tableValue662);
  fun2ffb8(signExtendWord(tableValue662));

  const previous664 = readU16(state, TABLE_VALUE_0664_OFF);
  subs?.fun_2ff28?.(signExtendWord(previous664));

  const tableValue664 = readRomU16(rom, TABLE_239AC + levelIndex * 2);
  writeU16(state, TABLE_VALUE_0664_OFF, tableValue664);

  fun18fd0();

  const binsearchBase = readAbsU32(state, rom, statePtr + 0x26);
  writeU32(state, BINSEARCH_BASE_PTR_OFF, binsearchBase);

  if (subs?.fun_1a444) subs.fun_1a444();
  else buildTilemapRows1A444(state, rom);

  let timerValue = signExtendWord(readAbsU16(state, rom, statePtr + 0x10));
  if (levelIndex === 4) {
    timerValue = (timerValue + signExtendWord(readAbsU16(state, rom, statePtr + 0x12))) >> 0;
  }
  writeU32(state, LEVEL_TIMER_OFF, timerValue);
}
