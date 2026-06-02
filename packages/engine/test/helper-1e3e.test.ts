/**
 * helper-1e3e.test.ts — unit test for `fillSeqWords1E3E` (FUN_00001E3E).
 *
 * Here we cover: basic fill, edge cases (count=0, negative count, word wrap).
 */

import { describe, it, expect } from "vitest";
import {
  fillSeqWords1E3E,
  HELPER_1E3E_ADDR,
  FUN_00001E3E,
} from "../src/helper-1e3e.js";
import { emptyGameState } from "../src/state.js";

const WORK_RAM_BASE = 0x400000;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function readWord(state: ReturnType<typeof emptyGameState>, abs: number): number {
  const off = abs - WORK_RAM_BASE;
  return (((state.workRam[off] ?? 0) << 8) | (state.workRam[off + 1] ?? 0)) & 0xffff;
}

function readByte(state: ReturnType<typeof emptyGameState>, abs: number): number {
  return (state.workRam[abs - WORK_RAM_BASE] ?? 0) & 0xff;
}

// ─── HELPER_1E3E_ADDR constant ───────────────────────────────────────────────

describe("HELPER_1E3E_ADDR", () => {
  it("is 0x00001e3e", () => {
    expect(HELPER_1E3E_ADDR).toBe(0x00001e3e);
  });
});

// ─── FUN_00001E3E alias ───────────────────────────────────────────────────────

describe("FUN_00001E3E alias", () => {
  it("is identical to fillSeqWords1E3E", () => {
    expect(FUN_00001E3E).toBe(fillSeqWords1E3E);
  });
});

// ─── fillSeqWords1E3E — basic fill ───────────────────────────────────────────

describe("fillSeqWords1E3E", () => {
  it("count=0 → no-op, workRam unchanged", () => {
    const s = emptyGameState();
    s.workRam.fill(0xAA);
    fillSeqWords1E3E(s, 0x401000, 0x0010, 0);
    for (let i = 0; i < 0x10; i++) {
      expect(readByte(s, 0x401000 + i)).toBe(0xAA);
    }
  });

  it("negative count → no-op", () => {
    const s = emptyGameState();
    s.workRam.fill(0xBB);
    fillSeqWords1E3E(s, 0x401000, 0x0010, -1);
    for (let i = 0; i < 0x10; i++) {
      expect(readByte(s, 0x401000 + i)).toBe(0xBB);
    }
  });

  it("count=1 → writes a single word", () => {
    const s = emptyGameState();
    s.workRam.fill(0x00);
    fillSeqWords1E3E(s, 0x401100, 0x0042, 1);
    expect(readWord(s, 0x401100)).toBe(0x0042);
    // immediately following byte not touched (if there was a previous all-zero).
    expect(readWord(s, 0x401102)).toBe(0x0000);
  });

  it("count=4, start=0x10 → [0x10,0x11,0x12,0x13]", () => {
    const s = emptyGameState();
    s.workRam.fill(0x00);
    const dest = 0x401200;
    fillSeqWords1E3E(s, dest, 0x0010, 4);
    expect(readWord(s, dest + 0)).toBe(0x0010);
    expect(readWord(s, dest + 2)).toBe(0x0011);
    expect(readWord(s, dest + 4)).toBe(0x0012);
    expect(readWord(s, dest + 6)).toBe(0x0013);
    expect(readWord(s, dest + 8)).toBe(0x0000);
    expect(readByte(s, dest - 1)).toBe(0x00);
  });

  it("word wrap: start=0xFFFE, count=4 → [0xFFFE,0xFFFF,0x0000,0x0001]", () => {
    const s = emptyGameState();
    s.workRam.fill(0x00);
    const dest = 0x401300;
    fillSeqWords1E3E(s, dest, 0xFFFE, 4);
    expect(readWord(s, dest + 0)).toBe(0xFFFE);
    expect(readWord(s, dest + 2)).toBe(0xFFFF);
    expect(readWord(s, dest + 4)).toBe(0x0000);
    expect(readWord(s, dest + 6)).toBe(0x0001);
  });

  it("start is masked to 16 bits (e.g. 0x10042 → 0x0042)", () => {
    const s = emptyGameState();
    s.workRam.fill(0x00);
    const dest = 0x401400;
    fillSeqWords1E3E(s, dest, 0x10042, 2);
    expect(readWord(s, dest + 0)).toBe(0x0042);
    expect(readWord(s, dest + 2)).toBe(0x0043);
  });

  it("bytes adjacent to the buffer are not touched (no overflow write)", () => {
    const s = emptyGameState();
    s.workRam.fill(0xCC);
    const dest = 0x401500;
    fillSeqWords1E3E(s, dest, 0, 3);
    expect(readWord(s, dest + 0)).toBe(0x0000);
    expect(readWord(s, dest + 2)).toBe(0x0001);
    expect(readWord(s, dest + 4)).toBe(0x0002);
    expect(readByte(s, dest + 6)).toBe(0xCC);
    // byte at dest-1 not touched.
    expect(readByte(s, dest - 1)).toBe(0xCC);
  });

  it("writes also in alphaRam (0xa03000 range)", () => {
    const s = emptyGameState();
    s.alphaRam.fill(0x00);
    const dest = 0xa03000;
    fillSeqWords1E3E(s, dest, 0x0100, 3);
    expect((((s.alphaRam[0] ?? 0) << 8) | (s.alphaRam[1] ?? 0)) & 0xffff).toBe(0x0100);
    expect((((s.alphaRam[2] ?? 0) << 8) | (s.alphaRam[3] ?? 0)) & 0xffff).toBe(0x0101);
    expect((((s.alphaRam[4] ?? 0) << 8) | (s.alphaRam[5] ?? 0)) & 0xffff).toBe(0x0102);
  });

  it("writes also in spriteRam (0xa02000 range)", () => {
    const s = emptyGameState();
    s.spriteRam.fill(0x00);
    const dest = 0xa02000;
    fillSeqWords1E3E(s, dest, 0x0200, 2);
    expect((((s.spriteRam[0] ?? 0) << 8) | (s.spriteRam[1] ?? 0)) & 0xffff).toBe(0x0200);
    expect((((s.spriteRam[2] ?? 0) << 8) | (s.spriteRam[3] ?? 0)) & 0xffff).toBe(0x0201);
  });

  it("writes also in colorRam (0xb00000 range)", () => {
    const s = emptyGameState();
    s.colorRam.fill(0x00);
    const dest = 0xb00000;
    fillSeqWords1E3E(s, dest, 0x0300, 2);
    expect((((s.colorRam[0] ?? 0) << 8) | (s.colorRam[1] ?? 0)) & 0xffff).toBe(0x0300);
    expect((((s.colorRam[2] ?? 0) << 8) | (s.colorRam[3] ?? 0)) & 0xffff).toBe(0x0301);
  });

  it("addresses outside range are no-op (do not raise an exception)", () => {
    const s = emptyGameState();
    expect(() => fillSeqWords1E3E(s, 0x900000, 0, 4)).not.toThrow();
    // ROM area 0x000000 → no crash, no write
    expect(() => fillSeqWords1E3E(s, 0x000100, 0, 2)).not.toThrow();
  });

  it("large count (e.g. 0x400 entries) writes correctly", () => {
    const s = emptyGameState();
    s.workRam.fill(0x00);
    const dest = 0x400000;
    const count = 0x100;
    const start = 0x0000;
    fillSeqWords1E3E(s, dest, start, count);
    for (let i = 0; i < count; i++) {
      expect(readWord(s, dest + i * 2)).toBe((start + i) & 0xffff);
    }
  });
});
