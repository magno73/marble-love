/**
 * Test level loader. Usa il blob ROM reale a `ghidra_project/marble_program.bin`
 * (cercato sia da CWD package, sia dalla repo root, sia da var env).
 *
 * Se la ROM non è disponibile, skippa i test (non bloccante per CI).
 */

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  LEVEL_POINTER_TABLE_OFFSET,
  LEVEL_COUNT,
  LEVEL_HEADER_SIZE,
  HEIGHT_RECORD_SIZE,
  TERRAIN_COEFFICIENT_COUNT,
  decodeDirectTerrainByteRecord,
  decodeTerrainCode,
  resolveTerrainCodeHeights,
  loadAllLevels,
  loadLevel,
  readLevelPointerTable,
} from "../src/level.js";
import { emptyRomImage } from "../src/bus.js";
import type { RomImage } from "../src/bus.js";

function findRomBlob(): string | null {
  const candidates = [
    process.env["MARBLE_LOVE_ROM_BLOB"],
    resolve(process.cwd(), "ghidra_project/marble_program.bin"),
    resolve(process.cwd(), "../../ghidra_project/marble_program.bin"),
  ].filter((x): x is string => typeof x === "string");
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

function loadRomFromBlob(): RomImage | null {
  const path = findRomBlob();
  if (path === null) return null;
  const program = readFileSync(path);
  const rom = emptyRomImage();
  // Copy first program.length bytes (likely 0x88000)
  rom.program.set(program.subarray(0, rom.program.length));
  return rom;
}

describe("Level loader (constants)", () => {
  it("LEVEL_POINTER_TABLE_OFFSET = 0x2BE00", () => {
    expect(LEVEL_POINTER_TABLE_OFFSET).toBe(0x2BE00);
  });
  it("LEVEL_COUNT = 6", () => {
    expect(LEVEL_COUNT).toBe(6);
  });
  it("LEVEL_HEADER_SIZE = 0x2E (verified Phase 1 static — was 36 pre-fix)", () => {
    expect(LEVEL_HEADER_SIZE).toBe(0x2e);
  });
  it("HEIGHT_RECORD_SIZE = 8", () => {
    expect(HEIGHT_RECORD_SIZE).toBe(8);
  });
  it("terrain coefficient table has 32 word entries", () => {
    expect(TERRAIN_COEFFICIENT_COUNT).toBe(32);
  });
});

describe("Level terrain-code decode", () => {
  it("decodes the five terrain-code classes used by FUN_1CABA", () => {
    expect(decodeTerrainCode(0x0000)).toEqual({ kind: "empty", raw: 0x0000 });
    expect(decodeTerrainCode(0x0001)).toEqual({
      kind: "direct",
      raw: 0x0001,
      directRecordOffset: 0x0001,
    });
    expect(decodeTerrainCode(0x0812)).toEqual({
      kind: "indirect",
      raw: 0x0812,
      altTableByteOffset: 0x0012,
      altTableWordIndex: 0x0009,
    });
    expect(decodeTerrainCode(0x1245)).toEqual({
      kind: "quad",
      raw: 0x1245,
      baseHeightDelta: 5,
      coefficientIndex: 4,
      coefficientTableByteOffset: 8,
      sampleMask: 1,
    });
    expect(decodeTerrainCode(0xf000)).toEqual({
      kind: "flat",
      raw: 0xf000,
      baseHeightDelta: -64,
    });
    expect(decodeTerrainCode(0xf07f)).toEqual({
      kind: "flat",
      raw: 0xf07f,
      baseHeightDelta: 63,
    });
  });

  it("decodes direct terrain byte records as four byte samples with zero mask", () => {
    expect(decodeDirectTerrainByteRecord(new Uint8Array([0x00, 0x01, 0x40, 0xff]))).toEqual({
      raw: new Uint8Array([0x00, 0x01, 0x40, 0xff]),
      sampleBytes: [0x00, 0x01, 0x40, 0xff],
      emptySampleMask: 0x01,
    });
  });

  it("resolves quad and flat terrain heights with the FUN_1CABA formula", () => {
    const quad = decodeTerrainCode(0x2245);
    expect(quad.kind).toBe("quad");
    expect(resolveTerrainCodeHeights(quad, 0x4000, 0x0008)).toEqual([
      0x3ffd,
      0x4005,
      0x3ffd,
      0x3ffd,
    ]);

    const flat = decodeTerrainCode(0xf07f);
    expect(resolveTerrainCodeHeights(flat, 0x4000)).toEqual([
      0x403f,
      0x403f,
      0x403f,
      0x403f,
    ]);
  });
});

const rom = loadRomFromBlob();
const describeWithRom = rom === null ? describe.skip : describe;

describeWithRom("Level loader (with real ROM)", () => {
  it("pointer table reads expected 6 valid offsets", () => {
    const ptrs = readLevelPointerTable(rom!);
    expect(ptrs.length).toBe(6);
    // Pointers ascendenti dentro il range del program ROM (0..0x88000)
    for (let i = 0; i < ptrs.length - 1; i++) {
      expect(ptrs[i]!).toBeLessThan(ptrs[i + 1]!);
      expect(ptrs[i]!).toBeGreaterThanOrEqual(0x10000);
      expect(ptrs[i]!).toBeLessThan(0x88000);
    }
  });

  it("expected absolute pointers (Phase 4b verified)", () => {
    const ptrs = readLevelPointerTable(rom!);
    expect(ptrs).toEqual([
      0x0002BEE2, 0x0002C54C, 0x0002CD9E,
      0x0002D648, 0x0002DE1E, 0x0002E790,
    ]);
  });

  it("loads all 6 levels without throwing", () => {
    const levels = loadAllLevels(rom!);
    expect(levels.length).toBe(6);
    for (const lev of levels) {
      expect(lev.byteSize).toBeGreaterThan(LEVEL_HEADER_SIZE);
      expect(lev.header.raw.length).toBe(LEVEL_HEADER_SIZE);
      expect(lev.postHeader.terrainRowPointers.entries.length).toBeGreaterThan(0);
      expect(lev.records.length).toBeGreaterThan(0);
    }
  });

  it("Level 1 has reasonable size (1-3 KB)", () => {
    const l1 = loadLevel(rom!, 0);
    expect(l1.byteSize).toBeGreaterThan(1000);
    expect(l1.byteSize).toBeLessThan(3000);
  });

  it("Level records have non-zero data (not all blanks)", () => {
    const l1 = loadLevel(rom!, 0);
    const totalNonZero = l1.records.reduce(
      (acc, r) => acc + (r.word0 + r.word1 + r.word2 + r.word3 > 0 ? 1 : 0),
      0
    );
    expect(totalNonZero).toBeGreaterThan(10);
  });

  it("decodes post-header row pointer tables and terminators", () => {
    const levels = loadAllLevels(rom!);
    expect(levels.map((l) => l.postHeader.terrainRowPointers.entries.length)).toEqual([
      36, 36, 36, 36, 36, 144,
    ]);
    for (const lev of levels) {
      expect(lev.postHeader.terrainRowPointers.startPtr).toBe(lev.romOffset + LEVEL_HEADER_SIZE);
      expect(lev.postHeader.terrainRowPointers.endPtr).toBe(lev.header.subPatternTablePtr);
      expect(lev.postHeader.terrainRowPointers.terminator).toBe(0xffff);
    }
  });

  it("decodes sub-pattern and tile-line descriptor table boundaries", () => {
    const levels = loadAllLevels(rom!);
    expect(levels.map((l) => l.postHeader.subPatternPointers.entries.length)).toEqual([
      12, 21, 9, 13, 15, 7,
    ]);
    expect(levels.map((l) => l.postHeader.tileLineDescriptors.decodedCount)).toEqual([
      66, 79, 71, 78, 110, 53,
    ]);
    for (const lev of levels) {
      expect(lev.postHeader.tileLineDescriptors.decodedCount).toBe(lev.header.rowBuildEntryCount);
      expect(lev.postHeader.tileLineDescriptors.physicalCount).toBeGreaterThanOrEqual(
        lev.postHeader.tileLineDescriptors.decodedCount,
      );
    }
  });

  it("decodes row-build scripts exactly up to the RLE source pointer", () => {
    const levels = loadAllLevels(rom!);
    expect(levels.map((l) => l.postHeader.rowBuildScript.chunks.length)).toEqual([
      7, 9, 8, 9, 10, 9,
    ]);
    expect(levels.map((l) => (
      l.postHeader.rowBuildScript.chunks.reduce((sum, c) => sum + c.patches.length, 0)
    ))).toEqual([12, 20, 110, 0, 0, 272]);
    for (const lev of levels) {
      expect(lev.postHeader.rowBuildScript.endPtr).toBe(lev.header.rleSourcePtr);
      expect(lev.postHeader.rowBuildScript.chunks.at(-1)?.terminator).toBe(0xffff);
    }
  });

  it("decodes RLE row-offset runs and expands to the max tile bound", () => {
    const levels = loadAllLevels(rom!);
    expect(levels.map((l) => l.postHeader.rleRuns.runs.length)).toEqual([
      3, 6, 5, 5, 11, 4,
    ]);
    for (const lev of levels) {
      expect(lev.postHeader.rleRuns.expandedWordCount).toBe(lev.header.maxTileBound);
    }
  });

  it("rejects out-of-range level index", () => {
    expect(() => loadLevel(rom!, -1)).toThrow();
    expect(() => loadLevel(rom!, 6)).toThrow();
  });
});
