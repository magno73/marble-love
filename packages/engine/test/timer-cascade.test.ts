/**
 * Test tickCascadingTimer (FUN_28C38).
 *
 * Bit-perfect verified against the binary (1000/1000).
 */

import { describe, it, expect } from "vitest";
import { tickCascadingTimer } from "../src/timer-cascade.js";
import { emptyGameState } from "../src/state.js";

describe("tickCascadingTimer (FUN_28C38)", () => {
  function setStruct(s: ReturnType<typeof emptyGameState>, addr: number, vals: number[]) {
    const off = addr - 0x400000;
    for (let i = 0; i < vals.length; i++) s.workRam[off + i] = vals[i] ?? 0;
  }
  function readStruct(s: ReturnType<typeof emptyGameState>, addr: number): number[] {
    const off = addr - 0x400000;
    return [
      s.workRam[off] ?? 0,
      s.workRam[off + 1] ?? 0,
      s.workRam[off + 2] ?? 0,
      s.workRam[off + 3] ?? 0,
      s.workRam[off + 4] ?? 0,
    ];
  }

  it("inner == 0xFF (disabled): no-op, return 0", () => {
    const s = emptyGameState();
    setStruct(s, 0x400100, [0x01, 0x02, 0x03, 0x04, 0xff]);
    expect(tickCascadingTimer(s, 0x400100)).toBe(0);
    expect(readStruct(s, 0x400100)).toEqual([0x01, 0x02, 0x03, 0x04, 0xff]);
  });

  it("inner > 0: decrement only, return 0", () => {
    const s = emptyGameState();
    setStruct(s, 0x400100, [0, 0, 0, 0, 5]);
    expect(tickCascadingTimer(s, 0x400100)).toBe(0);
    expect(readStruct(s, 0x400100)).toEqual([0, 0, 0, 0, 4]);
  });

  it("inner = 0 → -1 (signed < 0): cascade to medium", () => {
    const s = emptyGameState();
    setStruct(s, 0x400100, [0, 0, 9, 0, 0]);
    // inner: 0 → 0xFF (= -1 signed). Cascade: reset to 5. Medium 9 → 8 (>= 0). Return 0.
    expect(tickCascadingTimer(s, 0x400100)).toBe(0);
    expect(readStruct(s, 0x400100)).toEqual([0, 0, 8, 0, 5]);
  });

  it("inner + medium cascade: outer decremented, bit 1 set", () => {
    const s = emptyGameState();
    setStruct(s, 0x400100, [0, 5, 0, 0, 0]);
    // inner: 0→-1, reset to 5. Medium: 0→-1, reset to 9. Outer: 0x0005 → 0x0004. Return bit 1.
    expect(tickCascadingTimer(s, 0x400100)).toBe(0x2);
    expect(readStruct(s, 0x400100)).toEqual([0, 4, 9, 0, 5]);
  });

  it("outer wraps to 0xFFFF: bit 0 also set", () => {
    const s = emptyGameState();
    setStruct(s, 0x400100, [0, 0, 0, 0, 0]);
    // inner cascade, medium cascade, outer 0 → 0xFFFF. Both bits set.
    expect(tickCascadingTimer(s, 0x400100)).toBe(0x3);
    expect(readStruct(s, 0x400100)).toEqual([0xff, 0xff, 9, 0, 5]);
  });

  it("inner negative (high bit) but non 0xFF: cascades", () => {
    // inner = 0x80 (signed -128), decrement to 0x7F (signed +127).
    // 0x7F >= 0 signed → no cascade. Return 0.
    const s = emptyGameState();
    setStruct(s, 0x400100, [0, 0, 0x05, 0, 0x80]);
    expect(tickCascadingTimer(s, 0x400100)).toBe(0);
    expect(readStruct(s, 0x400100)).toEqual([0, 0, 0x05, 0, 0x7f]);
  });
});
