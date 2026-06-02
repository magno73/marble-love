/**
 * main-loop-init-11452.ts — replica branchata di `FUN_00011452`.
 */

import type { GameState } from "./state.js";
import type { RomImage } from "./bus.js";
import { levelDispatcher16EC6 } from "./level-dispatcher-16ec6.js";
import { mainLoopInit10504, type MainLoopInit10504Subs } from "./main-loop-init-10504.js";
import { helper11FF8Default } from "./read-abs-byte-11ff8.js";
import { gameModePrep10456 } from "./game-mode-prep-10456.js";
import { finalize11654 } from "./finalize-11654.js";
import { tilemapBlit17044 } from "./tilemap-blit-17044.js";
import { bannerHelper26B66 } from "./banner-helper-26b66.js";
import { gameStateBanner26B2A } from "./game-state-banner-26b2a.js";
import { vblankAck28DEA } from "./vblank-helpers.js";
import { sceneInit11428 } from "./scene-init-11428.js";
import { stateSub2572 } from "./state-sub-2572.js";
import { particleInit18CD2 } from "./particle-init-18cd2.js";
import { slotInsertSorted18E6C } from "./slot-insert-sorted-18e6c.js";

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

function wl(state: GameState, addr: number, value: number): void {
  state.workRam[off(addr)] = (value >>> 24) & 0xff;
  state.workRam[off(addr) + 1] = (value >>> 16) & 0xff;
  state.workRam[off(addr) + 2] = (value >>> 8) & 0xff;
  state.workRam[off(addr) + 3] = value & 0xff;
}

function addByte(state: GameState, addr: number, value: number): void {
  wb(state, addr, rb(state, addr) + value);
}

function readRomLong(rom: RomImage | undefined, addr: number): number {
  const p = rom?.program;
  if (p === undefined) return 0;
  return ((((p[addr] ?? 0) << 24) | ((p[addr + 1] ?? 0) << 16) |
    ((p[addr + 2] ?? 0) << 8) | (p[addr + 3] ?? 0)) >>> 0);
}

function objectSlotAddr(index: number): number {
  return 0x00400018 + index * 0xe2;
}

export interface MainLoopInit11452Subs {
  memClear019C?: (state: GameState) => void;
  soundCmd?: (state: GameState, cmd: number) => void;
  sceneInit11428?: (state: GameState) => void;
  init10504?: (state: GameState) => void;
  gameModePrep10456?: (state: GameState) => void;
  helper16EC6?: (state: GameState) => void;
  gameStateBanner26B2A?: (state: GameState, mode: number) => void;
  helper26B66?: (state: GameState, arg: number) => void;
  vblankAck?: (state: GameState) => void;
  helper18CD2?: (state: GameState) => void;
  helper11FF8?: (state: GameState) => void;
  tilemapBlit17044?: (state: GameState) => void;
  randomMod13A98?: (state: GameState, maxExclusive: number) => number;
  renderString0142?: (state: GameState, textPtr: number, tileBase: number) => void;
  finalize11654?: (state: GameState) => void;
  init10504Subs?: MainLoopInit10504Subs;
}

export function mainLoopInit11452(
  state: GameState,
  rom?: RomImage,
  subs: MainLoopInit11452Subs = {},
): void {
  subs.memClear019C?.(state);
  wb(state, 0x00400460, 0xff);

  const mode = rw(state, 0x00400392);
  if (mode <= 3) {
    switch (mode) {
      case 0:
        state11452Case0(state, rom, subs);
        break;
      case 1:
        ww(state, 0x0040075a, 1);
        break;
      case 2:
        state11452Case2(state, rom, subs);
        break;
      case 3:
        state11452Case3(state, subs, rom);
        break;
    }
  }

  (subs.finalize11654 ?? finalize11654)(state);
}

