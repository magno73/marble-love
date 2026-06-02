/**
 * Test setAlphaWord (FUN_383A) + clearAlphaTilesFromIndex (FUN_28C7E).
 *
 */

import { describe, it, expect } from "vitest";
import {
  setAlphaWord,
  clearAlphaTilesFromIndex,
  ALPHA_TILE_COUNT,
} from "../src/alpha-tilemap.js";
import { emptyGameState } from "../src/state.js";

describe("setAlphaWord (FUN_383A)", () => {
  it("writes word @ alpha[index*2]", () => {
    const s = emptyGameState();
    setAlphaWord(s, 0, 0xABCD);
    expect(s.alphaRam[0]).toBe(0xAB);
    expect(s.alphaRam[1]).toBe(0xCD);
  });

  it("index 1 → offset 2", () => {
    const s = emptyGameState();
    setAlphaWord(s, 1, 0x1234);
    expect(s.alphaRam[2]).toBe(0x12);
    expect(s.alphaRam[3]).toBe(0x34);
  });

  it("index 0x77F (last tile) → offset 0xEFE", () => {
    const s = emptyGameState();
    setAlphaWord(s, 0x77F, 0xBEEF);
    expect(s.alphaRam[0xEFE]).toBe(0xBE);
    expect(s.alphaRam[0xEFF]).toBe(0xEF);
  });

  it("only the low word of the value is used", () => {
    const s = emptyGameState();
    setAlphaWord(s, 0, 0x12345678);
    expect(s.alphaRam[0]).toBe(0x56);
    expect(s.alphaRam[1]).toBe(0x78);
  });
});

describe("clearAlphaTilesFromIndex (FUN_28C7E)", () => {
  function fillAlpha(s: ReturnType<typeof emptyGameState>): void {
    for (let i = 0; i < s.alphaRam.length; i++) s.alphaRam[i] = 0xFF;
  }

  it("startRow=0: clears all tiles [0, 0x780)", () => {
    const s = emptyGameState();
    fillAlpha(s);
    clearAlphaTilesFromIndex(s, 0);
    // Every byte in [0, 0xF00) must be 0.
    for (let i = 0; i < ALPHA_TILE_COUNT * 2; i++) {
      expect(s.alphaRam[i]).toBe(0);
    }
    // Bytes from 0xF00 onward must remain 0xFF.
    for (let i = ALPHA_TILE_COUNT * 2; i < s.alphaRam.length; i++) {
      expect(s.alphaRam[i]).toBe(0xFF);
    }
  });

  it("startRow=30: no-op (counter already starts at 0x780)", () => {
    const s = emptyGameState();
    fillAlpha(s);
    clearAlphaTilesFromIndex(s, 30);
    for (let i = 0; i < s.alphaRam.length; i++) {
      expect(s.alphaRam[i]).toBe(0xFF);
    }
  });

  it("startRow=29: clears only the last row (64 tiles)", () => {
    const s = emptyGameState();
    fillAlpha(s);
    clearAlphaTilesFromIndex(s, 29);
    // Bytes [0, 29*64*2) = [0, 0xE80) must remain 0xFF.
    for (let i = 0; i < 29 * 64 * 2; i++) {
      expect(s.alphaRam[i]).toBe(0xFF);
    }
    // Bytes [0xE80, 0xF00) must be 0.
    for (let i = 29 * 64 * 2; i < ALPHA_TILE_COUNT * 2; i++) {
      expect(s.alphaRam[i]).toBe(0);
    }
    // Bytes [0xF00, end) must remain 0xFF.
    for (let i = ALPHA_TILE_COUNT * 2; i < s.alphaRam.length; i++) {
      expect(s.alphaRam[i]).toBe(0xFF);
    }
  });

  it("startRow=15: clears the lower half", () => {
    const s = emptyGameState();
    fillAlpha(s);
    clearAlphaTilesFromIndex(s, 15);
    for (let i = 0; i < 15 * 64 * 2; i++) {
      expect(s.alphaRam[i]).toBe(0xFF);
    }
    for (let i = 15 * 64 * 2; i < ALPHA_TILE_COUNT * 2; i++) {
      expect(s.alphaRam[i]).toBe(0);
    }
  });
});
