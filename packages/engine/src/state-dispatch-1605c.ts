/**
 * state-dispatch-1605c.ts — replica `FUN_0001605C` (82 byte).
 *
 * Mini-dispatcher a 3 vie sul **byte @ A2+0x1A** (campo "kind" nello struct
 * di stato puntato dal caller). Tre branch validi (`0x20`, `0x21`, `0x22`),
 * tutti gli altri valori → no-op.
 *
 * **Caller noto** (1 sito, vedi `find_xrefs`):
 *   - `0x15FD8` in `FUN_00015E24`: `move.l A2,-(SP); jsr 0x1605C; addq.l #4,SP`.
 *     L'arg passato è un pointer in workRam ad uno struct con un byte
 *     "kind" @ +0x1A e i campi `(0x6e, A0)` (current ptr) + `(0x72, A0)`
 *     (base ptr) usati dal callee `FUN_160AE`.
 *
 * **Disasm 0x1605C..0x160AD** (82 byte):
 *
 *   move.l  A2,-(SP)               ; preserve A2
 *   movea.l (0x8,SP),A2            ; A2 = arg1 long (struct ptr)
 *   move.b  (0x1A,A2),D0b          ; D0.b = byte @ A2+0x1A ("kind")
 *   ext.w   D0w
 *   ext.l   D0                     ; D0 = signExt(kind) → long
 *   movea.l D0,A0                  ; A0 = signExt(kind) (signed long)
 *   cmpa.w  #0x20,A0               ; cmp A0, signExt_w_l(0x20)
 *   blt.b   0x160AA                ; if A0 < 0x20 (signed) → epilog (no-op)
 *   bgt.b   0x16076                ; if A0 > 0x20 → check 0x21/0x22
 *   bra.b   0x16086                ; A0 == 0x20 → branch_20
 * 0x16076:
 *   cmpa.w  #0x21,A0
 *   bne.b   0x1607E                ; A0 != 0x21 → check 0x22
 *   bra.b   0x160AA                ; A0 == 0x21 → epilog (no-op)
 * 0x1607E:
 *   cmpa.w  #0x22,A0
 *   bne.b   0x160AA                ; A0 != 0x22 → epilog (no-op)
 *   bra.b   0x16094                ; A0 == 0x22 → branch_22
 *
 * 0x16086:  ; branch kind == 0x20
 *   clr.l   -(SP)                  ; push 0 (long)
 *   move.l  A2,-(SP)                ; push A2 (long ptr)
 *   jsr     0x000160AE.l            ; FUN_160AE(structPtr=A2, byteIdxLong=0)
 *   addq.l  #8,SP                  ; pop 2 long
 *   bra.b   0x160AA                ; → epilog
 *
 * 0x16094:  ; branch kind == 0x22
 *   move.l  A2,-(SP)                ; push A2
 *   jsr     0x00015C46.l            ; FUN_15C46(structPtr=A2) → D0 (long)
 *   addq.l  0x4,SP                 ; pop A2
 *   move.l  D0,-(SP)                ; push D0 (long, returned from FUN_15C46)
 *   move.l  A2,-(SP)                ; push A2
 *   jsr     0x000160AE.l            ; FUN_160AE(structPtr=A2, byteIdxLong=D0)
 *   addq.l  #8,SP                  ; pop 2 long
 *
 * 0x160AA:
 *   movea.l (SP)+,A2               ; restore A2
 *   rts
 *
 * **Tabella di dispatch** (per `kindByte` letto come byte unsigned 0..0xFF,
 * poi sign-extended a long signed):
 *   - byte 0x00..0x1F (0..31)         → no-op (A0 < 0x20)
 *   - byte 0x20                        → FUN_160AE(A2, 0)
 *   - byte 0x21                        → no-op (caso esplicito)
 *   - byte 0x22                        → FUN_160AE(A2, FUN_15C46(A2))
 *   - byte 0x23..0x7F (35..127)        → no-op (cmpa fall-through)
 *   - byte 0x80..0xFF (-128..-1 signed)→ no-op (A0 < 0x20)
 *
 * **Note semantiche**:
 *   - `cmpa.w` sign-estende il byte immediato a long signed; A0 è già un
 *     long signed (proveniente da byte → ext.w → ext.l → movea.l). Quindi
 *     i confronti sono signed.
 *   - I valori `0x20..0x22` (32..34) sono positivi, quindi il signed-vs-A0
 *     funziona come un "byte == 0x20/0x21/0x22" puro per byte ≤ 0x7F. Per
 *     byte ≥ 0x80, `signExt(byte) < 0 < 0x20`, quindi blt branch → no-op.
 *
 * **JSR sub injection**: due callee esposti via `StateDispatch1605CSubs`:
 *   - `fun_15c46(structPtrLong) → number (long)` — default `() => 0`.
 *     Restituisce un long che diventa `byteIdxLong` per FUN_160AE nel
 *     branch 0x22.
 *   - `fun_160ae(structPtrLong, byteIdxLong) → void` — default no-op.
 *     Il binario originale: `A0 = (0x6e, structPtr)`, `A1 = A0 + 2`,
 *     `D0b = (0, A1, byteIdxLong.w * 1)`, `D0 = signExt(D0b)` long,
 *     `D0 = D0 * 6 + (0x72, structPtr)`, `(0x6e, structPtr) = D0`.
 *     Cioè avanza il "current ptr" @ structPtr+0x6E saltando di
 *     `signExt(stride[byteIdx]) * 6` byte rispetto a base @ structPtr+0x72.
 *
 * **Return D0**: il binario non setta D0 esplicitamente in alcun branch; D0
 * al rts è "quello rimasto" (= D0 di FUN_15C46 nel branch 0x22, = 0 lasciato
 * dal `clr.l -(SP)` nel branch 0x20 — wait no, `clr.l -(SP)` non tocca D0;
 * D0 al rts dipende dal flow). Per fedeltà non valorizziamo D0 in TS:
 * la funzione ritorna `void`. Il caller (`FUN_15E24`) ignora D0.
 *
 * Verifica bit-perfect via `cli/src/test-state-dispatch-1605c-parity.ts`.
 */

