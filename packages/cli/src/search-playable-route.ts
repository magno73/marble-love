#!/usr/bin/env node
/**
 * search-playable-route.ts - deterministic TS route search for manual starts.
 *
 * This is a candidate generator only. A route that reaches a transition in TS
 * must still be replayed in MAME active-vs-neutral before any startLevel seed
 * can be promoted.
 */

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { argv, exit } from "node:process";

import {
  applySlapsticBank,
  bootInit,
  bus as busNs,
  level as levelNs,
  levelDispatcher16EC6 as dispatcherNs,
  state as stateNs,
  tick,
} from "@marble-love/engine";
import type { GameState, RomImage } from "@marble-love/engine";

interface SeedJson {
  name?: string;
  frame?: number;
  slapsticBank?: number;
  workRam: string;
  playfieldRam: string;
  spriteRam: string;
  alphaRam: string;
  colorRam: string;
}

interface ScenarioJson {
  name?: string;
  snapshots: SeedJson[];
}

interface CliArgs {
  seedPath: string;
  snapshotIndex: number | undefined;
  romPath: string;
  outDir: string;
  frames: number;
  chunk: number;
  stepPixels: number;
  beamWidth: number;
  maxCandidates: number;
  directions: string[];
  routePrefix: string | undefined;
  manualDispatcher: boolean;
  targetX: number;
  targetY: number;
  targetSegment: number | undefined;
  targetDescriptor: number | undefined;
  targetDescriptorPtr: number | undefined;
  diversityPrefixChunks: number | undefined;
  diversityStateBucket: number | undefined;
  maxDeaths: number | undefined;
  mameTrackballStart: number | undefined;
  descriptors?: readonly DescriptorSummary[];
}

interface StateSummary {
  main: number;
  mode: number;
  next: number;
  segment: number;
  playerState: number;
  timer: number;
  scrollY: number;
  pfNonzero: number;
  pfHash: string;
  coarseHash: string;
  descriptorPtr: number;
  descriptorLevel: number | undefined;
  descriptorPfNonzero: number | undefined;
  minPlayablePf: number;
  x: number;
  y: number;
}

interface DescriptorSummary {
  level: number;
  index: number;
  pointer: number;
  byteSize: number;
  pfNonzero: number;
  minPlayablePf: number;
}

interface SearchNode {
  state: GameState;
  p1X: number;
  p1Y: number;
  frame: number;
  chunks: string[];
  score: number;
  bestScore: number;
  bestFrame: number;
  firstState6Frame: number | undefined;
  firstMain3Frame: number | undefined;
  firstStableSegmentChangeFrame: number | undefined;
  firstTargetDescriptorFrame: number | undefined;
  firstTargetStableSegmentFrame: number | undefined;
  maxX: number;
  maxY: number;
  deathEvents: number;
  recoveries: number;
  inDeath: boolean;
  maxEmptyRun: number;
  emptyRun: number;
}

interface CandidateManifestEntry {
  file: string;
  sourceLabel: string;
  routeLabel: string;
  finalFrame: number;
  routeFrame: number;
  absoluteFrame: number | undefined;
  mameTrackballStart: number | undefined;
  forceManualDispatcher: boolean;
  forceManualFrame: number | undefined;
  routeSpec: string;
  stepPixels: number;
  segment: number;
  main: number;
  mode: number;
  timer: number;
  playerState: number;
  descriptorPtr: string;
  pfNonzero: number;
  pfHash: string;
  coarseHash: string;
  score: number;
  firstState6Frame: number | undefined;
  firstMain3Frame: number | undefined;
  firstStableSegmentChangeFrame: number | undefined;
  firstTargetDescriptorFrame: number | undefined;
  firstTargetStableSegmentFrame: number | undefined;
  maxX: number;
  maxY: number;
  deathEvents: number;
  recoveries: number;
}

const DEFAULT_SEED =
  "packages/web/public/scenarios/playable/manual_level1_start.seed.json";
const DEFAULT_ROM = "ghidra_project/marble_program.bin";
const DEFAULT_OUT_DIR = "/private/tmp/marble-manual-route-search";
const FALLBACK_MIN_PLAYABLE_PF = 4_001;
const DEFAULT_DIRECTIONS = ["D", "R", "L", "DR", "DL", "UR", "UL", "BR", "N"];
const SCREEN_DELTA_UNITS: Record<string, readonly [number, number]> = {
  D: [0, 1],
  U: [0, -1],
  R: [1, 0],
  L: [-1, 0],
  DR: [1, 1],
  DL: [-1, 1],
  UR: [1, -1],
  UL: [-1, -1],
  BR: [0.5, -0.75],
  N: [0, 0],
};

