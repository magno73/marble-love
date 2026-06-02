/**
 *
 * quoziente word zero-esteso a long.
 *
 *   - long unsigned valido (0..0xFFFFFFFF typical, but in the caller marble-madness
 *     are typically in the range word/byte)
 *   - `-1` (= 0xFFFFFFFF) o `-2` (= 0xFFFFFFFE) for errors of OOR
 *
 * and for parity (the binary oracle patches FUN_40D8 entry with synthetic RTS
 * and inietta D0 manualmente).
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
 *   0x5A18  bls.b   0x5A4A                      ; if num <= 0xFFFF → both fit → divu
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
 * **Convenzione caller** (xref single @ 0x5B8E in FUN_5A5E):
 *   - D2 callee-saved (prologue/epilogue lo preservano).
 *   - Return: long unsigned in D0 (= word quoziente, range 0..0xFFFF, or 0
 *     for the path early-exit).
 *
 * **Side effects**:
 *     and then explicitly cleaned up (`addq.l #8,SP` + `addq.l #4,SP`).
 *
 * **Note of low-level fidelity**:
 *
 *   1. **`asl.l #1, D2`**: shift aritmetico left of 1 = moltiplicazione per 2
 *      to `add.l D2, D2`. Sets CCR.X, CCR.N, CCR.Z, CCR.V (V on overflow), CCR.C.
 *      wraps mod 2^32 (long arithmetic semantics). Model this as unsigned32.
 *
 *   2. **`add.l D0, D2`**: long add. Wrap mod 2^32. CCR.X/N/Z/V/C settati.
 *      The following `tst.l D2` recomputes Z on D2; it does not reuse add's CCR.
 *
 *      for the following division: `divu.w` with divisor 0 raises an interrupt,
 *      so the routine bypasses it directly to epilogue.
 *
 *   4. **`addq.l #8, SP`**: M68k documentation says `addq` on Ax/SP
 *      `cmpi.l #0xFFFF,D2; addq.l #4,SP; bhi`: the `addq #4,SP` non clobba i
 *      flag of the cmpi.
 *
 *   5. **`cmpi.l #0xFFFF, D2; bhi`**: bhi = unsigned higher = `D2 > 0xFFFF`
 *      "fits in word"). Same for `cmpi.l #0x1FFFE, ...; bhi`.
 *
 *   6. **`cmpi.l #0xFFFF, D1; bls`**: bls = unsigned lower or same = `D1 <= 0xFFFF`.
 *      check on D2: bypass to `divu` (at 0x5A4A) happens only if `D2 <= 0xFFFF`.
 *
 *   7. **Halve-loop logic**:
 *      Punto entry @ 0x5A1A:
 *        if (D2 > 0x1FFFE) → goto LSR (0x5A2C)
 *        elif (D1 > 0x1FFFE) -> fall-through:
 *          0x5A24: cmpi.l #0x1FFFE, D1
 *          0x5A2A: bls.b 0x5A3A   ; if D1 <= 0x1FFFE → branch a ROUND-half
 *          → fall-through 0x5A2C: D1 > 0x1FFFE → LSR
 *        if (D2 > 0x1FFFE OR D1 > 0x1FFFE) → LSR (both via plain shift)
 *        else (= D2 <= 0x1FFFE AND D1 <= 0x1FFFE) → ROUND-half (both via (x+1)>>1)
 *
 *        - Loop: while (D2 > 0x1FFFE OR D1 > 0x1FFFE): D2 >>= 1; D1 >>= 1
 *        - Single round: if both <= 0x1FFFE (post-shift): D2 = (D2+1)>>1; D1 = (D1+1)>>1
 *      But the caller reaches here only if initially D2 > 0xFFFF OR D1 > 0xFFFF.
 *
 *      Check: if entry-cond `D2=0x10000, D1=0x100`:
 *        @0x5A1A: D2=0x10000, 0x10000 <= 0x1FFFE → no LSR
 *                 D1=0x100, 0x100 <= 0x1FFFE → bls → ROUND
 *        @0x5A3A: D2 = 0x10001>>1 = 0x8000; D1 = 0x101>>1 = 0x80
 *        @0x5A4A: divu (both <= 0xFFFF) ✓
 *
 *      If entry-cond `D2=0x30000, D1=0x100`:
 *        @0x5A1A: 0x30000 > 0x1FFFE → LSR
 *        @0x5A2C: D2 = 0x18000; D1 = 0x80
 *        @0x5A38: bra 0x5A1A
 *        @0x5A1A: 0x18000 <= 0x1FFFE; D1=0x80 <= 0x1FFFE → ROUND
 *        @0x5A3A: D2 = 0x18001>>1 = 0xC000; D1 = 0x81>>1 = 0x40
 *        @0x5A4A: divu (0xC000 <= 0xFFFF, 0x40 <= 0xFFFF) ✓
 *
 *      If entry-cond `D2=0x100000000` (overflow long?) — N/A, F(4) signed long, but
 *
 *   8. **`mulu.w #0x3C, D0`**: D0w * 60 → long in D0. NOT va in overflow long
 *      (max 0xFFFF * 60 = 0x3BFFC4 < 2^32). Sicuro.
 *
 *   9. **`divu.w D2, D1`**: D1 (long) / D2w (word, low). Quotient → D1 low word,
 *      remainder → D1 high word. If quotient > 0xFFFF → CCR.V set (overflow,
 *      In theory possible overflow if D2 = 1: quotient = D1 (max 0x3BFFC4, > 0xFFFF).
 *
 *      Verifichiamo Musashi: `divu.w` su 68k:
 *        - if divisor == 0 -> trap (avoided here by tst.l D2).
 *
 *
 *  10. **`moveq #0,D0; move.w D1w,D0w` (post-divu)**: zero-extend of the low word
 *
 *  11. **`move.l (SP)+, D2`**: pop of 4 byte → D2 ripristinato. SP allineato.
 *
 * **Xrefs** (1 ref, 1 caller):
 *   - `0x5B8E` in FUN_5A5E — `jsr 0x000059D2.l` (UNCONDITIONAL_CALL)
 *
 */

