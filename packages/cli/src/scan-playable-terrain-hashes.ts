#!/usr/bin/env node
/**
 * scan-playable-terrain-hashes.ts — terrain fingerprint scanner for level seeds.
 *
 * This is intentionally stricter than naming a warm snapshot "level N". It
 * compares playfield/color/alpha fingerprints and can run each seed through TS
 * for a bounded route, sampling terrain hashes over time. A candidate level
 * seed should be visually distinct from the known levels and then pass the
 * separate active-vs-neutral audit before being wired to startLevel.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
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

interface GraphicsLookupEntry {
  offset: number;
  bank: number;
  color: number;
  bpp: 4 | 5 | 6;
}

interface RenderFingerprint {
  renderHash: string;
  renderCoarseHash: string;
  playfieldCommands: number;
  alphaCommands: number;
  spriteNonzero: number;
  lookupSource: string;
}

interface ScenarioJson {
  snapshots?: SeedJson[];
}

interface LoadedSeed {
  path: string;
  label: string;
  seed: SeedJson;
}

type ClusterBy = "coarse" | "pf" | "segment";
type PlanPreset = "sweep" | "ladder";
type PlanSuite = "discovery";

interface CliArgs {
  paths: string[];
  frames: number;
  framesExplicit: boolean;
  sampleEvery: number;
  plan: string;
  planPreset: PlanPreset | undefined;
  planSuite: PlanSuite | undefined;
  json: boolean;
  pairwiseOnly: boolean;
  allSnapshots: boolean;
  nearThreshold: number;
  clusterBy: ClusterBy;
  stableOnly: boolean;
  minClusterSamples: number;
  emitCandidatesDir: string | undefined;
  maxCandidates: number;
}

interface Fingerprint {
  pfHash: string;
  colorHash: string;
  alphaHash: string;
  coarseHash: string;
  pfNonzero: number;
  colorNonzero: number;
  alphaNonzero: number;
  pfChecksum: number;
  render: RenderFingerprint;
}

interface SeedReport {
  label: string;
  frame: number | undefined;
  routeLabel: string | undefined;
  routeSpec: string | undefined;
  routeFrame: number | undefined;
  absoluteFrame: number | undefined;
  mameTrackballStart: number | undefined;
  main: number;
  mode: number;
  next: number;
  segment: number;
  playerState: number;
  timer: number;
  scrollWord: number;
  x: number;
  y: number;
  fingerprint: Fingerprint;
}

interface PairwiseReport {
  a: string;
  b: string;
  playfieldDiffs: number;
  colorDiffs: number;
  alphaDiffs: number;
  coarseManhattan: number;
  nearDuplicate: boolean;
}

interface ClusterReport {
  key: string;
  count: number;
  stableCount: number;
  firstLabel: string;
  lastLabel: string;
  labels: string[];
  segments: number[];
  modes: string[];
  pfHashes: number;
  representative: SeedReport;
}

interface RuntimeSamples {
  reports: SeedReport[];
  seedsByLabel: Map<string, SeedJson>;
}

interface CandidateManifestEntry {
  file: string;
  sourceLabel: string;
  routeLabel: string | undefined;
  routeFrame: number | undefined;
  absoluteFrame: number | undefined;
  mameTrackballStart: number | undefined;
  routeSpec: string | undefined;
  clusterKey: string;
  count: number;
  stableCount: number;
  segment: number;
  main: number;
  mode: number;
  timer: number;
  pfNonzero: number;
  pfHash: string;
  coarseHash: string;
  pfChecksum: number;
  renderHash: string;
  renderCoarseHash: string;
}

const PROM1_OFFSET_MASK = 0x07;
const PROM1_BANK_1 = 0x10;
const PROM1_BANK_2 = 0x20;
const PROM1_BANK_3 = 0x40;
const PROM1_BANK_4 = 0x80;
const PROM2_PLANE_4_ENABLE = 0x40;
const PROM2_PLANE_5_ENABLE = 0x80;
const PROM2_BANK_5 = 0x20;
const PROM2_BANK_6_OR_7 = 0x10;
const PROM2_PF_COLOR_MASK = 0x0f;
const PROM2_BANK_7 = 0x08;

const DEFAULT_PATHS = [
  "packages/web/public/scenarios/playable/manual_level1_start.seed.json",
  "packages/web/public/scenarios/playable/manual_level2_start.seed.json",
  "packages/web/public/scenarios/playable/manual_level3_start.seed.json",
  "packages/web/public/scenarios/playable/manual_level4_start.seed.json",
  "packages/web/public/scenarios/playable/manual_level5_start.seed.json",
  "oracle/scenarios/gameplay/level2_spawn.json",
  "oracle/scenarios/gameplay/level3_spawn.json",
  "oracle/scenarios/gameplay/level4_spawn.json",
  "oracle/scenarios/gameplay/level5_spawn.json",
];
const DEFAULT_PLAN = "R:120,D:120,L:120,U:120,DR:120,DL:120,N:360";
const ROUTE_PRESETS: Record<PlanPreset, string> = {
  sweep: DEFAULT_PLAN,
  ladder: "D:171,R:206,L:188,DL:107,BR:260,R:700,D:300,R:800,DR:300,R:800,U:100,R:500,N:10000",
};
const ROUTE_SUITES: Record<PlanSuite, Record<string, string>> = {
  discovery: {
    ladder: ROUTE_PRESETS.ladder,
    sweep: ROUTE_PRESETS.sweep,
    lower: "D:360,R:480,DL:180,R:720,D:240,R:720,N:2400",
    upper: "U:240,R:600,UR:240,R:480,D:240,R:480,N:2400",
    zigzag: "R:360,D:180,L:180,D:180,R:540,U:180,R:540,DL:240,N:2400",
  },
};
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
  console.log(`scan-playable-terrain-hashes — fingerprint candidate level seeds

Usage:
  npx tsx packages/cli/src/scan-playable-terrain-hashes.ts [options] [seed-or-scenario.json ...]

Options:
  --pairwise-only       Compare loaded seed snapshots without running TS
  --all-snapshots       Load every snapshot from scenario files
  --frames N            TS frames to run per seed (default: 960)
  --sample-every N      Sample terrain every N frames (default: 30)
  --plan SPEC           Route plan while running TS (default: ${DEFAULT_PLAN})
  --plan-preset NAME    Route preset: sweep or ladder. Ladder follows the
                        existing deep playable route guard and defaults to its
                        full length when --frames is omitted.
  --plan-suite NAME     Run a deterministic route suite and aggregate samples.
                        Currently: discovery.
  --cluster-by FIELD    Group runtime samples by coarse, pf, or segment
                        (default: coarse)
  --stable-only         Cluster only stable playable-looking samples
  --min-cluster-samples N
                        Hide clusters with fewer samples (default: 2)
  --emit-candidates-dir DIR
                        Write stable representative seed JSON files plus a
                        manifest. This is for audit input, not startLevel wiring.
  --max-candidates N    Limit emitted candidates (default: 12)
  --near-threshold N    PF byte-diff threshold for near duplicates (default: 512)
  --json                Emit JSON
  -h, --help            Show this help

The scanner is a discovery/filtering tool. Passing it does not by itself make a
seed safe for startLevel; candidates still need active-vs-neutral control proof.
When PROMs are available in /tmp/prom118.bin+/tmp/prom119.bin or roms/extracted,
render fingerprints use PROM lookup colors; otherwise they fall back to raw
playfield/alpha/sprite command signatures.
`);
}

function parseArgs(): CliArgs {
  const args = argv.slice(2);
  const paths: string[] = [];
  let frames = 960;
  let framesExplicit = false;
  let sampleEvery = 30;
  let plan = DEFAULT_PLAN;
  let planPreset: PlanPreset | undefined;
  let planSuite: PlanSuite | undefined;
  let json = false;
  let pairwiseOnly = false;
  let allSnapshots = false;
  let nearThreshold = 512;
  let clusterBy: ClusterBy = "coarse";
  let stableOnly = false;
  let minClusterSamples = 2;
  let emitCandidatesDir: string | undefined;
  let maxCandidates = 12;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--frames") {
      frames = parsePositiveInt(args[++i], "--frames");
      framesExplicit = true;
    } else if (arg === "--sample-every") {
      sampleEvery = parsePositiveInt(args[++i], "--sample-every");
    } else if (arg === "--plan") {
      const next = args[++i];
      if (next === undefined) throw new Error("--plan requires a value");
      plan = next;
      planPreset = undefined;
      planSuite = undefined;
    } else if (arg === "--plan-preset") {
      const next = args[++i];
      if (next !== "sweep" && next !== "ladder") throw new Error(`invalid --plan-preset value: ${next ?? ""}`);
      planPreset = next;
      planSuite = undefined;
      plan = ROUTE_PRESETS[next];
    } else if (arg === "--plan-suite") {
      const next = args[++i];
      if (next !== "discovery") throw new Error(`invalid --plan-suite value: ${next ?? ""}`);
      planSuite = next;
    } else if (arg === "--cluster-by") {
      const next = args[++i];
      if (next !== "coarse" && next !== "pf" && next !== "segment") {
        throw new Error(`invalid --cluster-by value: ${next ?? ""}`);
      }
      clusterBy = next;
    } else if (arg === "--stable-only") {
      stableOnly = true;
    } else if (arg === "--min-cluster-samples") {
      minClusterSamples = parsePositiveInt(args[++i], "--min-cluster-samples");
    } else if (arg === "--emit-candidates-dir") {
      const next = args[++i];
      if (next === undefined) throw new Error("--emit-candidates-dir requires a value");
      emitCandidatesDir = next;
    } else if (arg === "--max-candidates") {
      maxCandidates = parsePositiveInt(args[++i], "--max-candidates");
    } else if (arg === "--near-threshold") {
      nearThreshold = parsePositiveInt(args[++i], "--near-threshold");
    } else if (arg === "--pairwise-only") {
      pairwiseOnly = true;
    } else if (arg === "--all-snapshots") {
      allSnapshots = true;
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
    paths: paths.length > 0 ? paths : DEFAULT_PATHS.filter((path) => existsSync(resolve(path))),
    frames,
    framesExplicit,
    sampleEvery,
    plan,
    planPreset,
    planSuite,
    json,
    pairwiseOnly,
    allSnapshots,
    nearThreshold,
    clusterBy,
    stableOnly,
    minClusterSamples,
    emitCandidatesDir,
    maxCandidates,
  };
}

function parsePositiveInt(raw: string | undefined, label: string): number {
  if (raw === undefined) throw new Error(`${label} requires a value`);
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${label} must be a positive integer`);
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

function shortHash(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex").slice(0, 16);
}

function nonzero(bytes: Uint8Array): number {
  let total = 0;
  for (const value of bytes) if (value !== 0) total++;
  return total;
}

function checksumBytes(bytes: Uint8Array): number {
  let sum = 0;
  for (let i = 0; i < bytes.length; i++) sum = (sum + (bytes[i] ?? 0) * (i + 1)) >>> 0;
  return sum >>> 0;
}

function countDiffs(a: Uint8Array, b: Uint8Array): number {
  if (a.length !== b.length) throw new Error(`cannot diff buffers with different lengths ${a.length}/${b.length}`);
  let diffs = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diffs++;
  return diffs;
}

function bucketSignature(bytes: Uint8Array, bucketCount = 64): Uint16Array {
  const buckets = new Uint16Array(bucketCount);
  for (let i = 0; i < bytes.length; i++) {
    const bucket = Math.min(bucketCount - 1, Math.floor((i * bucketCount) / bytes.length));
    buckets[bucket] = ((buckets[bucket] ?? 0) + (bytes[i] ?? 0)) & 0xffff;
  }
  return buckets;
}

function bucketManhattan(a: Uint8Array, b: Uint8Array): number {
  const aa = bucketSignature(a);
  const bb = bucketSignature(b);
  let total = 0;
  for (let i = 0; i < aa.length; i++) total += Math.abs((aa[i] ?? 0) - (bb[i] ?? 0));
  return total;
}

function bucketHash(bytes: Uint8Array): string {
  const buckets = bucketSignature(bytes);
  return createHash("sha256").update(Buffer.from(buckets.buffer)).digest("hex").slice(0, 16);
}

function bppForProm2(prom2: number): 4 | 5 | 6 {
  if ((prom2 & PROM2_PLANE_4_ENABLE) === 0) return 4;
  return (prom2 & PROM2_PLANE_5_ENABLE) !== 0 ? 6 : 5;
}

function bankForProms(prom1: number, prom2: number): number {
  if ((prom1 & PROM1_BANK_1) === 0) return 1;
  if ((prom1 & PROM1_BANK_2) === 0) return 2;
  if ((prom1 & PROM1_BANK_3) === 0) return 3;
  if ((prom1 & PROM1_BANK_4) === 0) return 4;
  if ((prom2 & PROM2_BANK_5) === 0) return 5;
  if ((prom2 & PROM2_BANK_6_OR_7) === 0) return (prom2 & PROM2_BANK_7) === 0 ? 7 : 6;
  return 0;
}

function decodePlayfieldLookups(proms: Uint8Array): GraphicsLookupEntry[] {
  const remap = proms.slice(0x000, 0x200);
  const color = proms.slice(0x200, 0x400);
  const playfield: GraphicsLookupEntry[] = [];
  for (let i = 0; i < 256; i++) {
    const prom1 = remap[i] ?? 0xff;
    const prom2 = color[i] ?? 0xff;
    const bpp = bppForProm2(prom2);
    let bank = bankForProms(prom1, prom2);
    let offset = prom1 & PROM1_OFFSET_MASK;
    let entryColor = (~prom2 & PROM2_PF_COLOR_MASK) >>> (bpp - 4);
    if (bank === 0) {
      bank = 1;
      offset = 0;
      entryColor = 0;
    }
    playfield.push({ offset, bank, color: entryColor, bpp });
  }
  return playfield;
}

function loadPromLookups(): { playfieldLookups: GraphicsLookupEntry[] | undefined; source: string } {
  const candidates: Array<[string, string, string]> = [
    ["/tmp/prom118.bin", "/tmp/prom119.bin", "/tmp/prom118.bin+/tmp/prom119.bin"],
    ["roms/extracted/136033.118", "roms/extracted/136033.119", "roms/extracted/136033.118+136033.119"],
  ];
  for (const [a, b, source] of candidates) {
    if (existsSync(a) && existsSync(b)) {
      const proms = new Uint8Array(0x400);
      proms.set(readFileSync(a).subarray(0, 0x200), 0);
      proms.set(readFileSync(b).subarray(0, 0x200), 0x200);
      return { playfieldLookups: decodePlayfieldLookups(proms), source };
    }
  }
  return { playfieldLookups: undefined, source: "raw-playfield-fallback" };
}

function renderFingerprint(
  playfieldRam: Uint8Array,
  alphaRam: Uint8Array,
  spriteRam: Uint8Array,
  playfieldLookups: readonly GraphicsLookupEntry[] | undefined,
  lookupSource: string,
): RenderFingerprint {
  const hash = createHash("sha256");
  const coarseBuckets = new Uint32Array(64);
  let playfieldCommands = 0;
  for (let index = 0; index < Math.floor(playfieldRam.length / 2); index++) {
    const off = index * 2;
    const word = ((playfieldRam[off] ?? 0) << 8) | (playfieldRam[off + 1] ?? 0);
    if (word === 0) continue;
    playfieldCommands++;
    const lookupIndex = (word >>> 8) & 0x7f;
    const tileLow = word & 0xff;
    const flip = (word & 0x8000) !== 0 ? 1 : 0;
    const lookup = playfieldLookups?.[lookupIndex];
    const bank = lookup?.bank ?? -1;
    const color = lookup?.color ?? lookupIndex;
    const bpp = lookup?.bpp ?? 4;
    const tileIndex = lookup === undefined ? tileLow : lookup.offset * 256 + tileLow;
    const bucket = Math.min(coarseBuckets.length - 1, Math.floor((index * coarseBuckets.length) / 0x1000));
    const bucketValue = coarseBuckets[bucket] ?? 0;
    coarseBuckets[bucket] = (bucketValue + ((tileIndex ^ (color << 8) ^ (bank << 12) ^ word) >>> 0)) >>> 0;
    hash.update(`${index}:${tileIndex}:${bank}:${color}:${bpp}:${flip};`);
  }

  let alphaCommands = 0;
  for (let index = 0; index < Math.floor(alphaRam.length / 2); index++) {
    const off = index * 2;
    const word = ((alphaRam[off] ?? 0) << 8) | (alphaRam[off + 1] ?? 0);
    if (word === 0) continue;
    alphaCommands++;
    hash.update(`a${index}:${word};`);
  }

  let spriteNonzero = 0;
  for (let i = 0; i < spriteRam.length; i++) {
    const value = spriteRam[i] ?? 0;
    if (value === 0) continue;
    spriteNonzero++;
    hash.update(`s${i}:${value};`);
  }

  return {
    renderHash: hash.digest("hex").slice(0, 16),
    renderCoarseHash: createHash("sha256").update(Buffer.from(coarseBuckets.buffer)).digest("hex").slice(0, 16),
    playfieldCommands,
    alphaCommands,
    spriteNonzero,
    lookupSource,
  };
}

function fingerprint(
  playfieldRam: Uint8Array,
  colorRam: Uint8Array,
  alphaRam: Uint8Array,
  spriteRam: Uint8Array,
  playfieldLookups: readonly GraphicsLookupEntry[] | undefined,
  lookupSource: string,
): Fingerprint {
  return {
    pfHash: shortHash(playfieldRam),
    colorHash: shortHash(colorRam),
    alphaHash: shortHash(alphaRam),
    coarseHash: bucketHash(playfieldRam),
    pfNonzero: nonzero(playfieldRam),
    colorNonzero: nonzero(colorRam),
    alphaNonzero: nonzero(alphaRam),
    pfChecksum: checksumBytes(playfieldRam),
    render: renderFingerprint(playfieldRam, alphaRam, spriteRam, playfieldLookups, lookupSource),
  };
}

function loadSeeds(path: string, allSnapshots: boolean): LoadedSeed[] {
  const sourcePath = resolve(path);
  const raw = JSON.parse(readFileSync(sourcePath, "utf-8")) as ScenarioJson | SeedJson;
  if ("snapshots" in raw && Array.isArray(raw.snapshots)) {
    const snapshots = allSnapshots ? raw.snapshots : raw.snapshots.slice(0, 1);
    return snapshots.map((seed, index) => ({
      path,
      label: `${basename(path)}#${index}${seed.frame === undefined ? "" : `@f${seed.frame}`}`,
      seed,
    }));
  }
  return [{ path, label: basename(path), seed: raw as SeedJson }];
}

function seedReport(
  loaded: LoadedSeed,
  playfieldLookups: readonly GraphicsLookupEntry[] | undefined,
  lookupSource: string,
): SeedReport {
  const workRam = hexToBytes(loaded.seed.workRam, 0x2000, `${loaded.label} workRam`);
  const playfieldRam = hexToBytes(loaded.seed.playfieldRam, 0x2000, `${loaded.label} playfieldRam`);
  const colorRam = hexToBytes(loaded.seed.colorRam, 0x800, `${loaded.label} colorRam`);
  const alphaRam = hexToBytes(loaded.seed.alphaRam, 0x1000, `${loaded.label} alphaRam`);
  const spriteRam = hexToBytes(loaded.seed.spriteRam, 0x1000, `${loaded.label} spriteRam`);
  return {
    label: loaded.label,
    frame: loaded.seed.frame,
    routeLabel: undefined,
    routeSpec: undefined,
    routeFrame: undefined,
    absoluteFrame: undefined,
    mameTrackballStart: undefined,
    main: readWordBE(workRam, 0x390),
    mode: readWordBE(workRam, 0x392),
    next: readWordBE(workRam, 0x394),
    segment: workRam[0x3e4] ?? 0,
    playerState: workRam[0x18 + 0x1a] ?? 0,
    timer: readWordBE(workRam, 0x18 + 0x6a),
    scrollWord: readWordBE(workRam, 0x2) & 0x1ff,
    x: signedLong(readLongBE(workRam, 0x18 + 0x0c)),
    y: signedLong(readLongBE(workRam, 0x18 + 0x10)),
    fingerprint: fingerprint(playfieldRam, colorRam, alphaRam, spriteRam, playfieldLookups, lookupSource),
  };
}

function pairwiseReports(seeds: readonly LoadedSeed[], nearThreshold: number): PairwiseReport[] {
  const reports: PairwiseReport[] = [];
  for (let i = 0; i < seeds.length; i++) {
    const a = seeds[i]!;
    const aPf = hexToBytes(a.seed.playfieldRam, 0x2000, `${a.label} playfieldRam`);
    const aColor = hexToBytes(a.seed.colorRam, 0x800, `${a.label} colorRam`);
    const aAlpha = hexToBytes(a.seed.alphaRam, 0x1000, `${a.label} alphaRam`);
    for (let j = i + 1; j < seeds.length; j++) {
      const b = seeds[j]!;
      const bPf = hexToBytes(b.seed.playfieldRam, 0x2000, `${b.label} playfieldRam`);
      const playfieldDiffs = countDiffs(aPf, bPf);
      reports.push({
        a: a.label,
        b: b.label,
        playfieldDiffs,
        colorDiffs: countDiffs(aColor, hexToBytes(b.seed.colorRam, 0x800, `${b.label} colorRam`)),
        alphaDiffs: countDiffs(aAlpha, hexToBytes(b.seed.alphaRam, 0x1000, `${b.label} alphaRam`)),
        coarseManhattan: bucketManhattan(aPf, bPf),
        nearDuplicate: playfieldDiffs <= nearThreshold,
      });
    }
  }
  return reports;
}

function expandRouteSpec(spec: string, frames: number): string[] {
  const out: string[] = [];
  for (const part of spec.split(",")) {
    const trimmed = part.trim();
    if (trimmed === "") continue;
    const [step, countRaw] = trimmed.split(":");
    if (step === undefined || countRaw === undefined || SCREEN_DELTAS[step] === undefined) {
      throw new Error(`invalid route part "${part}"`);
    }
    const count = parsePositiveInt(countRaw, `route count for ${step}`);
    for (let i = 0; i < count && out.length < frames; i++) out.push(step);
  }
  while (out.length < frames) out.push("N");
  return out;
}

function routeSpecLength(spec: string): number {
  let total = 0;
  for (const part of spec.split(",")) {
    const trimmed = part.trim();
    if (trimmed === "") continue;
    const [, countRaw] = trimmed.split(":");
    total += parsePositiveInt(countRaw, `route count in ${part}`);
  }
  return total;
}

interface RouteRun {
  label: string;
  route: string[];
  spec: string;
}

function routeRunsForArgs(args: CliArgs): RouteRun[] {
  if (args.planSuite !== undefined) {
    return Object.entries(ROUTE_SUITES[args.planSuite]).map(([label, spec]) => ({
      label,
      route: expandRouteSpec(spec, args.framesExplicit ? args.frames : routeSpecLength(spec)),
      spec,
    }));
  }
  const frames = args.planPreset !== undefined && !args.framesExplicit ? routeSpecLength(args.plan) : args.frames;
  return [{ label: "single", route: expandRouteSpec(args.plan, frames), spec: args.plan }];
}

function advanceTrackball(p1X: number, p1Y: number, step: string): readonly [number, number] {
  const [screenDx, screenDy] = SCREEN_DELTAS[step] ?? [0, 0];
  return [(p1X + (screenDx !== 0 ? -screenDx : 0)) & 0xff, (p1Y + (screenDy !== 0 ? -screenDy : 0)) & 0xff];
}

function loadStateFromSeed(rom: RomImage, seed: SeedJson): GameState {
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
  gameState.clock.mainLoopBodyTicks = 1 as typeof gameState.clock.mainLoopBodyTicks;
  return gameState;
}

function runSamples(
  rom: RomImage,
  loaded: LoadedSeed,
  routeLabel: string,
  routeSpec: string | undefined,
  route: readonly string[],
  sampleEvery: number,
  playfieldLookups: readonly GraphicsLookupEntry[] | undefined,
  lookupSource: string,
): RuntimeSamples {
  const state = loadStateFromSeed(rom, loaded.seed);
  let p1X = state.workRam[0x18 + 0xc9] ?? 0xff;
  let p1Y = state.workRam[0x18 + 0xc8] ?? 0xff;
  const reports: SeedReport[] = [];
  const seedsByLabel = new Map<string, SeedJson>();

  for (let frame = 1; frame <= route.length; frame++) {
    [p1X, p1Y] = advanceTrackball(p1X, p1Y, route[frame - 1] ?? "N");
    tick(state, {
      rom,
      runMainLoopBody: true,
      p1X,
      p1Y,
      p2X: 0xff,
      p2Y: 0xff,
      inputMmio: 0x6f,
    });
    if (frame % sampleEvery === 0 || frame === route.length) {
      const label = routeLabel === "single" ? `${loaded.label}+${frame}` : `${loaded.label}+${routeLabel}+${frame}`;
      const absoluteFrame = loaded.seed.frame === undefined ? undefined : loaded.seed.frame + frame;
      const seed: SeedJson = {
        frame,
        slapsticBank: loaded.seed.slapsticBank ?? 1,
        workRam: Buffer.from(state.workRam).toString("hex"),
        playfieldRam: Buffer.from(state.playfieldRam).toString("hex"),
        spriteRam: Buffer.from(state.spriteRam).toString("hex"),
        alphaRam: Buffer.from(state.alphaRam).toString("hex"),
        colorRam: Buffer.from(state.colorRam).toString("hex"),
      };
      const report = seedReport({ path: loaded.path, label, seed }, playfieldLookups, lookupSource);
      report.routeLabel = routeLabel;
      report.routeSpec = routeSpec;
      report.routeFrame = frame;
      report.absoluteFrame = absoluteFrame;
      report.mameTrackballStart = loaded.seed.frame === undefined ? undefined : loaded.seed.frame + 1;
      reports.push(report);
      seedsByLabel.set(label, seed);
    }
  }
  return { reports, seedsByLabel };
}

function isStablePlayableSample(report: SeedReport): boolean {
  return report.main === 1 && report.mode === 0 && report.playerState === 0 && report.timer > 0 && report.fingerprint.pfNonzero > 4_000;
}

function clusterKey(report: SeedReport, clusterBy: ClusterBy): string {
  const renderCoarse = report.fingerprint.render.renderCoarseHash;
  if (clusterBy === "pf") return `${report.fingerprint.pfHash}:${renderCoarse}:${report.fingerprint.colorHash}`;
  if (clusterBy === "segment") {
    return `seg${report.segment}:${report.fingerprint.coarseHash}:${renderCoarse}:${report.fingerprint.colorHash}`;
  }
  return `${report.fingerprint.coarseHash}:${renderCoarse}:${report.fingerprint.colorHash}`;
}

function clusterSamples(
  samples: readonly SeedReport[],
  clusterBy: ClusterBy,
  stableOnly: boolean,
  minClusterSamples: number,
): ClusterReport[] {
  const groups = new Map<string, SeedReport[]>();
  for (const sample of samples) {
    if (stableOnly && !isStablePlayableSample(sample)) continue;
    const key = clusterKey(sample, clusterBy);
    const group = groups.get(key);
    if (group === undefined) groups.set(key, [sample]);
    else group.push(sample);
  }

  return Array.from(groups.entries())
    .map(([key, group]) => {
      const representative = group[0]!;
      return {
        key,
        count: group.length,
        stableCount: group.filter(isStablePlayableSample).length,
        firstLabel: group[0]!.label,
        lastLabel: group[group.length - 1]!.label,
        labels: group.map((sample) => sample.label),
        segments: Array.from(new Set(group.map((sample) => sample.segment))).sort((a, b) => a - b),
        modes: Array.from(new Set(group.map((sample) => `${sample.main}/${sample.mode}`))).sort(),
        pfHashes: new Set(group.map((sample) => sample.fingerprint.pfHash)).size,
        representative,
      };
    })
    .filter((cluster) => cluster.count >= minClusterSamples)
    .sort((a, b) => b.stableCount - a.stableCount || b.count - a.count || a.key.localeCompare(b.key));
}

function printClusters(clusters: readonly ClusterReport[]): void {
  if (clusters.length === 0) {
    console.log("  no clusters matched the current filters");
    return;
  }
  for (const cluster of clusters) {
    const rep = cluster.representative;
    console.log(
      `  count=${cluster.count} stable=${cluster.stableCount} segments=${cluster.segments.join("/")} ` +
        `modes=${cluster.modes.join("/")} pfHashes=${cluster.pfHashes} key=${cluster.key}`,
    );
    console.log(
      `    first=${cluster.firstLabel} last=${cluster.lastLabel} repTimer=${rep.timer} ` +
        `repPf=${rep.fingerprint.pfNonzero} repChecksum=${rep.fingerprint.pfChecksum}` +
        (rep.absoluteFrame === undefined ? "" : ` absFrame=${rep.absoluteFrame} mameTrackballStart=${rep.mameTrackballStart}`),
    );
  }
}

function sanitizeFilePart(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 120) || "candidate";
}

function writeCandidateSeeds(
  dir: string,
  clusters: readonly ClusterReport[],
  seedsByLabel: ReadonlyMap<string, SeedJson>,
  maxCandidates: number,
): CandidateManifestEntry[] {
  mkdirSync(resolve(dir), { recursive: true });
  const manifest: CandidateManifestEntry[] = [];
  const stableClusters = clusters.filter((cluster) => cluster.stableCount > 0 && isStablePlayableSample(cluster.representative));
  for (const cluster of stableClusters.slice(0, maxCandidates)) {
    const seed = seedsByLabel.get(cluster.representative.label);
    if (seed === undefined) continue;
    const rep = cluster.representative;
    const file = `${String(manifest.length + 1).padStart(2, "0")}_${sanitizeFilePart(rep.label)}_seg${rep.segment}_${rep.fingerprint.coarseHash}.seed.json`;
    writeFileSync(resolve(dir, file), `${JSON.stringify(seed, null, 2)}\n`);
    manifest.push({
      file,
      sourceLabel: rep.label,
      routeLabel: rep.routeLabel,
      routeFrame: rep.routeFrame,
      absoluteFrame: rep.absoluteFrame,
      mameTrackballStart: rep.mameTrackballStart,
      routeSpec: rep.routeSpec,
      clusterKey: cluster.key,
      count: cluster.count,
      stableCount: cluster.stableCount,
      segment: rep.segment,
      main: rep.main,
      mode: rep.mode,
      timer: rep.timer,
      pfNonzero: rep.fingerprint.pfNonzero,
      pfHash: rep.fingerprint.pfHash,
      coarseHash: rep.fingerprint.coarseHash,
      pfChecksum: rep.fingerprint.pfChecksum,
      renderHash: rep.fingerprint.render.renderHash,
      renderCoarseHash: rep.fingerprint.render.renderCoarseHash,
    });
  }
  writeFileSync(resolve(dir, "manifest.json"), `${JSON.stringify({ candidates: manifest }, null, 2)}\n`);
  return manifest;
}

function printSeed(report: SeedReport): void {
  const fp = report.fingerprint;
  console.log(
    `${report.label}: main=${report.main} mode=${report.mode} next=${report.next} seg=${report.segment} ` +
      `state=${report.playerState} timer=${report.timer} scroll=${report.scrollWord} ` +
      `pf=${fp.pfNonzero} pfHash=${fp.pfHash} coarse=${fp.coarseHash} checksum=${fp.pfChecksum} ` +
      `render=${fp.render.renderHash}/${fp.render.renderCoarseHash} ` +
      `cmds=${fp.render.playfieldCommands}/${fp.render.alphaCommands}/${fp.render.spriteNonzero}`,
  );
}

function main(): void {
  const args = parseArgs();
  if (args.paths.length === 0) throw new Error("no seed/scenario paths found");
  const seeds = args.paths.flatMap((path) => loadSeeds(path, args.allSnapshots));
  const { playfieldLookups, source: lookupSource } = loadPromLookups();
  const initialReports = seeds.map((seed) => seedReport(seed, playfieldLookups, lookupSource));
  const pairs = pairwiseReports(seeds, args.nearThreshold);

  if (args.json) {
    const runReports = args.pairwiseOnly
      ? []
      : (() => {
          const rom = busNs.emptyRomImage();
          applySlapsticBank.loadRomBlob(rom, readFileSync(resolve("ghidra_project/marble_program.bin")));
          const routeRuns = routeRunsForArgs(args);
          const seedMaps: Map<string, SeedJson>[] = [];
          const runReports = seeds.flatMap((seed) =>
            routeRuns.map((routeRun) => {
              const runtime = runSamples(rom, seed, routeRun.label, routeRun.spec, routeRun.route, args.sampleEvery, playfieldLookups, lookupSource);
              seedMaps.push(runtime.seedsByLabel);
              return { label: seed.label, route: routeRun.label, routeFrames: routeRun.route.length, samples: runtime.reports };
            }),
          );
          const allSamples = runReports.flatMap((report) => report.samples);
          const clusters = clusterSamples(allSamples, args.clusterBy, args.stableOnly, args.minClusterSamples);
          const emittedCandidates =
            args.emitCandidatesDir === undefined
              ? []
              : writeCandidateSeeds(
                  args.emitCandidatesDir,
                  clusters,
                  new Map(seedMaps.flatMap((map) => Array.from(map.entries()))),
                  args.maxCandidates,
                );
          return { routeRuns: routeRuns.map((routeRun) => ({ label: routeRun.label, frames: routeRun.route.length })), runReports, clusters, emittedCandidates };
        })();
    console.log(JSON.stringify({ initialReports, pairs, ...runReports }, null, 2));
    return;
  }

  console.log(`Render fingerprint lookup source: ${lookupSource}`);
  console.log("Initial terrain fingerprints:");
  for (const report of initialReports) printSeed(report);

  console.log("\nPairwise terrain diffs:");
  for (const pair of pairs) {
    const marker = pair.nearDuplicate ? "NEAR" : "    ";
    console.log(
      `${marker} ${pair.a} <-> ${pair.b}: pf=${pair.playfieldDiffs} color=${pair.colorDiffs} ` +
        `alpha=${pair.alphaDiffs} coarse=${pair.coarseManhattan}`,
    );
  }

  if (!args.pairwiseOnly) {
    const rom = busNs.emptyRomImage();
    applySlapsticBank.loadRomBlob(rom, readFileSync(resolve("ghidra_project/marble_program.bin")));
    const routeRuns = routeRunsForArgs(args);
    const routeSummary = routeRuns.map((routeRun) => `${routeRun.label}:${routeRun.route.length}`).join(", ");
    console.log(`\nTS sampled terrain every ${args.sampleEvery} frames over route(s) ${routeSummary}:`);
    const allSamples: SeedReport[] = [];
    const allSeedEntries: [string, SeedJson][] = [];
    for (const seed of seeds) {
      const seedSamples: SeedReport[] = [];
      for (const routeRun of routeRuns) {
        const runtime = runSamples(rom, seed, routeRun.label, routeRun.spec, routeRun.route, args.sampleEvery, playfieldLookups, lookupSource);
        const samples = runtime.reports;
        seedSamples.push(...samples);
        allSamples.push(...samples);
        allSeedEntries.push(...runtime.seedsByLabel.entries());
        const uniquePf = new Set(samples.map((sample) => sample.fingerprint.pfHash));
        const uniqueCoarse = new Set(samples.map((sample) => sample.fingerprint.coarseHash));
        const stableSamples = samples.filter(isStablePlayableSample);
        const last = samples[samples.length - 1];
        console.log(
          `\n${seed.label} [${routeRun.label}]: samples=${samples.length} stable=${stableSamples.length} ` +
            `uniquePf=${uniquePf.size} uniqueCoarse=${uniqueCoarse.size}`,
        );
        if (last !== undefined) printSeed(last);
      }
      if (routeRuns.length > 1) {
        const stableSamples = seedSamples.filter(isStablePlayableSample);
        console.log(`${seed.label} [all-routes]: samples=${seedSamples.length} stable=${stableSamples.length}`);
      }
    }
    console.log(
      `\nRuntime terrain clusters (by=${args.clusterBy}, stableOnly=${args.stableOnly}, ` +
        `minSamples=${args.minClusterSamples}):`,
    );
    const clusters = clusterSamples(allSamples, args.clusterBy, args.stableOnly, args.minClusterSamples);
    printClusters(clusters);
    if (args.emitCandidatesDir !== undefined) {
      const manifest = writeCandidateSeeds(args.emitCandidatesDir, clusters, new Map(allSeedEntries), args.maxCandidates);
      console.log(`\nWrote ${manifest.length} stable representative candidate seed(s) to ${resolve(args.emitCandidatesDir)}`);
      console.log("These are discovery candidates only; run audit-playable-seed.ts before wiring startLevel.");
    }
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  exit(1);
}
