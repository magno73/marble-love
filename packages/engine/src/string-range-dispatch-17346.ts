/**
 * string-range-dispatch-17346.ts — replica `FUN_00017346`.
 *
 * "String slot" range-boundary dispatcher. It is called from
 * `scrollRange144E4` between `FUN_14C46` and `FUN_12DFA`, and owns the
 * 7-slot array at `0x401482` (stride `0x42`). When a scroll boundary is
 * crossed it initializes one or more string slots, computes their projected
 * coordinates, and inserts entity type `0x0e` into the draw list.
 */

import type { GameState } from "./state.js";
import type { RomImage } from "./bus.js";
import { deriveSpriteFromArg_v1 } from "./sprite-derive.js";

export const STRING_RANGE_DISPATCH_17346_ADDR = 0x00017346 as const;

const WORK_RAM_BASE = 0x00400000 as const;
const ROM_TABLE = 0x00023d4a as const;
const ENTRY_SENTINEL = 0xff as const;
const ENTRY_STRIDE = 8 as const;
const ENTRY_MAX_ITER = 256 as const;

export const STRING_SLOT_BASE_ADDR = 0x00401482 as const;
export const STRING_SLOT_STRIDE = 0x42 as const;
export const STRING_SLOT_COUNT = 7 as const;

const SLOT_ACTIVE_OFF = 0x18 as const;
const SLOT_SUBIDX_OFF = 0x19 as const;
const SLOT_STATE_OFF = 0x1a as const;
const SLOT_KIND_OFF = 0x1b as const;
const SLOT_POS_X_OFF = 0x0c as const;
const SLOT_POS_Y_OFF = 0x10 as const;
const SLOT_PROJECT_RET_OFF = 0x14 as const;
const SLOT_COORD_OFF = 0x28 as const;
const SLOT_CURSOR_OFF = 0x2c as const;
const SLOT_BASE_PTR_OFF = 0x30 as const;
const SLOT_LOW_BOUND_OFF = 0x34 as const;
const SLOT_HIGH_BOUND_OFF = 0x36 as const;

const RANDOM_LIMIT = 2 as const;
const LIST_KIND_SINGLE = 5 as const;
const TYPE_CODE = 0x0e as const;

const SINGLE_TABLE_A = 0x00023d62 as const;
const SINGLE_TABLE_B = 0x00023d66 as const;
const GROUP_TABLE_A = 0x00023d6a as const;
const GROUP_TABLE_B = 0x00023d82 as const;

export interface StringRangeDispatch17346Subs {
  /** `FUN_00013A98(limit=2)`. Default is deterministic `0`. */
  fun_13a98?: (state: GameState, limit: number) => number;
  /** `FUN_0001CC62(arg=1)`. Default no-op return `0`. */
  fun_1cc62?: (state: GameState, arg: number) => number;
  /** `FUN_0001D1EC(slotPtr)`. Default no-op. */
  fun_1d1ec?: (state: GameState, slotPtr: number) => void;
  /** `FUN_0001778E(slotPtr)`. Default no-op. */
  fun_1778e?: (state: GameState, slotPtr: number) => void;
  /** `FUN_00018E6C(typeCode=0x0e, subIdx=slot[0x19])`. Default no-op. */
  fun_18e6c?: (state: GameState, typeCode: number, subIdx: number) => void;
  /** `FUN_00018F46(typeCode=0x0e, subIdx=slot[0x19])`. Default no-op. */
  fun_18f46?: (state: GameState, typeCode: number, subIdx: number) => void;
}

export type StringRangeEntrySpawnKind = "single" | "group" | "direct";
export type StringRangeSlotAction = "init" | "teardown" | "noop";

export interface StringRangeEntryTrace {
  entryPtr: number;
  entryBytes: number[];
  matched: boolean;
  gated: boolean;
  spawnKind: StringRangeEntrySpawnKind | null;
  initializedSlots: number[];
}

export interface StringRangeSlotTrace {
  slotIdx: number;
  slotPtr: number;
  action: StringRangeSlotAction;
}

export interface StringRangeDispatch17346Result {
  mode: number;
  entryListPtr: number;
  emptyEntryList: boolean;
  entries: StringRangeEntryTrace[];
  slots: StringRangeSlotTrace[];
  fun13A98Calls: number;
  fun1CC62Calls: number;
  fun1D1ECCalls: number;
  fun1778ECalls: number;
  fun18E6CCalls: number;
  fun18F46Calls: number;
}

