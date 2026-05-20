import { describe, expect, it } from "vitest";
import { emptyRomImage } from "../src/bus.js";
import type { RomImage } from "../src/bus.js";
import { emptyGameState } from "../src/state.js";
import type { GameState } from "../src/state.js";
import {
  STRING_SLOT_BASE_ADDR,
  STRING_SLOT_STRIDE,
  stringRangeDispatch17346,
} from "../src/string-range-dispatch-17346.js";

const WRAM = 0x400000;
const ROM_TABLE = 0x23d4a;
const ENTRY_LIST = 0x10000;
const DATA_PTR = 0x10100;

function setByte(state: GameState, off: number, value: number): void {
  state.workRam[off] = value & 0xff;
}

function setWordBE(state: GameState, off: number, value: number): void {
  const v = value & 0xffff;
  state.workRam[off] = (v >>> 8) & 0xff;
  state.workRam[off + 1] = v & 0xff;
}

function readByte(state: GameState, off: number): number {
  return (state.workRam[off] ?? 0) & 0xff;
}

function readWordSigned(state: GameState, off: number): number {
  const value = (((state.workRam[off] ?? 0) << 8) | (state.workRam[off + 1] ?? 0)) & 0xffff;
  return value & 0x8000 ? value - 0x10000 : value;
}

function readLongBE(state: GameState, off: number): number {
  return (
    (((state.workRam[off] ?? 0) << 24) |
      ((state.workRam[off + 1] ?? 0) << 16) |
      ((state.workRam[off + 2] ?? 0) << 8) |
      (state.workRam[off + 3] ?? 0)) >>>
    0
  );
}

function setRomByte(rom: RomImage, off: number, value: number): void {
  rom.program[off] = value & 0xff;
}

function setRomLongBE(rom: RomImage, off: number, value: number): void {
  const v = value >>> 0;
  rom.program[off] = (v >>> 24) & 0xff;
  rom.program[off + 1] = (v >>> 16) & 0xff;
  rom.program[off + 2] = (v >>> 8) & 0xff;
  rom.program[off + 3] = v & 0xff;
}

function initStringSlotIds(state: GameState): void {
  for (let i = 0; i < 7; i++) {
    const off = STRING_SLOT_BASE_ADDR - WRAM + i * STRING_SLOT_STRIDE;
    setByte(state, off + 0x18, 0);
    setByte(state, off + 0x19, i);
  }
}

function pointModeAtEntryList(state: GameState, rom: RomImage): void {
  setWordBE(state, 0x394, 0);
  setRomLongBE(rom, ROM_TABLE, ENTRY_LIST);
}

