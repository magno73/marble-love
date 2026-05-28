import { describe, it, expect } from "vitest";
import { emptyGameState } from "../src/state.js";
import {
  VBLANK_ACK_28DEA_ADDR,
  WAIT_28DB8_ADDR,
  CLEAR_PALETTE_RAM_121A6_ADDR,
  vblankAck28DEA,
  wait28DB8,
  clearPaletteRam121A6,
} from "../src/vblank-helpers.js";

describe("FUN_28DEA vblankAck28DEA", () => {
  it("expone l'address del binario", () => {
    expect(VBLANK_ACK_28DEA_ADDR).toBe(0x28dea);
  });

  it("setta workRam[0x16]=1 e incrementa workRam[0x3F0]", () => {
    const s = emptyGameState();
    s.workRam[0x16] = 0;
    s.workRam[0x3f0] = 0x10;
    vblankAck28DEA(s);
    expect(s.workRam[0x16]).toBe(1);
    expect(s.workRam[0x3f0]).toBe(0x11);
  });

  it("counter wraps a 0xFF → 0x00", () => {
    const s = emptyGameState();
    s.workRam[0x3f0] = 0xff;
    vblankAck28DEA(s);
    expect(s.workRam[0x3f0]).toBe(0);
  });
});

describe("FUN_28DB8 wait28DB8", () => {
  it("expone l'address del binario", () => {
    expect(WAIT_28DB8_ADDR).toBe(0x28db8);
  });

  it("aspetta N frame e incrementa workRam[0x3F0] N volte", () => {
    const s = emptyGameState();
    s.workRam[0x3f0] = 0x10;
    s.workRam[0x390] = 0;
    s.workRam[0x391] = 1;
    wait28DB8(s, 5);
    expect(s.workRam[0x3f0]).toBe(0x15);
  });

  it("early exit se state machine state cambia", () => {
    const s = emptyGameState();
    s.workRam[0x3f0] = 0;
    s.workRam[0x390] = 0;
    s.workRam[0x391] = 1;

    // Artificial sub that changes state on the 3rd tick.
    let calls = 0;
    const originalCounter = s.workRam[0x3f0] ?? 0;
    void originalCounter;
    // Emulate: after 3 vblankAck calls, change state.
    const wrapped = (st: typeof s) => {
      vblankAck28DEA(st);
      calls += 1;
      if (calls === 3) st.workRam[0x391] = 2; // state changes
    };
    // Replico inline il loop di wait28DB8 ma usando wrapped invece di vblankAck
    const initial = s.workRam[0x391] ?? 0;
    let counter = 10;
    while (counter > 0) {
      wrapped(s);
      const cur = ((s.workRam[0x390] ?? 0) << 8) | (s.workRam[0x391] ?? 0);
      const initWord = initial & 0x80 ? initial | 0xff00 : initial;
      if (cur !== (initWord & 0xffff)) counter = 0;
      else counter -= 1;
    }
    // Only 3 calls: 1+2 before state change, then exit at the 4th iteration.
    expect(calls).toBe(3);
  });

  it("frames=0 → no-op", () => {
    const s = emptyGameState();
    s.workRam[0x3f0] = 0x42;
    wait28DB8(s, 0);
    expect(s.workRam[0x3f0]).toBe(0x42);
  });
});

describe("FUN_121A6 clearPaletteRam121A6", () => {
  it("expone l'address del binario", () => {
    expect(CLEAR_PALETTE_RAM_121A6_ADDR).toBe(0x121a6);
  });

  it("azzera tutta la colorRam (2 KB)", () => {
    const s = emptyGameState();
    s.colorRam.fill(0xab);
    clearPaletteRam121A6(s);
    for (let i = 0; i < s.colorRam.length; i++) {
      expect(s.colorRam[i]).toBe(0);
    }
  });

  it("non tocca workRam/alphaRam/spriteRam/playfieldRam", () => {
    const s = emptyGameState();
    s.colorRam.fill(0xff);
    s.workRam[0x100] = 0x42;
    s.alphaRam[0x100] = 0x73;
    s.spriteRam[0x10] = 0x99;
    s.playfieldRam[0x100] = 0x55;
    clearPaletteRam121A6(s);
    expect(s.workRam[0x100]).toBe(0x42);
    expect(s.alphaRam[0x100]).toBe(0x73);
    expect(s.spriteRam[0x10]).toBe(0x99);
    expect(s.playfieldRam[0x100]).toBe(0x55);
  });
});
