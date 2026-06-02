/**
 * Test fillIncrementingU16 (FUN_1E3E).
 *
 * Bit-perfect verified against the binary (500/500) through
 * `cli/src/test-array-helpers-parity.ts`.
 */

import { describe, it, expect } from "vitest";
import {
  fillIncrementingU16,
  initStructHeader,
  clearPaletteRam,
  swapLongPair,
} from "../src/array-helpers.js";
import { emptyGameState } from "../src/state.js";

describe("fillIncrementingU16 (FUN_1E3E)", () => {
  function readU16(s: ReturnType<typeof emptyGameState>, addr: number): number {
    const off = addr - 0x400000;
    return ((s.workRam[off] ?? 0) << 8) | (s.workRam[off + 1] ?? 0);
  }

  it("count=0: no-op", () => {
    const s = emptyGameState();
    s.workRam[0x100] = 0xAA;
    fillIncrementingU16(s, 0x400100, 0x1234, 0);
    expect(s.workRam[0x100]).toBe(0xAA);
  });

  it("count=1: single word", () => {
    const s = emptyGameState();
    fillIncrementingU16(s, 0x400100, 0x5678, 1);
    expect(readU16(s, 0x400100)).toBe(0x5678);
    expect(s.workRam[0x102]).toBe(0); // not touched
  });

  it("count=5: incrementing sequence", () => {
    const s = emptyGameState();
    fillIncrementingU16(s, 0x400100, 100, 5);
    expect(readU16(s, 0x400100)).toBe(100);
    expect(readU16(s, 0x400102)).toBe(101);
    expect(readU16(s, 0x400104)).toBe(102);
    expect(readU16(s, 0x400106)).toBe(103);
    expect(readU16(s, 0x400108)).toBe(104);
    expect(s.workRam[0x10A]).toBe(0); // not touched
  });

  it("start wraps at 0xFFFF (word arithmetic)", () => {
    const s = emptyGameState();
    fillIncrementingU16(s, 0x400100, 0xFFFE, 4);
    expect(readU16(s, 0x400100)).toBe(0xFFFE);
    expect(readU16(s, 0x400102)).toBe(0xFFFF);
    expect(readU16(s, 0x400104)).toBe(0); // wrap
    expect(readU16(s, 0x400106)).toBe(1);
  });

  it("count negative: no-op (signed)", () => {
    const s = emptyGameState();
    s.workRam[0x100] = 0xBB;
    fillIncrementingU16(s, 0x400100, 0, -5);
    expect(s.workRam[0x100]).toBe(0xBB);
  });

  it("dest in colorRam (palette region)", () => {
    const s = emptyGameState();
    fillIncrementingU16(s, 0xB00000, 0xFADE, 3);
    expect(((s.colorRam[0] ?? 0) << 8) | (s.colorRam[1] ?? 0)).toBe(0xFADE);
    expect(((s.colorRam[2] ?? 0) << 8) | (s.colorRam[3] ?? 0)).toBe(0xFADF);
    expect(((s.colorRam[4] ?? 0) << 8) | (s.colorRam[5] ?? 0)).toBe(0xFAE0);
  });
});

describe("initStructHeader (FUN_255A)", () => {
  it("writes byte a offset 0/1, azzera offset 6", () => {
    const s = emptyGameState();
    // Pre-fill with 0xAA
    for (let i = 0; i < 8; i++) s.workRam[0x100 + i] = 0xAA;
    initStructHeader(s, 0x400100, 0x12, 0x34);
    expect(s.workRam[0x100]).toBe(0x12);
    expect(s.workRam[0x101]).toBe(0x34);
    expect(s.workRam[0x102]).toBe(0xAA); // not touched
    expect(s.workRam[0x103]).toBe(0xAA);
    expect(s.workRam[0x104]).toBe(0xAA);
    expect(s.workRam[0x105]).toBe(0xAA);
    expect(s.workRam[0x106]).toBe(0); // cleared
    expect(s.workRam[0x107]).toBe(0xAA);
  });

  it("byte values mascherati a 8 bit", () => {
    const s = emptyGameState();
    initStructHeader(s, 0x400100, 0x1FF, 0x200);
    expect(s.workRam[0x100]).toBe(0xFF);
    expect(s.workRam[0x101]).toBe(0x00);
  });

  it("ptr in colorRam", () => {
    const s = emptyGameState();
    s.colorRam[0x10] = 0xCC;
    s.colorRam[0x16] = 0xCC;
    initStructHeader(s, 0xB00010, 0xAB, 0xCD);
    expect(s.colorRam[0x10]).toBe(0xAB);
    expect(s.colorRam[0x11]).toBe(0xCD);
    expect(s.colorRam[0x16]).toBe(0); // cleared
  });
});

describe("clearPaletteRam (FUN_121A6)", () => {
  it("azzera tutta la palette RAM (2 KB)", () => {
    const s = emptyGameState();
    s.colorRam.fill(0xFF);
    clearPaletteRam(s);
    for (let i = 0; i < s.colorRam.length; i++) {
      expect(s.colorRam[i]).toBe(0);
    }
  });
});

describe("swapLongPair (FUN_12886)", () => {
  it("scambia 2 long adiacenti", () => {
    const s = emptyGameState();
    // *0x401D00 = 0xDEADBEEF, *0x401D04 = 0x12345678
    s.workRam[0x1D00] = 0xDE; s.workRam[0x1D01] = 0xAD;
    s.workRam[0x1D02] = 0xBE; s.workRam[0x1D03] = 0xEF;
    s.workRam[0x1D04] = 0x12; s.workRam[0x1D05] = 0x34;
    s.workRam[0x1D06] = 0x56; s.workRam[0x1D07] = 0x78;
    swapLongPair(s, 0x401D00);
    // Now *0x401D00 = 0x12345678, *0x401D04 = 0xDEADBEEF
    expect(s.workRam[0x1D00]).toBe(0x12);
    expect(s.workRam[0x1D01]).toBe(0x34);
    expect(s.workRam[0x1D02]).toBe(0x56);
    expect(s.workRam[0x1D03]).toBe(0x78);
    expect(s.workRam[0x1D04]).toBe(0xDE);
    expect(s.workRam[0x1D05]).toBe(0xAD);
    expect(s.workRam[0x1D06]).toBe(0xBE);
    expect(s.workRam[0x1D07]).toBe(0xEF);
  });

  it("non tocca byte adiacenti", () => {
    const s = emptyGameState();
    s.workRam[0x1CFF] = 0xAA;
    s.workRam[0x1D08] = 0xBB;
    swapLongPair(s, 0x401D00);
    expect(s.workRam[0x1CFF]).toBe(0xAA);
    expect(s.workRam[0x1D08]).toBe(0xBB);
  });
});
