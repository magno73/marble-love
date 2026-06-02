/**
 * 0x261BC..0x262B1, 246 byte).
 *
 * **Caller**: `FUN_00026196` (`flag-scaled-magnitude-dispatch.ts`), which
 * invokes it via callback `inner` with `(slotPtr, magnitude)`.
 *
 * **Disasm 0x261BC..0x262B1** (block-level semantics):
 *
 *   PROLOG:
 *     261bc  movem.l {A2 D5 D4 D3 D2}, -(SP)
 *     261c0  A2 = (0x18,SP)                    ; arg1 = slotPtr
 *     261c4  D2 = (0x1c,SP)                    ; arg2 = magnitude (long)
 *
 *   ABS VX/VY:
 *     261c8  D0 = (A2)                         ; D0 = VX (long signed)
 *     261ca  bge → 0x261d0                     ; if VX >= 0 skip neg
 *     261cc  neg.l D0                          ; D0 = |VX|
 *     261d0  D1 = D0                           ; D1 = |VX|
 *     261d2  D0 = (0x4,A2)                     ; D0 = VY
 *     261d6  bge → 0x261dc
 *     261d8  neg.l D0
 *     261dc  D4 = D0                           ; D4 = |VY|
 *
 *   MANHATTAN-LIKE DISTANCE (D3):
 *     261de  cmp.l D4,D1                       ; cmp D1 (|VX|), D4 (|VY|)
 *     261e0  bls → 0x261f2                     ; if |VX| <= |VY| go ELSE
 *     IF (|VX| > |VY|):                        ; D1 > D4
 *       261e2  D0 = D4 (|VY|)
 *       261e4  D0 = D0 lsr.l 3                 ; |VY| >> 3 (unsigned)
 *       261e6  D3w = D0w                       ; D3 = (|VY|>>3) word
 *       261e8  ext.l D3                        ; sign-extend low word
 *       261ea  mulu.w #0x3, D3                 ; D3 = (|VY|>>3) * 3 (unsigned word)
 *       261ee  D3 = D3 + D1                    ; D3 = D1 + (D4>>3)*3
 *       261f0  bra → 0x26200
 *     ELSE (|VX| <= |VY|):
 *       261f2  D0 = D1 (|VX|)
 *       261f4  D0 = D0 lsr.l 3
 *       261f6  D3w = D0w
 *       261f8  ext.l D3
 *       261fa  mulu.w #0x3, D3
 *       261fe  D3 = D3 + D4                    ; D3 = D4 + (D1>>3)*3
 *
 *   ANGLE LOOKUP (only for slot @ 0x400018 or @ 0x4000FA):
 *     26200  cmpa.l #0x400018, A2; beq → 0x26214
 *     2620a  cmpa.l #0x4000fa, A2; bne → 0x26282 (skip lookup)
 *     ANGLE BLOCK:
 *       26214  D0 = D3 lsr.l #15 (== bit 15..30 of D3)
 *       2621a  D4w = D0w; D4w &= 0xf            ; D4 = (D3 >> 15) & 0xF
 *       26220  D0 = D3 lsr.l #12
 *       26226  D1w = D0w; D1w &= 0x7            ; D1 = (D3 >> 12) & 0x7
 *       2622c  D0w = D4w; ext.l D0; D0 *= 2     ; D0 = D4 * 2 (word index)
 *       26232  A0 = #0x1eef8                    ; ROM table base
 *       26238  D5w = (0x0, A0, D0*1).w          ; D5 = romW[0x1eef8 + D4*2]
 *       2623c  D0w = D4w; ext.l; addq.l #1      ; D0 = D4 + 1
 *       26242  D0 *= 2
 *       26244  A0 = #0x1eef8
 *       2624a  D0w = romW[0x1eef8 + (D4+1)*2]
 *       2624e  D0w -= D5w                       ; delta = next - cur (signed word)
 *       26250  muls.w D1w, D0                   ; D0 = delta * D1 (signed long)
 *       26252  D1 = D0
 *       26254  D1 = D1 asr.l 3                  ; D1 = D0 / 8 (signed)
 *       26256  D0w = D5w; ext.l                 ; D0 = sext_w(D5)
 *       2625a  D1 = D0 + D1                     ; D1 = D5 + delta*D1/8 (linear interp)
 *       2625c  D0 = 9
 *       2625e  D1 = D1 asr.l D0                 ; D1 >>= 9
 *       26260  D0w = D1w
 *       26262  add.w D0w, (0xc4,A2)             ; (0xc4,A2) += D0w  (signed word add)
 *       26266  cmpi.w #0xa0, (0xc4,A2)
 *       2626c  ble → 0x26282                    ; if (0xc4,A2) <= 0xA0 skip wrap
 *       2626e  subi.w #0xa0, (0xc4,A2)
 *       26274  pea (0xa).w                      ; arg2 = 0xA (long sign-ext from word)
 *       26278  move.l A2, -(SP)                 ; arg1 = slotPtr
 *       2627a  jsr 0x28608                      ; FUN_28608(slotPtr, 0xA)
 *       26280  addq.l #8, SP
 *
 *   VELOCITY CLAMP (only if magnitude < dist):
 *     26282  D0 = D2 (magnitude)
 *     26284  cmp.l D3, D0                       ; cmp D2, D3
 *     26286  bcc → 0x262ac                      ; if D2 >= D3 (unsigned hi-or-eq) skip clamp
 *     IF magnitude < dist (unsigned):
 *       26288  D0 = D2; D0 = D0 asl.l 6         ; D0 = magnitude << 6
 *       2628c  D1 = D0
 *       2628e  D0 = D3; D0 = D0 lsr.l 8         ; D0 = dist >> 8 (unsigned)
 *       26292  divu.w D0w, D1                   ; D1q = (mag<<6) / (dist>>8) (unsigned word)
 *                                                 ; quotient in D1.w, remainder in D1.hi
 *       26294  D0 = (A2)                        ; D0 = VX
 *       26296  D0 = D0 asr.l 8                  ; D0 = VX >> 8 (signed)
 *       26298  muls.w D1w, D0                   ; D0 = (VX>>8) * D1q (signed word*long)
 *       2629a  D0 = D0 asr.l 6                  ; D0 >>= 6 (signed)
 *       2629c  (A2) = D0                        ; VX = scaled
 *       2629e  D0 = (0x4,A2)
 *       262a2  D0 asr.l 8
 *       262a4  muls.w D1w, D0
 *       262a6  D0 asr.l 6
 *       262a8  (0x4,A2) = D0                    ; VY = scaled
 *
 *   EPILOG:
 *     262ac  movem.l (SP)+, {D2 D3 D4 D5 A2}
 *     262b0  rts                                ; return D0 (VY scaled, or magnitude
 *                                               ;          if no clamp)
 *
 * **Sub callees**:
 *   - `FUN_28608` (objectAccumFlag28608) @ 0x2627A — already replicated
 *     in `object-accum-flag-28608.ts`. Modifiable via `subs.fun28608`.
 *
 * **Slot writes**:
 *   - slot+0x00..0x03 (VX long)  via `(A2)`        — 0x2629C
 *   - slot+0x04..0x07 (VY long)  via `(0x4,A2)`    — 0x262A8
 *   - slot+0xC4..0xC5 (word)    via `(0xC4,A2)`   — 0x26262, 0x2626E (only when
 *     A2 ∈ {0x400018, 0x4000FA})
 *
 * **Return value (D0)**:
 *   - If magnitude < dist: D0 = scaled VY (last write); used by FUN_26196's
 *     RTS chain.
 *   - Else: D0 = magnitude (D2 last copy at 0x26282).
 *
 * NOTE: callers (FUN_182BA via FUN_26196) ignore the return value — the rts of
 */

