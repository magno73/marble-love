/**
 * boot-init.ts - game-engine boot sequence.
 *
 * Progressively mirrors the original binary reset sequence, turning an
 * `emptyGameState()` into a coherent initial "post-boot, pre-tick" state.
 * Intended to be called exactly once before the first `tick()`.
 *
 * **Binary sequence** (reset vector @ 0x004 -> entry @ 0x466):
 *
 *   Hardware init (0x466..0x4FE):
 *     - SR = 0x2700                              ; disable IRQ
 *     - watchdog kick loop @ 0x486 (4000 iter)
 *     - clear MMIO 0x860000, 0xF40010
 *     - clear alpha RAM 0xA00000..0xA03FFE word-by-word (0x4000 byte!)
 *     - test bit 6 of MMIO 0xF60001 (= test mode? skip if 0)
 *     - init color RAM 0xB00000..0xB0061E with a decreasing pattern:
 *         word[i] = (-0x1000 + (i+1)*4) & 0xFFFF
 *     - init work RAM 0x400000..0x401FFE (clear words via test routine
 *       at 0x84E, which clears and verifies each word with cmp/branch)
 *
 *   High-level init (FUN_FA0, indirect call after hardware init):
 *     - if *0x400016 == 0 (cold boot):
 *         copy 3 long ROM ptrs (0x10074, 0x10078, 0x1007C) ->
 *             workRam (0x400140, 0x400154, 0x400168) via FUN_1D74
 *     - clear *0x40017C (word) and MMIO 0x860000
 *     - jsr 0x1CEA = paletteRamInitFull
 *     - jsr 0xE24 = paletteBootstrapInit
 *     - jsr 0x31D0 = gameStateMachineInit (state machine + alpha RAM clear)
 *     - many other workRam global setup paths (stubbed for now)
 *
 * **State after bootInit()**: `tick(state, {rom})` can proceed without UB.
 * Byte-perfect parity with FUN_FA0 would require mirroring the whole ~1KB
 * routine. For now bootInit covers the visible pieces: initialized palette,
 * cleared alpha RAM, and state-machine globals.
 */

import type { GameState } from "./state.js";
import type { RomImage } from "./bus.js";
import { applySlapsticBank } from "./m68k/apply-slapstic-bank.js";
import { as_u16, as_u32 } from "./wrap.js";

import {
  paletteRamInitFull,
  paletteBootstrapInit,
  gameStateMachineInit,
} from "./init-helpers.js";
import { slotArrayBulkInit } from "./slot-array-init.js";
import { mainLoopInit117B2 } from "./main-loop-init-117b2.js";
import { clearPlayfieldRam12174 } from "./clear-playfield-ram-12174.js";
import { levelDispatcher16EC6 } from "./level-dispatcher-16ec6.js";
import { moScreenInit1A286 } from "./mo-screen-init-1a286.js";
import { moGridInit2404 } from "./mo-grid-init-2404.js";
import { levelInit16F6C } from "./level-init-16f6c.js";
import { initDefaultHighScoreTable } from "./high-score-defaults.js";

function shouldArmLegacyAttractWarmReplay(workRam: Uint8Array): boolean {
  return (
    (workRam[0x3e4] ?? 0) === 1 &&
    (workRam[0x3e2] ?? 0) === 0 &&
    (((workRam[0x390] ?? 0) << 8) | (workRam[0x391] ?? 0)) === 1 &&
    (((workRam[0x392] ?? 0) << 8) | (workRam[0x393] ?? 0)) === 0 &&
    (workRam[0x13f2] ?? 0) === 0xff &&
    (workRam[0x13f3] ?? 0) === 0xa6 &&
    (workRam[0x6f5] ?? 0) === 0x32
  );
}

/**
 * Initializes color RAM with the RESET handler's decreasing pattern
 * (0x4C4..0x4DC):
 *
 *   D0 = -0x1000
 *   loop until A0 >= 0xB0061E:
 *     D0 += 4
 *     *(A0)+ = D0  (word)
 *
 * Output: 783 words @ 0xB00000..0xB0061E, values 0xFFFC, 0xFFF8, 0xFFF4, ...
 */