import type { GameState } from "./state.js";

// ─── Tipi callback ─────────────────────────────────────────────────────────

/**
 * Signature of `FUN_000040D8` — config-field fetch.
 *
 *   - id == 0xD → ROM[0x1006F] sign-ext-long (long signed range -128..127)
 *   - id > 0xD  → -1 (= 0xFFFFFFFF) "out-of-range"
 *
 * For FUN_59D2 the three field ids are `3`, `4`, and `5`. The default here is
 * only for tests.
 *
 * @returns       long unsigned (D0 al rts of the callee).
 */
export type Sub59D2Inner40D8 = (state: GameState, fieldId: number) => number;

// ─── Constants ─────────────────────────────────────────────────────────────

/** Field id passed to FUN_40D8 to get F(4), denominator component. */
export const FIELD_ID_F4 = 4 as const;

/** Field id passed to FUN_40D8 to get F(3), denominator component. */
export const FIELD_ID_F3 = 3 as const;

/** Field id passed to FUN_40D8 to get F(5), base numerator. */
export const FIELD_ID_F5 = 5 as const;

/** Numerator multiplication constant (`mulu.w #0x3C, D0`). */
export const SCALE_FACTOR = 0x3c as const;

/** "Fits in word" threshold for cmpi.l #0xFFFF (direct bypass to divu). */
const WORD_MAX = 0xffff as const;

/** "Fits in 17 bits" threshold for cmpi.l #0x1FFFE (round-half vs lsr). */
const HALF_THRESHOLD = 0x1fffe as const;

// ─── Port ─────────────────────────────────────────────────────────────────

