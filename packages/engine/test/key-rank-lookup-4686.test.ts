/**
 * key-rank-lookup-4686.test.ts — smoke tests of `keyRankLookup4686`
 * (FUN_4686).
 *
 * The table at `*0x401FFC + 0x1E` (10 rows x 5 bytes, first 3 bytes used as
 * prefix) is expected to be sorted descending. Match happens at the first
 * row with prefix strictly < key. If key < every row prefix, return 10. If key
 * exactly equals row r (3 bytes), return r+1 (or 10 if r=9), matching the `bcc`
 * after the bhi filter.
 *
 * Bit-perfect parity (500 cases) verified in
 * `packages/cli/src/test-key-rank-lookup-4686-parity.ts` vs Musashi.
 */

import { describe, it, expect } from "vitest";
import { keyRankLookup4686 } from "../src/key-rank-lookup-4686.js";
import { emptyGameState } from "../src/state.js";

const PTR_OFF = 0x1ffc;
const PTR_ABS = 0x401d00;
const TABLE_OFF = (PTR_ABS - 0x400000) + 0x1e; // workRam offset of the table

function writeLongBE(ram: Uint8Array, off: number, val: number): void {
  ram[off] = (val >>> 24) & 0xff;
  ram[off + 1] = (val >>> 16) & 0xff;
  ram[off + 2] = (val >>> 8) & 0xff;
  ram[off + 3] = val & 0xff;
}

/**
 * Set up a 10x5-byte table. Rows are passed as 5-byte arrays;
 * the bytes non specificati are lasciati a 0.
 */
function setupTable(ram: Uint8Array, rows: ReadonlyArray<readonly number[]>): void {
  // Pulisce 50 byte
  for (let i = 0; i < 50; i++) ram[TABLE_OFF + i] = 0;
  for (let r = 0; r < rows.length && r < 10; r++) {
    const row = rows[r]!;
    for (let c = 0; c < 5 && c < row.length; c++) {
      ram[TABLE_OFF + r * 5 + c] = row[c]! & 0xff;
    }
  }
}