function printHelp(): void {
  console.log(`search-playable-route - deterministic TS route search

Usage:
  npx tsx packages/cli/src/search-playable-route.ts [options]

Options:
  --seed PATH            Seed JSON (default: ${DEFAULT_SEED})
                          Can also be a scenario JSON with snapshots
  --snapshot-index N     Snapshot index when --seed points at a scenario JSON
                          (default: 0 for scenario JSON)
  --rom PATH             Program ROM blob (default: ${DEFAULT_ROM})
  --out-dir DIR          Output manifest dir (default: ${DEFAULT_OUT_DIR})
  --frames N             Search horizon in route frames (default: 3600)
  --chunk N              Frames per beam expansion (default: 30)
  --step-pixels N        Trackball screen-space delta per frame (default: 8)
  --beam-width N         Nodes retained per expansion (default: 96)
  --max-candidates N     Routes written to manifest (default: 12)
  --directions LIST      Comma-separated route directions
                          (default: ${DEFAULT_DIRECTIONS.join(",")})
  --route-prefix SPEC    Fixed route prefix before beam expansion
  --preserve-dispatcher  Do not clear 0x400390 before route search
  --target-x N           Scoring target X in world pixels (default: 435.5)
  --target-y N           Scoring target Y in world pixels (default: 419.3)
  --target-segment N     Prefer stable-playable frames with runtime segment N
  --target-descriptor N  Prefer runtime level descriptor pointer L1..L6
  --diversity-prefix-chunks N
                          Retain one route per early chunk-prefix key while
                          filling the beam. Default: 8 for target searches,
                          otherwise 0.
  --diversity-state-bucket N
                          Retain one node per physical state bucket before
                          route-prefix diversity. Default: 48 for target
                          searches, otherwise 0.
  --max-deaths N         Hard cap on death events while expanding the beam.
                          Useful for rejecting attract/death-cycle routes.
  --mame-trackball-start N
                          Override MAME route start frame in manifest
  -h, --help             Show this help

The manifest is compatible with plan-mame-candidate-captures.ts. Use
--force-manual-dispatcher there, or rely on the manifest field emitted here.
`);
}

function parseArgs(): CliArgs {
  const raw = argv.slice(2);
  let seedPath = DEFAULT_SEED;
  let snapshotIndex: number | undefined;
  let romPath = DEFAULT_ROM;
  let outDir = DEFAULT_OUT_DIR;
  let frames = 3600;
  let chunk = 30;
  let stepPixels = 8;
  let beamWidth = 96;
  let maxCandidates = 12;
  let directions = DEFAULT_DIRECTIONS;
  let routePrefix: string | undefined;
  let manualDispatcher = true;
  let targetX = 435.5;
  let targetY = 419.3;
  let targetSegment: number | undefined;
  let targetDescriptor: number | undefined;
  let diversityPrefixChunks: number | undefined;
  let diversityStateBucket: number | undefined;
  let maxDeaths: number | undefined;
  let mameTrackballStart: number | undefined;

  for (let i = 0; i < raw.length; i++) {
    const arg = raw[i]!;
    if (arg === "--seed") seedPath = requireValue(raw[++i], "--seed");
    else if (arg === "--snapshot-index")
      snapshotIndex = parseNonNegativeInt(raw[++i], "--snapshot-index");
    else if (arg === "--rom") romPath = requireValue(raw[++i], "--rom");
    else if (arg === "--out-dir") outDir = requireValue(raw[++i], "--out-dir");
    else if (arg === "--frames") frames = parsePositiveInt(raw[++i], "--frames");
    else if (arg === "--chunk") chunk = parsePositiveInt(raw[++i], "--chunk");
    else if (arg === "--step-pixels")
      stepPixels = parsePositiveInt(raw[++i], "--step-pixels");
    else if (arg === "--beam-width")
      beamWidth = parsePositiveInt(raw[++i], "--beam-width");
    else if (arg === "--max-candidates")
      maxCandidates = parsePositiveInt(raw[++i], "--max-candidates");
    else if (arg === "--directions")
      directions = parseDirections(requireValue(raw[++i], "--directions"));
    else if (arg === "--route-prefix")
      routePrefix = requireValue(raw[++i], "--route-prefix");
    else if (arg === "--preserve-dispatcher") manualDispatcher = false;
    else if (arg === "--target-x") targetX = parseNumber(raw[++i], "--target-x");
    else if (arg === "--target-y") targetY = parseNumber(raw[++i], "--target-y");
    else if (arg === "--target-segment")
      targetSegment = parsePositiveInt(raw[++i], "--target-segment");
    else if (arg === "--target-descriptor")
      targetDescriptor = parseTargetDescriptor(raw[++i], "--target-descriptor");
    else if (arg === "--diversity-prefix-chunks")
      diversityPrefixChunks = parseNonNegativeInt(
        raw[++i],
        "--diversity-prefix-chunks",
      );
    else if (arg === "--diversity-state-bucket")
      diversityStateBucket = parseNonNegativeInt(raw[++i], "--diversity-state-bucket");
    else if (arg === "--max-deaths")
      maxDeaths = parseNonNegativeInt(raw[++i], "--max-deaths");
    else if (arg === "--mame-trackball-start")
      mameTrackballStart = parsePositiveInt(raw[++i], "--mame-trackball-start");
    else if (arg === "-h" || arg === "--help") {
      printHelp();
      exit(0);
    } else if (arg.startsWith("--")) {
      throw new Error(`unknown option: ${arg}`);
    } else {
      throw new Error(`unexpected positional argument: ${arg}`);
    }
  }

  return {
    seedPath,
    snapshotIndex,
    romPath,
    outDir,
    frames,
    chunk,
    stepPixels,
    beamWidth,
    maxCandidates,
    directions,
    routePrefix,
    manualDispatcher,
    targetX,
    targetY,
    targetSegment,
    targetDescriptor,
    targetDescriptorPtr: undefined,
    diversityPrefixChunks,
    diversityStateBucket,
    maxDeaths,
    mameTrackballStart,
  };
}

