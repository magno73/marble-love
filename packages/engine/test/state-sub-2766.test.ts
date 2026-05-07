import { describe, expect, it } from "vitest";

import { emptyRomImage } from "../src/bus.js";
import { stateSub2766, STATE_SUB_2766_ADDR } from "../src/state-sub-2766.js";
import { emptyGameState } from "../src/state.js";

describe("stateSub2766 (FUN_2766)", () => {
  it("exposes the binary entry address", () => {
    expect(STATE_SUB_2766_ADDR).toBe(0x2766);
  });

  it("default no-op shape is callable without throwing", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    s.workRam[0x1f42] = 0;
    s.workRam[0x1d01] = 0;
    s.workRam[0x1d06] = 0;
    s.workRam[0x1d08] = 0;
    expect(() => stateSub2766(s, rom, 0x00401d00)).not.toThrow();
  });
});
