/**
 * state-sub-26c2.ts - port of `FUN_000026C2` (164 bytes).
 *
 * State-machine helper "render-string-then-register-state-5-or-6".
 *
 *   1. Render the string chain by calling `FUN_2572` (`renderStringChain`) with
 *      `(arg1Long, sext(arg2.w))`.
 *
 *        - If arg3.w >= 0 (signed): STATE[i] = 5, THRESHOLD[i] = arg3.w
 *        - If arg3.w <  0 (signed): STATE[i] = 6, THRESHOLD[i] = -arg3.w
 *
 *
 *   - `arg1Long` (long): pointer, for example a struct address, passed both to
 *     `renderStringChain` and to `DATA_PTR[slot]`.
 *   - `arg2Long` (long, low word only via `move.w`): WORD16[slot] and, after
 *     sign extension, the second `renderStringChain` arg (attrWord).
 *   - `arg3Long` (long, low word only via `move.w`): determines state (5/6)
 *     and THRESHOLD[slot] magnitude.
 *
 * **Disasm 0x26C2..0x2766** (164 byte):
 *
 *   movem.l {D5,D4,D3,D2},-(SP)        ; save D2/D3/D4/D5 (16 bytes)
 *   move.l  (0x14,SP),D3               ; D3 = arg1Long (SP+20: 16 saved + 4 ret)
 *   move.w  (0x1A,SP),D4w              ; D4.w = arg2 low word
 *   move.w  (0x1E,SP),D2w              ; D2.w = arg3 low word
 *   move.w  D4w,D0w
 *   ext.l   D0                         ; D0 = sext32(arg2.w)
 *   move.l  D0,-(SP)                   ; push sext(arg2.w) as long
 *   move.l  D3,-(SP)                   ; push arg1Long
 *   jsr     FUN_00002572.l             ; renderStringChain(arg1, sext(arg2.w))
 *   clr.w   D5w                        ; D5 = 0 (loop counter, 4 slot)
 *   addq.l  #8,SP                      ; cleanup 2 long args
 *   ; loop @ 0x26E4
 *   move.w  D5w,D0w
 *   movea.l #0x401F1C,A0
 *   tst.b   (0,A0,D0w*1)               ; STATE[D5] != 0 ?
 *     move.w  D5w,D0w
 *     asl.w   #2,D0w                   ; D0 = D5*4
 *     movea.l #0x401F04,A0
 *     move.l  D3,(0,A0,D0w*1)          ; DATA_PTR[D5] = arg1 (long)
 *     tst.w   D2w                      ; arg3.w sign?
 *     bge.b   0x270E
 *     move.w  D2w,D1w
 *     ext.l   D1
 *     neg.l   D1                       ; D1 = -sext(arg3.w)
 *     bra.b   0x2712
 *     ; 0x270E (D2w >= 0):
 *     move.w  D2w,D1w
 *     ext.l   D1
 *     ; 0x2712:
 *     move.w  D5w,D0w
 *     add.w   D0w,D0w                  ; D0 = D5*2
 *     movea.l #0x401F20,A0
 *     move.w  D1w,(0,A0,D0w*1)         ; THRESHOLD[D5] = D1.w (abs of arg3.w)
 *     tst.w   D2w
 *     bge.b   0x2728
 *     moveq   #6,D1                    ; arg3.w < 0 → state byte = 6
 *     bra.b   0x272A
 *     ; 0x2728:
 *     moveq   #5,D1                    ; arg3.w >= 0 → state byte = 5
 *     ; 0x272A:
 *     move.w  D5w,D0w
 *     movea.l #0x401F1C,A0
 *     move.b  D1b,(0,A0,D0w*1)         ; STATE[D5] = 5 or 6
 *     move.w  D5w,D0w
 *     add.w   D0w,D0w
 *     movea.l #0x401F14,A0
 *     move.w  D4w,(0,A0,D0w*1)         ; WORD16[D5] = arg2.w
 *     move.w  D5w,D0w
 *     add.w   D0w,D0w
 *     movea.l #0x401F28,A0
 *     clr.w   (0,A0,D0w*1)             ; COUNTER[D5] = 0
 *     moveq   #1,D0                    ; D0 = 1 (success)
 *     bra.b   0x2760                   ; → epilog
 *   0x2756: addq.w #1,D5w
 *           moveq  #4,D0
 *           cmp.w  D5w,D0w
 *           bgt.b  0x26E4               ; if 4 > D5 (signed): loop
 *           moveq  #0,D0                ; D0 = 0 (no free slot)
 *   0x2760: movem.l (SP)+,{D2,D3,D4,D5}
 *           rts
 *
 * **JSR target**: `FUN_00002572` (alias `renderStringChain` /
 * `fun_2572` in `GameStateMachineSubs`). Exposed through stub injection
 * (`StateSub26C2Subs.fun_2572`); default no-op (matching `rts`).
 *
 * STATE/WORD16/COUNTER are directly observable by the differential test,
 * independently of what renderStringChain does.
 */

