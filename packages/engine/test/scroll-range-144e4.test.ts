/**
 * scroll-range-144e4.test.ts — unit tests per `scrollRange144E4` (FUN_000144E4).
 *
 * Verifica:
 *  - scaling math (boundary/16)
 *  - early exit quando d3 == d2
 *  - dispatch dei 4 sub (iniettabili + default no-op)
 *  - mode-3 banner dispatch
 *  - mode-4 range checks (FUN_18FFA, FUN_190EE, write 0x400762)
 */

import { describe, it, expect } from "vitest";
import { scrollRange144E4 } from "../src/scroll-range-144e4.js";
import { emptyGameState } from "../src/state.js";
import { emptyRomImage } from "../src/bus.js";
import type { GameState } from "../src/state.js";
import type { RomImage } from "../src/bus.js";

const WRAM = 0x400000;

function writeU16(state: GameState, addr: number, v: number): void {
  state.workRam[addr - WRAM] = (v >>> 8) & 0xff;
  state.workRam[addr - WRAM + 1] = v & 0xff;
}

function writeU32(state: GameState, addr: number, v: number): void {
  state.workRam[addr - WRAM] = (v >>> 24) & 0xff;
  state.workRam[addr - WRAM + 1] = (v >>> 16) & 0xff;
  state.workRam[addr - WRAM + 2] = (v >>> 8) & 0xff;
  state.workRam[addr - WRAM + 3] = v & 0xff;
}

function readByte(state: GameState, addr: number): number {
  return state.workRam[addr - WRAM] ?? 0;
}

/**
 * Aggiunge un sentinel 0xFF all'offset 0 della ROM.
 * Con un empty ROM, rectListPtr = 0 → legge ROM[0].
 * Se ROM[0] = 0xFF → sentinel di fine lista → scriptRectDispatch12DFA
 * esce subito senza loop infinito.
 */
function addRomSentinel(rom: RomImage): void {
  rom.program[0] = 0xff;
}

function setStatePtrInRam(state: GameState, boundary: number): void {
  const ptrValue = 0x401000;
  writeU32(state, 0x400474, ptrValue);
  writeU16(state, ptrValue + 0x10, boundary & 0xffff);
}

function setMode(state: GameState, mode: number): void {
  writeU16(state, 0x400394, mode & 0xffff);
}

/** Sext 16 bit word. */
function sext16(v: number): number {
  const w = v & 0xffff;
  return w < 0x8000 ? w : (w | 0xffff0000) >> 0;
}

/** Expected scaled value: (sext(val) - boundary) >> 4, masked to byte. */
function expectedScaled(val: number, boundary: number): number {
  return ((sext16(val) - boundary) >> 4) & 0xff;
}

