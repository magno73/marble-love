import { readFileSync } from "node:fs";
import { cmdTapeAbsoluteCycle, type SoundChip } from "../../engine/src/m6502/sound-chip.js";
import { as_u8, type u16 } from "../../engine/src/wrap.js";

export const STATUS_BASE_MASK = 0xe7;
export const STATUS_DYNAMIC_MASK = 0x18;
export type SoundStatusReplayValueMode = "base" | "full";

export interface SoundStatusRead {
  readonly index: number;
  readonly frame: number | undefined;
  readonly cycleInFrame: number | undefined;
  readonly pc: number | undefined;
  readonly val: number;
  readonly base: number;
  readonly secs?: number;
  readonly attos?: string;
  readonly absoluteCycle?: number;
}

export interface SoundStatusBaseRun {
  readonly start: number;
  readonly count: number;
  readonly frame: number | undefined;
  readonly pc: number | undefined;
  readonly val: number;
  readonly base: number;
}

export interface SoundStatusReplayStats {
  readonly source: string;
  readonly mode: "readIndex" | "frame";
  readonly valueMode: SoundStatusReplayValueMode;
  readonly mameReadCount: number;
  readonly baseRunCount: number;
  tsReadCount: number;
  appliedReadCount: number;
  exhaustedReadCount: number;
  baseMismatchCount: number;
  valueMismatchCount: number;
  firstBaseMismatch: {
    readonly index: number;
    readonly tsBase: number;
    readonly mameBase: number;
    readonly tsVal: number;
    readonly forcedVal: number;
    readonly mame: SoundStatusRead;
  } | undefined;
  firstValueMismatch: {
    readonly index: number;
    readonly tsVal: number;
    readonly forcedVal: number;
    readonly mame: SoundStatusRead;
  } | undefined;
}

export interface SoundStatusReadTape {
  readonly readCount: number;
  readonly baseRunCount: number;
  readAt(index: number): SoundStatusRead | undefined;
  readAtFrame(frame: number, frameReadIndex: number): SoundStatusRead | undefined;
  baseRunAtFrame(frame: number): SoundStatusBaseRun | undefined;
}

export interface SoundStatusReplayOptions {
  readonly valueMode?: SoundStatusReplayValueMode;
}

function parseHexOrNumber(value: unknown): number | undefined {
  if (typeof value === "number") return value;
  if (typeof value !== "string") return undefined;
  return Number.parseInt(value, value.startsWith("0x") ? 16 : 10);
}

function rawStatusReads(parsed: unknown): Array<Record<string, unknown>> {
  if (typeof parsed !== "object" || parsed === null) return [];
  const obj = parsed as {
    statusReads?: Array<Record<string, unknown>>;
    reads?: Array<Record<string, unknown>>;
    events?: Array<Record<string, unknown>>;
  };
  if (Array.isArray(obj.statusReads)) return obj.statusReads;
  if (Array.isArray(obj.reads)) return obj.reads;
  if (Array.isArray(obj.events)) return obj.events.filter((event) => event.kind === "statusRead");
  return [];
}

function rawStatusBaseRuns(parsed: unknown): Array<Record<string, unknown>> {
  if (typeof parsed !== "object" || parsed === null) return [];
  const obj = parsed as { statusBaseRuns?: Array<Record<string, unknown>> };
  return Array.isArray(obj.statusBaseRuns) ? obj.statusBaseRuns : [];
}

function parseAttos(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(Math.trunc(value));
  return undefined;
}

function absoluteSoundCycle(secs: number | undefined, attos: string | undefined): number | undefined {
  if (secs === undefined || attos === undefined) return undefined;
  const cycle = cmdTapeAbsoluteCycle({ secs, attos });
  if (cycle === undefined) return undefined;
  const asNumber = Number(cycle);
  return Number.isSafeInteger(asNumber) ? asNumber : undefined;
}