describe("stringRangeDispatch17346 (FUN_00017346)", () => {
  it("spawns a single type0x0e string slot from the random single table", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();
    initStringSlotIds(state);
    pointModeAtEntryList(state, rom);

    setRomByte(rom, ENTRY_LIST, 10);
    setRomByte(rom, ENTRY_LIST + 1, 20);
    setRomLongBE(rom, ENTRY_LIST + 2, 0);
    setRomByte(rom, ENTRY_LIST + 6, 5);
    setRomByte(rom, ENTRY_LIST + 8, 0xff);
    setRomLongBE(rom, 0x23d62, DATA_PTR);
    setRomByte(rom, DATA_PTR, 5);
    setRomByte(rom, DATA_PTR + 1, 0xfd);

    const inserts: Array<[number, number]> = [];
    const result = stringRangeDispatch17346(state, rom, 5, 10, {
      fun_13a98: () => 0,
      fun_1cc62: () => 0xdeadbeef,
      fun_1d1ec: () => undefined,
      fun_1778e: () => undefined,
      fun_18e6c: (_s, typeCode, subIdx) => {
        inserts.push([typeCode, subIdx]);
      },
    });

    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]!.gated).toBe(true);
    expect(result.entries[0]!.spawnKind).toBe("single");
    expect(result.entries[0]!.initializedSlots).toEqual([0x40160e]);
    expect(result.fun13A98Calls).toBe(1);
    expect(result.fun18E6CCalls).toBe(1);
    expect(inserts).toEqual([[0x0e, 6]]);

    const slotOff = 0x40160e - WRAM;
    expect(readLongBE(state, slotOff + 0x2c)).toBe(DATA_PTR);
    expect(readLongBE(state, slotOff + 0x30)).toBe(DATA_PTR);
    expect(readByte(state, slotOff + 0x1b)).toBe(5);
    expect(readWordSigned(state, slotOff + 0x34)).toBe(10);
    expect(readWordSigned(state, slotOff + 0x36)).toBe(20);
    expect(readLongBE(state, slotOff + 0x0c)).toBe((5 << 19) >>> 0);
    expect(readLongBE(state, slotOff + 0x10)).toBe(((-3 << 19) | 0) >>> 0);
    expect(readLongBE(state, slotOff + 0x14)).toBe(0xdeadbeef);
    expect(readLongBE(state, slotOff + 0x00)).toBe(0);
    expect(readLongBE(state, slotOff + 0x04)).toBe(0);
    expect(readByte(state, slotOff + 0x18)).toBe(1);
    expect(readByte(state, slotOff + 0x1a)).toBe(0);
    expect(readLongBE(state, slotOff + 0x28)).toBe(0);
  });

  it("spawns six type0x0e string slots from the random group table", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();
    initStringSlotIds(state);
    pointModeAtEntryList(state, rom);

    setRomByte(rom, ENTRY_LIST, 17);
    setRomByte(rom, ENTRY_LIST + 1, 42);
    setRomLongBE(rom, ENTRY_LIST + 2, 0);
    setRomByte(rom, ENTRY_LIST + 6, 6);
    setRomByte(rom, ENTRY_LIST + 8, 0xff);

    for (let i = 0; i < 6; i++) {
      const ptr = DATA_PTR + i * 0x10;
      setRomLongBE(rom, 0x23d6a + i * 4, ptr);
      setRomByte(rom, ptr, 0x30 + i);
      setRomByte(rom, ptr + 1, 0x40 + i);
    }

    const inserts: Array<[number, number]> = [];
    const result = stringRangeDispatch17346(state, rom, 16, 17, {
      fun_13a98: () => 0,
      fun_1d1ec: () => undefined,
      fun_1778e: () => undefined,
      fun_18e6c: (_s, typeCode, subIdx) => {
        inserts.push([typeCode, subIdx]);
      },
    });

    expect(result.entries[0]!.spawnKind).toBe("group");
    expect(result.entries[0]!.initializedSlots).toEqual([
      0x40160e,
      0x4015cc,
      0x40158a,
      0x401548,
      0x401506,
      0x4014c4,
    ]);
    expect(result.fun18E6CCalls).toBe(6);
    expect(inserts).toEqual([
      [0x0e, 6],
      [0x0e, 5],
      [0x0e, 4],
      [0x0e, 3],
      [0x0e, 2],
      [0x0e, 1],
    ]);
  });

  it("tears down an active string slot when the range is crossed outward", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();
    initStringSlotIds(state);
    pointModeAtEntryList(state, rom);
    setRomByte(rom, ENTRY_LIST, 0xff);

    const slotOff = STRING_SLOT_BASE_ADDR - WRAM;
    setByte(state, slotOff + 0x18, 1);
    setByte(state, slotOff + 0x19, 3);
    setWordBE(state, slotOff + 0x34, 15);
    setWordBE(state, slotOff + 0x36, 25);

    const removes: Array<[number, number]> = [];
    const result = stringRangeDispatch17346(state, rom, 15, 14, {
      fun_18f46: (_s, typeCode, subIdx) => {
        removes.push([typeCode, subIdx]);
      },
    });

    expect(result.entries).toHaveLength(0);
    expect(result.slots[0]!.action).toBe("teardown");
    expect(readByte(state, slotOff + 0x18)).toBe(0);
    expect(result.fun18F46Calls).toBe(1);
    expect(removes).toEqual([[0x0e, 3]]);
  });
});
