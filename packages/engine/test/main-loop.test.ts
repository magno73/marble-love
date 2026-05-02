/**
 * Test mainUpdateScrollSync (prefix di FUN_28788 0x28788..0x287D8).
 *
 * Bit-perfect verificato vs binary (2000/2000) tramite
 * `cli/src/test-main-prefix-parity.ts`.
 */

import { describe, it, expect } from "vitest";
import { mainUpdateScrollSync } from "../src/main-loop.js";
import { emptyGameState } from "../src/state.js";

describe("mainUpdateScrollSync", () => {
  function setState(opts: {
    flag: number;
    frameLong: number;
    yTarget: number;
    yLatched: number;
    avNew: number;
    avCache: number;
  }) {
    const s = emptyGameState();
    s.workRam[0x39a] = opts.flag;
    s.workRam[0x10] = (opts.frameLong >>> 24) & 0xff;
    s.workRam[0x11] = (opts.frameLong >>> 16) & 0xff;
    s.workRam[0x12] = (opts.frameLong >>> 8) & 0xff;
    s.workRam[0x13] = opts.frameLong & 0xff;
    s.workRam[0x00] = (opts.yTarget >>> 8) & 0xff;
    s.workRam[0x01] = opts.yTarget & 0xff;
    s.workRam[0x02] = (opts.yLatched >>> 8) & 0xff;
    s.workRam[0x03] = opts.yLatched & 0xff;
    s.workRam[0x3ae] = (opts.avCache >>> 8) & 0xff;
    s.workRam[0x3af] = opts.avCache & 0xff;
    s.workRam[0x3b0] = (opts.avNew >>> 8) & 0xff;
    s.workRam[0x3b1] = opts.avNew & 0xff;
    return s;
  }
  function readU16(s: ReturnType<typeof setState>, off: number): number {
    return ((s.workRam[off] ?? 0) << 8) | (s.workRam[off + 1] ?? 0);
  }
  function readU32(s: ReturnType<typeof setState>, off: number): number {
    return (
      ((s.workRam[off] ?? 0) << 24) |
      ((s.workRam[off + 1] ?? 0) << 16) |
      ((s.workRam[off + 2] ?? 0) << 8) |
      (s.workRam[off + 3] ?? 0)
    ) >>> 0;
  }

  it("flag == 0: no-op (state unchanged)", () => {
    const s = setState({
      flag: 0, frameLong: 100, yTarget: 0xAAAA, yLatched: 0xBBBB,
      avNew: 0xCCCC, avCache: 0xDDDD,
    });
    mainUpdateScrollSync(s);
    expect(s.workRam[0x39a]).toBe(0);
    expect(readU32(s, 0x10)).toBe(100); // ctr unchanged
    expect(readU16(s, 0x02)).toBe(0xBBBB); // yLatched unchanged
    expect(readU16(s, 0x3ae)).toBe(0xDDDD); // avCache unchanged
  });

  it("flag != 0: increment ctr, latch y + avControl, clear flag", () => {
    const s = setState({
      flag: 1, frameLong: 0xa298fff, yTarget: 0xc66a, yLatched: 0x3942,
      avNew: 0xf217, avCache: 0x0578,
    });
    mainUpdateScrollSync(s);
    expect(s.workRam[0x39a]).toBe(0); // flag cleared
    expect(readU32(s, 0x10)).toBe(0xa299000); // ctr+1
    expect(readU16(s, 0x02)).toBe(0xc66a); // yLatched = yTarget
    expect(readU16(s, 0x3ae)).toBe(0xf217); // avCache = avNew
  });

  it("ctr wraps around 32-bit", () => {
    const s = setState({
      flag: 1, frameLong: 0xffffffff, yTarget: 0, yLatched: 0,
      avNew: 0, avCache: 0,
    });
    mainUpdateScrollSync(s);
    expect(readU32(s, 0x10)).toBe(0); // 0xFFFFFFFF + 1 = 0
  });
});
