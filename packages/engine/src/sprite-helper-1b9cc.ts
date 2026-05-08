/**
 * sprite-helper-1b9cc.ts — replica `FUN_0001B9CC`.
 *
 * Updates the sprite-position globals via `FUN_1BAB2`, computes the packed
 * screen-space key for an object, and maintains the three-entry MRU cache at
 * `obj+0x1E`.
 */

import type { GameState } from "./state.js";
import { spritePosUpdate1BAB2 } from "./sprite-pos-update-1bab2.js";

const WRAM = 0x00400000;

export const SPRITE_HELPER_1B9CC_ADDR = 0x0001b9cc as const;

export interface SpriteHelper1B9CCSubs {
  fun_1bab2?: (state: GameState, objAbs: number) => void;
}

function off(abs: number): number {
  return abs - WRAM;
}

function readU8(state: GameState, abs: number): number {
  return state.workRam[off(abs)] ?? 0;
}

function readU16(state: GameState, abs: number): number {
  const o = off(abs);
  return (((state.workRam[o] ?? 0) << 8) | (state.workRam[o + 1] ?? 0)) & 0xffff;
}

function writeU16(state: GameState, abs: number, value: number): void {
  const o = off(abs);
  const v = value & 0xffff;
  state.workRam[o] = (v >>> 8) & 0xff;
  state.workRam[o + 1] = v & 0xff;
}

function readU32(state: GameState, abs: number): number {
  const o = off(abs);
  return (((state.workRam[o] ?? 0) << 24) |
    ((state.workRam[o + 1] ?? 0) << 16) |
    ((state.workRam[o + 2] ?? 0) << 8) |
    (state.workRam[o + 3] ?? 0)) >>> 0;
}

function writeU32(state: GameState, abs: number, value: number): void {
  const o = off(abs);
  const v = value >>> 0;
  state.workRam[o] = (v >>> 24) & 0xff;
  state.workRam[o + 1] = (v >>> 16) & 0xff;
  state.workRam[o + 2] = (v >>> 8) & 0xff;
  state.workRam[o + 3] = v & 0xff;
}

function toS16(value: number): number {
  const w = value & 0xffff;
  return (w & 0x8000) !== 0 ? w - 0x10000 : w;
}

export function spriteHelper1B9CC(
  state: GameState,
  objAbs: number,
  flagLong: number,
  subs: SpriteHelper1B9CCSubs = {},
): void {
  if ((flagLong & 0xff) !== 0) {
    writeU16(state, 0x00400698, 0xffff);
    writeU16(state, 0x00400696, 0xffff);
  }

  (subs.fun_1bab2 ?? ((s, obj) => { spritePosUpdate1BAB2(s, obj); }))(state, objAbs);

  let z = readU16(state, objAbs + 0x14);
  const type = readU8(state, objAbs + 0x58);
  if ((type === 0x2f || type === 0x30 || type === 0x31) && (readU8(state, 0x00400691) & 1) !== 0) {
    const xLong = readU32(state, objAbs);
    const magnitude = (xLong & 0x80000000) !== 0 ? ((-((xLong | 0))) >>> 0) : xLong;
    if (magnitude > 0x4000) z = (z + 2) & 0xffff;
  }

  const screenY = (readU16(state, 0x00400692) - readU16(state, 0x00400690) + 0x88) & 0xffff;
  const avg = (toS16(readU16(state, 0x00400690)) + toS16(readU16(state, 0x00400692))) >> 1;
  const screenX = (readU16(state, 0x0040097e) + z + 0x54 - avg) & 0xffff;
  const packed = ((((screenY << 16) >>> 0) + screenX) >>> 0);

  if (readU32(state, objAbs + 0x1e) === packed || readU32(state, objAbs + 0x22) === packed) {
    return;
  }

  writeU32(state, objAbs + 0x26, readU32(state, objAbs + 0x22));
  writeU32(state, objAbs + 0x22, readU32(state, objAbs + 0x1e));
  writeU32(state, objAbs + 0x1e, packed);
}

export { spriteHelper1B9CC as FUN_0001B9CC };
