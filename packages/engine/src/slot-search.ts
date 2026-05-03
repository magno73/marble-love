/**
 * slot-search.ts — `FUN_00014BCE` (62 byte) + `FUN_00014C0C` (58 byte).
 *
 * - **FUN_14BCE — `findFreeSlotInTable()`**: scansiona 4 entry struct
 *   pointers da ROM table @ 0x1F006 (stride 4). Per ogni: se byte+0x18==0
 *   (free), salva. Returns last free slot address (o -1).
 *
 * - **FUN_14C0C — `slotMatchesPtr(arg)`**: scansiona array @ 0x401302
 *   stride 0x60, 4 entries. Returns 1 se trova match (byte+0x18 != 0 AND
 *   *(slot+0x4E) == *(arg+2)), else 0.
 */

import type { GameState } from "./state.js";
import type { RomImage } from "./bus.js";

const ROM_PTR_TABLE = 0x1f006 as const;
const SLOT_STRIDE = 0x60 as const;
const SLOT_BASE_ADDR = 0x401302 as const;

function readU32Workram(state: GameState, off: number): number {
  return (
    (((state.workRam[off] ?? 0) << 24) |
      ((state.workRam[off + 1] ?? 0) << 16) |
      ((state.workRam[off + 2] ?? 0) << 8) |
      (state.workRam[off + 3] ?? 0)) >>> 0
  );
}
function readU32Rom(rom: RomImage, addr: number): number {
  return (
    (((rom.program[addr] ?? 0) << 24) |
      ((rom.program[addr + 1] ?? 0) << 16) |
      ((rom.program[addr + 2] ?? 0) << 8) |
      (rom.program[addr + 3] ?? 0)) >>> 0
  );
}

export function findFreeSlotInTable(state: GameState, rom: RomImage): number {
  let result = 0xffffffff;
  for (let i = 0; i < 4; i++) {
    const ptr = readU32Rom(rom, ROM_PTR_TABLE + i * 4);
    const ptrOff = (ptr - 0x400000) >>> 0;
    const byteAt18 = state.workRam[ptrOff + 0x18] ?? 0;
    if (byteAt18 === 0) {
      result = ptr;
    }
  }
  return result;
}

export function slotMatchesPtr(state: GameState, argPtr: number): number {
  const r = state.workRam;
  const argOff = argPtr - 0x400000;
  // *(arg+2) is a long
  const target = readU32Workram(state, argOff + 2);
  for (let i = 0; i < 4; i++) {
    const slotOff = (SLOT_BASE_ADDR + i * SLOT_STRIDE) - 0x400000;
    const byteAt18 = r[slotOff + 0x18] ?? 0;
    if (byteAt18 !== 0) {
      const fld4E = readU32Workram(state, slotOff + 0x4E);
      if (fld4E === target) return 1;
    }
  }
  return 0;
}

/** Replica `FUN_000159D8` — scan @ 0x4009A4, stride 0x7C, 2 entries, match field+0x72. */
export function slotMatchesPtr_4009A4(state: GameState, argPtr: number): number {
  const argOff = argPtr - 0x400000;
  const target = readU32Workram(state, argOff + 2);
  for (let i = 0; i < 2; i++) {
    const slotOff = (0x4009A4 + i * 0x7C) - 0x400000;
    const byteAt18 = state.workRam[slotOff + 0x18] ?? 0;
    if (byteAt18 !== 0) {
      const fld = readU32Workram(state, slotOff + 0x72);
      if (fld === target) return 1;
    }
  }
  return 0;
}

/** Replica `FUN_0001599A` — find free slot in 2-entry ROM table @ 0x1EFFE. */
export function findFreeSlotInTable_1EFFE(state: GameState, rom: RomImage): number {
  let result = 0xffffffff;
  for (let i = 0; i < 2; i++) {
    const ptr = readU32Rom(rom, 0x1effe + i * 4);
    const ptrOff = (ptr - 0x400000) >>> 0;
    const byteAt18 = state.workRam[ptrOff + 0x18] ?? 0;
    if (byteAt18 === 0) {
      result = ptr;
    }
  }
  return result;
}

/**
 * Replica `FUN_00012D6E` — find FIRST free in ROM table @ 0x1F016, 25 entries.
 * Returns first ptr where byte+0x18 == 0, or -1 if none.
 */
export function findFirstFreeSlot_1F016(state: GameState, rom: RomImage): number {
  let result = 0xffffffff;
  for (let i = 0; i < 0x19; i++) {
    const ptr = readU32Rom(rom, 0x1f016 + i * 4);
    const ptrOff = (ptr - 0x400000) >>> 0;
    const byteAt18 = state.workRam[ptrOff + 0x18] ?? 0;
    if (byteAt18 === 0) {
      result = ptr;
      break; // EARLY exit (FIRST free)
    }
  }
  return result;
}

/** Replica `FUN_0001730C` — scan @ 0x401482, stride 0x42, 7 entries, match field+0x30. */
export function slotMatchesPtr_401482(state: GameState, argPtr: number): number {
  const argOff = argPtr - 0x400000;
  const target = readU32Workram(state, argOff + 2);
  for (let i = 0; i < 7; i++) {
    const slotOff = (0x401482 + i * 0x42) - 0x400000;
    const byteAt18 = state.workRam[slotOff + 0x18] ?? 0;
    if (byteAt18 !== 0) {
      const fld = readU32Workram(state, slotOff + 0x30);
      if (fld === target) return 1;
    }
  }
  return 0;
}
