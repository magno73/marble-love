/**
 * Test hudFrameInit283C2 (FUN_000283C2) — smoke tests sui rami principali.
 *
 * `FUN_000283C2` (166 byte) è un init HUD frame: cancella i bordi laterali di
 * 30 righe alpha tilemap + disegna un frame attorno alla score area
 * (12 tile in 1P, 24 in 2P). Bit-perfect verificato vs binary tramite
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

/** Helper: scrive un word big-endian in workRam @ off. */
function writeWordBE(ram: Uint8Array, off: number, value: number): void {
  ram[off] = (value >>> 8) & 0xff;
  ram[off + 1] = value & 0xff;
}

/** Helper: scrive un word big-endian in rom.program @ addr. */
function writeRomWordBE(rom: RomImage, addr: number, value: number): void {
  rom.program[addr] = (value >>> 8) & 0xff;
  rom.program[addr + 1] = value & 0xff;
}

/** Helper: legge un word big-endian da alphaRam @ off. */
function readAlphaWordBE(alpha: Uint8Array, off: number): number {
  return (((alpha[off] ?? 0) << 8) | (alpha[off + 1] ?? 0)) & 0xffff;
}

/**
 * Setup ROM con tabelle reali di Marble Madness ai loro offset binari.
 * Tabelle ricostruite dalle prime 16 entry (24 word ciascuna per cols 2P,
 * rows e data; 12 word per cols 1P).
 */
function setupRom(): RomImage {
  const rom = emptyRomImage();
  // ROM lookup table @ 0x72A4 (alpha-pointer shift count). Per rotation=0,
  // viene letto byte @ 0x72A5 = sext(byte). Il valore reale del ROM Marble
  // è 0x00 (shift 0 sul col). Layout: addr = (col + row*64) * 2.
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
  it("Loop1 (rotation=0): cancella 30 righe × 6 word = 360 byte di bordo con 0x3400", () => {
    const s = emptyGameState();
    const rom = setupRom();
    // rotation flag @ workRam[0x1F42] = 0 (default emptyGameState già 0).
    // player count @ 0x396 = 0 (→ 2P branch, ma testiamo solo Loop1 qui:
    // verifichiamo i bordi e ignoriamo l'effetto di Loop2 sui bordi —
    // il frame disegna alle col 13..23 / 25..29, fuori dai bordi 0..2/39..41).
    writeWordBE(s.workRam, PLAYER_COUNT_OFF, 1); // 1P (Loop2 mette 12 frame tile

    hudFrameInit283C2(s, rom);

    // Verifica Loop1: per ogni riga 0..29 in non-rotated layout
    //   alpha[row*128 + 0..1, +2..3, +4..5] = 0x3400
    //   alpha[row*128 + 0x4E..0x4F, +0x50..0x51, +0x52..0x53] = 0x3400
    for (let row = 0; row < LOOP1_ROW_COUNT; row++) {
      const base = row * 128; // shift 6 (cols=64) × 2 byte/word
      // Sinistro: 3 word
      for (let i = 0; i < LOOP1_GROUP_WORDS; i++) {
        const off = base + i * 2;
        expect(readAlphaWordBE(s.alphaRam, off), `row ${row}, left word ${i}`).toBe(LOOP1_CLEAR_WORD);
      }
      // Destro: 3 word @ off+0x4E
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

    // Verifica 12 tile: cols da 1P table, rows da rows table, data da data table.
    // Posizione alpha = (col, row) → alpha[row*128 + col*2] = data | mask (0x1C00).
    // **Overlap handling**: alcune tuple (col,row) si ripetono — l'ultima
    // scrittura vince, esattamente come il binario via setAlphaTile.
    const cols1P = [0x13, 0x14, 0x15, 0x16, 0x17, 0x17, 0x17, 0x17, 0x16, 0x15, 0x14, 0x13];
    const rows = [0, 0, 0, 0, 0, 1, 2, 3, 3, 3, 3, 3];
    const data = [0x5f, 0x5f, 0x5f, 0x5f, 0xff, 0xdf, 0xdf, 0x1b, 0x5e, 0x5e, 0x5e, 0x5e];

    // Computa il valore finale atteso per ogni cella (last-write-wins).
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

    // Last-write-wins (alcune tuple (col,row) si ripetono nella table 2P).
    const finalVal = new Map<number, number>();
    for (let i = 0; i < LOOP2_COUNT_2P; i++) {
      const off = rows[i]! * 128 + cols2P[i]! * 2;
      finalVal.set(off, (data[i]! | LOOP2_MASK) & 0xffff);
    }
    for (const [off, expected] of finalVal) {
      expect(readAlphaWordBE(s.alphaRam, off), `Loop2 tile @ off 0x${off.toString(16)}`).toBe(expected);
    }
  });

  it("count=0 (caso non-1P, default emptyGameState): prende il branch 2P (24 tile)", () => {
    const s = emptyGameState();
    const rom = setupRom();
    // PLAYER_COUNT_OFF già 0 → bne dal cmp.w D0(=1) → 2P branch.

    hudFrameInit283C2(s, rom);

    // Verifica almeno il primo tile 2P @ (col=0x0d, row=0).
    const off0 = 0 * 128 + 0x0d * 2;
    expect(readAlphaWordBE(s.alphaRam, off0)).toBe((0x5f | LOOP2_MASK) & 0xffff);
    // E un tile dell'area che 1P non avrebbe scritto: row=0, col=0x19.
    const off12 = 0 * 128 + 0x19 * 2;
    expect(readAlphaWordBE(s.alphaRam, off12)).toBe((0x5f | LOOP2_MASK) & 0xffff);
  });

  it("non muta state.workRam (la funzione è solo lettore di workRam)", () => {
    const s = emptyGameState();
    const rom = setupRom();
    // Pollute workRam con pattern noto.
    for (let i = 0; i < s.workRam.length; i++) s.workRam[i] = (i * 7) & 0xff;
    writeWordBE(s.workRam, PLAYER_COUNT_OFF, 1);
    s.workRam[0x1f42] = 0; // rotation off
    s.workRam[0x1f43] = 0;
    const before = new Uint8Array(s.workRam);

    hudFrameInit283C2(s, rom);

    // workRam invariato byte-by-byte
    for (let i = 0; i < s.workRam.length; i++) {
      expect(s.workRam[i], `workRam byte 0x${i.toString(16)}`).toBe(before[i]);
    }
  });

  it("non muta state.alphaRam fuori dalle 30 righe HUD (byte 0xF00..0xFFF intatti)", () => {
    const s = emptyGameState();
    const rom = setupRom();
    // Pollute alphaRam con sentinel 0xAA fuori del range 0..0xEFF (rows 30+).
    for (let i = 0xf00; i < s.alphaRam.length; i++) s.alphaRam[i] = 0xaa;
    writeWordBE(s.workRam, PLAYER_COUNT_OFF, 1);

    hudFrameInit283C2(s, rom);

    // Loop1 scrive solo a row*128+i (i < 0x54). Con row max=29, off max = 29*128+0x53 = 0xEd3.
    // Loop2 scrive a (row*128 + col*2) con row<=3, col<=0x1d → off max = 3*128+0x3a = 0x1ba.
    // Quindi range [0xF00, 0x1000) deve restare 0xAA.
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
