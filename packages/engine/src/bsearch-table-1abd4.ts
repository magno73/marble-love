/**
 * bsearch-table-1abd4.ts — replica `FUN_0001ABD4` (68 byte).
 *
 * Lookup binary-search dentro un array di word ordinato, le cui
 * estremita' (base / fine) sono a runtime negli slot long
 * `*(0x0040065A)` e `*(0x0040065E)`. Usato dallo scheduler/AI tick
 * (caller `FUN_0001AA38` @ 0x1ABBE) per convertire un offset signed
 * di 16 bit in un indice di campione (D0.w viene scritto in
 * `(-0x8,A2)` dopo il return).
 *
 * **Disasm 0x1ABD4..0x1AC18** (68 byte = 0x44):
 *
 *   0001abd4  move.l  (0x4,SP),D1            ; D1 = arg1 long (target)
 *   0001abd8  movea.l (0x0040065A).l,A0      ; A0 = lo bound (base)
 *   0001abde  movea.l (0x0040065E).l,A1      ; A1 = hi bound (end)
 *   0001abe4  move.l  A2,-(SP)               ; save A2
 *   0001abe6  movea.l A0,A2                  ; A2 = base (probe ptr)
 *   0001abe8  move.l  #0x400,D0              ; D0 = 0x400 (step iniziale)
 *   ; loop @ 0x1ABEE:
 *   0001abee  cmp.w   (A2),D1w               ; flags da D1.w - (A2).w
 *   0001abf0  bcc.b   0x1ABF6                ; D1>=(A2) unsigned → check eq
 *   0001abf2    suba.l D0,A2                 ; D1<(A2): A2 -= step
 *   0001abf4    bra.b  0x1AC06                ; → clamp + halve
 *   0001abf6  beq.b   0x1ABFC                ; D1==(A2) → return
 *   0001abf8    adda.l D0,A2                 ; D1>(A2): A2 += step
 *   0001abfa    bra.b  0x1AC06                ; → clamp + halve
 *   ; return @ 0x1ABFC:
 *   0001abfc  move.l  A2,D0                  ; D0 = A2
 *   0001abfe  sub.l   A0,D0                  ; D0 = A2 - A0 (byte offset)
 *   0001ac00  lsr.l   #1,D0                  ; D0 >>= 1 (word index)
 *   0001ac02  movea.l (SP)+,A2
 *   0001ac04  rts
 *   ; clamp + halve @ 0x1AC06:
 *   0001ac06  cmpa.l  A2,A1                  ; flags da A1 - A2
 *   0001ac08  bcc.b   0x1AC0E                ; A1>=A2 → no clamp top
 *   0001ac0a    movea.l A1,A2                ; A2 > A1 → A2 = A1
 *   0001ac0c    bra.b  0x1AC14                ; skip lower clamp
 *   0001ac0e  cmpa.l  A0,A2                  ; flags da A2 - A0
 *   0001ac10  bcc.b   0x1AC14                ; A2>=A0 → no clamp bot
 *   0001ac12    movea.l A0,A2                ; A2 < A0 → A2 = A0
 *   0001ac14  lsr.l   #1,D0                  ; step >>= 1
 *   0001ac16  bra.b   0x1ABEE                ; → loop
 *
 * **Semantica**:
 *   - Bisezione su array di word, partendo dalla base con passo 0x400 byte
 *     (= 0x200 word). Ogni iter dimezza il passo. Probe clampato a [base,
 *     end].
 *   - **Termina solo all'equality** (`beq` @ 0x1ABF6). Se il target non e'
 *     presente nel table, il binario entra in **infinite loop** (passo
 *     scende a 0, A2 non si muove piu', il confronto resta diverso).
 *     L'AI tick costruisce sempre tabelle "complete" → il caso pratico
 *     trova sempre un match. La replica TS aggiunge un **safety cap di
 *     iterazioni** per non hangare i test con dati arbitrari, ma il
 *     comportamento bit-perfect e' identico quando il match esiste.
 *
 * **Ritorno** (D0): word-index del campione = `(matchPtr - base) / 2`
 * (offset byte tra `A2` finale e `A0`, shiftato a destra di 1).
 *
 * **Confronto** `cmp.w (A2),D1w`: in Motorola syntax `cmp.w src,dst` calcola
 * `dst - src`. Qui `D1.w - (A2).w`. Le bandiere usate sono:
 *   - `bcc` (= unsigned >=) → D1.w >= (A2).w in lettura unsigned
 *   - `beq` → D1.w == (A2).w
 * Il binario tratta i word come **unsigned 16 bit** (i bcc sono scelti
 * apposta). La replica TS usa un compare unsigned 16 bit.
 *
 * **Side effects**: nessuno — la funzione e' puro lookup. Non scrive in
 * memoria, restituisce solo D0.
 *
 * **Nessuna JSR**: self-contained, no stub injection.
 *
 * **Caller** (FUN_0001AA38 @ 0x1ABBE):
 *
 *   0x1ABB6: move.l A1,D1
 *   0x1ABB8: sub.w  D6w,D1w
 *   0x1ABBA: ext.l  D1               ; D1 = sign-extended 16-bit offset
 *   0x1ABBC: move.l D1,-(SP)         ; push arg
 *   0x1ABBE: jsr    0x0001ABD4.l
 *   0x1ABC4: move.w D0w,(-0x8,A2)    ; salva word-index in slot AI
 *
 * Verifica bit-perfect via `cli/src/test-bsearch-table-1abd4-parity.ts`.
 */

