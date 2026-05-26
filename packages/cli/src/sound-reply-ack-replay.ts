import { readFileSync } from "node:fs";
import {
  cmdTapeAbsoluteCycle,
  cmdTapeFrameOriginAbsoluteCycle,
  type MainReplyWriteEvent,
} from "../../engine/src/m6502/sound-chip.js";

export interface MainReplyAckReplayStats {
  readonly source: string;
  readonly mode: MainReplyAckReplayMode;
  readonly ackCount: number;
  scheduledWriteCount: number;
  exhaustedWriteCount: number;
  skippedAckCount: number;
  reusedAckCount: number;
  firstSkippedAck: {
    readonly cycle: number;
    readonly writeCycle: number;
  } | undefined;
  firstReusedAck: {
    readonly writeCycle: number;
    readonly ackCycle: number;
  } | undefined;
  firstScheduledAck: {
    readonly writeCycle: number;
    readonly ackCycle: number;
    readonly delayCycles: number;
  } | undefined;
}

export interface MainReplyAckReplay {
  readonly stats: MainReplyAckReplayStats;
  readonly schedule: (event: MainReplyWriteEvent) => number | undefined;
}

export type MainReplyAckReplayMode = "absolute" | "sequential";

export interface MainReplyAckReplayForTapeOptions {
  readonly useEmbedded?: boolean;
  readonly mode?: MainReplyAckReplayMode;
}

function parseHexOrNumber(value: unknown): number | undefined {
  if (typeof value === "number") return value;
  if (typeof value !== "string") return undefined;
  return Number.parseInt(value, value.startsWith("0x") ? 16 : 10);
}

function rawMainReplyReads(parsed: unknown): Array<Record<string, unknown>> {
  if (typeof parsed !== "object" || parsed === null) return [];
  const obj = parsed as {
    mainReplyReads?: Array<Record<string, unknown>>;
    replyAcks?: Array<Record<string, unknown>>;
    events?: Array<Record<string, unknown>>;
  };
  if (Array.isArray(obj.mainReplyReads)) return obj.mainReplyReads;
  if (Array.isArray(obj.replyAcks)) return obj.replyAcks;
  if (Array.isArray(obj.events)) return obj.events.filter((event) => event.kind === "mainReplyRead");
  return [];
}

function rawCmds(parsed: unknown): Array<{ secs?: number; attos?: string; cycleInFrame?: number }> {
  if (typeof parsed !== "object" || parsed === null) return [];
  const cmds = (parsed as { cmds?: Array<{ secs?: number; attos?: string; cycleInFrame?: number }> }).cmds;
  return Array.isArray(cmds) ? cmds : [];
}

function readOriginCycle(parsed: unknown, cmdTapePath: string): bigint | undefined {
  for (const cmd of rawCmds(parsed)) {
    const frameOrigin = cmdTapeFrameOriginAbsoluteCycle(cmd);
    if (frameOrigin !== undefined) return frameOrigin;
    const cycle = cmdTapeAbsoluteCycle(cmd);
    if (cycle !== undefined) return cycle;
  }
  const tape = JSON.parse(readFileSync(cmdTapePath, "utf8")) as unknown;
  for (const cmd of rawCmds(tape)) {
    const frameOrigin = cmdTapeFrameOriginAbsoluteCycle(cmd);
    if (frameOrigin !== undefined) return frameOrigin;
    const cycle = cmdTapeAbsoluteCycle(cmd);
    if (cycle !== undefined) return cycle;
  }
  return undefined;
}

function eventCycle(raw: Record<string, unknown>, originCycle: bigint | undefined): number | undefined {
  const relative = parseHexOrNumber(raw.relativeCycle ?? raw.cycle);
  if (relative !== undefined) return relative;
  const secs = parseHexOrNumber(raw.secs);
  const attos = typeof raw.attos === "string" ? raw.attos : undefined;
  if (secs === undefined || attos === undefined || originCycle === undefined) return undefined;
  const absolute = cmdTapeAbsoluteCycle({ secs, attos });
  if (absolute === undefined) return undefined;
  return Number(absolute - originCycle);
}

