/**
 * state-sub-2bda.ts — replica `FUN_00002BDA` (134 byte).
 *
 * Sub-function "register-in-first-empty-slot" del state-machine scheduler.
 * Chiamata dal dispatcher root `FUN_00002E18` (vedi `game-state-machine.ts`,
 * `GameStateMachineSubs.fun_2bda`) durante il branch state==3 quando il
 * sub-state ritorna 0 e il pointer next (`*(data+8)`) non è zero: il caller
 * "ri-aggancia" la nuova entry come slot fresh in stato 3.
 *
 * **Argomenti (3 long sullo stack)**:
 *   - `arg1Long` (long): nuovo `dataPtr` da assegnare a DATA_PTR[slot].
 *   - `arg2Long` (long, ma usato solo come word): `WORD16[slot]`.
 *   - `arg3Long` (long, ma usato solo come word): `THRESHOLD[slot]`.
 *
 * **Disasm 0x2BDA..0x2C5C** (134 byte):
 *
 *   movem.l {D4,D3,D2},-(SP)         ; salva D2/D3/D4 (12 byte)
 *   move.l  (0x10,SP),D3             ; D3 = arg1 long  (SP+12=ret, +16=arg1)
 *   move.w  (0x16,SP),D2w            ; D2.w = low word di arg2 (SP+20)
 *   move.w  (0x1A,SP),D1w            ; D1.w = low word di arg3 (SP+24)
 *   clr.w   D4w                      ; D4 = 0 (loop counter, 4 slot)
 *   ; loop @ 0x2BEC: D4 in {0,1,2,3}
 *   move.w  D4w,D0w
 *   movea.l #0x401F1C,A0             ; A0 = STATE_BASE
 *   tst.b   (0,A0,D0w*1)             ; STATE[D4] != 0 ?
 *   bne.b   0x2C50                   ; sì → slot occupato, prossimo
 *   ; slot vuoto → registra qui:
 *     move.w  D4w,D0w
 *     asl.w   #2,D0w                 ; D0 = D4*4
 *     movea.l #0x401F04,A0
 *     move.l  D3,(0,A0,D0w*1)        ; DATA_PTR[D4] = D3 (long)
 *     move.w  D4w,D0w
 *     movea.l #0x401F1C,A0
 *     move.b  #3,(0,A0,D0w*1)        ; STATE[D4] = 3 (byte)
 *     move.w  D4w,D0w
 *     add.w   D0w,D0w                ; D0 = D4*2
 *     movea.l #0x401F20,A0
 *     move.w  D1w,(0,A0,D0w*1)       ; THRESHOLD[D4] = D1.w
 *     move.w  D4w,D0w
 *     add.w   D0w,D0w
 *     movea.l #0x401F14,A0
 *     move.w  D2w,(0,A0,D0w*1)       ; WORD16[D4] = D2.w
 *     move.w  D4w,D0w
 *     add.w   D0w,D0w
 *     movea.l #0x401F28,A0
 *     clr.w   (0,A0,D0w*1)           ; COUNTER[D4] = 0 (word)
 *     move.w  D4w,D0w
 *     movea.l #0x401F34,A0
 *     clr.b   (0,A0,D0w*1)           ; FLAG34[D4] = 0 (byte)
 *     moveq   #1,D0                  ; D0 = 1 (success)
 *     bra.b   0x2C5A                 ; → epilog
 *   0x2C50: addq.w #1,D4w
 *           moveq  #4,D0
 *           cmp.w  D4w,D0w           ; cmp D4,#4
 *           bgt.b  0x2BEC             ; if 4 > D4 (signed) → loop (D4 < 4)
 *   0x2C58: moveq  #0,D0             ; D0 = 0 (no slot libero)
 *   0x2C5A: movem.l (SP)+,{D2,D3,D4}
 *           rts
 *
 * **Semantica**: trova il primo slot libero (`STATE[i] == 0`, i in [0..3])
 * e lo inizializza in stato 3 con `dataPtr=arg1`, `word16=arg2.w`,
 * `threshold=arg3.w`, `counter=0`, `flag34=0`. Ritorna 1 se ha trovato
 * uno slot, 0 altrimenti.
 *
 * **Nessuna JSR**: la funzione è self-contained (puro write-into-table).
 *
 * Verifica bit-perfect via `cli/src/test-state-sub-2bda-parity.ts`.
 */

