/**
 * Test absLong (FUN_1216A / FUN_1B5A6) + negateIfPositive (FUN_1B5B4).
 *
 * Bit-perfect verified vs binary via `cli/src/test-math-helpers-parity.ts`.
 */

import { describe, it, expect } from "vitest";
import { absLong, negateIfPositive } from "../src/math-helpers.js";

describe("absLong (FUN_1216A / FUN_1B5A6)", () => {
  it("zero → zero", () => {
    expect(absLong(0)).toBe(0);
  });

  it("positivo → invariato", () => {
    expect(absLong(42)).toBe(42);
    expect(absLong(0x12345678)).toBe(0x12345678);
    expect(absLong(0x7FFFFFFF)).toBe(0x7FFFFFFF);
  });

  it("negativo → positivo", () => {
    expect(absLong(-1 >>> 0)).toBe(1);
    expect(absLong(0xFFFFFFFE)).toBe(2); // -2 → 2
    expect(absLong(0x80000001)).toBe(0x7FFFFFFF); // -INT_MAX → INT_MAX
  });

  it("INT_MIN (0x80000000) → INT_MIN (overflow del neg, M68k quirk)", () => {
    expect(absLong(0x80000000)).toBe(0x80000000);
  });
});

describe("negateIfPositive (FUN_1B5B4)", () => {
  it("zero → zero (ble si applica)", () => {
    expect(negateIfPositive(0)).toBe(0);
  });

  it("positivo → negativo", () => {
    expect(negateIfPositive(1)).toBe(0xFFFFFFFF); // -1 unsigned
    expect(negateIfPositive(42)).toBe((-42 >>> 0));
    expect(negateIfPositive(0x7FFFFFFF)).toBe(0x80000001);
  });

  it("negativo → invariato", () => {
    expect(negateIfPositive(-1 >>> 0)).toBe(0xFFFFFFFF);
    expect(negateIfPositive(0x80000000)).toBe(0x80000000);
  });
});
