import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { loadRomBlob } from "../src/m68k/apply-slapstic-bank.js";
import { bootInit } from "../src/boot-init.js";
import { emptyRomImage } from "../src/bus.js";
import { tick } from "../src/index.js";
import { emptyGameState, type GameState } from "../src/state.js";
import { getAlphaTileAddr } from "../src/alpha-tilemap.js";

interface PlayableSeed {
  slapsticBank?: number;
  workRam: string;
  playfieldRam: string;
  spriteRam: string;
  alphaRam: string;
  colorRam: string;
}

interface GameplayScenario {
  snapshots: PlayableSeed[];
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

function nonzeroAlphaClearRows(
  state: GameState,
  rom: ReturnType<typeof emptyRomImage>,
  startRow: number,
): number {
  let total = 0;
  for (let row = startRow & 0xff; row !== 0x1e; row = (row + 1) & 0xff) {
    let off = getAlphaTileAddr(state, rom, 3, row) - 0xa03000;
    for (let i = 0; i < 0x24; i++) {
      if ((state.alphaRam[off] ?? 0) !== 0 || (state.alphaRam[off + 1] ?? 0) !== 0) {
        total++;
      }
      off += 2;
    }
  }
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

function loadGameplayScenarioState(
  rom: ReturnType<typeof emptyRomImage>,
  scenarioName: string,
  options: { manualDispatcher?: boolean } = {},
): GameState {
  const scenario = JSON.parse(
    readFileSync(resolve(`oracle/scenarios/gameplay/${scenarioName}.json`), "utf-8"),
  ) as GameplayScenario;
  const snapshot = scenario.snapshots[0];
  expect(snapshot).toBeDefined();

  const state = emptyGameState();
  bootInit(state, rom, {
    warmState: {
      workRam: hexToBytes(snapshot.workRam, 0x2000),
      playfieldRam: hexToBytes(snapshot.playfieldRam, 0x2000),
      spriteRam: hexToBytes(snapshot.spriteRam, 0x1000),
      alphaRam: hexToBytes(snapshot.alphaRam, 0x1000),
      colorRam: hexToBytes(snapshot.colorRam, 0x800),
      slapsticBank: snapshot.slapsticBank ?? 1,
    },
  });

  if (options.manualDispatcher === true) {
    state.workRam[0x390] = 0;
    state.workRam[0x391] = 0;
  }
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

interface RouteSummary {
  deltaX: number;
  deltaY: number;
  finalX: number;
  finalY: number;
  mainState: number;
  mode: number;
  segment: number;
  playerState: number;
  pfCount: number;
  maxEmptyRun: number;
  maxScrollY: number;
  deathEvents: number;
  recoveries: number;
}

function runRoute(
  rom: ReturnType<typeof emptyRomImage>,
  state: GameState,
  plan: readonly string[],
): RouteSummary {
  let p1X = state.workRam[0x18 + 0xc9] ?? 0xff;
  let p1Y = state.workRam[0x18 + 0xc8] ?? 0xff;
  const initialX = signedLong(readLongBE(state.workRam, 0x18 + 0x0c));
  const initialY = signedLong(readLongBE(state.workRam, 0x18 + 0x10));
  let deathEvents = 0;
  let recoveries = 0;
  let inDeath = false;
  let maxScrollY = 0;
  let emptyRun = 0;
  let maxEmptyRun = 0;

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
    maxScrollY = Math.max(maxScrollY, state.videoScrollY);
  }

  maxEmptyRun = Math.max(maxEmptyRun, emptyRun);
  const finalX = signedLong(readLongBE(state.workRam, 0x18 + 0x0c));
  const finalY = signedLong(readLongBE(state.workRam, 0x18 + 0x10));
  return {
    deltaX: Math.abs(finalX - initialX),
    deltaY: Math.abs(finalY - initialY),
    finalX,
    finalY,
    mainState: readWordBE(state.workRam, 0x390),
    mode: readWordBE(state.workRam, 0x392),
    segment: state.workRam[0x3e4] ?? 0,
    playerState: state.workRam[0x18 + 0x1a] ?? 0,
    pfCount: nonzero(state.playfieldRam),
    maxEmptyRun,
    maxScrollY,
    deathEvents,
    recoveries,
  };
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

  it("proves level-1 manual input changes outcome versus neutral input", () => {
    const rom = emptyRomImage();
    loadRomBlob(rom, readFileSync(resolve("ghidra_project/marble_program.bin")));

    const activePlan = expand([
      ["D", 171],
      ["R", 206],
      ["L", 188],
      ["DL", 107],
      ["BR", 260],
      ["R", 700],
      ["D", 300],
      ["R", 800],
    ]);
    const neutralPlan = expand([["N", activePlan.length]]);

    const runPlan = (plan: readonly string[]) => {
      const state = loadPlayableState(rom);
      let p1X = state.workRam[0x18 + 0xc9] ?? 0xff;
      let p1Y = state.workRam[0x18 + 0xc8] ?? 0xff;
      const initialX = signedLong(readLongBE(state.workRam, 0x18 + 0x0c));
      const initialY = signedLong(readLongBE(state.workRam, 0x18 + 0x10));
      let deathEvents = 0;
      let recoveries = 0;
      let inDeath = false;
      let maxScrollY = 0;
      let emptyRun = 0;
      let maxEmptyRun = 0;

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
        maxScrollY = Math.max(maxScrollY, state.videoScrollY);
      }

      maxEmptyRun = Math.max(maxEmptyRun, emptyRun);
      const finalX = signedLong(readLongBE(state.workRam, 0x18 + 0x0c));
      const finalY = signedLong(readLongBE(state.workRam, 0x18 + 0x10));
      return {
        deltaX: Math.abs(finalX - initialX),
        deltaY: Math.abs(finalY - initialY),
        finalX,
        finalY,
        mainState: readWordBE(state.workRam, 0x390),
        mode: readWordBE(state.workRam, 0x392),
        segment: state.workRam[0x3e4] ?? 0,
        playerState: state.workRam[0x18 + 0x1a] ?? 0,
        pfCount: nonzero(state.playfieldRam),
        maxEmptyRun,
        maxScrollY,
        deathEvents,
        recoveries,
      };
    };

    const active = runPlan(activePlan);
    const neutral = runPlan(neutralPlan);

    expect(active.mainState).toBe(0);
    expect(active.mode).toBe(0);
    expect(active.segment).toBe(2);
    expect(active.playerState).toBe(0);
    expect(active.pfCount).toBeGreaterThan(4000);
    expect(active.maxEmptyRun).toBe(0);
    expect(active.maxScrollY).toBeLessThanOrEqual(90);
    expect(active.deathEvents).toBeGreaterThanOrEqual(3);
    expect(active.recoveries).toBe(active.deathEvents);
    expect(active.deltaX).toBeGreaterThan(7_000_000);
    expect(active.deltaY).toBeGreaterThan(9_000_000);

    expect(neutral.mainState).toBe(0);
    expect(neutral.mode).toBe(0);
    expect(neutral.segment).toBe(2);
    expect(neutral.playerState).toBe(0);
    expect(neutral.pfCount).toBeGreaterThan(4000);
    expect(neutral.deathEvents).toBe(0);
    expect(neutral.maxScrollY).toBe(0);
    expect(neutral.deltaY).toBeLessThan(1_000_000);
    expect(Math.abs(active.finalX - neutral.finalX)).toBeGreaterThan(3_000_000);
    expect(Math.abs(active.finalY - neutral.finalY)).toBeGreaterThan(8_000_000);
  });

  it("refreshes the visible timer HUD when the player timer decrements", () => {
    const rom = emptyRomImage();
    loadRomBlob(rom, readFileSync(resolve("ghidra_project/marble_program.bin")));
    const state = loadPlayableState(rom);
    const initialAlpha = state.alphaRam.slice();
    const initialTimer = readWordBE(state.workRam, 0x18 + 0x6a);

    for (let frame = 0; frame < 60; frame++) {
      tick(state, {
        rom,
        runMainLoopBody: true,
        p1X: state.workRam[0x18 + 0xc9] ?? 0xff,
        p1Y: state.workRam[0x18 + 0xc8] ?? 0xff,
        p2X: 0xff,
        p2Y: 0xff,
        inputMmio: 0x6f,
      });
    }

    let alphaDiffs = 0;
    for (let i = 0; i < state.alphaRam.length; i++) {
      if (state.alphaRam[i] !== initialAlpha[i]) alphaDiffs++;
    }
    expect(readWordBE(state.workRam, 0x18 + 0x6a)).toBe(initialTimer - 1);
    expect(alphaDiffs).toBeGreaterThan(0);
  });

  it.each([
    ["level2_spawn", 4, { maxScrollY: 160, minDiffX: 1_000_000, minDiffY: 6_000_000 }],
    ["level3_spawn", 5, { maxScrollY: 360, minDiffX: 8_000_000, minDiffY: 8_000_000 }],
  ] as const)(
    "proves %s is controllable only after the manual dispatcher is rearmed",
    (scenarioName, segment, routeExpect) => {
      const rom = emptyRomImage();
      loadRomBlob(rom, readFileSync(resolve("ghidra_project/marble_program.bin")));

      const activePlan = expand([
        ["R", 300],
        ["D", 300],
        ["L", 300],
        ["U", 300],
        ["DR", 300],
        ["DL", 300],
        ["N", 400],
      ]);
      const neutralPlan = expand([["N", activePlan.length]]);

      const preservedActive = runRoute(rom, loadGameplayScenarioState(rom, scenarioName), activePlan);
      const preservedNeutral = runRoute(rom, loadGameplayScenarioState(rom, scenarioName), neutralPlan);

      // These checked-in MAME gameplay seeds are diagnostics, not level-complete
      // proof. With the preserved dispatcher, direct trackball deltas are sampled
      // but do not steer the object path.
      expect(preservedActive.finalX).toBe(preservedNeutral.finalX);
      expect(preservedActive.finalY).toBe(preservedNeutral.finalY);
      expect(preservedActive.segment).toBe(preservedNeutral.segment);

      const manualActive = runRoute(
        rom,
        loadGameplayScenarioState(rom, scenarioName, { manualDispatcher: true }),
        activePlan,
      );
      const manualNeutral = runRoute(
        rom,
        loadGameplayScenarioState(rom, scenarioName, { manualDispatcher: true }),
        neutralPlan,
      );

      expect(manualActive.mainState).toBe(0);
      expect(manualActive.mode).toBe(0);
      expect(manualActive.segment).toBe(segment);
      expect(manualActive.playerState).toBe(0);
      expect(manualActive.pfCount).toBeGreaterThan(4000);
      expect(manualActive.maxEmptyRun).toBe(0);
      expect(manualActive.maxScrollY).toBeLessThanOrEqual(routeExpect.maxScrollY);
      expect(manualActive.deathEvents).toBeGreaterThanOrEqual(3);
      expect(manualActive.recoveries).toBe(manualActive.deathEvents);
      expect(Math.abs(manualActive.finalX - manualNeutral.finalX)).toBeGreaterThan(routeExpect.minDiffX);
      expect(Math.abs(manualActive.finalY - manualNeutral.finalY)).toBeGreaterThan(routeExpect.minDiffY);
    },
  );

  it("guards the level-1 completion detector from a manually rearmed finish-line seed", () => {
    const rom = emptyRomImage();
    loadRomBlob(rom, readFileSync(resolve("ghidra_project/marble_program.bin")));

    const completionPlan = expand([
      ["L", 180],
      ["DL", 900],
    ]);
    const neutralPlan = expand([["N", completionPlan.length]]);

    const preservedActive = runRoute(rom, loadGameplayScenarioState(rom, "level1_end"), completionPlan);
    const preservedNeutral = runRoute(rom, loadGameplayScenarioState(rom, "level1_end"), neutralPlan);

    // The preserved MAME dispatcher autonomously advances through presentation
    // windows, so it must not be counted as active manual completion proof.
    expect(preservedActive.mainState).toBe(1);
    expect(preservedActive.segment).toBeGreaterThanOrEqual(4);
    expect(preservedActive.finalX).toBe(preservedNeutral.finalX);
    expect(preservedActive.finalY).toBe(preservedNeutral.finalY);

    const state = loadGameplayScenarioState(rom, "level1_end", { manualDispatcher: true });
    let p1X = state.workRam[0x18 + 0xc9] ?? 0xff;
    let p1Y = state.workRam[0x18 + 0xc8] ?? 0xff;
    let firstCompletionFrame = -1;
    let firstState6Frame = -1;

    for (let frame = 1; frame <= completionPlan.length; frame++) {
      [p1X, p1Y] = advanceTrackball(p1X, p1Y, completionPlan[frame - 1] ?? "N");
      tick(state, {
        rom,
        runMainLoopBody: true,
        p1X,
        p1Y,
        p2X: 0xff,
        p2Y: 0xff,
        inputMmio: 0x6f,
      });

      if (firstState6Frame < 0 && state.workRam[0x18 + 0x1a] === 6) {
        firstState6Frame = frame;
      }
      if (firstCompletionFrame < 0 && readWordBE(state.workRam, 0x390) === 3) {
        firstCompletionFrame = frame;
      }
    }

    expect(firstState6Frame).toBeGreaterThan(0);
    expect(firstCompletionFrame).toBeGreaterThan(firstState6Frame);
    expect(firstCompletionFrame).toBeLessThan(1_000);
    expect(readWordBE(state.workRam, 0x390)).toBe(0);
    expect(readWordBE(state.workRam, 0x392)).toBe(2);
    expect(readWordBE(state.workRam, 0x394)).toBe(2);
    expect(state.workRam[0x3e4]).toBe(3);
    expect(state.workRam[0x18 + 0x18]).toBe(1);
    expect(state.workRam[0x18 + 0x1a]).toBe(0);
  });

  it("time-out transition holds the out-of-time summary before any attract rebuild", () => {
    const rom = emptyRomImage();
    loadRomBlob(rom, readFileSync(resolve("ghidra_project/marble_program.bin")));
    const state = loadPlayableState(rom);

    const p1X = state.workRam[0x18 + 0xc9] ?? 0xff;
    const p1Y = state.workRam[0x18 + 0xc8] ?? 0xff;
    let summaryFrame = -1;
    let maxSummaryDelay = 0;
    let maxSummaryAlphaRows = 0;
    let sawMode2DuringSummary = false;
    let sawMode0RebuildDuringSummary = false;
    let sawEmptyPlayfieldDuringSummary = false;

    for (let i = 0; i < 3780; i++) {
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
      const waitDelay = state.clock.mainThreadWaitDelay;

      if (waitDelay !== undefined) {
        if (summaryFrame < 0) summaryFrame = i;
        maxSummaryDelay = Math.max(maxSummaryDelay, waitDelay);
        maxSummaryAlphaRows = Math.max(maxSummaryAlphaRows, nonzeroAlphaClearRows(state, rom, 0x14));
        sawMode2DuringSummary ||= mainState === 1 && mode === 2;
        sawMode0RebuildDuringSummary ||= mainState === 1 && mode === 0 && (state.workRam[0x3e4] ?? 0) === 0;
        sawEmptyPlayfieldDuringSummary ||= pfCount === 0;
      }
    }

    expect(summaryFrame).toBeGreaterThan(0);
    expect(maxSummaryDelay).toBeGreaterThanOrEqual(170);
    expect(maxSummaryAlphaRows).toBeGreaterThan(0);
    expect(sawMode2DuringSummary).toBe(false);
    expect(sawMode0RebuildDuringSummary).toBe(false);
    expect(sawEmptyPlayfieldDuringSummary).toBe(false);
    expect(readWordBE(state.workRam, 0x390)).toBe(2);
    expect(readWordBE(state.workRam, 0x392)).toBe(0);
    expect(readWordBE(state.workRam, 0x394)).toBe(1);
    expect(state.workRam[0x3e4]).toBe(2);
    expect(state.clock.mainThreadWaitDelay).toBeGreaterThan(0);
    expect(nonzero(state.playfieldRam)).toBeGreaterThan(4000);
    expect(state.videoScrollY).toBe(0);
    expect(state.workRam[0x18 + 0x18]).toBe(2);

    for (let i = 0; i < 240 && state.clock.mainThreadWaitDelay !== undefined; i++) {
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

    expect(state.clock.mainThreadWaitDelay).toBeUndefined();
    expect(state.clock.mainThreadWaitClearRows).toBeUndefined();
    expect(nonzeroAlphaClearRows(state, rom, 0x14)).toBe(0);
  });

  it("guards a level-1 baseline and mapped level-2/3 timeout windows", () => {
    const rom = emptyRomImage();
    loadRomBlob(rom, readFileSync(resolve("ghidra_project/marble_program.bin")));
    const state = loadPlayableState(rom);

    let p1X = state.workRam[0x18 + 0xc9] ?? 0xff;
    let p1Y = state.workRam[0x18 + 0xc8] ?? 0xff;
    let emptyRun = 0;
    let maxEmptyRun = 0;
    let state1Run = 0;
    let maxState1Run = 0;
    let state2Run = 0;
    let maxState2Run = 0;
    let state6Run = 0;
    let maxState6Run = 0;
    let maxScrollY = 0;
    let sawMode2AfterEarlyRoute = false;
    // MAME gameplay warm seeds map level2_spawn to segment 4 and level3_spawn
    // to segment 5. This timeout/rebuild ladder is stable, but neutral input
    // can reach the same windows; it is not proof of manual level completion.
    let level2EntryFrame = -1;
    let level3EntryFrame = -1;
    let level2StableFrames = 0;
    let level3StableFrames = 0;
    let level1StableFrames = 0;
    let deathEvents = 0;
    let recoveries = 0;
    let inDeath = false;
    let sawSegment5 = false;
    let sawSegment7 = false;
    const playableMinXBySegment = new Map<number, number>();
    const playableMaxXBySegment = new Map<number, number>();
    const playableMinYBySegment = new Map<number, number>();
    const playableMaxYBySegment = new Map<number, number>();
    const deathSegments = new Set<number>();
    const recoverySegments = new Set<number>();

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

    let frame = 0;
    for (const step of plan) {
      frame++;
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

      if (state.workRam[0x18 + 0x1a] === 2) {
        state2Run++;
      } else {
        maxState2Run = Math.max(maxState2Run, state2Run);
        state2Run = 0;
      }

      if (state.workRam[0x18 + 0x1a] === 6) {
        state6Run++;
      } else {
        maxState6Run = Math.max(maxState6Run, state6Run);
        state6Run = 0;
      }

      const mainState = readWordBE(state.workRam, 0x390);
      const mode = readWordBE(state.workRam, 0x392);
      const segment = state.workRam[0x3e4] ?? 0;
      const playerState = state.workRam[0x18 + 0x1a] ?? 0;
      const stableTerrain = mainState === 1 && mode === 0 && pfCount > 4000 && playerState === 0;
      const isDeath = playerState === 4 || playerState === 5;
      if (isDeath && !inDeath) {
        deathEvents++;
        deathSegments.add(segment);
        inDeath = true;
      } else if (inDeath && playerState === 0) {
        recoveries++;
        recoverySegments.add(segment);
        inDeath = false;
      }
      maxScrollY = Math.max(maxScrollY, state.videoScrollY);
      sawMode2AfterEarlyRoute ||= mainState === 1 && mode === 2 && segment >= 3;
      if (stableTerrain && (segment === 2 || segment === 3)) {
        level1StableFrames++;
      }
      if (stableTerrain && segment === 4) {
        if (level2EntryFrame < 0) level2EntryFrame = frame;
        level2StableFrames++;
      }
      if (stableTerrain && segment === 5) {
        if (level3EntryFrame < 0) level3EntryFrame = frame;
        level3StableFrames++;
      }
      if (stableTerrain) {
        const objX = signedLong(readLongBE(state.workRam, 0x18 + 0x0c));
        const objY = signedLong(readLongBE(state.workRam, 0x18 + 0x10));
        playableMinXBySegment.set(segment, Math.min(playableMinXBySegment.get(segment) ?? objX, objX));
        playableMaxXBySegment.set(segment, Math.max(playableMaxXBySegment.get(segment) ?? objX, objX));
        playableMinYBySegment.set(segment, Math.min(playableMinYBySegment.get(segment) ?? objY, objY));
        playableMaxYBySegment.set(segment, Math.max(playableMaxYBySegment.get(segment) ?? objY, objY));
      }
      sawSegment5 ||= mainState === 1 && segment >= 5;
      sawSegment7 ||= mainState === 1 && segment >= 7;
    }

    maxEmptyRun = Math.max(maxEmptyRun, emptyRun);
    maxState1Run = Math.max(maxState1Run, state1Run);
    maxState2Run = Math.max(maxState2Run, state2Run);
    maxState6Run = Math.max(maxState6Run, state6Run);
    const objDeltaX = (segment: number): number =>
      (playableMaxXBySegment.get(segment) ?? 0) - (playableMinXBySegment.get(segment) ?? 0);
    const objDeltaY = (segment: number): number =>
      (playableMaxYBySegment.get(segment) ?? 0) - (playableMinYBySegment.get(segment) ?? 0);
    expect(sawMode2AfterEarlyRoute).toBe(true);
    expect(level1StableFrames).toBeGreaterThan(1500);
    expect(level2EntryFrame).toBeGreaterThan(0);
    expect(level3EntryFrame).toBeGreaterThan(level2EntryFrame);
    expect(level2StableFrames).toBeGreaterThan(700);
    expect(level3StableFrames).toBeGreaterThan(700);
    // Object motion in the mapped windows is necessary for stability, but it
    // is still compatible with the timeout/presentation path. A future route
    // completion proof must compare against neutral input or MAME route input.
    expect(objDeltaX(2)).toBeGreaterThan(1_000_000);
    expect(objDeltaY(2)).toBeGreaterThan(1_000_000);
    expect(objDeltaX(4)).toBeGreaterThan(1_000_000);
    expect(objDeltaY(4)).toBeGreaterThan(1_000_000);
    expect(objDeltaX(5)).toBeGreaterThan(1_000_000);
    expect(objDeltaY(5)).toBeGreaterThan(1_000_000);
    expect(deathEvents).toBeGreaterThanOrEqual(5);
    // The route is a timeout/presentation stability ladder, so after the
    // summary hold lands it may finish with one in-flight death still pending.
    expect(recoveries).toBeGreaterThanOrEqual(deathEvents - 1);
    expect(deathSegments.has(2)).toBe(true);
    expect(deathSegments.has(4)).toBe(true);
    expect(deathSegments.has(5)).toBe(true);
    expect(recoverySegments.has(2)).toBe(true);
    expect(recoverySegments.has(4)).toBe(true);
    expect(recoverySegments.has(5)).toBe(true);
    expect(sawSegment5).toBe(true);
    expect(sawSegment7).toBe(true);
    expect(maxEmptyRun).toBeLessThanOrEqual(16);
    expect(maxState1Run).toBe(0);
    expect(maxState2Run).toBe(0);
    expect(maxState6Run).toBeLessThanOrEqual(90);
    expect(maxScrollY).toBeLessThanOrEqual(360);
    expect(nonzero(state.playfieldRam)).toBeGreaterThan(4000);
    if (recoveries === deathEvents) {
      expect(state.workRam[0x18 + 0x1a]).toBe(0);
    } else {
      expect(inDeath).toBe(true);
      expect([4, 5]).toContain(state.workRam[0x18 + 0x1a]);
    }
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

  it("bounds transient live state-1 tumble during manual input", () => {
    const rom = emptyRomImage();
    loadRomBlob(rom, readFileSync(resolve("ghidra_project/marble_program.bin")));
    const state = loadPlayableState(rom);

    let p1X = state.workRam[0x18 + 0xc9] ?? 0xff;
    let p1Y = state.workRam[0x18 + 0xc8] ?? 0xff;
    let state1Entries = 0;
    let state1Run = 0;
    let maxState1Run = 0;
    let leftState1 = 0;
    let emptyRun = 0;
    let maxEmptyRun = 0;
    let sawDeathAfterState1 = false;
    let sawState0AfterState1 = false;
    let sawSegment4 = false;

    const plan = expand([
      ["D", 171],
      ["R", 206],
      ["L", 188],
      ["DL", 107],
      ["BR", 260],
      ["DR", 283],
      ["U", 93],
      ["L", 192],
      ["DL", 67],
      ["R", 47],
      ["L", 93],
      ["UL", 132],
      ["UR", 101],
      ["UL", 326],
      ["BR", 81],
      ["DR", 103],
      ["U", 90],
      ["DL", 102],
      ["UR", 65],
      ["BR", 40],
      ["DR", 40],
      ["N", 134],
      ["R", 76],
      ["UL", 40],
      ["BR", 179],
      ["D", 173],
      ["U", 170],
      ["DL", 51],
      ["N", 113],
      ["DL", 150],
      ["BR", 69],
      ["D", 72],
      ["DL", 74],
      ["R", 56],
      ["D", 85],
      ["R", 63],
      ["UR", 85],
      ["D", 107],
      ["DR", 47],
      ["L", 65],
      ["DR", 52],
      ["UL", 170],
      ["N", 130],
      ["L", 132],
      ["N", 5000],
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
      if (playerState === 1) {
        if (state1Run === 0) state1Entries++;
        state1Run++;
      } else if (state1Run > 0) {
        maxState1Run = Math.max(maxState1Run, state1Run);
        leftState1++;
        sawDeathAfterState1 ||= playerState === 4 || playerState === 5;
        sawState0AfterState1 ||= playerState === 0;
        state1Run = 0;
      }

      const pfCount = nonzero(state.playfieldRam);
      if (pfCount === 0) {
        emptyRun++;
      } else {
        maxEmptyRun = Math.max(maxEmptyRun, emptyRun);
        emptyRun = 0;
      }

      sawSegment4 ||= readWordBE(state.workRam, 0x390) === 1 && (state.workRam[0x3e4] ?? 0) >= 4;
      expect(state.videoScrollY).toBeLessThanOrEqual(360);
    }

    maxState1Run = Math.max(maxState1Run, state1Run);
    maxEmptyRun = Math.max(maxEmptyRun, emptyRun);
    expect(state1Entries).toBeGreaterThanOrEqual(2);
    expect(leftState1).toBe(state1Entries);
    expect(maxState1Run).toBeLessThanOrEqual(80);
    expect(sawDeathAfterState1).toBe(true);
    expect(sawState0AfterState1).toBe(true);
    expect(sawSegment4).toBe(true);
    expect(maxEmptyRun).toBeLessThanOrEqual(16);
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
