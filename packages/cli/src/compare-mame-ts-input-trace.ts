#!/usr/bin/env node
/**
 * compare-mame-ts-input-trace.ts - replay a MAME input trace in TS.
 *
 * Route labels such as DR/UL are useful for planning, but the authoritative
 * proof is the absolute input stream MAME actually read. This tool starts from
 * the first snapshot in a dense MAME scenario, feeds TS the matching
 * input.json absolute trackball/switch values, and reports the first
 * frame-level divergence against later MAME snapshots.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { argv, exit } from "node:process";

import {
  applySlapsticBank,
  bootInit,
  bus as busNs,
  state as stateNs,
  tick,
} from "@marble-love/engine";
import type { GameState, RomImage } from "@marble-love/engine";

interface SnapshotJson {
  frame?: number;
  slapsticBank?: number;
  workRam: string;
  playfieldRam: string;
  spriteRam: string;
  alphaRam: string;
  colorRam: string;
}

interface ScenarioJson {
  snapshots: SnapshotJson[];
}

interface InputFrame {
  frame: number;
  trackballX?: number;
  trackballY?: number;
  trackball2X?: number;
  trackball2Y?: number;
  switches?: number;
}

interface InputTraceJson {
  frames: InputFrame[];
}

interface CliArgs {
  scenarioPath: string;
  inputPath: string;
  romPath: string;
  dispatcher: "manual" | "preserved";
  startIndex: number;
  maxFrames: number | undefined;
  sampleEvery: number;
  json: boolean;
}

interface Sample {
  frame: number | undefined;
  main: number;
  mode: number;
  next: number;
  segment: number;
  descriptorPointer: number;
  playerState: number;
  timer: number;
  xRaw: number;
  yRaw: number;
  zRaw: number;
  trackballX: number;
  trackballY: number;
  pfCount: number;
  scrollY: number;
}

interface FrameComparison {
  routeFrame: number;
  frame: number | undefined;
  inputX: number;
  inputY: number;
  inputSwitches: number;
  ts: Sample;
  mame: Sample;
  dxRaw: number;
  dyRaw: number;
  dzRaw: number;
  stateMismatch: boolean;
  mainMismatch: boolean;
  descriptorMismatch: boolean;
  timerMismatch: boolean;
  pfCountDelta: number;
  pfByteDiffs: number;
  trackballMismatch: boolean;
}

interface Summary {
  scenarioPath: string;
  inputPath: string;
  dispatcher: "manual" | "preserved";
  seedFrame: number | undefined;
  comparedFrames: number;
  inputDistinctX: number;
  inputDistinctY: number;
  firstStateMismatch: FrameComparison | undefined;
  firstMainMismatch: FrameComparison | undefined;
  firstDescriptorMismatch: FrameComparison | undefined;
  firstTrackballMismatch: FrameComparison | undefined;
  firstPositionDelta: FrameComparison | undefined;
  firstLargePositionDelta: FrameComparison | undefined;
  firstPlayfieldDiff: FrameComparison | undefined;
  maxAbsDxRaw: number;
  maxAbsDyRaw: number;
  maxAbsDzRaw: number;
  maxPfByteDiffs: number;
  final: FrameComparison | undefined;
}

function printHelp(): void {
  console.log(`compare-mame-ts-input-trace - replay MAME input.json in TS

Usage:
  node --import tsx packages/cli/src/compare-mame-ts-input-trace.ts \\
    --input /tmp/run/input.json /tmp/run/scenarios/f3200.json

Options:
  --input PATH             MAME input trace JSON (required)
  --rom PATH               Program ROM blob (default: ghidra_project/marble_program.bin)
  --dispatcher MODE        manual or preserved (default: manual)
  --start-index N          Scenario snapshot index to use as seed (default: 0)
  --max-frames N           Max frames to compare after the seed
  --sample-every N         Print one text row every N frames (default: 20)
  --json                   Print summary JSON
  -h, --help               Show this help
`);
}

function parseArgs(): CliArgs {
  const raw = argv.slice(2);
  let inputPath = "";
  let romPath = "ghidra_project/marble_program.bin";
  let dispatcher: "manual" | "preserved" = "manual";
  let startIndex = 0;
  let maxFrames: number | undefined;
  let sampleEvery = 20;
  let json = false;
  const paths: string[] = [];

  for (let i = 0; i < raw.length; i++) {
    const arg = raw[i]!;
    if (arg === "--input") {
      inputPath = requireValue(raw[++i], "--input");
    } else if (arg === "--rom") {
      romPath = requireValue(raw[++i], "--rom");
    } else if (arg === "--dispatcher") {
      const value = requireValue(raw[++i], "--dispatcher");
      if (value !== "manual" && value !== "preserved") throw new Error("--dispatcher must be manual or preserved");
      dispatcher = value;
    } else if (arg === "--start-index") {
      startIndex = parseNonNegativeInt(raw[++i], "--start-index");
    } else if (arg === "--max-frames") {
      maxFrames = parsePositiveInt(raw[++i], "--max-frames");
    } else if (arg === "--sample-every") {
      sampleEvery = parsePositiveInt(raw[++i], "--sample-every");
    } else if (arg === "--json") {
      json = true;
    } else if (arg === "-h" || arg === "--help") {
      printHelp();
      exit(0);
    } else if (arg.startsWith("-")) {
      throw new Error(`unknown option: ${arg}`);
    } else {
      paths.push(arg);
    }
  }

  if (inputPath === "") throw new Error("--input is required");
  if (paths.length !== 1) throw new Error("exactly one scenario JSON path is required");
  return {
    scenarioPath: paths[0]!,
    inputPath,
    romPath,
    dispatcher,
    startIndex,
    maxFrames,
    sampleEvery,
    json,
  };
}

function requireValue(raw: string | undefined, label: string): string {
  if (raw === undefined || raw === "") throw new Error(`${label} requires a value`);
  return raw;
}

function parsePositiveInt(raw: string | undefined, label: string): number {
  const value = Number(requireValue(raw, label));
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${label} must be a positive integer`);
  return value;
}

function parseNonNegativeInt(raw: string | undefined, label: string): number {
  const value = Number(requireValue(raw, label));
  if (!Number.isInteger(value) || value < 0) throw new Error(`${label} must be a non-negative integer`);
  return value;
}

function hexToBytes(hex: string, expectedLength: number, label: string): Uint8Array {
  if (hex.length !== expectedLength * 2) {
    throw new Error(`${label} has ${hex.length / 2} bytes, expected ${expectedLength}`);
  }
  const out = new Uint8Array(expectedLength);
  for (let i = 0; i < expectedLength; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function readWordBE(bytes: Uint8Array, off: number): number {
  return (((bytes[off] ?? 0) << 8) | (bytes[off + 1] ?? 0)) & 0xffff;
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

function nonzero(bytes: Uint8Array): number {
  let count = 0;
  for (const byte of bytes) if (byte !== 0) count++;
  return count;
}

function byteDiffs(a: Uint8Array, b: Uint8Array): number {
  const n = Math.min(a.length, b.length);
  let diffs = Math.abs(a.length - b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) diffs++;
  return diffs;
}

function loadScenario(path: string): SnapshotJson[] {
  const raw = JSON.parse(readFileSync(resolve(path), "utf-8")) as ScenarioJson;
  if (!Array.isArray(raw.snapshots) || raw.snapshots.length === 0) {
    throw new Error(`${path} does not contain snapshots`);
  }
  return raw.snapshots;
}

function loadInputTrace(path: string): Map<number, InputFrame> {
  const raw = JSON.parse(readFileSync(resolve(path), "utf-8")) as InputTraceJson;
  if (!Array.isArray(raw.frames) || raw.frames.length === 0) throw new Error(`${path} does not contain frames`);
  return new Map(raw.frames.map((frame) => [frame.frame, frame]));
}

function loadRom(path: string): RomImage {
  const rom = busNs.emptyRomImage();
  applySlapsticBank.loadRomBlob(rom, readFileSync(resolve(path)));
  return rom;
}

function loadStateFromSnapshot(rom: RomImage, snapshot: SnapshotJson, dispatcher: "manual" | "preserved"): GameState {
  const state = stateNs.emptyGameState();
  bootInit(state, rom, {
    warmState: {
      workRam: hexToBytes(snapshot.workRam, 0x2000, "workRam"),
      playfieldRam: hexToBytes(snapshot.playfieldRam, 0x2000, "playfieldRam"),
      spriteRam: hexToBytes(snapshot.spriteRam, 0x1000, "spriteRam"),
      alphaRam: hexToBytes(snapshot.alphaRam, 0x1000, "alphaRam"),
      colorRam: hexToBytes(snapshot.colorRam, 0x800, "colorRam"),
      slapsticBank: snapshot.slapsticBank ?? 1,
    },
  });
  if (dispatcher === "manual") {
    state.workRam[0x390] = 0;
    state.workRam[0x391] = 0;
  }
  state.clock.mainLoopBodyTicks = 1 as typeof state.clock.mainLoopBodyTicks;
  return state;
}

function sampleFromBuffers(frame: number | undefined, workRam: Uint8Array, playfieldRam: Uint8Array, scrollY: number): Sample {
  const obj = 0x18;
  return {
    frame,
    main: readWordBE(workRam, 0x390),
    mode: readWordBE(workRam, 0x392),
    next: readWordBE(workRam, 0x394),
    segment: workRam[0x3e4] ?? 0,
    descriptorPointer: readLongBE(workRam, 0x474),
    playerState: workRam[obj + 0x1a] ?? 0,
    timer: readWordBE(workRam, obj + 0x6a),
    xRaw: signedLong(readLongBE(workRam, obj + 0x0c)),
    yRaw: signedLong(readLongBE(workRam, obj + 0x10)),
    zRaw: signedLong(readLongBE(workRam, obj + 0x14)),
    trackballX: workRam[obj + 0xc9] ?? 0xff,
    trackballY: workRam[obj + 0xc8] ?? 0xff,
    pfCount: nonzero(playfieldRam),
    scrollY,
  };
}

function sampleGameState(state: GameState, frame: number | undefined): Sample {
  return sampleFromBuffers(frame, state.workRam, state.playfieldRam, state.videoScrollY);
}

function sampleSnapshot(snapshot: SnapshotJson): { sample: Sample; playfieldRam: Uint8Array } {
  const workRam = hexToBytes(snapshot.workRam, 0x2000, "workRam");
  const playfieldRam = hexToBytes(snapshot.playfieldRam, 0x2000, "playfieldRam");
  const scrollY = readWordBE(workRam, 0x02) & 0x1ff;
  return { sample: sampleFromBuffers(snapshot.frame, workRam, playfieldRam, scrollY), playfieldRam };
}

function compareFrame(
  routeFrame: number,
  input: InputFrame,
  tsState: GameState,
  mameSnapshot: SnapshotJson,
): FrameComparison {
  const ts = sampleGameState(tsState, mameSnapshot.frame);
  const { sample: mame, playfieldRam: mamePlayfield } = sampleSnapshot(mameSnapshot);
  const dxRaw = ts.xRaw - mame.xRaw;
  const dyRaw = ts.yRaw - mame.yRaw;
  const dzRaw = ts.zRaw - mame.zRaw;
  return {
    routeFrame,
    frame: mameSnapshot.frame,
    inputX: input.trackballX ?? 0xff,
    inputY: input.trackballY ?? 0xff,
    inputSwitches: input.switches ?? 0x6f,
    ts,
    mame,
    dxRaw,
    dyRaw,
    dzRaw,
    stateMismatch: ts.playerState !== mame.playerState,
    mainMismatch: ts.main !== mame.main || ts.mode !== mame.mode || ts.next !== mame.next,
    descriptorMismatch: ts.descriptorPointer !== mame.descriptorPointer,
    timerMismatch: ts.timer !== mame.timer,
    pfCountDelta: ts.pfCount - mame.pfCount,
    pfByteDiffs: byteDiffs(tsState.playfieldRam, mamePlayfield),
    trackballMismatch: ts.trackballX !== mame.trackballX || ts.trackballY !== mame.trackballY,
  };
}

function px(raw: number): string {
  const value = raw / 65536;
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function frameText(cmp: FrameComparison): string {
  return (
    `f+${cmp.routeFrame}/abs=${cmp.frame ?? "?"} input=${cmp.inputX}/${cmp.inputY} ` +
    `mame state=${cmp.mame.playerState} xy=${px(cmp.mame.xRaw)},${px(cmp.mame.yRaw)} z=${px(cmp.mame.zRaw)} ` +
    `ts state=${cmp.ts.playerState} xy=${px(cmp.ts.xRaw)},${px(cmp.ts.yRaw)} z=${px(cmp.ts.zRaw)} ` +
    `dRaw=${cmp.dxRaw}/${cmp.dyRaw}/${cmp.dzRaw} pfDiff=${cmp.pfByteDiffs}`
  );
}

function main(): void {
  const args = parseArgs();
  const snapshots = loadScenario(args.scenarioPath);
  const seed = snapshots[args.startIndex];
  if (seed === undefined) throw new Error(`${args.scenarioPath} has no snapshot index ${args.startIndex}`);
  const inputFrames = loadInputTrace(args.inputPath);
  const rom = loadRom(args.romPath);
  const state = loadStateFromSnapshot(rom, seed, args.dispatcher);
  const maxIndex = Math.min(
    snapshots.length - 1,
    args.maxFrames === undefined ? snapshots.length - 1 - args.startIndex : args.startIndex + args.maxFrames,
  );
  if (maxIndex <= args.startIndex) throw new Error("not enough snapshots to compare");

  const compared: FrameComparison[] = [];
  const inputXValues = new Set<number>();
  const inputYValues = new Set<number>();
  let firstStateMismatch: FrameComparison | undefined;
  let firstMainMismatch: FrameComparison | undefined;
  let firstDescriptorMismatch: FrameComparison | undefined;
  let firstTrackballMismatch: FrameComparison | undefined;
  let firstPositionDelta: FrameComparison | undefined;
  let firstLargePositionDelta: FrameComparison | undefined;
  let firstPlayfieldDiff: FrameComparison | undefined;
  let maxAbsDxRaw = 0;
  let maxAbsDyRaw = 0;
  let maxAbsDzRaw = 0;
  let maxPfByteDiffs = 0;

  for (let index = args.startIndex + 1; index <= maxIndex; index++) {
    const snapshot = snapshots[index]!;
    const input = inputFrames.get(snapshot.frame ?? -1);
    if (input === undefined) throw new Error(`input trace has no frame ${snapshot.frame ?? "?"}`);
    inputXValues.add(input.trackballX ?? 0xff);
    inputYValues.add(input.trackballY ?? 0xff);
    tick(state, {
      rom,
      runMainLoopBody: true,
      p1X: input.trackballX ?? 0xff,
      p1Y: input.trackballY ?? 0xff,
      p2X: input.trackball2X ?? 0xff,
      p2Y: input.trackball2Y ?? 0xff,
      inputMmio: input.switches ?? 0x6f,
    });
    const cmp = compareFrame(index - args.startIndex, input, state, snapshot);
    compared.push(cmp);

    const isFirstStateMismatch = firstStateMismatch === undefined && cmp.stateMismatch;
    firstStateMismatch ??= cmp.stateMismatch ? cmp : undefined;
    firstMainMismatch ??= cmp.mainMismatch ? cmp : undefined;
    firstDescriptorMismatch ??= cmp.descriptorMismatch ? cmp : undefined;
    firstTrackballMismatch ??= cmp.trackballMismatch ? cmp : undefined;
    if (firstPositionDelta === undefined && (cmp.dxRaw !== 0 || cmp.dyRaw !== 0 || cmp.dzRaw !== 0)) {
      firstPositionDelta = cmp;
    }
    if (firstLargePositionDelta === undefined && (Math.abs(cmp.dxRaw) > 0x10000 || Math.abs(cmp.dyRaw) > 0x10000)) {
      firstLargePositionDelta = cmp;
    }
    firstPlayfieldDiff ??= cmp.pfByteDiffs !== 0 ? cmp : undefined;
    maxAbsDxRaw = Math.max(maxAbsDxRaw, Math.abs(cmp.dxRaw));
    maxAbsDyRaw = Math.max(maxAbsDyRaw, Math.abs(cmp.dyRaw));
    maxAbsDzRaw = Math.max(maxAbsDzRaw, Math.abs(cmp.dzRaw));
    maxPfByteDiffs = Math.max(maxPfByteDiffs, cmp.pfByteDiffs);

    if (!args.json && (cmp.routeFrame === 1 || cmp.routeFrame % args.sampleEvery === 0 || isFirstStateMismatch)) {
      console.log(frameText(cmp));
    }
  }

  const summary: Summary = {
    scenarioPath: args.scenarioPath,
    inputPath: args.inputPath,
    dispatcher: args.dispatcher,
    seedFrame: seed.frame,
    comparedFrames: compared.length,
    inputDistinctX: inputXValues.size,
    inputDistinctY: inputYValues.size,
    firstStateMismatch,
    firstMainMismatch,
    firstDescriptorMismatch,
    firstTrackballMismatch,
    firstPositionDelta,
    firstLargePositionDelta,
    firstPlayfieldDiff,
    maxAbsDxRaw,
    maxAbsDyRaw,
    maxAbsDzRaw,
    maxPfByteDiffs,
    final: compared.at(-1),
  };

  if (args.json) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  console.log("");
  console.log(
    `Compared ${summary.comparedFrames} frames from seed f${summary.seedFrame ?? "?"} ` +
      `dispatcher=${summary.dispatcher} inputDistinct=${summary.inputDistinctX}/${summary.inputDistinctY}`,
  );
  console.log(
    `Max raw deltas: dx=${summary.maxAbsDxRaw} dy=${summary.maxAbsDyRaw} dz=${summary.maxAbsDzRaw} ` +
      `maxPfByteDiffs=${summary.maxPfByteDiffs}`,
  );
  console.log(`First state mismatch: ${summary.firstStateMismatch === undefined ? "none" : frameText(summary.firstStateMismatch)}`);
  console.log(`First main mismatch: ${summary.firstMainMismatch === undefined ? "none" : frameText(summary.firstMainMismatch)}`);
  console.log(
    `First descriptor mismatch: ${
      summary.firstDescriptorMismatch === undefined ? "none" : frameText(summary.firstDescriptorMismatch)
    }`,
  );
  console.log(
    `First trackball mismatch: ${
      summary.firstTrackballMismatch === undefined ? "none" : frameText(summary.firstTrackballMismatch)
    }`,
  );
  console.log(
    `First position delta: ${
      summary.firstPositionDelta === undefined ? "none" : frameText(summary.firstPositionDelta)
    }`,
  );
  console.log(
    `First >1px position delta: ${
      summary.firstLargePositionDelta === undefined ? "none" : frameText(summary.firstLargePositionDelta)
    }`,
  );
  console.log(`First playfield diff: ${summary.firstPlayfieldDiff === undefined ? "none" : frameText(summary.firstPlayfieldDiff)}`);
  if (summary.final !== undefined) console.log(`Final: ${frameText(summary.final)}`);
}

main();
