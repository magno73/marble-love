/**
 * state-sub-15670.ts — replica `FUN_00015670` (532 byte).
 *
 * Scans the object array counted by `0x400396` and looks for a candidate:
 *   - `obj.state (0x18) == 1`
 *   - `obj.zorder (0x1B) == arg.zorder`
 *   - `|obj_x| + |obj_y| > 0xC000`
 *   - `obj.field36 (0x36) != 2`
 *   - `obj.kind (0x1A) in {0, 1, 5}`
 * Also scans the 4-entry marble-slot array at stride `0x60` for collisions:
 *   - `slot.state (0x18) == 1`
 *   - `slot.kind (0x1A) == 1`
 *   - `slot.field56 (0x56).w == signExt(obj.field19 (0x19))`
 *
 *     decremented), epilog (no-op).
 *     `FUN_00015FE6(obj0, obj1)` chooses the above object by depth and writes
 *     candidate `A1`:
 *       `dx = |arg.x (0xC) - A1.x (0xC)| >> 12`  -> low word `D3`
 *       `dy = |arg.y (0x10) - A1.y (0x10)| >> 12` -> low word `D4`
 *       `dist = (min(D3,D4) >> 3) * 3 + max(D3,D4)`
 *      contributes a 3/8 factor while the longer side contributes fully. Shift
 *      and multiply operate on the word extended to long through
 *      `move.w D?w, D?w; lsr.l #3; muls.w #3`.)
 *   - If `0x180 < dist < 0x280`, both bound checks (`ble`/`bge`) pass and call
 *      `FUN_00015460(A2)`.
 *
 * **Known caller** (1 site):
 *   - `0x15270` in `FUN_00015148`: `move.l A2,-(SP); jsr 0x15670.l;
 *
 * **Disasm 0x15670..0x15883** (532 byte) — compatto:
 *
 *   movem.l  {A5 A4 A3 A2 D6 D5 D4 D3 D2}, -(SP)   ; save 9 regs (36 byte)
 *   movea.l  (0x28,SP),A2                          ; A2 = arg1 long
 *   movea.l  #0x400396,A4                          ; A4 = count word ptr
 *   move.b   (0x1A,A2),D0b                         ; D0 = arg.kind (UNUSED!)
 *   move.b   (1,A4),D2b                            ; D2 = low byte of count
 *   movea.l  A3,A0                                 ; A0 = obj iter ptr
 *   moveq    0,D6                                  ; D6 = 0
 *   movea.l  D6,A1                                 ; A1 = nullptr (best obj)
 *   clr.b    D5b                                   ; D5 = 0 (loop counter)
 *   bra.w    test_outer                            ; jump to count check
 *  obj_iter:                                       ; @ 0x15698
 *   D1 = abs((long*)A0[0])
 *   D3 = abs((long*)A0[4])
 *   if A0.state (0x18) != 1 -> next
 *   if (1B,A2) != (1B,A0) -> next
 *   if (D3 + D1) <= 0xC000 -> next       ; signed long
 *   if (0x36,A0) == 2 -> next
 *   if (0x1A,A0) not in {0,1,5} -> next
 *   ; inner: 4-slot collision check @ 0x401302 stride 0x60
 *   D1 = #0x401302; D4 = 0; D3 = 0
 *  inner_iter:
 *   if A2 == D1 -> skip body
 *   else if (1, A5=D1).state == 1 AND (1, A5).kind == 1 AND
 *          (0x56, A5).w == signExt((0x19, A0).b) -> D4 = 1
 *   D1 += 0x60; D3.b += 1
 *   if D3 != 4 -> inner_iter
 *   if D4 != 0 -> next                   ; collision: skip
 *   D2.b -= 1                            ; count valid candidates
 *   A1 = A0                              ; save last good
 *  next:
 *   D6 = A0; D6 += 0xE2; A0 = D6
 *   D5.b += 1
 *  test_outer:                          ; @ 0x15758
 *   D0 = signExt(D5.b).w
 *   if D0 != count(A4).w -> obj_iter
 *
 *   D0 = signExt(D2.b).w
 *
 *   if count(A4).w == 2 AND D2 == 0:
 *     ret = FUN_15FE6(A3, A3+0xE2)
 *     A1 = (ret != 0 ? A3+0xE2 : A3)
 *
 *   D2.b = (0x19, A1)
 *   ; ("dead" calculations that reassign D0=1 in several branches, then get overwritten)
 *   D0 = (0xC, A1) - (0xC, A2)          ; long signed
 *   D3.w = abs(D0) >> 12                 ; low 16
 *   D0 = (0x10, A1) - (0x10, A2)
 *   D4.w = abs(D0) >> 12
 *   if D3 > D4 (unsigned word):
 *     D1 = (D4 >> 3) * 3 + D3            ; octant-approx
 *   else:
 *     D1 = (D3 >> 3) * 3 + D4
 *   (0x56, A2).w = signExt(D2.b).w
 *   if 0x180 < D1 < 0x280:               ; ble.b skips; bge.b skips
 *     (0x1A, A2) = 1
 *     FUN_15460(A2)
 *  epilog:
 *   movem.l (SP)+, {D2 D3 D4 D5 D6 A2 A3 A4 A5}
 *   rts
 *
 * **Direct side effects** on work RAM:
 *   - `(0x1A, A2) = 1` only when the distance condition matches.
 *
 * **Indirect side effects**:
 *     `FUN_00015FE6` via `compareObjDepth` (see `object-compare.ts`).
 *
 * `0x400396`, and A2 in the same range. The replica accesses work RAM.
 *
 */

