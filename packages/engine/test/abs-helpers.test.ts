import { describe, it, expect } from "vitest";
import {
  ABS_LONG_1B5A6_ADDR,
  NEG_ABS_LONG_1B5B4_ADDR,
  absLong1B5A6,
  negAbsLong1B5B4,
} from "../src/abs-helpers.js";

describe("FUN_1B5A6 absLong1B5A6", () => {
  it("expone l'address of the binario", () => {
    expect(ABS_LONG_1B5A6_ADDR).toBe(0x1b5a6);
  });

  it("positivo → invariato", () => {
    expect(absLong1B5A6(42)).toBe(42);
    expect(absLong1B5A6(0x7fffffff)).toBe(0x7fffffff);
  });

  it("negativo → negato", () => {
    expect(absLong1B5A6(-42)).toBe(42);
    expect(absLong1B5A6(-1)).toBe(1);
  });

  it("zero → zero", () => {
    expect(absLong1B5A6(0)).toBe(0);
  });

  it("INT32_MIN edge case → invariato (M68k neg.l overflow)", () => {
    expect(absLong1B5A6(-2147483648)).toBe(-2147483648);
  });

  it("32-bit signed overflow", () => {
    // -2^31 + 1 → 2^31 - 1
    expect(absLong1B5A6(-2147483647)).toBe(2147483647);
  });
});

describe("FUN_1B5B4 negAbsLong1B5B4", () => {
  it("expone l'address of the binario", () => {
    expect(NEG_ABS_LONG_1B5B4_ADDR).toBe(0x1b5b4);
  });

  it("positivo → negato", () => {
    expect(negAbsLong1B5B4(42)).toBe(-42);
    expect(negAbsLong1B5B4(0x7fffffff)).toBe(-0x7fffffff);
  });

  it("negativo → invariato", () => {
    expect(negAbsLong1B5B4(-42)).toBe(-42);
    expect(negAbsLong1B5B4(-1)).toBe(-1);
  });

  it("zero → zero", () => {
    expect(negAbsLong1B5B4(0)).toBe(0);
  });

  it("simmetrico a absLong1B5A6 modulo zero", () => {
    for (const v of [42, -42, 100, -100, 1, -1]) {
      expect(negAbsLong1B5B4(v)).toBe(-Math.abs(v));
    }
  });
});
