import { describe, it, expect } from "vitest";
import { emptyGameState } from "../src/state.js";
import { emptyRomImage } from "../src/bus.js";
import { STRCPY_1D74_ADDR, strcpy1D74 } from "../src/strcpy-1d74.js";

describe("FUN_1D74 strcpy1D74", () => {
  it("exposes the binary address", () => {
    expect(STRCPY_1D74_ADDR).toBe(0x1d74);
  });

  it("copies a null-terminated string from ROM to workRam", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    // Setup "ABC\0" @ ROM 0x10000
    rom.program[0x10000] = 0x41; // 'A'
    rom.program[0x10001] = 0x42; // 'B'
    rom.program[0x10002] = 0x43; // 'C'
    rom.program[0x10003] = 0x00;

    const written = strcpy1D74(s, rom, 0x00400100, 0x00010000);

    expect(written).toBe(4); // 3 chars + null
    expect(s.workRam[0x100]).toBe(0x41);
    expect(s.workRam[0x101]).toBe(0x42);
    expect(s.workRam[0x102]).toBe(0x43);
    expect(s.workRam[0x103]).toBe(0x00);
    expect(s.workRam[0x104]).toBe(0x00); // untouched
  });

  it("copies a string workRam → workRam (both in workRam range)", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    s.workRam[0x500] = 0x48; // 'H'
    s.workRam[0x501] = 0x49; // 'I'
    s.workRam[0x502] = 0x00;

    const written = strcpy1D74(s, rom, 0x00400600, 0x00400500);

    expect(written).toBe(3);
    expect(s.workRam[0x600]).toBe(0x48);
    expect(s.workRam[0x601]).toBe(0x49);
    expect(s.workRam[0x602]).toBe(0x00);
  });

  it("first byte zero → copies only the null", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    rom.program[0x20000] = 0x00;

    const written = strcpy1D74(s, rom, 0x00400100, 0x00020000);

    expect(written).toBe(1);
    expect(s.workRam[0x100]).toBe(0x00);
  });

  it("safety bound (256 bytes) for non-terminated strings", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    // Fill 300 non-zero bytes in ROM
    for (let i = 0; i < 300; i++) rom.program[0x30000 + i] = 0xff;

    const written = strcpy1D74(s, rom, 0x00400100, 0x00030000);

    expect(written).toBe(256); // MAX_LEN
    expect(s.workRam[0x100]).toBe(0xff);
    expect(s.workRam[0x100 + 255]).toBe(0xff);
  });

  it("dst outside workRam → no-op (graceful)", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    rom.program[0x10000] = 0x41;
    const written = strcpy1D74(s, rom, 0x00500000, 0x00010000);
    expect(written).toBe(0);
    expect(s.workRam[0]).toBe(0);
  });
});
