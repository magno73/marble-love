/**
 * object-init-259b4.ts — replica `FUN_000259B4`.
 *
 * Iterates the active player/object slots (`0x400018 + n*0xE2`) up to
 * `word[0x400396]`. Slots with state byte `3` are expanded from the current
 * level descriptor and normalized; all other state bytes are cleared to zero.
 */

import type { RomImage } from "./bus.js";
import type { GameState } from "./state.js";
import { objectArrayInit25B40 } from "./object-array-init-25b40.js";
import { objectEnter1281C } from "./object-enter-1281c.js";
import { slotInsertSorted18E6C } from "./slot-insert-sorted-18e6c.js";
import { spritePosUpdate1BAB2 } from "./sprite-pos-update-1bab2.js";
import { spriteProject1CC62 } from "./sprite-project-1cc62.js";
import { spriteRotate1C014 } from "./sprite-rotate-1c014.js";

const WRAM = 0x00400000;
const WRAM_END = 0x00402000;
const ROM_END = 0x00088000;
const OBJ_BASE = 0x00400018;
const OBJ_STRIDE = 0x00e2;

export const OBJECT_INIT_259B4_ADDR = 0x000259b4 as const;

export interface ObjectInit259B4Subs {
  fun_1bab2?: (objAbs: number) => void;
  fun_1cc62?: (argLong: number) => number;
  fun_25b40?: (objAbs: number) => void;
  fun_1b9cc?: (objAbs: number, argLong: number) => void;
  fun_1c014?: (objAbs: number) => void;
  fun_1281c?: (objAbs: number) => void;
  fun_18e6c?: (typeCode: number, subIdx: number) => void;
}

function off(abs: number): number {
  return abs - WRAM;
}

function readU8(state: GameState, abs: number): number {
  return state.workRam[off(abs)] ?? 0;
}

function writeU8(state: GameState, abs: number, value: number): void {
  state.workRam[off(abs)] = value & 0xff;
}

function readU16(state: GameState, abs: number): number {
  return (((state.workRam[off(abs)] ?? 0) << 8) | (state.workRam[off(abs) + 1] ?? 0)) & 0xffff;
}

function writeU16(state: GameState, abs: number, value: number): void {
  const o = off(abs);
  const v = value & 0xffff;
  state.workRam[o] = (v >>> 8) & 0xff;
  state.workRam[o + 1] = v & 0xff;
}

function readU32(state: GameState, abs: number): number {
  return ((((state.workRam[off(abs)] ?? 0) << 24) |
    ((state.workRam[off(abs) + 1] ?? 0) << 16) |
    ((state.workRam[off(abs) + 2] ?? 0) << 8) |
    (state.workRam[off(abs) + 3] ?? 0)) >>> 0);
}

function writeU32(state: GameState, abs: number, value: number): void {
  const o = off(abs);
  const v = value >>> 0;
  state.workRam[o] = (v >>> 24) & 0xff;
  state.workRam[o + 1] = (v >>> 16) & 0xff;
  state.workRam[o + 2] = (v >>> 8) & 0xff;
  state.workRam[o + 3] = v & 0xff;
}

function readAbsU8(state: GameState, rom: RomImage, abs: number): number {
  const a = abs >>> 0;
  if (a >= WRAM && a < WRAM_END) return state.workRam[a - WRAM] ?? 0;
  if (a < ROM_END) return rom.program[a] ?? 0;
  return 0;
}

function readAbsU16(state: GameState, rom: RomImage, abs: number): number {
  return ((readAbsU8(state, rom, abs) << 8) | readAbsU8(state, rom, abs + 1)) & 0xffff;
}

function signExtendByte(value: number): number {
  const b = value & 0xff;
  return (b & 0x80) !== 0 ? b - 0x100 : b;
}

export function objectInit259B4(
  state: GameState,
  rom: RomImage,
  subs: ObjectInit259B4Subs = {},
): void {
  const fun1bab2 = subs.fun_1bab2 ?? ((objAbs: number): void => { spritePosUpdate1BAB2(state, objAbs); });
  const fun1cc62 = subs.fun_1cc62 ?? ((argLong: number): number => spriteProject1CC62(state, argLong));
  const fun25b40 = subs.fun_25b40 ?? ((objAbs: number): void => { objectArrayInit25B40(state, rom, objAbs); });
  const fun1b9cc = subs.fun_1b9cc ?? ((): void => undefined);
  const fun1c014 = subs.fun_1c014 ?? ((objAbs: number): void => { spriteRotate1C014(state, rom, objAbs - WRAM); });
  const fun1281c = subs.fun_1281c ?? ((objAbs: number): void => { objectEnter1281C(state, objAbs, () => 0); });
  const fun18e6c = subs.fun_18e6c ?? ((typeCode: number, subIdx: number): void => {
    slotInsertSorted18E6C(state, rom, typeCode, subIdx);
  });

  const count = readU16(state, 0x00400396);
  const statePtr = readU32(state, 0x00400474);
  const gameMode = readU16(state, 0x00400394);

  for (let i = 0; i !== count; i++) {
    const obj = OBJ_BASE + i * OBJ_STRIDE;
    if (readU8(state, obj + 0x18) !== 3) {
      writeU8(state, obj + 0x18, 0);
      continue;
    }

    const packed = readAbsU16(state, rom, statePtr + 0x14 + i * 2);
    const hi = (packed >>> 8) & 0xff;
    const lo = packed & 0xff;

    writeU8(state, obj + 0x70, 0xff);
    writeU8(state, obj + 0x71, 0xff);
    writeU32(state, obj + 0x0c, (0x00040000 + hi * 0x00080000) >>> 0);
    writeU32(state, obj + 0x10, (0x00040000 + lo * 0x00080000) >>> 0);
    writeU16(state, 0x00400698, 0xffff);
    writeU16(state, 0x00400696, 0xffff);

    fun1bab2(obj);
    writeU32(state, obj + 0x14, fun1cc62(0));
    writeU16(state, obj + 0xc4, 0);
    writeU8(state, obj + 0x1b, 0);
    writeU32(state, obj + 0x08, 0);
    writeU32(state, obj + 0x04, 0);
    writeU32(state, obj + 0x00, 0);
    writeU8(state, obj + 0x57, 0);
    writeU8(state, obj + 0x56, 0);
    writeU8(state, obj + 0x1a, 0);
    writeU8(state, obj + 0x18, 1);
    writeU32(state, obj + 0x5a, 0);
    writeU8(state, obj + 0x36, 0);
    writeU8(state, obj + 0x58, 0);
    writeU8(state, obj + 0xcb, 0);
    writeU8(state, obj + 0xd8, 0);
    writeU8(state, obj + 0x67, 0);
    writeU8(state, obj + 0xd1, 0);
    writeU32(state, obj + 0x26, 0);
    writeU32(state, obj + 0x22, 0);

    fun25b40(obj);
    fun1b9cc(obj, 0);
    fun1c014(obj);
    fun1281c(obj);

    if (gameMode < 2) writeU16(state, obj + 0x6a, 0);
    writeU8(state, obj + 0x6c, 9);
    writeU8(state, obj + 0x6e, 0xff);
    fun18e6c(1, signExtendByte(readU8(state, obj + 0x19)));

    if (gameMode === 3) {
      writeU8(state, obj + 0x58, readU8(state, obj + 0x19) === 0 ? 0x17 : 0x18);
      writeU8(state, obj + 0x59, 0xff);
    }
  }
}

export { objectInit259B4 as FUN_000259B4 };
