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

const screenDeltas: Record<string, readonly [number, number]> = {
  D: [0, 8],
  U: [0, -8],
  R: [8, 0],
  L: [-8, 0],
  DR: [8, 8],
  DL: [-8, 8],
  UR: [8, -8],
  UL: [-8, -8],
  BR: [4, -6],
  N: [0, 0],
};

function advanceTrackball(p1X: number, p1Y: number, step: string): readonly [number, number] {
  const [screenDx, screenDy] = screenDeltas[step] ?? [0, 0];
  return [(p1X + (screenDx !== 0 ? -screenDx : 0)) & 0xff, (p1Y + (screenDy !== 0 ? -screenDy : 0)) & 0xff];
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
      { minDeltaX: 1_000_000 },
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
    [
      "state-2 respawn recovery",
      expand([
        ["DL", 12],
        ["D", 43],
        ["UR", 9],
        ["DR", 54],
        ["U", 11],
        ["N", 55],
        ["BR", 8],
        ["U", 17],
        ["DL", 33],
        ["D", 18],
        ["N", 30],
        ["BR", 13],
        ["UL", 40],
        ["N", 13],
        ["R", 48],
        ["D", 8],
        ["BR", 25],
        ["UR", 8],
        ["U", 47],
        ["N", 35],
        ["DL", 40],
        ["BR", 31],
        ["UR", 8],
        ["BR", 21],
        ["DR", 25],
        ["DL", 32],
        ["R", 60],
        ["DR", 18],
        ["R", 20],
        ["UL", 46],
        ["L", 40],
        ["UL", 13],
        ["DL", 43],
        ["L", 107],
        ["DR", 55],
        ["UR", 23],
        ["D", 44],
        ["N", 19],
        ["R", 24],
        ["D", 27],
        ["UR", 27],
        ["D", 13],
        ["U", 21],
        ["UR", 16],
        ["N", 400],
      ]),
      170,
      { sawState: 2, finalState: 0 },
    ],
    ["mixed manual input", pseudoRandomPlan(2200), 40, {}],
  ] as const)("%s does not run away or empty the playfield", (_name, plan, maxScrollY, routeExpect) => {
    const rom = emptyRomImage();
    loadRomBlob(rom, readFileSync(resolve("ghidra_project/marble_program.bin")));
    const state = loadPlayableState(rom);

    let p1X = state.workRam[0x18 + 0xc9] ?? 0xff;
    let p1Y = state.workRam[0x18 + 0xc8] ?? 0xff;
    const initialObjX = signedLong(readLongBE(state.workRam, 0x18 + 0x0c));
    let maxObjX = Number.NEGATIVE_INFINITY;
    let sawExpectedState = routeExpect.sawState === undefined;

    for (const step of plan) {
      [p1X, p1Y] = advanceTrackball(p1X, p1Y, step);
      tick(state, {
        rom,
        runMainLoopBody: true,
        p1X,
        p1Y,
        p2X: 0xff,
        p2Y: 0xff,
        inputMmio: 0x6f,
      });

      maxObjX = Math.max(maxObjX, signedLong(readLongBE(state.workRam, 0x18 + 0x0c)));
      if (routeExpect.sawState !== undefined && state.workRam[0x18 + 0x1a] === routeExpect.sawState) {
        sawExpectedState = true;
      }
      expect(state.videoScrollY).toBeLessThanOrEqual(maxScrollY);
      expect(nonzero(state.playfieldRam)).toBeGreaterThan(4000);
    }

    if (routeExpect.minDeltaX !== undefined) {
      expect(maxObjX - initialObjX).toBeGreaterThan(routeExpect.minDeltaX);
    }
    expect(sawExpectedState).toBe(true);
    if (routeExpect.finalState !== undefined) {
      expect(state.workRam[0x18 + 0x1a]).toBe(routeExpect.finalState);
    }
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

  it("progresses through later timeout rebuilds without losing playable terrain", () => {
    const rom = emptyRomImage();
    loadRomBlob(rom, readFileSync(resolve("ghidra_project/marble_program.bin")));
    const state = loadPlayableState(rom);

    let p1X = state.workRam[0x18 + 0xc9] ?? 0xff;
    let p1Y = state.workRam[0x18 + 0xc8] ?? 0xff;
    let emptyRun = 0;
    let maxEmptyRun = 0;
    let state1Run = 0;
    let maxState1Run = 0;
    let maxScrollY = 0;
    let sawMode2AfterEarlyRoute = false;
    let sawSegment5 = false;
    let sawSegment7 = false;

    const plan = expand([
      ["D", 171],
      ["R", 206],
      ["L", 188],
      ["DL", 107],
      ["BR", 260],
      ["R", 700],
      ["D", 300],
      ["R", 800],
      ["DR", 300],
      ["R", 800],
      ["U", 100],
      ["R", 500],
      ["N", 10000],
    ]);

    for (const step of plan) {
      [p1X, p1Y] = advanceTrackball(p1X, p1Y, step);
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
      if (pfCount === 0) {
        emptyRun++;
      } else {
        maxEmptyRun = Math.max(maxEmptyRun, emptyRun);
        emptyRun = 0;
      }

      if (state.workRam[0x18 + 0x1a] === 1) {
        state1Run++;
      } else {
        maxState1Run = Math.max(maxState1Run, state1Run);
        state1Run = 0;
      }

      const mainState = readWordBE(state.workRam, 0x390);
      const mode = readWordBE(state.workRam, 0x392);
      const segment = state.workRam[0x3e4] ?? 0;
      maxScrollY = Math.max(maxScrollY, state.videoScrollY);
      sawMode2AfterEarlyRoute ||= mainState === 1 && mode === 2 && segment >= 3;
      sawSegment5 ||= mainState === 1 && segment >= 5;
      sawSegment7 ||= mainState === 1 && segment >= 7;
    }

    maxEmptyRun = Math.max(maxEmptyRun, emptyRun);
    maxState1Run = Math.max(maxState1Run, state1Run);
    expect(sawMode2AfterEarlyRoute).toBe(true);
    expect(sawSegment5).toBe(true);
    expect(sawSegment7).toBe(true);
    expect(maxEmptyRun).toBeLessThanOrEqual(16);
    expect(maxState1Run).toBe(0);
    expect(maxScrollY).toBeLessThanOrEqual(360);
    expect(nonzero(state.playfieldRam)).toBeGreaterThan(4000);
    expect(state.workRam[0x18 + 0x1a]).toBe(0);
  });

  it("recovers from repeated live fall/death routes", () => {
    const rom = emptyRomImage();
    loadRomBlob(rom, readFileSync(resolve("ghidra_project/marble_program.bin")));
    const state = loadPlayableState(rom);

    let p1X = state.workRam[0x18 + 0xc9] ?? 0xff;
    let p1Y = state.workRam[0x18 + 0xc8] ?? 0xff;
    let deathEvents = 0;
    let recoveries = 0;
    let inDeath = false;
    let emptyRun = 0;
    let maxEmptyRun = 0;
    let sawSegment6 = false;

    const plan = expand([
      ["D", 260],
      ["N", 520],
      ["D", 330],
      ["N", 600],
      ["D", 260],
      ["N", 700],
      ["D", 260],
      ["N", 900],
      ["D", 360],
      ["N", 2000],
      ["D", 420],
      ["N", 2500],
      ["D", 500],
      ["N", 3000],
    ]);

    for (const step of plan) {
      [p1X, p1Y] = advanceTrackball(p1X, p1Y, step);
      tick(state, {
        rom,
        runMainLoopBody: true,
        p1X,
        p1Y,
        p2X: 0xff,
        p2Y: 0xff,
        inputMmio: 0x6f,
      });

      const playerState = state.workRam[0x18 + 0x1a] ?? 0;
      const isDeath = playerState === 4 || playerState === 5;
      if (isDeath && !inDeath) {
        deathEvents++;
        inDeath = true;
      } else if (inDeath && playerState === 0) {
        recoveries++;
        inDeath = false;
      }

      const pfCount = nonzero(state.playfieldRam);
      if (pfCount === 0) {
        emptyRun++;
      } else {
        maxEmptyRun = Math.max(maxEmptyRun, emptyRun);
        emptyRun = 0;
      }
      sawSegment6 ||= readWordBE(state.workRam, 0x390) === 1 && (state.workRam[0x3e4] ?? 0) >= 6;
      expect(playerState).not.toBe(1);
      expect(state.videoScrollY).toBeLessThanOrEqual(360);
    }

    maxEmptyRun = Math.max(maxEmptyRun, emptyRun);
    expect(deathEvents).toBeGreaterThanOrEqual(4);
    expect(recoveries).toBe(deathEvents);
    expect(sawSegment6).toBe(true);
    expect(maxEmptyRun).toBeLessThanOrEqual(16);
    expect(nonzero(state.playfieldRam)).toBeGreaterThan(4000);
    expect(state.workRam[0x18 + 0x1a]).toBe(0);
  });

  it("refreshes player terrain shape records through FUN_264AA mode 0", () => {
    const rom = emptyRomImage();
    loadRomBlob(rom, readFileSync(resolve("ghidra_project/marble_program.bin")));
    const state = loadPlayableState(rom);

    let p1X = state.workRam[0x18 + 0xc9] ?? 0xff;
    let p1Y = state.workRam[0x18 + 0xc8] ?? 0xff;
    let sawTerrainShape = false;

    for (const step of expand([["D", 180], ["R", 80]])) {
      [p1X, p1Y] = advanceTrackball(p1X, p1Y, step);
      tick(state, {
        rom,
        runMainLoopBody: true,
        p1X,
        p1Y,
        p2X: 0xff,
        p2Y: 0xff,
        inputMmio: 0x6f,
      });

      sawTerrainShape ||= readWordBE(state.workRam, 0x18 + 0x38) === 0x7500;
      expect(nonzero(state.playfieldRam)).toBeGreaterThan(4000);
      expect(state.videoScrollY).toBeLessThanOrEqual(90);
    }

    expect(sawTerrainShape).toBe(true);
  });
});
