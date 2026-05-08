/**
 * helper-3a08.ts — replica `FUN_00003A08` (32 istruzioni, 0x4C byte).
 *
 * **Semantica**: scrive il valore `value` come stringa esadecimale ASCII in
 * memoria, backwards a partire da `bufEnd + numDigits` (null-terminator),
 * usando `numDigits` cifre. Se `value == 0` e `showSpaces == 1`, le cifre
 * leading zero diventano ' ' (spazio).
 *
 * È la primitiva "format hex" usata da `FUN_00000FA0` (5 call site),
 * `FUN_00003D62` (3 call site), e `FUN_00003A54` (tail-call trampolino
 * per la variante decimale-via-BCD).
 *
 * **Disasm 0x3A08..0x3A53** (32 istruzioni, 0x4C byte):
 *
 *   00003a08    move.l D2,-(SP)          ; salva D2 (SP-=4)
 *   00003a0a    move.l (0x10,SP),D0      ; D0 = numDigits (arg3 @ SP+0x10)
 *   00003a0e    movea.l (0xc,SP),A0      ; A0 = bufEnd (arg2 @ SP+0xC)
 *   00003a12    adda.l D0,A0             ; A0 = bufEnd + numDigits
 *   00003a14    clr.b  (A0)              ; *A0 = 0  (null-terminator)
 *   00003a16    move.l (0x8,SP),D1       ; D1 = value (arg1 @ SP+0x8) — setta Z
 *   00003a1a    bne.b  0x00003a22        ; se value != 0: salta (non scrivere '0')
 *   00003a1c    move.b #0x30,-(A0)       ; *--A0 = '0'
 *   00003a20    subq.w 0x1,D0w           ; D0w -= 1
 *   00003a22    subq.w 0x1,D0w           ; D0w -= 1
 *   00003a24    bmi.b  0x00003a50        ; se D0w < 0 (N flag): goto fine
 *   00003a26    move.l D1,D2             ; D2 = value (copia per nibble extract)
 *   00003a28    andi.w #0xf,D2w          ; D2w = D1 & 0xF (nibble basso)
 *   00003a2c    cmpi.w #0xa,D2w          ; confronta nibble con 10
 *   00003a30    blt.b  0x00003a34        ; se nibble < 10: skip add 7
 *   00003a32    addq.w 0x7,D2w           ; D2w += 7 (gap '9'..'A': 0x41-0x3A=7)
 *   00003a34    tst.l  D1               ; testa D1 (rimasto? Z se esaurito)
 *   00003a36    bne.b  0x00003a44        ; se D1 != 0: salta (no space)
 *   00003a38    cmpi.w #0x1,(0x16,SP)    ; confronta showSpaces.w con 1
 *   00003a3e    bne.b  0x00003a44        ; se showSpaces != 1: salta
 *   00003a40    move.w #-0x10,D2w        ; D2w = -16 (= ' ' - '0' = 0x20-0x30)
 *   00003a44    addi.w #0x30,D2w         ; D2w += '0'  →  final char
 *   00003a48    move.b D2b,-(A0)         ; *--A0 = D2b
 *   00003a4a    lsr.l  #0x4,D1           ; D1 >>= 4 (logical shift right 4 bit)
 *   00003a4c    dbf    D0w,0x00003a26    ; D0w -= 1; se D0w != -1: continua loop
 *   00003a50    move.l (SP)+,D2          ; ripristina D2
 *   00003a52    rts
 *
 * **Calling convention** (cdecl, 4 long arg push RTL, D2 salvato in prolog):
 *
 *   Dopo `move.l D2,-(SP)` (SP-=4):
 *     SP+0x00 : D2 saved (4 byte)
 *     SP+0x04 : return address (4 byte)
 *     SP+0x08 : arg1 = value (long)
 *     SP+0x0C : arg2 = bufEnd (long)
 *     SP+0x10 : arg3 = numDigits (long)
 *     SP+0x14 : arg4 = showSpaces (long, word read via `(0x16,SP).w` = low word)
 *
 * **Logica bit-perfect**:
 *
 *   1. Scrive null-terminator a `bufEnd + numDigits`.
 *   2. Se `value == 0`: scrive '0' a `--A0`, decrementa D0w.
 *   3. Decrementa D0w di 1. Se D0w < 0 (bmi.b): fine.
 *   4. Loop `dbf` (D0w iterazioni + 1 iniziale):
 *      a. Estrae nibble basso di D1.
 *      b. Se nibble >= 10: aggiunge 7 (per 'A'..'F').
 *      c. Se D1 == 0 e showSpaces == 1: D2w = -16 (produrrà ' ').
 *      d. D2w += 0x30; scrive D2b a `--A0`.
 *      e. D1 >>= 4 (lsr.l #4).
 *      f. `dbf D0w`: D0w -= 1; ripete se D0w != -1.
 *
 * **Callers** (9 xref UNCONDITIONAL_CALL + 1 EXTERNAL entry):
 *   - `FUN_00000FA0` @ 0x1854, 0x1ADE, 0x1B0A, 0x1B36, 0x1C24
 *   - `FUN_00003D62` @ 0x3D82, 0x3DA6, 0x3DCA
 *   - `FUN_00003A54` @ 0x3A64 (jmp tail-call: formatDecimal trampolino)
 *
 * Verifica bit-perfect via
 * `packages/cli/src/test-helper-3a08-parity.ts` (500/500).
 */

