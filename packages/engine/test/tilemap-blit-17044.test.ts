/**
 * Test tilemapBlit17044 (FUN_17044) — smoke tests on the main branches.
 *
 * `cli/src/test-tilemap-blit-17044-parity.ts`.
 */

import { describe, it, expect } from "vitest";
import {
  tilemapBlit17044,
  ROM_SOURCE_ADDR,
  PF_RAM_BASE_ADDR,
  PF_DEST_ADDR,
  ROW_COUNT,
  WORDS_PER_ROW,
  BYTES_PER_ROW,
  ROW_SKIP_BYTES,
  ROW_STRIDE_BYTES,
  TOTAL_BYTES_COPIED,
} from "../src/tilemap-blit-17044.js";
import { emptyRomImage } from "../src/bus.js";

const PF_SIZE = 0x2000; // 8 KB PF RAM
const DEST_OFF = PF_DEST_ADDR - PF_RAM_BASE_ADDR; // 0x116

function fillRomSource(rom: ReturnType<typeof emptyRomImage>, byteFn: (i: number) => number): void {
  for (let i = 0; i < TOTAL_BYTES_COPIED; i++) {
    rom.program[ROM_SOURCE_ADDR + i] = byteFn(i) & 0xff;
  }
}

describe("tilemapBlit17044 (FUN_17044)", () => {
  it("constants consistent with the disasm", () => {
    expect(ROM_SOURCE_ADDR).toBe(0x19f04);
    expect(PF_RAM_BASE_ADDR).toBe(0xa00000);
    expect(PF_DEST_ADDR).toBe(0xa00116);
    expect(ROW_COUNT).toBe(6); // outer cmpi.b #0x6
    expect(WORDS_PER_ROW).toBe(0x14); // inner cmpi.b #0x14
    expect(BYTES_PER_ROW).toBe(40); // 20 word × 2
    expect(ROW_SKIP_BYTES).toBe(0x58); // moveq #0x58
    expect(ROW_STRIDE_BYTES).toBe(0x80); // 40 + 88
    expect(TOTAL_BYTES_COPIED).toBe(240); // 6 × 40
  });

  it("copies 240 contiguous bytes from the ROM into 6 windows of 40 bytes (preserving the 88 skip bytes)", () => {
    const rom = emptyRomImage();
    // Incremental pattern to catch each byte uniquely.
    fillRomSource(rom, (i) => (i + 1) & 0xff);
    const pf = new Uint8Array(PF_SIZE).fill(0xcc);

    tilemapBlit17044(rom, pf);

    // Pre-DEST byte = 0xCC preserved
    for (let i = 0; i < DEST_OFF; i++) expect(pf[i]).toBe(0xcc);

    for (let row = 0; row < ROW_COUNT; row++) {
      const base = DEST_OFF + row * ROW_STRIDE_BYTES;
      for (let j = 0; j < BYTES_PER_ROW; j++) {
        const expected = ((row * BYTES_PER_ROW + j) + 1) & 0xff;
        expect(pf[base + j]).toBe(expected);
      }
      for (let j = BYTES_PER_ROW; j < ROW_STRIDE_BYTES; j++) {
        expect(pf[base + j]).toBe(0xcc);
      }
    }

    const afterLast = DEST_OFF + (ROW_COUNT - 1) * ROW_STRIDE_BYTES + BYTES_PER_ROW;
    expect(afterLast).toBe(0x3be);
    for (let i = afterLast; i < PF_SIZE; i++) {
      expect(pf[i]).toBe(0xcc);
    }
  });

  it("preserves PF RAM outside the range [0x116..0x3BD] in a bit-perfect way", () => {
    const rom = emptyRomImage();
    fillRomSource(rom, () => 0x42);
    const pf = new Uint8Array(PF_SIZE);
    for (let i = 0; i < PF_SIZE; i++) pf[i] = (i * 7) & 0xff;
    const before = new Uint8Array(pf);

    tilemapBlit17044(rom, pf);

    // [0..0x115] preserved
    for (let i = 0; i < DEST_OFF; i++) expect(pf[i]).toBe(before[i]);

    for (let row = 0; row < ROW_COUNT; row++) {
      const base = DEST_OFF + row * ROW_STRIDE_BYTES;
      for (let j = 0; j < BYTES_PER_ROW; j++) expect(pf[base + j]).toBe(0x42);
      for (let j = BYTES_PER_ROW; j < ROW_STRIDE_BYTES; j++) {
        expect(pf[base + j]).toBe(before[base + j]);
      }
    }

    const lastBlitEnd = DEST_OFF + (ROW_COUNT - 1) * ROW_STRIDE_BYTES + BYTES_PER_ROW;
    for (let i = lastBlitEnd; i < PF_SIZE; i++) {
      expect(pf[i]).toBe(before[i]);
    }
  });

  it("ROM all-zero → writes zero in 6 windows of 40 bytes (but 0xFF elsewhere)", () => {
    const rom = emptyRomImage(); // program zero-init
    const pf = new Uint8Array(PF_SIZE).fill(0xff);

    tilemapBlit17044(rom, pf);

    // Count zeroed bytes: must be exactly 6x40 = 240.
    let zeros = 0;
    for (let i = 0; i < PF_SIZE; i++) if (pf[i] === 0) zeros++;
    expect(zeros).toBe(TOTAL_BYTES_COPIED);
  });

  it("BE word preserved: high byte at the even offset, low byte at the odd one", () => {
    const rom = emptyRomImage();
    // ROM has pattern 0xAB,0xCD,0xAB,0xCD,... → each word = 0xABCD
    for (let i = 0; i < TOTAL_BYTES_COPIED; i += 2) {
      rom.program[ROM_SOURCE_ADDR + i] = 0xab;
      rom.program[ROM_SOURCE_ADDR + i + 1] = 0xcd;
    }
    const pf = new Uint8Array(PF_SIZE);
    tilemapBlit17044(rom, pf);

    for (let row = 0; row < ROW_COUNT; row++) {
      const base = DEST_OFF + row * ROW_STRIDE_BYTES;
      for (let w = 0; w < WORDS_PER_ROW; w++) {
        expect(pf[base + w * 2]).toBe(0xab);
        expect(pf[base + w * 2 + 1]).toBe(0xcd);
      }
    }
  });

  it("idempotent with the same ROM: two calls == one", () => {
    const rom = emptyRomImage();
    fillRomSource(rom, (i) => (i ^ 0x5a) & 0xff);

    const a = new Uint8Array(PF_SIZE).fill(0x33);
    tilemapBlit17044(rom, a);

    const b = new Uint8Array(PF_SIZE).fill(0x33);
    tilemapBlit17044(rom, b);
    tilemapBlit17044(rom, b);

    expect(b).toEqual(a);
  });

  it("shorter buffer: bound-safe, no overflow", () => {
    const rom = emptyRomImage();
    fillRomSource(rom, (i) => (i + 1) & 0xff);
    const small = new Uint8Array(0x200).fill(0xee);
    tilemapBlit17044(rom, small);
    // [0..0x115] preserved
    for (let i = 0; i < DEST_OFF; i++) expect(small[i]).toBe(0xee);
    for (let j = 0; j < BYTES_PER_ROW; j++) {
      expect(small[DEST_OFF + j]).toBe((j + 1) & 0xff);
    }
    for (let j = BYTES_PER_ROW; j < ROW_STRIDE_BYTES; j++) {
      expect(small[DEST_OFF + j]).toBe(0xee);
    }
    const row1Base = DEST_OFF + ROW_STRIDE_BYTES;
    const row1Available = small.length - row1Base; // 0x200 - 0x196 = 0x6A
    for (let j = 0; j < Math.min(BYTES_PER_ROW, row1Available); j++) {
      expect(small[row1Base + j]).toBe((BYTES_PER_ROW + j + 1) & 0xff);
    }
  });

  it("does not read ROM beyond 0x19F04 + 240 bytes (no over-read from rom.program)", () => {
    const rom = emptyRomImage();
    rom.program.fill(0xff);
    // Then overwrite the 240 source bytes with a non-FF pattern.
    for (let i = 0; i < TOTAL_BYTES_COPIED; i++) {
      rom.program[ROM_SOURCE_ADDR + i] = (i + 1) & 0xff;
    }
    const pf = new Uint8Array(PF_SIZE);
    tilemapBlit17044(rom, pf);
    for (let row = 0; row < ROW_COUNT; row++) {
      const base = DEST_OFF + row * ROW_STRIDE_BYTES;
      for (let j = 0; j < BYTES_PER_ROW; j++) {
        const v = pf[base + j] ?? 0;
        const expected = (row * BYTES_PER_ROW + j + 1) & 0xff;
        expect(v).toBe(expected);
        expect(v).not.toBe(0xff);
      }
    }
  });
});
