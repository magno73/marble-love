import { describe, expect, it } from "vitest";

import { emptyRomImage } from "../src/bus.js";
import { stateSub295A, STATE_SUB_295A_ADDR } from "../src/state-sub-295a.js";
import { emptyGameState } from "../src/state.js";

describe("stateSub295A (FUN_295A)", () => {
  it("exposes the binary entry address", () => {
    expect(STATE_SUB_295A_ADDR).toBe(0x295a);
  });

  it("is callable with an empty ROM/state", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    expect(() => stateSub295A(s, rom)).not.toThrow();
  });
});
