import { describe, expect, it } from "vitest";
import {
  buildClassicDemoFrame,
  buildRomBackedDemoFrame,
} from "../src/fixtures/classic-demo-frame.js";
import type { RomGraphicsAssets } from "../src/rom-graphics.js";

function fakeRomGraphics(): RomGraphicsAssets {
  return {
    alpha: new Uint8Array(),
    tiles: new Uint8Array(),
    sprites: new Uint8Array(),
    proms: new Uint8Array(),
    promTables: {
      remap: new Uint8Array(),
      color: new Uint8Array(),
    },
    lookupTables: {
      playfield: [{ offset: 1, bank: 1, color: 2, bpp: 4 }],
      motionObjects: [{ offset: 2, bank: 1, color: 3, bpp: 4 }],
    },
    motherboardProms: [],
    decodedPalette: {
      status: "not-decoded",
      source: "proms",
    },
    decodedAlpha: {
      status: "decoded",
      source: "alpha",
      tileWidth: 8,
      tileHeight: 8,
      glyphs: [],
    },
    decodedTiles: {
      status: "not-decoded",
      source: "tiles",
    },
    decodedSprites: {
      status: "not-decoded",
      source: "sprites",
    },
  };
}

describe("buildClassicDemoFrame", () => {
  it("keeps the synthetic scene shaped as a ramp/platform composition", () => {
    const frame = buildClassicDemoFrame(0);
    const surfaceTiles = frame.playfield.filter((tile) =>
      [2, 3, 4, 5].includes(tile.paletteIndex),
    );
    const darkTiles = frame.playfield.filter((tile) =>
      [0, 9].includes(tile.paletteIndex),
    );

    expect(frame.nativeSize).toEqual({ width: 336, height: 240 });
    expect(surfaceTiles.length).toBeGreaterThan(80);
    expect(surfaceTiles.length).toBeLessThan(frame.playfield.length / 2);
    expect(darkTiles.length).toBeGreaterThan(surfaceTiles.length);
    expect(frame.sprites.some((sprite) => sprite.spriteIndex === 0)).toBe(true);
  });
});

describe("buildRomBackedDemoFrame", () => {
  it("limits ROM-backed playfield texture metadata to a small diagnostics strip", () => {
    const frame = buildRomBackedDemoFrame(fakeRomGraphics(), 0);
    const texturedTiles = frame.playfield.filter((tile) => tile.gfxBank !== undefined);

    expect(texturedTiles.length).toBeGreaterThan(0);
    expect(texturedTiles.length).toBeLessThan(32);
    expect(frame.sprites.every((sprite) => sprite.gfxBank !== undefined)).toBe(true);
    expect(frame.debugLabel).toBe("rom-backed-demo");
  });
});