import type { GameState } from "./state.js";
import { compareObjDepth } from "./object-compare.js";

// ─── Layout Constants ─────────────────────────────────────────────────────

/** Absolute M68k work RAM base. */
const WORK_RAM_BASE = 0x00400000;
/** Work RAM size (8 KB). */
const WORK_RAM_SIZE = 0x2000;

export const OBJ_ARRAY_BASE = 0x00400018 as const;
export const OBJ_STRIDE = 0xe2 as const;
export const OBJ_COUNT_ADDR = 0x00400396 as const;

export const SLOT_ARRAY_BASE = 0x00401302 as const;
/** Marble-slot stride. */
export const SLOT_STRIDE = 0x60 as const;
/** Number of marble slots. */
export const SLOT_COUNT = 4 as const;

// Per-obj field offsets
const OBJ_X_OFF = 0x00; // long signed
const OBJ_Y_OFF = 0x04; // long signed
const OBJ_STATE_OFF = 0x18; // byte
const OBJ_FLAG19_OFF = 0x19; // byte (target word value via signExt)
const OBJ_KIND_OFF = 0x1a; // byte
const OBJ_ZORDER_OFF = 0x1b; // byte
const OBJ_FIELD36_OFF = 0x36; // byte

// Marble-slot field offsets; state/kind reuse 0x18/0x1A.
const SLOT_STATE_OFF = 0x18; // byte
const SLOT_KIND_OFF = 0x1a; // byte
const SLOT_FIELD56_OFF = 0x56; // word

// "main struct" A2 field offsets
const ARG_FX_OFF = 0x0c; // long signed (fixed-point pos x)
const ARG_FY_OFF = 0x10; // long signed (fixed-point pos y)
const ARG_KIND_OFF = 0x1a;
const ARG_ZORDER_OFF = 0x1b; // byte
const ARG_FIELD56_OFF = 0x56; // word written as signExt(D2.b)

const ACTIVE_SUM_THRESHOLD = 0xc000 as const;
/** Exclusive lower distance bound (`> 0x180`) for the trigger. */
const DIST_LO_EXCL = 0x180 as const;
/** Exclusive upper distance bound (`< 0x280`) for the trigger. */
const DIST_HI_EXCL = 0x280 as const;
/** Shift applied to positional differences (fixed-point -> tile-ish). */
const POS_DIFF_SHIFT = 12 as const;
const TRIGGERED_KIND = 1 as const;

// ─── Stub injection ──────────────────────────────────────────────────────

/**
 * Stub injection for the two JSR calls in `FUN_00015670`.
 *
 *   Absolute struct pointer. Default no-op.
 */
export interface StateSub15670Subs {
  /**
   * `FUN_00015FE6(obj0Abs, obj1Abs) -> 0/1` (long signed). Returns 1 when
   * `obj0` wins over `obj1` by depth ordering.
   */
  fun_15fe6?: (obj0Abs: number, obj1Abs: number) => number;
  /**
   * `FUN_00015460(structPtrAbs) -> void`. Side-effect handler invoked on trigger.
   */
  fun_15460?: (structPtrAbs: number) => void;
}


function readByteAbs(state: GameState, addr: number): number {
  const a = addr >>> 0;
  if (a < WORK_RAM_BASE || a >= WORK_RAM_BASE + WORK_RAM_SIZE) return 0;
  return state.workRam[a - WORK_RAM_BASE] ?? 0;
}

function readU16Abs(state: GameState, addr: number): number {
  const a = addr >>> 0;
  if (a + 2 > WORK_RAM_BASE + WORK_RAM_SIZE || a < WORK_RAM_BASE) return 0;
  const r = state.workRam;
  const off = a - WORK_RAM_BASE;
  return (((r[off] ?? 0) << 8) | (r[off + 1] ?? 0)) & 0xffff;
}

