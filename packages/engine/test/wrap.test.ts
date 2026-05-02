/**
 * Test aggressivi su wrap.ts. Bug qui = bug ovunque (PRD §10).
 *
 * Coverage target:
 *  - Overflow / underflow espliciti
 *  - Sign extension
 *  - Bit shift edge case (shift di 0, shift > width)
 *  - Math.imul vs operatore *
 *  - Round-trip brand/unbrand
 *  - Pack/unpack 8↔16↔32
 */

import { describe, it, expect } from "vitest";
import {
  as_u8, as_u16, as_u32, as_i8, as_i16, as_i32, raw,
  u8_add, u8_sub, u8_mul, u8_and, u8_or, u8_xor, u8_shl, u8_shr, u8_not,
  u16_add, u16_sub, u16_mul, u16_shl, u16_shr, u16_rotl, u16_rotr,
  u32_add, u32_sub, u32_mul, u32_shl, u32_shr, u32_rotl, u32_rotr,
  u32_pack16, u16_pack8, u16_hi, u16_lo, u8_hi, u8_lo,
  sext_8_16, sext_8_32, sext_16_32,
  carry_add, borrow_sub, overflow_add,
  i16_add, i16_sub, i16_sar, i32_sar,
} from "../src/wrap.js";

describe("brand round-trip", () => {
  it("as_u8 wraps to 0..255", () => {
    expect(raw(as_u8(0))).toBe(0);
    expect(raw(as_u8(255))).toBe(255);
    expect(raw(as_u8(256))).toBe(0);
    expect(raw(as_u8(-1))).toBe(255);
    expect(raw(as_u8(0x1ff))).toBe(0xff);
    expect(raw(as_u8(-128))).toBe(128);
  });

  it("as_u16 wraps to 0..65535", () => {
    expect(raw(as_u16(0))).toBe(0);
    expect(raw(as_u16(0xffff))).toBe(0xffff);
    expect(raw(as_u16(0x10000))).toBe(0);
    expect(raw(as_u16(-1))).toBe(0xffff);
  });

  it("as_u32 forces unsigned 32-bit", () => {
    expect(raw(as_u32(0))).toBe(0);
    expect(raw(as_u32(-1))).toBe(0xffffffff);
    expect(raw(as_u32(0x80000000))).toBe(0x80000000);
    expect(raw(as_u32(0x100000000))).toBe(0); // wraps via >>> 0
  });

  it("as_i8 sign-extends", () => {
    expect(raw(as_i8(0))).toBe(0);
    expect(raw(as_i8(127))).toBe(127);
    expect(raw(as_i8(128))).toBe(-128);
    expect(raw(as_i8(255))).toBe(-1);
    expect(raw(as_i8(-1))).toBe(-1);
  });

  it("as_i16 sign-extends", () => {
    expect(raw(as_i16(0))).toBe(0);
    expect(raw(as_i16(0x7fff))).toBe(0x7fff);
    expect(raw(as_i16(0x8000))).toBe(-0x8000);
    expect(raw(as_i16(0xffff))).toBe(-1);
  });

  it("as_i32 forces signed 32-bit", () => {
    expect(raw(as_i32(0))).toBe(0);
    expect(raw(as_i32(0x7fffffff))).toBe(0x7fffffff);
    expect(raw(as_i32(0x80000000))).toBe(-0x80000000);
    expect(raw(as_i32(0xffffffff))).toBe(-1);
  });
});

describe("u8 arithmetic", () => {
  it("u8_add wraps", () => {
    expect(raw(u8_add(as_u8(200), as_u8(100)))).toBe(44); // 300 mod 256
    expect(raw(u8_add(as_u8(0xff), as_u8(1)))).toBe(0);
  });
  it("u8_sub wraps", () => {
    expect(raw(u8_sub(as_u8(0), as_u8(1)))).toBe(0xff);
    expect(raw(u8_sub(as_u8(10), as_u8(20)))).toBe(246);
  });
  it("u8_mul truncates", () => {
    expect(raw(u8_mul(as_u8(16), as_u8(16)))).toBe(0); // 256
    expect(raw(u8_mul(as_u8(17), as_u8(17)))).toBe(289 & 0xff);
  });
  it("u8 bitwise", () => {
    expect(raw(u8_and(as_u8(0xf0), as_u8(0x0f)))).toBe(0);
    expect(raw(u8_or(as_u8(0xf0), as_u8(0x0f)))).toBe(0xff);
    expect(raw(u8_xor(as_u8(0xff), as_u8(0xf0)))).toBe(0x0f);
    expect(raw(u8_not(as_u8(0)))).toBe(0xff);
    expect(raw(u8_shl(as_u8(0x80), 1))).toBe(0); // shifted out
    expect(raw(u8_shr(as_u8(0x80), 7))).toBe(1);
  });
});

describe("u16 arithmetic", () => {
  it("u16_add wraps", () => {
    expect(raw(u16_add(as_u16(0xffff), as_u16(1)))).toBe(0);
    expect(raw(u16_add(as_u16(0x8000), as_u16(0x8000)))).toBe(0);
  });
  it("u16_sub wraps", () => {
    expect(raw(u16_sub(as_u16(0), as_u16(1)))).toBe(0xffff);
  });
  it("u16_mul uses imul (32→16 truncate)", () => {
    expect(raw(u16_mul(as_u16(0xffff), as_u16(0xffff)))).toBe(1); // -1 * -1 mod 2^16
    expect(raw(u16_mul(as_u16(0x100), as_u16(0x100)))).toBe(0);   // 65536 mod 2^16
  });
  it("u16_rotl preserves bits", () => {
    expect(raw(u16_rotl(as_u16(0x8001), 1))).toBe(0x0003);
    expect(raw(u16_rotl(as_u16(0xa5a5), 8))).toBe(0xa5a5);
    expect(raw(u16_rotl(as_u16(0x1234), 16))).toBe(0x1234);
  });
  it("u16_rotr inverso di u16_rotl", () => {
    const v = as_u16(0xdead);
    expect(raw(u16_rotr(u16_rotl(v, 5), 5))).toBe(0xdead);
  });
});

