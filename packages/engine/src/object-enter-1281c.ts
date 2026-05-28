/**
 * Port of ROM routine `FUN_0001281C`.
 *
 * Clears the struct status byte, gates on signed word `A0+0x20`, and calls
 * `FUN_264AA(structPtr, mode)` when the value is in `(-16, 256)`. The two
 * canonical singleton slots (`0x400018`, `0x4000FA`) map to mode 0; every other
 * in-range slot maps to mode 1.
 *
 * Out-of-range returns the residual `moveq #-0x10,D0` value (`0xFFFFFFF0`).
 * In-range returns the `FUN_264AA` result verbatim. Tests can stub `FUN_264AA`
 * to expose the calculated mode in D0.
 */

import type { GameState } from "./state.js";

/** Work RAM base (0x400000..0x401FFF, 8 KB). */
const WORK_RAM_BASE = 0x400000;

/** Offsets in the struct passed as arg1. */
const STRUCT_STATUS_BYTE_OFF = 0x1c; // (0x1C, A0) byte: 0 prologue, 1 in-range
const STRUCT_RANGE_WORD_OFF = 0x20; // (0x20, A0) word signed: gating value

/** Lower signed bound: skip body when `range <= LOWER_REJECT`. */
export const RANGE_LOWER_BOUND = -16 as const;

/** Upper signed bound: skip body when `range >= UPPER_REJECT`. */
export const RANGE_UPPER_BOUND = 0x100 as const;

/** The two canonical singleton object slots that select `mode=0`. */
export const SINGLETON_SLOT_A = 0x00400018 as const;
export const SINGLETON_SLOT_B = 0x004000fa as const;

/**
 * Out-of-range D0 sentinel: residual value from `moveq #-0x10,D0`.
 */
export const OUT_OF_RANGE_D0 = 0xfffffff0 as const;

/**
 * Callback that models `FUN_000264AA`. Receives `(structPtr, mode)` as longs.
 *
 * @param structPtr  Identical to `A0`, verbatim and not normalized.
 */
export type Inner264AA = (structPtr: number, mode: number) => number;

/**
 * Runs `FUN_0001281C`, the bounded enter/dispatch shim.
 *
 * @param state    GameState used to read/write `workRam[A0+0x1C, +0x20]`.
 * @param inner    Callback that models `FUN_000264AA`. See `Inner264AA`.
 *                 - in-range      : `inner(structPtr, mode)`
 *                 - out-of-range  : `0xFFFFFFF0` (= `OUT_OF_RANGE_D0`).
 */
export function objectEnter1281C(
  state: GameState,
  structPtr: number,
  inner: Inner264AA,
  rangeWordOverride?: number,
): number {
  const a0 = structPtr >>> 0;
  const slotOff = (a0 - WORK_RAM_BASE) >>> 0;

  state.workRam[slotOff + STRUCT_STATUS_BYTE_OFF] = 0;

  let rangeWord: number;
  if (rangeWordOverride !== undefined) {
    rangeWord = rangeWordOverride & 0xffff;
  } else {
    const hi = state.workRam[slotOff + STRUCT_RANGE_WORD_OFF] ?? 0;
    const lo = state.workRam[slotOff + STRUCT_RANGE_WORD_OFF + 1] ?? 0;
    rangeWord = ((hi << 8) | lo) & 0xffff;
  }

  const rangeSigned = rangeWord & 0x8000 ? rangeWord - 0x10000 : rangeWord;

  // Bounds gate: body runs sse RANGE_LOWER_BOUND < rangeSigned < RANGE_UPPER_BOUND.
  // And `cmpi.w #0x100,D1; bge done` -> skip if D1 >= 256.)
  if (rangeSigned <= RANGE_LOWER_BOUND || rangeSigned >= RANGE_UPPER_BOUND) {
    return OUT_OF_RANGE_D0 >>> 0;
  }

  state.workRam[slotOff + STRUCT_STATUS_BYTE_OFF] = 1;

  const mode = a0 === SINGLETON_SLOT_A || a0 === SINGLETON_SLOT_B ? 0 : 1;

  // sopravvive all'`addq.l #8,SP; rts` dello shim → ritornato verbatim.
  return inner(a0, mode) >>> 0;
}

/**
 */
export function selectMode(structPtr: number): number {
  const a0 = structPtr >>> 0;
  return a0 === SINGLETON_SLOT_A || a0 === SINGLETON_SLOT_B ? 0 : 1;
}
