/**
 * Port of ROM routine `FUN_000160D4`.
 *
 * Enters object state 0x23, calls the injected `FUN_15D10(objPtr)` helper, then
 * writes long timer `0x00070000` at `obj+0x68`.
 */

import type { GameState } from "./state.js";

/** Absolute work RAM base (`0x400000` on the M68K bus). */
const WORK_RAM_BASE = 0x400000;

export const OBJECT_STATE_BYTE_OFF = 0x1a as const;
export const OBJECT_TIMER_LONG_OFF = 0x68 as const;

export const STATE_VALUE_23 = 0x23 as const;

export const TIMER_LONG_VALUE = 0x00070000 as const;

export interface ObjectEnterState23Subs {
  /** Replica injected for the nested `FUN_15D10(objPtr)` call. */
  fun_15d10?: (state: GameState, objPtr: number) => void;
}

/**
 * Runs `FUN_000160D4`, the "enter state 0x23" wrapper.
 *
 * Pure side effect on `state.workRam`; the ROM routine returns via plain RTS.
 *
 * `objPtr` must point inside work RAM and cover byte 0x1A plus long 0x68..0x6B.
 */
export function objectEnterState23(state: GameState, objPtr: number, subs: ObjectEnterState23Subs = {}): void {
  const objOff = ((objPtr >>> 0) - WORK_RAM_BASE) >>> 0;

  state.workRam[objOff + OBJECT_STATE_BYTE_OFF] = STATE_VALUE_23;

  // jsr 0x00015D10 — injected by runtime callers that need the full chain.
  // The standalone parity test leaves this undefined, matching its RTS patch.
  subs.fun_15d10?.(state, objPtr);

  // move.l #0x70000, (0x68, A2) — long timer big-endian 00 07 00 00.
  state.workRam[objOff + OBJECT_TIMER_LONG_OFF + 0] = (TIMER_LONG_VALUE >>> 24) & 0xff;
  state.workRam[objOff + OBJECT_TIMER_LONG_OFF + 1] = (TIMER_LONG_VALUE >>> 16) & 0xff;
  state.workRam[objOff + OBJECT_TIMER_LONG_OFF + 2] = (TIMER_LONG_VALUE >>> 8) & 0xff;
  state.workRam[objOff + OBJECT_TIMER_LONG_OFF + 3] = TIMER_LONG_VALUE & 0xff;
}
