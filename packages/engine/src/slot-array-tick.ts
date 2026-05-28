/**
 * slot-array-tick.ts - replica `FUN_0001493C`.
 *
 *
 *
 * **Disasm 0x1493C..0x14965** (42 byte):
 *
 *   movem.l {D3,D2},-(SP)            ; save D3/D2 (8 byte)
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
 *   bne.b   0x14948                  ; if D2 != 4, loop
 *   movem.l (SP)+,{D2,D3}            ; restore D2/D3
 *   rts
 *
 *   - call 0: ptr = 0x401302
 *   - call 1: ptr = 0x401362
 *   - call 2: ptr = 0x4013C2
 *   - call 3: ptr = 0x401422
 *
 * Return value is not explicitly written; caller `FUN_10FCE` does not use it.
 *
 * Each call sees the current slot pointer, not the next one.
 */

import type { GameState } from "./state.js";

export const SLOT_ARRAY_BASE = 0x00401302 as const;
/** Stride between consecutive slots. */
export const SLOT_ARRAY_STRIDE = 0x60 as const;
/** Number of iterated slots. */
export const SLOT_ARRAY_COUNT = 4 as const;

/**
 * Stub injection for the JSR to `0x14966` (per-slot ticker).
 *
 * `slotTick(slotPtr, state)` is called four times with absolute pointers for
 * the four slots.
 *
 * Default no-op, matching the `rts` patch in parity tests.
 */
export interface SlotArrayTickSubs {
  /** FUN_14966(slotPtr). Default no-op. */
  fun_14966?: (slotPtr: number, state: GameState) => void;
}

/**
 *
 * @param state  GameState forwarded to `subs.fun_14966` for each slot.
 * @param subs   Stub injection for the JSR to `FUN_14966`.
 *
 * Side effects come from the `fun_14966` callback.
 *
 *   slot 0 (0x401302) -> slot 1 (0x401362) -> slot 2 (0x4013C2) -> slot 3 (0x401422)
 */
export function slotArrayTick(
  state: GameState,
  subs?: SlotArrayTickSubs,
): void {
  const cb = subs?.fun_14966;
  let slotPtr = SLOT_ARRAY_BASE >>> 0;
  for (let i = 0; i < SLOT_ARRAY_COUNT; i++) {
    // Current slot, not the next slot.
    const snapshotPtr = slotPtr;
    slotPtr = (slotPtr + SLOT_ARRAY_STRIDE) >>> 0;
    cb?.(snapshotPtr, state);
  }
}
