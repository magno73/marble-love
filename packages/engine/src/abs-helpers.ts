/**
 * abs-helpers.ts — replica `FUN_0001B5A6` + `FUN_0001B5B4`.
 *
 * Due leaf helper signed-32-bit, opposti tra loro:
 *
 * **FUN_1B5A6 absLong1B5A6** (7 instr, 6 callers): `abs(arg)`
 *
 *   move.l (0x4,SP),D0
 *   tst.l D0
 *   bge done            ; if D0 >= 0 → exit
 *   neg.l D0            ; D0 = -D0
 *   done: rts
 *
 *   Returns `|arg|` (signed 32-bit absolute value, mod 2^32).
 *
 * **FUN_1B5B4 negAbsLong1B5B4** (7 instr, 6 callers): `-abs(arg)`
 *
 *   move.l (0x4,SP),D0
 *   tst.l D0
 *   ble done            ; if D0 <= 0 → exit
 *   neg.l D0            ; D0 = -D0
 *   done: rts
 *
 *   Returns `-|arg|`. Equivalente a "negate-if-positive": se l'arg è
 *   positivo lo nega, altrimenti lo lascia. Usato dove il binario vuole
 *   un valore garantito non-positivo.
 *
 * Entrambi sono leaf puri (no side effect su workRam, no JSR), quindi
 * la replica TypeScript è una funzione matematica diretta.
 */

export const ABS_LONG_1B5A6_ADDR = 0x0001b5a6 as const;
export const NEG_ABS_LONG_1B5B4_ADDR = 0x0001b5b4 as const;

/** Sign-extend signed 32-bit di un number (clamped a int32). */
function s32(value: number): number {
  return (value | 0);
}

/**
 * Replica `FUN_0001B5A6` — `abs(arg)` signed 32-bit.
 *
 * @param arg  Long arg (signed 32-bit).
 * @returns    `|arg|`. Edge case: `0x80000000` (= INT32_MIN) → `0x80000000`
 *             (overflow, M68k `neg.l` su INT32_MIN ritorna INT32_MIN).
 */
export function absLong1B5A6(arg: number): number {
  const a = s32(arg);
  return a < 0 ? s32(-a) : a;
}

/**
 * Replica `FUN_0001B5B4` — `-abs(arg)` signed 32-bit.
 *
 * @param arg  Long arg (signed 32-bit).
 * @returns    `-|arg|`. Mirror di `absLong1B5A6`.
 */
export function negAbsLong1B5B4(arg: number): number {
  const a = s32(arg);
  return a > 0 ? s32(-a) : a;
}