function r8(state: GameState, off: number): number {
  return (state.workRam[off] ?? 0) & 0xff;
}

function w8(state: GameState, off: number, value: number): void {
  state.workRam[off] = value & 0xff;
}

function rWordBE(state: GameState, off: number): number {
  return (((state.workRam[off] ?? 0) << 8) | (state.workRam[off + 1] ?? 0)) & 0xffff;
}

function wWordBE(state: GameState, off: number, value: number): void {
  const v = value & 0xffff;
  state.workRam[off] = (v >>> 8) & 0xff;
  state.workRam[off + 1] = v & 0xff;
}

function rLongBE(state: GameState, off: number): number {
  return (
    (((state.workRam[off] ?? 0) << 24) |
      ((state.workRam[off + 1] ?? 0) << 16) |
      ((state.workRam[off + 2] ?? 0) << 8) |
      (state.workRam[off + 3] ?? 0)) >>>
    0
  );
}

function wLongBE(state: GameState, off: number, value: number): void {
  const v = value >>> 0;
  state.workRam[off] = (v >>> 24) & 0xff;
  state.workRam[off + 1] = (v >>> 16) & 0xff;
  state.workRam[off + 2] = (v >>> 8) & 0xff;
  state.workRam[off + 3] = v & 0xff;
}

function romByte(rom: RomImage, off: number): number {
  return (rom.program[off >>> 0] ?? 0) & 0xff;
}

function romLongBE(rom: RomImage, off: number): number {
  const o = off >>> 0;
  return (
    ((rom.program[o] ?? 0) << 24) |
    ((rom.program[o + 1] ?? 0) << 16) |
    ((rom.program[o + 2] ?? 0) << 8) |
    (rom.program[o + 3] ?? 0)
  ) >>> 0;
}

function readByteAbs(state: GameState, rom: RomImage, addr: number): number {
  const a = addr >>> 0;
  if (a >= WORK_RAM_BASE && a < WORK_RAM_BASE + state.workRam.length) {
    return r8(state, a - WORK_RAM_BASE);
  }
  return romByte(rom, a);
}

function readLongAbs(state: GameState, rom: RomImage, addr: number): number {
  const a = addr >>> 0;
  if (a >= WORK_RAM_BASE && a < WORK_RAM_BASE + state.workRam.length) {
    return rLongBE(state, a - WORK_RAM_BASE);
  }
  return romLongBE(rom, a);
}

function sext8(value: number): number {
  const v = value & 0xff;
  return v & 0x80 ? v - 0x100 : v;
}

function sext16(value: number): number {
  const v = value & 0xffff;
  return v & 0x8000 ? v - 0x10000 : v;
}

function findFreeStringSlot(state: GameState): number {
  let result = 0xffffffff;
  for (let i = 0; i < STRING_SLOT_COUNT; i++) {
    const slotPtr = STRING_SLOT_BASE_ADDR + i * STRING_SLOT_STRIDE;
    const slotOff = slotPtr - WORK_RAM_BASE;
    if (r8(state, slotOff + SLOT_ACTIVE_OFF) === 0) result = slotPtr >>> 0;
  }
  return result >>> 0;
}

function slotMatchesRecord(state: GameState, rom: RomImage, entryPtr: number): boolean {
  const target = readLongAbs(state, rom, entryPtr + 2);
  for (let i = 0; i < STRING_SLOT_COUNT; i++) {
    const slotPtr = STRING_SLOT_BASE_ADDR + i * STRING_SLOT_STRIDE;
    const slotOff = slotPtr - WORK_RAM_BASE;
    if (r8(state, slotOff + SLOT_ACTIVE_OFF) === 0) continue;
    if (rLongBE(state, slotOff + SLOT_BASE_PTR_OFF) === target) return true;
  }
  return false;
}

function readEntryBytes(state: GameState, rom: RomImage, entryPtr: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < ENTRY_STRIDE; i++) out.push(readByteAbs(state, rom, entryPtr + i));
  return out;
}

