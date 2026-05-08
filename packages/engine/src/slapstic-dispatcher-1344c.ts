/**
 * slapstic-dispatcher-1344c.ts — replica `FUN_0001344C`.
 *
 * This helper gates one pending playfield update record at `0x400970`. When a
 * record exists it brackets the update with two slapstic table lookups, renders
 * visible tile rows into playfield RAM, applies an optional workRam patch list,
 * then clears the pending-record pointer.
 */

import type { RomImage } from "./bus.js";
import type { GameState } from "./state.js";
import { decodeBitstream1A668 } from "./decode-bitstream-1a668.js";
import { levelHelper2FFB8 } from "./level-helper-2ffb8.js";

const WRAM = 0x00400000;
const WRAM_END = 0x00402000;
const PF = 0x00a00000;
const PF_END = 0x00a02000;
const ROM_END = 0x00088000;

const PENDING_RECORD = 0x00400970;
const ACTIVE_RECORD = 0x00400978;
const CURRENT_OBJECT = 0x00400974;
const CAMERA_Y = 0x0040097c;
const LEVEL_STRUCT_PTR = 0x00400474;

export const SLAPSTIC_DISPATCHER_1344C_ADDR = 0x0001344c as const;

export interface SlapsticDispatcher1344CSubs {
  fun_2ffb8?: (state: GameState, rom: RomImage, argLong: number) => number;
  fun_1a668?: (state: GameState, rom: RomImage, outAbs: number, ctrlAbs: number, extAbs: number) => void;
}

function off(abs: number): number {
  return abs - WRAM;
}

function toS8(v: number): number {
  const b = v & 0xff;
  return b & 0x80 ? b - 0x100 : b;
}

function toS16(v: number): number {
  const w = v & 0xffff;
  return w & 0x8000 ? w - 0x10000 : w;
}

function readAbsU8(state: GameState, rom: RomImage, abs: number): number {
  const a = abs >>> 0;
  if (a < ROM_END) return (rom.program[a] ?? 0) & 0xff;
  if (a >= WRAM && a < WRAM_END) return (state.workRam[a - WRAM] ?? 0) & 0xff;
  return 0;
}

function readAbsU16(state: GameState, rom: RomImage, abs: number): number {
  return ((readAbsU8(state, rom, abs) << 8) | readAbsU8(state, rom, (abs + 1) >>> 0)) & 0xffff;
}

function readAbsU32(state: GameState, rom: RomImage, abs: number): number {
  return ((readAbsU8(state, rom, abs) << 24) |
    (readAbsU8(state, rom, (abs + 1) >>> 0) << 16) |
    (readAbsU8(state, rom, (abs + 2) >>> 0) << 8) |
    readAbsU8(state, rom, (abs + 3) >>> 0)) >>> 0;
}

function rw(state: GameState, abs: number): number {
  const o = off(abs);
  return (((state.workRam[o] ?? 0) << 8) | (state.workRam[o + 1] ?? 0)) & 0xffff;
}

function rl(state: GameState, abs: number): number {
  const o = off(abs);
  return (((state.workRam[o] ?? 0) << 24) |
    ((state.workRam[o + 1] ?? 0) << 16) |
    ((state.workRam[o + 2] ?? 0) << 8) |
    (state.workRam[o + 3] ?? 0)) >>> 0;
}

function wl(state: GameState, abs: number, value: number): void {
  const o = off(abs);
  const v = value >>> 0;
  state.workRam[o] = (v >>> 24) & 0xff;
  state.workRam[o + 1] = (v >>> 16) & 0xff;
  state.workRam[o + 2] = (v >>> 8) & 0xff;
  state.workRam[o + 3] = v & 0xff;
}

function wwWork(state: GameState, abs: number, value: number): void {
  const o = off(abs);
  const v = value & 0xffff;
  if (o < 0 || o + 1 >= state.workRam.length) return;
  state.workRam[o] = (v >>> 8) & 0xff;
  state.workRam[o + 1] = v & 0xff;
}

function wwPlayfield(state: GameState, abs: number, value: number): void {
  const a = abs >>> 0;
  if (a < PF || a + 1 >= PF_END) return;
  const o = a - PF;
  const v = value & 0xffff;
  state.playfieldRam[o] = (v >>> 8) & 0xff;
  state.playfieldRam[o + 1] = v & 0xff;
}

function normalizePfRowStart(abs: number): number {
  let a = abs >>> 0;
  if (a < PF) a = (a + 0x2000) >>> 0;
  if (a > PF_END - 1) a = (a - 0x2000) >>> 0;
  return a;
}

