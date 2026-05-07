import { describe, expect, it } from "vitest";

import { emptyRomImage } from "../src/bus.js";
import { stateSub2572, STATE_SUB_2572_ADDR } from "../src/state-sub-2572.js";
import { emptyGameState } from "../src/state.js";

describe("stateSub2572 (FUN_2572)", () => {
  it("exposes the binary entry address", () => {
    expect(STATE_SUB_2572_ADDR).toBe(0x2572);
  });

  it("returns 1 for an empty single-entry chain", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    s.workRam[0x1d02] = 0x00;
    s.workRam[0x1d03] = 0x40;
    s.workRam[0x1d04] = 0x1d;
    s.workRam[0x1d05] = 0x40;
    s.workRam[0x1d06] = 0;
    s.workRam[0x1d40] = 0;
    expect(stateSub2572(s, rom, 0x00401d00, 0x1200)).toBe(1);
  });
});
