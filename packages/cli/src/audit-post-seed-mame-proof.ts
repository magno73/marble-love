#!/usr/bin/env node
/**
 * audit-post-seed-mame-proof.ts - verify MAME control after a candidate seed.
 *
 * The regular frontier audit compares active and neutral captures at the seed
 * frame. That is useful for triage, but it can accept states that were already
 * influenced by pre-seed input. This stricter proof expects active and neutral
 * MAME runs to be byte-identical at the first snapshot, then diverge only after
 * the scripted route starts on the following frames.
 */

import { readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { argv, exit } from "node:process";

import {
  applySlapsticBank,
  bus as busNs,
  level as levelNs,
  levelDispatcher16EC6 as dispatcherNs,
  state as stateNs,
} from "@marble-love/engine";
import type { RomImage } from "@marble-love/engine";

interface SeedJson {
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
  snapshots?: SeedJson[];
}

interface CliArgs {
  activePath: string;
  neutralPath: string;
  romPath: string;
  distinctFrom: string[];
  minPlayfieldDiff: number;
  minMameDiff: number;
  maxRouteDeaths: number;
  minTailFrames: number;
  json: boolean;
}

interface DescriptorSummary {
  level: number;
  index: number;
  pointer: number;
  byteSize: number;
  pfNonzero: number;
  minPlayablePf: number;
}

interface SeedSummary {
  frame: number | undefined;
  main: number;
  mode: number;
  next: number;
  descriptorPointer: number;
  descriptorLevel: number | undefined;
  descriptorPfNonzero: number | undefined;
  minPlayablePf: number;
  segment: number;
  playerState: number;
  timer: number;
  scrollWord: number;
  x: number;
  y: number;
  z: number;
  pfCount: number;
}

interface RegionDiffSummary {
  workRam: number;
  playfieldRam: number;
  spriteRam: number;
  alphaRam: number;
  colorRam: number;
  exact: boolean;
}

interface TailSummary {
  comparedFrames: number;
  firstFrame: number | undefined;
  lastFrame: number | undefined;
  maxDiffX: number;
  maxDiffY: number;
  maxDiffFrame: number | undefined;
  responsive: boolean;
  activeDeathEvents: number;
  neutralDeathEvents: number;
  activeRecoveries: number;
  neutralRecoveries: number;
  activeMaxState1Run: number;
  activeMaxState2Run: number;
  activeMaxState6Run: number;
  neutralMaxState1Run: number;
  neutralMaxState2Run: number;
  neutralMaxState6Run: number;
  activeFinal: SeedSummary;
  neutralFinal: SeedSummary;
  stable: boolean;
}

interface ReferenceSummary {
  path: string;
  diffs: number;
  exactMatch: boolean;
  nearDuplicate: boolean;
}

interface AuditSummary {
  activePath: string;
  neutralPath: string;
  seed: SeedSummary;
  seedDiffs: RegionDiffSummary;
  references: ReferenceSummary[];
  tail: TailSummary;
  verdict: "post-seed-candidate" | "diagnostic-only";
  reasons: string[];
}

const DEFAULT_ROM = "ghidra_project/marble_program.bin";
const DEFAULT_DISTINCT_FROM = ["packages/web/public/scenarios/playable/manual_level1_start.seed.json"];
const DEFAULT_MIN_PLAYFIELD_DIFF = 512;
const DEFAULT_MIN_MAME_DIFF = 1_000_000;
const DEFAULT_MAX_ROUTE_DEATHS = 0;
const DEFAULT_MIN_TAIL_FRAMES = 60;
const FALLBACK_MIN_PLAYABLE_PF = 4_001;

function printHelp(): void {
  console.log(`audit-post-seed-mame-proof - verify active-vs-neutral after seed

Usage:
  node --import tsx packages/cli/src/audit-post-seed-mame-proof.ts [options] active.json neutral.json

Options:
  --rom PATH              Program ROM blob (default: ${DEFAULT_ROM})
  --distinct-from PATH    Reject near-duplicate playfield references. Repeatable.
                          Defaults to ${DEFAULT_DISTINCT_FROM[0]}
  --min-playfield-diff N  Minimum byte diff from each reference (default: ${DEFAULT_MIN_PLAYFIELD_DIFF})
  --min-mame-diff N       Raw fixed-point XY diff proving MAME response (default: ${DEFAULT_MIN_MAME_DIFF})
  --max-route-deaths N    Max death events allowed after the seed (default: ${DEFAULT_MAX_ROUTE_DEATHS})
  --min-tail-frames N     Minimum aligned post-seed frames required (default: ${DEFAULT_MIN_TAIL_FRAMES})
  --json                  Emit machine-readable JSON
  -h, --help              Show this help

Generate inputs by running paired MAME captures where active and neutral are
identical through the seed frame, and MARBLE_PLAYABLE_TRACKBALL_START is
seedFrame+1 or later. This tool never writes or wires startLevel seeds.
`);
}

function parseArgs(): CliArgs {
  const raw = argv.slice(2);
  const paths: string[] = [];
  let romPath = DEFAULT_ROM;
  const distinctFrom: string[] = [];
  let minPlayfieldDiff = DEFAULT_MIN_PLAYFIELD_DIFF;
  let minMameDiff = DEFAULT_MIN_MAME_DIFF;
  let maxRouteDeaths = DEFAULT_MAX_ROUTE_DEATHS;
  let minTailFrames = DEFAULT_MIN_TAIL_FRAMES;
  let json = false;

  for (let i = 0; i < raw.length; i++) {
    const arg = raw[i]!;
    if (arg === "--rom") romPath = requireValue(raw[++i], "--rom");
    else if (arg === "--distinct-from") distinctFrom.push(requireValue(raw[++i], "--distinct-from"));
    else if (arg === "--min-playfield-diff") minPlayfieldDiff = parseNonNegativeInt(raw[++i], "--min-playfield-diff");
    else if (arg === "--min-mame-diff") minMameDiff = parseNonNegativeInt(raw[++i], "--min-mame-diff");
    else if (arg === "--max-route-deaths") maxRouteDeaths = parseNonNegativeInt(raw[++i], "--max-route-deaths");
    else if (arg === "--min-tail-frames") minTailFrames = parseNonNegativeInt(raw[++i], "--min-tail-frames");
    else if (arg === "--json") json = true;
    else if (arg === "-h" || arg === "--help") {
      printHelp();
      exit(0);
    } else if (arg.startsWith("--")) {
      throw new Error(`unknown option: ${arg}`);
    } else {
      paths.push(arg);
    }
  }

  if (paths.length !== 2) throw new Error("expected active.json and neutral.json");
  return {
    activePath: paths[0]!,
    neutralPath: paths[1]!,
    romPath,
    distinctFrom: distinctFrom.length === 0 ? DEFAULT_DISTINCT_FROM : distinctFrom,
    minPlayfieldDiff,
    minMameDiff,
    maxRouteDeaths,
    minTailFrames,
    json,
  };
}

function requireValue(raw: string | undefined, label: string): string {
  if (raw === undefined || raw === "") throw new Error(`${label} requires a value`);
  return raw;
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
    ((bytes[off] ?? 0) * 0x1000000 +
      ((bytes[off + 1] ?? 0) << 16) +
      ((bytes[off + 2] ?? 0) << 8) +
      (bytes[off + 3] ?? 0)) >>>
    0
  );
}

