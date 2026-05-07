/**
 * trackball-clamp-flags-28468.ts — replica `FUN_00028468` (280 byte).
 *
 * Funzione "trackball clamp + flags": chiamata dal VBLANK ISR (caller @ 0xBC2)
 * via il trampolino @ 0x10042 (`jmp.l 0x28468`). Aggiorna le accumulator word
 * `*0x4006A4` (X) e `*0x4006A6` (Y) sommando il delta clampato del trackball
 * picked dell'object con `|C6|+|C7|` maggiore, applica saturazione hard a
 * ±0x40 ai valori correnti dei due accumulator (pre-step) e a ±0x18 ai valori
 * finali (post-step) con wrap-around, e ritorna un long flag-word codificando:
 *   - bit 0: `*0x4003AA` bit 0 (input "fire1" debounced stable)
 *   - bit 1: `*0x4003AA` bit 1 (input "fire2" debounced stable)
 *   - bit 12: NO wrap-around X positivo (Y NOT clamped > +0x18)
 *     [in realtà: bit 15 = NO wrap Y+, bit 14 = NO wrap Y-, bit 12 = NO wrap X+, bit 13 = NO wrap X-]
 *   - bit 13: NO wrap X negativo
 *   - bit 14: NO wrap Y negativo
 *   - bit 15: NO wrap Y positivo
 *
 * Il flag-word D5 inizia a `0xF003` (bits 0,1,12,13,14,15 set) e i bit
 * vengono ripuliti se la condizione corrispondente NON è soddisfatta.
 *
 * **Disasm 0x28468..0x2857F** (280 byte):
 *
 *   00028468  movem.l {A3 A2 D5 D4 D3 D2}, -(SP)    ; salva 24 byte
 *   0002846C  movea.l #0x4006A6, A3                 ; A3 = ptr OUT-Y word
 *   00028472  movea.l #0x4006A4, A2                 ; A2 = ptr OUT-X word
 *
 *   ; ── Pre-clamp hard a ±0x40 sui due accumulator ─────────────────────
 *   00028478  moveq   #0x40, D0
 *   0002847A  cmp.w   (A2), D0w           ; D0=0x40 vs *A2 (X word, signed)
 *   0002847C  bge.b   0x28482             ; if 0x40 >= *A2 (signed) → skip
 *   0002847E  move.w  #0x40, (A2)         ; else *A2 = 0x40 (cap upper)
 *   00028482  moveq   #0x40, D0
 *   00028484  cmp.w   (A3), D0w           ; D0=0x40 vs *A3 (Y word)
 *   00028486  bge.b   0x2848C
 *   00028488  move.w  #0x40, (A3)         ; cap upper Y
 *   0002848C  moveq   #-0x40, D0
 *   0002848E  cmp.w   (A2), D0w           ; D0=-0x40 vs *A2
 *   00028490  ble.b   0x28496             ; if -0x40 <= *A2 (signed) → skip
 *   00028492  move.w  #-0x40, (A2)        ; else *A2 = -0x40 (cap lower)
 *   00028496  moveq   #-0x40, D0
 *   00028498  cmp.w   (A3), D0w
 *   0002849A  ble.b   0x284A0
 *   0002849C  move.w  #-0x40, (A3)        ; cap lower Y
 *
 *   ; ── Init flag word + chiamate sub ──────────────────────────────────
 *   000284A0  move.w  #-0xFFD, D5w        ; D5w = 0xF003 (init flags)
 *   000284A4  jsr     0x2893C.l           ; debounceInput (legge MMIO 0xF60001)
 *   000284AA  btst.b  #0, (0x4003AA).l    ; debounced bit 0 set?
 *   000284B2  bne.b   0x284B8             ; sì → keep flag bit 0
 *   000284B4  andi.w  #-2, D5w            ; no → clear bit 0 of D5w
 *   000284B8  btst.b  #1, (0x4003AA).l
 *   000284C0  bne.b   0x284C6
 *   000284C2  andi.w  #-3, D5w            ; clear bit 1
 *   000284C6  jsr     0x1AC18.l           ; trackballInputTick (no-args)
 *   000284CC  jsr     0x180BE.l           ; pickObjLarger
 *
 *   ; ── Calcolo D1, D2 (rotated coords) ────────────────────────────────
 *   ; A = *0x4006AA (= picked obj.deltaY, sext_b)
 *   ; B = *0x4006A8 (= picked obj.deltaX, sext_b)
 *   ;
 *   ; D1 byte = byte(-sext(A)) - B  (mod 256, signed byte arith)
 *   ; D2 byte = A - B               (mod 256)
 *   ;
 *   ; (Trackball è ruotato 45° hardware; A e B sono già le 2 componenti
 *   ;  rotated: questo blocco "de-ruota" via somma/differenza per ottenere
 *   ;  i delta X/Y reali in screen-space.)
 *   000284D2  move.b  (0x4006AA).l, D0b
 *   000284D8  ext.w   D0w
 *   000284DA  ext.l   D0
 *   000284DC  neg.l   D0                  ; D0 = -sext_l(A)
 *   000284DE  move.b  D0b, D1b            ; D1b = byte(-sext_l(A)) = (-A)&0xFF
 *   000284E0  sub.b   (0x4006A8).l, D1b   ; D1b -= B
 *   000284E6  move.b  (0x4006AA).l, D2b   ; D2b = A
 *   000284EC  sub.b   (0x4006A8).l, D2b   ; D2b -= B
 *
 *   ; ── D3 = abs(D1), D4 = abs(D2) (signed-abs su byte) ────────────────
 *   000284F2  tst.b   D1b
 *   000284F4  bge.b   0x284FE             ; if D1b >= 0 → use D1
 *   000284F6  moveq   #0, D0
 *   000284F8  move.b  D1b, D0b            ; D0 = uext_l(D1b)
 *   000284FA  neg.l   D0                  ; D0 = -D1b (long-neg of unsigned)
 *   000284FC  bra.b   0x28502
 *   000284FE  moveq   #0, D0
 *   00028500  move.b  D1b, D0b
 *   00028502  move.b  D0b, D3b            ; D3b = abs8(D1b) [byte]
 *
 *   00028504  tst.b   D2b
 *   00028506  bge.b   0x28510
 *   00028508  moveq   #0, D0
 *   0002850A  move.b  D2b, D0b
 *   0002850C  neg.l   D0
 *   0002850E  bra.b   0x28514
 *   00028510  moveq   #0, D0
 *   00028512  move.b  D2b, D0b
 *   00028514  move.b  D0b, D4b            ; D4b = abs8(D2b)
 *
 *   ; ── Axis-lock: se uno è > 2× dell'altro, azzera il minore ──────────
 *   00028516  move.b  D4b, D0b
 *   00028518  lsl.b   #1, D0b             ; D0b = (2*D4b) & 0xFF (byte unsigned)
 *   0002851A  cmp.b   D0b, D3b            ; D3b vs 2*D4b
 *   0002851C  bhi.w   0x28528             ; if D3b unsigned > 2*D4b → CLEAR
 *   00028520  move.b  D3b, D0b
 *   00028522  lsl.b   #1, D0b             ; D0b = 2*D3b
 *   00028524  cmp.b   D0b, D4b
 *   00028526  bls.b   0x28532             ; if D4b unsigned <= 2*D3b → SKIP
 *   ; CLEAR_BLOCK:
 *   00028528  cmp.b   D4b, D3b
 *   0002852A  bcc.b   0x28530             ; if D3b unsigned >= D4b → clr D2
 *   0002852C  clr.b   D1b                 ; else clr D1
 *   0002852E  bra.b   0x28532
 *   00028530  clr.b   D2b
 *   ; SKIP:
 *
 *   ; ── Add D1, D2 (sext word) to *A2, *A3 ─────────────────────────────
 *   00028532  move.b  D1b, D0b
 *   00028534  ext.w   D0w
 *   00028536  add.w   D0w, (A2)           ; *A2 += sext_w(D1b)
 *   00028538  move.b  D2b, D0b
 *   0002853A  ext.w   D0w
 *   0002853C  add.w   D0w, (A3)           ; *A3 += sext_w(D2b)
 *
 *   ; ── Post-step wrap a ±0x18, clearing flag bit on overflow ──────────
 *   0002853E  moveq   #0x18, D0
 *   00028540  cmp.w   (A3), D0w
 *   00028542  bge.b   0x2854C             ; if 0x18 >= *A3 → skip (no wrap)
 *   00028544  subi.w  #0x18, (A3)         ; else *A3 -= 0x18
 *   00028548  andi.w  #0x7FFF, D5w        ; clear bit 15 (Y+ wrap)
 *   0002854C  moveq   #-0x18, D0
 *   0002854E  cmp.w   (A3), D0w
 *   00028550  ble.b   0x2855A
 *   00028552  addi.w  #0x18, (A3)
 *   00028556  andi.w  #-0x4001, D5w       ; clear bit 14 (Y- wrap)
 *   0002855A  moveq   #0x18, D0
 *   0002855C  cmp.w   (A2), D0w
 *   0002855E  bge.b   0x28568
 *   00028560  subi.w  #0x18, (A2)
 *   00028564  andi.w  #-0x1001, D5w       ; clear bit 12 (X+ wrap)
 *   00028568  moveq   #-0x18, D0
 *   0002856A  cmp.w   (A2), D0w
 *   0002856C  ble.b   0x28576
 *   0002856E  addi.w  #0x18, (A2)
 *   00028572  andi.w  #-0x2001, D5w       ; clear bit 13 (X- wrap)
 *
 *   ; ── Return D5w sign-extended in D0 ─────────────────────────────────
 *   00028576  move.w  D5w, D0w
 *   00028578  ext.l   D0                  ; sign-ext D0w → D0
 *   0002857A  movem.l (SP)+, {D2 D3 D4 D5 A2 A3}
 *   0002857E  rts
 *
 * **Caller** (xref):
 *   - `0x00000BC2` (VBLANK ISR): `jsr 0x10042` → trampolino → `FUN_28468`.
 *     Il caller fa `not.w D0w; andi.w #0xF002, D0w; or.w D0w, *0x400000`,
 *     cioè estrae bits 1, 12, 13, 14, 15 INVERTITI (= "input ATTIVO" o
 *     "wrap AVVENUTO") e li mette nel global control word @ 0x400000.
 *
 * **Ordine delle scritture in workRam** (importante per parità byte-by-byte):
 *   1. *0x4006A4 / *0x4006A6 saturate ±0x40 (X poi Y, cap upper poi lower)
 *   2. FUN_2893C scrive *0x4003A8/AA/AC (debounce)
 *   3. FUN_1AC18 scrive obj0 e obj1 trackball+delta (4 byte ciascuno)
 *   4. FUN_180BE scrive *0x4006AA / *0x4006A8 (picked obj C6/C7)
 *   5. *0x4006A4 += sext_w(D1b), *0x4006A6 += sext_w(D2b)
 *   6. *0x4006A6 wrap ±0x18, *0x4006A4 wrap ±0x18
 *
 * **Side effects diretti del modulo TS (esclusi quelli delle 3 sub)**:
 *   - state.workRam[0x6A4..0x6A5] mutato (X accumulator word)
 *   - state.workRam[0x6A6..0x6A7] mutato (Y accumulator word)
 *
 * **Verifica bit-perfect** via
 * `packages/cli/src/test-trackball-clamp-flags-28468-parity.ts`.
 */

