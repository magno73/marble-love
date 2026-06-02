/**
 * bsearch-table-1abd4.test.ts — smoke tests for `FUN_0001ABD4`.
 *
 * The function bisects a sorted word array whose
 * bounds are in the two long slots `*(0x40065A)` and `*(0x40065E)`.
 * Initial step = 0x400 bytes, halved each iter, probe clamped to
 * `[base, end]`. Terminates only on equality.
 */

import { describe, it, expect } from "vitest";
import { bsearchTable1ABD4 } from "../src/bsearch-table-1abd4.js";
import { emptyGameState } from "../src/state.js";

const BASE_PTR_OFF = 0x65a; // workRam offset of *(0x40065A) slot
const END_PTR_OFF = 0x65e;

const WORK_RAM_BASE_ADDR = 0x00400000;

function writeLongBE(s: ReturnType<typeof emptyGameState>, off: number, v: number): void {
  s.workRam[off] = (v >>> 24) & 0xff;
  s.workRam[off + 1] = (v >>> 16) & 0xff;
  s.workRam[off + 2] = (v >>> 8) & 0xff;
  s.workRam[off + 3] = v & 0xff;
}

function writeWordBE(s: ReturnType<typeof emptyGameState>, off: number, v: number): void {
  s.workRam[off] = (v >>> 8) & 0xff;
  s.workRam[off + 1] = v & 0xff;
}

/**
 * Helper: set up a word table at workRam offset `tableOff`.
 * Configures *(0x40065A) and *(0x40065E) pointing in absolute addressing
 * (workRam = 0x400000+).
 */
function setupTable(
  s: ReturnType<typeof emptyGameState>,
  tableOff: number,
  words: number[],
): void {
  for (let i = 0; i < words.length; i++) {
    writeWordBE(s, tableOff + i * 2, words[i]! & 0xffff);
  }
  const baseAbs = WORK_RAM_BASE_ADDR + tableOff;
  const endAbs = WORK_RAM_BASE_ADDR + tableOff + (words.length - 1) * 2;
  writeLongBE(s, BASE_PTR_OFF, baseAbs);
  writeLongBE(s, END_PTR_OFF, endAbs);
}

describe("bsearchTable1ABD4 (FUN_0001ABD4)", () => {
  it("finds the exact match and returns the word index", () => {
    const s = emptyGameState();
    // Table of 5 words @ workRam off 0x800: [0x10, 0x20, 0x30, 0x40, 0x50]
    // Stride 2 bytes; initial step 0x400 → first step goes OUT of range, but the
    // clamp brings it back inside. The test guarantees that the match exists.
    const tableOff = 0x800;
    setupTable(s, tableOff, [0x10, 0x20, 0x30, 0x40, 0x50]);

    // Search 0x10 → match at the first probe (probeAbs == baseAbs).
    // Word index = (matchPtr - basePtr) / 2 = 0.
    expect(bsearchTable1ABD4(s, 0x10)).toBe(0);
  });

  it("returns 0 when target == base.word (no bisection iterations)", () => {
    const s = emptyGameState();
    const tableOff = 0x1000;
    // Table with base.word = 0xABCD; another at +0x400 bytes (= word 0x200).
    setupTable(s, tableOff, [0xabcd]);
    // Force end-pointer 1024 bytes beyond base, fill in a terminator
    writeLongBE(s, END_PTR_OFF, WORK_RAM_BASE_ADDR + tableOff + 0x400);
    writeWordBE(s, tableOff + 0x400, 0xffff);

    expect(bsearchTable1ABD4(s, 0xabcd)).toBe(0);
  });

  it("uses only the low-word of targetLong (mask 0xFFFF)", () => {
    const s = emptyGameState();
    const tableOff = 0x900;
    setupTable(s, tableOff, [0x1234, 0x5678, 0x9abc]);

    // arg long = 0xCAFE5678 -> low word 0x5678 must match entry 1.
    // Careful: the bisection loop searches with initial step 0x400 bytes.
    // = 512 words. With a 3-word table, the first probe moves forward/backward
    // by 512 words and goes outside range; the clamp brings it back to [base, end].
    // For a simple test, use a larger synthetic table:
    const tableOff2 = 0xc00;
    const words: number[] = [];
    for (let i = 0; i < 0x201; i++) words.push(0xffff); // filler
    words[0] = 0x5678;
    setupTable(s, tableOff2, words);
    expect(bsearchTable1ABD4(s, 0xcafe5678)).toBe(0);
  });

  it("does not write to workRam (pure lookup)", () => {
    const s = emptyGameState();
    const tableOff = 0x800;
    setupTable(s, tableOff, [0x10, 0x20, 0x30]);

    // Snapshot of all of workRam except the table + the two slot pointers
    // set up by the test (the only ones not zero-initialized).
    const snapshot = new Uint8Array(s.workRam);
    bsearchTable1ABD4(s, 0x10);
    expect(s.workRam).toEqual(snapshot);
  });
});
