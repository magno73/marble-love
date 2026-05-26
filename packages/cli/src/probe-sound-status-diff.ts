// probe-sound-status-diff.ts — ordered $1820 read diff, TS SoundChip vs MAME.
//
// This is a diagnostics-only drill for strict timing/input-port parity. It does
// not change the normal replay path; it only wraps the TS MMU while replaying a
// cmd tape and compares the ordered $1820 reads against a MAME status log.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import {
  cmdTapeAbsoluteCycle,
  createSoundChip,
  loadCmdTape,
  tickFrameWithTape,
  type CmdTape,
} from "../../engine/src/m6502/sound-chip.js";
import { as_u8, type u16 } from "../../engine/src/wrap.js";
import {
  STATUS_BASE_MASK,
  installSoundStatusReplay,
  loadSoundStatusReads,
  statusReplayReport,
  type SoundStatusRead,
  type SoundStatusReplayStats,
} from "./sound-status-replay.js";
import {
  createMainReplyAckReplayForTape,
  mainReplyAckReplayReport,
  type MainReplyAckReplay,
} from "./sound-reply-ack-replay.js";

interface Args {
  frames: number;
  cmdTape: string;
  mameStatus: string | undefined;
  out: string | undefined;
  statusBase: number | undefined;
  applyStatusTape: boolean;
  maxMismatches: number;
  ignoreFrame: boolean;
  context: number;
  frameContext: number;
  cycleTolerance: number;
  replayCycleTolerance: number;
  resetReleaseDelayCycles: number;
  replyAckDelayCycles: number;
  replyAckTape: string | undefined;
  useEmbeddedReplyAckTape: boolean;
}

interface TsStatusRead extends SoundStatusRead {
  readonly cycle: number;
}

interface StatusMismatch {
  readonly index: number;
  readonly fields: string[];
  readonly ts: TsStatusRead | undefined;
  readonly mame: SoundStatusRead | undefined;
}

interface StatusDiffSummary {
  readonly compared: number;
  readonly tsCount: number;
  readonly mameCount: number;
  readonly mismatchCount: number;
  readonly firstMismatch: StatusMismatch | undefined;
  readonly firstCountMismatch: {
    readonly tsCount: number;
    readonly mameCount: number;
    readonly delta: number;
  } | undefined;
  readonly frameCountDiff: {
    readonly comparedFrames: number;
    readonly mismatchCount: number;
    readonly firstMismatch: FrameCountMismatch | undefined;
    readonly samples: FrameCountMismatch[];
  };
  readonly replayCycleDiff: ReplayCycleDiffSummary | undefined;
}

interface ReplayCycleDiffSummary {
  readonly compared: number;
  readonly mismatchCount: number;
  readonly min: number | undefined;
  readonly max: number | undefined;
  readonly maxAbs: number | undefined;
  readonly meanAbs: number | undefined;
  readonly firstMismatch: ReplayCycleMismatch | undefined;
}

interface ReplayCycleMismatch {
  readonly index: number;
  readonly delta: number;
  readonly tsCycle: number;
  readonly mameReplayCycle: number;
  readonly ts: TsStatusRead | undefined;
  readonly mame: SoundStatusRead | undefined;
}

interface FrameCountMismatch {
  readonly frame: number;
  readonly tsCount: number;
  readonly mameCount: number;
  readonly delta: number;
  readonly tsByPc: Record<string, number>;
  readonly mameByPc: Record<string, number>;
}

function readArg(args: string[], name: string): string | undefined {
  const idx = args.indexOf(name);
  return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : undefined;
}

function parseNumber(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  return Number.parseInt(value, value.startsWith("0x") ? 16 : 10);
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  const statusBaseArg = readArg(args, "--status-base");
  return {
    frames: Number(readArg(args, "--frames") ?? "500"),
    cmdTape: readArg(args, "--cmd-tape") ?? "oracle/scenarios/sound-cmd-tape-attract-cycle-precise.json",
    mameStatus: readArg(args, "--mame-status"),
    out: readArg(args, "--out"),
    statusBase: statusBaseArg === undefined ? undefined : parseNumber(statusBaseArg),
    applyStatusTape: args.includes("--apply-status-tape") && readArg(args, "--apply-status-tape") !== "0",
    maxMismatches: Number(readArg(args, "--max-mismatches") ?? "0"),
    ignoreFrame: args.includes("--ignore-frame") && readArg(args, "--ignore-frame") !== "0",
    context: Number(readArg(args, "--context") ?? "3"),
    frameContext: Number(readArg(args, "--frame-context") ?? "8"),
    cycleTolerance: Number(readArg(args, "--cycle-tolerance") ?? "Infinity"),
    replayCycleTolerance: Number(readArg(args, "--replay-cycle-tolerance") ?? "Infinity"),
    resetReleaseDelayCycles: Number(readArg(args, "--reset-release-delay") ?? "0"),
    replyAckDelayCycles: Number(readArg(args, "--reply-ack-delay") ?? "0"),
    replyAckTape: readArg(args, "--reply-ack-tape"),
    useEmbeddedReplyAckTape: !args.includes("--no-embedded-reply-ack"),
  };
}

