/**
 * helper-3a54.ts — replica `FUN_00003A54` (27 istruzioni) + sub-helper
 * `FUN_00003A6A` (21 istruzioni, locale).
 *
 * **Semantica**: formatta un valore binario a 32-bit come stringa decimale
 * ASCII in memoria. Combina:
 *   1. `FUN_3A6A` (interna): conversione binary → BCD packed via double-dabble
 *      con istruzioni ABCD/ROXL del M68k.
 *   2. `FUN_3A08` (`helper3A08`): scrittura del valore BCD come stringa hex
 *      ASCII in memoria (tail-call).
 *
 * Il risultato è una stringa decimale (non esadecimale) perché `FUN_3A6A`
 * converte il binario in BCD packed prima della chiamata a `FUN_3A08`.
 *
 * **Disasm 0x3A54..0x3A69** (FUN_3A54, 5 istruzioni):
 *
 *   00003a54    move.l  ($4,SP), -(SP)   ; push arg1 (value) extra copy
 *   00003a58    jsr     $3a6a.l          ; call FUN_3A6A(value) → BCD in D0
 *   00003a5e    addq.l  #$4, SP          ; pop extra push
 *   00003a60    move.l  D0, ($4,SP)      ; arg1 = BCD result
 *   00003a64    jmp     $3a08.l          ; tail-call FUN_3A08(BCD,bufEnd,numDigits,showSpaces)
 *
 * **Disasm 0x3A6A..0x3A9A** (FUN_3A6A, 21 istruzioni):
 *
 *   00003a6a    movem.l d2-d5, -(a7)     ; salva D2/D3/D4/D5 (16 byte)
 *   00003a6e    moveq   #$1f, d5         ; D5 = 31 (loop counter: 32 iter)
 *   00003a70    move.l  ($14,a7), d4     ; D4 = value (arg @ SP+0x14 dopo movem)
 *   00003a74    clr.w   d1               ; D1.w = 0
 *   00003a76    clr.w   d2               ; D2.w = 0
 *   00003a78    clr.w   d3               ; D3.w = 0
 *   00003a7a    clr.w   d0               ; D0.w = 0
 *   00003a7c    roxl.l  #$1, d4          ; shift MSB di D4 → X flag, X → D4.bit0
 *   00003a7e    abcd.b  d1, d1           ; D1.b = BCD(D1.b + D1.b + X)
 *   00003a80    abcd.b  d2, d2           ; D2.b = BCD(D2.b + D2.b + carry)
 *   00003a82    abcd.b  d3, d3           ; D3.b = BCD(D3.b + D3.b + carry)
 *   00003a84    abcd.b  d0, d0           ; D0.b = BCD(D0.b + D0.b + carry)
 *   00003a86    dbra    d5, $3a7c        ; D5 -= 1; loop se D5 != -1
 *   00003a8a    asl.w   #$8, d0          ; D0.w <<= 8
 *   00003a8c    asl.w   #$8, d2          ; D2.w <<= 8
 *   00003a8e    or.w    d1, d2           ; D2.w |= D1.b (cifre 1-2 → D2)
 *   00003a90    or.w    d3, d0           ; D0.w |= D3.b (cifre 5-6 → D0)
 *   00003a92    swap    d0               ; scambia high/low word di D0
 *   00003a94    move.w  d2, d0           ; D0.w = D2.w
 *   00003a96    movem.l (a7)+, d2-d5     ; ripristina registri
 *   00003a9a    rts
 *
 * **Algoritmo FUN_3A6A — double-dabble BCD**:
 *
 *   D1, D2, D3, D0 sono 4 accumulatori BCD a 1 byte ciascuno (bassa word azzerata
 *   da clr.w; ABCD opera solo sul byte basso). Ogni iterazione:
 *   1. ROXL.L D4: sposta il bit MSB di D4 nel flag X (processando MSB-first).
 *   2. ABCD D1,D1: D1.b = BCD(2*D1.b + X). X_out = carry.
 *   3. ABCD D2,D2: D2.b = BCD(2*D2.b + X_in). X_out = carry.
 *   4. ABCD D3,D3: D3.b = BCD(2*D3.b + X_in). X_out = carry.
 *   5. ABCD D0,D0: D0.b = BCD(2*D0.b + X_in). X_out = carry.
 *
 *   Dopo 32 iterazioni (dbra D5 da 31 a -1):
 *   - D1.b = cifre BCD 1-2 (less significant)
 *   - D2.b = cifre BCD 3-4
 *   - D3.b = cifre BCD 5-6
 *   - D0.b = cifre BCD 7-8 (most significant)
 *
 *   Packing finale in D0 long:
 *   - D0[31:24] = D0.b (cifre 7-8)
 *   - D0[23:16] = D3.b (cifre 5-6)
 *   - D0[15:8]  = D2.b (cifre 3-4)
 *   - D0[7:0]   = D1.b (cifre 1-2)
 *
 *   Esempio: value=1234 → D0=0x00001234 (BCD packed).
 *   Esempio: value=99   → D0=0x00000099.
 *
 * **Calling convention** di FUN_3A54 (4 long args, cdecl RTL):
 *
 *   Stack al momento della JSR a FUN_3A54:
 *     SP+0x00 : return address (4 byte)
 *     SP+0x04 : arg1 = value    (long, 32-bit binary da formattare)
 *     SP+0x08 : arg2 = bufEnd   (long, indirizzo buffer)
 *     SP+0x0C : arg3 = numDigits (long, numero cifre)
 *     SP+0x10 : arg4 = showSpaces (long, flag spazi per leading zeros)
 *
 *   Il tail-call a FUN_3A08 usa gli stessi slot stack (arg1 modificato).
 *
 * **Callers** (5 JSR a 0x3A54):
 *   - `FUN_00011192` @ 0x1192
 *   - `FUN_000017D8` @ 0x17d8 (format score field)
 *   - `FUN_00001A84` @ 0x1a84 (format score display)
 *   - `FUN_00001BB0` @ 0x1bb0
 *   - `FUN_000053A8` @ 0x53a8
 *
 * Verifica bit-perfect via
 * `packages/cli/src/test-helper-3a54-parity.ts` (500/500).
 */

