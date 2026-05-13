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
import { as_u8 } from "./wrap.js";
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
import { buildTilemapRows1A444 } from "./tilemap-row-build-1a444.js";
import { levelInit16F6C } from "./level-init-16f6c.js";
import { decodeBitstream1A668 } from "./decode-bitstream-1a668.js";

const WRAM = 0x00400000;
const MODE0_LEVEL_PREFIX_ROWS = 18;

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
  if (stage >= 70) {
    const pulse = stage & 1;
    wb(state, 0x00400014, pulse);
    wb(state, 0x00400016, 0);
    wb(state, 0x0040039a, pulse);
    return;
  }
  wb(state, 0x00400014, stage & 0xff);
  wb(state, 0x00400016, stage < 5 ? stage : (stage - 5) & 0xff);
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

export function startMode2Init11452Async(state: GameState): void {
  wb(state, 0x00400460, 0xff);
  state.clock.mode2Init11452Stage = as_u8(0);
}

export function startMode0Init11452Async(state: GameState): void {
  wb(state, 0x00400460, 0xff);
  wb(state, 0x004003e2, 0);
  state.clock.mode0Init11452Stage = as_u8(0);
}

export function advanceMode0Init11452Async(state: GameState, rom: RomImage): void {
  const stage = state.clock.mode0Init11452Stage;
  if (stage === undefined) return;
  setMode0VblankSnapshot(state, stage);

  switch (stage) {
    case 0:
      vblankAck28DEA(state);
      clearPaletteRam121A6(state);
      clearPlayfieldRam12174(state);
      clearAlphaWords(state, 0, 1183);
      initFnPointers28580(state, rom);
      state.clock.mode0Init11452Stage = as_u8(1);
      return;

    case 1:
      clearAlphaWords(state, 1183, 0x780);
      state.clock.mode0Init11452Stage = as_u8(2);
      return;

    case 2:
      sceneObjInit28CA6Default(state, rom, {
        fun_26f3e: (s) => lateGameLogic26F3E(s, rom),
        fun_28dea: vblankAck28DEA,
      });
      state.clock.mode0Init11452Stage = as_u8(3);
      return;

    case 3:
    case 4:
      state.clock.mode0Init11452Stage = as_u8(stage + 1);
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
      state.clock.mode0Init11452Stage = as_u8(6);
      return;
    }

    case 6:
    case 7:
    case 8:
    case 9:
    case 10:
    case 11:
    case 12:
      state.clock.mode0Init11452Stage = as_u8(stage + 1);
      return;

    case 13:
      rebuildMode0LevelPrefix(state, rom, 1);
      state.clock.mode0Init11452Stage = as_u8(14);
      return;

    case 29:
      rebuildMode0LevelPrefix(state, rom, 2);
      state.clock.mode0Init11452Stage = as_u8(30);
      return;

    case 33:
      rebuildMode0LevelPrefix(state, rom, 3);
      state.clock.mode0Init11452Stage = as_u8(34);
      return;

    case 49:
      rebuildMode0LevelPrefix(state, rom, 4);
      state.clock.mode0Init11452Stage = as_u8(50);
      return;

    case 53:
      rebuildMode0LevelPrefix(state, rom, 5);
      state.clock.mode0Init11452Stage = as_u8(54);
      return;

    case 59:
      rebuildMode0LevelPrefix(state, rom, 6);
      state.clock.mode0Init11452Stage = as_u8(60);
      return;

    case 63:
      // MAME has the first decode rows visible at f12950, one sampled vblank
      // before the full FUN_10504 tail lands at f12960.
      decodeMode0LevelRowsPrefix(state, rom, MODE0_LEVEL_PREFIX_ROWS);
      state.clock.mode0Init11452Stage = as_u8(64);
      return;

    case 64:
      mainLoopInit10504(state, {}, {}, rom);
      state.clock.mode0Init11452Stage = as_u8(65);
      return;

    case 220:
      finalize11654(state, rom);
      state.clock.mode0Init11452Stage = undefined;
      return;

    default:
      state.clock.mode0Init11452Stage = as_u8(stage + 1);
      return;
  }
}

export function advanceMode2Init11452Async(state: GameState, rom: RomImage): void {
  const stage = state.clock.mode2Init11452Stage;
  if (stage === undefined) return;

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
      state.clock.mode2BottomHudDelay = as_u8(1);
      return;
  }
}
