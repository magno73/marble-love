/**
 * state-sub-28ea.ts - port of `FUN_000028EA` (112 bytes).
 *
 * State-machine helper "set-target-and-register-state-7".
 * Variant 7 of the `scheduleStateMachineN` family (see `state-machine-schedule.ts`
 * for variants 1..6). Difference from stateSub2BDA (state=3):
 *   - Registers the slot with state byte = 7.
 *
 *   - `arg1Long` (long): `dataPtr` assigned to `DATA_PTR[slot]` and passed to
 *     rendering (D2).
 *
 * **Disasm 0x28EA..0x2958** (112 byte, end-exclusive 0x295A):
 *
 *   movem.l {D3,D2},-(SP)              ; save D3, D2 (8 bytes)
 *   move.l  (0xC,SP),D2                ; D2 = arg1 long  (SP+12: ret(4) + saved(8))
 *   move.w  (0x12,SP),D3w              ; D3.w = low word of arg2
 *   move.w  (0x16,SP),D0w              ; D0.w = low word of arg3
 *   move.w  D0w,(0x00401F3E).l         ; *(0x401F3E) = arg3.w
 *   move.w  D3w,D0w
 *   ext.l   D0                         ; sext.l(arg2.w) → long
 *   move.l  D0,-(SP)                   ; push sext_l(arg2.w)
 *   move.l  D2,-(SP)                   ; push dataPtr (long)
 *   jsr     0x00002572.l               ; FUN_2572(dataPtr, sext_l(arg2.w))
 *   clr.w   D1w                        ; D1 = 0 (loop counter)
 *   addq.l  #8,SP                      ; pop 2 long args
 *   ; loop @ 0x2912: D1 in {0,1,2,3}
 *   move.w  D1w,D0w
 *   movea.l #0x401F1C,A0               ; A0 = STATE_BASE
 *   tst.b   (0,A0,D0w*1)               ; STATE[D1] != 0 ?
 *     move.w  D1w,D0w
 *     asl.w   #2,D0w                   ; D0 = D1*4
 *     movea.l #0x401F04,A0
 *     move.l  D2,(0,A0,D0w*1)          ; DATA_PTR[D1] = D2 (long)
 *     move.w  D1w,D0w
 *     movea.l #0x401F1C,A0
 *     move.b  #7,(0,A0,D0w*1)          ; STATE[D1] = 7 (byte)
 *     move.w  D1w,D0w
 *     add.w   D0w,D0w                  ; D0 = D1*2
 *     movea.l #0x401F14,A0
 *     move.w  D3w,(0,A0,D0w*1)         ; WORD16[D1] = D3.w
 *     bra.b   epilog
 *   skip: addq.w  #1,D1w
 *         moveq   #4,D0
 *         cmp.w   D1w,D0w              ; cmp D1,#4
 *         bgt.b   loop                  ; if 4 > D1 (signed) → loop (D1 < 4)
 *   epilog: movem.l (SP)+,{D2,D3}
 *           rts
 *
 * Renders the string chain (side effect on alpha tilemap @ 0xA03000+), then
 * claims the first free state-machine slot.
 *
 *
 * **JSR target**: `FUN_00002572` (`renderStringChain`). Exposed through stub
 * injection (`StateSub28EASubs.fun_2572`) for symmetry with the other helpers
 * (see `state-machine-schedule.ts`, `scheduleStateMachine1/2`).
 *
 * In parity tests, FUN_2572 is patched to `rts` and the callback is a no-op.
 */

import type { GameState } from "./state.js";
import type { RomImage } from "./bus.js";
import {
  DATA_PTR_BASE_OFF,
  WORD16_BASE_OFF,
  STATE_BASE_OFF,
  SPECIAL_TARGET_OFF,
  SLOT_COUNT,
} from "./game-state-machine.js";

/** Stub injection for the JSR at 0x2572 (`FUN_2572` / renderStringChain). */
export interface StateSub28EASubs {
  /**
   * `FUN_2572` - renderStringChain. Default no-op (matching `rts`).
   *
   * @param dataPtr    long: `arg1Long` = pointer to the string chain.
   * @param attrSigned long: `sext.l(arg2.w)` = attr passed as a long,
   *                   sign-extended from the low word.
   */
  fun_2572?: (
    state: GameState,
    rom: RomImage,
    dataPtr: number,
    attrSigned: number,
  ) => void;
}

/**
 *
 * @param state    GameState. Mutates `state.workRam`:
 *                   - If it finds a free slot `i` in [0..3]:
 *                     - `DATA_PTR[i]` (long, big-endian) = `arg1Long`
 *                     - `STATE[i]` (byte) = 7
 *                     - `WORD16[i]` (word, big-endian) = `arg2Long & 0xFFFF`
 * @param rom      ROM image passed to `subs.fun_2572` for rendering.
 * @param arg1Long long: `dataPtr` (long, big-endian).
 * @param subs     Stub injection for `fun_2572` (default no-op, matching `rts`).
 *
 */
export function stateSub28EA(
  state: GameState,
  rom: RomImage,
  arg1Long: number,
  arg2Long: number,
  arg3Long: number,
  subs?: StateSub28EASubs,
): void {
  const r = state.workRam;
  const arg1 = arg1Long >>> 0;
  const arg2W = arg2Long & 0xffff;
  const arg3W = arg3Long & 0xffff;

  r[SPECIAL_TARGET_OFF] = (arg3W >>> 8) & 0xff;
  r[SPECIAL_TARGET_OFF + 1] = arg3W & 0xff;

  // jsr FUN_2572(dataPtr, sext_l(arg2.w))
  const arg2Signed = arg2W & 0x8000 ? arg2W - 0x10000 : arg2W;
  if (subs?.fun_2572) {
    subs.fun_2572(state, rom, arg1, arg2Signed | 0);
  }

  for (let d1 = 0; d1 < SLOT_COUNT; d1++) {
    if ((r[STATE_BASE_OFF + d1] ?? 0) !== 0) continue;

    // DATA_PTR[D1] = arg1 (long, big-endian)
    const dataOff = DATA_PTR_BASE_OFF + d1 * 4;
    r[dataOff] = (arg1 >>> 24) & 0xff;
    r[dataOff + 1] = (arg1 >>> 16) & 0xff;
    r[dataOff + 2] = (arg1 >>> 8) & 0xff;
    r[dataOff + 3] = arg1 & 0xff;

    // STATE[D1] = 7 (byte)
    r[STATE_BASE_OFF + d1] = 7;

    // WORD16[D1] = arg2.w (word, big-endian)
    const w16Off = WORD16_BASE_OFF + d1 * 2;
    r[w16Off] = (arg2W >>> 8) & 0xff;
    r[w16Off + 1] = arg2W & 0xff;

    return;
  }

}
