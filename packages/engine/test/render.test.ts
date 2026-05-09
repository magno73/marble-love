import { describe, expect, it } from "vitest";
import {
  buildAlphaFromRam,
  buildFrame,
  buildPaletteFromColorRam,
  buildPlayfieldFromRam,
  buildSpritesFromMotionObjectList,
  buildSpritesFromMotionObjectRam,
  decodeMotionObjectWords,
  decodePlayfieldWord,
  decodeVideoControlByte,
  irgb4444ToRgba,
  walkMotionObjectLinkedList,
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
    expect(frame.debugLabel).toBeUndefined();
  });

  it("can opt into building sprites from the motion-object linked list", () => {
    const state = emptyGameState();
    state.spriteRam.set([0x00, 0x21, 0x01, 0x10, 0x00, 0x41, 0x00, 0x00], 0);

    const frame = buildFrame(state, {
      motionObjects: "linked-list",
      maxMotionObjectEntries: 1,
      videoControlByte: 0b0010_1101,
    });

    expect(frame.sprites).toEqual([
      {
        spriteIndex: 0x10,
        x: 2,
        y: 1,
        width: 16,
        height: 16,
        paletteIndex: 0x101,
        flipX: false,
        priority: 0,
        translucent: false,
      },
    ]);
    expect(frame.debugLabel).toBe("engine-frame:alpha-bank-1:pf-bank-1:mo-bank-5");
  });

  it("passes optional motion-object lookup metadata through buildFrame", () => {
    const state = emptyGameState();
    state.spriteRam.set([0x00, 0x21, 0x02, 0x22, 0x00, 0x41, 0x00, 0x00], 0);

    const frame = buildFrame(state, {
      motionObjects: "linked-list",
      maxMotionObjectEntries: 1,
      motionObjectLookups: [
        { offset: 0, bank: 0, color: 0, bpp: 4 },
        { offset: 0, bank: 0, color: 0, bpp: 4 },
        { offset: 6, bank: 3, color: 2, bpp: 6 },
      ],
    });

    expect(frame.sprites).toEqual([
      {
        spriteIndex: 0x622,
        gfxBank: 3,
        bitsPerPixel: 6,
        x: 2,
        y: 1,
        width: 16,
        height: 16,
        paletteIndex: 0x24, // 0x20 + (2 << 1) — MAME s_mob_config base 0x100/8
        flipX: false,
        priority: 0,
        translucent: false,
      },
    ]);
  });

  it("can opt into building playfield commands from supplied RAM and lookups", () => {
    const state = emptyGameState();
    const playfieldRam = new Uint8Array([0x81, 0x12]);

    const frame = buildFrame(state, {
      playfieldRam,
      playfieldLookups: [
        { offset: 0, bank: 0, color: 0, bpp: 4 },
        { offset: 3, bank: 2, color: 5, bpp: 5 },
      ],
      scrollX: 4,
      scrollY: 8,
    });

    expect(frame.scrollX).toBe(4);
    expect(frame.scrollY).toBe(8);
    expect(frame.playfield).toEqual([
      {
        tileIndex: 0x312,
        gfxBank: 2,
        bitsPerPixel: 5,
        x: 0,
        y: 0,
        width: 8,
        height: 8,
        paletteIndex: 0x34, // 0x20 + (5 << (5-3)) — bpp-aware shift
        flipX: true,
        priority: 1,
      },
    ]);
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

describe("buildPlayfieldFromRam", () => {
  it("builds neutral tile commands from raw playfield RAM and lookup metadata", () => {
    const ram = new Uint8Array([0x81, 0x34, 0x00, 0x12]);
    const lookups = [
      { offset: 2, bank: 1, color: 3, bpp: 5 as const },
      { offset: 4, bank: 2, color: 1, bpp: 4 as const },
    ];

    expect(buildPlayfieldFromRam(ram, lookups)).toEqual([
      {
        tileIndex: 0x434,
        gfxBank: 2,
        bitsPerPixel: 4,
        x: 0,
        y: 0,
        width: 8,
        height: 8,
        paletteIndex: 0x22, // 0x20 + (1 << (4-3))
        flipX: true,
        priority: 1,
      },
      {
        tileIndex: 0x212,
        gfxBank: 1,
        bitsPerPixel: 5,
        x: 8,
        y: 0,
        width: 8,
        height: 8,
        paletteIndex: 0x2c, // 0x20 + (3 << (5-3))
        flipX: false,
        priority: 0,
      },
    ]);
  });
});

describe("decodeMotionObjectWords", () => {
  it("extracts documented motion-object entry fields", () => {
    expect(decodeMotionObjectWords(0x83e2, 0x2a7f, 0x8563, 0x0034)).toEqual({
      tileIndex: 0x7f,
      color: 0x2a,
      xRaw: 0x2b,
      yRaw: 0x1f,
      widthTiles: 4,
      heightTiles: 3,
      link: 0x34,
      flipX: true,
      priority: true,
      timer: false,
    });
  });

  it("marks timer entries without applying Atari System 1R timer behavior", () => {
    expect(decodeMotionObjectWords(0x0000, 0xffff, 0x0000, 0x0000).timer).toBe(true);
  });
});

describe("buildSpritesFromMotionObjectRam", () => {
  it("builds neutral sprite commands from explicit motion-object entries", () => {
    const ram = new Uint8Array(16);
    ram.set([0x83, 0xe2, 0x2a, 0x7f, 0x85, 0x63, 0x00, 0x34], 0);
    ram.set([0x00, 0x00, 0xff, 0xff, 0x00, 0x00, 0x00, 0x00], 8);

    expect(buildSpritesFromMotionObjectRam(ram, [0, 1, 64, -1])).toEqual([
      {
        spriteIndex: 0x7f,
        x: 0x2b,
        y: 0x1f,
        width: 32,
        height: 24,
        paletteIndex: 0x12a,
        flipX: true,
        priority: 1,
        translucent: true,
      },
    ]);
  });

  it("can enrich sprite commands with motion-object graphics lookup metadata", () => {
    const ram = new Uint8Array(8);
    ram.set([0x00, 0x21, 0x03, 0x10, 0x00, 0x41, 0x00, 0x00], 0);
    const lookups = [
      { offset: 0, bank: 0, color: 0, bpp: 4 as const },
      { offset: 0, bank: 0, color: 0, bpp: 4 as const },
      { offset: 0, bank: 0, color: 0, bpp: 4 as const },
      { offset: 5, bank: 2, color: 4, bpp: 5 as const },
    ];

    expect(buildSpritesFromMotionObjectRam(ram, [0], lookups)).toEqual([
      {
        spriteIndex: 0x510,
        gfxBank: 2,
        bitsPerPixel: 5,
        x: 2,
        y: 1,
        width: 16,
        height: 16,
        paletteIndex: 0x28, // 0x20 + (4 << 1) — MAME s_mob_config base 0x100/8
        flipX: false,
        priority: 0,
        translucent: false,
      },
    ]);
  });
});

describe("walkMotionObjectLinkedList", () => {
  it("walks word-3 links until an entry repeats", () => {
    const ram = new Uint8Array(64 * 8);
    ram[7] = 2;
    ram[2 * 8 + 7] = 5;
    ram[5 * 8 + 7] = 2;

    expect(walkMotionObjectLinkedList(ram)).toEqual([0, 2, 5]);
  });

  it("honors the max entry limit and start entry", () => {
    const ram = new Uint8Array(64 * 8);
    ram[3 * 8 + 7] = 4;
    ram[4 * 8 + 7] = 5;
    ram[5 * 8 + 7] = 6;

    expect(walkMotionObjectLinkedList(ram, 3, 2)).toEqual([3, 4]);
  });
});

describe("buildSpritesFromMotionObjectList", () => {
  it("builds neutral sprites from the walked motion-object list", () => {
    const ram = new Uint8Array(64 * 8);
    ram.set([0x00, 0x21, 0x01, 0x10, 0x00, 0x41, 0x00, 0x02], 0);
    ram.set([0x00, 0x22, 0x02, 0x20, 0x80, 0x62, 0x00, 0x00], 16);

    expect(buildSpritesFromMotionObjectList(ram)).toEqual([
      {
        spriteIndex: 0x10,
        x: 2,
        y: 1,
        width: 16,
        height: 16,
        paletteIndex: 0x101,
        flipX: false,
        priority: 0,
        translucent: false,
      },
      {
        spriteIndex: 0x20,
        x: 3,
        y: 1,
        width: 24,
        height: 24,
        paletteIndex: 0x102,
        flipX: false,
        priority: 1,
        translucent: true,
      },
    ]);
  });
});

describe("decodeVideoControlByte", () => {
  it("extracts documented System 1 video banking bits", () => {
    expect(decodeVideoControlByte(0b0011_1101)).toEqual({
      alphaBank: 1,
      playfieldTileBank: 1,
      motionObjectBank: 7,
    });
    expect(decodeVideoControlByte(0)).toEqual({
      alphaBank: 0,
      playfieldTileBank: 0,
      motionObjectBank: 0,
    });
  });
});