import type { GameState } from "./state.js";

// ─── Address constant (M68k absolute) ────────────────────────────────────────

/** Indirizzo assoluto M68k della funzione. */
export const HELPER_3A08_ADDR = 0x00003a08 as const;

// ─── Internal memory helper ───────────────────────────────────────────────────

/**
 * Scrive un byte in workRam, spriteRam, alphaRam o colorRam secondo la
 * memory map 68k.
 */
function writeU8(state: GameState, addr: number, value: number): void {
  const v = value & 0xff;
  const a = addr >>> 0;
  if (a >= 0x400000 && a < 0x402000) {
    state.workRam[a - 0x400000] = v;
  } else if (a >= 0xa02000 && a < 0xa03000) {
    state.spriteRam[a - 0xa02000] = v;
  } else if (a >= 0xa03000 && a < 0xa04000) {
    state.alphaRam[a - 0xa03000] = v;
  } else if (a >= 0xb00000 && a < 0xb00800) {
    state.colorRam[a - 0xb00000] = v;
  }
}

// ─── Main function: replica FUN_3A08 ─────────────────────────────────────────

/**
 * Replica bit-perfect di `FUN_00003A08` — scrittura valore hex ASCII in
 * memoria, backwards da `bufEnd + numDigits` (incluso null-terminator).
 *
 * @param state      GameState. I byte vengono scritti in workRam (o nelle
 *                   regioni MMIO secondo la memory map).
 * @param value      Long 32-bit da formattare (argomento arg1 via stack).
 *                   Trattato come unsigned.
 * @param bufEnd     Indirizzo 68k della fine del buffer (esclusa): la funzione
 *                   scrive `numDigits+1` byte a partire da `bufEnd + numDigits`
 *                   (null-terminator) verso `bufEnd` (primo char).
 * @param numDigits  Numero di cifre da produrre (arg3). Usato come contatore
 *                   nel `dbf` loop. Deve essere >= 1 per produrre output.
 * @param showSpaces Word (low 16 bit di arg4): se 1, le cifre "leading zero"
 *                   vengono rimpiazzate con ' ' (0x20).
 *
 * @returns void. Side effect: byte scritti in memoria secondo la memory map.
 */
export function helper3A08(
  state: GameState,
  value: number,
  bufEnd: number,
  numDigits: number,
  showSpaces: number,
): void {
  // D1 = value (long unsigned)
  let d1 = value >>> 0;

  // D0 = numDigits (low word usato come contatore dbf)
  let d0w = numDigits & 0xffff;

  // A0 = bufEnd + numDigits
  let a0 = (bufEnd + d0w) >>> 0;

  // clr.b (A0) — null-terminator
  writeU8(state, a0, 0);

  // Se value == 0: scrivi '0' e decrementa D0w
  if (d1 === 0) {
    // move.b #0x30,-(A0)
    a0 = (a0 - 1) >>> 0;
    writeU8(state, a0, 0x30); // '0'
    // subq.w #1,D0w
    d0w = (d0w - 1) & 0xffff;
  }

  // subq.w #1,D0w (secondo decremento, eseguito sempre)
  d0w = (d0w - 1) & 0xffff;

  // bmi.b: branch if N flag set (d0w >= 0x8000, i.e., d0w as signed < 0)
  if (d0w >= 0x8000) return;

  // showSpaces: low word di arg4
  const showSp = (showSpaces & 0xffff) === 1;

  // Loop: dbf D0w esegue il corpo almeno una volta, poi D0w volte in più
  while (true) {
    // andi.w #0xf,D2w → nibble basso di D1
    let d2w = d1 & 0xf;

    // cmpi.w #0xa,D2w; blt → addq.w #7 se D2w >= 10
    if (d2w >= 10) {
      d2w = (d2w + 7) & 0xffff;
    }

    // tst.l D1; bne → skip space; cmpi.w #1,(0x16,SP); bne → skip
    if (d1 === 0 && showSp) {
      // move.w #-0x10,D2w  →  addi.w #0x30 → 0x20 = ' '
      d2w = (-0x10) & 0xffff;
    }

    // addi.w #0x30,D2w
    d2w = (d2w + 0x30) & 0xffff;

    // move.b D2b,-(A0)  (pre-decrement)
    a0 = (a0 - 1) >>> 0;
    writeU8(state, a0, d2w & 0xff);

    // lsr.l #4,D1  (logical shift right, unsigned)
    d1 = d1 >>> 4;

    // dbf D0w,loop: D0w -= 1; if D0w != 0xFFFF (== -1 word), continue
    if (d0w === 0) break;
    d0w = (d0w - 1) & 0xffff;
  }
}
