/**
 * main-loop-init-1101e.ts — state dispatcher `FUN_0001101E`.
 */

import type { GameState } from "./state.js";
import type { RomImage } from "./bus.js";
import { levelDispatcher16EC6 } from "./level-dispatcher-16ec6.js";
import { mainLoopInit10504, type MainLoopInit10504Subs } from "./main-loop-init-10504.js";
import { mainLoopInit11452, type MainLoopInit11452Subs } from "./main-loop-init-11452.js";
import { clearPlayfieldOther12186 } from "./clear-playfield-other-12186.js";
import { playerSlotIter118D2 } from "./player-slot-iter-118d2.js";
import { gameModePrep10456 } from "./game-mode-prep-10456.js";
import { finalize11654 } from "./finalize-11654.js";
import { sceneInit11428 } from "./scene-init-11428.js";
import { specialAttract } from "./special-attract.js";
import { soundPair15884 } from "./sound-pair-15884.js";
import { levelFractionRender28232Default } from "./level-fraction-render-28232.js";
import { CLEAR_ROWS_ARG, WAIT_PHASE2_TICKS, stateSub16A20 } from "./state-sub-16a20.js";
import { stateSub18A88 } from "./state-sub-18a88.js";
import { renderStringEntry286B0 } from "./render-string-entry-286b0.js";
import { renderStringEntry28F62 } from "./render-string-entry-28f62.js";
import { renderStringEntry28FA0 } from "./render-string-entry-28fa0.js";
import { renderScore28E3C } from "./render-score-28e3c.js";
import { formatAndRender28EB2 } from "./format-and-render-28eb2.js";
import { refreshFrame10FCE } from "./refresh-frame-10fce.js";
import { stateSub2678 } from "./state-sub-2678.js";
import { stateSub2572 } from "./state-sub-2572.js";
import { clearAlphaTiles28C7E } from "./clear-alpha-tiles-28c7e.js";
import { clearAlphaTilesFromIndex } from "./alpha-tilemap.js";
import { initFnPointers28580 } from "./init-fn-pointers-28580.js";
import { objectSlotLookup11B18 } from "./object-slot-lookup-11b18.js";
import { vblankAck28DEA } from "./vblank-helpers.js";
import { gameStateBanner26B2A } from "./game-state-banner-26b2a.js";
import { sceneObjInit28CA6Default } from "./scene-obj-init-28ca6.js";
import { startMode0Init11452Async, startMode2Init11452Async } from "./mode2-init-11452-async.js";
import { armLevelIntroBannerResume } from "./level-intro-banner-resume.js";
import { renderStringChain3520 } from "./render-string-chain-3520.js";
import { formatNumber3874 } from "./string-format.js";
import { trimTrailingSpace } from "./string-trim.js";
import { objectAccumFlag28608 } from "./object-accum-flag-28608.js";
import { particleInit18CD2 } from "./particle-init-18cd2.js";
import { as_u8, as_u16 } from "./wrap.js";

const WRAM = 0x00400000;
const LEVEL_END_SCORE_WAIT_TICKS = 0x28 as const;
const FINAL_SCORE_WAIT_TICKS = 0xb4 as const;

const SLOT_BASE_ADDR = 0x00400018 as const;
const SLOT_STRIDE = 0xe2 as const;
const SLOT_STATE_OFF = 0x18 as const;
const SLOT_SCORE_OFF = 0x6a as const;
const SCORE_RENDER_TABLE = 0x0001d36e as const;
const LEVEL_END_TEXT_PTR_P0 = 0x00022b82 as const;
const LEVEL_END_TEXT_PTR_P1 = 0x00022b9a as const;
const TILE_BASE_P0 = 0x2000 as const;
const TILE_BASE_P1 = 0x2400 as const;

function off(addr: number): number {
  return addr - WRAM;
}

