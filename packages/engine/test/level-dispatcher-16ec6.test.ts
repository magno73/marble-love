import { describe, expect, it } from "vitest";

import { emptyRomImage } from "../src/bus.js";
import { emptyGameState } from "../src/state.js";
import {
  LEVEL_DISPATCHER_16EC6_ADDR,
  levelDispatcher16EC6,
} from "../src/level-dispatcher-16ec6.js";

function writeRomWord(rom: ReturnType<typeof emptyRomImage>, off: number, value: number): void {
  rom.program[off] = (value >>> 8) & 0xff;
  rom.program[off + 1] = value & 0xff;
}

function writeRomLong(rom: ReturnType<typeof emptyRomImage>, off: number, value: number): void {
  rom.program[off] = (value >>> 24) & 0xff;
  rom.program[off + 1] = (value >>> 16) & 0xff;
  rom.program[off + 2] = (value >>> 8) & 0xff;
  rom.program[off + 3] = value & 0xff;
}

function readLong(buf: Uint8Array, off: number): number {
  return (
    (((buf[off] ?? 0) << 24) |
      ((buf[off + 1] ?? 0) << 16) |
      ((buf[off + 2] ?? 0) << 8) |
      (buf[off + 3] ?? 0)) >>>
    0
  );
}

describe("levelDispatcher16EC6 (FUN_16EC6)", () => {
  it("exposes the binary entry address", () => {
    expect(LEVEL_DISPATCHER_16EC6_ADDR).toBe(0x16ec6);
  });

  it("selects level descriptor tables and writes observable globals", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    const statePtr = 0x0002c000;

    s.workRam[0x0395] = 2;
    s.workRam[0x0664] = 0xfe;
    s.workRam[0x0665] = 0xdc;
    writeRomLong(rom, 0x2be00 + 2 * 4, statePtr);
    writeRomWord(rom, 0x239a0 + 2 * 2, 0x8001);
    writeRomWord(rom, 0x239ac + 2 * 2, 0x1234);
    writeRomWord(rom, statePtr + 0x10, 0xc0d0);
    writeRomLong(rom, statePtr + 0x26, 0x0008087e);

    const calls: string[] = [];
    levelDispatcher16EC6(s, rom, {
      fun_2ffb8: (arg) => calls.push(`2ffb8:${arg}`),
      fun_2ff28: (arg) => calls.push(`2ff28:${arg}`),
      fun_18fd0: () => calls.push("18fd0"),
      fun_1a444: () => calls.push("1a444"),
    });

    expect(readLong(s.workRam, 0x0474)).toBe(statePtr);
    expect(readLong(s.workRam, 0x065a)).toBe(0x0008087e);
    expect(s.workRam[0x0662]).toBe(0x80);
    expect(s.workRam[0x0663]).toBe(0x01);
    expect(s.workRam[0x0664]).toBe(0x12);
    expect(s.workRam[0x0665]).toBe(0x34);
    expect(readLong(s.workRam, 0x097c)).toBe(0xffffc0d0);
    expect(calls).toEqual(["2ffb8:-32767", "2ff28:-292", "18fd0", "1a444"]);
  });

  it("adds descriptor +0x12 only for level index 4", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    const statePtr = 0x0002d000;

    s.workRam[0x0395] = 4;
    writeRomLong(rom, 0x2be00 + 4 * 4, statePtr);
    writeRomWord(rom, statePtr + 0x10, 0x0010);
    writeRomWord(rom, statePtr + 0x12, 0xfff0);

    levelDispatcher16EC6(s, rom, { fun_1a444: () => undefined });

    expect(readLong(s.workRam, 0x097c)).toBe(0);
  });
});
