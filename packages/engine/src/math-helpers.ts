/**
 * math-helpers.ts — utility aritmetiche signed long del binario.
 *
 * Funzioni leaf piccolissime (4-7 istruzioni). Versioni leggermente
 * differenti dello stesso pattern (es. due `abs` con bpl vs bge) sono
 * presenti perché compilate da ROM diverse, ma semanticamente identiche.
 *
 * **Verificate bit-perfect** vs binary tramite `cli/src/test-math-helpers-parity.ts`.
 */

// ─── absLong (FUN_1216A / FUN_1B5A6) ─────────────────────────────────────

/**
 * Replica `FUN_0001216A` (e clone bit-identico `FUN_0001B5A6`) — `abs(arg)`.
 *
 * Disassembly FUN_1216A (4 inst):
 *   move.l (0x4,SP), D0
 *   bpl.b  skip
 *   neg.l  D0
 *   skip: rts
 *
 * FUN_1B5A6 fa esattamente la stessa cosa con `tst.l + bge.b`.
 *
 * Edge case: `abs(0x80000000) = 0x80000000` (overflow del neg, M68k
 * ritorna lo stesso valore — il neg.l di `0x80000000` è `0x80000000`).
 *
 * @returns valore assoluto come long unsigned (con la quirk del minimo signed)
 */
export function absLong(value: number): number {
  // M68k neg.l (0x80000000) = 0x80000000 (overflow, ritorna se stesso).
  // In TS: -(0x80000000 | 0) = -(-2147483648) = 2147483648 → out of i32 range.
  // Per replicare: se il bit 31 è set, ritorna il valore se >= 0x80000000.
  const v = value | 0; // signed i32
  if (v >= 0) return v >>> 0;
  // v < 0. Caso speciale: minimo signed → ritorna se stesso (overflow del neg)
  if (v === -0x80000000) return 0x80000000;
  return -v >>> 0;
}

// ─── negateIfPositive (FUN_1B5B4) ────────────────────────────────────────

/**
 * Replica `FUN_0001B5B4` — `-abs(arg)`.
 *
 * Disassembly:
 *   move.l (0x4,SP), D0
 *   tst.l  D0
 *   ble.b  skip          ; if D0 <= 0: skip (signed)
 *   neg.l  D0            ; else (D0 > 0): D0 = -D0
 *   nop
 *   skip: rts
 *
 * - `arg > 0`: ritorna `-arg` (negativo)
 * - `arg <= 0`: ritorna `arg` (invariato)
 *
 * Equivalente a `-abs(arg)` per arg != INT_MIN, oppure `INT_MIN` per
 * arg == INT_MIN (il neg ovreflowa).
 */
export function negateIfPositive(value: number): number {
  const v = value | 0;
  if (v <= 0) return v >>> 0;
  return -v >>> 0;
}
