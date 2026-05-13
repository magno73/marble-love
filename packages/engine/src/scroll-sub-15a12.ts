/**
 * scroll-sub-15a12.ts -- replica of FUN_00015A12.
 *
 * The scroll range dispatcher calls this when a row-boundary is crossed. It
 * walks the mode-specific descriptor list at ROM table 0x22706 and spawns or
 * clears the two object-pair slots at 0x4009A4/0x400A20.
 */

import type { GameState } from "./state.js";
import type { RomImage } from "./bus.js";
import {
  findFreeSlotInTable_1EFFE,
  slotMatchesPtr_4009A4,
} from "./slot-search.js";
import { spritePosUpdate1BAB2 } from "./sprite-pos-update-1bab2.js";
import { spriteProject1CC62 } from "./sprite-project-1cc62.js";
import { spriteHelper1B9CC } from "./sprite-helper-1b9cc.js";
import { slotInsertSorted18E6C } from "./slot-insert-sorted-18e6c.js";
import { stateSub15BD0 } from "./state-sub-15bd0.js";
import { sub1CABATileRedraw } from "./sub-1caba-tile-redraw.js";

const WORK_RAM_BASE = 0x00400000 as const;
const DESC_TABLE_BY_MODE = 0x00022706 as const;
const SLOT_PAIR_BASE = 0x004009a4 as const;
const SLOT_PAIR_STRIDE = 0x7c as const;
const SLOT_PAIR_COUNT = 2 as const;
const SPECIAL_DESC_PTR = 0x0002276e as const;

function off(abs: number): number {
  return (abs - WORK_RAM_BASE) >>> 0;
}

function rb(state: GameState, abs: number): number {
  return (state.workRam[off(abs)] ?? 0) & 0xff;
}

function wb(state: GameState, abs: number, value: number): void {
  state.workRam[off(abs)] = value & 0xff;
}

function rw(state: GameState, abs: number): number {
  const o = off(abs);
  return (((state.workRam[o] ?? 0) << 8) | (state.workRam[o + 1] ?? 0)) & 0xffff;
}

function ww(state: GameState, abs: number, value: number): void {
  const o = off(abs);
  const v = value & 0xffff;
  state.workRam[o] = (v >>> 8) & 0xff;
  state.workRam[o + 1] = v & 0xff;
}

function wl(state: GameState, abs: number, value: number): void {
  const o = off(abs);
  const v = value >>> 0;
  state.workRam[o] = (v >>> 24) & 0xff;
  state.workRam[o + 1] = (v >>> 16) & 0xff;
  state.workRam[o + 2] = (v >>> 8) & 0xff;
  state.workRam[o + 3] = v & 0xff;
}

function romB(rom: RomImage, addr: number): number {
  return (rom.program[addr >>> 0] ?? 0) & 0xff;
}

function romL(rom: RomImage, addr: number): number {
  const a = addr >>> 0;
  return (
    (((rom.program[a] ?? 0) << 24) |
      ((rom.program[a + 1] ?? 0) << 16) |
      ((rom.program[a + 2] ?? 0) << 8) |
      (rom.program[a + 3] ?? 0)) >>> 0
  );
}

function readAbsByte(state: GameState, rom: RomImage, addr: number): number {
  const a = addr >>> 0;
  if (a >= WORK_RAM_BASE && a < WORK_RAM_BASE + state.workRam.length) {
    return state.workRam[a - WORK_RAM_BASE] ?? 0;
  }
  return romB(rom, a);
}

function sextB(value: number): number {
  const b = value & 0xff;
  return b & 0x80 ? b - 0x100 : b;
}

function sextW(value: number): number {
  const w = value & 0xffff;
  return w & 0x8000 ? w - 0x10000 : w;
}

function readGameMode(state: GameState): number {
  return rw(state, 0x00400394);
}

function descriptorTableForMode(state: GameState, rom: RomImage): number {
  return romL(rom, DESC_TABLE_BY_MODE + ((readGameMode(state) & 0xffff) << 2));
}

function crossesDescriptor(fromScaled: number, toScaled: number, descStart: number, descEnd: number): boolean {
  const from = sextB(fromScaled);
  const to = sextB(toScaled);
  const start = sextB(descStart);
  const end = sextB(descEnd);

  if (to !== start && to !== end) return false;
  if (from < start) return true;
  return from > end;
}

