/**
 * Test trackballClampFlags28468 (FUN_00028468) — smoke tests sui rami principali.
 *
 * `FUN_00028468` (280 byte): pre-clamp ±0x40 sui due accumulator
 * (*0x4006A4 / *0x4006A6), debounce input, axis-lock 2:1 for trackball deltas
 * `cli/src/test-trackball-clamp-flags-28468-parity.ts` (500/500).
 */

import { describe, it, expect } from "vitest";
import {
  trackballClampFlags28468,
  FUN_28468_ADDR,
  ACCUM_X_OFF,
  ACCUM_Y_OFF,
  PICKED_DELTA_X_OFF,
  PICKED_DELTA_Y_OFF,
  DEBOUNCED_INPUT_OFF,
  PRE_CLAMP_LIMIT,
  POST_WRAP_LIMIT,
  INITIAL_FLAGS,
} from "../src/trackball-clamp-flags-28468.js";
import { emptyGameState } from "../src/state.js";

function writeSWord(ram: Uint8Array, off: number, value: number): void {
  const v = value & 0xffff;
  ram[off] = (v >>> 8) & 0xff;
  ram[off + 1] = v & 0xff;
}

function readSWord(ram: Uint8Array, off: number): number {
  const w = (((ram[off] ?? 0) << 8) | (ram[off + 1] ?? 0)) & 0xffff;
  return w & 0x8000 ? w - 0x10000 : w;
}

