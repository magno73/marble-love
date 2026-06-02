/**
 * Test positionUpdate (FUN_1706C) — 452 byte pure leaf.
 *
 * Bit-perfect verified against the binary (2000/2000) through
 * `cli/src/test-position-update-parity.ts`.
 */

import { describe, it, expect } from "vitest";
import {
  positionUpdate,
  POS_BITMAP_OFF,
  POS_FLAG_PX_OFF,
  POS_GATE_PX_OFF,
  POS_ROT_IDX_OFF,
  POS_ROT_SPEC_OFF,
} from "../src/position-update.js";
import { emptyGameState } from "../src/state.js";
import { emptyRomImage } from "../src/bus.js";

function readU32(s: ReturnType<typeof emptyGameState>, addr: number): number {
  const off = addr - 0x400000;
  return (
    (((s.workRam[off] ?? 0) << 24) |
      ((s.workRam[off + 1] ?? 0) << 16) |
      ((s.workRam[off + 2] ?? 0) << 8) |
      (s.workRam[off + 3] ?? 0)) >>> 0
  );
}

describe("positionUpdate (FUN_1706C)", () => {
  it("all flag 0: x and y unchanged", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    // Setup: struct @ 0x401D00 = (0x12345678, 0xABCDEF01)
    s.workRam[0x1D00] = 0x12; s.workRam[0x1D01] = 0x34;
    s.workRam[0x1D02] = 0x56; s.workRam[0x1D03] = 0x78;
    s.workRam[0x1D04] = 0xAB; s.workRam[0x1D05] = 0xCD;
    s.workRam[0x1D06] = 0xEF; s.workRam[0x1D07] = 0x01;
    // Tutti flag/bitmap = 0
    positionUpdate(s, rom, 0x00401D00);
    expect(readU32(s, 0x401D00)).toBe(0x12345678);
    expect(readU32(s, 0x401D04)).toBe(0xABCDEF01);
  });

  it("flag PX != 0 + gate PX > 0 + rotIdx < 4: x += rom_table[rotIdx]", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    // Forziamo ROM table[0] = 0x0010 (= +16 signed)
    rom.program[0x23D40] = 0; rom.program[0x23D41] = 0x10;
    // Struct @ 0x401D00 = (100, 200)
    s.workRam[0x1D00] = 0; s.workRam[0x1D01] = 0;
    s.workRam[0x1D02] = 0; s.workRam[0x1D03] = 100;
    s.workRam[0x1D04] = 0; s.workRam[0x1D05] = 0;
    s.workRam[0x1D06] = 0; s.workRam[0x1D07] = 200;
    s.workRam[POS_FLAG_PX_OFF] = 1;
    s.workRam[POS_GATE_PX_OFF] = 0; s.workRam[POS_GATE_PX_OFF + 1] = 1; // gate = 1 > 0
    s.workRam[POS_ROT_IDX_OFF] = 0; // rotIdx 0 < 4
    s.workRam[POS_ROT_SPEC_OFF] = 7; // d2 = 0, d1 = 7 (>= 4 → no -X), d4 = 7 (>= 4 → no -Y)
    positionUpdate(s, rom, 0x00401D00);
    // x should be 100 + 16 = 116
    expect(readU32(s, 0x401D00)).toBe(116);
    // y unchanged (flagPy = 0)
    expect(readU32(s, 0x401D04)).toBe(200);
  });

  it("rotIdx >= 4: cardinale skip also con flag set", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    rom.program[0x23D40 + 4 * 2] = 0; rom.program[0x23D40 + 4 * 2 + 1] = 0x20;
    s.workRam[0x1D03] = 50;
    s.workRam[POS_FLAG_PX_OFF] = 1;
    s.workRam[POS_GATE_PX_OFF + 1] = 1;
    s.workRam[POS_ROT_IDX_OFF] = 4; // rotIdx >= 4 → skip
    positionUpdate(s, rom, 0x00401D00);
    expect(readU32(s, 0x401D00)).toBe(50); // unchanged
  });

  it("flag PX = 3: skip (cmpi #3 ble)", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    rom.program[0x23D41] = 0x05;
    s.workRam[0x1D03] = 10;
    s.workRam[POS_FLAG_PX_OFF] = 3;  // 3 NOT < 3
    s.workRam[POS_GATE_PX_OFF + 1] = 1;
    s.workRam[POS_ROT_IDX_OFF] = 0;
    positionUpdate(s, rom, 0x00401D00);
    expect(readU32(s, 0x401D00)).toBe(10);
  });

  it("bitmap bit 0 set + condizioni met: x and y both modificati", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    // table[0] = +5 (per d3=0), table[7] = +3 (per d2=7-7=0... aspetta)
    // d3 = rotIdx = 0, d2 = 7 - rotSpec = 7 - 7 = 0
    // Therefore both localM4 and -localM2 use table[0].
    rom.program[0x23D41] = 5; // table[0] = 5
    s.workRam[0x1D03] = 100;
    s.workRam[0x1D07] = 50;
    s.workRam[POS_BITMAP_OFF] = 0x01; // bit 0
    // d3=0<4, d2=0<4: condition met
    s.workRam[POS_ROT_IDX_OFF] = 0;
    s.workRam[POS_ROT_SPEC_OFF] = 7;
    s.workRam[POS_GATE_PX_OFF + 1] = 1; // gate > 0
    positionUpdate(s, rom, 0x00401D00);
    // x += localM4 (= 5)
    // y += localM2 (= -5)
    expect(readU32(s, 0x401D00)).toBe(105);
    expect(readU32(s, 0x401D04)).toBe(45);
  });
});