import type { GameState } from "./state.js";

/** Slot long @ `0x0040065A` — pointer alla base della table (in workRam). */
export const TABLE_BASE_PTR_ABS = 0x0040065a as const;
/** Slot long @ `0x0040065E` — pointer al fine della table (in workRam). */
export const TABLE_END_PTR_ABS = 0x0040065e as const;

/** Workram base (used to map absolute addresses to `workRam` offset). */
const WORK_RAM_BASE_ADDR = 0x00400000 as const;
const WORK_RAM_SIZE = 0x2000 as const;

/** Step iniziale binary search (in byte). Halvato ad ogni iter. */
export const INITIAL_STEP_BYTES = 0x400 as const;

/**
 * Cap difensivo sul numero di iterazioni del loop di bisezione. Il binario
 * non ha questo cap (entra in infinite loop se il target non e' nel table);
 * la replica TS lo include solo per non hangare con dati arbitrari nei
 * test. In pratica il loop converge in <=12 iter (0x400 -> 1 -> 0 dopo ~10
 * shift). Manteniamo 64 come margine generoso.
 */
export const ITERATION_CAP = 64 as const;

/**
 * Stub injection placeholder. FUN_0001ABD4 non chiama JSR, quindi questa
 * interface e' vuota (mantenuta per simmetria col pattern degli altri
 * sub-replicate).
 */
export type BsearchTable1ABD4Subs = Record<string, never>;

/** Helper: legge long big-endian da `workRam` a offset. */
function readLongBE(mem: Uint8Array, off: number): number {
  const a = mem[off] ?? 0;
  const b = mem[off + 1] ?? 0;
  const c = mem[off + 2] ?? 0;
  const d = mem[off + 3] ?? 0;
  return ((a << 24) | (b << 16) | (c << 8) | d) >>> 0;
}

/** Helper: legge word big-endian unsigned (0..0xFFFF) da `workRam` a offset. */
function readWordBE(mem: Uint8Array, off: number): number {
  const a = mem[off] ?? 0;
  const b = mem[off + 1] ?? 0;
  return ((a << 8) | b) & 0xffff;
}

