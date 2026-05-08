import { describe, expect, it } from "vitest";
import { emptyRomImage } from "../src/bus.js";
import {
  initFnPointers28580,
  INIT_FN_POINTERS_28580_ADDR,
} from "../src/init-fn-pointers-28580.js";
import { emptyGameState } from "../src/state.js";

function readU32(bytes: Uint8Array, off: number): number {
  return ((((bytes[off] ?? 0) << 24) |
    ((bytes[off + 1] ?? 0) << 16) |
    ((bytes[off + 2] ?? 0) << 8) |
    (bytes[off + 3] ?? 0)) >>> 0);
}

describe("initFnPointers28580 (FUN_00028580)", () => {
  it("writes the four binary function-pointer fields", () => {
    const s = emptyGameState();
    s.workRam.fill(0xaa);

    initFnPointers28580(s, emptyRomImage());

    expect(readU32(s.workRam, 0x412)).toBe(0x004006ac);
    expect(readU32(s.workRam, 0x41e)).toBe(0x004006d0);
    expect(readU32(s.workRam, 0x42a)).toBe(0x004006e2);
    expect(readU32(s.workRam, 0x436)).toBe(0x004006f4);
  });

  it("calls FUN_014E injection before pointer writes", () => {
    const s = emptyGameState();
    const calls: string[] = [];
    initFnPointers28580(s, emptyRomImage(), {
      fun_014e: () => {
        calls.push("014e");
        expect(readU32(s.workRam, 0x412)).toBe(0);
      },
    });
    expect(calls).toEqual(["014e"]);
    expect(readU32(s.workRam, 0x412)).toBe(0x004006ac);
  });

  it("exposes the binary entry address", () => {
    expect(INIT_FN_POINTERS_28580_ADDR).toBe(0x28580);
  });
});
