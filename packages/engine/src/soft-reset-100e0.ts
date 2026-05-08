/**
 * soft-reset-100e0.ts — replica `FUN_000100E0`.
 *
 * The routine prepares an audio reset call (`FUN_0254`) using the current word
 * at `0x4003AE`, then updates frame/reset globals.
 */

import type { GameState } from "./state.js";

const WRAM = 0x00400000;

export const SOFT_RESET_100E0_ADDR = 0x000100e0 as const;

export interface SoftReset100E0Subs {
  fun_0254?: (state: GameState, argWord: number, zero: number) => void;
}

function off(abs: number): number {
  return abs - WRAM;
}

function readU16(state: GameState, abs: number): number {
  const o = off(abs);
  return (((state.workRam[o] ?? 0) << 8) | (state.workRam[o + 1] ?? 0)) & 0xffff;
}

function writeU8(state: GameState, abs: number, value: number): void {
  state.workRam[off(abs)] = value & 0xff;
}

function writeU16(state: GameState, abs: number, value: number): void {
  const o = off(abs);
  const v = value & 0xffff;
  state.workRam[o] = (v >>> 8) & 0xff;
  state.workRam[o + 1] = v & 0xff;
}

export function softReset100E0(
  state: GameState,
  subs: SoftReset100E0Subs = {},
): void {
  const audioArg = readU16(state, 0x004003ae);
  subs.fun_0254?.(state, audioArg, 0);

  writeU16(state, 0x004003b6, readU16(state, 0x004003b6) + 1);
  writeU8(state, 0x004003b2, 0);
  writeU16(state, 0x004003b8, 0x012c);
}

export { softReset100E0 as FUN_000100E0 };
