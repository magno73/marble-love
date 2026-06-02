/**
 * object-update-pair-158cc.ts — `FUN_000158CC` replica (42 bytes).
 *
 * (`FUN_00010392`) with `count=2, stride=0x7C` and scanned as
 * 2 entry × 0x7C byte.
 *
 * **Caller**: `FUN_00010FE0` (part of `FUN_00010FCE`, root of the game tick
 *
 * **Disasm 0x158CC..0x158F5** (42 byte, no args):
 *
 *   movem.l  {D2 D3}, -(SP)             ; save D2/D3 (callee-save)
 *   clr.b    D2                         ; D2.b = 0 (loop counter, byte)
 * loop:
 *   moveq    #0x7C, D0                  ; D0 = stride 0x7C
 *   add.l    D0, D3                     ; D3 += 0x7C → ptr next slot
 *   jsr      0x000158F6.l               ; FUN_158F6(slot ptr)
 *   addq.l   #0x4, SP                   ; pop arg
 *   addq.b   #0x1, D2                   ; D2++
 *   cmpi.b   #0x2, D2                   ; D2 == 2 ?
 *   bne.b    loop                       ; otherwise, iterate
 *   movem.l  (SP)+, {D2 D3}             ; restore D2/D3
 *   rts
 *
 * **Behavior**:
 *       1) with arg = `0x004009A4` (slot 0)
 *       2) with arg = `0x00400A20` (slot 1, = base + 0x7C)
 *     `FUN_158F6` internally.
 *
 * **Side effects** (of FUN_158CC itself, excluding the helper):
 *
 * 0x23 via `FUN_160D4`, and other complex logic — cf. the disasm of
 * `ObjectUpdatePair158CCSubs.objectUpdate`. The caller (mainTick / the root
 *
 * Mirror pattern of `sound-pair-15884.ts` and `special-attract.ts`.
 *
 * `cli/src/test-object-update-pair-158cc-parity.ts` (500/500 cases).
 */

import type { GameState } from "./state.js";

/** Absolute work RAM base (corresponds to `0x400000` on the M68k bus). */
export const WORK_RAM_BASE = 0x400000 as const;

export const SLOT_PAIR_BASE_ADDR = 0x004009a4 as const;

/** Stride between the two slots (`moveq #0x7C, D0`). */
export const SLOT_PAIR_STRIDE = 0x7c as const;

export const SLOT_PAIR_COUNT = 2 as const;

/**
 *
 */
export interface ObjectUpdatePair158CCSubs {
  /**
   * Default no-op.
   *
   */
  objectUpdate?: (slotPtr: number) => void;
}

/**
 * `FUN_000158F6` on each.
 *
 *
 */
export function objectUpdatePair158CC(
  state: GameState,
  subs?: ObjectUpdatePair158CCSubs,
): void {
  // injection" (and to allow the caller to pass a reference into
  // work RAM.
  void state;

  for (let i = 0; i < SLOT_PAIR_COUNT; i++) {
    const slotPtr = (SLOT_PAIR_BASE_ADDR + i * SLOT_PAIR_STRIDE) >>> 0;
    subs?.objectUpdate?.(slotPtr);
  }
}
