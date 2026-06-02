/**
 * trackball-clamp-flags-28468.ts — `FUN_00028468` replica (280 bytes).
 *
 * Updates `*0x4006A4` (X) and `*0x4006A6` (Y) by adding the clamped trackball delta.
 *   - bit 0: `*0x4003AA` bit 0 (input "fire1" debounced stable)
 *   - bit 1: `*0x4003AA` bit 1 (input "fire2" debounced stable)
 *   - bit 12: no positive X wrap-around (Y not clamped > +0x18)
 *   - bit 13: no negative X wrap
 *   - bit 14: no negative Y wrap
 *   - bit 15: no positive Y wrap
 *
 * D5 flag-word starts as `0xF003` (bits 0,1,12,13,14,15 set) and bits
 *
 * **Disasm 0x28468..0x2857F** (280 byte):
 *
 *   00028468  movem.l {A3 A2 D5 D4 D3 D2}, -(SP)    ; save 24 bytes
 *   0002846C  movea.l #0x4006A6, A3                 ; A3 = ptr OUT-Y word
 *   00028472  movea.l #0x4006A4, A2                 ; A2 = ptr OUT-X word
 *
 *   ; ── Hard pre-clamp to ±0x40 on both accumulators ───────────────────
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
 *   000284A0  move.w  #-0xFFD, D5w        ; D5w = 0xF003 (init flags)
 *   000284AA  btst.b  #0, (0x4003AA).l    ; debounced bit 0 set?
 *   000284B4  andi.w  #-2, D5w            ; no → clear bit 0 of D5w
 *   000284B8  btst.b  #1, (0x4003AA).l
 *   000284C0  bne.b   0x284C6
 *   000284C2  andi.w  #-3, D5w            ; clear bit 1
 *   000284C6  jsr     0x1AC18.l           ; trackballInputTick (no-args)
 *   000284CC  jsr     0x180BE.l           ; pickObjLarger
 *
 *   ; A = *0x4006AA (= picked obj.deltaY, sext_b)
 *   ; B = *0x4006A8 (= picked obj.deltaX, sext_b)
 *   ;
 *   ; D1 byte = byte(-sext(A)) - B  (mod 256, signed byte arith)
 *   ; D2 byte = A - B               (mod 256)
 *   ;
 *   ;  real X/Y deltas in screen space.)
 *   000284D2  move.b  (0x4006AA).l, D0b
 *   000284D8  ext.w   D0w
 *   000284DA  ext.l   D0
 *   000284DC  neg.l   D0                  ; D0 = -sext_l(A)
 *   000284DE  move.b  D0b, D1b            ; D1b = byte(-sext_l(A)) = (-A)&0xFF
 *   000284E0  sub.b   (0x4006A8).l, D1b   ; D1b -= B
 *   000284E6  move.b  (0x4006AA).l, D2b   ; D2b = A
 *   000284EC  sub.b   (0x4006A8).l, D2b   ; D2b -= B
 *
 *   ; ── D3 = abs(D1), D4 = abs(D2) (signed abs on byte) ────────────────
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
 *   ; ── Post-step wrap at ±0x18, clearing the flag bit on overflow ─────
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
 *   - `0x00000BC2` (VBLANK ISR): `jsr 0x10042` → trampoline → `FUN_28468`.
 *     The caller runs `not.w D0w; andi.w #0xF002, D0w; or.w D0w, *0x400000`,
 *     converting the returned "no wrap" bits into "wrap happened" bits in the
 *     global control word @ 0x400000.
 *
 *   1. *0x4006A4 / *0x4006A6 saturate ±0x40 (X poi Y, cap upper poi lower)
 *   5. *0x4006A4 += sext_w(D1b), *0x4006A6 += sext_w(D2b)
 *   6. *0x4006A6 wrap ±0x18, *0x4006A4 wrap ±0x18
 *
 * **Direct TS module side effects (excluding the 3 sub-call side effects)**:
 *   - state.workRam[0x6A4..0x6A5] mutated (X accumulator word)
 *   - state.workRam[0x6A6..0x6A7] mutated (Y accumulator word)
 *
 * `packages/cli/src/test-trackball-clamp-flags-28468-parity.ts`.
 */

import type { GameState } from "./state.js";
import { debounceInput } from "./game-main-gate.js";
import { trackballInputTick } from "./trackball-input.js";
import { pickObjLarger } from "./obj-pick-larger.js";

// ─── Address constants (workRam offsets relative to 0x400000) ────────────

export const FUN_28468_ADDR = 0x00028468 as const;

/** Word offset accumulator X @ 0x4006A4. */
export const ACCUM_X_OFF = 0x6a4 as const;

/** Word offset accumulator Y @ 0x4006A6. */
export const ACCUM_Y_OFF = 0x6a6 as const;

/** Byte offset picked-delta-X @ 0x4006A8 (written by FUN_180BE = pickObjLarger). */
export const PICKED_DELTA_X_OFF = 0x6a8 as const;

