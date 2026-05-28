/**
 * Test renderStringChain (FUN_2572) — 262 byte pure leaf.
 *
 * Bit-perfect verified against the binary (2000/2000) through
 * `cli/src/test-string-render-parity.ts`.
 */

import { describe, it, expect } from "vitest";
import { renderStringChain } from "../src/string-render.js";
import { emptyGameState } from "../src/state.js";
import { emptyRomImage } from "../src/bus.js";

describe("renderStringChain (FUN_2572)", () => {
  it("ritorna sempre 1", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    const r = renderStringChain(s, rom, 0x401D00, 0);
    expect(r).toBe(1);
  });

  it("D1 > lookup → skip render, exit immediato (marker check)", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    // tickOff = 100, tick = 0 → D1 = 100. Lookup[0] = 0x1E = 30 (small).
    // 100 > 30 → skip render. Marker = 0, valF00 = 0 → sum 0 ≤ 1 → exit.
    rom.program[0x7294] = 0; rom.program[0x7295] = 0x1E; // lookup[0] = 30
    s.workRam[0x1D01] = 100; // tickOff
    s.workRam[0x1D06] = 0;    // marker
    // Setup: tick=0, valF00=0 (default emptyGameState)

    // Pre-fill alpha to verify NO write happens
    s.alphaRam.fill(0xCC);
    renderStringChain(s, rom, 0x00401D00, 0);
    // No alpha write
    for (let i = 0; i < 16; i++) {
      expect(s.alphaRam[i]).toBe(0xCC);
    }
  });

  it("space char (0x20): scrive solo attr nel tile", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    // String = " " (space + null)
    s.workRam[0x1D40] = 0x20;
    s.workRam[0x1D41] = 0;
    // Entry struct
    s.workRam[0x1D00] = 0;     // col = 0
    s.workRam[0x1D01] = 0;     // tickOff = 0
    s.workRam[0x1D02] = 0; s.workRam[0x1D03] = 0x40; s.workRam[0x1D04] = 0x1D; s.workRam[0x1D05] = 0x40; // strPtr = 0x401D40
    s.workRam[0x1D06] = 0;     // marker = 0 → exit after string
    // Default rotation 0, tick 0, valF00 0
    renderStringChain(s, rom, 0x00401D00, 0xABCD);
    // Alpha[0] = 0xAB, Alpha[1] = 0xCD (attr written)
    expect(s.alphaRam[0]).toBe(0xAB);
    expect(s.alphaRam[1]).toBe(0xCD);
  });
});
