import { describe, it, expect } from "vitest";
import { emptyGameState } from "../src/state.js";
import {
  objectAccumFlag28608,
  OBJECT_ACCUM_FLAG_28608_ADDR,
} from "../src/object-accum-flag-28608.js";

const WORK_RAM_BASE = 0x00400000;
const OBJECT_STRIDE = 0xe2;
const DIRTY_BITMAP_OFF = 0x39c;

/** Write big-endian long into a Uint8Array. */
function putLong(r: Uint8Array, off: number, v: number): void {
  const u = v >>> 0;
  r[off] = (u >>> 24) & 0xff;
  r[off + 1] = (u >>> 16) & 0xff;
  r[off + 2] = (u >>> 8) & 0xff;
  r[off + 3] = u & 0xff;
}

/** Read big-endian long from a Uint8Array. */
function getLong(r: Uint8Array, off: number): number {
  return (
    (((r[off] ?? 0) << 24) |
      ((r[off + 1] ?? 0) << 16) |
      ((r[off + 2] ?? 0) << 8) |
      (r[off + 3] ?? 0)) >>>
    0
  );
}

describe("objectAccumFlag28608 (FUN_00028608)", () => {
  it("adds value to the long accumulator at objPtr+0xBC", () => {
    const s = emptyGameState();
    const objPtr = WORK_RAM_BASE + 0x18; // slot 0
    const objOff = 0x18;
    putLong(s.workRam, objOff + 0xbc, 0x00000064); // initial accum = 100
    s.workRam[objOff + 0x19] = 0; // flagIdx = 0

    objectAccumFlag28608(s, objPtr, 200);

    expect(getLong(s.workRam, objOff + 0xbc)).toBe(300);
  });

  it("wraps accumulator on 32-bit overflow", () => {
    const s = emptyGameState();
    const objPtr = WORK_RAM_BASE + 0x18;
    const objOff = 0x18;
    putLong(s.workRam, objOff + 0xbc, 0xffffffff);
    s.workRam[objOff + 0x19] = 0;

    objectAccumFlag28608(s, objPtr, 1);

    expect(getLong(s.workRam, objOff + 0xbc)).toBe(0);
  });

  it("sets the correct bit in dirty bitmap based on flagIdx", () => {
    for (let flagIdx = 0; flagIdx < 8; flagIdx++) {
      const s = emptyGameState();
      const objPtr = WORK_RAM_BASE + 0x18;
      const objOff = 0x18;
      s.workRam[objOff + 0x19] = flagIdx;

      objectAccumFlag28608(s, objPtr, 0);

      expect(s.workRam[DIRTY_BITMAP_OFF] & (1 << flagIdx)).not.toBe(0);
    }
  });

  it("ORs (does not clear) existing bits in the dirty bitmap", () => {
    const s = emptyGameState();
    const objPtr = WORK_RAM_BASE + 0x18;
    const objOff = 0x18;
    s.workRam[DIRTY_BITMAP_OFF] = 0b00000001; // bit 0 already set
    s.workRam[objOff + 0x19] = 2; // set bit 2

    objectAccumFlag28608(s, objPtr, 0);

    // both bit 0 and bit 2 should be set
    expect(s.workRam[DIRTY_BITMAP_OFF]).toBe(0b00000101);
  });

  it("works with second object slot (objPtr = 0x400018 + 1*0xE2)", () => {
    const s = emptyGameState();
    const objPtr = WORK_RAM_BASE + 0x18 + OBJECT_STRIDE;
    const objOff = 0x18 + OBJECT_STRIDE;
    putLong(s.workRam, objOff + 0xbc, 0x000003e8); // 1000
    s.workRam[objOff + 0x19] = 1; // flagIdx = 1

    objectAccumFlag28608(s, objPtr, 9000);

    expect(getLong(s.workRam, objOff + 0xbc)).toBe(10000);
    expect(s.workRam[DIRTY_BITMAP_OFF] & 0x02).toBe(0x02);
  });

  it("adding zero still sets the dirty flag bit", () => {
    const s = emptyGameState();
    const objPtr = WORK_RAM_BASE + 0x18;
    const objOff = 0x18;
    putLong(s.workRam, objOff + 0xbc, 0x1234abcd);
    s.workRam[objOff + 0x19] = 3;

    objectAccumFlag28608(s, objPtr, 0);

    expect(getLong(s.workRam, objOff + 0xbc)).toBe(0x1234abcd);
    expect(s.workRam[DIRTY_BITMAP_OFF] & 0x08).toBe(0x08);
  });

  it("adding negative value decrements accumulator", () => {
    const s = emptyGameState();
    const objPtr = WORK_RAM_BASE + 0x18;
    const objOff = 0x18;
    putLong(s.workRam, objOff + 0xbc, 1000);
    s.workRam[objOff + 0x19] = 0;

    objectAccumFlag28608(s, objPtr, -100);

    expect(getLong(s.workRam, objOff + 0xbc)).toBe(900);
  });

  it("does not modify any memory outside workRam[0x39C] and objOff+0xBC..0xBF", () => {
    const s = emptyGameState();
    const objPtr = WORK_RAM_BASE + 0x18;
    const objOff = 0x18;
    s.workRam.fill(0x42);
    s.workRam[objOff + 0x19] = 0;
    putLong(s.workRam, objOff + 0xbc, 0);
    s.workRam[DIRTY_BITMAP_OFF] = 0;

    objectAccumFlag28608(s, objPtr, 7);

    // Check accum written
    expect(getLong(s.workRam, objOff + 0xbc)).toBe(7);
    // Check bitmap bit set
    expect(s.workRam[DIRTY_BITMAP_OFF]).toBe(0x01);
    // Check a sample of unrelated bytes unchanged
    expect(s.workRam[0x00]).toBe(0x42);
    expect(s.workRam[0x100]).toBe(0x42);
  });

  it("exports OBJECT_ACCUM_FLAG_28608_ADDR constant", () => {
    expect(OBJECT_ACCUM_FLAG_28608_ADDR).toBe(0x00028608);
  });
});
