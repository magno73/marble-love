import { describe, expect, it } from "vitest";

import { emptyRomImage } from "../src/bus.js";
import {
  LEVEL_DISPATCHER_HELPER_18FD0_ADDR,
  levelDispatcherHelper18FD0,
} from "../src/level-dispatcher-helper-18fd0.js";
import { emptyGameState } from "../src/state.js";

function writeWord(buf: Uint8Array, off: number, value: number): void {
  buf[off] = (value >>> 8) & 0xff;
  buf[off + 1] = value & 0xff;
}

function writeLong(buf: Uint8Array, off: number, value: number): void {
  buf[off] = (value >>> 24) & 0xff;
  buf[off + 1] = (value >>> 16) & 0xff;
  buf[off + 2] = (value >>> 8) & 0xff;
  buf[off + 3] = value & 0xff;
}

describe("levelDispatcherHelper18FD0 (FUN_18FD0)", () => {
  it("exposes the binary entry address", () => {
    expect(LEVEL_DISPATCHER_HELPER_18FD0_ADDR).toBe(0x18fd0);
  });

  it("expands workRam source pairs into row args", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    writeLong(s.workRam, 0x0474, 0x00401000);
    writeLong(s.workRam, 0x100c, 0x00401100);
    writeWord(s.workRam, 0x1100, 2);
    writeWord(s.workRam, 0x1102, 0x1234);
    writeWord(s.workRam, 0x1104, 1);
    writeWord(s.workRam, 0x1106, 0xabcd);
    writeWord(s.workRam, 0x1108, 0);

    levelDispatcherHelper18FD0(s, rom);

    expect(Array.from(s.workRam.slice(0x0478, 0x047e))).toEqual([0x12, 0x34, 0x12, 0x34, 0xab, 0xcd]);
  });

  it("reads descriptor and source from ROM absolute pointers", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    writeLong(s.workRam, 0x0474, 0x00030000);
    writeLong(rom.program, 0x3000c, 0x00030100);
    writeWord(rom.program, 0x30100, 3);
    writeWord(rom.program, 0x30102, 0x00ef);
    writeWord(rom.program, 0x30104, 0);

    levelDispatcherHelper18FD0(s, rom);

    expect(Array.from(s.workRam.slice(0x0478, 0x047e))).toEqual([0, 0xef, 0, 0xef, 0, 0xef]);
  });
});
