/**
 * hi-score-decode-41c8.test.ts — smoke tests of `hiScoreDecode41c8` (FUN_41C8).
 *
 * Verifies the main return paths + invariants (arg1 range, score
 * decoding 24-bit BE, radix-40 unpack 3 chars, side-effect localized to
 * 0x401F7A..0x401F80).
 *
 * Bit-perfect parity (500 random cases) verified in
 * `packages/cli/src/test-hi-score-decode-41c8-parity.ts` vs Musashi.
 */

import { describe, it, expect } from "vitest";
import {
  hiScoreDecode41c8,
  TABLE_OFF_FROM_PTR,
  RECORD_STRIDE,
  OUTPUT_BUFFER_ADDR,
  OUTPUT_BUFFER_OFF,
  OUTPUT_BUFFER_LEN,
  RET_INDEX_OOR,
  MAX_INDEX,
} from "../src/hi-score-decode-41c8.js";
import { emptyGameState } from "../src/state.js";

const PTR_OFF = 0x1ffc;

function writeLongBE(ram: Uint8Array, off: number, val: number): void {
  ram[off] = (val >>> 24) & 0xff;
  ram[off + 1] = (val >>> 16) & 0xff;
  ram[off + 2] = (val >>> 8) & 0xff;
  ram[off + 3] = val & 0xff;
}

/** Computes the packed radix-40 value (16-bit) for 3 char digits (digit2 MSB). */
function pack3(d2: number, d1: number, d0: number): number {
  return (((d2 * 40 + d1) * 40 + d0) & 0xffff) >>> 0;
}

