/**
 * string-addr-check-39f0.ts — replica `FUN_0039F0` (24 byte, 0x0039F0–0x003A08).
 *
 * In TS we return the Z flag as a boolean.
 *
 * Disassembly:
 *   000039f0  cmpa.l #0x3850,A1
 *   000039f6  beq.b  0x3A06        ; -> rts if A1==0x3850
 *   000039f8  cmpa.l #0x385C,A1
 *   000039fe  beq.b  0x3A06        ; -> rts if A1==0x385C
 *   00003a00  cmpa.l #0x3868,A1    ; Z = (A1==0x3868)
 *   00003a06  rts
 *
 * Xrefs callers: FUN_00003874 @ 0x399A, 0x39C2.
 *
 */

const ADDR_A = 0x3850;
const ADDR_B = 0x385c;
const ADDR_C = 0x3868;

/**
 * Replica `FUN_0039F0`.
 *
 *
 */
export function isKnownStringAddr(a1: number): boolean {
  const addr = a1 >>> 0;
  if (addr === ADDR_A) return true;
  if (addr === ADDR_B) return true;
  // cmpa.l #ADDR_C,A1 - sets Z, then rts.
  return addr === ADDR_C;
}
