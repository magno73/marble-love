#!/usr/bin/env node
/**
 * verify-start-level-candidates.ts - gate the six checked-in startLevel seeds.
 *
 * This is a promotion-audit helper, not a wiring tool. It verifies that the
 * checked-in post-seed candidates cover the six real ROM descriptor families,
 * are playable-looking start states, are pairwise distinct, and optionally that
 * the local paired MAME post-seed captures prove seed-exact active-vs-neutral
 * control after the seed frame.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { argv, exit } from "node:process";

interface SeedJson {
  name?: string;
  source?: string;
  frame?: number;
  slapsticBank?: number;
  mainLoopBodyTicks?: number;
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
  withProofs: boolean;
  minPairwisePfDiff: number;
  minMameDiff: number;
  minTailFrames: number;
  json: boolean;
}

interface CandidateSpec {
  level: number;
  seedPath: string;
  expectedFrame: number;
  expectedDescriptor: number;
  expectedNext: number;
  expectedMainLoopBodyTicks: number;
  route: string;
  activeScenarioPath: string;
  neutralScenarioPath: string;
}

interface Buffers {
  workRam: Uint8Array;
  playfieldRam: Uint8Array;
  spriteRam: Uint8Array;
  alphaRam: Uint8Array;
  colorRam: Uint8Array;
}

interface RuntimeSummary {
  frame: number | undefined;
  main: number;
  mode: number;
  next: number;
  descriptor: number;
  segment: number;
  playerState: number;
  timer: number;
  xRaw: number;
  yRaw: number;
  zRaw: number;
  pfNonzero: number;
  spriteNonzero: number;
  alphaNonzero: number;
  colorNonzero: number;
  playfieldHash: string;
  colorHash: string;
}

interface ProofReport {
  activePath: string;
  neutralPath: string;
  seedExact: boolean;
  seedRegionDiffs: RegionDiffs;
  tailFrames: number;
  maxDiffX: number;
  maxDiffY: number;
  maxDiffFrame: number | undefined;
  responsive: boolean;
  stable: boolean;
  badTailFrames: number;
  activeLastFrame: number | undefined;
  neutralLastFrame: number | undefined;
}

interface CandidateReport {
  level: number;
  seedPath: string;
  route: string;
  seedName: string | undefined;
  source: string | undefined;
  mainLoopBodyTicks: number;
  summary: RuntimeSummary;
  proof: ProofReport | undefined;
  errors: string[];
}

interface PairwiseDiff {
  a: number;
  b: number;
  playfieldDiffs: number;
}

interface RegionDiffs {
  workRam: number;
  playfieldRam: number;
  spriteRam: number;
  alphaRam: number;
  colorRam: number;
}

const OBJ0 = 0x18;
const DEFAULT_MIN_PAIRWISE_PF_DIFF = 512;
const DEFAULT_MIN_MAME_DIFF = 100_000;
const DEFAULT_MIN_TAIL_FRAMES = 120;
const MIN_SEED_PLAYFIELD = 1_000;

const CANDIDATES: CandidateSpec[] = [
  {
    level: 1,
    seedPath: "packages/web/public/scenarios/playable/candidate_level1_postseed_r_f2800.seed.json",
    expectedFrame: 2800,
    expectedDescriptor: 0x2bee2,
    expectedNext: 0,
    expectedMainLoopBodyTicks: 0,
    route: "R:60,N:180",
    activeScenarioPath: "/private/tmp/marble-earliest-start-proof-20260516/l1-f2800/R-active/scenarios/f2800.json",
    neutralScenarioPath: "/private/tmp/marble-earliest-start-proof-20260516/l1-f2800/neutral/scenarios/f2800.json",
  },
  {
    level: 2,
    seedPath: "packages/web/public/scenarios/playable/candidate_level2_postseed_dr_f3000.seed.json",
    expectedFrame: 3000,
    expectedDescriptor: 0x2c54c,
    expectedNext: 1,
    expectedMainLoopBodyTicks: 1,
    route: "DR:60,N:180",
    activeScenarioPath: "/private/tmp/marble-post-seed-proof-l23-20260516/l2-f3000-DR-active/scenarios/f3000.json",
    neutralScenarioPath: "/private/tmp/marble-post-seed-proof-l23-20260516/l2-f3000-neutral/scenarios/f3000.json",
  },
  {
    level: 3,
    seedPath: "packages/web/public/scenarios/playable/candidate_level3_postseed_ur_f3000.seed.json",
    expectedFrame: 3000,
    expectedDescriptor: 0x2cd9e,
    expectedNext: 2,
    expectedMainLoopBodyTicks: 1,
    route: "UR:60,N:180",
    activeScenarioPath: "/private/tmp/marble-post-seed-proof-l23-20260516/l3-f3000-UR-active/scenarios/f3000.json",
    neutralScenarioPath: "/private/tmp/marble-post-seed-proof-l23-20260516/l3-f3000-neutral/scenarios/f3000.json",
  },
  {
    level: 4,
    seedPath: "packages/web/public/scenarios/playable/candidate_level4_postseed_dr_f3000.seed.json",
    expectedFrame: 3000,
    expectedDescriptor: 0x2d648,
    expectedNext: 3,
    expectedMainLoopBodyTicks: 1,
    route: "DR:60,N:180",
    activeScenarioPath: "/private/tmp/marble-earliest-start-proof-20260516/l4-f3000-detector/DR-active/scenarios/f3000.json",
    neutralScenarioPath: "/private/tmp/marble-earliest-start-proof-20260516/l4-f3000-detector/neutral/scenarios/f3000.json",
  },
  {
    level: 5,
    seedPath: "packages/web/public/scenarios/playable/candidate_level5_postseed_dl_f2800.seed.json",
    expectedFrame: 2800,
    expectedDescriptor: 0x2de1e,
    expectedNext: 4,
    expectedMainLoopBodyTicks: 1,
    route: "DL:60,N:180",
    activeScenarioPath: "/private/tmp/marble-earliest-start-proof-20260516/l5-f2800-detector/DL-active/scenarios/f2800.json",
    neutralScenarioPath: "/private/tmp/marble-earliest-start-proof-20260516/l5-f2800-detector/neutral/scenarios/f2800.json",
  },
  {
    level: 6,
    seedPath: "packages/web/public/scenarios/playable/candidate_level6_postseed_ul_f3600.seed.json",
    expectedFrame: 3600,
    expectedDescriptor: 0x2e790,
    expectedNext: 5,
    expectedMainLoopBodyTicks: 1,
    route: "UL:180",
    activeScenarioPath: "/private/tmp/marble-post-seed-proof-l6-f3600/UL180-proof/scenarios/f3600.json",
    neutralScenarioPath: "/private/tmp/marble-post-seed-proof-l6-f3600/neutral/scenarios/f3600.json",
  },
];

function printHelp(): void {
  console.log(`verify-start-level-candidates - audit the six post-seed candidates

Usage:
  node --import tsx packages/cli/src/verify-start-level-candidates.ts [options]

Options:
  --proofs                  Also verify the default local MAME post-seed proof
                            captures under /private/tmp
  --min-pairwise-pf-diff N  Minimum playfield byte diff between every pair
                            of candidate seeds (default: ${DEFAULT_MIN_PAIRWISE_PF_DIFF})
  --min-mame-diff N         Minimum raw XY active-vs-neutral divergence in
                            proof tails (default: ${DEFAULT_MIN_MAME_DIFF})
  --min-tail-frames N       Minimum post-seed proof tail frames (default: ${DEFAULT_MIN_TAIL_FRAMES})
  --json                    Emit machine-readable JSON
  -h, --help                Show this help

This command does not edit practice-level.ts and does not wire startLevel.
`);
}

function parseArgs(): CliArgs {
  const raw = argv.slice(2);
  let withProofs = false;
  let minPairwisePfDiff = DEFAULT_MIN_PAIRWISE_PF_DIFF;
  let minMameDiff = DEFAULT_MIN_MAME_DIFF;
  let minTailFrames = DEFAULT_MIN_TAIL_FRAMES;
  let json = false;

  for (let i = 0; i < raw.length; i++) {
    const arg = raw[i]!;
    if (arg === "--proofs") {
      withProofs = true;
    } else if (arg === "--min-pairwise-pf-diff") {
      minPairwisePfDiff = parseNonNegativeInt(raw[++i], "--min-pairwise-pf-diff");
    } else if (arg === "--min-mame-diff") {
      minMameDiff = parseNonNegativeInt(raw[++i], "--min-mame-diff");
    } else if (arg === "--min-tail-frames") {
      minTailFrames = parseNonNegativeInt(raw[++i], "--min-tail-frames");
    } else if (arg === "--json") {
      json = true;
    } else if (arg === "-h" || arg === "--help") {
      printHelp();
      exit(0);
    } else {
      throw new Error(`unknown option: ${arg}`);
    }
  }

  return { withProofs, minPairwisePfDiff, minMameDiff, minTailFrames, json };
}

function parseNonNegativeInt(raw: string | undefined, label: string): number {
  if (raw === undefined || raw === "") throw new Error(`${label} requires a value`);
  const value = Number(raw);
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
  return ((readWordBE(bytes, off) << 16) | readWordBE(bytes, off + 2)) >>> 0;
}

function signedLong(bytes: Uint8Array, off: number): number {
  const value = readLongBE(bytes, off);
  return value > 0x7fffffff ? value - 0x1_0000_0000 : value;
}

function nonzero(bytes: Uint8Array): number {
  let count = 0;
  for (const value of bytes) if (value !== 0) count++;
  return count;
}

function hash16(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex").slice(0, 16);
}

function byteDiffs(a: Uint8Array, b: Uint8Array): number {
  const n = Math.min(a.length, b.length);
  let diffs = Math.abs(a.length - b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) diffs++;
  return diffs;
}

function loadSeed(path: string): SeedJson {
  return JSON.parse(readFileSync(resolve(path), "utf-8")) as SeedJson;
}

function loadScenario(path: string): SeedJson[] {
  const raw = JSON.parse(readFileSync(resolve(path), "utf-8")) as ScenarioJson;
  if (!Array.isArray(raw.snapshots) || raw.snapshots.length === 0) {
    throw new Error(`${path} does not contain snapshots`);
  }
  return raw.snapshots;
}

function buffersFromSeed(seed: SeedJson): Buffers {
  return {
    workRam: hexToBytes(seed.workRam, 0x2000, "workRam"),
    playfieldRam: hexToBytes(seed.playfieldRam, 0x2000, "playfieldRam"),
    spriteRam: hexToBytes(seed.spriteRam, 0x1000, "spriteRam"),
    alphaRam: hexToBytes(seed.alphaRam, 0x1000, "alphaRam"),
    colorRam: hexToBytes(seed.colorRam, 0x800, "colorRam"),
  };
}

function summarize(seed: SeedJson, buffers: Buffers): RuntimeSummary {
  const workRam = buffers.workRam;
  return {
    frame: seed.frame,
    main: readWordBE(workRam, 0x390),
    mode: readWordBE(workRam, 0x392),
    next: readWordBE(workRam, 0x394),
    descriptor: readLongBE(workRam, 0x474),
    segment: workRam[0x3e4] ?? 0,
    playerState: workRam[OBJ0 + 0x1a] ?? 0,
    timer: readWordBE(workRam, OBJ0 + 0x6a),
    xRaw: signedLong(workRam, OBJ0 + 0x0c),
    yRaw: signedLong(workRam, OBJ0 + 0x10),
    zRaw: signedLong(workRam, OBJ0 + 0x14),
    pfNonzero: nonzero(buffers.playfieldRam),
    spriteNonzero: nonzero(buffers.spriteRam),
    alphaNonzero: nonzero(buffers.alphaRam),
    colorNonzero: nonzero(buffers.colorRam),
    playfieldHash: hash16(buffers.playfieldRam),
    colorHash: hash16(buffers.colorRam),
  };
}

function regionDiffs(a: Buffers, b: Buffers): RegionDiffs {
  return {
    workRam: byteDiffs(a.workRam, b.workRam),
    playfieldRam: byteDiffs(a.playfieldRam, b.playfieldRam),
    spriteRam: byteDiffs(a.spriteRam, b.spriteRam),
    alphaRam: byteDiffs(a.alphaRam, b.alphaRam),
    colorRam: byteDiffs(a.colorRam, b.colorRam),
  };
}

function isExact(diff: RegionDiffs): boolean {
  return diff.workRam === 0 &&
    diff.playfieldRam === 0 &&
    diff.spriteRam === 0 &&
    diff.alphaRam === 0 &&
    diff.colorRam === 0;
}

function validateSeed(spec: CandidateSpec, seed: SeedJson, summary: RuntimeSummary): string[] {
  const errors: string[] = [];
  const phase = seed.mainLoopBodyTicks ?? 1;
  if (seed.frame !== spec.expectedFrame) errors.push(`frame ${seed.frame ?? "?"} != expected ${spec.expectedFrame}`);
  if (phase !== spec.expectedMainLoopBodyTicks) {
    errors.push(`mainLoopBodyTicks ${phase} != expected ${spec.expectedMainLoopBodyTicks}`);
  }
  if (summary.main !== 0 || summary.mode !== 0) errors.push(`main/mode ${summary.main}/${summary.mode} is not 0/0`);
  if (summary.next !== spec.expectedNext) errors.push(`next ${summary.next} != expected ${spec.expectedNext}`);
  if (summary.descriptor !== spec.expectedDescriptor) {
    errors.push(`descriptor 0x${summary.descriptor.toString(16)} != expected 0x${spec.expectedDescriptor.toString(16)}`);
  }
  if (summary.playerState !== 0) errors.push(`player state ${summary.playerState} is not playable state 0`);
  if (summary.timer <= 0) errors.push(`timer ${summary.timer} is not live`);
  if (summary.pfNonzero < MIN_SEED_PLAYFIELD) {
    errors.push(`playfield has only ${summary.pfNonzero} nonzero bytes`);
  }
  if (summary.spriteNonzero === 0) errors.push("sprite RAM is empty");
  if (summary.alphaNonzero === 0) errors.push("alpha RAM is empty");
  if (summary.colorNonzero === 0) errors.push("color RAM is empty");
  return errors;
}

function verifyProof(
  spec: CandidateSpec,
  seedBuffers: Buffers,
  args: CliArgs,
  errors: string[],
): ProofReport | undefined {
  if (!existsSync(spec.activeScenarioPath)) {
    errors.push(`missing active proof ${spec.activeScenarioPath}`);
    return undefined;
  }
  if (!existsSync(spec.neutralScenarioPath)) {
    errors.push(`missing neutral proof ${spec.neutralScenarioPath}`);
    return undefined;
  }

  const active = loadScenario(spec.activeScenarioPath);
  const neutral = loadScenario(spec.neutralScenarioPath);
  const activeSeed = active[0]!;
  const neutralSeed = neutral[0]!;
  const activeSeedBuffers = buffersFromSeed(activeSeed);
  const neutralSeedBuffers = buffersFromSeed(neutralSeed);
  const seedVsActive = regionDiffs(seedBuffers, activeSeedBuffers);
  const seedVsNeutral = regionDiffs(seedBuffers, neutralSeedBuffers);
  const activeVsNeutral = regionDiffs(activeSeedBuffers, neutralSeedBuffers);
  const seedExact = isExact(seedVsActive) && isExact(seedVsNeutral) && isExact(activeVsNeutral);
  const seedRegionDiffs: RegionDiffs = {
    workRam: seedVsActive.workRam + seedVsNeutral.workRam + activeVsNeutral.workRam,
    playfieldRam: seedVsActive.playfieldRam + seedVsNeutral.playfieldRam + activeVsNeutral.playfieldRam,
    spriteRam: seedVsActive.spriteRam + seedVsNeutral.spriteRam + activeVsNeutral.spriteRam,
    alphaRam: seedVsActive.alphaRam + seedVsNeutral.alphaRam + activeVsNeutral.alphaRam,
    colorRam: seedVsActive.colorRam + seedVsNeutral.colorRam + activeVsNeutral.colorRam,
  };
  if (!seedExact) errors.push(`MAME proof seed is not byte-exact (${JSON.stringify(seedRegionDiffs)})`);
  if (activeSeed.frame !== spec.expectedFrame || neutralSeed.frame !== spec.expectedFrame) {
    errors.push(`MAME proof starts at ${activeSeed.frame ?? "?"}/${neutralSeed.frame ?? "?"}, expected ${spec.expectedFrame}`);
  }

  const comparable = Math.min(active.length, neutral.length);
  const tailFrames = Math.max(0, comparable - 1);
  let maxDiffX = 0;
  let maxDiffY = 0;
  let maxDiffFrame: number | undefined;
  let badTailFrames = 0;

  for (let i = 1; i < comparable; i++) {
    const activeBuffers = buffersFromSeed(active[i]!);
    const neutralBuffers = buffersFromSeed(neutral[i]!);
    const activeSummary = summarize(active[i]!, activeBuffers);
    const neutralSummary = summarize(neutral[i]!, neutralBuffers);
    const diffX = Math.abs(activeSummary.xRaw - neutralSummary.xRaw);
    const diffY = Math.abs(activeSummary.yRaw - neutralSummary.yRaw);
    if (Math.max(diffX, diffY) > Math.max(maxDiffX, maxDiffY)) {
      maxDiffX = diffX;
      maxDiffY = diffY;
      maxDiffFrame = activeSummary.frame;
    }
    if (!isStableTailSummary(spec, activeSummary) || !isStableTailSummary(spec, neutralSummary)) {
      badTailFrames++;
    }
  }

  const responsive = Math.max(maxDiffX, maxDiffY) >= args.minMameDiff;
  const stable = tailFrames >= args.minTailFrames && badTailFrames === 0;
  if (tailFrames < args.minTailFrames) errors.push(`MAME proof tail has ${tailFrames} frames, expected >= ${args.minTailFrames}`);
  if (!responsive) {
    errors.push(`MAME active-vs-neutral max diff ${Math.max(maxDiffX, maxDiffY)} < ${args.minMameDiff}`);
  }
  if (!stable) errors.push(`MAME proof tail has ${badTailFrames} unstable frame(s)`);

  return {
    activePath: spec.activeScenarioPath,
    neutralPath: spec.neutralScenarioPath,
    seedExact,
    seedRegionDiffs,
    tailFrames,
    maxDiffX,
    maxDiffY,
    maxDiffFrame,
    responsive,
    stable,
    badTailFrames,
    activeLastFrame: active[active.length - 1]?.frame,
    neutralLastFrame: neutral[neutral.length - 1]?.frame,
  };
}

function isStableTailSummary(spec: CandidateSpec, summary: RuntimeSummary): boolean {
  return summary.main === 0 &&
    summary.mode === 0 &&
    summary.next === spec.expectedNext &&
    summary.descriptor === spec.expectedDescriptor &&
    summary.playerState === 0 &&
    summary.timer > 0 &&
    summary.pfNonzero >= MIN_SEED_PLAYFIELD;
}

function pairwiseDiffs(reports: CandidateReport[]): PairwiseDiff[] {
  const buffers = reports.map((report) => ({
    level: report.level,
    playfieldRam: buffersFromSeed(loadSeed(report.seedPath)).playfieldRam,
  }));
  const out: PairwiseDiff[] = [];
  for (let i = 0; i < buffers.length; i++) {
    for (let j = i + 1; j < buffers.length; j++) {
      out.push({
        a: buffers[i]!.level,
        b: buffers[j]!.level,
        playfieldDiffs: byteDiffs(buffers[i]!.playfieldRam, buffers[j]!.playfieldRam),
      });
    }
  }
  return out;
}

function px(raw: number): string {
  const value = raw / 65536;
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function fallbackSeedName(path: string): string {
  return (path.split("/").pop() ?? path).replace(/\.seed\.json$/, "");
}

function main(): void {
  const args = parseArgs();
  const reports: CandidateReport[] = [];
  for (const spec of CANDIDATES) {
    const seed = loadSeed(spec.seedPath);
    const buffers = buffersFromSeed(seed);
    const summary = summarize(seed, buffers);
    const errors = validateSeed(spec, seed, summary);
    const proof = args.withProofs ? verifyProof(spec, buffers, args, errors) : undefined;
    reports.push({
      level: spec.level,
      seedPath: spec.seedPath,
      route: spec.route,
      seedName: seed.name ?? fallbackSeedName(spec.seedPath),
      source: seed.source,
      mainLoopBodyTicks: seed.mainLoopBodyTicks ?? 1,
      summary,
      proof,
      errors,
    });
  }

  const pairDiffs = pairwiseDiffs(reports);
  const globalErrors: string[] = [];
  for (const pair of pairDiffs) {
    if (pair.playfieldDiffs < args.minPairwisePfDiff) {
      globalErrors.push(`L${pair.a}/L${pair.b} playfield diff ${pair.playfieldDiffs} < ${args.minPairwisePfDiff}`);
    }
  }
  const uniqueHashes = new Set(reports.map((report) => report.summary.playfieldHash));
  if (uniqueHashes.size !== reports.length) globalErrors.push("candidate playfield hashes are not unique");

  const ok = globalErrors.length === 0 && reports.every((report) => report.errors.length === 0);
  if (args.json) {
    console.log(JSON.stringify({ ok, reports, pairDiffs, globalErrors }, null, 2));
  } else {
    console.log(`Six startLevel candidate audit (${args.withProofs ? "with MAME proofs" : "seed matrix only"})`);
    for (const report of reports) {
      const summary = report.summary;
      const proof = report.proof;
      console.log(
        `L${report.level} ${report.seedName ?? report.seedPath} ` +
          `frame=${summary.frame ?? "?"} phase=${report.mainLoopBodyTicks} ` +
          `main/mode=${summary.main}/${summary.mode} next=${summary.next} ` +
          `desc=0x${summary.descriptor.toString(16)} state=${summary.playerState} timer=${summary.timer} ` +
          `xy=${px(summary.xRaw)},${px(summary.yRaw)} z=${px(summary.zRaw)} ` +
          `pf=${summary.pfNonzero} hash=${summary.playfieldHash} route=${report.route}`,
      );
      if (proof !== undefined) {
        console.log(
          `  proof seedExact=${proof.seedExact} tail=${proof.tailFrames} stable=${proof.stable} ` +
            `responsive=${proof.responsive} maxDiffXY=${proof.maxDiffX}/${proof.maxDiffY}@${proof.maxDiffFrame ?? "?"}`,
        );
      }
      for (const error of report.errors) console.log(`  ERROR ${error}`);
    }
    const minPair = pairDiffs.reduce((best, pair) => pair.playfieldDiffs < best.playfieldDiffs ? pair : best, pairDiffs[0]!);
    console.log(`Pairwise playfield diff: min L${minPair.a}/L${minPair.b}=${minPair.playfieldDiffs}`);
    for (const error of globalErrors) console.log(`ERROR ${error}`);
    console.log(ok ? "verdict: pass" : "verdict: fail");
  }

  if (!ok) exit(1);
}

main();
