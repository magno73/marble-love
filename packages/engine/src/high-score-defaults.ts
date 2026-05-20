/**
 * high-score-defaults.ts - cold-boot default high-score table setup.
 */

import type { GameState } from "./state.js";
import type { RomImage } from "./bus.js";

const WRAM = 0x00400000;
const PTR_FFC_ADDR = 0x00401ffc;
const DEFAULT_STRUCT_ADDR = 0x00401e74;
const STATUS_OFF = 0x0a;
const STATUS_COMPLEMENT_OFF = 0x0b;
const HIGH_SCORE_TABLE_OFF = 0x1e;
const HIGH_SCORE_ROWS = 10;
const HIGH_SCORE_RECORD_SIZE = 5;
const ROM_DEFAULT_TABLE = 0x0001eea0;
const ROM_DEFAULT_RECORD_SIZE = 8;

function off(addr: number): number {
  return addr - WRAM;
}

function wb(state: GameState, addr: number, value: number): void {
  state.workRam[off(addr)] = value & 0xff;
}

function wl(state: GameState, addr: number, value: number): void {
  const v = value >>> 0;
  state.workRam[off(addr)] = (v >>> 24) & 0xff;
  state.workRam[off(addr) + 1] = (v >>> 16) & 0xff;
  state.workRam[off(addr) + 2] = (v >>> 8) & 0xff;
  state.workRam[off(addr) + 3] = v & 0xff;
}

function readRomLong(rom: RomImage, addr: number): number {
  return ((((rom.program[addr] ?? 0) << 24) |
    ((rom.program[addr + 1] ?? 0) << 16) |
    ((rom.program[addr + 2] ?? 0) << 8) |
    (rom.program[addr + 3] ?? 0)) >>> 0);
}

function readRomByte(rom: RomImage, addr: number): number {
  return (rom.program[addr] ?? 0) & 0xff;
}

function asciiToRadix40(value: number): number {
  if (value === 0 || value === 0x20) return 0;
  if (value >= 0x41 && value <= 0x5a) return value - 0x40;
  if (value >= 0x30 && value <= 0x39) return value - 0x15;
  if (value >= 0x3a && value <= 0x3c) return value - 0x15;
  return 0;
}

function packInitials(rom: RomImage, entryAddr: number): number {
  const c0 = asciiToRadix40(readRomByte(rom, entryAddr + 4));
  const c1 = asciiToRadix40(readRomByte(rom, entryAddr + 5));
  const c2 = asciiToRadix40(readRomByte(rom, entryAddr + 6));
  return (c0 * 1600 + c1 * 40 + c2) & 0xffff;
}

/**
 * Seeds captured from MAME use `0x401E74` as the EEPROM/player settings
 * struct. The high-score routines rank against `ptr + 0x1E`; without this
 * cold-boot default every non-zero score qualifies against an all-zero table.
 */
export function initDefaultHighScoreTable(state: GameState, rom: RomImage): void {
  wl(state, PTR_FFC_ADDR, DEFAULT_STRUCT_ADDR);
  wb(state, DEFAULT_STRUCT_ADDR + STATUS_OFF, 0x00);
  wb(state, DEFAULT_STRUCT_ADDR + STATUS_COMPLEMENT_OFF, 0xff);

  const tableAddr = DEFAULT_STRUCT_ADDR + HIGH_SCORE_TABLE_OFF;
  for (let row = 0; row < HIGH_SCORE_ROWS; row++) {
    const romEntry = ROM_DEFAULT_TABLE + row * ROM_DEFAULT_RECORD_SIZE;
    const dst = tableAddr + row * HIGH_SCORE_RECORD_SIZE;
    const score = readRomLong(rom, romEntry) & 0x00ffffff;
    const initials = packInitials(rom, romEntry);

    wb(state, dst, score >>> 16);
    wb(state, dst + 1, score >>> 8);
    wb(state, dst + 2, score);
    wb(state, dst + 3, initials >>> 8);
    wb(state, dst + 4, initials);
  }
}

export const DEFAULT_HIGH_SCORE_STRUCT_ADDR = DEFAULT_STRUCT_ADDR;
export const DEFAULT_HIGH_SCORE_TABLE_ADDR = DEFAULT_STRUCT_ADDR + HIGH_SCORE_TABLE_OFF;
