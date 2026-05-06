/**
 * state-sub-59d2.ts — replica `FUN_000059D2` (140 byte) bit-perfect.
 *
 * Calcola un "scaled rate" = `(F(5) * 60) / (2 * F(4) + F(3))` con saturazione
 * a 16 bit: prima della `divu.w`, se numeratore o denominatore non entrano in
 * un word, vengono entrambi dimezzati simultaneamente (con due varianti di
 * "halve" che dipendono dalla magnitudine corrente). Il risultato è il
 * quoziente word zero-esteso a long.
 *
 * `F(n)` = chiamata a `FUN_000040D8(n)`, una "config-field fetch" che
 * dato un id ritorna un long signed. In FUN_59D2 i tre id usati sono `3`,
 * `4`, `5`. Il valore di ritorno di `FUN_40D8` può essere:
 *   - long unsigned valido (0..0xFFFFFFFF tipico, ma nei caller marble-madness
 *     stanno tipicamente nel range word/byte)
 *   - `-1` (= 0xFFFFFFFF) o `-2` (= 0xFFFFFFFE) per errori di OOR
 *
 * In questo modulo il fetch è iniettabile via `inner40D8` per testabilità
 * e per parity (il binary oracle patcha l'entry di FUN_40D8 con RTS sintetico
 * e inietta D0 manualmente).
 *
 * **Disasm 0x59D2..0x5A5D** (140 byte / 0x8C):
 *
 *   0x59D2  move.l  D2,-(SP)                    ; preserve D2 (callee-saved)
 *   0x59D4  pea     (0x4).w
 *   0x59D8  jsr     0x40D8.l                    ; D0 = FUN_40D8(4)
 *   0x59DE  move.l  D0,D2
 *   0x59E0  asl.l   #1,D2                       ; D2 = F(4) << 1 = 2*F(4)
 *   0x59E2  pea     (0x3).w
 *   0x59E6  jsr     0x40D8.l                    ; D0 = FUN_40D8(3)
 *   0x59EC  add.l   D0,D2                       ; D2 = 2*F(4) + F(3) = denom
 *   0x59EE  tst.l   D2
 *   0x59F0  addq.l  #8,SP                       ; cleanup 2 args (4*2)
 *   0x59F2  bne.b   0x59FA                      ; if denom != 0 → continue
 *   0x59F4  moveq   #0,D0                       ; ret = 0
 *   0x59F6  bra.w   0x5A5A                      ; → epilogue
 *   0x59FA  pea     (0x5).w
 *   0x59FE  jsr     0x40D8.l                    ; D0 = FUN_40D8(5) = num
 *   0x5A04  move.l  D0,D1                       ; D1 = num
 *   0x5A06  cmpi.l  #0xFFFF,D2
 *   0x5A0C  addq.l  #4,SP                       ; cleanup 1 arg
 *   0x5A0E  bhi.w   0x5A1A                      ; if denom > 0xFFFF → loop top
 *   0x5A12  cmpi.l  #0xFFFF,D1
 *   0x5A18  bls.b   0x5A4A                      ; if num <= 0xFFFF → entrambi fit → divu
 *   0x5A1A: cmpi.l  #0x1FFFE,D2                 ; loop top
 *   0x5A20  bhi.w   0x5A2C                      ; if denom > 0x1FFFE → halve via lsr
 *   0x5A24  cmpi.l  #0x1FFFE,D1
 *   0x5A2A  bls.b   0x5A3A                      ; if num <= 0x1FFFE → halve via (x+1)>>1
 *   0x5A2C  move.l  D2,D0; lsr.l #1,D0; move.l D0,D2   ; D2 = D2 >> 1
 *   0x5A32  move.l  D1,D0; lsr.l #1,D0; move.l D0,D1   ; D1 = D1 >> 1
 *   0x5A38  bra.b   0x5A1A                      ; → loop top (re-check, no exit cond yet)
 *   0x5A3A  move.l  D2,D0; addq.l #1,D0; lsr.l #1,D0; move.l D0,D2  ; D2 = (D2+1)>>1
 *   0x5A42  move.l  D1,D0; addq.l #1,D0; lsr.l #1,D0; move.l D0,D1  ; D1 = (D1+1)>>1
 *                                              ; (fall through to 0x5A4A — exit halve loop)
 *   0x5A4A  moveq   #0,D0                       ; D0 high word = 0
 *   0x5A4C  move.w  D1w,D0w                     ; D0 = num low word zero-ext
 *   0x5A4E  mulu.w  #0x3C,D0                    ; D0 = (num & 0xFFFF) * 60 (long unsigned)
 *   0x5A52  move.l  D0,D1                       ; D1 = num*60
 *   0x5A54  divu.w  D2,D1                       ; D1 high = remainder, low = quotient
 *   0x5A56  moveq   #0,D0                       ; D0 high = 0
 *   0x5A58  move.w  D1w,D0w                     ; D0 = quotient zero-ext to long
 *   0x5A5A  move.l  (SP)+,D2                    ; restore D2
 *   0x5A5C  rts                                  ; return D0
 *
 * **Convenzione caller** (xref unico @ 0x5B8E in FUN_5A5E):
 *   - Nessun argomento esplicito (FUN_59D2 prende le sue input via FUN_40D8).
 *   - D2 callee-saved (prologue/epilogue lo preservano).
 *   - Return: long unsigned in D0 (= word quoziente, range 0..0xFFFF, oppure 0
 *     per il path early-exit).
 *
 * **Side effects**:
 *   - Diretti: nessuno. Lo stack viene usato solo per pushare arg di FUN_40D8
 *     e poi cleanato esplicitamente (`addq.l #8,SP` + `addq.l #4,SP`).
 *   - Indiretti: tutti dentro `FUN_40D8` (che dalla disasm 0x40D8.. è una pura
 *     read-only function: legge ROM @ 0x1006F, walka una tabella ROM @ 0x795A,
 *     accede a `*(0x401FFC)` come puntatore strutturato — nessuna scrittura
 *     diretta in workRam o MMIO). Quindi anche quelli sono nulli ai fini di
 *     stato osservabile dal modulo TS, modulo eventuali letture di stato.
 *
 * **Note di low-level fidelity**:
 *
 *   1. **`asl.l #1, D2`**: shift aritmetico left di 1 = moltiplicazione per 2
 *      con preservazione del segno. Per long signed, `asl.l #1` è equivalente
 *      a `add.l D2, D2`. Setta CCR.X, CCR.N, CCR.Z, CCR.V (V se overflow), CCR.C.
 *      In TS: `(d2 << 1) >>> 0` mantiene la semantica unsigned long. NB: se
 *      F(4) ha bit 31 set (improbabile per config field), il risultato è
 *      "wrap" mod 2^32 (semantica long aritmetica). Modeliamo come unsigned32.
 *
 *   2. **`add.l D0, D2`**: long add. Wrap mod 2^32. CCR.X/N/Z/V/C settati.
 *      Il `tst.l D2` successivo ricalcola Z su D2 (non riusa CCR del add).
 *
 *   3. **`tst.l D2; bne`**: branch if Z=0, cioè se D2 != 0 (long). Rilevante
 *      per la divisione successiva: `divu.w` con divisore 0 causa interrupt
 *      su 68k reale; il codice qui evita il caso scrivendo `D0 = 0` e saltando
 *      direttamente all'epilogue.
 *
 *   4. **`addq.l #8, SP`**: la documentazione M68k dice che `addq` su Ax/SP
 *      non setta i flag. Quindi il `tst.l D2` precedente NON viene clobberato
 *      dall'`addq` che sta DOPO il `tst.l` ma PRIMA del `bne`. Anche
 *      `cmpi.l #0xFFFF,D2; addq.l #4,SP; bhi`: l'`addq #4,SP` non clobba i
 *      flag del cmpi.
 *
 *   5. **`cmpi.l #0xFFFF, D2; bhi`**: bhi = unsigned higher = `D2 > 0xFFFF`
 *      strettamente. Quindi se D2 == 0xFFFF, NON branch (entra nel ramo
 *      "fits in word"). Idem per `cmpi.l #0x1FFFE, ...; bhi`.
 *
 *   6. **`cmpi.l #0xFFFF, D1; bls`**: bls = unsigned lower or same = `D1 <= 0xFFFF`.
 *      Quindi se D1 == 0xFFFF, branch (entra nel ramo "fits"). Combinato col
 *      check su D2: il bypass alla `divu` (a 0x5A4A) avviene SE `D2 <= 0xFFFF
 *      AND D1 <= 0xFFFF`. Altrimenti entra in halve-loop @ 0x5A1A.
 *
 *   7. **Halve-loop logica**:
 *      Punto entry @ 0x5A1A:
 *        if (D2 > 0x1FFFE) → goto LSR (0x5A2C)
 *        elif (D1 > 0x1FFFE) → fall-through: NO! Aspetta:
 *          0x5A24: cmpi.l #0x1FFFE, D1
 *          0x5A2A: bls.b 0x5A3A   ; if D1 <= 0x1FFFE → branch a ROUND-half
 *          → fall-through 0x5A2C: D1 > 0x1FFFE → LSR
 *      Quindi:
 *        if (D2 > 0x1FFFE OR D1 > 0x1FFFE) → LSR (entrambi via plain shift)
 *        else (= D2 <= 0x1FFFE AND D1 <= 0x1FFFE) → ROUND-half (entrambi via (x+1)>>1)
 *      Dopo LSR: bra 0x5A1A → re-check loop.
 *      Dopo ROUND-half: NESSUN bra → cade in 0x5A4A → exit halve-loop, divu.
 *
 *      Quindi la struttura logica è:
 *        - Loop: while (D2 > 0x1FFFE OR D1 > 0x1FFFE): D2 >>= 1; D1 >>= 1
 *        - Singolo round: if both <= 0x1FFFE (post-shift): D2 = (D2+1)>>1; D1 = (D1+1)>>1
 *        - Procede sempre alla `divu`
 *      Ma il caller arriva qui solo se INITIALMENTE D2 > 0xFFFF OR D1 > 0xFFFF
 *      (altrimenti bypass diretto). Quindi ALMENO un round di halving è eseguito.
 *
 *      Verifichiamo: se entry-cond `D2=0x10000, D1=0x100`:
 *        @0x5A1A: D2=0x10000, 0x10000 <= 0x1FFFE → no LSR
 *                 D1=0x100, 0x100 <= 0x1FFFE → bls → ROUND
 *        @0x5A3A: D2 = 0x10001>>1 = 0x8000; D1 = 0x101>>1 = 0x80
 *        @0x5A4A: divu (entrambi <= 0xFFFF) ✓
 *
 *      Se entry-cond `D2=0x30000, D1=0x100`:
 *        @0x5A1A: 0x30000 > 0x1FFFE → LSR
 *        @0x5A2C: D2 = 0x18000; D1 = 0x80
 *        @0x5A38: bra 0x5A1A
 *        @0x5A1A: 0x18000 <= 0x1FFFE; D1=0x80 <= 0x1FFFE → ROUND
 *        @0x5A3A: D2 = 0x18001>>1 = 0xC000; D1 = 0x81>>1 = 0x40
 *        @0x5A4A: divu (0xC000 <= 0xFFFF, 0x40 <= 0xFFFF) ✓
 *
 *      Se entry-cond `D2=0x100000000` (overflow long?) — N/A, F(4) signed long, ma
 *      `D2 = F(4) << 1` è long, il cmpi.l #0x1FFFE testa unsigned 32-bit. Se
 *      D2 = 0xFFFFFFFE (= -2 unsigned) il test bhi 0x1FFFE è TRUE → LSR.
 *      Il loop quindi termina sempre in O(log(max(D1,D2)/0xFFFF)) iterazioni.
 *
 *   8. **`mulu.w #0x3C, D0`**: D0w * 60 → long in D0. NON va in overflow long
 *      (max 0xFFFF * 60 = 0x3BFFC4 < 2^32). Sicuro.
 *
 *   9. **`divu.w D2, D1`**: D1 (long) / D2w (word, low). Quotient → D1 low word,
 *      remainder → D1 high word. Se quotient > 0xFFFF → CCR.V set (overflow,
 *      D1 invariato). Qui dopo halving: D1 ≈ (num & 0xFFFF) * 60, max ~0x3BFFC4.
 *      D2 ≥ 1 dopo halving (a meno che fosse 0 ma quel path è gestito separato).
 *      In teoria possible overflow se D2 = 1: quotient = D1 (max 0x3BFFC4, > 0xFFFF).
 *      In quel caso CCR.V set, D1 unchanged → quotient sarebbe il VECCHIO low
 *      word di D1. **Modeliamo questo caso fedelmente**.
 *
 *      Verifichiamo Musashi: `divu.w` su 68k:
 *        - se divisor == 0 → trap (qui evitato dal tst.l D2).
 *        - se quoziente > 0xFFFF → V flag set, dest unchanged. NB: dest qui è
 *          D1 long. Quindi se overflow, D1 NON viene scritto.
 *
 *      In TS: detectare `Math.floor(D1 / D2w) > 0xFFFF` e in tal caso preservare
 *      D1 invariato. Il risultato del move.w D1w,D0w usa il VECCHIO D1 low word.
 *
 *  10. **`moveq #0,D0; move.w D1w,D0w` (post-divu)**: zero-extend del low word
 *      di D1 (= quotient se no-overflow, oppure vecchio D1w se overflow) in D0.
 *      Return value finale.
 *
 *  11. **`move.l (SP)+, D2`**: pop di 4 byte → D2 ripristinato. SP allineato.
 *      D0 NON è toccato.
 *
 * **Xrefs** (1 ref, 1 caller):
 *   - `0x5B8E` in FUN_5A5E — `jsr 0x000059D2.l` (UNCONDITIONAL_CALL)
 *
 * Verifica bit-perfect via `packages/cli/src/test-state-sub-59d2-parity.ts`.
 */

