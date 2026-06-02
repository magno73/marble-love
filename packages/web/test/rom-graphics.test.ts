import { describe, expect, it } from "vitest";
import {
  decodeAlphaRom,
  decodeGraphicsLookups,
  decodeObjectTile,
  splitGraphicsProms,
} from "../src/rom-graphics.js";

describe("decodeAlphaRom", () => {
  it("decodes 8x8 2bpp alpha glyphs using the documented System 1 layout", () => {
    const alpha = new Uint8Array(16);
    // Row 0, x0: plane 0 bit at layout bit offset 0.
    alpha[0] = 0b1000_0000;
    // Row 0, x1: plane 1 bit at layout bit offset 5.
    alpha[0] |= 0b0000_0100;
    // Row 1, x4: plane 0 + plane 1 bits at layout bit offsets 24 and 28.
    alpha[3] = 0b1000_1000;

    const decoded = decodeAlphaRom(alpha);

    expect(decoded.status).toBe("decoded");
    expect(decoded.glyphs).toHaveLength(1);
    expect(decoded.glyphs[0]?.pixels[0]).toBe(1);
    expect(decoded.glyphs[0]?.pixels[1]).toBe(2);
    expect(decoded.glyphs[0]?.pixels[12]).toBe(3);
  });

  it("ignores incomplete trailing bytes", () => {
    expect(decodeAlphaRom(new Uint8Array(17)).glyphs).toHaveLength(1);
  });
});

describe("splitGraphicsProms", () => {
  it("splits remap and color PROM tables without interpreting them", () => {
    const proms = new Uint8Array(0x400);
    proms[0] = 0x11;
    proms[0x1ff] = 0x22;
    proms[0x200] = 0x33;
    proms[0x3ff] = 0x44;

    const tables = splitGraphicsProms(proms);

    expect(tables.remap).toHaveLength(0x200);
    expect(tables.color).toHaveLength(0x200);
    expect(tables.remap[0]).toBe(0x11);
    expect(tables.remap[0x1ff]).toBe(0x22);
    expect(tables.color[0]).toBe(0x33);
    expect(tables.color[0x1ff]).toBe(0x44);
  });
});

describe("decodeGraphicsLookups", () => {
  it("decodes playfield and motion-object PROM lookup metadata", () => {
    const proms = new Uint8Array(0x400).fill(0xff);
    // playfield entry 0: bank 1 active-low, offset 5, 4bpp, color mask => 3.
    proms[0x000] = 0xe5;
    proms[0x200] = 0xcc;
    // motion-object entry 0: bank 2 active-low, offset 7, 5bpp, MO color => 2.
    proms[0x100] = 0xd7;
    proms[0x300] = 0x11;

    const lookups = decodeGraphicsLookups(proms);

    expect(lookups.playfield[0]).toEqual({
      offset: 5,
      bank: 1,
      color: 3,
      bpp: 4,
    });
    expect(lookups.motionObjects[0]).toEqual({
      offset: 7,
      bank: 2,
      color: 3,
      bpp: 5,
    });
  });
});

describe("decodeObjectTile", () => {
  it("decodes a synthetic 4bpp object tile from planar banks", () => {
    const tiles = new Uint8Array(0x40000);
    // MAME `readbit` MSB-first: bit position 0 = bit 7 (MSB) of the byte.
    // Setting all planes a 0x80 (bit 7 set) produce pen 0b1111 a x=0.
    tiles[0x30000] = 0x80;
    tiles[0x20000] = 0x80;
    tiles[0x10000] = 0x80;
    tiles[0x00000] = 0x80;

    const tile = decodeObjectTile(tiles, 1, 0, 4);

    expect(tile.width).toBe(8);
    expect(tile.height).toBe(8);
    expect(tile.pixels[0]).toBe(0x0f);
    expect(tile.pixels[1]).toBe(0);
  });
});
