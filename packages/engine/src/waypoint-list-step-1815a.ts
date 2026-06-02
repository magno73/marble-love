/**
 * waypoint-list-step-1815a.ts — `FUN_0001815A` replica (352 bytes).
 *
 * Reads waypoint records from the ROM table @ `0x1d364 + gameMode*4`.
 * Each waypoint record occupies one slot. It steers toward the waypoint,
 * updates `[A2+0x0..0x7]`, and (if flag `[A2+0x36]` is set)
 *
 * **Disasm 0x1815A..0x182BA** (352 bytes) — summary:
 *
 *   movem.l {D2-D6,A2,A3},-(SP)
 *   movea.l (0x20,SP),A2                 ; A2 = arg long (entity ptr)
 * loop:                                  ; @ 0x18162
 *   movea.l (0x00400446).l,A3            ; A3 = global cursor
 *   tst.b   (A3)
 *   beq.w   exit_rts                     ; terminator → return
 *   ; ─── compute D2 = sx<<19 - [A2+0xc] + 0x40000 ────────────────────
 *   move.b  (A3),D0b                     ; sx (signed)
 *   ext.w D0; ext.l D0
 *   move.l  D0,D2
 *   moveq   #0x13,D1
 *   asl.l   D1,D2
 *   sub.l   (0xc,A2),D2
 *   addi.l  #0x40000,D2
 *   ; ─── D3 = sy<<19 - [A2+0x10] + 0x40000 ───────────────────────────
 *   move.b  (0x1,A3),D0b                 ; sy (signed)
 *   ext.w D0; ext.l D0
 *   move.l  D0,D3
 *   asl.l   D1,D3                        ; (D1=0x13)
 *   sub.l   (0x10,A2),D3
 *   addi.l  #0x40000,D3
 *   ; ─── D5 = sm<<16 ─────────────────────────────────────────────────
 *   move.b  (0x2,A3),D0b                 ; sm (signed magnitude)
 *   ext.w D0; ext.l D0
 *   move.l  D0,D5
 *   moveq   #0x10,D1
 *   asl.l   D1,D5
 *   ; ─── D4.w = abs(D2) >> 12 ─────────────────────────────────────────
 *   tst.l D2; bge skip1; D0 = -D2; bra take; skip1: D0 = D2
 *   moveq   #0xc,D1
 *   asr.l   D1,D0
 *   move.w  D0w,D4w
 *   ; ─── D6.w = abs(D3) >> 12 ─────────────────────────────────────────
 *   tst.l D3; bge skip2; D0 = -D3; bra take2; skip2: D0 = D3
 *   asr.l D1,D0
 *   move.w  D0w,D6w
 *   ; ─── range check: out-of-range → L18222 (apply accel + return) ──
 *   moveq   #0x20,D0
 *   cmp.w   D4w,D0w; bls.b L18222         ; if 0x20 <= D4 → out of range
 *   moveq   #0x20,D0
 *   cmp.w   D6w,D0w; bls.b L18222         ; if 0x20 <= D6 → out of range
 *   ; ─── in range: optional sound trigger ─────────────────────────────
 *   tst.b   (0x3,A3); blt.b skip_sound    ; if signed byte <0 (bit 7 set) → skip
 *   pea     (0x5a).w                      ; push 0x5a long
 *   pea     (0x3400).w                    ; push 0x3400 long
 *   move.b  (0x3,A3),D0b
 *   ext.w   D0w
 *   asl.w   #0x2,D0w                      ; D0w *= 4 (table index)
 *   movea.l #0x242aa,A0
 *   move.l  (0x0,A0,D0w*0x1),-(SP)        ; push *(table + D0w) long
 *   jsr     0x0000012a.l                  ; sound dispatch
 *   lea     (0xc,SP),SP                   ; pop 3 longs
 * skip_sound:
 *   addq.l  #0x4,A3                       ; advance to next record
 *   tst.b   (A3)
 *   bne.b   no_terminator
 *   move.w  #0x1,(0x0040075a).l           ; signal: list exhausted
 *   move.b  #-0x1,(0x6e,A2)               ; entity[0x6e] = 0xFF
 * no_terminator:
 *   move.l  A3,(0x00400446).l             ; commit cursor
 *   bra.w   loop
 *
 * L18222 (out-of-range branch):
 *   ; ─── denom: D1.w = (smaller>>3)*3 + larger ───────────────────────
 *   cmp.w   D6w,D4w
 *   bls.b   use_d4_smaller                ; if D4<=D6, D4 is smaller
 *   move.w  D6w,D1w; lsr.w #3,D1w         ; D1.w = D6>>3
 *   mulu.w  #3,D1                         ; D1 = D1.w * 3 (32-bit unsigned)
 *   add.w   D4w,D1w                       ; D1.w += D4 (word add)
 *   bra.b   denom_done
 * use_d4_smaller:
 *   move.w  D4w,D1w; lsr.w #3,D1w
 *   mulu.w  #3,D1
 *   add.w   D6w,D1w
 * denom_done:
 *   tst.w   D1w
 *   beq.b   denom_zero
 *   move.l  D2,D0; divs.w D1w,D0; move.w D0w,D2w   ; D2.w = sext_div(D2,D1.w)
 *   move.l  D3,D0; divs.w D1w,D0; move.w D0w,D3w
 *   bra.b   after_div
 * denom_zero:
 *   clr.w   D2w; move.w D2w,D3w           ; D2.w = D3.w = 0 (only word!)
 * after_div:
 *   moveq   #0x40,D0
 *   cmp.w   D1w,D0w
 *   bls.b   skip_d5_override               ; if 0x40 <= D1.w → skip override
 *   move.l  #0xc000,D5                     ; D5 = 0xC000 (unsigned)
 * skip_d5_override:
 *   move.l  D5,D0
 *   asr.l   #0x8,D0                        ; D0 = signed_asr(D5, 8)
 *   move.w  D0w,D1w                        ; D1.w = (D5 asr 8).w
 *   move.w  D1w,D0w
 *   muls.w  D2w,D0                         ; D0 = sext16(D1.w) * sext16(D2.w) [32-bit]
 *   move.l  D0,D2
 *   asr.l   #0x4,D2                        ; D2 >>= 4 (signed)
 *   move.w  D1w,D0w
 *   muls.w  D3w,D0
 *   move.l  D0,D3
 *   asr.l   #0x4,D3
 *   move.l  D2,D0
 *   sub.l   (A2),D0
 *   asr.l   #0x3,D0                        ; D0 = (D2 - [A2]) >> 3 signed
 *   move.l  D3,D1
 *   sub.l   (0x4,A2),D1
 *   asr.l   #0x3,D1
 *   add.l   D0,(A2)                        ; [A2] += D0
 *   move.l  D1,D0
 *   add.l   D0,(0x4,A2)                    ; [A2+4] += D1
 *   tst.b   (0x36,A2)
 *   beq.b   skip_grav
 *   addi.l  #-0x6000,(0x8,A2)              ; [A2+8] -= 0x6000 (gravity)
 *   cmpi.l  #-0x50000,(0x8,A2)
 *   bge.b   skip_grav                      ; if [A2+8] >= -0x50000, no clamp
 *   move.l  #-0x50000,(0x8,A2)             ; clamp
 * skip_grav:
 *   move.l  A2,-(SP)
 *   jsr     0x00026196.l                   ; FUN_26196(entity)
 *   addq.l  #0x4,SP
 * exit_rts:
 *   movem.l (SP)+,{D2-D6,A2,A3}
 *   rts
 *
 * ## Semantics
 *
 *     `(sx_i8, sy_i8, sm_i8, sound_i8)` terminated by byte 0 (`*A3 == 0`).
 *       dx = (sx<<19) - entity.x + 0x40000
 *       dy = (sy<<19) - entity.y + 0x40000
 *       D4 = abs(dx) >> 12, D6 = abs(dy) >> 12 (low word, signed asr)
 *       in_range ⇔ D4 < 0x20 && D6 < 0x20
 *   - **If in range**:
 *       1. If sound_idx (signed) >= 0: dispatch sound via JSR 0x12a, passing
 *          (0x5a, 0x3400, table[0x242aa + sound_idx*4]). External sub,
 *          stub-injectable.
 *          - `*(0x40075a).w = 1`
 *          - `entity[0x6e].b = 0xff`
 *       D1.w = ((min(D4,D6) >> 3) * 3 + max(D4,D6)) & 0xffff
 *       If D1.w == 0: dx.w = dy.w = 0 (low word only!)
 *       k = signed_asr(D5, 8) & 0xffff
 *       vx = signed_asr(sext16(k) * sext16(dx.w), 4)
 *       vy = signed_asr(sext16(k) * sext16(dy.w), 4)
 *       step_x = (vx - entity.x) >> 3 signed
 *       step_y = (vy - entity.y) >> 3 signed
 *       entity.x += step_x; entity.y += step_y
 *       If entity[0x36] != 0:
 *         entity.z -= 0x6000
 *         if entity.z < -0x50000: entity.z = -0x50000
 *
 * ## External JSRs
 *
 *     in-range with sound_idx >= 0). 3 long args: (0x5a, 0x3400, table_value).
 *     Exposed as `subs.fun_012a`. Default no-op.
 *   - `FUN_00026196` (flag-scaled magnitude dispatch, replicated in the
 *     out-of-range branch. Exposed as `subs.fun_26196`. Default no-op.
 *
 *
 *   only if sound_idx >= 0. Our replica exposes a callback
 *   image; by default we read from `state.rom` if available.
 *
 * ## Side effects in `state.workRam`
 *
 *   - `entity[0x0..0x7]` modified (32-bit signed add) in the out-of-range branch.
 *   - `entity[0x8..0xb]` modified if `entity[0x36] != 0`.
 *   - `*(0x400446)` (long) advanced by N*4 bytes (N = records consumed in range).
 *   - `*(0x40075a)` (word) = 1 if the list is exhausted.
 *
 * ## Caller
 *
 *   - `FUN_017F66 @ 0x17f8e`: gate `*(0x400390).w == 1` (homing-mode flag).
 *   - `FUN_000253ec @ 0x254de`: secondary caller.
 *
 */