function requireValue(value: string | undefined, label: string): string {
  if (value === undefined) throw new Error(`${label} requires a value`);
  return value;
}

function parsePositiveInt(raw: string | undefined, label: string): number {
  if (raw === undefined) throw new Error(`${label} requires a value`);
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0)
    throw new Error(`${label} must be a positive integer`);
  return value;
}

function parseNonNegativeInt(raw: string | undefined, label: string): number {
  if (raw === undefined) throw new Error(`${label} requires a value`);
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0)
    throw new Error(`${label} must be a non-negative integer`);
  return value;
}

function parseNumber(raw: string | undefined, label: string): number {
  if (raw === undefined) throw new Error(`${label} requires a value`);
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`${label} must be numeric`);
  return value;
}

function parseTargetDescriptor(raw: string | undefined, label: string): number {
  const value = parsePositiveInt(raw, label);
  if (value < 1 || value > levelNs.LEVEL_COUNT) {
    throw new Error(`${label} must be in range 1..${levelNs.LEVEL_COUNT}`);
  }
  return value;
}

function parseDirections(raw: string): string[] {
  const directions = raw
    .split(",")
    .map((part) => part.trim().toUpperCase())
    .filter((part) => part !== "");
  if (directions.length === 0) throw new Error("--directions produced no directions");
  for (const direction of directions) {
    if (SCREEN_DELTA_UNITS[direction] === undefined)
      throw new Error(`unknown direction: ${direction}`);
  }
  return directions;
}

function hexToBytes(hex: string, expectedLength: number, label: string): Uint8Array {
  if (hex.length !== expectedLength * 2) {
    throw new Error(`${label} has ${hex.length / 2} bytes, expected ${expectedLength}`);
  }
  const out = new Uint8Array(expectedLength);
  for (let i = 0; i < expectedLength; i++)
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
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

function formatHex32(value: number | undefined): string {
  return value === undefined ? "-" : `0x${(value >>> 0).toString(16).padStart(8, "0")}`;
}

function signedLong(value: number): number {
  return value | 0;
}

function nonzero(bytes: Uint8Array): number {
  let total = 0;
  for (const value of bytes) if (value !== 0) total++;
  return total;
}

function shortHash(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex").slice(0, 16);
}

function bucketHash(bytes: Uint8Array): string {
  const buckets = new Uint16Array(64);
  for (let i = 0; i < bytes.length; i++) {
    const bucket = Math.min(
      buckets.length - 1,
      Math.floor((i * buckets.length) / bytes.length),
    );
    buckets[bucket] = ((buckets[bucket] ?? 0) + (bytes[i] ?? 0)) & 0xffff;
  }
  return createHash("sha256")
    .update(Buffer.from(buckets.buffer))
    .digest("hex")
    .slice(0, 16);
}

function expandRouteSpec(spec: string): string[] {
  const out: string[] = [];
  for (const part of spec.split(",")) {
    const trimmed = part.trim();
    if (trimmed === "") continue;
    const [directionRaw, countRaw] = trimmed.split(":");
    const direction = directionRaw?.trim().toUpperCase();
    if (
      direction === undefined ||
      countRaw === undefined ||
      SCREEN_DELTA_UNITS[direction] === undefined
    ) {
      throw new Error(`invalid route part: ${part}`);
    }
    const count = Number(countRaw);
    if (!Number.isInteger(count) || count < 0)
      throw new Error(`invalid route count in ${part}`);
    for (let i = 0; i < count; i++) out.push(direction);
  }
  return out;
}

function compressRoute(steps: readonly string[]): string {
  const parts: string[] = [];
  let last: string | undefined;
  let count = 0;
  for (const step of steps) {
    if (step === last) {
      count++;
      continue;
    }
    if (last !== undefined) parts.push(`${last}:${count}`);
    last = step;
    count = 1;
  }
  if (last !== undefined) parts.push(`${last}:${count}`);
  return parts.join(",");
}

function sanitizeFilePart(value: string): string {
  return (
    value
      .replace(/[^a-zA-Z0-9._-]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 120) || "candidate"
  );
}

function advanceTrackball(
  p1X: number,
  p1Y: number,
  step: string,
  stepPixels: number,
): readonly [number, number] {
  const [unitDx, unitDy] = SCREEN_DELTA_UNITS[step] ?? [0, 0];
  const screenDx = Math.round(unitDx * stepPixels);
  const screenDy = Math.round(unitDy * stepPixels);
  return [
    (p1X + (screenDx !== 0 ? -screenDx : 0)) & 0xff,
    (p1Y + (screenDy !== 0 ? -screenDy : 0)) & 0xff,
  ];
}

function loadRom(path: string): RomImage {
  const rom = busNs.emptyRomImage();
  applySlapsticBank.loadRomBlob(rom, readFileSync(resolve(path)));
  return rom;
}

function isScenarioJson(value: unknown): value is ScenarioJson {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as { snapshots?: unknown }).snapshots)
  );
}

