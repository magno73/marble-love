/**
 *
 * Branded types: u8, u16, u32, i8, i16, i32 (aliases of number, but incompatible
 *
 * Rules:
 *    fails in `packages/engine/src`.
 *  - For >>= prefer `u32_shr` (zero-fill) or `i32_sar` (arithmetic).
 *    `as_u8/as_u16/as_u32` to be branded.
 */

declare const __u8: unique symbol;
declare const __u16: unique symbol;
declare const __u32: unique symbol;
declare const __i8: unique symbol;
declare const __i16: unique symbol;
declare const __i32: unique symbol;

export type u8 = number & { readonly [__u8]: void };
export type u16 = number & { readonly [__u16]: void };
export type u32 = number & { readonly [__u32]: void };
export type i8 = number & { readonly [__i8]: void };
export type i16 = number & { readonly [__i16]: void };
export type i32 = number & { readonly [__i32]: void };

// ─── Brand/unbrand ────────────────────────────────────────────────────────

export const as_u8 = (n: number): u8 => (n & 0xff) as u8;
export const as_u16 = (n: number): u16 => (n & 0xffff) as u16;
export const as_u32 = (n: number): u32 => (n >>> 0) as u32;
export const as_i8 = (n: number): i8 => {
  const v = n & 0xff;
  return ((v & 0x80) ? v - 0x100 : v) as i8;
};
export const as_i16 = (n: number): i16 => {
  const v = n & 0xffff;
  return ((v & 0x8000) ? v - 0x10000 : v) as i16;
};
export const as_i32 = (n: number): i32 => (n | 0) as i32;

export const raw = (n: u8 | u16 | u32 | i8 | i16 | i32): number => n as unknown as number;

// ─── u8 ───────────────────────────────────────────────────────────────────

export const u8_add = (a: u8, b: u8): u8 => as_u8((a as number) + (b as number));
export const u8_sub = (a: u8, b: u8): u8 => as_u8((a as number) - (b as number));
export const u8_mul = (a: u8, b: u8): u8 => as_u8(Math.imul(a as number, b as number));
export const u8_and = (a: u8, b: u8): u8 => as_u8((a as number) & (b as number));
export const u8_or = (a: u8, b: u8): u8 => as_u8((a as number) | (b as number));
export const u8_xor = (a: u8, b: u8): u8 => as_u8((a as number) ^ (b as number));
export const u8_shl = (a: u8, n: number): u8 => as_u8((a as number) << n);
export const u8_shr = (a: u8, n: number): u8 => as_u8((a as number) >>> n);
export const u8_not = (a: u8): u8 => as_u8(~(a as number));

// ─── u16 ──────────────────────────────────────────────────────────────────

export const u16_add = (a: u16, b: u16): u16 => as_u16((a as number) + (b as number));
export const u16_sub = (a: u16, b: u16): u16 => as_u16((a as number) - (b as number));
export const u16_mul = (a: u16, b: u16): u16 => as_u16(Math.imul(a as number, b as number));
export const u16_and = (a: u16, b: u16): u16 => as_u16((a as number) & (b as number));
export const u16_or = (a: u16, b: u16): u16 => as_u16((a as number) | (b as number));
export const u16_xor = (a: u16, b: u16): u16 => as_u16((a as number) ^ (b as number));
export const u16_shl = (a: u16, n: number): u16 => as_u16((a as number) << n);
export const u16_shr = (a: u16, n: number): u16 => as_u16((a as number) >>> n);
export const u16_not = (a: u16): u16 => as_u16(~(a as number));

export const u16_rotl = (a: u16, n: number): u16 => {
  const v = a as number;
  const k = n & 15;
  return as_u16((v << k) | (v >>> (16 - k)));
};
export const u16_rotr = (a: u16, n: number): u16 => {
  const v = a as number;
  const k = n & 15;
  return as_u16((v >>> k) | (v << (16 - k)));
};

// ─── u32 ──────────────────────────────────────────────────────────────────

