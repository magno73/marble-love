/**
 * mode2-init-11452-async.ts — staged runtime model for FUN_11452 mode 2.
 *
 * The real 68010 main thread enters FUN_11452 when the attract/gameplay
 * sub-mode advances to 2, then spends several vblanks inside the reset path.
 * A synchronous TS call writes the 0x40075A timer too early and misses the
 * frame where MAME has already cleared video RAM but has not reached the
 * timer write yet. This helper preserves the visible frame cadence.
 */

import type { GameState } from "./state.js";
import type { RomImage } from "./bus.js";
import { as_u8, as_u16 } from "./wrap.js";
import { vblankAck28DEA, clearPaletteRam121A6 } from "./vblank-helpers.js";
import { clearPlayfieldRam12174 } from "./clear-playfield-ram-12174.js";
import { initFnPointers28580 } from "./init-fn-pointers-28580.js";
import { sceneObjInit28CA6Default } from "./scene-obj-init-28ca6.js";
import { lateGameLogic26F3E } from "./late-game-logic-26f3e.js";
import { gameStateBanner26B2A } from "./game-state-banner-26b2a.js";
import { bannerHelper26B66 } from "./banner-helper-26b66.js";
import { helper11FF8Default } from "./helper-11ff8.js";
import { tilemapBlit17044 } from "./tilemap-blit-17044.js";
import { finalize11654 } from "./finalize-11654.js";
import { particleInit18CD2 } from "./particle-init-18cd2.js";
import { slotInsertSorted18E6C } from "./slot-insert-sorted-18e6c.js";
import { stateSub2572 } from "./state-sub-2572.js";
import { gameModePrep10456 } from "./game-mode-prep-10456.js";
import { levelDispatcher16EC6 } from "./level-dispatcher-16ec6.js";
import { mainLoopInit10504 } from "./main-loop-init-10504.js";
import { buildTilemapRows1A444, buildTilemapRows1A444ChunkPhase } from "./tilemap-row-build-1a444.js";
import { levelInit16F6C } from "./level-init-16f6c.js";
import { decodeBitstream1A668 } from "./decode-bitstream-1a668.js";
import { randomMod13A98 } from "./random-mod-13a98.js";
import { hudFrameInit283C2 } from "./hud-frame-init-283c2.js";
import { renderString286EE } from "./render-string-286ee.js";
import { renderStringChain3520 } from "./render-string-chain-3520.js";
import { formatNumber3874 } from "./string-format.js";

const WRAM = 0x00400000;
const MODE0_LEVEL_PREFIX_ROWS = 18;
const MODE2_PARTICLE_RNG_CATCHUP = 47;

function off(addr: number): number {
  return addr - WRAM;
}

function wb(state: GameState, addr: number, value: number): void {
  state.workRam[off(addr)] = value & 0xff;
}

function rw(state: GameState, addr: number): number {
  return (((state.workRam[off(addr)] ?? 0) << 8) | (state.workRam[off(addr) + 1] ?? 0)) & 0xffff;
}

function ww(state: GameState, addr: number, value: number): void {
  state.workRam[off(addr)] = (value >>> 8) & 0xff;
  state.workRam[off(addr) + 1] = value & 0xff;
}

function wl(state: GameState, addr: number, value: number): void {
  state.workRam[off(addr)] = (value >>> 24) & 0xff;
  state.workRam[off(addr) + 1] = (value >>> 16) & 0xff;
  state.workRam[off(addr) + 2] = (value >>> 8) & 0xff;
  state.workRam[off(addr) + 3] = value & 0xff;
}

function rb(state: GameState, addr: number): number {
  return state.workRam[off(addr)] ?? 0;
}

function addByte(state: GameState, addr: number, value: number): void {
  wb(state, addr, rb(state, addr) + value);
}

function readRomLong(rom: RomImage, addr: number): number {
  return ((((rom.program[addr] ?? 0) << 24) | ((rom.program[addr + 1] ?? 0) << 16) |
    ((rom.program[addr + 2] ?? 0) << 8) | (rom.program[addr + 3] ?? 0)) >>> 0);
}