function loadSeed(path: string, snapshotIndex: number | undefined): SeedJson {
  const parsed = JSON.parse(readFileSync(resolve(path), "utf-8")) as SeedJson | ScenarioJson;
  if (!isScenarioJson(parsed)) {
    if (snapshotIndex !== undefined)
      throw new Error("--snapshot-index is only valid when --seed is a scenario JSON");
    return parsed;
  }

  const index = snapshotIndex ?? 0;
  const snapshot = parsed.snapshots[index];
  if (snapshot === undefined) {
    throw new Error(
      `scenario ${path} has ${parsed.snapshots.length} snapshot(s), cannot read index ${index}`,
    );
  }
  return {
    ...snapshot,
    name: snapshot.name ?? `${parsed.name ?? "scenario"}[${index}]`,
  };
}

function stateFromSeed(
  rom: RomImage,
  seed: SeedJson,
  manualDispatcher: boolean,
): GameState {
  const gameState = stateNs.emptyGameState();
  bootInit(gameState, rom, {
    warmState: {
      workRam: hexToBytes(seed.workRam, 0x2000, "workRam"),
      playfieldRam: hexToBytes(seed.playfieldRam, 0x2000, "playfieldRam"),
      spriteRam: hexToBytes(seed.spriteRam, 0x1000, "spriteRam"),
      alphaRam: hexToBytes(seed.alphaRam, 0x1000, "alphaRam"),
      colorRam: hexToBytes(seed.colorRam, 0x800, "colorRam"),
      slapsticBank: seed.slapsticBank ?? 1,
    },
  });
  if (manualDispatcher) {
    gameState.workRam[0x390] = 0;
    gameState.workRam[0x391] = 0;
  }
  gameState.clock.mainLoopBodyTicks = 1 as typeof gameState.clock.mainLoopBodyTicks;
  return gameState;
}

function descriptorSummaries(rom: RomImage): DescriptorSummary[] {
  return levelNs.loadAllLevels(rom).map((level) => {
    const gameState = stateNs.emptyGameState();
    gameState.workRam[0x394] = (level.index >>> 8) & 0xff;
    gameState.workRam[0x395] = level.index & 0xff;
    dispatcherNs.levelDispatcher16EC6(gameState, rom);
    const pfNonzero = nonzero(gameState.playfieldRam);
    return {
      level: level.index + 1,
      index: level.index,
      pointer: level.romOffset,
      byteSize: level.byteSize,
      pfNonzero,
      minPlayablePf: Math.max(1_200, Math.floor(pfNonzero * 0.75)),
    };
  });
}

function descriptorForPointer(
  descriptors: readonly DescriptorSummary[] | undefined,
  pointer: number,
): DescriptorSummary | undefined {
  return descriptors?.find((descriptor) => descriptor.pointer === pointer);
}

function summarize(
  state: GameState,
  descriptors?: readonly DescriptorSummary[],
): StateSummary {
  const descriptorPtr = readLongBE(state.workRam, 0x474);
  const descriptor = descriptorForPointer(descriptors, descriptorPtr);
  return {
    main: readWordBE(state.workRam, 0x390),
    mode: readWordBE(state.workRam, 0x392),
    next: readWordBE(state.workRam, 0x394),
    segment: state.workRam[0x3e4] ?? 0,
    playerState: state.workRam[0x18 + 0x1a] ?? 0,
    timer: readWordBE(state.workRam, 0x18 + 0x6a),
    scrollY: state.videoScrollY,
    pfNonzero: nonzero(state.playfieldRam),
    pfHash: shortHash(state.playfieldRam),
    coarseHash: bucketHash(state.playfieldRam),
    descriptorPtr,
    descriptorLevel: descriptor?.level,
    descriptorPfNonzero: descriptor?.pfNonzero,
    minPlayablePf: descriptor?.minPlayablePf ?? FALLBACK_MIN_PLAYABLE_PF,
    x: signedLong(readLongBE(state.workRam, 0x18 + 0x0c)) / 65536,
    y: signedLong(readLongBE(state.workRam, 0x18 + 0x10)) / 65536,
  };
}

function isStablePlayable(summary: StateSummary): boolean {
  return (
    (summary.main === 0 || summary.main === 1) &&
    summary.mode === 0 &&
    summary.playerState === 0 &&
    summary.timer > 0 &&
    summary.pfNonzero >= summary.minPlayablePf
  );
}

