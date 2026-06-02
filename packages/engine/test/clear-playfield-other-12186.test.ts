import { describe, it, expect } from "vitest";
import { emptyGameState } from "../src/state.js";
import { clearPlayfieldOther12186 } from "../src/clear-playfield-other-12186.js";

describe("clearPlayfieldOther12186 (FUN_00012186)", () => {
  it("azzera 72 byte per 64 iterazioni, partendo dto the offset 6", () => {
    const s = emptyGameState();
    s.playfieldRam.fill(0xab);
    clearPlayfieldOther12186(s);

    let off = 6;
    for (let outer = 0; outer < 64; outer++) {
      // 72 bytes zeroed.
      for (let i = 0; i < 72; i++) {
        expect(s.playfieldRam[off + i]).toBe(0);
      }
      off += 128;
    }
  });

  it("non tocca i first 6 byte of playfieldRam (pre-offset)", () => {
    const s = emptyGameState();
    s.playfieldRam.fill(0xcd);
    clearPlayfieldOther12186(s);

    for (let i = 0; i < 6; i++) {
      expect(s.playfieldRam[i]).toBe(0xcd);
    }
  });

  it("preserva i 56 byte saltati in each iterazione", () => {
    const s = emptyGameState();
    s.playfieldRam.fill(0xef);
    clearPlayfieldOther12186(s);

    let off = 6;
    for (let outer = 0; outer < 64; outer++) {
      // 56 bytes skipped (offset 72..127 relative to the start of the iteration),
      // Only when inside array bounds; the last iteration touches the end.
      for (let i = 72; i < 128; i++) {
        const idx = off + i;
        if (idx < s.playfieldRam.length) {
          expect(s.playfieldRam[idx]).toBe(0xef);
        }
      }
      off += 128;
    }
  });

  it("non tocca workRam, alphaRam, spriteRam, colorRam", () => {
    const s = emptyGameState();
    s.playfieldRam.fill(0xff);
    s.workRam[0x100] = 0x42;
    s.alphaRam[0x200] = 0x73;
    s.spriteRam[0x10] = 0x99;
    s.colorRam[0x40] = 0x55;
    clearPlayfieldOther12186(s);
    expect(s.workRam[0x100]).toBe(0x42);
    expect(s.alphaRam[0x200]).toBe(0x73);
    expect(s.spriteRam[0x10]).toBe(0x99);
    expect(s.colorRam[0x40]).toBe(0x55);
  });
});
