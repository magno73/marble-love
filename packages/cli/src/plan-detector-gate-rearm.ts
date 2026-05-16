#!/usr/bin/env node
/**
 * plan-detector-gate-rearm.ts — find MAME object-detector windows that can be
 * replayed with a minimal browser-style dispatcher rearm.
 *
 * This prints commands only. It does not run MAME and does not promote seeds.
 */

import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { argv, exit } from "node:process";

interface TraceJson {
  samples?: TraceSample[];
  events?: TraceEvent[];
  pointerWindows?: PointerWindow[];
}

interface TraceSample {
  frame?: number;
  main?: number;
  mode?: number;
  levelIndex?: number;
  objCount?: number;
  segment?: number;
  obj0State18?: number;
  obj0Substate1a?: number;
  obj0GateX20?: number;
  obj0Field36?: number;
  playerTimer?: number;
  levelPtr?: string;
  levelLabel?: string;
  level?: number;
}

interface TraceEvent {
  frame?: number;
  name?: string;
  pc?: string;
  writeData?: string;
}

interface PointerWindow {
  ptr?: string;
  label?: string;
  firstFrame?: number;
  lastFrame?: number;
  frameCount?: number;
}

interface CliArgs {
  tracePath: string;
  outRoot: string;
  rompath: string;
  only: Set<number>;
  targetLevel: number | undefined;
  rearmLead: number;
  maxGap: number;
  minSamples: number;
  traceLead: number;
  traceDuration: number;
  sampleEvery: number;
  maxEvents: number;
  maxSamples: number;
  trackballDelay: number;
  routeStep: number;
  activeRoute: string;
  neutralRoute: string;
  frameOffsets: number[];
  prefixRearmFrames: number[];
  anySubstate: boolean;
}

interface DetectorRun {
  first: TraceSample;
  last: TraceSample;
  sampleCount: number;
}

interface Candidate {
  index: number;
  firstFrame: number;
  lastFrame: number;
  sampleCount: number;
  rearmFrame: number;
  traceFrom: number;
  traceTo: number;
  trackballStart: number;
  frameList: string;
  level: number;
  levelIndex: number;
  expectedTargetLevel: number | undefined;
  label: string;
  pointer: string;
  segment: number;
  main: number;
  mode: number;
  objCount: number;
  substate: number;
}

function printHelp(): void {
  console.log(`plan-detector-gate-rearm — plan MAME detector-gate rearm proof runs

Usage:
  node --import tsx packages/cli/src/plan-detector-gate-rearm.ts [options] trace.json

Options:
  --out-root DIR        Output root (default: /private/tmp/marble-detector-gate-rearm)
  --rompath DIR         MAME ROM path (default: roms)
  --only LIST           1-based candidate indexes to print commands for
  --target-level N      Only keep candidates expected to advance to ROM L<N>
  --rearm-lead N        Force-manual frame lead before detector window (default: 1)
  --max-gap N           Max sample gap inside a detector-ready run (default: 30)
  --min-samples N       Min samples in a detector-ready run (default: 1)
  --trace-lead N        Frames before rearm to start descriptor trace (default: 50)
  --trace-duration N    Frames after first detector sample to capture (default: 2200)
  --sample-every N      Descriptor sample interval for planned runs (default: 5)
  --trackball-delay N   Frames after detector window before route starts (default: 453)
  --route-step N        MARBLE_PLAYABLE_ROUTE_STEP for planned runs (default: 4)
  --active-route SPEC   Active MAME route (default: R:300,D:300,L:300,U:300,N:500)
  --neutral-route SPEC  Neutral MAME route (default: N:1700)
  --frame-offsets CSV   Snapshot offsets from detector frame
                        (default: 0,126,153,253,353,553,753,1253,1853)
  --prefix-rearm-frames CSV
                        Earlier force-manual frames required to reproduce
                        candidates from an already-rearmed trace
  --any-substate        Do not require obj0+0x1A == 6 in the detector window
  -h, --help            Show this help

Input must be a JSON trace from oracle/mame_level_descriptor_tap.lua with
object fields enabled. Candidates are diagnostic proof runs; audit output is
still required before any startLevel wiring.
`);
}

