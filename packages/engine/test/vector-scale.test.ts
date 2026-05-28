/**
 * Test vectorScale (FUN_25E7C) — 326 byte pure leaf.
 *
 * Bit-perfect verified against the binary (2000/2000) through
 * `cli/src/test-vector-scale-parity.ts` with input range [-256, 255]
 * (small range to avoid 68k divu.w overflow).
 */

import { describe, it, expect } from "vitest";
import { vectorScale } from "../src/vector-scale.js";
import { emptyGameState } from "../src/state.js";
import { emptyRomImage } from "../src/bus.js";

function readU32(s: ReturnType<typeof emptyGameState>, addr: number): number {
  const off = addr - 0x400000;
  return (
    (((s.workRam[off] ?? 0) << 24) |
      ((s.workRam[off + 1] ?? 0) << 16) |
      ((s.workRam[off + 2] ?? 0) << 8) |
      (s.workRam[off + 3] ?? 0)) >>> 0
  );
}
function writeU32(s: ReturnType<typeof emptyGameState>, addr: number, v: number): void {
  const off = addr - 0x400000;
  s.workRam[off] = (v >>> 24) & 0xff;
  s.workRam[off + 1] = (v >>> 16) & 0xff;
  s.workRam[off + 2] = (v >>> 8) & 0xff;
  s.workRam[off + 3] = v & 0xff;
}

describe("vectorScale (FUN_25E7C)", () => {
  it("zero vector: scrive (0,0) con clamp D3=0x100", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    writeU32(s, 0x401D00, 0);
    writeU32(s, 0x401D04, 0);
    vectorScale(s, rom, 0x00401D00, 5);
    // Zero input, should produce zero output
    expect(readU32(s, 0x401D00)).toBe(0);
    expect(readU32(s, 0x401D04)).toBe(0);
  });

  it("non-zero vector: produce risultato deterministic con ROM zero", () => {
    const s = emptyGameState();
    const rom = emptyRomImage(); // ROM zero — D5 e V_next entrambi 0
    writeU32(s, 0x401D00, 100);
    writeU32(s, 0x401D04, 50);
    vectorScale(s, rom, 0x00401D00, 5);
    // With zero ROM: D5=0, D2=0 after add, default mode 5 -> D4 = D3 - 0 = D3.
    // D5 = (D4 << 6) / (D3 >> 8) = D3*64 / (D3>>8) = clamp triggers, D3 = 0x100
    // D5 = 0x4000 / 1 = 0x4000 (fits in word)
    // x = (100 >> 8) * 0x4000 >> 6 = 0 * ... = 0
    // y = same logic, 0
    expect(readU32(s, 0x401D00)).toBe(0);
    expect(readU32(s, 0x401D04)).toBe(0);
  });
});
