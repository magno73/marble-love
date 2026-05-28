/**
 * state-dispatch-1605c.ts - `FUN_0001605C` replica (82 bytes).
 *
 *
 * **Known caller** (1 site, see `find_xrefs`):
 *   - `0x15FD8` in `FUN_00015E24`: `move.l A2,-(SP); jsr 0x1605C; addq.l #4,SP`.
 *     base pointer used by callee `FUN_160AE`.
 *
 * **Disasm 0x1605C..0x160AD** (82 byte):
 *
 *   move.l  A2,-(SP)               ; preserve A2
 *   movea.l (0x8,SP),A2            ; A2 = arg1 long (struct ptr)
 *   move.b  (0x1A,A2),D0b          ; D0.b = byte @ A2+0x1A ("kind")
 *   ext.w   D0w
 *   ext.l   D0                     ; D0 = signExt(kind) -> long
 *   movea.l D0,A0                  ; A0 = signExt(kind) (signed long)
 *   cmpa.w  #0x20,A0               ; cmp A0, signExt_w_l(0x20)
 *   blt.b   0x160AA                ; if A0 < 0x20 (signed), epilog (no-op)
 *   bgt.b   0x16076                ; if A0 > 0x20, check 0x21/0x22
 *   bra.b   0x16086                ; A0 == 0x20, branch_20
 * 0x16076:
 *   cmpa.w  #0x21,A0
 *   bne.b   0x1607E                ; A0 != 0x21, check 0x22
 *   bra.b   0x160AA                ; A0 == 0x21, epilog (no-op)
 * 0x1607E:
 *   cmpa.w  #0x22,A0
 *   bne.b   0x160AA                ; A0 != 0x22, epilog (no-op)
 *   bra.b   0x16094                ; A0 == 0x22, branch_22
 *
 * 0x16086:  ; branch kind == 0x20
 *   clr.l   -(SP)                  ; push 0 (long)
 *   move.l  A2,-(SP)                ; push A2 (long ptr)
 *   jsr     0x000160AE.l            ; FUN_160AE(structPtr=A2, byteIdxLong=0)
 *   addq.l  #8,SP                  ; pop 2 long
 *   bra.b   0x160AA                ; → epilog
 *
 * 0x16094:  ; branch kind == 0x22
 *   move.l  A2,-(SP)                ; push A2
 *   jsr     0x00015C46.l            ; FUN_15C46(structPtr=A2) -> D0 (long)
 *   addq.l  0x4,SP                 ; pop A2
 *   move.l  D0,-(SP)                ; push D0 (long, returned from FUN_15C46)
 *   move.l  A2,-(SP)                ; push A2
 *   jsr     0x000160AE.l            ; FUN_160AE(structPtr=A2, byteIdxLong=D0)
 *   addq.l  #8,SP                  ; pop 2 long
 *
 * 0x160AA:
 *   movea.l (SP)+,A2               ; restore A2
 *   rts
 *
 * then sign-extended to a signed long:
 *   - byte 0x00..0x1F (0..31)          -> no-op (A0 < 0x20)
 *   - byte 0x20                        -> FUN_160AE(A2, 0)
 *   - byte 0x22                        -> FUN_160AE(A2, FUN_15C46(A2))
 *   - byte 0x23..0x7F (35..127)        -> no-op (cmpa fall-through)
 *   - byte 0x80..0xFF (-128..-1 signed)-> no-op (A0 < 0x20)
 *
 * **Note semantiche**:
 *     i confronti sono signed.
 *     behaves like a plain "byte == 0x20/0x21/0x22" check for byte <= 0x7F.
 *
 * **JSR sub injection**: two callees exposed through `StateDispatch1605CSubs`:
 *   - `fun_15c46(structPtrLong) -> number (long)` - default `() => 0`.
 *     Returns the long used as `byteIdxLong` for FUN_160AE in the
 *     branch 0x22.
 *   - `fun_160ae(structPtrLong, byteIdxLong) -> void` - default no-op.
 *     `D0b = (0, A1, byteIdxLong.w * 1)`, `D0 = signExt(D0b)` long,
 *     `D0 = D0 * 6 + (0x72, structPtr)`, `(0x6e, structPtr) = D0`.
 *     `signExt(stride[byteIdx]) * 6` bytes from base @ structPtr+0x72.
 *
 * D0 is not an API result here.
 *
 */

