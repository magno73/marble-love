/**
 * thunk-10042.ts — replica `FUN_00010042` (6 byte, thunk).
 *
 * Disasm:
 *   00010042  jmp 0x00028468.l
 *
 * È un trampolino puro: l'unico caller (0x0BC2, VBLANK ISR) fa
 * `jsr 0x10042` che ricade immediatamente su `FUN_00028468`
 * (`trackballClampFlags28468`). Nessuna logica propria.
 *
 * Xref:
 *   - 0x00000BC2 (UNCONDITIONAL_CALL) → unico caller.
 */

import type { GameState } from "./state.js";
import {
  trackballClampFlags28468,
  type TrackballClampFlags28468Inputs,
} from "./trackball-clamp-flags-28468.js";

/** Indirizzo binario di questo thunk. */
export const FUN_10042_ADDR = 0x00010042 as const;

/**
 * Replica bit-perfect di `FUN_00010042`.
 *
 * Delega interamente a `trackballClampFlags28468` (FUN_00028468) —
 * esattamente ciò che il `jmp.l 0x00028468` fa in hardware.
 *
 * @param state GameState (workRam mutato dalla target function).
 * @param inputs Bag MMIO passato a `trackballClampFlags28468`.
 * @returns long signed (D0) identico a quello di FUN_00028468.
 */
export function thunk10042(
  state: GameState,
  inputs: TrackballClampFlags28468Inputs,
): number {
  return trackballClampFlags28468(state, inputs);
}

/** Alias canonico per mapping binario→TS. */
export { thunk10042 as FUN_00010042 };
