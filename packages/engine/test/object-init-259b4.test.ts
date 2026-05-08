import { describe, expect, it } from "vitest";
import { emptyRomImage } from "../src/bus.js";
import { objectInit259B4, OBJECT_INIT_259B4_ADDR } from "../src/object-init-259b4.js";
import { emptyGameState } from "../src/state.js";

function writeU16(bytes: Uint8Array, off: number, value: number): void {
  bytes[off] = (value >>> 8) & 0xff;
  bytes[off + 1] = value & 0xff;
}

function writeU32(bytes: Uint8Array, off: number, value: number): void {
  bytes[off] = (value >>> 24) & 0xff;
  bytes[off + 1] = (value >>> 16) & 0xff;
  bytes[off + 2] = (value >>> 8) & 0xff;
  bytes[off + 3] = value & 0xff;
}

function readU32(bytes: Uint8Array, off: number): number {
  return ((((bytes[off] ?? 0) << 24) |
    ((bytes[off + 1] ?? 0) << 16) |
    ((bytes[off + 2] ?? 0) << 8) |
    (bytes[off + 3] ?? 0)) >>> 0);
}

describe("objectInit259B4 (FUN_000259B4)", () => {
  it("normalizes inactive slots to state byte zero", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    writeU16(s.workRam, 0x396, 2);
    s.workRam[0x18 + 0x18] = 2;
    s.workRam[0xfa + 0x18] = 0xff;

    objectInit259B4(s, rom);

    expect(s.workRam[0x18 + 0x18]).toBe(0);
    expect(s.workRam[0xfa + 0x18]).toBe(0);
  });

  it("initializes an active slot from descriptor packed bytes", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    writeU16(s.workRam, 0x394, 3);
    writeU16(s.workRam, 0x396, 1);
    writeU32(s.workRam, 0x474, 0x00400800);
    writeU16(s.workRam, 0x800 + 0x14, 0x1234);
    s.workRam[0x18 + 0x18] = 3;
    s.workRam[0x18 + 0x19] = 0;

    objectInit259B4(s, rom, {
      fun_1bab2: () => undefined,
      fun_1cc62: () => 0xabcdef01,
      fun_25b40: () => undefined,
      fun_1b9cc: () => undefined,
      fun_1c014: () => undefined,
      fun_1281c: () => undefined,
      fun_18e6c: () => undefined,
    });

    expect(s.workRam[0x18 + 0x18]).toBe(1);
    expect(readU32(s.workRam, 0x18 + 0x0c)).toBe(0x00940000);
    expect(readU32(s.workRam, 0x18 + 0x10)).toBe(0x01a40000);
    expect(readU32(s.workRam, 0x18 + 0x14)).toBe(0xabcdef01);
    expect(s.workRam[0x18 + 0x58]).toBe(0x17);
    expect(s.workRam[0x18 + 0x59]).toBe(0xff);
    expect(s.workRam[0x18 + 0x6c]).toBe(9);
    expect(s.workRam[0x18 + 0x6e]).toBe(0xff);
  });

  it("exposes the binary entry address", () => {
    expect(OBJECT_INIT_259B4_ADDR).toBe(0x259b4);
  });
});