function initStringSlot(
  state: GameState,
  rom: RomImage,
  slotPtr: number,
  dataPtr: number,
  entryBytes: number[],
  subs: StringRangeDispatch17346Subs | undefined,
  counters: {
    fun1CC62Calls: number;
    fun1D1ECCalls: number;
    fun1778ECalls: number;
    fun18E6CCalls: number;
  },
): void {
  const slotOff = (slotPtr - WORK_RAM_BASE) >>> 0;
  const e0 = entryBytes[0] ?? 0;
  const e1 = entryBytes[1] ?? 0;
  const e6 = entryBytes[6] ?? 0;

  wLongBE(state, slotOff + SLOT_CURSOR_OFF, dataPtr);
  wLongBE(state, slotOff + SLOT_BASE_PTR_OFF, dataPtr);
  w8(state, slotOff + SLOT_KIND_OFF, e6);
  wWordBE(state, slotOff + SLOT_LOW_BOUND_OFF, sext8(e0) & 0xffff);
  wWordBE(state, slotOff + SLOT_HIGH_BOUND_OFF, sext8(e1) & 0xffff);

  const dataByte0 = readByteAbs(state, rom, dataPtr);
  const dataByte1 = readByteAbs(state, rom, dataPtr + 1);
  wLongBE(state, slotOff + SLOT_POS_X_OFF, (sext8(dataByte0) << 19) >>> 0);
  wLongBE(state, slotOff + SLOT_POS_Y_OFF, (sext8(dataByte1) << 19) >>> 0);

  deriveSpriteFromArg_v1(state, slotPtr);

  const projectRet = (subs?.fun_1cc62?.(state, 1) ?? 0) >>> 0;
  counters.fun1CC62Calls++;
  wLongBE(state, slotOff + SLOT_PROJECT_RET_OFF, projectRet);

  wLongBE(state, slotOff + 0x04, 0);
  wLongBE(state, slotOff + 0x00, 0);
  w8(state, slotOff + SLOT_ACTIVE_OFF, 1);
  w8(state, slotOff + SLOT_STATE_OFF, 0);
  wLongBE(state, slotOff + SLOT_COORD_OFF, 0);

  subs?.fun_1d1ec?.(state, slotPtr);
  counters.fun1D1ECCalls++;
  subs?.fun_1778e?.(state, slotPtr);
  counters.fun1778ECalls++;

  subs?.fun_18e6c?.(state, TYPE_CODE, sext8(r8(state, slotOff + SLOT_SUBIDX_OFF)));
  counters.fun18E6CCalls++;
}

function chooseRandomTable(kind: number, randomBit: number): number {
  if ((kind & 0xff) === LIST_KIND_SINGLE) {
    return randomBit === 0 ? SINGLE_TABLE_A : SINGLE_TABLE_B;
  }
  return randomBit === 0 ? GROUP_TABLE_A : GROUP_TABLE_B;
}

/**
 * Replica `FUN_00017346`.
 *
 * Arg order mirrors `stateSub14C46`: `arg1` is loaded into D2.b and `arg2`
 * into D3.b by the original callee. `scrollRange144E4` therefore calls this
 * with `(fromScaled, toScaled)` after its stack-order adjustment.
 */
