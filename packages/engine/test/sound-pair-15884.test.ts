/**
 * sound-pair-15884.test.ts — corner cases of soundPair15884 (FUN_15884).
 *
 */

import { describe, it, expect } from "vitest";
import { soundPair15884 } from "../src/sound-pair-15884.js";
import { emptyGameState } from "../src/state.js";

function setMode(state: ReturnType<typeof emptyGameState>, value: number): void {
  const u16 = (value & 0xffff) >>> 0;
  state.workRam[0x394] = (u16 >>> 8) & 0xff;
  state.workRam[0x395] = u16 & 0xff;
}

describe("soundPair15884 (FUN_15884)", () => {
  it("mode = 0 (default) → soundCommand(0x3A) + soundCommand(0x3B)", () => {
    const s = emptyGameState();
    const calls: number[] = [];
    soundPair15884(s, { soundCommand: (c) => calls.push(c) });
    expect(calls).toEqual([0x3a, 0x3b]);
  });

  it("mode = 1 → complete pair 0x3A + 0x3B", () => {
    const s = emptyGameState();
    setMode(s, 1);
    const calls: number[] = [];
    soundPair15884(s, { soundCommand: (c) => calls.push(c) });
    expect(calls).toEqual([0x3a, 0x3b]);
  });

  it("mode = 2 → solo soundCommand(0x3A) (gate)", () => {
    const s = emptyGameState();
    setMode(s, 2);
    const calls: number[] = [];
    soundPair15884(s, { soundCommand: (c) => calls.push(c) });
    expect(calls).toEqual([0x3a]);
  });

  it("mode = 3 → complete pair 0x3A + 0x3B (boundary just above gate)", () => {
    const s = emptyGameState();
    setMode(s, 3);
    const calls: number[] = [];
    soundPair15884(s, { soundCommand: (c) => calls.push(c) });
    expect(calls).toEqual([0x3a, 0x3b]);
  });

  it("mode = 4 → complete pair (see trackball ADD path)", () => {
    const s = emptyGameState();
    setMode(s, 4);
    const calls: number[] = [];
    soundPair15884(s, { soundCommand: (c) => calls.push(c) });
    expect(calls).toEqual([0x3a, 0x3b]);
  });

  it("mode = 0xFFFF → complete pair (cmp.w is word, not sign-aware)", () => {
    const s = emptyGameState();
    setMode(s, 0xffff);
    const calls: number[] = [];
    soundPair15884(s, { soundCommand: (c) => calls.push(c) });
    expect(calls).toEqual([0x3a, 0x3b]);
  });

  it("mode = 0x0102 → complete pair (high byte non-zero)", () => {
    const s = emptyGameState();
    setMode(s, 0x0102);
    const calls: number[] = [];
    soundPair15884(s, { soundCommand: (c) => calls.push(c) });
    expect(calls).toEqual([0x3a, 0x3b]);
  });

  it("subs undefined → no-op (no throw)", () => {
    const s = emptyGameState();
    setMode(s, 2);
    expect(() => soundPair15884(s)).not.toThrow();
  });

  it("subs.soundCommand undefined → no-op (no throw)", () => {
    const s = emptyGameState();
    setMode(s, 0);
    expect(() => soundPair15884(s, {})).not.toThrow();
  });

  it("non modifies workRam", () => {
    const s = emptyGameState();
    setMode(s, 2);
    const before = new Uint8Array(s.workRam);
    soundPair15884(s, { soundCommand: () => {} });
    expect(s.workRam).toEqual(before);
  });

  it("ordine of trigger: 0x3A precede 0x3B (non viceversa)", () => {
    const s = emptyGameState();
    setMode(s, 0);
    const calls: number[] = [];
    soundPair15884(s, { soundCommand: (c) => calls.push(c) });
    expect(calls[0]).toBe(0x3a);
    expect(calls[1]).toBe(0x3b);
  });

  it("mode == 2 → exactly 1 chiamata; otherwise exactly 2", () => {
    const s = emptyGameState();
    setMode(s, 2);
    let n = 0;
    soundPair15884(s, { soundCommand: () => n++ });
    expect(n).toBe(1);

    setMode(s, 0);
    n = 0;
    soundPair15884(s, { soundCommand: () => n++ });
    expect(n).toBe(2);
  });
});
