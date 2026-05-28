import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { bootInit } from "../src/boot-init.js";
import { emptyRomImage } from "../src/bus.js";
import {
  buildAlphaFromRam,
  buildFrame,
  buildPaletteFromColorRam,
  buildPlayfieldFromRam,
  buildSpritesFromRuntimeMotionObjects,
  buildSpritesFromMotionObjectList,
  buildSpritesFromMotionObjectRam,
  decodeMotionObjectWords,
  decodePlayfieldWord,
  decodeVideoControlByte,
  irgb4444ToRgba,
  motionObjectStartEntryFromAvControl,
  runtimeMotionObjectEntryIndexes,
  visibleMotionObjectStartEntry,
  walkMotionObjectLinkedList,
} from "../src/render.js";
import { emptyGameState } from "../src/state.js";

interface GameplaySnapshot {
  workRam: string;
  playfieldRam: string;
  spriteRam: string;
  alphaRam: string;
  colorRam: string;
  slapsticBank?: number;
}

interface GameplayScenario {
  snapshots: GameplaySnapshot[];
}

function hexToBytes(hex: string, expectedLength: number): Uint8Array {
  expect(hex.length).toBe(expectedLength * 2);
  return Uint8Array.from(Buffer.from(hex, "hex"));
}

function readU16BE(bytes: Uint8Array, off: number): number {
  return (((bytes[off] ?? 0) << 8) | (bytes[off + 1] ?? 0)) & 0xffff;
}

function loadGameplaySnapshotState(snapshot: GameplaySnapshot): ReturnType<typeof emptyGameState> {
  const state = emptyGameState();
  bootInit(state, emptyRomImage(), {
    warmState: {
      workRam: hexToBytes(snapshot.workRam, 0x2000),
      playfieldRam: hexToBytes(snapshot.playfieldRam, 0x2000),
      spriteRam: hexToBytes(snapshot.spriteRam, 0x1000),
      alphaRam: hexToBytes(snapshot.alphaRam, 0x1000),
      colorRam: hexToBytes(snapshot.colorRam, 0x800),
      slapsticBank: snapshot.slapsticBank ?? 1,
    },
  });
  return state;
}

function writeU16BE(bytes: Uint8Array, off: number, value: number): void {
  const v = value & 0xffff;
  bytes[off] = (v >>> 8) & 0xff;
  bytes[off + 1] = v & 0xff;
}

function writeRuntimeMotionObject(
  state: ReturnType<typeof emptyGameState>,
  entryIndex: number,
  fields: { word0: number; word1: number; word2: number; word3: number },
): void {
  const bankIndex = Math.floor(entryIndex / 64);
  const entry = entryIndex & 0x3f;
  const bankBase = bankIndex * 0x200;
  writeU16BE(state.spriteRam, bankBase + entry * 2, fields.word0);
  writeU16BE(state.spriteRam, bankBase + 0x80 + entry * 2, fields.word1);
  writeU16BE(state.spriteRam, bankBase + 0x100 + entry * 2, fields.word2);
  writeU16BE(state.spriteRam, bankBase + 0x180 + entry * 2, fields.word3);
}

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

  it("suppresses motion objects during the level intro without clearing MO RAM", () => {
    const state = emptyGameState();
    state.spriteRam.set([0x00, 0x21, 0x01, 0x10, 0x00, 0x41, 0x00, 0x00], 0);
    state.clock.levelIntroBannerResumeTick = 1 as typeof state.clock.levelIntroBannerResumeTick;

    const frame = buildFrame(state, {
      motionObjects: "linked-list",
      maxMotionObjectEntries: 1,
    });

    expect(frame.sprites).toEqual([]);
    expect(Array.from(state.spriteRam.slice(0, 8))).toEqual([0x00, 0x21, 0x01, 0x10, 0x00, 0x41, 0x00, 0x00]);
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
        paletteIndex: 0x24,
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
        paletteIndex: 0x54, // 0x40 + (5 << (5-3)) — color_base 0x100 — bpp-aware shift
        flipX: true,
        priority: 1,
      },
    ]);
  });
});