import type { GameState } from "./state.js";

// ─── Globals (absolute m68k) ─────────────────────────────────────────────

export const GLOBAL_LIST_PTR_ADDR = 0x00400446 as const;
export const GLOBAL_EXHAUSTED_FLAG_ADDR = 0x0040075a as const;

// ─── Entity offsets ──────────────────────────────────────────────────────

/** Entity X 32-bit (fixed-point format). */
export const ENTITY_X_OFFSET = 0x00 as const;
/** Entity Y 32-bit. */
export const ENTITY_Y_OFFSET = 0x04 as const;
/** Entity Z 32-bit (modified if gravity flag set). */
export const ENTITY_Z_OFFSET = 0x08 as const;
export const ENTITY_TARGET_X_OFFSET = 0x0c as const;
/** Target Y. */
export const ENTITY_TARGET_Y_OFFSET = 0x10 as const;
export const ENTITY_GRAVITY_FLAG_OFFSET = 0x36 as const;
/** "List-end-reached" marker byte (set to 0xFF when the list is exhausted). */
export const ENTITY_LIST_END_OFFSET = 0x6e as const;

// ─── Algorithm constants ───────────────────────────────────────────────────

/** Additive bias applied to the deltas: sext(byte) << 19 - entity.field + bias. */
export const DELTA_BIAS = 0x40000 as const;
/** In-range threshold (asr 12 of abs(delta)). */
export const RANGE_THRESHOLD = 0x20 as const;
export const D5_OVERRIDE = 0xc000 as const;
/** Threshold for the D5 override. */
export const D5_OVERRIDE_DENOM_LIMIT = 0x40 as const;
/** Z decrement (gravity-like). */
export const Z_DECREMENT = -0x6000 as const;
/** Z floor (saturation lower bound). */
export const Z_FLOOR = -0x50000 as const;
/** Sound dispatch arg #0 (push pea (0x5a).w). */
export const SOUND_ARG0 = 0x5a as const;
/** Sound dispatch arg #1 (push pea (0x3400).w). */
export const SOUND_ARG1 = 0x3400 as const;
/** Base ROM table address for the sound table lookup. */
export const SOUND_TABLE_ADDR = 0x000242aa as const;
/** Size of a waypoint record (4 bytes). */
export const WAYPOINT_RECORD_SIZE = 4 as const;
export const MAX_LIST_ITERATIONS = 1024 as const;

