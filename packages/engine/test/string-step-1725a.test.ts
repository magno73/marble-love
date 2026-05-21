import { describe, expect, it } from "vitest";
import { emptyRomImage } from "../src/bus.js";
import type { RomImage } from "../src/bus.js";
import { emptyGameState } from "../src/state.js";
import type { GameState } from "../src/state.js";
import { stringStep1725A } from "../src/string-step-1725a.js";

const WRAM = 0x400000;
const SLOT = 0x401482;
const SLOT_OFF = SLOT - WRAM;

function writeLong(state: GameState, off: number, value: number): void {
  const v = value >>> 0;
  state.workRam[off] = (v >>> 24) & 0xff;
  state.workRam[off + 1] = (v >>> 16) & 0xff;
  state.workRam[off + 2] = (v >>> 8) & 0xff;
  state.workRam[off + 3] = v & 0xff;
}

function readLong(state: GameState, off: number): number {
  return (
    (((state.workRam[off] ?? 0) << 24) |
      ((state.workRam[off + 1] ?? 0) << 16) |
      ((state.workRam[off + 2] ?? 0) << 8) |
      (state.workRam[off + 3] ?? 0)) >>>
    0
  );
}

function writeRomByte(rom: RomImage, addr: number, value: number): void {
  rom.program[addr >>> 0] = value & 0xff;
}

function writeRomLong(rom: RomImage, addr: number, value: number): void {
  const v = value >>> 0;
  rom.program[addr >>> 0] = (v >>> 24) & 0xff;
  rom.program[(addr + 1) >>> 0] = (v >>> 16) & 0xff;
  rom.program[(addr + 2) >>> 0] = (v >>> 8) & 0xff;
  rom.program[(addr + 3) >>> 0] = v & 0xff;
}

describe("stringStep1725A (FUN_1725A)", () => {
  it("uses ROM waypoint bytes when the animation loop reaches a terminator", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();
    const pathCursor = 0x23f66;
    const animCursor = 0x24000;
    const animBase = 0x20ea4;

    state.workRam[SLOT_OFF + 0x18] = 1;
    state.workRam[SLOT_OFF + 0x24] = 0;
    state.workRam[SLOT_OFF + 0x25] = 0;
    writeLong(state, SLOT_OFF + 0x0c, 5 << 19);
    writeLong(state, SLOT_OFF + 0x10, 2 << 19);
    writeLong(state, SLOT_OFF + 0x2c, pathCursor);
    writeLong(state, SLOT_OFF + 0x30, pathCursor);
    writeLong(state, SLOT_OFF + 0x3a, animCursor);
    writeLong(state, SLOT_OFF + 0x3e, animBase);

    writeRomLong(rom, animCursor + 4, 0xffffffff);
    writeRomByte(rom, pathCursor + 0, 5);
    writeRomByte(rom, pathCursor + 1, 2);
    writeRomByte(rom, pathCursor + 2, 2);
    writeRomByte(rom, pathCursor + 8, 7);
    writeRomByte(rom, pathCursor + 9, 2);

    stringStep1725A(state, SLOT, rom);

    expect(readLong(state, SLOT_OFF + 0x2c)).toBe(pathCursor + 8);
    expect(readLong(state, SLOT_OFF + 0x00)).toBe(0x00080000);
    expect(readLong(state, SLOT_OFF + 0x04)).toBe(0x00000000);
    expect(readLong(state, SLOT_OFF + 0x3a)).toBe(animBase);
    expect(readLong(state, SLOT_OFF + 0x3e)).toBe(animBase);
  });
});
