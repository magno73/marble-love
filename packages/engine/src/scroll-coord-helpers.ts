/**
 * scroll-coord-helpers.ts — replica `FUN_0001BB08` + `FUN_0001BB50`.
 *
 *
 * **`FUN_1BB50` updateScrollCoords1BB50** (19 instr, 5 callers):
 *   ricalcola cell-coords + dirty-flag basato su `*0x400690` (world X) e
 *   `*0x400692` (world Y).
 *
 *   Side effects:
 *     *0x40069E.w = *0x400690.w & 0x7   ; sub-cell X (3 bit low)
 *     *0x4006A0.w = *0x400692.w & 0x7   ; sub-cell Y
 *     *0x400696.w = *0x400690.w >> 3    ; cell X (signed shift)
 *     *0x400698.w = *0x400692.w >> 3    ; cell Y
 *     *0x4006A2.w = 1                    ; dirty flag default
 *     if (*0x4006A0 < *0x40069E) → *0x4006A2 = 0 (clear dirty)
 *
 * **`FUN_1BB08` setScrollCoordsFromEntity1BB08** (8 instr, 7 callers):
 *   trasferisce `entity[0xC..0xF]` (X word) e `entity[0x10..0x13]` (Y word)
 *   `updateScrollCoords1BB50`.
 *
 *   Side effects:
 *     *0x400690.w = entity+0xC.w
 *     *0x400692.w = entity+0x10.w
 */

import type { GameState } from "./state.js";

export const SET_SCROLL_COORDS_FROM_ENTITY_1BB08_ADDR = 0x0001bb08 as const;
export const UPDATE_SCROLL_COORDS_1BB50_ADDR = 0x0001bb50 as const;

const WORK_RAM_BASE = 0x00400000;
const WORK_RAM_END = 0x00402000;

function readU16Abs(state: GameState, addr: number): number {
  const a = (addr >>> 0) - WORK_RAM_BASE;
  if (a < 0 || a >= WORK_RAM_END - WORK_RAM_BASE) return 0;
  return ((state.workRam[a] ?? 0) << 8) | (state.workRam[a + 1] ?? 0);
}

function writeU16(state: GameState, off: number, value: number): void {
  state.workRam[off] = (value >>> 8) & 0xff;
  state.workRam[off + 1] = value & 0xff;
}

function readU16(state: GameState, off: number): number {
  return ((state.workRam[off] ?? 0) << 8) | (state.workRam[off + 1] ?? 0);
}

/** Sign-extend word (16-bit) → signed JS number. */
function s16(value: number): number {
  return value & 0x8000 ? value - 0x10000 : value;
}

/**
 * Replica `FUN_0001BB50` — ricalcola sub-cell + cell coords + dirty flag.
 */
export function updateScrollCoords1BB50(state: GameState): void {
  const worldX = readU16(state, 0x690);
  const worldY = readU16(state, 0x692);

  // Sub-cell: low 3 bit
  writeU16(state, 0x69e, worldX & 0x7);
  writeU16(state, 0x6a0, worldY & 0x7);

  // Cell: signed shift right 3
  const cellX = (s16(worldX) >> 3) & 0xffff;
  const cellY = (s16(worldY) >> 3) & 0xffff;
  writeU16(state, 0x696, cellX);
  writeU16(state, 0x698, cellY);

  // Dirty flag: default = 1
  writeU16(state, 0x6a2, 1);

  // Reset dirty if sub-cell Y < sub-cell X (signed compare).
  const subX = readU16(state, 0x69e);
  const subY = readU16(state, 0x6a0);
  if (s16(subY) < s16(subX)) {
    writeU16(state, 0x6a2, 0);
  }
}

/**
 * `updateScrollCoords1BB50`.
 *
 * @param entityPtr  Pointer assoluto M68k all'entity struct (workRam).
 *                   Deve avere word X @ +0xC e word Y @ +0x10.
 */
export function setScrollCoordsFromEntity1BB08(
  state: GameState,
  entityPtr: number,
): void {
  const entityX = readU16Abs(state, entityPtr + 0xc);
  const entityY = readU16Abs(state, entityPtr + 0x10);
  writeU16(state, 0x690, entityX);
  writeU16(state, 0x692, entityY);
  updateScrollCoords1BB50(state);
}
