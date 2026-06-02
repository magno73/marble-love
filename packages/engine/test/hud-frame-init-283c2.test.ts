/**
 * Test hudFrameInit283C2 (FUN_000283C2) — smoke tests on the main branches.
 *
 * `cli/src/test-hud-frame-init-283c2-parity.ts` (500/500).
 */

import { describe, it, expect } from "vitest";
import {
  hudFrameInit283C2,
  FUN_283C2_ADDR,
  PLAYER_COUNT_OFF,
  LOOP1_ROW_COUNT,
  LOOP1_CLEAR_WORD,
  LOOP1_RIGHT_OFF,
  LOOP1_GROUP_WORDS,
  ROM_COLS_1P,
  ROM_ROWS,
  ROM_DATA,
  ROM_COLS_2P,
  LOOP2_COUNT_1P,
  LOOP2_COUNT_2P,
  LOOP2_MASK,
} from "../src/hud-frame-init-283c2.js";
import { emptyGameState } from "../src/state.js";
import { emptyRomImage } from "../src/bus.js";
import type { RomImage } from "../src/bus.js";

function writeWordBE(ram: Uint8Array, off: number, value: number): void {
  ram[off] = (value >>> 8) & 0xff;
  ram[off + 1] = value & 0xff;
}

function writeRomWordBE(rom: RomImage, addr: number, value: number): void {
  rom.program[addr] = (value >>> 8) & 0xff;
  rom.program[addr + 1] = value & 0xff;
}

function readAlphaWordBE(alpha: Uint8Array, off: number): number {
  return (((alpha[off] ?? 0) << 8) | (alpha[off + 1] ?? 0)) & 0xffff;
}

/**
 * rows and data; 12 words for 1P cols).
 */
function setupRom(): RomImage {
  const rom = emptyRomImage();
  // ROM lookup table @ 0x72A4 (alpha-pointer shift count). For rotation=0,
  rom.program[0x72a5] = 0x00;

  // ROM cols 1P @ 0x23C2C (12 word).
  const cols1P = [
    0x0013, 0x0014, 0x0015, 0x0016, 0x0017, 0x0017, 0x0017, 0x0017,
    0x0016, 0x0015, 0x0014, 0x0013,
  ];
  for (let i = 0; i < cols1P.length; i++) {
    writeRomWordBE(rom, ROM_COLS_1P + i * 2, cols1P[i]!);
  }

  // ROM rows @ 0x23C44 (24 word).
  const rows = [
    0x0000, 0x0000, 0x0000, 0x0000, 0x0000, 0x0001, 0x0002, 0x0003,
    0x0003, 0x0003, 0x0003, 0x0003,
    0x0000, 0x0000, 0x0000, 0x0000, 0x0000, 0x0000, 0x0000, 0x0001,
    0x0002, 0x0003, 0x0003, 0x0003,
  ];
  for (let i = 0; i < rows.length; i++) {
    writeRomWordBE(rom, ROM_ROWS + i * 2, rows[i]!);
  }

  // ROM data @ 0x23C74 (24 word).
  const data = [
    0x005f, 0x005f, 0x005f, 0x005f, 0x00ff, 0x00df, 0x00df, 0x001b,
    0x005e, 0x005e, 0x005e, 0x005e,
    0x005f, 0x005f, 0x005f, 0x005f, 0x00ff, 0x00df, 0x00df, 0x001b,
    0x005e, 0x005e, 0x005e, 0x005e,
  ];
  for (let i = 0; i < data.length; i++) {
    writeRomWordBE(rom, ROM_DATA + i * 2, data[i]!);
  }

  // ROM cols 2P @ 0x23CA4 (24 word).
  const cols2P = [
    0x000d, 0x000e, 0x000f, 0x0010, 0x0011, 0x0011, 0x0011, 0x0011,
    0x0010, 0x000f, 0x000e, 0x000d,
    0x0019, 0x001a, 0x001b, 0x001c, 0x001d, 0x001d, 0x001d, 0x001d,
    0x001c, 0x001b, 0x001a, 0x0019,
  ];
  for (let i = 0; i < cols2P.length; i++) {
    writeRomWordBE(rom, ROM_COLS_2P + i * 2, cols2P[i]!);
  }

  return rom;
}

