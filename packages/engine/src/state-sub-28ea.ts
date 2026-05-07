/**
 * state-sub-28ea.ts — replica `FUN_000028EA` (112 byte).
 *
 * Sub-function "set-target-and-register-state-7" del state-machine scheduler.
 * Variant "7" della famiglia `scheduleStateMachineN` (cfr. `state-machine-schedule.ts`
 * per le variant 1..6). Differenze rispetto a stateSub2BDA (state=3):
 *   - Scrive un global word target a `0x401F3E` PRIMA della jsr (`SPECIAL_TARGET_OFF`)
 *   - Chiama JSR a `FUN_00002572` (renderStringChain) con (`dataPtr`, sext.l(word16))
 *   - Registra slot con state byte = 7
 *   - **Non** scrive THRESHOLD / COUNTER / FLAG34 (a differenza di state=3)
 *
 * **Argomenti (3 long sullo stack)**:
 *   - `arg1Long` (long): `dataPtr` da assegnare a `DATA_PTR[slot]` e passare al
 *     render (D2).
 *   - `arg2Long` (long, ma usato come word): low word in `WORD16[slot]` (D3) e,
 *     dopo sign-extension a long, secondo argomento di `FUN_2572`.
 *   - `arg3Long` (long, ma usato come word): low word scritto in `0x401F3E`
 *     (target globale), usato dalla render via gating in altre sub.
 *
 * **Disasm 0x28EA..0x2958** (112 byte, end-exclusive 0x295A):
 *
 *   movem.l {D3,D2},-(SP)              ; salva D3, D2 (8 byte)
 *   move.l  (0xC,SP),D2                ; D2 = arg1 long  (SP+12: ret(4) + saved(8))
 *   move.w  (0x12,SP),D3w              ; D3.w = low word di arg2
 *   move.w  (0x16,SP),D0w              ; D0.w = low word di arg3
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
 *   bne.b   skip                       ; sì → slot occupato, prossimo
 *   ; slot vuoto → registra qui:
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
 * **Semantica**: scrive `0x401F3E` con la target word, esegue il render della
 * string chain (side-effect su alpha tilemap @ 0xA03000+), poi cerca il primo
 * slot libero (`STATE[i] == 0`) e lo inizializza in stato 7 con
 * `DATA_PTR=arg1`, `WORD16=arg2.w`. Se nessun slot libero, `0x401F3E` resta
 * scritta e il render avviene comunque, ma non c'è registrazione.
 *
 * **Ritorno**: void (nessun `moveq #X,D0` prima di `rts`; D0 mantiene il
 * valore di ritorno di FUN_2572, che il caller in genere ignora).
 *
 * **JSR target**: `FUN_00002572` (`renderStringChain`). Esposto via stub
 * injection (`StateSub28EASubs.fun_2572`) per simmetria con gli altri sub
 * (cfr. `state-machine-schedule.ts`, `scheduleStateMachine1/2`).
 *
 * Verifica bit-perfect via `cli/src/test-state-sub-28ea-parity.ts` con
 * FUN_2572 patched a `rts` e callback no-op.
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

/** Stub injection per la JSR a 0x2572 (`FUN_2572` / renderStringChain). */
export interface StateSub28EASubs {
  /**
   * `FUN_2572` — renderStringChain. Default no-op (matching `rts`).
   *
   * @param state      GameState (la render scrive in alpha tilemap).
   * @param rom        ROM image (la render legge tabelle ROM).
   * @param dataPtr    long: `arg1Long` = pointer alla string chain.
   * @param attrSigned long: `sext.l(arg2.w)` = attr passato come long
   *                   sign-extended dalla low word.
   */
  fun_2572?: (
    state: GameState,
    rom: RomImage,
    dataPtr: number,
    attrSigned: number,
  ) => void;
}

/**
 * Replica bit-perfect di `FUN_000028EA` — `scheduleStateMachine7`.
 *
 * @param state    GameState. Modifica in `state.workRam`:
 *                   - `0x401F3E` (word, target globale) — sempre.
 *                   - Se trova slot libero `i` in [0..3]:
 *                     - `DATA_PTR[i]` (long, big-endian) = `arg1Long`
 *                     - `STATE[i]` (byte) = 7
 *                     - `WORD16[i]` (word, big-endian) = `arg2Long & 0xFFFF`
 * @param rom      ROM image (passata a `subs.fun_2572` per la render).
 * @param arg1Long long: `dataPtr` (long, big-endian).
 * @param arg2Long long: solo low word usata come `word16` (sign-extesa per
 *                 il render).
 * @param arg3Long long: solo low word usata come target → `0x401F3E`.
 * @param subs     stub injection per `fun_2572` (default no-op, matching
 *                 `rts` patch nel binario per parity).
 *
 * @returns void. Il binario lascia in D0 il return di FUN_2572 (ignorato).
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
  // Solo low word: il binario fa `move.w (0x12,SP),D3w` e `(0x16,SP),D0w`.
  const arg2W = arg2Long & 0xffff;
  const arg3W = arg3Long & 0xffff;

  // *(0x401F3E) = arg3.w (word, big-endian) — PRIMA della jsr.
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

  // Nessuno slot libero → return senza scritture aggiuntive
  // (`0x401F3E` è già stato scritto sopra, side effect persistente).
}
