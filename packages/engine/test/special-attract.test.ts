/**
 * special-attract.test.ts — corner cases of specialAttract (FUN_288F8).
 *
 * Bit-perfect parity verificata vs binary in `test-special-attract-parity.ts`.
 */

import { describe, it, expect } from "vitest";
import { specialAttract } from "../src/special-attract.js";
import { emptyGameState } from "../src/state.js";

/** Helper: writes a signed big-endian int16 @ workRam[0x3EA..0x3EB]. */
function setStage(state: ReturnType<typeof emptyGameState>, value: number): void {
  const u16 = (value & 0xffff) >>> 0;
  state.workRam[0x3ea] = (u16 >>> 8) & 0xff;
  state.workRam[0x3eb] = u16 & 0xff;
}

describe("specialAttract (FUN_288F8)", () => {
  it("S = 0 → soundCommand(0x61) (low path)", () => {
    const s = emptyGameState();
    const calls: number[] = [];
    specialAttract(s, { soundCommand: (c) => calls.push(c) });
    expect(calls).toEqual([0x61]);
  });

  it("S = 0x0B → soundCommand(0x61) (low path, just below mid threshold)", () => {
    const s = emptyGameState();
    setStage(s, 0x0b);
    const calls: number[] = [];
    specialAttract(s, { soundCommand: (c) => calls.push(c) });
    expect(calls).toEqual([0x61]);
  });

  it("S = 0x0C → soundCommand(0x65) (mid path, exact threshold)", () => {
    const s = emptyGameState();
    setStage(s, 0x0c);
    const calls: number[] = [];
    specialAttract(s, { soundCommand: (c) => calls.push(c) });
    expect(calls).toEqual([0x65]);
  });

  it("S = 0x17 → soundCommand(0x65) (mid path, just below high threshold)", () => {
    const s = emptyGameState();
    setStage(s, 0x17);
    const calls: number[] = [];
    specialAttract(s, { soundCommand: (c) => calls.push(c) });
    expect(calls).toEqual([0x65]);
  });

  it("S = 0x18 → soundCommand(0x67) (high path, exact threshold)", () => {
    const s = emptyGameState();
    setStage(s, 0x18);
    const calls: number[] = [];
    specialAttract(s, { soundCommand: (c) => calls.push(c) });
    expect(calls).toEqual([0x67]);
  });

  it("S = 0x7FFF (max positive int16) → soundCommand(0x67)", () => {
    const s = emptyGameState();
    setStage(s, 0x7fff);
    const calls: number[] = [];
    specialAttract(s, { soundCommand: (c) => calls.push(c) });
    expect(calls).toEqual([0x67]);
  });

  it("S = -1 (signed underflow) → soundCommand(0x61) (low path, signed compare)", () => {
    const s = emptyGameState();
    // 0xFFFF read as int16 = -1, signed less than 0x0C.
    setStage(s, -1);
    const calls: number[] = [];
    specialAttract(s, { soundCommand: (c) => calls.push(c) });
    expect(calls).toEqual([0x61]);
  });

  it("S = -32768 (min int16) → soundCommand(0x61)", () => {
    const s = emptyGameState();
    setStage(s, -32768);
    const calls: number[] = [];
    specialAttract(s, { soundCommand: (c) => calls.push(c) });
    expect(calls).toEqual([0x61]);
  });

  it("subs undefined → no-op (no throw)", () => {
    const s = emptyGameState();
    setStage(s, 0x18);
    expect(() => specialAttract(s)).not.toThrow();
  });

  it("subs.soundCommand undefined → no-op (no throw)", () => {
    const s = emptyGameState();
    setStage(s, 0x18);
    expect(() => specialAttract(s, {})).not.toThrow();
  });

  it("non modifies workRam", () => {
    const s = emptyGameState();
    setStage(s, 0x18);
    const before = new Uint8Array(s.workRam);
    specialAttract(s, { soundCommand: () => {} });
    expect(s.workRam).toEqual(before);
  });

  it("una sola chiamata a soundCommand per invocation", () => {
    const s = emptyGameState();
    setStage(s, 0x10);
    const calls: number[] = [];
    specialAttract(s, { soundCommand: (c) => calls.push(c) });
    expect(calls.length).toBe(1);
  });
});
