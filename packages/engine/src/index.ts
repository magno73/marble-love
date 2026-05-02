/**
 * @marble-love/engine — entry point.
 *
 * Esporta i namespace dei moduli core. Tutto pure-logic, no DOM, no PixiJS.
 *
 * Uso tipico:
 *   import { wrap, state, rng, bus, physics, ai, level, render, audio, trace }
 *     from "@marble-love/engine";
 */

export * as wrap from "./wrap.js";
export * as state from "./state.js";
export * as rng from "./rng.js";
export * as bus from "./bus.js";
export * as physics from "./physics.js";
export * as ai from "./ai.js";
export * as level from "./level.js";
export * as render from "./render.js";
export * as audio from "./audio.js";
export * as trace from "./trace.js";

// Re-export tipi più usati per ergonomia
export type { GameState } from "./state.js";
export type { Bus, RomImage } from "./bus.js";
export type { TraceFrame, TraceHeader } from "./trace.js";
export type {
  u8,
  u16,
  u32,
  i8,
  i16,
  i32,
} from "./wrap.js";

/**
 * Tick principale. Orchestra le subroutine nell'ordine che il binario
 * originale segue (da identificare in Phase 1-2). Ordine STUB:
 *   1. read input MMIO
 *   2. AI tick (può chiamare RNG)
 *   3. physics tick
 *   4. game logic (score, timer, level transition)
 *   5. avanza clock
 */
import type { GameState } from "./state.js";
import { aiTick } from "./ai.js";
import { physicsTick } from "./physics.js";
import { rngClearFrameCounter } from "./rng.js";

export function tick(s: GameState): void {
  rngClearFrameCounter(s.rng);
  aiTick(s);
  physicsTick(s);
}
