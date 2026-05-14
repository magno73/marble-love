import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  createInputReplay,
  INPUT_MMIO_SWITCHES,
  INPUT_MMIO_TRACKBALL2_X,
  INPUT_MMIO_TRACKBALL2_Y,
  INPUT_MMIO_TRACKBALL_X,
  INPUT_MMIO_TRACKBALL_Y,
  parseInputReplayTrace,
} from "../src/input-replay.js";

describe("input replay trace", () => {
  it("replays captured MAME MMIO bytes for 50 frames", () => {
    const trace = parseInputReplayTrace(
      readFileSync(resolve("oracle/scenarios/input/demo_attract.json"), "utf-8"),
    );
    const replay = createInputReplay(trace);
    const sample = trace.frames.slice(0, 50);
    expect(sample.length).toBe(50);

    for (const frame of sample) {
      expect(replay.read8(INPUT_MMIO_TRACKBALL_X, frame.frame) as unknown as number).toBe(frame.trackballX);
      expect(replay.read8(INPUT_MMIO_TRACKBALL_Y, frame.frame) as unknown as number).toBe(frame.trackballY);
      expect(replay.read8(INPUT_MMIO_TRACKBALL2_X, frame.frame) as unknown as number).toBe(frame.trackball2X);
      expect(replay.read8(INPUT_MMIO_TRACKBALL2_Y, frame.frame) as unknown as number).toBe(frame.trackball2Y);
      expect(replay.read8(INPUT_MMIO_SWITCHES, frame.frame) as unknown as number).toBe(frame.switches);

      const inputs = replay.mainTickInputs(frame.frame);
      expect(inputs.p1X).toBe(frame.trackballX);
      expect(inputs.p1Y).toBe(frame.trackballY);
      expect(inputs.p2X).toBe(frame.trackball2X);
      expect(inputs.p2Y).toBe(frame.trackball2Y);
      expect(inputs.inputMmio).toBe(frame.switches);
    }
  });
});
