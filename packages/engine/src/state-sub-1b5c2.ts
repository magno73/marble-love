/**
 * state-sub-1b5c2.ts - `FUN_0001B5C2` replica (838 bytes, 0x1B5C2-0x1B908).
 *
 * trackball/steering (`0x40069a-0x40069c` vs `0x400696-0x400698`), then
 * applies `absLong` / `negateIfPositive` to D3 (coord X long) and D4 (coord Y
 * long) of struct A2 based on 8 conditional blocks that test:
 *
 *   - flag cardinali @ `0x40066c/0x40066e/0x400670/0x400672` (byte)
 *   - gate word `0x400674/0x400676/0x400678/0x40067a`
 *   - gate word `0x40067c/0x40067e/0x400680/0x400682`
 *   - gate word `0x4006a0` (direct word)
 *   - gate word `*d2Addr` (word addressed through D2 register, address arg)
 *   - bit 0..7 of `(A3)` (direction bitmap)
 *   - D5.w (signed delta X) and D6.w (signed delta Y)
 *
 * struct A2 and sets changed flags `*0x400666` / `*0x400668`; if at least
 *
 * **Reconstructed prologue** (0x1B5C2..0x1B5F5, ~52 bytes):
 *   movem.l {D2-D6, A2-A4}, -(SP)
 *   movea.l ... A2           ; struct ptr (arg)
 *   movea.l ... A3           ; bitmap ptr (arg)
 *   movea.l ... A4           ; = &FUN_0001B5B4 (negateIfPositive fn, const)
 *   move.l  ... D2           ; word address (rotIdx-like, arg)
 *   move.l  (A2), D3         ; D3 = long @ A2+0 (x)
 *
 * **Xref**: unico caller `FUN_000121b8 @ 0x12338` (UNCONDITIONAL_CALL).
 *
 *
 * **Disasm 0x1B5F6..0x1B908**:
 *
 *   move.l (0x4,A2),D4
 *   move.w (0x0040069a).l,D5w
 *   sub.w  (0x00400696).l,D5w          ; D5 = delta_x (signed word)
 *   move.w (0x0040069c).l,D6w
 *   sub.w  (0x00400698).l,D6w          ; D6 = delta_y (signed word)
 *
 *   ; ── Block 1: absLong(D3) ─────────────────────────────────────────────
 *   tst.b  (0x40066c).l
 *   beq.b  → check1b
 *   cmpi.b #3,(0x40066c)
 *   bge.b  → check1b
 *   moveq  4,D0; exg D2,A0; cmp.w (A0),D0w; exg D2,A0
 *   ble.b  → check1b                   ; skip if word@d2Addr >= 4
 *   moveq  4,D0; cmp.w (0x400674),D0w
 *   ble.w  → absLong_D3                ; call if word@674 >= 4
 *  check1b:
 *   cmpi.b #2,(0x400670)
 *   ble.b  → end_blk1
 *   moveq  1,D0; cmp.w D5w,D0w; bne → end_blk1  ; D5 != 1
 *   moveq  4,D0; cmp.w (0x400678),D0w; bgt → end_blk1  ; word@678 < 4
 *  absLong_D3: D3 = absLong(D3)
 *  end_blk1:
 *
 *   ; ── Block 2: negateIfPositive(D4) ────────────────────────────────────
 *   tst.b  (0x40066e)
 *   beq.b  → check2b
 *   cmpi.b #3,(0x40066e); bge → check2b
 *   moveq  4,D0; cmp.w (0x4006a0),D0w; bge → check2b  ; word@6a0 <= 4
 *   moveq  4,D0; cmp.w (0x400676),D0w; ble.w → neg_D4
 *  check2b:
 *   cmpi.b #2,(0x400672); ble → end_blk2
 *   moveq -1,D0; cmp.w D6w,D0w; bne → end_blk2  ; D6 != -1
 *   moveq  4,D0; cmp.w (0x40067a),D0w; bgt → end_blk2  ; word@67a < 4
 *  neg_D4: D4 = negateIfPositive(D4)
 *  end_blk2:
 *
 *   ; ── Block 3: negateIfPositive(D4) ────────────────────────────────────
 *   tst.b  (0x400670); beq → check3b
 *   cmpi.b #3,(0x400670); bge → check3b
 *   moveq  4,D0; exg D2,A0; cmp.w (A0),D0w; exg D2,A0; bge → check3b  ; word@d2 <= 4
 *   moveq  4,D0; cmp.w (0x400678),D0w; ble.w → neg_D4b
 *  check3b:
 *   cmpi.b #2,(0x40066c); ble → end_blk3
 *   moveq -1,D0; cmp.w D5w,D0w; bne → end_blk3  ; D5 != -1
 *   moveq  4,D0; cmp.w (0x400674),D0w; bgt → end_blk3  ; word@674 < 4
 *  neg_D4b: D4 = negateIfPositive(D4)
 *  end_blk3:
 *
 *   ; ── Block 4: absLong(D4) ─────────────────────────────────────────────
 *   tst.b  (0x400672); beq → check4b
 *   cmpi.b #3,(0x400672); bge → check4b
 *   moveq  4,D0; cmp.w (0x4006a0),D0w; ble → check4b  ; word@6a0 >= 4
 *   moveq  4,D0; cmp.w (0x40067a),D0w; ble.w → abs_D4
 *  check4b:
 *   cmpi.b #2,(0x40066e); ble → end_blk4
 *   moveq  1,D0; cmp.w D6w,D0w; bne → end_blk4  ; D6 != 1
 *   moveq  4,D0; cmp.w (0x400676),D0w; bgt → end_blk4  ; word@676 < 4
 *  abs_D4: D4 = absLong(D4)
 *  end_blk4:
 *
 *   ; ── Block 5: negateIfPositive(D4) + absLong(D3) ─────────────────────
 *   btst.b #0,(A3); beq → check5b
 *   moveq -1,D0; cmp.w D5w,D0w; beq → check5b  ; D5==-1
 *   moveq  1,D0; cmp.w D6w,D0w; beq → check5b  ; D6==1
 *   moveq  4,D0; exg D2,A0; cmp.w (A0),D0w; exg D2,A0; ble → check5b  ; word@d2 >= 4
 *   moveq  4,D0; cmp.w (0x4006a0),D0w; bge → check5b  ; word@6a0 <= 4
 *   moveq  4,D0; cmp.w (0x40007c),D0w; ble → call5    ; word@7c >= 4
 *  check5b:
 *   btst.b #6,(A3); beq → end_blk5
 *   tst.w D5w; beq → end_blk5    ; D5==0
 *   tst.w D6w; beq → end_blk5    ; D6==0
 *   moveq 4,D0; cmp.w (0x400080),D0w; bgt → end_blk5  ; word@680 < 4
 *  call5: D4 = negateIfPositive(D4); D3 = absLong(D3)
 *  end_blk5:
 *
 *   ; ── Block 6: negateIfPositive(D4) + negateIfPositive(D3) ────────────
 *   btst.b #1,(A3); beq → check6b
 *   moveq  1,D0; cmp.w D5w,D0w; beq → check6b   ; D5==1
 *   moveq  1,D0; cmp.w D6w,D0w; beq → check6b   ; D6==1
 *   moveq  4,D0; exg D2,A0; cmp.w (A0),D0w; exg D2,A0; bge → check6b  ; word@d2 <= 4
 *   moveq  4,D0; cmp.w (0x4006a0),D0w; bge → check6b  ; word@6a0 <= 4
 *   moveq  4,D0; cmp.w (0x40007e),D0w; ble → call6
 *  check6b:
 *   btst.b #7,(A3); beq → end_blk6
 *   tst.w D5w; beq → end_blk6
 *   tst.w D6w; beq → end_blk6
 *   moveq 4,D0; cmp.w (0x400082),D0w; bgt → end_blk6
 *  call6: D4 = negateIfPositive(D4); D3 = negateIfPositive(D3)
 *  end_blk6:
 *
 *   ; ── Block 7: absLong(D4) + negateIfPositive(D3) ─────────────────────
 *   btst.b #2,(A3); beq → check7b
 *   moveq  1,D0; cmp.w D5w,D0w; beq → check7b   ; D5==1
 *   moveq -1,D0; cmp.w D6w,D0w; beq → check7b   ; D6==-1
 *   moveq  4,D0; exg D2,A0; cmp.w (A0),D0w; exg D2,A0; bge → check7b  ; word@d2 <= 4
 *   moveq  4,D0; cmp.w (0x4006a0),D0w; ble → check7b  ; word@6a0 >= 4
 *   moveq  4,D0; cmp.w (0x400080),D0w; ble → call7
 *  check7b:
 *   btst.b #4,(A3); beq → end_blk7
 *   tst.w D5w; beq → end_blk7
 *   tst.w D6w; beq → end_blk7
 *   moveq 4,D0; cmp.w (0x40007c),D0w; bgt → end_blk7
 *  call7: D4 = absLong(D4); D3 = negateIfPositive(D3)
 *  end_blk7:
 *
 *   ; ── Block 8: absLong(D4) + absLong(D3) ──────────────────────────────
 *   btst.b #3,(A3); beq → check8b
 *   moveq -1,D0; cmp.w D5w,D0w; beq → check8b   ; D5==-1
 *   moveq -1,D0; cmp.w D6w,D0w; beq → check8b   ; D6==-1
 *   moveq  4,D0; exg D2,A0; cmp.w (A0),D0w; exg D2,A0; ble → check8b  ; word@d2 >= 4
 *   moveq  4,D0; cmp.w (0x4006a0),D0w; ble → check8b  ; word@6a0 >= 4
 *   moveq  4,D0; cmp.w (0x400082),D0w; ble → call8
 *  check8b:
 *   btst.b #5,(A3); beq → end_blk8
 *   tst.w D5w; beq → end_blk8
 *   tst.w D6w; beq → end_blk8
 *   moveq 4,D0; cmp.w (0x40007e),D0w; bgt → end_blk8
 *  call8: D4 = absLong(D4); D3 = absLong(D3)
 *  end_blk8:
 *
 *   ; ── Write-back ───────────────────────────────────────────────────────
 *   cmp.l (A2),D3; beq → no_x
 *     move.b #1,(0x400666)
 *     move.l (0x400684),(0xc,A2)
 *     move.l D3,(A2)
 *  no_x:
 *   cmp.l (0x4,A2),D4; beq → no_y
 *     move.b #1,(0x400668)
 *     move.l (0x400688),(0x10,A2)
 *     move.l D4,(0x4,A2)
 *  no_y:
 *   tst.b (0x400666); bne → sound
 *   tst.b (0x400668); beq → exit
 *  sound:
 *   pea (0x34); jsr FUN_158AC; addq.l #4,SP
 *  exit:
 *   movem.l (SP)+,{D2-D6,A2-A4}
 *   rts
 */