function parseArgs(): CliArgs {
  const args = argv.slice(2);
  let outRoot = "/private/tmp/marble-detector-gate-rearm";
  let rompath = "roms";
  const only = new Set<number>();
  let targetLevel: number | undefined;
  let rearmLead = 1;
  let maxGap = 30;
  let minSamples = 1;
  let traceLead = 50;
  let traceDuration = 2200;
  let sampleEvery = 5;
  let maxEvents = 30000;
  let maxSamples = 5000;
  let trackballDelay = 453;
  let routeStep = 4;
  let activeRoute = "R:300,D:300,L:300,U:300,N:500";
  let neutralRoute = "N:1700";
  let frameOffsets = [0, 126, 153, 253, 353, 553, 753, 1253, 1853];
  let prefixRearmFrames: number[] = [];
  let anySubstate = false;
  const paths: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--out-root") {
      outRoot = requireValue(args[++i], "--out-root");
    } else if (arg === "--rompath") {
      rompath = requireValue(args[++i], "--rompath");
    } else if (arg === "--only") {
      for (const token of requireValue(args[++i], "--only").split(",")) {
        const value = Number(token.trim());
        if (!Number.isInteger(value) || value <= 0) throw new Error("--only values must be positive integers");
        only.add(value);
      }
    } else if (arg === "--target-level") {
      targetLevel = parsePositiveInt(args[++i], "--target-level");
    } else if (arg === "--rearm-lead") {
      rearmLead = parseNonNegativeInt(args[++i], "--rearm-lead");
    } else if (arg === "--max-gap") {
      maxGap = parsePositiveInt(args[++i], "--max-gap");
    } else if (arg === "--min-samples") {
      minSamples = parsePositiveInt(args[++i], "--min-samples");
    } else if (arg === "--trace-lead") {
      traceLead = parseNonNegativeInt(args[++i], "--trace-lead");
    } else if (arg === "--trace-duration") {
      traceDuration = parsePositiveInt(args[++i], "--trace-duration");
    } else if (arg === "--sample-every") {
      sampleEvery = parsePositiveInt(args[++i], "--sample-every");
    } else if (arg === "--trackball-delay") {
      trackballDelay = parseNonNegativeInt(args[++i], "--trackball-delay");
    } else if (arg === "--route-step") {
      routeStep = parsePositiveInt(args[++i], "--route-step");
    } else if (arg === "--active-route") {
      activeRoute = requireValue(args[++i], "--active-route");
    } else if (arg === "--neutral-route") {
      neutralRoute = requireValue(args[++i], "--neutral-route");
    } else if (arg === "--frame-offsets") {
      frameOffsets = parseCsvInts(requireValue(args[++i], "--frame-offsets"), "--frame-offsets");
    } else if (arg === "--prefix-rearm-frames") {
      prefixRearmFrames = parseCsvInts(requireValue(args[++i], "--prefix-rearm-frames"), "--prefix-rearm-frames");
    } else if (arg === "--any-substate") {
      anySubstate = true;
    } else if (arg === "--max-events") {
      maxEvents = parsePositiveInt(args[++i], "--max-events");
    } else if (arg === "--max-samples") {
      maxSamples = parsePositiveInt(args[++i], "--max-samples");
    } else if (arg === "-h" || arg === "--help") {
      printHelp();
      exit(0);
    } else if (arg !== undefined) {
      paths.push(arg);
    }
  }

  if (paths.length !== 1) throw new Error("expected exactly one trace path");
  const tracePath = paths[0];
  if (tracePath === undefined) throw new Error("expected a trace path");
  return {
    tracePath,
    outRoot,
    rompath,
    only,
    targetLevel,
    rearmLead,
    maxGap,
    minSamples,
    traceLead,
    traceDuration,
    sampleEvery,
    maxEvents,
    maxSamples,
    trackballDelay,
    routeStep,
    activeRoute,
    neutralRoute,
    frameOffsets,
    prefixRearmFrames,
    anySubstate,
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

function parseCsvInts(raw: string, label: string): number[] {
  const values = raw
    .split(",")
    .map((token) => token.trim())
    .filter((token) => token !== "")
    .map((token) => Number(token));
  if (values.length === 0 || values.some((value) => !Number.isInteger(value) || value < 0)) {
    throw new Error(`${label} must be a comma-separated list of non-negative integers`);
  }
  return [...new Set(values)].sort((a, b) => a - b);
}

function sampleFrame(sample: TraceSample): number {
  return sample.frame ?? -1;
}

function num(value: number | undefined): number {
  return value ?? 0;
}

function isDetectorReady(sample: TraceSample, args: CliArgs): boolean {
  return (
    sampleFrame(sample) >= 0 &&
    num(sample.objCount) >= 1 &&
    num(sample.obj0State18) === 3 &&
    (args.anySubstate || num(sample.obj0Substate1a) === 6)
  );
}

function sameRun(prev: TraceSample, next: TraceSample, args: CliArgs): boolean {
  return (
    sampleFrame(next) - sampleFrame(prev) <= args.maxGap &&
    num(prev.levelIndex) === num(next.levelIndex) &&
    num(prev.level) === num(next.level)
  );
}

function findDetectorRuns(samples: readonly TraceSample[], args: CliArgs): DetectorRun[] {
  const sorted = samples
    .filter((sample) => sample.frame !== undefined)
    .sort((a, b) => sampleFrame(a) - sampleFrame(b));
  const runs: DetectorRun[] = [];
  let current: DetectorRun | undefined;

  for (const sample of sorted) {
    if (!isDetectorReady(sample, args)) {
      if (current !== undefined) runs.push(current);
      current = undefined;
      continue;
    }
    if (current === undefined || !sameRun(current.last, sample, args)) {
      if (current !== undefined) runs.push(current);
      current = { first: sample, last: sample, sampleCount: 1 };
    } else {
      current.last = sample;
      current.sampleCount += 1;
    }
  }
  if (current !== undefined) runs.push(current);
  return runs.filter((run) => run.sampleCount >= args.minSamples);
}

function expectedTargetLevel(sample: TraceSample): number | undefined {
  const level = num(sample.level);
  if (level >= 1 && level < 6) return level + 1;
  const idx = num(sample.levelIndex);
  if (idx >= 0 && idx < 5) return idx + 2;
  return undefined;
}

function makeFrameList(firstFrame: number, offsets: readonly number[], traceTo: number): string {
  const frames = offsets
    .map((offset) => firstFrame + offset)
    .filter((frame) => frame <= traceTo);
  return frames.map((frame) => `f${frame}:${frame}`).join(",");
}

function makeCandidates(runs: readonly DetectorRun[], args: CliArgs): Candidate[] {
  const candidates: Candidate[] = [];
  for (const run of runs) {
    const firstFrame = sampleFrame(run.first);
    const lastFrame = sampleFrame(run.last);
    const target = expectedTargetLevel(run.first);
    if (args.targetLevel !== undefined && target !== args.targetLevel) continue;
    const traceTo = firstFrame + args.traceDuration;
    candidates.push({
      index: candidates.length + 1,
      firstFrame,
      lastFrame,
      sampleCount: run.sampleCount,
      rearmFrame: Math.max(1, firstFrame - args.rearmLead),
      traceFrom: Math.max(1, firstFrame - args.rearmLead - args.traceLead),
      traceTo,
      trackballStart: firstFrame + args.trackballDelay,
      frameList: makeFrameList(firstFrame, args.frameOffsets, traceTo),
      level: num(run.first.level),
      levelIndex: num(run.first.levelIndex),
      expectedTargetLevel: target,
      label: run.first.levelLabel ?? "unknown",
      pointer: run.first.levelPtr ?? "0x00000000",
      segment: num(run.first.segment),
      main: num(run.first.main),
      mode: num(run.first.mode),
      objCount: num(run.first.objCount),
      substate: num(run.first.obj0Substate1a),
    });
  }
  return candidates;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function sanitizeName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 80) || "detector";
}

