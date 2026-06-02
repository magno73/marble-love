/**
 * Test palette command queue (FUN_26B66 push, FUN_26B88 drain, FUN_26D4E sched3).
 *
 * Bit-perfect verified against the binary (1500/1500 total) through
 * `cli/src/test-palette-queue-parity.ts`.
 */

import { describe, it, expect } from "vitest";
import {
  paletteQueuePush,
  paletteAnim3Tick,
  PAL_QUEUE_PTR_ADDR,
  PAL_QUEUE_HEAD,
  PAL_QUEUE_TAIL,
  SCHED3_LOW_CTR,
  SCHED3_HIGH_CTR,
} from "../src/palette-queue.js";
import { emptyGameState } from "../src/state.js";

function readU32BE(buf: Uint8Array, off: number): number {
  return (
    ((buf[off] ?? 0) << 24) |
    ((buf[off + 1] ?? 0) << 16) |
    ((buf[off + 2] ?? 0) << 8) |
    (buf[off + 3] ?? 0)
  ) >>> 0;
}

function writeU32BE(buf: Uint8Array, off: number, v: number): void {
  buf[off] = (v >>> 24) & 0xff;
  buf[off + 1] = (v >>> 16) & 0xff;
  buf[off + 2] = (v >>> 8) & 0xff;
  buf[off + 3] = v & 0xff;
}

const PTR_OFF = PAL_QUEUE_PTR_ADDR - 0x400000;

describe("paletteQueuePush", () => {
  it("push to empty queue: head + 1", () => {
    const s = emptyGameState();
    writeU32BE(s.workRam, PTR_OFF, PAL_QUEUE_HEAD);
    paletteQueuePush(s, 0xAB);
    expect(s.workRam[0x40c]).toBe(0xAB);
    expect(readU32BE(s.workRam, PTR_OFF)).toBe(PAL_QUEUE_HEAD + 1);
  });

  it("push fills slots in order", () => {
    const s = emptyGameState();
    writeU32BE(s.workRam, PTR_OFF, PAL_QUEUE_HEAD);
    paletteQueuePush(s, 0x10);
    paletteQueuePush(s, 0x20);
    paletteQueuePush(s, 0x30);
    expect(s.workRam[0x40c]).toBe(0x10);
    expect(s.workRam[0x40d]).toBe(0x20);
    expect(s.workRam[0x40e]).toBe(0x30);
    expect(readU32BE(s.workRam, PTR_OFF)).toBe(PAL_QUEUE_HEAD + 3);
  });

  it("clamp at tail (4th push)", () => {
    const s = emptyGameState();
    writeU32BE(s.workRam, PTR_OFF, PAL_QUEUE_HEAD);
    paletteQueuePush(s, 1);
    paletteQueuePush(s, 2);
    paletteQueuePush(s, 3);
    paletteQueuePush(s, 4);
    expect(readU32BE(s.workRam, PTR_OFF)).toBe(PAL_QUEUE_TAIL);
    paletteQueuePush(s, 5);
    // 5th push: writes at TAIL (overwriting 4), ptr stays at TAIL
    expect(s.workRam[0x40f]).toBe(5);
    expect(readU32BE(s.workRam, PTR_OFF)).toBe(PAL_QUEUE_TAIL);
  });
});

describe("paletteAnim3Tick (FUN_26D4E scheduler)", () => {
  it("low ctr negative (signed): no-op", () => {
    const s = emptyGameState();
    s.workRam[SCHED3_LOW_CTR - 0x400000] = 0xFF; // signed -1
    s.workRam[SCHED3_HIGH_CTR - 0x400000] = 0x05;
    paletteAnim3Tick(s);
    expect(s.workRam[SCHED3_LOW_CTR - 0x400000]).toBe(0xFF);
    expect(s.workRam[SCHED3_HIGH_CTR - 0x400000]).toBe(0x05);
  });

  it("low ctr 0..5: increment without rollover", () => {
    const s = emptyGameState();
    s.workRam[SCHED3_LOW_CTR - 0x400000] = 3;
    paletteAnim3Tick(s);
    expect(s.workRam[SCHED3_LOW_CTR - 0x400000]).toBe(4);
  });

  it("low ctr = 6: increment to 7, then check (7 > 6 signed) → reset + push", () => {
    const s = emptyGameState();
    writeU32BE(s.workRam, PTR_OFF, PAL_QUEUE_HEAD);
    s.workRam[SCHED3_LOW_CTR - 0x400000] = 6;
    s.workRam[SCHED3_HIGH_CTR - 0x400000] = 0;
    paletteAnim3Tick(s);
    // low reset to 0, high incremented to 1
    expect(s.workRam[SCHED3_LOW_CTR - 0x400000]).toBe(0);
    expect(s.workRam[SCHED3_HIGH_CTR - 0x400000]).toBe(1);
    // queue should have one byte: 1 + 12 = 13
    expect(s.workRam[0x40c]).toBe(13);
    expect(readU32BE(s.workRam, PTR_OFF)).toBe(PAL_QUEUE_HEAD + 1);
  });

  it("high ctr wrap at 5 → 0", () => {
    const s = emptyGameState();
    writeU32BE(s.workRam, PTR_OFF, PAL_QUEUE_HEAD);
    s.workRam[SCHED3_LOW_CTR - 0x400000] = 6;  // about to overflow
    s.workRam[SCHED3_HIGH_CTR - 0x400000] = 5; // about to overflow when incremented
    paletteAnim3Tick(s);
    expect(s.workRam[SCHED3_HIGH_CTR - 0x400000]).toBe(0); // wrapped
    expect(s.workRam[0x40c]).toBe(12); // 0 + 12
  });
});
