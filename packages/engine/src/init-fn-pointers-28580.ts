/**
 * init-fn-pointers-28580.ts — replica `FUN_00028580`.
 *
 * The routine delegates once to `FUN_014E`, then initializes four work-RAM
 * function-pointer fields used by later text/render dispatch.
 */

import type { RomImage } from "./bus.js";
import type { GameState } from "./state.js";

const WRAM = 0x00400000;

export const INIT_FN_POINTERS_28580_ADDR = 0x00028580 as const;

export interface InitFnPointers28580Subs {
  fun_014e?: (state: GameState) => void;
}

function off(abs: number): number {
  return abs - WRAM;
}

function writeU32(state: GameState, abs: number, value: number): void {
  const o = off(abs);
  const v = value >>> 0;
  state.workRam[o] = (v >>> 24) & 0xff;
  state.workRam[o + 1] = (v >>> 16) & 0xff;
  state.workRam[o + 2] = (v >>> 8) & 0xff;
  state.workRam[o + 3] = v & 0xff;
}

export function initFnPointers28580(
  state: GameState,
  rom?: RomImage,
  subs: InitFnPointers28580Subs = {},
): void {
  void rom;
  subs.fun_014e?.(state);
  writeU32(state, 0x00400412, 0x004006ac);
  writeU32(state, 0x0040041e, 0x004006d0);
  writeU32(state, 0x0040042a, 0x004006e2);
  writeU32(state, 0x00400436, 0x004006f4);
}

export { initFnPointers28580 as FUN_00028580 };
