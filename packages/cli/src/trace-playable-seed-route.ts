#!/usr/bin/env node
/**
 * trace-playable-seed-route.ts - explain TS route failures from a seed.
 *
 * This is a diagnostic companion to audit-playable-seed. It replays the same
 * active-vs-neutral route from a captured seed and prints the first frames
 * where the candidate leaves stable playable state. It does not promote seeds.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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
  dispatcher: "manual" | "preserved" | "both";
  snapshotIndex: number;
  maxEvents: number;
  json: boolean;
}

interface DescriptorSummary {
  level: number;
  pointer: number;
  pfNonzero: number;
  minPlayablePf: number;
}

interface Sample {
  routeFrame: number;
  absoluteFrame: number | undefined;
  step: string;
  main: number;
  mode: number;
  next: number;
  segment: number;
  playerState: number;
  obj18: number;
  obj19: number;
  obj20: number;
  obj24: number;
  obj26: number;
  obj36: number;
  timer: number;
  pfCount: number;
  scrollY: number;
  descriptorPointer: number;
  descriptorLevel: number | undefined;
  x: number;
  y: number;
  z: number;
  field04: number;
  field08: number;
}

interface TraceEvent {
  kind: string;
  sample: Sample;
  previous?: Sample;
}

interface TraceSummary {
  dispatcher: "manual" | "preserved";
  path: string;
  sourceFrame: number | undefined;
  routeFrames: number;
  minStablePf: number;
  active: RouteTrace;
  neutral: RouteTrace;
  diffX: number;
  diffY: number;
  responsive: boolean;
  stable: boolean;
}

interface RouteTrace {
  initial: Sample;
  final: Sample;
  events: TraceEvent[];
  firstDeathFrame: number | undefined;
  firstRecoveryFrame: number | undefined;
  firstState1Frame: number | undefined;
  firstState2Frame: number | undefined;
  firstState6Frame: number | undefined;
  firstEmptyPfFrame: number | undefined;
  firstScrollOverflowFrame: number | undefined;
  deathEvents: number;
  recoveries: number;
  maxEmptyRun: number;
  maxState1Run: number;
  maxState2Run: number;
  maxState6Run: number;
}

const DEFAULT_PLAN = "R:200,D:200,L:200,U:200,N:200";
const DEFAULT_MAX_EVENTS = 18;
const FALLBACK_MIN_PLAYABLE_PF = 4_001;
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
  console.log(`trace-playable-seed-route - explain TS route failures

Usage:
  node --import tsx packages/cli/src/trace-playable-seed-route.ts [options] seed-or-scenario.json [...]

Options:
  --plan SPEC          Route to compare against neutral input
                       (default: ${DEFAULT_PLAN})
  --dispatcher MODE    manual, preserved, or both (default: both)
  --snapshot-index N   Scenario snapshot index (default: 0)
  --max-events N       Event rows per active/neutral trace in text output
                       (default: ${DEFAULT_MAX_EVENTS})
  --json               Emit machine-readable JSON
  -h, --help           Show this help

This tool diagnoses why a MAME-responsive frontier fails the TS/browser route
gate. It does not write playable seeds or change startLevel wiring.
`);
}

function parseArgs(): CliArgs {
  const raw = argv.slice(2);
  const paths: string[] = [];
  let plan = DEFAULT_PLAN;
  let dispatcher: CliArgs["dispatcher"] = "both";
  let snapshotIndex = 0;
  let maxEvents = DEFAULT_MAX_EVENTS;
  let json = false;

  for (let i = 0; i < raw.length; i++) {
    const arg = raw[i]!;
    if (arg === "--plan") {
      plan = requireValue(raw[++i], "--plan");
    } else if (arg === "--dispatcher") {
      const value = requireValue(raw[++i], "--dispatcher");
      if (value !== "manual" && value !== "preserved" && value !== "both") {
        throw new Error("--dispatcher must be manual, preserved, or both");
      }
      dispatcher = value;
    } else if (arg === "--snapshot-index") {
      snapshotIndex = parseNonNegativeInt(raw[++i], "--snapshot-index");
    } else if (arg === "--max-events") {
      maxEvents = parseNonNegativeInt(raw[++i], "--max-events");
    } else if (arg === "--json") {
      json = true;
    } else if (arg === "-h" || arg === "--help") {
      printHelp();
      exit(0);
    } else if (arg.startsWith("--")) {
      throw new Error(`unknown option: ${arg}`);
    } else {
      paths.push(arg);
    }
  }

  if (paths.length === 0) throw new Error("at least one seed/scenario path is required");
  return { paths, plan, dispatcher, snapshotIndex, maxEvents, json };
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

function nonzero(bytes: Uint8Array): number {
  let total = 0;
  for (const value of bytes) if (value !== 0) total++;
  return total;
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

function fixed16FromLong(value: number): number {
  return signedLong(value) / 65536;
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
      pointer: level.romOffset,
      pfNonzero,
      minPlayablePf: Math.max(1_200, Math.floor(pfNonzero * 0.75)),
    };
  });
}

function descriptorForPointer(descriptors: readonly DescriptorSummary[], pointer: number): DescriptorSummary | undefined {
  return descriptors.find((descriptor) => descriptor.pointer === pointer);
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

function loadSeed(path: string, snapshotIndex: number): SeedJson {
  const raw = JSON.parse(readFileSync(resolve(path), "utf-8")) as ScenarioJson | SeedJson;
  if ("snapshots" in raw && Array.isArray(raw.snapshots)) {
    const seed = raw.snapshots[snapshotIndex];
    if (seed === undefined) throw new Error(`${path} has no snapshot index ${snapshotIndex}`);
    return seed;
  }
  if (snapshotIndex !== 0) throw new Error(`${path} is a seed JSON, so --snapshot-index must be 0`);
  return raw as SeedJson;
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

function sampleState(
  state: GameState,
  descriptors: readonly DescriptorSummary[],
  routeFrame: number,
  sourceFrame: number | undefined,
  step: string,
): Sample {
  const descriptorPointer = readLongBE(state.workRam, 0x474);
  const descriptor = descriptorForPointer(descriptors, descriptorPointer);
  const obj = 0x18;
  return {
    routeFrame,
    absoluteFrame: sourceFrame === undefined ? undefined : sourceFrame + routeFrame,
    step,
    main: readWordBE(state.workRam, 0x390),
    mode: readWordBE(state.workRam, 0x392),
    next: readWordBE(state.workRam, 0x394),
    segment: state.workRam[0x3e4] ?? 0,
    playerState: state.workRam[obj + 0x1a] ?? 0,
    obj18: state.workRam[obj + 0x18] ?? 0,
    obj19: state.workRam[obj + 0x19] ?? 0,
    obj20: state.workRam[obj + 0x20] ?? 0,
    obj24: state.workRam[obj + 0x24] ?? 0,
    obj26: state.workRam[obj + 0x26] ?? 0,
    obj36: state.workRam[obj + 0x36] ?? 0,
    timer: readWordBE(state.workRam, obj + 0x6a),
    pfCount: nonzero(state.playfieldRam),
    scrollY: state.videoScrollY,
    descriptorPointer,
    descriptorLevel: descriptor?.level,
    x: fixed16FromLong(readLongBE(state.workRam, obj + 0x0c)),
    y: fixed16FromLong(readLongBE(state.workRam, obj + 0x10)),
    z: fixed16FromLong(readLongBE(state.workRam, obj + 0x14)),
    field04: signedLong(readLongBE(state.workRam, obj + 0x04)),
    field08: signedLong(readLongBE(state.workRam, obj + 0x08)),
  };
}

function eventKinds(prev: Sample, sample: Sample): string[] {
  const kinds: string[] = [];
  if (sample.main !== prev.main || sample.mode !== prev.mode) kinds.push("main-mode-change");
  if (sample.next !== prev.next) kinds.push("next-change");
  if (sample.segment !== prev.segment) kinds.push("segment-change");
  if (sample.descriptorPointer !== prev.descriptorPointer) kinds.push("descriptor-change");
  if (sample.playerState !== prev.playerState) {
    const isDeath = sample.playerState === 4 || sample.playerState === 5;
    const wasDeath = prev.playerState === 4 || prev.playerState === 5;
    if (isDeath && !wasDeath) kinds.push("death-enter");
    else if (!isDeath && wasDeath) kinds.push("death-exit");
    else kinds.push("state-change");
  }
  if (sample.pfCount === 0 && prev.pfCount !== 0) kinds.push("playfield-empty");
  if (sample.scrollY > 512 && prev.scrollY <= 512) kinds.push("scroll-overflow");
  return kinds;
}

function runRoute(
  rom: RomImage,
  state: GameState,
  descriptors: readonly DescriptorSummary[],
  plan: readonly string[],
  sourceFrame: number | undefined,
): RouteTrace {
  let p1X = state.workRam[0x18 + 0xc9] ?? 0xff;
  let p1Y = state.workRam[0x18 + 0xc8] ?? 0xff;
  const events: TraceEvent[] = [];
  const initial = sampleState(state, descriptors, 0, sourceFrame, "N");
  let previous = initial;
  let deathEvents = 0;
  let recoveries = 0;
  let inDeath = initial.playerState === 4 || initial.playerState === 5;
  let firstDeathFrame: number | undefined = inDeath ? 0 : undefined;
  let firstRecoveryFrame: number | undefined;
  let firstState1Frame: number | undefined = initial.playerState === 1 ? 0 : undefined;
  let firstState2Frame: number | undefined = initial.playerState === 2 ? 0 : undefined;
  let firstState6Frame: number | undefined = initial.playerState === 6 ? 0 : undefined;
  let firstEmptyPfFrame: number | undefined = initial.pfCount === 0 ? 0 : undefined;
  let firstScrollOverflowFrame: number | undefined = initial.scrollY > 512 ? 0 : undefined;
  let emptyRun = initial.pfCount === 0 ? 1 : 0;
  let maxEmptyRun = emptyRun;
  let state1Run = initial.playerState === 1 ? 1 : 0;
  let maxState1Run = state1Run;
  let state2Run = initial.playerState === 2 ? 1 : 0;
  let maxState2Run = state2Run;
  let state6Run = initial.playerState === 6 ? 1 : 0;
  let maxState6Run = state6Run;

  events.push({ kind: "initial", sample: initial });
  for (let i = 0; i < plan.length; i++) {
    const step = plan[i]!;
    [p1X, p1Y] = advanceTrackball(p1X, p1Y, step);
    tick(state, {
      rom,
      runMainLoopBody: true,
      p1X,
      p1Y,
      p2X: 0xff,
      p2Y: 0xff,
      inputMmio: 0x6f,
    });

    const sample = sampleState(state, descriptors, i + 1, sourceFrame, step);
    const kinds = eventKinds(previous, sample);
    for (const kind of kinds) events.push({ kind, sample, previous });

    const isDeath = sample.playerState === 4 || sample.playerState === 5;
    if (isDeath && !inDeath) {
      deathEvents++;
      inDeath = true;
      firstDeathFrame ??= sample.routeFrame;
    } else if (!isDeath && inDeath) {
      recoveries++;
      inDeath = false;
      firstRecoveryFrame ??= sample.routeFrame;
    }

    if (sample.playerState === 1) {
      state1Run++;
      firstState1Frame ??= sample.routeFrame;
    } else {
      maxState1Run = Math.max(maxState1Run, state1Run);
      state1Run = 0;
    }
    if (sample.playerState === 2) {
      state2Run++;
      firstState2Frame ??= sample.routeFrame;
    } else {
      maxState2Run = Math.max(maxState2Run, state2Run);
      state2Run = 0;
    }
    if (sample.playerState === 6) {
      state6Run++;
      firstState6Frame ??= sample.routeFrame;
    } else {
      maxState6Run = Math.max(maxState6Run, state6Run);
      state6Run = 0;
    }
    if (sample.pfCount === 0) {
      emptyRun++;
      firstEmptyPfFrame ??= sample.routeFrame;
    } else {
      maxEmptyRun = Math.max(maxEmptyRun, emptyRun);
      emptyRun = 0;
    }
    if (sample.scrollY > 512) firstScrollOverflowFrame ??= sample.routeFrame;
    previous = sample;
  }

  maxEmptyRun = Math.max(maxEmptyRun, emptyRun);
  maxState1Run = Math.max(maxState1Run, state1Run);
  maxState2Run = Math.max(maxState2Run, state2Run);
  maxState6Run = Math.max(maxState6Run, state6Run);
  const final = previous;
  events.push({ kind: "final", sample: final });
  return {
    initial,
    final,
    events,
    firstDeathFrame,
    firstRecoveryFrame,
    firstState1Frame,
    firstState2Frame,
    firstState6Frame,
    firstEmptyPfFrame,
    firstScrollOverflowFrame,
    deathEvents,
    recoveries,
    maxEmptyRun,
    maxState1Run,
    maxState2Run,
    maxState6Run,
  };
}

function traceSeed(
  rom: RomImage,
  descriptors: readonly DescriptorSummary[],
  path: string,
  seed: SeedJson,
  plan: readonly string[],
  dispatcher: "manual" | "preserved",
): TraceSummary {
  const manualDispatcher = dispatcher === "manual";
  const neutralPlan = Array.from({ length: plan.length }, () => "N");
  const active = runRoute(
    rom,
    loadStateFromSeed(rom, seed, manualDispatcher),
    descriptors,
    plan,
    seed.frame,
  );
  const neutral = runRoute(
    rom,
    loadStateFromSeed(rom, seed, manualDispatcher),
    descriptors,
    neutralPlan,
    seed.frame,
  );
  const diffX = Math.abs(Math.round(active.final.x * 65536) - Math.round(neutral.final.x * 65536));
  const diffY = Math.abs(Math.round(active.final.y * 65536) - Math.round(neutral.final.y * 65536));
  const descriptor = descriptorForPointer(descriptors, active.initial.descriptorPointer);
  const minStablePf = descriptor?.minPlayablePf ?? FALLBACK_MIN_PLAYABLE_PF;
  const responsive = diffX > 1_000_000 || diffY > 1_000_000;
  const stable =
    active.final.pfCount >= minStablePf &&
    active.final.playerState === 0 &&
    active.deathEvents === 0 &&
    neutral.deathEvents === 0 &&
    active.maxEmptyRun <= 16 &&
    active.maxState1Run === 0 &&
    active.maxState2Run <= 60 &&
    active.maxState6Run <= 180 &&
    active.firstScrollOverflowFrame === undefined;
  return {
    dispatcher,
    path,
    sourceFrame: seed.frame,
    routeFrames: plan.length,
    minStablePf,
    active,
    neutral,
    diffX,
    diffY,
    responsive,
    stable,
  };
}

function fmt(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function sampleText(sample: Sample): string {
  const abs = sample.absoluteFrame === undefined ? "?" : sample.absoluteFrame;
  return (
    `f+${sample.routeFrame}/abs=${abs} step=${sample.step} ` +
    `main=${sample.main}/${sample.mode} next=${sample.next} seg=${sample.segment} ` +
    `desc=L${sample.descriptorLevel ?? "?"}@0x${sample.descriptorPointer.toString(16)} ` +
    `state=${sample.playerState} obj18=${sample.obj18} obj20=${sample.obj20} ` +
    `timer=${sample.timer} pf=${sample.pfCount} scroll=${sample.scrollY} ` +
    `xy=${fmt(sample.x)},${fmt(sample.y)} z=${fmt(sample.z)} ` +
    `f04=${sample.field04} f08=${sample.field08}`
  );
}

function printTraceSummary(summary: TraceSummary, maxEvents: number): void {
  console.log(`\n${summary.path} dispatcher=${summary.dispatcher} sourceFrame=${summary.sourceFrame ?? "?"}`);
  console.log(
    `  routeFrames=${summary.routeFrames} responsive=${summary.responsive ? "yes" : "no "} ` +
      `stable=${summary.stable ? "yes" : "no "} diffXY=${summary.diffX}/${summary.diffY} minPf=${summary.minStablePf}`,
  );
  for (const [label, trace] of [
    ["active ", summary.active],
    ["neutral", summary.neutral],
  ] as const) {
    console.log(
      `  ${label}: deaths=${trace.deathEvents} recoveries=${trace.recoveries} ` +
        `firstDeath=${trace.firstDeathFrame ?? "-"} firstRecovery=${trace.firstRecoveryFrame ?? "-"} ` +
        `stateRuns s1=${trace.maxState1Run} s2=${trace.maxState2Run} s6=${trace.maxState6Run} ` +
        `emptyRun=${trace.maxEmptyRun} scrollOverflow=${trace.firstScrollOverflowFrame ?? "-"} ` +
        `final ${sampleText(trace.final)}`,
    );
    const visible = trace.events.slice(0, maxEvents);
    for (const event of visible) console.log(`    ${event.kind.padEnd(17)} ${sampleText(event.sample)}`);
    if (trace.events.length > visible.length) console.log(`    ... ${trace.events.length - visible.length} more event(s)`);
  }
}

function main(): void {
  try {
    const args = parseArgs();
    const plan = expandRouteSpec(args.plan);
    const rom = busNs.emptyRomImage();
    applySlapsticBank.loadRomBlob(rom, readFileSync(resolve("ghidra_project/marble_program.bin")));
    const descriptors = descriptorSummaries(rom);
    const dispatchers =
      args.dispatcher === "both" ? (["preserved", "manual"] as const) : ([args.dispatcher] as const);
    const summaries = args.paths.flatMap((path) => {
      const seed = loadSeed(path, args.snapshotIndex);
      return dispatchers.map((dispatcher) => traceSeed(rom, descriptors, path, seed, plan, dispatcher));
    });

    if (args.json) {
      console.log(JSON.stringify({ plan: args.plan, summaries }, null, 2));
    } else {
      console.log(`Plan ${args.plan} (${plan.length} frames), snapshotIndex=${args.snapshotIndex}`);
      for (const summary of summaries) printTraceSummary(summary, args.maxEvents);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    exit(1);
  }
}

main();
