import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { ROM_AVAILABLE } from "./_rom-fixture.js";

import { loadRomBlob } from "../src/m68k/apply-slapstic-bank.js";
import { bootInit } from "../src/boot-init.js";
import { emptyRomImage } from "../src/bus.js";
import { tick } from "../src/index.js";
import { emptyGameState } from "../src/state.js";

interface Snapshot {
  slapsticBank?: number;
  workRam: string;
  playfieldRam: string;
  spriteRam: string;
  alphaRam: string;
  colorRam: string;
}

interface Scenario {
  snapshots: Snapshot[];
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

function nonzero(bytes: Uint8Array): number {
  let total = 0;
  for (const b of bytes) if (b !== 0) total++;
  return total;
}

describe.skipIf(!ROM_AVAILABLE)("playable lower-platform respawn", () => {
  it("does not leave the marble stuck in the state-1 tumble path", () => {
    const scenario = JSON.parse(
      readFileSync(resolve("oracle/scenarios/playable/coin_start_to_level1.json"), "utf-8"),
    ) as Scenario;
    const seed = scenario.snapshots[0];
    expect(seed).toBeDefined();
    if (seed === undefined) return;

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

    // Browser manual START uses this playable dispatcher state.
    state.workRam[0x390] = 0;
    state.workRam[0x391] = 0;
    state.clock.mainLoopBodyTicks = 1;

    let p1X = state.workRam[0x18 + 0xc9] ?? 0xff;
    let p1Y = state.workRam[0x18 + 0xc8] ?? 0xff;

    const plan: string[] = [];
    for (const [dir, count] of [
      ["D", 171],
      ["R", 206],
      ["L", 188],
      ["DL", 107],
      ["N", 80],
      ["U", 80],
      ["U", 80],
      ["N", 220],
    ] as const) {
      for (let i = 0; i < count; i++) plan.push(dir);
    }

    const deltas: Record<string, readonly [number, number]> = {
      D: [0, 8],
      R: [8, 0],
      L: [-8, 0],
      U: [0, -8],
      DL: [-8, 8],
      N: [0, 0],
    };

    let sawState1 = false;
    for (const step of plan) {
      const [screenDx, screenDy] = deltas[step] ?? [0, 0];
      p1X = (p1X + (screenDx !== 0 ? -screenDx : 0)) & 0xff;
      p1Y = (p1Y + (screenDy !== 0 ? -screenDy : 0)) & 0xff;
      tick(state, {
        rom,
        runMainLoopBody: true,
        p1X,
        p1Y,
        p2X: 0xff,
        p2Y: 0xff,
        inputMmio: 0x6f,
      });

      sawState1 ||= (state.workRam[0x18 + 0x1a] ?? 0) === 1;
    }

    expect(sawState1).toBe(true);
    expect(state.workRam[0x18 + 0x1a]).toBe(0);
    expect(readLongBE(state.workRam, 0x462)).toBe(244);
    expect(readLongBE(state.workRam, 0x466)).toBe(268);
    expect(state.videoScrollY).toBeLessThanOrEqual(90);
    expect(nonzero(state.playfieldRam)).toBeGreaterThan(4000);
  });
});
