/**
 * ai.ts - Marble Madness enemy behavior placeholder.
 *
 * The current public runtime is still driven mostly by translated ROM routines.
 * Enemy-specific state machines should be added here only when backed by MAME
 * traces or direct binary-oracle comparisons.
 *
 * Original game notes:
 *  - Marble Eater hides in the floor and eats the marble when in range.
 *  - Slinky chases the marble with an elastic movement pattern.
 *  - Acid Pool grows/moves and dissolves the marble on contact.
 *  - Hammer strikes vertically in fixed patterns.
 *  - Steelie chases and pushes the player marble.
 *
 * AI is deterministic and can consume RNG ticks. Preserve call order when
 * adding behavior.
 */

import type { GameState } from "./state.js";

export function aiTick(_state: GameState): void {
  // Future work: dispatch per enemy kind and mirror the 68010 state machines.
}
