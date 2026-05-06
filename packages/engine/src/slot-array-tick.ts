/**
 * slot-array-tick.ts — replica `FUN_0001493C` (42 byte).
 *
 * Iteratore "fan-out" del main-tick: scorre i **4 slot** dell'array-4
 * (`0x401302`, stride `0x60` — vedi `slot-array-init.ts` e `slot-search.ts`)
 * e per ognuno chiama il per-slot ticker `FUN_00014966` passando il puntatore
 * dello slot come unico argomento sullo stack.
 *
 * **Caller**: `FUN_00010FCE` (chiamato dal main pipeline una volta per frame
 * — vedi xref). FUN_1493C è l'unica callee fra le 5 sub di FUN_10FCE che
 * processa specificamente l'array-4.
 *
 * **Disasm 0x1493C..0x14965** (42 byte):
 *
 *   movem.l {D3,D2},-(SP)            ; salva D3/D2 (8 byte)
 *   move.l  #0x401302,D3             ; D3 = slot ptr base
 *   clr.b   D2b                      ; D2 = 0 (loop counter, 4 slot)
 *   ; loop @ 0x14948:
 *   move.l  D3,D1                    ; D1 = current slot ptr
 *   moveq   #0x60,D0                 ; D0 = stride
 *   add.l   D0,D3                    ; D3 += 0x60 (advance to next slot)
 *   move.l  D1,-(SP)                 ; push currentSlotPtr
 *   jsr     0x00014966.l             ; tick(currentSlotPtr)
 *   addq.l  #4,SP                    ; pop arg
 *   addq.b  #1,D2b                   ; D2++
 *   cmpi.b  #4,D2b                   ; cmp D2,#4
 *   bne.b   0x14948                  ; if D2 != 4 → loop
 *   movem.l (SP)+,{D2,D3}            ; restore D2/D3
 *   rts
 *
 * **Semantica**: 4 chiamate a `FUN_14966`, una per ciascun slot:
 *   - call 0: ptr = 0x401302
 *   - call 1: ptr = 0x401362
 *   - call 2: ptr = 0x4013C2
 *   - call 3: ptr = 0x401422
 *
 * **Nessuno side-effect diretto** sulla work RAM: tutti i write derivano
 * dalla callee. `FUN_1493C` ritorna senza valore significativo (D0 non viene
 * scritto: il caller `FUN_10FCE` non lo usa).
 *
 * **Ordine deterministico**: il loop incrementa `D3 += 0x60` PRIMA della
 * `jsr`, ma `D1` (= snapshot pre-incremento) viene pushato come arg, quindi
 * l'i-esima call vede il pointer dello slot i-esimo (non i+1).
 */

import type { GameState } from "./state.js";

/** Base address dell'array-4 (4 slot × 0x60 byte) in work RAM. */
export const SLOT_ARRAY_BASE = 0x00401302 as const;
/** Stride fra slot consecutivi. */
export const SLOT_ARRAY_STRIDE = 0x60 as const;
/** Numero di slot iterati. */
export const SLOT_ARRAY_COUNT = 4 as const;

/**
 * Stub injection per la JSR a `0x14966` (per-slot ticker).
 *
 * `slotTick(slotPtr, state)`: invocata 4 volte con i puntatori assoluti dei
 * 4 slot (0x401302, 0x401362, 0x4013C2, 0x401422). Il `state` è passato per
 * comodità (la callee originale modifica work RAM tramite quel ptr).
 *
 * Default no-op (matching `rts` patch nel parity test).
 */
export interface SlotArrayTickSubs {
  /** FUN_14966(slotPtr). Default no-op. */
  fun_14966?: (slotPtr: number, state: GameState) => void;
}

/**
 * Replica bit-perfect di `FUN_0001493C` — fan-out tick sui 4 slot
 * dell'array-4 (`0x401302`).
 *
 * @param state  GameState (forwardato a `subs.fun_14966` per ogni slot).
 * @param subs   Stub injection per la JSR a `FUN_14966`. Se `fun_14966`
 *               è undefined, la funzione è un no-op puro (4 iterazioni vuote).
 *
 * **Side effects**: nessuno diretto. Tutti i write a work RAM passano per
 * la callback `fun_14966`.
 *
 * **Ordine di chiamata** (deterministico, importante per parity):
 *   slot 0 (0x401302) → slot 1 (0x401362) → slot 2 (0x4013C2) → slot 3 (0x401422)
 */
export function slotArrayTick(
  state: GameState,
  subs?: SlotArrayTickSubs,
): void {
  const cb = subs?.fun_14966;
  let slotPtr = SLOT_ARRAY_BASE >>> 0;
  for (let i = 0; i < SLOT_ARRAY_COUNT; i++) {
    // FUN_14966 viene chiamata col pointer pre-incremento (D1 = snapshot
    // di D3 prima di `add.l D0,D3`). Quindi snapshotPtr corrisponde al
    // slot i-esimo, non i+1-esimo.
    const snapshotPtr = slotPtr;
    slotPtr = (slotPtr + SLOT_ARRAY_STRIDE) >>> 0;
    cb?.(snapshotPtr, state);
  }
}