function readLongSignedAbs(state: GameState, addr: number): number {
  const a = addr >>> 0;
  if (a + 4 > WORK_RAM_BASE + WORK_RAM_SIZE || a < WORK_RAM_BASE) return 0;
  const r = state.workRam;
  const off = a - WORK_RAM_BASE;
  const u =
    (((r[off] ?? 0) << 24) |
      ((r[off + 1] ?? 0) << 16) |
      ((r[off + 2] ?? 0) << 8) |
      (r[off + 3] ?? 0)) >>>
    0;
  // Re-interpret as int32 signed
  return u | 0;
}

function writeU16Abs(state: GameState, addr: number, value: number): void {
  const a = addr >>> 0;
  if (a + 2 > WORK_RAM_BASE + WORK_RAM_SIZE || a < WORK_RAM_BASE) return;
  const off = a - WORK_RAM_BASE;
  state.workRam[off] = (value >>> 8) & 0xff;
  state.workRam[off + 1] = value & 0xff;
}

function writeByteAbs(state: GameState, addr: number, value: number): void {
  const a = addr >>> 0;
  if (a < WORK_RAM_BASE || a >= WORK_RAM_BASE + WORK_RAM_SIZE) return;
  state.workRam[a - WORK_RAM_BASE] = value & 0xff;
}

/** Sign-extend low byte 0..0xFF to signed int32. */
function sextByteL(b: number): number {
  return ((b & 0xff) << 24) >> 24;
}

/** asr.l signed 32-bit. */
function asrL(value: number, count: number): number {
  return (value | 0) >> (count & 0x1f);
}

function absL(v: number): number {
  // M68k `tst.l` + `bge` + `neg.l` on 0x80000000 produces 0x80000000 (overflow).
  // In JS: 0x80000000 | 0 = -0x80000000; -(-0x80000000) | 0 = -0x80000000.
  // Behavior matches.
  const x = v | 0;
  return x < 0 ? -x | 0 : x;
}

// ─── Main Replica ─────────────────────────────────────────────────────────

/**
 *
 *                       candidate is decremented) and `arg+0x1A` (only when
 *                       distance is in trigger range).
 * @param structPtrLong  long: absolute pointer to the "arg" struct (A2).
 *                       Default: `fun_15fe6 = compareObjDepth(state,..)`,
 *                       `fun_15460 = no-op`.
 */
