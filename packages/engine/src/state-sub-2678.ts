/**
 * state-sub-2678.ts — replica `FUN_00002678` (74 byte).
 *
 * Sub-function "deregister-by-pointer" del state-machine scheduler. Chiamata
 * dal dispatcher root `FUN_00002E18` (vedi `game-state-machine.ts`,
 * `GameStateMachineSubs.fun_2678`) quando lo slot è in `state == 1`.
 *
 * **Argomento (long sullo stack)**: `argLong` = pointer / handle che
 * identifica la "sorgente" da rimuovere. Il caller in 2E18 lo legge da
 * `DATA_PTR[D4]` (long @ 0x401F04 + D4*4) prima del dispatch.
 *
 * **Disasm 0x2678..0x26C2** (74 byte):
 *
 *   move.l  D2,-(SP)                ; salva D2
 *   move.l  (0x8,SP),D1             ; D1 = arg (SP+8: ret(4) + saved D2(4))
 *   clr.w   D2w                     ; D2 = 0 (loop counter, 4 slot)
 *   ; loop: D2 in {0, 1, 2, 3}
 *   move.w  D2w,D0w                 ; D0 = D2
 *   asl.w   #2,D0w                  ; D0 = D2 * 4
 *   movea.l #0x401F04,A0            ; A0 = DATA_PTR_BASE table
 *   cmp.l   (0,A0,D0w*1),D1         ; cmp DATA_PTR[D2] (long) vs D1
 *   bne.b   skip                    ; se != → non match, salta clear
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
 * **Semantica**: scorre i 4 slot della state-machine table; se uno slot
 * referenzia `argLong` (DATA_PTR[i] == argLong, long-equal), lo libera
 * azzerando STATE[i] e DATA_PTR[i]. Poi forwarda la chiamata a `FUN_2ABC`
 * passando lo stesso argLong (typically un cleanup/notify follow-up).
 *
 * **JSR target** identificato: `FUN_00002ABC` (alias `fun_2abc` nel
 * `GameStateMachineSubs`). NON è replicata qui: viene esposta via stub
 * injection per simmetria col dispatcher root.
 *
 * Verifica bit-perfect via `cli/src/test-state-sub-2678-parity.ts` con
 * FUN_2ABC patched a `rts` e callback no-op.
 */

import type { GameState } from "./state.js";
import {
  DATA_PTR_BASE_OFF,
  STATE_BASE_OFF,
  SLOT_COUNT,
} from "./game-state-machine.js";

/** Stub injection per la JSR a 0x2ABC. */
export interface StateSub2678Subs {
  /** FUN_2ABC(argLong). Default no-op (matching `rts`). */
  fun_2abc?: (argLong: number) => void;
}

/**
 * Replica bit-perfect di `FUN_00002678`.
 *
 * @param state    GameState (modifica STATE e DATA_PTR table @ 0x401F04..1F1F).
 * @param argLong  long arg dallo stack: pointer/handle da deregistrare.
 * @param subs     stub injection per `fun_2abc` (default no-op).
 *
 * **Side effects** in `state.workRam`:
 *   - Per ogni slot D2 in [0..3], se DATA_PTR[D2] (long, big-endian) ==
 *     argLong: STATE[D2] = 0; DATA_PTR[D2] = 0.
 *   - Forwarda chiamata a `subs.fun_2abc(argLong)` (default no-op).
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
    // DATA_PTR[D2] = 0 (long, big-endian → tutti 4 byte a 0)
    r[dataOff] = 0;
    r[dataOff + 1] = 0;
    r[dataOff + 2] = 0;
    r[dataOff + 3] = 0;
  }

  // jsr FUN_2ABC(argLong)
  subs?.fun_2abc?.(arg);
}
