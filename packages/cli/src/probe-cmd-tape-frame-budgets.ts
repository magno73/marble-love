/**
 * probe-cmd-tape-frame-budgets.ts — compare cmd-tape-derived frame budgets
 * against MAME event frame origins.
 */
import { readFileSync, writeFileSync } from "node:fs";
import {
  cmdTapeFrameOriginAbsoluteCycle,
  loadCmdTape,
  type CmdTape,
  type CmdTapeCommandTiming,
} from "../../engine/src/m6502/sound-chip.js";
import { SOUND_CYCLES_PER_FRAME } from "../../engine/src/m6502/sound-clock.js";

type JsonObject = Record<string, unknown>;

interface Args {
  readonly cmdTape: string;
  readonly mameYm: string | undefined;
  readonly mamePokey: string | undefined;
  readonly frames: readonly number[];
  readonly report: string | undefined;
}

interface TimedEvent {
  readonly sourceIndex: number;
  readonly frame: number;
  readonly cycleInFrame: number;
  readonly origin: bigint;
}

interface FrameOriginSummary {
  readonly frame: number;
  readonly count: number;
  readonly minOrigin: string;
  readonly maxOrigin: string;
  readonly rangeCycles: number;
  readonly residualFromFixed: number;
}

function readArg(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index < 0 ? undefined : args[index + 1];
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  const cmdTape = readArg(args, "--cmd-tape");
  if (cmdTape === undefined) {
    throw new Error("usage: probe-cmd-tape-frame-budgets --cmd-tape PATH [--mame-ym PATH] [--mame-pokey PATH] [--frames 244,500,1500] [--report PATH]");
  }
  const frames = (readArg(args, "--frames") ?? "244,500,1500")
    .split(",")
    .map((raw) => Number(raw.trim()))
    .filter((frame) => Number.isFinite(frame))
    .map((frame) => Math.trunc(frame));
  return {
    cmdTape,
    mameYm: readArg(args, "--mame-ym"),
    mamePokey: readArg(args, "--mame-pokey"),
    frames,
    report: readArg(args, "--report"),
  };
}

function parseNumberLike(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value !== "string") return undefined;
  const parsed = Number.parseInt(value, value.startsWith("0x") ? 16 : 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function loadJson(path: string): JsonObject {
  return JSON.parse(readFileSync(path, "utf8")) as JsonObject;
}

function rawEvents(parsed: JsonObject, field: "cmds" | "writes"): readonly JsonObject[] {
  const direct = parsed[field];
  if (Array.isArray(direct)) return direct as JsonObject[];
  if (field !== "writes" && Array.isArray(parsed.writes)) return parsed.writes as JsonObject[];
  if (field !== "cmds" && Array.isArray(parsed.cmds)) return parsed.cmds as JsonObject[];
  return [];
}

function eventOrigin(event: JsonObject, sourceIndex: number): TimedEvent | undefined {
  const frame = parseNumberLike(event.frame);
  const cycleInFrame = parseNumberLike(event.cycleInFrame);
  const secs = parseNumberLike(event.secs);
  const attos = typeof event.attos === "string" ? event.attos : undefined;
  if (frame === undefined || cycleInFrame === undefined || secs === undefined || attos === undefined) {
    return undefined;
  }
  const origin = cmdTapeFrameOriginAbsoluteCycle({ secs, attos, cycleInFrame });
  if (origin === undefined) return undefined;
  return {
    sourceIndex,
    frame: Math.trunc(frame),
    cycleInFrame: Math.trunc(cycleInFrame),
    origin,
  };
}

function collectTimedEvents(events: readonly JsonObject[]): TimedEvent[] {
  const timed: TimedEvent[] = [];
  for (let i = 0; i < events.length; i++) {
    const event = eventOrigin(events[i]!, i);
    if (event !== undefined) timed.push(event);
  }
  return timed;
}

function increment(histogram: Map<number, number>, value: number): void {
  histogram.set(value, (histogram.get(value) ?? 0) + 1);
}

function histogramJson(histogram: Map<number, number>, limit = 16): Array<{ value: number; count: number }> {
  return [...histogram.entries()]
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])
    .slice(0, limit)
    .map(([value, count]) => ({ value, count }));
}

