/**
 * Test helper28C38 (FUN_00028C38) — cascading timer tick.
 *
 * 23 istr, 0x44 byte. Struct layout (5 byte at timerPtr):
 *   +0..1: outerCounter (u16 BE)
 *   +2:    mediumCounter (u8)
 *   +3:    padding (not touched)
 *   +4:    innerCounter (u8) — 0xFF = disabled
 *
 * Bit-perfect verificato 500/500 vs musashi-wasm.
 */

import { describe, it, expect } from "vitest";
import { helper28C38, HELPER_28C38_ADDR } from "../src/helper-28c38.js";
import { emptyGameState } from "../src/state.js";

const ADDR = 0x400100;

function setStruct(
  s: ReturnType<typeof emptyGameState>,
  addr: number,
  vals: [number, number, number, number, number],
): void {
  const off = addr - 0x400000;
  for (let i = 0; i < 5; i++) s.workRam[off + i] = vals[i] ?? 0;
}

function readStruct(
  s: ReturnType<typeof emptyGameState>,
  addr: number,
): [number, number, number, number, number] {
  const off = addr - 0x400000;
  return [
    s.workRam[off] ?? 0,
    s.workRam[off + 1] ?? 0,
    s.workRam[off + 2] ?? 0,
    s.workRam[off + 3] ?? 0,
    s.workRam[off + 4] ?? 0,
  ];
}

describe("helper28C38 (FUN_00028C38)", () => {
  it("HELPER_28C38_ADDR is correct", () => {
    expect(HELPER_28C38_ADDR).toBe(0x00028c38);
  });

  it("inner == 0xFF (disabled): no-op, returns 0", () => {
    const s = emptyGameState();
    setStruct(s, ADDR, [0x00, 0x05, 0x03, 0x00, 0xff]);
    expect(helper28C38(s, ADDR)).toBe(0);
    expect(readStruct(s, ADDR)).toEqual([0x00, 0x05, 0x03, 0x00, 0xff]);
  });

  it("inner > 0: decrements only, returns 0", () => {
    const s = emptyGameState();
    setStruct(s, ADDR, [0x00, 0x0a, 0x07, 0x00, 0x03]);
    expect(helper28C38(s, ADDR)).toBe(0);
    expect(readStruct(s, ADDR)).toEqual([0x00, 0x0a, 0x07, 0x00, 0x02]);
  });

  it("inner = 0 → wraps to 0xFF (signed −1): cascades to medium, medium > 0", () => {
    const s = emptyGameState();
    // inner=0, medium=9 → inner goes to 0xFF (<0), resets to 5, medium 9→8 (>=0 signed)
    setStruct(s, ADDR, [0x00, 0x05, 0x09, 0x00, 0x00]);
    expect(helper28C38(s, ADDR)).toBe(0);
    expect(readStruct(s, ADDR)).toEqual([0x00, 0x05, 0x08, 0x00, 0x05]);
  });

  it("inner + medium both expire: outer decremented, bit 1 set", () => {
    const s = emptyGameState();
    // inner=0, medium=0 → both expire, outer 0x0005 → 0x0004
    setStruct(s, ADDR, [0x00, 0x05, 0x00, 0x00, 0x00]);
    expect(helper28C38(s, ADDR)).toBe(0x2);
    expect(readStruct(s, ADDR)).toEqual([0x00, 0x04, 0x09, 0x00, 0x05]);
  });

  it("outer wraps 0x0000 → 0xFFFF: bits 0 and 1 both set", () => {
    const s = emptyGameState();
    // inner=0, medium=0, outer=0x0000 → 0xFFFF
    setStruct(s, ADDR, [0x00, 0x00, 0x00, 0x00, 0x00]);
    expect(helper28C38(s, ADDR)).toBe(0x3);
    expect(readStruct(s, ADDR)).toEqual([0xff, 0xff, 0x09, 0x00, 0x05]);
  });

  it("outer = 1 → 0 (not −1): bit 1 set, bit 0 not set", () => {
    const s = emptyGameState();
    setStruct(s, ADDR, [0x00, 0x01, 0x00, 0x00, 0x00]);
    expect(helper28C38(s, ADDR)).toBe(0x2);
    expect(readStruct(s, ADDR)).toEqual([0x00, 0x00, 0x09, 0x00, 0x05]);
  });

  it("inner = 1 → 0 (signed ≥ 0): no cascade, return 0", () => {
    const s = emptyGameState();
    setStruct(s, ADDR, [0x00, 0x05, 0x03, 0x00, 0x01]);
    expect(helper28C38(s, ADDR)).toBe(0);
    expect(readStruct(s, ADDR)).toEqual([0x00, 0x05, 0x03, 0x00, 0x00]);
  });

  it("inner = 0x80 (signed −128) → 0x7F (signed +127): no cascade", () => {
    const s = emptyGameState();
    setStruct(s, ADDR, [0x00, 0x05, 0x03, 0x00, 0x80]);
    expect(helper28C38(s, ADDR)).toBe(0);
    expect(readStruct(s, ADDR)).toEqual([0x00, 0x05, 0x03, 0x00, 0x7f]);
  });

  it("padding byte (+3) is never modified", () => {
    const s = emptyGameState();
    setStruct(s, ADDR, [0x00, 0x00, 0x00, 0xab, 0x00]);
    helper28C38(s, ADDR);
    // outer = 0x0000 → 0xFFFF, full cascade
    expect((s.workRam[(ADDR - 0x400000) + 3] ?? 0)).toBe(0xab);
  });

  it("outer = 0x0100: big-endian word decrement, result 0x00FF", () => {
    const s = emptyGameState();
    setStruct(s, ADDR, [0x01, 0x00, 0x00, 0x00, 0x00]);
    expect(helper28C38(s, ADDR)).toBe(0x2);
    expect(readStruct(s, ADDR)).toEqual([0x00, 0xff, 0x09, 0x00, 0x05]);
  });
});
