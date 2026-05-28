/**
 * state-sub-2678.ts - port of `FUN_00002678` (74 bytes).
 *
 * Helper called by the `FUN_00002E18` root dispatcher; see `game-state-machine.ts`.
 *
 *
 * **Disasm 0x2678..0x26C2** (74 byte):
 *
 *   move.l  D2,-(SP)                ; save D2
 *   move.l  (0x8,SP),D1             ; D1 = arg (SP+8: ret(4) + saved D2(4))
 *   clr.w   D2w                     ; D2 = 0 (loop counter, 4 slot)
 *   ; loop: D2 in {0, 1, 2, 3}
 *   move.w  D2w,D0w                 ; D0 = D2
 *   asl.w   #2,D0w                  ; D0 = D2 * 4
 *   movea.l #0x401F04,A0            ; A0 = DATA_PTR_BASE table
 *   cmp.l   (0,A0,D0w*1),D1         ; cmp DATA_PTR[D2] (long) vs D1
 *     move.w  D2w,D0w
 *     movea.l #0x401F1C,A0          ; A0 = STATE_BASE
 *     clr.b   (0,A0,D0w*1)          ; STATE[D2] = 0
 *     move.w  D2w,D0w
 *     asl.w   #2,D0w                ; D0 = D2*4
 *     movea.l #0x401F04,A0
 *     clr.l   (0,A0,D0w*1)          ; DATA_PTR[D2] = 0 (long)
 *   skip:
 *   addq.w  #1,D2w                  ; D2 += 1
 *   moveq   #4,D0
 *   cmp.w   D2w,D0w                 ; cmp D2,#4
 *   bgt.b   loop                    ; if 4 > D2 (signed) → loop (D2 < 4)
 *   move.l  D1,-(SP)                ; push argLong
 *   jsr     FUN_00002ABC            ; call FUN_2ABC(argLong)
 *   moveq   #1,D0                   ; D0 = 1 (return value, ignored by caller)
 *   addq.l  #4,SP                   ; pop arg
 *   move.l  (SP)+,D2                ; restore D2
 *   rts
 *
 * **Semantics**: walks the four state-machine slots. If a slot references
 * `argLong` (DATA_PTR[i] == argLong, long-equal), it frees the slot and then
 * passes the same argLong to the cleanup/notify follow-up.
 *
 * **Identified JSR target**: `FUN_00002ABC` (alias `fun_2abc` in the injection
 * for symmetry with the root dispatcher).
 *
 * In parity tests, FUN_2ABC is patched to `rts` and the callback is a no-op.
 */

import type { GameState } from "./state.js";
import {
  DATA_PTR_BASE_OFF,
  STATE_BASE_OFF,
  SLOT_COUNT,
} from "./game-state-machine.js";

/** Stub injection for the JSR at 0x2ABC. */
export interface StateSub2678Subs {
  /** FUN_2ABC(argLong). Default no-op (matching `rts`). */
  fun_2abc?: (argLong: number) => void;
}

/**
 *
 * @param state    GameState. Mutates STATE and DATA_PTR tables @ 0x401F04..1F1F.
 * @param argLong  Long arg from the stack: pointer/handle to deregister.
 * @param subs     Stub injection for `fun_2abc` (default no-op).
 *
 * **Side effects** in `state.workRam`:
 *   - For each slot D2 in [0..3], if DATA_PTR[D2] (long, big-endian) ==
 *     argLong: STATE[D2] = 0; DATA_PTR[D2] = 0.
 */
export function stateSub2678(
  state: GameState,
  argLong: number,
  subs?: StateSub2678Subs,
): void {
  const r = state.workRam;
  const arg = argLong >>> 0;

  for (let d2 = 0; d2 < SLOT_COUNT; d2++) {
    const dataOff = DATA_PTR_BASE_OFF + d2 * 4;
    const slot =
      (((r[dataOff] ?? 0) << 24) |
        ((r[dataOff + 1] ?? 0) << 16) |
        ((r[dataOff + 2] ?? 0) << 8) |
        (r[dataOff + 3] ?? 0)) >>>
      0;
    if (slot !== arg) continue;

    // STATE[D2] = 0 (byte)
    r[STATE_BASE_OFF + d2] = 0;
    r[dataOff] = 0;
    r[dataOff + 1] = 0;
    r[dataOff + 2] = 0;
    r[dataOff + 3] = 0;
  }

  // jsr FUN_2ABC(argLong)
  subs?.fun_2abc?.(arg);
}
