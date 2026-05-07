import { describe, expect, it } from "vitest";

import { emptyRomImage } from "../src/bus.js";
import { LEVEL_HELPER_2FFB8_ADDR, levelHelper2FFB8 } from "../src/level-helper-2ffb8.js";
import { SLAPSTIC_LOOKUP_BASE, slapsticLookup } from "../src/slapstic-lookup.js";

function writeBE16(buf: Uint8Array, off: number, word: number): void {
  buf[off] = (word >>> 8) & 0xff;
  buf[off + 1] = word & 0xff;
}

describe("levelHelper2FFB8 (FUN_2FFB8)", () => {
  it("exposes the binary entry address", () => {
    expect(LEVEL_HELPER_2FFB8_ADDR).toBe(0x2ffb8);
  });

  it("delegates to the bit-perfect slapstic lookup semantics", () => {
    const rom = emptyRomImage();
    writeBE16(rom.program, SLAPSTIC_LOOKUP_BASE + 0x60, 0xcafe);

    expect(levelHelper2FFB8(rom, 3)).toBe(0xcafe);
    expect(levelHelper2FFB8(rom, 3)).toBe(slapsticLookup(rom, 3));
  });

  it("uses the low word of the caller long argument", () => {
    const rom = emptyRomImage();
    writeBE16(rom.program, SLAPSTIC_LOOKUP_BASE + 0x20, 0x55aa);

    expect(levelHelper2FFB8(rom, 0xffff0001)).toBe(0x55aa);
  });
});
