#!/usr/bin/env node
/**
 * audit-mame-route-proof.ts - audit a MAME forced-manual route proof.
 *
 * This covers the proof shape where snapshot #0 is the unmodified playable
 * seed candidate, then MAME clears the manual dispatcher one frame later and
 * captures active-vs-neutral tails. It does not promote or wire startLevel.
 */

import { createHash } from "node:crypto";
import { basename, resolve } from "node:path";
import { readFileSync } from "node:fs";
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
  activePath: string;
  neutralPath: string;
  romPath: string;
  initialIndex: number;
  proofIndex: number | undefined;
  distinctFrom: string[];
  minPlayfieldDiff: number;
  descriptorWarnDiff: number;
  json: boolean;
}

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

interface SeedSummary {
  frame: number | undefined;
  main: number;
  mode: number;
  next: number;
  segment: number;
  playerState: number;
  timer: number;
  scrollWord: number;
  x: number;
  y: number;
  pfNonzero: number;
  pfHash: string;
}

interface DescriptorSummary {
  label: string;
  levelIndex: number;
  pointer: string;
  playfieldDiffs: number;
  pfHash: string;
}

interface DescriptorSurface extends DescriptorSummary {
  playfield: Uint8Array;
}

interface ReferenceSummary {
  path: string;
  playfieldDiffs: number;
  exactMatch: boolean;
  nearDuplicate: boolean;
}

const DEFAULT_ROM_PATH = "ghidra_project/marble_program.bin";
const DEFAULT_DISTINCT_FROM = ["packages/web/public/scenarios/playable/manual_level1_start.seed.json"];
const DEFAULT_MIN_PLAYFIELD_DIFF = 512;
const DEFAULT_DESCRIPTOR_WARN_DIFF = 1024;

function printHelp(): void {
  console.log(`audit-mame-route-proof - audit MAME active-vs-neutral route proof tails

Usage:
  npx tsx packages/cli/src/audit-mame-route-proof.ts [options] active.json

Options:
  --neutral PATH             Matching neutral MAME scenario path (required)
  --rom PATH                 Program ROM blob (default: ${DEFAULT_ROM_PATH})
  --initial-index N          Snapshot index for the unforced seed candidate
                             (default: 0)
  --proof-index N            Snapshot index used for active-vs-neutral proof
                             (default: last shared snapshot)
  --distinct-from PATH       Reject/flag near-duplicate playfield references.
                             Can be repeated; default is ${DEFAULT_DISTINCT_FROM[0]}
  --min-playfield-diff N     Near-duplicate threshold (default: ${DEFAULT_MIN_PLAYFIELD_DIFF})
  --descriptor-warn-diff N   Warn when nearest ROM descriptor PF diff exceeds N
                             (default: ${DEFAULT_DESCRIPTOR_WARN_DIFF})
  --json                     Emit JSON
  -h, --help                 Show this help

This utility expects active/neutral captures with the same snapshot layout. The
initial snapshot should be before forced manual dispatcher clear; the proof
snapshot should be after route input has had time to diverge.
`);
}

function parseArgs(): CliArgs {
  const raw = argv.slice(2);
  const distinctFrom: string[] = [];
  let activePath: string | undefined;
  let neutralPath: string | undefined;
  let romPath = DEFAULT_ROM_PATH;
  let initialIndex = 0;
  let proofIndex: number | undefined;
  let minPlayfieldDiff = DEFAULT_MIN_PLAYFIELD_DIFF;
  let descriptorWarnDiff = DEFAULT_DESCRIPTOR_WARN_DIFF;
  let json = false;

  for (let i = 0; i < raw.length; i++) {
    const arg = raw[i]!;
    if (arg === "--neutral") neutralPath = requireValue(raw[++i], "--neutral");
    else if (arg === "--rom") romPath = requireValue(raw[++i], "--rom");
    else if (arg === "--initial-index") initialIndex = parseNonNegativeInt(raw[++i], "--initial-index");
    else if (arg === "--proof-index") proofIndex = parseNonNegativeInt(raw[++i], "--proof-index");
    else if (arg === "--distinct-from") distinctFrom.push(requireValue(raw[++i], "--distinct-from"));
    else if (arg === "--min-playfield-diff") minPlayfieldDiff = parseNonNegativeInt(raw[++i], "--min-playfield-diff");
    else if (arg === "--descriptor-warn-diff") descriptorWarnDiff = parseNonNegativeInt(raw[++i], "--descriptor-warn-diff");
    else if (arg === "--json") json = true;
    else if (arg === "-h" || arg === "--help") {
      printHelp();
      exit(0);
    } else if (arg.startsWith("--")) {
      throw new Error(`unknown option: ${arg}`);
    } else if (activePath === undefined) {
      activePath = arg;
    } else {
      throw new Error(`unexpected positional argument: ${arg}`);
    }
  }

  if (activePath === undefined) throw new Error("expected active scenario path");
  if (neutralPath === undefined) throw new Error("--neutral is required");
  return {
    activePath,
    neutralPath,
    romPath,
    initialIndex,
    proofIndex,
    distinctFrom: distinctFrom.length === 0 ? DEFAULT_DISTINCT_FROM : distinctFrom,
    minPlayfieldDiff,
    descriptorWarnDiff,
    json,
  };
}