/**
 *
 *   denom = (2 * F(4) + F(3)) mod 2^32
 *   if denom == 0 → return 0
 *   num = F(5)
 *   (D2, D1) = halve-pair-until-both-fit-in-word(denom, num)
 *   return ((num_word * 60) / denom_word) & 0xFFFF (with divu.w overflow semantics)
 *
 * @param state     GameState passed to `inner40D8` for workRam dependencies.
 *
 * @returns unsigned long (D0 at rts):
 *           - 0 when `2*F(4)+F(3) == 0` (early exit)
 *
 *
 *    arithmetic operations that wrap mod 2^32. Use `>>> 0` to force that.
 *
 * 2. Il halving step `(x + 1) >> 1` modella `addq.l #1, D0; lsr.l #1, D0`.
 *
 * 3. Il halve-loop ha entry @ 0x5A1A. Re-check su D2 and D1. Fallthrough a 0x5A4A
 *    through the ROUND-half path (NOT through the LSR path, which has explicit `bra 0x5A1A`).
 *    SOLO round-half ((D2+1)>>1, (D1+1)>>1), poi divu.
 *
 *    D2 = 0xFFFF <= 0x1FFFE → no LSR. D1 = 0x10000 <= 0x1FFFE → bls → ROUND-half.
 *    D2' = 0x10000>>1 = 0x8000; D1' = 0x10001>>1 = 0x8000. Procede a divu.
 *
 *    @0x5A18: D1 > 0xFFFF → no bypass. @0x5A1A: 0x10000 <= 0x1FFFE → no LSR.
 *    @0x5A24: 0x10000 <= 0x1FFFE → ROUND-half. D2' = D1' = 0x8000. Divu OK.
 *
 *    @0x5A1A: 0x20000 > 0x1FFFE → LSR. D2' = 0x10000, D1' = 0x80. bra 0x5A1A.
 *    Re-check: 0x10000 <= 0x1FFFE; D1' = 0x80 <= 0x1FFFE → ROUND-half.
 *    D2'' = 0x10001>>1 = 0x8000; D1'' = 0x81>>1 = 0x40. Divu OK.
 *
 * 4. `divu.w D2, D1`: divisione word unsigned. Quotient in the low word of D1,
 *    remainder in the high word. If quotient > 0xFFFF → V flag, D1 unchanged.
 *    In TS: rilevamento `Math.floor(num / denomW) > 0xFFFF`.
 *
 *    (32-bit copy esatta).
 *
 *    Per overflow detection: `D1_pre_divu = (D1_post_halving & 0xFFFF) * 60`.
 *    Quotient teorico = `Math.floor(D1_pre_divu / (D2 & 0xFFFF))`. If > 0xFFFF
 *    -> V set, D1 unchanged -> low word of D1 = (D1_pre_divu) & 0xFFFF =
 *    `((D1_halved & 0xFFFF) * 60) & 0xFFFF`.
 *
 *    `D1_pre = (D1w_halved * 60) >>> 0`. If quotient overflow:
 *      - V flag set
 *      - move.w D1w → D0 = D1_pre & 0xFFFF
 *
 *
 * @example
 * // F(3)=10, F(4)=20, F(5)=30 → denom = 50, num*60 = 1800, quot = 36
 * stateSub59D2(state, (_, id) => ({3:10, 4:20, 5:30})[id] ?? 0); // → 36
 *
 * @example
 * // F(3)=0, F(4)=0 → denom = 0 → early exit
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
  //   Equivalent: bypass if both <= 0xFFFF.
  if (d2 > WORD_MAX || d1 > WORD_MAX) {
    // ─── Halve-loop @ 0x5A1A ──────────────────────────────────────────────
    // while (D2 > 0x1FFFE OR D1 > 0x1FFFE):
    //   D2 = D2 >>> 1; D1 = D1 >>> 1
    // poi UN ROUND-half: D2 = (D2+1)>>1; D1 = (D1+1)>>1
    // poi cade in divu.
    //
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
  // Pre-divu: D1 = numScaled (long). D0 also = numScaled.

  // ─── Fase 7: divu.w D2, D1 ───────────────────────────────────────────────
  // Quotient = floor(D1 / D2w). If > 0xFFFF -> V flag, D1 unchanged.
  const d2Word = d2 & 0xffff;
  //
  // direttamente. d2 != 0 garantito from the path early-exit.
  //
  let d1AfterDivu: number;
  if (d2Word === 0) {
    // Path teoricamente irraggiungibile, but per safety lo trattiamo as V-flag
    d1AfterDivu = numScaled; // D1 unchanged
  } else {
    const quotient = Math.floor(numScaled / d2Word);
    if (quotient > WORD_MAX) {
      // divu.w overflow: V flag set, D1 NOT modified -> remains = numScaled.
      d1AfterDivu = numScaled;
    } else {
      // Quotient in the low word, remainder (numScaled mod d2Word) in the high word.
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
