/**
 * state-sub-5d2a.ts — replica `FUN_00005D2A` (194 byte = 0xC2).
 *
 * "Row-render with bit-mask scan" wrapper that draws 16 cell pairs
 * iterating a 16-bit bitmap (`arg0` low word) MSB→LSB. For each bit
 *
 *   - Trailing arg   : 0 (immediate `clr.l -(SP)`)
 *
 * Main iter: `D4 = 15 → 0` (`bge.w` in signed word → 16 iter). Mask
 *
 *
 * **Disasm 0x5D2A..0x5DEC** (194 byte):
 *
 *   0x5D2A  movem.l {A4 A3 A2 D7 D6 D5 D4 D3 D2},-(SP) ; preserve 9 reg (36 byte)
 *   0x5D2E  move.w  (0x2a,SP),D3w           ; D3w = arg0 word low
 *   0x5D32  move.w  (0x2e,SP),D2w           ; D2w = arg1 word low
 *   0x5D36  movea.w #-0x8000,A2             ; A2 = sign-ext(0x8000) = 0xFFFF8000;
 *   0x5D3A  moveq   #5,D5                   ; D5 = 5 (long)
 *   0x5D3C  clr.w   D7w                     ; D7w = 0
 *   0x5D3E  movea.w D7w,A3                  ; A3 = sign-ext(0) = 0
 *   0x5D40  moveq   #0xf,D4                 ; D4 = 15 (loop counter)
 * LOOP_TOP:
 *   0x5D42  moveq   #7,D1                   ; D1 = 7
 *   0x5D44  cmp.w   D4w,D1w                 ; cmp.w D4,D1 → calc D1-D4 = 7-D4
 *   0x5D46  bne.b   0x5D68                  ; if D4 != 7, skip gate-byte read
 *   0x5D48  tst.b   (0x10072).l             ; gate byte
 *   0x5D4E  beq.b   0x5D54                  ; if 0 → D0 = 5
 *   0x5D50  moveq   #-0xb,D0                ; D0 = -11 = 0xFFFFFFF5 (long)
 *   0x5D52  bra.b   0x5D56
 *   0x5D54  moveq   #5,D0                   ; D0 = 5
 *   0x5D56  move.w  D0w,D5w                 ; D5w = D0w (low word)
 *                                            ; D5 keeps its hi word, but hi=0 here
 *   0x5D58  tst.b   (0x10072).l             ; gate byte (read again)
 *   0x5D5E  beq.b   0x5D64                  ; if 0 → D0 = 0
 *   0x5D60  moveq   #4,D0                   ; D0 = 4
 *   0x5D62  bra.b   0x5D66
 *   0x5D64  moveq   #0,D0                   ; D0 = 0
 *   0x5D66  movea.w D0w,A3                  ; A3 = sign-ext(D0w)
 * LOOP_BODY:
 *   0x5D68  moveq   #0,D0
 *   0x5D6A  move.w  A2w,D0w                 ; D0 = A2w zero-ext (mask)
 *   0x5D6C  move.w  D3w,D1w                 ; D1w = D3w (arg0 word low)
 *   0x5D6E  ext.l   D1                      ; D1 = sign-ext(D1w)
 *   0x5D70  and.l   D1,D0                   ; D0 = mask & arg0 (long)
 *   0x5D72  beq.b   0x5D78                  ; if bit clear → D0 = 8
 *   0x5D74  moveq   #7,D0                   ; D0 = 7 (bit set)
 *   0x5D76  bra.b   0x5D7A
 *   0x5D78  moveq   #8,D0                   ; D0 = 8 (bit clear)
 *   0x5D7A  movea.w D0w,A4                  ; A4 = sign-ext(7 or 8) (always pos)
 *   0x5D7C  moveq   #0xf,D1                 ; D1 = 15
 *   0x5D7E  move.w  D4w,D0w                 ; D0w = D4w
 *   0x5D80  ext.l   D0                      ; D0 = sign-ext(D4w) = D4 (if 0..15)
 *   0x5D82  sub.l   D0,D1                   ; D1 = 15 - D4 (long)
 *   0x5D84  asl.l   #1,D1                   ; D1 = (15-D4) * 2
 *   0x5D86  move.w  D1w,D6w                 ; D6w = D1w
 *   0x5D88  add.w   D5w,D6w                 ; D6w += D5w (word)
 *   0x5D8A  cmp.w   D2w,D4w                 ; cmp.w D2,D4 → calc D4-D2
 *   0x5D8C  bne.b   0x5D96                  ; if D4 != D2w → attr = 0x20
 *   0x5D8E  move.l  #0xa0,D0                ; D0 = 0xA0 (highlighted)
 *   0x5D94  bra.b   0x5D98
 *   0x5D96  moveq   #0x20,D0                ; D0 = 0x20 (default)
 *   0x5D98  clr.l   -(SP)                   ; push 0 (arg4)
 *   0x5D9A  move.l  D0,-(SP)                ; push attr (arg3)
 *   0x5D9C  move.w  A3w,D0w                 ; D0 = A3w
 *   0x5D9E  ext.l   D0                      ; D0 = sign-ext(A3w)
 *   0x5DA0  move.w  A4w,D1w                 ; D1w = A4w
 *   0x5DA2  ext.l   D1                      ; D1 = sign-ext(A4w)
 *   0x5DA4  add.l   D1,D0                   ; D0 = A3 + A4 (long, sign-ext sum)
 *   0x5DA6  move.l  D0,-(SP)                ; push x_left (arg2)
 *   0x5DA8  move.w  D6w,D0w                 ; D0w = D6w
 *   0x5DAA  ext.l   D0                      ; D0 = sign-ext(D6w)
 *   0x5DAC  move.l  D0,-(SP)                ; push y (arg1)
 *   0x5DB4  clr.l   -(SP)                   ; push 0 (arg4 of call #2)
 *   0x5DB6  clr.l   -(SP)                   ; push 0 (arg3 of call #2)
 *                                            ; NB: attr = 0 NOT 0xA0/0x20!
 *   0x5DB8  moveq   #0xf,D0                 ; D0 = 15
 *   0x5DBA  move.w  A4w,D1w
 *   0x5DBC  ext.l   D1                      ; D1 = sign-ext(A4w)
 *   0x5DBE  sub.l   D1,D0                   ; D0 = 15 - A4
 *   0x5DC0  move.w  A3w,D1w
 *   0x5DC2  ext.l   D1                      ; D1 = sign-ext(A3w)
 *   0x5DC4  add.l   D1,D0                   ; D0 = (15-A4) + A3
 *   0x5DC6  move.l  D0,-(SP)                ; push x_right (arg2)
 *   0x5DC8  move.w  D6w,D0w
 *   0x5DCA  ext.l   D0                      ; D0 = sign-ext(D6w)
 *   0x5DCC  move.l  D0,-(SP)                ; push y (arg1)
 *   0x5DD4  move.w  A2w,D0w
 *   0x5DD6  lsr.w   #1,D0w                  ; mask >>= 1 (logical word shift)
 *   0x5DD8  movea.w D0w,A2                  ; A2 = sign-ext(new mask word)
 *   0x5DDA  lea     (0x20,SP),SP            ; pop 32 byte (8 args * 4 byte)
 *   0x5DDE  subq.w  #1,D4w                  ; D4--
 *   0x5DE0  tst.w   D4w
 *   0x5DE2  bge.w   0x5D42                  ; loop while D4 >= 0 (signed word)
 *   0x5DE6  movem.l (SP)+,{D2 D3 D4 D5 D6 D7 A2 A3 A4}
 *   0x5DEA  rts
 *
 * **Important: CALL #2 attr = 0, not 0xA0/0x20**:
 *   attr override".
 *
 *   - Args: 2 longs pushed by caller. Caller pushes low-word at `(0x2a, SP)`
 *     and `(0x2e, SP)` respectively; offsets count caller_SP_args + 2.
 *   - `arg0` long: bitmap pattern (16 bits used in the low word). `arg0_word_low`
 *   - `arg1` long: highlight index (low word). If `arg1` is in {0..15}, the cell
 *     at `D4 == arg1` it receives attr 0xA0 instead of 0x20.
 *     at `D4 == arg1` receives attr 0xA0 instead of 0x20.
 *     D0 is the last jsr's return value, but callers do not test it.
 *   - Callee-saved: D2-D7, A2-A4 (preserved via movem prologue/epilogue).
 *
 *   each invocation with its four args.
 *
 * **Low-level fidelity notes**:
 *
 *  1. **Stack offsets `(0x2a, SP)` and `(0x2e, SP)`**: post-movem (9 regs x 4 =
 *     36 = 0x24) + ret addr (4) = 40 = 0x28. Caller_SP_args = SP + 0x28.
 *     Arg layout (2 longs pushed by caller, RTL):
 *        (0x28, SP) = arg0 long (high = 0x28+0..3, low = 0x2A..0x2B)
 *        (0x2C, SP) = arg1 long (low = 0x2E..0x2F)
 *     = arg1 low word. ✓
 *
 *     to long -> A2 long = 0xFFFF8000. But `A2w` (low word) = 0x8000. The
 *     the following operations read `move.w A2w, D0w` (zero-ext) = 0x8000.
 *
 *     then movea.w D0w, A2 -> A2 = 0x00004000. From iter 1 onward A2 high = 0.
 *
 *  4. **`moveq #-0xb, D0`**: long sign-ext = 0xFFFFFFF5 = -11. Then
 *     `move.w D0w, D5w` = 0xFFF5 (low word). D5 = (D5_hi)|0xFFF5. D5_hi was
 *
 *  5. **`add.w D5w, D6w`**: word add (mod 65536). With D5w = 0xFFF5 (= -11
 *     D6w = 0; D6w + 0xFFF5 = 0xFFF5. D4=14, D6w = 2 + 0xFFF5 = 0xFFF7, etc.
 *
 *     D4 != 7. The branch executes once because D4 passes through 7 only once.
 *
 *     low word (range 0..0xFFFF). If arg1 is in {0..15}, exactly one iteration
 *
 *  8. **`subq.w #1, D4w; tst.w D4w; bge.w 0x5D42`**: word decrement, signed
 *     N=1, bge fails (signed N XOR V = 1). 16 iterations total (D4=15..0).
 *
 *  9. **Args of FUN_3784 (push order RTL)**:
 *     CALL #1: push (0, attr, x_left, y) → callee sees args on the stack as:
 *        (0x4, SP) = y (long, sign-ext from D6w)
 *        (0x8, SP) = x_left (long, sign-ext sum A3+A4)
 *        (0xC, SP) = attr (long, 0x20 or 0xA0)
 *        (0x10, SP) = 0 (long)
 *     CALL #2: push (0, 0, x_right, y) → callee sees:
 *        (0x4, SP) = y
 *        (0x8, SP) = x_right
 *        (0xC, SP) = 0  ← ATTR = 0, NOT the attr of CALL #1!
 *        (0x10, SP) = 0
 *
 *     `x_right` with the same `y`.
 *
 * 11. **D0 at rts**: the epilogue movem does NOT touch D0. D0 keeps its
 *
 *   - `0x5C44` in FUN_5BB8 — jsr 0x5D2A (UNCONDITIONAL_CALL)
 *   - `0x5CC4` in FUN_5BB8 — jsr 0x5D2A (UNCONDITIONAL_CALL)
 *
 */

