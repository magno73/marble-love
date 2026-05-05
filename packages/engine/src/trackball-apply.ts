/**
 * trackball-apply.ts — `FUN_00025DF6` (134 byte): apply trackball delta to position.
 *
 * Reads delta @ 0x4006A4 (D1 word) and 0x4006A6 (D2 word). If |delta| > 0xC,
 * scale delta *= 4. Then sub or add (delta << 11) to arg+0 and arg+4 longs:
 *   - if *0x400394 == 4: ADD (compensate)
 *   - else: SUBTRACT (apply movement)
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
function readU32(s: GameState, off: number): number {
  return (
    (((s.workRam[off] ?? 0) << 24) |
      ((s.workRam[off + 1] ?? 0) << 16) |
      ((s.workRam[off + 2] ?? 0) << 8) |
      (s.workRam[off + 3] ?? 0)) >>> 0
  );
}
function writeU32(s: GameState, off: number, v: number): void {
  const x = v >>> 0;
  s.workRam[off] = (x >>> 24) & 0xff;
  s.workRam[off + 1] = (x >>> 16) & 0xff;
  s.workRam[off + 2] = (x >>> 8) & 0xff;
  s.workRam[off + 3] = x & 0xff;
}

export function trackballApplyDelta(state: GameState, posAddr: number): void {
  // Boost x-delta if |x| > 0xC unsigned
  const xDelta = readWS(state, 0x6a4);
  const xAbs = xDelta < 0 ? -xDelta : xDelta;
  // bhi if 0xC > |X| (skip boost). Boost when |X| >= 0xC.
  if (xAbs >= 0xC) {
    writeW(state, 0x6a4, ((xDelta << 2) & 0xffff));
  }
  const yDelta = readWS(state, 0x6a6);
  const yAbs = yDelta < 0 ? -yDelta : yDelta;
  if (yAbs >= 0xC) {
    writeW(state, 0x6a6, ((yDelta << 2) & 0xffff));
  }

  // Re-read after potential boost
  const xFinal = readWS(state, 0x6a4);
  const yFinal = readWS(state, 0x6a6);
  const xLong = (xFinal << 11) | 0;
  const yLong = (yFinal << 11) | 0;

  const posOff = posAddr - 0x400000;
  const gameState = readW(state, 0x394);
  if (gameState === 4) {
    // Add path
    writeU32(state, posOff, ((readU32(state, posOff) + xLong) >>> 0));
    writeU32(state, posOff + 4, ((readU32(state, posOff + 4) + yLong) >>> 0));
  } else {
    // Sub path (default)
    writeU32(state, posOff, ((readU32(state, posOff) - xLong) >>> 0));
    writeU32(state, posOff + 4, ((readU32(state, posOff + 4) - yLong) >>> 0));
  }
}