import type { GameState } from "./state.js";
import { helper3A08 } from "./helper-3a08.js";

// ─── Address constant (M68k absolute) ────────────────────────────────────────

/** Indirizzo assoluto M68k della funzione. */
export const HELPER_3A54_ADDR = 0x00003a54 as const;

// ─── Sub-helper: FUN_3A6A — binary-to-BCD via double-dabble ─────────────────

/**
 * Replica bit-perfect di `FUN_00003A6A` — converte un valore binario 32-bit
 * in BCD packed 8 cifre (4 byte) usando l'algoritmo double-dabble del M68k
 * con istruzioni ROXL + ABCD.
 *
 * L'algoritmo processa i 32 bit MSB-first di `value`, doppiando (con ABCD)
 * quattro accumulatori BCD a byte che rappresentano le 8 cifre decimali del
 * risultato (D1=cifre 1-2, D2=cifre 3-4, D3=cifre 5-6, D0=cifre 7-8).
 *
 * Per valori > 99_999_999 (che eccedono 8 cifre BCD), le cifre più
 * significative vengono troncate — comportamento identico al binario.
 *
 * @param value  Valore 32-bit unsigned da convertire.
 * @returns BCD packed 32-bit: nibble alto di ogni byte = decina, nibble basso = unità.
 *          Esempio: `binaryToBcd(1234) === 0x00001234`.
 *          Esempio: `binaryToBcd(99)   === 0x00000099`.
 */
