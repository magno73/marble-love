#!/usr/bin/env node
/**
 * audit-playable-seed.ts — quick candidate filter for practice-level seeds.
 *
 * A seed is not a playable level start just because it has a populated
 * playfield. This probe compares active trackball input against a neutral run
 * with the preserved MAME dispatcher and with the browser-style manual
 * dispatcher rearmed.
 */

import { readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { argv, exit } from "node:process";

import { applySlapsticBank, bootInit, bus as busNs, state as stateNs, tick } from "@marble-love/engine";
import type { GameState, RomImage } from "@marble-love/engine";

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
  snapshots?: SeedJson[];
}

interface CliArgs {
  paths: string[];
  plan: string;
  json: boolean;
  mameNeutralDir: string | undefined;
  distinctFrom: string[];
  minPlayfieldDiff: number;
  allSnapshots: boolean;
  targetSegment: number | undefined;
  onlyCandidates: boolean;
}

interface SeedSummary {
  frame: number | undefined;
  slapsticBank: number;
  main: number;
  mode: number;
  next: number;
  segment: number;
  playerState: number;
  timer: number;
  scrollWord: number;
  x: number;
  y: number;
  pfCount: number;
}

interface RouteSummary {
  finalX: number;
  finalY: number;
  deltaX: number;
  deltaY: number;
  main: number;
  mode: number;
  next: number;
  segment: number;
  playerState: number;
  timer: number;
  pfCount: number;
  maxEmptyRun: number;
  maxScrollY: number;
  maxState1Run: number;
  maxState2Run: number;
  maxState6Run: number;
  deathEvents: number;
  recoveries: number;
}

interface ComparisonSummary {
  active: RouteSummary;
  neutral: RouteSummary;
  diffX: number;
  diffY: number;
  responsive: boolean;
  stable: boolean;
}

interface MamePairSummary {
  neutralPath: string;
  workRamDiffs: number;
  playfieldDiffs: number;
  spriteDiffs: number;
  alphaDiffs: number;
  colorDiffs: number;
  diffX: number;
  diffY: number;
  responsive: boolean;
}

interface PlayfieldReferenceSummary {
  path: string;
  diffs: number;
  checksum: number;
  exactMatch: boolean;
  nearDuplicate: boolean;
}

interface AuditSummary {
  path: string;
  sourcePath: string;
  initial: SeedSummary;
  playfieldReferences: PlayfieldReferenceSummary[];
  mamePair: MamePairSummary | undefined;
  preserved: ComparisonSummary;
  manualRearm: ComparisonSummary;
  verdict: "practice-seed" | "candidate-needs-route-proof" | "diagnostic-only";
  reasons: string[];
}

interface LoadedSeed {
  sourcePath: string;
  label: string;
  snapshotIndex: number;
  seed: SeedJson;
}

interface NeutralSeed {
  path: string;
  seed: SeedJson;
}

const DEFAULT_PATHS = [
  "packages/web/public/scenarios/playable/manual_level1_start.seed.json",
  "oracle/scenarios/gameplay/level2_spawn.json",
  "oracle/scenarios/gameplay/level3_spawn.json",
  "oracle/scenarios/gameplay/level4_spawn.json",
  "oracle/scenarios/gameplay/level5_spawn.json",
];

