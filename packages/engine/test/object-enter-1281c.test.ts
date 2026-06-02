/**
 * object-enter-1281c.test.ts — corner cases of `objectEnter1281C` (FUN_1281C).
 *
 * Bit-perfect parity validated vs binary in
 * `packages/cli/src/test-object-enter-1281c-parity.ts`.
 */

import { describe, it, expect } from "vitest";
import {
  objectEnter1281C,
  selectMode,
  RANGE_LOWER_BOUND,
  RANGE_UPPER_BOUND,
  SINGLETON_SLOT_A,
  SINGLETON_SLOT_B,
  OUT_OF_RANGE_D0,
} from "../src/object-enter-1281c.js";
import { emptyGameState } from "../src/state.js";

const WORK_RAM_BASE = 0x400000;

/** Helper: writes a signed big-endian word into workRam[off..off+1]. */
function writeWordBE(ram: Uint8Array, off: number, signed: number): void {
  const u = signed & 0xffff;
  ram[off] = (u >>> 8) & 0xff;
  ram[off + 1] = u & 0xff;
}

describe("objectEnter1281C (FUN_0001281C)", () => {
  it("range out-of-bounds (range = -16) → returns 0xFFFFFFF0, status = 0, no inner", () => {
    const s = emptyGameState();
    const structPtr = 0x00400500;
    const slotOff = structPtr - WORK_RAM_BASE;

    // Prepopulate status+0x1C with 0xAA to prove clr.b.
    s.workRam[slotOff + 0x1c] = 0xaa;
    writeWordBE(s.workRam, slotOff + 0x20, -16);

    let innerCalled = false;
    const r = objectEnter1281C(s, structPtr, () => {
      innerCalled = true;
      return 0x12345678;
    });

    expect(r >>> 0).toBe(OUT_OF_RANGE_D0 >>> 0);
    expect(s.workRam[slotOff + 0x1c]).toBe(0); // clr.b executed
    expect(innerCalled).toBe(false); // body skipped
  });

  it("range out-of-bounds (range = 256) → returns 0xFFFFFFF0", () => {
    const s = emptyGameState();
    const structPtr = 0x00400500;
    const slotOff = structPtr - WORK_RAM_BASE;
    writeWordBE(s.workRam, slotOff + 0x20, 256);

    let innerCalled = false;
    const r = objectEnter1281C(s, structPtr, () => {
      innerCalled = true;
      return 0;
    });

    expect(r >>> 0).toBe(OUT_OF_RANGE_D0 >>> 0);
    expect(innerCalled).toBe(false);
    expect(s.workRam[slotOff + 0x1c]).toBe(0);
  });

  it("range in-bounds (range = 0) per slot non-singleton → mode = 1", () => {
    const s = emptyGameState();
    const structPtr = 0x00400500; // NOT ∈ {0x400018, 0x4000FA}
    const slotOff = structPtr - WORK_RAM_BASE;
    writeWordBE(s.workRam, slotOff + 0x20, 0);

    let capturedPtr = -1;
    let capturedMode = -1;
    const r = objectEnter1281C(s, structPtr, (p, m) => {
      capturedPtr = p;
      capturedMode = m;
      return 0xcafebabe;
    });

    expect(r >>> 0).toBe(0xcafebabe);
    expect(capturedPtr >>> 0).toBe(structPtr);
    expect(capturedMode).toBe(1);
    expect(s.workRam[slotOff + 0x1c]).toBe(1); // status flagged in-range
  });

  it("range in-bounds per SINGLETON_SLOT_A (0x400018) → mode = 0", () => {
    const s = emptyGameState();
    const structPtr = SINGLETON_SLOT_A;
    const slotOff = structPtr - WORK_RAM_BASE;
    writeWordBE(s.workRam, slotOff + 0x20, 100);

    let capturedMode = -1;
    const r = objectEnter1281C(s, structPtr, (_p, m) => {
      capturedMode = m;
      return 0x42;
    });

    expect(r >>> 0).toBe(0x42);
    expect(capturedMode).toBe(0);
    expect(s.workRam[slotOff + 0x1c]).toBe(1);
  });

  it("range in-bounds per SINGLETON_SLOT_B (0x4000FA) → mode = 0", () => {
    const s = emptyGameState();
    const structPtr = SINGLETON_SLOT_B;
    const slotOff = structPtr - WORK_RAM_BASE;
    writeWordBE(s.workRam, slotOff + 0x20, -15); // lowest allowed value

    let capturedMode = -1;
    objectEnter1281C(s, structPtr, (_p, m) => {
      capturedMode = m;
      return 0;
    });

    expect(capturedMode).toBe(0);
    expect(s.workRam[slotOff + 0x1c]).toBe(1);
  });

  it("allowed extremes: range = -15 and range = 255 are in-bounds", () => {
    const s = emptyGameState();
    const structPtr = 0x00400500;
    const slotOff = structPtr - WORK_RAM_BASE;

    // -15 (RANGE_LOWER_BOUND + 1)
    writeWordBE(s.workRam, slotOff + 0x20, RANGE_LOWER_BOUND + 1);
    let called = 0;
    objectEnter1281C(s, structPtr, () => {
      called++;
      return 0;
    });
    expect(called).toBe(1);

    // 255 (RANGE_UPPER_BOUND - 1)
    writeWordBE(s.workRam, slotOff + 0x20, RANGE_UPPER_BOUND - 1);
    objectEnter1281C(s, structPtr, () => {
      called++;
      return 0;
    });
    expect(called).toBe(2);
  });

  it("rangeWordOverride bypasses the read from workRam", () => {
    const s = emptyGameState();
    const structPtr = 0x00400500;
    const slotOff = structPtr - WORK_RAM_BASE;
    // workRam says "out of range", but override forces in-range.
    writeWordBE(s.workRam, slotOff + 0x20, 1000);

    let called = 0;
    const r = objectEnter1281C(
      s,
      structPtr,
      () => {
        called++;
        return 0x99;
      },
      50, // override in-range
    );
    expect(r >>> 0).toBe(0x99);
    expect(called).toBe(1);
    expect(s.workRam[slotOff + 0x1c]).toBe(1);
  });

  it("selectMode helper: singleton vs others", () => {
    expect(selectMode(SINGLETON_SLOT_A)).toBe(0);
    expect(selectMode(SINGLETON_SLOT_B)).toBe(0);
    expect(selectMode(0x00400000)).toBe(1);
    expect(selectMode(0x00400500)).toBe(1);
    expect(selectMode(0x00401e00)).toBe(1);
  });
});