function renderDirectRows(
  state: GameState,
  rom: RomImage,
  srcAbs: number,
  destAbs: number,
  width: number,
  rows: number,
): void {
  let src = srcAbs >>> 0;
  let dest = destAbs >>> 0;
  for (let row = 0; row < rows; row++) {
    dest = normalizePfRowStart(dest);
    let p = dest;
    for (let col = 0; col < width; col++) {
      wwPlayfield(state, p, readAbsU16(state, rom, src));
      src = (src + 2) >>> 0;
      p = (p + 2) >>> 0;
    }
    dest = (p + (0x40 - width) * 2) >>> 0;
  }
}

export function slapsticDispatcher1344C(
  state: GameState,
  rom: RomImage,
  subs: SlapsticDispatcher1344CSubs = {},
): void {
  const pending = rl(state, PENDING_RECORD);
  if (pending === 0) return;

  const fun2ffb8 = subs.fun_2ffb8 ?? ((_state, r, arg) => levelHelper2FFB8(r, arg));
  const fun1a668 = subs.fun_1a668 ?? decodeBitstream1A668;
  fun2ffb8(state, rom, toS16(rw(state, 0x00400664)));

  const obj = rl(state, CURRENT_OBJECT);
  if (readAbsU8(state, rom, obj + 0x1e) === 1) {
    let src = readAbsU32(state, rom, pending);
    const isSpecial = readAbsU8(state, rom, obj + 0x1f) === 0x19;
    let width = 0x24;
    let height = 0x1e;
    if (!isSpecial) {
      width = toS8(readAbsU8(state, rom, src));
      height = toS8(readAbsU8(state, rom, src + 1));
      src = (src + 2) >>> 0;
    }

    const levelStruct = rl(state, LEVEL_STRUCT_PTR);
    const rowDelta = ((rl(state, CAMERA_Y) - toS16(readAbsU16(state, rom, levelStruct + 0x10))) >> 3) -
      toS16(readAbsU16(state, rom, obj + 0x28)) - 1;
    const startRow = rowDelta >= 0 ? rowDelta : 0;
    const backfill = -rowDelta >= 0 ? -rowDelta : 0;

    if (height > startRow && backfill < 0x21) {
      const scrollRows = ((toS16(rw(state, 0x00400000)) >> 3) + backfill - 1) | 0;
      let dest = (PF + 6 + toS16(readAbsU16(state, rom, obj + 0x26)) * 2 + scrollRows * 0x80) >>> 0;
      dest = normalizePfRowStart(dest);

      let endRow = height - rowDelta;
      if (endRow > 0x21) endRow = 0x21;
      const rows = Math.max(0, (endRow + rowDelta) - startRow);

      if (isSpecial) {
        const table = readAbsU32(state, rom, 0x0002be14);
        const ctrlBase = (readAbsU32(state, rom, table + 4) + (toS16(src) + startRow) * 2) >>> 0;
        let ext = (readAbsU32(state, rom, table + 0x2a) + 0x4e + startRow) >>> 0;
        let out = dest;
        let ctrl = ctrlBase;
        for (let row = 0; row < rows; row++) {
          out = normalizePfRowStart(out);
          const extAbs = (readAbsU8(state, rom, ext) + 0x0002be18) >>> 0;
          ext = (ext + 1) >>> 0;
          const ctrlAbs = (toS16(readAbsU16(state, rom, ctrl)) + 0x000800e4) >>> 0;
          ctrl = (ctrl + 2) >>> 0;
          fun1a668(state, rom, out, ctrlAbs, extAbs);
          out = (out + 0x80) >>> 0;
        }
      } else {
        renderDirectRows(state, rom, (src + width * 2 * startRow) >>> 0, dest, width, rows);
      }

      wl(state, ACTIVE_RECORD, pending);
    }
  }

  const patchPtr = readAbsU32(state, rom, pending + 4);
  if (patchPtr !== 0) {
    let p = patchPtr >>> 0;
    let dest = (0x0040076e + toS16(readAbsU16(state, rom, p)) * 2) >>> 0;
    p = (p + 2) >>> 0;
    const count = readAbsU16(state, rom, p);
    p = (p + 2) >>> 0;
    for (let i = 0; i < count; i++) {
      wwWork(state, dest, readAbsU16(state, rom, p));
      p = (p + 2) >>> 0;
      dest = (dest + 2) >>> 0;
    }
  }

  wl(state, PENDING_RECORD, 0);
  fun2ffb8(state, rom, toS16(rw(state, 0x00400662)));
}

export { slapsticDispatcher1344C as FUN_0001344C };
