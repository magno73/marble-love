/**
 * state-sub-1eaa.ts — replica `FUN_00001EAA` (54 byte).
 *
 * Sub-function "fan-out FUN_33F4 over a contiguous run". Chiamata dal
 * caller `FUN_00001EE0` (3 call site: 0x20EC, 0x210C, 0x212A) per
 * inizializzare gruppi di celle alpha-tilemap consecutivi: ad ogni step
 * incrementa il pointer alphaRam di 4 byte (1 cella = 2 word) e lo
 * "tile id" di +1.
 *
 * **Argomenti (3 long sullo stack)**:
 *   - `arg1Long` (long): pointer alphaRam (D4, incrementato di 4 ogni iter).
 *   - `arg2Long` (long): solo low word usata; D3w = tile id base
 *     (incrementata di 1 ogni iter, **wrap a 16 bit**).
 *   - `arg3Long` (long): contatore iterazioni (D2, decrementato di 1 ogni iter,
 *     trattato come signed long: loop esegue mentre `D2 > 0`).
 *
 * **Disasm 0x1EAA..0x1EE0** (54 byte):
 *
 *   movem.l {D4,D3,D2},-(SP)         ; salva D2/D3/D4 (12 byte)
 *   move.l  (0x10,SP),D4             ; D4 = arg1 (long ptr)
 *   move.w  (0x16,SP),D3w            ; D3.w = arg2 low word
 *   move.l  (0x18,SP),D2             ; D2 = arg3 (long count)
 *   ; loop @ 0x1EBA:
 *   tst.l   D2
 *   ble.b   0x1EDA                   ; if D2 <= 0 (signed) → exit
 *     clr.l   -(SP)                  ; push 0 (long)
 *     move.w  D3w,D0w
 *     ext.l   D0                     ; D0 = sign-extend(D3w) to long
 *     move.l  D0,-(SP)               ; push (long)
 *     move.l  D4,-(SP)               ; push D4 (long ptr)
 *     jsr     0x000033F4.l           ; FUN_33F4(ptr, sext_w_l(tileId), 0)
 *     addq.l  #4,D4                  ; D4 += 4 (long, no wrap @ 32 bit usato)
 *     addq.w  #1,D3w                 ; D3.w += 1 (word, wraps a 16 bit)
 *     subq.l  #1,D2                  ; D2 -= 1
 *     lea     (0xC,SP),SP            ; pop 12 byte (3 long)
 *     bra.b   0x1EBA                 ; → loop
 *   0x1EDA: movem.l (SP)+,{D2,D3,D4}
 *           rts
 *
 * **Semantica**: dato un puntatore base, un tile id base e un count, esegue
 * `FUN_33F4(ptr + i*4, sext_w_l((tileId + i) & 0xFFFF), 0)` per
 * `i in [0..count-1]`, con `count = max(0, signed(arg3))`.
 *
 * **Edge cases**:
 *   - `arg3 <= 0` (signed): ritorna immediatamente, **nessuna chiamata**.
 *   - `arg3 > 0` molto grande: D4 (long) increment di +4 NON satura — usiamo
 *     wrap a 32 bit. Il tile id (D3w) incrementa ogni iter come WORD, quindi
 *     wrappa modulo 0x10000 (è poi sign-extended a long ad ogni call).
 *   - Return D0: il binario non setta esplicitamente D0 prima di rts. Dopo
 *     il loop `D2 == 0` (se arg3 > 0) o `D2 == arg3` (se arg3 <= 0).
 *     Tuttavia, `movem.l (SP)+,{D2,D3,D4}` ripristina D2 al valore originale
 *     **del caller**, quindi D0 al ritorno = D0 dell'ultima chiamata a FUN_33F4
 *     (se entrato in loop) o D0 originale (se loop saltato). Non documentato
 *     come return value.
 *
 * **JSR target identificato**: `FUN_000033F4` (alias `fun_33f4` nel
 * `StateSub1EAASubs`). NON è replicata qui: viene esposta via stub injection.
 *
 * Verifica bit-perfect via `cli/src/test-state-sub-1eaa-parity.ts` con
 * FUN_33F4 patched a stub-probe (record arg1/arg2 in workRam scratch).
 */

import type { GameState } from "./state.js";

/** Stub injection per la JSR a 0x33F4. */
export interface StateSub1EAASubs {
  /**
   * `FUN_33F4(ptrLong, sextWordLong, zeroLong)`. Default no-op (matching
   * `rts`). Il binario originale scrive in alphaRam alla posizione `ptr`.
   */
  fun_33f4?: (ptrLong: number, sextWordLong: number, zeroLong: number) => void;
}

/**
 * Replica bit-perfect di `FUN_00001EAA`.
 *
 * @param _state    GameState (FUN_1EAA non scrive direttamente in workRam:
 *                  ogni effetto passa per `subs.fun_33f4`).
 * @param arg1Long  long: pointer base (incrementato di 4 ogni iter).
 * @param arg2Long  long: solo low word è usata come tile id base
 *                  (incrementato di 1 mod 0x10000 ogni iter, poi
 *                  sign-extended a long per la call).
 * @param arg3Long  long: contatore signed; loop esegue mentre D2 > 0.
 * @param subs      stub injection per `fun_33f4` (default no-op).
 *
 * **Side effects**: nessuno diretto. Tutti gli effetti delegati a
 * `subs.fun_33f4`. Esegue `count = max(0, signed(arg3Long))` chiamate.
 */
export function stateSub1EAA(
  _state: GameState,
  arg1Long: number,
  arg2Long: number,
  arg3Long: number,
  subs?: StateSub1EAASubs,
): void {
  // D4 = arg1 (long, mantenuto come u32; aritmetica wrap a 32 bit).
  let d4 = arg1Long >>> 0;
  // D3.w = low word di arg2 (mantenuto in [0, 0xFFFF], wrap a 16 bit).
  let d3w = arg2Long & 0xffff;
  // D2 = arg3 long, trattato come SIGNED 32-bit per il `tst.l D2 / ble`.
  // JS: usiamo `| 0` per ottenere int32 signed dal valore u32.
  let d2 = arg3Long | 0;

  while (d2 > 0) {
    // ext.l D0: sign-extend low word D3w → signed long. Risultato in [-32768, 32767].
    const sextWordLong = (d3w << 16) >> 16;
    subs?.fun_33f4?.(d4, sextWordLong, 0);

    // addq.l #4, D4 (wrap a 32 bit)
    d4 = (d4 + 4) >>> 0;
    // addq.w #1, D3w (wrap a 16 bit)
    d3w = (d3w + 1) & 0xffff;
    // subq.l #1, D2 (signed)
    d2 = (d2 - 1) | 0;
  }
}