function candidateName(candidate: Candidate): string {
  const target = candidate.expectedTargetLevel === undefined ? "next" : `L${candidate.expectedTargetLevel}`;
  return `${String(candidate.index).padStart(2, "0")}_${sanitizeName(candidate.label)}_idx${candidate.levelIndex}_to_${target}_f${candidate.firstFrame}`;
}

function printCommand(env: Record<string, string>, args: readonly string[]): void {
  const envText = Object.entries(env)
    .map(([key, value]) => `${key}=${shellQuote(value)}`)
    .join(" ");
  const argText = args.map(shellQuote).join(" ");
  console.log(envText === "" ? argText : `${envText} ${argText}`);
}

function printMameRun(candidate: Candidate, args: CliArgs, kind: "active" | "neutral"): void {
  const root = resolve(args.outRoot);
  const name = candidateName(candidate);
  const outDir = join(root, name, kind);
  const cfgDir = join(root, name, `cfg-${kind}`);
  const route = kind === "active" ? args.activeRoute : args.neutralRoute;
  const rearmFrames = [...args.prefixRearmFrames, candidate.rearmFrame]
    .filter((frame, index, frames) => frames.indexOf(frame) === index)
    .sort((a, b) => a - b)
    .join(",");

  console.log(`# ${kind} ${name}`);
  printCommand({}, ["rm", "-rf", cfgDir, outDir]);
  printCommand(
    {
      SDL_VIDEODRIVER: "dummy",
      MARBLE_DESCRIPTOR_TRACE_PLAYABLE_CAPTURE: "1",
      MARBLE_DESCRIPTOR_TRACE_FROM: String(candidate.traceFrom),
      MARBLE_DESCRIPTOR_TRACE_TO: String(candidate.traceTo),
      MARBLE_DESCRIPTOR_TRACE_SAMPLE_EVERY: String(args.sampleEvery),
      MARBLE_DESCRIPTOR_TRACE_MAX_EVENTS: String(args.maxEvents),
      MARBLE_DESCRIPTOR_TRACE_MAX_SAMPLES: String(args.maxSamples),
      MARBLE_DESCRIPTOR_TRACE_OUT: join(outDir, "trace.json"),
      MARBLE_PLAYABLE_OUT_DIR: join(outDir, "scenarios"),
      MARBLE_PLAYABLE_INPUT_OUT: join(outDir, "input.json"),
      MARBLE_PLAYABLE_FRAME_LIST: candidate.frameList,
      MARBLE_PLAYABLE_CAPTURE_FRAMES: "0",
      MARBLE_PLAYABLE_FORCE_MANUAL_DISPATCHER: "1",
      MARBLE_PLAYABLE_FORCE_MANUAL_FRAMES: rearmFrames,
      MARBLE_PLAYABLE_TRACKBALL_START: String(candidate.trackballStart),
      MARBLE_PLAYABLE_ROUTE_STEP: String(args.routeStep),
      MARBLE_PLAYABLE_ROUTE: route,
    },
    [
      "mame",
      "marble",
      "-rompath",
      args.rompath,
      "-cfg_directory",
      cfgDir,
      "-autoboot_script",
      "oracle/mame_level_descriptor_tap.lua",
      "-nothrottle",
      "-video",
      "none",
      "-sound",
      "none",
      "-nonvram_save",
    ],
  );
}