function state11452Case0(
  state: GameState,
  rom: RomImage | undefined,
  subs: MainLoopInit11452Subs,
): void {
  subs.soundCmd?.(state, 1);
  wb(state, 0x004003e2, 0);
  (subs.sceneInit11428 ?? ((s) => sceneInit11428(s, {}, rom)))(state);
  addByte(state, 0x004003e4, 1);

  if (rb(state, 0x004003e4) > 7) {
    for (let i = 0; i < 2; i++) {
      const base = objectSlotAddr(i);
      wb(state, base + 0xc0, 0x41);
      wb(state, base + 0xc1, 0x41);
      wb(state, base + 0xc2, 0x41);
    }
    ww(state, 0x00400392, 3);
    wb(state, 0x004003e4, 0);
    state11452Case3(state, subs, rom);
    return;
  }

  ww(state, 0x0040075a, 0);
  ww(state, 0x00400394, rw(state, 0x00400394) ^ 1);
  const gameMode = rw(state, 0x00400394);
  wl(state, 0x00400446, readRomLong(rom, 0x0001d364 + gameMode * 4));
  ww(state, 0x00400396, 1);
  (subs.gameModePrep10456 ?? gameModePrep10456)(state);
  (subs.helper16EC6 ?? ((s) => { if (rom !== undefined) levelDispatcher16EC6(s, rom); }))(state);
  if (rw(state, 0x00400390) === 1) {
    (subs.init10504 ?? ((s) => mainLoopInit10504(s, subs.init10504Subs, {}, rom)))(state);
  }
}

function state11452Case2(state: GameState, rom: RomImage | undefined, subs: MainLoopInit11452Subs): void {
  (subs.sceneInit11428 ?? ((s) => sceneInit11428(s, {}, rom)))(state);
  (subs.gameStateBanner26B2A ?? ((s, m) => { if (rom !== undefined) gameStateBanner26B2A(s, rom, m); }))(state, 0);
  (subs.helper26B66 ?? bannerHelper26B66)(state, 0x13);
  ww(state, 0x00400000, 0);
  ww(state, 0x00400002, 0);
  wb(state, 0x00400008, 0);
  wb(state, 0x00400006, 0);
  wb(state, 0x0040000a, 0);
  (subs.vblankAck ?? vblankAck28DEA)(state);
  (subs.helper18CD2 ?? ((s) => {
    if (rom === undefined) return;
    particleInit18CD2(s, 3, 0xfe, {
      fun_18e6c: (st, typeCode, subIdx) => {
        slotInsertSorted18E6C(st, rom, typeCode, subIdx);
      },
    });
  }))(state);
  (subs.helper11FF8 ?? ((s: GameState) => helper11FF8Default(s, rom)))(state);
  (subs.tilemapBlit17044 ?? ((s) => { if (rom !== undefined) tilemapBlit17044(rom, s.playfieldRam); }))(state);
  ww(state, 0x0040075a, 0x012c);
  if (rb(state, 0x004003e6) !== 0) {
    subs.soundCmd?.(state, subs.randomMod13A98?.(state, 3) ?? 0);
    wb(state, 0x004003e6, 0);
  }
}

function state11452Case3(state: GameState, subs: MainLoopInit11452Subs, rom?: RomImage): void {
  (subs.gameStateBanner26B2A ?? ((s, m) => { if (rom !== undefined) gameStateBanner26B2A(s, rom, m); }))(state, 0);
  const renderString0142 = subs.renderString0142 ?? ((s: GameState, ptr: number, tile: number) => {
    if (rom !== undefined) stateSub2572(s, rom, ptr, tile);
  });
  renderString0142(state, 0x22d26, 0x3000);
  renderString0142(state, 0x22d32, 0x3400);
  ww(state, 0x0040075a, 0x00c8);
  if ((rw(state, 0x004003dc) & 0x4000) !== 0) {
    wb(state, 0x004003e6, 1);
  }
}

export const MAIN_LOOP_INIT_11452_ADDR = 0x00011452 as const;
export const MAIN_LOOP_INIT_11452_SUB_ADDRS = [
  0x0000019c, 0x000158ac, 0x00011428, 0x00010456, 0x00016ec6,
  0x00010504, 0x00026b2a, 0x00026b66, 0x00028dea, 0x00018cd2,
  0x00011ff8, 0x00017044, 0x00013a98, 0x00000142, 0x00011654,
] as const;
