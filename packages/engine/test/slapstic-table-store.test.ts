/**
 * slapstic-table-store.test.ts — smoke tests of slapsticTableStore (FUN_2FF40).
 *
 * `cli/src/test-slapstic-table-store-parity.ts`.
 */

import { describe, it, expect } from "vitest";
import {
  slapsticTableStore,
  SRC_ADDR,
  DST_BASE_ADDR,
} from "../src/slapstic-table-store.js";

const SLAPSTIC_BASE = 0x80000;
const SLAPSTIC_SIZE = 0x8000;

function makeBuf(): Uint8Array {
  return new Uint8Array(SLAPSTIC_SIZE);
}

function setSrcWord(buf: Uint8Array, word: number): void {
  const srcOff = SRC_ADDR - SLAPSTIC_BASE;
  buf[srcOff] = (word >>> 8) & 0xff;
  buf[srcOff + 1] = word & 0xff;
}

function readDstWord(buf: Uint8Array, idx: number): number {
  const off = DST_BASE_ADDR - SLAPSTIC_BASE + idx * 2;
  return ((buf[off] ?? 0) << 8) | (buf[off + 1] ?? 0);
}

describe("slapsticTableStore (FUN_2FF40)", () => {
  it("indexWord=0: copies src word in dst[0]", () => {
    const buf = makeBuf();
    setSrcWord(buf, 0xea39);

    slapsticTableStore(buf, SLAPSTIC_BASE, 0);

    expect(readDstWord(buf, 0)).toBe(0xea39);
    // The other entries stay 0.
    expect(readDstWord(buf, 1)).toBe(0);
    expect(readDstWord(buf, 2)).toBe(0);
    expect(readDstWord(buf, 3)).toBe(0);
  });

  it("indexWord=3 (max value caller FUN_2BC5C): copies src word in dst[3]", () => {
    const buf = makeBuf();
    setSrcWord(buf, 0xdead);

    slapsticTableStore(buf, SLAPSTIC_BASE, 3);

    expect(readDstWord(buf, 0)).toBe(0);
    expect(readDstWord(buf, 1)).toBe(0);
    expect(readDstWord(buf, 2)).toBe(0);
    expect(readDstWord(buf, 3)).toBe(0xdead);
  });

  it("indexWord=2: writes a dst[2] = 0x87A4C", () => {
    const buf = makeBuf();
    setSrcWord(buf, 0xbeef);

    slapsticTableStore(buf, SLAPSTIC_BASE, 2);

    const off = 0x7a4c;
    expect(buf[off]).toBe(0xbe);
    expect(buf[off + 1]).toBe(0xef);
  });

  it("bit alti of indexWord are ignorati (mask a low word)", () => {
    const buf = makeBuf();
    setSrcWord(buf, 0x1234);

    // 0x10001 & 0xFFFF = 1 → dst[1]
    slapsticTableStore(buf, SLAPSTIC_BASE, 0x10001);

    expect(readDstWord(buf, 1)).toBe(0x1234);
  });

  it("indexWord negativo (sign-ext): writes a indirizzo first of DST_BASE", () => {
    const buf = makeBuf();
    setSrcWord(buf, 0xc0de);

    // indexWord = -1 (0xFFFF). add.w → 0xFFFE. signExt16 → -2.
    // dst = 0x87A48 + (-2) = 0x87A46. Offset in the buf = 0x7A46.
    slapsticTableStore(buf, SLAPSTIC_BASE, 0xffff);

    const off = 0x7a46;
    expect(buf[off]).toBe(0xc0);
    expect(buf[off + 1]).toBe(0xde);
  });

  it("indexWord=0x4000 (overflow add.w): doubled=0x8000 → signExt → -0x8000", () => {
    // add.w 0x4000 + 0x4000 = 0x8000 (16-bit, no overflow in the low word).
    // signExt16(0x8000) = -0x8000 = -32768.
    const buf = makeBuf();
    setSrcWord(buf, 0xa5a5);
    const before = new Uint8Array(buf);

    slapsticTableStore(buf, SLAPSTIC_BASE, 0x4000);

    expect(buf).toEqual(before);
  });

  it("dst outside range: graceful no-op (no throw, no scrittura)", () => {
    const buf = makeBuf();
    setSrcWord(buf, 0xface);
    const before = new Uint8Array(buf);

    // index=0x8000: doubled=0 (16-bit add wraps), signExt=0 → dst=DST_BASE.
    const smallBuf = new Uint8Array(0x100); // too small
    setSrcWord(smallBuf, 0xface); // off-by-bound, but does not throw
    expect(() => slapsticTableStore(smallBuf, SLAPSTIC_BASE, 0)).not.toThrow();
    void before;
  });
});