// ─── Sub injection ───────────────────────────────────────────────────────

/**
 * Stub injection for the external JSRs.
 *
 *   `(SOUND_ARG0, SOUND_ARG1, tableValue)`.
 * - `lookupSoundTable`: lookup `*(SOUND_TABLE_ADDR + idx*4)` 32-bit BE.
 *   Default 0 (matching the stubbed binary). For true parity, the ROM image
 */
export interface WaypointListStep1815ASubs {
  fun_012a?: (arg0: number, arg1: number, tableValue: number) => void;
  fun_26196?: (state: GameState, entityAddr: number) => void;
  lookupSoundTable?: (idx: number) => number;
}


/** Termination type of the call. */
export type ExitMode = "out_of_range" | "list_exhausted" | "list_empty";

export interface WaypointListStep1815AResult {
  exitMode: ExitMode;
  /** Records consumed (in-range advances). */
  recordsConsumed: number;
  /** Number of sound dispatches invoked. */
  soundDispatches: number;
  fun26196Called: boolean;
  listEndMarkerSet: boolean;
}

// ─── Helpers (read/write workRam, signed arithmetic 68k) ────────────────

function readByte(state: GameState, off: number): number {
  return (state.workRam[off] ?? 0) & 0xff;
}

function writeByte(state: GameState, off: number, v: number): void {
  state.workRam[off] = v & 0xff;
}

