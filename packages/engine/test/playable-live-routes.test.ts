import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { loadRomBlob } from "../src/m68k/apply-slapstic-bank.js";
import { bootInit } from "../src/boot-init.js";
import { emptyRomImage } from "../src/bus.js";
import { tick } from "../src/index.js";
import { emptyGameState, type GameState } from "../src/state.js";

interface PlayableSeed {
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

function nonzero(bytes: Uint8Array): number {
  let total = 0;
  for (const b of bytes) if (b !== 0) total++;
  return total;
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

function signedLong(value: number): number {
  return value | 0;
}

function readWordBE(bytes: Uint8Array, off: number): number {
  return (((bytes[off] ?? 0) << 8) | (bytes[off + 1] ?? 0)) & 0xffff;
}

function loadPlayableState(rom: ReturnType<typeof emptyRomImage>): GameState {
  const seed = JSON.parse(
    readFileSync(resolve("packages/web/public/scenarios/playable/manual_level1_start.seed.json"), "utf-8"),
  ) as PlayableSeed;

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
  state.clock.mainLoopBodyTicks = 1 as typeof state.clock.mainLoopBodyTicks;
  return state;
}

function expand(parts: readonly (readonly [string, number])[]): string[] {
  const out: string[] = [];
  for (const [dir, count] of parts) {
    for (let i = 0; i < count; i++) out.push(dir);
  }
  return out;
}

function pseudoRandomPlan(frames: number): string[] {
  const dirs = ["D", "R", "DR", "L", "DL", "U", "UR", "N"];
  const out: string[] = [];
  let x = 1;
  for (let i = 0; i < frames; i++) {
    x = (x * 1103515245 + 12345) >>> 0;
    out.push(dirs[(x >>> 28) % dirs.length] ?? "N");
  }
  return out;
}

describe("playable live route smoke", () => {
  it.each([
    [
      "first ramp death/respawn",
      expand([["D", 260], ["N", 500], ["D", 300], ["N", 400]]),
      80,
      { sawState: 4 },
    ],
    [
      "lower platform bridge",
      expand([["D", 171], ["R", 206], ["L", 188], ["DL", 107], ["BR", 260], ["R", 180], ["N", 300]]),
      90,
      { minMaxX: 300_000 },
    ],
    [
      "lower platform worm loops",
      expand([
        ["D", 171],
        ["R", 206],
        ["L", 188],
        ["DL", 120],
        ["R", 80],
        ["L", 80],
        ["DR", 80],
        ["DL", 80],
        ["U", 80],
        ["D", 80],
        ["N", 600],
      ]),
      90,
      {},
    ],
    ["mixed manual input", pseudoRandomPlan(2200), 40, {}],
  ] as const)("%s does not run away or empty the playfield", (_name, plan, maxScrollY, routeExpect) => {
    const rom = emptyRomImage();
    loadRomBlob(rom, readFileSync(resolve("ghidra_project/marble_program.bin")));
    const state = loadPlayableState(rom);

    let p1X = state.workRam[0x18 + 0xc9] ?? 0xff;
    let p1Y = state.workRam[0x18 + 0xc8] ?? 0xff;
    let maxObjX = Number.NEGATIVE_INFINITY;
    let sawExpectedState = routeExpect.sawState === undefined;
    const deltas: Record<string, readonly [number, number]> = {
      D: [0, 8],
      U: [0, -8],
      R: [8, 0],
      L: [-8, 0],
      DR: [8, 8],
      DL: [-8, 8],
      UR: [8, -8],
      BR: [4, -6],
      N: [0, 0],
    };

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

      maxObjX = Math.max(maxObjX, signedLong(readLongBE(state.workRam, 0x18)));
      if (routeExpect.sawState !== undefined && state.workRam[0x18 + 0x1a] === routeExpect.sawState) {
        sawExpectedState = true;
      }
      expect(state.videoScrollY).toBeLessThanOrEqual(maxScrollY);
      expect(nonzero(state.playfieldRam)).toBeGreaterThan(4000);
    }

    if (routeExpect.minMaxX !== undefined) {
      expect(maxObjX).toBeGreaterThan(routeExpect.minMaxX);
    }
    expect(sawExpectedState).toBe(true);
    expect(state.workRam[0x18 + 0x1a]).not.toBe(1);
  });

  it("time-out transition rebuilds the playfield instead of staying empty", () => {
    const rom = emptyRomImage();
    loadRomBlob(rom, readFileSync(resolve("ghidra_project/marble_program.bin")));
    const state = loadPlayableState(rom);

    const p1X = state.workRam[0x18 + 0xc9] ?? 0xff;
    const p1Y = state.workRam[0x18 + 0xc8] ?? 0xff;
    let emptyStart = -1;
    let emptyEnd = -1;
    let recoveredAt = -1;
    let sawTimedMode2 = false;
    let sawMode0Rebuild = false;

    for (let i = 0; i < 4320; i++) {
      tick(state, {
        rom,
        runMainLoopBody: true,
        p1X,
        p1Y,
        p2X: 0xff,
        p2Y: 0xff,
        inputMmio: 0x6f,
      });

      const pfCount = nonzero(state.playfieldRam);
      const mainState = readWordBE(state.workRam, 0x390);
      const mode = readWordBE(state.workRam, 0x392);
      sawTimedMode2 ||= mainState === 1 && mode === 2;
      sawMode0Rebuild ||= mainState === 1 && mode === 0;

      if (pfCount === 0) {
        if (emptyStart < 0) emptyStart = i;
        emptyEnd = i;
      } else if (emptyStart >= 0 && recoveredAt < 0 && pfCount > 4000) {
        recoveredAt = i;
      }
    }

    expect(sawTimedMode2).toBe(true);
    expect(sawMode0Rebuild).toBe(true);
    expect(emptyStart).toBeGreaterThanOrEqual(0);
    expect(emptyEnd - emptyStart).toBeLessThanOrEqual(16);
    expect(recoveredAt).toBeGreaterThan(emptyEnd);
    expect(recoveredAt).toBeLessThanOrEqual(4320);
    expect(nonzero(state.playfieldRam)).toBeGreaterThan(4000);
    expect(state.videoScrollY).toBeLessThanOrEqual(5);
    expect(state.workRam[0x18 + 0x1a]).not.toBe(6);
  });
});
