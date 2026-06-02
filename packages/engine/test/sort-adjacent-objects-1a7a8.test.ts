/**
 * sort-adjacent-objects-1a7a8.test.ts — smoke test of FUN_1A7A8.
 *
 * Here we cover the main paths of the walk + swap + ROM lookup logic.
 */

import { describe, it, expect } from "vitest";
import {
  sortAdjacentObjects1A7A8,
  fun1A80A,
  lookupRectPtr,
  BYTE_ARRAY_OFF,
  BYTE_ARRAY_LEN,
  SENTINEL_BYTE,
  ROM_LOOKUP_OFF,
} from "../src/sort-adjacent-objects-1a7a8.js";
import { emptyGameState } from "../src/state.js";
import { emptyRomImage } from "../src/bus.js";
import type { RomImage } from "../src/bus.js";
import type { GameState } from "../src/state.js";

const WORK_RAM_BASE = 0x400000;

function writeU32BE(buf: Uint8Array, off: number, val: number): void {
  buf[off] = (val >>> 24) & 0xff;
  buf[off + 1] = (val >>> 16) & 0xff;
  buf[off + 2] = (val >>> 8) & 0xff;
  buf[off + 3] = val & 0xff;
}

function writeU16WorkRamAbs(state: GameState, abs: number, val: number): void {
  const off = abs - WORK_RAM_BASE;
  state.workRam[off] = (val >>> 8) & 0xff;
  state.workRam[off + 1] = val & 0xff;
}

/**
 * Helper: set up ROM lookup with N entries, each pointing to a slot rect in
 */
function setupLookup(rom: RomImage, count: number, baseAbs = 0x4001dc, stride = 0x10): void {
  for (let i = 0; i < count; i++) {
    writeU32BE(rom.program, ROM_LOOKUP_OFF + i * 4, baseAbs + i * stride);
  }
}

/**
 */
function writeRect(state: GameState, abs: number, value: number): void {
  // Only offsets +2,+4,+6,+8,+A,+C are used by fun1A80A.
  for (const off of [2, 4, 6, 8, 0xa, 0xc]) {
    writeU16WorkRamAbs(state, abs + off, value);
  }
}

