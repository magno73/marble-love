/**
 * animation-step.ts — `FUN_000132E0` (84 byte): animation pointer step.
 *
 * Avanza il pointer animazione in obj struct, gestisce terminator (-1) +
 * loop count. Returns 1 se l'animazione è davvero "finita" (loop count
 * exhausted), altrimenti 0.
 */

import type { GameState } from "./state.js";

function readU32(state: GameState, off: number): number {
  return (
    (((state.workRam[off] ?? 0) << 24) |
      ((state.workRam[off + 1] ?? 0) << 16) |
      ((state.workRam[off + 2] ?? 0) << 8) |
      (state.workRam[off + 3] ?? 0)) >>> 0
  );
}
function writeU32(state: GameState, off: number, v: number): void {
  const x = v >>> 0;
  state.workRam[off] = (x >>> 24) & 0xff;
  state.workRam[off + 1] = (x >>> 16) & 0xff;
  state.workRam[off + 2] = (x >>> 8) & 0xff;
  state.workRam[off + 3] = x & 0xff;
}

export function animationStep(state: GameState, objAddr: number): number {
  const objOff = objAddr - 0x400000;
  const r = state.workRam;

  // *(A0+0x3E) += 4
  let ptr = (readU32(state, objOff + 0x3E) + 4) >>> 0;
  // if *(A0+0x1E).b != 0: += 4 again
  if ((r[objOff + 0x1E] ?? 0) !== 0) {
    ptr = (ptr + 4) >>> 0;
  }
  writeU32(state, objOff + 0x3E, ptr);

  // Read *A1 = *(*(A0+0x3E)) long, check == -1
  const ptrOff = (ptr - 0x400000) >>> 0;
  const valAtA1 = readU32(state, ptrOff);
  let d1 = 0;
  if (valAtA1 === 0xFFFFFFFF) {
    d1 = 1;
    // Branch on type
    if ((r[objOff + 0x1A] ?? 0) === 2) {
      writeU32(state, objOff + 0x3E, readU32(state, objOff + 0x46));
    } else {
      writeU32(state, objOff + 0x3E, readU32(state, objOff + 0x4A));
    }
    // Loop count word at +0x1C
    const cnt = ((r[objOff + 0x1C] ?? 0) << 8) | (r[objOff + 0x1D] ?? 0);
    if (cnt !== 0) {
      const newCnt = (cnt - 1) & 0xffff;
      r[objOff + 0x1C] = (newCnt >>> 8) & 0xff;
      r[objOff + 0x1D] = newCnt & 0xff;
      if (newCnt !== 0) d1 = 0;
    }
  }
  // Return D1.b sext_l (= 0 or 1)
  return d1;
}