function signedLong(value: number): number {
  return value > 0x7fffffff ? value - 0x100000000 : value;
}

function fixed16(workRam: Uint8Array, off: number): number {
  return signedLong(readLongBE(workRam, off)) / 65536;
}

function nonzero(bytes: Uint8Array): number {
  let total = 0;
  for (const value of bytes) if (value !== 0) total++;
  return total;
}

function countDiffs(a: Uint8Array, b: Uint8Array): number {
  if (a.length !== b.length) throw new Error(`length mismatch ${a.length} vs ${b.length}`);
  let total = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) total++;
  return total;
}

function loadRom(path: string): RomImage {
  const rom = busNs.emptyRomImage();
  applySlapsticBank.loadRomBlob(rom, readFileSync(resolve(path)));
  return rom;
}

function loadScenario(path: string): SeedJson[] {
  const raw = JSON.parse(readFileSync(resolve(path), "utf-8")) as ScenarioJson | SeedJson;
  if ("snapshots" in raw && Array.isArray(raw.snapshots)) {
    if (raw.snapshots.length === 0) throw new Error(`${path} has no snapshots`);
    return raw.snapshots;
  }
  if ("workRam" in raw) return [raw as SeedJson];
  throw new Error(`${path} is not a scenario or seed JSON`);
}