export function loadSoundStatusReads(path: string): SoundStatusReadTape {
  const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
  const rawReads = rawStatusReads(parsed);
  if (rawReads.length > 0) {
    const reads = rawReads.map((raw, index) => {
      const val = parseHexOrNumber(raw.val ?? raw.value ?? raw.data) ?? 0xff;
      const secs = parseHexOrNumber(raw.secs);
      const attos = parseAttos(raw.attos);
      const absoluteCycle = absoluteSoundCycle(secs, attos);
      return {
        index,
        frame: parseHexOrNumber(raw.frame),
        cycleInFrame: parseHexOrNumber(raw.cycleInFrame),
        pc: parseHexOrNumber(raw.pc),
        val: val & 0xff,
        base: val & STATUS_BASE_MASK,
        ...(secs === undefined ? {} : { secs }),
        ...(attos === undefined ? {} : { attos }),
        ...(absoluteCycle === undefined ? {} : { absoluteCycle }),
      };
    });
    const readsByFrame = new Map<number, SoundStatusRead[]>();
    for (const read of reads) {
      if (read.frame === undefined) continue;
      let bucket = readsByFrame.get(read.frame);
      if (bucket === undefined) {
        bucket = [];
        readsByFrame.set(read.frame, bucket);
      }
      bucket.push(read);
    }
    return {
      readCount: reads.length,
      baseRunCount: 0,
      readAt: (index: number) => reads[index],
      readAtFrame: (frame: number, frameReadIndex: number) => readsByFrame.get(frame)?.[frameReadIndex],
      baseRunAtFrame: () => undefined,
    };
  }

  const runs: SoundStatusBaseRun[] = rawStatusBaseRuns(parsed).map((raw) => {
    const val = parseHexOrNumber(raw.val ?? raw.value ?? raw.data) ?? 0xff;
    return {
      start: parseHexOrNumber(raw.start) ?? 0,
      count: parseHexOrNumber(raw.count) ?? 0,
      frame: parseHexOrNumber(raw.firstFrame ?? raw.frame),
      pc: parseHexOrNumber(raw.firstPc ?? raw.pc),
      val: val & 0xff,
      base: (parseHexOrNumber(raw.base) ?? val) & STATUS_BASE_MASK,
    };
  });
  const explicitCount = typeof parsed === "object" && parsed !== null
    ? parseHexOrNumber((parsed as { statusReadCount?: unknown }).statusReadCount)
    : undefined;
  const readCount = explicitCount ?? runs.reduce((max, run) => Math.max(max, run.start + run.count), 0);
  const sortedRuns = runs.slice().sort((a, b) => (a.frame ?? Number.MAX_SAFE_INTEGER) - (b.frame ?? Number.MAX_SAFE_INTEGER));
  return {
    readCount,
    baseRunCount: runs.length,
    readAt: (index: number): SoundStatusRead | undefined => {
      let lo = 0;
      let hi = runs.length - 1;
      while (lo <= hi) {
        const mid = Math.floor((lo + hi) / 2);
        const run = runs[mid]!;
        if (index < run.start) {
          hi = mid - 1;
        } else if (index >= run.start + run.count) {
          lo = mid + 1;
        } else {
          return {
            index,
            frame: run.frame,
            cycleInFrame: undefined,
            pc: run.pc,
            val: run.val,
            base: run.base,
          };
        }
      }
      return undefined;
    },
    readAtFrame: () => undefined,
    baseRunAtFrame: (frame: number): SoundStatusBaseRun | undefined => {
      let selected: SoundStatusBaseRun | undefined;
      for (const run of sortedRuns) {
        if (run.frame === undefined || run.frame > frame) break;
        selected = run;
      }
      return selected;
    },
  };
}

function replayValueMode(options: SoundStatusReplayOptions | undefined): SoundStatusReplayValueMode {
  return options?.valueMode ?? "base";
}

function forcedStatusValue(tsVal: number, mame: Pick<SoundStatusRead, "val" | "base">, mode: SoundStatusReplayValueMode): number {
  return mode === "full"
    ? mame.val & 0xff
    : ((tsVal & STATUS_DYNAMIC_MASK) | mame.base) & 0xff;
}

function updateMismatchStats(
  stats: SoundStatusReplayStats,
  tsVal: number,
  forcedVal: number,
  mame: SoundStatusRead,
): void {
  const tsBase = tsVal & STATUS_BASE_MASK;
  if (tsBase !== mame.base) {
    stats.baseMismatchCount++;
    stats.firstBaseMismatch ??= {
      index: stats.tsReadCount - 1,
      tsBase,
      mameBase: mame.base,
      tsVal,
      forcedVal,
      mame,
    };
  }
  if ((tsVal & 0xff) !== forcedVal) {
    stats.valueMismatchCount++;
    stats.firstValueMismatch ??= {
      index: stats.tsReadCount - 1,
      tsVal,
      forcedVal,
      mame,
    };
  }
}