describe("hudFrameInit283C2 (FUN_000283C2)", () => {
  it("Loop1 (rotation=0): clears 30 lines × 6 word = 360 byte of bordo con 0x3400", () => {
    const s = emptyGameState();
    const rom = setupRom();
    // player count @ 0x396 = 0 (-> 2P branch, but this tests only Loop1:
    writeWordBE(s.workRam, PLAYER_COUNT_OFF, 1); // 1P (Loop2 places 12 frame tiles

    hudFrameInit283C2(s, rom);

    //   alpha[row*128 + 0..1, +2..3, +4..5] = 0x3400
    //   alpha[row*128 + 0x4E..0x4F, +0x50..0x51, +0x52..0x53] = 0x3400
    for (let row = 0; row < LOOP1_ROW_COUNT; row++) {
      const base = row * 128; // shift 6 (cols=64) × 2 byte/word
      // Left: 3 words
      for (let i = 0; i < LOOP1_GROUP_WORDS; i++) {
        const off = base + i * 2;
        expect(readAlphaWordBE(s.alphaRam, off), `row ${row}, left word ${i}`).toBe(LOOP1_CLEAR_WORD);
      }
      // Right: 3 words @ off+0x4E
      for (let i = 0; i < LOOP1_GROUP_WORDS; i++) {
        const off = base + LOOP1_RIGHT_OFF + i * 2;
        expect(readAlphaWordBE(s.alphaRam, off), `row ${row}, right word ${i}`).toBe(LOOP1_CLEAR_WORD);
      }
    }
  });

  it("Loop2 1P: con player count=1 disegna 12 tile usando ROM_COLS_1P", () => {
    const s = emptyGameState();
    const rom = setupRom();
    writeWordBE(s.workRam, PLAYER_COUNT_OFF, 1);

    hudFrameInit283C2(s, rom);

    // **Overlap handling**: some (col,row) tuples repeat — the last one wins.
    const cols1P = [0x13, 0x14, 0x15, 0x16, 0x17, 0x17, 0x17, 0x17, 0x16, 0x15, 0x14, 0x13];
    const rows = [0, 0, 0, 0, 0, 1, 2, 3, 3, 3, 3, 3];
    const data = [0x5f, 0x5f, 0x5f, 0x5f, 0xff, 0xdf, 0xdf, 0x1b, 0x5e, 0x5e, 0x5e, 0x5e];

    const finalVal = new Map<number, number>();
    for (let i = 0; i < LOOP2_COUNT_1P; i++) {
      const off = rows[i]! * 128 + cols1P[i]! * 2;
      finalVal.set(off, (data[i]! | LOOP2_MASK) & 0xffff);
    }
    for (const [off, expected] of finalVal) {
      expect(readAlphaWordBE(s.alphaRam, off), `Loop2 tile @ off 0x${off.toString(16)}`).toBe(expected);
    }
  });

  it("Loop2 2P: con player count=2 disegna 24 tile usando ROM_COLS_2P", () => {
    const s = emptyGameState();
    const rom = setupRom();
    writeWordBE(s.workRam, PLAYER_COUNT_OFF, 2);

    hudFrameInit283C2(s, rom);

    const cols2P = [
      0x0d, 0x0e, 0x0f, 0x10, 0x11, 0x11, 0x11, 0x11, 0x10, 0x0f, 0x0e, 0x0d,
      0x19, 0x1a, 0x1b, 0x1c, 0x1d, 0x1d, 0x1d, 0x1d, 0x1c, 0x1b, 0x1a, 0x19,
    ];
    const rows = [
      0, 0, 0, 0, 0, 1, 2, 3, 3, 3, 3, 3,
      0, 0, 0, 0, 0, 0, 0, 1, 2, 3, 3, 3,
    ];
    const data = [
      0x5f, 0x5f, 0x5f, 0x5f, 0xff, 0xdf, 0xdf, 0x1b, 0x5e, 0x5e, 0x5e, 0x5e,
      0x5f, 0x5f, 0x5f, 0x5f, 0xff, 0xdf, 0xdf, 0x1b, 0x5e, 0x5e, 0x5e, 0x5e,
    ];

    // Last-write-wins: some (col,row) tuples repeat in the 2P table.
    const finalVal = new Map<number, number>();
    for (let i = 0; i < LOOP2_COUNT_2P; i++) {
      const off = rows[i]! * 128 + cols2P[i]! * 2;
      finalVal.set(off, (data[i]! | LOOP2_MASK) & 0xffff);
    }
    for (const [off, expected] of finalVal) {
      expect(readAlphaWordBE(s.alphaRam, off), `Loop2 tile @ off 0x${off.toString(16)}`).toBe(expected);
    }
  });

  it("count=0 (caso non-1P, default emptyGameState): takes il branch 2P (24 tile)", () => {
    const s = emptyGameState();
    const rom = setupRom();

    hudFrameInit283C2(s, rom);

    const off0 = 0 * 128 + 0x0d * 2;
    expect(readAlphaWordBE(s.alphaRam, off0)).toBe((0x5f | LOOP2_MASK) & 0xffff);
    // And one tile in the area that 1P would not have written: row=0, col=0x19.
    const off12 = 0 * 128 + 0x19 * 2;
    expect(readAlphaWordBE(s.alphaRam, off12)).toBe((0x5f | LOOP2_MASK) & 0xffff);
  });

  it("non muta state.workRam (la funzione is solo lettore of workRam)", () => {
    const s = emptyGameState();
    const rom = setupRom();
    // Pollute workRam with a known pattern.
    for (let i = 0; i < s.workRam.length; i++) s.workRam[i] = (i * 7) & 0xff;
    writeWordBE(s.workRam, PLAYER_COUNT_OFF, 1);
    s.workRam[0x1f42] = 0; // rotation off
    s.workRam[0x1f43] = 0;
    const before = new Uint8Array(s.workRam);

    hudFrameInit283C2(s, rom);

    // workRam unchanged byte-by-byte.
    for (let i = 0; i < s.workRam.length; i++) {
      expect(s.workRam[i], `workRam byte 0x${i.toString(16)}`).toBe(before[i]);
    }
  });

  it("non muta state.alphaRam outside dalle 30 lines HUD (byte 0xF00..0xFFF intact)", () => {
    const s = emptyGameState();
    const rom = setupRom();
    for (let i = 0xf00; i < s.alphaRam.length; i++) s.alphaRam[i] = 0xaa;
    writeWordBE(s.workRam, PLAYER_COUNT_OFF, 1);

    hudFrameInit283C2(s, rom);

    for (let i = 0xf00; i < s.alphaRam.length; i++) {
      expect(s.alphaRam[i], `alphaRam byte 0x${i.toString(16)}`).toBe(0xaa);
    }
  });

  it("costanti exposed: indirizzi binary corretti", () => {
    expect(FUN_283C2_ADDR).toBe(0x000283c2);
    expect(PLAYER_COUNT_OFF).toBe(0x396);
    expect(LOOP1_ROW_COUNT).toBe(0x1e);
    expect(LOOP1_CLEAR_WORD).toBe(0x3400);
    expect(LOOP1_RIGHT_OFF).toBe(0x4e);
    expect(LOOP1_GROUP_WORDS).toBe(3);
    expect(ROM_COLS_1P).toBe(0x00023c2c);
    expect(ROM_ROWS).toBe(0x00023c44);
    expect(ROM_DATA).toBe(0x00023c74);
    expect(ROM_COLS_2P).toBe(0x00023ca4);
    expect(LOOP2_COUNT_1P).toBe(0x0c);
    expect(LOOP2_COUNT_2P).toBe(0x18);
    expect(LOOP2_MASK).toBe(0x1c00);
  });
});
