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

const WRAM = 0x00400000;

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
      subs.refresh10FCE?.(state);
      return;
    case 1:
      case1(state, subs);
      return;
    case 2:
      case3(state, subs);
      return;
    case 3:
      case4(state, rom, subs);
      return;
    case 4:
      case2(state, subs);
      return;
    case 5:
      case5(state, rom, subs);
      return;
    case 6:
      case6(state, subs);
      return;
  }
}

function init11452(state: GameState, subs: MainLoopInit1101ESubs, rom?: RomImage): void {
  (subs.init11452 ?? ((s) => mainLoopInit11452(s, rom, subs.init11452Subs)))(state);
}

function init10504(state: GameState, subs: MainLoopInit1101ESubs): void {
  (subs.init10504 ?? ((s) => mainLoopInit10504(s, subs.init10504Subs)))(state);
}

function helper118D2(state: GameState, subs: MainLoopInit1101ESubs, rom?: RomImage): void {
  (subs.helper118D2 ?? ((s) => rom !== undefined ? playerSlotIter118D2(s, rom) : undefined))(state);
}

function case5(state: GameState, rom: RomImage | undefined, subs: MainLoopInit1101ESubs): void {
  wb(state, 0x00400086, 0xff);
  subs.soundCmd?.(state, 2);
  subs.soundCmd?.(state, 0);
  wb(state, 0x004003e2, 0);
  subs.sceneInit11428?.(state);
  subs.soundCmd?.(state, rw(state, 0x00400396) === 1 ? 0x62 : 0x63);
  ww(state, 0x00400394, readRomByte(rom, 0x0001f1c8));
  subs.gameModePrep10456?.(state);
  (subs.helper16EC6 ?? ((s) => { if (rom !== undefined) levelDispatcher16EC6(s, rom); }))(state);
  init10504(state, subs);
  ww(state, 0x00400390, 0);
}

function case1(state: GameState, subs: MainLoopInit1101ESubs): void {
  if (rb(state, 0x004003ee) === 1 && rw(state, 0x004003ea) >= 0x18) {
    subs.textPrint0118?.(state, 0x22a56);
    subs.textPrint0118?.(state, 0x22a62);
    subs.textPrint0118?.(state, 0x22a6e);
    ww(state, 0x0040075a, 0xffff);
  } else if (rb(state, 0x004003ee) === 0 && rw(state, 0x004003ea) >= 0x0c) {
    ww(state, 0x0040075a, 0xffff);
  }

  if (rw(state, 0x0040075a) === 0xffff) {
    if (rw(state, 0x00400392) !== 2) {
      wb(state, 0x00400086, 0xff);
      ww(state, 0x00400392, 2);
      init11452(state, subs);
    } else {
      subs.helper11654?.(state);
    }
    ww(state, 0x0040075a, 0);
  }

  subs.helper28232?.(state);
  const timer = rw(state, 0x0040075a);
  if (timer > 0) {
    ww(state, 0x0040075a, timer - 1);
    if (rw(state, 0x0040075a) === 0) {
      const next = rw(state, 0x00400392) + 1;
      ww(state, 0x00400392, next > 2 ? 0 : next);
      init11452(state, subs);
    }
  }

  if (rw(state, 0x00400392) === 0 && rw(state, 0x00400390) === 1) {
    subs.refresh10FCE?.(state);
  }
}

function case2(state: GameState, subs: MainLoopInit1101ESubs): void {
  const saved = rb(state, 0x00400008);
  wb(state, 0x00400008, 0);
  wb(state, 0x0040039a, 1);
  subs.vblankAck?.(state);
  subs.helper16A20?.(state);
  if (rw(state, 0x00400390) !== 0) {
    ww(state, 0x00400390, 2);
    wb(state, 0x00400460, 0xff);
  } else {
    wb(state, 0x00400008, saved);
  }
}

function case3(state: GameState, subs: MainLoopInit1101ESubs): void {
  wb(state, 0x004003ac, 0);
  const side = rb(state, 0x004003a4) === 1 ? 2 : 1;
  const d2 = rw(state, 0x00400396) === 1 ? 0 : side;
  const d3 = rw(state, 0x00400396) === 1 ? 0 : 3 - side;
  subs.helper019C?.(state);
  addByte(state, 0x004003f0, 1);
  subs.sceneInit11428?.(state);
  subs.gameStateBanner26B2A?.(state, 0);
  const a = subs.helper001C6?.(state, rl(state, 0x004000d4)) ?? 0;
  const b = subs.helper001C6?.(state, rl(state, 0x004001b6)) ?? 0;
  void a;
  void b;
  const p0 = subs.helper11B18?.(state, 0x00400018) ?? 0;
  const p1 = subs.helper11B18?.(state, 0x004000fa) ?? 0;
  ww(state, 0x00400394, 1);
  ww(state, 0x00400390, 1);
  if (rw(state, 0x004003ea) !== 0xffff) {
    ww(state, 0x004003ea, subs.helper0160?.(state) ?? 0);
  }
  subs.helper288F8?.(state);
  wb(state, 0x004003e4, 0);
  ww(state, 0x00400392, 2);
  ww(state, 0x0040075a, 0x0096);
  if (p0 === 0 && p1 === 0) init11452(state, subs);
  void d2;
  void d3;
}

function case4(state: GameState, rom: RomImage | undefined, subs: MainLoopInit1101ESubs): void {
  subs.soundPair15884?.(state);
  ww(state, 0x00400768, 0xffff);
  if (rw(state, 0x00400394) === 3) subs.soundCmd?.(state, 0x11);
  wb(state, 0x00400008, 0);
  wb(state, 0x00400006, 0);
  wb(state, 0x0040000a, 0);
  wb(state, 0x0040039a, 1);
  addByte(state, 0x004003f0, 1);
  ww(state, 0x00400394, rw(state, 0x00400394) + 1);
  helper118D2(state, subs, rom);
  wb(state, 0x00400460, 0xff);
  subs.vblankAck?.(state);
  subs.clearPaletteRam?.(state);
  (subs.clearOther12186 ?? clearPlayfieldOther12186)(state);
  subs.initFnPointers28580?.(state);
  subs.clearAlphaTiles28C7E?.(state);
  subs.sceneObjInit28CA6?.(state);
  if (rw(state, 0x00400394) > 5) {
    ww(state, 0x00400390, 6);
  } else {
    init10504(state, subs);
    ww(state, 0x00400390, 0);
  }
  void rom;
}

function case6(state: GameState, subs: MainLoopInit1101ESubs): void {
  wb(state, 0x00400008, 0);
  wb(state, 0x00400006, 0);
  wb(state, 0x0040000a, 0);
  subs.clearMoAlphaRam?.(state);
  subs.gameStateBanner26B2A?.(state, 0);
  subs.soundCmd?.(state, 0x1b);
  wb(state, 0x004003e8, 0);
  subs.helper18A88?.(state);
  subs.wait28DB8?.(state, 0xb4);
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
