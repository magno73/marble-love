/**
 * clear-playfield-ram-12174.ts — replica `FUN_00012174`.
 *
 * Disassembly:
 *   12174  lea (0xA00000).l, A0
 *   1217A  move.w #0x7FF, D0w
 *   1217E  clr.l (A0)+
 *   12180  dbf D0w, 0x1217E
 *   12184  rts
 *
 * Cancella tutta la `playfieldRam` (8 KB @ 0xA00000-0xA01FFF) con un loop
 * `clr.l (A0)+` di 0x800 iter (D0=0x7FF + dbf decrementa fino a -1 → 2048
 * iter × 4 byte = 8192 byte = 8 KB).
 *
 * Caller (4): FUN_1101E@0x113E4, FUN_11428@0x11434, FUN_1A236@0x1A26E,
 * Entry Point @ ?? (RESET handler).
 */

import type { GameState } from "./state.js";

export function clearPlayfieldRam12174(state: GameState): void {
  state.playfieldRam.fill(0);
}

export const CLEAR_PLAYFIELD_RAM_12174_ADDR = 0x00012174 as const;
