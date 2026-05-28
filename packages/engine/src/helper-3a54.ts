/**
 * Replica of `FUN_00003A54`, plus its local `FUN_00003A6A` helper.
 *
 * The routine formats a 32-bit binary value as decimal text by first converting
 * it to packed BCD with the 68000 ROXL/ABCD double-dabble sequence, then tail
 * calling `FUN_00003A08` to write the packed digits to memory.
 *
 * Stack contract for `FUN_00003A54`:
 *   - arg1: value, a 32-bit binary integer.
 *   - arg2: buffer end pointer.
 *   - arg3: number of digits to emit.
 *   - arg4: leading-zero display flag passed through to `FUN_00003A08`.
 *
 * Verified against `packages/cli/src/test-helper-3a54-parity.ts`.
 */

import type { GameState } from "./state.js";
import { helper3A08 } from "./helper-3a08.js";

// Address constant, using the original 68000 absolute address.

export const HELPER_3A54_ADDR = 0x00003a54 as const;

// Local sub-helper: `FUN_00003A6A`, binary-to-BCD via double dabble.

/**
 * Converts a 32-bit unsigned integer to eight packed BCD digits.
 *
 * The implementation mirrors the ROM helper: process the input MSB-first with
 * ROXL and double four one-byte BCD accumulators through ABCD. Values above
 * 99,999,999 keep the low eight decimal digits, matching the packed BCD width.
 */
function binaryToBcd(value: number): number {
  // D4 holds the 32-bit input and is rotated left through X.
  let d4 = value >>> 0;

  let d1b = 0;
  let d2b = 0;
  let d3b = 0;
  let d0b = 0;

  // X is the 68000 extend flag. The parity tests match the ROM with X=0 here.
  let x = 0;

  for (let iter = 0; iter < 32; iter++) {
    // roxl.l #1,d4: old MSB becomes X and old X enters bit 0.
    const msb = (d4 >>> 31) & 1;
    d4 = ((d4 << 1) & 0xffffffff) | x;
    x = msb;

    // abcd.b Dn,Dn: double the BCD byte and include X as carry-in.
    [d1b, x] = abcdByte(d1b, x);
    [d2b, x] = abcdByte(d2b, x);
    [d3b, x] = abcdByte(d3b, x);
    [d0b, x] = abcdByte(d0b, x);
  }

  // Pack D0/D3/D2/D1 bytes into the long returned in D0.
  const d0w = (d0b << 8) & 0xffff;
  const d2wShifted = (d2b << 8) & 0xffff;
  const d2w = (d2wShifted | d1b) & 0xffff;
  const d0wFinal = (d0w | d3b) & 0xffff;
  return ((d0wFinal << 16) | d2w) >>> 0;
}

/**
 * Simulates `ABCD.B Dn,Dn`: BCD add with extend, `Dn.b + Dn.b + X`.
 */
function abcdByte(a: number, x: number): [number, number] {
  const av = a & 0xff;

  // Binary sum before decimal correction.
  const s = av + av + x;

  const loSum = (av & 0xf) + (av & 0xf) + x;
  let corrected = s;
  if (loSum > 9) {
    corrected += 6;
  }

  let carry = 0;
  if (corrected > 0x99) {
    corrected += 0x60;
    carry = 1;
  }
  if (corrected >= 0x100) {
    carry = 1;
  }

  return [corrected & 0xff, carry];
}

// Main `FUN_00003A54` replica.

/**
 * Converts `value` to packed BCD and tail-calls `helper3A08` with the same
 * buffer contract as the original ROM routine.
 */
export function helper3A54(
  state: GameState,
  value: number,
  bufEnd: number,
  numDigits: number,
  showSpaces: number,
): void {
  const bcd = binaryToBcd(value >>> 0);

  // `move.l D0,(4,SP)` followed by `jmp 0x3A08`.
  helper3A08(state, bcd, bufEnd, numDigits, showSpaces);
}
