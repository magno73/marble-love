/**
 * Test fillIncrementingU16 (FUN_1E3E).
 *
 * Bit-perfect verificato vs binary (500/500) tramite
 * `cli/src/test-array-helpers-parity.ts`.
 */

import { describe, it, expect } from "vitest";
import { fillIncrementingU16 } from "../src/array-helpers.js";
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
