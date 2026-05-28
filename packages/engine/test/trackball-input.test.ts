/**
 * Test trackballInputTick (FUN_1AC18).
 *
 * Bit-perfect verified against the binary (2000/2000) through
 * `cli/src/test-trackball-input-parity.ts`.
 */

import { describe, it, expect } from "vitest";
import {
  trackballInputTick,
  OBJ_BASE_ADDR,
  OBJ_STRIDE,
  OBJ_FIELD_TRACKBALL_X,
  OBJ_FIELD_DELTA_X,
  OBJ_FIELD_TRACKBALL_Y,
  OBJ_FIELD_DELTA_Y,
} from "../src/trackball-input.js";
import { emptyGameState } from "../src/state.js";

describe("trackballInputTick (FUN_1AC18)", () => {
  function setup(opts: {
    obj0: { trackballX: number; deltaX: number; trackballY: number; deltaY: number };
    obj1?: { trackballX: number; deltaX: number; trackballY: number; deltaY: number };
  }) {
    const s = emptyGameState();
    const baseOff = OBJ_BASE_ADDR - 0x400000;
    s.workRam[baseOff + OBJ_FIELD_TRACKBALL_X] = opts.obj0.trackballX;
    s.workRam[baseOff + OBJ_FIELD_DELTA_X] = opts.obj0.deltaX;
    s.workRam[baseOff + OBJ_FIELD_TRACKBALL_Y] = opts.obj0.trackballY;
    s.workRam[baseOff + OBJ_FIELD_DELTA_Y] = opts.obj0.deltaY;
    if (opts.obj1) {
      const off1 = baseOff + OBJ_STRIDE;
      s.workRam[off1 + OBJ_FIELD_TRACKBALL_X] = opts.obj1.trackballX;
      s.workRam[off1 + OBJ_FIELD_DELTA_X] = opts.obj1.deltaX;
      s.workRam[off1 + OBJ_FIELD_TRACKBALL_Y] = opts.obj1.trackballY;
      s.workRam[off1 + OBJ_FIELD_DELTA_Y] = opts.obj1.deltaY;
    }
    return s;
  }
  function readObj(s: ReturnType<typeof setup>, p: number) {
    const off = (OBJ_BASE_ADDR - 0x400000) + p * OBJ_STRIDE;
    return {
      trackballX: s.workRam[off + OBJ_FIELD_TRACKBALL_X] ?? 0,
      deltaX: s.workRam[off + OBJ_FIELD_DELTA_X] ?? 0,
      trackballY: s.workRam[off + OBJ_FIELD_TRACKBALL_Y] ?? 0,
      deltaY: s.workRam[off + OBJ_FIELD_DELTA_Y] ?? 0,
    };
  }

  it("delta normale: cur=110, prev=100 → delta=10, save cur", () => {
    const s = setup({ obj0: { trackballX: 100, deltaX: 0, trackballY: 50, deltaY: 0 } });
    trackballInputTick(s, 110, 60, 0, 0);
    const o = readObj(s, 0);
    expect(o.trackballX).toBe(110);
    expect(o.deltaX).toBe(10);
    expect(o.trackballY).toBe(60);
    expect(o.deltaY).toBe(10);
  });

  it("delta out of range, sign DIFF da prev → saturate", () => {
    // prev_delta=100, cur=200, prev_X=50 → delta = 200-50 = 150 = -106 i8.
    // |delta|=106 > 96 → out of range. XOR(prev_delta=100, delta=-106) → 0x64 ^ 0x96 = 0xF2 = -14 i8 < 0 → SATURATE.
    // delta < 0 → saturate to 0x7F.
    const s = setup({ obj0: { trackballX: 50, deltaX: 100, trackballY: 0, deltaY: 0 } });
    trackballInputTick(s, 200, 0, 0, 0);
    const o = readObj(s, 0);
    expect(o.trackballX).toBe(200);
    expect(o.deltaX).toBe(0x7f); // saturated
  });

  it("delta out of range, sign UGUALE a prev → keep delta", () => {
    // prev_delta=100 (positive), cur=200, prev_X=80 → delta = 200-80 = 120, signed = 120.
    // |delta|=120 > 96 → out of range. XOR(100, 120) = 0x64 ^ 0x78 = 0x1C = +28 i8 >= 0 → SAME sign → keep.
    const s = setup({ obj0: { trackballX: 80, deltaX: 100, trackballY: 0, deltaY: 0 } });
    trackballInputTick(s, 200, 0, 0, 0);
    const o = readObj(s, 0);
    expect(o.trackballX).toBe(200);
    expect(o.deltaX).toBe(120);
  });

  it("processa entrambi P1 e P2 (slot 0 e 1)", () => {
    const s = setup({
      obj0: { trackballX: 0, deltaX: 0, trackballY: 0, deltaY: 0 },
      obj1: { trackballX: 50, deltaX: 0, trackballY: 100, deltaY: 0 },
    });
    trackballInputTick(s, 10, 20, 60, 110);
    const o0 = readObj(s, 0);
    const o1 = readObj(s, 1);
    expect(o0.trackballX).toBe(10); expect(o0.deltaX).toBe(10);
    expect(o0.trackballY).toBe(20); expect(o0.deltaY).toBe(20);
    expect(o1.trackballX).toBe(60); expect(o1.deltaX).toBe(10);
    expect(o1.trackballY).toBe(110); expect(o1.deltaY).toBe(10);
  });

  it("delta zero: stessi valori MMIO", () => {
    const s = setup({ obj0: { trackballX: 100, deltaX: 50, trackballY: 100, deltaY: 50 } });
    trackballInputTick(s, 100, 100, 0, 0);
    const o = readObj(s, 0);
    expect(o.deltaX).toBe(0); // same → delta 0
    expect(o.deltaY).toBe(0);
    expect(o.trackballX).toBe(100);
  });
});