function hex(value: number | undefined, width: number): string {
  return value === undefined ? "?" : `0x${value.toString(16).padStart(width, "0")}`;
}

function runTsStatusReads(args: Args, statusTapePath: string): {
  reads: TsStatusRead[];
  cyclePreciseTape: boolean;
  resetFrame: number | undefined;
  statusReplay: SoundStatusReplayStats | undefined;
  replyAckReplay: MainReplyAckReplay | undefined;
} {
  const rom421 = new Uint8Array(readFileSync("/tmp/sound-roms/136033.421"));
  const rom422 = new Uint8Array(readFileSync("/tmp/sound-roms/136033.422"));
  const tape = loadCmdTape(JSON.parse(readFileSync(args.cmdTape, "utf8")));
  const replyAckReplay = createMainReplyAckReplayForTape(args.cmdTape, args.replyAckTape, {
    useEmbedded: args.useEmbeddedReplyAckTape,
  });
  const chip = createSoundChip(args.statusBase === undefined
    ? {
      roms: { rom421, rom422 },
      mainReplyAckDelayCycles: args.replyAckDelayCycles,
      ...(replyAckReplay === undefined ? {} : { mainReplyAckCycle: replyAckReplay.schedule }),
    }
    : {
      roms: { rom421, rom422 },
      statusBase: as_u8(args.statusBase),
      mainReplyAckDelayCycles: args.replyAckDelayCycles,
      ...(replyAckReplay === undefined ? {} : { mainReplyAckCycle: replyAckReplay.schedule }),
    });
  const statusReplay = args.applyStatusTape
    ? installSoundStatusReplay(chip, statusTapePath, loadSoundStatusReads(statusTapePath))
    : undefined;

  const reads: TsStatusRead[] = [];
  const originalRead8 = chip.mmu.read8;
  chip.mmu.read8 = (addr: u16) => {
    const value = originalRead8(addr);
    if ((addr as number) === 0x1820) {
      const val = value as number;
      const frameStart = chip.diagnosticFrameStartCycle;
      reads.push({
        index: reads.length,
        frame: chip.diagnosticFrame,
        cycle: chip.cpu.cycles,
        cycleInFrame: frameStart === undefined ? undefined : chip.cpu.cycles - frameStart,
        pc: chip.cpu.lastOpcodePc ?? (chip.cpu.rf.pc as number),
        val,
        base: val & STATUS_BASE_MASK,
      });
    }
    return value;
  };

  for (let f = 0; f < args.frames; f++) {
    tickFrameWithTape(chip, tape, f, {
      autoReleaseReset: true,
      drainReplies: true,
      resetReleaseDelayCycles: args.resetReleaseDelayCycles,
    });
  }
  return { reads, cyclePreciseTape: tape.cyclePrecise, resetFrame: tape.resetFrame, statusReplay, replyAckReplay };
}

function fieldsDiffer(ts: TsStatusRead | undefined, mame: SoundStatusRead | undefined, args: Args): string[] {
  if (ts === undefined || mame === undefined) return ["missing"];
  const fields: string[] = [];
  if (ts.base !== mame.base) fields.push("base");
  if (ts.val !== mame.val) fields.push("val");
  if (ts.pc !== undefined && mame.pc !== undefined && ts.pc !== mame.pc) fields.push("pc");
  if (!args.ignoreFrame && ts.frame !== undefined && mame.frame !== undefined && ts.frame !== mame.frame) fields.push("frame");
  if (ts.cycleInFrame !== undefined && mame.cycleInFrame !== undefined &&
    Math.abs(ts.cycleInFrame - mame.cycleInFrame) > args.cycleTolerance) fields.push("cycleInFrame");
  return fields;
}

