import { describe, expect, it } from "vitest";
import { emptyRomImage } from "../src/bus.js";
import { levelInit16F6C, LEVEL_INIT_16F6C_ADDR } from "../src/level-init-16f6c.js";
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

describe("levelInit16F6C (FUN_00016F6C)", () => {
  it("dispatches 32 decode rows for normal mode", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    writeU32(s.workRam, 0x474, 0x00030000);
    writeU32(rom.program, 0x30004, 0x00031000);
    writeU32(rom.program, 0x3002a, 0x00032000);
    writeU16(s.workRam, 0x662, 2);
    writeU16(s.workRam, 0x664, 3);
    for (let i = 0; i < 0x40; i += 2) writeU16(rom.program, 0x31000 + i, i / 2);
    for (let i = 0; i < 0x20; i++) rom.program[0x32000 + i] = i;

    const slapArgs: number[] = [];
    const tableArgs: number[] = [];
    const decodeArgs: Array<[number, number, number]> = [];
    levelInit16F6C(s, rom, {
      fun_2ffb8: (arg) => slapArgs.push(arg),
      fun_2ff40: (arg) => tableArgs.push(arg),
      fun_1a668: (out, ctrl, ext) => decodeArgs.push([out, ctrl, ext]),
    });

    expect(slapArgs).toEqual([3, 2]);
    expect(tableArgs).toEqual([2]);
    expect(decodeArgs).toHaveLength(0x20);
    expect(decodeArgs[0]).toEqual([0x00a00006, 0x000800e4, 0x0002be18]);
    expect(decodeArgs[31]).toEqual([0x00a00f86, 0x00080103, 0x0002be37]);
  });

  it("mode 4 starts one wrapped row earlier and dispatches 33 rows", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    writeU16(s.workRam, 0x394, 4);
    writeU32(s.workRam, 0x474, 0x00030000);
    writeU32(rom.program, 0x30004, 0x00031000);
    writeU32(rom.program, 0x3002a, 0x00032000);
    writeU16(rom.program, 0x30012, 0x0010);
    for (let i = 0; i < 0x44; i += 2) writeU16(rom.program, 0x31000 + i, i / 2);
    for (let i = 0; i < 0x22; i++) rom.program[0x32000 + i] = i;

    const decodeArgs: Array<[number, number, number]> = [];
    levelInit16F6C(s, rom, {
      fun_2ffb8: () => undefined,
      fun_2ff40: () => undefined,
      fun_1a668: (out, ctrl, ext) => decodeArgs.push([out, ctrl, ext]),
    });

    expect(decodeArgs).toHaveLength(0x21);
    expect(decodeArgs[0]?.[0]).toBe(0x00a01f86);
    expect(decodeArgs[1]?.[0]).toBe(0x00a00006);
    expect(decodeArgs[0]?.[1]).toBe(0x000800e5);
    expect(decodeArgs[0]?.[2]).toBe(0x0002be19);
  });

  it("exposes the binary entry address", () => {
    expect(LEVEL_INIT_16F6C_ADDR).toBe(0x16f6c);
  });
});