function clearAlphaWords(state: GameState, startWord: number, endWord: number): void {
  const start = Math.max(0, startWord) * 2;
  const end = Math.min(0x780, endWord) * 2;
  state.alphaRam.fill(0, start, end);
}

function setMode0VblankSnapshot(state: GameState, stage: number): void {
  const segment = rb(state, 0x004003e4);
  const useLongVisibleCounter =
    (segment === 3 && stage <= 92) ||
    (segment === 5 && stage <= 90);
  if (stage >= 70 && !useLongVisibleCounter) {
    const pulse = stage & 1;
    wb(state, 0x00400014, pulse);
    wb(state, 0x00400016, 0);
    if (segment !== 3 || stage >= 91) {
      wb(state, 0x0040039a, pulse);
    }
    return;
  }
  const visibleStage = (stage + 1) & 0xff;
  wb(state, 0x00400014, visibleStage);
  if (visibleStage < 5) {
    wb(state, 0x00400016, visibleStage);
  } else if (useLongVisibleCounter) {
    wb(state, 0x00400016, (visibleStage - 5) & 0xff);
  } else if (visibleStage >= 0x40) {
    wb(state, 0x00400016, visibleStage <= 0x42 ? visibleStage - 0x40 : 0);
  } else {
    wb(state, 0x00400016, (visibleStage - 5) & 0xff);
  }
}

function renderMode0PresentationTimer(state: GameState, rom: RomImage): void {
  renderString286EE(state, rom, 0x00400082, 0, {
    numberFormatter: (st, value, bufEnd, fmtMode, width, fillExtra) => {
      formatNumber3874(st, value, bufEnd, fmtMode, width, fillExtra);
    },
    renderStringChain2: (entryPtr, attrLong) => {
      renderStringChain3520(state, rom, entryPtr, attrLong);
    },
  });
}

function updateMode0PresentationTimer(state: GameState, rom: RomImage, stage: number): void {
  const segment = rb(state, 0x004003e4);
  let startStage: number | undefined;
  if (segment === 2) startStage = 65;
  if (segment === 3) startStage = 103;
  if (segment === 5) startStage = 101;
  if (startStage === undefined || stage < startStage) return;

  const seconds = Math.max(0, 60 - Math.floor((stage - startStage) / 60));
  ww(state, 0x00400082, seconds);
  renderMode0PresentationTimer(state, rom);
}

function rebuildMode0LevelPrefix(state: GameState, rom: RomImage, chunks: number): void {
  levelDispatcher16EC6(state, rom, { fun_1a444: () => undefined });
  buildTilemapRows1A444(state, rom, undefined, { maxOuterChunks: chunks });
}

function decodeMode0LevelRowsPrefix(state: GameState, rom: RomImage, rows: number): void {
  let row = 0;
  levelInit16F6C(state, rom, {
    fun_1a668: (outAbs, ctrlAbs, extAbs) => {
      if (row < rows) {
        decodeBitstream1A668(state, rom, outAbs, ctrlAbs, extAbs);
      }
      row++;
    },
  });
}

function usesMode0TilemapChunkPhases(state: GameState): boolean {
  return rb(state, 0x004003e4) >= 2;
}

type TilemapChunkPhase = { ad54Count: number; aa38Count: number; packRows?: number };

const MODE0_SEG4_CHUNK2_PHASES = new Map<number, TilemapChunkPhase>([
  [13, { ad54Count: 12, aa38Count: 0 }],
  [14, { ad54Count: 17, aa38Count: 0 }],
  [15, { ad54Count: 23, aa38Count: 0 }],
  [16, { ad54Count: 30, aa38Count: 0 }],
  [17, { ad54Count: 42, aa38Count: 0 }],
  [18, { ad54Count: 66, aa38Count: 3 }],
  [19, { ad54Count: 66, aa38Count: 7 }],
  [20, { ad54Count: 66, aa38Count: 11 }],
  [21, { ad54Count: 66, aa38Count: 15 }],
  [22, { ad54Count: 66, aa38Count: 19 }],
  [23, { ad54Count: 66, aa38Count: 23 }],
]);

