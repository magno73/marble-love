import { describe, expect, it } from "vitest";

import {
  isCoinKey,
  isStartKey,
  mapLiveScreenDeltaToTrackballDelta,
  rotateMarbleTrackballDelta,
} from "../src/input.js";

describe("browser input mapping", () => {
  it("rotates raw browser deltas into Marble trackball MMIO axes", () => {
    expect(rotateMarbleTrackballDelta(8, 0)).toEqual({ x: 8, y: 8 });
    expect(rotateMarbleTrackballDelta(0, 8)).toEqual({ x: 8, y: -8 });
    expect(rotateMarbleTrackballDelta(-8, 0)).toEqual({ x: -8, y: -8 });
    expect(rotateMarbleTrackballDelta(4, -6)).toEqual({ x: -2, y: 10 });
  });

  it("maps live screen-space controls onto direct MMIO axes", () => {
    expect(mapLiveScreenDeltaToTrackballDelta(8, 0)).toEqual({ x: -8, y: 0 });
    expect(mapLiveScreenDeltaToTrackballDelta(-8, 0)).toEqual({ x: 8, y: 0 });
    expect(mapLiveScreenDeltaToTrackballDelta(0, -8)).toEqual({ x: 0, y: 8 });
    expect(mapLiveScreenDeltaToTrackballDelta(0, 8)).toEqual({ x: 0, y: -8 });
    expect(mapLiveScreenDeltaToTrackballDelta(4, -6)).toEqual({ x: -4, y: 6 });
  });

  it("maps arcade coin/start keys separately from trackball movement", () => {
    expect(isCoinKey("5")).toBe(true);
    expect(isCoinKey("c")).toBe(true);
    expect(isCoinKey("ArrowLeft")).toBe(false);

    expect(isStartKey("Enter")).toBe(true);
    expect(isStartKey(" ")).toBe(true);
    expect(isStartKey("5")).toBe(false);
  });
});