function scoreSummary(
  summary: StateSummary,
  node: SearchNode,
  args: CliArgs,
  initialSegment: number,
): number {
  const distance = Math.hypot(
    (args.targetX - summary.x) * 1.15,
    args.targetY - summary.y,
  );
  const targetRequested =
    args.targetDescriptorPtr !== undefined || args.targetSegment !== undefined;
  let score = 0;
  score += summary.x * 5;
  score += summary.y * 9;
  score += node.maxX * 1.5;
  score += node.maxY * 1.5;
  score -= distance * 12;
  score += summary.timer * 80;

  if (summary.main === 3 && summary.timer > 0)
    score += targetRequested ? 25_000 : 1_000_000;
  if (summary.playerState === 6 && summary.timer > 0)
    score += targetRequested ? 20_000 : 750_000;
  const stablePlayable = isStablePlayable(summary);
  if (stablePlayable) score += 3_000;
  if (summary.segment !== initialSegment && stablePlayable) score += 12_000;
  if (args.targetSegment !== undefined) {
    if (summary.segment === args.targetSegment && stablePlayable) score += 2_000_000;
    score -= Math.abs(summary.segment - args.targetSegment) * 6_000;
  }
  if (args.targetDescriptorPtr !== undefined) {
    if (summary.descriptorPtr === args.targetDescriptorPtr) {
      score += 3_000_000;
      if (summary.playerState === 6 && summary.timer > 0) score += 500_000;
      if (stablePlayable) score += 250_000;
    } else if (summary.descriptorPtr !== 0) {
      score -= 15_000;
    }
  }
  if (summary.pfNonzero < summary.minPlayablePf && summary.timer > 0)
    score -= targetRequested ? 60_000 : 20_000;
  if (summary.timer <= 0) score -= 80_000;
  if (summary.playerState === 4 || summary.playerState === 5)
    score -= targetRequested ? 50_000 : 3_500;
  if (summary.playerState === 1 || summary.playerState === 2)
    score -= targetRequested ? 15_000 : 2_000;
  score -= node.deathEvents * (targetRequested ? 50_000 : 950);
  score += node.recoveries * 250;
  score -= node.maxEmptyRun * (targetRequested ? 2_000 : 400);
  return score;
}

function tickNode(
  rom: RomImage,
  node: SearchNode,
  direction: string,
  frames: number,
  args: CliArgs,
  initialSegment: number,
): SearchNode {
  const state = stateNs.snapshotGameState(node.state);
  let p1X = node.p1X;
  let p1Y = node.p1Y;
  let frame = node.frame;
  let firstState6Frame = node.firstState6Frame;
  let firstMain3Frame = node.firstMain3Frame;
  let firstStableSegmentChangeFrame = node.firstStableSegmentChangeFrame;
  let firstTargetDescriptorFrame = node.firstTargetDescriptorFrame;
  let firstTargetStableSegmentFrame = node.firstTargetStableSegmentFrame;
  let maxX = node.maxX;
  let maxY = node.maxY;
  let deathEvents = node.deathEvents;
  let recoveries = node.recoveries;
  let inDeath = node.inDeath;
  let maxEmptyRun = node.maxEmptyRun;
  let emptyRun = node.emptyRun;
  let bestScore = node.bestScore;
  let bestFrame = node.bestFrame;
  let finalScore = node.score;

  for (let i = 0; i < frames; i++) {
    frame++;
    [p1X, p1Y] = advanceTrackball(p1X, p1Y, direction, args.stepPixels);
    tick(state, {
      rom,
      runMainLoopBody: true,
      p1X,
      p1Y,
      p2X: 0xff,
      p2Y: 0xff,
      inputMmio: 0x6f,
    });

    const summary = summarize(state, args.descriptors);
    maxX = Math.max(maxX, summary.x);
    maxY = Math.max(maxY, summary.y);
    if (summary.pfNonzero === 0) {
      emptyRun++;
    } else {
      maxEmptyRun = Math.max(maxEmptyRun, emptyRun);
      emptyRun = 0;
    }

    const isDeath = summary.playerState === 4 || summary.playerState === 5;
    if (isDeath && !inDeath) {
      deathEvents++;
      inDeath = true;
    } else if (inDeath && summary.playerState === 0) {
      recoveries++;
      inDeath = false;
    }

    if (
      firstState6Frame === undefined &&
      summary.playerState === 6 &&
      summary.timer > 0
    ) {
      firstState6Frame = frame;
    }
    if (firstMain3Frame === undefined && summary.main === 3 && summary.timer > 0) {
      firstMain3Frame = frame;
    }
    if (
      firstStableSegmentChangeFrame === undefined &&
      summary.segment !== initialSegment &&
      isStablePlayable(summary)
    ) {
      firstStableSegmentChangeFrame = frame;
    }
    if (
      firstTargetStableSegmentFrame === undefined &&
      args.targetSegment !== undefined &&
      summary.segment === args.targetSegment &&
      isStablePlayable(summary)
    ) {
      firstTargetStableSegmentFrame = frame;
    }
    if (
      firstTargetDescriptorFrame === undefined &&
      args.targetDescriptorPtr !== undefined &&
      summary.descriptorPtr === args.targetDescriptorPtr
    ) {
      firstTargetDescriptorFrame = frame;
    }

    const scoredNode: SearchNode = {
      ...node,
      state,
      p1X,
      p1Y,
      frame,
      firstState6Frame,
      firstMain3Frame,
      firstStableSegmentChangeFrame,
      firstTargetDescriptorFrame,
      firstTargetStableSegmentFrame,
      maxX,
      maxY,
      deathEvents,
      recoveries,
      inDeath,
      maxEmptyRun,
      emptyRun,
      bestScore,
      bestFrame,
    };
    finalScore = scoreSummary(summary, scoredNode, args, initialSegment);
    if (finalScore > bestScore) {
      bestScore = finalScore;
      bestFrame = frame;
    }
  }

  maxEmptyRun = Math.max(maxEmptyRun, emptyRun);
  return {
    state,
    p1X,
    p1Y,
    frame,
    chunks: [...node.chunks, ...Array.from({ length: frames }, () => direction)],
    score: finalScore,
    bestScore,
    bestFrame,
    firstState6Frame,
    firstMain3Frame,
    firstStableSegmentChangeFrame,
    firstTargetDescriptorFrame,
    firstTargetStableSegmentFrame,
    maxX,
    maxY,
    deathEvents,
    recoveries,
    inDeath,
    maxEmptyRun,
    emptyRun,
  };
}

