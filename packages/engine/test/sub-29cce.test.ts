/**
 * sub-29cce.test.ts — smoke tests per FUN_29CCE replica MINIMAL CHUNK.
 */
import { describe, it, expect } from "vitest";
import { fun29CCE } from "../src/sub-29cce.js";
import { emptyGameState } from "../src/state.js";
import { emptyRomImage } from "../src/bus.js";

const SLOT = 0x004009a4;
const SLOT_OFF = 0x09a4;

function rL(workRam: Uint8Array, off: number): number {
  return (
    (((workRam[off]     ?? 0) << 24) |
     ((workRam[off + 1] ?? 0) << 16) |
     ((workRam[off + 2] ?? 0) <<  8) |
      (workRam[off + 3] ?? 0)) >>> 0
  );
}

function wL(workRam: Uint8Array, off: number, v: number): void {
  workRam[off]     = (v >>> 24) & 0xff;
  workRam[off + 1] = (v >>> 16) & 0xff;
  workRam[off + 2] = (v >>>  8) & 0xff;
  workRam[off + 3] =  v         & 0xff;
}

describe("fun29CCE (FUN_29CCE minimal chunk)", () => {
  it("non solleva eccezioni con state vuoto e slot vuoto", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    expect(() => fun29CCE(s, SLOT, rom)).not.toThrow();
  });

  it("PROLOGUE clr.b *(0x58,A2): byte +0x58 azzerato dopo chiamata", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    s.workRam[SLOT_OFF + 0x58] = 0x42;
    fun29CCE(s, SLOT, rom);
    expect(s.workRam[SLOT_OFF + 0x58]).toBe(0x00);
  });

  it("EPILOGUE flag *(0x666)==0 e *(0x668)==0 → nessun neg.l su vx/vy", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    // vx = 0x12345678
    wL(s.workRam, SLOT_OFF + 0x00, 0x12345678);
    // vy = 0xDEADBEEF
    wL(s.workRam, SLOT_OFF + 0x04, 0xdeadbeef);
    // flag globals 0x666/0x668 = 0
    s.workRam[0x666] = 0;
    s.workRam[0x668] = 0;
    fun29CCE(s, SLOT, rom);
    expect(rL(s.workRam, SLOT_OFF + 0x00)).toBe(0x12345678);
    expect(rL(s.workRam, SLOT_OFF + 0x04)).toBe(0xdeadbeef);
  });

  it("EPILOGUE flag *(0x666) != 0 → x = *(0x684), vx = -vx", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    wL(s.workRam, SLOT_OFF + 0x00, 0x00010000); // vx = 0x10000
    wL(s.workRam, SLOT_OFF + 0x0c, 0x99999999); // x dummy
    wL(s.workRam, 0x684, 0xaabbccdd);            // *(0x400684) = restore
    s.workRam[0x666] = 0x01;
    fun29CCE(s, SLOT, rom);
    expect(rL(s.workRam, SLOT_OFF + 0x0c)).toBe(0xaabbccdd);
    // vx = -0x10000 = 0xFFFF0000 (32-bit two's complement)
    expect(rL(s.workRam, SLOT_OFF + 0x00)).toBe(0xffff0000);
  });

  it("EPILOGUE flag *(0x668) != 0 → y = *(0x688), vy = -vy", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    wL(s.workRam, SLOT_OFF + 0x04, 0x00020000); // vy = 0x20000
    wL(s.workRam, SLOT_OFF + 0x10, 0x77777777); // y dummy
    wL(s.workRam, 0x688, 0x11223344);            // *(0x400688)
    s.workRam[0x668] = 0x80;
    fun29CCE(s, SLOT, rom);
    expect(rL(s.workRam, SLOT_OFF + 0x10)).toBe(0x11223344);
    // vy = -0x20000 = 0xFFFE0000
    expect(rL(s.workRam, SLOT_OFF + 0x04)).toBe(0xfffe0000);
  });

  it("sound dispatch: D3=0x10 (initial +0x58 in arm) e D0=0 (clr) → soundCmdSend(0x44)", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    s.workRam[SLOT_OFF + 0x58] = 0x10;
    let soundArg: number | undefined;
    fun29CCE(s, SLOT, rom, {
      soundCmdSend158AC: (_st, b) => { soundArg = b; return 1; },
    });
    // d0 (rilettura post-clr) = 0 → !isMatch(d0); d3=0x10 → isMatch → 0x44
    expect(soundArg).toBe(0x44);
  });
});