function loadFirstSeed(path: string): SeedJson {
  return loadScenario(path)[0]!;
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

function descriptorForPointer(descriptors: readonly DescriptorSummary[], pointer: number): DescriptorSummary | undefined {
  return descriptors.find((descriptor) => descriptor.pointer === pointer);
}

function seedSummary(seed: SeedJson, descriptors: readonly DescriptorSummary[]): SeedSummary {
  const workRam = hexToBytes(seed.workRam, 0x2000, "workRam");
  const playfieldRam = hexToBytes(seed.playfieldRam, 0x2000, "playfieldRam");
  const descriptorPointer = readLongBE(workRam, 0x474);
  const descriptor = descriptorForPointer(descriptors, descriptorPointer);
  return {
    frame: seed.frame,
    main: readWordBE(workRam, 0x390),
    mode: readWordBE(workRam, 0x392),
    next: readWordBE(workRam, 0x394),
    descriptorPointer,
    descriptorLevel: descriptor?.level,
    descriptorPfNonzero: descriptor?.pfNonzero,
    minPlayablePf: descriptor?.minPlayablePf ?? FALLBACK_MIN_PLAYABLE_PF,
    segment: workRam[0x3e4] ?? 0,
    playerState: workRam[0x18 + 0x1a] ?? 0,
    timer: readWordBE(workRam, 0x18 + 0x6a),
    scrollWord: readWordBE(workRam, 0x2) & 0x1ff,
    x: fixed16(workRam, 0x18 + 0x0c),
    y: fixed16(workRam, 0x18 + 0x10),
    z: fixed16(workRam, 0x18 + 0x14),
    pfCount: nonzero(playfieldRam),
  };
}

function regionDiffs(active: SeedJson, neutral: SeedJson): RegionDiffSummary {
  const diffs = {
    workRam: countDiffs(hexToBytes(active.workRam, 0x2000, "active workRam"), hexToBytes(neutral.workRam, 0x2000, "neutral workRam")),
    playfieldRam: countDiffs(hexToBytes(active.playfieldRam, 0x2000, "active playfieldRam"), hexToBytes(neutral.playfieldRam, 0x2000, "neutral playfieldRam")),
    spriteRam: countDiffs(hexToBytes(active.spriteRam, 0x1000, "active spriteRam"), hexToBytes(neutral.spriteRam, 0x1000, "neutral spriteRam")),
    alphaRam: countDiffs(hexToBytes(active.alphaRam, 0x1000, "active alphaRam"), hexToBytes(neutral.alphaRam, 0x1000, "neutral alphaRam")),
    colorRam: countDiffs(hexToBytes(active.colorRam, 0x800, "active colorRam"), hexToBytes(neutral.colorRam, 0x800, "neutral colorRam")),
  };
  return { ...diffs, exact: Object.values(diffs).every((value) => value === 0) };
}

function rawX(seed: SeedJson): number {
  return signedLong(readLongBE(hexToBytes(seed.workRam, 0x2000, "workRam"), 0x18 + 0x0c));
}

function rawY(seed: SeedJson): number {
  return signedLong(readLongBE(hexToBytes(seed.workRam, 0x2000, "workRam"), 0x18 + 0x10));
}

function summarizeRuns(snapshots: readonly SeedJson[]): {
  deathEvents: number;
  recoveries: number;
  maxState1Run: number;
  maxState2Run: number;
  maxState6Run: number;
} {
  let deathEvents = 0;
  let recoveries = 0;
  let inDeath = false;
  let state1Run = 0;
  let state2Run = 0;
  let state6Run = 0;
  let maxState1Run = 0;
  let maxState2Run = 0;
  let maxState6Run = 0;

  for (const snapshot of snapshots) {
    const workRam = hexToBytes(snapshot.workRam, 0x2000, "workRam");
    const state = workRam[0x18 + 0x1a] ?? 0;
    if (state === 1) state1Run++;
    else {
      maxState1Run = Math.max(maxState1Run, state1Run);
      state1Run = 0;
    }
    if (state === 2) state2Run++;
    else {
      maxState2Run = Math.max(maxState2Run, state2Run);
      state2Run = 0;
    }
    if (state === 6) state6Run++;
    else {
      maxState6Run = Math.max(maxState6Run, state6Run);
      state6Run = 0;
    }

    const isDeath = state === 4 || state === 5;
    if (isDeath && !inDeath) {
      deathEvents++;
      inDeath = true;
    } else if (inDeath && state === 0) {
      recoveries++;
      inDeath = false;
    }
  }

  return {
    deathEvents,
    recoveries,
    maxState1Run: Math.max(maxState1Run, state1Run),
    maxState2Run: Math.max(maxState2Run, state2Run),
    maxState6Run: Math.max(maxState6Run, state6Run),
  };
}

function frameMap(snapshots: readonly SeedJson[]): Map<number, SeedJson> {
  const out = new Map<number, SeedJson>();
  for (let i = 0; i < snapshots.length; i++) {
    const frame = snapshots[i]!.frame ?? i;
    out.set(frame, snapshots[i]!);
  }
  return out;
}

function compareTail(
  active: readonly SeedJson[],
  neutral: readonly SeedJson[],
  descriptors: readonly DescriptorSummary[],
  minMameDiff: number,
  maxRouteDeaths: number,
  minTailFrames: number,
): TailSummary {
  const activeSeed = active[0]!;
  const neutralByFrame = frameMap(neutral);
  const seedFrame = activeSeed.frame ?? 0;
  const aligned = active
    .filter((snapshot) => (snapshot.frame ?? 0) > seedFrame && neutralByFrame.has(snapshot.frame ?? 0))
    .map((snapshot) => [snapshot, neutralByFrame.get(snapshot.frame ?? 0)!] as const);
  let maxDiffX = 0;
  let maxDiffY = 0;
  let maxDiffFrame: number | undefined;

  for (const [activeSnapshot, neutralSnapshot] of aligned) {
    const diffX = Math.abs(rawX(activeSnapshot) - rawX(neutralSnapshot));
    const diffY = Math.abs(rawY(activeSnapshot) - rawY(neutralSnapshot));
    if (diffX + diffY > maxDiffX + maxDiffY) {
      maxDiffX = diffX;
      maxDiffY = diffY;
      maxDiffFrame = activeSnapshot.frame;
    }
  }

  const activeRun = summarizeRuns(active.slice(1));
  const neutralRun = summarizeRuns(neutral.slice(1));
  const activeFinal = seedSummary(active[active.length - 1]!, descriptors);
  const neutralFinal = seedSummary(neutral[neutral.length - 1]!, descriptors);
  const responsive = maxDiffX >= minMameDiff || maxDiffY >= minMameDiff;
  const stable =
    aligned.length >= minTailFrames &&
    activeRun.deathEvents <= maxRouteDeaths &&
    neutralRun.deathEvents <= maxRouteDeaths &&
    activeRun.maxState1Run === 0 &&
    neutralRun.maxState1Run === 0 &&
    activeRun.maxState2Run <= 60 &&
    neutralRun.maxState2Run <= 60 &&
    activeRun.maxState6Run <= 180 &&
    neutralRun.maxState6Run <= 180 &&
    activeFinal.playerState === 0 &&
    neutralFinal.playerState === 0 &&
    activeFinal.timer > 0 &&
    neutralFinal.timer > 0 &&
    activeFinal.pfCount >= activeFinal.minPlayablePf &&
    neutralFinal.pfCount >= neutralFinal.minPlayablePf;

  return {
    comparedFrames: aligned.length,
    firstFrame: aligned[0]?.[0].frame,
    lastFrame: aligned[aligned.length - 1]?.[0].frame,
    maxDiffX,
    maxDiffY,
    maxDiffFrame,
    responsive,
    activeDeathEvents: activeRun.deathEvents,
    neutralDeathEvents: neutralRun.deathEvents,
    activeRecoveries: activeRun.recoveries,
    neutralRecoveries: neutralRun.recoveries,
    activeMaxState1Run: activeRun.maxState1Run,
    activeMaxState2Run: activeRun.maxState2Run,
    activeMaxState6Run: activeRun.maxState6Run,
    neutralMaxState1Run: neutralRun.maxState1Run,
    neutralMaxState2Run: neutralRun.maxState2Run,
    neutralMaxState6Run: neutralRun.maxState6Run,
    activeFinal,
    neutralFinal,
    stable,
  };
}

function compareReferences(seed: SeedJson, paths: readonly string[], minPlayfieldDiff: number): ReferenceSummary[] {
  const playfield = hexToBytes(seed.playfieldRam, 0x2000, "seed playfieldRam");
  return paths.map((path) => {
    const reference = loadFirstSeed(path);
    const referencePlayfield = hexToBytes(reference.playfieldRam, 0x2000, `${path} playfieldRam`);
    const diffs = countDiffs(playfield, referencePlayfield);
    return {
      path,
      diffs,
      exactMatch: diffs === 0,
      nearDuplicate: diffs < minPlayfieldDiff,
    };
  });
}

function mainModeCompatible(seed: SeedSummary): boolean {
  return (seed.main === 0 || seed.main === 1) && seed.mode === 0;
}

function audit(args: CliArgs): AuditSummary {
  const rom = loadRom(args.romPath);
  const descriptors = descriptorSummaries(rom);
  const active = loadScenario(args.activePath);
  const neutral = loadScenario(args.neutralPath);
  if (active.length < 2 || neutral.length < 2) {
    throw new Error("post-seed proof requires scenario captures with at least two snapshots each");
  }
  const activeSeed = active[0]!;
  const neutralSeed = neutral[0]!;
  const seed = seedSummary(activeSeed, descriptors);
  const seedDiffs = regionDiffs(activeSeed, neutralSeed);
  const references = compareReferences(activeSeed, args.distinctFrom, args.minPlayfieldDiff);
  const tail = compareTail(active, neutral, descriptors, args.minMameDiff, args.maxRouteDeaths, args.minTailFrames);
  const reasons: string[] = [];

  if ((activeSeed.frame ?? 0) !== (neutralSeed.frame ?? 0)) reasons.push("active/neutral seed frames do not match");
  if (!seedDiffs.exact) reasons.push("active/neutral seed snapshots are not byte-identical before input starts");
  if (seed.descriptorLevel === undefined) reasons.push(`seed descriptor pointer 0x${seed.descriptorPointer.toString(16)} is not one of the six ROM descriptors`);
  if (seed.pfCount < seed.minPlayablePf) reasons.push(`seed playfield is below descriptor-aware threshold (${seed.pfCount} < ${seed.minPlayablePf})`);
  if (!mainModeCompatible(seed)) reasons.push(`seed starts outside practice-compatible main/mode 0|1/0 (${seed.main}/${seed.mode})`);
  if (seed.playerState !== 0) reasons.push(`seed starts in player state ${seed.playerState}, not settled state 0`);
  if (seed.timer <= 0) reasons.push("seed starts with dead/zero timer");
  for (const reference of references) {
    if (reference.exactMatch) reasons.push(`playfield is byte-identical to reference ${reference.path}`);
    else if (reference.nearDuplicate) reasons.push(`playfield is near-duplicate of ${reference.path} (${reference.diffs} byte diffs < ${args.minPlayfieldDiff})`);
  }
  if (tail.comparedFrames < args.minTailFrames) reasons.push(`post-seed tail is too short (${tail.comparedFrames} < ${args.minTailFrames} aligned frames)`);
  if (!tail.responsive) reasons.push(`post-seed MAME active/neutral route does not diverge enough (max diff ${tail.maxDiffX}/${tail.maxDiffY})`);
  if (tail.activeDeathEvents > args.maxRouteDeaths || tail.neutralDeathEvents > args.maxRouteDeaths) {
    reasons.push(`post-seed route is death-prone (active/neutral deaths ${tail.activeDeathEvents}/${tail.neutralDeathEvents} > ${args.maxRouteDeaths})`);
  }
  if (!tail.stable) reasons.push("post-seed tail is not stable enough for a start seed");
  if (!basename(args.activePath).startsWith("candidate_")) {
    reasons.push("source is a temporary MAME capture; export/review before wiring");
  }

  const isCandidate =
    seedDiffs.exact &&
    seed.descriptorLevel !== undefined &&
    seed.pfCount >= seed.minPlayablePf &&
    mainModeCompatible(seed) &&
    seed.playerState === 0 &&
    seed.timer > 0 &&
    references.every((reference) => !reference.nearDuplicate) &&
    tail.responsive &&
    tail.stable;

  return {
    activePath: args.activePath,
    neutralPath: args.neutralPath,
    seed,
    seedDiffs,
    references,
    tail,
    verdict: isCandidate ? "post-seed-candidate" : "diagnostic-only",
    reasons,
  };
}

function printSummary(summary: AuditSummary): void {
  const seed = summary.seed;
  console.log(
    `${summary.verdict}: frame=${seed.frame ?? "-"} desc=L${seed.descriptorLevel ?? "?"}@0x${seed.descriptorPointer.toString(16)} ` +
      `main/mode=${seed.main}/${seed.mode} state=${seed.playerState} timer=${seed.timer} pf=${seed.pfCount}/${seed.minPlayablePf} ` +
      `xy=${seed.x.toFixed(2)},${seed.y.toFixed(2)} z=${seed.z.toFixed(2)}`,
  );
  console.log(
    `seedExact=${summary.seedDiffs.exact} seedDiffs wr/pf/spr/alpha/color=` +
      `${summary.seedDiffs.workRam}/${summary.seedDiffs.playfieldRam}/${summary.seedDiffs.spriteRam}/${summary.seedDiffs.alphaRam}/${summary.seedDiffs.colorRam}`,
  );
  console.log(
    `tail frames=${summary.tail.comparedFrames} range=${summary.tail.firstFrame ?? "-"}..${summary.tail.lastFrame ?? "-"} ` +
      `maxDiffXY=${summary.tail.maxDiffX}/${summary.tail.maxDiffY}@${summary.tail.maxDiffFrame ?? "-"} ` +
      `deaths=${summary.tail.activeDeathEvents}/${summary.tail.neutralDeathEvents} stable=${summary.tail.stable}`,
  );
  if (summary.reasons.length > 0) {
    console.log("reasons:");
    for (const reason of summary.reasons) console.log(`- ${reason}`);
  }
}

try {
  const args = parseArgs();
  const summary = audit(args);
  if (args.json) console.log(JSON.stringify(summary, null, 2));
  else printSummary(summary);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  exit(1);
}
