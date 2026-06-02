import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { ROM_AVAILABLE } from "./_rom-fixture.js";

import { emptyRomImage } from "../src/bus.js";
import { loadRomBlob } from "../src/m68k/apply-slapstic-bank.js";
import { mainLoopInit1101E } from "../src/main-loop-init-1101e.js";
import { emptyGameState } from "../src/state.js";

function writeWordBE(bytes: Uint8Array, off: number, value: number): void {
  bytes[off] = (value >>> 8) & 0xff;
  bytes[off + 1] = value & 0xff;
}

function readWordBE(bytes: Uint8Array, off: number): number {
  return (((bytes[off] ?? 0) << 8) | (bytes[off + 1] ?? 0)) & 0xffff;
}

function nonzero(bytes: Uint8Array): number {
  let count = 0;
  for (const b of bytes) if (b !== 0) count++;
  return count;
}

describe.skipIf(!ROM_AVAILABLE)("level-end score summary runtime wiring", () => {
  it("renders the level-complete score text and holds before the next level rebuild", () => {
    const rom = emptyRomImage();
    loadRomBlob(rom, readFileSync(resolve("ghidra_project/marble_program.bin")));
    const state = emptyGameState();

    writeWordBE(state.workRam, 0x390, 3);
    writeWordBE(state.workRam, 0x394, 0);
    writeWordBE(state.workRam, 0x396, 1);
    state.workRam[0x18 + 0x18] = 3;
    writeWordBE(state.workRam, 0x18 + 0x6a, 31);

    mainLoopInit1101E(state, rom);

    expect(readWordBE(state.workRam, 0x390)).toBe(3);
    expect(readWordBE(state.workRam, 0x394)).toBe(1);
    expect(state.clock.levelEndScoreResumePending).toBe(1);
    expect(state.clock.mainThreadWaitDelay).toBe(0x28);
    expect(nonzero(state.alphaRam)).toBeGreaterThan(0);
    expect(state.workRam[0x18 + 0x71]).toBe(0xff);
    expect(state.workRam[0x18 + 0x70]).toBe(0);
  });
});