export function stateSub15670(
  state: GameState,
  structPtrLong: number,
  subs?: StateSub15670Subs,
): void {
  const a2 = structPtrLong >>> 0;
  const a3 = OBJ_ARRAY_BASE >>> 0;
  const count = readU16Abs(state, OBJ_COUNT_ADDR);
  // D2 starts with (1, A4) = LSB byte of the BE count word (0x397).
  let d2Byte = readByteAbs(state, OBJ_COUNT_ADDR + 1);

  let a1: number = 0; // "best candidate" obj abs ptr (0 = none)

  for (let i = 0; i < count; i++) {
    const objAbs = (a3 + i * OBJ_STRIDE) >>> 0;

    const x = readLongSignedAbs(state, objAbs + OBJ_X_OFF);
    const y = readLongSignedAbs(state, objAbs + OBJ_Y_OFF);
    const ax = absL(x);
    const ay = absL(y);

    // Filter: state == 1
    if (readByteAbs(state, objAbs + OBJ_STATE_OFF) !== 1) continue;
    // Filter: arg.zorder == obj.zorder (cmp.b)
    if (
      readByteAbs(state, a2 + ARG_ZORDER_OFF) !==
      readByteAbs(state, objAbs + OBJ_ZORDER_OFF)
    ) {
      continue;
    }
    // Filter: ax + ay > 0xC000 (long signed). cmpi.l #0xc000,D0; ble.w skip.
    const sum = (ax + ay) | 0;
    if (sum <= ACTIVE_SUM_THRESHOLD) continue;
    // Filter: obj.field36 != 2
    if (readByteAbs(state, objAbs + OBJ_FIELD36_OFF) === 2) continue;
    // Filter: obj.kind ∈ {0, 1, 5}
    const objKind = readByteAbs(state, objAbs + OBJ_KIND_OFF);
    if (objKind !== 0 && objKind !== 1 && objKind !== 5) continue;

    // ─── Inner loop: marble-slot collision check ──────────────────────
    let collision = false;
    const targetWord = sextByteL(readByteAbs(state, objAbs + OBJ_FLAG19_OFF));
    const targetW = targetWord & 0xffff;
    for (let s = 0; s < SLOT_COUNT; s++) {
      const slotAbs = (SLOT_ARRAY_BASE + s * SLOT_STRIDE) >>> 0;
      // Skip if A2 == slotAbs.
      if (slotAbs === a2) continue;
      if (readByteAbs(state, slotAbs + SLOT_STATE_OFF) !== 1) continue;
      if (readByteAbs(state, slotAbs + SLOT_KIND_OFF) !== 1) continue;
      // (0x56, A5).w cmp.w D0w (= signExt(obj.0x19))
      const slotW = readU16Abs(state, slotAbs + SLOT_FIELD56_OFF);
      if (slotW !== targetW) continue;
      collision = true;
    }

    if (collision) continue;

    // Candidato valido: D2.b -= 1, A1 = A0 (latest good)
    d2Byte = (d2Byte - 1) & 0xff;
    a1 = objAbs;
  }

  // ─── Post-loop: count-match check ────────────────────────────────────
  // cmp.w (A4), signExt(D2.b).w == count.w → epilog
  const d2WordSext = sextByteL(d2Byte) & 0xffff;
  if (d2WordSext === (count & 0xffff)) {
    return;
  }

  // ─── Special case: count == 2 && D2 == 0 → depth compare obj0 vs obj1 ─
  if (count === 2 && d2Byte === 0) {
    const obj0Abs = a3 >>> 0;
    const obj1Abs = (a3 + OBJ_STRIDE) >>> 0;
    const fun15fe6 =
      subs?.fun_15fe6 ??
      ((p0: number, p1: number): number => compareObjDepth(state, p0, p1));
    const ret = fun15fe6(obj0Abs, obj1Abs) | 0;
    a1 = ret !== 0 ? obj1Abs : obj0Abs;
  }

  // ─── Riassegna D2 = (0x19, A1) ────────────────────────────────────
  // (0x56,A2).w via signExt.
  d2Byte = readByteAbs(state, a1 + OBJ_FLAG19_OFF);

  // ─── Distanza octant-approx tra arg (A2) e candidato (A1) ───────────
  const argX = readLongSignedAbs(state, a2 + ARG_FX_OFF);
  const argY = readLongSignedAbs(state, a2 + ARG_FY_OFF);
  const a1X = readLongSignedAbs(state, a1 + ARG_FX_OFF);
  const a1Y = readLongSignedAbs(state, a1 + ARG_FY_OFF);

  // dx long signed; |dx| poi asr 12 (signed) → low word
  const dxAbs = absL((a1X - argX) | 0);
  const dyAbs = absL((a1Y - argY) | 0);
  const d3W = asrL(dxAbs, POS_DIFF_SHIFT) & 0xffff;
  const d4W = asrL(dyAbs, POS_DIFF_SHIFT) & 0xffff;

  // bls = "branch if lower or same" unsigned: if D3 <= D4 unsigned -> swap.
  //
  //   moveq #0,D1; move.w <minor>,D1w  ; D1 = minor zero-extended (long unsigned)
  //   lsr.l #3, D1                      ; D1 >>= 3 (long unsigned)
  //   muls.w #3, D1                     ; D1 = (D1.w as int16) * 3 → long signed
  //   moveq #0,D0; move.w <major>,D0w  ; D0 = major zero-extended
  //   add.l D0, D1                      ; D1 += D0 (long add)
  //
  let dist: number;
  if (d3W > d4W) {
    // D3 > D4 unsigned: D1 = ((D4 >> 3) * 3) + D3
    const minor = d4W; // 0..0xFFFF
    const major = d3W;
    const minorShifted = (minor >>> 3) & 0xffff; // [0..0x1FFF]
    // muls.w: low word (positivo) × 3 → long signed positivo
    const muls = ((minorShifted << 16) >> 16) * 3; // safe: max 0x5FFD
    dist = (muls + major) | 0;
  } else {
    // D3 <= D4 unsigned: D1 = ((D3 >> 3) * 3) + D4
    const minor = d3W;
    const major = d4W;
    const minorShifted = (minor >>> 3) & 0xffff;
    const muls = ((minorShifted << 16) >> 16) * 3;
    dist = (muls + major) | 0;
  }

  // Always-write: (0x56, A2).w = signExt(D2.b).w
  writeU16Abs(state, a2 + ARG_FIELD56_OFF, sextByteL(d2Byte) & 0xffff);

  // Range check: 0x180 < dist < 0x280 (signed long)
  // ble (signed) -> skip if dist <= 0x180
  // bge (signed) -> skip if dist >= 0x280
  if (dist <= DIST_LO_EXCL) return;
  if (dist >= DIST_HI_EXCL) return;

  // Trigger: (0x1A, A2) = 1; FUN_15460(A2)
  writeByteAbs(state, a2 + ARG_KIND_OFF, TRIGGERED_KIND);
  subs?.fun_15460?.(a2);
}
