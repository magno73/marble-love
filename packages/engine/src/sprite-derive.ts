/**
 * sprite-derive.ts - `FUN_0001BB50` (90 bytes): derive 5 fields from xy.
 *
 * Reads *0x400690 (x word) and *0x400692 (y word). Writes:
 *   - *0x40069E = x & 7
 *   - *0x4006A0 = y & 7
 *   - *0x400696 = (x asr 3) signed
 *   - *0x400698 = (y asr 3) signed
 *   - *0x4006A2 = 1 if (y&7) >= (x&7) signed, else 0
 */

import type { GameState } from "./state.js";

function readU16(s: GameState, off: number): number {
  return ((s.workRam[off] ?? 0) << 8) | (s.workRam[off + 1] ?? 0);
}
function writeU16(s: GameState, off: number, v: number): void {
  s.workRam[off] = (v >>> 8) & 0xff;
  s.workRam[off + 1] = v & 0xff;
}

/** Replica `FUN_0001BB08` - wrapper that sets xy globals from arg+0xC/+0x10 word and JSRs derive. */
export function deriveSpriteFromArg_v1(state: GameState, argAddr: number): void {
  const argOff = argAddr - 0x400000;
  writeU16(state, 0x690, readU16(state, argOff + 0xC));
  writeU16(state, 0x692, readU16(state, argOff + 0x10));
  deriveSpriteFields(state);
}

/** Replica `FUN_0001BB28` — wrapper: byte+4/+5 sext × 8 → globals + jsr derive. */
export function deriveSpriteFromArg_v2(state: GameState, argAddr: number): void {
  const argOff = argAddr - 0x400000;
  const b4 = state.workRam[argOff + 4] ?? 0;
  const b5 = state.workRam[argOff + 5] ?? 0;
  const b4S = b4 & 0x80 ? b4 - 0x100 : b4;
  const b5S = b5 & 0x80 ? b5 - 0x100 : b5;
  writeU16(state, 0x690, (b4S << 3) & 0xffff);
  writeU16(state, 0x692, (b5S << 3) & 0xffff);
  deriveSpriteFields(state);
}

export function deriveSpriteFields(state: GameState): void {
  const x = readU16(state, 0x690);
  const y = readU16(state, 0x692);
  // x & 7
  writeU16(state, 0x69e, x & 7);
  // y & 7
  writeU16(state, 0x6a0, y & 7);
  // x >> 3 (asr signed)
  const xS = x & 0x8000 ? x - 0x10000 : x;
  const yS = y & 0x8000 ? y - 0x10000 : y;
  writeU16(state, 0x696, (xS >> 3) & 0xffff);
  writeU16(state, 0x698, (yS >> 3) & 0xffff);
  // bit-7-or-not? actually: cmp.w *0x40069E, *0x4006A0; bge skip → branch if A0 >= 69E
  // initial *0x4006A2 = 1, then if NOT branch (A0 < 69E): *0x4006A2 = 0
  writeU16(state, 0x6a2, 1);
  const a0Val = y & 7;
  const a69eVal = x & 7;
  const a0Signed = a0Val & 0x8000 ? a0Val - 0x10000 : a0Val;
  const a69eSigned = a69eVal & 0x8000 ? a69eVal - 0x10000 : a69eVal;
  // bge skips clear (= leaves 1). Branch if A0 >= 69E.
  if (a0Signed < a69eSigned) {
    writeU16(state, 0x6a2, 0);
  }
}
