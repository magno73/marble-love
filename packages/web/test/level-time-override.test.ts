import { describe, expect, it } from "vitest";

import { applyLevelTimeOverride, parseLevelTimeOverrideParam } from "../src/level-time-override.js";

function readWordBE(bytes: Uint8Array, off: number): number {
  return (((bytes[off] ?? 0) << 8) | (bytes[off + 1] ?? 0)) & 0xffff;
}

function readLongBE(bytes: Uint8Array, off: number): number {
  return (
    (((bytes[off] ?? 0) << 24) |
      ((bytes[off + 1] ?? 0) << 16) |
      ((bytes[off + 2] ?? 0) << 8) |
      (bytes[off + 3] ?? 0)) >>>
    0
  );
}

describe("level time override", () => {
  it("parses explicit debug level times", () => {
    expect(parseLevelTimeOverrideParam(null)).toBeUndefined();
    expect(parseLevelTimeOverrideParam("")).toBeUndefined();
    expect(parseLevelTimeOverrideParam("120")).toBe(120);
    expect(parseLevelTimeOverrideParam("180")).toBe(180);
  });

  it("rejects invalid or unsafe values", () => {
    expect(parseLevelTimeOverrideParam("0")).toBeUndefined();
    expect(parseLevelTimeOverrideParam("-1")).toBeUndefined();
    expect(parseLevelTimeOverrideParam("12.5")).toBeUndefined();
    expect(parseLevelTimeOverrideParam("1000")).toBeUndefined();
    expect(parseLevelTimeOverrideParam("abc")).toBeUndefined();
  });

  it("writes the player countdown and level timer mirror", () => {
    const state = { workRam: new Uint8Array(0x2000) };
    applyLevelTimeOverride(state, 180);
    expect(readWordBE(state.workRam, 0x18 + 0x6a)).toBe(180);
    expect(readLongBE(state.workRam, 0x097c)).toBe(180);
  });
});
