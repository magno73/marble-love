/**
 * flag-scaled-magnitude-dispatch.test.ts — corner cases of
 * `flagScaledMagnitudeDispatch` (FUN_26196).
 *
 * Bit-perfect parity vs binary in `test-flag-scaled-magnitude-dispatch-parity.ts`.
 */

import { describe, it, expect } from "vitest";
import {
  flagScaledMagnitudeDispatch,
  selectMagnitude,
  MAGNITUDE_FLAG_CLEAR,
  MAGNITUDE_FLAG_SET,
} from "../src/flag-scaled-magnitude-dispatch.js";
import { emptyGameState } from "../src/state.js";

describe("flagScaledMagnitudeDispatch (FUN_26196)", () => {
  it("flag byte == 0 → magnitude 0x40000 passed to inner", () => {
    const s = emptyGameState();
    const ptr = 0x401f44;
    s.workRam[(ptr - 0x400000) + 0x1a] = 0x00;
    let captured: { ptr: number; mag: number } | null = null;
    const r = flagScaledMagnitudeDispatch(s, ptr, (p, m) => {
      captured = { ptr: p, mag: m };
      return 0xdeadbeef;
    });
    expect(captured).not.toBeNull();
    expect(captured!.ptr).toBe(ptr);
    expect(captured!.mag).toBe(0x40000);
    expect(r).toBe(0xdeadbeef);
  });

  it("flag byte == 0x01 → magnitude 0x50000 passed to inner", () => {
    const s = emptyGameState();
    const ptr = 0x401f44;
    s.workRam[(ptr - 0x400000) + 0x1a] = 0x01;
    let captured: { ptr: number; mag: number } | null = null;
    const r = flagScaledMagnitudeDispatch(s, ptr, (p, m) => {
      captured = { ptr: p, mag: m };
      return 0x12345678;
    });
    expect(captured!.mag).toBe(0x50000);
    expect(r).toBe(0x12345678);
  });

  it("flag byte == 0xFF (any non-zero) → magnitude 0x50000", () => {
    const s = emptyGameState();
    const ptr = 0x401e00;
    s.workRam[(ptr - 0x400000) + 0x1a] = 0xff;
    let mag = -1;
    flagScaledMagnitudeDispatch(s, ptr, (_p, m) => {
      mag = m;
      return 0;
    });
    expect(mag).toBe(MAGNITUDE_FLAG_SET);
  });

  it("flag byte == 0x80 (high bit set) → magnitude 0x50000 (only zero/non-zero counts)", () => {
    const s = emptyGameState();
    const ptr = 0x401080;
    s.workRam[(ptr - 0x400000) + 0x1a] = 0x80;
    let mag = -1;
    flagScaledMagnitudeDispatch(s, ptr, (_p, m) => {
      mag = m;
      return 0;
    });
    expect(mag).toBe(MAGNITUDE_FLAG_SET);
  });

  it("returns exactly what inner returns (long unsigned)", () => {
    const s = emptyGameState();
    const ptr = 0x401f44;
    expect(
      flagScaledMagnitudeDispatch(s, ptr, () => 0xffffffff),
    ).toBe(0xffffffff);
    expect(
      flagScaledMagnitudeDispatch(s, ptr, () => 0),
    ).toBe(0);
  });

  it("flagByteOverride bypasses the read from workRam", () => {
    const s = emptyGameState();
    const ptr = 0x401f44;
    // workRam says "0", but override forces non-zero -> large magnitude
    s.workRam[(ptr - 0x400000) + 0x1a] = 0x00;
    let mag = -1;
    flagScaledMagnitudeDispatch(
      s,
      ptr,
      (_p, m) => {
        mag = m;
        return 0;
      },
      0x42,
    );
    expect(mag).toBe(0x50000);

    // vice versa: override 0 even if workRam !=0 -> small magnitude.
    s.workRam[(ptr - 0x400000) + 0x1a] = 0xab;
    flagScaledMagnitudeDispatch(
      s,
      ptr,
      (_p, m) => {
        mag = m;
        return 0;
      },
      0x00,
    );
    expect(mag).toBe(0x40000);
  });

  it("structPtr passed verbatim to inner (no offset)", () => {
    const s = emptyGameState();
    const ptr = 0x401abc;
    let seen = -1;
    flagScaledMagnitudeDispatch(s, ptr, (p, _m) => {
      seen = p;
      return 0;
    });
    expect(seen >>> 0).toBe(ptr >>> 0);
  });

  it("selectMagnitude: 0 → 0x40000, !=0 → 0x50000", () => {
    expect(selectMagnitude(0x00)).toBe(MAGNITUDE_FLAG_CLEAR);
    expect(selectMagnitude(0x01)).toBe(MAGNITUDE_FLAG_SET);
    expect(selectMagnitude(0xff)).toBe(MAGNITUDE_FLAG_SET);
    // Only the low 8 bits count (mask & 0xFF):
    expect(selectMagnitude(0x100)).toBe(MAGNITUDE_FLAG_CLEAR);
    expect(selectMagnitude(0x1ff)).toBe(MAGNITUDE_FLAG_SET);
  });

  it("exposed constants have the right values", () => {
    expect(MAGNITUDE_FLAG_CLEAR).toBe(0x40000);
    expect(MAGNITUDE_FLAG_SET).toBe(0x50000);
  });
});
