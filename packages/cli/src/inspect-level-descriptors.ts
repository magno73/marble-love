#!/usr/bin/env node
/**
 * inspect-level-descriptors.ts — fingerprint the six ROM level descriptors.
 *
 * This utility identifies the authoritative level geometry surfaces produced
 * by FUN_16EC6 from the ROM descriptor table. It can also compare checked-in or
 * MAME-captured snapshots against those descriptor surfaces, but it does not
 * promote any snapshot to a playable start seed.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { argv, exit } from "node:process";

import {
  applySlapsticBank,
  bus as busNs,
  level as levelNs,
  levelDispatcher16EC6 as dispatcherNs,
  state as stateNs,
} from "@marble-love/engine";
import type { RomImage } from "@marble-love/engine";

interface CliArgs {
  romPath: string;
  outDir: string;
  comparePaths: string[];
  extraDirs: string[];
  allSnapshots: boolean;
  defaultSnapshots: boolean;
  stableOnly: boolean;
  timelineSummary: boolean;
  timelineOnly: boolean;
  transitionSummary: boolean;
  maxNearest: number;
}

interface SeedJson {
  frame?: number;
  workRam: string;
  playfieldRam: string;
  spriteRam?: string;
  alphaRam: string;
  colorRam: string;
}

interface ScenarioJson {
  snapshots?: SeedJson[];
}

interface LoadedSeed {
  path: string;
  label: string;
  seed: SeedJson;
}

interface Surface {
  label: string;
  path: string | undefined;
  frame: number | undefined;
  levelIndex: number | undefined;
  pointer: number | undefined;
  byteSize: number | undefined;
  main: number | undefined;
  mode: number | undefined;
  next: number | undefined;
  segment: number | undefined;
  playerState: number | undefined;
  timer: number | undefined;
  scrollWord: number | undefined;
  pfNonzero: number;
  colorNonzero: number;
  alphaNonzero: number;
  pfHash: string;
  coarseHash: string;
  checksum: number;
  playfield: Uint8Array;
  color: Uint8Array;
  alpha: Uint8Array;
}

interface DiffReport {
  label: string;
  playfieldDiffs: number;
  colorDiffs: number;
  alphaDiffs: number;
}

interface SnapshotAssociation {
  label: string;
  path: string;
  frame: number | undefined;
  stablePlayable: boolean;
  main: number | undefined;
  mode: number | undefined;
  segment: number | undefined;
  playerState: number | undefined;
  timer: number | undefined;
  scrollWord: number | undefined;
  pfNonzero: number;
  pfHash: string;
  coarseHash: string;
  nearestDescriptor: number;
  nearestDescriptorPointer: string;
  playfieldDiffs: number;
  colorDiffs: number;
  alphaDiffs: number;
}

const DEFAULT_OUT_DIR = "/private/tmp/marble-six-level-descriptors";
const DEFAULT_ROM_PATH = "ghidra_project/marble_program.bin";
const DEFAULT_SNAPSHOT_PATHS = [
  "oracle/scenarios/gameplay/level1_spawn.json",
  "oracle/scenarios/gameplay/level1_early.json",
  "oracle/scenarios/gameplay/level1_midmap.json",
  "oracle/scenarios/gameplay/level1_obstacle.json",
  "oracle/scenarios/gameplay/level1_end.json",
  "oracle/scenarios/gameplay/level2_spawn.json",
  "oracle/scenarios/gameplay/level2_early.json",
  "oracle/scenarios/gameplay/level3_spawn.json",
  "oracle/scenarios/gameplay/level3_early.json",
  "oracle/scenarios/gameplay/level3_end.json",
  "oracle/scenarios/gameplay/level4_spawn.json",
  "oracle/scenarios/gameplay/level4_early.json",
  "oracle/scenarios/gameplay/level5_spawn.json",
  "oracle/scenarios/gameplay/level5_early.json",
  "packages/web/public/scenarios/playable/manual_level1_start.seed.json",
] as const;

function printHelp(): void {
  console.log(`inspect-level-descriptors — fingerprint ROM level descriptor surfaces

Usage:
  node --import tsx packages/cli/src/inspect-level-descriptors.ts [options] [snapshot-or-dir ...]

Options:
  --rom PATH              Program ROM blob (default: ${DEFAULT_ROM_PATH})
  --out-dir DIR           Manifest output dir (default: ${DEFAULT_OUT_DIR})
  --extra-scenario-dir D  Also compare every *.json directly inside D
  --all-snapshots         Use every scenario snapshot instead of only #0
  --no-default-snapshots  Compare only explicit path/dir arguments
  --stable-only           Only print snapshot associations that look playable
  --timeline-summary      Collapse frame-adjacent snapshots into compact ranges
  --timeline-only         Print timeline ranges instead of per-snapshot lines
  --transition-summary    Summarize exact descriptor-load windows and the first
                          later stable-playable frame in the capture
  --max-nearest N         Nearest checked-in snapshots per descriptor (default: 4)
  -h, --help              Show this help

Descriptor fingerprints identify ROM terrain families. A snapshot still needs
MAME/manual route proof and active-vs-neutral audit before any startLevel wiring.
`);
}

function parseArgs(): CliArgs {
  const raw = argv.slice(2);
  const comparePaths: string[] = [];
  const extraDirs: string[] = [];
  let romPath = DEFAULT_ROM_PATH;
  let outDir = DEFAULT_OUT_DIR;
  let allSnapshots = false;
  let defaultSnapshots = true;
  let stableOnly = false;
  let timelineSummary = false;
  let timelineOnly = false;
  let transitionSummary = false;
  let maxNearest = 4;

  for (let i = 0; i < raw.length; i++) {
    const arg = raw[i]!;
    if (arg === "--rom") {
      romPath = requireValue(raw[++i], "--rom");
    } else if (arg === "--out-dir") {
      outDir = requireValue(raw[++i], "--out-dir");
    } else if (arg === "--extra-scenario-dir") {
      extraDirs.push(requireValue(raw[++i], "--extra-scenario-dir"));
    } else if (arg === "--all-snapshots") {
      allSnapshots = true;
    } else if (arg === "--no-default-snapshots") {
      defaultSnapshots = false;
    } else if (arg === "--stable-only") {
      stableOnly = true;
    } else if (arg === "--timeline-summary") {
      timelineSummary = true;
    } else if (arg === "--timeline-only") {
      timelineSummary = true;
      timelineOnly = true;
    } else if (arg === "--transition-summary") {
      transitionSummary = true;
    } else if (arg === "--max-nearest") {
      maxNearest = parsePositiveInt(raw[++i], "--max-nearest");
    } else if (arg === "-h" || arg === "--help") {
      printHelp();
      exit(0);
    } else if (arg.startsWith("--")) {
      throw new Error(`unknown option: ${arg}`);
    } else {
      comparePaths.push(arg);
    }
  }

  return {
    romPath,
    outDir,
    comparePaths,
    extraDirs,
    allSnapshots,
    defaultSnapshots,
    stableOnly,
    timelineSummary,
    timelineOnly,
    transitionSummary,
    maxNearest,
  };
}

function requireValue(value: string | undefined, label: string): string {
  if (value === undefined) throw new Error(`${label} requires a value`);
  return value;
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

function nonzero(bytes: Uint8Array): number {
  let total = 0;
  for (const value of bytes) if (value !== 0) total++;
  return total;
}

function shortHash(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex").slice(0, 16);
}

function checksumBytes(bytes: Uint8Array): number {
  let total = 0;
  for (let i = 0; i < bytes.length; i++) total = (total + (bytes[i] ?? 0) * (i + 1)) >>> 0;
  return total >>> 0;
}

function bucketHash(bytes: Uint8Array): string {
  const buckets = new Uint16Array(64);
  for (let i = 0; i < bytes.length; i++) {
    const bucket = Math.min(buckets.length - 1, Math.floor((i * buckets.length) / bytes.length));
    buckets[bucket] = ((buckets[bucket] ?? 0) + (bytes[i] ?? 0)) & 0xffff;
  }
  return createHash("sha256").update(Buffer.from(buckets.buffer)).digest("hex").slice(0, 16);
}

function countDiffs(a: Uint8Array, b: Uint8Array): number {
  if (a.length !== b.length) throw new Error(`cannot diff buffers with different lengths ${a.length}/${b.length}`);
  let diffs = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diffs++;
  return diffs;
}

function loadRom(path: string): RomImage {
  const rom = busNs.emptyRomImage();
  applySlapsticBank.loadRomBlob(rom, readFileSync(path));
  return rom;
}

function makeSurface(
  label: string,
  path: string | undefined,
  frame: number | undefined,
  workRam: Uint8Array | undefined,
  playfield: Uint8Array,
  color: Uint8Array,
  alpha: Uint8Array,
  levelIndex: number | undefined,
  pointer: number | undefined,
  byteSize: number | undefined,
): Surface {
  return {
    label,
    path,
    frame,
    levelIndex,
    pointer,
    byteSize,
    main: workRam === undefined ? undefined : readWordBE(workRam, 0x390),
    mode: workRam === undefined ? undefined : readWordBE(workRam, 0x392),
    next: workRam === undefined ? undefined : readWordBE(workRam, 0x394),
    segment: workRam === undefined ? undefined : (workRam[0x3e4] ?? 0),
    playerState: workRam === undefined ? undefined : (workRam[0x18 + 0x1a] ?? 0),
    timer: workRam === undefined ? undefined : readWordBE(workRam, 0x18 + 0x6a),
    scrollWord: workRam === undefined ? undefined : readWordBE(workRam, 0x2) & 0x1ff,
    pfNonzero: nonzero(playfield),
    colorNonzero: nonzero(color),
    alphaNonzero: nonzero(alpha),
    pfHash: shortHash(playfield),
    coarseHash: bucketHash(playfield),
    checksum: checksumBytes(playfield),
    playfield,
    color,
    alpha,
  };
}

function descriptorSurfaces(rom: RomImage): Surface[] {
  return levelNs.loadAllLevels(rom).map((level) => {
    const gameState = stateNs.emptyGameState();
    gameState.workRam[0x394] = (level.index >>> 8) & 0xff;
    gameState.workRam[0x395] = level.index & 0xff;
    dispatcherNs.levelDispatcher16EC6(gameState, rom);
    const surface = makeSurface(
      `ROM descriptor L${level.index + 1}`,
      undefined,
      undefined,
      gameState.workRam.slice(),
      gameState.playfieldRam.slice(),
      gameState.colorRam.slice(),
      gameState.alphaRam.slice(),
      level.index,
      level.romOffset,
      level.byteSize,
    );
    surface.timer = readWordBE(gameState.workRam, 0x97e);
    return surface;
  });
}

function collectJsonPaths(inputPath: string): string[] {
  const absolute = resolve(inputPath);
  if (!existsSync(absolute)) return [];
  const stat = statSync(absolute);
  if (stat.isDirectory()) {
    return readdirSync(absolute)
      .filter((name) => name.endsWith(".json") || name.endsWith(".seed.json"))
      .sort()
      .map((name) => join(absolute, name));
  }
  return [absolute];
}

function loadSeeds(path: string, allSnapshots: boolean): LoadedSeed[] {
  const sourcePath = resolve(path);
  const raw = JSON.parse(readFileSync(sourcePath, "utf-8")) as ScenarioJson | SeedJson;
  if ("snapshots" in raw && Array.isArray(raw.snapshots)) {
    const snapshots = allSnapshots ? raw.snapshots : raw.snapshots.slice(0, 1);
    return snapshots.map((seed, index) => ({
      path: sourcePath,
      label: `${basename(sourcePath)}#${index}${seed.frame === undefined ? "" : `@f${seed.frame}`}`,
      seed,
    }));
  }
  return [{ path: sourcePath, label: basename(sourcePath), seed: raw as SeedJson }];
}

function loadSnapshotSurfaces(paths: readonly string[], allSnapshots: boolean): Surface[] {
  const loadedSeeds = paths.flatMap((path) => loadSeeds(path, allSnapshots));
  return loadedSeeds.map((loaded) => {
    const seed = loaded.seed;
    const workRam = hexToBytes(seed.workRam, 0x2000, `${loaded.label} workRam`);
    return makeSurface(
      loaded.label,
      loaded.path,
      seed.frame,
      workRam,
      hexToBytes(seed.playfieldRam, 0x2000, `${loaded.label} playfieldRam`),
      hexToBytes(seed.colorRam, 0x800, `${loaded.label} colorRam`),
      hexToBytes(seed.alphaRam, 0x1000, `${loaded.label} alphaRam`),
      undefined,
      undefined,
      undefined,
    );
  });
}

function diffSurface(a: Surface, b: Surface): DiffReport {
  return {
    label: b.label,
    playfieldDiffs: countDiffs(a.playfield, b.playfield),
    colorDiffs: countDiffs(a.color, b.color),
    alphaDiffs: countDiffs(a.alpha, b.alpha),
  };
}

function stablePlayable(surface: Surface): boolean {
  return surface.main === 1 && surface.mode === 0 && surface.playerState === 0 && (surface.timer ?? 0) > 0 && surface.pfNonzero > 4_000;
}

function nearestDescriptors(surface: Surface, descriptors: readonly Surface[]): Array<{ descriptor: Surface; diff: DiffReport }> {
  return descriptors
    .map((descriptor) => ({ descriptor, diff: diffSurface(surface, descriptor) }))
    .sort((a, b) => a.diff.playfieldDiffs - b.diff.playfieldDiffs || a.diff.colorDiffs - b.diff.colorDiffs || a.diff.alphaDiffs - b.diff.alphaDiffs);
}

function formatHex(value: number | undefined): string {
  return value === undefined ? "?" : `0x${value.toString(16)}`;
}

function descriptorNumber(surface: Surface): number {
  if (surface.levelIndex === undefined) throw new Error(`${surface.label} has no level index`);
  return surface.levelIndex + 1;
}

function snapshotAssociation(surface: Surface, descriptors: readonly Surface[]): SnapshotAssociation {
  const nearest = nearestDescriptors(surface, descriptors)[0];
  if (nearest === undefined) throw new Error("no descriptor surfaces available");
  const pointer = nearest.descriptor.pointer;
  if (pointer === undefined) throw new Error(`${nearest.descriptor.label} has no pointer`);
  return {
    label: surface.label,
    path: surface.path ?? "",
    frame: surface.frame,
    stablePlayable: stablePlayable(surface),
    main: surface.main,
    mode: surface.mode,
    segment: surface.segment,
    playerState: surface.playerState,
    timer: surface.timer,
    scrollWord: surface.scrollWord,
    pfNonzero: surface.pfNonzero,
    pfHash: surface.pfHash,
    coarseHash: surface.coarseHash,
    nearestDescriptor: descriptorNumber(nearest.descriptor),
    nearestDescriptorPointer: `0x${pointer.toString(16)}`,
    playfieldDiffs: nearest.diff.playfieldDiffs,
    colorDiffs: nearest.diff.colorDiffs,
    alphaDiffs: nearest.diff.alphaDiffs,
  };
}

function printDescriptorTable(descriptors: readonly Surface[]): void {
  console.log("ROM descriptor terrain fingerprints:");
  for (const descriptor of descriptors) {
    console.log(
      `  L${descriptorNumber(descriptor)} ptr=${formatHex(descriptor.pointer)} size=${descriptor.byteSize ?? "?"} ` +
        `timerRaw=${descriptor.timer ?? "?"} ` +
        `pf=${descriptor.pfNonzero} color=${descriptor.colorNonzero} alpha=${descriptor.alphaNonzero} ` +
        `pfHash=${descriptor.pfHash} coarse=${descriptor.coarseHash} checksum=${descriptor.checksum}`,
    );
  }
}

function printDescriptorPairwise(descriptors: readonly Surface[]): void {
  console.log("\nDescriptor pairwise playfield diffs:");
  for (let i = 0; i < descriptors.length; i++) {
    for (let j = i + 1; j < descriptors.length; j++) {
      const a = descriptors[i]!;
      const b = descriptors[j]!;
      console.log(
        `  L${descriptorNumber(a)}<->L${descriptorNumber(b)}: ` +
          `pf=${countDiffs(a.playfield, b.playfield)} color=${countDiffs(a.color, b.color)} alpha=${countDiffs(a.alpha, b.alpha)}`,
      );
    }
  }
}

function printNearestSnapshots(descriptors: readonly Surface[], snapshots: readonly Surface[], maxNearest: number): void {
  if (snapshots.length === 0) return;
  console.log("\nNearest compared snapshot for each descriptor:");
  for (const descriptor of descriptors) {
    const nearest = snapshots
      .map((snapshot) => diffSurface(descriptor, snapshot))
      .sort((a, b) => a.playfieldDiffs - b.playfieldDiffs || a.colorDiffs - b.colorDiffs || a.alphaDiffs - b.alphaDiffs)
      .slice(0, maxNearest);
    console.log(`  L${descriptorNumber(descriptor)}:`);
    for (const diff of nearest) {
      console.log(`    ${diff.label}: pf=${diff.playfieldDiffs} color=${diff.colorDiffs} alpha=${diff.alphaDiffs}`);
    }
  }
}

function printSnapshotAssociations(associations: readonly SnapshotAssociation[], stableOnly: boolean): void {
  const shown = stableOnly ? associations.filter((entry) => entry.stablePlayable) : associations;
  if (shown.length === 0) return;
  console.log(stableOnly ? "\nStable-playable snapshot associations:" : "\nSnapshot associations:");
  for (const entry of shown) {
    console.log(
      `  ${entry.label}: stable=${entry.stablePlayable ? "yes" : "no"} main/mode=${entry.main ?? "?"}/${entry.mode ?? "?"} ` +
        `seg=${entry.segment ?? "?"} state=${entry.playerState ?? "?"} timer=${entry.timer ?? "?"} scroll=${entry.scrollWord ?? "?"} ` +
        `pf=${entry.pfNonzero} pfHash=${entry.pfHash} nearest=L${entry.nearestDescriptor} ` +
        `pfDiff=${entry.playfieldDiffs} colorDiff=${entry.colorDiffs} alphaDiff=${entry.alphaDiffs}`,
    );
  }
}

function timelineKey(entry: SnapshotAssociation): string {
  return [
    entry.stablePlayable ? "stable" : "nonstable",
    entry.main ?? "?",
    entry.mode ?? "?",
    entry.segment ?? "?",
    entry.playerState ?? "?",
    entry.timer ?? "?",
    entry.scrollWord ?? "?",
    entry.pfNonzero,
    entry.pfHash,
    entry.nearestDescriptor,
    entry.playfieldDiffs,
    entry.colorDiffs,
    entry.alphaDiffs,
  ].join("|");
}

function printTimelineSummary(associations: readonly SnapshotAssociation[]): void {
  const framed = associations
    .filter((entry) => entry.frame !== undefined)
    .slice()
    .sort((a, b) => (a.frame ?? 0) - (b.frame ?? 0) || a.label.localeCompare(b.label));
  if (framed.length === 0) return;

  console.log("\nSnapshot timeline summary:");
  let first = framed[0]!;
  let last = framed[0]!;
  let key = timelineKey(first);

  const flush = (): void => {
    const firstFrame = first.frame ?? "?";
    const lastFrame = last.frame ?? "?";
    const count =
      typeof firstFrame === "number" && typeof lastFrame === "number"
        ? lastFrame - firstFrame + 1
        : 1;
    const range = firstFrame === lastFrame ? `f${firstFrame}` : `f${firstFrame}-f${lastFrame}`;
    console.log(
      `  ${range} count=${count} stable=${first.stablePlayable ? "yes" : "no"} ` +
        `main/mode=${first.main ?? "?"}/${first.mode ?? "?"} seg=${first.segment ?? "?"} ` +
        `state=${first.playerState ?? "?"} timer=${first.timer ?? "?"} scroll=${first.scrollWord ?? "?"} ` +
        `pf=${first.pfNonzero} pfHash=${first.pfHash} nearest=L${first.nearestDescriptor} ` +
        `pfDiff=${first.playfieldDiffs} colorDiff=${first.colorDiffs} alphaDiff=${first.alphaDiffs}`,
    );
  };

  for (const entry of framed.slice(1)) {
    const nextKey = timelineKey(entry);
    const adjacent =
      typeof last.frame === "number" && typeof entry.frame === "number" && entry.frame === last.frame + 1;
    if (nextKey === key && adjacent) {
      last = entry;
      continue;
    }
    flush();
    first = entry;
    last = entry;
    key = nextKey;
  }
  flush();
}

interface TransitionWindow {
  descriptor: number;
  firstFrame: number;
  lastFrame: number;
  state: number | undefined;
  timer: number | undefined;
  exactCount: number;
  firstStable: SnapshotAssociation | undefined;
}

function exactDescriptorMatch(entry: SnapshotAssociation): boolean {
  return entry.playfieldDiffs === 0 && entry.colorDiffs === 0 && entry.alphaDiffs === 0;
}

function transitionWindows(associations: readonly SnapshotAssociation[]): TransitionWindow[] {
  const framed = associations
    .filter((entry): entry is SnapshotAssociation & { frame: number } => entry.frame !== undefined)
    .slice()
    .sort((a, b) => a.frame - b.frame || a.label.localeCompare(b.label));
  const windows: TransitionWindow[] = [];
  let i = 0;

  while (i < framed.length) {
    const entry = framed[i]!;
    if (!exactDescriptorMatch(entry)) {
      i++;
      continue;
    }

    const descriptor = entry.nearestDescriptor;
    let last = entry;
    let j = i + 1;
    while (
      j < framed.length &&
      exactDescriptorMatch(framed[j]!) &&
      framed[j]!.nearestDescriptor === descriptor &&
      framed[j]!.frame === last.frame + 1
    ) {
      last = framed[j]!;
      j++;
    }

    let firstStable: SnapshotAssociation | undefined;
    for (let k = j; k < framed.length; k++) {
      const candidate = framed[k]!;
      if (exactDescriptorMatch(candidate)) break;
      if (candidate.stablePlayable) {
        firstStable = candidate;
        break;
      }
    }

    windows.push({
      descriptor,
      firstFrame: entry.frame,
      lastFrame: last.frame,
      state: entry.playerState,
      timer: entry.timer,
      exactCount: last.frame - entry.frame + 1,
      firstStable,
    });
    i = j;
  }

  return windows;
}

function printTransitionSummary(associations: readonly SnapshotAssociation[]): void {
  const windows = transitionWindows(associations);
  console.log("\nExact descriptor transition summary:");
  if (windows.length === 0) {
    console.log("  no byte-exact descriptor windows found in compared snapshots");
    return;
  }

  for (const window of windows) {
    const range =
      window.firstFrame === window.lastFrame
        ? `f${window.firstFrame}`
        : `f${window.firstFrame}-f${window.lastFrame}`;
    const stable = window.firstStable;
    const stableText =
      stable === undefined
        ? "firstStable=none before next exact descriptor"
        : `firstStable=f${stable.frame ?? "?"} seg=${stable.segment ?? "?"} state=${stable.playerState ?? "?"} ` +
          `timer=${stable.timer ?? "?"} pf=${stable.pfNonzero} pfHash=${stable.pfHash} ` +
          `nearest=L${stable.nearestDescriptor} pfDiff=${stable.playfieldDiffs} ` +
          `colorDiff=${stable.colorDiffs} alphaDiff=${stable.alphaDiffs}`;
    console.log(
      `  L${window.descriptor} exact ${range} count=${window.exactCount} ` +
        `state=${window.state ?? "?"} timer=${window.timer ?? "?"}; ${stableText}`,
    );
  }
}

function main(): void {
  const args = parseArgs();
  const romPath = resolve(args.romPath);
  const outDir = resolve(args.outDir);
  const rom = loadRom(romPath);
  const descriptors = descriptorSurfaces(rom);
  const snapshotPaths = [
    ...(args.defaultSnapshots ? DEFAULT_SNAPSHOT_PATHS.flatMap((path) => collectJsonPaths(path)) : []),
    ...args.comparePaths.flatMap((path) => collectJsonPaths(path)),
    ...args.extraDirs.flatMap((path) => collectJsonPaths(path)),
  ];
  const uniqueSnapshotPaths = Array.from(new Set(snapshotPaths)).sort();
  const snapshots = loadSnapshotSurfaces(uniqueSnapshotPaths, args.allSnapshots);
  const associations = snapshots.map((surface) => snapshotAssociation(surface, descriptors));

  printDescriptorTable(descriptors);
  printDescriptorPairwise(descriptors);
  printNearestSnapshots(descriptors, snapshots, args.maxNearest);
  if (args.timelineSummary) printTimelineSummary(associations);
  if (args.transitionSummary) printTransitionSummary(associations);
  if (!args.timelineOnly) printSnapshotAssociations(associations, args.stableOnly);

  const pairwise = [];
  for (let i = 0; i < descriptors.length; i++) {
    for (let j = i + 1; j < descriptors.length; j++) {
      const a = descriptors[i]!;
      const b = descriptors[j]!;
      pairwise.push({
        a: descriptorNumber(a),
        b: descriptorNumber(b),
        playfieldDiffs: countDiffs(a.playfield, b.playfield),
        colorDiffs: countDiffs(a.color, b.color),
        alphaDiffs: countDiffs(a.alpha, b.alpha),
      });
    }
  }

  const manifest = {
    generatedAt: new Date().toISOString(),
    romPath,
    interpretation:
      "ROM descriptor fingerprints are authoritative level geometry identities, not playable start seeds. Snapshot associations are diagnostic only until a MAME/manual route proves playable active-vs-neutral control.",
    descriptors: descriptors.map((descriptor) => ({
      level: descriptorNumber(descriptor),
      romPointer: formatHex(descriptor.pointer),
      byteSize: descriptor.byteSize,
      timerRaw: descriptor.timer,
      playfieldNonzero: descriptor.pfNonzero,
      colorNonzero: descriptor.colorNonzero,
      alphaNonzero: descriptor.alphaNonzero,
      playfieldHash: descriptor.pfHash,
      coarseHash: descriptor.coarseHash,
      checksum: descriptor.checksum,
      nearestComparedSnapshots: snapshots
        .map((snapshot) => diffSurface(descriptor, snapshot))
        .sort((a, b) => a.playfieldDiffs - b.playfieldDiffs || a.colorDiffs - b.colorDiffs || a.alphaDiffs - b.alphaDiffs)
        .slice(0, args.maxNearest),
    })),
    descriptorPairwiseDiffs: pairwise,
    snapshotAssociations: associations,
    transitionSummary: transitionWindows(associations).map((window) => ({
      descriptor: window.descriptor,
      firstFrame: window.firstFrame,
      lastFrame: window.lastFrame,
      exactCount: window.exactCount,
      state: window.state,
      timer: window.timer,
      firstStable:
        window.firstStable === undefined
          ? undefined
          : {
              label: window.firstStable.label,
              frame: window.firstStable.frame,
              stablePlayable: window.firstStable.stablePlayable,
              main: window.firstStable.main,
              mode: window.firstStable.mode,
              segment: window.firstStable.segment,
              playerState: window.firstStable.playerState,
              timer: window.firstStable.timer,
              pfNonzero: window.firstStable.pfNonzero,
              pfHash: window.firstStable.pfHash,
              nearestDescriptor: window.firstStable.nearestDescriptor,
              playfieldDiffs: window.firstStable.playfieldDiffs,
              colorDiffs: window.firstStable.colorDiffs,
              alphaDiffs: window.firstStable.alphaDiffs,
            },
    })),
  };

  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`\nWrote descriptor manifest: ${join(outDir, "manifest.json")}`);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  exit(1);
}
