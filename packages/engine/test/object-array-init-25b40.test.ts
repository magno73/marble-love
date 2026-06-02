/**
 * Test objectArrayInit25B40 (FUN_00025B40) - smoke tests for writes
 * of 24-word array @ A1+0x74/0x84/0x94 + byte clear @ A1+0xCA.
 *
 * Bit-perfect verified against the binary through
 * `cli/src/test-object-array-init-25b40-parity.ts` (500/500 cases).
 */

import { describe, it, expect } from "vitest";
import {
  objectArrayInit25B40,
  OBJECT_ARRAY_INIT_25B40_ADDR,
  OBJECT_ARRAY_INIT_25B40_COUNT,
  OBJECT_ARRAY_INIT_25B40_FIELDS,
  OBJECT_ARRAY_INIT_25B40_SHIFT,
  OBJECT_ARRAY_INIT_25B40_TABLE_A_ROM,
  OBJECT_ARRAY_INIT_25B40_TABLE_B_ROM,
  OBJECT_ARRAY_INIT_25B40_WRITTEN_RANGE,
} from "../src/object-array-init-25b40.js";
import { emptyGameState } from "../src/state.js";
import { emptyRomImage } from "../src/bus.js";
import type { RomImage } from "../src/bus.js";

const WORK_RAM_BASE = 0x400000;

/** Reads a big-endian word from workRam. */
function readU16BE(wr: Uint8Array, off: number): number {
  return (((wr[off] ?? 0) << 8) | (wr[off + 1] ?? 0)) & 0xffff;
}

/** Create ROM with tables filled as desired. */
function makeRomWithTables(
  tableA: readonly number[],
  tableB: readonly number[],
): RomImage {
  const rom = emptyRomImage();
  for (let i = 0; i < tableA.length; i++) {
    rom.program[OBJECT_ARRAY_INIT_25B40_TABLE_A_ROM + i] = tableA[i]! & 0xff;
  }
  for (let i = 0; i < tableB.length; i++) {
    rom.program[OBJECT_ARRAY_INIT_25B40_TABLE_B_ROM + i] = tableB[i]! & 0xff;
  }
  return rom;
}

