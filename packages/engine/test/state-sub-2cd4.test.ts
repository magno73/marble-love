import { describe, expect, it } from "vitest";

import { emptyRomImage } from "../src/bus.js";
import { stateSub2CD4, STATE_SUB_2CD4_ADDR } from "../src/state-sub-2cd4.js";
import { emptyGameState } from "../src/state.js";

describe("stateSub2CD4 (FUN_2CD4)", () => {
  it("exposes the binary entry address", () => {
    expect(STATE_SUB_2CD4_ADDR).toBe(0x2cd4);
  });

  it("returns 0 for an empty string entry", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    s.workRam[0x1d02] = 0x00;
    s.workRam[0x1d03] = 0x40;
    s.workRam[0x1d04] = 0x1d;
    s.workRam[0x1d05] = 0x40;
    s.workRam[0x1d40] = 0;
    expect(stateSub2CD4(s, rom, 0x00401d00, 0x1200, 0)).toBe(0);
  });
});
