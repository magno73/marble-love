/**
 * Test `alphaRamBootInitED6` (FUN_ED6) — smoke + side-effect coverage.
 *
 * `packages/cli/src/test-alpha-ram-boot-init-ed6-parity.ts` (500/500 cases).
 */

import { describe, it, expect } from "vitest";
import {
  alphaRamBootInitED6,
  ALPHA_RAM_BOOT_INIT_ED6_ADDR,
  ALPHA_RAM_BASE_ADDR,
  SOURCE_TABLE_ROM_ADDR,
  QUADRANT_COUNT,
  ROW_PER_QUADRANT,
  WORDS_PER_ROW,
  ROW_STRIDE_BYTES,
  SOURCE_QUADRANT_STRIDE_BYTES,
  BLANK_TILE_WORD,
  FILL_LOOP_COUNT,
  FILL_LOOP_2_BASE_OFFSET,
  FILL_LOOP_3_BASE_OFFSET,
} from "../src/alpha-ram-boot-init-ed6.js";
import { emptyGameState } from "../src/state.js";
import { emptyRomImage } from "../src/bus.js";

describe("alphaRamBootInitED6 (FUN_ED6)", () => {
  it("costanti coerenti col disasm", () => {
    expect(ALPHA_RAM_BOOT_INIT_ED6_ADDR).toBe(0xed6);
    expect(ALPHA_RAM_BASE_ADDR).toBe(0xa03000);
    expect(SOURCE_TABLE_ROM_ADDR).toBe(0x6928);
    expect(QUADRANT_COUNT).toBe(3); // moveq #3, D0; cmp.w D4, D0
    expect(ROW_PER_QUADRANT).toBe(10); // moveq #0xA, D0; cmp.w D5, D0
    expect(WORDS_PER_ROW).toBe(42); // moveq #0x2A, D0; cmp.w D2, D0
    expect(ROW_STRIDE_BYTES).toBe(0x80); // addi.l #0x80, D6
    expect(SOURCE_QUADRANT_STRIDE_BYTES).toBe(0x54); // mulu.w #0x54, D0
    expect(BLANK_TILE_WORD).toBe(0x2000); // move.w #0x2000, (A0)
    expect(FILL_LOOP_COUNT).toBe(34); // 0x26 - 4
    expect(FILL_LOOP_2_BASE_OFFSET).toBe(0x000);
    expect(FILL_LOOP_3_BASE_OFFSET).toBe(0xe80); // 0xA03E80 - 0xA03000
  });

  it("copies il pattern ROM[0x6928 + D4*0x54] in 10 row consecutivi per each quadrante", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();
    for (let i = 0; i < QUADRANT_COUNT * SOURCE_QUADRANT_STRIDE_BYTES; i++) {
      rom.program[SOURCE_TABLE_ROM_ADDR + i] = (i | 0x80) & 0xff;
    }
    // Pre-fill alphaRam with sentinel 0xCC.
    state.alphaRam.fill(0xcc);

    alphaRamBootInitED6(state, rom);

    // For each D4 quadrant, every D5 row must contain ROM[0x6928 + D4*0x54..].
    // The bytes [row .. row + WORDS_PER_ROW*2 - 1] = [row .. row+0x53].
    for (let d4 = 0; d4 < QUADRANT_COUNT; d4++) {
      const srcBase = SOURCE_TABLE_ROM_ADDR + d4 * SOURCE_QUADRANT_STRIDE_BYTES;
      for (let d5 = 0; d5 < ROW_PER_QUADRANT; d5++) {
        const rowOff = (d4 * ROW_PER_QUADRANT + d5) * ROW_STRIDE_BYTES;
        for (let b = 0; b < WORDS_PER_ROW * 2; b++) {
          // Exception for loops 2 and 3, which overwrite part of some rows.
          // Loop 2 overwrites offsets [0x008..0x04B] (row 0, quadrant 0).
          // Loop 3 overwrites offsets [0xE88..0xECB] (row 9, quadrant 2).
          const absOff = rowOff + b;
          if (absOff >= 0x008 && absOff <= 0x04b) continue;
          if (absOff >= 0xe88 && absOff <= 0xecb) continue;
          const expected = rom.program[srcBase + b] ?? 0;
          expect(state.alphaRam[absOff]).toBe(expected);
        }
        // The bytes [row + 0x54 .. row + 0x7F] (44 bytes) stay 0xCC.
        for (let b = WORDS_PER_ROW * 2; b < ROW_STRIDE_BYTES; b++) {
          const absOff = rowOff + b;
          expect(state.alphaRam[absOff]).toBe(0xcc);
        }
      }
    }
  });

  it("writes 0x2000 word a alphaRam[0x008..0x04B] (loop 2, 34 word)", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();
    state.alphaRam.fill(0xcc);
    alphaRamBootInitED6(state, rom);

    // 34 words starting at offset 0x008 (D2=4 → D2*2=8).
    for (let i = 0; i < FILL_LOOP_COUNT; i++) {
      const off = FILL_LOOP_2_BASE_OFFSET + (4 + i) * 2;
      expect(state.alphaRam[off]).toBe(0x20);
      expect(state.alphaRam[off + 1]).toBe(0x00);
    }
    // (here ROM = 0 → alphaRam[0..7] = 0).
    for (let i = 0; i < 8; i++) {
      expect(state.alphaRam[i]).toBe(0x00);
    }
    for (let i = 0x4c; i < 0x54; i++) {
      expect(state.alphaRam[i]).toBe(0x00);
    }
  });

  it("writes 0x2000 word a alphaRam[0xE88..0xECB] (loop 3, 34 word)", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();
    state.alphaRam.fill(0xcc);
    alphaRamBootInitED6(state, rom);

    for (let i = 0; i < FILL_LOOP_COUNT; i++) {
      const off = FILL_LOOP_3_BASE_OFFSET + (4 + i) * 2;
      expect(state.alphaRam[off]).toBe(0x20);
      expect(state.alphaRam[off + 1]).toBe(0x00);
    }
  });

  it("non tocca alphaRam[0xF00..0xFFF] (beyond l'last row)", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();
    state.alphaRam.fill(0xcc);
    alphaRamBootInitED6(state, rom);

    // The last row written by loop 1 starts at 0xE80 and covers 42 words through 0xED3.
    // Loop 3 overwrites 0xE88..0xECB. Bytes 0xED4..0xEFF (44 skipped row-9 bytes)
    // and 0xF00..0xFFF (beyond the range of loop 1) stay sentinel.
    for (let i = 0xed4; i < 0xf00; i++) {
      expect(state.alphaRam[i]).toBe(0xcc);
    }
    for (let i = 0xf00; i < 0x1000; i++) {
      expect(state.alphaRam[i]).toBe(0xcc);
    }
  });

  it("is idempotente: invocations multiple producono lo same state", () => {
    const stateA = emptyGameState();
    const stateB = emptyGameState();
    const rom = emptyRomImage();
    for (let i = 0; i < QUADRANT_COUNT * SOURCE_QUADRANT_STRIDE_BYTES; i++) {
      rom.program[SOURCE_TABLE_ROM_ADDR + i] = (i * 7 + 3) & 0xff;
    }
    stateA.alphaRam.fill(0x55);
    stateB.alphaRam.fill(0x55);

    alphaRamBootInitED6(stateA, rom);
    alphaRamBootInitED6(stateA, rom);
    alphaRamBootInitED6(stateB, rom);

    for (let i = 0; i < 0x1000; i++) {
      expect(stateA.alphaRam[i]).toBe(stateB.alphaRam[i]);
    }
  });
});
