/**
 * Port of ROM routine `FUN_0001493C`.
 *
 * Iterates four slots at `0x401302`, `0x401362`, `0x4013C2`, and `0x401422`,
 * calling `FUN_14966(slotPtr)` for each. The slot stride is 0x60 bytes.
 */

import type { GameState } from "./state.js";

export const REFRESH_HELPER_1493C_ADDR = 0x0001493c as const;

export const SLOT_BASE_ADDR = 0x00401302 as const;

/** Stride between consecutive slots (0x60 = 96 bytes). */
export const SLOT_STRIDE = 0x60 as const;

/** Number of iterated slots. */
export const SLOT_COUNT = 4 as const;

/** Callback type for `FUN_14966(slotPtr)`, using absolute work RAM addresses. */
export type Fun14966 = (state: GameState, slotAddr: number) => void;

/**
 * Runs `FUN_0001493C`.
 *
 * @param fun14966 Implementation of FUN_14966. Default: no-op stub.
 */
export function refreshHelper1493C(
  state: GameState,
  fun14966: Fun14966 = (_s, _a) => undefined,
): void {
  // D3 = 0x401302 (base address, advances by SLOT_STRIDE each iteration)
  let d3 = SLOT_BASE_ADDR;

  // D2.b = 0 (loop counter, 4 iterations)
  for (let d2 = 0; d2 < SLOT_COUNT; d2++) {
    // D1 = D3 (current slot ptr)
    const slotPtr = d3;
    // D3 += 0x60 (advance to next slot)
    d3 = (d3 + SLOT_STRIDE) >>> 0;
    // jsr FUN_14966(slotPtr)
    fun14966(state, slotPtr);
  }
}
