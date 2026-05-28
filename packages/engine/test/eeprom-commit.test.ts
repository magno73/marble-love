/**
 * eeprom-commit.test.ts — smoke tests di `eepromCommit` (FUN_3F78).
 *
 * Verify the three main branches (early exit, drain with zero iters, drain with
 * iter > 0 + clamp) and the invariant "in the early-exit path workRam does not change".
 *
 * Bit-perfect parity (500 random cases) verified in
 * `packages/cli/src/test-eeprom-commit-parity.ts` vs l'oracle Musashi.
 */

import { describe, it, expect } from "vitest";
import { eepromCommit } from "../src/eeprom-commit.js";
import { emptyGameState } from "../src/state.js";

const PTR_OFF = 0x1ffc;
const FF5_OFF = 0x1ff5;
const FF7_OFF = 0x1ff7;

/** Helper: writes a big-endian long into workRam. */
function writeLongBE(ram: Uint8Array, off: number, val: number): void {
  ram[off] = (val >>> 24) & 0xff;
  ram[off + 1] = (val >>> 16) & 0xff;
  ram[off + 2] = (val >>> 8) & 0xff;
  ram[off + 3] = val & 0xff;
}

/** Helper: sets status byte + complement byte on the struct pointed to by A2. */
function setStatus(ram: Uint8Array, ptrOff: number, status: number): void {
  ram[ptrOff + 0xa] = status & 0xff;
  ram[ptrOff + 0xb] = ~status & 0xff;
}

describe("eepromCommit (FUN_3F78)", () => {
  it("status >= 0xE0 -> early exit, ritorna 0x18 e NON modifica 0x401FF5/F7", () => {
    const s = emptyGameState();
    const ptr = 0x401d00;
    writeLongBE(s.workRam, PTR_OFF, ptr);
    setStatus(s.workRam, ptr - 0x400000, 0xe5); // >= 0xE0 -> helper torna 0
    s.workRam[FF5_OFF] = 0x42;
    s.workRam[FF7_OFF] = 0x77;

    const r = eepromCommit(s);
    expect(r).toBe(0x18);
    // Early-exit path: no touch.
    expect(s.workRam[FF5_OFF]).toBe(0x42);
    expect(s.workRam[FF7_OFF]).toBe(0x77);
  });

  it("complement mismatch (status != ~complByte) -> status forzato a 0; D1=1; computazione normale", () => {
    const s = emptyGameState();
    const ptr = 0x401d00;
    const ptrOff = ptr - 0x400000;
    writeLongBE(s.workRam, PTR_OFF, ptr);
    // status non-complementare -> validato a 0 -> D1 = (0 & 3) + 1 = 1.
    s.workRam[ptrOff + 0xa] = 0x55;
    s.workRam[ptrOff + 0xb] = 0x55; // ~0x55 = 0xAA != 0x55 -> mismatch
    s.workRam[FF5_OFF] = 0x10;
    s.workRam[FF7_OFF] = 0x05; // 5 iter (sub 1 ciascuna)

    const r = eepromCommit(s);
    // Drain: counter 5 -> 0 (5 iter), acc 0x10 + 5 = 0x15 (<=0x19, no clamp)
    expect(s.workRam[FF7_OFF]).toBe(0);
    expect(s.workRam[FF5_OFF]).toBe(0x15);
    // result = (0x15 * 12) / 1 = 0xFC
    expect(r).toBe(0xfc);
  });

  it("D1=4, drain finisce con counter < D1 (no underflow byte)", () => {
    const s = emptyGameState();
    const ptr = 0x401d00;
    const ptrOff = ptr - 0x400000;
    writeLongBE(s.workRam, PTR_OFF, ptr);
    setStatus(s.workRam, ptrOff, 0x07); // (7 & 3) + 1 = 4
    s.workRam[FF5_OFF] = 0x00;
    s.workRam[FF7_OFF] = 0x0a; // 10/4 = 2 iter, resto 2

    const r = eepromCommit(s);
    expect(s.workRam[FF7_OFF]).toBe(2);
    expect(s.workRam[FF5_OFF]).toBe(8);
    // result = (8 * 12) / 4 = 24
    expect(r).toBe(24);
  });

  it("clamp a 0x19: acc che supera 0x19 viene clampato e poi scalato", () => {
    const s = emptyGameState();
    const ptr = 0x401d00;
    const ptrOff = ptr - 0x400000;
    writeLongBE(s.workRam, PTR_OFF, ptr);
    setStatus(s.workRam, ptrOff, 0x00); // D1 = 1
    s.workRam[FF5_OFF] = 0x18; // 24
    s.workRam[FF7_OFF] = 0x05; // drena 5 -> acc=0x18+5=0x1D > 0x19 -> clamp 0x19

    const r = eepromCommit(s);
    expect(s.workRam[FF7_OFF]).toBe(0);
    expect(s.workRam[FF5_OFF]).toBe(0x19); // clamped
    // result = (0x19 * 12) / 1 = 300 = 0x12C; word low = 0x12C.
    expect(r).toBe(0x12c);
  });

  it("counter < divisor a inizio loop: zero iter, acc invariato, result = (acc*12)/D1", () => {
    const s = emptyGameState();
    const ptr = 0x401d00;
    const ptrOff = ptr - 0x400000;
    writeLongBE(s.workRam, PTR_OFF, ptr);
    setStatus(s.workRam, ptrOff, 0x03); // (3 & 3) + 1 = 4
    s.workRam[FF5_OFF] = 0x05;
    s.workRam[FF7_OFF] = 0x02; // 2 < 4 -> 0 iter

    const r = eepromCommit(s);
    expect(s.workRam[FF7_OFF]).toBe(2); // unchanged
    expect(s.workRam[FF5_OFF]).toBe(5); // unchanged
    // result = (5 * 12) / 4 = 15
    expect(r).toBe(15);
  });

  it("status = 0xDF (sotto soglia per 1 byte): D1 = (0xDF & 3) + 1 = 4", () => {
    const s = emptyGameState();
    const ptr = 0x401d00;
    const ptrOff = ptr - 0x400000;
    writeLongBE(s.workRam, PTR_OFF, ptr);
    setStatus(s.workRam, ptrOff, 0xdf); // 0xDF < 0xE0
    s.workRam[FF5_OFF] = 0;
    s.workRam[FF7_OFF] = 0;

    const r = eepromCommit(s);
    // counter=0 < D1=4 -> 0 iter; acc=0; result = 0*12/4 = 0
    expect(r).toBe(0);
  });

  it("status = 0xE0 esatto: helper ritorna 0 -> early exit 0x18", () => {
    const s = emptyGameState();
    const ptr = 0x401d00;
    const ptrOff = ptr - 0x400000;
    writeLongBE(s.workRam, PTR_OFF, ptr);
    setStatus(s.workRam, ptrOff, 0xe0);
    s.workRam[FF5_OFF] = 0x09;
    s.workRam[FF7_OFF] = 0x10;

    const r = eepromCommit(s);
    expect(r).toBe(0x18);
    expect(s.workRam[FF5_OFF]).toBe(0x09);
    expect(s.workRam[FF7_OFF]).toBe(0x10);
  });
});
