/**
 * grid-bitmap-test.ts — `FUN_00019460` (90 byte): test bit in ROM grid bitmap.
 *
 * Returns 1 se (arg1>>3 - 0x59) o (arg2>>3 - 0x5A) sono fuori range [0, 0xF],
 * oppure se bit (arg1>>3 - 0x59) di ROM[0x24496 + (arg2>>3 - 0x5A)*2] è set.
 * Returns 0 altrimenti.
 *
 * Use case probabile: collision check con grid bitmap.
 */

import type { RomImage } from "./bus.js";

const ROM_GRID_BASE = 0x24496;

export function testGridBitmap(rom: RomImage, arg1Word: number, arg2Word: number): number {
  // D0w = arg1; D0w >>= 3 signed; D2.b = D0.b - 0x59
  const arg1Signed = (arg1Word & 0xffff) & 0x8000 ? (arg1Word & 0xffff) - 0x10000 : (arg1Word & 0xffff);
  const arg2Signed = (arg2Word & 0xffff) & 0x8000 ? (arg2Word & 0xffff) - 0x10000 : (arg2Word & 0xffff);
  const x = (arg1Signed >> 3) & 0xff;
  const y = (arg2Signed >> 3) & 0xff;
  const xByte = (x - 0x59) & 0xff;
  const yByte = (y - 0x5a) & 0xff;
  const xByteSigned = xByte & 0x80 ? xByte - 0x100 : xByte;
  const yByteSigned = yByte & 0x80 ? yByte - 0x100 : yByte;

  // Range checks: blt or bgt → invalid → return 1
  if (xByteSigned < 0 || xByteSigned > 0xf) return 1;
  if (yByteSigned < 0 || yByteSigned > 0xf) return 1;

  // Compute D0w = sext_w(yByteSigned) * 2, then ROM lookup
  // ext.w D0w (sext byte to word, but D0.b was already y, so D0.w = sext_w(y) — but only after the move.b D2b,D0b was for D2... let me re-check
  //
  // Re-reading: at 0x19498, we have D0.b = y_byte (yByte). Then ext.w D0w sext to word.
  // Then add.w D0w, D0w → D0w *= 2.
  // Then ROM[0x24496 + D0*1] read as word.
  // (uses D0 as long index after add.w — but the address mode is `(0,A0,D0*1)` so D0 long. But D0w was set, high bits unchanged. After ext.w, high word = sext of low byte. Hmm wait.)
  //
  // Actually let me trace more carefully:
  //   ext.w D0w  → D0w = sext_b(D0.b). So D0.w = sext byte (D0 high byte unchanged in long).
  //   add.w D0w, D0w → D0.w *= 2 (word-wide). High word of D0 unchanged.
  //   So address mode (0, A0, D0*1) — for 68k, default index size in (d8, An, Xn) is .w (word), not .l. So uses D0.w.
  //
  // Therefore: index = sext_w(yByte) * 2.
  const yIdx = yByteSigned * 2;
  const idx = ROM_GRID_BASE + yIdx;
  const wordVal = ((rom.program[idx] ?? 0) << 8) | (rom.program[idx + 1] ?? 0);
  // Sext_l (`ext.l D0`)
  const wordSigned = wordVal & 0x8000 ? wordVal - 0x10000 : wordVal;

  // D1 = 1 << D2.b (= xByte). asl.l D2,D1 — D2.b is shift count.
  // For xByte in [0, 0xF], D1 = 1 << xByte (max 0x8000)
  const mask = (1 << (xByte & 0x3f)) >>> 0;

  const result = (wordSigned & mask) >>> 0;
  return result !== 0 ? 1 : 0;
}
