/**
 * main-tick.ts - main game tick orchestrator.
 *
 * Mirrors the call structure of `FUN_00028788`, the IRQ4 vblank handler the ROM
 * invokes every frame at 60 Hz. Unported sub-functions remain no-op or injectable
 * callbacks until they have oracle-backed implementations.
 *
 * Subs called by the binary (in order):
 *   1. paletteAnim1Tick (FUN_26BEE) ✅
 *   2. paletteAnim2Tick (FUN_26C78) ✅
 *   3. paletteAnim3Tick (FUN_26D4E) ✅
 *   4. paletteQueueDrain (FUN_26B88) ✅
 *   5. gameStateMachineTick (FUN_2E18 via thunk 0x148)
 *   6. soundTick (FUN_4CA0 via thunk 0x15A)
 *   7. gameTickTimers (FUN_28A96) ✅
 *   8. trackballClampFlags28468 (FUN_28468 via thunk 0x10042) ✅
 *   9. gameMainGate (FUN_28972) ✅
 *   10. auxTimer (FUN_10146) ✅
 *   11. eepromCommit (FUN_3F78 via thunk 0x160) ✅
 *   12. soundCommand (FUN_158AC), emitted by replicated subs through audio hook
 *   13. specialAttract (FUN_288F8) ✅
 *   14. particleBounce (FUN_18DCA), conditional on *0x4003E2
 *   15. lateGameLogic (FUN_26F3E), called after mainLoopInit1101E when
 *       runMainLoopBody=true. It emits sprite RAM entries from work RAM objects.
 *
 * Also includes the conditional FUN_26D8A playfield-scroll setup at the start.
 *
 * Side effect: updates workRam, colorRam, alphaRam, and spriteRam in ROM order.
 * `render.buildFrame(state)` can then consume the state.
 */

import type { GameState } from "./state.js";
import type { RomImage } from "./bus.js";

import { mainUpdateScrollSync } from "./main-loop.js";
import { pfScrollUpdate } from "./pf-scroll.js";
import { mainLoopInit1101E, type MainLoopInit1101ESubs } from "./main-loop-init-1101e.js";
import { refreshFrame10FCE } from "./refresh-frame-10fce.js";
import { lateGameLogic26F3E } from "./late-game-logic-26f3e.js";
import { fun_FA0_marbleEmit } from "./sub-fa0-marble-emit.js";
import { sub14966 } from "./sub-14966.js";
import { runWarmSlotArrayReplayTick } from "./slot-array-replay.js";
import { runWarmResidualReplayTick } from "./warm-residual-replay.js";
import { randomMod13A98 } from "./random-mod-13a98.js";
import { soundTick } from "./sound-tick.js";
import type { SoundTickSubs } from "./sound-tick.js";
import { soundCmdSend158AC } from "./sound-cmd-send-158ac.js";
import { soundDispatchSend } from "./sound-dispatch-send.js";
import { soundStatusCheck } from "./sound-status-check.js";
import { auxTimer } from "./aux-timer.js";
import { specialAttract } from "./special-attract.js";
import { eepromCommit } from "./eeprom-commit.js";
import { stateSub2ABC } from "./state-sub-2abc.js";
import { stateSub2678 } from "./state-sub-2678.js";
import { stateSub2BDA } from "./state-sub-2bda.js";
import { stateSub2DA0 } from "./state-sub-2da0.js";
import { stateSub2C60 } from "./state-sub-2c60.js";
import { stateSub2572 } from "./state-sub-2572.js";
import { stateSub2766 } from "./state-sub-2766.js";
import { stateSub2818 } from "./state-sub-2818.js";
import { stateSub295A } from "./state-sub-295a.js";
import { stateSub2CD4 } from "./state-sub-2cd4.js";
import { paletteAnim1Tick, paletteAnim2Tick } from "./palette-anim.js";
import { paletteAnim3Tick, paletteQueueDrain } from "./palette-queue.js";
import { gameStateMachineTick } from "./game-state-machine.js";
import type { GameStateMachineSubs } from "./game-state-machine.js";
import { gameTickTimers } from "./game-tick-timers.js";
import type { HudCallback } from "./game-tick-timers.js";
import { trackballClampFlags28468 } from "./trackball-clamp-flags-28468.js";
import { gameMainGate } from "./game-main-gate.js";
import type { GameMainGateOptions } from "./game-main-gate.js";
import { particleBounce } from "./particle-bounce.js";
import { CYCLES_PER_VBLANK } from "./m68k/cycle-table.js";
import { addCpuCycles, resetCpuCycles } from "./m68k/clock.js";
import { SUB_CYCLE_ESTIMATE } from "./m68k/sub-cycle-costs.js";
import { as_u8, as_u16, as_u32, raw } from "./wrap.js";
import {
  advanceMode0Init11452Async,
  advanceMode2Init11452Async,
  startMode2Init11452Async,
} from "./mode2-init-11452-async.js";
import { levelFractionRender28232Default } from "./level-fraction-render-28232.js";
import { tilemapBlit17044 } from "./tilemap-blit-17044.js";
import { renderString286EE } from "./render-string-286ee.js";
import { formatNumber3874 } from "./string-format.js";
import { renderStringChain3520 } from "./render-string-chain-3520.js";
import { clearAlphaRows } from "./alpha-tilemap.js";
import { advanceLevelIntroBannerResume } from "./level-intro-banner-resume.js";
import {
  advanceHighScoreInitialsEntry,
  highScoreInitialsEntryActive,
} from "./high-score-initials-entry.js";
import { helper11FF8Default } from "./read-abs-byte-11ff8.js";

