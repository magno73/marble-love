import { describe, expect, it } from "vitest";
import {
  spriteHelper1B9CC,
  SPRITE_HELPER_1B9CC_ADDR,
} from "../src/sprite-helper-1b9cc.js";
import { emptyGameState } from "../src/state.js";

const WRAM = 0x00400000;

function off(abs: number): number {
  return abs - WRAM;
}

function ww(bytes: Uint8Array, abs: number, value: number): void {
  const o = off(abs);
  bytes[o] = (value >>> 8) & 0xff;
  bytes[o + 1] = value & 0xff;
}

function wl(bytes: Uint8Array, abs: number, value: number): void {
  const o = off(abs);
  const v = value >>> 0;
  bytes[o] = (v >>> 24) & 0xff;
  bytes[o + 1] = (v >>> 16) & 0xff;
  bytes[o + 2] = (v >>> 8) & 0xff;
  bytes[o + 3] = v & 0xff;
}

function rl(bytes: Uint8Array, abs: number): number {
  const o = off(abs);
  return (((bytes[o] ?? 0) << 24) |
    ((bytes[o + 1] ?? 0) << 16) |
    ((bytes[o + 2] ?? 0) << 8) |
    (bytes[o + 3] ?? 0)) >>> 0;
}

describe("spriteHelper1B9CC (FUN_0001B9CC)", () => {
  it("sets sentinel globals when flag low byte is non-zero", () => {
    const s = emptyGameState();
    spriteHelper1B9CC(s, 0x00400018, 1, { fun_1bab2: () => undefined });
    expect(s.workRam[0x696]).toBe(0xff);
    expect(s.workRam[0x697]).toBe(0xff);
    expect(s.workRam[0x698]).toBe(0xff);
    expect(s.workRam[0x699]).toBe(0xff);
  });

  it("computes packed screen key and shifts the three-entry MRU cache", () => {
    const s = emptyGameState();
    const obj = 0x00400018;
    ww(s.workRam, obj + 0x14, 0x0004);
    ww(s.workRam, 0x00400690, 0x0010);
    ww(s.workRam, 0x00400692, 0x0020);
    ww(s.workRam, 0x0040097e, 0x0030);
    wl(s.workRam, obj + 0x1e, 0xaaaaaaaa);
    wl(s.workRam, obj + 0x22, 0xbbbbbbbb);
    wl(s.workRam, obj + 0x26, 0xcccccccc);

    spriteHelper1B9CC(s, obj, 0, { fun_1bab2: () => undefined });

    expect(rl(s.workRam, obj + 0x1e)).toBe(0x00980070);
    expect(rl(s.workRam, obj + 0x22)).toBe(0xaaaaaaaa);
    expect(rl(s.workRam, obj + 0x26)).toBe(0xbbbbbbbb);
  });

  it("does not shift cache when packed key is already one of the first two entries", () => {
    const s = emptyGameState();
    const obj = 0x00400018;
    ww(s.workRam, obj + 0x14, 0);
    ww(s.workRam, 0x00400690, 0);
    ww(s.workRam, 0x00400692, 0);
    ww(s.workRam, 0x0040097e, 0);
    wl(s.workRam, obj + 0x1e, 0x00880054);
    wl(s.workRam, obj + 0x22, 0x22222222);
    wl(s.workRam, obj + 0x26, 0x33333333);

    spriteHelper1B9CC(s, obj, 0, { fun_1bab2: () => undefined });

    expect(rl(s.workRam, obj + 0x1e)).toBe(0x00880054);
    expect(rl(s.workRam, obj + 0x22)).toBe(0x22222222);
    expect(rl(s.workRam, obj + 0x26)).toBe(0x33333333);
  });

  it("exposes the binary entry address", () => {
    expect(SPRITE_HELPER_1B9CC_ADDR).toBe(0x1b9cc);
  });
});