function runPrefix(
  rom: RomImage,
  node: SearchNode,
  prefix: readonly string[],
  args: CliArgs,
  initialSegment: number,
): SearchNode {
  let current = node;
  for (const step of prefix) {
    current = tickNode(rom, current, step, 1, args, initialSegment);
  }
  return { ...current, chunks: prefix.slice() };
}

function sortNodes(a: SearchNode, b: SearchNode, args: CliArgs): number {
  const targetRequested =
    args.targetDescriptorPtr !== undefined || args.targetSegment !== undefined;
  if (targetRequested) {
    const aHit =
      a.firstTargetDescriptorFrame !== undefined
        ? 2
        : a.firstTargetStableSegmentFrame !== undefined
          ? 1
          : 0;
    const bHit =
      b.firstTargetDescriptorFrame !== undefined
        ? 2
        : b.firstTargetStableSegmentFrame !== undefined
          ? 1
          : 0;
    return bHit - aHit || b.score - a.score || b.bestScore - a.bestScore;
  }

  const aHit =
    a.firstTargetDescriptorFrame !== undefined
      ? 5
      : a.firstTargetStableSegmentFrame !== undefined
        ? 4
        : a.firstMain3Frame !== undefined
          ? 3
          : a.firstState6Frame !== undefined
            ? 2
            : a.firstStableSegmentChangeFrame !== undefined
              ? 1
              : 0;
  const bHit =
    b.firstTargetDescriptorFrame !== undefined
      ? 5
      : b.firstTargetStableSegmentFrame !== undefined
        ? 4
        : b.firstMain3Frame !== undefined
          ? 3
          : b.firstState6Frame !== undefined
            ? 2
            : b.firstStableSegmentChangeFrame !== undefined
              ? 1
              : 0;
  return bHit - aHit || b.bestScore - a.bestScore || b.score - a.score;
}

function chunkDirections(node: SearchNode, chunkFrames: number): string[] {
  const chunks: string[] = [];
  for (let start = 0; start < node.chunks.length; start += chunkFrames) {
    chunks.push(node.chunks[start] ?? "N");
  }
  return chunks;
}

function diversityKey(node: SearchNode, args: CliArgs): string {
  const prefixChunks = args.diversityPrefixChunks ?? 0;
  if (prefixChunks <= 0) return "";
  const routeChunks = chunkDirections(node, args.chunk).slice(0, prefixChunks);
  const summary = summarize(node.state, args.descriptors);
  return [
    routeChunks.join("/"),
    `desc=${formatHex32(summary.descriptorPtr)}`,
    `seg=${summary.segment}`,
    `state=${summary.playerState}`,
  ].join("|");
}

function stateDiversityKey(node: SearchNode, args: CliArgs): string {
  const bucket = args.diversityStateBucket ?? 0;
  if (bucket <= 0) return "";
  const summary = summarize(node.state, args.descriptors);
  return [
    `desc=${formatHex32(summary.descriptorPtr)}`,
    `main=${summary.main}`,
    `mode=${summary.mode}`,
    `seg=${summary.segment}`,
    `state=${summary.playerState}`,
    `x=${Math.floor(summary.x / bucket)}`,
    `y=${Math.floor(summary.y / bucket)}`,
    `scroll=${Math.floor(summary.scrollY / bucket)}`,
    `timer=${Math.floor(summary.timer / 5)}`,
    `pf=${Math.floor(summary.pfNonzero / 256)}`,
  ].join("|");
}

function selectBeam(sortedNodes: SearchNode[], args: CliArgs): SearchNode[] {
  const prefixChunks = args.diversityPrefixChunks ?? 0;
  const stateBucket = args.diversityStateBucket ?? 0;
  if (prefixChunks <= 0 && stateBucket <= 0)
    return sortedNodes.slice(0, args.beamWidth);

  const selected: SearchNode[] = [];
  const selectedSet = new Set<SearchNode>();
  if (stateBucket > 0) {
    const seenStateKeys = new Set<string>();
    for (const node of sortedNodes) {
      const key = stateDiversityKey(node, args);
      if (seenStateKeys.has(key)) continue;
      seenStateKeys.add(key);
      selected.push(node);
      selectedSet.add(node);
      if (selected.length >= args.beamWidth) return selected;
    }
  }
  if (prefixChunks > 0) {
    const seenRouteKeys = new Set<string>();
    for (const node of sortedNodes) {
      if (selectedSet.has(node)) continue;
      const key = diversityKey(node, args);
      if (seenRouteKeys.has(key)) continue;
      seenRouteKeys.add(key);
      selected.push(node);
      selectedSet.add(node);
      if (selected.length >= args.beamWidth) return selected;
    }
  }
  for (const node of sortedNodes) {
    if (selectedSet.has(node)) continue;
    selected.push(node);
    if (selected.length >= args.beamWidth) break;
  }
  return selected;
}