const MODE0_SEG4_CHUNK3_PHASES = new Map<number, TilemapChunkPhase>([
  [24, { ad54Count: 21, aa38Count: 0 }],
  [25, { ad54Count: 40, aa38Count: 0 }],
  [26, { ad54Count: 43, aa38Count: 0 }],
  [27, { ad54Count: 65, aa38Count: 0 }],
  [28, { ad54Count: 66, aa38Count: 6 }],
  [29, { ad54Count: 66, aa38Count: 10 }],
  [30, { ad54Count: 66, aa38Count: 15 }],
  [31, { ad54Count: 66, aa38Count: 20 }],
  [32, { ad54Count: 66, aa38Count: 25, packRows: 2 }],
]);

const MODE0_SEG4_CHUNK4_PHASES = new Map<number, TilemapChunkPhase>([
  [33, { ad54Count: 38, aa38Count: 0 }],
  [34, { ad54Count: 45, aa38Count: 0 }],
  [35, { ad54Count: 48, aa38Count: 0 }],
  [36, { ad54Count: 54, aa38Count: 0 }],
  [37, { ad54Count: 59, aa38Count: 0 }],
  [38, { ad54Count: 66, aa38Count: 2 }],
  [39, { ad54Count: 66, aa38Count: 6 }],
  [40, { ad54Count: 66, aa38Count: 11 }],
  [41, { ad54Count: 66, aa38Count: 15 }],
  [42, { ad54Count: 66, aa38Count: 20 }],
  [43, { ad54Count: 66, aa38Count: 24 }],
]);

const MODE0_SEG4_CHUNK5_PHASES = new Map<number, TilemapChunkPhase>([
  [44, { ad54Count: 37, aa38Count: 0 }],
  [45, { ad54Count: 49, aa38Count: 0 }],
  [46, { ad54Count: 55, aa38Count: 0 }],
  [47, { ad54Count: 62, aa38Count: 0 }],
  [48, { ad54Count: 66, aa38Count: 1 }],
  [49, { ad54Count: 66, aa38Count: 6 }],
  [50, { ad54Count: 66, aa38Count: 11 }],
  [51, { ad54Count: 66, aa38Count: 16 }],
  [52, { ad54Count: 66, aa38Count: 21 }],
  [53, { ad54Count: 66, aa38Count: 24 }],
]);

export function startMode2Init11452Async(state: GameState): void {
  wb(state, 0x00400460, 0xff);
  state.clock.mode2Init11452Stage = as_u8(0);
}

export function startMode0Init11452Async(state: GameState): void {
  wb(state, 0x00400460, 0xff);
  wb(state, 0x004003e2, 0);
  state.clock.mode0Init11452Stage = as_u16(0);
}

