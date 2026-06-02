/**
 * vblank-wait.test.ts — smoke test of `waitVblank` (FUN_000052B8).
 *
 * `packages/cli/src/test-vblank-wait-parity.ts`.
 */

import { describe, it, expect } from "vitest";
import { waitVblank, VBLANK_COUNTER_OFF } from "../src/vblank-wait.js";
import { emptyGameState } from "../src/state.js";

describe("waitVblank (FUN_000052B8)", () => {
  it("count = 0 → returns 0 and non tocca workRam", () => {
    const s = emptyGameState();
    const before = new Uint8Array(s.workRam);
    const r = waitVblank(s, 0);
    expect(r).toBe(0);
    expect(s.workRam).toEqual(before);
  });

  it("count > 0 (positivo) → returns 0 (D0w decrementato a 0 in the loop)", () => {
    const s = emptyGameState();
    expect(waitVblank(s, 1)).toBe(0);
    expect(waitVblank(s, 5)).toBe(0);
    expect(waitVblank(s, 0x7fff)).toBe(0); // max positivo signed word
  });

  it("count < 0 (signed word) → returns count low word, no loop", () => {
    const s = emptyGameState();
    // -1 = 0xFFFF, signed → tst.w bgt non scatta
    expect(waitVblank(s, -1)).toBe(0xffff);
    expect(waitVblank(s, 0x8000)).toBe(0x8000);
    expect(waitVblank(s, -100)).toBe((-100 & 0xffff) >>> 0);
  });

  it("count is troncato a 16 bit (D0w)", () => {
    const s = emptyGameState();
    expect(waitVblank(s, 0x10000)).toBe(0);
    expect(waitVblank(s, 0x18000)).toBe(0x8000);
    expect(waitVblank(s, 0x10001)).toBe(0);
  });

  it("VBLANK_COUNTER_OFF is coerente con il binario (0x1FF8)", () => {
    expect(VBLANK_COUNTER_OFF).toBe(0x1ff8);
  });

  it("invariante: workRam non is mai modified", () => {
    const s = emptyGameState();
    // pre-fill with a known pattern.
    for (let i = 0; i < s.workRam.length; i++) {
      s.workRam[i] = (i * 7 + 3) & 0xff;
    }
    const before = new Uint8Array(s.workRam);
    waitVblank(s, 0);
    waitVblank(s, 10);
    waitVblank(s, -50);
    waitVblank(s, 0x12345);
    expect(s.workRam).toEqual(before);
  });
});
