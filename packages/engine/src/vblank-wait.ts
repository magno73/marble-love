/**
 * vblank-wait.ts — `FUN_000052B8` replica (34 bytes): "wait N vblanks".
 *
 *
 * **Disasm 0x52B8..0x52D9** (34 byte):
 *
 *   move.l  D2,-(SP)                ; preserve D2 (clobber-free)
 *   move.w  (0xa,SP),D0w            ; D0w = count (signed word)
 *   bra.b   test
 * loop:
 *   move.l  (0x00401FF8).l,D2       ; D2 = vblank counter
 * inner:
 *   move.l  (0x00401FF8).l,D1       ; D1 = vblank counter
 *   cmp.l   D2,D1
 *   subq.w  #1,D0w                  ; D0w--
 * test:
 *   tst.w   D0w
 *   bgt.b   loop                    ; while D0w > 0
 *   move.l  (SP)+,D2                ; restore D2
 *   rts
 *
 * Modeled by the long counter @ `0x401FF8` (workRam offset 0x1FF8), which
 * advances time.
 *
 *   - `count <= 0` (signed-word interpretation): `bgt` is not taken.
 *
 *
 * `requestAnimationFrame` schedulerebbe il tick next.
 */

import type { GameState } from "./state.js";

/** WORK RAM base address (for consistency with the rest of the project). */
const WORK_RAM_BASE = 0x400000;
/** Offset of the long vblank counter in workRam (== `0x401FF8 - WORK_RAM_BASE`). */
export const VBLANK_COUNTER_OFF = 0x1ff8;

/**
 * `FUN_000052B8` replica — busy-wait for `count` vblank ticks.
 *
 * @param _state    GameState (unused, but signature matches the other modules).
 * @param countWord Word count, reinterpreted as signed to replicated `tst.w + bgt`.
 *                    - count signed > 0  → 0
 *                    - count signed <= 0 → count masked to 16 bits (low word)
 */
export function waitVblank(_state: GameState, countWord: number): number {
  // Truncate to 16 bits (D0w) and reinterpret as signed (`tst.w + bgt` use signed flags).
  const w = countWord & 0xffff;
  const signed = w & 0x8000 ? w - 0x10000 : w;

  if (signed > 0) {
    return 0;
  }
  // count <= 0: the loop does not run, D0w remains count (low word).
  return w >>> 0;
}

/**
 * Re-export the symbol as "FUN_000052B8" for explicit mapping.
 */
export { waitVblank as FUN_000052B8 };
export { WORK_RAM_BASE };