import type { GameState } from "./state.js";
import type { RomImage } from "./bus.js";

// ─── ROM addresses ────────────────────────────────────────────────────────

/** Byte ROM @ 0x10072: gate for the branch `D4 == 7` (D5w/A3w override). */
export const ROM_GATE_BYTE_ADDR = 0x00010072 as const;

// ─── Constants derived from the disasm ─────────────────────────────────────────

export const LOOP_ITER_COUNT = 16 as const;

export const CALLS_PER_ITER = 2 as const;

export const SPECIAL_ITER_D4 = 7 as const;

export const INIT_MASK = 0x8000 as const;

/** Init D5 (default, override to -11/0xFFF5 word if gate != 0). */
export const INIT_D5 = 5 as const;

/** Override D5 word if gate != 0 (`moveq #-0xb, D0`). */
export const OVERRIDE_D5W_GATE_NZ = 0xfff5 as const;

/** Init A3 (default, override to 4 if gate != 0). */
export const INIT_A3 = 0 as const;

/** Override A3 if gate != 0 (`moveq #4, D0`). */
export const OVERRIDE_A3_GATE_NZ = 4 as const;

export const ATTR_HIGHLIGHTED = 0xa0 as const;

export const ATTR_DEFAULT = 0x20 as const;

export const ATTR_RIGHT = 0 as const;

