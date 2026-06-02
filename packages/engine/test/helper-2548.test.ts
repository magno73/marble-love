/**
 * helper-2548.test.ts — smoke test per helper2548 (FUN_00002548).
 *
 * **Semantica**: LSR.W su *0x400006 (workRam[0x0006..0x0007]).
 *
 * `packages/cli/src/test-helper-2548-parity.ts` vs Musashi.
 */

import { describe, it, expect } from "vitest";
import {
  helper2548,
  LSR_FLAG_OFF,
  HELPER_2548_ADDR,
  FUN_00002548,
} from "../src/helper-2548.js";
import { emptyGameState } from "../src/state.js";

function readWordBE(workRam: Uint8Array, off: number): number {
  return (((workRam[off] ?? 0) << 8) | (workRam[off + 1] ?? 0)) & 0xffff;
}

function writeWordBE(workRam: Uint8Array, off: number, val: number): void {
  workRam[off] = (val >>> 8) & 0xff;
  workRam[off + 1] = val & 0xff;
}

describe("helper2548 (FUN_00002548) — smoke", () => {
  it("costanti esportate corrette", () => {
    expect(HELPER_2548_ADDR).toBe(0x00002548);
    expect(LSR_FLAG_OFF).toBe(0x0006);
  });

  it("alias FUN_00002548 is identico a helper2548", () => {
    expect(FUN_00002548).toBe(helper2548);
  });

  it("word=0x0001: bit 0 set → returns 1, word diventa 0x0000", () => {
    const s = emptyGameState();
    writeWordBE(s.workRam, LSR_FLAG_OFF, 0x0001);
    const result = helper2548(s);
    expect(result).toBe(1);
    expect(readWordBE(s.workRam, LSR_FLAG_OFF)).toBe(0x0000);
  });

  it("word=0x0000: bit 0 clear → returns 0, word stays 0x0000", () => {
    const s = emptyGameState();
    writeWordBE(s.workRam, LSR_FLAG_OFF, 0x0000);
    const result = helper2548(s);
    expect(result).toBe(0);
    expect(readWordBE(s.workRam, LSR_FLAG_OFF)).toBe(0x0000);
  });

  it("word=0x0002: bit 0 clear → returns 0, word diventa 0x0001", () => {
    const s = emptyGameState();
    writeWordBE(s.workRam, LSR_FLAG_OFF, 0x0002);
    const result = helper2548(s);
    expect(result).toBe(0);
    expect(readWordBE(s.workRam, LSR_FLAG_OFF)).toBe(0x0001);
  });

  it("word=0xFFFF: bit 0 set → returns 1, word diventa 0x7FFF (MSB becomes 0)", () => {
    const s = emptyGameState();
    writeWordBE(s.workRam, LSR_FLAG_OFF, 0xffff);
    const result = helper2548(s);
    expect(result).toBe(1);
    expect(readWordBE(s.workRam, LSR_FLAG_OFF)).toBe(0x7fff);
  });

  it("word=0xFFFE: bit 0 clear → returns 0, word diventa 0x7FFF", () => {
    const s = emptyGameState();
    writeWordBE(s.workRam, LSR_FLAG_OFF, 0xfffe);
    const result = helper2548(s);
    expect(result).toBe(0);
    expect(readWordBE(s.workRam, LSR_FLAG_OFF)).toBe(0x7fff);
  });

  it("word=0x8000: bit 0 clear → returns 0, word diventa 0x4000 (LSR is logico, MSB=0)", () => {
    const s = emptyGameState();
    writeWordBE(s.workRam, LSR_FLAG_OFF, 0x8000);
    const result = helper2548(s);
    expect(result).toBe(0);
    expect(readWordBE(s.workRam, LSR_FLAG_OFF)).toBe(0x4000);
  });

  it("word=0x0003: bit 0 set → returns 1, word diventa 0x0001", () => {
    const s = emptyGameState();
    writeWordBE(s.workRam, LSR_FLAG_OFF, 0x0003);
    const result = helper2548(s);
    expect(result).toBe(1);
    expect(readWordBE(s.workRam, LSR_FLAG_OFF)).toBe(0x0001);
  });

  it("shift multipli: consuma bit 0 poi bit 1 (as shift register)", () => {
    const s = emptyGameState();
    // word = 0b00000101 = 5: bit0=1, bit1=0, bit2=1
    writeWordBE(s.workRam, LSR_FLAG_OFF, 0x0005);

    expect(helper2548(s)).toBe(1);
    expect(readWordBE(s.workRam, LSR_FLAG_OFF)).toBe(0x0002);

    expect(helper2548(s)).toBe(0);
    expect(readWordBE(s.workRam, LSR_FLAG_OFF)).toBe(0x0001);

    expect(helper2548(s)).toBe(1);
    expect(readWordBE(s.workRam, LSR_FLAG_OFF)).toBe(0x0000);

    expect(helper2548(s)).toBe(0);
    expect(readWordBE(s.workRam, LSR_FLAG_OFF)).toBe(0x0000);
  });

  it("non tocca byte outside da workRam[0x0006..0x0007] (no side-effect collaterali)", () => {
    const s = emptyGameState();
    s.workRam.fill(0xa5);
    writeWordBE(s.workRam, LSR_FLAG_OFF, 0x0001);

    helper2548(s);

    // Byte adiacenti intact
    expect(s.workRam[LSR_FLAG_OFF - 1]).toBe(0xa5);
    expect(s.workRam[LSR_FLAG_OFF + 2]).toBe(0xa5);
    expect(s.workRam[0x0100]).toBe(0xa5);
  });

  it("simulazione spin-wait: 8 bit of 0x00FF consumed correttamente", () => {
    const s = emptyGameState();
    // 0x00FF = 0b11111111: 8 × bit-1 in posizioni 0..7
    writeWordBE(s.workRam, LSR_FLAG_OFF, 0x00ff);

    // Le prime 8 call alternano: bit0=1, poi shift rivela bit1=1, etc.
    for (let i = 0; i < 8; i++) {
      expect(helper2548(s)).toBe(1);
    }
    expect(readWordBE(s.workRam, LSR_FLAG_OFF)).toBe(0x0000);

    expect(helper2548(s)).toBe(0);
  });

  it("word=0x5555 (0b0101...): alternanza 1,0,1,0 per i first 4 bit", () => {
    const s = emptyGameState();
    writeWordBE(s.workRam, LSR_FLAG_OFF, 0x5555); // 0b0101010101010101

    const results: number[] = [];
    for (let i = 0; i < 4; i++) results.push(helper2548(s));

    expect(results).toEqual([1, 0, 1, 0]);
  });
});