import type { GameState } from "./state.js";
import { absLong, negateIfPositive } from "./math-helpers.js";

// ─── workRam offsets (absolute addr - 0x400000) ──────────────────────────

/** Byte @ 0x400666: x-changed flag. Set to 1 when D3 changes. */
export const CHG_X_OFF = 0x666 as const;
/** Byte @ 0x400668: y-changed flag. Set to 1 when D4 changes. */
export const CHG_Y_OFF = 0x668 as const;
/** Byte @ 0x40066c: cardinal +X direction flag (0=off, 1|2=active, ≥3=off). */
export const FLAG_PX_OFF = 0x66c as const;
/** Byte @ 0x40066e: cardinal +Y direction flag. */
export const FLAG_PY_OFF = 0x66e as const;
/** Byte @ 0x400670: cardinal -X direction flag. */
export const FLAG_NX_OFF = 0x670 as const;
/** Byte @ 0x400672: cardinal -Y direction flag. */
export const FLAG_NY_OFF = 0x672 as const;
/** Word @ 0x400674: speed gate for +X path. */
export const GATE_PX_OFF = 0x674 as const;
/** Word @ 0x400676: speed gate for +Y path. */
export const GATE_PY_OFF = 0x676 as const;
/** Word @ 0x400678: speed gate for -X / blk1b / blk3a path. */
export const GATE_NX_OFF = 0x678 as const;
/** Word @ 0x40067a: speed gate for -Y / blk2b / blk4a path. */
export const GATE_NY_OFF = 0x67a as const;
/** Word @ 0x40067c: gate for btst#0-pathA / btst#4-pathB. */
export const GATE_7C_OFF = 0x67c as const;
/** Word @ 0x40067e: gate for btst#1-pathA / btst#5-pathB. */
export const GATE_7E_OFF = 0x67e as const;
/** Word @ 0x400680: gate for btst#6-pathB / btst#2-pathA. */
export const GATE_80_OFF = 0x680 as const;
/** Word @ 0x400682: gate for btst#7-pathB / btst#3-pathA. */
export const GATE_82_OFF = 0x682 as const;
/** Long @ 0x400684: written to (0xc,A2) when x changes. */
export const STRUCT_X_SRC_OFF = 0x684 as const;
/** Long @ 0x400688: written to (0x10,A2) when y changes. */
export const STRUCT_Y_SRC_OFF = 0x688 as const;
/** Word @ 0x4006a0: used in blk2a/blk4a/btst#0-5 gate comparisons. */
export const GATE_A0_OFF = 0x6a0 as const;
/** Word @ 0x40069a: trackball/steering current x. */
export const TRACK_X_CUR_OFF = 0x69a as const;
/** Word @ 0x400696: trackball/steering base x. */
export const TRACK_X_BASE_OFF = 0x696 as const;
/** Word @ 0x40069c: trackball/steering current y. */
export const TRACK_Y_CUR_OFF = 0x69c as const;
/** Word @ 0x400698: trackball/steering base y. */
export const TRACK_Y_BASE_OFF = 0x698 as const;

