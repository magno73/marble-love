/**
 * pf-scroll-emit-26e14.test.ts — smoke + corner case of pfScrollEmit26E14.
 *
 */

import { describe, it, expect } from "vitest";
import { pfScrollEmit26E14 } from "../src/pf-scroll-emit-26e14.js";
import { emptyGameState } from "../src/state.js";

const WORK_RAM_BASE = 0x400000;
const SPRITE_RAM_BASE = 0xa02000;

function readU16(buf: Uint8Array, off: number): number {
  return ((buf[off] ?? 0) << 8) | (buf[off + 1] ?? 0);
}
function writeU16(buf: Uint8Array, off: number, v: number): void {
  buf[off] = (v >>> 8) & 0xff;
  buf[off + 1] = v & 0xff;
}
function readU32(buf: Uint8Array, off: number): number {
  return (
    (buf[off] ?? 0) * 0x1000000 +
    ((buf[off + 1] ?? 0) << 16) +
    ((buf[off + 2] ?? 0) << 8) +
    (buf[off + 3] ?? 0)
  ) >>> 0;
}
function writeU32(buf: Uint8Array, off: number, v: number): void {
  const u = v >>> 0;
  buf[off] = (u >>> 24) & 0xff;
  buf[off + 1] = (u >>> 16) & 0xff;
  buf[off + 2] = (u >>> 8) & 0xff;
  buf[off + 3] = u & 0xff;
}