function initSlotFromDescriptor(
  state: GameState,
  rom: RomImage,
  slotAbs: number,
  descAbs: number,
): void {
  const targetPtr = romL(rom, descAbs + 2);
  wl(state, slotAbs + 0x6e, targetPtr);
  wl(state, slotAbs + 0x72, targetPtr);
  wb(state, slotAbs + 0x1b, romB(rom, descAbs + 6));
  ww(state, slotAbs + 0x76, sextB(romB(rom, descAbs)));
  ww(state, slotAbs + 0x78, sextB(romB(rom, descAbs + 1)));
  if (targetPtr === SPECIAL_DESC_PTR) {
    ww(state, slotAbs + 0x78, (rw(state, slotAbs + 0x78) - 0x10) & 0xffff);
  }

  const xByte = readAbsByte(state, rom, targetPtr);
  const yByte = readAbsByte(state, rom, targetPtr + 1);
  wl(state, slotAbs + 0x0c, (((sextB(xByte) << 19) + 0x40000) >>> 0));
  wl(state, slotAbs + 0x10, (((sextB(yByte) << 19) + 0x40000) >>> 0));

  ww(state, 0x00400698, 0xffff);
  ww(state, 0x00400696, 0xffff);
  spritePosUpdate1BAB2(state, slotAbs, {
    fun_1CABA: (s) => { sub1CABATileRedraw(s, rom); },
  });
  wl(state, slotAbs + 0x14, spriteProject1CC62(state, 0) >>> 0);

  wl(state, slotAbs + 0x04, 0);
  wl(state, slotAbs + 0x00, 0);
  wb(state, slotAbs + 0x18, 1);
  wb(state, slotAbs + 0x36, 0);
  wb(state, slotAbs + 0x1a, 0x20);
  wl(state, slotAbs + 0x22, 0);
  wl(state, slotAbs + 0x1e, 0);
  wb(state, slotAbs + 0x67, 0);
  wb(state, slotAbs + 0x56, 0);
  wb(state, slotAbs + 0x58, 0);

  for (let i = 0; i < 5; i++) {
    ww(state, slotAbs + 0x38 + i * 6, 0);
  }

  spriteHelper1B9CC(state, slotAbs, 0, {
    fun_1bab2: (s, obj) => {
      spritePosUpdate1BAB2(s, obj, {
        fun_1CABA: (s2) => { sub1CABATileRedraw(s2, rom); },
      });
    },
  });
  slotInsertSorted18E6C(state, rom, rb(state, slotAbs + 0x19), 2);
}

function clearSlotsLeavingRange(state: GameState, fromScaled: number, toScaled: number): void {
  const from = sextB(fromScaled);
  const to = sextB(toScaled);
  for (let i = 0; i < SLOT_PAIR_COUNT; i++) {
    const slotAbs = SLOT_PAIR_BASE + i * SLOT_PAIR_STRIDE;
    if (rb(state, slotAbs + 0x18) === 0) continue;

    const start = sextW(rw(state, slotAbs + 0x76));
    const end = sextW(rw(state, slotAbs + 0x78));
    let leaving = false;
    if (from === start && to < start) leaving = true;
    if (from === end && to > end) leaving = true;
    if (leaving) stateSub15BD0(state, slotAbs, 0, 1);
  }
}

export function scrollSub15A12(
  state: GameState,
  rom: RomImage,
  fromScaled: number,
  toScaled: number,
): void {
  let descAbs = descriptorTableForMode(state, rom);
  for (let safety = 0; safety < 0x100; safety++) {
    if (romB(rom, descAbs) === 0xff) break;

    const slotAbs = findFreeSlotInTable_1EFFE(state, rom) >>> 0;
    if (slotAbs === 0xffffffff) break;

    if (
      slotMatchesPtr_4009A4(state, descAbs) === 0 &&
      crossesDescriptor(fromScaled, toScaled, romB(rom, descAbs), romB(rom, descAbs + 1))
    ) {
      initSlotFromDescriptor(state, rom, slotAbs, descAbs);
    }

    descAbs = (descAbs + 8) >>> 0;
  }

  clearSlotsLeavingRange(state, fromScaled, toScaled);
}
