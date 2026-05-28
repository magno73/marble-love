/**
 * state-sub-5200.ts - port of `FUN_00005200` (14 bytes, 0x005200-0x00520E).
 *
 *
 * **Disasm 0x5200..0x520E** (14 bytes):
 *
 *   0x5200  moveq  #0x13, D0              ; D0 = 0x00000013 (19)
 *   0x5202  clr.b  (0x1e,A2,D0w*1)        ; clear byte at A2 + 0x1e + signext(D0w)
 *   0x5206  dbra   D0w, 0x5202            ; decrement D0w; loop while D0w != −1
 *   0x520a  moveq  #0x0c, D1              ; D1 = 0x0000000c (bits 2,3)
 *   0x520c  bra.b  0x5248                 ; tail-call FUN_5248 → or.l D1,(0x401F5E).l; rts
 *
 * **Loop semantics (dbra / DBF)**:
 *   `dbra D0w, target`: D0w := D0w − 1; if D0w != −1 branch.
 *   D0w starts at 19. After body at D0w=19,18,...,0 → dbra decrements to −1 →
 *   exit. Total: 20 executions of the clr.b body.
 *   Index values used: D0w = 19,18,...,0. Offset from A2: 0x1e+19=0x31 down to
 *   0x1e+0=0x1e. Cleared range: **A2[0x1e..0x31]** (20 byte).
 *
 * **Tail-call via bra.b 0x5248** (`FUN_00005248`):
 *   `or.l D1,(0x00401f5e).l` → *0x401F5E |= 0x0000000c (sets bits 2,3)
 *   `rts`
 *
 * **Side effects (workRam)**:
 *   2. long-BE OR: *0x401F5E |= 0x0000000c (bits 2, 3)
 *
 * **Caller convention (FUN_4F38)**:
 *   - `A2` = absolute pointer in workRam (struct slot base).
 *
 *   1. `clr.b (0x1e,A2,D0w*1)`: index displacement with D0w sign-extended to long.
 *   2. `moveq #0x13, D0`: clear upper 24 bits; D0 = 0x00000013.
 *
 *
 * **Xrefs** (2 call):
 *   - 0x509C in FUN_00004F38 (UNCONDITIONAL_CALL)
 *   - 0x51F6 in FUN_00004F38 (UNCONDITIONAL_CALL)
 */

import type { GameState } from "./state.js";
import { orFlags5248 } from "./or-flags-5248.js";

/** Absolute M68k work RAM base. */
const WORK_RAM_BASE = 0x400000;

/** Offset relative to A2 of the first cleared byte (= 0x1e + 0). */
export const CLEAR_OFFSET_START = 0x1e as const;

/** Offset relative to A2 of the last cleared byte (= 0x1e + 0x13). */
export const CLEAR_OFFSET_END = 0x31 as const;

/** Number of cleared bytes (= 0x14 = 20). */
export const CLEAR_COUNT = 0x14 as const;

/** OR mask applied to *0x401F5E (D1 = moveq #0x0c). Bits 2,3. */
export const OR_MASK = 0x0000000c as const;

/**
 * Port of `FUN_00005200` - buffer clear + status flags OR.
 *
 * @param state  GameState. workRam is mutated in two zones:
 *               (1) A2[0x1e..0x31] (20 byte → zero);
 *               (2) long-BE @ 0x1F5E OR-ed with 0x0000000c.
 * @param a2     Absolute M68k pointer (uint32). Must point into workRam
 *               (0x400000..0x401FFF). The cleared bytes are at offset
 *               0x1e..0x31 from a2.
 *
 * @returns void.
 */
export function stateSub5200(state: GameState, a2: number): void {
  const a2u = a2 >>> 0;
  const r = state.workRam;
  const a2Off = (a2u - WORK_RAM_BASE) >>> 0;

  // Phase 1: clear A2[0x1e..0x31] (20 bytes).
  // M68k: D0 = 0x13; body: clr.b (0x1e, A2, D0w*1); dbra D0w.
  // D0w = 19,18,...,0 -> 20 executions. Byte @ A2+0x1e+D0w for each D0w.
  for (let i = 0; i < CLEAR_COUNT; i++) {
    const off = a2Off + CLEAR_OFFSET_START + i;
    if (off < r.length) r[off] = 0;
  }

  // Phase 2: OR *0x401F5E with 0x0000000c.
  // D1 = moveq #0x0c; bra 0x5248 -> or.l D1,(0x401F5E).l; rts.
  orFlags5248(state, OR_MASK);
}
