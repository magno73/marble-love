/**
 * slapstic-word-copy-2ff28.test.ts — smoke tests di slapsticWordCopy2FF28
 * (FUN_02FF28).
 *
 * Bit-perfect parity verificata vs binary in
 * `cli/src/test-slapstic-word-copy-2ff28-parity.ts`.
 */

import { describe, it, expect } from "vitest";
import {
  slapsticWordCopy2FF28,
  SRC_ADDR,
  DST_ADDR,
} from "../src/slapstic-word-copy-2ff28.js";

const SLAPSTIC_BASE = 0x80000;
const SLAPSTIC_SIZE = 0x8000;

function makeBuf(): Uint8Array {
  return new Uint8Array(SLAPSTIC_SIZE);
}

function setSrcWord(buf: Uint8Array, word: number): void {
  const off = SRC_ADDR - SLAPSTIC_BASE;
  buf[off] = (word >>> 8) & 0xff;
  buf[off + 1] = word & 0xff;
}

function readWord(buf: Uint8Array, addr: number): number {
  const off = addr - SLAPSTIC_BASE;
  return (((buf[off] ?? 0) << 8) | (buf[off + 1] ?? 0)) & 0xffff;
}

describe("slapsticWordCopy2FF28 (FUN_02FF28)", () => {
  it("copia src word in dst fisso 0x87A48", () => {
    const buf = makeBuf();
    setSrcWord(buf, 0xdead);

    slapsticWordCopy2FF28(buf, SLAPSTIC_BASE);

    expect(readWord(buf, DST_ADDR)).toBe(0xdead);
  });

  it("src invariato dopo la copia", () => {
    const buf = makeBuf();
    setSrcWord(buf, 0xbeef);

    slapsticWordCopy2FF28(buf, SLAPSTIC_BASE);

    expect(readWord(buf, SRC_ADDR)).toBe(0xbeef);
    expect(readWord(buf, DST_ADDR)).toBe(0xbeef);
  });

  it("word 0x0000: copia zero in dst", () => {
    const buf = makeBuf();
    // dst pre-caricato con valore diverso
    const dstOff = DST_ADDR - SLAPSTIC_BASE;
    buf[dstOff] = 0xff;
    buf[dstOff + 1] = 0xff;
    // src lasciato a 0 (zero-init)

    slapsticWordCopy2FF28(buf, SLAPSTIC_BASE);

    expect(readWord(buf, DST_ADDR)).toBe(0x0000);
  });

  it("word 0xFFFF: copia tutti i bit set", () => {
    const buf = makeBuf();
    setSrcWord(buf, 0xffff);

    slapsticWordCopy2FF28(buf, SLAPSTIC_BASE);

    expect(readWord(buf, DST_ADDR)).toBe(0xffff);
  });

  it("big-endian: byte alto e basso corretti", () => {
    const buf = makeBuf();
    setSrcWord(buf, 0x12ab);

    slapsticWordCopy2FF28(buf, SLAPSTIC_BASE);

    const dstOff = DST_ADDR - SLAPSTIC_BASE;
    expect(buf[dstOff]).toBe(0x12);
    expect(buf[dstOff + 1]).toBe(0xab);
  });

  it("src troppo vicino al bordo del buffer: no-op, no throw", () => {
    // buffer troppo piccolo per contenere SRC_ADDR
    const smallBuf = new Uint8Array(0x100);
    expect(() => slapsticWordCopy2FF28(smallBuf, SLAPSTIC_BASE)).not.toThrow();
  });

  it("idempotente: seconda chiamata produce stesso risultato", () => {
    const buf = makeBuf();
    setSrcWord(buf, 0xa5a5);

    slapsticWordCopy2FF28(buf, SLAPSTIC_BASE);
    slapsticWordCopy2FF28(buf, SLAPSTIC_BASE);

    expect(readWord(buf, DST_ADDR)).toBe(0xa5a5);
  });
});