import type { GameState } from "./state.js";

// ─── Tipi callback ─────────────────────────────────────────────────────────

/**
 * Signature di `FUN_000040D8` — config-field fetch.
 *
 * Dato un id (long unsigned), ritorna un long unsigned che è:
 *   - id == 0xD → ROM[0x1006F] sign-ext-long (long signed range -128..127)
 *   - id < 0xD  → byte/word lookup in tabella ROM @ 0x795A + workRam @ *0x401FFC
 *   - id > 0xD  → -1 (= 0xFFFFFFFF) "out-of-range"
 *
 * Per FUN_59D2 i tre id usati sono `3`, `4`, `5`. Il default (qui per testing)
 * ritorna 0 — semanticamente "denom = 0" → early-exit con D0 = 0.
 *
 * @param state   GameState (workRam letto dal callee).
 * @param fieldId Id del campo (long unsigned). FUN_59D2 usa solo 3, 4, 5.
 * @returns       long unsigned (D0 al rts del callee).
 */
export type Sub59D2Inner40D8 = (state: GameState, fieldId: number) => number;

// ─── Costanti ──────────────────────────────────────────────────────────────

/** Field id passato a FUN_40D8 per ottenere F(4) (componente del denominatore). */
export const FIELD_ID_F4 = 4 as const;

