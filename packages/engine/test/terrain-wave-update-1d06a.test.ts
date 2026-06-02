import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { ROM_AVAILABLE } from "./_rom-fixture.js";

import { emptyRomImage } from "../src/bus.js";
import { loadRomBlob } from "../src/m68k/apply-slapstic-bank.js";
import { emptyGameState } from "../src/state.js";
import { terrainWaveUpdate1D06A } from "../src/terrain-wave-update-1d06a.js";

const ALT_TERRAIN_OFF = 0x76e;
const ALT_TERRAIN_LEN = 0x42;

type ExpectedWords = readonly (readonly [number, number])[];

const EXPECTED: readonly { arg: number; words: ExpectedWords }[] = [
  {
    arg: 0,
    words: [
      [0x76e, 0x9ac2],
      [0x770, 0xf012],
      [0x772, 0x9f92],
      [0x774, 0x9ad2],
      [0x776, 0xf022],
      [0x778, 0x9fa2],
      [0x77a, 0x9ac6],
      [0x77c, 0xf016],
      [0x77e, 0x9f96],
      [0x780, 0x9ab6],
      [0x782, 0xf006],
      [0x784, 0x9f86],
    ],
  },
  {
    arg: 8,
    words: [
      [0x76e, 0x9ab6],
      [0x770, 0xf006],
      [0x772, 0x9f86],
      [0x774, 0x9ac6],
      [0x776, 0xf016],
      [0x778, 0x9f96],
      [0x77a, 0x9ad2],
      [0x77c, 0xf022],
      [0x77e, 0x9fa2],
      [0x780, 0x9ac2],
      [0x782, 0xf012],
      [0x784, 0x9f92],
    ],
  },
  {
    arg: 15,
    words: [
      [0x77a, 0x9abe],
      [0x77c, 0xf00e],
      [0x77e, 0x9f8e],
      [0x780, 0x9ace],
      [0x782, 0xf01e],
      [0x784, 0x9f9e],
      [0x786, 0x9aca],
      [0x788, 0xf01a],
      [0x78a, 0x0140],
      [0x78c, 0x9aba],
      [0x78e, 0xf00a],
      [0x790, 0x928a],
    ],
  },
  {
    arg: 16,
    words: [
      [0x77a, 0x9aba],
      [0x77c, 0xf00a],
      [0x77e, 0x9f8a],
      [0x780, 0x9aca],
      [0x782, 0xf01a],
      [0x784, 0x9f9a],
      [0x786, 0x9ace],
      [0x788, 0xf01e],
      [0x78a, 0x0144],
      [0x78c, 0x9abe],
      [0x78e, 0xf00e],
      [0x790, 0x940e],
    ],
  },
  {
    arg: 29,
    words: [
      [0x78c, 0x9ab6],
      [0x78e, 0xf006],
      [0x790, 0x9086],
      [0x792, 0x9ac6],
      [0x794, 0xf016],
      [0x796, 0x0164],
      [0x798, 0x9ad2],
      [0x79a, 0xf022],
      [0x79c, 0x9fa2],
      [0x79e, 0x9ac2],
      [0x7a0, 0xf012],
      [0x7a2, 0x9f92],
    ],
  },
  {
    arg: 30,
    words: [
      [0x792, 0x9ac2],
      [0x794, 0xf012],
      [0x796, 0x0160],
      [0x798, 0x9ad2],
      [0x79a, 0xf022],
      [0x79c, 0x9fa2],
      [0x79e, 0x9ac6],
      [0x7a0, 0xf016],
      [0x7a2, 0x9f96],
      [0x7a4, 0x9ab6],
      [0x7a6, 0xf006],
      [0x7a8, 0x9f86],
    ],
  },
];

function loadRom() {
  const rom = emptyRomImage();
  loadRomBlob(rom, readFileSync(resolve("ghidra_project/marble_program.bin")));
  return rom;
}

function readWord(buf: Uint8Array, off: number): number {
  return (((buf[off] ?? 0) << 8) | (buf[off + 1] ?? 0)) & 0xffff;
}

function expectedMap(words: ExpectedWords): Map<number, number> {
  return new Map(words.map(([off, value]) => [off, value]));
}

describe.skipIf(!ROM_AVAILABLE)("terrainWaveUpdate1D06A", () => {
  it("matches original FUN_1D06A terrain-table writes for green wave phases", () => {
    const rom = loadRom();

    for (const { arg, words } of EXPECTED) {
      const state = emptyGameState();
      state.workRam.fill(0xaa, ALT_TERRAIN_OFF, ALT_TERRAIN_OFF + ALT_TERRAIN_LEN);

      terrainWaveUpdate1D06A(state, rom, arg);

      const expected = expectedMap(words);
      for (let off = ALT_TERRAIN_OFF; off < ALT_TERRAIN_OFF + ALT_TERRAIN_LEN; off += 2) {
        const expectedWord = expected.get(off);
        if (expectedWord === undefined) {
          expect(readWord(state.workRam, off), `arg ${arg} off ${off.toString(16)}`).toBe(0xaaaa);
        } else {
          expect(readWord(state.workRam, off), `arg ${arg} off ${off.toString(16)}`).toBe(expectedWord);
        }
      }
    }
  });
});
