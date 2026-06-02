/**
 * Test formatAndRender28E00 (FUN_28E00) — smoke tests on the main branches.
 *
 * `cli/src/test-format-and-render-28e00-parity.ts`.
 */

import { describe, it, expect } from "vitest";
import {
  formatAndRender28E00,
  BUFEND_PTR_OFF,
  STRUCT_BASE_OFF,
  ATTR_WORD,
} from "../src/format-and-render-28e00.js";
import { emptyGameState } from "../src/state.js";
import { emptyRomImage } from "../src/bus.js";

function writeWorkLong(ram: Uint8Array, off: number, value: number): void {
  ram[off] = (value >>> 24) & 0xff;
  ram[off + 1] = (value >>> 16) & 0xff;
  ram[off + 2] = (value >>> 8) & 0xff;
  ram[off + 3] = value & 0xff;
}

describe("formatAndRender28E00 (FUN_28E00)", () => {
  it("formatHex: writes hex digits backward from the bufEnd read from *0x400436, terminated by NUL", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();

    // Setup: *0x400436 = 0x00401D00 → buffer in workRam @ 0x1D00.
    writeWorkLong(s.workRam, BUFEND_PTR_OFF, 0x00401d00);

    // arg2Word = 4 (numDigits), arg1Long = 0xABCD
    // arg3Word/arg4Word = 0/0 (col, tickOff). callerD2Word = 0 (no spaces).
    formatAndRender28E00(s, rom, 0xabcd, 4, 0, 0, 0);

    // Backward from the bufEnd+numDigits = 0x401D04: '\0' @ 1D04, 'D' @ 1D03,
    // 'C' @ 1D02, 'B' @ 1D01, 'A' @ 1D00.
    expect(s.workRam[0x1d00]).toBe(0x41); // 'A'
    expect(s.workRam[0x1d01]).toBe(0x42); // 'B'
    expect(s.workRam[0x1d02]).toBe(0x43); // 'C'
    expect(s.workRam[0x1d03]).toBe(0x44); // 'D'
    expect(s.workRam[0x1d04]).toBe(0x00); // null term
  });

  it("initStructHeader (via FUN_28FDE): writes arg3.lo @ 0x434, arg4.lo @ 0x435, 0 @ 0x43A", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();

    s.workRam[STRUCT_BASE_OFF] = 0xff;
    s.workRam[STRUCT_BASE_OFF + 1] = 0xff;
    s.workRam[STRUCT_BASE_OFF + 6] = 0xff;
    // Sets bufEnd to a harmless "scratch" area.
    writeWorkLong(s.workRam, BUFEND_PTR_OFF, 0x00401e00);

    formatAndRender28E00(s, rom, 0, 0, 0x12, 0xab, 0);

    expect(s.workRam[STRUCT_BASE_OFF]).toBe(0x12); // 0x434 = arg3.lowByte
    expect(s.workRam[STRUCT_BASE_OFF + 1]).toBe(0xab); // 0x435 = arg4.lowByte
    expect(s.workRam[STRUCT_BASE_OFF + 6]).toBe(0x00);
  });

  it("renderStringChain: the render uses attrWord=0x3400 and struct@0x400434 (smoke render)", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();

    // rendered). Points to workRam[0x500].
    writeWorkLong(s.workRam, BUFEND_PTR_OFF, 0x00400500);

    // (tickOff) = 0. State machine dummy: rotation 0, tick 0, marker 0.
    s.alphaRam.fill(0x00);
    formatAndRender28E00(s, rom, 0, 0, 0, 0, 0);

    expect(s.workRam[0x4ff]).toBe(0x30); // '0'
    expect(s.workRam[0x500]).toBe(0x00); // null

    // intact.
    for (let i = 0; i < 16; i++) {
      expect(s.alphaRam[i]).toBe(0x00);
    }
    expect(ATTR_WORD).toBe(0x3400);
  });

  it("callerD2Word used as showSpaces: value==0 + showSpaces==1 → leading spaces", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();

    writeWorkLong(s.workRam, BUFEND_PTR_OFF, 0x00401d00);

    // value=0, numDigits=4, showSpaces=1. formatHex: the first char (value==0)
    formatAndRender28E00(s, rom, 0, 4, 0, 0, /*callerD2Word*/ 1);

    expect(s.workRam[0x1d03]).toBe(0x30); // '0' (first digit pre-loop)
    expect(s.workRam[0x1d02]).toBe(0x20);
    expect(s.workRam[0x1d01]).toBe(0x20); // ' '
    expect(s.workRam[0x1d00]).toBe(0x20); // ' '
    expect(s.workRam[0x1d04]).toBe(0x00); // null term
  });

  it("arg2Word negative (signed sext): numDigits ≤ 0 → formatHex no-op (beyond the initial '0')", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();

    writeWorkLong(s.workRam, BUFEND_PTR_OFF, 0x00401d00);
    s.workRam.fill(0x55, 0x1d00, 0x1d10); // sentinel

    // arg2Word = 0x8000 -> sext_l = -32768. formatHex with numDigits=-32768:
    //   bufEnd + numDigits = 0x401D00 - 0x8000 = 0x399D00 (out-of-range);
    formatAndRender28E00(s, rom, 0xdeadbeef, 0x8000, 0, 0, 0);

    // Sentinel 0x55 must be preserved @ 0x1D00..0x1D0F (formatHex does not
    for (let i = 0; i < 16; i++) {
      expect(s.workRam[0x1d00 + i]).toBe(0x55);
    }
  });
});
