/**
 * sprite-pair-coord-add-1d82.test.ts — smoke + corner-case di FUN_1D82.
 */

import { describe, it, expect } from "vitest";
import {
  spritePairCoordAdd1D82,
  SPRITE_RAM_BANK_A_ADDR,
  SPRITE_RAM_BANK_B_ADDR,
  BANK_STRIDE_BYTES,
  COORD_PACK_MASK,
} from "../src/sprite-pair-coord-add-1d82.js";
import { emptyGameState } from "../src/state.js";

function writeWord(s: Uint8Array, off: number, v: number): void {
  s[off] = (v >>> 8) & 0xff;
  s[off + 1] = v & 0xff;
}

function readWord(s: Uint8Array, off: number): number {
  return (((s[off] ?? 0) << 8) | (s[off + 1] ?? 0)) & 0xffff;
}

describe("spritePairCoordAdd1D82 (FUN_1D82)", () => {
  it("base case: bank=0, col=0, delta=0 → preserva word ma clear bit 14,15 e bit 4", () => {
    const s = emptyGameState();
    // bank A @ offset 0: pack coord=0x10 (bit 5..13 = 0x10), low nibble 0x5.
    // Layout: coord<<5 | nibble = 0x10*0x20 + 0x5 = 0x205. Settiamo anche
    // bit 14,15 e bit 4 per testare il clear.
    writeWord(s.spriteRam, 0x000, 0xc215); // 0b1100_0010_0001_0101
    // bank B @ offset 0x100:
    writeWord(s.spriteRam, 0x100, 0x4123); // bit 14 clear, bit 15 set, etc

    spritePairCoordAdd1D82(s, /*col*/ 0, /*bank*/ 0, /*deltaA*/ 0, /*deltaB*/ 0);

    // bank A: coord = asr 5 di 0xC215 = 0xFE10 sign-ext, & 0x1FF = 0x010
    // Aspetta — (-16363) >> 5 in 16-bit signed: 0xC215 unsigned, signed -15851.
    //   -15851 / 32 = -495.34..., floor = -496 = 0xFE10.
    //   0xFE10 & 0x1FF = 0x010.
    // delta=0, shifted = 0x010 << 5 = 0x200.
    // low nibble di 0xC215 = 0x5.
    // result = (0x200 | 0x5) & 0x3FFF = 0x205.
    expect(readWord(s.spriteRam, 0x000)).toBe(0x205);

    // bank B: 0x4123 signed = 16675, >>5 = 521 = 0x209, & 0x1FF = 0x009.
    // shifted = 0x009 << 5 = 0x120. low nibble = 0x3. result = 0x123.
    expect(readWord(s.spriteRam, 0x100)).toBe(0x123);
  });

  it("posivite delta: incrementa la coord (signed-9)", () => {
    const s = emptyGameState();
    // pack coord = 0x050 (= 80), low nibble = 0x7.
    // word = 0x050 << 5 | 0x7 = 0x0A07.
    writeWord(s.spriteRam, 0x000, 0x0a07);
    writeWord(s.spriteRam, 0x100, 0x0a07);

    spritePairCoordAdd1D82(s, 0, 0, /*deltaA*/ 0x10, /*deltaB*/ 0x20);

    // bank A: 0x0A07 signed = +2567, >>5 = 80 = 0x50.
    // 0x50 + 0x10 = 0x60. shifted = 0x60 << 5 = 0xC00. | 0x7 = 0xC07. & 0x3FFF = 0xC07.
    expect(readWord(s.spriteRam, 0x000)).toBe(0xc07);

    // bank B: 0x50 + 0x20 = 0x70. shifted = 0x70 << 5 = 0xE00. | 0x7 = 0xE07.
    expect(readWord(s.spriteRam, 0x100)).toBe(0xe07);
  });

  it("bank/col addressing: scrive nei giusti offset spriteRam", () => {
    const s = emptyGameState();
    // bank=3, col=0x12 → offset = 3*0x200 + 0x12*2 = 0x600 + 0x24 = 0x624.
    const offA = 3 * BANK_STRIDE_BYTES + 0x12 * 2;
    const offB = offA + 0x100;

    // Pre-set: 0x0040 (= coord 2, nibble 0).
    writeWord(s.spriteRam, offA, 0x0040);
    writeWord(s.spriteRam, offB, 0x0040);

    spritePairCoordAdd1D82(s, 0x12, 3, 0x05, 0x07);

    // 0x0040 >>5 = 2. + 0x05 = 7. << 5 = 0xE0. | 0 = 0xE0.
    expect(readWord(s.spriteRam, offA)).toBe(0xe0);
    // bank B: 2 + 7 = 9. << 5 = 0x120. | 0 = 0x120.
    expect(readWord(s.spriteRam, offB)).toBe(0x120);

    expect(readWord(s.spriteRam, offA - 2)).toBe(0);
    expect(readWord(s.spriteRam, offA + 2)).toBe(0);
    expect(readWord(s.spriteRam, offB - 2)).toBe(0);
    expect(readWord(s.spriteRam, offB + 2)).toBe(0);
  });

  it("signed coord: bit 13 (= 0x4000 nel pack) → coord negativa, asr propaga il segno", () => {
    const s = emptyGameState();
    // word = 0xFFE0: signed16 = -32, >>5 = -1 = 0xFFFF, & 0x1FF = 0x1FF.
    // delta = 1: 0x1FF + 1 = 0x200, & 0xFFFF = 0x200. << 5 = 0x4000.
    // OR low nibble (0) → 0x4000. & 0x3FFF → 0x0000.
    writeWord(s.spriteRam, 0x000, 0xffe0);
    writeWord(s.spriteRam, 0x100, 0xffe0);

    spritePairCoordAdd1D82(s, 0, 0, 1, 1);

    expect(readWord(s.spriteRam, 0x000)).toBe(0x0000);
    expect(readWord(s.spriteRam, 0x100)).toBe(0x0000);
  });

  it("delta wrapping: somma word-wise modulo 2^16", () => {
    const s = emptyGameState();
    // coord estratta = 0x100. delta = 0xFF00 (= -256 signed).
    // 0x100 + 0xFF00 = 0x10000 → word = 0x0000.
    // pack: 0x0000 << 5 = 0x0000. low nibble of original word 0x2008.
    //   (0x100 << 5 | 0x8 = 0x2008). low nibble = 0x8. result = 0x0008.
    writeWord(s.spriteRam, 0x000, 0x2008);
    writeWord(s.spriteRam, 0x100, 0x2008);

    spritePairCoordAdd1D82(s, 0, 0, 0xff00, 0xff00);

    expect(readWord(s.spriteRam, 0x000)).toBe(0x0008);
    expect(readWord(s.spriteRam, 0x100)).toBe(0x0008);
  });

  it("preserve low nibble, perde bit 4: pack mask = 0xF non 0x1F", () => {
    const s = emptyGameState();
    // word = 0x0010 (only bit 4 set). Extracted coord = 0. + delta 0 = 0.
    // shifted = 0. low nibble (= word & 0xF) = 0x0. result = 0.
    writeWord(s.spriteRam, 0x000, 0x0010);
    writeWord(s.spriteRam, 0x100, 0x0010);

    spritePairCoordAdd1D82(s, 0, 0, 0, 0);

    expect(readWord(s.spriteRam, 0x000)).toBe(0x0000);
    expect(readWord(s.spriteRam, 0x100)).toBe(0x0000);
  });

  it("constants exported correttamente", () => {
    expect(SPRITE_RAM_BANK_A_ADDR).toBe(0x00a02000);
    expect(SPRITE_RAM_BANK_B_ADDR).toBe(0x00a02100);
    expect(BANK_STRIDE_BYTES).toBe(0x200);
    expect(COORD_PACK_MASK).toBe(0x3fff);
  });
});
