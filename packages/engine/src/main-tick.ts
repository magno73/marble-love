/**
 * main-tick.ts — orchestrator del game tick principale.
 *
 * Replica la struttura di chiamata di `FUN_00028788` (= IRQ4 vblank handler
 * che il binario invoca ogni frame @ 60 Hz). Ordine identico al binario;
 * le sub-functions ancora non replicate sono stubbed come no-op (con flag
 * opzionali per iniettare callback in futuro).
 *
 * Sub chiamate dal binario (in ordine):
 *   1. paletteAnim1Tick (FUN_26BEE) ✅
 *   2. paletteAnim2Tick (FUN_26C78) ✅
 *   3. paletteAnim3Tick (FUN_26D4E) ✅
 *   4. paletteQueueDrain (FUN_26B88) ✅
 *   5. gameStateMachineTick (FUN_2E18 via thunk 0x148) ✅ tutti 10 subs wirati
 *   6. soundTick (FUN_4CA0 via thunk 0x15A) ✅ (FUN_4DCC chip ancora minimal-stub)
 *   7. gameTickTimers (FUN_28A96) ✅
 *   8. trackballInputTick (FUN_1AC18) ✅
 *   9. gameMainGate (FUN_28972) ✅
 *   10. auxTimer (FUN_10146) ✅
 *   11. eepromCommit (FUN_3F78 via thunk 0x160) ✅
 *   12. soundCommand (FUN_158AC) — emessa dalle subs replicate via hook audio
 *   13. specialAttract (FUN_288F8) ✅
 *   14. particleBounce (FUN_18DCA) ✅ (conditional su *0x4003E2)
 *   15. lateGameLogic (FUN_26F3E) — chiamata dopo mainLoopInit1101E quando
 *       runMainLoopBody=true. Pipeline sprite RAM emit (workRam obj → spriteRam
 *       MO entry per-frame). Replica struttura di mainLoop117B2LoopBody.
 *
 * Più condizionale FUN_26D8A (PF scroll setup) all'inizio.
 *
 * **Side effect**: aggiorna workRam, colorRam, alphaRam, spriteRam coerentemente
 * col binario. `render.buildFrame(state)` può poi consumare lo state per
 * produrre un Frame valido.
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
import { trackballInputTick } from "./trackball-input.js";
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
import { helper11FF8Default } from "./helper-11ff8.js";

export interface MainTickInputs {
  /** Trackball delta player 1 X (signed byte). */
  p1X?: number;
  /** Trackball delta player 1 Y (signed byte). */
  p1Y?: number;
  /** Trackball delta player 2 X (signed byte). */
  p2X?: number;
  /** Trackball delta player 2 Y (signed byte). */
  p2Y?: number;
  /**
   * MMIO byte @ 0xF60001 letto da gameMainGate (default 0x6F = attract
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
  /** Skip frame counter increment (utile per test deterministici). */
  skipFrameCounter?: boolean;
  /** Sub-functions stub di FUN_4CA0 sound dispatcher (FUN_3E1A, FUN_4DCC, FUN_4C3E). */
  soundSubs?: SoundTickSubs;
  /**
   * Se true, dopo mainTick chiama anche `mainLoopInit1101E(state, rom)` per
   * far avanzare il dispatcher state machine `*0x400390`. Nel binario questo
   * gira sul main thread (FUN_117B2 loop), separato dall'IRQ4 vblank.
   * Approssima il game-loop body run per gameplay simulation. Default OFF
   * (preserva parity vs MAME oracle).
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
 * Esegue un tick di gioco completo (= 1 frame @ 60 Hz).
 *
 * Replica l'ordine di chiamata del binario `FUN_00028788`. Le funzioni
 * non ancora replicate sono no-op: i loro side effect (sound, eeprom)
 * non avvengono ma il game state core si aggiorna correttamente.
 *
 * Per renderer hookup: chiamare `mainTick(state, {rom})` ogni frame, poi
 * `buildFrame(state, options)` dal modulo `render.ts` per ottenere un Frame
 * consumabile dal renderer PixiJS.
 */