function mameStatusReadsInFrameRange(
  mameReads: ReturnType<typeof loadSoundStatusReads>,
  frames: number,
): SoundStatusRead[] {
  const out: SoundStatusRead[] = [];
  for (let i = 0; i < mameReads.readCount; i++) {
    const read = mameReads.readAt(i);
    if (read === undefined) continue;
    if (read.frame !== undefined && read.frame >= frames) continue;
    out.push(read);
  }
  return out;
}

function diffStatusReads(ts: TsStatusRead[], mame: readonly SoundStatusRead[], args: Args): StatusDiffSummary {
  const compared = Math.max(ts.length, mame.length);
  let mismatchCount = 0;
  let firstMismatch: StatusMismatch | undefined;
  for (let i = 0; i < compared; i++) {
    const tsi = ts[i];
    const mameRead = mame[i];
    const fields = fieldsDiffer(tsi, mameRead, args);
    if (fields.length > 0) {
      mismatchCount++;
      firstMismatch ??= { index: i, fields, ts: tsi, mame: mameRead };
    }
  }
  const frameCountDiff = diffFrameCounts(ts, mame, args);
  const replayCycleDiff = diffReplayCycles(ts, mame, args);
  return {
    compared,
    tsCount: ts.length,
    mameCount: mame.length,
    mismatchCount,
    firstMismatch,
    firstCountMismatch: ts.length === mame.length
      ? undefined
      : { tsCount: ts.length, mameCount: mame.length, delta: ts.length - mame.length },
    frameCountDiff,
    replayCycleDiff,
  };
}

function firstCommandReplayOrigin(cmdTapePath: string): number | undefined {
  const tape = JSON.parse(readFileSync(cmdTapePath, "utf8")) as CmdTape;
  const first = tape.cmds[0];
  if (first === undefined) return undefined;
  const cycle = cmdTapeAbsoluteCycle(first);
  if (cycle === undefined) return undefined;
  const asNumber = Number(cycle);
  return Number.isSafeInteger(asNumber) ? asNumber : undefined;
}

function diffReplayCycles(
  ts: readonly TsStatusRead[],
  mame: readonly SoundStatusRead[],
  args: Args,
): ReplayCycleDiffSummary | undefined {
  const origin = firstCommandReplayOrigin(args.cmdTape);
  if (origin === undefined) return undefined;
  const compared = Math.min(ts.length, mame.length);
  let mismatchCount = 0;
  let min: number | undefined;
  let max: number | undefined;
  let maxAbs: number | undefined;
  let sumAbs = 0;
  let firstMismatch: ReplayCycleMismatch | undefined;
  for (let i = 0; i < compared; i++) {
    const tsRead = ts[i]!;
    const mameRead = mame[i]!;
    if (mameRead.absoluteCycle === undefined) continue;
    const mameReplayCycle = mameRead.absoluteCycle - origin;
    const delta = tsRead.cycle - mameReplayCycle;
    min = min === undefined ? delta : Math.min(min, delta);
    max = max === undefined ? delta : Math.max(max, delta);
    const abs = Math.abs(delta);
    maxAbs = maxAbs === undefined ? abs : Math.max(maxAbs, abs);
    sumAbs += abs;
    if (abs > args.replayCycleTolerance) {
      mismatchCount++;
      firstMismatch ??= {
        index: i,
        delta,
        tsCycle: tsRead.cycle,
        mameReplayCycle,
        ts: tsRead,
        mame: mameRead,
      };
    }
  }
  return {
    compared,
    mismatchCount,
    min,
    max,
    maxAbs,
    meanAbs: compared === 0 ? undefined : sumAbs / compared,
    firstMismatch,
  };
}

function countByFrame(reads: readonly SoundStatusRead[]): Map<number, SoundStatusRead[]> {
  const counts = new Map<number, SoundStatusRead[]>();
  for (const read of reads) {
    if (read.frame === undefined) continue;
    let bucket = counts.get(read.frame);
    if (bucket === undefined) {
      bucket = [];
      counts.set(read.frame, bucket);
    }
    bucket.push(read);
  }
  return counts;
}

function readsByPc(reads: readonly SoundStatusRead[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const read of reads) {
    const key = hex(read.pc, 4);
    out[key] = (out[key] ?? 0) + 1;
  }
  return out;
}