import type { GameState } from "./state.js";
import { objectAccumFlag28608 } from "./object-accum-flag-28608.js";

const WORK_RAM_BASE = 0x00400000 as const;

/** Base ROM table for angle interp. */
const ANGLE_TABLE_ROM_OFF = 0x0001eef8 as const;

// ─── Helpers (M68k arithmetic, big-endian) ────────────────────────────────

function rL(state: GameState, off: number): number {
  return (
    (((state.workRam[off] ?? 0) << 24) |
      ((state.workRam[off + 1] ?? 0) << 16) |
      ((state.workRam[off + 2] ?? 0) << 8) |
      (state.workRam[off + 3] ?? 0)) >>>
    0
  );
}

function wL(state: GameState, off: number, v: number): void {
  const u = v >>> 0;
  state.workRam[off] = (u >>> 24) & 0xff;
  state.workRam[off + 1] = (u >>> 16) & 0xff;
  state.workRam[off + 2] = (u >>> 8) & 0xff;
  state.workRam[off + 3] = u & 0xff;
}

function rW(state: GameState, off: number): number {
  return (
    (((state.workRam[off] ?? 0) << 8) | (state.workRam[off + 1] ?? 0)) >>> 0
  );
}

function wW(state: GameState, off: number, v: number): void {
  const u = v & 0xffff;
  state.workRam[off] = (u >>> 8) & 0xff;
  state.workRam[off + 1] = u & 0xff;
}

