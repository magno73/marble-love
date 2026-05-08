/**
 * refresh-helper-1493c.ts — replica bit-perfect di `FUN_0001493C`.
 *
 * Chiamata da FUN_00010FCE (refresh frame handler) @ 0x10FE6 come JSR.
 *
 * **Disasm 0x1493C..0x14964** (19 istruzioni, nessun arg esplicito):
 *
 *   0001493c  movem.l {D3 D2},-(SP)
 *   00014940  move.l  #0x401302,D3       ; D3 = base slot 0
 *   00014946  clr.b   D2b                ; loop counter = 0
 *   ; ── loop (D2 = 0..3) ──────────────────────────────────────────
 *   00014948  move.l  D3,D1              ; D1 = current slot ptr
 *   0001494a  moveq   0x60,D0            ; D0 = stride 0x60
 *   0001494c  add.l   D0,D3              ; D3 += 0x60 → next slot
 *   0001494e  move.l  D1,-(SP)           ; push arg: slot ptr
 *   00014950  jsr     0x00014966.l       ; FUN_14966(slotPtr)
 *   00014956  addq.l  0x4,SP             ; pop arg
 *   00014958  addq.b  0x1,D2b            ; counter++
 *   0001495a  cmpi.b  #0x4,D2b          ; compare with 4
 *   0001495e  bne.b   0x00014948         ; loop while != 4
 *   ; ── end loop ──────────────────────────────────────────────────
 *   00014960  movem.l (SP)+,{D2 D3}
 *   00014964  rts
 *
 * **Cosa fa**:
 *   Itera su 4 slot contigui a partire da 0x401302, stride 0x60, e chiama
 *   FUN_14966 su ciascuno. Le slot si trovano agli indirizzi:
 *     - slot 0: 0x401302
 *     - slot 1: 0x401362
 *     - slot 2: 0x4013C2
 *     - slot 3: 0x401422
 *
 * **FUN_14966** (unico callee, unico caller = questa funzione):
 *   Non replicata — iniettabile come stub (default: no-op).
 *   Prende un singolo argomento long (indirizzo slot) passato on-stack.
 */

import type { GameState } from "./state.js";

export const REFRESH_HELPER_1493C_ADDR = 0x0001493c as const;

/** Indirizzo base del primo slot (0x401302). */
export const SLOT_BASE_ADDR = 0x00401302 as const;

/** Stride tra slot consecutivi (0x60 = 96 byte). */
export const SLOT_STRIDE = 0x60 as const;

/** Numero di slot iterati. */
export const SLOT_COUNT = 4 as const;

/**
 * Callback iniettabile per FUN_14966.
 *
 * Nel binario FUN_14966 riceve il puntatore allo slot come singolo arg
 * long passato on-stack. In TS riceviamo `state` e `slotAddr` (indirizzo
 * assoluto in work RAM).
 *
 * Default: no-op (stub appropriato per test di parità; il corpo di
 * FUN_14966 ha effetti solo sulle strutture slot a cui punta `slotAddr`).
 */
export type Fun14966 = (state: GameState, slotAddr: number) => void;

/**
 * Replica bit-perfect di `FUN_0001493C` — refresh frame helper.
 *
 * Nessun argomento esplicito, nessun return. Side effects dipendono
 * interamente dall'implementazione di `fun14966`.
 *
 * @param state   GameState corrente. Mutato (potenzialmente) da fun14966.
 * @param fun14966 Implementazione di FUN_14966. Default: no-op stub.
 */
export function refreshHelper1493C(
  state: GameState,
  fun14966: Fun14966 = (_s, _a) => undefined,
): void {
  // D3 = 0x401302 (base address, advances by SLOT_STRIDE each iteration)
  let d3 = SLOT_BASE_ADDR;

  // D2.b = 0 (loop counter, 4 iterations)
  for (let d2 = 0; d2 < SLOT_COUNT; d2++) {
    // D1 = D3 (current slot ptr)
    const slotPtr = d3;
    // D3 += 0x60 (advance to next slot)
    d3 = (d3 + SLOT_STRIDE) >>> 0;
    // jsr FUN_14966(slotPtr)
    fun14966(state, slotPtr);
  }
}
