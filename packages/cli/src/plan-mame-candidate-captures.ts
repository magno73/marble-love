#!/usr/bin/env node
/**
 * plan-mame-candidate-captures.ts — turn scanner candidate manifests into
 * reproducible MAME active/neutral capture commands.
 *
 * This prints commands only. It does not run MAME and does not promote seeds.
 */

import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { argv, exit } from "node:process";

interface CandidateManifest {
  candidates?: CandidateEntry[];
}

interface CandidateEntry {
  file: string;
  sourceLabel: string;
  routeLabel?: string;
  routeFrame?: number;
  absoluteFrame?: number;
  mameTrackballStart?: number;
  routeSpec?: string;
  segment: number;
  pfNonzero: number;
  coarseHash: string;
  renderCoarseHash?: string;
}

interface CliArgs {
  manifestPath: string;
  outRoot: string;
  captureFrames: number;
  only: Set<string>;
}

interface CaptureGroup {
  key: string;
  routeSpec: string;
  neutralSpec: string;
  mameTrackballStart: number;
  candidates: CandidateEntry[];
}

function printHelp(): void {
  console.log(`plan-mame-candidate-captures — print MAME proof commands for seed candidates

Usage:
  npx tsx packages/cli/src/plan-mame-candidate-captures.ts [options] manifest.json

Options:
  --out-root DIR        Output root for active/neutral MAME captures
                        (default: /private/tmp/marble-mame-candidate-captures)
  --capture-frames N   Snapshot frames after each candidate frame (default: 100)
  --only LIST           Comma-separated candidate selectors. Values can be
                        manifest indexes (1-based), filenames, or source labels.
  -h, --help            Show this help

The scanner manifest must include routeSpec, absoluteFrame, routeFrame, and
mameTrackballStart. Use scan-playable-terrain-hashes.ts from the current main.
`);
}

function parseArgs(): CliArgs {
  const args = argv.slice(2);
  let outRoot = "/private/tmp/marble-mame-candidate-captures";
  let captureFrames = 100;
  const only = new Set<string>();
  const paths: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--out-root") {
      const next = args[++i];
      if (next === undefined) throw new Error("--out-root requires a value");
      outRoot = next;
    } else if (arg === "--capture-frames") {
      captureFrames = parsePositiveInt(args[++i], "--capture-frames");
    } else if (arg === "--only") {
      const next = args[++i];
      if (next === undefined) throw new Error("--only requires a value");
      for (const token of next.split(",")) {
        const trimmed = token.trim();
        if (trimmed !== "") only.add(trimmed);
      }
    } else if (arg === "-h" || arg === "--help") {
      printHelp();
      exit(0);
    } else if (arg !== undefined) {
      paths.push(arg);
    }
  }

  if (paths.length !== 1) throw new Error("expected exactly one manifest path");
  return { manifestPath: paths[0]!, outRoot, captureFrames, only };
}

function parsePositiveInt(raw: string | undefined, label: string): number {
  if (raw === undefined) throw new Error(`${label} requires a value`);
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) throw new Error(`${label} must be a non-negative integer`);
  return value;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function sanitizeName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 80) || "candidate";
}

function candidateName(index: number, candidate: CandidateEntry): string {
  const routeFrame = candidate.routeFrame === undefined ? "unknown" : String(candidate.routeFrame);
  return `${String(index + 1).padStart(2, "0")}_${sanitizeName(candidate.routeLabel ?? "route")}_seg${candidate.segment}_f${routeFrame}`;
}

function selectedCandidates(candidates: CandidateEntry[], only: ReadonlySet<string>): CandidateEntry[] {
  if (only.size === 0) return candidates;
  return candidates.filter((candidate, index) => {
    const oneBased = String(index + 1);
    return only.has(oneBased) || only.has(candidate.file) || only.has(candidate.sourceLabel);
  });
}

function requireCandidateFields(candidate: CandidateEntry): void {
  const missing: string[] = [];
  if (candidate.routeSpec === undefined) missing.push("routeSpec");
  if (candidate.routeFrame === undefined) missing.push("routeFrame");
  if (candidate.absoluteFrame === undefined) missing.push("absoluteFrame");
  if (candidate.mameTrackballStart === undefined) missing.push("mameTrackballStart");
  if (missing.length > 0) {
    throw new Error(`${candidate.file} is missing ${missing.join(", ")}; regenerate the manifest with the current scanner`);
  }
}