function filterByHardLimits(nodes: SearchNode[], args: CliArgs): SearchNode[] {
  if (args.maxDeaths === undefined) return nodes;
  return nodes.filter((node) => node.deathEvents <= args.maxDeaths!);
}

function routeFrameForCandidate(node: SearchNode): number {
  return (
    node.firstTargetDescriptorFrame ??
    node.firstTargetStableSegmentFrame ??
    node.firstMain3Frame ??
    node.firstState6Frame ??
    node.firstStableSegmentChangeFrame ??
    node.bestFrame
  );
}

function manifestEntry(
  index: number,
  node: SearchNode,
  seed: SeedJson,
  args: CliArgs,
): CandidateManifestEntry {
  const summary = summarize(node.state, args.descriptors);
  const routeSpec = compressRoute(node.chunks);
  const routeFrame = routeFrameForCandidate(node);
  const seedFrame = seed.frame;
  const mameTrackballStart =
    args.mameTrackballStart ?? (seedFrame === undefined ? undefined : seedFrame + 1);
  const file = `${String(index + 1).padStart(2, "0")}_route_f${routeFrame}_seg${summary.segment}_${sanitizeFilePart(summary.pfHash)}.seed.json`;
  return {
    file,
    sourceLabel: `route_f${routeFrame}`,
    routeLabel: "manual-route-search",
    finalFrame: node.frame,
    routeFrame,
    absoluteFrame: seedFrame === undefined ? undefined : seedFrame + routeFrame,
    mameTrackballStart,
    forceManualDispatcher: args.manualDispatcher,
    forceManualFrame: args.manualDispatcher ? mameTrackballStart : undefined,
    routeSpec,
    stepPixels: args.stepPixels,
    segment: summary.segment,
    main: summary.main,
    mode: summary.mode,
    timer: summary.timer,
    playerState: summary.playerState,
    descriptorPtr: formatHex32(summary.descriptorPtr),
    pfNonzero: summary.pfNonzero,
    pfHash: summary.pfHash,
    coarseHash: summary.coarseHash,
    score: node.bestScore,
    firstState6Frame: node.firstState6Frame,
    firstMain3Frame: node.firstMain3Frame,
    firstStableSegmentChangeFrame: node.firstStableSegmentChangeFrame,
    firstTargetDescriptorFrame: node.firstTargetDescriptorFrame,
    firstTargetStableSegmentFrame: node.firstTargetStableSegmentFrame,
    maxX: node.maxX,
    maxY: node.maxY,
    deathEvents: node.deathEvents,
    recoveries: node.recoveries,
  };
}

function printNode(index: number, node: SearchNode, args: CliArgs): void {
  const summary = summarize(node.state, args.descriptors);
  console.log(
    `${String(index + 1).padStart(2, "0")} score=${node.bestScore.toFixed(0)} frame=${node.frame} ` +
      `routeFrame=${routeFrameForCandidate(node)} first6=${node.firstState6Frame ?? "-"} ` +
      `firstMain3=${node.firstMain3Frame ?? "-"} stableSeg=${node.firstStableSegmentChangeFrame ?? "-"} ` +
      `targetDesc=${node.firstTargetDescriptorFrame ?? "-"} targetSeg=${node.firstTargetStableSegmentFrame ?? "-"} ` +
      `main/mode=${summary.main}/${summary.mode} seg=${summary.segment} state=${summary.playerState} timer=${summary.timer} ` +
      `desc=${formatHex32(summary.descriptorPtr)} ` +
      `x=${summary.x.toFixed(1)} y=${summary.y.toFixed(1)} max=${node.maxX.toFixed(1)}/${node.maxY.toFixed(1)} ` +
      `pf=${summary.pfNonzero} deaths=${node.deathEvents} recoveries=${node.recoveries}`,
  );
  console.log(`   ${compressRoute(node.chunks)}`);
}

