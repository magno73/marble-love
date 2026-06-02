/**
 * sprite-coords-jsr-150d0.test.ts — smoke + corner case of FUN_000150D0.
 */

import { describe, it, expect } from "vitest";
import {
  spriteCoordsJsr150D0,
  INNER_MODE,
  type Inner264AA,
} from "../src/sprite-coords-jsr-150d0.js";
import { emptyGameState } from "../src/state.js";

const POS_X_OFF = 0x690;
const POS_Y_OFF = 0x692;
const HUD_OFFSET_OFF = 0x97e;

function readU16(s: ReturnType<typeof emptyGameState>, off: number): number {
  return ((s.workRam[off] ?? 0) << 8) | (s.workRam[off + 1] ?? 0);
}
function readU32(s: ReturnType<typeof emptyGameState>, off: number): number {
  return (
    (((s.workRam[off] ?? 0) << 24) |
      ((s.workRam[off + 1] ?? 0) << 16) |
      ((s.workRam[off + 2] ?? 0) << 8) |
      (s.workRam[off + 3] ?? 0)) >>>
    0
  );
}
function writeU16(
  s: ReturnType<typeof emptyGameState>,
  off: number,
  v: number,
): void {
  s.workRam[off] = (v >>> 8) & 0xff;
  s.workRam[off + 1] = v & 0xff;
}

describe("spriteCoordsJsr150D0 (FUN_000150D0)", () => {
  it("writes POS_X/POS_Y globals + packed long @ struct+0x28 and calls inner(structPtr, 2)", () => {
    const s = emptyGameState();
    const STRUCT = 0x00401000;
    const off = STRUCT - 0x400000;

    // HUD_OFFSET = 0
    writeU16(s, HUD_OFFSET_OFF, 0);

    // w0 = 0x10, w2 = 0x20, w4 = 0x30
    writeU16(s, off + 0xc, 0x0010);
    writeU16(s, off + 0x10, 0x0020);
    writeU16(s, off + 0x14, 0x0030);

    // D3w = w2 - w0 + 0x88 = 0x20 - 0x10 + 0x88 = 0x98
    // avg = (0x20 + 0x10) >> 1 = 0x18
    // D2w = 0 + 0x30 + 0x54 - 0x18 = 0x6C
    // packed = (0x98 << 16) | 0x6C = 0x0098_006C
    let captured: { ptr: number; mode: number } | null = null;
    const inner: Inner264AA = (ptr, mode) => {
      captured = { ptr, mode };
      return 0xdeadbeef;
    };
    const ret = spriteCoordsJsr150D0(s, STRUCT, { inner264AA: inner });

    expect(ret).toBe(0xdeadbeef);
    expect(captured).not.toBeNull();
    expect(captured!.ptr).toBe(STRUCT);
    expect(captured!.mode).toBe(INNER_MODE);
    expect(INNER_MODE).toBe(2);

    expect(readU16(s, POS_X_OFF)).toBe(0x0010);
    expect(readU16(s, POS_Y_OFF)).toBe(0x0020);
    expect(readU32(s, off + 0x28)).toBe(0x0098006c);
  });

  it("handles overflow word su D3w (yMinusX) as signed << 16 in the packed", () => {
    const s = emptyGameState();
    const STRUCT = 0x00401000;
    const off = STRUCT - 0x400000;

    writeU16(s, HUD_OFFSET_OFF, 0);

    // w0 = 0x8000 (-32768), w2 = 0x0000 (0)
    // D3w = (0 - 0x8000 + 0x88) & 0xFFFF = (-0x8000 + 0x88) & 0xFFFF = 0x8088
    // signed → 0x8088 - 0x10000 = -32632
    // packed.high = (-32632) << 16 = 0x80880000 (unsigned)
    // avg = (0 + (-0x8000)) >> 1 = -0x4000
    // w4 = 0
    // D2w = 0 + 0 + 0x54 - (-0x4000 & 0xFFFF) = 0x54 - 0xC000 = 0x4054
    writeU16(s, off + 0xc, 0x8000);
    writeU16(s, off + 0x10, 0x0000);
    writeU16(s, off + 0x14, 0x0000);

    const inner: Inner264AA = () => 0x12345678;
    spriteCoordsJsr150D0(s, STRUCT, { inner264AA: inner });

    expect(readU32(s, off + 0x28)).toBe(0x80884054);
  });

  it("uses HUD_OFFSET globale @ 0x40097E in the calcolo of D2w", () => {
    const s = emptyGameState();
    const STRUCT = 0x00401000;
    const off = STRUCT - 0x400000;

    // HUD_OFFSET = 0x100
    writeU16(s, HUD_OFFSET_OFF, 0x0100);

    // w0=0, w2=0, w4=0
    writeU16(s, off + 0xc, 0);
    writeU16(s, off + 0x10, 0);
    writeU16(s, off + 0x14, 0);

    // D3w = 0 + 0x88 = 0x88 → packed.high = 0x00880000
    // avg = 0 → D2w = 0x100 + 0 + 0x54 - 0 = 0x154
    // packed = 0x0088_0154
    const inner: Inner264AA = () => 0;
    spriteCoordsJsr150D0(s, STRUCT, { inner264AA: inner });

    expect(readU32(s, off + 0x28)).toBe(0x00880154);
    expect(readU16(s, POS_X_OFF)).toBe(0);
    expect(readU16(s, POS_Y_OFF)).toBe(0);
  });

  it("returns verbatim il D0 of the callback inner264AA (non lo modifies)", () => {
    const s = emptyGameState();
    const STRUCT = 0x004015c0;
    const off = STRUCT - 0x400000;

    writeU16(s, HUD_OFFSET_OFF, 0x0042);
    writeU16(s, off + 0xc, 0xabcd);
    writeU16(s, off + 0x10, 0xdcba);
    writeU16(s, off + 0x14, 0x1234);

    const sentinels = [0, 1, 0xfffffff0, 0xcafebabe, 0xffffffff];
    for (const sentinel of sentinels) {
      const inner: Inner264AA = () => sentinel;
      const ret = spriteCoordsJsr150D0(s, STRUCT, { inner264AA: inner });
      expect(ret >>> 0).toBe(sentinel >>> 0);
    }
  });

  it("la callback receives exactly (structPtr, 2) — mode hard-coded", () => {
    const s = emptyGameState();
    const STRUCT_LIST = [0x00400018, 0x004000fa, 0x00400500, 0x00401e00];
    for (const STRUCT of STRUCT_LIST) {
      let captured: { ptr: number; mode: number } | null = null;
      const inner: Inner264AA = (p, m) => {
        captured = { ptr: p, mode: m };
        return 0;
      };
      spriteCoordsJsr150D0(s, STRUCT, { inner264AA: inner });
      expect(captured).not.toBeNull();
      expect(captured!.ptr).toBe(STRUCT);
      expect(captured!.mode).toBe(2);
    }
  });
});