function frameSummaries(events: readonly TimedEvent[]): Map<number, FrameOriginSummary> {
  const byFrame = new Map<number, bigint[]>();
  for (const event of events) {
    const bucket = byFrame.get(event.frame);
    if (bucket === undefined) byFrame.set(event.frame, [event.origin]);
    else bucket.push(event.origin);
  }
  const frames = [...byFrame.keys()].sort((a, b) => a - b);
  const firstFrame = frames[0];
  const firstOrigins = firstFrame === undefined ? undefined : byFrame.get(firstFrame);
  const firstOrigin = firstOrigins?.slice().sort((a, b) => a < b ? -1 : a > b ? 1 : 0)[0];
  const summaries = new Map<number, FrameOriginSummary>();
  for (const frame of frames) {
    const origins = byFrame.get(frame)!.slice().sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
    const min = origins[0]!;
    const max = origins[origins.length - 1]!;
    const residual = firstOrigin === undefined || firstFrame === undefined
      ? 0
      : Number(min - (firstOrigin + BigInt(frame - firstFrame) * BigInt(SOUND_CYCLES_PER_FRAME)));
    summaries.set(frame, {
      frame,
      count: origins.length,
      minOrigin: min.toString(),
      maxOrigin: max.toString(),
      rangeCycles: Number(max - min),
      residualFromFixed: residual,
    });
  }
  return summaries;
}

function summarizeSource(label: string, events: readonly TimedEvent[], framesOfInterest: readonly number[]): JsonObject {
  const summaries = frameSummaries(events);
  const frames = [...summaries.keys()].sort((a, b) => a - b);
  const rangeHistogram = new Map<number, number>();
  const residualHistogram = new Map<number, number>();
  const budgetHistogram = new Map<number, number>();
  let maxRange: FrameOriginSummary | undefined;
  for (const frame of frames) {
    const summary = summaries.get(frame)!;
    increment(rangeHistogram, summary.rangeCycles);
    increment(residualHistogram, summary.residualFromFixed);
    if (maxRange === undefined || summary.rangeCycles > maxRange.rangeCycles) maxRange = summary;
  }
  for (let i = 0; i + 1 < frames.length; i++) {
    const frame = frames[i]!;
    const nextFrame = frames[i + 1]!;
    if (nextFrame !== frame + 1) continue;
    const current = BigInt(summaries.get(frame)!.minOrigin);
    const next = BigInt(summaries.get(nextFrame)!.minOrigin);
    increment(budgetHistogram, Number(next - current));
  }
  const samples = framesOfInterest
    .map((frame) => summaries.get(frame))
    .filter((summary): summary is FrameOriginSummary => summary !== undefined);
  return {
    label,
    eventCount: events.length,
    frameCount: frames.length,
    firstFrame: frames[0],
    lastFrame: frames[frames.length - 1],
    firstOrigin: frames[0] === undefined ? undefined : summaries.get(frames[0]!)?.minOrigin,
    rangeHistogram: histogramJson(rangeHistogram),
    residualHistogram: histogramJson(residualHistogram),
    consecutiveBudgetHistogram: histogramJson(budgetHistogram),
    maxRange,
    samples,
  };
}

function summarizeLoadedBudgets(tapeJson: CmdTape, timing: CmdTapeCommandTiming, framesOfInterest: readonly number[]): JsonObject {
  const tape = loadCmdTape(tapeJson, { commandTiming: timing });
  const entries = [...tape.frameCycleBudgets.entries()].sort((a, b) => a[0] - b[0]);
  const budgetHistogram = new Map<number, number>();
  const cumulativeResidualHistogram = new Map<number, number>();
  let cumulative = 0;
  let previousFrame: number | undefined;
  const cumulativeByFrame = new Map<number, number>();
  for (const [frame, budget] of entries) {
    increment(budgetHistogram, budget);
    if (previousFrame !== undefined) {
      const skipped = frame - previousFrame - 1;
      if (skipped > 0) cumulative += skipped * SOUND_CYCLES_PER_FRAME;
    }
    cumulativeByFrame.set(frame, cumulative);
    increment(cumulativeResidualHistogram, cumulative - ((frame - entries[0]![0]) * SOUND_CYCLES_PER_FRAME));
    cumulative += budget;
    previousFrame = frame;
  }
  const sampleFrames = framesOfInterest.map((frame) => ({
    frame,
    budget: tape.frameCycleBudgets.get(frame),
    cumulativeResidual: cumulativeByFrame.has(frame)
      ? cumulativeByFrame.get(frame)! - ((frame - entries[0]![0]) * SOUND_CYCLES_PER_FRAME)
      : undefined,
  }));
  return {
    timing,
    budgetCount: entries.length,
    firstFrame: entries[0]?.[0],
    lastFrame: entries[entries.length - 1]?.[0],
    budgetHistogram: histogramJson(budgetHistogram),
    cumulativeResidualHistogram: histogramJson(cumulativeResidualHistogram),
    samples: sampleFrames,
  };
}

