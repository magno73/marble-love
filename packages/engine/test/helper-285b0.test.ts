/**
 * helper-285b0.test.ts — unit tests for `FUN_000285B0` replica.
 *
 * Covers:
 *   - Score table lookup and delegation to objectAccumFlag28608
 *   - ROM pointer table lookup and write to *(objPtr+0xD4)
 *   - Zero writes to *(objPtr+0x70) and *(objPtr+0x68)
 *   - 0xFF write to *(objPtr+0x69)
 *   - 0x01 write to *(objPtr+0xD8)
 *   - Boundary: modeByte out of normal range
 *   - Address constant
 */

import { describe, expect, it } from "vitest";
import { emptyGameState } from "../src/state.js";
import {
  helper285B0,
  HELPER_285B0_ADDR,
  HELPER_285B0_SCORE_TABLE_ADDR,
  HELPER_285B0_PTR_TABLE_ADDR,
} from "../src/helper-285b0.js";

const WORK_RAM_BASE = 0x00400000;
const OBJ_BASE = WORK_RAM_BASE + 0x18; // first object slot (0x400018)
const OBJ_OFF = 0x18; // workRam-relative offset for slot 0
const DIRTY_BITMAP_OFF = 0x39c;

// ─── Helpers ────────────────────────────────────────────────────────────────

function readLong(r: Uint8Array, off: number): number {
  return (
    (((r[off] ?? 0) << 24) |
      ((r[off + 1] ?? 0) << 16) |
      ((r[off + 2] ?? 0) << 8) |
      (r[off + 3] ?? 0)) >>>
    0
  );
}

// Known ROM score table values (mode index → expected score)
const SCORE_TABLE: readonly number[] = [
  250, 500, 750, 1000, 1500, 2000, 2500, 3000, 3500, 4000, 4500, 5000, 5500,
  6000, 0, 0, 0,
];