function readLongBE(state: GameState, off: number): number {
  return (
    (((state.workRam[off] ?? 0) << 24) |
      ((state.workRam[off + 1] ?? 0) << 16) |
      ((state.workRam[off + 2] ?? 0) << 8) |
      (state.workRam[off + 3] ?? 0)) >>>
    0
  );
}

function writeLongBE(state: GameState, off: number, v: number): void {
  const u = v >>> 0;
  state.workRam[off] = (u >>> 24) & 0xff;
  state.workRam[off + 1] = (u >>> 16) & 0xff;
  state.workRam[off + 2] = (u >>> 8) & 0xff;
  state.workRam[off + 3] = u & 0xff;
}

function readWordBE(state: GameState, off: number): number {
  return (((state.workRam[off] ?? 0) << 8) | (state.workRam[off + 1] ?? 0)) & 0xffff;
}

function writeWordBE(state: GameState, off: number, v: number): void {
  state.workRam[off] = (v >>> 8) & 0xff;
  state.workRam[off + 1] = v & 0xff;
}

/** Signed 32-bit asr with `count & 0x3F`. */
function asrL(value: number, count: number): number {
  const c = count & 0x3f;
  return ((value | 0) >> c) | 0;
}

/** Convert 32-bit unsigned to signed. */
function s32(v: number): number {
  return v | 0;
}

/** Convert 16-bit value (low word) to signed 16. */
function s16(v: number): number {
  const w = v & 0xffff;
  return w & 0x8000 ? w - 0x10000 : w;
}

