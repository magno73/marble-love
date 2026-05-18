import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { loadRomBlob } from "../src/m68k/apply-slapstic-bank.js";
import { bootInit } from "../src/boot-init.js";
import { emptyRomImage } from "../src/bus.js";
import { tick } from "../src/index.js";
import { emptyGameState } from "../src/state.js";

interface Seed {
  slapsticBank?: number;
  workRam: string;
  playfieldRam: string;
  spriteRam: string;
  alphaRam: string;
  colorRam: string;
}

function hexToBytes(hex: string, expectedLength: number): Uint8Array {
  expect(hex.length).toBe(expectedLength * 2);
  const out = new Uint8Array(expectedLength);
  for (let i = 0; i < expectedLength; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function readLongBE(bytes: Uint8Array, off: number): number {
  return (
    (((bytes[off] ?? 0) << 24) |
      ((bytes[off + 1] ?? 0) << 16) |
      ((bytes[off + 2] ?? 0) << 8) |
      (bytes[off + 3] ?? 0)) >>>
    0
  );
}

describe("L5 Silly Race live terrain", () => {
  it("updates the player surface on the MAME D route instead of floating on stale flat terrain", () => {
    const seed = JSON.parse(
      readFileSync(
        resolve("packages/web/public/scenarios/playable/candidate_level5_postseed_dl_f3520.seed.json"),
        "utf-8",
      ),
    ) as Seed;

    const rom = emptyRomImage();
    loadRomBlob(rom, readFileSync(resolve("ghidra_project/marble_program.bin")));

    const state = emptyGameState();
    bootInit(state, rom, {
      warmState: {
        workRam: hexToBytes(seed.workRam, 0x2000),
        playfieldRam: hexToBytes(seed.playfieldRam, 0x2000),
        spriteRam: hexToBytes(seed.spriteRam, 0x1000),
        alphaRam: hexToBytes(seed.alphaRam, 0x1000),
        colorRam: hexToBytes(seed.colorRam, 0x800),
        slapsticBank: seed.slapsticBank ?? 1,
      },
    });

    state.workRam[0x390] = 0;
    state.workRam[0x391] = 0;
    state.clock.mainLoopBodyTicks = 1;

    let p1X = state.workRam[0x18 + 0xc9] ?? 0xff;
    let p1Y = state.workRam[0x18 + 0xc8] ?? 0xff;

    for (let frame = 1; frame <= 180; frame++) {
      if (frame <= 60) {
        p1X = (p1X - 4) & 0xff;
        p1Y = (p1Y + 4) & 0xff;
      }
      tick(state, {
        rom,
        runMainLoopBody: true,
        p1X,
        p1Y,
        p2X: 0xff,
        p2Y: 0xff,
        inputMmio: 0x6f,
      });
    }

    expect(state.workRam[0x18 + 0x1a]).toBe(4);
    expect(readLongBE(state.workRam, 0x18 + 0x0c)).toBe(1004 * 0x10000);
    expect(readLongBE(state.workRam, 0x18 + 0x10)).toBe(980 * 0x10000);
    expect(readLongBE(state.workRam, 0x18 + 0x14)).toBe(16168 * 0x10000);
  });
});