function diffFrameCounts(
  ts: readonly TsStatusRead[],
  mame: readonly SoundStatusRead[],
  args: Args,
): StatusDiffSummary["frameCountDiff"] {
  const tsByFrame = countByFrame(ts);
  const mameByFrame = countByFrame(mame);
  const frames = new Set<number>();
  for (const frame of tsByFrame.keys()) frames.add(frame);
  for (const frame of mameByFrame.keys()) frames.add(frame);
  const sortedFrames = [...frames].sort((a, b) => a - b);
  const samples: FrameCountMismatch[] = [];
  let firstMismatch: FrameCountMismatch | undefined;
  let mismatchCount = 0;
  for (const frame of sortedFrames) {
    const tsReads = tsByFrame.get(frame) ?? [];
    const mameReads = mameByFrame.get(frame) ?? [];
    if (tsReads.length === mameReads.length) continue;
    mismatchCount++;
    const mismatch = {
      frame,
      tsCount: tsReads.length,
      mameCount: mameReads.length,
      delta: tsReads.length - mameReads.length,
      tsByPc: readsByPc(tsReads),
      mameByPc: readsByPc(mameReads),
    };
    firstMismatch ??= mismatch;
    if (samples.length < Math.max(1, args.frameContext)) samples.push(mismatch);
  }
  return {
    comparedFrames: sortedFrames.length,
    mismatchCount,
    firstMismatch,
    samples,
  };
}

function fmtRead(read: SoundStatusRead | TsStatusRead | undefined): string {
  if (read === undefined) return "<missing>";
  const cycle = "cycleInFrame" in read && read.cycleInFrame !== undefined ? String(read.cycleInFrame) : "?";
  return `{frame:${read.frame ?? "?"}, cycleInFrame:${cycle}, pc:${hex(read.pc, 4)}, val:${hex(read.val, 2)}, base:${hex(read.base, 2)}}`;
}

