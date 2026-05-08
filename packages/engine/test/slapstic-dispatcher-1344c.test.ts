import { describe, expect, it } from "vitest";
import type { RomImage } from "../src/bus.js";
import {
  slapsticDispatcher1344C,
  SLAPSTIC_DISPATCHER_1344C_ADDR,
} from "../src/slapstic-dispatcher-1344c.js";
import { emptyGameState } from "../src/state.js";

const WRAM = 0x00400000;

function makeRom(): RomImage {
  return {
    program: new Uint8Array(0x88000),
    sound: new Uint8Array(0x10000),
    tiles: new Uint8Array(0x100000),
    sprites: new Uint8Array(0),
    proms: new Uint8Array(0x400),
  };
}

function off(abs: number): number {
  return abs - WRAM;
}

function wb(bytes: Uint8Array, abs: number, value: number): void {
  bytes[off(abs)] = value & 0xff;
}

function ww(bytes: Uint8Array, abs: number, value: number): void {
  bytes[off(abs)] = (value >>> 8) & 0xff;
  bytes[off(abs) + 1] = value & 0xff;
}

function wl(bytes: Uint8Array, abs: number, value: number): void {
  bytes[off(abs)] = (value >>> 24) & 0xff;
  bytes[off(abs) + 1] = (value >>> 16) & 0xff;
  bytes[off(abs) + 2] = (value >>> 8) & 0xff;
  bytes[off(abs) + 3] = value & 0xff;
}

describe("slapsticDispatcher1344C (FUN_0001344C)", () => {
  it("returns immediately when no pending record exists", () => {
    const s = emptyGameState();
    const rom = makeRom();
    let calls = 0;

    slapsticDispatcher1344C(s, rom, {
      fun_2ffb8: () => {
        calls++;
        return 0;
      },
    });

    expect(calls).toBe(0);
    expect(s.workRam[0x970]).toBe(0);
  });

  it("applies patch list, clears pending record, and brackets slapstic helper calls", () => {
    const s = emptyGameState();
    const rom = makeRom();
    const calls: number[] = [];
    const rec = 0x00400a00;
    const obj = 0x00400b00;
    const patch = 0x00400c00;

    wl(s.workRam, 0x00400970, rec);
    wl(s.workRam, 0x00400974, obj);
    ww(s.workRam, 0x00400664, 0x0004);
    ww(s.workRam, 0x00400662, 0xfffe);
    wb(s.workRam, obj + 0x1e, 0);
    wl(s.workRam, rec + 4, patch);
    ww(s.workRam, patch, 2);
    ww(s.workRam, patch + 2, 3);
    ww(s.workRam, patch + 4, 0x1111);
    ww(s.workRam, patch + 6, 0x2222);
    ww(s.workRam, patch + 8, 0x3333);

    slapsticDispatcher1344C(s, rom, {
      fun_2ffb8: (_state, _rom, arg) => {
        calls.push(arg);
        return 0;
      },
    });

    expect(calls).toEqual([4, -2]);
    expect(s.workRam.slice(0x970, 0x974)).toEqual(new Uint8Array([0, 0, 0, 0]));
    expect(s.workRam.slice(0x76e + 4, 0x76e + 10)).toEqual(
      new Uint8Array([0x11, 0x11, 0x22, 0x22, 0x33, 0x33]),
    );
  });

  it("renders direct tile rows into playfield RAM", () => {
    const s = emptyGameState();
    const rom = makeRom();
    const rec = 0x00400a00;
    const obj = 0x00400b00;
    const tiles = 0x00400c00;
    const level = 0x00400d00;

    wl(s.workRam, 0x00400970, rec);
    wl(s.workRam, 0x00400974, obj);
    wl(s.workRam, 0x00400474, level);
    wl(s.workRam, rec, tiles);
    wl(s.workRam, rec + 4, 0);
    wb(s.workRam, obj + 0x1e, 1);
    wb(s.workRam, obj + 0x1f, 0);
    ww(s.workRam, obj + 0x26, 0);
    ww(s.workRam, obj + 0x28, 0xffff);
    ww(s.workRam, 0x00400000, 8);
    wb(s.workRam, tiles, 2);
    wb(s.workRam, tiles + 1, 2);
    ww(s.workRam, tiles + 2, 0x1111);
    ww(s.workRam, tiles + 4, 0x2222);
    ww(s.workRam, tiles + 6, 0x3333);
    ww(s.workRam, tiles + 8, 0x4444);

    slapsticDispatcher1344C(s, rom, { fun_2ffb8: () => 0 });

    expect(s.playfieldRam.slice(6, 10)).toEqual(new Uint8Array([0x11, 0x11, 0x22, 0x22]));
    expect(s.playfieldRam.slice(0x86, 0x8a)).toEqual(new Uint8Array([0x33, 0x33, 0x44, 0x44]));
    expect(s.workRam.slice(0x978, 0x97c)).toEqual(new Uint8Array([0, 0x40, 0x0a, 0]));
  });

  it("exposes the binary entry address", () => {
    expect(SLAPSTIC_DISPATCHER_1344C_ADDR).toBe(0x1344c);
  });
});