describe("objectArrayInit25B40 (FUN_00025B40)", () => {
  it("writes 3 arrays of 8 words + byte clear @ +0xCA with real ROM tables", () => {
    // Real tables extracted from ROM @ 0x1D3F4 / 0x1D3FC.
    const tableA = [0x02, 0x02, 0x00, 0xfe, 0xfc, 0xfe, 0x00, 0x04];
    const tableB = [0x02, 0xfe, 0xfc, 0xfe, 0x00, 0x02, 0x04, 0x00];
    const rom = makeRomWithTables(tableA, tableB);

    const s = emptyGameState();
    const objPtr = WORK_RAM_BASE + 0x1000;
    const objOff = objPtr - WORK_RAM_BASE;

    // Pre-fill obj with non-zero sentinel to verify writes.
    for (let k = 0; k < 0x100; k++) s.workRam[objOff + k] = 0x55;

    objectArrayInit25B40(s, rom, objPtr);

    // A1[+0xCA].b = 0
    expect(s.workRam[objOff + 0xca]).toBe(0);

    // For each i in 0..7:
    //   array A @ +0x74 + i*2 = sext_b(tableA[i]) << 11 (16 bit wrap)
    //   array B @ +0x84 + i*2 = sext_b(tableB[i]) << 11
    //   array Z @ +0x94 + i*2 = 0
    const sextByte = (b: number): number => (b >= 0x80 ? b - 0x100 : b) & 0xffff;
    for (let i = 0; i < OBJECT_ARRAY_INIT_25B40_COUNT; i++) {
      const expA = (sextByte(tableA[i]!) << OBJECT_ARRAY_INIT_25B40_SHIFT) & 0xffff;
      const expB = (sextByte(tableB[i]!) << OBJECT_ARRAY_INIT_25B40_SHIFT) & 0xffff;
      expect(readU16BE(s.workRam, objOff + 0x74 + i * 2)).toBe(expA);
      expect(readU16BE(s.workRam, objOff + 0x84 + i * 2)).toBe(expB);
      expect(readU16BE(s.workRam, objOff + 0x94 + i * 2)).toBe(0);
    }

    // Concrete checks (table A real values):
    //   i=0: 0x02 → sext = 0x0002 → <<11 = 0x1000
    //   i=3: 0xfe → sext = 0xFFFE → <<11 & 0xFFFF = 0xF000
    //   i=4: 0xfc → sext = 0xFFFC → <<11 & 0xFFFF = 0xE000
    expect(readU16BE(s.workRam, objOff + 0x74 + 0 * 2)).toBe(0x1000);
    expect(readU16BE(s.workRam, objOff + 0x74 + 3 * 2)).toBe(0xf000);
    expect(readU16BE(s.workRam, objOff + 0x74 + 4 * 2)).toBe(0xe000);
    // i=7: 0x04 → 0x4 << 11 = 0x2000
    expect(readU16BE(s.workRam, objOff + 0x74 + 7 * 2)).toBe(0x2000);
  });

  it("does not mutate bytes near the written ranges (0x70..0x73, 0xA4..0xC9, 0xCB..0xCF)", () => {
    const rom = makeRomWithTables(
      [0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08],
      [0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17, 0x18],
    );

    const s = emptyGameState();
    const objPtr = WORK_RAM_BASE + 0x1100;
    const objOff = objPtr - WORK_RAM_BASE;

    // Sentinels on neighbors, which writes must not touch.
    // Written ranges: contiguous [0x74, 0xA3] + byte @ 0xCA.
    // Neighbors: [0x70, 0x73] below, [0xA4, 0xC9] between, [0xCB, 0xCF] above.
    const neighborOffs = [
      0x70, 0x71, 0x72, 0x73, // below
      0xa4, 0xa5, 0xb0, 0xc0, 0xc8, 0xc9, // between
      0xcb, 0xcc, 0xcf, // above
    ];
    const sentinels: Record<number, number> = {};
    for (let idx = 0; idx < neighborOffs.length; idx++) {
      const off = neighborOffs[idx]!;
      const v = (0xb0 + idx) & 0xff;
      sentinels[off] = v;
      s.workRam[objOff + off] = v;
    }

    objectArrayInit25B40(s, rom, objPtr);

    for (const off of neighborOffs) {
      expect(s.workRam[objOff + off]).toBe(sentinels[off]);
    }
  });

  it("ROM with all-zero tables → all arrays zero, byte +0xCA zero", () => {
    const rom = makeRomWithTables(
      [0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0],
    );

    const s = emptyGameState();
    const objPtr = WORK_RAM_BASE + 0x1200;
    const objOff = objPtr - WORK_RAM_BASE;

    // Pre-fill with non-zero sentinel to show that the writes
    // zero out the 24 words + 1 target byte.
    for (let k = 0; k < 0x100; k++) s.workRam[objOff + k] = 0xaa;

    objectArrayInit25B40(s, rom, objPtr);

    for (let i = 0; i < OBJECT_ARRAY_INIT_25B40_COUNT; i++) {
      expect(readU16BE(s.workRam, objOff + 0x74 + i * 2)).toBe(0);
      expect(readU16BE(s.workRam, objOff + 0x84 + i * 2)).toBe(0);
      expect(readU16BE(s.workRam, objOff + 0x94 + i * 2)).toBe(0);
    }
    expect(s.workRam[objOff + 0xca]).toBe(0);
  });

  it("tables with all bytes 0xFF (sext=-1) → array A/B = 0xF800 << 11 wrap", () => {
    // 0xFF sext_w = 0xFFFF. asl.w #11 → (0xFFFF << 11) & 0xFFFF = 0xF800.
    const rom = makeRomWithTables(
      [0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff],
      [0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff],
    );

    const s = emptyGameState();
    const objPtr = WORK_RAM_BASE + 0x1300;
    const objOff = objPtr - WORK_RAM_BASE;

    objectArrayInit25B40(s, rom, objPtr);

    for (let i = 0; i < OBJECT_ARRAY_INIT_25B40_COUNT; i++) {
      expect(readU16BE(s.workRam, objOff + 0x74 + i * 2)).toBe(0xf800);
      expect(readU16BE(s.workRam, objOff + 0x84 + i * 2)).toBe(0xf800);
      expect(readU16BE(s.workRam, objOff + 0x94 + i * 2)).toBe(0);
    }
  });

  it("exposed constants: correct binary and ROM addresses", () => {
    expect(OBJECT_ARRAY_INIT_25B40_ADDR).toBe(0x25b40);
    expect(OBJECT_ARRAY_INIT_25B40_TABLE_A_ROM).toBe(0x1d3f4);
    expect(OBJECT_ARRAY_INIT_25B40_TABLE_B_ROM).toBe(0x1d3fc);
    expect(OBJECT_ARRAY_INIT_25B40_COUNT).toBe(8);
    expect(OBJECT_ARRAY_INIT_25B40_SHIFT).toBe(11);
    expect(OBJECT_ARRAY_INIT_25B40_FIELDS.arrayABase).toBe(0x74);
    expect(OBJECT_ARRAY_INIT_25B40_FIELDS.arrayBBase).toBe(0x84);
    expect(OBJECT_ARRAY_INIT_25B40_FIELDS.arrayZBase).toBe(0x94);
    expect(OBJECT_ARRAY_INIT_25B40_FIELDS.byteAtCA).toBe(0xca);
    expect(OBJECT_ARRAY_INIT_25B40_WRITTEN_RANGE.contiguousLow).toBe(0x74);
    expect(OBJECT_ARRAY_INIT_25B40_WRITTEN_RANGE.contiguousHigh).toBe(0xa3);
    expect(OBJECT_ARRAY_INIT_25B40_WRITTEN_RANGE.isolatedByte).toBe(0xca);
  });
});