import type { GameState } from "./state.js";
import { debounceInput } from "./game-main-gate.js";
import { trackballInputTick } from "./trackball-input.js";
import { pickObjLarger } from "./obj-pick-larger.js";

// ─── Address constants (workRam offsets relativi a 0x400000) ─────────────

/** Offset binario della funzione (per cross-reference). */
export const FUN_28468_ADDR = 0x00028468 as const;

/** Word offset accumulator X @ 0x4006A4. */
export const ACCUM_X_OFF = 0x6a4 as const;

/** Word offset accumulator Y @ 0x4006A6. */
export const ACCUM_Y_OFF = 0x6a6 as const;

/** Byte offset picked-delta-X @ 0x4006A8 (scritto da FUN_180BE = pickObjLarger). */
export const PICKED_DELTA_X_OFF = 0x6a8 as const;

/** Byte offset picked-delta-Y @ 0x4006AA (scritto da FUN_180BE). */
export const PICKED_DELTA_Y_OFF = 0x6aa as const;

/** Offset byte debounced input flags @ 0x4003AA (letto da FUN_2893C). */
export const DEBOUNCED_INPUT_OFF = 0x3aa as const;

/** Pre-clamp hard saturation (signed word) sui accumulator: ±0x40. */
export const PRE_CLAMP_LIMIT = 0x40 as const;

