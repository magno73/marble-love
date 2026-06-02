/**
 * strcpy-1d74.ts — replica `FUN_00001D74` (6 instr leaf, 3 callers).
 *
 * Classic C-style `strcpy` on M68k:
 *
 *   movea.l (0x4,SP),A1   ; A1 = dst
 *   movea.l (0x8,SP),A0   ; A0 = src
 *   loop: move.b (A0)+,(A1)+   ; copy byte, set Z if zero
 *   rts
 *
 * adds a safety cap to avoid infinite loops on corrupted input.
 *
 * in workRam (PLAYER 1/2 START, TRAKBALL).
 */

import type { GameState } from "./state.js";
import type { RomImage } from "./bus.js";

export const STRCPY_1D74_ADDR = 0x00001d74 as const;

const WORK_RAM_BASE = 0x00400000;
const WORK_RAM_END = 0x00402000;
const MAX_LEN = 256;

/**
 * Replica `FUN_00001D74` — strcpy null-terminated.
 *
 * null terminator in writes.
 *
 * @param state    GameState (mutates `workRam` at `dstAbs`).
 * @param dstAbs   Absolute destination pointer (must be workRam).
 * @param srcAbs   Absolute source pointer (workRam or ROM).
 *                 `MAX_LEN` if the safety bound is reached.
 */
export function strcpy1D74(
  state: GameState,
  rom: RomImage,
  dstAbs: number,
  srcAbs: number,
): number {
  const dstOff = (dstAbs >>> 0) - WORK_RAM_BASE;
  if (dstOff < 0 || dstOff >= WORK_RAM_END - WORK_RAM_BASE) return 0;

  let s = srcAbs >>> 0;
  let d = dstOff;
  for (let i = 0; i < MAX_LEN; i++) {
    let b: number;
    if (s >= WORK_RAM_BASE && s < WORK_RAM_END) {
      b = state.workRam[s - WORK_RAM_BASE] ?? 0;
    } else {
      b = rom.program[s] ?? 0;
    }
    if (d >= WORK_RAM_END - WORK_RAM_BASE) break;
    state.workRam[d] = b;
    s = (s + 1) >>> 0;
    d += 1;
    if (b === 0) return i + 1;
  }
  return MAX_LEN;
}