describe("fun1A80A — rect compare (FUN_1A80A)", () => {
  it("D3 <= D2 → return 0 (sumY_A1 <= sumX_A0)", () => {
    const s = emptyGameState();
    // A1: sumX = 3*10 = 30, sumY = 3*5 = 15.
    // A0: sumX = 3*20 = 60, sumY = 3*0 = 0.
    // D3 = 15, D2 = 60 → D3 <= D2 → return 0.
    writeU16WorkRamAbs(s, 0x401000 + 2, 10);
    writeU16WorkRamAbs(s, 0x401000 + 4, 10);
    writeU16WorkRamAbs(s, 0x401000 + 6, 10);
    writeU16WorkRamAbs(s, 0x401000 + 8, 5);
    writeU16WorkRamAbs(s, 0x401000 + 0xa, 5);
    writeU16WorkRamAbs(s, 0x401000 + 0xc, 5);
    writeU16WorkRamAbs(s, 0x401100 + 2, 20);
    writeU16WorkRamAbs(s, 0x401100 + 4, 20);
    writeU16WorkRamAbs(s, 0x401100 + 6, 20);
    writeU16WorkRamAbs(s, 0x401100 + 8, 0);
    writeU16WorkRamAbs(s, 0x401100 + 0xa, 0);
    writeU16WorkRamAbs(s, 0x401100 + 0xc, 0);
    expect(fun1A80A(s, 0x401000, 0x401100)).toBe(0);
  });

  it("D3 > D2, D5 <= D4 → return 1", () => {
    const s = emptyGameState();
    // A1: sumX = 3*5 = 15, sumY = 3*30 = 90.
    // A0: sumX = 3*0 = 0, sumY = 3*5 = 15.
    // D3 = 90 > D2 = 0 (next test). D5 = 15 <= D4 = 15 → return 1.
    writeRect(s, 0x401000, 0);
    writeU16WorkRamAbs(s, 0x401000 + 2, 5);
    writeU16WorkRamAbs(s, 0x401000 + 4, 5);
    writeU16WorkRamAbs(s, 0x401000 + 6, 5);
    writeU16WorkRamAbs(s, 0x401000 + 8, 30);
    writeU16WorkRamAbs(s, 0x401000 + 0xa, 30);
    writeU16WorkRamAbs(s, 0x401000 + 0xc, 30);
    writeU16WorkRamAbs(s, 0x401100 + 2, 0);
    writeU16WorkRamAbs(s, 0x401100 + 4, 0);
    writeU16WorkRamAbs(s, 0x401100 + 6, 0);
    writeU16WorkRamAbs(s, 0x401100 + 8, 5);
    writeU16WorkRamAbs(s, 0x401100 + 0xa, 5);
    writeU16WorkRamAbs(s, 0x401100 + 0xc, 5);
    expect(fun1A80A(s, 0x401000, 0x401100)).toBe(1);
  });

  it("Word compare path: all equal → returns 1 (last fallthrough)", () => {
    const s = emptyGameState();
    // A1 and A0 with same pattern to skip the 4 initial cmp.w and fall
    // in the `moveq #1`. Setup: D3 > D2, D5 > D4 (neither fires).
    // D2 = 0, D3 = 3 → D3 > D2 ok; D4 = 3, D5 = 0 → D5 <= D4 → return 1.
    // A1: x=2,2,2 (D4=6); y=2,2,2 (D3=6). A0: x=0,0,0 (D2=0); y=10,10,10 (D5=30).
    // D3=6 > D2=0 ok. D5=30 > D4=6 ok.
    // Word: a0_4=0 >= a1_a=2? No (0<2) → continue.
    // Word: a1_4=2 >= a0_a=10? No → continue.
    // Word: a0_2=0 >= a1_8=2? No → continue.
    // Word: a1_2=2 >= a0_8=10? No → continue.
    // Word: a0_6=0 >= a1_c=2? No → fall to moveq #1 → return 1.
    writeU16WorkRamAbs(s, 0x401000 + 2, 2);
    writeU16WorkRamAbs(s, 0x401000 + 4, 2);
    writeU16WorkRamAbs(s, 0x401000 + 6, 2);
    writeU16WorkRamAbs(s, 0x401000 + 8, 2);
    writeU16WorkRamAbs(s, 0x401000 + 0xa, 2);
    writeU16WorkRamAbs(s, 0x401000 + 0xc, 2);
    writeU16WorkRamAbs(s, 0x401100 + 2, 0);
    writeU16WorkRamAbs(s, 0x401100 + 4, 0);
    writeU16WorkRamAbs(s, 0x401100 + 6, 0);
    writeU16WorkRamAbs(s, 0x401100 + 8, 10);
    writeU16WorkRamAbs(s, 0x401100 + 0xa, 10);
    writeU16WorkRamAbs(s, 0x401100 + 0xc, 10);
    expect(fun1A80A(s, 0x401000, 0x401100)).toBe(1);
  });

  it("ptr outside workRam → 0 (defensive)", () => {
    const s = emptyGameState();
    expect(fun1A80A(s, 0x500000, 0x501000)).toBe(0);
  });
});

describe("lookupRectPtr — ROM table @ 0x1F0E2", () => {
  it("read pointer @ idx 0", () => {
    const rom = emptyRomImage();
    writeU32BE(rom.program, ROM_LOOKUP_OFF, 0x004001dc);
    expect(lookupRectPtr(rom, 0)).toBe(0x004001dc);
  });

  it("read pointer @ idx 5", () => {
    const rom = emptyRomImage();
    writeU32BE(rom.program, ROM_LOOKUP_OFF + 5 * 4, 0xdeadbeef);
    expect(lookupRectPtr(rom, 5)).toBe(0xdeadbeef);
  });

  it("read pointer @ idx 255 (outside the 16 valid entries)", () => {
    const rom = emptyRomImage();
    writeU32BE(rom.program, ROM_LOOKUP_OFF + 255 * 4, 0x12345678);
    expect(lookupRectPtr(rom, 255)).toBe(0x12345678);
  });
});