/** Post-step wrap threshold (signed word) sui accumulator: ±0x18. */
export const POST_WRAP_LIMIT = 0x18 as const;

/** Initial flag word D5w = 0xF003 (bits 0, 1, 12, 13, 14, 15). */
export const INITIAL_FLAGS = 0xf003 as const;

/** Mask AND `andi.w #-2` per clear bit 0 (input bit 0 NOT debounced). */
export const FLAG_MASK_CLEAR_INPUT0 = 0xfffe as const;

/** Mask AND `andi.w #-3` per clear bit 1 (input bit 1 NOT debounced). */
export const FLAG_MASK_CLEAR_INPUT1 = 0xfffd as const;

/** Mask AND `andi.w #0x7FFF` per clear bit 15 (Y+ wrap). */
export const FLAG_MASK_CLEAR_YPOS_WRAP = 0x7fff as const;

/** Mask AND `andi.w #-0x4001` per clear bit 14 (Y- wrap). */
export const FLAG_MASK_CLEAR_YNEG_WRAP = 0xbfff as const;

/** Mask AND `andi.w #-0x1001` per clear bit 12 (X+ wrap). */
export const FLAG_MASK_CLEAR_XPOS_WRAP = 0xefff as const;

/** Mask AND `andi.w #-0x2001` per clear bit 13 (X- wrap). */
export const FLAG_MASK_CLEAR_XNEG_WRAP = 0xdfff as const;