export const TRAILING_ARG = 0 as const;

// ─── Callback types ─────────────────────────────────────────────────────────

/**
 * Signature of `FUN_00003784` — "draw cell" callee.
 *
 *               if gate-byte != 0).
 *
 */
export type Sub5D2AInner3784 = (
  state: GameState,
  y: number,
  x: number,
  attr: number,
  extra: number,
) => number;

// ─── Helpers ──────────────────────────────────────────────────────────────

/**
 * Sign-extend low word of `v` to a long unsigned32.
 *   - if `v & 0x8000` -> hi word = 0xFFFF
 */
function signExtWord(v: number): number {
  return ((v & 0x8000) !== 0 ? (v | 0xffff0000) : (v & 0xffff)) >>> 0;
}

/** Add long unsigned32 (mod 2^32, equivalent to M68k `add.l`). */
function addLong(a: number, b: number): number {
  return ((a + b) | 0) >>> 0;
}

/** Sub long unsigned32 (mod 2^32). */
function subLong(a: number, b: number): number {
  return ((a - b) | 0) >>> 0;
}

// Replica.

/**
 *
 * Iterates 16 times (`D4 = 15..0`), for each iter:
 *      - `D5w = 0xFFF5` (instead of 5)
 *      - `A3 = 4` (instead of 0)
 *   3. Test `mask & arg0_word`: if set -> `A4 = 7`, else `A4 = 8`.
 *   6. CALL #1: `inner3784(y_signExt, (A3+A4)_signExt, attr_left, 0)`
 *   7. CALL #2: `inner3784(y_signExt, ((15-A4)+A3)_signExt, 0, 0)`
 *   8. `mask = (mask >> 1) & 0xFFFF` (word logical shift).
 *
 *                      MSB→LSB). High word ignored.
 *                      `arg1_low ∈ {0..15}`, the cell at `D4 == arg1_low`
 *                      iter 0 left, iter 0 right, iter 1 left, ... iter 15 right.
 *
 * @returns long unsigned32 (D0 at rts). In practice = D0 left by the last
 *          inner3784, or 0 if default no-op).
 *
 *
 *    overrides start from D0 long, hi 0).
 * 4. `D6w = (15-D4)*2 + D5w` (word add, mod 65536). Sign-ext to a long for `y`.
 *    NB: D4 in word range 0..15, D2w in range 0..0xFFFF. Match only if D2w
 * 6. `x_left = sign-ext(A3w) + sign-ext(A4w)` (long add).
 *    `x_right = sign-ext(15-A4) + sign-ext(A3w)` — computed as
 *    `(15 - sign-ext(A4w)) + sign-ext(A3w)` long.
 *
 * **Safety**: loop has exactly 16 iterations (no runaway). 32 callback calls.
 */
