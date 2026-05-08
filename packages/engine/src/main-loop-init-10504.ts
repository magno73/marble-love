/**
 * main-loop-init-10504.ts — replica parziale, stub-injectable, di `FUN_00010504`.
 *
 * `FUN_10504` è il grosso init per game-state/level-start chiamato dalla
 * chain `117B2 -> 1101E/11452 -> 10504 -> 10392`. Questa prima slice copre
 * il blocco deterministico iniziale e la coda di normalizzazione oggetti,
 * lasciando le JSR non replicate come callback iniettabili.
 */

import type { GameState } from "./state.js";
import { slotArrayBulkInit } from "./slot-array-init.js";
import { randomMod13A98 } from "./random-mod-13a98.js";
import { soundMaybe11AC2 } from "./sound-maybe-11ac2.js";
import { stateDispatch12FD0 } from "./state-dispatch-12fd0.js";
import { pfScrollEmit26E14 } from "./pf-scroll-emit-26e14.js";
import { lateGameLogic26F3E } from "./late-game-logic-26f3e.js";
import type { RomImage } from "./bus.js";
import { levelInit16F6C } from "./level-init-16f6c.js";
import { objectInit259B4 } from "./object-init-259b4.js";
import { slapsticDispatcher1344C } from "./slapstic-dispatcher-1344c.js";
import { clearPaletteRam121A6, vblankAck28DEA } from "./vblank-helpers.js";
import { scrollRange144E4 } from "./scroll-range-144e4.js";
import { stateSub2572 } from "./state-sub-2572.js";
import { objDirtyDispatch28624 } from "./obj-dirty-dispatch-28624.js";
import { renderString286EE } from "./render-string-286ee.js";

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

function addByte(state: GameState, addr: number, delta: number): void {
  wb(state, addr, rb(state, addr) + delta);
}

function objectSlotAddr(index: number): number {
  return 0x00400018 + index * 0xe2;
}

export interface MainLoopInit10504Subs {
  clearPaletteRam?: (state: GameState) => void; // FUN_121A6
  hudFrameInit?: (state: GameState) => void; // FUN_283C2
  slotArrayBulkInit?: (state: GameState) => void; // FUN_10392
  soundMaybe11AC2?: (state: GameState) => void;
  scrollRange144E4?: (state: GameState, from: number, to: number) => void;
  stateDispatch12FD0?: (state: GameState) => void;
  vblankAck?: (state: GameState) => void;
  helper1344C?: (state: GameState) => void;
  levelInit16F6C?: (state: GameState) => void;
  objectInit259B4?: (state: GameState) => void;
  lateLogic26F3E?: (state: GameState) => void;
  scrollStep26E14?: (state: GameState, value: number) => void;
  objectDirtyDispatch?: (state: GameState) => void; // FUN_28624
  renderString?: (state: GameState, slotAddr: number, ordinal: number) => void; // FUN_286EE subset
  gameStateBanner?: (state: GameState, gameMode: number) => void; // FUN_26B2A
  soundCmd?: (state: GameState, cmd: number) => void; // FUN_158AC
  randomMod?: (state: GameState, maxExclusive: number) => number; // FUN_13A98
  render0142?: (state: GameState, textPtr: number, tileBase: number) => void;
  format28EB2?: (state: GameState) => void;
  wait28DB8?: (state: GameState, frames: number) => void;
  textPrint0118?: (state: GameState, textPtr: number) => void;
  helper16E8E?: (state: GameState, arg: number) => void;
  helper01BA?: (state: GameState, arg: number) => void;
  helper0236?: (state: GameState) => number;
  helper0230?: (state: GameState, arg: number) => number;
}

export interface MainLoopInit10504Options {
  /**
   * The middle of FUN_10504 contains long attract/name-entry presentation
   * loops. This slice defaults to skipping those presentation-only branches
   * after reproducing the deterministic setup and before the shared tail.
   */
  runPresentationMiddle?: boolean;
}