function printAuditCommands(candidate: Candidate, args: CliArgs): void {
  const root = resolve(args.outRoot);
  const name = candidateName(candidate);
  const activeDir = join(root, name, "active");
  const neutralDir = join(root, name, "neutral");

  console.log(`# inspect/audit ${name}`);
  printCommand(
    {},
    [
      "node",
      "--import",
      "tsx",
      "packages/cli/src/inspect-level-descriptors.ts",
      "--no-default-snapshots",
      "--all-snapshots",
      "--transition-summary",
      join(activeDir, "scenarios"),
    ],
  );
  const auditPrefix = [
    "node",
    "--import",
    "tsx",
    "packages/cli/src/audit-playable-seed.ts",
    "--mame-neutral-dir",
    join(neutralDir, "scenarios"),
    "--distinct-from",
    "packages/web/public/scenarios/playable/manual_level1_start.seed.json",
  ];
  console.log(`${auditPrefix.map(shellQuote).join(" ")} ${shellQuote(join(activeDir, "scenarios"))}/*.json`);
}

function printTraceSuccessSummary(trace: TraceJson): void {
  const events = trace.events ?? [];
  const main3Writes = events.filter((event) => event.name === "workRam[0x390..0x391]" && event.writeData === "0x00000003");
  const detectorHits = events.filter(
    (event) => event.name === "FUN_251DE_endgame_set_flag" || event.name === "FUN_251DE_write_main3",
  );
  if (detectorHits.length === 0 && main3Writes.length === 0) return;
  console.log("");
  console.log("# Existing trace success signals");
  console.log(`detectorHits=${detectorHits.length} main3Writes=${main3Writes.length}`);
  for (const event of [...detectorHits, ...main3Writes].slice(0, 12)) {
    console.log(
      `  f${event.frame ?? "?"} ${event.name ?? "event"} pc=${event.pc ?? "?"} writeData=${event.writeData ?? "-"}`,
    );
  }
}

