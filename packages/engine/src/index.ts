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
export * as stateSub1EAA from "./state-sub-1eaa.js";
export * as stateSub2678 from "./state-sub-2678.js";
export * as stateSub2ABC from "./state-sub-2abc.js";
export * as stateSub2BDA from "./state-sub-2bda.js";
export * as stateSub2C60 from "./state-sub-2c60.js";
export * as stateSub2DA0 from "./state-sub-2da0.js";
export * as stateSub520E from "./state-sub-520e.js";
export * as stateSub525C from "./state-sub-525c.js";
export * as stateSub540A from "./state-sub-540a.js";
export * as stateSub5334 from "./state-sub-5334.js";
export * as stateSub535E from "./state-sub-535e.js";
export * as stateSub5584 from "./state-sub-5584.js";
export * as stateSub5608 from "./state-sub-5608.js";
export * as entityWaypointStep1D1EC from "./entity-waypoint-step-1d1ec.js";
export * as syncAvToggle1E08 from "./sync-av-toggle-1e08.js";
export * as renderGlyphLoop1E64 from "./render-glyph-loop-1e64.js";
export * as positionUpdate from "./position-update.js";
export * as vectorScale from "./vector-scale.js";
export * as stringRender from "./string-render.js";
export * as stringClear from "./string-clear.js";
export * as stringShift from "./string-shift.js";
export * as stateMachineSchedule from "./state-machine-schedule.js";
export * as stateDispatch1605C from "./state-dispatch-1605c.js";
export * as stateValidateGrid15DB6 from "./state-validate-grid-15db6.js";
export * as stringStep from "./string-step.js";
export * as bcd from "./bcd.js";
export * as paletteInit from "./palette-init.js";
export * as objectHelpers from "./object-helpers.js";
export * as rleExpand from "./rle-expand.js";
export * as stringTrim from "./string-trim.js";
export * as slotSearch from "./slot-search.js";
export * as scriptSlotClaim from "./script-slot-claim.js";
export * as initHelpers from "./init-helpers.js";
export * as initLevelLoad1A236 from "./init-level-load-1a236.js";
export * as pfScroll from "./pf-scroll.js";
export * as soundTick from "./sound-tick.js";
export * as soundStatusCheck from "./sound-status-check.js";
export * as soundIrqInput from "./sound-irq-input.js";
export * as soundDispatchSend from "./sound-dispatch-send.js";
export * as soundCmdSend from "./sound-cmd-send.js";
export * as soundCmdGate from "./sound-cmd-gate.js";
export * as flagScaledMagnitudeDispatch from "./flag-scaled-magnitude-dispatch.js";
export * as eepromCommit from "./eeprom-commit.js";
export * as eepromCommitRequest from "./eeprom-commit-request.js";
export * as fieldFetch4058 from "./field-fetch-4058.js";
export * as slotArrayInit from "./slot-array-init.js";
export * as slotArrayTick from "./slot-array-tick.js";
export * as dispatchStrings17230 from "./dispatch-strings-17230.js";
export * as dispatchTable1EEA0 from "./dispatch-table-1eea0.js";
export { bootInit } from "./boot-init.js";
export * as bootSpuriousHandler from "./boot-spurious-handler.js";
export * as animationStep from "./animation-step.js";
export * as spriteCoords from "./sprite-coords.js";
export * as objectCompare from "./object-compare.js";
export * as spritePack from "./sprite-pack.js";
export * as spriteDerive from "./sprite-derive.js";
export * as spritePosUpdate1BAB2 from "./sprite-pos-update-1bab2.js";
export * as objectTypeDispatch194BA from "./object-type-dispatch-194ba.js";
export * as stateSub1960E from "./state-sub-1960e.js";
export * as gridBitmapTest from "./grid-bitmap-test.js";
export * as lerp from "./lerp.js";
export * as timerDelta from "./timer-delta.js";
export * as vblankWait from "./vblank-wait.js";
export * as waitVblankStateGated from "./wait-vblank-state-gated.js";
export * as formatAndRender28E00 from "./format-and-render-28e00.js";
export * as particleBounce from "./particle-bounce.js";
export * as specialAttract from "./special-attract.js";
export * as soundPair15884 from "./sound-pair-15884.js";
export * as objectUpdatePair158CC from "./object-update-pair-158cc.js";
export * as sceneInit11428 from "./scene-init-11428.js";
export * as proximityCheck from "./proximity-check.js";
export * as paletteRngFill26CFA from "./palette-rng-fill-26cfa.js";
export * as array9ClearAndDispatch from "./array-9-clear-and-dispatch.js";
export * as objPickLarger from "./obj-pick-larger.js";
export * as hudFormat from "./hud-format.js";
export * as trackballApply from "./trackball-apply.js";
export * as moveVelocity from "./move-velocity.js";
export * as nearestNeighbor from "./nearest-neighbor.js";
export * as mainTick from "./main-tick.js";
export * as auxTimer from "./aux-timer.js";
export * as renderStringEntry28FDE from "./render-string-entry-28fde.js";
export * as renderStringEntry28F62 from "./render-string-entry-28f62.js";
export * as renderStringEntry28FA0 from "./render-string-entry-28fa0.js";
export * as renderStringEntry286B0 from "./render-string-entry-286b0.js";
export * as objectEnterState23 from "./object-enter-state-23.js";
export * as objectEnter1281C from "./object-enter-1281c.js";
export * as slapsticLookup from "./slapstic-lookup.js";
export * as slapsticTableStore from "./slapstic-table-store.js";
export * as clearPfStride from "./clear-pf-stride.js";
export * as bsearchTable1ABD4 from "./bsearch-table-1abd4.js";
export * as sortAdjacentObjects1A7A8 from "./sort-adjacent-objects-1a7a8.js";
export * as stateSub15BD0 from "./state-sub-15bd0.js";
export * as spriteCoordsJsr150D0 from "./sprite-coords-jsr-150d0.js";
export * as tilemapBlit17044 from "./tilemap-blit-17044.js";
export * as bootScreenInit from "./boot-screen-init.js";
export * as moGridInit2404 from "./mo-grid-init-2404.js";
export * as spritePairCoordAdd1D82 from "./sprite-pair-coord-add-1d82.js";
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
import type { RomImage } from "./bus.js";
import { rngClearFrameCounter } from "./rng.js";
import { mainTick as runMainTick } from "./main-tick.js";
import type { MainTickOptions } from "./main-tick.js";

/**
 * Tick principale del game engine — 1 frame @ 60 Hz.
 *
 * Orchestrator che chiama 9 root sub-systems replicati bit-perfect dal
 * binario originale (`FUN_00028788`). Aggiorna `state.workRam`,
 * `state.colorRam`, `state.alphaRam`, `state.spriteRam` coerentemente
 * col binario.
 *
 * Per integrare col renderer:
 * ```ts
 * tick(state, {rom});
 * const frame = render.buildFrame(state);
 * // → consegna `frame` al renderer PixiJS
 * ```
 *
 * Le sub-functions ancora non replicate (sound, EEPROM, FUN_26D8A scroll,
 * FUN_26F3E late logic) sono no-op: lo state core si aggiorna ma audio
 * e persistenza non avvengono ancora.
 */
export function tick(s: GameState, opts: { rom: RomImage } & Partial<Omit<MainTickOptions, "rom">>): void {
  rngClearFrameCounter(s.rng);
  runMainTick(s, opts as MainTickOptions);
}