describe("visibleMotionObjectStartEntry", () => {
  it("uses the latched active MO bank during normal rendering", () => {
    const state = emptyGameState();
    state.workRam[0x3ae] = 0x00;
    state.workRam[0x3af] = 0x18;
    state.workRam[0x3b0] = 0x00;
    state.workRam[0x3b1] = 0x20;

    expect(motionObjectStartEntryFromAvControl(0x0018)).toBe(3 * 64);
    expect(visibleMotionObjectStartEntry(state)).toBe(3 * 64);
  });

  it("uses the pending MO bank during the level-end score hold", () => {
    const state = emptyGameState();
    state.workRam[0x3ae] = 0x00;
    state.workRam[0x3af] = 0x00;
    state.workRam[0x3b0] = 0x00;
    state.workRam[0x3b1] = 0x08;
    state.clock.levelEndScoreResumePending = 1 as typeof state.clock.levelEndScoreResumePending;

    expect(visibleMotionObjectStartEntry(state)).toBe(64);
  });
});

describe("runtime motion objects", () => {
  it("uses the pending bank while a freshly emitted runtime list is dirty", () => {
    const state = emptyGameState();
    writeU16BE(state.workRam, 0x3ae, 0x0000);
    writeU16BE(state.workRam, 0x3b0, 0x0008);
    writeU16BE(state.workRam, 0x406, 0x0002);
    state.workRam[0x39a] = 1;

    expect(runtimeMotionObjectEntryIndexes(state)).toEqual([64, 65]);
  });

  it("draws only the emitted sequential entries and ignores stale linked data", () => {
    const state = emptyGameState();
    writeU16BE(state.workRam, 0x3b0, 0x0008);
    writeU16BE(state.workRam, 0x406, 0x0002);
    state.workRam[0x39a] = 1;
    writeRuntimeMotionObject(state, 64, {
      word0: 0x0021,
      word1: 0x0110,
      word2: 0x0041,
      word3: 0x0001,
    });
    writeRuntimeMotionObject(state, 65, {
      word0: 0x0042,
      word1: 0x0220,
      word2: 0x0062,
      word3: 0x0002,
    });
    writeRuntimeMotionObject(state, 66, {
      word0: 0x0063,
      word1: 0x0330,
      word2: 0x0083,
      word3: 0x0002,
    });

    const frame = buildFrame(state, { motionObjects: "runtime-counter" });

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
      {
        spriteIndex: 0x20,
        x: 3,
        y: 2,
        width: 24,
        height: 24,
        paletteIndex: 0x102,
        flipX: false,
        priority: 0,
        translucent: false,
      },
    ]);
  });

  it("falls back to the linked list before the runtime emitter has written a count", () => {
    const state = emptyGameState();
    writeRuntimeMotionObject(state, 0, {
      word0: 0x0021,
      word1: 0x0110,
      word2: 0x0041,
      word3: 0x0001,
    });
    writeRuntimeMotionObject(state, 1, {
      word0: 0x0042,
      word1: 0x0220,
      word2: 0x0062,
      word3: 0x0001,
    });

    expect(buildSpritesFromRuntimeMotionObjects(state)).toHaveLength(2);
  });

  it("uses the runtime counter to ignore stale Practice Race end-of-level motion-object banks", () => {
    const scenario = JSON.parse(
      readFileSync(resolve("oracle/scenarios/gameplay/level1_end.json"), "utf-8"),
    ) as GameplayScenario;
    let maxStaleExtra = 0;

    for (const snapshot of scenario.snapshots) {
      const state = loadGameplaySnapshotState(snapshot);
      const runtimeFrame = buildFrame(state, { motionObjects: "runtime-counter" });
      const allBanksFrame = buildFrame(state, { motionObjects: "all-banks" });
      const runtimeCount = readU16BE(state.workRam, 0x406);

      expect(runtimeFrame.sprites).toHaveLength(runtimeCount);
      maxStaleExtra = Math.max(maxStaleExtra, allBanksFrame.sprites.length - runtimeFrame.sprites.length);
    }

    expect(maxStaleExtra).toBeGreaterThan(0);
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
        paletteIndex: 0x42, // 0x40 + (1 << (4-3))
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
        paletteIndex: 0x4c, // 0x40 + (3 << (5-3))
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
        paletteIndex: 0x28,
        flipX: false,
        priority: 0,
        translucent: false,
      },
    ]);
  });

  it("keeps the high-priority motion-object visual palette workaround", () => {
    const ram = new Uint8Array(8);
    ram.set([0x00, 0x21, 0x03, 0x10, 0x80, 0x41, 0x00, 0x00], 0);
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
        paletteIndex: 0x44,
        flipX: false,
        priority: 1,
        translucent: true,
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
