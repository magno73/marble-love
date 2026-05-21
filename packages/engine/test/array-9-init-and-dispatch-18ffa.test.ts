import { describe, it, expect } from "vitest";
import { emptyGameState } from "../src/state.js";
import { emptyRomImage } from "../src/bus.js";
import {
  array9InitAndDispatch18FFA,
  ARRAY9_BASE,
  ARRAY9_COUNT,
  ARRAY9_STRIDE,
} from "../src/array-9-init-and-dispatch-18ffa.js";
import { scrollRange144E4 } from "../src/scroll-range-144e4.js";
import type { GameState } from "../src/state.js";

const WRAM = 0x400000;

function off(addr: number): number {
  return addr - WRAM;
}

function readU32(state: GameState, addr: number): number {
  const o = off(addr);
  return (
    (((state.workRam[o] ?? 0) << 24) |
      ((state.workRam[o + 1] ?? 0) << 16) |
      ((state.workRam[o + 2] ?? 0) << 8) |
      (state.workRam[o + 3] ?? 0)) >>>
    0
  );
}

function writeU16(state: GameState, addr: number, value: number): void {
  const o = off(addr);
  state.workRam[o] = (value >>> 8) & 0xff;
  state.workRam[o + 1] = value & 0xff;
}

function writeU32(state: GameState, addr: number, value: number): void {
  const o = off(addr);
  state.workRam[o] = (value >>> 24) & 0xff;
  state.workRam[o + 1] = (value >>> 16) & 0xff;
  state.workRam[o + 2] = (value >>> 8) & 0xff;
  state.workRam[o + 3] = value & 0xff;
}

function setupScrollRangeMode4(state: GameState): void {
  writeU16(state, 0x400394, 4);
  writeU32(state, 0x400474, 0x00401000);
  writeU16(state, 0x00401010, 0);
}

describe("array9InitAndDispatch18FFA (FUN_18FFA)", () => {
  it("initializes nine type7/8/9 entries and dispatches each one", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();
    for (let i = 0; i < ARRAY9_COUNT; i++) {
      state.workRam[off(ARRAY9_BASE + i * ARRAY9_STRIDE) + 0x19] = 0x30 + i;
    }

    let rngValue = 0;
    const dispatchCalls: number[] = [];
    const coordCalls: number[] = [];
    const insertCalls: Array<{ type: number; sub: number }> = [];

    array9InitAndDispatch18FFA(state, rom, {
      fun_13a98: () => rngValue++,
      fun_1937c: () => 0,
      fun_194ba: (_st, addr) => { dispatchCalls.push(addr); },
      fun_199d6: (_st, addr) => { coordCalls.push(addr); },
      fun_18e6c: (_st, type, sub) => { insertCalls.push({ type, sub }); },
    });

    expect(dispatchCalls).toHaveLength(9);
    expect(coordCalls).toHaveLength(9);
    expect(insertCalls).toEqual([
      { type: 7, sub: 0x30 },
      { type: 7, sub: 0x31 },
      { type: 7, sub: 0x32 },
      { type: 8, sub: 0x33 },
      { type: 8, sub: 0x34 },
      { type: 8, sub: 0x35 },
      { type: 9, sub: 0x36 },
      { type: 9, sub: 0x37 },
      { type: 9, sub: 0x38 },
    ]);

    for (let i = 0; i < ARRAY9_COUNT; i++) {
      const addr = ARRAY9_BASE + i * ARRAY9_STRIDE;
      const entryOff = off(addr);
      const expectedType = i < 3 ? 7 : i < 6 ? 8 : 9;
      expect(state.workRam[entryOff + 0x18]).toBe(1);
      expect(state.workRam[entryOff + 0x1a]).toBe(0);
      expect(state.workRam[entryOff + 0x1b]).toBe(0);
      expect(state.workRam[entryOff + 0x25]).toBe(expectedType);
      expect(readU32(state, addr + 0x00)).toBe(0);
      expect(readU32(state, addr + 0x04)).toBe(0);
      expect(readU32(state, addr + 0x08)).toBe(0);
      expect(readU32(state, addr + 0x14)).toBe(0x3f6e0000);
    }

    expect(readU32(state, ARRAY9_BASE + 0x0c)).toBe(0x02ca0000);
    expect(readU32(state, ARRAY9_BASE + 0x10)).toBe(0x02d60000);
    expect(rngValue).toBe(18);
  });

  it("returns immediately when any array-9 entry is already active", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();
    const activeAddr = ARRAY9_BASE + 4 * ARRAY9_STRIDE;
    state.workRam[off(activeAddr) + 0x18] = 1;
    state.workRam[off(ARRAY9_BASE) + 0x25] = 0xaa;

    let called = false;
    array9InitAndDispatch18FFA(state, rom, {
      fun_13a98: () => {
        called = true;
        return 0;
      },
      fun_194ba: () => { called = true; },
      fun_199d6: () => { called = true; },
      fun_18e6c: () => { called = true; },
    });

    expect(called).toBe(false);
    expect(state.workRam[off(ARRAY9_BASE) + 0x25]).toBe(0xaa);
  });

  it("rerolls x/y while FUN_1937C reports a blocked position", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();
    let rngValue = 0;
    let validateCalls = 0;

    array9InitAndDispatch18FFA(state, rom, {
      fun_13a98: () => rngValue++,
      fun_1937c: () => {
        validateCalls++;
        return validateCalls === 1 ? 1 : 0;
      },
      fun_194ba: () => undefined,
      fun_199d6: () => undefined,
      fun_18e6c: () => undefined,
    });

    expect(validateCalls).toBe(10);
    expect(readU32(state, ARRAY9_BASE + 0x0c)).toBe(0x02d20000);
    expect(readU32(state, ARRAY9_BASE + 0x10)).toBe(0x02de0000);
    expect(rngValue).toBe(20);
  });

  it("scrollRange144E4 default wires FUN_18FFA on entry into the mode-4 L5 window", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();
    rom.program[0] = 0xff;
    setupScrollRangeMode4(state);

    scrollRange144E4(state, rom, 0x0100, 0x0200, {
      fun_15a12: () => undefined,
      fun_14c46: () => undefined,
      fun_17346: () => undefined,
    });

    expect(state.workRam[off(ARRAY9_BASE) + 0x18]).toBe(1);
    expect(state.workRam[off(ARRAY9_BASE) + 0x25]).toBe(7);
    expect(state.workRam[off(ARRAY9_BASE + 8 * ARRAY9_STRIDE) + 0x25]).toBe(9);
  });

  it("scrollRange144E4 default wires FUN_190EE on exit from the mode-4 L5 window", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();
    rom.program[0] = 0xff;
    setupScrollRangeMode4(state);
    for (let i = 0; i < ARRAY9_COUNT; i++) {
      const entryOff = off(ARRAY9_BASE + i * ARRAY9_STRIDE);
      state.workRam[entryOff + 0x18] = 1;
      state.workRam[entryOff + 0x19] = i;
      state.workRam[entryOff + 0x25] = i < 3 ? 7 : i < 6 ? 8 : 9;
    }

    scrollRange144E4(state, rom, 0x0200, 0x0100, {
      fun_15a12: () => undefined,
      fun_14c46: () => undefined,
      fun_17346: () => undefined,
    });

    for (let i = 0; i < ARRAY9_COUNT; i++) {
      expect(state.workRam[off(ARRAY9_BASE + i * ARRAY9_STRIDE) + 0x18]).toBe(0);
    }
  });
});
