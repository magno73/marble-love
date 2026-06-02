/**
 * state-sub-2abc.test.ts — smoke + corner case of FUN_2ABC.
 */

import { describe, it, expect } from "vitest";
import { stateSub2ABC } from "../src/state-sub-2abc.js";
import { emptyGameState } from "../src/state.js";
import { emptyRomImage } from "../src/bus.js";

const VAL_F00_OFF = 0x1f00;
const ROTATION_OFF = 0x1f42;
const STRUCT_OFF = 0x1d00;
const STRUCT_ADDR = 0x400000 + STRUCT_OFF;
const STRING_OFF = 0x1d40;
const STRING_ADDR = 0x400000 + STRING_OFF;

function setupStruct(
  s: ReturnType<typeof emptyGameState>,
  col: number,
  tickOff: number,
  stringPtr: number,
  marker: number,
  nextPtr: number,
): void {
  s.workRam[STRUCT_OFF + 0] = col & 0xff;
  s.workRam[STRUCT_OFF + 1] = tickOff & 0xff;
  s.workRam[STRUCT_OFF + 2] = (stringPtr >>> 24) & 0xff;
  s.workRam[STRUCT_OFF + 3] = (stringPtr >>> 16) & 0xff;
  s.workRam[STRUCT_OFF + 4] = (stringPtr >>> 8) & 0xff;
  s.workRam[STRUCT_OFF + 5] = stringPtr & 0xff;
  s.workRam[STRUCT_OFF + 6] = marker & 0xff;
  s.workRam[STRUCT_OFF + 7] = 0;
  s.workRam[STRUCT_OFF + 8] = (nextPtr >>> 24) & 0xff;
  s.workRam[STRUCT_OFF + 9] = (nextPtr >>> 16) & 0xff;
  s.workRam[STRUCT_OFF + 10] = (nextPtr >>> 8) & 0xff;
  s.workRam[STRUCT_OFF + 11] = nextPtr & 0xff;
}

function setupRomTables(
  rom: ReturnType<typeof emptyRomImage>,
): void {
  // 0x72A0..0x72AB
  rom.program[0x72a0] = 0x00; rom.program[0x72a1] = 0x01; // stride[0]=1
  rom.program[0x72a2] = 0x00; rom.program[0x72a3] = 0x40; // stride[1]=64
  rom.program[0x72a4] = 0x00; rom.program[0x72a5] = 0x00; // shift[0]=0 / stride[2]=0
  rom.program[0x72a6] = 0x00; rom.program[0x72a7] = 0x06; // shift[1]=6 / stride[3]=6
  rom.program[0x72a8] = 0x00; rom.program[0x72a9] = 0x00; // shift[2]=0
  rom.program[0x72aa] = 0x00; rom.program[0x72ab] = 0x80; // shift[3]=128
}