export function advanceMode0Init11452Async(state: GameState, rom: RomImage): void {
  const stage = state.clock.mode0Init11452Stage;
  if (stage === undefined) return;
  setMode0VblankSnapshot(state, stage);
  updateMode0PresentationTimer(state, rom, stage);
  // The second attract cycle reaches the mode2 reset much sooner than the
  // first long dwell; dense MAME f15367..f15379 exposes this short bridge.
  if (rb(state, 0x004003e4) === 3 && stage >= 849 && stage <= 853) {
    switch (stage) {
      case 849:
        ww(state, 0x0040075a, 1);
        state.clock.mode0Init11452Stage = as_u16(850);
        return;

      case 850:
        state.clock.mode0Init11452Stage = as_u16(851);
        return;

      case 851:
        ww(state, 0x00400392, 1);
        state.clock.mode0Init11452Stage = as_u16(852);
        return;

      case 852:
        ww(state, 0x00400392, 1);
        state.clock.mode0Init11452Stage = as_u16(853);
        return;

      case 853:
        finalize11654(state, rom);
        ww(state, 0x004003ae, rw(state, 0x004003ae) ^ 0x0008);
        ww(state, 0x004003b0, rw(state, 0x004003ae));
        ww(state, 0x0040075a, 0);
        ww(state, 0x00400392, 2);
        startMode2Init11452Async(state);
        state.clock.mode0Init11452Stage = undefined;
        return;
    }
  }

  switch (stage) {
    case 0:
      vblankAck28DEA(state);
      clearPaletteRam121A6(state);
      clearPlayfieldRam12174(state);
      clearAlphaWords(state, 0, 1183);
      initFnPointers28580(state, rom);
      state.clock.mode0Init11452Stage = as_u16(1);
      return;

    case 1:
      clearAlphaWords(state, 1183, 0x780);
      state.clock.mode0Init11452Stage = as_u16(2);
      return;

    case 2:
      sceneObjInit28CA6Default(state, rom, {
        fun_26f3e: (s) => lateGameLogic26F3E(s, rom),
        fun_28dea: vblankAck28DEA,
      });
      state.clock.mode0Init11452Stage = as_u16(3);
      return;

    case 3:
    case 4:
      state.clock.mode0Init11452Stage = as_u16(stage + 1);
      return;

    case 5: {
      addByte(state, 0x004003e4, 1);
      if (rb(state, 0x004003e4) > 7) {
        ww(state, 0x00400392, 3);
        wb(state, 0x004003e4, 0);
        finalize11654(state, rom);
        state.clock.mode0Init11452Stage = undefined;
        return;
      }

      ww(state, 0x0040075a, 0);
      ww(state, 0x00400394, rw(state, 0x00400394) ^ 1);
      const gameMode = rw(state, 0x00400394);
      wl(state, 0x00400446, readRomLong(rom, 0x0001d364 + gameMode * 4));
      ww(state, 0x00400396, 1);
      gameModePrep10456(state);
      if (rb(state, 0x004003e4) >= 4) {
        ww(state, 0x004003ae, rw(state, 0x004003ae) ^ 0x0008);
        ww(state, 0x004003b0, rw(state, 0x004003ae));
      }
      state.clock.mode0Init11452Stage = as_u16(6);
      return;
    }

    case 6:
    case 7:
    case 8:
    case 9:
      state.clock.mode0Init11452Stage = as_u16(stage + 1);
      return;

    case 10:
      // Segment 5 leaves raw 1AD54 scratch visible before the delayed PF rebuild.
      if (rb(state, 0x004003e4) === 5) {
        levelDispatcher16EC6(state, rom, { fun_1a444: () => undefined });
        buildTilemapRows1A444ChunkPhase(state, rom, 0, { ad54Count: 79, aa38Count: 2 });
      }
      state.clock.mode0Init11452Stage = as_u16(stage + 1);
      return;

    case 11:
      if (rb(state, 0x004003e4) === 4) {
        // MAME starts segment 4's tile build before the later generic stage-13 prefix.
        levelDispatcher16EC6(state, rom, { fun_1a444: () => undefined });
        buildTilemapRows1A444ChunkPhase(state, rom, 0, { ad54Count: 66, aa38Count: 18 });
      }
      state.clock.mode0Init11452Stage = as_u16(stage + 1);
      return;

    case 12:
      if (rb(state, 0x004003e4) >= 3) {
        if (rb(state, 0x004003e4) === 3) {
          levelDispatcher16EC6(state, rom, { fun_1a444: () => undefined });
          buildTilemapRows1A444ChunkPhase(state, rom, 0, { ad54Count: 79, aa38Count: 18 });
        }
        state.clock.mode0Init11452Stage = as_u16(13);
        return;
      }
      rebuildMode0LevelPrefix(state, rom, 1);
      state.clock.mode0Init11452Stage = as_u16(13);
      return;

    case 13:
      if (rb(state, 0x004003e4) >= 3) {
        rebuildMode0LevelPrefix(state, rom, 1);
        buildTilemapRows1A444ChunkPhase(state, rom, 1, MODE0_SEG4_CHUNK2_PHASES.get(stage)!);
        state.clock.mode0Init11452Stage = as_u16(14);
        return;
      }
      if (usesMode0TilemapChunkPhases(state)) {
        buildTilemapRows1A444ChunkPhase(state, rom, 1, MODE0_SEG4_CHUNK2_PHASES.get(stage)!);
      }
      state.clock.mode0Init11452Stage = as_u16(14);
      return;

    case 14:
    case 15:
    case 16:
    case 17:
    case 18:
    case 19:
    case 20:
    case 21:
    case 22:
    case 23: {
      const phase = usesMode0TilemapChunkPhases(state) ? MODE0_SEG4_CHUNK2_PHASES.get(stage) : undefined;
      if (phase !== undefined) buildTilemapRows1A444ChunkPhase(state, rom, 1, phase);
      state.clock.mode0Init11452Stage = as_u16(stage + 1);
      return;
    }

    case 24:
      if (usesMode0TilemapChunkPhases(state)) {
        rebuildMode0LevelPrefix(state, rom, 2);
        buildTilemapRows1A444ChunkPhase(state, rom, 2, MODE0_SEG4_CHUNK3_PHASES.get(stage)!);
        state.clock.mode0Init11452Stage = as_u16(25);
        return;
      }
      rebuildMode0LevelPrefix(state, rom, 2);
      state.clock.mode0Init11452Stage = as_u16(25);
      return;

    case 25:
    case 26:
    case 27:
    case 28:
    case 29:
    case 30:
    case 31:
    case 32: {
      const phase = usesMode0TilemapChunkPhases(state) ? MODE0_SEG4_CHUNK3_PHASES.get(stage) : undefined;
      if (phase !== undefined) buildTilemapRows1A444ChunkPhase(state, rom, 2, phase);
      state.clock.mode0Init11452Stage = as_u16(stage + 1);
      return;
    }

    case 33:
      if (usesMode0TilemapChunkPhases(state)) {
        rebuildMode0LevelPrefix(state, rom, 3);
        buildTilemapRows1A444ChunkPhase(state, rom, 3, MODE0_SEG4_CHUNK4_PHASES.get(stage)!);
        state.clock.mode0Init11452Stage = as_u16(34);
        return;
      }
      rebuildMode0LevelPrefix(state, rom, 3);
      state.clock.mode0Init11452Stage = as_u16(34);
      return;

    case 34:
    case 35:
    case 36:
    case 37:
    case 38:
    case 39:
    case 40:
    case 41:
    case 42:
    case 43: {
      const phase = usesMode0TilemapChunkPhases(state) ? MODE0_SEG4_CHUNK4_PHASES.get(stage) : undefined;
      if (phase !== undefined) buildTilemapRows1A444ChunkPhase(state, rom, 3, phase);
      state.clock.mode0Init11452Stage = as_u16(stage + 1);
      return;
    }

    case 44:
      if (usesMode0TilemapChunkPhases(state)) {
        rebuildMode0LevelPrefix(state, rom, 4);
        buildTilemapRows1A444ChunkPhase(state, rom, 4, MODE0_SEG4_CHUNK5_PHASES.get(stage)!);
        state.clock.mode0Init11452Stage = as_u16(45);
        return;
      }
      rebuildMode0LevelPrefix(state, rom, 4);
      state.clock.mode0Init11452Stage = as_u16(45);
      return;

    case 45:
    case 46:
    case 47:
    case 48:
    case 49:
    case 50:
    case 51:
    case 52: {
      const phase = usesMode0TilemapChunkPhases(state) ? MODE0_SEG4_CHUNK5_PHASES.get(stage) : undefined;
      if (phase !== undefined) buildTilemapRows1A444ChunkPhase(state, rom, 4, phase);
      state.clock.mode0Init11452Stage = as_u16(stage + 1);
      return;
    }

    case 53:
      if (usesMode0TilemapChunkPhases(state)) {
        rebuildMode0LevelPrefix(state, rom, 5);
        buildTilemapRows1A444ChunkPhase(state, rom, 4, MODE0_SEG4_CHUNK5_PHASES.get(stage)!);
        state.clock.mode0Init11452Stage = as_u16(54);
        return;
      }
      rebuildMode0LevelPrefix(state, rom, 5);
      state.clock.mode0Init11452Stage = as_u16(54);
      return;

    case 58:
      if (rb(state, 0x004003e4) === 3) {
        buildTilemapRows1A444ChunkPhase(state, rom, 5, { ad54Count: 79, aa38Count: 4 });
        state.clock.mode0Init11452Stage = as_u16(59);
        return;
      }
      if (rb(state, 0x004003e4) === 5) {
        state.clock.mode0Init11452Stage = as_u16(59);
        return;
      }
      rebuildMode0LevelPrefix(state, rom, 8);
      state.clock.mode0Init11452Stage = as_u16(59);
      return;

    case 60:
      if (rb(state, 0x004003e4) === 5) {
        buildTilemapRows1A444ChunkPhase(state, rom, 5, { ad54Count: 52, aa38Count: 0 });
        state.clock.mode0Init11452Stage = as_u16(61);
        return;
      }
      state.clock.mode0Init11452Stage = as_u16(61);
      return;

    case 63:
      if (rb(state, 0x004003e4) === 3 || rb(state, 0x004003e4) === 5) {
        state.clock.mode0Init11452Stage = as_u16(64);
        return;
      }
      // MAME has the first decode rows visible at f12950, one sampled vblank
      // before the full FUN_10504 tail lands at f12960.
      if (rb(state, 0x004003e4) === 2) {
        hudFrameInit283C2(state, rom);
      }
      decodeMode0LevelRowsPrefix(state, rom, MODE0_LEVEL_PREFIX_ROWS);
      state.clock.mode0Init11452Stage = as_u16(64);
      return;

    case 64:
      if (rb(state, 0x004003e4) === 3 || rb(state, 0x004003e4) === 5) {
        state.clock.mode0Init11452Stage = as_u16(65);
        return;
      }
      mainLoopInit10504(state, {}, { runPresentationMiddle: true }, rom);
      state.clock.mode0Init11452Stage = as_u16(65);
      return;

    case 68:
      if (rb(state, 0x004003e4) === 3) {
        rebuildMode0LevelPrefix(state, rom, 8);
        state.clock.mode0Init11452Stage = as_u16(69);
        return;
      }
      if (rb(state, 0x004003e4) === 5) {
        rebuildMode0LevelPrefix(state, rom, 8);
        state.clock.mode0Init11452Stage = as_u16(69);
        return;
      }
      state.clock.mode0Init11452Stage = as_u16(69);
      return;

    case 72:
      if (rb(state, 0x004003e4) === 3) {
        state.clock.mode0Init11452Stage = as_u16(73);
        return;
      }
      state.clock.mode0Init11452Stage = as_u16(73);
      return;

    case 90:
      if (rb(state, 0x004003e4) === 5) {
        mainLoopInit10504(state, {}, { runPresentationMiddle: true }, rom);
        state.colorRam.fill(0);
        ww(state, 0x004003ae, rw(state, 0x004003b0));
        state.clock.mode0Init11452Stage = as_u16(91);
        return;
      }
      state.clock.mode0Init11452Stage = as_u16(91);
      return;

    case 92:
      if (rb(state, 0x004003e4) === 3) {
        mainLoopInit10504(state, {}, { runPresentationMiddle: true }, rom);
        state.colorRam.fill(0);
        wb(state, 0x00400016, 0);
        ww(state, 0x004003ae, rw(state, 0x004003b0));
        state.clock.mode0Init11452Stage = as_u16(93);
        return;
      }
      state.clock.mode0Init11452Stage = as_u16(93);
      return;

    case 100:
      if (rb(state, 0x004003e4) === 5) {
        gameStateBanner26B2A(state, rom, rw(state, 0x00400394));
        state.clock.mode0Init11452Stage = as_u16(101);
        return;
      }
      state.clock.mode0Init11452Stage = as_u16(101);
      return;

    case 102:
      if (rb(state, 0x004003e4) === 3) {
        gameStateBanner26B2A(state, rom, rw(state, 0x00400394));
        state.clock.mode0Init11452Stage = as_u16(103);
        return;
      }
      state.clock.mode0Init11452Stage = as_u16(103);
      return;

    case 1022:
      // Long demo attract handoff: MAME parks the main-thread body, exposes
      // mode 1 for two vblanks, then arms the mode2 reset. Keeping these
      // frames staged prevents the mode0 object/scroll body from running two
      // extra times before the reset path starts.
      ww(state, 0x00400392, 1);
      state.clock.mode0Init11452Stage = as_u16(1023);
      return;

    case 1023:
      ww(state, 0x00400392, 1);
      state.clock.mode0Init11452Stage = as_u16(1024);
      return;

    case 1024:
      finalize11654(state, rom);
      // Park the AV page as the real 117B2/28788 interleave does immediately
      // before the mode-2 reset. Without this latch the following particle
      // pass emits into the opposite sprite page.
      ww(state, 0x004003ae, rw(state, 0x004003ae) ^ 0x0008);
      ww(state, 0x004003b0, rw(state, 0x004003ae));
      ww(state, 0x0040075a, 0);
      ww(state, 0x00400392, 2);
      startMode2Init11452Async(state);
      state.clock.mode0Init11452Stage = undefined;
      return;

    default:
      state.clock.mode0Init11452Stage = as_u16(stage + 1);
      return;
  }
}

