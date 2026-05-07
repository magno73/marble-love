/**
 * string-addr-check-39f0.ts — replica `FUN_0039F0` (24 byte, 0x0039F0–0x003A08).
 *
 * La funzione confronta A1 con tre indirizzi ROM fissi (0x3850, 0x385C, 0x3868)
 * e comunica il risultato tramite il flag Z del 68k (beq/bne nel chiamante).
 * In TS restituiamo il flag Z come boolean.
 *
 * Disassembly:
 *   000039f0  cmpa.l #0x3850,A1
 *   000039f6  beq.b  0x3A06        ; → rts se A1==0x3850
 *   000039f8  cmpa.l #0x385C,A1
 *   000039fe  beq.b  0x3A06        ; → rts se A1==0x385C
 *   00003a00  cmpa.l #0x3868,A1    ; Z = (A1==0x3868)
 *   00003a06  rts
 *
 * Xrefs callers: FUN_00003874 @ 0x399A, 0x39C2.
 *
 * Verificato bit-perfect vs binario tramite `cli/src/test-string-addr-check-39f0-parity.ts`.
 */

/** Tre indirizzi ROM su cui FUN_0039F0 è sensibile. */
const ADDR_A = 0x3850;
const ADDR_B = 0x385c;
const ADDR_C = 0x3868;

/**
 * Replica `FUN_0039F0`.
 *
 * @param a1 — valore del registro A1 (indirizzo a 32 bit, unsigned).
 * @returns `true` se A1 ∈ {0x3850, 0x385C, 0x3868} (Z=1), `false` altrimenti (Z=0).
 *
 * Nota: il 68k confronta con `cmpa.l` che estende il segno dell'immediato a 32 bit.
 * Gli immediati < 0x80000000 hanno estensione nulla, quindi il confronto è identico
 * a un confronto unsigned su valori < 2^31.
 */
export function isKnownStringAddr(a1: number): boolean {
  const addr = a1 >>> 0;
  if (addr === ADDR_A) return true;
  if (addr === ADDR_B) return true;
  // cmpa.l #ADDR_C,A1 — imposta Z; poi rts
  return addr === ADDR_C;
}