const DEFAULT_PLAN = "R:300,D:300,L:300,U:300,DR:300,DL:300,N:400";
const DEFAULT_DISTINCT_FROM = ["packages/web/public/scenarios/playable/manual_level1_start.seed.json"];
const DEFAULT_MIN_PLAYFIELD_DIFF = 512;
const SCREEN_DELTAS: Record<string, readonly [number, number]> = {
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

function printHelp(): void {
  console.log(`audit-playable-seed — filter practice-start seed candidates

Usage:
  npx tsx packages/cli/src/audit-playable-seed.ts [options] [scenario-or-seed.json ...]

Options:
  --plan SPEC   Route to compare against neutral input
                (default: ${DEFAULT_PLAN})
  --mame-neutral-dir DIR
                Compare each input scenario against DIR/<same filename> from
                a neutral MAME capture before doing the TS rearm probe
  --distinct-from PATH
                Reject practice promotion when playfieldRam is byte-identical
                to this reference seed/scenario snapshot. Can be repeated.
                Defaults to ${DEFAULT_DISTINCT_FROM[0]}.
  --min-playfield-diff N
                Reject practice promotion when a candidate differs from any
                --distinct-from reference by fewer than N playfield bytes.
                Defaults to ${DEFAULT_MIN_PLAYFIELD_DIFF}.
  --all-snapshots
                Audit every snapshot in each scenario file instead of only
                the first seed frame. Useful for manual/playback tail captures.
  --target-segment N
                Pre-filter snapshots by workRam[0x3e4] segment before running
                the active-vs-neutral probe
  --only-candidates
                Print only non-diagnostic verdicts
  --json        Emit machine-readable JSON
  -h, --help    Show this help

Without paths, audits the checked-in level1 playable seed and the old
level2..5 gameplay/oracle spawn snapshots.
With --only-candidates, snapshots that fail the cheap practice-start gate are
skipped before expensive active-vs-neutral TS route replay.
`);
}

function parseArgs(): CliArgs {
  const args = argv.slice(2);
  const paths: string[] = [];
  let plan = DEFAULT_PLAN;
  let json = false;
  let mameNeutralDir: string | undefined;
  const distinctFrom: string[] = [];
  let minPlayfieldDiff = DEFAULT_MIN_PLAYFIELD_DIFF;
  let allSnapshots = false;
  let targetSegment: number | undefined;
  let onlyCandidates = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--plan") {
      const next = args[++i];
      if (next === undefined) throw new Error("--plan requires a value");
      plan = next;
    } else if (arg === "--mame-neutral-dir") {
      const next = args[++i];
      if (next === undefined) throw new Error("--mame-neutral-dir requires a value");
      mameNeutralDir = next;
    } else if (arg === "--distinct-from") {
      const next = args[++i];
      if (next === undefined) throw new Error("--distinct-from requires a value");
      distinctFrom.push(next);
    } else if (arg === "--min-playfield-diff") {
      const next = args[++i];
      if (next === undefined) throw new Error("--min-playfield-diff requires a value");
      const value = Number(next);
      if (!Number.isInteger(value) || value < 0) throw new Error(`invalid --min-playfield-diff value: ${next}`);
      minPlayfieldDiff = value;
    } else if (arg === "--all-snapshots") {
      allSnapshots = true;
    } else if (arg === "--target-segment") {
      const next = args[++i];
      if (next === undefined) throw new Error("--target-segment requires a value");
      const value = Number(next);
      if (!Number.isInteger(value) || value < 0 || value > 255) {
        throw new Error(`invalid --target-segment value: ${next}`);
      }
      targetSegment = value;
    } else if (arg === "--only-candidates") {
      onlyCandidates = true;
    } else if (arg === "--json") {
      json = true;
    } else if (arg === "-h" || arg === "--help") {
      printHelp();
      exit(0);
    } else if (arg !== undefined) {
      paths.push(arg);
    }
  }

  return {
    paths: paths.length > 0 ? paths : DEFAULT_PATHS,
    plan,
    json,
    mameNeutralDir,
    distinctFrom: distinctFrom.length > 0 ? distinctFrom : DEFAULT_DISTINCT_FROM,
    minPlayfieldDiff,
    allSnapshots,
    targetSegment,
    onlyCandidates,
  };
}