/** Sign-extend signed 8-bit byte to 32-bit signed. */
function sextB(v: number): number {
  const b = v & 0xff;
  return b & 0x80 ? b - 0x100 : b;
}

/**
 * 68k `divs.w` semantics: signed 32-bit / signed 16-bit.
 *
 * In M68K, divs.w <ea>, Dn:
 *   - Dn (32-bit signed) / sext16(<ea>) truncated toward zero
 *   - If the quotient fits in signed 16-bit [-0x8000..0x7FFF]:
 *       Dn.low_word = quot, Dn.high_word = remainder, V cleared
 *
 */
function divsW(dividend32: number, divisor16: number): number | null {
  const dvd = dividend32 | 0;
  const dvs = s16(divisor16);
  if (dvs === 0) return null; // div0 trap; treated as overflow for parity
  // JS / truncates toward zero for non-finite, but `| 0` does this for
  // 32-bit. Use Math.trunc to avoid -0 quirks.
  const quotRaw = Math.trunc(dvd / dvs);
  if (quotRaw < -0x8000 || quotRaw > 0x7fff) {
    return null; // overflow: no write
  }
  return quotRaw & 0xffff;
}

/**
 * Replica m68k `add.w src, dst`: the addition changes only `dst`'s low word;
 * `dst`'s high word remains unchanged.
 */
function addW(dst32: number, src16: number): number {
  const high = dst32 & 0xffff0000;
  const low = ((dst32 + src16) & 0xffff) >>> 0;
  return (high | low) >>> 0;
}

/**
 * Replica m68k `mulu.w #imm, Dn`: low word of Dn (unsigned) * imm
 * (unsigned 16-bit) → 32-bit unsigned in Dn.
 */
function muluW(dnLow: number, imm16: number): number {
  return ((dnLow & 0xffff) * (imm16 & 0xffff)) >>> 0;
}

/**
 * Replica m68k `muls.w D1, D0`: signed 16 * signed 16 → signed 32.
 */
function mulsW(a16: number, b16: number): number {
  return Math.imul(s16(a16), s16(b16)) | 0;
}

/** Replica m68k `neg.l`: 32-bit signed negation. */
function negL(v: number): number {
  return (-(v | 0)) | 0;
}

// ─── Replica ─────────────────────────────────────────────────────────────

/**
 *
 *                    (e.g. `0x401e00`). Converted to workRam offset through
 *                    `entityAddr - 0x400000`.
 * @param subs        injection for sound, FUN_26196, sound-table lookup.
 *                    Default no-op / 0.
 *
 */