describe("u32 arithmetic — il caso critico per il 68010", () => {
  it("u32_add wraps a 2^32", () => {
    expect(raw(u32_add(as_u32(0xffffffff), as_u32(1)))).toBe(0);
    expect(raw(u32_add(as_u32(0x80000000), as_u32(0x80000000)))).toBe(0);
  });
  it("u32_sub wraps", () => {
    expect(raw(u32_sub(as_u32(0), as_u32(1)))).toBe(0xffffffff);
  });
  it("u32_mul è Math.imul (32×32→32)", () => {
    // imul(0xFFFF, 0xFFFF) = 0xFFFE0001
    expect(raw(u32_mul(as_u32(0xffff), as_u32(0xffff)))).toBe(0xfffe0001);
    // overflow: imul(0x10000, 0x10000) = 0
    expect(raw(u32_mul(as_u32(0x10000), as_u32(0x10000)))).toBe(0);
  });
  it("u32_shl rispetta wraparound a 32", () => {
    expect(raw(u32_shl(as_u32(1), 31))).toBe(0x80000000);
    expect(raw(u32_shl(as_u32(1), 32))).toBe(1); // JS << modulo 32
  });
  it("u32_shr è zero-fill (logical)", () => {
    expect(raw(u32_shr(as_u32(0x80000000), 31))).toBe(1);
    expect(raw(u32_shr(as_u32(0xffffffff), 1))).toBe(0x7fffffff);
  });
  it("u32_rotl/rotr round-trip", () => {
    const v = as_u32(0xdeadbeef);
    for (const n of [0, 1, 7, 16, 31]) {
      expect(raw(u32_rotr(u32_rotl(v, n), n))).toBe(0xdeadbeef);
    }
  });
});

describe("pack / unpack", () => {
  it("u32_pack16 + u16_hi/lo round-trip", () => {
    const v = u32_pack16(as_u16(0xdead), as_u16(0xbeef));
    expect(raw(v)).toBe(0xdeadbeef);
    expect(raw(u16_hi(v))).toBe(0xdead);
    expect(raw(u16_lo(v))).toBe(0xbeef);
  });
  it("u16_pack8 + u8_hi/lo round-trip", () => {
    const v = u16_pack8(as_u8(0xab), as_u8(0xcd));
    expect(raw(v)).toBe(0xabcd);
    expect(raw(u8_hi(v))).toBe(0xab);
    expect(raw(u8_lo(v))).toBe(0xcd);
  });
});

describe("sign extension", () => {
  it("sext_8_16", () => {
    expect(raw(sext_8_16(as_u8(0x7f)))).toBe(0x7f);
    expect(raw(sext_8_16(as_u8(0x80)))).toBe(-0x80);
    expect(raw(sext_8_16(as_u8(0xff)))).toBe(-1);
  });
  it("sext_8_32", () => {
    expect(raw(sext_8_32(as_u8(0xff)))).toBe(-1);
    expect(raw(sext_8_32(as_u8(0x80)))).toBe(-128);
  });
  it("sext_16_32", () => {
    expect(raw(sext_16_32(as_u16(0xffff)))).toBe(-1);
    expect(raw(sext_16_32(as_u16(0x8000)))).toBe(-32768);
    expect(raw(sext_16_32(as_u16(0x7fff)))).toBe(0x7fff);
  });
});

describe("CCR flag helpers (68010)", () => {
  it("carry_add", () => {
    expect(carry_add(0xff, 1, 8)).toBe(true);
    expect(carry_add(0x7f, 1, 8)).toBe(false);
    expect(carry_add(0xffff, 1, 16)).toBe(true);
    expect(carry_add(0xffffffff, 1, 32)).toBe(true);
  });
  it("borrow_sub", () => {
    expect(borrow_sub(0, 1, 8)).toBe(true);
    expect(borrow_sub(1, 0, 8)).toBe(false);
  });
  it("overflow_add (signed)", () => {
    // 0x7F + 1 = 0x80 → overflow
    expect(overflow_add(0x7f, 1, 8)).toBe(true);
    // 0x80 + 0xFF = 0x7F (-128 + -1 = -129 wrap to +127) → overflow
    expect(overflow_add(0x80, 0xff, 8)).toBe(true);
    // 1 + 1 = 2 → no overflow
    expect(overflow_add(1, 1, 8)).toBe(false);
  });
});

describe("signed arithmetic (i16/i32)", () => {
  it("i16_add wraps", () => {
    expect(raw(i16_add(as_i16(0x7fff), as_i16(1)))).toBe(-0x8000);
  });
  it("i16_sub wraps", () => {
    expect(raw(i16_sub(as_i16(-0x8000), as_i16(1)))).toBe(0x7fff);
  });
  it("i16_sar è arithmetic (sign-fill)", () => {
    expect(raw(i16_sar(as_i16(-1), 1))).toBe(-1);
    expect(raw(i16_sar(as_i16(-2), 1))).toBe(-1);
    expect(raw(i16_sar(as_i16(-4), 2))).toBe(-1);
  });
  it("i32_sar è arithmetic", () => {
    expect(raw(i32_sar(as_i32(-1), 5))).toBe(-1);
    expect(raw(i32_sar(as_i32(-1024), 4))).toBe(-64);
  });
});
