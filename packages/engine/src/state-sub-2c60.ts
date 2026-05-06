/**
 * state-sub-2c60.ts — replica `FUN_00002C60` (116 byte).
 *
 * Sub-function "claim-free-slot-state-4" del state-machine scheduler. Chiamata
 * dal dispatcher root `FUN_00002E18` (vedi `game-state-machine.ts`,
 * `GameStateMachineSubs.fun_2c60`) come transition di state==4 quando il
 * risultato di `FUN_2DA0` torna 0 e `*(data[D4]+8)` non è zero.
 *
 * **Argomenti**:
 *   - `arg1Long` = pointer (long) alla nuova "data" da installare nello slot
 *   - `arg2Long` = threshold (long; **solo low word** usato come `move.w`)
 *
 * **Disasm 0x2C60..0x2CD2** (116 byte):
 *
 *   movem.l D2-D3, -(SP)            ; salva D2/D3
 *   move.l  (12,SP),D2              ; D2 = arg1Long (long)
 *   move.w  (18,SP),D1              ; D1.w = low word di arg2Long (BE)
 *   clr.w   D3w                     ; D3 = 0 (loop counter [0..3])
 * loop:
 *   move.w  D3,D0
 *   movea.l #0x00401F1C,A0          ; A0 = STATE_BASE
 *   tst.b   (0,A0,D0w*1)            ; tst.b STATE[D3]
 *   bne.b   skip                    ; se STATE != 0: slot busy → skip
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
 * **Semantica**: scorre i 4 slot, claim del **primo** slot con `STATE[i] == 0`,
 * inizializzandolo come state==4: setta DATA_PTR[i]=arg1, STATE[i]=4,
 * THRESHOLD[i]=arg2.w, COUNTER[i]=0, FLAG34[i]=0. Ritorna D0=1 in caso di
 * claim, D0=0 se tutti gli slot sono busy. Nessuna JSR esterna.
 *
 * **Nessuna JSR** → nessuna sub injection necessaria. La firma include `subs?`
 * opzionale per simmetria col pattern usato da `state-sub-2678.ts`.
 *
 * Verifica bit-perfect via `cli/src/test-state-sub-2c60-parity.ts`.
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

/** Stub injection (unused — FUN_2C60 non chiama JSR esterne). */
export interface StateSub2C60Subs {
  // Reserved per futuro pattern symmetry. Nessuna sub-call attualmente.
}

/**
 * Risultato della replica: `claimed === 1` se uno slot è stato preso,
 * `0` altrimenti (matching `D0` del binario).
 */
export interface StateSub2C60Result {
  /** Return value (D0): 1 se claim successful, 0 se nessun slot libero. */
  claimed: 0 | 1;
  /** Indice slot claimed (0..3) o -1 se nessuno. */
  slot: number;
}

/**
 * Replica bit-perfect di `FUN_00002C60`.
 *
 * @param state    GameState (modifica DATA_PTR, STATE, THRESHOLD, COUNTER, FLAG34
 *                 in `state.workRam` @ 0x401F00..0x401F37).
 * @param arg1Long pointer (long) installato in `DATA_PTR[slot]`.
 * @param arg2Long threshold (long); solo low word usato (matching `move.w`).
 * @param _subs    riservato per pattern symmetry; ignorato.
 *
 * @returns `{ claimed, slot }`. `claimed === 1` se il primo slot con
 *          `STATE[i] == 0` è stato preso. `claimed === 0` se tutti busy.
 *
 * **Side effects** in `state.workRam` (solo se `claimed === 1`):
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
  // `move.w (18,SP),D1` legge solo la low word del long arg2 (big-endian).
  const a2w = arg2Long & 0xffff;

  for (let d3 = 0; d3 < SLOT_COUNT; d3++) {
    const stateByte = r[STATE_BASE_OFF + d3] ?? 0;
    if (stateByte !== 0) continue; // slot busy → skip

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