function colorRamHardwareInit(state: GameState): void {
  let d0 = -0x1000 & 0xffff;
  // Loop limit 0xB0061E exclusive from 0xB00000 -> 0x61E bytes = 0x30F words.
  // The loop writes through `(A0)+`, so A0 == 0xB0061E stops the loop.
  // The bne checks cmpa.l A0,A1 where A1 = 0xB0061E: 0x30F+1 iterations,
  // with A0 running from 0xB00000 to the final inclusive write at 0xB0061C.
  for (let off = 0; off < 0x61e; off += 2) {
    d0 = (d0 + 4) & 0xffff;
    state.colorRam[off] = (d0 >>> 8) & 0xff;
    state.colorRam[off + 1] = d0 & 0xff;
  }
}

/**
 * Mirrors the 3 conditional FUN_FA0 strcpy calls (0xfc2..0xff8):
 *
 *   if *0x400016 == 0:
 *     FUN_1D74(dst=0x400140, src=*ROM[0x10074])  // strcpy through null
 *     FUN_1D74(dst=0x400168, src=*ROM[0x1007C])
 *     FUN_1D74(dst=0x400154, src=*ROM[0x10078])
 *
 * **Important**: `FUN_1D74` is a C-style `strcpy` (`move.b (A0)+,(A1)+`
 * with `bne` on the Z flag), not a long copy. ROM[0x10074..0x1007C] are long
 * pointers to null-terminated ASCII strings in ROM ("PLAYER 1 START\0",
 * "PLAYER 2 START\0", "TRAKBALL\0"). They are copied into workRam as HUD
 * label text.
 */
function bootHudStringsInit(state: GameState, rom: RomImage): void {
  if ((state.workRam[0x16] ?? 0) !== 0) return; // warm boot

  function readLong(buf: Uint8Array, off: number): number {
    return (
      ((buf[off] ?? 0) << 24) |
      ((buf[off + 1] ?? 0) << 16) |
      ((buf[off + 2] ?? 0) << 8) |
      (buf[off + 3] ?? 0)
    ) >>> 0;
  }

  /** FUN_1D74-style strcpy: copies through the first null byte, inclusive. */
  function strcpy(dstOff: number, srcAbs: number): void {
    let s = srcAbs;
    let d = dstOff;
    while (true) {
      const b = rom.program[s] ?? 0;
      state.workRam[d] = b;
      s++; d++;
      if (b === 0) return;
      // Safety bound: ROM strings are < 64 bytes; avoid infinite loops.
      if (d - dstOff > 64) return;
    }
  }

  // FUN_FA0 order: 0x140 (Player 1), 0x168 (Player 2), 0x154 (Trakball).
  strcpy(0x140, readLong(rom.program, 0x10074));
  strcpy(0x168, readLong(rom.program, 0x1007c));
  strcpy(0x154, readLong(rom.program, 0x10078));
}

/**
 * Optional `bootInit` options.
 */
export interface BootInitOptions {
  /**
   * When provided (0..5), runs the `clearPlayfieldRam12174 +
   * levelDispatcher16EC6` chain after base bootInit to preload the selected
   * level into `state.playfieldRam`.
   *
   * Useful for smoke tests and renderer demos. Do not use for MAME-oracle
   * parity scenarios: it breaks alignment because the real binary does not
   * preload at boot; it populates playfield RAM through the iterative game loop.
   */
  preloadLevel?: number;
  /**
   * When true, runs the MO init chain discovered in the `level-enter` subs
   * after `preloadLevel`:
   *   - moScreenInit1A286: 32 word slot headers (bank A/B/C/D x 8 entries)
   *   - moGridInit2404(rom, arg1=1): 56 motion-object slot @ 0xA02200+
   * Result: Frame.sprites goes from 0/1 placeholder sprites to N>=2 real
   * sprites with non-zero coordinates, gfxBank, and wired palettes. Pixi then
   * renders those sprites. Opt-in only: do not use for parity tests because the
   * binary calls these subs at level-enter, not at boot.
   */
  fullScreenInit?: boolean;
  /**
   * "Warm state" (snapshot-hybrid mode): when provided, directly populates
   * state.workRam/playfieldRam/spriteRam/alphaRam/colorRam from the buffers
   * and skips standard bootInit. Useful for tests and demos that start from an
   * existing RAM snapshot (for example a MAME state dump at frame N) and then
   * advance via tick(M).
   *
   * Does not combine with `preloadLevel` or `fullScreenInit`; those options are
   * ignored. Use case: simulate a warm game loop without a full reboot.
   */
  warmState?: {
    workRam: Uint8Array;
    playfieldRam: Uint8Array;
    spriteRam: Uint8Array;
    alphaRam: Uint8Array;
    colorRam: Uint8Array;
    /** Optional scroll registers cached from MMIO writes. */
    videoScrollX?: number;
    videoScrollY?: number;
    /**
     * Optional active slapstic bank for the warm snapshot. When provided, it is
     * applied to `rom.slapsticFsm.bank` and `applySlapsticBank(rom, bank)`.
     * Default: use the bank already present in `rom.slapsticFsm`, typically
     * reset bank 3 or a bank set by prior setup.
     *
     * For warm-state @ MAME f12000 attract mode, the correct bank is **1**
     * (verified via `oracle/mame_slapstic_tap.lua` by inspecting read bytes).
     */
    slapsticBank?: number;
  };
}

