/**
 * lerp.ts - `FUN_0001C61E` (74 bytes): linear interpolation through ROM table.
 *
 *   D2.w = (arg >> 10).w - 0xC (= table index)
 *   D3.w = arg & 0x3FF (= lerp fraction 0..0x3FF)
 *   v0 = ROM[0x1EE6E + D2*2].w (signed)
 *   v1 = ROM[0x1EE6E + (D2+1)*2].w (signed)
 *   delta = v1 - v0 (word)
 *   result.w = v0 + ((D3 * delta) >> 10) signed
 *   return sext_l(result.w)
 */

import type { RomImage } from "./bus.js";

const ROM_LERP_BASE = 0x1ee6e;

export function lerpFromRom(rom: RomImage, argWord: number): number {
  const arg = argWord & 0xffff;
  // D2.w = (arg >> 10).w (lsr.w)
  let d2 = (arg >>> 10) & 0xffff;
  // D2 -= 0xC (word sub)
  d2 = (d2 - 0xc) & 0xffff;
  // D3 = arg & 0x3FF
  const d3 = arg & 0x3ff;

  // ROM[base + (D2+1)*2] (sext word)
  const d2Signed = d2 & 0x8000 ? d2 - 0x10000 : d2;
  const idx1 = (ROM_LERP_BASE + (d2Signed + 1) * 2) >>> 0;
  const v1Raw = ((rom.program[idx1] ?? 0) << 8) | (rom.program[idx1 + 1] ?? 0);
  // ROM[base + D2*2] (sext word)
  const idx0 = (ROM_LERP_BASE + d2Signed * 2) >>> 0;
  const v0Raw = ((rom.program[idx0] ?? 0) << 8) | (rom.program[idx0 + 1] ?? 0);

  // delta = v1 - v0 (word sub)
  const delta = (v1Raw - v0Raw) & 0xffff;
  const deltaSigned = delta & 0x8000 ? delta - 0x10000 : delta;

  // D0 = D3 * delta (muls.w → long)
  const d0Long = (d3 * deltaSigned) | 0;
  // D0 = asr.l #10
  const d0Shifted = d0Long >> 10;

  // D0.w += v0 (word add)
  const result = (d0Shifted + v0Raw) & 0xffff;
  // return sext_l(result.w)
  return result & 0x8000 ? (result - 0x10000) >>> 0 : result;
}
