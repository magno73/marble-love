import { describe, expect, it } from "vitest";
import {
  bannerHelper26B66,
  BANNER_HELPER_26B66_ADDR,
} from "../src/banner-helper-26b66.js";
import { emptyGameState } from "../src/state.js";

function writeU32(bytes: Uint8Array, off: number, value: number): void {
  const v = value >>> 0;
  bytes[off] = (v >>> 24) & 0xff;
  bytes[off + 1] = (v >>> 16) & 0xff;
  bytes[off + 2] = (v >>> 8) & 0xff;
  bytes[off + 3] = v & 0xff;
}

function readU32(bytes: Uint8Array, off: number): number {
  return ((((bytes[off] ?? 0) << 24) |
    ((bytes[off + 1] ?? 0) << 16) |
    ((bytes[off + 2] ?? 0) << 8) |
    (bytes[off + 3] ?? 0)) >>> 0);
}

describe("bannerHelper26B66 (FUN_00026B66)", () => {
  it("pushes the low argument byte into the palette queue", () => {
    const s = emptyGameState();
    writeU32(s.workRam, 0x408, 0x0040040c);

    bannerHelper26B66(s, 0x123456ab);

    expect(s.workRam[0x40c]).toBe(0xab);
    expect(readU32(s.workRam, 0x408)).toBe(0x0040040d);
  });

  it("clamps the queue pointer to 0x40040F", () => {
    const s = emptyGameState();
    writeU32(s.workRam, 0x408, 0x0040040f);

    bannerHelper26B66(s, 0x42);

    expect(s.workRam[0x40f]).toBe(0x42);
    expect(readU32(s.workRam, 0x408)).toBe(0x0040040f);
  });

  it("exposes the binary entry address", () => {
    expect(BANNER_HELPER_26B66_ADDR).toBe(0x26b66);
  });
});
