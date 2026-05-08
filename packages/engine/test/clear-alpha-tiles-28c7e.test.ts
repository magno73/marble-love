import { describe, expect, it } from "vitest";
import { ALPHA_TILE_COUNT } from "../src/alpha-tilemap.js";
import {
  clearAlphaTiles28C7E,
  CLEAR_ALPHA_TILES_28C7E_ADDR,
} from "../src/clear-alpha-tiles-28c7e.js";
import { emptyGameState } from "../src/state.js";

describe("clearAlphaTiles28C7E (FUN_00028C7E)", () => {
  it("clears all active alpha tile words from row 0", () => {
    const s = emptyGameState();
    s.alphaRam.fill(0xff);

    clearAlphaTiles28C7E(s);

    for (let i = 0; i < ALPHA_TILE_COUNT * 2; i++) {
      expect(s.alphaRam[i]).toBe(0);
    }
    for (let i = ALPHA_TILE_COUNT * 2; i < s.alphaRam.length; i++) {
      expect(s.alphaRam[i]).toBe(0xff);
    }
  });

  it("exposes the binary entry address", () => {
    expect(CLEAR_ALPHA_TILES_28C7E_ADDR).toBe(0x28c7e);
  });
});