function summarizeSourceDelta(
  label: string,
  left: Map<number, FrameOriginSummary>,
  right: Map<number, FrameOriginSummary>,
  framesOfInterest: readonly number[],
): JsonObject {
  const histogram = new Map<number, number>();
  const samples: Array<{ frame: number; delta: number; left: FrameOriginSummary; right: FrameOriginSummary }> = [];
  let commonFrames = 0;
  for (const [frame, leftSummary] of left.entries()) {
    const rightSummary = right.get(frame);
    if (rightSummary === undefined) continue;
    commonFrames++;
    const delta = Number(BigInt(leftSummary.minOrigin) - BigInt(rightSummary.minOrigin));
    increment(histogram, delta);
    if (framesOfInterest.includes(frame) || (samples.length < 12 && delta !== 0)) {
      samples.push({ frame, delta, left: leftSummary, right: rightSummary });
    }
  }
  return {
    label,
    commonFrames,
    deltaHistogram: histogramJson(histogram),
    samples,
  };
}

function topArray(value: unknown, limit: number): unknown {
  return Array.isArray(value) ? value.slice(0, limit) : value;
}

function main(): void {
  const args = parseArgs();
  const tapeJson = loadJson(args.cmdTape) as unknown as CmdTape;
  const tapeEvents = collectTimedEvents(rawEvents(tapeJson as unknown as JsonObject, "cmds"));
  const sources: Array<{ label: string; events: TimedEvent[]; summaries: Map<number, FrameOriginSummary> }> = [
    { label: "cmdTape", events: tapeEvents, summaries: frameSummaries(tapeEvents) },
  ];
  if (args.mameYm !== undefined) {
    const events = collectTimedEvents(rawEvents(loadJson(args.mameYm), "writes"));
    sources.push({ label: "mameYm", events, summaries: frameSummaries(events) });
  }
  if (args.mamePokey !== undefined) {
    const events = collectTimedEvents(rawEvents(loadJson(args.mamePokey), "writes"));
    sources.push({ label: "mamePokey", events, summaries: frameSummaries(events) });
  }
  const report = {
    probe: {
      argv: process.argv.slice(2),
      cwd: process.cwd(),
      cmdTape: args.cmdTape,
      mameYm: args.mameYm,
      mamePokey: args.mamePokey,
      soundCyclesPerFrame: SOUND_CYCLES_PER_FRAME,
      frames: args.frames,
    },
    loadedBudgets: [
      summarizeLoadedBudgets(tapeJson, "cycleInFrame", args.frames),
      summarizeLoadedBudgets(tapeJson, "secsAttos", args.frames),
    ],
    sources: sources.map((source) => summarizeSource(source.label, source.events, args.frames)),
    sourceDeltas: sources.flatMap((left, i) =>
      sources.slice(i + 1).map((right) =>
        summarizeSourceDelta(`${left.label}-${right.label}`, left.summaries, right.summaries, args.frames))),
  };
  if (args.report !== undefined) {
    writeFileSync(args.report, `${JSON.stringify(report, undefined, 2)}\n`);
  }
  console.log(`Frame budget probe: tape=${args.cmdTape}`);
  for (const budget of report.loadedBudgets) {
    console.log(
      `loaded ${budget.timing}: frames=${budget.budgetCount} ` +
      `budgets=${JSON.stringify(topArray(budget.budgetHistogram, 6))} ` +
      `samples=${JSON.stringify(budget.samples)}`,
    );
  }
  for (const source of report.sources) {
    console.log(
      `source ${source.label}: events=${source.eventCount} frames=${source.frameCount} ` +
      `originRange=${JSON.stringify(topArray(source.rangeHistogram, 4))} ` +
      `residual=${JSON.stringify(topArray(source.residualHistogram, 8))} ` +
      `budgets=${JSON.stringify(topArray(source.consecutiveBudgetHistogram, 8))}`,
    );
  }
  for (const delta of report.sourceDeltas) {
    console.log(
      `delta ${delta.label}: commonFrames=${delta.commonFrames} ` +
      `hist=${JSON.stringify(topArray(delta.deltaHistogram, 8))}`,
    );
  }
}

main();
