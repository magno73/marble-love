/**
 * slapstic-lookup.test.ts — corner cases di slapsticLookup (FUN_2FFB8).
 *
 * Bit-perfect parity verificata vs binary in `test-slapstic-lookup-parity.ts`.
 *
 * Smoke tests with synthetic ROM (Uint8Array): manually write the words
 * expected BE values at `0x80080 + idx` and verify the function returns them.
 */

import { describe, it, expect } from "vitest";
import { slapsticLookup, SLAPSTIC_LOOKUP_BASE } from "../src/slapstic-lookup.js";
import type { RomImage } from "../src/bus.js";

function makeRom(): RomImage {
  return {
    program: new Uint8Array(0x88000),
    sound: new Uint8Array(0x10000),
    tiles: new Uint8Array(0x100000),
    sprites: new Uint8Array(0),
    proms: new Uint8Array(0x400),
  };
}

function writeBE16(rom: RomImage, addr: number, word: number): void {
  rom.program[addr] = (word >>> 8) & 0xff;
  rom.program[addr + 1] = word & 0xff;
}

describe("slapsticLookup (FUN_2FFB8)", () => {
  it("arg=0 → ritorna word a 0x80080", () => {
    const rom = makeRom();
    writeBE16(rom, SLAPSTIC_LOOKUP_BASE, 0xdead);
    expect(slapsticLookup(rom, 0)).toBe(0xdead);
  });

  it("arg=1 → ritorna word a 0x80080 + 0x20 (1<<5)", () => {
    const rom = makeRom();
    writeBE16(rom, SLAPSTIC_LOOKUP_BASE + 0x20, 0xbeef);
    expect(slapsticLookup(rom, 1)).toBe(0xbeef);
  });

  it("arg=3 → ritorna word a 0x80080 + 0x60 (3<<5) — caller FUN_1ACE0", () => {
    const rom = makeRom();
    writeBE16(rom, SLAPSTIC_LOOKUP_BASE + 0x60, 0x1234);
    expect(slapsticLookup(rom, 3)).toBe(0x1234);
  });

  it("arg=0x10 → idx = 0x200, address = 0x80280", () => {
    const rom = makeRom();
    writeBE16(rom, SLAPSTIC_LOOKUP_BASE + 0x200, 0xc0de);
    expect(slapsticLookup(rom, 0x10)).toBe(0xc0de);
  });

  it("arg con bit 10 set (0x400): (arg<<5)&0xFFFF = 0x8000 → signExt16 → -0x8000 → addr 0x78080 (main ROM)", () => {
    const rom = makeRom();
    writeBE16(rom, 0x78080, 0xface);
    expect(slapsticLookup(rom, 0x400)).toBe(0xface);
  });

  it("arg=0x800: (arg<<5)&0xFFFF = 0 → wrap, idx=0, address=0x80080", () => {
    const rom = makeRom();
    writeBE16(rom, SLAPSTIC_LOOKUP_BASE, 0xa5a5);
    // arg with bit 11 set: (0x800 << 5) = 0x10000 -> low word = 0.
    expect(slapsticLookup(rom, 0x800)).toBe(0xa5a5);
  });

  it("ROM zero-init → ritorna 0", () => {
    const rom = makeRom();
    expect(slapsticLookup(rom, 0)).toBe(0);
    expect(slapsticLookup(rom, 2)).toBe(0);
  });

  it("argW oltre 16 bit viene mascherato a 16 bit", () => {
    const rom = makeRom();
    writeBE16(rom, SLAPSTIC_LOOKUP_BASE + 0x20, 0x55aa);
    // 0x10001 & 0xFFFF = 1 → idx = 0x20
    expect(slapsticLookup(rom, 0x10001)).toBe(0x55aa);
  });
});