export function loadMainReplyAckCycles(path: string, cmdTapePath: string): number[] {
  const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
  const originCycle = readOriginCycle(parsed, cmdTapePath);
  const cycles: number[] = [];
  for (const raw of rawMainReplyReads(parsed)) {
    const cycle = eventCycle(raw, originCycle);
    if (cycle !== undefined && Number.isFinite(cycle) && cycle >= 0) {
      cycles.push(Math.trunc(cycle));
    }
  }
  cycles.sort((a, b) => a - b);
  return cycles;
}

function lowerBound(cycles: readonly number[], target: number): number {
  let lo = 0;
  let hi = cycles.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (cycles[mid]! < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export function createMainReplyAckReplay(
  source: string,
  cycles: readonly number[],
  mode: MainReplyAckReplayMode = "absolute",
): MainReplyAckReplay {
  const stats: MainReplyAckReplayStats = {
    source,
    mode,
    ackCount: cycles.length,
    scheduledWriteCount: 0,
    exhaustedWriteCount: 0,
    skippedAckCount: 0,
    reusedAckCount: 0,
    firstSkippedAck: undefined,
    firstReusedAck: undefined,
    firstScheduledAck: undefined,
  };
  let next = 0;
  let skippedBefore = 0;
  const scheduledAckIndexes = new Set<number>();
  let lastScheduledAckCycle: number | undefined;
  return {
    stats,
    schedule: (event: MainReplyWriteEvent): number | undefined => {
      while (skippedBefore < cycles.length && cycles[skippedBefore]! < event.cycle) {
        if (!scheduledAckIndexes.has(skippedBefore)) {
          stats.skippedAckCount++;
          stats.firstSkippedAck ??= { cycle: cycles[skippedBefore]!, writeCycle: event.cycle };
        }
        skippedBefore++;
      }
      if (mode === "sequential") {
        next = Math.max(next, skippedBefore);
      } else {
        next = lowerBound(cycles, event.cycle);
      }
      const ackCycle = cycles[next];
      if (ackCycle === undefined) {
        stats.exhaustedWriteCount++;
        return undefined;
      }
      const scheduledIndex = next;
      if (mode === "sequential") next++;
      stats.scheduledWriteCount++;
      const reusedScheduledIndex = scheduledAckIndexes.has(scheduledIndex);
      if (reusedScheduledIndex) {
        stats.reusedAckCount++;
        stats.firstReusedAck ??= { writeCycle: event.cycle, ackCycle };
      }
      scheduledAckIndexes.add(scheduledIndex);
      if (lastScheduledAckCycle !== undefined && ackCycle <= lastScheduledAckCycle) {
        if (!reusedScheduledIndex) stats.reusedAckCount++;
        stats.firstReusedAck ??= { writeCycle: event.cycle, ackCycle };
      }
      lastScheduledAckCycle = ackCycle;
      stats.firstScheduledAck ??= {
        writeCycle: event.cycle,
        ackCycle,
        delayCycles: ackCycle - event.cycle,
      };
      return ackCycle;
    },
  };
}

export function createMainReplyAckReplayForTape(
  cmdTapePath: string,
  explicitSource: string | undefined,
  options: MainReplyAckReplayForTapeOptions = {},
): MainReplyAckReplay | undefined {
  const source = explicitSource ?? (options.useEmbedded === false ? undefined : cmdTapePath);
  if (source === undefined) return undefined;
  const cycles = loadMainReplyAckCycles(source, cmdTapePath);
  if (cycles.length === 0 && explicitSource === undefined) return undefined;
  return createMainReplyAckReplay(source, cycles, options.mode ?? "absolute");
}

export function mainReplyAckReplayReport(
  replay: MainReplyAckReplay | undefined,
): Record<string, unknown> | undefined {
  if (replay === undefined) return undefined;
  return { ...replay.stats };
}