describe("keyRankLookup4686 (FUN_4686)", () => {
  it("high byte != 0 → returns -1", () => {
    const s = emptyGameState();
    writeLongBE(s.workRam, PTR_OFF, PTR_ABS);
    setupTable(s.workRam, [
      [0xff, 0xff, 0xff, 0, 0],
    ]);
    expect(keyRankLookup4686(s, 0x01000000)).toBe(-1);
    expect(keyRankLookup4686(s, 0xff112233)).toBe(-1);
  });

  it("DESC table, key > prefix of all le lines → returns 0 (first row gia' < key)", () => {
    const s = emptyGameState();
    writeLongBE(s.workRam, PTR_OFF, PTR_ABS);
    // DESC: row 0 max, row 9 min
    setupTable(s.workRam, [
      [0x00, 0xa0, 0x00, 0, 0], // row 0
      [0x00, 0x90, 0x00, 0, 0],
      [0x00, 0x80, 0x00, 0, 0],
      [0x00, 0x70, 0x00, 0, 0],
      [0x00, 0x60, 0x00, 0, 0],
      [0x00, 0x50, 0x00, 0, 0],
      [0x00, 0x40, 0x00, 0, 0],
      [0x00, 0x30, 0x00, 0, 0],
      [0x00, 0x20, 0x00, 0, 0],
      [0x00, 0x10, 0x00, 0, 0], // row 9
    ]);
    // key 00:FF:FF > all i prefix → row 0 prefix 00:a0:00 < key per col 1
    // (table[1]=0xa0 < key[1]=0xff) → return 0
    expect(keyRankLookup4686(s, 0x0000ffff)).toBe(0);
  });

  it("DESC table, key between row r-1 and r → returns r", () => {
    const s = emptyGameState();
    writeLongBE(s.workRam, PTR_OFF, PTR_ABS);
    setupTable(s.workRam, [
      [0x00, 0xa0, 0x00, 0, 0], // row 0
      [0x00, 0x90, 0x00, 0, 0], // row 1
      [0x00, 0x80, 0x00, 0, 0], // row 2
      [0x00, 0x70, 0x00, 0, 0], // row 3
      [0x00, 0x60, 0x00, 0, 0],
      [0x00, 0x50, 0x00, 0, 0],
      [0x00, 0x40, 0x00, 0, 0],
      [0x00, 0x30, 0x00, 0, 0],
      [0x00, 0x20, 0x00, 0, 0],
      [0x00, 0x10, 0x00, 0, 0],
    ]);
    // key 00:75:00: row 0 (a0) > key (75) → advance; row 1 (90) > key → advance;
    //              row 2 (80) > key → advance; row 3 (70): col 0 ==, col 1
    //              0x70 < 0x75 → return 3
    expect(keyRankLookup4686(s, 0x00007500)).toBe(3);
    // key 00:55:00 → between row 4 (60) and row 5 (50): row 5 prefix 00:50:00 < key
    // (col 1: 50 < 55) → return 5
    expect(keyRankLookup4686(s, 0x00005500)).toBe(5);
  });

  it("DESC table, key < prefix of all le lines → returns 10", () => {
    const s = emptyGameState();
    writeLongBE(s.workRam, PTR_OFF, PTR_ABS);
    setupTable(s.workRam, [
      [0x00, 0xa0, 0x00, 0, 0],
      [0x00, 0x90, 0x00, 0, 0],
      [0x00, 0x80, 0x00, 0, 0],
      [0x00, 0x70, 0x00, 0, 0],
      [0x00, 0x60, 0x00, 0, 0],
      [0x00, 0x50, 0x00, 0, 0],
      [0x00, 0x40, 0x00, 0, 0],
      [0x00, 0x30, 0x00, 0, 0],
      [0x00, 0x20, 0x00, 0, 0],
      [0x00, 0x10, 0x00, 0, 0], // row 9: prefix 00:10:00
    ]);
    // key 00:00:01 < all i prefix (col 1: 0 < all) → each cmp.b: tableByte
    // > keyByte (col 0 ==, col 1 >) → bhi → advance row → 10 advance →
    // return 10
    expect(keyRankLookup4686(s, 0x00000001)).toBe(10);
  });

  it("key exactly uguale a row r → returns r+1 (post-bhi/bcc semantics)", () => {
    const s = emptyGameState();
    writeLongBE(s.workRam, PTR_OFF, PTR_ABS);
    setupTable(s.workRam, [
      [0x00, 0xa0, 0x00, 0, 0], // row 0
      [0x00, 0x80, 0x00, 0, 0], // row 1: 80
      [0x00, 0x70, 0x00, 0, 0], // row 2 (per dare row 1 spazio dopo)
      [0x00, 0x60, 0x00, 0, 0],
      [0x00, 0x50, 0x00, 0, 0],
      [0x00, 0x40, 0x00, 0, 0],
      [0x00, 0x30, 0x00, 0, 0],
      [0x00, 0x20, 0x00, 0, 0],
      [0x00, 0x10, 0x00, 0, 0],
      [0x00, 0x05, 0x00, 0, 0],
    ]);
    // key 00:80:00 == row 1 prefix esatto. row 0 (a0) > key → advance;
    //              row 1: all 3 col == → fall-through advance row;
    //              row 2 (70) < key (80) col 1 → return 2.
    expect(keyRankLookup4686(s, 0x00008000)).toBe(2);
  });

  it("low 24 bit estratti correttamente (high == 0, key=0)", () => {
    const s = emptyGameState();
    writeLongBE(s.workRam, PTR_OFF, PTR_ABS);
    // DESC table with row 9 prefix 00:00:00.
    setupTable(s.workRam, [
      [0x00, 0xa0, 0x00, 0, 0],
      [0x00, 0x80, 0x00, 0, 0],
      [0x00, 0x60, 0x00, 0, 0],
      [0x00, 0x40, 0x00, 0, 0],
      [0x00, 0x20, 0x00, 0, 0],
      [0x00, 0x10, 0x00, 0, 0],
      [0x00, 0x08, 0x00, 0, 0],
      [0x00, 0x04, 0x00, 0, 0],
      [0x00, 0x02, 0x00, 0, 0],
      [0x00, 0x00, 0x00, 0, 0], // row 9: prefix 00:00:00
    ]);
    // key 00:00:00 == row 9 esatto. Row 0..8 hanno prefix > 0 → bhi → advance.
    // Row 9: all 3 col == → fall-through. Loop completato. → return 10.
    expect(keyRankLookup4686(s, 0x00000000)).toBe(10);
  });
});
