/**
 * terrain-wave-update-1d06a.ts — replica `FUN_0001D06A`.
 *
 * Called by `FUN_13334` for script slots with kind `0x06`. Despite older
 * notes calling this palette-only, the original routine writes the runtime
 * indirect terrain table at `0x40076E`. L3 green waves rely on this table so
 * `FUN_1CABA`/`FUN_25DF6` can produce the original conveyor-like push without
 * inventing direct `tag=0x06` collision behavior.
 */

import type { GameState } from "./state.js";
import type { RomImage } from "./bus.js";

export const TERRAIN_WAVE_UPDATE_1D06A_ADDR = 0x0001d06a as const;

const WORK_RAM_BASE = 0x00400000 as const;
const ALT_TERRAIN_BASE = 0x0040076e as const;

const ARG_REMAP_TABLE = 0x00024e1a as const;
const CONTROL_TABLE = 0x00024c7a as const;
const SOURCE_TABLE = 0x00024c98 as const;

const TABLE_A = 0x00024d10 as const;
const TABLE_B = 0x00024cc4 as const;
const TABLE_C0 = 0x00024d5c as const;
const TABLE_C1 = 0x00024da8 as const;
const TABLE_C2 = 0x00024dce as const;
const TABLE_C3 = 0x00024df4 as const;
const TABLE_D0 = 0x00024d36 as const;
const TABLE_D1 = 0x00024cea as const;
const TABLE_D2 = 0x00024d82 as const;

function romB(rom: RomImage, addr: number): number {
  return (rom.program[addr >>> 0] ?? 0) & 0xff;
}

function romW(rom: RomImage, addr: number): number {
  const a = addr >>> 0;
  return (((rom.program[a] ?? 0) << 8) | (rom.program[a + 1] ?? 0)) & 0xffff;
}

function sext8(v: number): number {
  const b = v & 0xff;
  return b & 0x80 ? b - 0x100 : b;
}

function sext16(v: number): number {
  const w = v & 0xffff;
  return w & 0x8000 ? w - 0x10000 : w;
}

function writeWorkWord(state: GameState, abs: number, value: number): void {
  const off = (abs - WORK_RAM_BASE) >>> 0;
  if (off + 1 >= state.workRam.length) return;
  const v = value & 0xffff;
  state.workRam[off] = (v >>> 8) & 0xff;
  state.workRam[off + 1] = v & 0xff;
}

function tableForControl(control: number): readonly [number, number, number] {
  if (control === 0) return [TABLE_A, TABLE_B, TABLE_C0];
  if (control === 1) return [TABLE_A, TABLE_B, TABLE_C1];
  if (control === 2) return [TABLE_A, TABLE_B, TABLE_C2];
  if (control === 3) return [TABLE_A, TABLE_B, TABLE_C3];
  return [TABLE_D0, TABLE_D1, TABLE_D2];
}

/**
 * Replica `FUN_0001D06A(arg)`.
 *
 * @param state GameState whose `workRam[0x76e..]` is patched.
 * @param rom Program ROM containing the terrain tables.
 * @param argLong Long argument pushed by `FUN_13334`; only the low word is
 *                observed by the original routine.
 */
export function terrainWaveUpdate1D06A(
  state: GameState,
  rom: RomImage,
  argLong: number,
): void {
  let d1 = sext16(argLong);

  if (d1 <= 0x0c) {
    d1 = sext8(romB(rom, ARG_REMAP_TABLE + d1));
  } else {
    d1 = sext16(d1 - 6);
  }

  const sourcePhase = (((sext16(d1 - 7) & 0x0003) + 7) << 2) & 0xffff;
  let sourcePtr = (SOURCE_TABLE + sourcePhase) >>> 0;

  const group = sext16(d1) >> 2;
  let controlPtr = (CONTROL_TABLE + group) >>> 0;
  let destAbs = (ALT_TERRAIN_BASE + group * 6) >>> 0;

  for (let i = 0; i < 4; i++) {
    const control = sext8(romB(rom, controlPtr));
    if (control < 0) break;

    const sourceIndex = sext8(romB(rom, sourcePtr)) * 2;
    const tables = tableForControl(control);
    writeWorkWord(state, destAbs, romW(rom, tables[0] + sourceIndex));
    writeWorkWord(state, destAbs + 2, romW(rom, tables[1] + sourceIndex));
    writeWorkWord(state, destAbs + 4, romW(rom, tables[2] + sourceIndex));

    sourcePtr = (sourcePtr + 1) >>> 0;
    controlPtr = (controlPtr + 1) >>> 0;
    destAbs = (destAbs + 6) >>> 0;
  }
}

export { terrainWaveUpdate1D06A as FUN_0001D06A };
