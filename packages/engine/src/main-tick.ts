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
 *   5. gameStateMachineTick (FUN_2E18 via thunk 0x148) ✅
 *   6. soundTick (FUN_4CA0 via thunk 0x15A) — STUB
 *   7. gameTickTimers (FUN_28A96) ✅
 *   8. trackballInputTick (FUN_1AC18) ✅
 *   9. gameMainGate (FUN_28972) ✅
 *   10. eepromCommitTick (FUN_3F78 via thunk 0x160) — STUB
 *   11. soundCommand (FUN_158AC) — STUB
 *   12. specialAttract (FUN_288F8) — STUB
 *   13. particleBounce (FUN_18DCA) ✅ (conditional su *0x4003E2)
 *   14. lateGameLogic (FUN_26F3E) — STUB (conditional)
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
import { soundTick } from "./sound-tick.js";
import type { SoundTickSubs } from "./sound-tick.js";
import { soundDispatchSend } from "./sound-dispatch-send.js";
import { soundStatusCheck } from "./sound-status-check.js";
import { auxTimer } from "./aux-timer.js";
import { specialAttract } from "./special-attract.js";
import { eepromCommit } from "./eeprom-commit.js";
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

/** Frame counter byte @ 0x400014 (incremented dall'IRQ handler in 0x10116). */
const FRAME_COUNTER_LOW_OFF = 0x14;
/** Frame counter byte @ 0x400016 (incremented dall'IRQ handler). */
const FRAME_COUNTER_HIGH_OFF = 0x16;

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
   * MMIO byte @ 0xF60001 letto da gameMainGate (default 0xFC = no buttons
   * pressed, bit 6 set per skip Block C). Bit 6 alto evita spin loop.
   * Verificato vs MAME attract_mode frame 46.
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

  // ─── Preambolo IRQ4 (replica 0x10116) ───────────────────────────────
  if (!opts.skipFrameCounter) {
    r[FRAME_COUNTER_LOW_OFF] = ((r[FRAME_COUNTER_LOW_OFF] ?? 0) + 1) & 0xff;
    r[FRAME_COUNTER_HIGH_OFF] = ((r[FRAME_COUNTER_HIGH_OFF] ?? 0) + 1) & 0xff;
    // state.clock.frame: contatore canonico per trace + debugging.
    state.clock.frame = ((state.clock.frame + 1) >>> 0) as typeof state.clock.frame;
  }

  // ─── FUN_28788 prefix (scroll/MMIO setup) ────────────────────────────
  // Replica 0x28788..0x287D8: incrementer + latch Y target + AV-control.
  mainUpdateScrollSync(state);

  // FUN_26D8A (PF scroll update) — conditional
  if (
    (r[0x08] ?? 0) !== 0 &&
    (r[0x0a] ?? 0) >= 2 &&
    (r[0x14] ?? 0) === 1
  ) {
    pfScrollUpdate(state);
  }

  paletteAnim1Tick(state, rom);
  paletteAnim2Tick(state, rom);
  paletteAnim3Tick(state);
  paletteQueueDrain(state, rom);

  gameStateMachineTick(state, rom, opts.stateMachineSubs);

  // FUN_4CA0 (sound dispatcher wrapper, replicato).
  // Sub FUN_3E1A e FUN_4C3E ora replicate bit-perfect; FUN_4DCC ancora STUB
  // (richiede emulare YM2151). Default subs: chiama le replicate.
  const soundSubs: SoundTickSubs = opts.soundSubs ?? {
    fun_3e1a: (argLong) => soundDispatchSend(state, rom, argLong),
    fun_4c3e: (st, d0, a0) => soundStatusCheck(st, d0, a0),
    // fun_4dcc: undefined → soundTick usa default mini-stub (counter increment)
  };
  soundTick(state, soundSubs);

  gameTickTimers(state, opts.hudCallback);

  trackballInputTick(
    state,
    opts.p1X ?? 0,
    opts.p1Y ?? 0,
    opts.p2X ?? 0,
    opts.p2Y ?? 0,
  );

  const gateOpts: GameMainGateOptions = { mmioInput: opts.inputMmio ?? 0xfc };
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

  // FUN_158AC (sound cmd send) — STUB nel mainTick (chiamato condizionale
  // da altre subs replicate; integra quando integriamo le sound subs).

  // FUN_288F8 (special attract / end-screen sound) — REPLICATO
  specialAttract(state);

  if ((r[0x3e2] ?? 0) !== 0) {
    r[0x3ae] = r[0x3b0] ?? 0;
    r[0x3af] = r[0x3b1] ?? 0;
    particleBounce(state);
    // FUN_26F3E (lateGameLogic) — STUB
  }
}