function main(): void {
  const args = parseArgs();
  if (args.mameStatus === undefined || !existsSync(args.mameStatus)) {
    console.error("Usage: probe-sound-status-diff --mame-status <json> [--frames N] [--apply-status-tape]");
    console.error("MAME status log not found:", args.mameStatus);
    process.exit(2);
    return;
  }

  const mameReads = loadSoundStatusReads(args.mameStatus);
  const mameInFrameRange = mameStatusReadsInFrameRange(mameReads, args.frames);
  const tsRun = runTsStatusReads(args, args.mameStatus);
  const diff = diffStatusReads(tsRun.reads, mameInFrameRange, args);
  const contextStart = diff.firstMismatch === undefined
    ? undefined
    : Math.max(0, diff.firstMismatch.index - Math.max(0, args.context));
  const contextEnd = contextStart === undefined || diff.firstMismatch === undefined
    ? undefined
    : Math.min(diff.compared, diff.firstMismatch.index + Math.max(0, args.context) + 1);
  const context = contextStart === undefined || contextEnd === undefined
    ? undefined
    : Array.from({ length: contextEnd - contextStart }, (_, offset) => {
      const index = contextStart + offset;
      return { index, ts: tsRun.reads[index], mame: mameInFrameRange[index] };
    });
  const report = {
    frames: args.frames,
    cmdTape: args.cmdTape,
    mameStatus: args.mameStatus,
    cyclePreciseTape: tsRun.cyclePreciseTape,
    resetFrame: tsRun.resetFrame,
    applyStatusTape: args.applyStatusTape,
    ignoreFrame: args.ignoreFrame,
    cycleTolerance: args.cycleTolerance,
    resetReleaseDelayCycles: args.resetReleaseDelayCycles,
    replyAckDelayCycles: args.replyAckDelayCycles,
    useEmbeddedReplyAckTape: args.useEmbeddedReplyAckTape,
    ...(args.statusBase === undefined ? {} : { statusBase: hex(args.statusBase, 2) }),
    ...(statusReplayReport(tsRun.statusReplay) === undefined ? {} : { statusReplay: statusReplayReport(tsRun.statusReplay) }),
    ...(mainReplyAckReplayReport(tsRun.replyAckReplay) === undefined ? {} : { replyAckReplay: mainReplyAckReplayReport(tsRun.replyAckReplay) }),
    diff,
    ...(context === undefined ? {} : { context }),
  };
  if (args.out !== undefined) writeFileSync(args.out, JSON.stringify(report, null, 2));

  const status = diff.mismatchCount <= args.maxMismatches ? "PASS" : "FAIL";
  console.log(
    `${status} status-read diff: compared=${diff.compared} mismatches=${diff.mismatchCount} ` +
    `TS=${diff.tsCount} MAME=${diff.mameCount} applyStatusTape=${args.applyStatusTape} ` +
    `ignoreFrame=${args.ignoreFrame} resetReleaseDelayCycles=${args.resetReleaseDelayCycles} ` +
    `replyAckDelayCycles=${args.replyAckDelayCycles}` +
    (args.useEmbeddedReplyAckTape ? "" : " embeddedReplyAckTape=false") +
    (tsRun.replyAckReplay === undefined ? "" : ` replyAckTapeAcks=${tsRun.replyAckReplay.stats.ackCount}`),
  );
  if (tsRun.statusReplay !== undefined) {
    console.log(
      `statusReplay: applied=${tsRun.statusReplay.appliedReadCount}/${tsRun.statusReplay.mameReadCount} ` +
      `tsReads=${tsRun.statusReplay.tsReadCount} exhausted=${tsRun.statusReplay.exhaustedReadCount} ` +
      `baseMismatches=${tsRun.statusReplay.baseMismatchCount}`,
    );
  }
  if (tsRun.replyAckReplay !== undefined) {
    const stats = tsRun.replyAckReplay.stats;
    console.log(
      `replyAckReplay: scheduled=${stats.scheduledWriteCount}/${stats.ackCount} ` +
      `exhausted=${stats.exhaustedWriteCount} skipped=${stats.skippedAckCount} source=${stats.source}`,
    );
  }
  if (diff.firstMismatch !== undefined) {
    console.log(`first mismatch #${diff.firstMismatch.index} fields=${diff.firstMismatch.fields.join(",")}`);
    console.log(`  TS   ${fmtRead(diff.firstMismatch.ts)}`);
    console.log(`  MAME ${fmtRead(diff.firstMismatch.mame)}`);
    if (context !== undefined) {
      for (const row of context) {
        console.log(`  ctx #${row.index} TS ${fmtRead(row.ts)} | MAME ${fmtRead(row.mame)}`);
      }
    }
  }
  console.log(
    `frame-count diff: comparedFrames=${diff.frameCountDiff.comparedFrames} ` +
    `mismatches=${diff.frameCountDiff.mismatchCount}`,
  );
  if (diff.frameCountDiff.firstMismatch !== undefined) {
    const first = diff.frameCountDiff.firstMismatch;
    console.log(
      `  first frame mismatch f${first.frame}: TS=${first.tsCount} ` +
      `MAME=${first.mameCount} delta=${first.delta}`,
    );
    for (const sample of diff.frameCountDiff.samples) {
      console.log(
        `  frame sample f${sample.frame}: TS=${sample.tsCount} MAME=${sample.mameCount} ` +
        `delta=${sample.delta} tsByPc=${JSON.stringify(sample.tsByPc)} ` +
        `mameByPc=${JSON.stringify(sample.mameByPc)}`,
      );
    }
  }
  if (diff.replayCycleDiff !== undefined) {
    console.log(
      `replay-cycle diff: compared=${diff.replayCycleDiff.compared} ` +
      `mismatches>${args.replayCycleTolerance}c=${diff.replayCycleDiff.mismatchCount} ` +
      `min=${diff.replayCycleDiff.min} max=${diff.replayCycleDiff.max} ` +
      `maxAbs=${diff.replayCycleDiff.maxAbs} meanAbs=${diff.replayCycleDiff.meanAbs?.toFixed(2)}`,
    );
    if (diff.replayCycleDiff.firstMismatch !== undefined) {
      const first = diff.replayCycleDiff.firstMismatch;
      console.log(
        `  first replay-cycle mismatch #${first.index}: delta=${first.delta} ` +
        `TS cycle=${first.tsCycle} MAME replayCycle=${first.mameReplayCycle}`,
      );
      console.log(`    TS   ${fmtRead(first.ts)}`);
      console.log(`    MAME ${fmtRead(first.mame)}`);
    }
  }
  if (diff.firstCountMismatch !== undefined) {
    console.log(
      `count mismatch: TS=${diff.firstCountMismatch.tsCount} ` +
      `MAME=${diff.firstCountMismatch.mameCount} delta=${diff.firstCountMismatch.delta}`,
    );
  }
  if (diff.mismatchCount > args.maxMismatches) process.exitCode = 1;
}

main();
