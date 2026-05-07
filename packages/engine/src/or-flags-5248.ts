/**
 * or-flags-5248.ts — replica `FUN_00005248` (8 byte, 0x005248-0x005250).
 *
 * **Disasm 0x5248..0x5250** (8 byte):
 *
 *   00005248    or.l D1,(0x00401f5e).l   ; *0x401F5E |= D1 (long-BE)
 *   0000524e    rts
 *
 * È un thunk puro: esegue un OR long del registro D1 nel long-BE a
 * indirizzo assoluto `0x401F5E` (workRam offset `0x1F5E`), poi ritorna.
 *
 * **Callers**:
 *   - `FUN_00004F38` @ 0x000050a2 (UNCONDITIONAL_CALL): D1 = 3 → OR mask 0x3
 *   - `FUN_0000520E` @ 0x00005224 (UNCONDITIONAL_CALL): D1 = 3 → OR mask 0x3
 *     (vedi `state-sub-520e.ts` per il contesto completo).
 *
 * In TS è modellato come pure function: nessuno stato nascosto, side-effect
 * esclusivamente su `state.workRam`.
 */

import type { GameState } from "./state.js";

/** workRam offset del long-BE di status flags @ 0x401F5E. */
export const STATUS_FLAGS_OFF = 0x1f5e as const;

/**
 * Replica `FUN_00005248` — OR del long `d1` nel long-BE @ workRam[0x1F5E].
 *
 * @param state  GameState: `state.workRam[0x1F5E..0x1F61]` mutato.
 * @param d1     Valore long (32 bit) da OR-are. Corrisponde al registro D1
 *               M68k al momento della call. I callers producono tipicamente
 *               il valore `3` (mask bits 0,1).
 */
export function orFlags5248(state: GameState, d1: number): void {
  const mask = d1 >>> 0;
  if (mask === 0) return; // or.l 0 = no-op

  const r = state.workRam;
  const cur =
    (((r[STATUS_FLAGS_OFF] ?? 0) << 24) |
      ((r[STATUS_FLAGS_OFF + 1] ?? 0) << 16) |
      ((r[STATUS_FLAGS_OFF + 2] ?? 0) << 8) |
      (r[STATUS_FLAGS_OFF + 3] ?? 0)) >>>
    0;
  const next = (cur | mask) >>> 0;
  r[STATUS_FLAGS_OFF] = (next >>> 24) & 0xff;
  r[STATUS_FLAGS_OFF + 1] = (next >>> 16) & 0xff;
  r[STATUS_FLAGS_OFF + 2] = (next >>> 8) & 0xff;
  r[STATUS_FLAGS_OFF + 3] = next & 0xff;
}