function requireValue(value: string | undefined, label: string): string {
  if (value === undefined) throw new Error(`${label} requires a value`);
  return value;
}

function parseNonNegativeInt(raw: string | undefined, label: string): number {
  if (raw === undefined) throw new Error(`${label} requires a value`);
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

function fixed16Raw(bytes: Uint8Array, off: number): number {
  return signedLong(readLongBE(bytes, off));
}

function nonzero(bytes: Uint8Array): number {
  let total = 0;
  for (const value of bytes) if (value !== 0) total++;
  return total;
}

function shortHash(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex").slice(0, 16);
}

function countDiffs(a: Uint8Array, b: Uint8Array): number {
  if (a.length !== b.length) throw new Error(`cannot diff buffers with different lengths ${a.length}/${b.length}`);
  let diffs = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diffs++;
  return diffs;
}

function loadSnapshots(path: string): SeedJson[] {
  const absolute = resolve(path);
  const raw = JSON.parse(readFileSync(absolute, "utf-8")) as ScenarioJson | SeedJson;
  if ("snapshots" in raw && Array.isArray(raw.snapshots)) return raw.snapshots;
  return [raw as SeedJson];
}

function snapshotAt(snapshots: readonly SeedJson[], index: number, label: string): SeedJson {
  const seed = snapshots[index];
  if (seed === undefined) throw new Error(`${label} has no snapshot index ${index}`);
  return seed;
}

function workRam(seed: SeedJson, label: string): Uint8Array {
  return hexToBytes(seed.workRam, 0x2000, `${label} workRam`);
}

function playfield(seed: SeedJson, label: string): Uint8Array {
  return hexToBytes(seed.playfieldRam, 0x2000, `${label} playfieldRam`);
}

function summarizeSeed(seed: SeedJson, label: string): SeedSummary {
  const work = workRam(seed, label);
  const pf = playfield(seed, label);
  return {
    frame: seed.frame,
    main: readWordBE(work, 0x390),
    mode: readWordBE(work, 0x392),
    next: readWordBE(work, 0x394),
    segment: work[0x3e4] ?? 0,
    playerState: work[0x18 + 0x1a] ?? 0,
    timer: readWordBE(work, 0x18 + 0x6a),
    scrollWord: readWordBE(work, 0x2) & 0x1ff,
    x: fixed16(work, 0x18 + 0x0c),
    y: fixed16(work, 0x18 + 0x10),
    pfNonzero: nonzero(pf),
    pfHash: shortHash(pf),
  };
}

function loadRom(path: string): RomImage {
  const rom = busNs.emptyRomImage();
  applySlapsticBank.loadRomBlob(rom, readFileSync(resolve(path)));
  return rom;
}

function descriptorPlayfields(rom: RomImage): DescriptorSurface[] {
  return levelNs.loadAllLevels(rom).map((level) => {
    const gameState = stateNs.emptyGameState();
    gameState.workRam[0x394] = (level.index >>> 8) & 0xff;
    gameState.workRam[0x395] = level.index & 0xff;
    dispatcherNs.levelDispatcher16EC6(gameState, rom);
    return {
      label: `L${level.index + 1}`,
      levelIndex: level.index,
      pointer: `0x${level.romOffset.toString(16)}`,
      playfieldDiffs: 0,
      pfHash: shortHash(gameState.playfieldRam),
      playfield: gameState.playfieldRam.slice(),
    };
  });
}

function nearestDescriptor(seed: SeedJson, rom: RomImage, label: string): DescriptorSummary {
  const pf = playfield(seed, label);
  const descriptors = descriptorPlayfields(rom).map((descriptor) => ({
    label: descriptor.label,
    levelIndex: descriptor.levelIndex,
    pointer: descriptor.pointer,
    pfHash: descriptor.pfHash,
    playfieldDiffs: countDiffs(pf, descriptor.playfield),
  }));
  descriptors.sort((a, b) => a.playfieldDiffs - b.playfieldDiffs);
  return descriptors[0]!;
}

function referenceSummary(seed: SeedJson, referencePath: string, minPlayfieldDiff: number): ReferenceSummary {
  const pf = playfield(seed, "initial");
  const reference = snapshotAt(loadSnapshots(referencePath), 0, referencePath);
  const referencePf = playfield(reference, referencePath);
  const diffs = countDiffs(pf, referencePf);
  return {
    path: referencePath,
    playfieldDiffs: diffs,
    exactMatch: diffs === 0,
    nearDuplicate: diffs < minPlayfieldDiff,
  };
}

function byteDiff(seedA: SeedJson, seedB: SeedJson, field: "workRam" | "playfieldRam" | "spriteRam" | "alphaRam" | "colorRam"): number {
  const expected = field === "workRam" || field === "playfieldRam" ? 0x2000 : field === "colorRam" ? 0x800 : 0x1000;
  return countDiffs(hexToBytes(seedA[field], expected, `active ${field}`), hexToBytes(seedB[field], expected, `neutral ${field}`));
}

function proofDiff(active: SeedJson, neutral: SeedJson): {
  diffX: number;
  diffY: number;
  responsive: boolean;
  workRamDiffs: number;
  playfieldDiffs: number;
  spriteDiffs: number;
  alphaDiffs: number;
  colorDiffs: number;
} {
  const activeWork = workRam(active, "active proof");
  const neutralWork = workRam(neutral, "neutral proof");
  const diffX = Math.abs(fixed16Raw(activeWork, 0x18 + 0x0c) - fixed16Raw(neutralWork, 0x18 + 0x0c));
  const diffY = Math.abs(fixed16Raw(activeWork, 0x18 + 0x10) - fixed16Raw(neutralWork, 0x18 + 0x10));
  return {
    diffX,
    diffY,
    responsive: diffX > 0x40000 || diffY > 0x40000,
    workRamDiffs: countDiffs(activeWork, neutralWork),
    playfieldDiffs: byteDiff(active, neutral, "playfieldRam"),
    spriteDiffs: byteDiff(active, neutral, "spriteRam"),
    alphaDiffs: byteDiff(active, neutral, "alphaRam"),
    colorDiffs: byteDiff(active, neutral, "colorRam"),
  };
}

function fmt(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function main(): void {
  const args = parseArgs();
  const activeSnapshots = loadSnapshots(args.activePath);
  const neutralSnapshots = loadSnapshots(args.neutralPath);
  const proofIndex = args.proofIndex ?? Math.min(activeSnapshots.length, neutralSnapshots.length) - 1;
  if (proofIndex < 0) throw new Error("active/neutral scenarios have no shared snapshots");

  const initialSeed = snapshotAt(activeSnapshots, args.initialIndex, "active");
  const activeProofSeed = snapshotAt(activeSnapshots, proofIndex, "active");
  const neutralProofSeed = snapshotAt(neutralSnapshots, proofIndex, "neutral");
  const rom = loadRom(args.romPath);
  const initial = summarizeSeed(initialSeed, "initial");
  const activeProof = summarizeSeed(activeProofSeed, "active proof");
  const neutralProof = summarizeSeed(neutralProofSeed, "neutral proof");
  const nearest = nearestDescriptor(initialSeed, rom, "initial");
  const references = args.distinctFrom.map((path) => referenceSummary(initialSeed, path, args.minPlayfieldDiff));
  const proof = proofDiff(activeProofSeed, neutralProofSeed);

  const reasons: string[] = [];
  if (initial.pfNonzero <= 4_000) reasons.push("initial playfield is not fully populated");
  if (initial.main !== 1 || initial.mode !== 0) reasons.push(`initial seed is outside playable main/mode 1/0 (${initial.main}/${initial.mode})`);
  if (initial.playerState !== 0) reasons.push(`initial player starts in state ${initial.playerState}, not state 0`);
  if (initial.timer <= 0) reasons.push("initial timer is dead/zero");
  for (const reference of references) {
    if (reference.exactMatch) reasons.push(`initial playfield exactly matches ${reference.path}`);
    else if (reference.nearDuplicate) {
      reasons.push(`initial playfield is near-duplicate of ${reference.path} (${reference.playfieldDiffs} < ${args.minPlayfieldDiff})`);
    }
  }
  if (!proof.responsive) reasons.push("MAME proof tail active-vs-neutral did not diverge enough");
  if (activeProof.playerState !== 0) reasons.push(`active proof tail player state is ${activeProof.playerState}, not state 0`);
  if (activeProof.timer <= 0) reasons.push("active proof tail timer is dead/zero");
  if (activeProof.pfNonzero <= 4_000) reasons.push("active proof tail playfield is not fully populated");
  if (nearest.playfieldDiffs > args.descriptorWarnDiff) {
    reasons.push(`nearest ROM descriptor is still far (${nearest.label} pfDiff=${nearest.playfieldDiffs} > ${args.descriptorWarnDiff})`);
  }

  const verdict =
    reasons.length === 0
      ? "route-proof-candidate"
      : proof.responsive && initial.main === 1 && initial.mode === 0 && initial.playerState === 0 && initial.timer > 0
        ? "diagnostic-route-proof"
        : "diagnostic-only";

  const result = {
    activePath: resolve(args.activePath),
    neutralPath: resolve(args.neutralPath),
    initialIndex: args.initialIndex,
    proofIndex,
    initial,
    activeProof,
    neutralProof,
    nearestDescriptor: nearest,
    references,
    proof,
    verdict,
    reasons,
  };

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(`MAME route proof: ${basename(args.activePath)} vs ${basename(args.neutralPath)}`);
  console.log(
    `  initial #${args.initialIndex}: frame=${initial.frame ?? "-"} main/mode=${initial.main}/${initial.mode} ` +
      `seg=${initial.segment} state=${initial.playerState} timer=${initial.timer} ` +
      `xy=${fmt(initial.x)},${fmt(initial.y)} pf=${initial.pfNonzero} hash=${initial.pfHash}`,
  );
  console.log(
    `  nearest descriptor: ${nearest.label} ptr=${nearest.pointer} pfDiff=${nearest.playfieldDiffs} hash=${nearest.pfHash}`,
  );
  for (const reference of references) {
    console.log(
      `  distinct-from: diffs=${reference.playfieldDiffs} exact=${reference.exactMatch ? "yes" : "no"} ` +
        `near=${reference.nearDuplicate ? "yes" : "no"} path=${reference.path}`,
    );
  }
  console.log(
    `  proof #${proofIndex}: active frame=${activeProof.frame ?? "-"} main/mode=${activeProof.main}/${activeProof.mode} ` +
      `seg=${activeProof.segment} state=${activeProof.playerState} timer=${activeProof.timer} ` +
      `xy=${fmt(activeProof.x)},${fmt(activeProof.y)} pf=${activeProof.pfNonzero}`,
  );
  console.log(
    `  neutral #${proofIndex}: frame=${neutralProof.frame ?? "-"} main/mode=${neutralProof.main}/${neutralProof.mode} ` +
      `seg=${neutralProof.segment} state=${neutralProof.playerState} timer=${neutralProof.timer} ` +
      `xy=${fmt(neutralProof.x)},${fmt(neutralProof.y)} pf=${neutralProof.pfNonzero}`,
  );
  console.log(
    `  active-vs-neutral: responsive=${proof.responsive ? "yes" : "no"} diffXY=${proof.diffX}/${proof.diffY} ` +
      `bytes wr/pf/sp/al/co=${proof.workRamDiffs}/${proof.playfieldDiffs}/${proof.spriteDiffs}/${proof.alphaDiffs}/${proof.colorDiffs}`,
  );
  console.log(`  verdict: ${verdict}`);
  for (const reason of reasons) console.log(`   - ${reason}`);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  exit(1);
}
