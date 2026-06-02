/**
 * state-sub-295a.ts — replica `FUN_0000295A`.
 *
 * Branch-A one-shot helper of the root game-state machine. Does not call JSR: it copies
 * words inside alpha RAM using the same ROM rotation tables as the
 * renderer stringhe.
 */

import type { RomImage } from "./bus.js";
import type { GameState } from "./state.js";

const ROTATION_OFF = 0x1f42 as const;
const ALPHA_BASE = 0x00a03000 as const;
const ROM_LIMIT_TABLE = 0x7294 as const;
const ROM_WIDTH_TABLE = 0x7298 as const;
const ROM_ROW_TABLE = 0x729c as const;
const ROM_STRIDE_TABLE = 0x72a0 as const;
const ROM_SHIFT_TABLE = 0x72a4 as const;

export interface StateSub295ASubs {
  // FUN_295A is a leaf; reserved for symmetry with other state-sub wrappers.
}

function readU16(state: GameState, off: number): number {
  return ((state.workRam[off] ?? 0) << 8) | (state.workRam[off + 1] ?? 0);
}

function readRomU16(rom: RomImage, addr: number): number {
  return (((rom.program[addr] ?? 0) << 8) | (rom.program[addr + 1] ?? 0)) & 0xffff;
}

function toI16(v: number): number {
  const w = v & 0xffff;
  return w & 0x8000 ? w - 0x10000 : w;
}

function aslWord(value: number, count: number): number {
  const n = count & 0x3f;
  if (n >= 16) return 0;
  return (value << n) & 0xffff;
}

function readAlphaWord(state: GameState, addr: number): number {
  const a = addr >>> 0;
  if (a >= ALPHA_BASE && a < ALPHA_BASE + state.alphaRam.length - 1) {
    const off = a - ALPHA_BASE;
    return (((state.alphaRam[off] ?? 0) << 8) | (state.alphaRam[off + 1] ?? 0)) & 0xffff;
  }
  return 0;
}

function writeAlphaWord(state: GameState, addr: number, value: number): void {
  const a = addr >>> 0;
  if (a >= ALPHA_BASE && a < ALPHA_BASE + state.alphaRam.length - 1) {
    const off = a - ALPHA_BASE;
    const v = value & 0xffff;
    state.alphaRam[off] = (v >>> 8) & 0xff;
    state.alphaRam[off + 1] = v & 0xff;
  }
}

export function stateSub295A(state: GameState, rom: RomImage, _subs?: StateSub295ASubs): void {
  const rotation = toI16(readU16(state, ROTATION_OFF));
  const rotIndex = (rotation * 2) | 0;

  let d5 = (ALPHA_BASE + (rotation !== 0 ? 0x2a * 2 : 0)) >>> 0;
  const rowDelta = toI16(readRomU16(rom, ROM_ROW_TABLE + rotIndex)) * 2;
  let d6 = (d5 + rowDelta) >>> 0;

  const shiftCount = rom.program[ROM_SHIFT_TABLE + rotIndex + 1] ?? 0;
  const width = toI16(aslWord(readRomU16(rom, ROM_WIDTH_TABLE + rotIndex), shiftCount));
  const stride = toI16(readRomU16(rom, ROM_STRIDE_TABLE + rotIndex));
  const limit = toI16(readRomU16(rom, ROM_LIMIT_TABLE + rotIndex));

  for (let d4 = 0; toI16(d4) < limit; d4 = (d4 + 1) & 0xffff) {
    d5 = (d5 + rowDelta) >>> 0;
    d6 = (d6 + rowDelta) >>> 0;

    for (let d3 = 0; toI16(d3) < width; d3 = (d3 + stride) & 0xffff) {
      const src = (d6 + toI16(d3) * 2) >>> 0;
      const dst = (d5 + toI16(d3) * 2) >>> 0;
      writeAlphaWord(state, dst, readAlphaWord(state, src));
    }
  }
}

export const STATE_SUB_295A_ADDR = 0x0000295a as const;
