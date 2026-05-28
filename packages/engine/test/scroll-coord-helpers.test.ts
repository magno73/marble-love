import { describe, it, expect } from "vitest";
import { emptyGameState } from "../src/state.js";
import {
  SET_SCROLL_COORDS_FROM_ENTITY_1BB08_ADDR,
  UPDATE_SCROLL_COORDS_1BB50_ADDR,
  setScrollCoordsFromEntity1BB08,
  updateScrollCoords1BB50,
} from "../src/scroll-coord-helpers.js";

function w16(s: ReturnType<typeof emptyGameState>, off: number, v: number): void {
  s.workRam[off] = (v >>> 8) & 0xff;
  s.workRam[off + 1] = v & 0xff;
}

function r16(s: ReturnType<typeof emptyGameState>, off: number): number {
  return ((s.workRam[off] ?? 0) << 8) | (s.workRam[off + 1] ?? 0);
}

describe("FUN_1BB50 updateScrollCoords1BB50", () => {
  it("expone l'address del binario", () => {
    expect(UPDATE_SCROLL_COORDS_1BB50_ADDR).toBe(0x1bb50);
  });

  it("scrive sub-cell X/Y e cell X/Y", () => {
    const s = emptyGameState();
    w16(s, 0x690, 0x42); // worldX = 0x42 = cell 8 + sub 2
    w16(s, 0x692, 0x35); // worldY = 0x35 = cell 6 + sub 5
    updateScrollCoords1BB50(s);
    expect(r16(s, 0x69e)).toBe(2); // subX
    expect(r16(s, 0x6a0)).toBe(5); // subY
    expect(r16(s, 0x696)).toBe(8); // cellX = 0x42 >> 3
    expect(r16(s, 0x698)).toBe(6); // cellY = 0x35 >> 3
  });

  it("dirty=1 quando subY >= subX", () => {
    const s = emptyGameState();
    w16(s, 0x690, 0x42); // subX = 2
    w16(s, 0x692, 0x35); // subY = 5
    updateScrollCoords1BB50(s);
    expect(r16(s, 0x6a2)).toBe(1);
  });

  it("dirty=0 quando subY < subX", () => {
    const s = emptyGameState();
    w16(s, 0x690, 0x47); // subX = 7
    w16(s, 0x692, 0x32); // subY = 2
    updateScrollCoords1BB50(s);
    expect(r16(s, 0x6a2)).toBe(0);
  });

  it("cell signed shift right (negative world X)", () => {
    const s = emptyGameState();
    w16(s, 0x690, 0xfff8); // -8 signed
    w16(s, 0x692, 0);
    updateScrollCoords1BB50(s);
    // -8 >> 3 = -1 = 0xFFFF
    expect(r16(s, 0x696)).toBe(0xffff);
  });
});

describe("FUN_1BB08 setScrollCoordsFromEntity1BB08", () => {
  it("expone l'address del binario", () => {
    expect(SET_SCROLL_COORDS_FROM_ENTITY_1BB08_ADDR).toBe(0x1bb08);
  });

  it("copia entity[0xC]/[0x10] in 0x690/0x692 + chiama updateScrollCoords", () => {
    const s = emptyGameState();
    // Entity struct @ 0x400100
    w16(s, 0x100 + 0xc, 0x42); // entity X
    w16(s, 0x100 + 0x10, 0x35); // entity Y
    setScrollCoordsFromEntity1BB08(s, 0x00400100);
    expect(r16(s, 0x690)).toBe(0x42);
    expect(r16(s, 0x692)).toBe(0x35);
    // Verify updateScrollCoords was called.
    expect(r16(s, 0x69e)).toBe(2); // subX = 0x42 & 7
    expect(r16(s, 0x696)).toBe(8); // cellX = 0x42 >> 3
  });

  it("entityPtr fuori workRam → reads zero, writes zero", () => {
    const s = emptyGameState();
    setScrollCoordsFromEntity1BB08(s, 0x00500000);
    expect(r16(s, 0x690)).toBe(0);
    expect(r16(s, 0x692)).toBe(0);
  });
});
