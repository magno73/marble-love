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
export * as bannerHelper26B66 from "./banner-helper-26b66.js";
export * as mainLoop from "./main-loop.js";
export * as eventFlags from "./event-flags.js";
export * as scrollFlagHelperF6A from "./scroll-flag-helper-f6a.js";
export * as arrayHelpers from "./array-helpers.js";
export * as stringFormat from "./string-format.js";
export * as stringAddrCheck39F0 from "./string-addr-check-39f0.js";
export * as trackballInput from "./trackball-input.js";
export * as timerCascade from "./timer-cascade.js";
export * as alphaTilemap from "./alpha-tilemap.js";
export * as byteQueue from "./byte-queue.js";
export * as mathHelpers from "./math-helpers.js";
export * as gameTickTimers from "./game-tick-timers.js";
export * as gameMainGate from "./game-main-gate.js";
export * as gameStateMachine from "./game-state-machine.js";
export * as stateSub1EAA from "./state-sub-1eaa.js";
export * as stateSub2572 from "./state-sub-2572.js";
export * as stateSub2678 from "./state-sub-2678.js";
export * as stateSub2766 from "./state-sub-2766.js";
export * as stateSub2818 from "./state-sub-2818.js";
export * as stateSub295A from "./state-sub-295a.js";
export * as stateSub26C2 from "./state-sub-26c2.js";
export * as stateSub2ABC from "./state-sub-2abc.js";
export * as stateSub2BDA from "./state-sub-2bda.js";
export * as stateSub2C60 from "./state-sub-2c60.js";
export * as stateSub2CD4 from "./state-sub-2cd4.js";
export * as stateSub2DA0 from "./state-sub-2da0.js";
export * as stateSub28EA from "./state-sub-28ea.js";
export * as stateSub5200 from "./state-sub-5200.js";
export * as stateSub520E from "./state-sub-520e.js";
export * as helper5236 from "./helper-5236.js";
export * as orFlags5248 from "./or-flags-5248.js";
export * as stateSub5250 from "./state-sub-5250.js";
export * as stateSub525C from "./state-sub-525c.js";
export * as stateSub5284 from "./state-sub-5284.js";
export * as stateBuilder52DA from "./state-builder-52da.js";
export * as stateSub540A from "./state-sub-540a.js";
export * as stateSub5334 from "./state-sub-5334.js";
export * as stateSub535E from "./state-sub-535e.js";
export * as stateSub5584 from "./state-sub-5584.js";
export * as stateSub5608 from "./state-sub-5608.js";
export * as stateSub5D2A from "./state-sub-5d2a.js";
export * as stateSub50F4 from "./state-sub-50f4.js";
export * as stateSub59D2 from "./state-sub-59d2.js";
export * as entityWaypointStep1D1EC from "./entity-waypoint-step-1d1ec.js";
export * as syncAvToggle1E08 from "./sync-av-toggle-1e08.js";
export * as renderGlyphLoop1E64 from "./render-glyph-loop-1e64.js";
export * as renderStringChain3662 from "./render-string-chain-3662.js";
export * as renderStringChain3520 from "./render-string-chain-3520.js";
export * as positionUpdate from "./position-update.js";
export * as vectorScale from "./vector-scale.js";
export * as stringRender from "./string-render.js";
export * as stringClear from "./string-clear.js";
export * as stringShift from "./string-shift.js";
export * as stateMachineSchedule from "./state-machine-schedule.js";
export * as stateDispatch1605C from "./state-dispatch-1605c.js";
export * as stateDispatch15460 from "./state-dispatch-15460.js";
export * as stateDispatch12FD0 from "./state-dispatch-12fd0.js";
export * as stateValidateGrid15DB6 from "./state-validate-grid-15db6.js";
export * as stringStep from "./string-step.js";
export * as bcd from "./bcd.js";
export * as paletteInit from "./palette-init.js";
export * as objectHelpers from "./object-helpers.js";
export * as rleExpand from "./rle-expand.js";
export * as stringTrim from "./string-trim.js";
export * as slotSearch from "./slot-search.js";
export * as scriptSlotClaim from "./script-slot-claim.js";
export * as scriptSlotBboxTest14E92 from "./script-slot-bbox-test-14e92.js";
export * as slotSpawnPattern13D38 from "./slot-spawn-pattern-13d38.js";
export * as scriptRectDispatch12DFA from "./script-rect-dispatch-12dfa.js";
export * as objectRenderUpdate13334 from "./object-render-update-13334.js";
export * as objectRenderUpdate1365C from "./object-render-update-1365c.js";
export * as slotMatch12DAE from "./slot-match-12dae.js";
export * as initHelpers from "./init-helpers.js";
export * as initLevelLoad1A236 from "./init-level-load-1a236.js";
export * as moScreenInit1A286 from "./mo-screen-init-1a286.js";
export * as alphaRamBootInitED6 from "./alpha-ram-boot-init-ed6.js";
export * as pfScroll from "./pf-scroll.js";
export * as pfScrollEmit26E14 from "./pf-scroll-emit-26e14.js";
export * as soundTick from "./sound-tick.js";
export * as soundStatusCheck from "./sound-status-check.js";
export * as soundIrqInput from "./sound-irq-input.js";
export * as soundDispatchSend from "./sound-dispatch-send.js";
export * as soundCmdSend from "./sound-cmd-send.js";
export * as soundCmdSend158AC from "./sound-cmd-send-158ac.js";
export * as soundCmdGate from "./sound-cmd-gate.js";
export * as flagScaledMagnitudeDispatch from "./flag-scaled-magnitude-dispatch.js";
export * as eepromCommit from "./eeprom-commit.js";
export * as eepromCommitRequest from "./eeprom-commit-request.js";
export * as eepromHelper40D8 from "./eeprom-helper-40d8.js";
export * as fieldFetch4058 from "./field-fetch-4058.js";
export * as hiScoreDecode41c8 from "./hi-score-decode-41c8.js";
export * as slotArrayInit from "./slot-array-init.js";
export * as slotArrayTick from "./slot-array-tick.js";
export * as dispatchStrings17230 from "./dispatch-strings-17230.js";
export * as stringDispatchTable177F8 from "./string-dispatch-table-177f8.js";
export * as objectStep17F66 from "./object-step-17f66.js";
export * as stringSlotMatch1730C from "./string-slot-match-1730c.js";
export * as stringTargetStep176D2 from "./string-target-step-176d2.js";
export * as stringHelper17CB8 from "./string-helper-17cb8.js";
export * as stringViewportHit175C8 from "./string-viewport-hit-175c8.js";
export * as dispatchTable1EEA0 from "./dispatch-table-1eea0.js";
export { bootInit } from "./boot-init.js";
export * as bootSpuriousHandler from "./boot-spurious-handler.js";
export * as slapsticWordCopy2FF28 from "./slapstic-word-copy-2ff28.js";
export * as thunk10042 from "./thunk-10042.js";
export * as disableInterrupts10110 from "./disable-interrupts-10110.js";
export * as animationStep from "./animation-step.js";
export * as spriteCoords from "./sprite-coords.js";
export * as objectCompare from "./object-compare.js";
export * as spritePack from "./sprite-pack.js";
export * as spriteDerive from "./sprite-derive.js";
export * as spritePosUpdate1BAB2 from "./sprite-pos-update-1bab2.js";
export * as spriteHelper1B9CC from "./sprite-helper-1b9cc.js";
export * as objectCharcodeBroadcast1BBAA from "./object-charcode-broadcast-1bbaa.js";
export * as spriteBracketLerp1C676 from "./sprite-bracket-lerp-1c676.js";
export * as spriteRotate1C014 from "./sprite-rotate-1c014.js";
export * as spriteProject1CC62 from "./sprite-project-1cc62.js";
export * as objectTypeDispatch194BA from "./object-type-dispatch-194ba.js";
export * as stateSub16A20 from "./state-sub-16a20.js";
export * as stateSub186AC from "./state-sub-186ac.js";
export * as stateSub1844A from "./state-sub-1844a.js";
export * as stateSub1881C from "./state-sub-1881c.js";
export * as stateSub18A88 from "./state-sub-18a88.js";
export * as stateSub1960E from "./state-sub-1960e.js";
export * as waypointListStep1815A from "./waypoint-list-step-1815a.js";
export * as stateSub198BC from "./state-sub-198bc.js";
export * as stateSub19A40 from "./state-sub-19a40.js";
export * as stateSub19BAA from "./state-sub-19baa.js";
export * as stateSub1B5C2 from "./state-sub-1b5c2.js";
export * as bboxHitTest19D94 from "./bbox-hit-test-19d94.js";
export * as particleInit18CD2 from "./particle-init-18cd2.js";
export * as marbleCellDispatch19E42 from "./marble-cell-dispatch-19e42.js";
export * as gridBitmapTest from "./grid-bitmap-test.js";
export * as lerp from "./lerp.js";
export * as timerDelta from "./timer-delta.js";
export * as vblankWait from "./vblank-wait.js";
export * as waitVblankStateGated from "./wait-vblank-state-gated.js";
export * as formatAndRender28E00 from "./format-and-render-28e00.js";
export * as formatAndRender28EB2 from "./format-and-render-28eb2.js";
export * as particleBounce from "./particle-bounce.js";
export * as specialAttract from "./special-attract.js";
export * as soundPair15884 from "./sound-pair-15884.js";
export * as soundMaybe11AC2 from "./sound-maybe-11ac2.js";
export * as objectUpdatePair158CC from "./object-update-pair-158cc.js";
export * as sceneInit11428 from "./scene-init-11428.js";
export * as sceneObjInit28CA6 from "./scene-obj-init-28ca6.js";
export * as objDirtyDispatch28624 from "./obj-dirty-dispatch-28624.js";
export * as objectAccumFlag28608 from "./object-accum-flag-28608.js";
export * as hudFrameInit283C2 from "./hud-frame-init-283c2.js";
export * as levelFractionRender28232 from "./level-fraction-render-28232.js";
export * as objectStateEntry25BAE from "./object-state-entry-25bae.js";
export * as proximityCheck from "./proximity-check.js";
export * as paletteRngFill26CFA from "./palette-rng-fill-26cfa.js";
export * as array9ClearAndDispatch from "./array-9-clear-and-dispatch.js";
export * as objPickLarger from "./obj-pick-larger.js";
export * as trackballClampFlags28468 from "./trackball-clamp-flags-28468.js";
export * as hudFormat from "./hud-format.js";
export * as trackballApply from "./trackball-apply.js";
export * as moveVelocity from "./move-velocity.js";
export * as sub19692 from "./sub-19692.js";
export * as sub19976 from "./sub-19976.js";
export * as sub1937C from "./sub-1937c.js";
export * as nearestNeighbor from "./nearest-neighbor.js";
export * as mainTick from "./main-tick.js";
export * as auxTimer from "./aux-timer.js";
export * as renderStringEntry28FDE from "./render-string-entry-28fde.js";
export * as renderStringEntry28F62 from "./render-string-entry-28f62.js";
export * as renderScore28E3C from "./render-score-28e3c.js";
export * as renderStringEntry28FA0 from "./render-string-entry-28fa0.js";
export * as renderStringEntry286B0 from "./render-string-entry-286b0.js";
export * as renderString286EE from "./render-string-286ee.js";
export * as objectEnterState23 from "./object-enter-state-23.js";
export * as objectEnter1281C from "./object-enter-1281c.js";
export * as objectInit2591A from "./object-init-2591a.js";
export * as objectInit259B4 from "./object-init-259b4.js";
export * as objectSlotLookup11B18 from "./object-slot-lookup-11b18.js";
export * as objectScanDispatch251DE from "./object-scan-dispatch-251de.js";
export * as findNearestTarget2637A from "./find-nearest-target-2637a.js";
export * as slapsticLookup from "./slapstic-lookup.js";
export * as slapsticDispatcher1344C from "./slapstic-dispatcher-1344c.js";
export * as slapsticTableStore from "./slapstic-table-store.js";
export * as clearPfStride from "./clear-pf-stride.js";
export * as bsearchTable1ABD4 from "./bsearch-table-1abd4.js";
export * as keyRankLookup4686 from "./key-rank-lookup-4686.js";
export * as scoreTableUpdate4790 from "./score-table-update-4790.js";
export * as levelDispatcherHelper18FD0 from "./level-dispatcher-helper-18fd0.js";
export * as levelHelper2FFB8 from "./level-helper-2ffb8.js";
export * as levelInit16F6C from "./level-init-16f6c.js";
export * as tilemapEntryPack1A9CC from "./tilemap-entry-pack-1a9cc.js";
export * as tilemapRowBuild1A444 from "./tilemap-row-build-1a444.js";
export * as tilemapSpanBuilder1AA38 from "./tilemap-span-builder-1aa38.js";
export * as levelDispatcher16EC6 from "./level-dispatcher-16ec6.js";
export * as playerSlotIter118D2 from "./player-slot-iter-118d2.js";
export * as sortAdjacentObjects1A7A8 from "./sort-adjacent-objects-1a7a8.js";
export * as decodeBitstream1A668 from "./decode-bitstream-1a668.js";
export * as moBlockEmit1A8D2 from "./mo-block-emit-1a8d2.js";
export * as renderTileLine1AD54 from "./render-tile-line-1ad54.js";
export * as slotInsertSorted18E6C from "./slot-insert-sorted-18e6c.js";
export * as helper18F46 from "./helper-18f46.js";
export * as helper12F44 from "./helper-12f44.js";
export * as bufferFill1B12A from "./buffer-fill-1b12a.js";
export * as stateSub15BD0 from "./state-sub-15bd0.js";
export * as stateSub14C46 from "./state-sub-14c46.js";
export * as stateSub15670 from "./state-sub-15670.js";
export * as spriteCoordsJsr150D0 from "./sprite-coords-jsr-150d0.js";
export * as tilemapBlit17044 from "./tilemap-blit-17044.js";
export * as bootScreenInit from "./boot-screen-init.js";
export * as mainLoopInit117B2 from "./main-loop-init-117b2.js";
export * as softReset100E0 from "./soft-reset-100e0.js";
export * as helper11FF8 from "./helper-11ff8.js";
export * as helper16E8E from "./helper-16e8e.js";
export * as helper1E3E from "./helper-1e3e.js";
export * as helper15FE6 from "./helper-15fe6.js";
export * as helper3784 from "./helper-3784.js";
export * as helper3A08 from "./helper-3a08.js";
export * as helper3A54 from "./helper-3a54.js";
export * as finalize11654 from "./finalize-11654.js";
export * as bootHelper1464A from "./boot-helper-1464a.js";
export * as clearPlayfieldRam12174 from "./clear-playfield-ram-12174.js";
export * as clearAlphaTiles28C7E from "./clear-alpha-tiles-28c7e.js";
export * as initFnPointers28580 from "./init-fn-pointers-28580.js";
export * as clearPlayfieldOther12186 from "./clear-playfield-other-12186.js";
export * as moGridInit2404 from "./mo-grid-init-2404.js";
export * as spritePairCoordAdd1D82 from "./sprite-pair-coord-add-1d82.js";
export * as processAllSprites189E2 from "./process-all-sprites-189e2.js";
export * as counterPoolSubtract4008 from "./counter-pool-subtract-4008.js";
export * as objectArrayInit25B40 from "./object-array-init-25b40.js";
export * as objectOrbitEmit13ADE from "./object-orbit-emit-13ade.js";
export * as stateDispatch160F6 from "./state-dispatch-160f6.js";
export * as randomMod13A98 from "./random-mod-13a98.js";
export * as render from "./render.js";
export * as audio from "./audio.js";
export * as trace from "./trace.js";
export * as irqVectorThunks from "./irq-vector-thunks.js";
export * as gameModePrep10456 from "./game-mode-prep-10456.js";
export * as scriptSlotStep13068 from "./script-slot-step-13068.js";
export * as helper12896 from "./helper-12896.js";
export * as lateGameLogic26F3E from "./late-game-logic-26f3e.js";
export * as subFA0MarbleEmit from "./sub-fa0-marble-emit.js";
export * as refreshHelper1493C from "./refresh-helper-1493c.js";
export * as refreshHelper1912C from "./refresh-helper-1912c.js";
export * as refreshHelper13EE6 from "./refresh-helper-13ee6.js";
export * as refreshFrame10FCE from "./refresh-frame-10fce.js";
export * as gameStateBanner26B2A from "./game-state-banner-26b2a.js";
export * as vblankHelpers from "./vblank-helpers.js";
export * as scrollRange144E4 from "./scroll-range-144e4.js";
export * as scrollSub15A12 from "./scroll-sub-15a12.js";
export * as helper2548 from "./helper-2548.js";
export * as helper121B8 from "./helper-121b8.js";
export * as helper1BC88 from "./helper-1bc88.js";
export * as helper1C88 from "./helper-1c88.js";
export * as helper253BC from "./helper-253bc.js";
export * as helper25FC2 from "./helper-25fc2.js";
export * as helper285B0 from "./helper-285b0.js";
export * as helper1CD00 from "./helper-1cd00.js";
export * as absHelpers from "./abs-helpers.js";
export * as scrollCoordHelpers from "./scroll-coord-helpers.js";
export * as strcpy1D74 from "./strcpy-1d74.js";
export * as miniHelpers from "./mini-helpers.js";
export * as helper15148 from "./helper-15148.js";
export * as helper172C2 from "./helper-172c2.js";
export * as helper28C38 from "./helper-28c38.js";
export * as helper28D02 from "./helper-28d02.js";
export * as helper25C74 from "./helper-25c74.js";
export * as helper25E7C from "./helper-25e7c.js";
export * as sub1BB08 from "./sub-1bb08.js";
export * as sub14DEC from "./sub-14dec.js";
export * as sub1D242 from "./sub-1d242.js";
export * as slapstic103 from "./m68k/slapstic-103.js";
export * as applySlapsticBank from "./m68k/apply-slapstic-bank.js";
export * as inputReplay from "./input-replay.js";

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
 * Orchestrator che chiama 14 root sub-systems replicati bit-perfect dal
 * binario originale (`FUN_00028788`). Aggiorna `state.workRam`,
 * `state.playfieldRam`, `state.colorRam`, `state.alphaRam`, `state.spriteRam`
 * coerentemente col binario.
 *
 * Per integrare col renderer:
 * ```ts
 * tick(state, {rom});
 * const frame = render.buildFrame(state);
 * // → consegna `frame` al renderer PixiJS
 * ```
 *
 * Sub ancora stubbed: FUN_158AC (sound cmd send conditional), FUN_26F3E
 * (lateGameLogic conditional), FUN_4DCC (sound chip writer, richiede YM2151).
 */
export function tick(s: GameState, opts: { rom: RomImage } & Partial<Omit<MainTickOptions, "rom">>): void {
  rngClearFrameCounter(s.rng);
  runMainTick(s, opts as MainTickOptions);
}

// ─── Sound subsystem (cherry-pick da feature/sound-chip C4-C10) ─────────────
export {
  type SoundChip,
  type SoundChipConfig,
  createSoundChip,
  tickCycles,
  submitCommand,
  drainReplyEvents,
  getRegisterShadow,
  resetSoundChip,
} from "./m6502/sound-chip.js";
export { SOUND_CYCLES_PER_FRAME } from "./m6502/sound-clock.js";
