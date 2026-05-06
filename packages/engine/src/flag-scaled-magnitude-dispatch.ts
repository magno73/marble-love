/**
 * flag-scaled-magnitude-dispatch.ts — replica `FUN_00026196` (38 byte).
 *
 * Sub molto sottile (uno "shim"): seleziona una **magnitude long** in base
 * ad un flag byte nello struct puntato dal singolo argomento, e poi delega
 * a un sub interno (`FUN_000261BC`) passandogli `(structPtr, magnitude)`.
 *
 * **Disasm 0x26196..0x261BB** (38 byte):
 *
 *   00026196   movea.l (0x4,SP),A0          ; A0 = arg1 (struct ptr)
 *   0002619a   tst.b   (0x1a,A0)            ; flag byte @ struct+0x1A
 *   0002619e   bne.b   0x000261A8           ; bit set → big magnitude
 *   000261a0   move.l  #0x40000,D0          ; flag==0 → magnitude = 0x40000
 *   000261a6   bra.b   0x000261AE
 *   000261a8   move.l  #0x50000,D0          ; flag!=0 → magnitude = 0x50000
 *   000261ae   move.l  D0,-(SP)             ; push magnitude
 *   000261b0   move.l  A0,-(SP)             ; push struct ptr
 *   000261b2   jsr     0x000261BC.l         ; FUN_261BC(structPtr, magnitude)
 *   000261b8   addq.l  #0x8,SP              ; clean up 2 long args
 *   000261ba   rts                          ; return whatever D0 inner left
 *
 * **Convenzione caller**: il chiamante setta un long magnitude negativo a
 * `(0x8,A2)` se condizione di segno (quattro xref: 0x180b0, 0x182ac, 0x1843c
 * e in particolare `bge ... move.l #-0x50000,(0x8,A2)` davanti). Poi pusha
 * `A2` (== struct ptr) e chiama questa funzione, che NON tocca `(0x8,A2)`,
 * ma sceglie il valore `(0x40000|0x50000)` da passare al sub interno in
 * base a un flag indipendente in `(0x1A, A2)`.
 *
 * **Cosa modelliamo qui**:
 *   - lettura `flagByte = workRam[A0+0x1A]` (modulo `WORK_RAM_BASE` se A0 è
 *     un puntatore assoluto in 0x400000..0x401FFF, altrimenti l'argomento
 *     può essere passato direttamente come byte).
 *   - selezione magnitude (0x40000 vs 0x50000).
 *   - delegata via callback `inner(structPtr, magnitude) → d0` perché il
 *     sub interno (`FUN_000261BC`, ~200+ byte) appartiene a un'altra slice
 *     di replica e non vogliamo accoppiarlo qui (NO INTEGRAZIONE).
 *
 * **Side effects**: NESSUNO direttamente; il sub interno può scrivere in
 * RAM, ma ciò è opacizzato dal callback `inner`. La funzione di per sé è
 * pure: dato (flagByte, magnitude_inner_return) → return value.
 */

import type { GameState } from "./state.js";

/** Offset del flag byte nello struct passato come arg1. */
const STRUCT_FLAG_BYTE_OFF = 0x1a;

/** Magnitude restituita quando il flag byte è 0 (`bne` non preso). */
export const MAGNITUDE_FLAG_CLEAR = 0x40000 as const;

/** Magnitude restituita quando il flag byte è !=0 (`bne` preso). */
export const MAGNITUDE_FLAG_SET = 0x50000 as const;

/** Base della work RAM (0x400000..0x401FFF, 8 KB). */
const WORK_RAM_BASE = 0x400000;

/**
 * Callback che modella `FUN_000261BC`. Riceve il `structPtr` (tale e quale a
 * `A0`, identico a quello passato dal caller) e la `magnitude` long
 * selezionata da questa funzione, e ritorna il long che `FUN_000261BC`
 * lascia in `D0`.
 *
 * Nel binario originale i due argomenti vengono passati sullo stack RTL
 * (push magnitude poi push structPtr), ma qui modelliamo l'ABI a livello
 * logico: la funzione interna riceve i due valori in input.
 */
export type DispatchInner = (structPtr: number, magnitude: number) => number;

/**
 * Replica `FUN_00026196` — flag-scaled magnitude dispatch.
 *
 * @param state      GameState (per leggere `workRam[A0+0x1A]` quando
 *                   `flagByteOverride` non è specificato).
 * @param structPtr  Puntatore assoluto allo struct (tipicamente in
 *                   `0x400000..0x401FFF`). Passato verbatim a `inner`.
 * @param inner      Callback che modella `FUN_000261BC`. Vedi `DispatchInner`.
 * @param flagByteOverride  (Opzionale) byte già letto dal caller; se
 *                   presente bypassa la lettura da `state.workRam`. Utile per
 *                   test che vogliono fissare il flag senza popolare workRam.
 * @returns          Il valore ritornato da `inner` (= D0 del sub interno).
 *
 * NOTE: l'unica logica vera della funzione è la selezione della magnitude.
 * Tutto il resto (push/pop, jsr) è ABI plumbing che modelliamo come
 * chiamata diretta TS al callback.
 */
export function flagScaledMagnitudeDispatch(
  state: GameState,
  structPtr: number,
  inner: DispatchInner,
  flagByteOverride?: number,
): number {
  // Determina il flag byte. Se override disponibile, usa quello (dev tests);
  // altrimenti leggi da workRam[A0+0x1A].
  let flagByte: number;
  if (flagByteOverride !== undefined) {
    flagByte = flagByteOverride & 0xff;
  } else {
    const off = ((structPtr - WORK_RAM_BASE) >>> 0) + STRUCT_FLAG_BYTE_OFF;
    flagByte = state.workRam[off] ?? 0;
  }

  // tst.b/bne: solo zero/non-zero conta (NON il segno né il valore esatto).
  const magnitude =
    flagByte !== 0 ? MAGNITUDE_FLAG_SET : MAGNITUDE_FLAG_CLEAR;

  // jsr FUN_261BC con (structPtr, magnitude). Il valore di ritorno di
  // questo sub è ciò che FUN_00026196 lascia in D0 al `rts` finale.
  const d0 = inner(structPtr >>> 0, magnitude >>> 0);
  return d0 >>> 0;
}

/**
 * Versione "selector-only" della funzione: utile in contesti dove il caller
 * vuole sapere SOLO quale magnitude verrà passata al sub interno, senza
 * effettivamente eseguirlo (es. per logging/trace, o per implementare il
 * sub interno separatamente in caller più alti).
 *
 * Esegue solo `tst.b (0x1A,A0)` + selezione costante.
 */
export function selectMagnitude(flagByte: number): number {
  return (flagByte & 0xff) !== 0
    ? MAGNITUDE_FLAG_SET
    : MAGNITUDE_FLAG_CLEAR;
}