function binaryToBcd(value: number): number {
  // D4 = value (32-bit unsigned, processiamo MSB-first via ROXL)
  let d4 = value >>> 0;

  // D1/D2/D3/D0: accumulatori BCD (byte basso usato; clr.w azzera low 16 bit)
  let d1b = 0; // cifre 1-2 (least significant)
  let d2b = 0; // cifre 3-4
  let d3b = 0; // cifre 5-6
  let d0b = 0; // cifre 7-8 (most significant)

  // X flag (extend flag): inizialmente 0 (clr.w non modifica X,
  // ma con d1/d2/d3/d0 = 0 e X inizialmente indefinito, il binario
  // si comporta come X=0 perché non c'è stato nessun ROXL precedente
  // nel prolog — il clr.w azzera solo il word, non X).
  // In pratica il X flag iniziale non è garantito dal calling code,
  // ma i test mostrano che l'output è corretto con X=0 iniziale.
  let x = 0;

  // dbra D5 (D5=0x1f=31): 32 iterazioni totali
  for (let iter = 0; iter < 32; iter++) {
    // roxl.l #1, d4: MSB di d4 → x, x → bit0 di d4
    const msb = (d4 >>> 31) & 1;
    d4 = ((d4 << 1) & 0xffffffff) | x;
    x = msb;

    // abcd.b d1,d1: D1.b = BCD(D1.b + D1.b + X), X = carry
    [d1b, x] = abcdByte(d1b, x);
    // abcd.b d2,d2
    [d2b, x] = abcdByte(d2b, x);
    // abcd.b d3,d3
    [d3b, x] = abcdByte(d3b, x);
    // abcd.b d0,d0
    [d0b, x] = abcdByte(d0b, x);
  }

  // Packing:
  // asl.w #8, d0: d0_word = d0b << 8
  const d0w = (d0b << 8) & 0xffff;
  // asl.w #8, d2: d2_word = d2b << 8
  const d2wShifted = (d2b << 8) & 0xffff;
  // or.w d1,d2: d2_word |= d1b
  const d2w = (d2wShifted | d1b) & 0xffff;
  // or.w d3,d0: d0_word |= d3b
  const d0wFinal = (d0w | d3b) & 0xffff;
  // swap d0: high word ↔ low word; then move.w d2,d0
  // Result D0 long = (d0wFinal << 16) | d2w
  return ((d0wFinal << 16) | d2w) >>> 0;
}

/**
 * Simula l'istruzione M68k `ABCD.B Dn,Dn` (BCD add with extend: Dn.b + Dn.b + X).
 *
 * Regole BCD (equivalenti al DAA del 6800):
 *   1. Somma binaria: s = a + a + x
 *   2. Se nibble basso > 9 (o half-carry): s += 6
 *   3. Se nibble alto > 9 (o carry): s += 0x60; carry_out = 1
 *
 * @param a  Byte BCD (0x00..0x99).
 * @param x  Flag X (0 o 1).
 * @returns  [risultato_byte, carry_out].
 */
function abcdByte(a: number, x: number): [number, number] {
  const av = a & 0xff;

  // Somma binaria: av + av + x
  const s = av + av + x;

  // Correzione nibble basso: se (nibble_basso_di_s > 9 oppure half-carry)
  // Half-carry = carry da bit3 a bit4, i.e., (nibble basso degli addendi) > 9.
  // Siccome addizioniamo av+av: nibble_basso = (av&0xF)+(av&0xF)+x.
  // Se questo > 9: half-carry.
  const loSum = (av & 0xf) + (av & 0xf) + x;
  let corrected = s;
  if (loSum > 9) {
    corrected += 6;
  }

  // Correzione nibble alto: se nibble alto di corrected > 9 (o overflow byte)
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

// ─── Main function: replica FUN_3A54 ─────────────────────────────────────────

/**
 * Replica bit-perfect di `FUN_00003A54` — formatta un valore decimale ASCII
 * in memoria.
 *
 * Converte `value` in BCD packed (via `binaryToBcd`), poi chiama `helper3A08`
 * con il BCD come nuovo "value" — producendo una stringa decimale invece che
 * esadecimale.
 *
 * @param state      GameState (passato a helper3A08 per le scritture).
 * @param value      Valore 32-bit unsigned da formattare come decimale.
 * @param bufEnd     Indirizzo 68k della fine del buffer (vedere helper3A08).
 * @param numDigits  Numero di cifre da produrre (max 8 per BCD 32-bit).
 * @param showSpaces Se 1: leading zeros → spazi (passato a helper3A08).
 *
 * @returns void. Side effect: byte scritti in memoria via helper3A08.
 */
export function helper3A54(
  state: GameState,
  value: number,
  bufEnd: number,
  numDigits: number,
  showSpaces: number,
): void {
  // move.l (4,SP),-(SP) + jsr 0x3A6A: chiama FUN_3A6A con value
  const bcd = binaryToBcd(value >>> 0);

  // move.l D0,(4,SP) + jmp 0x3A08: tail-call helper3A08 con BCD
  helper3A08(state, bcd, bufEnd, numDigits, showSpaces);
}