import type { GameState } from "./state.js";
import {
  DATA_PTR_BASE_OFF,
  WORD16_BASE_OFF,
  STATE_BASE_OFF,
  THRESHOLD_BASE_OFF,
  COUNTER_BASE_OFF,
  FLAG34_BASE_OFF,
  SLOT_COUNT,
} from "./game-state-machine.js";

/**
 * Stub injection placeholder. FUN_2BDA non chiama JSR, quindi questa
 * interface è vuota (mantenuta per simmetria col pattern degli altri
 * state-sub).
 */
export type StateSub2BDASubs = Record<string, never>;

/**
 * Replica bit-perfect di `FUN_00002BDA`.
 *
 * @param state    GameState (modifica STATE/DATA_PTR/WORD16/THRESHOLD/COUNTER/FLAG34
 *                 table @ 0x401F00..0x401F37).
 * @param arg1Long long: nuovo `dataPtr` da scrivere in DATA_PTR[slot].
 * @param arg2Long long: solo la low word va in WORD16[slot].
 * @param arg3Long long: solo la low word va in THRESHOLD[slot].
 * @param _subs    placeholder (FUN_2BDA non ha JSR).
 * @returns 1 se ha trovato slot libero (registrato), 0 se tutti occupati.
 *
 * **Side effects** in `state.workRam` (solo se trova slot vuoto i):
 *   - DATA_PTR[i] = arg1Long (long, big-endian)
 *   - STATE[i] = 3 (byte)
 *   - THRESHOLD[i] = arg3Long & 0xFFFF (word, big-endian)
 *   - WORD16[i] = arg2Long & 0xFFFF (word, big-endian)
 *   - COUNTER[i] = 0 (word)
 *   - FLAG34[i] = 0 (byte)
 */
export function stateSub2BDA(
  state: GameState,
  arg1Long: number,
  arg2Long: number,
  arg3Long: number,
  _subs?: StateSub2BDASubs,
): number {
  const r = state.workRam;
  const arg1 = arg1Long >>> 0;
  // Solo low word: il binario fa `move.w (0x16,SP),D2w` e `(0x1A,SP),D1w`.
  const arg2W = arg2Long & 0xffff;
  const arg3W = arg3Long & 0xffff;

  for (let d4 = 0; d4 < SLOT_COUNT; d4++) {
    if ((r[STATE_BASE_OFF + d4] ?? 0) !== 0) continue;

    // DATA_PTR[D4] = arg1 (long, big-endian)
    const dataOff = DATA_PTR_BASE_OFF + d4 * 4;
    r[dataOff] = (arg1 >>> 24) & 0xff;
    r[dataOff + 1] = (arg1 >>> 16) & 0xff;
    r[dataOff + 2] = (arg1 >>> 8) & 0xff;
    r[dataOff + 3] = arg1 & 0xff;

    // STATE[D4] = 3 (byte)
    r[STATE_BASE_OFF + d4] = 3;

    // THRESHOLD[D4] = arg3.w (word, big-endian)
    const thrOff = THRESHOLD_BASE_OFF + d4 * 2;
    r[thrOff] = (arg3W >>> 8) & 0xff;
    r[thrOff + 1] = arg3W & 0xff;

    // WORD16[D4] = arg2.w (word, big-endian)
    const w16Off = WORD16_BASE_OFF + d4 * 2;
    r[w16Off] = (arg2W >>> 8) & 0xff;
    r[w16Off + 1] = arg2W & 0xff;

    // COUNTER[D4] = 0 (word)
    const cntOff = COUNTER_BASE_OFF + d4 * 2;
    r[cntOff] = 0;
    r[cntOff + 1] = 0;

    // FLAG34[D4] = 0 (byte)
    r[FLAG34_BASE_OFF + d4] = 0;

    return 1;
  }

  return 0;
}