import type { GameState } from "./state.js";

/**
 * Stub injection per le 2 JSR del dispatcher.
 *
 * - `fun_15c46`: chiamato solo nel branch `kind == 0x22`. Riceve il ptr
 *   struct (A2) e ritorna un long (D0). Default `() => 0`.
 * - `fun_160ae`: chiamato nei branch `kind == 0x20` (con `byteIdxLong = 0`)
 *   e `kind == 0x22` (con `byteIdxLong = ret di fun_15c46`). Default no-op.
 */
export interface StateDispatch1605CSubs {
  /**
   * `FUN_00015C46(structPtrLong) → long`. Compute a "best match index"
   * (word, sign-extended to long) used as `byteIdxLong` per FUN_160AE.
   */
  fun_15c46?: (structPtrLong: number) => number;
  /**
   * `FUN_000160AE(structPtrLong, byteIdxLong) → void`. Avanza il "current
   * ptr" dello struct di un offset derivato dalla tabella stride.
   */
  fun_160ae?: (structPtrLong: number, byteIdxLong: number) => void;
}

/** Offset del byte "kind" nello struct (rispetto al ptr passato come arg1). */
export const KIND_BYTE_OFF = 0x1a as const;

/** Valore "kind" → fun_160ae(A2, 0). */
export const KIND_CASE_20 = 0x20 as const;
/** Valore "kind" → no-op (esplicito nel binario). */
export const KIND_CASE_21 = 0x21 as const;
/** Valore "kind" → fun_160ae(A2, fun_15c46(A2)). */
export const KIND_CASE_22 = 0x22 as const;

/** WORK RAM base assoluta M68k (per derivare offset in `state.workRam`). */
const WORK_RAM_BASE = 0x00400000;
/** Dimensione workRam (8 KB). */
const WORK_RAM_SIZE = 0x2000;

/**
 * Replica bit-perfect di `FUN_0001605C` — dispatcher a 3 vie sul byte
 * "kind" @ structPtr+0x1A.
 *
 * @param state    GameState. Letto: `workRam[structPtr - 0x400000 + 0x1A]`
 *                 se `structPtr` punta in workRam; altrimenti il byte è
 *                 considerato 0 (no-op via blt). Il binario originale
 *                 leggerebbe da memoria assoluta — la nostra replica modella
 *                 l'unico path osservato (struct in workRam).
 * @param structPtrLong  long (A2): pointer assoluto allo struct di stato.
 * @param subs     stub injection per `fun_15c46` / `fun_160ae`.
 * @returns void. Side effects esclusivamente via `subs.*`.
 *
 * **Side effects diretti**: nessuno. Tutto delegato a `subs`.
 *
 * **Sequenza chiamate per kind**:
 *   - 0x20: `subs.fun_160ae(structPtrLong, 0)`
 *   - 0x21: nessuna chiamata
 *   - 0x22: `r = subs.fun_15c46(structPtrLong)` poi
 *           `subs.fun_160ae(structPtrLong, r)`
 *   - altri valori: nessuna chiamata
 */
export function stateDispatch1605C(
  state: GameState,
  structPtrLong: number,
  subs?: StateDispatch1605CSubs,
): void {
  const a2 = structPtrLong >>> 0;

  // Read byte @ A2 + 0x1A. Modeling: if pointer is in workRam, read from
  // workRam; altrimenti il valore è 0 (cade nel ramo blt → no-op).
  // (Il binario originale leggerebbe da memoria assoluta, ma il caller
  //  reale FUN_15E24 punta sempre in workRam.)
  const kindAddr = (a2 + KIND_BYTE_OFF) >>> 0;
  let kindByte = 0;
  if (kindAddr >= WORK_RAM_BASE && kindAddr < WORK_RAM_BASE + WORK_RAM_SIZE) {
    kindByte = state.workRam[kindAddr - WORK_RAM_BASE] ?? 0;
  }

  // ext.w + ext.l: signed sign-extend del byte a long signed.
  // JS: (b << 24) >> 24 produce int32 signed.
  const a0Signed = ((kindByte & 0xff) << 24) >> 24;

  // cmpa.w #0x20,A0 — `0x20` viene sign-extended (positivo) a 0x20 long.
  // blt.b: if A0 < 0x20 (signed) → return.
  if (a0Signed < 0x20) {
    return; // ramo "byte 0..0x1F o byte 0x80..0xFF (signed negativo)"
  }

  // bgt.b 0x16076: if A0 > 0x20, fall-through al check 0x21/0x22; else
  // (A0 == 0x20) cade nel `bra.b 0x16086` → branch_20.
  if (a0Signed === 0x20) {
    // branch kind == 0x20: fun_160ae(A2, 0)
    subs?.fun_160ae?.(a2, 0);
    return;
  }

  // A0 > 0x20: check 0x21 e 0x22.
  if (a0Signed === 0x21) {
    return; // ramo no-op esplicito
  }
  if (a0Signed === 0x22) {
    // branch kind == 0x22:
    //   D0 = fun_15c46(A2)  → long
    //   fun_160ae(A2, D0)
    const ret = (subs?.fun_15c46?.(a2) ?? 0) >>> 0;
    subs?.fun_160ae?.(a2, ret);
    return;
  }

  // A0 in [0x23..0x7F]: il binario fa cmpa #0x22 → bne.b 0x160AA → epilog.
  // Equivalente a no-op.
}
