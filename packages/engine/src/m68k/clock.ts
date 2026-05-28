/**
 * clock.ts - M68010 CPU-cycle accumulator for cadence simulation.
 *
 * Exposes `addCpuCycles(state, n)` as the only way to increment
 * `state.clock.cpuTicks`. Keeps the u32 brand (2^32 wrap) via `u32_add` from
 * wrap.ts.
 *
 * **Purpose**: feed the dynamic 30/60Hz gate in `main-tick.ts`. When
 * `cpuTicks > CYCLES_PER_VBLANK` during a body run, the vblank mailbox at
 * workRam[0x16] is set to 1. This mimics IRQ4 incrementing the flag during a
 * slow body, so MAME runs one extra body without waiting for the first vsync.
 * See FUN_117B2 ROM 0x117B2..0x118CE.
 */

import type { GameState } from "../state.js";
import { u32_add, as_u32, type u32 } from "../wrap.js";

/**
 * Add `n` cycles to the accumulated CPU counter for the current body.
 * `n` must be branded u32. Wraps modulo 2^32.
 */
export function addCpuCycles(state: GameState, n: u32): void {
  state.clock.cpuTicks = u32_add(state.clock.cpuTicks, n);
}

/**
 * Clear the CPU counter. Called at the start of each body run in main-tick.
 */
export function resetCpuCycles(state: GameState): void {
  state.clock.cpuTicks = as_u32(0);
}
