/**
 * sprite-coords.ts — `FUN_00018A1E` (106 byte) e `FUN_000199D6` (106 byte).
 *
 * Calcola coordinate sprite (xy packed in long) per HUD/MO. Le 2 funzioni
 * differiscono solo nel layout dell'arg struct.
 *
 * - **FUN_18A1E — `computeSpriteCoords_v1(arg)`**: arg+0,+2,+4. Skip se +0xA == -1.
 * - **FUN_199D6 — `computeSpriteCoords_v2(arg)`**: arg+0xC,+0x10,+0x14.
 */

import type { GameState } from "./state.js";

function readU16(state: GameState, off: number): number {
  return ((state.workRam[off] ?? 0) << 8) | (state.workRam[off + 1] ?? 0);
}
function writeU16(state: GameState, off: number, v: number): void {
  state.workRam[off] = (v >>> 8) & 0xff;
  state.workRam[off + 1] = v & 0xff;
}

const POS_X_OFF = 0x690; // 0x400690
const POS_Y_OFF = 0x692;
const HUD_OFFSET_OFF = 0x97e;

function compute(state: GameState, w0: number, w2: number, w4: number, dstOff: number): void {
  // *0x400690 = w0 (= word at arg+aOffX or 0xC)
  writeU16(state, POS_X_OFF, w0 & 0xffff);
  // *0x400692 = w2
  writeU16(state, POS_Y_OFF, w2 & 0xffff);
  // D3.w = *0x400692 - *0x400690 + 0x88 (word arithmetic)
  const yMinusX = (((w2 - w0) | 0) + 0x88) & 0xffff;
  // D0w = w4. D2.w = *0x40097E + w4 + 0x54
  const hudOff = readU16(state, HUD_OFFSET_OFF);
  let d2 = ((hudOff + (w4 & 0xffff)) | 0) + 0x54;
  d2 = d2 & 0xffff;
  // D0 = sext_l(*0x400692.w); D1 = sext_l(*0x400690.w); D0 = (D0+D1) asr.l 1
  const yS = w2 & 0x8000 ? w2 - 0x10000 : w2;
  const xS = w0 & 0x8000 ? w0 - 0x10000 : w0;
  const avg = (yS + xS) >> 1;
  // D2.w -= avg (word sub)
  d2 = (d2 - avg) & 0xffff;
  // D2 = sext_l(D2.w) & 0xFFFF (effectively zero high word)
  const d2w = d2 & 0xffff;
  // D1 = sext_l(D3.w) << 16
  const d3w = yMinusX & 0xffff;
  const d3Signed = d3w & 0x8000 ? d3w - 0x10000 : d3w;
  const d1Long = ((d3Signed << 16) | 0) >>> 0;
  // D2 += D1 (long add)
  const result = ((d1Long + d2w) >>> 0);
  // Write *(arg+dstOff) = result (long)
  state.workRam[dstOff] = (result >>> 24) & 0xff;
  state.workRam[dstOff + 1] = (result >>> 16) & 0xff;
  state.workRam[dstOff + 2] = (result >>> 8) & 0xff;
  state.workRam[dstOff + 3] = result & 0xff;
}

export function computeSpriteCoords_v1(state: GameState, argAddr: number): void {
  const argOff = argAddr - 0x400000;
  if ((state.workRam[argOff + 0xA] ?? 0) === 0xFF) return;
  const w0 = readU16(state, argOff + 0);
  const w2 = readU16(state, argOff + 2);
  const w4 = readU16(state, argOff + 4);
  compute(state, w0, w2, w4, argOff + 6);
}

export function computeSpriteCoords_v2(state: GameState, argAddr: number): void {
  const argOff = argAddr - 0x400000;
  // No skip check in v2; reads from +0xC, +0x10, +0x14, writes to +0x20
  const w0 = readU16(state, argOff + 0xC);
  const w2 = readU16(state, argOff + 0x10);
  const w4 = readU16(state, argOff + 0x14);
  compute(state, w0, w2, w4, argOff + 0x20);
}

/** Replica `FUN_0001778E` — variante che scrive a +0x28 invece di +0x20. */
export function computeSpriteCoords_v3(state: GameState, argAddr: number): void {
  const argOff = argAddr - 0x400000;
  const w0 = readU16(state, argOff + 0xC);
  const w2 = readU16(state, argOff + 0x10);
  const w4 = readU16(state, argOff + 0x14);
  compute(state, w0, w2, w4, argOff + 0x28);
}
