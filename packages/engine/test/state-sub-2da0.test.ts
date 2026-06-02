/**
 * state-sub-2da0.test.ts — smoke + corner case of FUN_2DA0.
 */

import { describe, it, expect } from "vitest";
import { stateSub2DA0 } from "../src/state-sub-2da0.js";
import { emptyGameState } from "../src/state.js";
import { emptyRomImage } from "../src/bus.js";

const ROTATION_OFF = 0x1f42;
const STRUCT_OFF = 0x1d00; // arbitrary work-RAM offset for struct
const STRUCT_ADDR = 0x400000 + STRUCT_OFF;
const STRING_OFF = 0x1d40;
const STRING_ADDR = 0x400000 + STRING_OFF;

function setupStruct(
  s: ReturnType<typeof emptyGameState>,
  col: number,
  tickOff: number,
  stringPtr: number,
): void {
  s.workRam[STRUCT_OFF + 0] = col & 0xff;
  s.workRam[STRUCT_OFF + 1] = tickOff & 0xff;
  s.workRam[STRUCT_OFF + 2] = (stringPtr >>> 24) & 0xff;
  s.workRam[STRUCT_OFF + 3] = (stringPtr >>> 16) & 0xff;
  s.workRam[STRUCT_OFF + 4] = (stringPtr >>> 8) & 0xff;
  s.workRam[STRUCT_OFF + 5] = stringPtr & 0xff;
}

describe("stateSub2DA0 (FUN_2DA0)", () => {
  it("string byte == 0 (terminator) → return 0, alphaRam unchanged", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    setupStruct(s, 0x10, 0x05, STRING_ADDR);
    s.workRam[STRING_OFF] = 0; // string[0] = terminator
    s.workRam[ROTATION_OFF] = 0;
    s.workRam[ROTATION_OFF + 1] = 0;

    // pre-fill alpha RAM with sentinel
    s.alphaRam.fill(0xcc);

    const ret = stateSub2DA0(s, rom, STRUCT_ADDR, 0);
    expect(ret).toBe(0);
    // alphaRam unchanged.
    for (let i = 0; i < s.alphaRam.length; i++) {
      expect(s.alphaRam[i]).toBe(0xcc);
    }
  });

  it("string byte != 0 with rotation=0 → return 4, clear word in alphaRam", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    // Inject ROM shift table @ 0x72a4..0x72ab (to replicate the real ROM).
    // For rotation=0, byte @ 0x72a5 = 0 → shiftCount=0
    rom.program[0x72a5] = 0x00;
    setupStruct(s, 1, 2, STRING_ADDR);
    s.workRam[STRING_OFF] = 0x41; // string[0] = 'A' (non-zero)
    s.workRam[ROTATION_OFF] = 0;
    s.workRam[ROTATION_OFF + 1] = 0;

    s.alphaRam.fill(0xcc);

    // Pre-calc alpha pos:
    //   D3 = sext(2) << 6 = 128
    //   D0 = (sext(1) + 0) << 0 = 1
    //   D0 += D3 = 129
    //   D0 *= 2 = 258
    //   alpha_addr = 0xa03000 + 258
    const ret = stateSub2DA0(s, rom, STRUCT_ADDR, 0);
    expect(ret).toBe(4);
    expect(s.alphaRam[258]).toBe(0);
    expect(s.alphaRam[259]).toBe(0);
    // Adjacent bytes intact
    expect(s.alphaRam[257]).toBe(0xcc);
    expect(s.alphaRam[260]).toBe(0xcc);
  });

  it("rotation != 0 → D3 = 0x29 - sext(tickOff), alternative formula path", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    // rotation=1 → byte @ 0x72a7 = 0x06 → shift count = 6
    rom.program[0x72a7] = 0x06;
    setupStruct(s, 0, 0, STRING_ADDR);
    s.workRam[STRING_OFF] = 0x42; // non-zero
    s.workRam[ROTATION_OFF] = 0;
    s.workRam[ROTATION_OFF + 1] = 1;

    s.alphaRam.fill(0xcc);

    // D3 = 0x29 - 0 = 0x29 = 41
    // D0 = (0 + 0) << 6 = 0
    // D0 += D3 = 41
    // D0 *= 2 = 82
    const ret = stateSub2DA0(s, rom, STRUCT_ADDR, 0);
    expect(ret).toBe(4);
    expect(s.alphaRam[82]).toBe(0);
    expect(s.alphaRam[83]).toBe(0);
  });

  it("arg2 byte advances within the string: stringPtr + arg2", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    rom.program[0x72a5] = 0x00; // shift = 0 for rotation=0
    setupStruct(s, 0, 0, STRING_ADDR);
    s.workRam[STRING_OFF + 0] = 0x41;
    s.workRam[STRING_OFF + 1] = 0x42;
    s.workRam[STRING_OFF + 2] = 0; // terminator @ index 2

    s.workRam[ROTATION_OFF] = 0;
    s.workRam[ROTATION_OFF + 1] = 0;

    // arg2=0: reads string[0]=0x41 -> return 4.
    expect(stateSub2DA0(s, rom, STRUCT_ADDR, 0)).toBe(4);
    // arg2=1: reads string[1]=0x42 -> return 4.
    expect(stateSub2DA0(s, rom, STRUCT_ADDR, 1)).toBe(4);
    // arg2=2: reads string[2]=0 -> return 0.
    expect(stateSub2DA0(s, rom, STRUCT_ADDR, 2)).toBe(0);
  });

  it("negative col (signed): sext propagates correctly", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    rom.program[0x72a5] = 0x00;
    setupStruct(s, 0xff, 0, STRING_ADDR); // col = -1 signed
    s.workRam[STRING_OFF] = 0x41;
    s.workRam[ROTATION_OFF] = 0;
    s.workRam[ROTATION_OFF + 1] = 0;

    s.alphaRam.fill(0xcc);

    // D3 = 0 << 6 = 0
    // D0 = (-1 + 0) << 0 = -1
    // D0 += 0 = -1
    // D0 *= 2 = -2
    // alpha_addr = 0xa03000 + (-2 wraps via >>> 0) → 0xa02ffe (NOT in alpha RAM)
    // -> clearAlphaWord no-op (out-of-bounds), alphaRam unchanged.
    const ret = stateSub2DA0(s, rom, STRUCT_ADDR, 0);
    expect(ret).toBe(4);
    for (let i = 0; i < 16; i++) {
      expect(s.alphaRam[i]).toBe(0xcc);
    }
  });
});