export function stringRangeDispatch17346(
  state: GameState,
  rom: RomImage,
  arg1: number,
  arg2: number,
  subs?: StringRangeDispatch17346Subs,
): StringRangeDispatch17346Result {
  const d2 = arg1 & 0xff;
  const d3 = arg2 & 0xff;
  const d2s = sext8(d2);

  const mode = rWordBE(state, 0x400394 - WORK_RAM_BASE);
  const tableIdxWord = (mode << 2) & 0xffff;
  const entryListPtr = romLongBE(rom, (ROM_TABLE + sext16(tableIdxWord)) >>> 0);

  const counters = {
    fun13A98Calls: 0,
    fun1CC62Calls: 0,
    fun1D1ECCalls: 0,
    fun1778ECalls: 0,
    fun18E6CCalls: 0,
    fun18F46Calls: 0,
  };
  const entries: StringRangeEntryTrace[] = [];
  let emptyEntryList = false;

  let entryPtr = entryListPtr >>> 0;
  for (let iter = 0; iter < ENTRY_MAX_ITER; iter++) {
    const entry0 = readByteAbs(state, rom, entryPtr);
    if (entry0 === ENTRY_SENTINEL) {
      if (iter === 0) emptyEntryList = true;
      break;
    }

    const entryBytes = readEntryBytes(state, rom, entryPtr);
    const trace: StringRangeEntryTrace = {
      entryPtr,
      entryBytes,
      matched: false,
      gated: false,
      spawnKind: null,
      initializedSlots: [],
    };

    const matched = slotMatchesRecord(state, rom, entryPtr);
    trace.matched = matched;
    if (matched) {
      entries.push(trace);
      entryPtr = (entryPtr + ENTRY_STRIDE) >>> 0;
      continue;
    }

    const e0 = entryBytes[0] ?? 0;
    const e1 = entryBytes[1] ?? 0;
    const d3MatchesBoundary = d3 === e0 || d3 === e1;
    if (!d3MatchesBoundary) {
      entries.push(trace);
      entryPtr = (entryPtr + ENTRY_STRIDE) >>> 0;
      continue;
    }

    const d2Outside = d2s < sext8(e0) || d2s > sext8(e1);
    if (!d2Outside) {
      entries.push(trace);
      entryPtr = (entryPtr + ENTRY_STRIDE) >>> 0;
      continue;
    }

    trace.gated = true;
    const entryLong = readLongAbs(state, rom, entryPtr + 2);
    let stopEntryWalk = false;

    if (entryLong === 0) {
      const kind = entryBytes[6] ?? 0;
      const spawnCount = (kind & 0xff) === LIST_KIND_SINGLE ? 1 : 6;
      const randomBit = (subs?.fun_13a98?.(state, RANDOM_LIMIT) ?? 0) & 0xffff;
      counters.fun13A98Calls++;
      let tablePtr = chooseRandomTable(kind, randomBit === 0 ? 0 : 1);
      trace.spawnKind = spawnCount === 1 ? "single" : "group";

      for (let i = 0; i < spawnCount; i++) {
        const slotPtr = findFreeStringSlot(state);
        if (slotPtr === 0xffffffff) {
          stopEntryWalk = true;
          break;
        }
        const dataPtr = romLongBE(rom, tablePtr);
        tablePtr = (tablePtr + 4) >>> 0;
        initStringSlot(state, rom, slotPtr, dataPtr, entryBytes, subs, counters);
        trace.initializedSlots.push(slotPtr);
      }
    } else {
      trace.spawnKind = "direct";
      const slotPtr = findFreeStringSlot(state);
      if (slotPtr === 0xffffffff) {
        stopEntryWalk = true;
      } else {
        initStringSlot(state, rom, slotPtr, entryLong, entryBytes, subs, counters);
        trace.initializedSlots.push(slotPtr);
      }
    }

    entries.push(trace);
    if (stopEntryWalk) break;
    entryPtr = (entryPtr + ENTRY_STRIDE) >>> 0;
  }

  const slots: StringRangeSlotTrace[] = [];
  for (let i = 0; i < STRING_SLOT_COUNT; i++) {
    const slotPtr = STRING_SLOT_BASE_ADDR + i * STRING_SLOT_STRIDE;
    const slotOff = slotPtr - WORK_RAM_BASE;
    const trace: StringRangeSlotTrace = {
      slotIdx: i,
      slotPtr,
      action: "noop",
    };

    if (r8(state, slotOff + SLOT_ACTIVE_OFF) !== 0) {
      const slotLow = sext16(rWordBE(state, slotOff + SLOT_LOW_BOUND_OFF));
      const slotHigh = sext16(rWordBE(state, slotOff + SLOT_HIGH_BOUND_OFF));
      const d2WordSigned = sext16(sext8(d2) & 0xffff);
      const d3WordSigned = sext16(sext8(d3) & 0xffff);
      const teardown =
        (d2WordSigned === slotLow && d3WordSigned < slotLow) ||
        (d2WordSigned === slotHigh && d3WordSigned > slotHigh);

      if (teardown) {
        w8(state, slotOff + SLOT_ACTIVE_OFF, 0);
        subs?.fun_18f46?.(state, TYPE_CODE, sext8(r8(state, slotOff + SLOT_SUBIDX_OFF)));
        counters.fun18F46Calls++;
        trace.action = "teardown";
      }
    }

    slots.push(trace);
  }

  return {
    mode,
    entryListPtr,
    emptyEntryList,
    entries,
    slots,
    ...counters,
  };
}
