/**
 * state-sub-1eaa.ts — `FUN_00001EAA` replica (54 bytes).
 *
 * caller `FUN_00001EE0` (3 call sites: 0x20EC, 0x210C, 0x212A) to
 * initialize groups of consecutive alpha-tilemap cells: each step
 * increments the alphaRam pointer by 4 bytes (1 cell = 2 words) and the
 * "tile id" of +1.
 *
 *   - `arg1Long` (long): alphaRam pointer (D4, incremented by 4 each iter).
 *     (incremented by 1 each iter, **16-bit wrap**).
 *     treated as signed long: loop runs while `D2 > 0`).
 *
 * **Disasm 0x1EAA..0x1EE0** (54 byte):
 *
 *   movem.l {D4,D3,D2},-(SP)         ; save D2/D3/D4 (12 bytes)
 *   move.l  (0x10,SP),D4             ; D4 = arg1 (long ptr)
 *   move.w  (0x16,SP),D3w            ; D3.w = arg2 low word
 *   move.l  (0x18,SP),D2             ; D2 = arg3 (long count)
 *   ; loop @ 0x1EBA:
 *   tst.l   D2
 *   ble.b   0x1EDA                   ; if D2 <= 0 (signed) → exit
 *     clr.l   -(SP)                  ; push 0 (long)
 *     move.w  D3w,D0w
 *     ext.l   D0                     ; D0 = sign-extend(D3w) to long
 *     move.l  D0,-(SP)               ; push (long)
 *     move.l  D4,-(SP)               ; push D4 (long ptr)
 *     jsr     0x000033F4.l           ; FUN_33F4(ptr, sext_w_l(tileId), 0)
 *     addq.w  #1,D3w                 ; D3.w += 1 (word, wraps a 16 bit)
 *     subq.l  #1,D2                  ; D2 -= 1
 *     lea     (0xC,SP),SP            ; pop 12 byte (3 long)
 *     bra.b   0x1EBA                 ; → loop
 *   0x1EDA: movem.l (SP)+,{D2,D3,D4}
 *           rts
 *
 * `FUN_33F4(ptr + i*4, sext_w_l((tileId + i) & 0xFFFF), 0)` per
 * `i in [0..count-1]`, with `count = max(0, signed(arg3))`.
 *
 * **Edge cases**:
 *   - Very large `arg3 > 0`: D4 (long) increment by +4 does NOT saturate; use
 *     loop `D2 == 0` (if arg3 > 0) or `D2 == arg3` (if arg3 <= 0).
 *     as return value.
 *
 * **JSR target identificato**: `FUN_000033F4` (alias `fun_33f4` in the
 *
 * FUN_33F4 patched a stub-probe (record arg1/arg2 in workRam scratch).
 */

import type { GameState } from "./state.js";

/** Stub injection per la JSR a 0x33F4. */
export interface StateSub1EAASubs {
  /**
   * `FUN_33F4(ptrLong, sextWordLong, zeroLong)`. Default no-op (matching
   */
  fun_33f4?: (ptrLong: number, sextWordLong: number, zeroLong: number) => void;
}

/**
 *
 * @param arg1Long  long: pointer base (incremented of 4 each iter).
 *                  (incremented of 1 mod 0x10000 each iter, poi
 *                  sign-extended a long per la call).
 * @param subs      stub injection per `fun_33f4` (default no-op).
 *
 */
export function stateSub1EAA(
  _state: GameState,
  arg1Long: number,
  arg2Long: number,
  arg3Long: number,
  subs?: StateSub1EAASubs,
): void {
  // D4 = arg1 (long, mantenuto as u32; aritmetica wrap a 32 bit).
  let d4 = arg1Long >>> 0;
  // D3.w = low word of arg2 (mantenuto in [0, 0xFFFF], wrap a 16 bit).
  let d3w = arg2Long & 0xffff;
  // D2 = arg3 long, trattato as SIGNED 32-bit for the `tst.l D2 / ble`.
  let d2 = arg3Long | 0;

  while (d2 > 0) {
    const sextWordLong = (d3w << 16) >> 16;
    subs?.fun_33f4?.(d4, sextWordLong, 0);

    // addq.l #4, D4 (wrap a 32 bit)
    d4 = (d4 + 4) >>> 0;
    // addq.w #1, D3w (wrap a 16 bit)
    d3w = (d3w + 1) & 0xffff;
    // subq.l #1, D2 (signed)
    d2 = (d2 - 1) | 0;
  }
}