/** Byte offset picked-delta-Y @ 0x4006AA (written by FUN_180BE). */
export const PICKED_DELTA_Y_OFF = 0x6aa as const;

export const DEBOUNCED_INPUT_OFF = 0x3aa as const;

/** Pre-clamp hard saturation (signed word) on accumulators: ±0x40. */
export const PRE_CLAMP_LIMIT = 0x40 as const;

/** Post-step wrap threshold (signed word) on accumulators: ±0x18. */
export const POST_WRAP_LIMIT = 0x18 as const;

/** Initial flag word D5w = 0xF003 (bits 0, 1, 12, 13, 14, 15). */
export const INITIAL_FLAGS = 0xf003 as const;

/** Mask AND `andi.w #-2` to clear bit 0 (input bit 0 not debounced). */
export const FLAG_MASK_CLEAR_INPUT0 = 0xfffe as const;

/** Mask AND `andi.w #-3` to clear bit 1 (input bit 1 not debounced). */
export const FLAG_MASK_CLEAR_INPUT1 = 0xfffd as const;

/** Mask AND `andi.w #0x7FFF` to clear bit 15 (Y+ wrap). */
export const FLAG_MASK_CLEAR_YPOS_WRAP = 0x7fff as const;

/** Mask AND `andi.w #-0x4001` to clear bit 14 (Y- wrap). */
export const FLAG_MASK_CLEAR_YNEG_WRAP = 0xbfff as const;

/** Mask AND `andi.w #-0x1001` to clear bit 12 (X+ wrap). */
export const FLAG_MASK_CLEAR_XPOS_WRAP = 0xefff as const;

/** Mask AND `andi.w #-0x2001` to clear bit 13 (X- wrap). */
export const FLAG_MASK_CLEAR_XNEG_WRAP = 0xdfff as const;

// ─── Helpers ─────────────────────────────────────────────────────────────

/** Read a big-endian signed word from state.workRam @ off. */
function readSignedWord(state: GameState, off: number): number {
  const r = state.workRam;
  const w = (((r[off] ?? 0) << 8) | (r[off + 1] ?? 0)) & 0xffff;
  return w & 0x8000 ? w - 0x10000 : w;
}

/** Write word (low 16 bits, big-endian) into state.workRam @ off. */
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
 * Hard pre-clamp saturation of a single accumulator word to ±limit.
 *
 *   moveq #limit, D0; cmp.w (Ax), D0w; bge skip; move.w #limit, (Ax)
 *   moveq #-limit, D0; cmp.w (Ax), D0w; ble skip; move.w #-limit, (Ax)
 *
 */
function preClampWord(state: GameState, off: number, limit: number): void {
  let v = readSignedWord(state, off);
  if (v > limit) v = limit;
  if (v < -limit) v = -limit;
  writeWord(state, off, v);
}


export interface TrackballClampFlags28468Inputs {
  /** Byte MMIO @ 0xF60001 — passed to debounceInput (FUN_2893C). */
  mmioInputByte: number;
  /** Byte MMIO trackball X player 1 @ 0xF20001 — passed to trackballInputTick. */
  p1X: number;
  /** Byte MMIO trackball Y player 1 @ 0xF20003. */
  p1Y: number;
  /** Byte MMIO trackball X player 2 @ 0xF20005. */
  p2X: number;
  /** Byte MMIO trackball Y player 2 @ 0xF20007. */
  p2Y: number;
}

/**
 *
 *   1. Hard pre-clamp ±0x40 on *0x4006A4 and *0x4006A6 (X then Y).
 *   2. Init D5w = 0xF003.
 *   4. Clear D5w bit 0 if *0x4003AA bit 0 is not set.
 *   5. Clear D5w bit 1 if *0x4003AA bit 1 is not set.
 *      delta X/Y bytes.
 *  11. *0x4006A4 += sext_w(D1b); *0x4006A6 += sext_w(D2b).
 *  12. Post-step wrap ±0x18: for each of the 4 sides (Y+, Y-, X+, X-),
 *      if overflow occurs, subtract/add 0x18 and clear the corresponding
 *      D5w bit (15, 14, 12, 13 respectively).
 *
 * @param state GameState (mutates workRam).
 * @param inputs Bag with the 5 MMIO bytes (1 input + 4 trackball).
 */