export const u32_add = (a: u32, b: u32): u32 => as_u32((a as number) + (b as number));
export const u32_sub = (a: u32, b: u32): u32 => as_u32((a as number) - (b as number));
export const u32_mul = (a: u32, b: u32): u32 => as_u32(Math.imul(a as number, b as number));
export const u32_and = (a: u32, b: u32): u32 => as_u32((a as number) & (b as number));
export const u32_or = (a: u32, b: u32): u32 => as_u32((a as number) | (b as number));
export const u32_xor = (a: u32, b: u32): u32 => as_u32((a as number) ^ (b as number));
export const u32_shl = (a: u32, n: number): u32 => as_u32((a as number) << n);
/** Logical shift right (zero-fill). */
export const u32_shr = (a: u32, n: number): u32 => as_u32((a as number) >>> n);
export const u32_not = (a: u32): u32 => as_u32(~(a as number));

export const u32_rotl = (a: u32, n: number): u32 => {
  const v = a as number;
  const k = n & 31;
  return as_u32((v << k) | (v >>> (32 - k)));
};
export const u32_rotr = (a: u32, n: number): u32 => {
  const v = a as number;
  const k = n & 31;
  return as_u32((v >>> k) | (v << (32 - k)));
};

// ─── i8/i16/i32 ───────────────────────────────────────────────────────────

export const i16_add = (a: i16, b: i16): i16 => as_i16((a as number) + (b as number));
export const i16_sub = (a: i16, b: i16): i16 => as_i16((a as number) - (b as number));
export const i16_mul = (a: i16, b: i16): i16 => as_i16(Math.imul(a as number, b as number));
/** Arithmetic shift right (sign-extending). */
export const i16_sar = (a: i16, n: number): i16 => as_i16((a as number) >> n);

export const i32_add = (a: i32, b: i32): i32 => as_i32((a as number) + (b as number));
export const i32_sub = (a: i32, b: i32): i32 => as_i32((a as number) - (b as number));
export const i32_mul = (a: i32, b: i32): i32 => as_i32(Math.imul(a as number, b as number));
export const i32_sar = (a: i32, n: number): i32 => as_i32((a as number) >> n);


export const u8_to_u16 = (a: u8): u16 => as_u16(a as number);
export const u16_to_u32 = (a: u16): u32 => as_u32(a as number);
export const u8_to_u32 = (a: u8): u32 => as_u32(a as number);

export const u16_hi = (a: u32): u16 => as_u16((a as number) >>> 16);
export const u16_lo = (a: u32): u16 => as_u16(a as number);
export const u8_hi = (a: u16): u8 => as_u8((a as number) >>> 8);
export const u8_lo = (a: u16): u8 => as_u8(a as number);

/** Composes a u32 from hi:lo u16. */
export const u32_pack16 = (hi: u16, lo: u16): u32 =>
  as_u32(((hi as number) << 16) | (lo as number));

/** Composes a u16 from hi:lo u8. */
export const u16_pack8 = (hi: u8, lo: u8): u16 =>
  as_u16(((hi as number) << 8) | (lo as number));

// ─── Sign extension ───────────────────────────────────────────────────────

export const sext_8_16 = (a: u8): i16 => as_i16(((a as number) << 24) >> 24);
export const sext_8_32 = (a: u8): i32 => as_i32(((a as number) << 24) >> 24);
export const sext_16_32 = (a: u16): i32 => as_i32(((a as number) << 16) >> 16);

// ─── Flag helpers (CCR of the 68010) ─────────────────────────────────────────

/**
 *  (JS bitwise would return -1, useless for unsigned comparisons). */
const umask = (bits: 8 | 16 | 32): number =>
  bits === 32 ? 0xffffffff : (1 << bits) - 1;

const uval = (n: number, bits: 8 | 16 | 32): number =>
  bits === 32 ? n >>> 0 : n & umask(bits);

/** Carry for an N-bit add. */
export const carry_add = (a: number, b: number, bits: 8 | 16 | 32): boolean => {
  return uval(a, bits) + uval(b, bits) > umask(bits);
};
/** Borrow for an N-bit sub. */
export const borrow_sub = (a: number, b: number, bits: 8 | 16 | 32): boolean => {
  return uval(a, bits) < uval(b, bits);
};
/** Overflow (signed) for an N-bit add. */
export const overflow_add = (a: number, b: number, bits: 8 | 16 | 32): boolean => {
  const sign = 1 << (bits - 1);
  const ua = uval(a, bits);
  const ub = uval(b, bits);
  const r = (ua + ub) & umask(bits) | 0;
  return ((ua ^ r) & (ub ^ r) & sign) !== 0;
};
