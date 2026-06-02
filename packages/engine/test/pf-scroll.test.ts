/**
 * pf-scroll.test.ts — smoke + corner case of pfScrollUpdate.
 *
 */

import { describe, it, expect } from "vitest";
import { pfScrollUpdate } from "../src/pf-scroll.js";
import { emptyGameState } from "../src/state.js";

function readU16(buf: Uint8Array, off: number): number {
  return ((buf[off] ?? 0) << 8) | (buf[off + 1] ?? 0);
}
function writeU16(buf: Uint8Array, off: number, v: number): void {
  buf[off] = (v >>> 8) & 0xff;
  buf[off + 1] = v & 0xff;
}

describe("pfScrollUpdate", () => {
  it("does not throw exceptions with empty state", () => {
    const s = emptyGameState();
    expect(() => pfScrollUpdate(s)).not.toThrow();
  });

  it("speed=0 → scroll Y unchanged, line offset 0", () => {
    const s = emptyGameState();
    s.workRam[0x0A] = 0;
    writeU16(s.workRam, 0x02, 0x1234);
    pfScrollUpdate(s);
    expect(readU16(s.workRam, 0x02)).toBe(0x1234);
  });

  it("speed=4 (signed >>1 = 2) → scroll Y += 2", () => {
    const s = emptyGameState();
    s.workRam[0x0A] = 4;
    writeU16(s.workRam, 0x02, 0x1000);
    writeU16(s.spriteRam, 0x180, 0);
    pfScrollUpdate(s);
    expect(readU16(s.workRam, 0x02)).toBe(0x1002);
  });

  it("speed=-4 (signed asr >>1 = -2) → scroll Y -= 2", () => {
    const s = emptyGameState();
    s.workRam[0x0A] = 0xfc; // -4
    writeU16(s.workRam, 0x02, 0x1000);
    writeU16(s.spriteRam, 0x180, 0);
    pfScrollUpdate(s);
    expect(readU16(s.workRam, 0x02)).toBe(0x0FFE);
  });

  it("flip flag (*0x400004 == 0xFF) inverts the sign", () => {
    const s = emptyGameState();
    s.workRam[0x0A] = 4; // → d2 = 2
    s.workRam[0x04] = 0xff; // flip
    writeU16(s.workRam, 0x02, 0x1000);
    writeU16(s.spriteRam, 0x180, 0);
    pfScrollUpdate(s);
    expect(readU16(s.workRam, 0x02)).toBe(0x0FFE); // 0x1000 + (-2)
  });

  it("rotation bit (AV & 8): changes base offsets", () => {
    const s = emptyGameState();
    s.workRam[0x0A] = 4;
    writeU16(s.workRam, 0x3AE, 0x0008); // rotation set
    // rotation set → base = 0x200 (A0), 0x380 (A1)
    writeU16(s.spriteRam, 0x380, 0); // stop iter 0
    pfScrollUpdate(s);
    // No exceptions, and scrolling moved to the second band.
    expect(readU16(s.workRam, 0x02)).toBe(0x0002); // 0 + 2
  });

  it("loop limited to 60 iters when cmp never matches", () => {
    const s = emptyGameState();
    s.workRam[0x0A] = 2; // d2 = 1
    for (let i = 0; i < 60; i++) writeU16(s.spriteRam, 0x180 + i * 2, 0xFFFF);
    expect(() => pfScrollUpdate(s)).not.toThrow();
    // (60 complete iters: indices 0..59)
    expect(readU16(s.spriteRam, 0x76)).not.toBe(0); // d2<<5 in the masked range
  });

  it("updates bits 5..13 of the tile word (scroll line bits)", () => {
    const s = emptyGameState();
    s.workRam[0x0A] = 4; // d2 = 2 → lineOffset = 2 << 5 = 0x40
    writeU16(s.spriteRam, 0x180, 0xFFFF); // does not match
    writeU16(s.spriteRam, 0x000, 0x0000);
    pfScrollUpdate(s);
    expect(readU16(s.spriteRam, 0x000)).toBe(0x0040);
  });

  it("preserves bits 0..4 and 14..15 of the tile word", () => {
    const s = emptyGameState();
    s.workRam[0x0A] = 4;
    writeU16(s.spriteRam, 0x180, 0xFFFF);
    writeU16(s.spriteRam, 0x000, 0xC01F); // bit 0..4 + 14..15 set
    pfScrollUpdate(s);
    const result = readU16(s.spriteRam, 0x000);
    expect(result & 0xC01F).toBe(0xC01F); // preserved bits
    expect(result & 0x3FE0).toBe(0x0040); // updated bits
  });
});
