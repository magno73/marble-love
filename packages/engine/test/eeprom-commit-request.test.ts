/**
 * eeprom-commit-request.test.ts — smoke tests di `eepromCommitRequest`
 * (FUN_3FC6).
 *
 * Verify the three return branches (early-1 without side effects, fail-0 with
 * 1 eepromCommit, success-1 with 1 eepromCommit + decrement) + invariants.
 *
 * Bit-perfect parity (500 random cases) verified in
 * `packages/cli/src/test-eeprom-commit-request-parity.ts` vs Musashi.
 */

import { describe, it, expect } from "vitest";
import { eepromCommitRequest } from "../src/eeprom-commit-request.js";
import { emptyGameState } from "../src/state.js";

const PTR_OFF = 0x1ffc;
const FF5_OFF = 0x1ff5;
const FF7_OFF = 0x1ff7;

function writeLongBE(ram: Uint8Array, off: number, val: number): void {
  ram[off] = (val >>> 24) & 0xff;
  ram[off + 1] = (val >>> 16) & 0xff;
  ram[off + 2] = (val >>> 8) & 0xff;
  ram[off + 3] = val & 0xff;
}

function setStatus(ram: Uint8Array, ptrOff: number, status: number): void {
  ram[ptrOff + 0xa] = status & 0xff;
  ram[ptrOff + 0xb] = ~status & 0xff;
}

