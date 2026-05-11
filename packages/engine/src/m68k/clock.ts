/**
 * clock.ts — accumulatore cicli CPU M68010 per cadence simulation.
 *
 * Espone `addCpuCycles(state, n)` come unica via per incrementare il counter
 * `state.clock.cpuTicks`. Conserva il brand u32 (wrap su 2^32) usando
 * `u32_add` da wrap.ts.
 *
 * **Scopo**: alimentare il gate dinamico 30/60Hz del main loop in
 * `main-tick.ts`. Quando `cpuTicks > CYCLES_PER_VBLANK` durante un body run,
 * la mailbox vblank @ workRam[0x16] viene settata a 1 (mimica del fatto che
 * IRQ4 ha incrementato il flag durante il body lento) → MAME esegue un body
 * extra senza attendere il primo vsync. Vedi FUN_117B2 ROM 0x117B2..0x118CE.
 */

import type { GameState } from "../state.js";
import { u32_add, as_u32, type u32 } from "../wrap.js";

/**
 * Aggiunge `n` cicli al counter CPU accumulato per il body corrente.
 * `n` deve essere u32 (branded). Wrap modulo 2^32.
 */
export function addCpuCycles(state: GameState, n: u32): void {
  state.clock.cpuTicks = u32_add(state.clock.cpuTicks, n);
}

/**
 * Azzera il counter CPU. Chiamato all'inizio di ogni body run nel main-tick.
 */
export function resetCpuCycles(state: GameState): void {
  state.clock.cpuTicks = as_u32(0);
}