// ─── Helpers ─────────────────────────────────────────────────────────────

/** Read signed word big-endian da state.workRam @ off. */
function readSignedWord(state: GameState, off: number): number {
  const r = state.workRam;
  const w = (((r[off] ?? 0) << 8) | (r[off + 1] ?? 0)) & 0xffff;
  return w & 0x8000 ? w - 0x10000 : w;
}

/** Write word (low 16 bit, big-endian) in state.workRam @ off. */
function writeWord(state: GameState, off: number, value: number): void {
  const v = value & 0xffff;
  state.workRam[off] = (v >>> 8) & 0xff;
  state.workRam[off + 1] = v & 0xff;
}

/** Sign-extend byte (low 8 bit) → i32 signed. */
function sext8(b: number): number {
  return ((b & 0xff) << 24) >> 24;
}

/** Sign-extend word (low 16 bit) → i32 signed. */
function sext16(w: number): number {
  return ((w & 0xffff) << 16) >> 16;
}

/**
 * Pre-clamp hard saturation di un singolo accumulator word a ±limit.
 *
 * Replica il pattern (eseguito 4 volte nel binario):
 *   moveq #limit, D0; cmp.w (Ax), D0w; bge skip; move.w #limit, (Ax)
 *   moveq #-limit, D0; cmp.w (Ax), D0w; ble skip; move.w #-limit, (Ax)
 *
 * NB: nel binario le 4 operazioni sono sequenziali (cap upper X, cap upper Y,
 * cap lower X, cap lower Y) e poi le X-Y a coppia. L'ordine delle scritture
 * è observable solo se si guarda step-by-step; il risultato finale per ogni
 * word è lo stesso applicando cap upper + cap lower in qualsiasi ordine.
 */
function preClampWord(state: GameState, off: number, limit: number): void {
  let v = readSignedWord(state, off);
  if (v > limit) v = limit;
  if (v < -limit) v = -limit;
  writeWord(state, off, v);
}

// ─── Funzione principale ────────────────────────────────────────────────

export interface TrackballClampFlags28468Inputs {
  /** Byte MMIO @ 0xF60001 — passato a debounceInput (FUN_2893C). */
  mmioInputByte: number;
  /** Byte MMIO trackball X player 1 @ 0xF20001 — passato a trackballInputTick. */
  p1X: number;
  /** Byte MMIO trackball Y player 1 @ 0xF20003. */
  p1Y: number;
  /** Byte MMIO trackball X player 2 @ 0xF20005. */
  p2X: number;
  /** Byte MMIO trackball Y player 2 @ 0xF20007. */
  p2Y: number;
}

/**
 * Replica bit-perfect di `FUN_00028468`.
 *
 * Esegue (in ordine):
 *   1. Pre-clamp hard ±0x40 su *0x4006A4 e *0x4006A6 (X poi Y).
 *   2. Init D5w = 0xF003.
 *   3. debounceInput(state, mmioInputByte) → aggiorna *0x4003A8/AA/AC.
 *   4. Clear D5w bit 0 se *0x4003AA bit 0 NOT set.
 *   5. Clear D5w bit 1 se *0x4003AA bit 1 NOT set.
 *   6. trackballInputTick(state, p1X, p1Y, p2X, p2Y) → aggiorna obj0/obj1
 *      delta X/Y bytes.
 *   7. pickObjLarger(state) → scrive *0x4006A8 e *0x4006AA dal picked obj.
 *   8. Calcola D1b = (-A) - B, D2b = A - B (con A=*0x6AA, B=*0x6A8 byte signed).
 *   9. Calcola D3 = abs8(D1), D4 = abs8(D2) byte unsigned.
 *  10. Axis-lock: se max(D3,D4) > 2*min(D3,D4) → clear minore (D1 o D2).
 *  11. *0x4006A4 += sext_w(D1b); *0x4006A6 += sext_w(D2b).
 *  12. Post-step wrap ±0x18: per ognuno dei 4 lati (Y+, Y-, X+, X-),
 *      se overflow, sottrai/aggiungi 0x18 e clear corrispondente bit
 *      del D5w (15, 14, 12, 13 rispettivamente).
 *  13. Ritorna sext_l(D5w).
 *
 * @param state GameState (workRam mutato).
 * @param inputs Bag con i 5 byte MMIO (1 input + 4 trackball).
 * @returns long signed (sext di D5w finale) — il caller usa i bit 1, 12-15.
 */