describe("sortAdjacentObjects1A7A8 — single-pass walk", () => {
  it("Array all 0xFF → immediate exit, no mutation", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    for (let i = 0; i < BYTE_ARRAY_LEN; i++) {
      s.workRam[BYTE_ARRAY_OFF + i] = SENTINEL_BYTE;
    }
    const before = new Uint8Array(s.workRam);

    sortAdjacentObjects1A7A8(s, rom, 1);

    expect(s.workRam).toEqual(before);
  });

  it("byte[A2] (= 0x3BC) == 0xFF immediately → immediate exit", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    s.workRam[BYTE_ARRAY_OFF] = 0xff;
    s.workRam[BYTE_ARRAY_OFF + 1] = 0x05; // does not matter
    const before = new Uint8Array(s.workRam);

    sortAdjacentObjects1A7A8(s, rom, 1);

    expect(s.workRam).toEqual(before);
  });

  it("Compare always 0 (no swap) → walk up to 0xFF, no mutation", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    // Setup: 5 entries 0..4, then 0xFF.
    for (let i = 0; i < 5; i++) s.workRam[BYTE_ARRAY_OFF + i] = i;
    s.workRam[BYTE_ARRAY_OFF + 5] = 0xff;
    setupLookup(rom, 5);
    for (let i = 0; i < 5; i++) writeRect(s, 0x4001dc + i * 0x10, 100);

    const before = new Uint8Array(s.workRam);

    sortAdjacentObjects1A7A8(s, rom, 1);

    expect(s.workRam).toEqual(before);
  });

  it("Compare always 1 (always swap) stride=1 → swap of all adjacent pairs", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    s.workRam[BYTE_ARRAY_OFF + 0] = 0;
    s.workRam[BYTE_ARRAY_OFF + 1] = 1;
    s.workRam[BYTE_ARRAY_OFF + 2] = 2;
    s.workRam[BYTE_ARRAY_OFF + 3] = 3;
    s.workRam[BYTE_ARRAY_OFF + 4] = 4;
    s.workRam[BYTE_ARRAY_OFF + 5] = 0xff;

    sortAdjacentObjects1A7A8(s, rom, 1, {
      compare: () => 1,
    });

    // does not see 0xFF.
    //   step0: A2=3BC byte[3BC]=0, A3=3BD byte[3BD]=1. byte[3BD]!=FF.
    //   step1: byte[3BD]=0 != FF, byte[3BE]=2 != FF. swap → [1,2,0,3,4,FF].
    //          A2=3BE, A3=3BF.
    //   step2: byte[3BE]=0 != FF, byte[3BF]=3 != FF. swap → [1,2,3,0,4,FF].
    //          A2=3BF, A3=3C0.
    //   step3: byte[3BF]=0 != FF, byte[3C0]=4 != FF. swap → [1,2,3,4,0,FF].
    //          A2=3C0, A3=3C1.
    //   step4: byte[3C0]=0 != FF, byte[3C1]=FF → exit.
    expect(s.workRam[BYTE_ARRAY_OFF + 0]).toBe(1);
    expect(s.workRam[BYTE_ARRAY_OFF + 1]).toBe(2);
    expect(s.workRam[BYTE_ARRAY_OFF + 2]).toBe(3);
    expect(s.workRam[BYTE_ARRAY_OFF + 3]).toBe(4);
    expect(s.workRam[BYTE_ARRAY_OFF + 4]).toBe(0);
    expect(s.workRam[BYTE_ARRAY_OFF + 5]).toBe(0xff);
  });

  it("Compare always 1 stride=2 → swap on pairs 2 apart", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    s.workRam[BYTE_ARRAY_OFF + 0] = 0;
    s.workRam[BYTE_ARRAY_OFF + 1] = 1;
    s.workRam[BYTE_ARRAY_OFF + 2] = 2;
    s.workRam[BYTE_ARRAY_OFF + 3] = 3;
    s.workRam[BYTE_ARRAY_OFF + 4] = 4;
    s.workRam[BYTE_ARRAY_OFF + 5] = 0xff;

    sortAdjacentObjects1A7A8(s, rom, 2, { compare: () => 1 });

    // step0: A2=3BC byte=0, A3=3BE byte=2. swap → [2,1,0,3,4,FF]. A2=3BD, A3=3BF.
    // step1: byte[3BD]=1 != FF, byte[3BF]=3 != FF. swap → [2,1,3,0,1->?]
    //        wait, byte[3BD]=1, byte[3BF]=3. swap those two -> [2,3,0,1,4,FF].
    //        A2=3BD (byte=1), A3=3BF (byte=3). swap → [2,3,0,1,4,FF].
    //        A2=3BE, A3=3C0.
    // step2: byte[3BE]=0 != FF, byte[3C0]=4 != FF. swap → [2,3,4,1,0,FF].
    //        A2=3BF, A3=3C1.
    // step3: byte[3BF]=1 != FF, byte[3C1]=FF → exit.
    expect(s.workRam[BYTE_ARRAY_OFF + 0]).toBe(2);
    expect(s.workRam[BYTE_ARRAY_OFF + 1]).toBe(3);
    expect(s.workRam[BYTE_ARRAY_OFF + 2]).toBe(4);
    expect(s.workRam[BYTE_ARRAY_OFF + 3]).toBe(1);
    expect(s.workRam[BYTE_ARRAY_OFF + 4]).toBe(0);
    expect(s.workRam[BYTE_ARRAY_OFF + 5]).toBe(0xff);
  });

  it("compare() callback receives the correct ROM-resolved pointers", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    s.workRam[BYTE_ARRAY_OFF + 0] = 3;
    s.workRam[BYTE_ARRAY_OFF + 1] = 7;
    s.workRam[BYTE_ARRAY_OFF + 2] = 0xff;

    // Setup ROM lookup: idx=3 → 0xAAAA0000, idx=7 → 0xBBBB0000.
    writeU32BE(rom.program, ROM_LOOKUP_OFF + 3 * 4, 0xaaaa0000);
    writeU32BE(rom.program, ROM_LOOKUP_OFF + 7 * 4, 0xbbbb0000);

    const calls: Array<{ ptrA1: number; ptrA0: number }> = [];
    sortAdjacentObjects1A7A8(s, rom, 1, {
      compare: (_state, ptrA1, ptrA0) => {
        calls.push({ ptrA1, ptrA0 });
        return 0; // no swap
      },
    });

    // ptrA1 = lookup[byte[A2]] = lookup[3] = 0xAAAA0000.
    // ptrA0 = lookup[byte[A3]] = lookup[7] = 0xBBBB0000.
    expect(calls.length).toBe(1);
    expect(calls[0]!.ptrA1).toBe(0xaaaa0000);
    expect(calls[0]!.ptrA0).toBe(0xbbbb0000);
  });

  it("stride=0 with compare=1 → A2==A3, swap no-op (byte=byte)", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    s.workRam[BYTE_ARRAY_OFF + 0] = 5;
    s.workRam[BYTE_ARRAY_OFF + 1] = 0xff;
    const before = new Uint8Array(s.workRam);

    sortAdjacentObjects1A7A8(s, rom, 0, { compare: () => 1 });

    // With stride=0 A2==A3, byte swap with itself = no-op.
    expect(s.workRam).toEqual(before);
  });

  it("Mutation does NOT touch bytes outside 0x3BC..0x3DC", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    s.workRam[BYTE_ARRAY_OFF + 0] = 0;
    s.workRam[BYTE_ARRAY_OFF + 1] = 1;
    s.workRam[BYTE_ARRAY_OFF + 2] = 0xff;
    s.workRam[BYTE_ARRAY_OFF - 1] = 0x99;
    s.workRam[BYTE_ARRAY_OFF + BYTE_ARRAY_LEN] = 0x88;

    sortAdjacentObjects1A7A8(s, rom, 1, { compare: () => 1 });

    expect(s.workRam[BYTE_ARRAY_OFF - 1]).toBe(0x99);
    expect(s.workRam[BYTE_ARRAY_OFF + BYTE_ARRAY_LEN]).toBe(0x88);
  });

  it("Pure: rect structs in workRam @ 0x1DC.. are not modified", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    s.workRam[BYTE_ARRAY_OFF + 0] = 0;
    s.workRam[BYTE_ARRAY_OFF + 1] = 1;
    s.workRam[BYTE_ARRAY_OFF + 2] = 0xff;
    setupLookup(rom, 16);
    // Setup rect data
    writeRect(s, 0x4001dc, 1);
    writeRect(s, 0x4001ec, 2);
    const rectBefore = new Uint8Array(s.workRam.slice(0x1dc, 0x2bc));

    sortAdjacentObjects1A7A8(s, rom, 1);

    expect(new Uint8Array(s.workRam.slice(0x1dc, 0x2bc))).toEqual(rectBefore);
  });
});
