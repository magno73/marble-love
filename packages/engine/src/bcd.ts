/**
 * bcd.ts — replica `FUN_00003A6A` (50 byte): binary-to-BCD via double-dabble.
 *
 * Converte un long signed in 8-digit BCD packed in long. Algoritmo classico
 * "double dabble" usando ABCD instruction del 68k.
 *
 * Algoritmo:
 *   - 32 iter (D5=31, dbf decrementing)
 *   - Per iter: roxl.l #1 D4 — sposta MSB di D4 in X flag, shifta D4 sinistra
 *   - abcd D, D — 4 volte (D1, D2, D3, D0): BCD double + add X
 *   - Dopo 32 iter, D0..D3 contengono 8 cifre BCD (2 cifre per byte)
 *   - Combina: result.long = (D3 << 24) | (D0_byte << 16) | (D2 << 8) | D1
 *
 * **Pure leaf** — verificato bit-perfect.
 */

/** Esegue ABCD: same register (dest = src). Returns {result, newX}. */
function abcdSame(value: number, x: number): { result: number; newX: number } {
  const low = (value & 0x0f) + (value & 0x0f) + (x & 1);
  let lowOut = low;
  let lowCarry = 0;
  if (lowOut > 9) {
    lowOut -= 10;
    lowCarry = 1;
  }
  const high = ((value >> 4) & 0x0f) + ((value >> 4) & 0x0f) + lowCarry;
  let highOut = high;
  let newX = 0;
  if (highOut > 9) {
    highOut -= 10;
    newX = 1;
  }
  const result = ((highOut << 4) | lowOut) & 0xff;
  return { result, newX };
}

/**
 * Replica `FUN_00003A6A` — binToBcd(value) → BCD long.
 *
 * @param value Long unsigned (32-bit) input
 * @returns BCD packed long: high word = first 2 BCD bytes (D3<<8 | D0_byte),
 *          low word = (D2 << 8) | D1
 */
export function binToBcd(value: number): number {
  let d4 = value >>> 0;
  let d0 = 0, d1 = 0, d2 = 0, d3 = 0;
  let x = 0;

  // 32 iterations (D5 = 31, dbf D5 runs 32 times: 31, 30, ..., 0, -1 exits)
  for (let i = 0; i < 32; i++) {
    // roxl.l #1, D4: rotate left through X. New X = bit 31 of D4. New D4 = (D4 << 1) | old_X.
    const newXFromRoxl = (d4 >>> 31) & 1;
    d4 = (((d4 << 1) | (x & 1)) >>> 0);
    x = newXFromRoxl;

    // abcd D1, D1
    let r = abcdSame(d1, x);
    d1 = r.result;
    x = r.newX;
    // abcd D2, D2
    r = abcdSame(d2, x);
    d2 = r.result;
    x = r.newX;
    // abcd D3, D3
    r = abcdSame(d3, x);
    d3 = r.result;
    x = r.newX;
    // abcd D0, D0
    r = abcdSame(d0, x);
    d0 = r.result;
    x = r.newX;
  }

  // Final combination:
  //   asl.w #8, D0w — D0w = D0 << 8 (low word)
  //   asl.w #8, D2w — D2w = D2 << 8
  //   or.w D1w, D2w — D2w |= D1 → D2w = (D2 << 8) | D1
  //   or.w D3w, D0w — D0w |= D3 → D0w = (D0 << 8) | D3
  //   swap D0 — D0 = (D0_low << 16) | D0_high
  //   move.w D2w, D0w — D0 low word = D2w
  // Final D0 = (D0_low_after_or << 16) | D2w_value
  // Where D0_low_after_or = (D0_byte << 8) | D3_byte (treating D0 and D3 as bytes)
  const word0 = ((d0 << 8) | d3) & 0xffff;
  const word1 = ((d2 << 8) | d1) & 0xffff;
  return ((word0 << 16) | word1) >>> 0;
}
