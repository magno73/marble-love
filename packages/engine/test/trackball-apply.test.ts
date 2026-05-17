import { describe, expect, it } from "vitest";
import { emptyGameState } from "../src/state.js";
import { sanitizeProjectedTerrainDeltas, trackballApplyDelta } from "../src/trackball-apply.js";

function writeWordBE(ram: Uint8Array, off: number, val: number): void {
  ram[off] = (val >>> 8) & 0xff;
  ram[off + 1] = val & 0xff;
}

function writeLongBE(ram: Uint8Array, off: number, val: number): void {
  const u = val >>> 0;
  ram[off] = (u >>> 24) & 0xff;
  ram[off + 1] = (u >>> 16) & 0xff;
  ram[off + 2] = (u >>> 8) & 0xff;
  ram[off + 3] = u & 0xff;
}

function readLongBE(ram: Uint8Array, off: number): number {
  return (
    (((ram[off] ?? 0) << 24) |
      ((ram[off + 1] ?? 0) << 16) |
      ((ram[off + 2] ?? 0) << 8) |
      (ram[off + 3] ?? 0)) >>>
    0
  );
}

describe("trackballApplyDelta", () => {
  it("ignores projected terrain deltas that use a zero sentinel endpoint", () => {
    const state = emptyGameState();
    const r = state.workRam;
    const objOff = 0x18;

    writeLongBE(r, objOff + 0x00, Math.round(0.15 * 0x10000));
    writeLongBE(r, objOff + 0x04, Math.round(0.61 * 0x10000));

    writeWordBE(r, 0x1c28 + 0x04, 16320); // cx0
    writeWordBE(r, 0x1c28 + 0x0e, 0); // cx1: out-of-terrain sentinel
    writeWordBE(r, 0x1c28 + 0x10, 16320); // cy0
    writeWordBE(r, 0x1c28 + 0x1a, 16320); // cz
    writeWordBE(r, 0x6a2, 1); // bge path: x delta = cx1 - cx0
    writeWordBE(r, 0x6a4, 0xc040); // -16320, the raw sentinel delta
    writeWordBE(r, 0x6a6, 0);

    sanitizeProjectedTerrainDeltas(state);
    trackballApplyDelta(state, 0x400018);

    expect(readLongBE(r, objOff + 0x00)).toBe(Math.round(0.15 * 0x10000));
    expect(readLongBE(r, objOff + 0x04)).toBe(Math.round(0.61 * 0x10000));
    expect(((r[0x6a4] ?? 0) << 8) | (r[0x6a5] ?? 0)).toBe(0);
    expect(state.debug?.lastTrackballSanitize).toMatchObject({
      rawX: -16320,
      rawY: 0,
      suppressedX: true,
      suppressedY: false,
      reasonX: "large-discontinuity+missing-endpoint",
    });
  });

  it("still applies normal projected terrain deltas with real endpoints", () => {
    const state = emptyGameState();
    const r = state.workRam;
    const objOff = 0x18;

    writeLongBE(r, objOff + 0x00, Math.round(0.15 * 0x10000));
    writeLongBE(r, objOff + 0x04, Math.round(0.61 * 0x10000));

    writeWordBE(r, 0x1c28 + 0x04, 16320); // cx0
    writeWordBE(r, 0x1c28 + 0x0e, 16384); // cx1
    writeWordBE(r, 0x1c28 + 0x10, 16320); // cy0
    writeWordBE(r, 0x1c28 + 0x1a, 16320); // cz
    writeWordBE(r, 0x6a2, 1);
    writeWordBE(r, 0x6a4, 64);
    writeWordBE(r, 0x6a6, 0);

    sanitizeProjectedTerrainDeltas(state);
    trackballApplyDelta(state, 0x400018);

    expect(readLongBE(r, objOff + 0x00)).toBe((Math.round(0.15 * 0x10000) - (256 << 11)) >>> 0);
    expect(readLongBE(r, objOff + 0x04)).toBe(Math.round(0.61 * 0x10000));
    expect(state.debug?.lastTrackballSanitize).toBeUndefined();
  });

  it("keeps small zero-endpoint deltas when that axis contributes to interpolation", () => {
    const state = emptyGameState();
    const r = state.workRam;
    const objOff = 0x18;

    writeLongBE(r, objOff + 0x00, Math.round(0.15 * 0x10000));
    writeLongBE(r, objOff + 0x04, Math.round(0.61 * 0x10000));

    writeWordBE(r, 0x1c28 + 0x04, 8);
    writeWordBE(r, 0x1c28 + 0x0e, 0);
    writeWordBE(r, 0x1c28 + 0x10, 8);
    writeWordBE(r, 0x1c28 + 0x1a, 8);
    writeWordBE(r, 0x69e, 1);
    writeWordBE(r, 0x6a2, 1);
    writeWordBE(r, 0x6a4, 0xfff8);
    writeWordBE(r, 0x6a6, 0);

    sanitizeProjectedTerrainDeltas(state);
    trackballApplyDelta(state, 0x400018);

    expect(readLongBE(r, objOff + 0x00)).not.toBe(Math.round(0.15 * 0x10000));
    expect(((r[0x6a4] ?? 0) << 8) | (r[0x6a5] ?? 0)).not.toBe(0);
    expect(state.debug?.lastTrackballSanitize).toBeUndefined();
  });

  it("ignores discontinuity-sized projected deltas before the ROM boost", () => {
    const state = emptyGameState();
    const r = state.workRam;
    const objOff = 0x18;

    writeLongBE(r, objOff + 0x00, Math.round(0.05 * 0x10000));
    writeLongBE(r, objOff + 0x04, Math.round(0.49 * 0x10000));

    writeWordBE(r, 0x1c28 + 0x04, 16264);
    writeWordBE(r, 0x1c28 + 0x0e, 16264);
    writeWordBE(r, 0x1c28 + 0x10, 16472);
    writeWordBE(r, 0x1c28 + 0x1a, 16264);
    writeWordBE(r, 0x6a2, 0);
    writeWordBE(r, 0x6a4, 208);
    writeWordBE(r, 0x6a6, 0);

    sanitizeProjectedTerrainDeltas(state);
    trackballApplyDelta(state, 0x400018);

    expect(readLongBE(r, objOff + 0x00)).toBe(Math.round(0.05 * 0x10000));
    expect(readLongBE(r, objOff + 0x04)).toBe(Math.round(0.49 * 0x10000));
    expect(((r[0x6a4] ?? 0) << 8) | (r[0x6a5] ?? 0)).toBe(0);
    expect(state.debug?.lastTrackballSanitize).toMatchObject({
      rawX: 208,
      rawY: 0,
      suppressedX: true,
      suppressedY: false,
      reasonX: "large-discontinuity",
    });
  });
});