function s32(v: number): number {
  return v | 0;
}
function sextW(w: number): number {
  return ((w & 0xffff) << 16) >> 16;
}

/** Read big-endian 16-bit word from ROM program region. */
function romW(rom: Uint8Array, abs: number): number {
  const a = abs >>> 0;
  if (a + 1 >= rom.length) return 0;
  return (((rom[a] ?? 0) << 8) | (rom[a + 1] ?? 0)) & 0xffff;
}

/** Stub-injection for sub callees. */
export interface Sub261BCSubs {
  /** `FUN_28608` (objectAccumFlag28608). Default = the real replica. */
  fun28608?: (state: GameState, slotPtr: number, value: number) => void;
}

/**
 *
 * @param state      GameState (mutated: workRam slot fields)
 *                   `0x400018` (slot 0) or `0x4000FA` (slot 1) for the
 *                   angle-lookup branch; other slots jump directly to clamp.
 * @param magnitude  Long unsigned (M68k convention) — `0x40000` or `0x50000`
 *                   from `FUN_26196`.
 * @param rom        ROM program (for table 0x1eef8).
 * @param subs       Stub-injection (default = real callees).
 */
export function fun261BC(
  state: GameState,
  slotPtr: number,
  magnitude: number,
  rom: Uint8Array,
  subs?: Sub261BCSubs,
): number {
  const a2 = slotPtr >>> 0;
  const a2Off = (a2 - WORK_RAM_BASE) >>> 0;
  const d2 = magnitude >>> 0; // arg2: magnitude (used as unsigned for cmp/divu)

  // ─── ABS VX, VY ────────────────────────────────────────────────────────
  // 261c8: D0 = (A2); if D0 < 0 neg.l D0
  let d0L = s32(rL(state, a2Off + 0x00));
  if (d0L < 0) d0L = (-d0L) | 0;
  const d1AbsVX = d0L >>> 0; // |VX|

  // 261d2: D0 = (0x4,A2); if D0 < 0 neg.l D0
  d0L = s32(rL(state, a2Off + 0x04));
  if (d0L < 0) d0L = (-d0L) | 0;
  const d4AbsVY = d0L >>> 0; // |VY|

  // ─── MANHATTAN-LIKE DIST (D3) ───────────────────────────────────────────
  // 261de: cmp.l D4,D1; bls → ELSE (D1 <= D4)
  // M68k cmp.l: signed flags but bls is "below or same" → unsigned <=
  let d3: number;
  if (d1AbsVX > d4AbsVY) {
    // |VX| > |VY|: D3 = D1 + ((D4 >>> 3) word) * 3
    // D0 = D4; D0 = D0 lsr.l 3; D3w = D0w; ext.l D3 (sign-ext low word)
    // mulu.w #3, D3 → unsigned word*word -> long
    // add.l D1, D3
    const t = (d4AbsVY >>> 3) & 0xffff; // word
    // ext.l D3 sign-extends, but since result of >>>3 over 32-bit values may
    // have bits set beyond 16; here we explicitly take the low 16 bits as
    // M68k does (move.w D0w,D3w writes only low word, leaving high word
    // unchanged from previous operation). The subsequent ext.l D3 would
    // sign-extend that low word, but for unsigned mulu the sign-ext is
    // benign (mulu treats source as unsigned word).
    // mulu.w #3, D3 → (t * 3) as 32-bit unsigned product
    const prod = (t * 3) >>> 0;
    d3 = ((prod + d1AbsVX) | 0) >>> 0;
  } else {
    // |VX| <= |VY|: D3 = D4 + ((D1 >>> 3) word) * 3
    const t = (d1AbsVX >>> 3) & 0xffff;
    const prod = (t * 3) >>> 0;
    d3 = ((prod + d4AbsVY) | 0) >>> 0;
  }

  // ─── ANGLE LOOKUP (only slot 0x400018 or 0x4000FA) ──────────────────────
  if (a2 === 0x00400018 || a2 === 0x004000fa) {
    // 26214: D0 = D3 lsr.l 15; D4w = D0w; D4w &= 0xf
    const d4Idx = ((d3 >>> 15) & 0xf) >>> 0;
    // 26220: D0 = D3 lsr.l 12; D1w = D0w; D1w &= 0x7
    const d1Frac = ((d3 >>> 12) & 0x7) >>> 0;

    // 2622c: D0 = D4 * 2 (word index, ext.l a long)
    // 26232: A0 = 0x1eef8
    // 26238: D5w = romW[0x1eef8 + D4*2]
    const off0 = ANGLE_TABLE_ROM_OFF + (d4Idx << 1);
    const d5W = romW(rom.length > 0 ? rom : new Uint8Array(0), off0);

    // 2623c: D0 = (D4 + 1) * 2; D0w = romW[0x1eef8 + (D4+1)*2]
    const off1 = ANGLE_TABLE_ROM_OFF + ((d4Idx + 1) << 1);
    const d0NextW = romW(rom.length > 0 ? rom : new Uint8Array(0), off1);

    // 2624e: sub.w D5w, D0w → D0 word = (next - cur) word (signed via muls)
    // muls.w D1w, D0 → signed word * word → long
    // The high half of D0 is undefined post-sub.w (still has prior bits) but
    // muls.w only reads low word → so we use the low word of (next - cur).
    const deltaW = sextW((d0NextW - d5W) & 0xffff);
    // muls.w D1w, D0 → signed product (D1 is 0..7, deltaW is signed word)
    const mulProd = (deltaW * sextW(d1Frac)) | 0;

    // 26252: D1 = D0 (long product)
    // 26254: D1 = D1 asr.l 3 (signed shift)
    let d1Acc = mulProd >> 3;

    // 26256: D0w = D5w; ext.l D0 (sign-ext word to long)
    const d5Long = sextW(d5W);

    // 2625a: D1 = D0 + D1 (long signed add)
    d1Acc = (d5Long + d1Acc) | 0;

    // 2625c: D0 = 9; D1 = D1 asr.l D0
    d1Acc = d1Acc >> 9;

    // 26260: D0w = D1w (low word, sign-ext at next add.w)
    // 26262: add.w D0w, (0xc4,A2)  → signed word add, low 16 bits of slot+0xc4
    const cur = sextW(rW(state, a2Off + 0xc4));
    const next = (cur + sextW(d1Acc & 0xffff)) | 0;
    wW(state, a2Off + 0xc4, next & 0xffff);

    // 26266: cmpi.w #0xA0, (0xc4,A2); ble → skip wrap
    // (signed word compare: M68k cmpi.w sets flags; ble is signed)
    if (sextW(rW(state, a2Off + 0xc4)) > 0xa0) {
      // 2626e: subi.w #0xA0, (0xc4,A2)
      const cur2 = sextW(rW(state, a2Off + 0xc4));
      wW(state, a2Off + 0xc4, (cur2 - 0xa0) & 0xffff);

      // 26274: pea (0xa).w  → push 0xA as long (sign-ext word)
      // 26278: move.l A2, -(SP)
      // 2627a: jsr FUN_28608(slotPtr, 0xA)
      const fn = subs?.fun28608 ?? objectAccumFlag28608;
      fn(state, a2, 0xa);
    }
  }

  // ─── VELOCITY CLAMP (only if magnitude < dist, unsigned) ────────────────
  // 26282: D0 = D2 (magnitude)
  // 26284: cmp.l D3, D0  → cmp D0,D3 (sub.l D3,D0 mentally: flags set on D0-D3)
  //         actually M68k cmp.l Dy,Dx computes Dx-Dy → here cmp.l D3,D0 is D0-D3
  // 26286: bcc → skip if D0 >= D3 unsigned (carry clear)
  // So if D2 < D3 (unsigned), enter clamp block.
  let retVal = d2 >>> 0; // D0 at 26282 = D2 (magnitude); preserved if no clamp
  if ((d2 >>> 0) < (d3 >>> 0)) {
    // 26288: D0 = D2; D0 = D0 asl.l 6 → magnitude << 6 (32-bit, drops high 6 bits)
    const d0Shl = (d2 << 6) >>> 0;

    // 2628c: D1 = D0
    // 2628e: D0 = D3; D0 = D0 lsr.l 8 → dist >> 8 (unsigned)
    const divisor = (d3 >>> 8) >>> 0;

    // 26292: divu.w D0w, D1 → unsigned 32/16 → quotient.w in low, remainder.w in hi
    // M68k divu.w: 32-bit dividend / 16-bit divisor.
    // If quotient overflows 16-bit OR divisor==0 → CPU exception. We model as
    // saturating to 0xFFFF for safety (callers in real code won't hit zero
    // here because dist >= 1 when entering this branch — D3 > D2 ≥ 0).
    let quotientW = 0;
    if ((divisor & 0xffff) !== 0) {
      const q = Math.trunc(d0Shl / (divisor & 0xffff));
      // M68k undefined behavior on overflow; we mask low word as the next
      // op (muls.w D1w) only reads low 16 bits.
      quotientW = q & 0xffff;
    }
    // After divu.w, D1 high word = remainder (unused), low word = quotient.

    // 26294: D0 = (A2) (VX long)
    // 26296: D0 = D0 asr.l 8 (signed)
    // 26298: muls.w D1w, D0 (signed word * signed word → long)
    // 2629a: D0 = D0 asr.l 6
    // 2629c: (A2) = D0
    const vx = s32(rL(state, a2Off + 0x00));
    let d0Vx = vx >> 8; // asr.l 8
    d0Vx = ((sextW(d0Vx & 0xffff) * sextW(quotientW)) | 0) >> 6;
    wL(state, a2Off + 0x00, d0Vx >>> 0);

    // 2629e: D0 = (0x4,A2) (VY long)
    // 262a2: asr.l 8
    // 262a4: muls.w D1w, D0
    // 262a6: asr.l 6
    // 262a8: (0x4,A2) = D0
    const vy = s32(rL(state, a2Off + 0x04));
    let d0Vy = vy >> 8;
    d0Vy = ((sextW(d0Vy & 0xffff) * sextW(quotientW)) | 0) >> 6;
    wL(state, a2Off + 0x04, d0Vy >>> 0);

    // D0 at the rts = scaled VY long
    retVal = d0Vy >>> 0;
  }

  // 262ac: movem.l (SP)+, {D2 D3 D4 D5 A2}
  // 262b0: rts → returns D0
  return retVal >>> 0;
}

/** @public */
export const SUB_261BC_ADDR = 0x000261bc as const;
