/**
 * sprite-pos-update-1bab2.test.ts — smoke + corner case of FUN_0001BAB2.
 */

import { describe, it, expect } from "vitest";
import { spritePosUpdate1BAB2 } from "../src/sprite-pos-update-1bab2.js";
import { emptyGameState } from "../src/state.js";

const POS_X_OFF = 0x690;
const POS_Y_OFF = 0x692;
const POS_Z_OFF = 0x694;
const TILE_X_OFF = 0x696;
const TILE_Y_OFF = 0x698;

function readWord(s: ReturnType<typeof emptyGameState>, off: number): number {
  return ((s.workRam[off] ?? 0) << 8) | (s.workRam[off + 1] ?? 0);
}

function writeWord(
  s: ReturnType<typeof emptyGameState>,
  off: number,
  v: number,
): void {
  s.workRam[off] = (v >>> 8) & 0xff;
  s.workRam[off + 1] = v & 0xff;
}

describe("spritePosUpdate1BAB2 (FUN_0001BAB2)", () => {
  it("non solleva eccezioni con state vuoto and copies x/y/z from the +0xC/+0x10/+0x14", () => {
    const s = emptyGameState();
    const ARG = 0x401d00;
    const argOff = ARG - 0x400000;
    writeWord(s, argOff + 0xc, 0x1234);
    writeWord(s, argOff + 0x10, 0x5678);
    writeWord(s, argOff + 0x14, 0xabcd);
    const r = spritePosUpdate1BAB2(s, ARG);
    expect(readWord(s, POS_X_OFF)).toBe(0x1234);
    expect(readWord(s, POS_Y_OFF)).toBe(0x5678);
    expect(readWord(s, POS_Z_OFF)).toBe(0xabcd);
    expect(readWord(s, TILE_X_OFF)).toBe(0x1234 >> 3);
    expect(readWord(s, TILE_Y_OFF)).toBe(0x5678 >> 3);
    expect(r.redrawNeeded).toBe(true);
    expect(r.prevTileX).toBe(0);
    expect(r.prevTileY).toBe(0);
  });

  it("invoca subs.fun_1CABA when le tile coords cambiano", () => {
    const s = emptyGameState();
    let calls = 0;
    const ARG = 0x401d00;
    const argOff = ARG - 0x400000;
    writeWord(s, argOff + 0xc, 0x0040);  // tileX = 8
    writeWord(s, argOff + 0x10, 0x0080); // tileY = 16
    writeWord(s, argOff + 0x14, 0x0001);
    const r = spritePosUpdate1BAB2(s, ARG, {
      fun_1CABA: () => { calls++; },
    });
    expect(r.redrawNeeded).toBe(true);
    expect(calls).toBe(1);
    expect(readWord(s, TILE_X_OFF)).toBe(8);
    expect(readWord(s, TILE_Y_OFF)).toBe(16);
  });

  it("NOT invoca subs.fun_1CABA se le tile coords restano uguali (movimento sub-tile)", () => {
    const s = emptyGameState();
    // Pre-condizione: tile-coords correnti = (3, 5) → globals 696/698.
    writeWord(s, TILE_X_OFF, 3);
    writeWord(s, TILE_Y_OFF, 5);
    // Setup struct: x=0x18 (=> tile 3), y=0x28 (=> tile 5)
    const ARG = 0x401d00;
    const argOff = ARG - 0x400000;
    writeWord(s, argOff + 0xc, 0x18);
    writeWord(s, argOff + 0x10, 0x28);
    writeWord(s, argOff + 0x14, 0x00);
    let calls = 0;
    const r = spritePosUpdate1BAB2(s, ARG, {
      fun_1CABA: () => { calls++; },
    });
    expect(r.redrawNeeded).toBe(false);
    expect(calls).toBe(0);
    expect(readWord(s, TILE_X_OFF)).toBe(3);
    expect(readWord(s, TILE_Y_OFF)).toBe(5);
    expect(r.prevTileX).toBe(3);
    expect(r.prevTileY).toBe(5);
  });

  it("invoca redraw se solo X-tile cambia (Y stays)", () => {
    const s = emptyGameState();
    writeWord(s, TILE_X_OFF, 1);
    writeWord(s, TILE_Y_OFF, 2);
    const ARG = 0x401d00;
    const argOff = ARG - 0x400000;
    writeWord(s, argOff + 0xc, 0x40);   // tileX = 8 (cambia)
    writeWord(s, argOff + 0x10, 0x10);  // tileY = 2 (stays)
    writeWord(s, argOff + 0x14, 0);
    let calls = 0;
    spritePosUpdate1BAB2(s, ARG, { fun_1CABA: () => { calls++; } });
    expect(calls).toBe(1);
  });

  it("invoca redraw se solo Y-tile cambia (X stays)", () => {
    const s = emptyGameState();
    writeWord(s, TILE_X_OFF, 1);
    writeWord(s, TILE_Y_OFF, 2);
    const ARG = 0x401d00;
    const argOff = ARG - 0x400000;
    writeWord(s, argOff + 0xc, 0x08);   // tileX = 1 (stays)
    writeWord(s, argOff + 0x10, 0x80);  // tileY = 16 (cambia)
    writeWord(s, argOff + 0x14, 0);
    let calls = 0;
    spritePosUpdate1BAB2(s, ARG, { fun_1CABA: () => { calls++; } });
    expect(calls).toBe(1);
  });

  it("redraw funziona con coord negative (x>>3 signed asr)", () => {
    const s = emptyGameState();
    // OLD: tile = 0 — NEW: x = 0xFFC0 (= -64) → asr 3 = 0xFFF8 (= -8)
    const ARG = 0x401d00;
    const argOff = ARG - 0x400000;
    writeWord(s, argOff + 0xc, 0xffc0);
    writeWord(s, argOff + 0x10, 0x0000);
    writeWord(s, argOff + 0x14, 0);
    const r = spritePosUpdate1BAB2(s, ARG);
    expect(readWord(s, TILE_X_OFF)).toBe(0xfff8);
    expect(r.redrawNeeded).toBe(true);
  });

  it("subs assente → no-op silenzioso even if redrawNeeded", () => {
    const s = emptyGameState();
    const ARG = 0x401d00;
    const argOff = ARG - 0x400000;
    writeWord(s, argOff + 0xc, 0x40);
    writeWord(s, argOff + 0x10, 0x80);
    writeWord(s, argOff + 0x14, 0);
    const r = spritePosUpdate1BAB2(s, ARG);
    expect(r.redrawNeeded).toBe(true);
  });
});
