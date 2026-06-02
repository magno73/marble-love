/**
 * state-sub-2c60.ts - port of `FUN_00002C60` (116 bytes).
 *
 * Helper called by the `FUN_00002E18` root dispatcher; see `game-state-machine.ts`.
 *
 *   - `arg1Long` = pointer (long) to the new data installed in the slot.
 *
 * **Disasm 0x2C60..0x2CD2** (116 byte):
 *
 *   movem.l D2-D3, -(SP)            ; save D2/D3
 *   move.l  (12,SP),D2              ; D2 = arg1Long (long)
 *   move.w  (18,SP),D1              ; D1.w = low word of arg2Long (BE)
 *   clr.w   D3w                     ; D3 = 0 (loop counter [0..3])
 * loop:
 *   move.w  D3,D0
 *   movea.l #0x00401F1C,A0          ; A0 = STATE_BASE
 *   tst.b   (0,A0,D0w*1)            ; tst.b STATE[D3]
 *   bne.b   skip                    ; if STATE != 0: slot busy -> skip
 *   ; STATE == 0: claim slot
 *   move.w  D3,D0
 *   asl.w   #2,D0w                  ; D0 = D3 * 4
 *   movea.l #0x00401F04,A0          ; A0 = DATA_PTR_BASE
 *   move.l  D2,(0,A0,D0w*1)         ; DATA_PTR[D3] = arg1Long (long)
 *   move.w  D3,D0
 *   movea.l #0x00401F1C,A0          ; A0 = STATE_BASE
 *   move.b  #4,(0,A0,D0w*1)         ; STATE[D3] = 4
 *   move.w  D3,D0
 *   add.w   D0,D0                   ; D0 = D3 * 2
 *   movea.l #0x00401F20,A0          ; A0 = THRESHOLD_BASE
 *   move.w  D1,(0,A0,D0w*1)         ; THRESHOLD[D3] = D1.w (low word arg2)
 *   move.w  D3,D0
 *   add.w   D0,D0
 *   movea.l #0x00401F28,A0          ; A0 = COUNTER_BASE
 *   clr.w   (0,A0,D0w*1)            ; COUNTER[D3] = 0
 *   move.w  D3,D0
 *   movea.l #0x00401F34,A0          ; A0 = FLAG34_BASE
 *   clr.b   (0,A0,D0w*1)            ; FLAG34[D3] = 0
 *   moveq   #1,D0                   ; D0 = 1 (claimed)
 *   bra.b   end
 * skip:
 *   addq.w  #1,D3w                  ; D3 += 1
 *   moveq   #4,D0
 *   cmp.w   D3,D0                   ; cmp D3,#4
 *   bgt.b   loop                    ; if 4 > D3 (signed): loop
 *   moveq   #0,D0                   ; D0 = 0 (no free slot)
 * end:
 *   movem.l (SP)+,D2-D3             ; restore D2/D3
 *   rts
 *
 * **Semantics**: walks the four slots, claims the first slot with `STATE[i] == 0`,
 * and initializes it as state==4: DATA_PTR[i]=arg1, STATE[i]=4,
 *
 *
 */

import type { GameState } from "./state.js";
import {
  DATA_PTR_BASE_OFF,
  STATE_BASE_OFF,
  THRESHOLD_BASE_OFF,
  COUNTER_BASE_OFF,
  FLAG34_BASE_OFF,
  SLOT_COUNT,
} from "./game-state-machine.js";

export interface StateSub2C60Subs {}

export interface StateSub2C60Result {
  claimed: 0 | 1;
  slot: number;
}

/**
 *
 * @param state    GameState. Mutates DATA_PTR, STATE, THRESHOLD, COUNTER, FLAG34
 *                 in `state.workRam` @ 0x401F00..0x401F37.
 * @param arg1Long Pointer (long) installed in `DATA_PTR[slot]`.
 * @param _subs    Reserved for pattern symmetry; ignored.
 *
 * @returns `{ claimed, slot }`. `claimed === 1` when the first free slot is claimed.
 *
 * **Side effects** in `state.workRam` (only when `claimed === 1`):
 *   - DATA_PTR[slot]   = arg1Long              (long, big-endian)
 *   - STATE[slot]      = 4                     (byte)
 *   - THRESHOLD[slot]  = arg2Long & 0xFFFF     (word, big-endian)
 *   - COUNTER[slot]    = 0                     (word)
 *   - FLAG34[slot]     = 0                     (byte)
 */
export function stateSub2C60(
  state: GameState,
  arg1Long: number,
  arg2Long: number,
  _subs?: StateSub2C60Subs,
): StateSub2C60Result {
  const r = state.workRam;
  const a1 = arg1Long >>> 0;
  const a2w = arg2Long & 0xffff;

  for (let d3 = 0; d3 < SLOT_COUNT; d3++) {
    const stateByte = r[STATE_BASE_OFF + d3] ?? 0;
    if (stateByte !== 0) continue; // slot busy -> skip

    // Claim slot d3
    const dataOff = DATA_PTR_BASE_OFF + d3 * 4;
    r[dataOff] = (a1 >>> 24) & 0xff;
    r[dataOff + 1] = (a1 >>> 16) & 0xff;
    r[dataOff + 2] = (a1 >>> 8) & 0xff;
    r[dataOff + 3] = a1 & 0xff;

    r[STATE_BASE_OFF + d3] = 4;

    const thrOff = THRESHOLD_BASE_OFF + d3 * 2;
    r[thrOff] = (a2w >>> 8) & 0xff;
    r[thrOff + 1] = a2w & 0xff;

    const cntOff = COUNTER_BASE_OFF + d3 * 2;
    r[cntOff] = 0;
    r[cntOff + 1] = 0;

    r[FLAG34_BASE_OFF + d3] = 0;

    return { claimed: 1, slot: d3 };
  }

  return { claimed: 0, slot: -1 };
}
