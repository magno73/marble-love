/**
 * ai.ts — comportamento dei nemici di Marble Madness.
 *
 * **Status: STUB.** Per ogni `EnemyKind` va replicata la state machine del
 * binario (Phase 4-6 dopo Phase 2 statica).
 *
 * Note dal gioco originale:
 *  - **Marble Eater**: si nasconde nel pavimento, esce, mangia la biglia se a tiro.
 *  - **Slinky**: insegue la biglia con un pattern semi-elastico.
 *  - **Acid Pool**: pozzanghera che cresce/si sposta, dissolve la biglia al contatto.
 *  - **Hammer**: martello che colpisce verticalmente in pattern fissi.
 *  - **Steelie**: biglia di acciaio che insegue/spinge la biglia del giocatore.
 *
 * L'AI è deterministica e usa l'RNG (`rng.ts`) per i tick di "decisione".
 * Replicare l'ordine delle chiamate RNG è critico per parità.
 */

import type { GameState } from "./state.js";

export function aiTick(_state: GameState): void {
  // TODO Phase 4-6: dispatch per kind di nemico, replicare state machine 68010.
}