function rb(state: GameState, addr: number): number {
  return state.workRam[off(addr)] ?? 0;
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

function rl(state: GameState, addr: number): number {
  return ((((state.workRam[off(addr)] ?? 0) << 24) | ((state.workRam[off(addr) + 1] ?? 0) << 16) |
    ((state.workRam[off(addr) + 2] ?? 0) << 8) | (state.workRam[off(addr) + 3] ?? 0)) >>> 0);
}

function readRomByte(rom: RomImage | undefined, addr: number): number {
  return rom?.program[addr] ?? 0;
}

function addByte(state: GameState, addr: number, value: number): void {
  wb(state, addr, rb(state, addr) + value);
}

function sextWord(value: number): number {
  const w = value & 0xffff;
  return w & 0x8000 ? w - 0x10000 : w;
}

function sextByte(value: number): number {
  const b = value & 0xff;
  return b & 0x80 ? (b | 0xffffff00) >> 0 : b;
}

function colorRamWrite(state: GameState, colorOff: number, value: number): void {
  const v = value & 0xffff;
  state.colorRam[colorOff] = (v >>> 8) & 0xff;
  state.colorRam[colorOff + 1] = v & 0xff;
}

function renderString2572Default(state: GameState, rom: RomImage, entryPtr: number, attrWord: number): void {
  stateSub2572(state, rom, entryPtr, attrWord);
}

function renderScore28E3CDefault(
  state: GameState,
  rom: RomImage,
  arg1: number,
  arg2: number,
  arg3: number,
  arg4: number,
  arg5: number,
  arg6: number,
): void {
  renderScore28E3C(state, arg1, arg2, arg3, arg4, arg5, arg6, {
    numberFormatter: (st, value, bufEnd, fmtMode, width, fillExtra) => {
      formatNumber3874(st, value, bufEnd, fmtMode, width, fillExtra);
    },
    renderStringEntry28F62: (st, col, tickOff, attr) => {
      renderStringEntry28F62(st, col, tickOff, attr, {
        renderStringChain: (structAddr, attrWord) => {
          renderString2572Default(st, rom, structAddr, attrWord);
        },
      });
    },
  });
}

function renderStringEntry286B0Default(
  state: GameState,
  rom: RomImage,
  arg1: number,
  arg2: number,
  arg3: number,
  arg4: number,
): void {
  renderStringEntry286B0(
    state,
    arg1,
    arg2,
    arg3,
    arg4,
    {
      renderStringChain: (structAddr, attrWord) => {
        renderString2572Default(state, rom, structAddr, attrWord);
      },
    },
    (absAddr) => rom.program[absAddr >>> 0] ?? 0,
  );
}

function formatAndRender28EB2Default(
  state: GameState,
  rom: RomImage,
  arg1: number,
  arg2: number,
  arg3: number,
  arg4: number,
  arg5: number,
  arg6: number,
): void {
  formatAndRender28EB2(state, arg1, arg2, arg3, arg4, arg5, arg6, {
    numberFormatter: (st, value, bufEnd, fmtMode, width, fillExtra) => {
      formatNumber3874(st, value, bufEnd, fmtMode, width, fillExtra);
    },
    trimTrailingSpace: (st, strPtr, maxLen) => {
      trimTrailingSpace(st, strPtr, maxLen);
    },
    renderStringEntry: (st, col, tickOff, attr) => {
      renderStringEntry28FA0(st, col, tickOff, attr, {
        renderStringChain2: (structAddr, attrLong) => {
          renderStringChain3520(st, rom, structAddr, attrLong);
        },
      });
    },
  });
}

function renderLevelEndScorePrelude(state: GameState, rom: RomImage): number {
  colorRamWrite(state, 0x00, 0x0000);
  colorRamWrite(state, 0x08, 0x0000);
  colorRamWrite(state, 0x3a, 0x0000);
  colorRamWrite(state, 0x10, 0x0000);
  colorRamWrite(state, 0x18, 0x0000);
  colorRamWrite(state, 0x12, 0xafff);
  colorRamWrite(state, 0x1a, 0xafff);
  colorRamWrite(state, 0x16, 0xf00f);
  colorRamWrite(state, 0x1e, 0xaf00);

  let matched = 0;
  const slotCount = rw(state, 0x00400396);
  for (let d2 = 0; (d2 & 0x80 ? d2 - 256 : d2) !== (slotCount & 0xffff); d2 = (d2 + 1) & 0xff) {
    const slotAddr = SLOT_BASE_ADDR + d2 * SLOT_STRIDE;
    if (rb(state, slotAddr + SLOT_STATE_OFF) !== 3) continue;
    matched++;

    wb(state, slotAddr + 0xd8, 0);
    wb(state, slotAddr + 0x71, 0xff);
    wb(state, slotAddr + 0x70, 0);

    const tileBase = d2 !== 0 ? TILE_BASE_P1 : TILE_BASE_P0;
    const textPtr = d2 !== 0 ? LEVEL_END_TEXT_PTR_P1 : LEVEL_END_TEXT_PTR_P0;
    renderString2572Default(state, rom, textPtr, tileBase);

    const scoreSigned = sextWord(rw(state, slotAddr + SLOT_SCORE_OFF));
    const clamped = scoreSigned > 99 ? 99 : scoreSigned;
    const scoreValue = (clamped * 100) >> 0;
    const tableByte = rom.program[(SCORE_RENDER_TABLE + d2) >>> 0] ?? 0;
    renderScore28E3CDefault(
      state,
      rom,
      scoreValue >>> 0,
      0,
      sextByte(tableByte),
      4,
      5,
      tileBase,
    );
  }
  return matched;
}

function playerSlotIter118D2PostScoreHold(state: GameState, rom: RomImage, subs: MainLoopInit1101ESubs): void {
  playerSlotIter118D2(state, rom, {
    fun_0142: () => undefined,
    fun_28e3c: () => undefined,
    fun_28db8: () => undefined,
    fun_158ac: (st, cmd) => {
      subs.soundCmd?.(st, cmd);
      return 1;
    },
    fun_16ec6: (st) => levelDispatcher16EC6(st, rom),
    fun_28608: (st, slotPtr, value) => objectAccumFlag28608(st, slotPtr, value),
  });
}

function stateSub18A88Default(state: GameState, rom: RomImage): number {
  const result = stateSub18A88(state, {
    particleInit: (st, count, mode) => {
      particleInit18CD2(st, count, mode);
    },
    clearAlphaTiles: (st, startRow) => {
      clearAlphaTilesFromIndex(st, startRow);
    },
    renderStringVia142: (st, entryPtr, attrLong) => {
      renderString2572Default(st, rom, entryPtr, attrLong);
    },
    renderStringVia200: (st, entryPtr, attrLong) => {
      renderStringChain3520(st, rom, entryPtr, attrLong);
    },
    renderTag: (st, a1, a2, a3, a4) => {
      renderStringEntry286B0Default(st, rom, a1, a2, a3, a4);
    },
    renderStringHelper: (st, a1, a2, a3, a4, a5, a6) => {
      renderScore28E3CDefault(st, rom, a1, a2, a3, a4, a5, a6);
    },
    addToObjectAccum: (st, objPtr, value) => {
      objectAccumFlag28608(st, objPtr, value);
    },
    formatAndRender: (st, a1, a2, a3, a4, a5, a6) => {
      formatAndRender28EB2Default(st, rom, a1, a2, a3, a4, a5, a6);
    },
  });
  return result.matchedCount;
}

export interface MainLoopInit1101ESubs {
  soundCmd?: (state: GameState, cmd: number) => void;
  textPrint0118?: (state: GameState, textPtr: number) => void;
  sceneInit11428?: (state: GameState) => void;
  init10504?: (state: GameState) => void;
  init11452?: (state: GameState) => void;
  refresh10FCE?: (state: GameState) => void;
  gameModePrep10456?: (state: GameState) => void;
  helper16EC6?: (state: GameState) => void;
  vblankAck?: (state: GameState) => void;
  helper16A20?: (state: GameState) => void;
  helper28232?: (state: GameState) => void;
  helper11654?: (state: GameState) => void;
  helper019C?: (state: GameState) => void;
  gameStateBanner26B2A?: (state: GameState, mode: number) => void;
  helper001C6?: (state: GameState, value: number) => number;
  helper11B18?: (state: GameState, objectAddr: number) => number;
  helper0160?: (state: GameState) => number;
  helper288F8?: (state: GameState) => void;
  soundPair15884?: (state: GameState) => void;
  helper118D2?: (state: GameState) => void;
  clearPaletteRam?: (state: GameState) => void;
  clearMoAlphaRam?: (state: GameState) => void;
  clearOther12186?: (state: GameState) => void;
  initFnPointers28580?: (state: GameState) => void;
  clearAlphaTiles28C7E?: (state: GameState) => void;
  sceneObjInit28CA6?: (state: GameState) => void;
  helper18A88?: (state: GameState) => void;
  wait28DB8?: (state: GameState, frames: number) => void;
  init10504Subs?: MainLoopInit10504Subs;
  init11452Subs?: MainLoopInit11452Subs;
}

export function mainLoopInit1101E(
  state: GameState,
  rom?: RomImage,
  subs: MainLoopInit1101ESubs = {},
): void {
  const stateWord = rw(state, 0x00400390);
  if (stateWord > 6) return;

  switch (stateWord) {
    case 0:
      (subs.refresh10FCE ?? ((s) => { if (rom !== undefined) refreshFrame10FCE(s, rom); }))(state);
      return;
    case 1:
      case1(state, subs, rom);
      return;
    case 2:
      case3(state, subs, rom);
      return;
    case 3:
      case4(state, rom, subs);
      return;
    case 4:
      case2(state, subs, rom);
      return;
    case 5:
      case5(state, rom, subs);
      return;
    case 6:
      case6(state, subs, rom);
      return;
  }
}

function init11452(state: GameState, subs: MainLoopInit1101ESubs, rom?: RomImage): void {
  (subs.init11452 ?? ((s) => mainLoopInit11452(s, rom, subs.init11452Subs)))(state);
}

function init10504(state: GameState, subs: MainLoopInit1101ESubs, rom?: RomImage): void {
  (subs.init10504 ?? ((s) => mainLoopInit10504(s, subs.init10504Subs, {}, rom)))(state);
}

function helper118D2(state: GameState, subs: MainLoopInit1101ESubs, rom?: RomImage): void {
  (subs.helper118D2 ?? ((s) => {
    if (rom === undefined) return;
    playerSlotIter118D2(s, rom, {
      fun_16ec6: (st) => levelDispatcher16EC6(st, rom),
    });
  }))(state);
}

function case5(state: GameState, rom: RomImage | undefined, subs: MainLoopInit1101ESubs): void {
  wb(state, 0x00400086, 0xff);
  subs.soundCmd?.(state, 2);
  subs.soundCmd?.(state, 0);
  wb(state, 0x004003e2, 0);
  (subs.sceneInit11428 ?? ((s) => sceneInit11428(s, {}, rom)))(state);
  subs.soundCmd?.(state, rw(state, 0x00400396) === 1 ? 0x62 : 0x63);
  ww(state, 0x00400394, readRomByte(rom, 0x0001f1c8));
  (subs.gameModePrep10456 ?? gameModePrep10456)(state);
  (subs.helper16EC6 ?? ((s) => { if (rom !== undefined) levelDispatcher16EC6(s, rom); }))(state);
  init10504(state, subs, rom);
  ww(state, 0x00400390, 0);
}

function case1(state: GameState, subs: MainLoopInit1101ESubs, rom?: RomImage): void {
  if (rb(state, 0x004003ee) === 1 && rw(state, 0x004003ea) >= 0x18) {
    const textPrint = subs.textPrint0118 ?? ((s: GameState, ptr: number) => stateSub2678(s, ptr));
    textPrint(state, 0x22a56);
    textPrint(state, 0x22a62);
    textPrint(state, 0x22a6e);
    ww(state, 0x0040075a, 0xffff);
  } else if (rb(state, 0x004003ee) === 0 && rw(state, 0x004003ea) >= 0x0c) {
    ww(state, 0x0040075a, 0xffff);
  }

  if (rw(state, 0x0040075a) === 0xffff) {
    if (rw(state, 0x00400392) !== 2) {
      wb(state, 0x00400086, 0xff);
      ww(state, 0x00400392, 2);
      init11452(state, subs, rom);
    } else {
      (subs.helper11654 ?? finalize11654)(state);
    }
    ww(state, 0x0040075a, 0);
  }

  if (subs.helper28232 !== undefined) {
    subs.helper28232(state);
  } else if (
    rom !== undefined &&
    state.clock.mode2Init11452Stage === undefined &&
    state.clock.mode2BottomHudDelay === undefined
  ) {
    levelFractionRender28232Default(state, rom);
  }
  const timer = rw(state, 0x0040075a);
  if (timer > 0) {
    ww(state, 0x0040075a, timer - 1);
    if (rw(state, 0x0040075a) === 0) {
      const next = rw(state, 0x00400392) + 1;
      ww(state, 0x00400392, next > 2 ? 0 : next);
      if (rom !== undefined && subs.init11452 === undefined && rw(state, 0x00400392) === 2) {
        startMode2Init11452Async(state);
      } else if (rom !== undefined && subs.init11452 === undefined && rw(state, 0x00400392) === 0) {
        startMode0Init11452Async(state);
      } else {
        init11452(state, subs, rom);
      }
    }
  }

  if (
    state.clock.mode0Init11452Stage === undefined &&
    rw(state, 0x00400392) === 0 &&
    rw(state, 0x00400390) === 1
  ) {
    (subs.refresh10FCE ?? ((s) => { if (rom !== undefined) refreshFrame10FCE(s, rom); }))(state);
  }
}

function case2(state: GameState, subs: MainLoopInit1101ESubs, rom?: RomImage): void {
  const saved = rb(state, 0x00400008);
  wb(state, 0x00400008, 0);
  wb(state, 0x0040039a, 1);
  (subs.vblankAck ?? vblankAck28DEA)(state);
  let timeoutSummaryMatched = false;
  (subs.helper16A20 ?? ((s) => {
    if (rom !== undefined) {
      const result = stateSub16A20(s, rom, {
        renderStr: (st, strPtr, col, tickOff, attr) => {
          renderStringEntry286B0(
            st,
            strPtr,
            col,
            tickOff,
            attr,
            {
              renderStringChain: (entryPtr, attrWord) =>
                stateSub2572(st, rom, entryPtr, attrWord),
            },
            (absAddr) => rom.program[absAddr >>> 0] ?? 0,
          );
        },
      });
      timeoutSummaryMatched = result.phase2Matched > 0;
    }
  }))(state);
  if (rw(state, 0x00400390) !== 0) {
    ww(state, 0x00400390, 2);
    wb(state, 0x00400460, 0xff);
    if (timeoutSummaryMatched && state.clock.mainThreadWaitDelay === undefined) {
      state.clock.mainThreadWaitDelay = as_u16(WAIT_PHASE2_TICKS);
      state.clock.mainThreadWaitClearRows = as_u8(CLEAR_ROWS_ARG);
    }
  } else {
    wb(state, 0x00400008, saved);
  }
}

function case3(state: GameState, subs: MainLoopInit1101ESubs, rom?: RomImage): void {
  wb(state, 0x004003ac, 0);
  const side = rb(state, 0x004003a4) === 1 ? 2 : 1;
  const d2 = rw(state, 0x00400396) === 1 ? 0 : side;
  const d3 = rw(state, 0x00400396) === 1 ? 0 : 3 - side;
  subs.helper019C?.(state);
  addByte(state, 0x004003f0, 1);
  (subs.sceneInit11428 ?? ((s) => sceneInit11428(s, {}, rom)))(state);
  (subs.gameStateBanner26B2A ?? ((s, m) => { if (rom !== undefined) gameStateBanner26B2A(s, rom, m); }))(state, 0);
  const a = subs.helper001C6?.(state, rl(state, 0x004000d4)) ?? 0;
  const b = subs.helper001C6?.(state, rl(state, 0x004001b6)) ?? 0;
  void a;
  void b;
  const p0 = (subs.helper11B18 ?? objectSlotLookup11B18)(state, 0x00400018);
  const p1 = (subs.helper11B18 ?? objectSlotLookup11B18)(state, 0x004000fa);
  ww(state, 0x00400394, 1);
  ww(state, 0x00400390, 1);
  if (rw(state, 0x004003ea) !== 0xffff) {
    ww(state, 0x004003ea, subs.helper0160?.(state) ?? 0);
  }
  (subs.helper288F8 ?? specialAttract)(state);
  wb(state, 0x004003e4, 0);
  ww(state, 0x00400392, 2);
  ww(state, 0x0040075a, 0x0096);
  if (p0 === 0 && p1 === 0) {
    if (rom !== undefined && subs.init11452 === undefined) {
      startMode2Init11452Async(state);
    } else {
      init11452(state, subs, rom);
    }
  }
  void d2;
  void d3;
}

function case4(state: GameState, rom: RomImage | undefined, subs: MainLoopInit1101ESubs): void {
  if (
    state.clock.levelEndScoreResumePending !== undefined &&
    rom !== undefined &&
    subs.helper118D2 === undefined
  ) {
    state.clock.levelEndScoreResumePending = undefined;
    playerSlotIter118D2PostScoreHold(state, rom, subs);
    finishCase4Transition(state, rom, subs);
    return;
  }

  (subs.soundPair15884 ?? soundPair15884)(state);
  ww(state, 0x00400768, 0xffff);
  if (rw(state, 0x00400394) === 3) subs.soundCmd?.(state, 0x11);
  wb(state, 0x00400008, 0);
  wb(state, 0x00400006, 0);
  wb(state, 0x0040000a, 0);
  wb(state, 0x0040039a, 1);
  addByte(state, 0x004003f0, 1);
  ww(state, 0x00400394, rw(state, 0x00400394) + 1);

  if (rom !== undefined && subs.helper118D2 === undefined) {
    const matched = renderLevelEndScorePrelude(state, rom);
    if (matched > 0) {
      state.clock.levelEndScoreResumePending = as_u8(1);
      state.clock.mainThreadWaitDelay = as_u16(LEVEL_END_SCORE_WAIT_TICKS);
      return;
    }
  }

  helper118D2(state, subs, rom);
  finishCase4Transition(state, rom, subs);
}

function finishCase4Transition(state: GameState, rom: RomImage | undefined, subs: MainLoopInit1101ESubs): void {
  wb(state, 0x00400460, 0xff);
  (subs.vblankAck ?? vblankAck28DEA)(state);
  subs.clearPaletteRam?.(state);
  (subs.clearOther12186 ?? clearPlayfieldOther12186)(state);
  (subs.initFnPointers28580 ?? ((s) => initFnPointers28580(s, rom)))(state);
  (subs.clearAlphaTiles28C7E ?? clearAlphaTiles28C7E)(state);
  (subs.sceneObjInit28CA6 ?? ((s) => { if (rom !== undefined) sceneObjInit28CA6Default(s, rom); }))(state);
  if (rw(state, 0x00400394) > 5) {
    ww(state, 0x00400390, 6);
  } else {
    const carryoverTimer = rw(state, 0x00400082);
    init10504(state, subs, rom);
    armLevelIntroBannerResume(state, {
      baseTimer: carryoverTimer,
      parkTimer: true,
      ...(rom === undefined ? {} : { rom }),
    });
    ww(state, 0x00400390, 0);
  }
}

function case6(state: GameState, subs: MainLoopInit1101ESubs, rom?: RomImage): void {
  wb(state, 0x00400008, 0);
  wb(state, 0x00400006, 0);
  wb(state, 0x0040000a, 0);
  subs.clearMoAlphaRam?.(state);
  (subs.gameStateBanner26B2A ?? ((s, m) => { if (rom !== undefined) gameStateBanner26B2A(s, rom, m); }))(state, 0);
  subs.soundCmd?.(state, 0x1b);
  wb(state, 0x004003e8, 0);
  let matched = 0;
  (subs.helper18A88 ?? ((s) => {
    if (rom !== undefined) {
      matched = stateSub18A88Default(s, rom);
    } else {
      matched = stateSub18A88(s).matchedCount;
    }
  }))(state);
  if (subs.wait28DB8 !== undefined) {
    subs.wait28DB8(state, FINAL_SCORE_WAIT_TICKS);
  } else if (matched > 0) {
    state.clock.mainThreadWaitDelay = as_u16(FINAL_SCORE_WAIT_TICKS);
  }
  wb(state, 0x004003e2, 0);
  ww(state, 0x00400390, 2);
}

export const MAIN_LOOP_INIT_1101E_ADDR = 0x0001101e as const;
export const MAIN_LOOP_INIT_1101E_SUB_ADDRS = [
  0x000158ac, 0x00000118, 0x00011428, 0x00010504, 0x00010fce, 0x00010456,
  0x00016ec6, 0x00011452, 0x00028dea, 0x00016a20, 0x00028232,
  0x00011654, 0x0000019c, 0x00026b2a, 0x000001c6, 0x00011b18,
  0x00000160, 0x000288f8, 0x00015884, 0x000118d2, 0x000121a6,
  0x00012174, 0x00012186, 0x00028580, 0x00028c7e, 0x00028ca6,
  0x00018a88, 0x00028db8,
] as const;