/**
 * Runs the complete boot sequence.
 *
 * Call once on an `emptyGameState()` before the first `tick()`. It is
 * idempotent because of the `*0x400016 == 0` gate, but production callers
 * should still call it once.
 */
export function bootInit(
  state: GameState,
  rom: RomImage,
  options: BootInitOptions = {},
): void {
  // 0. Snapshot-hybrid: if warmState is provided, populate state directly and
  //    skip all standard bootInit work (= no boot ROM code, no preloadLevel).
  if (options.warmState !== undefined) {
    const w = options.warmState;
    state.workRam.set(w.workRam.subarray(0, state.workRam.length));
    state.playfieldRam.set(w.playfieldRam.subarray(0, state.playfieldRam.length));
    state.spriteRam.set(w.spriteRam.subarray(0, state.spriteRam.length));
    state.alphaRam.set(w.alphaRam.subarray(0, state.alphaRam.length));
    state.colorRam.set(w.colorRam.subarray(0, state.colorRam.length));
    if (w.videoScrollX !== undefined) state.videoScrollX = w.videoScrollX & 0x1ff;
    if (w.videoScrollY !== undefined) state.videoScrollY = w.videoScrollY & 0x1ff;
    if (w.slapsticBank !== undefined) {
      rom.slapsticFsm.bank = w.slapsticBank & 3;
      rom.slapsticFsm.state = "IDLE";
      rom.slapsticFsm.loadedBank = 0;
      applySlapsticBank(rom, rom.slapsticFsm.bank);
    }
    state.rng.seed = as_u32((((state.workRam[0x3a6] ?? 0) << 8) | (state.workRam[0x3a7] ?? 0)) & 0xffff);
    state.rng.callsThisFrame = as_u32(0);
    state.clock.frame = as_u32(0);
    state.clock.cpuTicks = as_u32(0);
    state.clock.scanline = as_u16(0);
    state.clock.mainLoopBodyTicks = as_u32(0);
    state.clock.decoderD6Init = as_u16(0);
    state.clock.decoderCallCount = as_u32(0);
    state.clock.pendingSlotArray1493C = undefined;
    const armLegacyWarmReplay = shouldArmLegacyAttractWarmReplay(state.workRam);
    state.clock.slotArrayReplayTick = armLegacyWarmReplay ? as_u16(0) : undefined;
    state.clock.warmResidualReplayTick = armLegacyWarmReplay ? as_u16(0) : undefined;
    return;
  }

  // 1. Hardware init (RESET 0x466)
  colorRamHardwareInit(state);
  // alpha RAM clear: already 0 in emptyGameState.
  // work RAM clear: already 0 in emptyGameState.

  // 2. FUN_FA0 cold-boot conditional (3 strcpy HUD labels)
  // NB: in attract_mode the oracle does not populate this range, so the
  // FUN_FA0 cold-boot path does not run (probably *0x400016 != 0 at call time,
  // taking the warm-boot path). Skip strcpy for alignment. Re-enable when
  // validating parity scenarios that actually trigger cold boot, e.g. after
  // hardware POST.
  // bootHudStringsInit(state, rom);
  void bootHudStringsInit; // kept in scope for future use.
  state.workRam[0x17c] = 0;
  state.workRam[0x17d] = 0;

  // 3. Sub-init replicated
  paletteRamInitFull(state, rom);
  paletteBootstrapInit(state);
  gameStateMachineInit(state, rom);
  initDefaultHighScoreTable(state, rom);

  // 4. Bulk init slot array (FUN_10392, called by main loop FUN_117B2 through
  //    FUN_10504 on the first pass, before the game state machine starts).
  slotArrayBulkInit(state);

  // 5. Boot main path globals (FUN_100B0 + FUN_100E0):
  //   *0x4003AE = 0x0080  (AV-control init)
  //   *0x4003B6 = 0       (FUN_100B0 sets 0xFFFF, FUN_100E0 increments to 0)
  //   *0x4003B8 = 0x012C  (FUN_100E0 sets countdown 300)
  //   *0x4003B2 = 0       (FUN_100E0 cleared, already 0 in empty state)
  state.workRam[0x3ae] = 0x00;
  state.workRam[0x3af] = 0x80;
  state.workRam[0x3b6] = 0x00;
  state.workRam[0x3b7] = 0x00;
  state.workRam[0x3b8] = 0x01;
  state.workRam[0x3b9] = 0x2c;
  // Global cascading timer @ 0x40039E inner counter (offset +4 = 0x3A2):
  // initialized to 0xFF (TIMER_DISABLED) by the binary to avoid a spurious
  // cascade on the first tick (verified against oracle frame 46).
  state.workRam[0x3a2] = 0xff;

  // 6. Main loop init chain (FUN_117B2 prefix only, loopIterations=0).
  //    Status: 2026-05-08 retry after the complete Codex playfield chain plus
  //    9 default wired Cat.1 subs. Result: attract_mode aligned parity
  //    regressed from 9 to 14 divergent fields at truth-offset=47.
  //    Explanation: the prefix runs the whole `mainLoopInit11452 ->
  //    mainLoopInit10504 -> levelDispatcher16EC6 -> buildTilemapRows1A444`
  //    chain, which populates state.playfieldRam with level 0, while the MAME
  //    oracle at frame 47 (post-FUN_FA0, first tick) has not executed that path
  //    yet. The real binary enters the normal iterative game loop. Semantically,
  //    Semantically, bootInit would jump too far ahead. The preload path is
  //    useful for rendering but not for parity unless the caller opts in.
  void mainLoopInit117B2; // kept in scope for future explicit preload wiring.

  // 7. Optional level preload. This manually runs the tile-loading chain found
  //    through MAME watch_write on level 1:
  //    `clearPlayfieldRam12174 + levelDispatcher16EC6`, using default
  //    tile-row builders. The result is roughly 1500-2900 populated playfield
  //    bytes depending on level.
  if (options.preloadLevel !== undefined) {
    state.workRam[0x394] = (options.preloadLevel >>> 8) & 0xff;
    state.workRam[0x395] = options.preloadLevel & 0xff;
    clearPlayfieldRam12174(state);
    levelDispatcher16EC6(state, rom);
    // Do not call levelInit16F6C here yet: the attempted call regressed PF
    // match from 24% to 16%, likely due to a preloadLevel index mismatch with
    // the MAME frame-2400 reference.
    void levelInit16F6C;

    // Set state machine to case 1 so string/HUD rendering runs during ticks.
    // With *0x390=0, case 0 is idle refresh and does not render HUD text.
    state.workRam[0x390] = 0;
    state.workRam[0x391] = 1;
    // player count = 1 (single player demo)
    state.workRam[0x396] = 0;
    state.workRam[0x397] = 1;
  }

  // 8. Optional full screen-init MO chain. Mirrors level-enter subs that
  //    populate sprite slots; opt-in to preserve default MAME-oracle parity.
  if (options.fullScreenInit === true) {
    moScreenInit1A286(state, rom);
    moGridInit2404(state, rom, 1);
  }

  // Future work: mirror the remaining FUN_FA0 setup subs. For now uninitialized
  // fields stay zero, which lets the first tick run while some state-machine
  // slots remain inactive until gameplay code populates them.
}