/** Field id passato a FUN_40D8 per ottenere F(3) (componente del denominatore). */
export const FIELD_ID_F3 = 3 as const;

/** Field id passato a FUN_40D8 per ottenere F(5) (numeratore base). */
export const FIELD_ID_F5 = 5 as const;

/** Costante di moltiplicazione del numeratore (`mulu.w #0x3C, D0`). */
export const SCALE_FACTOR = 0x3c as const;

/** Soglia "fits in word" per cmpi.l #0xFFFF (bypass diretto a divu). */
const WORD_MAX = 0xffff as const;

/** Soglia "fits in 17 bit" per cmpi.l #0x1FFFE (round-half vs lsr). */
const HALF_THRESHOLD = 0x1fffe as const;

// ─── Replica ───────────────────────────────────────────────────────────────

/**
 * Replica bit-perfect di `FUN_000059D2` — scaled-rate computation.
 *
 * Calcola:
 *   denom = (2 * F(4) + F(3)) mod 2^32
 *   if denom == 0 → return 0
 *   num = F(5)
 *   (D2, D1) = halve-pair-until-both-fit-in-word(denom, num)
 *   return ((num_word * 60) / denom_word) & 0xFFFF (con semantica divu.w overflow)
 *
 * @param state     GameState (passato a `inner40D8` per dipendenze workRam).
 * @param inner40D8 Callback per FUN_40D8. Default ritorna 0 (= denom = 0 path).
 *
 * @returns long unsigned (D0 al rts):
 *           - 0 se `2*F(4)+F(3) == 0` (early-exit)
 *           - quoziente word zero-ext (0..0xFFFF) altrimenti
 *           - in caso di divu.w overflow: low word di D1 PRE-divu (= num*60 & 0xFFFF)
 *
 * **Note di fedeltà**:
 *
 * 1. Tutti i valori sono long unsigned 32-bit. `asl.l #1` e `add.l` sono
 *    operazioni aritmetiche che wrappano mod 2^32. Usiamo `>>> 0` per forzare.
 *
 * 2. Il halving step `(x + 1) >> 1` modella `addq.l #1, D0; lsr.l #1, D0`.
 *    Questo è "round half up" (per x dispari, restituisce ceil(x/2)). Il LSR
 *    plain è "floor division" (`>> 1` per unsigned, `>>> 1` in TS).
 *
 * 3. Il halve-loop ha entry @ 0x5A1A. Re-check su D2 e D1. Fallthrough a 0x5A4A
 *    via il path ROUND-half (NON via il path LSR, che ha `bra 0x5A1A` esplicito).
 *    Quindi: il loop fa N >> 1 finché (D2 > 0x1FFFE OR D1 > 0x1FFFE), poi UN
 *    SOLO round-half ((D2+1)>>1, (D1+1)>>1), poi divu.
 *
 *    Caso edge: se entry-cond è D2 == 0xFFFF AND D1 > 0xFFFF (esempio D1 = 0x10000),
 *    allora @0x5A18 il bls fallisce (D1 > 0xFFFF), entra a 0x5A1A. Lì:
 *    D2 = 0xFFFF <= 0x1FFFE → no LSR. D1 = 0x10000 <= 0x1FFFE → bls → ROUND-half.
 *    D2' = 0x10000>>1 = 0x8000; D1' = 0x10001>>1 = 0x8000. Procede a divu.
 *
 *    Caso edge 2: D2 = 0x10000, D1 = 0x10000.
 *    @0x5A18: D1 > 0xFFFF → no bypass. @0x5A1A: 0x10000 <= 0x1FFFE → no LSR.
 *    @0x5A24: 0x10000 <= 0x1FFFE → ROUND-half. D2' = D1' = 0x8000. Divu OK.
 *
 *    Caso edge 3: D2 = 0x20000, D1 = 0x100.
 *    @0x5A1A: 0x20000 > 0x1FFFE → LSR. D2' = 0x10000, D1' = 0x80. bra 0x5A1A.
 *    Re-check: 0x10000 <= 0x1FFFE; D1' = 0x80 <= 0x1FFFE → ROUND-half.
 *    D2'' = 0x10001>>1 = 0x8000; D1'' = 0x81>>1 = 0x40. Divu OK.
 *
 * 4. `divu.w D2, D1`: divisione word unsigned. Quotient nel low word di D1,
 *    remainder nel high word. Se quotient > 0xFFFF → V flag, D1 unchanged.
 *    In TS: rilevamento `Math.floor(num / denomW) > 0xFFFF`.
 *
 *    Nota CCR.X di `mulu.w` precedente: D0 = mulu(D1w, 0x3C). Se D1w == 0 → D0 = 0.
 *    Subito dopo `move.l D0, D1`: D1 alta-word = 0. Quindi pre-divu, D1 = D0
 *    (32-bit copy esatta).
 *
 *    Per overflow detection: `D1_pre_divu = (D1_post_halving & 0xFFFF) * 60`.
 *    Quotient teorico = `Math.floor(D1_pre_divu / (D2 & 0xFFFF))`. Se > 0xFFFF
 *    → V set, D1 invariato → low word di D1 = (D1_pre_divu) & 0xFFFF =
 *    `((D1_halved & 0xFFFF) * 60) & 0xFFFF`.
 *
 *    Verifichiamo: D1 prima del divu = mulu result long. Quindi
 *    `D1_pre = (D1w_halved * 60) >>> 0`. Se quotient overflow:
 *      - V flag set
 *      - D1 invariato → rimane = D1_pre
 *      - move.w D1w → D0 = D1_pre & 0xFFFF
 *
 * 5. Il valore ritornato in caso di divisore-zero (early-exit) è 0 (D0 = 0).
 *    Il caller del binario (FUN_5A5E @ 0x5B8E) usa D0 come... TBD (analisi
 *    successiva, non rilevante per la replica).
 *
 * @example
 * // F(3)=10, F(4)=20, F(5)=30 → denom = 50, num*60 = 1800, quot = 36
 * stateSub59D2(state, (_, id) => ({3:10, 4:20, 5:30})[id] ?? 0); // → 36
 *
 * @example
 * // F(3)=0, F(4)=0 → denom = 0 → early exit
 * stateSub59D2(state, () => 0); // → 0 (anche se F(5) viene comunque non chiamato)
 */