export function waypointListStep1815A(
  state: GameState,
  entityAddr: number,
  subs?: WaypointListStep1815ASubs,
  rom?: import("./bus.js").RomImage,
): WaypointListStep1815AResult {
  const readByteAbs = (absAddr: number): number => {
    const a = absAddr >>> 0;
    if (rom !== undefined && a < 0x80000) {
      return (rom.program[a] ?? 0) & 0xff;
    }
    if (a >= 0x400000 && a < 0x402000) {
      return (state.workRam[a - 0x400000] ?? 0) & 0xff;
    }
    return 0;
  };
  const entOff = (entityAddr - 0x400000) >>> 0;
  const ptrOff = (GLOBAL_LIST_PTR_ADDR - 0x400000) >>> 0;
  const flagOff = (GLOBAL_EXHAUSTED_FLAG_ADDR - 0x400000) >>> 0;

  let recordsConsumed = 0;
  let soundDispatches = 0;
  let fun26196Called = false;
  let listEndMarkerSet = false;

  for (let iter = 0; iter < MAX_LIST_ITERATIONS; iter++) {
    // A3 = *(0x400446)
    const a3Addr = readLongBE(state, ptrOff);

    // Test terminator at *A3 (may be in ROM if a3Addr < 0x80000)
    const sx_b = readByteAbs(a3Addr);
    if (sx_b === 0) {
      return {
        exitMode: iter === 0 ? "list_empty" : "list_exhausted",
        recordsConsumed,
        soundDispatches,
        fun26196Called,
        listEndMarkerSet,
      };
    }

    // ─── Compute deltas ─────────────────────────────────────────────────
    // D2 = sext_long(sx) << 19 - entity.target_x + 0x40000
    const sx = sextB(sx_b);
    const targetX = readLongBE(state, entOff + ENTITY_TARGET_X_OFFSET);
    let d2 = ((sx << 19) - s32(targetX) + DELTA_BIAS) | 0;

    const sy = sextB(readByteAbs(a3Addr + 1));
    const targetY = readLongBE(state, entOff + ENTITY_TARGET_Y_OFFSET);
    let d3 = ((sy << 19) - s32(targetY) + DELTA_BIAS) | 0;

    const sm = sextB(readByteAbs(a3Addr + 2));
    let d5 = (sm << 16) | 0;

    // ─── D4.w = abs(d2) >> 12 ──────────────────────────────────────────
    const absD2 = d2 < 0 ? negL(d2) : d2;
    const d4w = asrL(absD2, 0xc) & 0xffff;
    const absD3 = d3 < 0 ? negL(d3) : d3;
    const d6w = asrL(absD3, 0xc) & 0xffff;

    // ─── Range check ─────────────────────────────────────────────────────
    // bls = unsigned <=. branch if 0x20 <= D4w
    if (RANGE_THRESHOLD <= d4w || RANGE_THRESHOLD <= d6w) {
      // ─── L18222: out-of-range, apply acceleration & exit ────────────
      // denom: D1.w = (min(D4,D6) >> 3) * 3 + max(D4,D6) (word arithmetic)
      let d1: number;
      if (d4w <= d6w) {
        // use D4 as the smaller-side
        let d1w = (d4w >>> 3) & 0xffff;
        d1 = muluW(d1w, 3); // D1 = d1.w * 3 (32-bit unsigned)
        d1 = addW(d1, d6w); // word add
      } else {
        let d1w = (d6w >>> 3) & 0xffff;
        d1 = muluW(d1w, 3);
        d1 = addW(d1, d4w);
      }

      const d1lowWord = d1 & 0xffff;
      if (d1lowWord === 0) {
        // clr.w D2 → D2 low word = 0 (high word unchanged)
        // move.w D2w,D3w → D3 low word = 0 (high word of D3 unchanged)
        d2 = (d2 & 0xffff0000) >>> 0;
        d3 = (d3 & 0xffff0000) >>> 0;
      } else {
        // divs.w D1, D2; move.w D0w, D2w (only low word updated)
        const q2 = divsW(d2, d1lowWord);
        if (q2 !== null) {
          d2 = ((d2 & 0xffff0000) | (q2 & 0xffff)) >>> 0;
        }
        // (overflow: D2 unchanged — D0.w remains the original D2.w → identical
        // re-write)
        const q3 = divsW(d3, d1lowWord);
        if (q3 !== null) {
          d3 = ((d3 & 0xffff0000) | (q3 & 0xffff)) >>> 0;
        }
      }

      // D5 override: if D1.w < 0x40 → D5 = 0xC000
      // bls means branch if 0x40 <= D1.w (skip override when D1 large)
      if (d1lowWord < D5_OVERRIDE_DENOM_LIMIT) {
        d5 = D5_OVERRIDE;
      }

      // D0 = D5 asr.l 8; D1.w = D0.w
      const d0_asr = asrL(d5, 8);
      const k_w = d0_asr & 0xffff;

      // D0.w = k_w (overlay only low word — but D0 is dead, so fine)
      // D0 = muls.w D2.w, D0  (signed 16 * signed 16 → signed 32)
      // d2 = D0 asr.l 4
      const mul_d2 = mulsW(k_w, d2 & 0xffff);
      d2 = asrL(mul_d2, 4);

      const mul_d3 = mulsW(k_w, d3 & 0xffff);
      d3 = asrL(mul_d3, 4);

      // D0 = (d2 - [A2]) >> 3 signed
      const ax_old = readLongBE(state, entOff + ENTITY_X_OFFSET);
      const stepX = asrL((s32(d2) - s32(ax_old)) | 0, 3);
      const ay_old = readLongBE(state, entOff + ENTITY_Y_OFFSET);
      const stepY = asrL((s32(d3) - s32(ay_old)) | 0, 3);

      writeLongBE(state, entOff + ENTITY_X_OFFSET, (s32(ax_old) + stepX) >>> 0);
      writeLongBE(state, entOff + ENTITY_Y_OFFSET, (s32(ay_old) + stepY) >>> 0);

      // gravity-Z if entity[0x36] != 0
      if (readByte(state, entOff + ENTITY_GRAVITY_FLAG_OFFSET) !== 0) {
        const az_old = s32(readLongBE(state, entOff + ENTITY_Z_OFFSET));
        let az = (az_old + Z_DECREMENT) | 0;
        // cmpi.l #-0x50000,(0x8,A2); bge → no clamp; else clamp
        if (az < Z_FLOOR) {
          az = Z_FLOOR;
        }
        writeLongBE(state, entOff + ENTITY_Z_OFFSET, az >>> 0);
      }

      // jsr FUN_26196(entity)
      subs?.fun_26196?.(state, entityAddr);
      fun26196Called = true;

      return {
        exitMode: "out_of_range",
        recordsConsumed,
        soundDispatches,
        fun26196Called,
        listEndMarkerSet,
      };
    }

    // ─── In range: optional sound trigger ──────────────────────────────
    const _sound_byte = readByteAbs(a3Addr + 3);
    const sound_idx = _sound_byte & 0x80 ? _sound_byte - 0x100 : _sound_byte;
    if (sound_idx >= 0) {
      // table_value = *(0x242aa + sound_idx*4) 32-bit BE
      // asl.w #2, D0w on byte-sext: D0.w = sound_idx * 4 (word). Negative
      // would not happen here (we tested >=0).
      const tableValue = subs?.lookupSoundTable
        ? subs.lookupSoundTable(sound_idx) >>> 0
        : 0;
      subs?.fun_012a?.(SOUND_ARG0, SOUND_ARG1, tableValue);
      soundDispatches++;
    }

    // Advance A3 by 4
    const newA3 = (a3Addr + WAYPOINT_RECORD_SIZE) >>> 0;

    if (readByteAbs(newA3) === 0) {
      // List exhausted: set globals
      writeWordBE(state, flagOff, 1);
      writeByte(state, entOff + ENTITY_LIST_END_OFFSET, 0xff);
      listEndMarkerSet = true;
    }

    // Commit cursor
    writeLongBE(state, ptrOff, newA3);
    recordsConsumed++;
    // Loop back to top
  }

  // Safety: shouldn't reach here in well-formed lists
  return {
    exitMode: "list_exhausted",
    recordsConsumed,
    soundDispatches,
    fun26196Called,
    listEndMarkerSet,
  };
}

// ─── Re-exports for namespace convenience ───────────────────────────────

/** Read the global list pointer (debug helper). */
export function readListPtr(state: GameState): number {
  return readLongBE(state, (GLOBAL_LIST_PTR_ADDR - 0x400000) >>> 0);
}

/** Write the global list pointer (test helper). */
export function writeListPtr(state: GameState, addr: number): void {
  writeLongBE(state, (GLOBAL_LIST_PTR_ADDR - 0x400000) >>> 0, addr >>> 0);
}

/** Read the exhausted flag word (debug helper). */
export function readExhaustedFlag(state: GameState): number {
  return readWordBE(state, (GLOBAL_EXHAUSTED_FLAG_ADDR - 0x400000) >>> 0);
}
