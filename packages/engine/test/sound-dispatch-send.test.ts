/**
 * sound-dispatch-send.test.ts — smoke + corner case di FUN_3E1A.
 */

import { describe, it, expect } from "vitest";
import { soundDispatchSend } from "../src/sound-dispatch-send.js";
import { emptyGameState } from "../src/state.js";
import { emptyRomImage } from "../src/bus.js";

describe("soundDispatchSend (FUN_3E1A)", () => {
  it("non solleva eccezioni con state e ROM vuoti", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    expect(() => soundDispatchSend(s, rom, 0x0000)).not.toThrow();
  });

  it("D3 >= 0xE0 → clear *0x401FF5 e early-return (no outer loop)", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    // Pointer A2 in workRam-safe: 0x401D00
    s.workRam[0x1ffc] = 0x00;
    s.workRam[0x1ffd] = 0x40;
    s.workRam[0x1ffe] = 0x1d;
    s.workRam[0x1fff] = 0x00;
    // *(A2+0xA) = 0xE5, *(A2+0xB) = ~0xE5 = 0x1A → D3 valido = 0xE5 >= 0xE0
    s.workRam[0x1d0a] = 0xe5;
    s.workRam[0x1d0b] = 0x1a;
    // Pre-fill 0x1FF5 con marker
    s.workRam[0x1ff5] = 0xab;
    soundDispatchSend(s, rom, 0x0000);
    expect(s.workRam[0x1ff5]).toBe(0); // cleared
  });

  it("complement byte non match → D3 = 0", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    s.workRam[0x1ffc] = 0x00;
    s.workRam[0x1ffd] = 0x40;
    s.workRam[0x1ffe] = 0x1d;
    s.workRam[0x1fff] = 0x00;
    // *(A2+0xA) = 0x55, *(A2+0xB) = 0x55 (NOT complement) → D3 = 0
    s.workRam[0x1d0a] = 0x55;
    s.workRam[0x1d0b] = 0x55;
    expect(() => soundDispatchSend(s, rom, 0x0000)).not.toThrow();
  });

  it("argLong=0 con D3=0: nessuna modifica (D2 sempre 0)", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    s.workRam[0x1ffc] = 0x00;
    s.workRam[0x1ffd] = 0x40;
    s.workRam[0x1ffe] = 0x1d;
    s.workRam[0x1fff] = 0x00;
    s.workRam[0x1d0a] = 0x00;
    s.workRam[0x1d0b] = 0xff;
    s.workRam[0x1ff5] = 0;
    s.workRam[0x1ff6] = 0;
    s.workRam[0x1ff7] = 0;
    soundDispatchSend(s, rom, 0x0000);
    expect(s.workRam[0x1ff5]).toBe(0);
    expect(s.workRam[0x1ff7]).toBe(0);
  });

  it("non solleva con vari argLong random", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    s.workRam[0x1ffc] = 0x00;
    s.workRam[0x1ffd] = 0x40;
    s.workRam[0x1ffe] = 0x1d;
    s.workRam[0x1fff] = 0x00;
    for (const arg of [0x0102, 0xff00, 0x80ff, 0x1234, 0xabcd]) {
      expect(() => soundDispatchSend(s, rom, arg)).not.toThrow();
    }
  });
});