export function stateSub59D2(
  state: GameState,
  inner40D8: Sub59D2Inner40D8 = () => 0,
): number {
  // ─── Fase 1: D2 = 2 * F(4) ──────────────────────────────────────────────
  // pea 4; jsr 40D8 → D0 = F(4); move.l D0,D2; asl.l #1,D2.
  const f4 = (inner40D8(state, FIELD_ID_F4) >>> 0) >>> 0;
  // asl.l #1, D2 = D2 * 2 (long unsigned wrap mod 2^32).
  let d2 = (f4 << 1) >>> 0;

  // ─── Fase 2: D2 += F(3) (denom) ──────────────────────────────────────────
  // pea 3; jsr 40D8 → D0 = F(3); add.l D0,D2.
  const f3 = (inner40D8(state, FIELD_ID_F3) >>> 0) >>> 0;
  d2 = (d2 + f3) >>> 0;

  // ─── Fase 3: tst.l D2; beq → ret 0 ───────────────────────────────────────
  // bne 0x59FA: se D2 != 0 continua; altrimenti D0 = 0 → epilogue.
  if (d2 === 0) {
    // moveq #0, D0; bra 0x5A5A; move.l (SP)+,D2; rts.
    return 0 >>> 0;
  }

  // ─── Fase 4: D1 = F(5) (num) ─────────────────────────────────────────────
  // pea 5; jsr 40D8 → D0 = F(5); move.l D0,D1.
  let d1 = (inner40D8(state, FIELD_ID_F5) >>> 0) >>> 0;

  // ─── Fase 5: bypass-fits-in-word vs halve-loop ───────────────────────────
  // 0x5A06: cmpi.l #0xFFFF, D2; bhi 0x5A1A
  // 0x5A12: cmpi.l #0xFFFF, D1; bls 0x5A4A
  //   → entra in halve-loop SOLO se D2 > 0xFFFF OR D1 > 0xFFFF.
  //   Equivalente: bypass se entrambi <= 0xFFFF.
  if (d2 > WORD_MAX || d1 > WORD_MAX) {
    // ─── Halve-loop @ 0x5A1A ──────────────────────────────────────────────
    // while (D2 > 0x1FFFE OR D1 > 0x1FFFE):
    //   D2 = D2 >>> 1; D1 = D1 >>> 1
    // poi UN ROUND-half: D2 = (D2+1)>>1; D1 = (D1+1)>>1
    // poi cade in divu.
    //
    // NB: il loop esegue almeno 0 iterazioni LSR (se entry-cond già <= 0x1FFFE),
    // ma esegue SEMPRE 1 round-half. Quindi minimo 1 step di halving.
    while (d2 > HALF_THRESHOLD || d1 > HALF_THRESHOLD) {
      d2 = (d2 >>> 1) >>> 0;
      d1 = (d1 >>> 1) >>> 0;
    }
    // ROUND-half (single).
    d2 = ((d2 + 1) >>> 1) >>> 0;
    d1 = ((d1 + 1) >>> 1) >>> 0;
  }

  // ─── Fase 6: D0 = (D1 & 0xFFFF) * 60; D1 = D0 (long) ─────────────────────
  // moveq #0, D0; move.w D1w,D0w; mulu.w #0x3C,D0; move.l D0,D1.
  const d1Word = d1 & 0xffff;
  const numScaled = (d1Word * SCALE_FACTOR) >>> 0;
  // Pre-divu: D1 = numScaled (long). D0 anche = numScaled.

  // ─── Fase 7: divu.w D2, D1 ───────────────────────────────────────────────
  // Quotient = floor(D1 / D2w). Se > 0xFFFF → V flag, D1 invariato.
  const d2Word = d2 & 0xffff;
  // d2Word == 0 sarebbe trap su 68k, ma il path early-exit ha già gestito
  // il caso d2 == 0 long. Tuttavia d2 long != 0 NON implica d2Word != 0:
  // dopo l'halve-loop, d2 può avere bit alti zero ma low word zero. Vediamo:
  // l'halve-loop garantisce d2 <= 0xFFFF (post-round-half). Quindi d2 == d2Word.
  // Se d2 inizialmente long != 0 ma word == 0 (es. d2 = 0x10000), entra nel
  // loop, halving una volta dopo round → d2 = 0x8000 (non zero). Mai 0.
  // Più rigoroso: post-halve d2 minimo è ceil(d2_initial / 2^k) per k passi,
  // sempre >= 1 se d2_initial >= 1.
  //
  // CASO BYPASS (d2 <= 0xFFFF, d1 <= 0xFFFF, no halve): d2 long == d2Word
  // direttamente. d2 != 0 garantito dal path early-exit.
  //
  // Quindi d2Word >= 1 sempre (d2 long != 0 e <= 0xFFFF post-halve o bypass).
  let d1AfterDivu: number;
  if (d2Word === 0) {
    // Path teoricamente irraggiungibile, ma per safety lo trattiamo come V-flag
    // (no write to D1). Sul 68k reale qui ci sarebbe un trap (#5 zero divide)
    // che NON è modellato dal nostro JS-side; il binario non finisce mai qui
    // perché d2_long != 0 e l'halve preserva non-zero per d2_long >= 1.
    d1AfterDivu = numScaled; // D1 unchanged
  } else {
    const quotient = Math.floor(numScaled / d2Word);
    if (quotient > WORD_MAX) {
      // divu.w overflow: V flag set, D1 NON modificato → resta = numScaled.
      d1AfterDivu = numScaled;
    } else {
      // Quotient nel low word, remainder (numScaled mod d2Word) nel high word.
      const remainder = numScaled - quotient * d2Word;
      d1AfterDivu = (((remainder & 0xffff) << 16) | (quotient & 0xffff)) >>> 0;
    }
  }

  // ─── Fase 8: D0 = D1 low word zero-ext ───────────────────────────────────
  // moveq #0, D0; move.w D1w, D0w.
  const d0 = d1AfterDivu & 0xffff;

  // Epilogue: move.l (SP)+, D2 (D2 restored); rts. D0 returned.
  void state; // referenced for API consistency
  return d0 >>> 0;
}