function printPointerWindows(trace: TraceJson): void {
  const windows = trace.pointerWindows ?? [];
  if (windows.length === 0) return;
  console.log("# Pointer windows");
  for (const window of windows) {
    console.log(
      `  ${window.label ?? "?"}@${window.ptr ?? "?"} f${window.firstFrame ?? "?"}-${window.lastFrame ?? "?"} (${window.frameCount ?? "?"})`,
    );
  }
  console.log("");
}

function main(): void {
  const args = parseArgs();
  const trace = JSON.parse(readFileSync(args.tracePath, "utf8")) as TraceJson;
  const runs = findDetectorRuns(trace.samples ?? [], args);
  const candidates = makeCandidates(runs, args);
  const selected = candidates.filter((candidate) => args.only.size === 0 || args.only.has(candidate.index));

  console.log(`# Detector-gate rearm plan from ${args.tracePath}`);
  printPointerWindows(trace);
  if (candidates.length === 0) {
    console.log("No detector-ready windows found.");
    printTraceSuccessSummary(trace);
    return;
  }

  console.log("# Candidates");
  for (const candidate of candidates) {
    const target = candidate.expectedTargetLevel === undefined ? "next" : `L${candidate.expectedTargetLevel}`;
    console.log(
      [
        `${candidate.index}.`,
        `f${candidate.firstFrame}-${candidate.lastFrame}`,
        `samples=${candidate.sampleCount}`,
        `rearm=f${candidate.rearmFrame}`,
        `trackball=f${candidate.trackballStart}`,
        `current=${candidate.label}@${candidate.pointer}`,
        `idx=${candidate.levelIndex}`,
        `target=${target}`,
        `main/mode=${candidate.main}/${candidate.mode}`,
        `seg=${candidate.segment}`,
        `objCount=${candidate.objCount}`,
        `sub1a=${candidate.substate}`,
      ].join(" "),
    );
  }
  printTraceSuccessSummary(trace);

  if (selected.length === 0) return;
  console.log("");
  console.log("# Planned proof commands");
  for (const candidate of selected) {
    console.log("");
    printMameRun(candidate, args, "active");
    console.log("");
    printMameRun(candidate, args, "neutral");
    console.log("");
    printAuditCommands(candidate, args);
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  exit(1);
}