describe("scrollRange144E4 (FUN_000144E4)", () => {
  // ─── Scaling math ──────────────────────────────────────────────────────

  it("scaling: d3b = (sext(from) - boundary) >> 4 low byte", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();
    addRomSentinel(rom);
    setMode(state, 0);
    setStatePtrInRam(state, 0x0100); // boundary = 256

    // from = 0x0200, to = 0x0100 (= boundary exactly → d2 = 0)
    // d3 = (0x200 - 0x100) >> 4 = 0x100 >> 4 = 0x10
    // d2 = (0x100 - 0x100) >> 4 = 0
    // d3 != d2 → dispatches
    const calls: number[] = [];
    scrollRange144E4(state, rom, 0x0200, 0x0100, {
      fun_15a12: (_s, d3b, _d2b) => { calls.push(d3b); },
    });
    expect(calls[0]).toBe(expectedScaled(0x0200, 0x0100));
  });

  it("scaling: negative boundary makes d2b/d3b negative bytes", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();
    addRomSentinel(rom);
    setMode(state, 0);
    // boundary = 0xFE00 (= -512 in signed 16-bit)
    setStatePtrInRam(state, 0xfe00);

    // from = 0x0000, boundary = -512
    // d3 = (0 - (-512)) >> 4 = 512 >> 4 = 32 = 0x20
    const d3Expected = expectedScaled(0x0000, sext16(0xfe00));
    const calls: Array<[number, number]> = [];
    scrollRange144E4(state, rom, 0x0000, 0x0200, {
      fun_15a12: (_s, d3b, d2b) => { calls.push([d3b, d2b]); },
    });
    if (calls.length > 0) {
      expect(calls[0]![0]).toBe(d3Expected & 0xff);
    }
  });

  // ─── Early exit ────────────────────────────────────────────────────────

  it("early exit: d3 == d2 → no dispatch, no side effects", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();
    // No sentinel needed (no dispatch happens)
    setMode(state, 3);
    setStatePtrInRam(state, 0x0000);

    // from = to = 0x0010 → d3 = d2 = 1 → early exit
    const called = { sub15a12: false, sub14c46: false };
    scrollRange144E4(state, rom, 0x0010, 0x0010, {
      fun_15a12: () => { called.sub15a12 = true; },
      fun_14c46: () => { called.sub14c46 = true; },
    });
    expect(called.sub15a12).toBe(false);
    expect(called.sub14c46).toBe(false);
  });

  it("early exit check: different from/to but same scaled value → no dispatch", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();
    // No sentinel needed (no dispatch happens)
    setMode(state, 0);
    setStatePtrInRam(state, 0x0000);

    // from = 0x0000, to = 0x000F → d3 = 0, d2 = 0 → same → no dispatch
    let called = false;
    scrollRange144E4(state, rom, 0x0000, 0x000f, {
      fun_15a12: () => { called = true; },
    });
    expect(called).toBe(false);
  });

  // ─── 4 dispatcher calls ────────────────────────────────────────────────

  it("dispatches all 4 subs with (d3b, d2b) args", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();
    addRomSentinel(rom);
    setMode(state, 0); // mode != 3 and != 4, so only 4 basic subs called
    setStatePtrInRam(state, 0x0000);

    // from = 0x0020, to = 0x0000 → d3 = 2, d2 = 0 → different → dispatch
    const log: string[] = [];
    scrollRange144E4(state, rom, 0x0020, 0x0000, {
      fun_15a12: (_s, d3, d2) => { log.push(`15a12(${d3},${d2})`); },
      fun_14c46: (_s, d3, d2) => { log.push(`14c46(${d3},${d2})`); },
      fun_17346: (_s, d3, d2) => { log.push(`17346(${d3},${d2})`); },
    });
    expect(log).toContain("15a12(2,0)");
    expect(log).toContain("14c46(2,0)");
    expect(log).toContain("17346(2,0)");
    // All 3 called in order
    expect(log.indexOf("15a12(2,0)")).toBeLessThan(log.indexOf("14c46(2,0)"));
    expect(log.indexOf("14c46(2,0)")).toBeLessThan(log.indexOf("17346(2,0)"));
  });

  it("fun_12dfa (scriptRectDispatch12DFA) called via rom — exits cleanly with sentinel", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();
    addRomSentinel(rom); // Ensure rect-list loop exits immediately
    setMode(state, 0);
    setStatePtrInRam(state, 0x0000);
    // from/to different: dispatch happens
    expect(() => scrollRange144E4(state, rom, 0x0100, 0x0000)).not.toThrow();
  });

  it("fun_12dfa skipped when rom is undefined", () => {
    const state = emptyGameState();
    setMode(state, 0);
    setStatePtrInRam(state, 0x0000);
    expect(() => scrollRange144E4(state, undefined, 0x0100, 0x0000)).not.toThrow();
  });

  // ─── Mode 3: banner dispatch ───────────────────────────────────────────

  it("mode 3: d3 < 0x29 AND d2 >= 0x29 → bannerHelper26B66 called (palette ptr incremented)", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();
    addRomSentinel(rom);
    setMode(state, 3);
    setStatePtrInRam(state, 0x0000);

    // d3b = 0x28, d2b = 0x29 → banner(9)
    // Set valid palette queue ptr
    writeU32(state, 0x400408, 0x0040040c);
    // from = 0x280, to = 0x290
    scrollRange144E4(state, rom, 0x0280, 0x0290);
    // paletteQueuePush increments ptr from 0x40040c to 0x40040d
    const ptr = (
      ((state.workRam[0x408] ?? 0) << 24) |
      ((state.workRam[0x409] ?? 0) << 16) |
      ((state.workRam[0x40a] ?? 0) << 8) |
      (state.workRam[0x40b] ?? 0)
    ) >>> 0;
    expect(ptr).toBe(0x0040040d);
  });

  it("mode 3: d3 >= 0x29 AND d2 < 0x29 → bannerHelper26B66 called with 8", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();
    addRomSentinel(rom);
    setMode(state, 3);
    setStatePtrInRam(state, 0x0000);

    writeU32(state, 0x400408, 0x0040040c);
    // d3b = 0x29, d2b = 0x28 → banner(8)
    scrollRange144E4(state, rom, 0x0290, 0x0280);
    const ptr = (
      ((state.workRam[0x408] ?? 0) << 24) |
      ((state.workRam[0x409] ?? 0) << 16) |
      ((state.workRam[0x40a] ?? 0) << 8) |
      (state.workRam[0x40b] ?? 0)
    ) >>> 0;
    expect(ptr).toBe(0x0040040d);
  });

  it("mode 3: both < 0x29 → no banner called (palette ptr unchanged)", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();
    addRomSentinel(rom);
    setMode(state, 3);
    setStatePtrInRam(state, 0x0000);

    writeU32(state, 0x400408, 0x0040040c);
    // d3 = 0x10, d2 = 0x20 — both < 0x29
    scrollRange144E4(state, rom, 0x0100, 0x0200);
    const ptr = (
      ((state.workRam[0x408] ?? 0) << 24) |
      ((state.workRam[0x409] ?? 0) << 16) |
      ((state.workRam[0x40a] ?? 0) << 8) |
      (state.workRam[0x40b] ?? 0)
    ) >>> 0;
    expect(ptr).toBe(0x0040040c); // unchanged
  });

  it("mode 3: both >= 0x29 → no banner called", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();
    addRomSentinel(rom);
    setMode(state, 3);
    setStatePtrInRam(state, 0x0000);

    writeU32(state, 0x400408, 0x0040040c);
    // d3 = 0x29, d2 = 0x30 — both >= 0x29
    scrollRange144E4(state, rom, 0x0290, 0x0300);
    const ptr = (
      ((state.workRam[0x408] ?? 0) << 24) |
      ((state.workRam[0x409] ?? 0) << 16) |
      ((state.workRam[0x40a] ?? 0) << 8) |
      (state.workRam[0x40b] ?? 0)
    ) >>> 0;
    expect(ptr).toBe(0x0040040c); // unchanged
  });

  // ─── Mode 4: range-based dispatch ──────────────────────────────────────

  it("mode 4: d3 NOT in [1D..38] AND d2 in [1D..38] → fun_18ffa called", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();
    addRomSentinel(rom);
    setMode(state, 4);
    setStatePtrInRam(state, 0x0000);

    // d3 = 0x10 (< 0x1D), d2 = 0x20 (in [0x1D..0x38])
    let called18ffa = false;
    scrollRange144E4(state, rom, 0x0100, 0x0200, {
      fun_18ffa: () => { called18ffa = true; },
    });
    expect(called18ffa).toBe(true);
  });

  it("mode 4: d3 in [1D..38] AND d2 NOT in [1D..38] → fun_190ee called", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();
    addRomSentinel(rom);
    setMode(state, 4);
    setStatePtrInRam(state, 0x0000);

    // d3 = 0x20 (in [0x1D..0x38]), d2 = 0x10 (< 0x1D)
    let called190ee = false;
    scrollRange144E4(state, rom, 0x0200, 0x0100, {
      fun_190ee: () => { called190ee = true; },
    });
    expect(called190ee).toBe(true);
  });

  it("mode 4: both in [1D..38] → neither FUN_18FFA nor FUN_190EE called", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();
    addRomSentinel(rom);
    setMode(state, 4);
    setStatePtrInRam(state, 0x0000);

    // d3 = 0x1E, d2 = 0x30 — both in [0x1D..0x38]
    let called = false;
    scrollRange144E4(state, rom, 0x01e0, 0x0300, {
      fun_18ffa: () => { called = true; },
      fun_190ee: () => { called = true; },
    });
    expect(called).toBe(false);
  });

  it("mode 4: d3 NOT in [3..1B] AND d2 in [3..1B] → write 1 to 0x400762", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();
    addRomSentinel(rom);
    setMode(state, 4);
    setStatePtrInRam(state, 0x0000);

    // d3 = 0x20 (> 0x1B), d2 = 0x10 (in [3..0x1B])
    state.workRam[0x400762 - WRAM] = 0xff;
    scrollRange144E4(state, rom, 0x0200, 0x0100, {
      fun_190ee: () => { /* no-op */ },
    });
    expect(readByte(state, 0x400762)).toBe(1);
  });

  it("mode 4: d3 in [3..1B] AND d2 NOT in [3..1B] → write 0 to 0x400762", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();
    addRomSentinel(rom);
    setMode(state, 4);
    setStatePtrInRam(state, 0x0000);

    // d3 = 0x10 (in [3..0x1B]), d2 = 0x20 (> 0x1B)
    state.workRam[0x400762 - WRAM] = 0x01;
    scrollRange144E4(state, rom, 0x0100, 0x0200, {
      fun_18ffa: () => { /* no-op */ },
    });
    expect(readByte(state, 0x400762)).toBe(0);
  });

  it("mode 4: both in [3..1B] → 0x400762 unchanged (no write)", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();
    addRomSentinel(rom);
    setMode(state, 4);
    setStatePtrInRam(state, 0x0000);

    // d3 = 0x08, d2 = 0x10 — both in [3..1B], different
    state.workRam[0x400762 - WRAM] = 0xAA;
    scrollRange144E4(state, rom, 0x0080, 0x0100);
    expect(readByte(state, 0x400762)).toBe(0xAA);
  });

  it("mode 4: both NOT in [3..1B] → 0x400762 unchanged", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();
    addRomSentinel(rom);
    setMode(state, 4);
    setStatePtrInRam(state, 0x0000);

    // d3 = 0x20 (> 0x1B), d2 = 0x00 (< 3) — both outside [3..1B]
    state.workRam[0x400762 - WRAM] = 0x55;
    scrollRange144E4(state, rom, 0x0200, 0x0000, {
      fun_190ee: () => { /* no-op */ },
    });
    expect(readByte(state, 0x400762)).toBe(0x55);
  });

  // ─── readAbsU16 for boundary (ROM-or-workRam) ──────────────────────────

  it("boundary read from ROM when statePtr points to ROM address", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();
    addRomSentinel(rom);
    setMode(state, 0);

    // statePtr = 0x10000 (in ROM range)
    const ptrValue = 0x10000;
    writeU32(state, 0x400474, ptrValue);
    // Write boundary to ROM at ptrValue + 0x10
    rom.program[ptrValue + 0x10] = 0x00;
    rom.program[ptrValue + 0x11] = 0x10; // boundary = 0x0010 = 16

    // from = 0x0020, to = 0x0000
    // d3 = (0x20 - 16) >> 4 = (16) >> 4 = 1
    // d2 = (0x0  - 16) >> 4 = (-16) >> 4 = -1 = 0xFF
    const calls: Array<[number, number]> = [];
    scrollRange144E4(state, rom, 0x0020, 0x0000, {
      fun_15a12: (_s, d3b, d2b) => { calls.push([d3b, d2b]); },
    });
    expect(calls.length).toBe(1);
    expect(calls[0]![0]).toBe(1);   // d3b = 1
    expect(calls[0]![1]).toBe(0xff); // d2b = (-1) & 0xff = 0xFF
  });

  // ─── No crash on undefined rom ─────────────────────────────────────────

  it("undefined rom: boundary=0, no scriptRectDispatch called, no throw", () => {
    const state = emptyGameState();
    setMode(state, 0);
    // statePtr = 0 → readAbsU16(undefined, 0x10) → 0
    let sub15Called = false;
    expect(() => scrollRange144E4(state, undefined, 0x0100, 0x0000, {
      fun_15a12: () => { sub15Called = true; },
    })).not.toThrow();
    // d3 = (256 - 0) >> 4 = 16 = 0x10, d2 = (0 - 0) >> 4 = 0 → different → dispatch
    expect(sub15Called).toBe(true);
  });
});
