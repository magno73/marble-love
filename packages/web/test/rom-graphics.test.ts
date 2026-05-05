import { describe, expect, it } from "vitest";
import { decodeAlphaRom, splitGraphicsProms } from "../src/rom-graphics.js";

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