export function trackballClampFlags28468(
  state: GameState,
  inputs: TrackballClampFlags28468Inputs,
): number {
  // ─── Step 1: Pre-clamp hard ±0x40 ─────────────────────────────────────
  // L'ordine binario è: cap upper X, cap upper Y, cap lower X, cap lower Y.
  // Ma l'effetto finale per ciascun word è equivalente a "clamp [-0x40, 0x40]".
  // preClampWord applica entrambi cap consecutivamente per ogni word.
  preClampWord(state, ACCUM_X_OFF, PRE_CLAMP_LIMIT);
  preClampWord(state, ACCUM_Y_OFF, PRE_CLAMP_LIMIT);

  // ─── Step 2-3: Init flags + debounce ──────────────────────────────────
  let flags = INITIAL_FLAGS;
  debounceInput(state, inputs.mmioInputByte);

  // ─── Step 4-5: Clear flag bits 0/1 se input non debounced ─────────────
  const debounced = state.workRam[DEBOUNCED_INPUT_OFF] ?? 0;
  if ((debounced & 0x01) === 0) flags &= FLAG_MASK_CLEAR_INPUT0;
  if ((debounced & 0x02) === 0) flags &= FLAG_MASK_CLEAR_INPUT1;

  // ─── Step 6: trackballInputTick ───────────────────────────────────────
  trackballInputTick(state, inputs.p1X, inputs.p1Y, inputs.p2X, inputs.p2Y);

  // ─── Step 7: pickObjLarger → scrive *0x6A8 e *0x6AA ───────────────────
  pickObjLarger(state);

  // ─── Step 8: Calcola D1b, D2b (rotated → screen-space deltas) ─────────
  // A = *0x4006AA (sext_b), B = *0x4006A8 (sext_b).
  // Il binario fa:
  //   D0 = sext_l(A); D0 = -D0; D1b = D0b; D1b -= B (byte signed sub)
  //   D2b = A; D2b -= B
  // In TS: usiamo byte arith mod 256 mantenendo sign-extension fedele.
  const A_byte = (state.workRam[PICKED_DELTA_Y_OFF] ?? 0) & 0xff;
  const B_byte = (state.workRam[PICKED_DELTA_X_OFF] ?? 0) & 0xff;

  // D1b = byte( -sext_l(A) ) = (-A) & 0xFF (per via dell'overflow byte).
  // Poi D1b -= B (mod 256).
  const negA_byte = (-sext8(A_byte)) & 0xff;
  const D1_byte = (negA_byte - B_byte) & 0xff;
  const D2_byte = (A_byte - B_byte) & 0xff;

  // ─── Step 9: D3 = abs8(D1), D4 = abs8(D2) (byte unsigned) ─────────────
  // Il binario: tst.b D1b; bge → D0=D1b zero-extended; else D0=neg.l(D1b).
  // Risultato: byte assoluto di un signed byte.
  // - se D1b >= 0 (signed): D3 = D1b (0..127)
  // - se D1b <  0 (signed): D3 = (-D1b)&0xFF = (256 - D1b)&0xFF
  //   Ma neg.l su long(D1b zero-ext) = -D1b (long), poi byte = -D1b & 0xFF.
  //   Per D1b in [-128, -1] (sext range), |D1b| in [1, 128].
  //   Esempi: D1b = 0x80 (=-128), D3 = (-128)&0xFF = 0x80. abs(-128) = 128 ✓
  //   D1b = 0xFF (=-1), D3 = (-(-1))&0xFF = 1. ✓
  const D3_byte = sext8(D1_byte) >= 0 ? D1_byte : (-D1_byte) & 0xff;
  const D4_byte = sext8(D2_byte) >= 0 ? D2_byte : (-D2_byte) & 0xff;

  // ─── Step 10: Axis-lock ───────────────────────────────────────────────
  // bhi/bls usano confronto UNSIGNED su byte. lsl.b raddoppia con possibile
  // overflow byte (es: 0x80 << 1 = 0x00). Manteniamo questo behaviour.
  let D1_final = D1_byte;
  let D2_final = D2_byte;
  const D4_doubled = (D4_byte << 1) & 0xff;
  // bhi: branch if D3 > D4_doubled (unsigned) → CLEAR_BLOCK
  if (D3_byte > D4_doubled) {
    // CLEAR_BLOCK: bcc (= bhs unsigned >=) D3 vs D4
    if (D3_byte >= D4_byte) {
      D2_final = 0; // clr.b D2b
    } else {
      D1_final = 0; // clr.b D1b
    }
  } else {
    const D3_doubled = (D3_byte << 1) & 0xff;
    // bls: branch if D4 <= D3_doubled (unsigned) → SKIP
    // → fallthrough a CLEAR_BLOCK altrimenti
    if (D4_byte > D3_doubled) {
      // CLEAR_BLOCK
      if (D3_byte >= D4_byte) {
        D2_final = 0;
      } else {
        D1_final = 0;
      }
    }
    // else: SKIP — D1, D2 invariati
  }

  // ─── Step 11: Add sext(D1b) a *0x6A4, sext(D2b) a *0x6A6 ──────────────
  // Il binario fa `move.b Dxb, D0b; ext.w D0w; add.w D0w, (Ax)`.
  // ext.w di un byte zero-esteso → sext_w del byte signed.
  const xCur = readSignedWord(state, ACCUM_X_OFF);
  const xNew = sext16((xCur + sext8(D1_final)) & 0xffff);
  writeWord(state, ACCUM_X_OFF, xNew);

  const yCur = readSignedWord(state, ACCUM_Y_OFF);
  const yNew = sext16((yCur + sext8(D2_final)) & 0xffff);
  writeWord(state, ACCUM_Y_OFF, yNew);

  // ─── Step 12: Post-step wrap ±0x18 con flag clear ─────────────────────
  // Y+ wrap: se *A3 > 0x18 → *A3 -= 0x18, clear bit 15
  let yWord = readSignedWord(state, ACCUM_Y_OFF);
  if (yWord > POST_WRAP_LIMIT) {
    yWord = sext16((yWord - POST_WRAP_LIMIT) & 0xffff);
    writeWord(state, ACCUM_Y_OFF, yWord);
    flags &= FLAG_MASK_CLEAR_YPOS_WRAP;
  }
  // Y- wrap: se *A3 < -0x18 → *A3 += 0x18, clear bit 14
  // Riletta perché se Y+ ha applicato il wrap, il valore è cambiato.
  yWord = readSignedWord(state, ACCUM_Y_OFF);
  if (yWord < -POST_WRAP_LIMIT) {
    yWord = sext16((yWord + POST_WRAP_LIMIT) & 0xffff);
    writeWord(state, ACCUM_Y_OFF, yWord);
    flags &= FLAG_MASK_CLEAR_YNEG_WRAP;
  }
  // X+ wrap: se *A2 > 0x18 → *A2 -= 0x18, clear bit 12
  let xWord = readSignedWord(state, ACCUM_X_OFF);
  if (xWord > POST_WRAP_LIMIT) {
    xWord = sext16((xWord - POST_WRAP_LIMIT) & 0xffff);
    writeWord(state, ACCUM_X_OFF, xWord);
    flags &= FLAG_MASK_CLEAR_XPOS_WRAP;
  }
  // X- wrap: se *A2 < -0x18 → *A2 += 0x18, clear bit 13
  xWord = readSignedWord(state, ACCUM_X_OFF);
  if (xWord < -POST_WRAP_LIMIT) {
    xWord = sext16((xWord + POST_WRAP_LIMIT) & 0xffff);
    writeWord(state, ACCUM_X_OFF, xWord);
    flags &= FLAG_MASK_CLEAR_XNEG_WRAP;
  }

  // ─── Step 13: Ritorna D5w sign-extended (long signed) ─────────────────
  return sext16(flags);
}

/** Re-export del simbolo come "FUN_00028468" per mappatura binario→TS. */
export { trackballClampFlags28468 as FUN_00028468 };
