import { describe, expect, it } from "vitest";
import {
  buildAlphaFromRam,
  buildFrame,
  buildPaletteFromColorRam,
  decodePlayfieldWord,
  irgb4444ToRgba,
} from "../src/render.js";
import { emptyGameState } from "../src/state.js";

describe("irgb4444ToRgba", () => {
  it("converts black and full-intensity white", () => {
    expect(irgb4444ToRgba(0x0000)).toEqual({ r: 0, g: 0, b: 0, a: 255 });
    expect(irgb4444ToRgba(0xffff)).toEqual({
      r: 255,
      g: 255,
      b: 255,
      a: 255,
    });
  });

  it("applies intensity to RGB nibbles", () => {
    expect(irgb4444ToRgba(0x8f00)).toEqual({ r: 136, g: 0, b: 0, a: 255 });
  });
});

describe("buildPaletteFromColorRam", () => {
  it("reads big-endian 16-bit palette words", () => {
    const ram = new Uint8Array([0xff, 0xff, 0x8f, 0x00]);

    expect(buildPaletteFromColorRam(ram)).toEqual([
      { index: 0, rgba: { r: 255, g: 255, b: 255, a: 255 } },
      { index: 1, rgba: { r: 136, g: 0, b: 0, a: 255 } },
    ]);
  });
});

describe("buildAlphaFromRam", () => {
  it("skips empty alpha words", () => {
    expect(buildAlphaFromRam(new Uint8Array(4))).toEqual([]);
  });

  it("decodes alpha tile index, palette, opacity, and screen position", () => {
    const ram = new Uint8Array(132);
    // index 65 => x=8, y=8. Word bits: opaque + palette 3 + tile 0x12.
    ram[130] = 0x2c;
    ram[131] = 0x12;

    expect(buildAlphaFromRam(ram)).toEqual([
      {
        tileIndex: 0x12,
        x: 8,
        y: 8,
        paletteIndex: 3,
        opaque: true,
      },
    ]);
  });
});

describe("buildFrame", () => {
  it("includes palette and alpha scaffolds without playfield or sprite commands", () => {
    const state = emptyGameState();
    state.colorRam[0] = 0xff;
    state.colorRam[1] = 0xff;
    state.alphaRam[0] = 0x04;
    state.alphaRam[1] = 0x2a;

    const frame = buildFrame(state);

    expect(frame.nativeSize).toEqual({ width: 336, height: 240 });
    expect(frame.palette[0]).toEqual({
      index: 0,
      rgba: { r: 255, g: 255, b: 255, a: 255 },
    });
    expect(frame.alpha).toEqual([
      {
        tileIndex: 0x2a,
        x: 0,
        y: 0,
        paletteIndex: 1,
        opaque: false,
      },
    ]);
    expect(frame.playfield).toEqual([]);
    expect(frame.sprites).toEqual([]);
  });
});

describe("decodePlayfieldWord", () => {
  it("extracts documented playfield RAM word fields", () => {
    expect(decodePlayfieldWord(0x80ab)).toEqual({
      tileIndexLow: 0xab,
      lookupIndex: 0x00,
      flipX: true,
    });
    expect(decodePlayfieldWord(0x7f42)).toEqual({
      tileIndexLow: 0x42,
      lookupIndex: 0x7f,
      flipX: false,
    });
  });
});
