/**
 * Test formatHex (FUN_3A08).
 *
 * Bit-perfect verificato vs binary (1000/1000) tramite
 * `cli/src/test-string-format-parity.ts`.
 */

import { describe, it, expect } from "vitest";
import { formatHex } from "../src/string-format.js";
import { emptyGameState } from "../src/state.js";

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

  it("value=0, digits=4, no spaces: '0\\0' a bufEnd-1", () => {
    const s = emptyGameState();
    formatHex(s, 0, 0x401D00, 4, 0);
    // bufEnd=0x401D00, digits=4. Funzione scrive: bufEnd+4 = 0 (NUL),
    // poi siccome value==0: *(--A0) = '0', D0 -= 1.
    // Quindi: bufEnd+3='0' (=0x30), bufEnd+4=0
    expect(s.workRam[0x1D00 + 3]).toBe(0x30); // '0'
    expect(s.workRam[0x1D00 + 4]).toBe(0); // NUL
  });

  it("value=0xABCD, digits=4: ASCII 'ABCD' a bufEnd..bufEnd+3", () => {
    const s = emptyGameState();
    formatHex(s, 0xABCD, 0x401D00, 4, 0);
    expect(s.workRam[0x1D00 + 0]).toBe(0x41); // 'A'
    expect(s.workRam[0x1D00 + 1]).toBe(0x42); // 'B'
    expect(s.workRam[0x1D00 + 2]).toBe(0x43); // 'C'
    expect(s.workRam[0x1D00 + 3]).toBe(0x44); // 'D'
    expect(s.workRam[0x1D00 + 4]).toBe(0); // NUL
  });

  it("value=0x12345678, digits=8: scrive 8 cifre", () => {
    const s = emptyGameState();
    formatHex(s, 0x12345678, 0x401D00, 8, 0);
    expect(readBytes(s, 0x401D00, 9)).toBe("12345678\\x00");
  });

  it("value=0x10, digits=4, showSpaces=1: leading zeros → spaces", () => {
    const s = emptyGameState();
    formatHex(s, 0x10, 0x401D00, 4, 1);
    // 0x10 = "  10" con spaces leading
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
