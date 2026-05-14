/**
 * object-target-init-262b2.ts — focused runtime wiring for `FUN_000262B2`.
 *
 * `FUN_262B2` is the first callee inside `FUN_2591A` (`objectInit2591A`).
 * Its observable contract for the respawn/death path is to prepare the
 * target globals consumed immediately afterwards by `FUN_2591A`:
 *
 *   - `*0x400462.l` target pixel X
 *   - `*0x400466.l` target pixel Y
 *   - `*0x400472.b` target/filter byte
 *
 * The nested scanner `FUN_2637A` is already replicated and parity-tested.
 * This module wires the real table dispatch and the sentinel setup that the
 * caller performs before that scanner.
 */

import type { RomImage } from "./bus.js";
import type { GameState } from "./state.js";
import { findNearestTarget2637A } from "./find-nearest-target-2637a.js";
import { stringHelper17CB8 } from "./string-helper-17cb8.js";

const GLOBAL_LEVEL_MODE = 0x394;
const GLOBAL_TARGET_X = 0x462;
const GLOBAL_TARGET_Y = 0x466;
const GLOBAL_TARGET_FILTER = 0x472;
const TARGET_TABLE_DISPATCH = 0x1ef1a;
const WORK_RAM_BASE = 0x400000;

function readW(state: GameState, off: number): number {
  return (((state.workRam[off] ?? 0) << 8) | (state.workRam[off + 1] ?? 0)) & 0xffff;
}

function readBAbs(state: GameState, addr: number): number {
  const off = (addr >>> 0) - WORK_RAM_BASE;
  if (off < 0 || off >= state.workRam.length) return 0;
  return state.workRam[off] ?? 0;
}

function writeL(state: GameState, off: number, value: number): void {
  const v = value >>> 0;
  state.workRam[off] = (v >>> 24) & 0xff;
  state.workRam[off + 1] = (v >>> 16) & 0xff;
  state.workRam[off + 2] = (v >>> 8) & 0xff;
  state.workRam[off + 3] = v & 0xff;
}

function writeB(state: GameState, off: number, value: number): void {
  state.workRam[off] = value & 0xff;
}

function signExt8(value: number): number {
  const v = value & 0xff;
  return v >= 0x80 ? v - 0x100 : v;
}

function readRomLong(rom: RomImage, addr: number): number {
  const a = addr >>> 0;
  return (
    (((rom.program[a] ?? 0) << 24) |
      ((rom.program[a + 1] ?? 0) << 16) |
      ((rom.program[a + 2] ?? 0) << 8) |
      (rom.program[a + 3] ?? 0)) >>>
    0
  );
}

function romByte(rom: RomImage, addr: number): number {
  return rom.program[addr >>> 0] ?? 0;
}

function writeTargetGlobals(state: GameState, pixelX: number, pixelY: number, filter: number): void {
  writeL(state, GLOBAL_TARGET_X, pixelX & 0xffff);
  writeL(state, GLOBAL_TARGET_Y, pixelY & 0xffff);
  writeB(state, GLOBAL_TARGET_FILTER, filter);
}

function fallbackScan262B2(
  state: GameState,
  rom: RomImage,
  objPtr: number,
  tableAddr: number,
): void {
  let recAddr = tableAddr >>> 0;
  const beforeStart = (recAddr - 4) >>> 0;
  const maxRecords = 256;

  let guard = 0;
  while ((romByte(rom, recAddr) & 0xff) !== 0xff && guard < maxRecords) {
    recAddr = (recAddr + 4) >>> 0;
    guard++;
  }

  let fallbackFilter = signExt8(readBAbs(state, (objPtr + 0x1d) >>> 0));
  if (fallbackFilter !== 0) fallbackFilter = (fallbackFilter - 1) & 0xffff;
  else fallbackFilter = 0;

  guard = 0;
  while (recAddr !== beforeStart && guard < maxRecords) {
    const x = romByte(rom, recAddr) & 0xff;
    const y = romByte(rom, recAddr + 1) & 0xff;
    const filter = romByte(rom, recAddr + 2) & 0xff;
    const pixelX = ((x << 3) + 4) & 0xffff;
    const pixelY = ((y << 3) + 4) & 0xffff;

    const blocked =
      stringHelper17CB8(state, objPtr >>> 0, pixelX, pixelY, 0x180) | 0;
    if (blocked === 0 && filter === (fallbackFilter & 0xffff)) {
      writeTargetGlobals(state, pixelX, pixelY, filter);
      return;
    }

    recAddr = (recAddr - 4) >>> 0;
    guard++;
  }
}

/**
 * Runtime model of `FUN_262B2` needed by `FUN_2591A`.
 *
 * The scanner leaves the target globals untouched when no candidate matches;
 * the real caller initializes them to a sentinel first.  Keeping that behavior
 * matters because `FUN_2591A` reads the globals immediately after this call.
 * If the nearest-target pass does not find a record, the binary performs a
 * second backwards scan through the same target table and accepts the first
 * reachable entry with the decremented object filter.
 */
export function objectTargetInit262B2(
  state: GameState,
  rom: RomImage,
  objPtr: number,
): void {
  writeL(state, GLOBAL_TARGET_X, 0);
  writeL(state, GLOBAL_TARGET_Y, 0);
  writeB(state, GLOBAL_TARGET_FILTER, 0xff);

  const mode = readW(state, GLOBAL_LEVEL_MODE);
  const tableAddr = readRomLong(rom, TARGET_TABLE_DISPATCH + ((mode & 0xffff) << 2));
  if (tableAddr === 0 || tableAddr >= rom.program.length) return;

  findNearestTarget2637A(
    state,
    objPtr,
    tableAddr,
    (addr) => romByte(rom, addr),
  );

  if ((state.workRam[GLOBAL_TARGET_FILTER] ?? 0) === 0xff) {
    fallbackScan262B2(state, rom, objPtr, tableAddr);
  }
}