function groupCandidates(candidates: CandidateEntry[], captureFrames: number): CaptureGroup[] {
  const groups = new Map<string, CaptureGroup>();
  for (const candidate of candidates) {
    requireCandidateFields(candidate);
    const routeSpec = candidate.routeSpec!;
    const start = candidate.mameTrackballStart!;
    const key = `${start}:${routeSpec}`;
    const existing = groups.get(key);
    const group =
      existing ??
      (() => {
        const created: CaptureGroup = {
          key,
          routeSpec,
          neutralSpec: "N:1",
          mameTrackballStart: start,
          candidates: [],
        };
        groups.set(key, created);
        return created;
      })();
    group.candidates.push(candidate);
    const routeFrame = candidate.routeFrame ?? 0;
    const neutralFrames = Math.max(Number(group.neutralSpec.slice(2)), routeFrame + captureFrames + 1);
    group.neutralSpec = `N:${neutralFrames}`;
  }
  return Array.from(groups.values());
}

function frameList(candidates: readonly CandidateEntry[], allCandidates: readonly CandidateEntry[]): string {
  return candidates
    .map((candidate) => {
      const index = allCandidates.indexOf(candidate);
      return `${candidateName(index, candidate)}:${candidate.absoluteFrame}`;
    })
    .join(",");
}

function printCommand(env: Record<string, string>, args: readonly string[]): void {
  const envText = Object.entries(env)
    .map(([key, value]) => `${key}=${shellQuote(value)}`)
    .join(" ");
  const argText = args.map(shellQuote).join(" ");
  console.log(envText === "" ? argText : `${envText} ${argText}`);
}

function main(): void {
  const args = parseArgs();
  const manifest = JSON.parse(readFileSync(resolve(args.manifestPath), "utf-8")) as CandidateManifest;
  const allCandidates = manifest.candidates ?? [];
  const candidates = selectedCandidates(allCandidates, args.only);
  if (candidates.length === 0) throw new Error("no candidates selected");
  const groups = groupCandidates(candidates, args.captureFrames);

  console.log(`# MAME candidate proof plan from ${args.manifestPath}`);
  console.log(`# selected=${candidates.length} captureFrames=${args.captureFrames}`);
  for (const group of groups) {
    const activeDir = join(args.outRoot, `active_${sanitizeName(group.key).slice(0, 32)}`);
    const neutralDir = join(args.outRoot, `neutral_${sanitizeName(group.key).slice(0, 32)}`);
    const frames = frameList(group.candidates, allCandidates);
    const activeInput = join(activeDir, "input.json");
    const neutralInput = join(neutralDir, "input.json");

    console.log("");
    console.log(`# group trackballStart=${group.mameTrackballStart} candidates=${group.candidates.length}`);
    console.log("# active capture");
    printCommand(
      {
        MARBLE_PLAYABLE_OUT_DIR: activeDir,
        MARBLE_PLAYABLE_INPUT_OUT: activeInput,
        MARBLE_PLAYABLE_ROUTE: group.routeSpec,
        MARBLE_PLAYABLE_TRACKBALL_START: String(group.mameTrackballStart),
        MARBLE_PLAYABLE_FRAME_LIST: frames,
        MARBLE_PLAYABLE_CAPTURE_FRAMES: String(args.captureFrames),
      },
      ["mame", "marble", "-rompath", "roms", "-autoboot_script", "oracle/mame_playable_input_capture.lua", "-nothrottle", "-video", "none", "-sound", "none", "-nonvram_save"],
    );
    console.log("# neutral capture");
    printCommand(
      {
        MARBLE_PLAYABLE_OUT_DIR: neutralDir,
        MARBLE_PLAYABLE_INPUT_OUT: neutralInput,
        MARBLE_PLAYABLE_ROUTE: group.neutralSpec,
        MARBLE_PLAYABLE_TRACKBALL_START: String(group.mameTrackballStart),
        MARBLE_PLAYABLE_FRAME_LIST: frames,
        MARBLE_PLAYABLE_CAPTURE_FRAMES: String(args.captureFrames),
      },
      ["mame", "marble", "-rompath", "roms", "-autoboot_script", "oracle/mame_playable_input_capture.lua", "-nothrottle", "-video", "none", "-sound", "none", "-nonvram_save"],
    );
    console.log("# audit after both captures");
    const activeScenarios = group.candidates.map((candidate) => join(activeDir, `${candidateName(allCandidates.indexOf(candidate), candidate)}.json`));
    printCommand(
      {},
      [
        "npx",
        "tsx",
        "packages/cli/src/audit-playable-seed.ts",
        "--mame-neutral-dir",
        neutralDir,
        "--distinct-from",
        "packages/web/public/scenarios/playable/manual_level1_start.seed.json",
        ...activeScenarios,
      ],
    );
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  exit(1);
}
