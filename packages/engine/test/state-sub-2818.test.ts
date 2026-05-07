import { describe, expect, it } from "vitest";

import { emptyRomImage } from "../src/bus.js";
import { stateSub2818, STATE_SUB_2818_ADDR } from "../src/state-sub-2818.js";
import { emptyGameState } from "../src/state.js";

describe("stateSub2818 (FUN_2818)", () => {
  it("exposes the binary entry address", () => {
    expect(STATE_SUB_2818_ADDR).toBe(0x2818);
  });

  it("is callable with default no-op shape", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    s.workRam[0x1f42] = 0;
    s.workRam[0x1d01] = 0;
    s.workRam[0x1d06] = 0;
    expect(() => stateSub2818(s, rom, 0x00401d00)).not.toThrow();
  });
});
