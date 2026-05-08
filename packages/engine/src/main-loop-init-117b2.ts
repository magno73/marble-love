/**
 * main-loop-init-117b2.ts — entry chain `FUN_000117B2`.
 */

import type { GameState } from "./state.js";
import type { RomImage } from "./bus.js";
import { mainLoopInit1101E, type MainLoopInit1101ESubs } from "./main-loop-init-1101e.js";
import { mainLoopInit11452, type MainLoopInit11452Subs } from "./main-loop-init-11452.js";
import { randomMod13A98 } from "./random-mod-13a98.js";
import { bootHelper1464ADefault } from "./boot-helper-1464a.js";
import { softReset100E0 } from "./soft-reset-100e0.js";
import { lateGameLogic26F3E } from "./late-game-logic-26f3e.js";
export { mainLoopInit1101E, type MainLoopInit1101ESubs } from "./main-loop-init-1101e.js";
export { mainLoopInit11452, type MainLoopInit11452Subs } from "./main-loop-init-11452.js";
export { mainLoopInit10504, type MainLoopInit10504Subs } from "./main-loop-init-10504.js";

const WRAM = 0x00400000;

function off(addr: number): number {
  return addr - WRAM;
}

function rb(state: GameState, addr: number): number {
  return state.workRam[off(addr)] ?? 0;
}

function i8(value: number): number {
  const b = value & 0xff;
  return (b & 0x80) !== 0 ? b - 0x100 : b;
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

function addByte(state: GameState, addr: number, value: number): void {
  wb(state, addr, rb(state, addr) + value);
}

export interface MainLoopInit117B2Subs {
  bootHelper1464A?: (state: GameState) => void;
  init11452?: (state: GameState) => void;
  init1101E?: (state: GameState) => void;
  soundCmd158AC?: (state: GameState, cmd: number) => number | void;
  softReset100E0?: (state: GameState) => void;
  randomMod13A98?: (state: GameState, maxExclusive: number) => number;
  lateLogic26F3E?: (state: GameState) => void;
  vblankAck?: (state: GameState) => void;
  init1101ESubs?: MainLoopInit1101ESubs;
  init11452Subs?: MainLoopInit11452Subs;
}

export interface MainLoopInit117B2Options {
  loopIterations?: number;
}

export function mainLoopInit117B2(
  state: GameState,
  rom?: RomImage,
  subs: MainLoopInit117B2Subs = {},
  options: MainLoopInit117B2Options = {},
): void {
  wb(state, 0x004003f4, 0);
  wb(state, 0x004003f2, 0);
  wb(state, 0x004003f0, 0);
  (subs.bootHelper1464A ?? bootHelper1464ADefault)(state);
  ww(state, 0x00400390, 1);
  wb(state, 0x004003e4, 0);
  ww(state, 0x00400394, 1);
  ww(state, 0x00400392, 0);
  (subs.init11452 ?? ((s) => mainLoopInit11452(s, rom, subs.init11452Subs)))(state);

  const iterations = options.loopIterations ?? 1;
  for (let i = 0; i < iterations; i++) {
    mainLoop117B2LoopBody(state, rom, subs);
  }
}

export function mainLoop117B2LoopBody(
  state: GameState,
  rom?: RomImage,
  subs: MainLoopInit117B2Subs = {},
): void {
  addByte(state, 0x004003f0, 1);
  wb(state, 0x00400016, 0);
  wb(state, 0x00400014, 0);
  (subs.init1101E ?? ((s) => mainLoopInit1101E(s, rom, subs.init1101ESubs)))(state);

  const timer = rw(state, 0x00400768);
  if ((timer & 0x8000) === 0) {
    ww(state, 0x00400768, timer - 1);
    if ((rw(state, 0x00400768) & 0x8000) !== 0) {
      subs.soundCmd158AC?.(state, 0x13);
      wb(state, 0x0040076a, rb(state, 0x0040076a) | 4);
    }
  }

  if (rb(state, 0x004003b2) === 0) {
    if ((rw(state, 0x00400010) & 7) === 0) {
      const d0 = subs.soundCmd158AC?.(state, 7) ?? 0;
      if (d0 !== 0) wb(state, 0x004003b2, 4);
      else addByte(state, 0x004003b4, 1);
    }
  } else {
    addByte(state, 0x004003b2, -1);
    if (rb(state, 0x004003b2) === 0) addByte(state, 0x004003b4, 1);
  }

  if (i8(rb(state, 0x004003b4)) > 8) {
    (subs.softReset100E0 ?? softReset100E0)(state);
    wb(state, 0x004003b2, 0);
    wb(state, 0x004003b4, 0);
  }

  if (rw(state, 0x004003b8) !== 0) {
    ww(state, 0x004003b8, rw(state, 0x004003b8) - 1);
    if (rw(state, 0x004003b8) === 0) (subs.softReset100E0 ?? softReset100E0)(state);
  }

  (subs.randomMod13A98 ?? randomMod13A98)(state, 0x100);
  (subs.lateLogic26F3E ?? ((s) => { if (rom !== undefined) lateGameLogic26F3E(s, rom); }))(state);
  if (rb(state, 0x00400016) === 0) subs.vblankAck?.(state);
  wb(state, 0x0040039a, 1);
  subs.vblankAck?.(state);
}

export const MAIN_LOOP_INIT_117B2_ADDR = 0x000117b2 as const;
export const MAIN_LOOP_INIT_117B2_SUB_ADDRS = [
  0x0001464a, 0x00011452, 0x0001101e, 0x000158ac, 0x000100e0,
  0x00013a98, 0x00026f3e, 0x00028dea,
] as const;