export function mainLoopInit10504(
  state: GameState,
  subs: MainLoopInit10504Subs = {},
  options: MainLoopInit10504Options = {},
  rom?: RomImage,
): void {
  const gameMode = rw(state, 0x00400394);
  const playerCount = rw(state, 0x00400396);

  (subs.clearPaletteRam ?? clearPaletteRam121A6)(state);
  (subs.hudFrameInit ?? (() => undefined))(state);
  (subs.slotArrayBulkInit ?? slotArrayBulkInit)(state);

  wb(state, 0x0040075c, 0);
  wb(state, 0x0040039c, 0);
  ww(state, 0x00400000, 0);
  ww(state, 0x00400002, 0);
  wb(state, 0x00400008, 0);
  wb(state, 0x00400006, 0);
  wb(state, 0x0040000a, 0);
  wl(state, 0x00400978, 0);
  wl(state, 0x00400974, 0);
  wl(state, 0x00400970, 0);
  wl(state, 0x00400408, 0x0040040c);
  wb(state, 0x0040075e, 1);
  wb(state, 0x00400762, 0);
  ww(state, 0x0040045c, 0);
  wb(state, 0x00400760, 0);
  wb(state, 0x0040045e, 0);
  wb(state, 0x00400460, 0xff);
  ww(state, 0x00400768, 0xffff);
  wb(state, 0x0040076a, 0);

  if (gameMode === 2) {
    (subs.soundMaybe11AC2 ?? ((s: GameState) => { if (rom !== undefined) soundMaybe11AC2(s, rom); }))(state);
  }

  const scrollBase = 0x0040097c;
  if (gameMode === 4) {
    (subs.scrollRange144E4 ?? ((s, from, to) => scrollRange144E4(s, rom, from, to)))(state, scrollBase + 0x19, scrollBase);
  } else {
    (subs.scrollRange144E4 ?? ((s, from, to) => scrollRange144E4(s, rom, from, to)))(state, scrollBase - 0x19, scrollBase);
  }

  (subs.stateDispatch12FD0 ?? stateDispatch12FD0)(state);
  wb(state, 0x0040039a, 1);
  (subs.vblankAck ?? vblankAck28DEA)(state);
  (subs.helper1344C ?? ((s) => { if (rom !== undefined) slapsticDispatcher1344C(s, rom); }))(state);

  if (gameMode === 0 && rw(state, 0x00400390) !== 1) {
    ww(state, 0x00400000, 0xff10);
    ww(state, 0x00400002, 0xff10);
  }

  (subs.levelInit16F6C ?? ((s) => { if (rom !== undefined) levelInit16F6C(s, rom); }))(state);
  (subs.objectInit259B4 ?? ((s) => { if (rom !== undefined) objectInit259B4(s, rom); }))(state);
  const lateLogic = subs.lateLogic26F3E ?? ((s: GameState) => { if (rom !== undefined) lateGameLogic26F3E(s, rom); });
  lateLogic(state);
  lateLogic(state);
  wb(state, 0x0040039a, 1);
  (subs.vblankAck ?? vblankAck28DEA)(state);

  if (gameMode === 0 && rw(state, 0x00400390) !== 1) {
    (subs.scrollStep26E14 ?? pfScrollEmit26E14)(state, rw(state, 0x00400000));
  }

  wb(state, 0x0040039a, 1);
  (subs.vblankAck ?? vblankAck28DEA)(state);
  const render0142 = subs.render0142 ?? ((s: GameState, ptr: number, tile: number) => {
    if (rom !== undefined) stateSub2572(s, rom, ptr, tile);
  });
  render0142(state, 0x22b16, 0x1c00);
  render0142(state, 0x22b22, 0x2000);
  if (playerCount === 2) {
    render0142(state, 0x22b2e, 0x1c00);
    render0142(state, 0x22b3a, 0x2400);
  }
  wb(state, 0x0040039c, ((playerCount - 1) | playerCount) & 0xff);
  (subs.objectDirtyDispatch ?? ((s) => {
    if (rom !== undefined) objDirtyDispatch28624(s, rom.program.subarray(0x23d3a, 0x23e3a));
  }))(state);

  for (let i = 0; i < playerCount; i++) {
    (subs.renderString ?? ((s, slot, ord) => { if (rom !== undefined) renderString286EE(s, rom, slot, ord); }))(state, objectSlotAddr(i) + 0x6a, playerCount + i - 1);
  }

  (subs.vblankAck ?? vblankAck28DEA)(state);
  subs.gameStateBanner?.(state, gameMode);
  if (gameMode === 0) {
    subs.soundCmd?.(state, 0);
  }

  if (options.runPresentationMiddle === true) {
    runPresentationMiddle(state, subs, gameMode, playerCount, rom);
  }

  addByte(state, 0x004003f0, 1);
  if (gameMode !== 0) {
    subs.soundCmd?.(state, gameMode);
  }

  wb(state, 0x004003e0, 0);
  for (let i = 0; i < playerCount; i++) {
    const base = objectSlotAddr(i);
    if (rb(state, base + 0x18) !== 0) {
      wb(state, base + 0x6e, 5);
      wb(state, base + 0x1a, 0);
      wl(state, base + 0x04, 0);
      wl(state, base + 0x00, 0);
      addByte(state, 0x004003e0, 1);
    }
    (subs.renderString ?? ((s, slot, ord) => { if (rom !== undefined) renderString286EE(s, rom, slot, ord); }))(state, base + 0x6a, playerCount + i - 1);
  }

  if (gameMode === 3) {
    subs.soundCmd?.(state, 0x43);
  }
  if (gameMode === 5) {
    wb(state, 0x00400460, 0);
  }
  wb(state, 0x004003a4, 0xff);
  wb(state, 0x0040076c, 1);
  wb(state, 0x00400444, (subs.randomMod ?? randomMod13A98)(state, 0x100) & 0xff);
}

function runPresentationMiddle(
  state: GameState,
  subs: MainLoopInit10504Subs,
  gameMode: number,
  _playerCount: number,
  rom?: RomImage,
): void {
  if (rw(state, 0x00400390) === 1) {
    ww(state, 0x00400082, 0x003c);
    return;
  }
  const render0142 = subs.render0142 ?? ((s: GameState, ptr: number, tile: number) => {
    if (rom !== undefined) stateSub2572(s, rom, ptr, tile);
  });
  render0142(state, gameMode < 2 ? 0x2291e : 0x22942, 0x3000);
  render0142(state, 0x1f15e + gameMode * 4, 0x3000);
  render0142(state, 0x1f176 + gameMode * 4, 0x3400);
}

export const MAIN_LOOP_INIT_10504_ADDR = 0x00010504 as const;
export const MAIN_LOOP_INIT_10504_SUB_ADDRS = [
  0x000121a6, 0x000283c2, 0x00010392, 0x00011ac2, 0x000144e4,
  0x00012fd0, 0x00028dea, 0x0001344c, 0x00016f6c, 0x000259b4,
  0x00026f3e, 0x00026e14, 0x00028624, 0x000286ee, 0x00026b2a,
  0x000158ac, 0x00013a98,
] as const;
