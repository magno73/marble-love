/**
 * Test consumeEventFlag (FUN_2548).
 *
 * Bit-perfect verificato vs binary (1000/1000) tramite
 * `cli/src/test-event-flags-parity.ts`.
 */

import { describe, it, expect } from "vitest";
import { consumeEventFlag, EVENT_FLAGS_OFF } from "../src/event-flags.js";
import { emptyGameState } from "../src/state.js";

describe("consumeEventFlag (FUN_2548)", () => {
  function setFlags(value: number) {
    const s = emptyGameState();
    s.workRam[EVENT_FLAGS_OFF] = (value >>> 8) & 0xff;
    s.workRam[EVENT_FLAGS_OFF + 1] = value & 0xff;
    return s;
  }
  function readFlags(s: ReturnType<typeof setFlags>): number {
    return ((s.workRam[EVENT_FLAGS_OFF] ?? 0) << 8) | (s.workRam[EVENT_FLAGS_OFF + 1] ?? 0);
  }

  it("flag word == 0: returns 0, stays 0", () => {
    const s = setFlags(0);
    expect(consumeEventFlag(s)).toBe(0);
    expect(readFlags(s)).toBe(0);
  });

  it("flag word == 1: returns 1, becomes 0", () => {
    const s = setFlags(1);
    expect(consumeEventFlag(s)).toBe(1);
    expect(readFlags(s)).toBe(0);
  });

  it("flag word == 0xFFFF: returns 1 (16 times to drain)", () => {
    const s = setFlags(0xffff);
    for (let i = 0; i < 16; i++) {
      expect(consumeEventFlag(s)).toBe(1);
    }
    expect(readFlags(s)).toBe(0);
    expect(consumeEventFlag(s)).toBe(0);
  });

  it("alternating bits 0xAAAA: 0,1,0,1,...", () => {
    // 0xAAAA = 1010101010101010 (LSB-first: 0,1,0,1,...)
    const s = setFlags(0xaaaa);
    const seq: number[] = [];
    for (let i = 0; i < 16; i++) seq.push(consumeEventFlag(s));
    expect(seq).toEqual([0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1]);
  });

  it("0x5555: 1,0,1,0,...", () => {
    const s = setFlags(0x5555);
    const seq: number[] = [];
    for (let i = 0; i < 16; i++) seq.push(consumeEventFlag(s));
    expect(seq).toEqual([1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0]);
  });
});