export function stateSub5D2A(
  state: GameState,
  rom: RomImage,
  arg0Long: number,
  arg1Long: number,
  inner3784: Sub5D2AInner3784 = () => 0,
): number {
  // long signature for consistency with the caller convention (push long RTL).
  const arg0Word = arg0Long & 0xffff;
  const arg1Word = arg1Long & 0xffff;

  // Init register state (post-prologue movem + setup).
  // A2 long = 0xFFFF8000 (sign-ext of 0x8000), but A2w = 0x8000 (mask).
  // Only A2w is used, so track it as a word.
  let maskWord: number = INIT_MASK; // 0x8000 -> 0x4000 -> ... -> 0x0001
  // D5 long = 5 (init `moveq #5,D5`). hi=0, lo=5.
  let d5Word: number = INIT_D5;
  // A3 long = 0 (init `clr.w D7w; movea.w D7w, A3`). hi=0, lo=0.
  let a3Word: number = INIT_A3; // low word, sign-ext for long ops.

  const gateByte = rom.program[ROM_GATE_BYTE_ADDR] ?? 0;

  // D0 at rts: propagated from the last `inner3784`. Default 0.
  let lastD0 = 0;

  // ─── Main loop: D4 = 15 → 0 (16 iter, signed bge.w on D4w) ───────
  for (let d4 = 15; d4 >= 0; d4--) {
    // ─── Special @ D4 == 7: gate-byte override ─────────────────────────
    if (d4 === SPECIAL_ITER_D4) {
      // tst.b ROM[0x10072]; beq → D5w = 5; bne → D5w = 0xFFF5.
      // `moveq #-0xb, D0` (D0 = 0xFFFFFFF5), then D5w = 0xFFF5.
      d5Word = gateByte === 0 ? INIT_D5 : OVERRIDE_D5W_GATE_NZ;

      a3Word = gateByte === 0 ? INIT_A3 : OVERRIDE_A3_GATE_NZ;
    }

    // ─── Test bit `mask & arg0_word` → A4 ∈ {7, 8} ─────────────────────
    // moveq #0, D0; move.w A2w, D0w; move.w D3w, D1w; ext.l D1; and.l D1,D0.
    // D0 = (mask zero-ext) & sign-ext(arg0_word). If arg0_word < 0x8000,
    // sign-ext = zero-ext (hi=0); if >= 0x8000, sign-ext (hi=0xFFFF). But
    const bitTest = (maskWord & arg0Word) >>> 0;
    const a4Word = bitTest === 0 ? 8 : 7;

    // ─── Calc D6w = (15-D4)*2 + D5w (word add) ─────────────────────────
    // D1 = 15 - D4 (long, sign-ext), asl.l #1 → *2. move.w D1w, D6w; add.w D5w, D6w.
    const d1Long = ((15 - d4) << 1) >>> 0; // (15-d4) * 2, range 0..30
    const d6Word = (d1Long + d5Word) & 0xffff; // word add wraps

    // cmp.w D2w, D4w → calc D4-D2; bne → attr = 0x20.
    const attrLeft = d4 === arg1Word ? ATTR_HIGHLIGHTED : ATTR_DEFAULT;

    // ─── CALL #1: inner3784(y, x_left, attr_left, 0) ──────────────────
    // y = sign-ext(D6w); x_left = sign-ext(A3w) + sign-ext(A4w) (long add).
    const yLong = signExtWord(d6Word);
    const xLeft = addLong(signExtWord(a3Word), signExtWord(a4Word));
    lastD0 = (inner3784(state, yLong, xLeft, attrLeft, TRAILING_ARG) >>> 0) >>> 0;

    // ─── CALL #2: inner3784(y, x_right, 0, 0) ─────────────────────────
    // x_right = (15 - sign-ext(A4w)) + sign-ext(A3w).
    // Disasm: `moveq #0xf,D0; move.w A4w,D1w; ext.l D1; sub.l D1,D0;
    //          move.w A3w,D1w; ext.l D1; add.l D1,D0`.
    // Equivalent to `(15 - signExt(A4w)) + signExt(A3w)` (long arithmetic).
    const xRight = addLong(subLong(15, signExtWord(a4Word)), signExtWord(a3Word));
    lastD0 = (inner3784(state, yLong, xRight, ATTR_RIGHT, TRAILING_ARG) >>> 0) >>> 0;

    // ─── Shift mask: A2w >>= 1 (logical word shift) ────────────────────
    // move.w A2w, D0w; lsr.w #1, D0w; movea.w D0w, A2.
    // movea.w D0w → A2 = sign-ext(0x4000) = 0x00004000 (hi=0). A2w = 0x4000.
    // Following iterations: 0x2000, 0x1000, ..., 0x0001, then 0x0000 at iter 16
    maskWord = (maskWord >>> 1) & 0xffff;
  }

  void state; // referenced for API / consistency
  return lastD0 >>> 0;
}
