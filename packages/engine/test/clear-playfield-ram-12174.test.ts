import { describe, it, expect } from "vitest";
import { emptyGameState } from "../src/state.js";
import { clearPlayfieldRam12174 } from "../src/clear-playfield-ram-12174.js";

describe("clearPlayfieldRam12174 (FUN_00012174)", () => {
  it("azzera tutta la playfieldRam (8 KB)", () => {
    const s = emptyGameState();
    s.playfieldRam.fill(0xab);
    clearPlayfieldRam12174(s);
    for (let i = 0; i < s.playfieldRam.length; i++) {
      expect(s.playfieldRam[i]).toBe(0);
    }
  });

  it("non tocca workRam, alphaRam, spriteRam, colorRam", () => {
    const s = emptyGameState();
    s.playfieldRam.fill(0xff);
    s.workRam[0x100] = 0x42;
    s.alphaRam[0x200] = 0x73;
    s.spriteRam[0x10] = 0x99;
    s.colorRam[0x40] = 0x55;
    clearPlayfieldRam12174(s);
    expect(s.workRam[0x100]).toBe(0x42);
    expect(s.alphaRam[0x200]).toBe(0x73);
    expect(s.spriteRam[0x10]).toBe(0x99);
    expect(s.colorRam[0x40]).toBe(0x55);
  });
});
