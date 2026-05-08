import { describe, expect, it } from "vitest";
import {
  scrollFlagHelperF6A,
  SCROLL_FLAG_HELPER_F6A_ADDR,
} from "../src/scroll-flag-helper-f6a.js";
import { EDGE_DETECTOR_PREV_OFF } from "../src/event-flags.js";
import { emptyGameState } from "../src/state.js";

function setup(flag: number, prev: number) {
  const s = emptyGameState();
  s.workRam[0] = (flag >>> 8) & 0xff;
  s.workRam[1] = flag & 0xff;
  s.workRam[EDGE_DETECTOR_PREV_OFF] = (prev >>> 8) & 0xff;
  s.workRam[EDGE_DETECTOR_PREV_OFF + 1] = prev & 0xff;
  return s;
}

describe("scrollFlagHelperF6A (FUN_00000F6A)", () => {
  it("returns high nibble plus rising low-bit edges", () => {
    const s = setup(0x5003, 0x0001);
    expect(scrollFlagHelperF6A(s)).toBe(0x5002);
  });

  it("stores current low two bits as previous state", () => {
    const s = setup(0x9002, 0xffff);
    scrollFlagHelperF6A(s);
    const saved = ((s.workRam[EDGE_DETECTOR_PREV_OFF] ?? 0) << 8) |
      (s.workRam[EDGE_DETECTOR_PREV_OFF + 1] ?? 0);
    expect(saved).toBe(2);
  });

  it("sign-extends high nibble when bit 15 is set", () => {
    const s = setup(0xf001, 0);
    expect(scrollFlagHelperF6A(s) >>> 0).toBe(0xfffff001);
  });

  it("exposes the binary entry address", () => {
    expect(SCROLL_FLAG_HELPER_F6A_ADDR).toBe(0x0f6a);
  });
});
