/**
 * clear-playfield-other-12186.ts — replica `FUN_00012186`.
 *
 * Disassembly:
 *   12186  lea (0xA00006).l, A0       ; A0 = playfieldRam + 6
 *   1218C  move.w #0x3F, D1w          ; outer counter = 64
 *   12190  move.w #0x11, D0w          ; inner counter = 18
 *   12194  clr.l (A0)+                ; *A0 = 0; A0 += 4
 *   12196  dbf D0w, 0x12194           ; loop 18 times, clearing 72 bytes
 *   1219A  adda.l #0x38, A0           ; skip 56 byte
 *   121A0  dbf D1w, 0x12190           ; outer loop 64 times
 *   121A4  rts
 *
 * Selective pattern: 64 iterations of 72 cleared bytes followed by 56 skipped
 * bytes. The +6 starting offset and 56-byte skip preserve header-like bytes
 * that `FUN_00012174` would otherwise clear.
 *
 * Caller: FUN_1101E@0x1139A (replicated as `mainLoopInit1101E`,
 * hook `clearOther12186`).
 */

import type { GameState } from "./state.js";

export function clearPlayfieldOther12186(state: GameState): void {
  let off = 6;
  for (let outer = 0; outer < 64; outer++) {
    for (let i = 0; i < 72; i++) {
      state.playfieldRam[off + i] = 0;
    }
    off += 128;
  }
}

export const CLEAR_PLAYFIELD_OTHER_12186_ADDR = 0x00012186 as const;