describe("stateSub2ABC (FUN_2ABC)", () => {
  it("does not raise exceptions on a minimal struct (empty string, no chain)", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    setupRomTables(rom);
    s.workRam[STRING_OFF] = 0; // empty string
    setupStruct(s, 0, 0, STRING_ADDR, 0, 0);
    s.workRam[VAL_F00_OFF] = 0;
    s.workRam[VAL_F00_OFF + 1] = 0;
    s.workRam[ROTATION_OFF] = 0;
    s.workRam[ROTATION_OFF + 1] = 0;

    expect(() => stateSub2ABC(s, rom, STRUCT_ADDR)).not.toThrow();
  });

  it("non-empty string with rotation=0 → clear word in alphaRam", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    setupRomTables(rom);
    // Struct: col=1, tickOff=2, stringPtr → string "AB"+0
    setupStruct(s, 1, 2, STRING_ADDR, 0, 0);
    s.workRam[STRING_OFF + 0] = 0x41; // 'A'
    s.workRam[STRING_OFF + 1] = 0x42; // 'B'
    s.workRam[STRING_OFF + 2] = 0;    // terminator
    s.workRam[VAL_F00_OFF] = 0;
    s.workRam[VAL_F00_OFF + 1] = 0;
    s.workRam[ROTATION_OFF] = 0;
    s.workRam[ROTATION_OFF + 1] = 0;

    s.alphaRam.fill(0xcc);

    // rot=0:
    //   D2 = 2 << 6 = 128
    //   shift = byte @ 0x72A5 = 0
    //   D0 = 1 << 0 = 1
    //   D0 += 128 = 129
    //   D0 *= 2 = 258
    //   a3 = 0xA03000 + 258
    //   stride = word @ 0x72A0 = 1; a3 += 2*1 = 2 per char
    // char 'A' at offset 258 → clr word
    // char 'B' at offset 260 → clr word
    stateSub2ABC(s, rom, STRUCT_ADDR);

    expect(s.alphaRam[258]).toBe(0);
    expect(s.alphaRam[259]).toBe(0);
    expect(s.alphaRam[260]).toBe(0);
    expect(s.alphaRam[261]).toBe(0);
    // Adjacent untouched
    expect(s.alphaRam[257]).toBe(0xcc);
    expect(s.alphaRam[262]).toBe(0xcc);
  });

  it("chain walk: marker + VAL_F00 > 1 → follows *(A0+8)", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    setupRomTables(rom);

    const STRUCT2_OFF = 0x1d20;
    const STRUCT2_ADDR = 0x400000 + STRUCT2_OFF;
    const STRING2_OFF = 0x1d60;
    const STRING2_ADDR = 0x400000 + STRING2_OFF;

    setupStruct(s, 0, 0, STRING_ADDR, 2, STRUCT2_ADDR);
    s.workRam[STRING_OFF + 0] = 0x58; // 'X'
    s.workRam[STRING_OFF + 1] = 0;

    // entry 2
    s.workRam[STRUCT2_OFF + 0] = 0;
    s.workRam[STRUCT2_OFF + 1] = 0;
    s.workRam[STRUCT2_OFF + 2] = (STRING2_ADDR >>> 24) & 0xff;
    s.workRam[STRUCT2_OFF + 3] = (STRING2_ADDR >>> 16) & 0xff;
    s.workRam[STRUCT2_OFF + 4] = (STRING2_ADDR >>> 8) & 0xff;
    s.workRam[STRUCT2_OFF + 5] = STRING2_ADDR & 0xff;
    s.workRam[STRUCT2_OFF + 6] = 0; // marker=0 → end
    s.workRam[STRING2_OFF + 0] = 0x59; // 'Y'
    s.workRam[STRING2_OFF + 1] = 0;

    s.workRam[VAL_F00_OFF] = 0;
    s.workRam[VAL_F00_OFF + 1] = 0;
    s.workRam[ROTATION_OFF] = 0;
    s.workRam[ROTATION_OFF + 1] = 0;

    s.alphaRam.fill(0xcc);

    // entry 1: D2=0, shift=0, D0=0, *2=0 → a3=0xA03000+0 → alpha[0..1]=0
    stateSub2ABC(s, rom, STRUCT_ADDR);
    expect(s.alphaRam[0]).toBe(0);
    expect(s.alphaRam[1]).toBe(0);
    // infinite loop means the chain-walk + termination works).
  });

  it("rotation != 0 → D2 = 0x29 - sext(tickOff), alternative formula path", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    setupRomTables(rom);
    setupStruct(s, 0, 0, STRING_ADDR, 0, 0);
    s.workRam[STRING_OFF + 0] = 0x42; // non-zero
    s.workRam[STRING_OFF + 1] = 0;
    s.workRam[VAL_F00_OFF] = 0;
    s.workRam[VAL_F00_OFF + 1] = 0;
    s.workRam[ROTATION_OFF] = 0;
    s.workRam[ROTATION_OFF + 1] = 1; // rot = 1

    s.alphaRam.fill(0xcc);

    // rot=1:
    //   D2 = 0x29 - 0 = 41
    //   shift = byte @ 0x72A7 = 0x06 → 6
    //   D0 = (0 << 6) = 0
    //   D0 += 41 = 41
    //   D0 *= 2 = 82
    //   a3 = 0xA03000 + 82
    stateSub2ABC(s, rom, STRUCT_ADDR);
    expect(s.alphaRam[82]).toBe(0);
    expect(s.alphaRam[83]).toBe(0);
    // Adjacent untouched
    expect(s.alphaRam[81]).toBe(0xcc);
  });

  it("negative col (signed): sext propagates, addr outside alpha → no-op", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    setupRomTables(rom);
    setupStruct(s, 0xff, 0, STRING_ADDR, 0, 0); // col = -1 signed
    s.workRam[STRING_OFF + 0] = 0x41;
    s.workRam[STRING_OFF + 1] = 0;
    s.workRam[VAL_F00_OFF] = 0;
    s.workRam[VAL_F00_OFF + 1] = 0;
    s.workRam[ROTATION_OFF] = 0;
    s.workRam[ROTATION_OFF + 1] = 0;

    s.alphaRam.fill(0xcc);

    // rot=0: D2 = 0 << 6 = 0, shift=0, D0 = -1 << 0 = -1, +0=-1, *2=-2
    stateSub2ABC(s, rom, STRUCT_ADDR);
    for (let i = 0; i < 16; i++) {
      expect(s.alphaRam[i]).toBe(0xcc);
    }
  });

  it("safety bound: self-referential chain does not cause a hang", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    setupRomTables(rom);
    // Struct with marker=2 + nextPtr = STRUCT_ADDR (cyclic chain).
    setupStruct(s, 0, 0, STRING_ADDR, 2, STRUCT_ADDR);
    s.workRam[STRING_OFF + 0] = 0x41;
    s.workRam[STRING_OFF + 1] = 0;
    s.workRam[VAL_F00_OFF] = 0;
    s.workRam[VAL_F00_OFF + 1] = 0;
    s.workRam[ROTATION_OFF] = 0;
    s.workRam[ROTATION_OFF + 1] = 0;

    // Must not hang: the internal safety cap (1024) interrupts the loop.
    expect(() => stateSub2ABC(s, rom, STRUCT_ADDR)).not.toThrow();
  });
});