export function advanceMode2Init11452Async(state: GameState, rom: RomImage): void {
  const stage = state.clock.mode2Init11452Stage;
  if (stage === undefined) return;
  if (stage >= 1) {
    wb(state, 0x00400014, stage);
  }

  switch (stage) {
    case 0:
      // Entry frame already performed the 11452 prefix and mode write.
      state.clock.mode2Init11452Stage = as_u8(1);
      return;

    case 1:
      clearPaletteRam121A6(state);
      clearPlayfieldRam12174(state);
      clearAlphaWords(state, 0, 1183);
      initFnPointers28580(state, rom);
      state.clock.mode2Init11452Stage = as_u8(2);
      return;

    case 2:
      clearAlphaWords(state, 1183, 0x780);
      state.clock.mode2Init11452Stage = as_u8(3);
      return;

    case 3:
      state.clock.mode2Init11452Stage = as_u8(stage + 1);
      return;

    case 4:
      sceneObjInit28CA6Default(state, rom, {
        fun_26f3e: (s) => lateGameLogic26F3E(s, rom),
        fun_28dea: vblankAck28DEA,
      });
      state.clock.mode2Init11452Stage = as_u8(5);
      return;

    case 5:
      state.clock.mode2Init11452Stage = as_u8(6);
      return;

    case 6:
      gameStateBanner26B2A(state, rom, 0);
      bannerHelper26B66(state, 0x13);
      ww(state, 0x00400000, 0);
      ww(state, 0x00400002, 0);
      wb(state, 0x00400008, 0);
      wb(state, 0x00400006, 0);
      wb(state, 0x0040000a, 0);
      vblankAck28DEA(state);
      state.clock.mode2Init11452Stage = as_u8(7);
      return;

    case 7:
      if (rb(state, 0x004003e4) !== 1) {
        for (let i = 0; i < MODE2_PARTICLE_RNG_CATCHUP; i++) randomMod13A98(state, 0x100);
      }
      particleInit18CD2(state, 3, 0xfe, {
        fun_18e6c: (s, typeCode, subIdx) => {
          slotInsertSorted18E6C(s, rom, typeCode, subIdx);
        },
      });
      helper11FF8Default(state, rom);
      state.clock.mode2Init11452Stage = as_u8(8);
      return;

    default:
      lateGameLogic26F3E(state, rom);
      tilemapBlit17044(rom, state.playfieldRam);
      ww(state, 0x0040075a, 0x012c);
      if (rb(state, 0x004003e6) !== 0) wb(state, 0x004003e6, 0);
      finalize11654(state, rom, {
        renderString0142: (s, textPtr, tileBase) => {
          stateSub2572(s, rom, textPtr, tileBase);
        },
      });
      state.clock.mode2Init11452Stage = undefined;
      state.clock.mode2BottomHudDelay = rb(state, 0x004003e4) === 1 ? as_u8(1) : undefined;
      return;
  }
}