// Known ROM pointer table values
const PTR_TABLE: readonly number[] = [
  0x00022386, 0x00022392, 0x0002239e, 0x000223aa, 0x000223b6, 0x000223c2,
  0x000223ce, 0x000223da, 0x000223e6, 0x000223f2, 0x000223fe, 0x0002240a,
  0x00022416, 0x00022422, 0x0002242e, 0x0002243a, 0x00022446,
];

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("helper285B0 (FUN_000285B0)", () => {
  it("exports HELPER_285B0_ADDR = 0x000285B0", () => {
    expect(HELPER_285B0_ADDR).toBe(0x000285b0);
  });

  it("exports ROM table address constants", () => {
    expect(HELPER_285B0_SCORE_TABLE_ADDR).toBe(0x00023cd4);
    expect(HELPER_285B0_PTR_TABLE_ADDR).toBe(0x00023cf6);
  });

  it("writes 0x00 to objPtr+0x70, 0x68; 0xFF to objPtr+0x69; 0x01 to objPtr+0xD8 (mode 0)", () => {
    const s = emptyGameState();
    s.workRam.fill(0x42); // sentinel fill
    s.workRam[OBJ_OFF + 0x19] = 0; // flagIdx for objectAccumFlag28608
    s.workRam[DIRTY_BITMAP_OFF] = 0;

    helper285B0(s, OBJ_BASE, 0);

    expect(s.workRam[OBJ_OFF + 0x70]).toBe(0x00);
    expect(s.workRam[OBJ_OFF + 0x68]).toBe(0x00);
    expect(s.workRam[OBJ_OFF + 0x69]).toBe(0xff);
    expect(s.workRam[OBJ_OFF + 0xd8]).toBe(0x01);
  });

  it("writes ROM pointer table entry to objPtr+0xD4 for each mode", () => {
    for (let mode = 0; mode < PTR_TABLE.length; mode++) {
      const s = emptyGameState();
      s.workRam[OBJ_OFF + 0x19] = 0;

      helper285B0(s, OBJ_BASE, mode);

      const written = readLong(s.workRam, OBJ_OFF + 0xd4);
      expect(written).toBe(PTR_TABLE[mode]);
    }
  });

  it("delegates to objectAccumFlag28608 with correct score for each mode", () => {
    for (let mode = 0; mode < SCORE_TABLE.length; mode++) {
      const s = emptyGameState();
      s.workRam[OBJ_OFF + 0x19] = 0; // flagIdx = 0 → dirty bit 0

      const calls: Array<{ objPtr: number; value: number }> = [];
      helper285B0(s, OBJ_BASE, mode, undefined, {
        objectAccumFlag28608: (_st, ptr, val) => {
          calls.push({ objPtr: ptr, value: val });
        },
      });

      expect(calls).toHaveLength(1);
      expect(calls[0]?.objPtr).toBe(OBJ_BASE);
      expect(calls[0]?.value).toBe(SCORE_TABLE[mode]);
    }
  });

  it("actually accumulates score in workRam via real objectAccumFlag28608 (mode 1 → 500)", () => {
    const s = emptyGameState();
    // initialise accum at objPtr+0xBC to 0
    s.workRam[OBJ_OFF + 0xbc] = 0;
    s.workRam[OBJ_OFF + 0xbd] = 0;
    s.workRam[OBJ_OFF + 0xbe] = 0;
    s.workRam[OBJ_OFF + 0xbf] = 0;
    s.workRam[OBJ_OFF + 0x19] = 0; // flagIdx = 0

    helper285B0(s, OBJ_BASE, 1); // mode 1 → score 500

    const accum = readLong(s.workRam, OBJ_OFF + 0xbc);
    expect(accum).toBe(500);
  });

  it("uses only the low byte of modeLong for table lookup (mode 0x103 == mode 3)", () => {
    const s1 = emptyGameState();
    const s2 = emptyGameState();
    s1.workRam[OBJ_OFF + 0x19] = 0;
    s2.workRam[OBJ_OFF + 0x19] = 0;

    helper285B0(s1, OBJ_BASE, 0x03);    // pure mode 3
    helper285B0(s2, OBJ_BASE, 0x103);   // low byte 3 only

    // Both should write the same pointer and score
    expect(readLong(s1.workRam, OBJ_OFF + 0xd4)).toBe(
      readLong(s2.workRam, OBJ_OFF + 0xd4),
    );
    expect(readLong(s1.workRam, OBJ_OFF + 0xbc)).toBe(
      readLong(s2.workRam, OBJ_OFF + 0xbc),
    );
  });

  it("uses second object slot (objPtr = 0x400018 + 0xE2)", () => {
    const OBJ_STRIDE = 0xe2;
    const objPtr1 = OBJ_BASE + OBJ_STRIDE;
    const objOff1 = OBJ_OFF + OBJ_STRIDE;

    const s = emptyGameState();
    s.workRam[objOff1 + 0x19] = 1; // flagIdx = 1

    helper285B0(s, objPtr1, 5); // mode 5 → score 2000, ptr 0x000223C2

    expect(readLong(s.workRam, objOff1 + 0xd4)).toBe(0x000223c2);
    expect(s.workRam[objOff1 + 0x70]).toBe(0x00);
    expect(s.workRam[objOff1 + 0x68]).toBe(0x00);
    expect(s.workRam[objOff1 + 0x69]).toBe(0xff);
    expect(s.workRam[objOff1 + 0xd8]).toBe(0x01);
  });

  it("mode 13 (max valid) → score 6000, ptr 0x00022422", () => {
    const s = emptyGameState();
    s.workRam[OBJ_OFF + 0x19] = 0;

    helper285B0(s, OBJ_BASE, 13);

    expect(readLong(s.workRam, OBJ_OFF + 0xd4)).toBe(0x00022422);
    // accum should be 6000
    expect(readLong(s.workRam, OBJ_OFF + 0xbc)).toBe(6000);
  });

  it("mode 14..16 → score 0 (no accum change), ptr from table", () => {
    for (const mode of [14, 15, 16]) {
      const s = emptyGameState();
      s.workRam[OBJ_OFF + 0x19] = 0;
      // accum pre-filled to 0x1000
      s.workRam[OBJ_OFF + 0xbc] = 0;
      s.workRam[OBJ_OFF + 0xbd] = 0;
      s.workRam[OBJ_OFF + 0xbe] = 0x10;
      s.workRam[OBJ_OFF + 0xbf] = 0x00;

      helper285B0(s, OBJ_BASE, mode);

      // score = 0 → accum unchanged
      expect(readLong(s.workRam, OBJ_OFF + 0xbc)).toBe(0x1000);
      expect(readLong(s.workRam, OBJ_OFF + 0xd4)).toBe(PTR_TABLE[mode]);
    }
  });

  it("does not mutate workRam outside expected offsets (mode 0, flagIdx 0)", () => {
    const SENTINEL = 0x5a;
    const s = emptyGameState();
    s.workRam.fill(SENTINEL);
    // Clear only the fields we expect to be written
    s.workRam[OBJ_OFF + 0x19] = 0; // flagIdx
    s.workRam[DIRTY_BITMAP_OFF] = 0;
    s.workRam[OBJ_OFF + 0xbc] = 0; // accum (4 bytes)
    s.workRam[OBJ_OFF + 0xbd] = 0;
    s.workRam[OBJ_OFF + 0xbe] = 0;
    s.workRam[OBJ_OFF + 0xbf] = 0;

    helper285B0(s, OBJ_BASE, 0);

    // Verify expected writes happened
    expect(readLong(s.workRam, OBJ_OFF + 0xbc)).toBe(250); // score mode 0
    expect(readLong(s.workRam, OBJ_OFF + 0xd4)).toBe(0x00022386); // ptr mode 0
    expect(s.workRam[OBJ_OFF + 0x70]).toBe(0x00);
    expect(s.workRam[OBJ_OFF + 0x68]).toBe(0x00);
    expect(s.workRam[OBJ_OFF + 0x69]).toBe(0xff);
    expect(s.workRam[OBJ_OFF + 0xd8]).toBe(0x01);
    // Dirty bitmap bit 0 set by objectAccumFlag28608
    expect(s.workRam[DIRTY_BITMAP_OFF]).toBe(0x01);

    // A sample of bytes that should be untouched
    expect(s.workRam[0x00]).toBe(SENTINEL);
    expect(s.workRam[OBJ_OFF + 0x17]).toBe(SENTINEL);
    expect(s.workRam[OBJ_OFF + 0x67]).toBe(SENTINEL);
    expect(s.workRam[OBJ_OFF + 0x6a]).toBe(SENTINEL);
    expect(s.workRam[OBJ_OFF + 0xd9]).toBe(SENTINEL);
  });
});