export interface MainTickInputs {
  /** Trackball MMIO absolute byte player 1 X. */
  p1X?: number;
  /** Trackball MMIO absolute byte player 1 Y. */
  p1Y?: number;
  /** Trackball MMIO absolute byte player 2 X. */
  p2X?: number;
  /** Trackball MMIO absolute byte player 2 Y. */
  p2Y?: number;
  /**
   * MMIO byte @ 0xF60001 read by gameMainGate (default 0x6F = attract
   * mode steady-state: DIP switches + coin status, no buttons pressed,
   * bit 6 set per skip Block C). Verificato vs MAME multi-frame dump
   * (frame 2400-2460 stabile a 0x6F).
   */
  inputMmio?: number;
}

export interface MainTickOptions extends MainTickInputs {
  /** ROM image required by gameStateMachineTick + paletteAnim/Queue. */
  rom: RomImage;
  /** Sub-functions stubs di gameStateMachineTick. */
  stateMachineSubs?: GameStateMachineSubs;
  /** HUD callback di gameTickTimers (no-op default). */
  hudCallback?: HudCallback;
  /** gameMainGate gateCheck stub (= FUN_01CC). */
  gateCheck?: GameMainGateOptions["gateCheck"];
  /** gameMainGate controlCallback stub (= FUN_28D02). */
  controlCallback?: GameMainGateOptions["controlCallback"];
  /** Skip frame counter increment, useful for deterministic tests. */
  skipFrameCounter?: boolean;
  /** Sub-function stubs for the FUN_4CA0 sound dispatcher (FUN_3E1A, FUN_4DCC, FUN_4C3E). */
  soundSubs?: SoundTickSubs;
  /**
   * If true, after mainTick also call `mainLoopInit1101E(state, rom)` to advance
   * dispatcher state machine `*0x400390`. In the binary this runs on the main
   * thread (FUN_117B2 loop), separate from IRQ4 vblank. It approximates the
   * game-loop body run for gameplay simulation. Default OFF, preserving parity
   * with the MAME oracle.
   */
  runMainLoopBody?: boolean;
}

const MAIN_LOOP_SOUND_SUBS: MainLoopInit1101ESubs = {
  soundCmd: soundCmdSend158AC,
  init10504Subs: { soundCmd: soundCmdSend158AC },
  init11452Subs: { soundCmd: soundCmdSend158AC },
};

