/**
 * rng.ts — replica esatta del PRNG di Marble Madness.
 *
 * **Status: STUB.** Da identificare nel binario in Phase 2 (Ghidra + reaper).
 * Il PRD §10 lo cita come rischio "alto, bassa probabilità" e prima cosa da
 * chiudere appena lo static analysis è in piedi.
 *
 * Quando identificato, sostituire `next()` con la replica esatta. Lo stato
 * `RngState.seed` deve essere bit-identico a quello osservato in MAME RAM.
 *
 * Ipotesi più probabili per un gioco Atari 1984 (da verificare):
 *  - LFSR a 16 bit con tap pattern stile Galois
 *  - LCG 16-bit (es. `seed = seed * a + c`)
 *  - Lookup table in ROM indicizzata da un counter
 *
 * Mai usare `Math.random()` qui dentro (PRD Appendice A). Mai.
 */

import { type RngState } from "./state.js";
import { as_u32, u32_and, u16_lo, u32_xor, u32_shl, u32_shr } from "./wrap.js";
import type { u16, u32 } from "./wrap.js";

/**
 * Estrae il prossimo valore u16 dallo stato RNG e avanza lo stato.
 *
 * **STUB**: implementa LFSR Galois a 16 bit con polynomial 0xB400 (placeholder
 * comune). Da rimpiazzare in Phase 2 con la replica esatta del binario.
 */
export function rngNext(state: RngState): u16 {
  // Placeholder LFSR16. NON FIDARSI di questa formula prima di Phase 2.
  const lsb = u32_and(state.seed, as_u32(1));
  let next = u32_shr(state.seed, 1);
  if ((lsb as unknown as number) !== 0) {
    next = u32_xor(next, as_u32(0xb400));
  }
  state.seed = next;
  state.callsThisFrame = as_u32((state.callsThisFrame as unknown as number) + 1);
  return u16_lo(next);
}

/**
 * Inizializza lo stato RNG. Il seed iniziale del binario originale è
 * tipicamente derivato da:
 *  - valore in ROM al cold-boot
 *  - frame counter
 *  - input I/O
 * Da identificare in Phase 2.
 */
export function rngInit(initialSeed: u32): RngState {
  return {
    seed: initialSeed,
    callsThisFrame: as_u32(0),
  };
}

/** Reset contatore di chiamate per frame (utile a fine tick per il diff). */
export function rngClearFrameCounter(state: RngState): void {
  state.callsThisFrame = as_u32(0);
}

// Helper per silenziare unused warning su import che servono al refactor
// futuro quando avremo l'algoritmo reale.
void u32_shl;
