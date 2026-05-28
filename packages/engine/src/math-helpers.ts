/**
 * Small ROM leaf helpers where exact signed overflow behavior matters.
 */

// ─── absLong (FUN_1216A / FUN_1B5A6) ─────────────────────────────────────

/**
 * Port of `FUN_0001216A` and bit-identical clone `FUN_0001B5A6`: `abs(arg)`.
 *
 * Disassembly FUN_1216A (4 inst):
 *   move.l (0x4,SP), D0
 *   bpl.b  skip
 *   neg.l  D0
 *   skip: rts
 *
 * FUN_1B5A6 does the same thing with `tst.l + bge.b`.
 *
 * Edge case: `abs(0x80000000) = 0x80000000`; the M68K `neg.l` overflows and
 * keeps the same bit pattern.
 */
export function absLong(value: number): number {
  // In TS: -(0x80000000 | 0) = -(-2147483648) = 2147483648, out of i32 range.
  const v = value | 0; // signed i32
  if (v >= 0) return v >>> 0;
  if (v === -0x80000000) return 0x80000000;
  return -v >>> 0;
}

// ─── negateIfPositive (FUN_1B5B4) ────────────────────────────────────────

/**
 * Port of `FUN_0001B5B4`: `-abs(arg)`.
 *
 * Disassembly:
 *   move.l (0x4,SP), D0
 *   tst.l  D0
 *   ble.b  skip          ; if D0 <= 0: skip (signed)
 *   neg.l  D0            ; else (D0 > 0): D0 = -D0
 *   nop
 *   skip: rts
 *
 *
 * Equivalent to `-abs(arg)` for arg != INT_MIN, or `INT_MIN` for arg == INT_MIN
 * because `neg.l` overflows.
 */
export function negateIfPositive(value: number): number {
  const v = value | 0;
  if (v <= 0) return v >>> 0;
  return -v >>> 0;
}
