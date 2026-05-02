/**
 * physics.ts — fisica della biglia: gravità, attrito, slope, collisioni.
 *
 * **Status: STUB.** L'implementazione corretta richiede di identificare le
 * subroutine fisiche nel binario originale (Phase 2 — Ghidra). Riferimento
 * importante dal lavoro precedente (`marble-madness-2026`):
 *  - Subroutine input fisica @ ROM $28000 (additiva, friction × 352)
 *  - Subroutine slope @ ROM $2815A (waypoint attractor: vel += (target-vel)/8)
 *  - Z_SCALE = 1 (1 z-unit = 1 pixel screen, conferma @ $189A2)
 *  - Proiezione: sx = (wy-wx)*8 + cx ; sy = (wx+wy)*4 - wz - scrollY
 *
 * Nota: il porting precedente è in vanilla JS (non bit-perfect). Qui dobbiamo
 * essere bit-perfect — quindi NON copiare meccanicamente: replicare la
 * subroutine 68010 con le esatte u16/i16 e gli stessi shift.
 */

import type { GameState } from "./state.js";
import { as_u32, u32_add } from "./wrap.js";

/** Tick fisica della biglia. STUB: avanza solo il frame counter. */
export function physicsTick(state: GameState): void {
  // TODO Phase 4-6: replica subroutine $28000 (input) + $2815A (slope).
  // Il loop originale chiama prima la subroutine input (additiva sulla
  // velocità), poi la subroutine slope (attractor verso velocità target del
  // tile sotto la biglia). Vedi `docs/physics-rom-notes.md` (da scrivere in
  // Phase 4).
  state.clock.frame = u32_add(state.clock.frame, as_u32(1));
}