describe("eepromCommitRequest (FUN_3FC6)", () => {
  it("status >= 0xE0 -> rate=0, (arg.w * 0) = 0 -> path #1: ritorna 1, NESSUN side effect", () => {
    const s = emptyGameState();
    const ptr = 0x401d00;
    writeLongBE(s.workRam, PTR_OFF, ptr);
    setStatus(s.workRam, ptr - 0x400000, 0xe5); // helper -> 0
    s.workRam[FF5_OFF] = 0x42;
    s.workRam[FF7_OFF] = 0x77;

    const r = eepromCommitRequest(s, 0x1234);
    expect(r).toBe(1);
    // Nessuna jsr a FUN_3F78 -> contatori invariati.
    expect(s.workRam[FF5_OFF]).toBe(0x42);
    expect(s.workRam[FF7_OFF]).toBe(0x77);
  });

  it("arg.w == 0 -> path #1 indipendentemente dal rate: ritorna 1, NESSUN side effect", () => {
    const s = emptyGameState();
    const ptr = 0x401d00;
    writeLongBE(s.workRam, PTR_OFF, ptr);
    setStatus(s.workRam, ptr - 0x400000, 0x05); // rate = 2
    s.workRam[FF5_OFF] = 0x10;
    s.workRam[FF7_OFF] = 0x08;

    const r = eepromCommitRequest(s, 0); // arg.w = 0
    expect(r).toBe(1);
    expect(s.workRam[FF7_OFF]).toBe(0x08);
    expect(s.workRam[FF5_OFF]).toBe(0x10);
  });

  it("path #2 (budget < arg*12 signed) -> ritorna 0, 1 sola jsr a FUN_3F78 (drain), no decremento", () => {
    // status = 0 -> rate = 1. arg = 0x100 -> arg*12 = 0x1200.
    // eepromCommit with counter=0x10, acc=0, divisor=1: drain 16 iters ->
    //   counter=0, acc=16, no clamp. result = 16*12/1 = 192 = 0xC0.
    // 0xC0 (= 192) < 0x1200 (= 4608) -> path #2: returns 0, no further
    // decremento.
    const s = emptyGameState();
    const ptr = 0x401d00;
    writeLongBE(s.workRam, PTR_OFF, ptr);
    setStatus(s.workRam, ptr - 0x400000, 0x00);
    s.workRam[FF5_OFF] = 0x00;
    s.workRam[FF7_OFF] = 0x10;

    const r = eepromCommitRequest(s, 0x100);
    expect(r).toBe(0);
    // Side effects della singola eepromCommit:
    expect(s.workRam[FF7_OFF]).toBe(0);
    expect(s.workRam[FF5_OFF]).toBe(16);
  });

  it("path #3 (budget >= arg*12 signed) -> ritorna 1, decrementa 0x401FF5 di (arg.w*rate.w).b", () => {
    // status = 0 -> rate = 1. arg = 1 -> arg*12 = 12.
    // eepromCommit with counter=4, acc=0, divisor=1: drain 4 iters ->
    //   counter=0, acc=4, no clamp. result = 4*12/1 = 48 = 0x30.
    // 0x30 (= 48) >= 12 -> path #3.
    // D3.b = (1 * 1) & 0xFF = 0x01. acc' = (4 - 1) & 0xFF = 3.
    const s = emptyGameState();
    const ptr = 0x401d00;
    writeLongBE(s.workRam, PTR_OFF, ptr);
    setStatus(s.workRam, ptr - 0x400000, 0x00);
    s.workRam[FF5_OFF] = 0x00;
    s.workRam[FF7_OFF] = 0x04;

    const r = eepromCommitRequest(s, 1);
    expect(r).toBe(1);
    expect(s.workRam[FF5_OFF]).toBe(3); // (4 - 1) mod 256
    expect(s.workRam[FF7_OFF]).toBe(0);
  });

  it("arg.w = 0xa96a, status=0x55 (rate=2): path #3 con D3.b = 0xD4 (replica caso parity)", () => {
    // Exact replica of a failure case observed during development.
    // arg.w = 0xa96a, status=0x55 -> rate=(0x55&3)+1=2.
    // mulu.w: D3.l = 0xa96a * 2 = 0x152D4. D3.w = 0x52D4 != 0 -> path #2/#3.
    // eepromCommit: counter=9, acc=0xba, divisor=2: drain 4 iter ->
    //   counter=1, acc=0xc2 -> clamp 0x19. result = 0x19*12/2 = 150 = 0x96.
    // signext(0xa96a) = -22166. * 12 = -266000 (signed long).
    // 0x96 (= 150) >= -266000 -> path #3.
    // D3.b = 0x152D4 & 0xFF = 0xD4. acc' = (0x19 - 0xD4) & 0xFF = 0x45.
    const s = emptyGameState();
    const ptr = 0x401d00;
    writeLongBE(s.workRam, PTR_OFF, ptr);
    setStatus(s.workRam, ptr - 0x400000, 0x55);
    s.workRam[FF5_OFF] = 0xba;
    s.workRam[FF7_OFF] = 0x09;

    const r = eepromCommitRequest(s, 0x55d8a96a);
    expect(r).toBe(1);
    expect(s.workRam[FF5_OFF]).toBe(0x45);
    expect(s.workRam[FF7_OFF]).toBe(0x01);
  });

  it("solo la low word di arg viene letta (high word del long ignorata)", () => {
    // arg = 0x12340000: low word = 0 -> path #1 (arg.w * rate.w = 0).
    const s = emptyGameState();
    const ptr = 0x401d00;
    writeLongBE(s.workRam, PTR_OFF, ptr);
    setStatus(s.workRam, ptr - 0x400000, 0x00);
    s.workRam[FF5_OFF] = 0x10;
    s.workRam[FF7_OFF] = 0x04;

    const r = eepromCommitRequest(s, 0x12340000);
    expect(r).toBe(1);
    // Path #1: no call to FUN_3F78 -> counters unchanged.
    expect(s.workRam[FF7_OFF]).toBe(0x04);
    expect(s.workRam[FF5_OFF]).toBe(0x10);
  });

  it("(arg.w * rate.w) low word == 0 con arg.w != 0 -> path #1", () => {
    // arg.w = 0x8000, rate = 2 (status=0x05): mulu.w = 0x10000. low word 0.
    const s = emptyGameState();
    const ptr = 0x401d00;
    writeLongBE(s.workRam, PTR_OFF, ptr);
    setStatus(s.workRam, ptr - 0x400000, 0x05);
    s.workRam[FF5_OFF] = 0x05;
    s.workRam[FF7_OFF] = 0x05;

    const r = eepromCommitRequest(s, 0x8000);
    expect(r).toBe(1);
    // Path #1: no call to eepromCommit.
    expect(s.workRam[FF5_OFF]).toBe(0x05);
    expect(s.workRam[FF7_OFF]).toBe(0x05);
  });
});
