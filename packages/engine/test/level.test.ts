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

  it("rejects out-of-range level index", () => {
    expect(() => loadLevel(rom!, -1)).toThrow();
    expect(() => loadLevel(rom!, 6)).toThrow();
  });
});
