/**
 * event-flags.ts — gestione di "queue di flag" a 16 bit nel game state.
 *
 * Marble Madness usa un word a `0x400006` come **queue di event flags**:
 *   - I produttori settano bit specifici per signalare eventi
 *     (es. "biglia rotolata", "nemico spawnato", ...)
 *   - I consumatori chiamano `consumeEventFlag` (FUN_2548) per pop il bit
 *     più basso. La funzione fa shift-right del word e ritorna il bit
 *     uscito (in D0).
 *
 * Verificato bit-perfect vs `FUN_00002548` tramite test-event-flags-parity.
 */

import type { GameState } from "./state.js";

/** Offset del flag word in workRam (assoluto 0x400006). */
export const EVENT_FLAGS_OFF = 0x06 as const;

/**
 * Replica `FUN_00002548` — consume next event flag.
 *
 * Disassembly:
 *   lsr.w *0x400006     ; X = bit 0 (uscito)
 *   bcc skip_set        ; if X == 0: D0 = 0
 *   moveq #1, D0
 *   rts
 *   skip_set:
 *   clr.l D0
 *   rts
 *
 * Side effect: *0x400006 viene shifted right by 1 (consuma il bit).
 *
 * Ritorna: 1 se il bit consumato era 1, altrimenti 0.
 */
export function consumeEventFlag(state: GameState): number {
  const high = state.workRam[EVENT_FLAGS_OFF] ?? 0;
  const low = state.workRam[EVENT_FLAGS_OFF + 1] ?? 0;
  const word = (high << 8) | low;
  const bit0 = word & 1;
  const newWord = (word >>> 1) & 0xffff;
  state.workRam[EVENT_FLAGS_OFF] = (newWord >>> 8) & 0xff;
  state.workRam[EVENT_FLAGS_OFF + 1] = newWord & 0xff;
  return bit0;
}