function hexToBytes(hex: string, expectedLength: number, label: string): Uint8Array {
  if (hex.length !== expectedLength * 2) {
    throw new Error(`${label} has ${hex.length / 2} bytes, expected ${expectedLength}`);
  }
  const out = new Uint8Array(expectedLength);
  for (let i = 0; i < expectedLength; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function nonzero(bytes: Uint8Array): number {
  let total = 0;
  for (const value of bytes) if (value !== 0) total++;
  return total;
}

function checksumBytes(bytes: Uint8Array): number {
  let sum = 0;
  for (let i = 0; i < bytes.length; i++) {
    sum = (sum + (bytes[i] ?? 0) * (i + 1)) >>> 0;
  }
  return sum >>> 0;
}

function countDiffs(a: Uint8Array, b: Uint8Array): number {
  if (a.length !== b.length) throw new Error(`cannot diff buffers with different lengths ${a.length}/${b.length}`);
  let diffs = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) diffs++;
  }
  return diffs;
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

function fixed16(bytes: Uint8Array, off: number): number {
  return signedLong(readLongBE(bytes, off)) / 65536;
}

function objectRawX(seed: SeedJson): number {
  return signedLong(readLongBE(hexToBytes(seed.workRam, 0x2000, "workRam"), 0x18 + 0x0c));
}

function objectRawY(seed: SeedJson): number {
  return signedLong(readLongBE(hexToBytes(seed.workRam, 0x2000, "workRam"), 0x18 + 0x10));
}

function expandRouteSpec(spec: string): string[] {
  const out: string[] = [];
  for (const part of spec.split(",")) {
    const trimmed = part.trim();
    if (trimmed === "") continue;
    const [step, countRaw] = trimmed.split(":");
    if (step === undefined || countRaw === undefined || SCREEN_DELTAS[step] === undefined) {
      throw new Error(`invalid route part "${part}"`);
    }
    const count = Number(countRaw);
    if (!Number.isInteger(count) || count < 0) throw new Error(`invalid route count in "${part}"`);
    for (let i = 0; i < count; i++) out.push(step);
  }
  if (out.length === 0) throw new Error("route plan is empty");
  return out;
}

function advanceTrackball(p1X: number, p1Y: number, step: string): readonly [number, number] {
  const [screenDx, screenDy] = SCREEN_DELTAS[step] ?? [0, 0];
  return [(p1X + (screenDx !== 0 ? -screenDx : 0)) & 0xff, (p1Y + (screenDy !== 0 ? -screenDy : 0)) & 0xff];
}

function loadSeeds(path: string, allSnapshots: boolean): LoadedSeed[] {
  const raw = JSON.parse(readFileSync(resolve(path), "utf-8")) as ScenarioJson | SeedJson;
  if ("snapshots" in raw && Array.isArray(raw.snapshots)) {
    if (raw.snapshots.length === 0) throw new Error(`${path} has no snapshots`);
    const snapshots = allSnapshots ? raw.snapshots : [raw.snapshots[0]!];
    return snapshots.map((seed, index) => {
      const snapshotIndex = allSnapshots ? index : 0;
      const frameSuffix = seed.frame === undefined ? "" : `@f${seed.frame}`;
      return {
        sourcePath: path,
        label: allSnapshots ? `${path}#${snapshotIndex}${frameSuffix}` : path,
        snapshotIndex,
        seed,
      };
    });
  }

  return [{ sourcePath: path, label: path, snapshotIndex: 0, seed: raw as SeedJson }];
}

function regionDiffs(activeHex: string, neutralHex: string, expectedLength: number, label: string): number {
  const active = hexToBytes(activeHex, expectedLength, `${label} active`);
  const neutral = hexToBytes(neutralHex, expectedLength, `${label} neutral`);
  return countDiffs(active, neutral);
}

function compareMamePair(activeSeed: SeedJson, neutralPath: string, neutralSeed: SeedJson): MamePairSummary {
  const diffX = Math.abs(objectRawX(activeSeed) - objectRawX(neutralSeed));
  const diffY = Math.abs(objectRawY(activeSeed) - objectRawY(neutralSeed));
  const workRamDiffs = regionDiffs(activeSeed.workRam, neutralSeed.workRam, 0x2000, "workRam");
  const playfieldDiffs = regionDiffs(activeSeed.playfieldRam, neutralSeed.playfieldRam, 0x2000, "playfieldRam");
  const spriteDiffs = regionDiffs(activeSeed.spriteRam, neutralSeed.spriteRam, 0x1000, "spriteRam");
  const alphaDiffs = regionDiffs(activeSeed.alphaRam, neutralSeed.alphaRam, 0x1000, "alphaRam");
  const colorDiffs = regionDiffs(activeSeed.colorRam, neutralSeed.colorRam, 0x800, "colorRam");
  return {
    neutralPath,
    workRamDiffs,
    playfieldDiffs,
    spriteDiffs,
    alphaDiffs,
    colorDiffs,
    diffX,
    diffY,
    responsive: diffX > 1_000_000 || diffY > 1_000_000,
  };
}

function seedSummary(seed: SeedJson): SeedSummary {
  const workRam = hexToBytes(seed.workRam, 0x2000, "workRam");
  const playfieldRam = hexToBytes(seed.playfieldRam, 0x2000, "playfieldRam");
  return {
    frame: seed.frame,
    slapsticBank: seed.slapsticBank ?? 1,
    main: readWordBE(workRam, 0x390),
    mode: readWordBE(workRam, 0x392),
    next: readWordBE(workRam, 0x394),
    segment: workRam[0x3e4] ?? 0,
    playerState: workRam[0x18 + 0x1a] ?? 0,
    timer: readWordBE(workRam, 0x18 + 0x6a),
    scrollWord: readWordBE(workRam, 0x2) & 0x1ff,
    x: fixed16(workRam, 0x18 + 0x0c),
    y: fixed16(workRam, 0x18 + 0x10),
    pfCount: nonzero(playfieldRam),
  };
}

function loadStateFromSeed(rom: RomImage, seed: SeedJson, manualDispatcher: boolean): GameState {
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

function runRoute(rom: RomImage, gameState: GameState, plan: readonly string[]): RouteSummary {
  let p1X = gameState.workRam[0x18 + 0xc9] ?? 0xff;
  let p1Y = gameState.workRam[0x18 + 0xc8] ?? 0xff;
  const initialX = signedLong(readLongBE(gameState.workRam, 0x18 + 0x0c));
  const initialY = signedLong(readLongBE(gameState.workRam, 0x18 + 0x10));
  let deathEvents = 0;
  let recoveries = 0;
  let inDeath = false;
  let emptyRun = 0;
  let maxEmptyRun = 0;
  let state1Run = 0;
  let maxState1Run = 0;
  let state2Run = 0;
  let maxState2Run = 0;
  let state6Run = 0;
  let maxState6Run = 0;
  let maxScrollY = 0;

  for (const step of plan) {
    [p1X, p1Y] = advanceTrackball(p1X, p1Y, step);
    tick(gameState, {
      rom,
      runMainLoopBody: true,
      p1X,
      p1Y,
      p2X: 0xff,
      p2Y: 0xff,
      inputMmio: 0x6f,
    });

    const pfCount = nonzero(gameState.playfieldRam);
    if (pfCount === 0) {
      emptyRun++;
    } else {
      maxEmptyRun = Math.max(maxEmptyRun, emptyRun);
      emptyRun = 0;
    }

    const playerState = gameState.workRam[0x18 + 0x1a] ?? 0;
    if (playerState === 1) state1Run++;
    else {
      maxState1Run = Math.max(maxState1Run, state1Run);
      state1Run = 0;
    }
    if (playerState === 2) state2Run++;
    else {
      maxState2Run = Math.max(maxState2Run, state2Run);
      state2Run = 0;
    }
    if (playerState === 6) state6Run++;
    else {
      maxState6Run = Math.max(maxState6Run, state6Run);
      state6Run = 0;
    }

    const isDeath = playerState === 4 || playerState === 5;
    if (isDeath && !inDeath) {
      deathEvents++;
      inDeath = true;
    } else if (inDeath && playerState === 0) {
      recoveries++;
      inDeath = false;
    }
    maxScrollY = Math.max(maxScrollY, gameState.videoScrollY);
  }

  maxEmptyRun = Math.max(maxEmptyRun, emptyRun);
  maxState1Run = Math.max(maxState1Run, state1Run);
  maxState2Run = Math.max(maxState2Run, state2Run);
  maxState6Run = Math.max(maxState6Run, state6Run);
  const finalX = signedLong(readLongBE(gameState.workRam, 0x18 + 0x0c));
  const finalY = signedLong(readLongBE(gameState.workRam, 0x18 + 0x10));

  return {
    finalX,
    finalY,
    deltaX: Math.abs(finalX - initialX),
    deltaY: Math.abs(finalY - initialY),
    main: readWordBE(gameState.workRam, 0x390),
    mode: readWordBE(gameState.workRam, 0x392),
    next: readWordBE(gameState.workRam, 0x394),
    segment: gameState.workRam[0x3e4] ?? 0,
    playerState: gameState.workRam[0x18 + 0x1a] ?? 0,
    timer: readWordBE(gameState.workRam, 0x18 + 0x6a),
    pfCount: nonzero(gameState.playfieldRam),
    maxEmptyRun,
    maxScrollY,
    maxState1Run,
    maxState2Run,
    maxState6Run,
    deathEvents,
    recoveries,
  };
}

function compareRoute(rom: RomImage, seed: SeedJson, plan: readonly string[], manualDispatcher: boolean): ComparisonSummary {
  const neutralPlan = Array.from({ length: plan.length }, () => "N");
  const active = runRoute(rom, loadStateFromSeed(rom, seed, manualDispatcher), plan);
  const neutral = runRoute(rom, loadStateFromSeed(rom, seed, manualDispatcher), neutralPlan);
  const diffX = Math.abs(active.finalX - neutral.finalX);
  const diffY = Math.abs(active.finalY - neutral.finalY);
  const responsive = diffX > 1_000_000 || diffY > 1_000_000;
  const stable =
    active.pfCount > 4_000 &&
    active.maxEmptyRun <= 16 &&
    active.maxState1Run === 0 &&
    active.maxState2Run <= 60 &&
    active.maxState6Run <= 180 &&
    active.maxScrollY <= 512;
  return { active, neutral, diffX, diffY, responsive, stable };
}

function comparePlayfieldReferences(seed: LoadedSeed, references: LoadedSeed[], minPlayfieldDiff: number): PlayfieldReferenceSummary[] {
  const seedPlayfield = hexToBytes(seed.seed.playfieldRam, 0x2000, "seed playfieldRam");
  return references
    .filter((reference) => reference.label !== seed.label)
    .map((reference) => {
      const referencePlayfield = hexToBytes(reference.seed.playfieldRam, 0x2000, "reference playfieldRam");
      const diffs = countDiffs(seedPlayfield, referencePlayfield);
      return {
        path: reference.label,
        diffs,
        checksum: checksumBytes(referencePlayfield),
        exactMatch: diffs === 0,
        nearDuplicate: diffs < minPlayfieldDiff,
      };
    });
}

function passesCheapCandidateGate(
  loaded: LoadedSeed,
  playfieldReferences: LoadedSeed[],
  minPlayfieldDiff: number,
): boolean {
  const initial = seedSummary(loaded.seed);
  if (initial.pfCount <= 4_000) return false;
  if (initial.main !== 1 || initial.mode !== 0) return false;
  if (initial.timer <= 0) return false;
  if (initial.playerState !== 0) return false;
  if (loaded.sourcePath.includes("oracle/scenarios/gameplay/")) return false;

  const referenceSummaries = comparePlayfieldReferences(loaded, playfieldReferences, minPlayfieldDiff);
  return referenceSummaries.every((reference) => !reference.nearDuplicate);
}

function auditPath(
  rom: RomImage,
  loaded: LoadedSeed,
  plan: readonly string[],
  neutral: NeutralSeed | undefined,
  playfieldReferences: LoadedSeed[],
  minPlayfieldDiff: number,
): AuditSummary {
  const seed = loaded.seed;
  const initial = seedSummary(seed);
  const playfieldReferenceSummaries = comparePlayfieldReferences(loaded, playfieldReferences, minPlayfieldDiff);
  const mamePair = neutral === undefined ? undefined : compareMamePair(seed, neutral.path, neutral.seed);
  const preserved = compareRoute(rom, seed, plan, false);
  const manualRearm = compareRoute(rom, seed, plan, true);
  const isGameplayOracleSeed = loaded.sourcePath.includes("oracle/scenarios/gameplay/");
  const isCheckedInPlayableSeed = loaded.sourcePath.includes("packages/web/public/scenarios/playable/");
  const reasons: string[] = [];

  if (initial.pfCount <= 4_000) reasons.push("playfield is not fully populated at seed frame");
  if (initial.main !== 1 || initial.mode !== 0) reasons.push(`seed starts outside playable main/mode 1/0 (${initial.main}/${initial.mode})`);
  if (initial.timer <= 0) reasons.push("seed starts with a dead/zero timer");
  for (const reference of playfieldReferenceSummaries) {
    if (reference.exactMatch) {
      reasons.push(`playfield is byte-identical to reference ${reference.path}`);
    } else if (reference.nearDuplicate) {
      reasons.push(`playfield is near-duplicate of ${reference.path} (${reference.diffs} byte diffs < ${minPlayfieldDiff})`);
    }
  }
  if (initial.playerState !== 0) reasons.push(`player starts in state ${initial.playerState}, not settled playable state 0`);
  if (!preserved.responsive) reasons.push("preserved dispatcher active route matches neutral route");
  if (mamePair !== undefined && !mamePair.responsive) {
    reasons.push("paired MAME active capture does not move differently from neutral capture");
  }
  if (!manualRearm.responsive) reasons.push("manual rearm still does not diverge from neutral input");
  if (!manualRearm.stable) reasons.push("manual rearm route is not stable enough for practice start");
  if (isGameplayOracleSeed) {
    reasons.push("source is gameplay/oracle warm seed; needs MAME playable-route capture before startLevel wiring");
  }
  if (!isGameplayOracleSeed && !isCheckedInPlayableSeed) {
    reasons.push(
      mamePair === undefined
        ? "source is not a checked-in playable seed; pair it with MAME active-vs-neutral capture before wiring"
        : "source is a temporary MAME capture; promote to a checked-in playable seed only after descriptor and browser stability review",
    );
  }

  const isManualCandidate =
    initial.pfCount > 4_000 &&
    playfieldReferenceSummaries.every((reference) => !reference.nearDuplicate) &&
    initial.main === 1 &&
    initial.mode === 0 &&
    initial.timer > 0 &&
    initial.playerState === 0 &&
    manualRearm.responsive &&
    manualRearm.stable &&
    !isGameplayOracleSeed &&
    (mamePair === undefined || mamePair.responsive);
  const verdict = isManualCandidate
    ? isCheckedInPlayableSeed
      ? "practice-seed"
      : "candidate-needs-route-proof"
    : "diagnostic-only";

  return {
    path: loaded.label,
    sourcePath: loaded.sourcePath,
    initial,
    playfieldReferences: playfieldReferenceSummaries,
    mamePair,
    preserved,
    manualRearm,
    verdict,
    reasons,
  };
}

function fmt(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function printSummary(summary: AuditSummary): void {
  const init = summary.initial;
  console.log(`\n${summary.path}`);
  console.log(
    `  seed: frame=${init.frame ?? "?"} bank=${init.slapsticBank} main=${init.main} mode=${init.mode} next=${init.next} ` +
      `seg=${init.segment} state=${init.playerState} timer=${init.timer} scroll=${init.scrollWord} ` +
      `xy=${fmt(init.x)},${fmt(init.y)} pf=${init.pfCount}`,
  );
  for (const reference of summary.playfieldReferences) {
    console.log(
      `  playfield ref: exact=${reference.exactMatch ? "yes" : "no "} near=${reference.nearDuplicate ? "yes" : "no "} ` +
        `diffs=${reference.diffs} checksum=${reference.checksum} path=${reference.path}`,
    );
  }
  if (summary.mamePair !== undefined) {
    const pair = summary.mamePair;
    console.log(
      `  mame pair: responsive=${pair.responsive ? "yes" : "no "} diffXY=${pair.diffX}/${pair.diffY} ` +
        `bytes wr/pf/sp/al/co=${pair.workRamDiffs}/${pair.playfieldDiffs}/${pair.spriteDiffs}/${pair.alphaDiffs}/${pair.colorDiffs}`,
    );
  }
  for (const [label, cmp] of [
    ["preserved", summary.preserved],
    ["manual   ", summary.manualRearm],
  ] as const) {
    console.log(
      `  ${label}: responsive=${cmp.responsive ? "yes" : "no "} stable=${cmp.stable ? "yes" : "no "} ` +
        `diffXY=${cmp.diffX}/${cmp.diffY} final active main/mode/seg/state=${cmp.active.main}/${cmp.active.mode}/${cmp.active.segment}/${cmp.active.playerState} ` +
        `pf=${cmp.active.pfCount} emptyRun=${cmp.active.maxEmptyRun} scrollMax=${cmp.active.maxScrollY}`,
    );
  }
  console.log(`  verdict: ${summary.verdict}`);
  for (const reason of summary.reasons) console.log(`   - ${reason}`);
}

function loadNeutralSeed(args: CliArgs, loaded: LoadedSeed): NeutralSeed | undefined {
  if (args.mameNeutralDir === undefined) return undefined;
  const neutralPath = join(args.mameNeutralDir, basename(loaded.sourcePath));
  const neutralSeeds = loadSeeds(neutralPath, args.allSnapshots);
  const neutral = neutralSeeds.find((seed) => seed.snapshotIndex === loaded.snapshotIndex) ?? neutralSeeds[0];
  if (neutral === undefined) throw new Error(`${neutralPath} has no neutral snapshot for ${loaded.label}`);
  return { path: neutral.label, seed: neutral.seed };
}

function main(): void {
  const args = parseArgs();
  const plan = expandRouteSpec(args.plan);
  const rom = busNs.emptyRomImage();
  applySlapsticBank.loadRomBlob(rom, readFileSync(resolve("ghidra_project/marble_program.bin")));
  const playfieldReferences = args.distinctFrom.flatMap((path) => loadSeeds(path, false));

  const loadedSeeds = args.paths.flatMap((path) => loadSeeds(path, args.allSnapshots));
  const filteredSeeds =
    args.targetSegment === undefined
      ? loadedSeeds
      : loadedSeeds.filter((seed) => seedSummary(seed.seed).segment === args.targetSegment);
  const routeAuditSeeds = args.onlyCandidates
    ? filteredSeeds.filter((seed) => passesCheapCandidateGate(seed, playfieldReferences, args.minPlayfieldDiff))
    : filteredSeeds;
  const summaries = routeAuditSeeds.map((seed) =>
    auditPath(rom, seed, plan, loadNeutralSeed(args, seed), playfieldReferences, args.minPlayfieldDiff),
  );
  const visibleSummaries = args.onlyCandidates
    ? summaries.filter((summary) => summary.verdict !== "diagnostic-only")
    : summaries;
  if (args.json) {
    console.log(
      JSON.stringify(
        {
          plan: args.plan,
          frames: plan.length,
          scannedSnapshots: loadedSeeds.length,
          targetFilteredSnapshots: filteredSeeds.length,
          auditedSnapshots: routeAuditSeeds.length,
          visibleSnapshots: visibleSummaries.length,
          summaries: visibleSummaries,
        },
        null,
        2,
      ),
    );
  } else {
    console.log(
      `Plan ${args.plan} (${plan.length} frames); audited ${routeAuditSeeds.length}/${filteredSeeds.length} ` +
        `target-filtered snapshot(s), scanned ${loadedSeeds.length}; showing ${visibleSummaries.length}`,
    );
    for (const summary of visibleSummaries) printSummary(summary);
  }
}

main();
