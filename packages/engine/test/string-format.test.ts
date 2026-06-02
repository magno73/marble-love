/**
 * Test formatHex (FUN_3A08) + setAlphaTile (FUN_3784).
 *
 * Bit-perfect verified vs binary via `cli/src/test-string-format-parity.ts`.
 */

import { describe, it, expect } from "vitest";
import { formatHex, setAlphaTile, strcpy } from "../src/string-format.js";
import { emptyGameState } from "../src/state.js";
import { emptyRomImage } from "../src/bus.js";

describe("formatHex (FUN_3A08)", () => {
  function readBytes(s: ReturnType<typeof emptyGameState>, addr: number, n: number): string {
    const off = addr - 0x400000;
    const bytes: string[] = [];
    for (let i = 0; i < n; i++) {
      const b = s.workRam[off + i] ?? 0;
      bytes.push(b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : `\\x${b.toString(16).padStart(2, "0")}`);
    }
    return bytes.join("");
  }

  it("value=0, digits=4, no spaces: '0\\0' at bufEnd-1", () => {
    const s = emptyGameState();
    formatHex(s, 0, 0x401D00, 4, 0);
    // bufEnd=0x401D00, digits=4. Function writes: bufEnd+4 = 0 (NUL),
    // then since value==0: *(--A0) = '0', D0 -= 1.
    // So: bufEnd+3='0' (=0x30), bufEnd+4=0
    expect(s.workRam[0x1D00 + 3]).toBe(0x30); // '0'
    expect(s.workRam[0x1D00 + 4]).toBe(0); // NUL
  });

  it("value=0xABCD, digits=4: ASCII 'ABCD' at bufEnd..bufEnd+3", () => {
    const s = emptyGameState();
    formatHex(s, 0xABCD, 0x401D00, 4, 0);
    expect(s.workRam[0x1D00 + 0]).toBe(0x41); // 'A'
    expect(s.workRam[0x1D00 + 1]).toBe(0x42); // 'B'
    expect(s.workRam[0x1D00 + 2]).toBe(0x43); // 'C'
    expect(s.workRam[0x1D00 + 3]).toBe(0x44); // 'D'
    expect(s.workRam[0x1D00 + 4]).toBe(0); // NUL
  });

  it("value=0x12345678, digits=8: writes 8 digits", () => {
    const s = emptyGameState();
    formatHex(s, 0x12345678, 0x401D00, 8, 0);
    expect(readBytes(s, 0x401D00, 9)).toBe("12345678\\x00");
  });

  it("value=0x10, digits=4, showSpaces=1: leading zeros → spaces", () => {
    const s = emptyGameState();
    formatHex(s, 0x10, 0x401D00, 4, 1);
    // 0x10 = "  10" with leading spaces.
    expect(s.workRam[0x1D00 + 0]).toBe(0x20); // ' '
    expect(s.workRam[0x1D00 + 1]).toBe(0x20); // ' '
    expect(s.workRam[0x1D00 + 2]).toBe(0x31); // '1'
    expect(s.workRam[0x1D00 + 3]).toBe(0x30); // '0'
  });

  it("value=0x10, digits=4, showSpaces=0: leading zeros stay", () => {
    const s = emptyGameState();
    formatHex(s, 0x10, 0x401D00, 4, 0);
    expect(s.workRam[0x1D00 + 0]).toBe(0x30); // '0'
    expect(s.workRam[0x1D00 + 1]).toBe(0x30); // '0'
    expect(s.workRam[0x1D00 + 2]).toBe(0x31); // '1'
    expect(s.workRam[0x1D00 + 3]).toBe(0x30); // '0'
  });
});

describe("setAlphaTile (FUN_3784)", () => {
  it("non-rotation mode (rotFlag=0): col*shift + row*64", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    // rotFlag = 0 → use lookup table[1] for shift count
    s.workRam[0x1f42] = 0; s.workRam[0x1f43] = 0;
    rom.program[0x72a4 + 1] = 0; // shift 0 → arg1 << 0 = arg1
    // arg1=2, arg2=3, arg3=0xF000, arg4=0x00BB
    // d3 = 3 << 6 = 192
    // d0 = 2 << 0 = 2
    // d0 = (2 + 192) * 2 = 388 = 0x184
    // dest = 0xA03000 + 0x184 = 0xA03184 → alphaRam[0x184]
    setAlphaTile(s, rom, 2, 3, 0xF000, 0x00BB);
    expect(((s.alphaRam[0x184] ?? 0) << 8) | (s.alphaRam[0x185] ?? 0)).toBe(0xF0BB);
  });

  it("OR of arg3 + arg4 word", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    s.workRam[0x1f42] = 0; s.workRam[0x1f43] = 0;
    rom.program[0x72a5] = 0;
    setAlphaTile(s, rom, 0, 0, 0x1000, 0x002A);
    // d3=0, d0=0, dest = 0xA03000 → alphaRam[0]. value = 0x1000 | 0x002A = 0x102A
    expect(((s.alphaRam[0] ?? 0) << 8) | (s.alphaRam[1] ?? 0)).toBe(0x102A);
  });
});

describe("strcpy (FUN_1D74)", () => {
  it("copies a string with null terminator (workRam → workRam)", () => {
    const s = emptyGameState();
    const SRC = 0x401D00;
    const DST = 0x401E00;
    // Write "HELLO\0" in src
    const msg = "HELLO";
    for (let i = 0; i < msg.length; i++) {
      s.workRam[(SRC - 0x400000) + i] = msg.charCodeAt(i);
    }
    s.workRam[(SRC - 0x400000) + msg.length] = 0;

    strcpy(s, null, DST, SRC);

    for (let i = 0; i < msg.length; i++) {
      expect(s.workRam[(DST - 0x400000) + i]).toBe(msg.charCodeAt(i));
    }
    // Null terminator copied
    expect(s.workRam[(DST - 0x400000) + msg.length]).toBe(0);
  });

  it("empty string: copies only the null", () => {
    const s = emptyGameState();
    const SRC = 0x401D00;
    const DST = 0x401E00;
    s.workRam[(SRC - 0x400000)] = 0;
    s.workRam[(DST - 0x400000)] = 0xFF; // pre-fill destination

    strcpy(s, null, DST, SRC);

    expect(s.workRam[(DST - 0x400000)]).toBe(0);
  });

  it("reads from ROM if src < 0x80000", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    rom.program[0x1000] = 0x41; // 'A'
    rom.program[0x1001] = 0x42; // 'B'
    rom.program[0x1002] = 0;

    const DST = 0x401E00;
    strcpy(s, rom, DST, 0x1000);

    expect(s.workRam[(DST - 0x400000)]).toBe(0x41);
    expect(s.workRam[(DST - 0x400000) + 1]).toBe(0x42);
    expect(s.workRam[(DST - 0x400000) + 2]).toBe(0);
  });
});
