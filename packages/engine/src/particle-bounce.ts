/**
 * particle-bounce.ts — `FUN_00018DCA` (162 byte): particle bounce on screen edges.
 *
 * Loop su array @ 0x400A9C, stride 0xA, count = byte @ 0x4003E2. For each entry:
 *   - newX = xpos + xvel; newY = ypos + yvel (both words)
 *   - D3 = newX >> 4 (signed); D2 = newY >> 4
 *   - X bounce: if (D3 < 8 AND xvel < 0) OR (D3 > 0x148 AND xvel > 0): xvel = -xvel
 *   - Y bounce: if (D2 < 0 AND yvel < 0) OR (D2 > 0xE0 AND yvel > 0): yvel = -yvel
 *   - if 8 ≤ D3 ≤ 0x148 AND 0 ≤ D2 ≤ 0xE0: commit pos (xpos = newX, ypos = newY)
 */

import type { GameState } from "./state.js";

function readW(s: GameState, off: number): number {
  return ((s.workRam[off] ?? 0) << 8) | (s.workRam[off + 1] ?? 0);
}
function readWS(s: GameState, off: number): number {
  const w = readW(s, off);
  return w & 0x8000 ? w - 0x10000 : w;
}
function writeW(s: GameState, off: number, v: number): void {
  s.workRam[off] = (v >>> 8) & 0xff;
  s.workRam[off + 1] = v & 0xff;
}

const BASE_OFF = 0xa9c; // 0x400A9C
const STRIDE = 0xa;
const COUNT_OFF = 0x3e2;

export function particleBounce(state: GameState): void {
  const count = state.workRam[COUNT_OFF] ?? 0;
  for (let i = 0; i < count; i++) {
    const eOff = BASE_OFF + i * STRIDE;
    const xpos = readWS(state, eOff + 0);
    const xvel = readWS(state, eOff + 4);
    const ypos = readWS(state, eOff + 2);
    const yvel = readWS(state, eOff + 6);
    const newX = (xpos + xvel) & 0xffff;
    const newY = (ypos + yvel) & 0xffff;
    const newXSigned = newX & 0x8000 ? newX - 0x10000 : newX;
    const newYSigned = newY & 0x8000 ? newY - 0x10000 : newY;
    const d3 = newXSigned >> 4;
    const d2 = newYSigned >> 4;

    // X bounce
    let xvelOut = xvel;
    if ((d3 < 8 && xvel < 0) || (d3 > 0x148 && xvel > 0)) {
      const negXvel = xvel === -0x8000 ? 0x8000 : ((-xvel) & 0xffff);
      xvelOut = negXvel & 0x8000 ? negXvel - 0x10000 : negXvel;
      writeW(state, eOff + 4, negXvel);
    }
    // Y bounce
    let yvelOut = yvel;
    if ((d2 < 0 && yvel < 0) || (d2 > 0xE0 && yvel > 0)) {
      const negYvel = yvel === -0x8000 ? 0x8000 : ((-yvel) & 0xffff);
      yvelOut = negYvel & 0x8000 ? negYvel - 0x10000 : negYvel;
      writeW(state, eOff + 6, negYvel);
    }
    // Commit pos if in bounds
    if (d3 >= 8 && d3 <= 0x148 && d2 >= 0 && d2 <= 0xE0) {
      writeW(state, eOff + 0, newX);
      writeW(state, eOff + 2, newY);
    }
    void xvelOut; void yvelOut;
  }
}