describe("pfScrollEmit26E14", () => {
  it("non solleva eccezioni con state vuoto", () => {
    const s = emptyGameState();
    // Default cmp word @ 0xA02180 = 0; D4=0 al first iter → match → exit.
    expect(() => pfScrollEmit26E14(s, 0)).not.toThrow();
  });

  it("toggla bit 3 of AV (0x4003AE) and writes in 0x4003B0", () => {
    const s = emptyGameState();
    writeU16(s.workRam, 0x3ae, 0x0000);
    writeU16(s.spriteRam, 0x180, 0);
    pfScrollEmit26E14(s, 0);
    expect(readU16(s.workRam, 0x3b0)).toBe(0x0008);

    writeU16(s.workRam, 0x3ae, 0x0008);
    writeU16(s.spriteRam, 0x180, 0);
    pfScrollEmit26E14(s, 0);
    expect(readU16(s.workRam, 0x3b0)).toBe(0x0000);
  });

  it("inizializza the 4 long-cursor on the pagina TOGGLED (AV iniziale 0 → next page = +0x100*2)", () => {
    const s = emptyGameState();
    writeU16(s.workRam, 0x3ae, 0x0000); // AV bit3 OFF → toggled = 8 → offNew = 0x200
    writeU16(s.spriteRam, 0x180, 0);

    pfScrollEmit26E14(s, 0);

    expect(readU32(s.workRam, 0x3f6)).toBe(SPRITE_RAM_BASE + 0x000 + 0x200 + 2);
    expect(readU32(s.workRam, 0x3fa)).toBe(SPRITE_RAM_BASE + 0x080 + 0x200 + 2);
    expect(readU32(s.workRam, 0x3fe)).toBe(SPRITE_RAM_BASE + 0x100 + 0x200 + 2);
    expect(readU32(s.workRam, 0x402)).toBe(SPRITE_RAM_BASE + 0x180 + 0x200 + 2);
  });

  it("AV bit3 ON → cursor on the pagina ALTRA (+0x000); read da +0x200", () => {
    const s = emptyGameState();
    writeU16(s.workRam, 0x3ae, 0x0008); // AV ON → toggled bit3 OFF → offNew = 0
    // I read pointers usano AV ORIGINALE (= 8) → offOld = 0x200, leggono da +0x200/+0x280/+0x300/+0x380
    writeU16(s.spriteRam, 0x180 + 0x200, 0); // cmp word @ A3 = 0 → exit iter 0

    pfScrollEmit26E14(s, 0);

    // Cursors write from toggled page (+0x000), advanced by 2.
    expect(readU32(s.workRam, 0x3f6)).toBe(SPRITE_RAM_BASE + 0x000 + 2);
    expect(readU32(s.workRam, 0x402)).toBe(SPRITE_RAM_BASE + 0x180 + 2);
  });

  it("emette merge on the buffer A: (src + (arg<<5)) & 0x3FFF | (src & 0xC000)", () => {
    const s = emptyGameState();
    writeU16(s.workRam, 0x3ae, 0x0000); // toggled = 8 → write @ +0x200, read @ +0
    // Setup: bank A read @ offset 0; cmp NOT match (force MAX_ITER limited)
    writeU16(s.spriteRam, 0x000, 0xc000); // src = 0xC000 (bit 14 set, low = 0)
    // arg=2 → lineOffset = (2 << 5) = 0x40
    // merged = ((0xC000 + 0x40) & 0x3FFF) | (0xC000 & 0xC000) = 0x40 | 0xC000 = 0xC040
    // cmp word @ +0x180 (orig page) = 0xFFFF does not match d4=0; then advance and cmp with d4=1...
    writeU16(s.spriteRam, 0x180, 0xffff);
    writeU16(s.spriteRam, 0x182, 0x0001); // d4=1 al check iter 1 → exit

    pfScrollEmit26E14(s, 2);

    expect(readU16(s.spriteRam, 0x200)).toBe(0xc040);
  });

  it("emette passthrough suthe buffers B/C/D", () => {
    const s = emptyGameState();
    writeU16(s.workRam, 0x3ae, 0x0000);
    writeU16(s.spriteRam, 0x080, 0xbeef); // bank B src
    writeU16(s.spriteRam, 0x100, 0xcafe); // bank C src
    writeU16(s.spriteRam, 0x180, 0xdead); // bank D src
    writeU16(s.spriteRam, 0x180, 0xffff);
    writeU16(s.spriteRam, 0x182, 0x0001);

    writeU16(s.spriteRam, 0x180, 0xdead);
    writeU16(s.spriteRam, 0x182, 0x0001);

    pfScrollEmit26E14(s, 0);

    // Output: bank B write @ +0x280; bank C write @ +0x300; bank D write @ +0x380.
    expect(readU16(s.spriteRam, 0x280)).toBe(0xbeef);
    expect(readU16(s.spriteRam, 0x300)).toBe(0xcafe);
    expect(readU16(s.spriteRam, 0x380)).toBe(0xdead);
  });

  it("loop limita a 60 iter when cmp non matcha mai", () => {
    const s = emptyGameState();
    writeU16(s.workRam, 0x3ae, 0x0000);
    for (let i = 0; i < 64; i++) writeU16(s.spriteRam, 0x180 + i * 2, 0xffff);

    expect(() => pfScrollEmit26E14(s, 1)).not.toThrow();

    // Cursor avanzati of 2 * 60 = 0x78 byte; base = 0xA02xxx + 0x200.
    expect(readU32(s.workRam, 0x3f6)).toBe(SPRITE_RAM_BASE + 0x000 + 0x200 + 60 * 2);
    expect(readU32(s.workRam, 0x402)).toBe(SPRITE_RAM_BASE + 0x180 + 0x200 + 60 * 2);
  });

  it("arg negativo (long signed): lineOffset = (arg << 5) low word", () => {
    const s = emptyGameState();
    writeU16(s.workRam, 0x3ae, 0x0000);
    writeU16(s.spriteRam, 0x000, 0x0000);
    // exit iter 0: cmp @ +0x180 = 0
    writeU16(s.spriteRam, 0x180, 0x0000);

    // arg = -1 (long): JS << 5 = -32 → low 16 bit = 0xFFE0
    pfScrollEmit26E14(s, -1);

    // src=0, lineOffset=0xFFE0 → (0 + 0xFFE0) & 0x3FFF = 0x3FE0 | 0 = 0x3FE0
    expect(readU16(s.spriteRam, 0x200)).toBe(0x3fe0);
  });
});

void WORK_RAM_BASE;