function main(): void {
  const args = parseArgs();
  const rom = loadRom(args.romPath);
  args.descriptors = descriptorSummaries(rom);
  if (args.targetDescriptor !== undefined) {
    args.targetDescriptorPtr =
      levelNs.readLevelPointerTable(rom)[args.targetDescriptor - 1];
    if (args.targetDescriptorPtr === undefined)
      throw new Error(`missing descriptor pointer for L${args.targetDescriptor}`);
  }
  const targetRequested =
    args.targetDescriptorPtr !== undefined || args.targetSegment !== undefined;
  if (args.diversityPrefixChunks === undefined) {
    args.diversityPrefixChunks = targetRequested ? 8 : 0;
  }
  if (args.diversityStateBucket === undefined) {
    args.diversityStateBucket = targetRequested ? 48 : 0;
  }
  const seed = loadSeed(args.seedPath, args.snapshotIndex);
  const seedState = stateFromSeed(rom, seed, args.manualDispatcher);
  const initial = summarize(seedState, args.descriptors);
  const prefix =
    args.routePrefix === undefined ? [] : expandRouteSpec(args.routePrefix);
  const initialNode: SearchNode = {
    state: seedState,
    p1X: seedState.workRam[0x18 + 0xc9] ?? 0xff,
    p1Y: seedState.workRam[0x18 + 0xc8] ?? 0xff,
    frame: 0,
    chunks: [],
    score: Number.NEGATIVE_INFINITY,
    bestScore: Number.NEGATIVE_INFINITY,
    bestFrame: 0,
    firstState6Frame: undefined,
    firstMain3Frame: undefined,
    firstStableSegmentChangeFrame: undefined,
    firstTargetDescriptorFrame: undefined,
    firstTargetStableSegmentFrame: undefined,
    maxX: initial.x,
    maxY: initial.y,
    deathEvents: 0,
    recoveries: 0,
    inDeath: false,
    maxEmptyRun: 0,
    emptyRun: 0,
  };
  const prefixed = runPrefix(rom, initialNode, prefix, args, initial.segment);
  let beam = [prefixed];
  const iterations = Math.ceil(Math.max(0, args.frames - prefix.length) / args.chunk);

  console.log(
    `search seed=${resolve(args.seedPath)} frames=${args.frames} chunk=${args.chunk} stepPixels=${args.stepPixels} ` +
      `beam=${args.beamWidth} directions=${args.directions.join("/")} manualDispatcher=${args.manualDispatcher} ` +
      `targetSegment=${args.targetSegment ?? "-"} targetDescriptor=${args.targetDescriptor ?? "-"} ` +
      `targetDescriptorPtr=${formatHex32(args.targetDescriptorPtr)} diversityPrefixChunks=${args.diversityPrefixChunks} ` +
      `diversityStateBucket=${args.diversityStateBucket} maxDeaths=${args.maxDeaths ?? "-"}`,
  );
  console.log(
    `initial main/mode=${initial.main}/${initial.mode} seg=${initial.segment} state=${initial.playerState} ` +
      `timer=${initial.timer} x=${initial.x.toFixed(1)} y=${initial.y.toFixed(1)} pf=${initial.pfNonzero}`,
  );

  for (let iteration = 1; iteration <= iterations; iteration++) {
    const next: SearchNode[] = [];
    const remainingFrames = args.frames - beam[0]!.frame;
    const framesThisChunk = Math.min(args.chunk, Math.max(0, remainingFrames));
    if (framesThisChunk === 0) break;
    for (const node of beam) {
      for (const direction of args.directions) {
        next.push(
          tickNode(rom, node, direction, framesThisChunk, args, initial.segment),
        );
      }
    }
    const limitedNext = filterByHardLimits(next, args);
    if (limitedNext.length === 0) {
      console.log(
        `[search] stopping at frame ${beam[0]!.frame}; all ${next.length} expansions violate hard limits`,
      );
      break;
    }
    limitedNext.sort((a, b) => sortNodes(a, b, args));
    beam = selectBeam(limitedNext, args);
    const best = beam[0]!;
    if (
      iteration % 10 === 0 ||
      best.firstState6Frame !== undefined ||
      best.firstMain3Frame !== undefined
    ) {
      printNode(0, best, args);
    }
    if (
      args.targetDescriptorPtr === undefined &&
      args.targetSegment === undefined &&
      best.firstMain3Frame !== undefined
    ) {
      break;
    }
  }

  const unique = new Map<string, SearchNode>();
  for (const node of beam.sort((a, b) => sortNodes(a, b, args))) {
    const route = compressRoute(node.chunks);
    if (!unique.has(route)) unique.set(route, node);
    if (unique.size >= args.maxCandidates) break;
  }
  const candidates = Array.from(unique.values()).slice(0, args.maxCandidates);
  const manifestCandidates = candidates.map((candidate, index) =>
    manifestEntry(index, candidate, seed, args),
  );

  mkdirSync(resolve(args.outDir), { recursive: true });
  writeFileSync(
    join(resolve(args.outDir), "manifest.json"),
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        interpretation:
          "TS route-search candidates only. Replay active-vs-neutral in MAME before promoting any startLevel seed.",
        seedPath: resolve(args.seedPath),
        romPath: resolve(args.romPath),
        search: {
          frames: args.frames,
          chunk: args.chunk,
          stepPixels: args.stepPixels,
          beamWidth: args.beamWidth,
          directions: args.directions,
          routePrefix: args.routePrefix,
          manualDispatcher: args.manualDispatcher,
          snapshotIndex: args.snapshotIndex,
          targetX: args.targetX,
          targetY: args.targetY,
          targetSegment: args.targetSegment,
          targetDescriptor: args.targetDescriptor,
          targetDescriptorPtr:
            args.targetDescriptorPtr === undefined
              ? undefined
              : formatHex32(args.targetDescriptorPtr),
          diversityPrefixChunks: args.diversityPrefixChunks,
          diversityStateBucket: args.diversityStateBucket,
          maxDeaths: args.maxDeaths,
          completedFrames: beam[0]?.frame,
        },
        candidates: manifestCandidates,
      },
      null,
      2,
    )}\n`,
  );

  console.log(`\nTop ${candidates.length} route candidate(s):`);
  candidates.forEach((candidate, index) => printNode(index, candidate, args));
  console.log(`\nWrote manifest: ${join(resolve(args.outDir), "manifest.json")}`);
  console.log(
    "Run plan-mame-candidate-captures.ts on this manifest before treating any candidate as proof.",
  );
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  exit(1);
}