export function mainTick(state: GameState, opts: MainTickOptions): void {
  const r = state.workRam;
  const rom = opts.rom;

  // ─── Preambolo IRQ4 (replica FUN_00010116) ───────────────────────────────
  // Nota: l'IRQ4 handler fa ADDQ.B #1 su 0x400016 (mailbox vblank) e 0x400014.
  // Tuttavia entrambi vengono *sovrascritti* durante il body:
  //   - 0x400016 azzerato da FUN_28DEA (vblankAck) ad ogni invocazione
  //   - 0x400014 sovrascritto da subs a 0x17aa/0x1b82 (move.w 0x400010 → 0x400014)
  // Il valore finale al frame_done MAME riflette quei sovrascrivimenti, non
  // l'incremento IRQ. Replicare l'incremento qui produce drift cumulativo →
  // skip e lascia che le sub corrette gestiscano i due offset.
  if (!opts.skipFrameCounter) {
    state.clock.frame = ((state.clock.frame + 1) >>> 0) as typeof state.clock.frame;
  }
  const asyncInitActiveAtTickStart =
    state.clock.mode2Init11452Stage !== undefined ||
    state.clock.mode2BottomHudDelay !== undefined ||
    state.clock.mode0Init11452Stage !== undefined ||
    state.clock.mainThreadWaitDelay !== undefined ||
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

  // Default state-machine subs: chiama le sub replicate. 10/10 subs
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

  // FUN_4CA0 (sound dispatcher wrapper, replicato).
  // Sub FUN_3E1A e FUN_4C3E ora replicate bit-perfect; FUN_4DCC ancora STUB
  // (richiede emulare YM2151). Default subs: chiama le replicate.
  const soundSubs: SoundTickSubs = opts.soundSubs ?? {
    fun_3e1a: (argLong) => soundDispatchSend(state, rom, argLong),
    fun_4c3e: (st, d0, a0) => soundStatusCheck(st, d0, a0),
    // fun_4dcc: undefined → soundTick usa default mini-stub (counter increment)
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

  // Default = 0xff (= MMIO trackball stable @ no-input in MAME) per evitare
  // delta spurious al primo tick: cur=0 vs prev=0xff produrrebbe delta=1
  // e scriverebbe 01 01 00 00 a obj1[+0xc6..0xc9] (= workRam[0x1c0..0x1c3]
  // per slot 7 / obj P2). Verificato vs MAME oracle frame 2401.
  trackballInputTick(
    state,
    opts.p1X ?? 0xff,
    opts.p1Y ?? 0xff,
    opts.p2X ?? 0xff,
    opts.p2Y ?? 0xff,
  );

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

  // FUN_10146 (aux timer/byte queue drain) — REPLICATO
  auxTimer(state);

  // FUN_3F78 (sound pacing pseudo-eeprom) — REPLICATO
  eepromCommit(state);

  // FUN_158AC (sound cmd send) — non è una chiamata diretta qui: viene inviata
  // dalle subs replicate cablate sotto via `soundCmdSend158AC`.

  // FUN_288F8 (special attract / end-screen sound) — REPLICATO
  specialAttract(state, {
    soundCommand: (cmd) => { soundCmdSend158AC(state, cmd); },
  });

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
  // ─── Game-tick gating dinamico 30/60Hz ────────────────────────────────
  // Il main thread (`FUN_117B2`, ROM 0x117B2..0x118CE) NON gira ogni vsync.
  // Dopo `jsr 0x26f3e` (lateGameLogic, 0x118AA) il loop body fa:
  //   0x118B0  tst.b *0x400016        ; vblank mailbox set by IRQ4
  //   0x118B8  bne  0x118C0
  //   0x118BA  jsr  0x28DEA           ; spin-wait #1 (saltato se mailbox!=0)
  //   0x118C0  move.b #1, *0x40039A
  //   0x118C8  jsr  0x28DEA           ; spin-wait #2 (sempre)
  //   0x118CE  bra  0x11804           ; loop top
  //
  // Path 30Hz (body veloce, *0x400016 == 0 a fine body):
  //   - entra in ENTRAMBE le `jsr 0x28DEA` → 2 vsync di wait → body ogni 2
  //     vsync. Cadenza 30Hz.
  // Path 60Hz (body lento, IRQ4 ha settato *0x400016 = 1 durante il body):
  //   - skip prima `jsr 0x28DEA` → solo 1 vsync di wait → body extra dopo
  //     1 vsync invece di 2 → cadenza 60Hz transitoria.
  //
  // Replica: per ogni tick (= 1 vsync simulato a 60Hz):
  //   - `mainLoopBodyTicks` dispari → tick "wait", skip body, increment.
  //   - `mainLoopBodyTicks` pari → tick "body candidate". Reset cpuTicks,
  //     run body, accumula stime cicli sub. Se cpuTicks > CYCLES_PER_VBLANK:
  //     setta mailbox (workRam[0x16]) = 1, e NON incrementa
  //     mainLoopBodyTicks (resta pari → next tick è ancora body).
  //     Altrimenti incrementa (next tick = wait).
  //
  // Phase warm-state f12000: body già eseguito a f12000, quindi f12001
  // (= primo tick TS) = wait, f12002 = body, ecc. Inizializzazione
  // mainLoopBodyTicks=0 → primo tick è "body" e poi alterna.
  //
  // **Nota cambio convenzione:** prima il gate era `mainLoopBodyTicks & 1 == 0`
  // dopo l'increment (= run a 0, 2, 4...). Ora controlliamo PRIMA del run:
  // even = body, odd = wait. Stessa sequenza di body run (ticks 0,2,4...
  // diventano body), ma il counter è ora 0,1,2,3... lineare con il tick.
  const OFF_VBLANK_MAILBOX = 0x16;
  let mainLoopWaitSnapshot: boolean | undefined;
  if (opts.runMainLoopBody === true && !mainThreadBlockedAtTickStart) {
    // Increment first (matches previous TS convention: warm-state assumed
    // mainLoopBodyTicks=0 → first tick post-warm gets value 1 → ODD = wait,
    // second tick gets 2 → EVEN = body candidate). Phase verificata vs
    // MAME warm-state f12000: body già stato eseguito a f12000, quindi
    // primo TS tick (= f12001) = WAIT, secondo (= f12002) = BODY.
    //
    // NOTA (Rule 12): tentativo di phase-flip a "tick 1 = BODY" basato su
    // osservazione "rect bbox cambia tra MAME f+0 e f+1" e' stato rolled
    // back. Dati: 50 body in 99 tick vs MAME 49 in 100 frame (= TS avanti
    // di 1 step). Drift gameplay 215 → 270, obj0.x diverge a f+99.
    // MAME aggiorna sub di tipi diversi in frame diversi (rect a dispari,
    // obj0.x a pari) — non e' phase mismatch unico, e' artefatto di
    // timing snapshot intra-frame.
    state.clock.mainLoopBodyTicks = ((state.clock.mainLoopBodyTicks + 1) >>> 0) as typeof state.clock.mainLoopBodyTicks;
    const tickIsBody = (state.clock.mainLoopBodyTicks & 1) === 0;
    mainLoopWaitSnapshot = !tickIsBody;
    if (!tickIsBody) {
      // tick "wait" (corrisponde a uno dei due spin-wait MAME).
      // No-op: nessun body, mainLoopBodyTicks già incrementato sopra.
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
      // tick "body candidate": replica della sequenza FUN_117B2.
      // clr.b (mailbox) — IRQ4 simulato la setterà se cpuTicks > vblank.
      r[OFF_VBLANK_MAILBOX] = 0;
      resetCpuCycles(state);

      // Body run: mainLoopInit1101E (dispatcher) + lateGameLogic26F3E.
      // Accumula overhead noti; il body delle sub è contato in refreshFrame10FCE.
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
      // FUN_26F3E (lateGameLogic) — chain MAME canonical, post-body.
      // Stima fast in attract (*0x3E2 == 0) vs full in gameplay.
      const fun26F3EKey = (r[0x3e2] ?? 0) === 0 ? "FUN_26F3E_FAST" : "FUN_26F3E";
      addCpuCycles(state, SUB_CYCLE_ESTIMATE[fun26F3EKey] ?? as_u32(2200));
      lateGameLogic26F3E(state, rom);

      // tst.b *0x400016: IRQ4 mailbox set durante body? Settata se cpuTicks
      // ha sforato un vblank intero (body lento → IRQ4 firato durante body).
      // In quel caso, MAME esegue un body extra (skip primo spin-wait).
      // Per replicare: decrementiamo il counter così il prossimo tick
      // sarà di nuovo "even" → body extra.
      if (raw(state.clock.cpuTicks) > raw(CYCLES_PER_VBLANK)) {
        r[OFF_VBLANK_MAILBOX] = 1;
        // Riporta il counter PRIMA dell'increment → prossimo tick: counter
        // viene riportato a "even" (body) invece di "odd" (wait).
        state.clock.mainLoopBodyTicks = ((state.clock.mainLoopBodyTicks - 1) >>> 0) as typeof state.clock.mainLoopBodyTicks;
      }
    }
    // NB: fun_FA0_marbleEmit (= surrogate empirico) RIMOSSO. Il marble si
    // muoverà bit-perfect quando wirate le sub MAME mancanti (helper1BC88
    // per slot_pair update, helper121B8 chain completa per spritePos /
    // spriteRotate, camera projection FUN_FA0 reale). Senza quelle, il
    // marble resta in posizione warm-state (= invisibilmente "fermo")
    // ma niente sprite rotti che girano a caso.
    void fun_FA0_marbleEmit;
  }

  // ─── Main-thread vblank-counter snapshot ────────────────────────────────
  // FUN_FA0 (entry-point main-thread loop) gira asincrono all'IRQ4. Ad ogni
  // sync-vblank esegue:
  //     btst.b #7, *0x400013     ; aspetta vblank
  //     beq    skip
  //     tst.w  (A3); bne loop    ; con timeout
  //     move.w *0x400010, D0     ; legge HIGH-word del long counter @ 0x400010
  //     andi.w #0xff, D0
  //     move.w D0,    *0x400014  ; snapshot low-byte
  // Sovrascrive l'increment-by-1 di IRQ4 (FUN_10116 @ 0x10126). Steady-state
  // attract: `*0x400010` long < 0x10000 → high-word == 0 → *0x400014 = 0x00.
  // Replica come stub minimo (= byte assignment a workRam[0x14]). Verificato
  // vs MAME multi-frame dump (frame 2401..2460: workRam[0x14] alternates
  // 0x00/0x01 in funzione di interleaving IRQ4↔main-thread).
  // Riferimenti binario: writers @ 0x17aa, 0x1b82 (entrambi in FUN_FA0).
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
  advanceLevelIntroBannerResume(state, (timerPtr, idx) => renderTimerHud286EE(state, rom, timerPtr, idx));
}