function readWorkWord(state: GameState, off: number): number {
  return (((state.workRam[off] ?? 0) << 8) | (state.workRam[off + 1] ?? 0)) & 0xffff;
}

function renderFinalizeHeader11654(state: GameState, rom: RomImage): void {
  const mode = readWorkWord(state, 0x392);
  const d2 = mode === 2 ? 0x2000 : 0;
  if (d2 === 0) {
    stateSub2572(state, rom, 0x00022a26, 0x1800);
  }
  stateSub2572(state, rom, 0x00022a32, (0x3000 - d2) >>> 0);
}

function renderTimerHud286EE(state: GameState, rom: RomImage, timerPtr: number, idx: number): void {
  renderString286EE(state, rom, timerPtr, idx, {
    numberFormatter: (st, value, bufEnd, fmtMode, width, fillExtra) => {
      formatNumber3874(st, value, bufEnd, fmtMode, width, fillExtra);
    },
    renderStringChain2: (entryPtr, attrLong) => {
      renderStringChain3520(state, rom, entryPtr, attrLong);
    },
  });
}

/**
 * Runs one complete game tick (= 1 frame @ 60 Hz).
 *
 * Mirrors the call order in ROM routine `FUN_00028788`. Routines not yet
 * replicated are no-ops: their side effects (sound, eeprom) do not run, but the
 * core game state still advances correctly.
 *
 * Renderer hookup: call `mainTick(state, {rom})` each frame, then
 * `buildFrame(state, options)` from `render.ts` to obtain a Frame consumable by
 * the PixiJS renderer.
 */