/** Sound cmd sent by FUN_158AC. */
export const SOUND_CMD = 0x34 as const;

// ─── Sub injection ────────────────────────────────────────────────────────

export interface StateSub1B5C2Subs {
  /** `FUN_000158AC(state, cmd)` — sound command sender. Default no-op. */
  fun_158ac?: (state: GameState, cmd: number) => void;
}

// ─── Result ──────────────────────────────────────────────────────────────

export interface StateSub1B5C2Result {
  /** Initial x coord (D3 start). */
  d3In: number;
  /** Final x coord (D3 end). */
  d3Out: number;
  /** Initial y coord (D4 start). */
  d4In: number;
  /** Final y coord (D4 end). */
  d4Out: number;
  /** True if x changed (flag @ 0x400666 set). */
  xChanged: boolean;
  /** True if y changed (flag @ 0x400668 set). */
  yChanged: boolean;
  /** True if FUN_158AC was called. */
  soundFired: boolean;
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function rb(state: GameState, off: number): number {
  return (state.workRam[off] ?? 0) & 0xff;
}

function wb(state: GameState, off: number, v: number): void {
  state.workRam[off] = v & 0xff;
}

function rw(state: GameState, off: number): number {
  return (((state.workRam[off] ?? 0) << 8) | (state.workRam[off + 1] ?? 0)) & 0xffff;
}

function rl(state: GameState, off: number): number {
  return (
    (((state.workRam[off] ?? 0) << 24) |
      ((state.workRam[off + 1] ?? 0) << 16) |
      ((state.workRam[off + 2] ?? 0) << 8) |
      (state.workRam[off + 3] ?? 0)) >>>
    0
  );
}

function wl(state: GameState, off: number, v: number): void {
  const x = v >>> 0;
  state.workRam[off] = (x >>> 24) & 0xff;
  state.workRam[off + 1] = (x >>> 16) & 0xff;
  state.workRam[off + 2] = (x >>> 8) & 0xff;
  state.workRam[off + 3] = x & 0xff;
}

/** Convert absolute m68k addr to workRam offset (subtract 0x400000). */
function ao(addr: number): number {
  return (addr - 0x400000) >>> 0;
}

/** Sign-extend 16-bit word to signed int. */
function sextW(w: number): number {
  const v = w & 0xffff;
  return v & 0x8000 ? v - 0x10000 : v;
}

/** Sign-extend 8-bit byte to signed int. */
function sextB(b: number): number {
  const v = b & 0xff;
  return v & 0x80 ? v - 0x100 : v;
}

// ─── Replica ─────────────────────────────────────────────────────────────

/**
 *
 *                +4 (y long), +0xC (dest x long), +0x10 (dest y long)
 *                `btst.b #N,(A3)` per N=0..7
 *                `exg D2,A0; cmp.w (A0),D0w` (tipicamente offset rotazione)
 * @param subs    Injection per `FUN_000158AC` (default no-op)
 */
export function stateSub1B5C2(
  state: GameState,
  a2Addr: number,
  a3Addr: number,
  d2Addr: number,
  subs?: StateSub1B5C2Subs,
): StateSub1B5C2Result {
  const a2 = ao(a2Addr);
  const a3 = ao(a3Addr);
  const d2 = ao(d2Addr);

  // ── Prologue: load D3 (x), D4 (y), D5 (delta_x), D6 (delta_y) ──────────
  // D3 = long @ A2+0 (x coord)
  let d3 = rl(state, a2);
  const d3In = d3;
  // D4 = long @ A2+4 (y coord) — loaded at 0x1B5F6
  let d4 = rl(state, a2 + 4);
  const d4In = d4;

  // D5.w = word@69a - word@696 (delta_x, signed word)
  const d5raw = sextW((rw(state, TRACK_X_CUR_OFF) - rw(state, TRACK_X_BASE_OFF)) & 0xffff);
  // D6.w = word@69c - word@698 (delta_y, signed word)
  const d6raw = sextW((rw(state, TRACK_Y_CUR_OFF) - rw(state, TRACK_Y_BASE_OFF)) & 0xffff);

  // Signed word deltas (kept as i16-range integers).
  const d5 = d5raw;
  const d6 = d6raw;

  // word@D2 (read as unsigned, compared as signed word)
  const wd2 = sextW(rw(state, d2));
  // word@6a0
  const wa0 = sextW(rw(state, GATE_A0_OFF));

  // Gate words — compared as signed: "cmp.w (addr),D0w" with D0.w=4 and ble/bgt.
  // ble: skip if 4 <= mem (i.e., proceed if 4 > mem, i.e., mem < 4 ← gate active if ≥4)
  // Wait: ble branches (skips to call) if D0.w ≤ mem.w. So `ble → call` means
  // "jump to call if 4 ≤ mem", i.e., call if mem ≥ 4 (signed).
  // bgt: skip if D0.w > mem. D0.w=4. "bgt → skip" means skip if 4 > mem (i.e., mem < 4).
  // So `bgt → skip` is: call if mem ≥ 4.
  const gPX = sextW(rw(state, GATE_PX_OFF));
  const gPY = sextW(rw(state, GATE_PY_OFF));
  const gNX = sextW(rw(state, GATE_NX_OFF));
  const gNY = sextW(rw(state, GATE_NY_OFF));
  const g7C = sextW(rw(state, GATE_7C_OFF));
  const g7E = sextW(rw(state, GATE_7E_OFF));
  const g80 = sextW(rw(state, GATE_80_OFF));
  const g82 = sextW(rw(state, GATE_82_OFF));

  // Direction flags (byte) — signed cmp.b: active if non-zero and < 3.
  const fPX = sextB(rb(state, FLAG_PX_OFF));
  const fPY = sextB(rb(state, FLAG_PY_OFF));
  const fNX = sextB(rb(state, FLAG_NX_OFF));
  const fNY = sextB(rb(state, FLAG_NY_OFF));

  // Direction bitmap bits (A3)
  const bm = rb(state, a3);

  // ── Block 1: absLong(D3) ────────────────────────────────────────────────
  // Path A: fPX ∈ [1,2] AND wd2 < 4 AND gPX >= 4
  // Path B: fNX > 2      AND d5 == 1 AND gNX >= 4
  {
    const pathA = fPX !== 0 && fPX < 3 && wd2 < 4 && gPX >= 4;
    const pathB = fNX > 2 && d5 === 1 && gNX >= 4;
    if (pathA || pathB) {
      d3 = absLong(d3);
    }
  }

  // ── Block 2: negateIfPositive(D4) ───────────────────────────────────────
  // Path A: fPY ∈ [1,2] AND wa0 > 4 AND gPY >= 4
  // Path B: fNY > 2      AND d6 == -1 AND gNY >= 4
  {
    const pathA = fPY !== 0 && fPY < 3 && wa0 > 4 && gPY >= 4;
    const pathB = fNY > 2 && d6 === -1 && gNY >= 4;
    if (pathA || pathB) {
      d4 = negateIfPositive(d4);
    }
  }

  // ── Block 3: negateIfPositive(D3) ───────────────────────────────────────
  // Path A: fNX ∈ [1,2] AND wd2 > 4 AND gNX >= 4
  // Path B: fPX > 2      AND d5 == -1 AND gPX >= 4
  // Note: block 3 modifies D3 (jsr (A4) with D3 on stack), not D4.
  {
    const pathA = fNX !== 0 && fNX < 3 && wd2 > 4 && gNX >= 4;
    const pathB = fPX > 2 && d5 === -1 && gPX >= 4;
    if (pathA || pathB) {
      d3 = negateIfPositive(d3);
    }
  }

  // ── Block 4: absLong(D4) ────────────────────────────────────────────────
  // Path A: fNY ∈ [1,2] AND wa0 < 4 AND gNY >= 4
  // Path B: fPY > 2      AND d6 == 1 AND gPY >= 4
  {
    const pathA = fNY !== 0 && fNY < 3 && wa0 < 4 && gNY >= 4;
    const pathB = fPY > 2 && d6 === 1 && gPY >= 4;
    if (pathA || pathB) {
      d4 = absLong(d4);
    }
  }

  // ── Block 5: negateIfPositive(D4) + absLong(D3) ─────────────────────────
  // Path A (btst#0): bit0 set AND d5 != -1 AND d6 != 1 AND wd2 < 4 AND wa0 > 4 AND g7C >= 4
  // Path B (btst#6): bit6 set AND d5 != 0  AND d6 != 0  AND g80 >= 4
  {
    const pathA =
      (bm & 0x01) !== 0 && d5 !== -1 && d6 !== 1 && wd2 < 4 && wa0 > 4 && g7C >= 4;
    const pathB = (bm & 0x40) !== 0 && d5 !== 0 && d6 !== 0 && g80 >= 4;
    if (pathA || pathB) {
      d4 = negateIfPositive(d4);
      d3 = absLong(d3);
    }
  }

  // ── Block 6: negateIfPositive(D4) + negateIfPositive(D3) ────────────────
  // Path A (btst#1): bit1 set AND d5 != 1 AND d6 != 1 AND wd2 > 4 AND wa0 > 4 AND g7E >= 4
  // Path B (btst#7): bit7 set AND d5 != 0 AND d6 != 0 AND g82 >= 4
  {
    const pathA =
      (bm & 0x02) !== 0 && d5 !== 1 && d6 !== 1 && wd2 > 4 && wa0 > 4 && g7E >= 4;
    const pathB = (bm & 0x80) !== 0 && d5 !== 0 && d6 !== 0 && g82 >= 4;
    if (pathA || pathB) {
      d4 = negateIfPositive(d4);
      d3 = negateIfPositive(d3);
    }
  }

  // ── Block 7: absLong(D4) + negateIfPositive(D3) ─────────────────────────
  // Path A (btst#2): bit2 set AND d5 != 1 AND d6 != -1 AND wd2 > 4 AND wa0 < 4 AND g80 >= 4
  // Path B (btst#4): bit4 set AND d5 != 0 AND d6 != 0  AND g7C >= 4
  {
    const pathA =
      (bm & 0x04) !== 0 && d5 !== 1 && d6 !== -1 && wd2 > 4 && wa0 < 4 && g80 >= 4;
    const pathB = (bm & 0x10) !== 0 && d5 !== 0 && d6 !== 0 && g7C >= 4;
    if (pathA || pathB) {
      d4 = absLong(d4);
      d3 = negateIfPositive(d3);
    }
  }

  // ── Block 8: absLong(D4) + absLong(D3) ──────────────────────────────────
  // Path A (btst#3): bit3 set AND d5 != -1 AND d6 != -1 AND wd2 < 4 AND wa0 < 4 AND g82 >= 4
  // Path B (btst#5): bit5 set AND d5 != 0  AND d6 != 0  AND g7E >= 4
  {
    const pathA =
      (bm & 0x08) !== 0 && d5 !== -1 && d6 !== -1 && wd2 < 4 && wa0 < 4 && g82 >= 4;
    const pathB = (bm & 0x20) !== 0 && d5 !== 0 && d6 !== 0 && g7E >= 4;
    if (pathA || pathB) {
      d4 = absLong(d4);
      d3 = absLong(d3);
    }
  }

  // ── Write-back ───────────────────────────────────────────────────────────
  // cmp.l (A2),D3 — compare D3 with *A2 (old x, long)
  // Note: already have d3In = original *A2 (since D3 was loaded from A2+0).
  let xChanged = false;
  let yChanged = false;

  if ((d3 >>> 0) !== d3In) {
    xChanged = true;
    wb(state, CHG_X_OFF, 1);
    // move.l (0x400684).l,(0xc,A2)
    wl(state, a2 + 0xc, rl(state, STRUCT_X_SRC_OFF));
    // move.l D3,(A2)
    wl(state, a2, d3);
  }

  if ((d4 >>> 0) !== d4In) {
    yChanged = true;
    wb(state, CHG_Y_OFF, 1);
    // move.l (0x400688).l,(0x10,A2)
    wl(state, a2 + 0x10, rl(state, STRUCT_Y_SRC_OFF));
    // move.l D4,(0x4,A2)
    wl(state, a2 + 4, d4);
  }

  // tst.b (0x400666) ; bne → sound ; tst.b (0x400668) ; beq → exit
  // Note: the test reads the *current* flag values (which may have been set
  // above, or were already set from a previous call).
  let soundFired = false;
  const flagX = rb(state, CHG_X_OFF);
  const flagY = rb(state, CHG_Y_OFF);
  if (flagX !== 0 || flagY !== 0) {
    subs?.fun_158ac?.(state, SOUND_CMD);
    soundFired = true;
  }

  return { d3In, d3Out: d3 >>> 0, d4In, d4Out: d4 >>> 0, xChanged, yChanged, soundFired };
}
