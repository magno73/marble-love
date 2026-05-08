import { describe, expect, it } from "vitest";
import { STRING_HELPER_17CB8_ADDR, stringHelper17CB8 } from "../src/string-helper-17cb8.js";
import { emptyGameState } from "../src/state.js";

const WRAM = 0x00400000;

function off(abs: number): number {
  return abs - WRAM;
}

function wb(wr: Uint8Array, abs: number, value: number): void {
  wr[off(abs)] = value & 0xff;
}

function ww(wr: Uint8Array, abs: number, value: number): void {
  const o = off(abs);
  wr[o] = (value >>> 8) & 0xff;
  wr[o + 1] = value & 0xff;
}

function rl(wr: Uint8Array, abs: number): number {
  const o = off(abs);
  return (((wr[o] ?? 0) << 24) | ((wr[o + 1] ?? 0) << 16) | ((wr[o + 2] ?? 0) << 8) | (wr[o + 3] ?? 0)) >>> 0;
}

describe("stringHelper17CB8 (FUN_00017CB8)", () => {
  it("finds active object in the main object pool and stores its index", () => {
    const s = emptyGameState();
    const obj = 0x00400018 + 0x00e2;
    ww(s.workRam, 0x00400396, 3);
    wb(s.workRam, obj + 0x18, 1);
    ww(s.workRam, obj + 0x0c, 0x0104);
    ww(s.workRam, obj + 0x10, 0x0204);

    expect(stringHelper17CB8(s, 0x00400018, 0x0100, 0x0200, 0x0180)).toBe(1);
    expect(rl(s.workRam, 0x0040046a)).toBe(1);
  });

  it("skips the passed object pointer", () => {
    const s = emptyGameState();
    const obj = 0x00400018;
    ww(s.workRam, 0x00400396, 1);
    wb(s.workRam, obj + 0x18, 1);
    ww(s.workRam, obj + 0x0c, 0x0100);
    ww(s.workRam, obj + 0x10, 0x0200);

    expect(stringHelper17CB8(s, obj, 0x0100, 0x0200, 0x0180)).toBe(0);
  });

  it("falls through to secondary pools", () => {
    const s = emptyGameState();
    const obj = 0x004009a4 + 0x007c;
    ww(s.workRam, 0x00400396, 0);
    wb(s.workRam, obj + 0x18, 1);
    ww(s.workRam, obj + 0x0c, 0x0030);
    ww(s.workRam, obj + 0x10, 0x0040);

    expect(stringHelper17CB8(s, 0x00400018, 0x0030, 0x0040, 0x0180)).toBe(2);
    expect(rl(s.workRam, 0x0040046a)).toBe(1);
  });

  it("exposes the binary entry address", () => {
    expect(STRING_HELPER_17CB8_ADDR).toBe(0x17cb8);
  });
});