describe("hiScoreDecode41c8 (FUN_41C8)", () => {
  it("path #1: arg1 > 9 -> ret 0, no buffer write", () => {
    const s = emptyGameState();
    writeLongBE(s.workRam, PTR_OFF, 0x401000);
    // Pre-fill buffer with sentinel to verify no-write.
    for (let i = 0; i < OUTPUT_BUFFER_LEN; i++) {
      s.workRam[OUTPUT_BUFFER_OFF + i] = 0xa5;
    }
    const before = new Uint8Array(s.workRam);

    expect(hiScoreDecode41c8(s, 10)).toBe(RET_INDEX_OOR);
    expect(hiScoreDecode41c8(s, 0xff)).toBe(RET_INDEX_OOR);
    // arg1 = 0xFFFFFFFF (negative sign-ext) -> bit 31 set -> large unsigned -> OOR.
    expect(hiScoreDecode41c8(s, 0xffffffff)).toBe(RET_INDEX_OOR);

    // No workRam writes in any OOR call.
    expect(s.workRam).toEqual(before);
  });

  it("path #2: arg1 in [0..9] -> ret 0x401F7A, writes buffer (4-byte score + 3-byte initials)", () => {
    const s = emptyGameState();
    const ptr = 0x401000;
    writeLongBE(s.workRam, PTR_OFF, ptr);
    // Table base = ptr + 0x1E = 0x40101E -> workRam[0x101E..].
    // Entry index 3 (= byte off 15) -> 0x40102D.
    const entryOff = 0x101e + 3 * RECORD_STRIDE;
    // Score 24-bit BE: 0x12 0x34 0x56 -> long = 0x00123456.
    s.workRam[entryOff + 0] = 0x12;
    s.workRam[entryOff + 1] = 0x34;
    s.workRam[entryOff + 2] = 0x56;
    // Initials packed: 'A','B','C' = 1,2,3 -> packed = 1*1600 + 2*40 + 3 = 1683.
    const packed = pack3(1, 2, 3); // 0x0693
    s.workRam[entryOff + 3] = (packed >>> 8) & 0xff;
    s.workRam[entryOff + 4] = packed & 0xff;

    const ret = hiScoreDecode41c8(s, 3);
    expect(ret).toBe(OUTPUT_BUFFER_ADDR);

    // Score long @ 0x401F7A (4 byte BE, high = 0).
    expect(s.workRam[OUTPUT_BUFFER_OFF + 0]).toBe(0x00);
    expect(s.workRam[OUTPUT_BUFFER_OFF + 1]).toBe(0x12);
    expect(s.workRam[OUTPUT_BUFFER_OFF + 2]).toBe(0x34);
    expect(s.workRam[OUTPUT_BUFFER_OFF + 3]).toBe(0x56);

    // Initials @ 0x401F7E..0x401F80 -> 'A','B','C'.
    expect(s.workRam[OUTPUT_BUFFER_OFF + 4]).toBe(0x41); // 'A'
    expect(s.workRam[OUTPUT_BUFFER_OFF + 5]).toBe(0x42); // 'B'
    expect(s.workRam[OUTPUT_BUFFER_OFF + 6]).toBe(0x43); // 'C'
  });

  it("path #3: digit 0 -> space; digit > 0x1A -> '0'..'<'", () => {
    const s = emptyGameState();
    const ptr = 0x401000;
    writeLongBE(s.workRam, PTR_OFF, ptr);
    const entryOff = 0x101e + 0 * RECORD_STRIDE;
    // Score irrelevant.
    s.workRam[entryOff + 0] = 0;
    s.workRam[entryOff + 1] = 0;
    s.workRam[entryOff + 2] = 0;
    // Initials: digit2=0 (space), digit1=27 ('0'), digit0=39 ('<').
    // 0x1B = 27 -> +0x15 = 0x30 = '0'.
    // 0x27 = 39 -> +0x15 = 0x3C = '<'.
    const packed = pack3(0, 27, 39);
    s.workRam[entryOff + 3] = (packed >>> 8) & 0xff;
    s.workRam[entryOff + 4] = packed & 0xff;

    expect(hiScoreDecode41c8(s, 0)).toBe(OUTPUT_BUFFER_ADDR);
    expect(s.workRam[OUTPUT_BUFFER_OFF + 4]).toBe(0x20); // space (digit 0)
    expect(s.workRam[OUTPUT_BUFFER_OFF + 5]).toBe(0x30); // '0' (digit 27)
    expect(s.workRam[OUTPUT_BUFFER_OFF + 6]).toBe(0x3c); // '<' (digit 39)
  });

  it("boundary arg1 = MAX_INDEX (= 9) e' VALIDO; arg1 = 10 e' OOR", () => {
    const s = emptyGameState();
    const ptr = 0x401000;
    writeLongBE(s.workRam, PTR_OFF, ptr);
    // Entry 9: byte off = 9*5 = 45. Entry 9 starts @ 0x101E + 45 = 0x104B.
    const entryOff = 0x101e + 9 * RECORD_STRIDE;
    s.workRam[entryOff + 0] = 0xab;
    s.workRam[entryOff + 1] = 0xcd;
    s.workRam[entryOff + 2] = 0xef;
    s.workRam[entryOff + 3] = 0x00;
    s.workRam[entryOff + 4] = 0x00;

    expect(hiScoreDecode41c8(s, MAX_INDEX)).toBe(OUTPUT_BUFFER_ADDR);
    expect(s.workRam[OUTPUT_BUFFER_OFF + 1]).toBe(0xab);
    expect(s.workRam[OUTPUT_BUFFER_OFF + 2]).toBe(0xcd);
    expect(s.workRam[OUTPUT_BUFFER_OFF + 3]).toBe(0xef);

    // arg1 = 10 e' OOR.
    const before = new Uint8Array(s.workRam);
    expect(hiScoreDecode41c8(s, 10)).toBe(RET_INDEX_OOR);
    expect(s.workRam).toEqual(before);
  });

  it("ptr legato dinamicamente a *0x401FFC (cambiare ptr cambia base)", () => {
    const s = emptyGameState();
    // Setup A: ptr = 0x401000 -> table base = 0x40101E. Entry 0 byte 0 = 0xAA.
    writeLongBE(s.workRam, PTR_OFF, 0x401000);
    s.workRam[0x101e] = 0xaa;
    s.workRam[0x101f] = 0;
    s.workRam[0x1020] = 0;
    s.workRam[0x1021] = 0;
    s.workRam[0x1022] = 0;
    expect(hiScoreDecode41c8(s, 0)).toBe(OUTPUT_BUFFER_ADDR);
    expect(s.workRam[OUTPUT_BUFFER_OFF + 1]).toBe(0xaa);

    // Setup B: ptr = 0x400500 -> table base = 0x40051E. Entry 0 byte 0 = 0xBB.
    writeLongBE(s.workRam, PTR_OFF, 0x400500);
    s.workRam[0x51e] = 0xbb;
    s.workRam[0x51f] = 0;
    s.workRam[0x520] = 0;
    s.workRam[0x521] = 0;
    s.workRam[0x522] = 0;
    expect(hiScoreDecode41c8(s, 0)).toBe(OUTPUT_BUFFER_ADDR);
    expect(s.workRam[OUTPUT_BUFFER_OFF + 1]).toBe(0xbb);
  });

  it("writes ESATTAMENTE 7 byte a 0x401F7A..0x401F80 (non beyond)", () => {
    const s = emptyGameState();
    const ptr = 0x401000;
    writeLongBE(s.workRam, PTR_OFF, ptr);
    // Pre-fill surrounding area with 0x99 for non-overflow check.
    for (let i = 0; i < 16; i++) {
      s.workRam[OUTPUT_BUFFER_OFF - 4 + i] = 0x99;
    }
    const entryOff = 0x101e + 0 * RECORD_STRIDE;
    s.workRam[entryOff + 0] = 0x11;
    s.workRam[entryOff + 1] = 0x22;
    s.workRam[entryOff + 2] = 0x33;
    s.workRam[entryOff + 3] = 0x00;
    s.workRam[entryOff + 4] = 0x00;

    hiScoreDecode41c8(s, 0);

    // Pre-buffer (4 byte) intact.
    expect(s.workRam[OUTPUT_BUFFER_OFF - 4]).toBe(0x99);
    expect(s.workRam[OUTPUT_BUFFER_OFF - 3]).toBe(0x99);
    expect(s.workRam[OUTPUT_BUFFER_OFF - 2]).toBe(0x99);
    expect(s.workRam[OUTPUT_BUFFER_OFF - 1]).toBe(0x99);
    // Buffer (7 bytes) modified.
    expect(s.workRam[OUTPUT_BUFFER_OFF + 0]).toBe(0x00);
    expect(s.workRam[OUTPUT_BUFFER_OFF + 1]).toBe(0x11);
    expect(s.workRam[OUTPUT_BUFFER_OFF + 2]).toBe(0x22);
    expect(s.workRam[OUTPUT_BUFFER_OFF + 3]).toBe(0x33);
    // Initials with packed=0 -> 3 spaces (digit 0 -> 0x20).
    expect(s.workRam[OUTPUT_BUFFER_OFF + 4]).toBe(0x20);
    expect(s.workRam[OUTPUT_BUFFER_OFF + 5]).toBe(0x20);
    expect(s.workRam[OUTPUT_BUFFER_OFF + 6]).toBe(0x20);
    // Post-buffer (5 byte) intact.
    expect(s.workRam[OUTPUT_BUFFER_OFF + 7]).toBe(0x99);
    expect(s.workRam[OUTPUT_BUFFER_OFF + 8]).toBe(0x99);
    expect(s.workRam[OUTPUT_BUFFER_OFF + 9]).toBe(0x99);
    expect(s.workRam[OUTPUT_BUFFER_OFF + 10]).toBe(0x99);
    expect(s.workRam[OUTPUT_BUFFER_OFF + 11]).toBe(0x99);
  });

  it("table base = ptr + 0x1E (TABLE_OFF_FROM_PTR), record stride = 5", () => {
    expect(TABLE_OFF_FROM_PTR).toBe(0x1e);
    expect(RECORD_STRIDE).toBe(5);
    expect(MAX_INDEX).toBe(9);
    expect(OUTPUT_BUFFER_ADDR).toBe(0x00401f7a);
    expect(OUTPUT_BUFFER_LEN).toBe(7);
  });
});
