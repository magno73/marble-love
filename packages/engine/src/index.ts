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
export * as paletteAnim from "./palette-anim.js";
export * as paletteQueue from "./palette-queue.js";
export * as mainLoop from "./main-loop.js";
export * as eventFlags from "./event-flags.js";
export * as arrayHelpers from "./array-helpers.js";
export * as stringFormat from "./string-format.js";
export * as trackballInput from "./trackball-input.js";
export * as timerCascade from "./timer-cascade.js";
export * as alphaTilemap from "./alpha-tilemap.js";
export * as byteQueue from "./byte-queue.js";
export * as mathHelpers from "./math-helpers.js";
export * as gameTickTimers from "./game-tick-timers.js";
export * as gameMainGate from "./game-main-gate.js";
export * as gameStateMachine from "./game-state-machine.js";
export * as positionUpdate from "./position-update.js";
export * as vectorScale from "./vector-scale.js";
export * as stringRender from "./string-render.js";
export * as stringClear from "./string-clear.js";
export * as stringShift from "./string-shift.js";
export * as stateMachineSchedule from "./state-machine-schedule.js";
export * as stringStep from "./string-step.js";
export * as bcd from "./bcd.js";
export * as paletteInit from "./palette-init.js";
export * as objectHelpers from "./object-helpers.js";
export * as rleExpand from "./rle-expand.js";
export * as stringTrim from "./string-trim.js";
export * as slotSearch from "./slot-search.js";
export * as initHelpers from "./init-helpers.js";
export * as animationStep from "./animation-step.js";
export * as spriteCoords from "./sprite-coords.js";
export * as objectCompare from "./object-compare.js";
export * as spritePack from "./sprite-pack.js";
export * as spriteDerive from "./sprite-derive.js";
export * as gridBitmapTest from "./grid-bitmap-test.js";
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