export function installSoundStatusReplay(
  chip: SoundChip,
  source: string,
  reads: SoundStatusReadTape,
  options?: SoundStatusReplayOptions,
): SoundStatusReplayStats {
  const valueMode = replayValueMode(options);
  const stats: SoundStatusReplayStats = {
    source,
    mode: "readIndex",
    valueMode,
    mameReadCount: reads.readCount,
    baseRunCount: reads.baseRunCount,
    tsReadCount: 0,
    appliedReadCount: 0,
    exhaustedReadCount: 0,
    baseMismatchCount: 0,
    valueMismatchCount: 0,
    firstBaseMismatch: undefined,
    firstValueMismatch: undefined,
  };
  const originalRead8 = chip.mmu.read8;
  chip.mmu.read8 = (addr: u16) => {
    const value = originalRead8(addr);
    if ((addr as number) !== 0x1820) return value;

    const tsVal = value as number;
    const mame = reads.readAt(stats.tsReadCount);
    stats.tsReadCount++;
    if (mame === undefined) {
      stats.exhaustedReadCount++;
      return value;
    }

    stats.appliedReadCount++;
    const forcedVal = forcedStatusValue(tsVal, mame, valueMode);
    updateMismatchStats(stats, tsVal, forcedVal, mame);
    return as_u8(forcedVal);
  };
  return stats;
}

export function installSoundStatusFrameReplay(
  chip: SoundChip,
  source: string,
  reads: SoundStatusReadTape,
  currentFrame: () => number | undefined,
  options?: SoundStatusReplayOptions,
): SoundStatusReplayStats {
  const valueMode = replayValueMode(options);
  const stats: SoundStatusReplayStats = {
    source,
    mode: "frame",
    valueMode,
    mameReadCount: reads.readCount,
    baseRunCount: reads.baseRunCount,
    tsReadCount: 0,
    appliedReadCount: 0,
    exhaustedReadCount: 0,
    baseMismatchCount: 0,
    valueMismatchCount: 0,
    firstBaseMismatch: undefined,
    firstValueMismatch: undefined,
  };
  const originalRead8 = chip.mmu.read8;
  const frameReadCounts = new Map<number, number>();
  chip.mmu.read8 = (addr: u16) => {
    const value = originalRead8(addr);
    if ((addr as number) !== 0x1820) return value;

    const tsVal = value as number;
    const frame = currentFrame();
    stats.tsReadCount++;
    const frameReadIndex = frame === undefined ? 0 : (frameReadCounts.get(frame) ?? 0);
    if (frame !== undefined) frameReadCounts.set(frame, frameReadIndex + 1);
    const frameRead = frame === undefined ? undefined : reads.readAtFrame(frame, frameReadIndex);
    const run = frameRead === undefined && frame !== undefined ? reads.baseRunAtFrame(frame) : undefined;
    const mame = frameRead ?? (run === undefined
      ? undefined
      : {
        index: stats.tsReadCount - 1,
        frame,
        cycleInFrame: undefined,
        pc: run.pc,
        val: run.val,
        base: run.base,
      });
    if (mame === undefined) {
      stats.exhaustedReadCount++;
      return value;
    }

    stats.appliedReadCount++;
    const forcedVal = forcedStatusValue(tsVal, mame, valueMode);
    updateMismatchStats(stats, tsVal, forcedVal, mame);
    return as_u8(forcedVal);
  };
  return stats;
}

export function statusReplayReport(stats: SoundStatusReplayStats | undefined): Record<string, unknown> | undefined {
  if (stats === undefined) return undefined;
  return {
    source: stats.source,
    mode: stats.mode,
    valueMode: stats.valueMode,
    mameReadCount: stats.mameReadCount,
    baseRunCount: stats.baseRunCount,
    tsReadCount: stats.tsReadCount,
    appliedReadCount: stats.appliedReadCount,
    exhaustedReadCount: stats.exhaustedReadCount,
    baseMismatchCount: stats.baseMismatchCount,
    valueMismatchCount: stats.valueMismatchCount,
    firstBaseMismatch: stats.firstBaseMismatch,
    firstValueMismatch: stats.firstValueMismatch,
  };
}