import type { GameState } from "./state.js";

/**
 * Stub injection for the two JSR calls in the dispatcher.
 *
   *   and `kind == 0x22` (with `byteIdxLong = fun_15c46` return). Default no-op.
 */
export interface StateDispatch1605CSubs {
  /**
   * `FUN_00015C46(structPtrLong) -> long`. Computes a "best match index"
   * (word, sign-extended to long) used as `byteIdxLong` by FUN_160AE.
   */
  fun_15c46?: (structPtrLong: number) => number;
  /**
   * `FUN_000160AE(structPtrLong, byteIdxLong) -> void`. Advances the current
   */
  fun_160ae?: (structPtrLong: number, byteIdxLong: number) => void;
}

/** Offset of the "kind" byte in the struct relative to arg1 pointer. */
export const KIND_BYTE_OFF = 0x1a as const;

export const KIND_CASE_20 = 0x20 as const;
export const KIND_CASE_21 = 0x21 as const;
export const KIND_CASE_22 = 0x22 as const;

/** Absolute M68k work RAM base, used to derive `state.workRam` offsets. */
const WORK_RAM_BASE = 0x00400000;
/** Work RAM size (8 KB). */
const WORK_RAM_SIZE = 0x2000;

/**
 * "kind" @ structPtr+0x1A.
 *
 *                 The observed path uses a work RAM struct.
 * @param subs     Stub injection for `fun_15c46` / `fun_160ae`.
 * @returns void. Side effects only through `subs.*`.
 *
 *
 *   - 0x20: `subs.fun_160ae(structPtrLong, 0)`
 *   - 0x22: `r = subs.fun_15c46(structPtrLong)` poi
 *           `subs.fun_160ae(structPtrLong, r)`
 */
export function stateDispatch1605C(
  state: GameState,
  structPtrLong: number,
  subs?: StateDispatch1605CSubs,
): void {
  const a2 = structPtrLong >>> 0;

  // Read byte @ A2 + 0x1A. Modeling: if pointer is in workRam, read from
  const kindAddr = (a2 + KIND_BYTE_OFF) >>> 0;
  let kindByte = 0;
  if (kindAddr >= WORK_RAM_BASE && kindAddr < WORK_RAM_BASE + WORK_RAM_SIZE) {
    kindByte = state.workRam[kindAddr - WORK_RAM_BASE] ?? 0;
  }

  // ext.w + ext.l: signed sign-extend del byte a long signed.
  // JS: (b << 24) >> 24 produce int32 signed.
  const a0Signed = ((kindByte & 0xff) << 24) >> 24;

  // blt.b: if A0 < 0x20 (signed) → return.
  if (a0Signed < 0x20) {
    return;
  }

  // bgt.b 0x16076: if A0 > 0x20, fall-through al check 0x21/0x22; else
  // (A0 == 0x20) cade nel `bra.b 0x16086` → branch_20.
  if (a0Signed === 0x20) {
    // branch kind == 0x20: fun_160ae(A2, 0)
    subs?.fun_160ae?.(a2, 0);
    return;
  }

  // A0 > 0x20: check 0x21 e 0x22.
  if (a0Signed === 0x21) {
    return;
  }
  if (a0Signed === 0x22) {
    // branch kind == 0x22:
    //   D0 = fun_15c46(A2) -> long
    //   fun_160ae(A2, D0)
    const ret = (subs?.fun_15c46?.(a2) ?? 0) >>> 0;
    subs?.fun_160ae?.(a2, ret);
    return;
  }

  // Equivalent to no-op.
}
