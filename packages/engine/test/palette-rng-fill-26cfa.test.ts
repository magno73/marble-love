/**
 * Test paletteRngFill26CFA (FUN_00026CFA).
 *
 * Smoke tests: verifichiamo le invarianti strutturali (header words, stride,
 * `packages/cli/src/test-palette-rng-fill-26cfa-parity.ts`.
 */

import { describe, it, expect } from "vitest";
import {
  paletteRngFill26CFATick,
  PAL_DEST_BASE,
  PAL_DEST_STRIDE,
  ENTRY_COUNT,
  ROM_TABLE_BASE,
  HEADER_WORD_1,
  HEADER_WORD_2,
} from "../src/palette-rng-fill-26cfa.js";
import { emptyGameState } from "../src/state.js";
import { emptyRomImage } from "../src/bus.js";
import { as_u16 } from "../src/wrap.js";

const PAL_RAM_BASE = 0xb00000;

function readPalU16BE(state: ReturnType<typeof emptyGameState>, addr: number): number {
  const off = addr - PAL_RAM_BASE;
  return ((state.colorRam[off] ?? 0) << 8) | (state.colorRam[off + 1] ?? 0);
}

describe("paletteRngFill26CFATick", () => {
  it("writes 8 entry: each header inizia con HEADER_WORD_1 / HEADER_WORD_2", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();
    state.rng.seed = as_u16(0x1234);

    paletteRngFill26CFATick(state, rom);

    for (let i = 0; i < ENTRY_COUNT; i++) {
      const dest = PAL_DEST_BASE + i * PAL_DEST_STRIDE;
      expect(readPalU16BE(state, dest + 0)).toBe(HEADER_WORD_1);
      expect(readPalU16BE(state, dest + 2)).toBe(HEADER_WORD_2);
    }
  });

  it("byte between entry consecutive (offset 10..31) restano invariati", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();
    // Pre-fill gap region with sentinel 0xA5 to detect any unwanted write.
    for (let i = 0; i < ENTRY_COUNT; i++) {
      const baseOff = (PAL_DEST_BASE - PAL_RAM_BASE) + i * PAL_DEST_STRIDE;
      for (let b = 10; b < 32; b++) {
        state.colorRam[baseOff + b] = 0xa5;
      }
    }
    state.rng.seed = as_u16(0xbeef);

    paletteRngFill26CFATick(state, rom);

    // Last entry's gap [10..32) is not written by next iter's stride += 22
    // but the function ends before the next iter, so check entries 0..6 inner gaps
    for (let i = 0; i < ENTRY_COUNT - 1; i++) {
      const baseOff = (PAL_DEST_BASE - PAL_RAM_BASE) + i * PAL_DEST_STRIDE;
      for (let b = 10; b < 32; b++) {
        expect(state.colorRam[baseOff + b]).toBe(0xa5);
      }
    }
  });

  it("avanza RNG of 8 step (8 chiamate a rngNext con limit=2)", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();
    state.rng.seed = as_u16(0x4321);
    const callsBefore = state.rng.callsThisFrame as unknown as number;

    paletteRngFill26CFATick(state, rom);

    const callsAfter = state.rng.callsThisFrame as unknown as number;
    expect(callsAfter - callsBefore).toBe(ENTRY_COUNT);
  });

  it("rnd=0 path: uses sub-entry +0 of the ROM table (i=0)", () => {
    // Force RNG path: rnd==0 → src = ROM_TABLE_BASE + 0 + 0 = ROM_TABLE_BASE
    const rom = emptyRomImage();
    rom.program[ROM_TABLE_BASE + 0] = 0x11;
    rom.program[ROM_TABLE_BASE + 1] = 0x22;
    rom.program[ROM_TABLE_BASE + 2] = 0x33;
    rom.program[ROM_TABLE_BASE + 3] = 0x44;
    rom.program[ROM_TABLE_BASE + 4] = 0x55;
    rom.program[ROM_TABLE_BASE + 5] = 0x66;
    // Different alternative sub-entry.
    rom.program[ROM_TABLE_BASE + 6] = 0xff;
    rom.program[ROM_TABLE_BASE + 7] = 0xee;

    let seedFound = -1;
    for (let s = 0; s < 0x10000; s++) {
      const tmpState = emptyGameState();
      tmpState.rng.seed = as_u16(s);
      paletteRngFill26CFATick(tmpState, rom);
      // Se entry 0 word3 == 0x1122 → rnd era 0
      if (readPalU16BE(tmpState, PAL_DEST_BASE + 4) === 0x1122) {
        seedFound = s;
        break;
      }
    }
    expect(seedFound).toBeGreaterThanOrEqual(0);

    const state = emptyGameState();
    state.rng.seed = as_u16(seedFound);
    paletteRngFill26CFATick(state, rom);
    expect(readPalU16BE(state, PAL_DEST_BASE + 4)).toBe(0x1122);
    expect(readPalU16BE(state, PAL_DEST_BASE + 6)).toBe(0x3344);
    expect(readPalU16BE(state, PAL_DEST_BASE + 8)).toBe(0x5566);
  });

  it("rnd!=0 path: uses sub-entry +6 of the ROM table", () => {
    const rom = emptyRomImage();
    rom.program[ROM_TABLE_BASE + 0] = 0x11; // base sub-entry
    rom.program[ROM_TABLE_BASE + 1] = 0x22;
    rom.program[ROM_TABLE_BASE + 6] = 0xaa; // alt sub-entry
    rom.program[ROM_TABLE_BASE + 7] = 0xbb;
    rom.program[ROM_TABLE_BASE + 8] = 0xcc;
    rom.program[ROM_TABLE_BASE + 9] = 0xdd;
    rom.program[ROM_TABLE_BASE + 10] = 0xee;
    rom.program[ROM_TABLE_BASE + 11] = 0xff;

    let seedFound = -1;
    for (let s = 0; s < 0x10000; s++) {
      const tmpState = emptyGameState();
      tmpState.rng.seed = as_u16(s);
      paletteRngFill26CFATick(tmpState, rom);
      // Se entry 0 word3 == 0xAABB → rnd era != 0
      if (readPalU16BE(tmpState, PAL_DEST_BASE + 4) === 0xaabb) {
        seedFound = s;
        break;
      }
    }
    expect(seedFound).toBeGreaterThanOrEqual(0);

    const state = emptyGameState();
    state.rng.seed = as_u16(seedFound);
    paletteRngFill26CFATick(state, rom);
    expect(readPalU16BE(state, PAL_DEST_BASE + 4)).toBe(0xaabb);
    expect(readPalU16BE(state, PAL_DEST_BASE + 6)).toBe(0xccdd);
    expect(readPalU16BE(state, PAL_DEST_BASE + 8)).toBe(0xeeff);
  });

  it("ROM table al of outside of the first entry (i=3): reads offset 0x20BB4 + 36", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();
    // Entry 3 sub-entry +0 (RNG=0): bytes a 0x20BB4 + 36..41
    const i = 3;
    const tableI = ROM_TABLE_BASE + i * 12;
    rom.program[tableI + 0] = 0xde;
    rom.program[tableI + 1] = 0xad;
    rom.program[tableI + 2] = 0xbe;
    rom.program[tableI + 3] = 0xef;
    rom.program[tableI + 4] = 0xca;
    rom.program[tableI + 5] = 0xfe;
    rom.program[tableI + 6] = 0x00; // alt
    rom.program[tableI + 7] = 0x00;

    let seedFound = -1;
    outer: for (let s = 1; s < 0x10000; s++) {
      const tmpState = emptyGameState();
      tmpState.rng.seed = as_u16(s);
      paletteRngFill26CFATick(tmpState, rom);
      const dest3 = PAL_DEST_BASE + i * PAL_DEST_STRIDE;
      if (readPalU16BE(tmpState, dest3 + 4) === 0xdead) {
        seedFound = s;
        break outer;
      }
    }
    expect(seedFound).toBeGreaterThanOrEqual(0);

    const state2 = emptyGameState();
    state2.rng.seed = as_u16(seedFound);
    paletteRngFill26CFATick(state2, rom);
    const dest3 = PAL_DEST_BASE + i * PAL_DEST_STRIDE;
    expect(readPalU16BE(state2, dest3 + 4)).toBe(0xdead);
    expect(readPalU16BE(state2, dest3 + 6)).toBe(0xbeef);
    expect(readPalU16BE(state2, dest3 + 8)).toBe(0xcafe);
  });
});
