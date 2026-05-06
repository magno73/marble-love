/**
 * vblank-wait.test.ts — smoke test di `waitVblank` (FUN_000052B8).
 *
 * Bit-perfect parity verificata vs binary in
 * `packages/cli/src/test-vblank-wait-parity.ts`.
 */

import { describe, it, expect } from "vitest";
import { waitVblank, VBLANK_COUNTER_OFF } from "../src/vblank-wait.js";
import { emptyGameState } from "../src/state.js";

describe("waitVblank (FUN_000052B8)", () => {
  it("count = 0 → ritorna 0 e non tocca workRam", () => {
    const s = emptyGameState();
    const before = new Uint8Array(s.workRam);
    const r = waitVblank(s, 0);
    expect(r).toBe(0);
    expect(s.workRam).toEqual(before);
  });

  it("count > 0 (positivo) → ritorna 0 (D0w decrementato a 0 nel loop)", () => {
    const s = emptyGameState();
    expect(waitVblank(s, 1)).toBe(0);
    expect(waitVblank(s, 5)).toBe(0);
    expect(waitVblank(s, 0x7fff)).toBe(0); // max positivo signed word
  });

  it("count < 0 (signed word) → ritorna count low word, nessun loop", () => {
    const s = emptyGameState();
    // -1 = 0xFFFF, signed → tst.w bgt non scatta
    expect(waitVblank(s, -1)).toBe(0xffff);
    // 0x8000 = -32768 (signed) → bgt non scatta → ritorna 0x8000
    expect(waitVblank(s, 0x8000)).toBe(0x8000);
    expect(waitVblank(s, -100)).toBe((-100 & 0xffff) >>> 0);
  });

  it("count viene troncato a 16 bit (D0w)", () => {
    const s = emptyGameState();
    // 0x10000 → low word = 0 → bgt non scatta → ritorna 0
    expect(waitVblank(s, 0x10000)).toBe(0);
    // 0x18000 → low word = 0x8000 (signed -32768) → ritorna 0x8000
    expect(waitVblank(s, 0x18000)).toBe(0x8000);
    // 0x10001 → low word = 0x0001 (signed +1) → loop esegue → ritorna 0
    expect(waitVblank(s, 0x10001)).toBe(0);
  });

  it("VBLANK_COUNTER_OFF è coerente con il binario (0x1FF8)", () => {
    expect(VBLANK_COUNTER_OFF).toBe(0x1ff8);
  });

  it("invariante: workRam non viene mai modificata", () => {
    const s = emptyGameState();
    // pre-fill con pattern noto
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