describe("trackballClampFlags28468 (FUN_00028468)", () => {
  it("pre-clamp ±0x40: accumulator iniziale > 0x40 viene cap a 0x40 prima di tutto", () => {
    const s = emptyGameState();
    writeSWord(s.workRam, ACCUM_X_OFF, 0x0100);
    writeSWord(s.workRam, ACCUM_Y_OFF, -0x80);

    trackballClampFlags28468(s, {
      mmioInputByte: 0,
      p1X: 0,
      p1Y: 0,
      p2X: 0,
      p2Y: 0,
    });

    expect(readSWord(s.workRam, ACCUM_X_OFF)).toBe(0x40 - POST_WRAP_LIMIT);
    expect(readSWord(s.workRam, ACCUM_Y_OFF)).toBe(-0x40 + POST_WRAP_LIMIT);
  });

  it("flag bits: input bit 0 stable mantiene D5 bit 0 set; bit 0 unstable lo clear", () => {
    const s = emptyGameState();
    // Setup debounce: prev = 0x01, oldDeb = 0x01 → cur=0x01 → newDeb = (0x01 | (0x01 & 0x01)) & (0x01 | 0x01) = 0x01
    s.workRam[0x3a8] = 0x01; // prev sample
    s.workRam[0x3aa] = 0x01; // oldDebounced
    const flags = trackballClampFlags28468(s, {
      mmioInputByte: 0x01, // curr = 0x01 → newDeb = 0x01
      p1X: 0,
      p1Y: 0,
      p2X: 0,
      p2Y: 0,
    });
    // bit 0 stays set. bit 1 was never set → stays cleared.
    // bit 0: set (stable). bit 1: clear (no stable).
    expect(flags & 0x0001).toBe(0x0001);
    expect(flags & 0x0002).toBe(0x0000);
    expect((flags >>> 12) & 0x0f).toBe(0x0f);
  });

  it("post-wrap: nessun overflow → wrap-bits 12-15 tutti set in D5w", () => {
    const s = emptyGameState();
    // Input zero, accumulator iniziali entro [-0x18, 0x18] → no wrap.
    writeSWord(s.workRam, ACCUM_X_OFF, 0x10);
    writeSWord(s.workRam, ACCUM_Y_OFF, -0x10);

    const flags = trackballClampFlags28468(s, {
      mmioInputByte: 0x00,
      p1X: 0,
      p1Y: 0,
      p2X: 0,
      p2Y: 0,
    });

    // Bit 0 e 1: depend on debounce. Default empty state, prev=0, oldDeb=0,
    // cur=0 → newDeb = 0 → bit 0 e 1 cleared.
    expect(flags & 0x0003).toBe(0x0000);
    expect((flags >>> 12) & 0x0f).toBe(0x0f);
    // Accumulator invariati (input 0, no axis-lock effect).
    expect(readSWord(s.workRam, ACCUM_X_OFF)).toBe(0x10);
    expect(readSWord(s.workRam, ACCUM_Y_OFF)).toBe(-0x10);
  });

  it("axis-lock: con A=0x10, B=0x00 → D1=-0x10, D2=0x10, abs uguali → SKIP", () => {
    // Per ottenere picked deltas controllati, settiamo entrambi obj C6/C7 al
    const s = emptyGameState();
    // obj0 @ 0x18: C6 = 0x10 (pickedY = A), C7 = 0x00 (pickedX = B)
    s.workRam[0x18 + 0xc6] = 0x10;
    s.workRam[0x18 + 0xc7] = 0x00;
    s.workRam[0xfa + 0xc6] = 0x10;
    s.workRam[0xfa + 0xc7] = 0x00;
    // trackballInputTick: deltaX = (cur - prev_savedX) & 0xFF, then save cur.
    // Setup: obj0 savedX=0xC9, savedY=0xC8 → set savedX = 0, savedY = 0xF0.
    // p1X = 0 → deltaX = 0 - 0 = 0; p1Y = 0 → deltaY = 0 - 0xF0 = 0x10 (mod 256)
    // (0xF0 sext = -16, 0 - (-16) = +16 = 0x10. delta out of [-0x60, 0x60]?
    //  +0x10 = 16 < 0x60 → no clamp). Ottimo.
    s.workRam[0x18 + 0xc9] = 0x00; // savedX
    s.workRam[0x18 + 0xc8] = 0xf0; // savedY
    s.workRam[0x18 + 0xc7] = 0x00; // deltaX init (per evitare clamp anti-wrap)
    s.workRam[0x18 + 0xc6] = 0x00; // deltaY init
    s.workRam[0xfa + 0xc9] = 0x00;
    s.workRam[0xfa + 0xc8] = 0x00;
    s.workRam[0xfa + 0xc7] = 0x00;
    s.workRam[0xfa + 0xc6] = 0x00;

    // Pre-set accumulator a 0 per pulire output.
    writeSWord(s.workRam, ACCUM_X_OFF, 0);
    writeSWord(s.workRam, ACCUM_Y_OFF, 0);

    trackballClampFlags28468(s, {
      mmioInputByte: 0,
      p1X: 0,
      p1Y: 0, // deltaY result = 0x10
      p2X: 0,
      p2Y: 0,
    });

    // pickObjLarger: |obj0.C6|+|obj0.C7| = 0x10+0 = 0x10; obj1 = 0+0 = 0.
    // sumA(=obj0)=0x10 >= sumB(=obj1)=0 → uses A: *0x6AA = 0x10 (C6),
    // *0x6A8 = 0 (C7).
    // A=0x10, B=0x00 → D1b = -A - B = -0x10 = 0xF0 (sext = -16)
    //                   D2b = A - B = 0x10 (sext = +16)
    // D3 = abs8(D1) = 0x10, D4 = abs8(D2) = 0x10.
    // 2*D4 = 0x20. D3 (0x10) > 0x20? no. fallthrough.
    // 2*D3 = 0x20. D4 (0x10) <= 0x20? yes (bls) → SKIP. D1, D2 invariati.
    // Add: *0x6A4 += sext_w(D1b) = -16 → -16. *0x6A6 += sext_w(D2b) = 16 → 16.
    // No wrap (|-16| <= 0x18, |16| <= 0x18).
    expect(readSWord(s.workRam, ACCUM_X_OFF)).toBe(-16);
    expect(readSWord(s.workRam, ACCUM_Y_OFF)).toBe(16);
  });

  it("debounceInput modifica *0x4003A8/AA/AC come parte della chiamata", () => {
    const s = emptyGameState();
    // Setup: prev=0xFF, oldDeb=0xFF → cur=0xFF → newDeb=0xFF (stable hi).
    s.workRam[0x3a8] = 0xff;
    s.workRam[0x3aa] = 0xff;
    s.workRam[0x3ac] = 0x00;

    trackballClampFlags28468(s, {
      mmioInputByte: 0xff,
      p1X: 0,
      p1Y: 0,
      p2X: 0,
      p2Y: 0,
    });

    expect(s.workRam[DEBOUNCED_INPUT_OFF]).toBe(0xff);
    expect(s.workRam[0x3a8]).toBe(0xff); // prev = curr = 0xFF
  });

  it("costanti exposed: indirizzi binary corretti", () => {
    expect(FUN_28468_ADDR).toBe(0x00028468);
    expect(ACCUM_X_OFF).toBe(0x6a4);
    expect(ACCUM_Y_OFF).toBe(0x6a6);
    expect(PICKED_DELTA_X_OFF).toBe(0x6a8);
    expect(PICKED_DELTA_Y_OFF).toBe(0x6aa);
    expect(DEBOUNCED_INPUT_OFF).toBe(0x3aa);
    expect(PRE_CLAMP_LIMIT).toBe(0x40);
    expect(POST_WRAP_LIMIT).toBe(0x18);
    expect(INITIAL_FLAGS).toBe(0xf003);
  });
});