import type { GameState } from "./state.js";
import {
  DATA_PTR_BASE_OFF,
  WORD16_BASE_OFF,
  STATE_BASE_OFF,
  THRESHOLD_BASE_OFF,
  COUNTER_BASE_OFF,
  SLOT_COUNT,
} from "./game-state-machine.js";

/** Stub injection for the JSR at 0x2572 (renderStringChain). */
export interface StateSub26C2Subs {
  /**
   * `FUN_2572` - render string chain. Default no-op (matching `rts`).
   *
   * @param arg1Long First long arg: structAddr passed as pointer to the renderer.
   * @param arg2Long Second long arg: `sext32(arg2.w)`, the sign-extended
   *                 low word of `stateSub26C2`'s second arg.
   */
  fun_2572?: (arg1Long: number, arg2Long: number) => void;
}

/**
 *
 * Executes: (1) `renderStringChain(arg1, sext(arg2.w))` through stub injection,
 * then claims a state-machine slot as state 5 or 6 depending on arg3.w, with
 * `THRESHOLD = abs(sext(arg3.w))`, `WORD16 = arg2.w`, and `COUNTER = 0`.
 *
 * @param state    GameState. Mutates DATA_PTR/STATE/WORD16/THRESHOLD/COUNTER
 *                 tables @ 0x401F04..0x401F2F.
 * @param arg1Long Long pointer/structAddr; first renderStringChain arg.
 * @param arg2Long Long whose low word goes in WORD16[slot]; sign-extended for render.
 * @param subs     Stub injection for `fun_2572` (default no-op).
 *
 *
 *   - DATA_PTR[i] = arg1Long (long, big-endian)
 *   - STATE[i] = 5 (if arg3.w >= 0) or 6 (if arg3.w < 0)
 *   - THRESHOLD[i] = |sext(arg3.w)| & 0xFFFF (word, big-endian)
 *   - WORD16[i] = arg2.w (word, big-endian)
 *   - COUNTER[i] = 0 (word)
 *
 */
export function stateSub26C2(
  state: GameState,
  arg1Long: number,
  arg2Long: number,
  arg3Long: number,
  subs?: StateSub26C2Subs,
): number {
  const r = state.workRam;
  const arg1 = arg1Long >>> 0;
  const arg2W = arg2Long & 0xffff;
  const arg3W = arg3Long & 0xffff;

  // Sign-extended versions (M68k `ext.l Dn` on a word).
  const arg2Signed = arg2W & 0x8000 ? arg2W - 0x10000 : arg2W;
  const arg3Signed = arg3W & 0x8000 ? arg3W - 0x10000 : arg3W;

  //   ext.l D0 (D0 = sext32(arg2.w)); push D0; push D3; jsr FUN_2572.
  // sext32(arg2.w). Default no-op (matching FUN_2572 patched a rts).
  subs?.fun_2572?.(arg1, arg2Signed | 0);

  // (2) Slot search: first i in [0..3] with STATE[i] == 0.
  for (let d5 = 0; d5 < SLOT_COUNT; d5++) {
    if ((r[STATE_BASE_OFF + d5] ?? 0) !== 0) continue;

    // DATA_PTR[D5] = arg1 (long, big-endian)
    const dataOff = DATA_PTR_BASE_OFF + d5 * 4;
    r[dataOff] = (arg1 >>> 24) & 0xff;
    r[dataOff + 1] = (arg1 >>> 16) & 0xff;
    r[dataOff + 2] = (arg1 >>> 8) & 0xff;
    r[dataOff + 3] = arg1 & 0xff;

    // THRESHOLD[D5] = abs(sext(arg3.w)) (word, big-endian).
    // Note: per arg3.w == 0x8000 (-32768), |x| in long = 32768, low word
    const absArg3 = arg3Signed < 0 ? -arg3Signed : arg3Signed;
    const thrW = absArg3 & 0xffff;
    const thrOff = THRESHOLD_BASE_OFF + d5 * 2;
    r[thrOff] = (thrW >>> 8) & 0xff;
    r[thrOff + 1] = thrW & 0xff;

    r[STATE_BASE_OFF + d5] = arg3Signed < 0 ? 6 : 5;

    // WORD16[D5] = arg2.w (word, big-endian)
    const w16Off = WORD16_BASE_OFF + d5 * 2;
    r[w16Off] = (arg2W >>> 8) & 0xff;
    r[w16Off + 1] = arg2W & 0xff;

    const cntOff = COUNTER_BASE_OFF + d5 * 2;
    r[cntOff] = 0;
    r[cntOff + 1] = 0;

    return 1;
  }

  return 0;
}