export function trackballClampFlags28468(
  state: GameState,
  inputs: TrackballClampFlags28468Inputs,
): number {
  // Step 1: hard pre-clamp +/-0x40.
  // preClampWord applies both caps consecutively for each word.
  preClampWord(state, ACCUM_X_OFF, PRE_CLAMP_LIMIT);
  preClampWord(state, ACCUM_Y_OFF, PRE_CLAMP_LIMIT);

  // ─── Step 2-3: Init flags + debounce ──────────────────────────────────
  let flags = INITIAL_FLAGS;
  debounceInput(state, inputs.mmioInputByte);

  // ─── Step 4-5: Clear flag bits 0/1 if input is not debounced ──────────
  const debounced = state.workRam[DEBOUNCED_INPUT_OFF] ?? 0;
  if ((debounced & 0x01) === 0) flags &= FLAG_MASK_CLEAR_INPUT0;
  if ((debounced & 0x02) === 0) flags &= FLAG_MASK_CLEAR_INPUT1;

  // ─── Step 6: trackballInputTick ───────────────────────────────────────
  trackballInputTick(state, inputs.p1X, inputs.p1Y, inputs.p2X, inputs.p2Y);

  pickObjLarger(state);

  // A = *0x4006AA (sext_b), B = *0x4006A8 (sext_b).
  //   D0 = sext_l(A); D0 = -D0; D1b = D0b; D1b -= B (byte signed sub)
  //   D2b = A; D2b -= B
  // In TS: use byte arithmetic mod 256 while preserving faithful sign-extension.
  const A_byte = (state.workRam[PICKED_DELTA_Y_OFF] ?? 0) & 0xff;
  const B_byte = (state.workRam[PICKED_DELTA_X_OFF] ?? 0) & 0xff;

  // D1b = byte( -sext_l(A) ) = (-A) & 0xFF (per via of the overflow byte).
  // Poi D1b -= B (mod 256).
  const negA_byte = (-sext8(A_byte)) & 0xff;
  const D1_byte = (negA_byte - B_byte) & 0xff;
  const D2_byte = (A_byte - B_byte) & 0xff;

  // ─── Step 9: D3 = abs8(D1), D4 = abs8(D2) (byte unsigned) ─────────────
  // - if D1b >= 0 (signed): D3 = D1b (0..127)
  // - if D1b <  0 (signed): D3 = (-D1b)&0xFF = (256 - D1b)&0xFF
  //   Ma neg.l su long(D1b zero-ext) = -D1b (long), poi byte = -D1b & 0xFF.
  //   Per D1b in [-128, -1] (sext range), |D1b| in [1, 128].
  //   Esempi: D1b = 0x80 (=-128), D3 = (-128)&0xFF = 0x80. abs(-128) = 128 ✓
  //   D1b = 0xFF (=-1), D3 = (-(-1))&0xFF = 1. ✓
  const D3_byte = sext8(D1_byte) >= 0 ? D1_byte : (-D1_byte) & 0xff;
  const D4_byte = sext8(D2_byte) >= 0 ? D2_byte : (-D2_byte) & 0xff;

  // ─── Step 10: Axis-lock ───────────────────────────────────────────────
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
  // ext.w of un byte zero-esteso → sext_w of the byte signed.
  const xCur = readSignedWord(state, ACCUM_X_OFF);
  const xNew = sext16((xCur + sext8(D1_final)) & 0xffff);
  writeWord(state, ACCUM_X_OFF, xNew);

  const yCur = readSignedWord(state, ACCUM_Y_OFF);
  const yNew = sext16((yCur + sext8(D2_final)) & 0xffff);
  writeWord(state, ACCUM_Y_OFF, yNew);

  // ─── Step 12: Post-step wrap +/-0x18 with flag clear ──────────────────
  // Y+ wrap: if *A3 > 0x18 -> *A3 -= 0x18, clear bit 15
  let yWord = readSignedWord(state, ACCUM_Y_OFF);
  if (yWord > POST_WRAP_LIMIT) {
    yWord = sext16((yWord - POST_WRAP_LIMIT) & 0xffff);
    writeWord(state, ACCUM_Y_OFF, yWord);
    flags &= FLAG_MASK_CLEAR_YPOS_WRAP;
  }
  // Y- wrap: if *A3 < -0x18 -> *A3 += 0x18, clear bit 14
  yWord = readSignedWord(state, ACCUM_Y_OFF);
  if (yWord < -POST_WRAP_LIMIT) {
    yWord = sext16((yWord + POST_WRAP_LIMIT) & 0xffff);
    writeWord(state, ACCUM_Y_OFF, yWord);
    flags &= FLAG_MASK_CLEAR_YNEG_WRAP;
  }
  // X+ wrap: if *A2 > 0x18 -> *A2 -= 0x18, clear bit 12
  let xWord = readSignedWord(state, ACCUM_X_OFF);
  if (xWord > POST_WRAP_LIMIT) {
    xWord = sext16((xWord - POST_WRAP_LIMIT) & 0xffff);
    writeWord(state, ACCUM_X_OFF, xWord);
    flags &= FLAG_MASK_CLEAR_XPOS_WRAP;
  }
  // X- wrap: if *A2 < -0x18 -> *A2 += 0x18, clear bit 13
  xWord = readSignedWord(state, ACCUM_X_OFF);
  if (xWord < -POST_WRAP_LIMIT) {
    xWord = sext16((xWord + POST_WRAP_LIMIT) & 0xffff);
    writeWord(state, ACCUM_X_OFF, xWord);
    flags &= FLAG_MASK_CLEAR_XNEG_WRAP;
  }

  return sext16(flags);
}

export { trackballClampFlags28468 as FUN_00028468 };
