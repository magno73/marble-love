/**
 * string-format.ts — funzioni di formattazione stringhe del binario.
 *
 * Le funzioni qui replicate sono usate dal codice HUD/score per scrivere
 * numeri formattati nell'alpha tilemap. Operano write byte-by-byte in
 * memoria.
 *
 * Verificate bit-perfect vs binary tramite `cli/src/test-string-format-parity.ts`.
 */

import type { GameState } from "./state.js";

// ─── Memory dispatch (subset coerente con bus.ts) ─────────────────────────

function writeMemoryU8(state: GameState, addr: number, value: number): void {
  const v = value & 0xff;
  if (addr >= 0x400000 && addr < 0x402000) {
    state.workRam[addr - 0x400000] = v;
  } else if (addr >= 0xa00000 && addr < 0xa02000) {
    // Playfield RAM — non rappresentata separatamente, fallback al workRam
    // (Phase 4: separare). Per ora ignored se non abbiamo PF separato.
  } else if (addr >= 0xa02000 && addr < 0xa03000) {
    state.spriteRam[addr - 0xa02000] = v;
  } else if (addr >= 0xa03000 && addr < 0xa04000) {
    // Alpha RAM — accessibile come Uint8Array (per ora condivide spriteRam)
    state.spriteRam[addr - 0xa02000] = v;
  } else if (addr >= 0xb00000 && addr < 0xb00800) {
    state.colorRam[addr - 0xb00000] = v;
  }
}

// ─── formatHex (FUN_3A08) ─────────────────────────────────────────────────

/**
 * Replica `FUN_00003A08` — formatHex(value, bufEnd, numDigits, showSpaces).
 *
 * Scrive `value` come stringa hex ASCII in memoria, **backward** a partire
 * da `bufEnd + numDigits` (null terminator). Cifre da 0..9 e A..F.
 *
 * Speciale:
 *   - Se `value == 0` e `showSpaces == 1`: leading zero diventa space (' ').
 *   - Se `value == 0` AND non special: scrive un singolo '0' come trailing.
 *
 * Disassembly:
 *   D1 = value (long, arg1 a SP+8)
 *   A0 = bufEnd (arg2 a SP+12)
 *   D0 = numDigits (arg3 a SP+16)
 *   showSpaces = (0x16, SP).w (arg4, word low di un long a SP+20)
 *
 *   A0 += D0
 *   *A0 = 0 (null terminator)
 *   if D1 == 0:
 *     *--A0 = '0'; D0 -= 1
 *   D0 -= 1
 *   if D0 < 0: goto end
 *   loop:
 *     D2 = D1 & 0xF
 *     if D2 >= 10: D2 += 7 (gap '9'+1..'A')
 *     if D1 == 0 AND showSpaces == 1: D2 = -16 (= ' '-0x30)
 *     D2 += '0'
 *     *--A0 = D2
 *     D1 >>= 4 (lsr.l)
 *     if D0 != 0: D0 -= 1, loop
 *   end: rts
 */
export function formatHex(
  state: GameState,
  value: number,
  bufEnd: number,
  numDigits: number,
  showSpaces: number,
): void {
  let d1 = value >>> 0;
  let a0 = (bufEnd + numDigits) >>> 0;
  let d0 = numDigits | 0;
  const showSp = (showSpaces & 0xffff) === 1;

  // Null terminator
  writeMemoryU8(state, a0, 0);

  // if D1 == 0: write '0' and decrement D0
  if (d1 === 0) {
    a0 = (a0 - 1) >>> 0;
    writeMemoryU8(state, a0, 0x30); // '0'
    d0 = (d0 - 1) | 0;
  }

  // D0 -= 1
  d0 = (d0 - 1) | 0;
  // if D0 < 0 (signed bmi): exit
  if (d0 < 0) return;

  // Loop dbf D0 (do-while semantics: il dbf decrementa POI testa, quindi runna
  // almeno una volta). dbf esce quando D0 raggiunge -1.
  while (true) {
    let d2 = d1 & 0xf;
    if (d2 >= 10) d2 += 7;
    if (d1 === 0 && showSp) d2 = -16;
    d2 = (d2 + 0x30) & 0xff;
    a0 = (a0 - 1) >>> 0;
    writeMemoryU8(state, a0, d2);
    d1 = d1 >>> 4;
    if (d0 === 0) break;
    d0 = (d0 - 1) | 0;
  }
}