/**
 * Replica bit-perfect di `FUN_0001ABD4`.
 *
 * Esegue una ricerca binaria word-aligned dentro la table puntata da
 * `*(0x40065A)..*(0x40065E)`, cercando `targetLong & 0xFFFF` (unsigned
 * word). Restituisce l'indice di word del primo match trovato.
 *
 * **Argomenti**:
 *   @param state       GameState. Letti SOLO i due slot long
 *                      `[0x65A]` e `[0x65E]` e i word a partire da
 *                      `*(0x65A)`. Non scrive nulla.
 *   @param targetLong  long passato sullo stack. Solo `& 0xFFFF` viene
 *                      usato (il binario fa `cmp.w (A2),D1w`).
 *   @param _subs       placeholder (FUN_1ABD4 non ha JSR).
 *   @returns           D0 = `(matchPtr - basePtr) >>> 1` se match trovato;
 *                      se la table non contiene il target, viene
 *                      restituito l'indice del probe finale dopo
 *                      `ITERATION_CAP` iter (NB: in questo caso il binario
 *                      reale entrerebbe in infinite loop — comportamento
 *                      indefinito in TS).
 */
export function bsearchTable1ABD4(
  state: GameState,
  targetLong: number,
  _subs?: BsearchTable1ABD4Subs,
): number {
  const r = state.workRam;
  const target = targetLong & 0xffff;

  // A0 = *(0x40065A), A1 = *(0x40065E)
  const baseAbs = readLongBE(r, TABLE_BASE_PTR_ABS - WORK_RAM_BASE_ADDR);
  const endAbs = readLongBE(r, TABLE_END_PTR_ABS - WORK_RAM_BASE_ADDR);

  // Mappiamo gli indirizzi A2 (probe) come "byte offset rispetto a base"
  // anziche' come indirizzo assoluto, cosi' la lettura word va in workRam.
  // L'aritmetica long su A0/A1/A2 nel binario si comporta come modulo
  // 2^32 — usiamo `>>> 0` per replicarlo. La sub.l in 0x1ABFE produce
  // un signed long (offset-from-base) che lsr.l #1 tratta come unsigned;
  // qui modelliamo direttamente come uint32.

  let probeAbs = baseAbs >>> 0;
  let step = INITIAL_STEP_BYTES;

  for (let iter = 0; iter < ITERATION_CAP; iter++) {
    // Leggi word a probeAbs (deve essere in workRam range)
    const probeOff = (probeAbs - WORK_RAM_BASE_ADDR) >>> 0;
    const word =
      probeOff + 1 < WORK_RAM_SIZE ? readWordBE(r, probeOff) : 0;

    if (target === word) {
      // Match: D0 = (A2 - A0) >> 1 (long sub modulo 2^32 → uint).
      return ((probeAbs - baseAbs) >>> 0) >>> 1;
    }

    // Branchless: D1 < word → A2 -= step; D1 > word → A2 += step.
    if (target < word) {
      probeAbs = (probeAbs - step) >>> 0;
    } else {
      probeAbs = (probeAbs + step) >>> 0;
    }

    // Clamp (cmpa.l ... bcc):
    //   if (A1 < A2 unsigned)  A2 = A1   (clamp top)
    //   else if (A2 < A0 unsigned) A2 = A0   (clamp bot)
    // I due rami sono mutuamente esclusivi (il binario fa bra dopo il
    // primo match), che e' equivalente a "if-else if" perche' un valore
    // non puo' essere contemporaneamente > A1 e < A0 quando A0 <= A1.
    if (endAbs < probeAbs) {
      probeAbs = endAbs;
    } else if (probeAbs < baseAbs) {
      probeAbs = baseAbs;
    }

    // Halve step.
    step = step >>> 1;
  }

  // Iter cap raggiunto: il binario sarebbe in infinite loop. Restituiamo
  // comunque l'indice corrente per coerenza (NB: nei test parity questo
  // path viene evitato costruendo table contenenti il target).
  return ((probeAbs - baseAbs) >>> 0) >>> 1;
}

/** Re-export del simbolo come "FUN_0001ABD4" per cross-reference. */
export { bsearchTable1ABD4 as FUN_0001ABD4 };
