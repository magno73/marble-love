import { describe, expect, it } from "vitest";
import {
  softReset100E0,
  SOFT_RESET_100E0_ADDR,
  type SoftReset100E0Subs,
} from "../src/soft-reset-100e0.js";
import { emptyGameState } from "../src/state.js";

function writeU16(bytes: Uint8Array, off: number, value: number): void {
  bytes[off] = (value >>> 8) & 0xff;
  bytes[off + 1] = value & 0xff;
}

function readU16(bytes: Uint8Array, off: number): number {
  return (((bytes[off] ?? 0) << 8) | (bytes[off + 1] ?? 0)) & 0xffff;
}

describe("softReset100E0 (FUN_000100E0)", () => {
  it("increments 0x3B6, clears 0x3B2, and resets countdown to 0x012C", () => {
    const s = emptyGameState();
    writeU16(s.workRam, 0x3b6, 0xffff);
    s.workRam[0x3b2] = 0x7f;
    writeU16(s.workRam, 0x3b8, 0x1234);

    softReset100E0(s);

    expect(readU16(s.workRam, 0x3b6)).toBe(0);
    expect(s.workRam[0x3b2]).toBe(0);
    expect(readU16(s.workRam, 0x3b8)).toBe(0x012c);
  });

  it("passes the 0x3AE word and zero to the audio thunk injection", () => {
    const s = emptyGameState();
    writeU16(s.workRam, 0x3ae, 0x0080);
    const calls: Array<[number, number]> = [];
    const subs: SoftReset100E0Subs = {
      fun_0254: (_state, argWord, zero) => calls.push([argWord, zero]),
    };

    softReset100E0(s, subs);

    expect(calls).toEqual([[0x0080, 0]]);
  });

  it("exposes the binary entry address", () => {
    expect(SOFT_RESET_100E0_ADDR).toBe(0x100e0);
  });
});