export function mainTick(state: GameState, opts: MainTickOptions): void {
  const r = state.workRam;
  const rom = opts.rom;

  // IRQ4 preamble (replica of FUN_00010116).
  // The IRQ4 handler ADDQ.B #1 on 0x400016 (vblank mailbox) and 0x400014, but
  // both are overwritten during the body:
  //   - 0x400016 is cleared by FUN_28DEA (vblankAck) on every invocation.
  //   - 0x400014 is overwritten by subs at 0x17aa/0x1b82
  //     (move.w 0x400010 -> 0x400014).
  // MAME's final frame_done value reflects those overwrites, not the IRQ
  // increment. Replicating the increment here creates cumulative drift, so the
  // correct subroutines own those offsets.
  if (!opts.skipFrameCounter) {
    state.clock.frame = ((state.clock.frame + 1) >>> 0) as typeof state.clock.frame;
  }
  const asyncInitActiveAtTickStart =
    state.clock.mode2Init11452Stage !== undefined ||
    state.clock.mode2BottomHudDelay !== undefined ||
    state.clock.mode0Init11452Stage !== undefined ||
    state.clock.mainThreadWaitDelay !== undefined ||
    state.clock.levelIntroScrollResumeTick !== undefined ||
    state.clock.levelIntroBannerResumeTick !== undefined ||
    highScoreInitialsEntryActive(state);
  // Some attract segments hold the mode0 refresh body for an extra staged
  // dwell; MAME keeps the presentation object frozen until the delayed 10504
  // handoff lands.
  const mode0Segment = r[0x3e4] ?? 0;
  const mode0AsyncRefreshStartStage =
    mode0Segment === 3 ? 95 :
    mode0Segment === 5 ? 91 :
    65;
  const mode0AsyncRefreshAtTickStart =
    state.clock.mode0Init11452Stage !== undefined &&
    state.clock.mode0Init11452Stage >= mode0AsyncRefreshStartStage &&
    state.clock.mode0Init11452Stage < ((r[0x3e4] ?? 0) === 3 ? 849 : 1020);
  const mode0AsyncLevelFractionAtTickStart =
    mode0AsyncRefreshAtTickStart &&
    (
      (mode0Segment === 2 && (state.clock.mode0Init11452Stage ?? 0) > 64) ||
      (mode0Segment === 3 && (state.clock.mode0Init11452Stage ?? 0) > 92) ||
      (mode0Segment === 4 && (state.clock.mode0Init11452Stage ?? 0) > 64) ||
      (mode0Segment === 5 && (state.clock.mode0Init11452Stage ?? 0) > 90)
    );
  const mainThreadBlockedAtTickStart =
    state.clock.mode2Init11452Stage !== undefined ||
    state.clock.mode2BottomHudDelay !== undefined ||
    state.clock.mainThreadWaitDelay !== undefined ||
    state.clock.levelIntroScrollResumeTick !== undefined ||
    state.clock.levelIntroBannerResumeTick !== undefined ||
    highScoreInitialsEntryActive(state) ||
    (state.clock.mode0Init11452Stage !== undefined && !mode0AsyncRefreshAtTickStart);

  // ─── FUN_28788 prefix (scroll/MMIO setup) ────────────────────────────
  // Replica 0x28788..0x287D8: incrementer + latch Y target + AV-control.
  mainUpdateScrollSync(state);

  // FUN_26D8A (PF scroll update) — conditional. In playable gameplay with
  // live trackball movement, frame_done snapshots expose the trigger one
  // vblank before the visible scroll/MO side effects, so schedule it there and
  // apply the previous one below. Attract/presentation segments keep the
  // immediate cadence already aligned by the long-demo oracle.
  const runDeferredPfScroll = state.clock.pendingPfScrollUpdate !== undefined;
  state.clock.pendingPfScrollUpdate = undefined;
  const p1InputActive = (opts.p1X ?? 0xff) !== 0xff || (opts.p1Y ?? 0xff) !== 0xff;
  const deferPfScrollUpdate =
    opts.runMainLoopBody === true &&
    ((r[0x3e4] ?? 0) === 2 || (r[0x3e4] ?? 0) === 4) &&
    p1InputActive;
  if (
    (r[0x08] ?? 0) !== 0 &&
    (r[0x0a] ?? 0) >= 2 &&
    (r[0x14] ?? 0) === 1
  ) {
    if (deferPfScrollUpdate) {
      state.clock.pendingPfScrollUpdate = as_u8(1);
    } else {
      pfScrollUpdate(state);
    }
  }
  if (runDeferredPfScroll) {
    pfScrollUpdate(state);
  }

  paletteAnim1Tick(state, rom);
  paletteAnim2Tick(state, rom);
  paletteAnim3Tick(state);
  paletteQueueDrain(state, rom);

  // Default state-machine subs: calls the replicated subs. 10/10 subs
  // disponibili: 2abc/2678/2bda/2da0/2c60 (Claude) + 2572/2766/2818/295a/2cd4
  // (Codex), tutte parity 500/500.
  const stateMachineSubs: GameStateMachineSubs = opts.stateMachineSubs ?? {
    fun_2abc: (argLong) => stateSub2ABC(state, rom, argLong),
    fun_2678: (argLong) => stateSub2678(state, argLong, {
      fun_2abc: (clearArg) => stateSub2ABC(state, rom, clearArg),
    }),
    fun_2bda: (a1, a2, a3) => { stateSub2BDA(state, a1, a2, a3); },
    fun_2da0: (a1, a2) => stateSub2DA0(state, rom, a1, a2),
    fun_2c60: (a1, a2) => { stateSub2C60(state, a1, a2); },
    fun_295a: () => { stateSub295A(state, rom); },
    fun_2572: (a1, a2) => { stateSub2572(state, rom, a1, a2); },
    fun_2cd4: (a1, a2, a3) => stateSub2CD4(state, rom, a1, a2, a3),
    fun_2766: (argLong) => { stateSub2766(state, rom, argLong); },
    fun_2818: (argLong) => { stateSub2818(state, rom, argLong); },
  };
  gameStateMachineTick(state, rom, stateMachineSubs);

  // FUN_4CA0 (sound dispatcher wrapper, replicated).
  // Subs FUN_3E1A and FUN_4C3E are now bit-perfect replicas; FUN_4DCC remains
  // stubbed (requires YM2151 emulation). Default subs call the replicas.
  const soundSubs: SoundTickSubs = opts.soundSubs ?? {
    fun_3e1a: (argLong) => soundDispatchSend(state, rom, argLong),
    fun_4c3e: (st, d0, a0) => soundStatusCheck(st, d0, a0),
    // fun_4dcc: undefined → soundTick uses the default mini-stub (counter increment)
  };
  soundTick(state, soundSubs);

  const mode2Segment3Dwell =
    (((r[0x390] ?? 0) << 8) | (r[0x391] ?? 0)) === 1 &&
    (((r[0x392] ?? 0) << 8) | (r[0x393] ?? 0)) === 2 &&
    (r[0x3e4] ?? 0) === 3;
  const pendingNewGameInitAtTickStart = readWorkWord(state, 0x390) === 5;
  if (!asyncInitActiveAtTickStart && !mode2Segment3Dwell && !pendingNewGameInitAtTickStart) {
    gameTickTimers(
      state,
      opts.hudCallback ?? ((timerPtr, idx) => renderTimerHud286EE(state, rom, timerPtr, idx)),
    );
  }

  // The IRQ trackball thunk does more than save raw encoder deltas: it also
  // updates the signed accumulators at 0x4006A4/0x4006A6 consumed by
  // FUN_25DF6 during player physics.
  trackballClampFlags28468(state, {
    mmioInputByte: opts.inputMmio ?? 0x6f,
    p1X: opts.p1X ?? 0xff,
    p1Y: opts.p1Y ?? 0xff,
    p2X: opts.p2X ?? 0xff,
    p2Y: opts.p2Y ?? 0xff,
  });

  const gateOpts: GameMainGateOptions = { mmioInput: opts.inputMmio ?? 0x6f };
  if (opts.gateCheck !== undefined) gateOpts.gateCheck = opts.gateCheck;
  if (opts.controlCallback !== undefined) gateOpts.controlCallback = opts.controlCallback;
  gameMainGate(state, gateOpts);

  // 0x4003F2/F0 sync logic
  if ((r[0x3f2] ?? 0) !== (r[0x3f0] ?? 0)) {
    r[0x3f2] = r[0x3f0] ?? 0;
    r[0x3f4] = 0;
  } else {
    r[0x3f4] = ((r[0x3f4] ?? 0) + 1) & 0xff;
  }

  // FUN_10146 (aux timer/byte queue drain) — REPLICATO (0x28860, unconditional)
  auxTimer(state);

  // FUN_28788 sound/attract gate (ROM 0x28866..0x288ca, A2 = 0x4003EA). The ROM
  // heavily gates the eeprom-commit (FUN_3F78) + special-attract (FUN_288F8)
  // path. The prior port ran BOTH unconditionally every frame, which flooded the
  // 68k→6502 sound mailbox with command 0x61 each frame during gameplay — the
  // level-5 "music loops with two alternating sounds" + browser-slowdown bug.
  // On the gameplay seeds 0x3EA=0 and eepromCommit()=0, so D2(0) <= (0x3EA)(0)
  // ⇒ ROM skips FUN_288F8 (no 0x61), which this restores.
  const sndSext16 = (w: number): number => (w & 0x8000 ? w - 0x10000 : w);
  const sndWriteWord = (off: number, v: number): void => {
    r[off] = (v >>> 8) & 0xff;
    r[off + 1] = v & 0xff;
  };
  // 0x28866: moveq #-1,D0; cmp.w (A2),D0w; beq.w 0x288d0 — skip all if 0x3EA==-1.
  const sndProgress = sndSext16(readWorkWord(state, 0x3ea));
  if (sndProgress !== -1) {
    // 0x2886e: FUN_3F78 (eepromCommit) — side-effecting, gated behind 0x3EA!=-1.
    const sndD2 = sndSext16(eepromCommit(state) & 0xffff);
    // 0x28876: if D2 == 0 → clr.b *0x4003EE
    if (sndD2 === 0) r[0x3ee] = 0;
    if (sndD2 < sndProgress) {
      // 0x2887e/0x28882: D2 < (0x3EA) → (0x3EA)=D2, skip FUN_288F8.
      sndWriteWord(0x3ea, sndD2 & 0xffff);
    } else if (sndD2 === sndProgress) {
      // 0x28886/0x28888: D2 == (0x3EA) → skip FUN_288F8 (no write).
    } else {
      // 0x2888a: D2 > (0x3EA) → FUN_158AC(0x41); (0x3EA)=D2.
      soundCmdSend158AC(state, 0x41);
      sndWriteWord(0x3ea, sndD2 & 0xffff);
      // 0x28898: run FUN_288F8 (+ its 0x75A latch) only when *0x400390 == 1.
      if (sndSext16(readWorkWord(state, 0x390)) === 1) {
        // 0x288a4..0x288c2: set *0x40075A=-1 unless (0x75A<=0 && 0x392!=0 && 0x392!=3).
        const sndV75a = sndSext16(readWorkWord(state, 0x75a));
        const sndV392 = sndSext16(readWorkWord(state, 0x392));
        if (sndV75a > 0 || sndV392 === 0 || sndV392 === 3) {
          sndWriteWord(0x75a, 0xffff);
        }
        // 0x288ca: FUN_288F8 (special attract / end-screen sound).
        specialAttract(state, {
          soundCommand: (cmd) => { soundCmdSend158AC(state, cmd); },
        });
      }
    }
  }

  if ((r[0x3e2] ?? 0) !== 0) {
    r[0x3ae] = r[0x3b0] ?? 0;
    r[0x3af] = r[0x3b1] ?? 0;
    if (state.clock.particleLayerDelay !== undefined && state.clock.particleLayerDelay > 0) {
      state.clock.particleLayerDelay = as_u8(state.clock.particleLayerDelay - 1);
      if (state.clock.particleLayerDelay === 0) state.clock.particleLayerDelay = undefined;
    } else {
      particleBounce(state);
      // 0x288EC: the IRQ4 update path also runs FUN_26F3E when the special
      // particle layer is active; the first staged attract reset (3E4 == 1)
      // already carries that pass in the 11452 cadence model.
      if ((r[0x3e4] ?? 0) !== 1) {
        lateGameLogic26F3E(state, rom);
      }
    }
  }

  // Optional: run main-loop body iter (FUN_117B2 main thread approximation).
  // Default OFF — opt-in for renderer demo / game flow advancement.
  //
  // Dynamic 30/60Hz game-tick gating. The main thread (`FUN_117B2`, ROM
  // 0x117B2..0x118CE) does not run every vsync. After lateGameLogic it does:
  //   0x118B0  tst.b *0x400016        ; vblank mailbox set by IRQ4
  //   0x118B8  bne  0x118C0
  //   0x118BA  jsr  0x28DEA           ; spin-wait #1 (skipped if mailbox!=0)
  //   0x118C0  move.b #1, *0x40039A
  //   0x118C8  jsr  0x28DEA           ; spin-wait #2 (always)
  //   0x118CE  bra  0x11804           ; loop top
  //
  // Fast 30Hz path waits for two vsyncs; slow bodies whose cycle count crosses
  // a vblank skip one wait and can run at a transient 60Hz cadence. The TS
  // model simulates one vsync per tick and uses `mainLoopBodyTicks` plus the
  // accumulated cycle estimate to decide whether the next tick is body or wait.
  const OFF_VBLANK_MAILBOX = 0x16;
  let mainLoopWaitSnapshot: boolean | undefined;
  if (opts.runMainLoopBody === true && !mainThreadBlockedAtTickStart) {
    // Increment first to match the warm-state convention: after MAME f12000 the
    // first TS tick is WAIT and the second is BODY. A previous phase-flip
    // experiment made TS advance one body step ahead of MAME and was reverted.
    state.clock.mainLoopBodyTicks = ((state.clock.mainLoopBodyTicks + 1) >>> 0) as typeof state.clock.mainLoopBodyTicks;
    const tickIsBody = (state.clock.mainLoopBodyTicks & 1) === 0;
    mainLoopWaitSnapshot = !tickIsBody;
    if (!tickIsBody) {
      // WAIT tick: corresponds to one of MAME's spin-waits. No main body runs.
      r[0x3f0] = ((r[0x3f0] ?? 0) + 2) & 0xff;
      randomMod13A98(state, 0x100);
      const replayHandled = runWarmSlotArrayReplayTick(state, rom);
      if (!replayHandled && state.clock.pendingSlotArray1493C !== undefined) {
        const slotPtr = 0x00401302 + state.clock.pendingSlotArray1493C * 0x60;
        sub14966(state, rom, slotPtr);
        state.clock.pendingSlotArray1493C = undefined;
      }
      // During the special particle layer, FUN_28788 already ran 26F3E in
      // the IRQ4 path above. A spin-wait vblank does not also execute the
      // main-thread 117B2 body, so keep the older wait surrogate only for
      // normal gameplay frames.
      if ((r[0x3e2] ?? 0) === 0) {
        lateGameLogic26F3E(state, rom);
      }
    } else {
      // BODY candidate: mirror FUN_117B2 sequence.
      r[OFF_VBLANK_MAILBOX] = 0;
      resetCpuCycles(state);

      // Body run: mainLoopInit1101E (dispatcher) + lateGameLogic26F3E.
      // Accumulate known overhead; refreshFrame10FCE accounts for sub bodies.
      addCpuCycles(state, SUB_CYCLE_ESTIMATE["FUN_1101E_OVERHEAD"] ?? as_u32(40));
      if (mode0AsyncRefreshAtTickStart) {
        if (mode0AsyncLevelFractionAtTickStart) {
          renderFinalizeHeader11654(state, rom);
          levelFractionRender28232Default(state, rom);
        }
        refreshFrame10FCE(state, rom);
      } else {
        mainLoopInit1101E(state, rom, MAIN_LOOP_SOUND_SUBS);
      }
      // FUN_26F3E lateGameLogic, canonical post-body chain. Use the fast
      // attract estimate when *0x3E2 == 0.
      const fun26F3EKey = (r[0x3e2] ?? 0) === 0 ? "FUN_26F3E_FAST" : "FUN_26F3E";
      addCpuCycles(state, SUB_CYCLE_ESTIMATE[fun26F3EKey] ?? as_u32(2200));
      lateGameLogic26F3E(state, rom);

      // If cycle count overruns a vblank, set the IRQ4 mailbox and force the
      // next simulated tick back to BODY, matching MAME's skipped spin-wait.
      if (raw(state.clock.cpuTicks) > raw(CYCLES_PER_VBLANK)) {
        r[OFF_VBLANK_MAILBOX] = 1;
        // Bring the counter back so the next tick is BODY instead of WAIT.
        state.clock.mainLoopBodyTicks = ((state.clock.mainLoopBodyTicks - 1) >>> 0) as typeof state.clock.mainLoopBodyTicks;
      }
    }
    // fun_FA0_marbleEmit remains disabled. The marble should move through the
    // real MAME-backed helper chain, not through empirical sprite surrogates.
    void fun_FA0_marbleEmit;
  }

  // Main-thread vblank-counter snapshot.
  // FUN_FA0 (main-thread loop entry point) runs asynchronously to IRQ4. At each
  // sync-vblank it executes:
  //     btst.b #7, *0x400013     ; wait for vblank
  //     beq    skip
  //     tst.w  (A3); bne loop    ; with timeout
  //     move.w *0x400010, D0     ; reads HIGH word of long counter @ 0x400010
  //     andi.w #0xff, D0
  //     move.w D0,    *0x400014  ; snapshot low-byte
  // This overwrites IRQ4's increment-by-1 (FUN_10116 @ 0x10126). In steady-state
  // attract, `*0x400010` long < 0x10000, so high-word == 0 and *0x400014 = 0x00.
  // Replicate it as a minimal stub (= byte assignment to workRam[0x14]).
  // Verified against MAME multi-frame dumps: frames 2401..2460 alternate
  // workRam[0x14] between 0x00/0x01 depending on IRQ4/main-thread interleaving.
  // Binary references: writers @ 0x17aa, 0x1b82 (both in FUN_FA0).
  r[0x14] = mainLoopWaitSnapshot === true ? 1 : r[0x11] ?? 0;
  if (mainLoopWaitSnapshot !== undefined) {
    r[0x39a] = mainLoopWaitSnapshot ? 1 : 0;
  }
  const rngSeed = raw(state.rng.seed) & 0xffff;
  r[0x3a6] = (rngSeed >>> 8) & 0xff;
  r[0x3a7] = rngSeed & 0xff;
  const deferNewPlayableMode0Reset =
    state.clock.mode0Init11452Stage !== undefined &&
    !asyncInitActiveAtTickStart &&
    mode0Segment === 2 &&
    readWorkWord(state, 0x394) === 1;
  if (!deferNewPlayableMode0Reset) {
    advanceMode0Init11452Async(state, rom);
  }
  if (highScoreInitialsEntryActive(state)) {
    const initialsEntryOptions: Parameters<typeof advanceHighScoreInitialsEntry>[1] = {
      buttons: state.input.buttons,
      afterRegisterScore: (renderState, _objectAddr, _rank, _recordAddr, registerResult) => {
        if (registerResult === -1) return;
        helper11FF8Default(renderState, rom);
        startMode2Init11452Async(renderState);
      },
    };
    if (opts.p1X !== undefined) initialsEntryOptions.p1X = opts.p1X;
    if (opts.p1Y !== undefined) initialsEntryOptions.p1Y = opts.p1Y;
    const result = advanceHighScoreInitialsEntry(state, initialsEntryOptions);
    if (result.changed) {
      // Keep the visible table/header refreshed while the DOM overlay shows
      // the editable record.
      helper11FF8Default(state, rom);
    }
  }
  advanceMode2Init11452Async(state, rom);
  if (state.clock.mode2BottomHudDelay !== undefined) {
    if (state.clock.mode2BottomHudDelay > 0) {
      state.clock.mode2BottomHudDelay = as_u8(state.clock.mode2BottomHudDelay - 1);
    } else {
      levelFractionRender28232Default(state, rom);
      state.clock.mode2BottomHudDelay = undefined;
    }
  }
  if (state.clock.mode2TilemapBlitDelay !== undefined) {
    if (state.clock.mode2TilemapBlitDelay > 0) {
      state.clock.mode2TilemapBlitDelay = as_u8(state.clock.mode2TilemapBlitDelay - 1);
    } else {
      tilemapBlit17044(rom, state.playfieldRam);
      state.clock.mode2TilemapBlitDelay = undefined;
    }
  }
  if (state.clock.mainThreadWaitDelay !== undefined) {
    if (state.clock.mainThreadWaitDelay > 0) {
      state.workRam[0x16] = 0;
      state.workRam[0x3f0] = ((state.workRam[0x3f0] ?? 0) + 1) & 0xff;
      state.clock.mainThreadWaitDelay = as_u16(state.clock.mainThreadWaitDelay - 1);
    } else {
      if (state.clock.mainThreadWaitClearRows !== undefined) {
        clearAlphaRows(state, rom, state.clock.mainThreadWaitClearRows);
        state.clock.mainThreadWaitClearRows = undefined;
      }
      state.clock.mainThreadWaitDelay = undefined;
    }
  }
  runWarmResidualReplayTick(state);
  advanceLevelIntroBannerResume(state, rom, (timerPtr, idx) => renderTimerHud286EE(state, rom, timerPtr, idx));
}
