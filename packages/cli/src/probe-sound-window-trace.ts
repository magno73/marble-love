// probe-sound-window-trace.ts — focused TS SoundChip trace for cmd/NMI/YM drift.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  createSoundChip,
  drainChipWriteEvents,
  loadCmdTape,
  tickFrameWithTape,
  type ChipWriteEvent,
  DEFAULT_COMMAND_NMI_SAMPLE_CYCLE,
  type MainReplyWriteEvent,
} from "../../engine/src/m6502/sound-chip.js";
import { as_u8, type u8, type u16 } from "../../engine/src/wrap.js";
import {
  installSoundStatusFrameReplay,
  installSoundStatusReplay,
  loadSoundStatusReads,
  statusReplayReport,
  type SoundStatusReplayValueMode,
} from "./sound-status-replay.js";
import {
  createMainReplyAckReplayForTape,
  mainReplyAckReplayReport,
} from "./sound-reply-ack-replay.js";

interface Args {
  frames: number;
  fromFrame: number;
  toFrame: number;
  cmdTape: string;
  out: string;
  tracePc: boolean;
  tracePcFull: boolean;
  traceVectors: boolean;
  traceYmStatus: boolean;
  traceIrqState: boolean;
  statusBase: number | undefined;
  statusTape: string | undefined;
  statusTapeMode: StatusTapeMode;
  statusValueMode: SoundStatusReplayValueMode;
  resetReleaseDelayCycles: number;
  resetFirstFetchDelayAfterCommandCycles: number;
  replyAckDelayCycles: number;
  replyAckTape: string | undefined;
  useEmbeddedReplyAckTape: boolean;
  timerAStartDelayCycles: number;
  timerAHoldWhileOverflow: boolean;
  deferYmTimerControlWriteTiming: boolean;
  irqServiceDelayCycles: number;
  ymIrqAssertionDelayCycles: number;
  ymIrqNewAssertionInstructionDelay: number;
  commandNmiDelayInstructions: number;
  commandNmiSampleCycle: number;
  commandNmiBoundaryDelayInstructions: number;
  commandNmiDelayMatches: readonly CommandNmiDelayMatch[];
  commandNmiDelayChipWriteBoundaryInstructions: number | undefined;
  commandNmiDelayCompletedChipWritePreemptions: number | undefined;
  commandCycleOffsetCycles: number;
  commandCycleOffsetStartFrame: number | undefined;
  commandPreemptChipWriteLookaheadCycles: number;
  commandPreemptChipWriteBeforeOnly: boolean;
  commandPreemptChipWritePcs: ReadonlySet<number>;
  commandPreemptChipWriteCompleteBeforeTarget: boolean;
  commandPreemptPendingIrqLookaheadCycles: number;
  ymWriteEventCycleOffsetCycles: number;
  ymWriteEventCycleOffsetRegs: ReadonlyMap<number, number>;
  ymWriteEventCycleOffsetMatches: readonly YmWriteEventCycleOffsetMatch[];
  traceZpAddrs: ReadonlySet<number>;
  traceZpMode: TraceZpMode;
  traceRamAddrs: ReadonlySet<number>;
  traceRamMode: TraceMemMode;
}

type StatusTapeMode = "readIndex" | "frame";
type TraceMemMode = "read" | "write" | "both";
type TraceZpMode = TraceMemMode;

interface CommandNmiDelayMatch {
  readonly frame?: number;
  readonly byte?: number;
  readonly cycleInFrame?: number;
  readonly delayInstructions: number;
}

interface YmWriteEventCycleOffsetMatch {
  readonly frame?: number;
  readonly pc?: number;
  readonly reg?: number;
  readonly val?: number;
  readonly deltaCycles: number;
}

interface TraceEvent {
  readonly kind: "pcFetch" | "vectorRead" | "cmdSubmit" | "cmdRead" | "replyWrite" | "mainReplyAck" | "statusRead" | "ymStatusRead" | "irqState" | "latchWrite" | "ymWrite" | "pokeyWrite" | "zpRead" | "zpWrite" | "ramRead" | "ramWrite";
  readonly frame: number;
  readonly cycle: number;
  readonly cycleInFrame: number;
  readonly actualCycle?: number;
  readonly actualCycleInFrame?: number;
  readonly pc?: string;
  readonly soundPc?: string;
  readonly expectedSoundPc?: string;
  readonly expectedSoundA?: string;
  readonly expectedSoundX?: string;
  readonly expectedSoundY?: string;
  readonly expectedSoundP?: string;
  readonly expectedSoundSp?: string;
  readonly expectedInstPc?: string;
  readonly expectedInstOpcode?: string;
  readonly expectedInstDeltaCycles?: number;
  readonly expectedNextChronoInstPc?: string;
  readonly expectedNextChronoInstOpcode?: string;
  readonly expectedNextChronoInstDeltaCycles?: number;
  readonly lastStepPc?: string;
  readonly lastStepStartCycle?: number;
  readonly lastStepEndCycle?: number;
  readonly a?: string;
  readonly x?: string;
  readonly y?: string;
  readonly p?: string;
  readonly sp?: string;
  readonly opcode?: string;
  readonly vector?: string;
  readonly readCycleOffset?: number;
  readonly addr?: string;
  readonly byte?: string;
  readonly reg?: string;
  readonly val?: string;
  readonly nextPc?: string;
  readonly interruptService?: "nmi" | "irq";
  readonly nmiBefore?: boolean;
  readonly irqBefore?: boolean;
  readonly irqWillServiceBefore?: boolean;
  readonly ymIrqPinBefore?: boolean;
  readonly timerAOverflowBefore?: boolean;
  readonly timerAIrqEnableBefore?: boolean;
  readonly timerACounterBefore?: number;
  readonly timerAAccumulatorBefore?: number;
  readonly pendingYmIrqAssertionDelayBefore?: number;
  readonly pendingYmIrqInstructionDelayBefore?: number;
  readonly nmiAfter?: boolean;
  readonly irqAfter?: boolean;
  readonly ymIrqPinAfter?: boolean;
  readonly timerAOverflowAfter?: boolean;
  readonly timerAIrqEnableAfter?: boolean;
  readonly timerACounterAfter?: number;
  readonly timerAAccumulatorAfter?: number;
  readonly pendingYmIrqAssertionDelayAfter?: number;
  readonly pendingYmIrqInstructionDelayAfter?: number;
  readonly commandNmiDelayInstructions?: number;
  readonly preemptedChipWrite?: {
    readonly pc: string;
    readonly opcode: string;
    readonly address: string;
    readonly stepStart: number;
    readonly stepEnd: number;
    readonly writeCycle: number;
    readonly targetDeltaFromWrite: number;
    readonly completedInstructionBeforeTarget?: boolean;
  };
}

interface SoundCpuStepEvent {
  readonly frame: number | undefined;
  readonly frameStartCycle: number | undefined;
  readonly startCycle: number;
  readonly endCycle: number;
  readonly startCycleInFrame: number | undefined;
  readonly endCycleInFrame: number | undefined;
  readonly pc: number;
  readonly opcode: number | undefined;
  readonly nextPc: number;
  readonly interruptService: "nmi" | "irq" | undefined;
  readonly nmiBefore: boolean;
  readonly irqBefore: boolean;
  readonly irqWillServiceBefore: boolean;
  readonly ymIrqPinBefore: boolean;
  readonly timerAOverflowBefore: boolean;
  readonly timerAIrqEnableBefore: boolean;
  readonly timerACounterBefore: number;
  readonly timerAAccumulatorBefore: number;
  readonly pendingYmIrqAssertionDelayBefore: number | undefined;
  readonly pendingYmIrqInstructionDelayBefore: number | undefined;
  readonly nmiAfter: boolean;
  readonly irqAfter: boolean;
  readonly ymIrqPinAfter: boolean;
  readonly timerAOverflowAfter: boolean;
  readonly timerAIrqEnableAfter: boolean;
  readonly timerACounterAfter: number;
  readonly timerAAccumulatorAfter: number;
  readonly pendingYmIrqAssertionDelayAfter: number | undefined;
  readonly pendingYmIrqInstructionDelayAfter: number | undefined;
}

interface CommandExpectedStateMismatch {
  readonly index: number;
  readonly fields: readonly string[];
  readonly event: TraceEvent;
}

interface CommandExpectedStateSummary {
  readonly commandCount: number;
  readonly expectedCommandCount: number;
  readonly mismatchCount: number;
  readonly fieldCounts: Readonly<Record<string, number>>;
  readonly firstMismatch?: CommandExpectedStateMismatch;
  readonly mismatchSamples: readonly CommandExpectedStateMismatch[];
}

interface YmStatusPcSummary {
  readonly readCount: number;
  readonly busyReadCount: number;
  readonly timerAReadCount: number;
  readonly clearReadCount: number;
  readonly firstCycleInFrame: number;
  readonly lastCycleInFrame: number;
  readonly firstRead: TraceEvent;
  readonly lastRead: TraceEvent;
}

interface YmStatusSummary {
  readonly readCount: number;
  readonly busyReadCount: number;
  readonly timerAReadCount: number;
  readonly clearReadCount: number;
  readonly byPc: Readonly<Record<string, YmStatusPcSummary>>;
}

interface CommandInstContextSample {
  readonly index: number;
  readonly frame: number;
  readonly expectedInstPc: string;
  readonly expectedInstDeltaCycles: number;
  readonly expectedInstCycle: number;
  readonly nearestDeltaCycles?: number;
  readonly nearestEvent?: TraceEvent;
}

interface CommandInstContextSummary {
  readonly commandCount: number;
  readonly expectedInstCount: number;
  readonly matchedPcFetchCount: number;
  readonly exactCycleCount: number;
  readonly nearestAbsDeltaMax: number | undefined;
  readonly samples: readonly CommandInstContextSample[];
}

type TickOptionsWithSubmit = NonNullable<Parameters<typeof tickFrameWithTape>[3]> & {
  readonly commandNmiBoundaryDelayInstructions?: number;
  readonly commandCycleOffsetCycles?: number;
};

function readArg(args: string[], name: string): string | undefined {
  const idx = args.indexOf(name);
  return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : undefined;
}

function parseNumber(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  return Number.parseInt(value, value.startsWith("0x") ? 16 : 10);
}

function parseStatusTapeMode(value: string | undefined): StatusTapeMode {
  if (value === undefined || value === "read" || value === "readIndex") return "readIndex";
  if (value === "frame") return "frame";
  throw new Error(`Unsupported --status-tape-mode: ${value}`);
}

function parseStatusValueMode(value: string | undefined): SoundStatusReplayValueMode {
  if (value === undefined || value === "base") return "base";
  if (value === "full") return "full";
  throw new Error(`Unsupported --status-value-mode: ${value}`);
}

function parseTraceZpAddrs(value: string | undefined): ReadonlySet<number> {
  const out = new Set<number>();
  if (value === undefined || value.trim() === "") return out;
  for (const raw of value.split(",")) {
    const part = raw.trim();
    if (part === "") continue;
    const parsed = Number.parseInt(part, part.startsWith("0x") ? 16 : 10);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 0xff) {
      throw new Error(`Unsupported --trace-zp address: ${raw}`);
    }
    out.add(parsed & 0xff);
  }
  return out;
}

function parseTraceRamAddrs(value: string | undefined): ReadonlySet<number> {
  const out = new Set<number>();
  if (value === undefined || value.trim() === "") return out;
  for (const raw of value.split(",")) {
    const part = raw.trim();
    if (part === "") continue;
    const parsed = Number.parseInt(part, part.startsWith("0x") ? 16 : 10);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed >= 0x1000) {
      throw new Error(`Unsupported --trace-ram address: ${raw}`);
    }
    out.add(parsed & 0x0fff);
  }
  return out;
}

function parseTracePcs(value: string | undefined): ReadonlySet<number> {
  const out = new Set<number>();
  if (value === undefined || value.trim() === "") return out;
  for (const raw of value.split(",")) {
    const part = raw.trim();
    if (part === "") continue;
    const parsed = Number.parseInt(part, part.startsWith("0x") ? 16 : 10);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 0xffff) {
      throw new Error(`Unsupported PC selector: ${raw}`);
    }
    out.add(parsed & 0xffff);
  }
  return out;
}

function parseTraceMemMode(value: string | undefined, argName: string): TraceMemMode {
  if (value === undefined || value === "" || value === "both") return "both";
  if (value === "read" || value === "write") return value;
  throw new Error(`Unsupported ${argName}: ${value}`);
}

function parseOptionalIntegerPart(raw: string): number | undefined {
  const trimmed = raw.trim();
  if (trimmed === "" || trimmed === "*") return undefined;
  const value = Number.parseInt(trimmed, trimmed.startsWith("0x") ? 16 : 10);
  if (!Number.isFinite(value)) throw new Error(`Unsupported selector value: ${raw}`);
  return value;
}

function parseRegisterCycleOffsets(value: string | undefined, name: string): ReadonlyMap<number, number> {
  const offsets = new Map<number, number>();
  if (value === undefined || value.trim() === "") return offsets;
  for (const rawEntry of value.split(",")) {
    const entry = rawEntry.trim();
    const separator = entry.includes("=") ? "=" : ":";
    const [regRaw, deltaRaw] = entry.split(separator);
    if (regRaw === undefined || deltaRaw === undefined || regRaw.trim() === "" || deltaRaw.trim() === "") {
      throw new Error(`Unsupported ${name} entry: ${rawEntry}; expected 0x18:+5 or 0x18=5`);
    }
    const reg = Number.parseInt(regRaw.trim(), regRaw.trim().startsWith("0x") ? 16 : 10);
    const delta = Number(deltaRaw.trim());
    if (!Number.isFinite(reg) || reg < 0 || reg > 0xff || !Number.isFinite(delta)) {
      throw new Error(`Unsupported ${name} entry: ${rawEntry}`);
    }
    offsets.set(reg & 0xff, Math.trunc(delta));
  }
  return offsets;
}

function parseYmWriteEventCycleOffsetMatches(
  value: string | undefined,
  name: string,
): readonly YmWriteEventCycleOffsetMatch[] {
  if (value === undefined || value.trim() === "") return [];
  return value.split(",").map((rawEntry) => {
    const parts = rawEntry.trim().split(":");
    if (parts.length !== 5) {
      throw new Error(`Unsupported ${name} entry: ${rawEntry}; expected frame:pc:reg:val:delta`);
    }
    const [frameRaw, pcRaw, regRaw, valRaw, deltaRaw] = parts;
    const deltaCycles = Number(deltaRaw);
    if (!Number.isFinite(deltaCycles)) throw new Error(`Unsupported ${name} delta in entry: ${rawEntry}`);
    const frame = parseOptionalIntegerPart(frameRaw ?? "");
    const pc = parseOptionalIntegerPart(pcRaw ?? "");
    const reg = parseOptionalIntegerPart(regRaw ?? "");
    const val = parseOptionalIntegerPart(valRaw ?? "");
    if (frame !== undefined && frame < 0) throw new Error(`Unsupported ${name} frame in entry: ${rawEntry}`);
    if (pc !== undefined && (pc < 0 || pc > 0xffff)) throw new Error(`Unsupported ${name} pc in entry: ${rawEntry}`);
    if (reg !== undefined && (reg < 0 || reg > 0xff)) throw new Error(`Unsupported ${name} reg in entry: ${rawEntry}`);
    if (val !== undefined && (val < 0 || val > 0xff)) throw new Error(`Unsupported ${name} val in entry: ${rawEntry}`);
    return {
      ...(frame === undefined ? {} : { frame: Math.trunc(frame) }),
      ...(pc === undefined ? {} : { pc: Math.trunc(pc) }),
      ...(reg === undefined ? {} : { reg: Math.trunc(reg) }),
      ...(val === undefined ? {} : { val: Math.trunc(val) }),
      deltaCycles: Math.trunc(deltaCycles),
    };
  });
}

function parseCommandNmiDelayMatches(
  value: string | undefined,
  name: string,
): readonly CommandNmiDelayMatch[] {
  if (value === undefined || value.trim() === "") return [];
  return value.split(",").map((rawEntry) => {
    const parts = rawEntry.trim().split(":");
    if (parts.length !== 4) {
      throw new Error(`Unsupported ${name} entry: ${rawEntry}; expected frame:byte:cycleInFrame:delay`);
    }
    const [frameRaw, byteRaw, cycleRaw, delayRaw] = parts;
    const frame = parseOptionalIntegerPart(frameRaw ?? "");
    const byte = parseOptionalIntegerPart(byteRaw ?? "");
    const cycleInFrame = parseOptionalIntegerPart(cycleRaw ?? "");
    const delayInstructions = Number(delayRaw);
    if (frame !== undefined && frame < 0) throw new Error(`Unsupported ${name} frame in entry: ${rawEntry}`);
    if (byte !== undefined && (byte < 0 || byte > 0xff)) throw new Error(`Unsupported ${name} byte in entry: ${rawEntry}`);
    if (cycleInFrame !== undefined && cycleInFrame < 0) throw new Error(`Unsupported ${name} cycle in entry: ${rawEntry}`);
    if (!Number.isFinite(delayInstructions) || delayInstructions < 0) {
      throw new Error(`Unsupported ${name} delay in entry: ${rawEntry}`);
    }
    return {
      ...(frame === undefined ? {} : { frame: Math.trunc(frame) }),
      ...(byte === undefined ? {} : { byte: Math.trunc(byte) & 0xff }),
      ...(cycleInFrame === undefined ? {} : { cycleInFrame: Math.trunc(cycleInFrame) }),
      delayInstructions: Math.trunc(delayInstructions),
    };
  });
}

function commandNmiDelayOverrideForMatch(
  matches: readonly CommandNmiDelayMatch[],
  frame: number,
  byte: number,
  cycleInFrame: number,
): number | undefined {
  for (const match of matches) {
    if (match.frame !== undefined && match.frame !== frame) continue;
    if (match.byte !== undefined && match.byte !== (byte & 0xff)) continue;
    if (match.cycleInFrame !== undefined && match.cycleInFrame !== cycleInFrame) continue;
    return match.delayInstructions;
  }
  return undefined;
}

function commandNmiDelayOverrideForArgs(
  args: Pick<
    Args,
    "commandNmiDelayMatches" |
    "commandNmiDelayChipWriteBoundaryInstructions" |
    "commandNmiDelayCompletedChipWritePreemptions"
  >,
  event: {
    readonly frame: number;
    readonly byte: number;
    readonly cycleInFrame: number;
    readonly currentChipIoStore?: unknown;
    readonly preemptedChipWrite?: {
      readonly pc?: number;
      readonly completedInstructionBeforeTarget?: boolean;
    };
  },
): number | undefined {
  const explicit = commandNmiDelayOverrideForMatch(
    args.commandNmiDelayMatches,
    event.frame,
    event.byte,
    event.cycleInFrame,
  );
  if (explicit !== undefined) return explicit;
  if (args.commandNmiDelayChipWriteBoundaryInstructions !== undefined &&
    event.cycleInFrame === 0 && event.currentChipIoStore !== undefined) {
    return args.commandNmiDelayChipWriteBoundaryInstructions;
  }
  if (args.commandNmiDelayCompletedChipWritePreemptions !== undefined &&
    event.preemptedChipWrite?.completedInstructionBeforeTarget === true) {
    return args.commandNmiDelayCompletedChipWritePreemptions;
  }
  return undefined;
}

function registerCycleOffsetsToJson(offsets: ReadonlyMap<number, number>): Record<string, number> {
  return Object.fromEntries(
    Array.from(offsets.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([reg, delta]) => [`0x${reg.toString(16).padStart(2, "0")}`, delta]),
  );
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  const fromFrame = Number(readArg(args, "--from") ?? "372");
  const toFrame = Number(readArg(args, "--to") ?? "377");
  return {
    frames: Number(readArg(args, "--frames") ?? String(toFrame + 1)),
    fromFrame,
    toFrame,
    cmdTape: readArg(args, "--cmd-tape") ?? "oracle/scenarios/sound-cmd-tape-attract-cycle-precise.json",
    out: readArg(args, "--out") ?? "/tmp/marble-love/audio-bitperfect/ts_sound_window_trace.json",
    tracePc: args.includes("--trace-pc") || args.includes("--trace-pc-full"),
    tracePcFull: args.includes("--trace-pc-full"),
    traceVectors: args.includes("--trace-vectors"),
    traceYmStatus: args.includes("--trace-ym-status"),
    traceIrqState: args.includes("--trace-irq-state"),
    statusBase: parseNumber(readArg(args, "--status-base")),
    statusTape: readArg(args, "--status-tape"),
    statusTapeMode: parseStatusTapeMode(readArg(args, "--status-tape-mode")),
    statusValueMode: parseStatusValueMode(readArg(args, "--status-value-mode")),
    resetReleaseDelayCycles: Number(readArg(args, "--reset-release-delay") ?? "0"),
    resetFirstFetchDelayAfterCommandCycles: Number(readArg(args, "--reset-first-fetch-after-command") ?? "0"),
    replyAckDelayCycles: Number(readArg(args, "--reply-ack-delay") ?? "0"),
    replyAckTape: readArg(args, "--reply-ack-tape"),
    useEmbeddedReplyAckTape: !args.includes("--no-embedded-reply-ack"),
    timerAStartDelayCycles: Number(readArg(args, "--timer-a-start-delay") ?? "0"),
    timerAHoldWhileOverflow: args.includes("--timer-a-hold-while-overflow"),
    deferYmTimerControlWriteTiming: args.includes("--defer-ym-timer-control-write-timing"),
    irqServiceDelayCycles: Number(readArg(args, "--irq-service-delay") ?? "0"),
    ymIrqAssertionDelayCycles: Number(readArg(args, "--ym-irq-assertion-delay") ?? "0"),
    ymIrqNewAssertionInstructionDelay:
      Number(readArg(args, "--ym-irq-new-assertion-instruction-delay") ?? "0"),
    commandNmiDelayInstructions: Number(readArg(args, "--command-nmi-delay-instructions") ?? "0"),
    commandNmiSampleCycle: Number(readArg(args, "--command-nmi-sample-cycle") ?? String(DEFAULT_COMMAND_NMI_SAMPLE_CYCLE)),
    commandNmiBoundaryDelayInstructions: Number(readArg(args, "--command-nmi-boundary-delay-instructions") ?? "0"),
    commandNmiDelayMatches: parseCommandNmiDelayMatches(
      readArg(args, "--command-nmi-delay-matches"),
      "--command-nmi-delay-matches",
    ),
    commandNmiDelayChipWriteBoundaryInstructions: readArg(args, "--command-nmi-delay-chip-write-boundary") === undefined
      ? undefined
      : Math.max(0, Math.trunc(Number(readArg(args, "--command-nmi-delay-chip-write-boundary")))),
    commandNmiDelayCompletedChipWritePreemptions:
      readArg(args, "--command-nmi-delay-completed-chip-write-preemptions") === undefined
        ? undefined
        : Math.max(0, Math.trunc(Number(readArg(args, "--command-nmi-delay-completed-chip-write-preemptions")))),
    commandCycleOffsetCycles: Number(readArg(args, "--command-cycle-offset") ?? "0"),
    commandCycleOffsetStartFrame: readArg(args, "--command-cycle-offset-start-frame") === undefined
      ? undefined
      : Number(readArg(args, "--command-cycle-offset-start-frame")),
    commandPreemptChipWriteLookaheadCycles: Number(readArg(args, "--command-preempt-chip-write-lookahead") ?? "0"),
    commandPreemptChipWriteBeforeOnly: args.includes("--command-preempt-chip-write-before-only"),
    commandPreemptChipWritePcs: parseTracePcs(readArg(args, "--command-preempt-chip-write-pcs")),
    commandPreemptChipWriteCompleteBeforeTarget:
      args.includes("--command-preempt-chip-write-complete-before-target"),
    commandPreemptPendingIrqLookaheadCycles: Number(readArg(args, "--command-preempt-pending-irq-lookahead") ?? "0"),
    ymWriteEventCycleOffsetCycles: Number(readArg(args, "--ym-write-event-cycle-offset") ?? "0"),
    ymWriteEventCycleOffsetRegs:
      parseRegisterCycleOffsets(readArg(args, "--ym-write-event-cycle-offset-regs"), "--ym-write-event-cycle-offset-regs"),
    ymWriteEventCycleOffsetMatches:
      parseYmWriteEventCycleOffsetMatches(readArg(args, "--ym-write-event-cycle-offset-matches"), "--ym-write-event-cycle-offset-matches"),
    traceZpAddrs: parseTraceZpAddrs(readArg(args, "--trace-zp")),
    traceZpMode: parseTraceMemMode(readArg(args, "--trace-zp-mode"), "--trace-zp-mode"),
    traceRamAddrs: parseTraceRamAddrs(readArg(args, "--trace-ram")),
    traceRamMode: parseTraceMemMode(readArg(args, "--trace-ram-mode"), "--trace-ram-mode"),
  };
}

function hex(value: number, width: number): string {
  return `0x${value.toString(16).padStart(width, "0")}`;
}

function incrementCount(counts: Record<string, number>, key: string): void {
  counts[key] = (counts[key] ?? 0) + 1;
}

function eventHexNumber(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number.parseInt(value, value.startsWith("0x") ? 16 : 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function expectedStateFields(event: TraceEvent): string[] {
  const fields: string[] = [];
  if (event.expectedSoundPc !== undefined && event.expectedSoundPc !== event.soundPc) fields.push("soundPc");
  if (event.expectedSoundA !== undefined && event.expectedSoundA !== event.a) fields.push("a");
  if (event.expectedSoundX !== undefined && event.expectedSoundX !== event.x) fields.push("x");
  if (event.expectedSoundY !== undefined && event.expectedSoundY !== event.y) fields.push("y");
  if (event.expectedSoundP !== undefined && event.expectedSoundP !== event.p) fields.push("p");
  if (event.expectedSoundSp !== undefined && event.expectedSoundSp !== event.sp) fields.push("sp");
  return fields;
}

function hasExpectedState(event: TraceEvent): boolean {
  return event.expectedSoundPc !== undefined ||
    event.expectedSoundA !== undefined ||
    event.expectedSoundX !== undefined ||
    event.expectedSoundY !== undefined ||
    event.expectedSoundP !== undefined ||
    event.expectedSoundSp !== undefined;
}

function commandExpectedStateSummary(
  events: readonly TraceEvent[],
  sampleLimit = 8,
): CommandExpectedStateSummary {
  let commandCount = 0;
  let expectedCommandCount = 0;
  let mismatchCount = 0;
  const fieldCounts: Record<string, number> = {};
  let firstMismatch: CommandExpectedStateMismatch | undefined;
  const mismatchSamples: CommandExpectedStateMismatch[] = [];
  for (const event of events) {
    if (event.kind !== "cmdSubmit") continue;
    const index = commandCount;
    commandCount++;
    if (!hasExpectedState(event)) continue;
    expectedCommandCount++;
    const fields = expectedStateFields(event);
    if (fields.length === 0) continue;
    mismatchCount++;
    for (const field of fields) incrementCount(fieldCounts, field);
    const mismatch = { index, fields, event };
    firstMismatch ??= mismatch;
    if (mismatchSamples.length < sampleLimit) mismatchSamples.push(mismatch);
  }
  return {
    commandCount,
    expectedCommandCount,
    mismatchCount,
    fieldCounts: Object.fromEntries(Object.entries(fieldCounts).sort((a, b) => a[0].localeCompare(b[0]))),
    ...(firstMismatch === undefined ? {} : { firstMismatch }),
    mismatchSamples,
  };
}

function ymStatusSummary(events: readonly TraceEvent[]): YmStatusSummary {
  let readCount = 0;
  let busyReadCount = 0;
  let timerAReadCount = 0;
  let clearReadCount = 0;
  const byPcMutable = new Map<string, {
    readCount: number;
    busyReadCount: number;
    timerAReadCount: number;
    clearReadCount: number;
    firstCycleInFrame: number;
    lastCycleInFrame: number;
    firstRead: TraceEvent;
    lastRead: TraceEvent;
  }>();

  for (const event of events) {
    if (event.kind !== "ymStatusRead") continue;
    const val = eventHexNumber(event.val) ?? 0;
    const pc = event.pc ?? "unknown";
    const busy = (val & 0x80) !== 0;
    const timerA = (val & 0x01) !== 0;
    const clear = !busy;
    readCount++;
    if (busy) busyReadCount++;
    if (timerA) timerAReadCount++;
    if (clear) clearReadCount++;

    const existing = byPcMutable.get(pc);
    if (existing === undefined) {
      byPcMutable.set(pc, {
        readCount: 1,
        busyReadCount: busy ? 1 : 0,
        timerAReadCount: timerA ? 1 : 0,
        clearReadCount: clear ? 1 : 0,
        firstCycleInFrame: event.cycleInFrame,
        lastCycleInFrame: event.cycleInFrame,
        firstRead: event,
        lastRead: event,
      });
    } else {
      existing.readCount++;
      if (busy) existing.busyReadCount++;
      if (timerA) existing.timerAReadCount++;
      if (clear) existing.clearReadCount++;
      existing.lastCycleInFrame = event.cycleInFrame;
      existing.lastRead = event;
    }
  }

  const byPc = Object.fromEntries(
    Array.from(byPcMutable.entries()).sort((a, b) => a[0].localeCompare(b[0])),
  );
  return {
    readCount,
    busyReadCount,
    timerAReadCount,
    clearReadCount,
    byPc,
  };
}

function commandInstContextSummary(
  events: readonly TraceEvent[],
  sampleLimit = 8,
): CommandInstContextSummary {
  const fetchesByPc = new Map<string, TraceEvent[]>();
  for (const event of events) {
    if (event.kind !== "pcFetch" || event.pc === undefined) continue;
    const bucket = fetchesByPc.get(event.pc);
    if (bucket === undefined) fetchesByPc.set(event.pc, [event]);
    else bucket.push(event);
  }

  let commandCount = 0;
  let expectedInstCount = 0;
  let matchedPcFetchCount = 0;
  let exactCycleCount = 0;
  let nearestAbsDeltaMax: number | undefined;
  const samples: CommandInstContextSample[] = [];
  for (const event of events) {
    if (event.kind !== "cmdSubmit") continue;
    const index = commandCount;
    commandCount++;
    if (event.expectedInstPc === undefined || event.expectedInstDeltaCycles === undefined) continue;
    expectedInstCount++;
    const expectedInstCycle = event.cycle - event.expectedInstDeltaCycles;
    let nearestEvent: TraceEvent | undefined;
    let nearestDeltaCycles: number | undefined;
    for (const fetch of fetchesByPc.get(event.expectedInstPc) ?? []) {
      const delta = fetch.cycle - expectedInstCycle;
      if (nearestDeltaCycles === undefined || Math.abs(delta) < Math.abs(nearestDeltaCycles)) {
        nearestDeltaCycles = delta;
        nearestEvent = fetch;
      }
    }
    if (nearestDeltaCycles !== undefined) {
      matchedPcFetchCount++;
      if (nearestDeltaCycles === 0) exactCycleCount++;
      nearestAbsDeltaMax = Math.max(nearestAbsDeltaMax ?? 0, Math.abs(nearestDeltaCycles));
    }
    if (samples.length < sampleLimit) {
      samples.push({
        index,
        frame: event.frame,
        expectedInstPc: event.expectedInstPc,
        expectedInstDeltaCycles: event.expectedInstDeltaCycles,
        expectedInstCycle,
        ...(nearestDeltaCycles === undefined ? {} : { nearestDeltaCycles }),
        ...(nearestEvent === undefined ? {} : { nearestEvent }),
      });
    }
  }
  return {
    commandCount,
    expectedInstCount,
    matchedPcFetchCount,
    exactCycleCount,
    nearestAbsDeltaMax,
    samples,
  };
}

function inWindow(frame: number, args: Args): boolean {
  return frame >= args.fromFrame && frame <= args.toFrame;
}

function shouldTracePc(pc: number, args: Args): boolean {
  if (!args.tracePc) return false;
  if (args.tracePcFull) return pc >= 0x8000 && pc <= 0xffff;
  return (pc >= 0x8100 && pc <= 0x81c3) ||
    (pc >= 0x8240 && pc <= 0x8280) ||
    (pc >= 0x8e20 && pc <= 0x8ec0) ||
    (pc >= 0x81e8 && pc <= 0x820f) ||
    (pc >= 0xe4e5 && pc <= 0xe543) ||
    (pc >= 0x9560 && pc <= 0x95d0) ||
    pc === 0x900a;
}

function vectorNameForAddress(addr: number): string {
  switch (addr & 0xffff) {
    case 0xfffa:
    case 0xfffb:
      return "nmi";
    case 0xfffc:
    case 0xfffd:
      return "reset";
    case 0xfffe:
    case 0xffff:
      return "irq";
    default:
      return "unknown";
  }
}

function vectorReadBusCycleOffset(addr: number): number {
  switch (addr & 0xffff) {
    case 0xfffa:
    case 0xfffc:
    case 0xfffe:
      return 5;
    case 0xfffb:
    case 0xfffd:
    case 0xffff:
      return 6;
    default:
      return 0;
  }
}

function opcodeAtPc(chip: ReturnType<typeof createSoundChip>, pc: number | undefined): number | undefined {
  if (pc === undefined) return undefined;
  if (pc >= 0x4000 && pc <= 0xffff) return chip.mmu.rom[pc - 0x4000];
  if (pc >= 0 && pc < 0x1000) return chip.mmu.ram[pc];
  return undefined;
}

function diagnosticReadCycleOffset(opcode: number | undefined): number {
  switch (opcode) {
    case 0xa5: // LDA zp
    case 0xa6: // LDX zp
    case 0xa4: // LDY zp
    case 0x24: // BIT zp
      return 2;
    case 0xb5: // LDA zp,X
    case 0xb6: // LDX zp,Y
    case 0xb4: // LDY zp,X
      return 3;
    case 0xad: // LDA abs
    case 0xae: // LDX abs
    case 0xac: // LDY abs
    case 0x2c: // BIT abs
      return 3;
    case 0xbd: // LDA abs,X
    case 0xb9: // LDA abs,Y
    case 0xbe: // LDX abs,Y
    case 0xbc: // LDY abs,X
      return 4;
    case 0xa1: // LDA (zp,X)
    case 0xb1: // LDA (zp),Y
      return 5;
    default:
      return 0;
  }
}

function cpuRegisters(chip: ReturnType<typeof createSoundChip>): Pick<TraceEvent, "a" | "x" | "y" | "p" | "sp"> {
  return {
    a: hex(chip.cpu.rf.a as unknown as number, 2),
    x: hex(chip.cpu.rf.x as unknown as number, 2),
    y: hex(chip.cpu.rf.y as unknown as number, 2),
    p: hex(chip.cpu.rf.p as unknown as number, 2),
    sp: hex(chip.cpu.rf.sp as unknown as number, 2),
  };
}

function serializeYmWrite(event: ChipWriteEvent): TraceEvent {
  return {
    kind: event.kind === "pokey" ? "pokeyWrite" : "ymWrite",
    frame: event.frame ?? -1,
    cycle: event.cycle,
    cycleInFrame: event.cycleInFrame ?? -1,
    pc: hex(event.pc, 4),
    reg: hex(event.reg, 2),
    val: hex(event.val, 2),
  };
}

function serializeIrqState(event: SoundCpuStepEvent, fallbackFrame: number): TraceEvent {
  const frame = event.frame ?? fallbackFrame;
  return {
    kind: "irqState",
    frame,
    cycle: event.startCycle,
    cycleInFrame: event.startCycleInFrame ?? -1,
    actualCycle: event.endCycle,
    ...(event.endCycleInFrame === undefined ? {} : { actualCycleInFrame: event.endCycleInFrame }),
    pc: hex(event.pc, 4),
    ...(event.opcode === undefined ? {} : { opcode: hex(event.opcode, 2) }),
    nextPc: hex(event.nextPc, 4),
    ...(event.interruptService === undefined ? {} : { interruptService: event.interruptService }),
    nmiBefore: event.nmiBefore,
    irqBefore: event.irqBefore,
    irqWillServiceBefore: event.irqWillServiceBefore,
    ymIrqPinBefore: event.ymIrqPinBefore,
    timerAOverflowBefore: event.timerAOverflowBefore,
    timerAIrqEnableBefore: event.timerAIrqEnableBefore,
    timerACounterBefore: event.timerACounterBefore,
    timerAAccumulatorBefore: event.timerAAccumulatorBefore,
    ...(event.pendingYmIrqAssertionDelayBefore === undefined
      ? {}
      : { pendingYmIrqAssertionDelayBefore: event.pendingYmIrqAssertionDelayBefore }),
    ...(event.pendingYmIrqInstructionDelayBefore === undefined
      ? {}
      : { pendingYmIrqInstructionDelayBefore: event.pendingYmIrqInstructionDelayBefore }),
    nmiAfter: event.nmiAfter,
    irqAfter: event.irqAfter,
    ymIrqPinAfter: event.ymIrqPinAfter,
    timerAOverflowAfter: event.timerAOverflowAfter,
    timerAIrqEnableAfter: event.timerAIrqEnableAfter,
    timerACounterAfter: event.timerACounterAfter,
    timerAAccumulatorAfter: event.timerAAccumulatorAfter,
    ...(event.pendingYmIrqAssertionDelayAfter === undefined
      ? {}
      : { pendingYmIrqAssertionDelayAfter: event.pendingYmIrqAssertionDelayAfter }),
    ...(event.pendingYmIrqInstructionDelayAfter === undefined
      ? {}
      : { pendingYmIrqInstructionDelayAfter: event.pendingYmIrqInstructionDelayAfter }),
  };
}

function main(): void {
  const args = parseArgs();
  if (args.toFrame < args.fromFrame) throw new Error("--to must be >= --from");
  if (args.frames <= args.toFrame) args.frames = args.toFrame + 1;

  const rom421 = new Uint8Array(readFileSync("/tmp/sound-roms/136033.421"));
  const rom422 = new Uint8Array(readFileSync("/tmp/sound-roms/136033.422"));
  const tape = loadCmdTape(JSON.parse(readFileSync(args.cmdTape, "utf8")));
  const events: TraceEvent[] = [];
  let currentFrame = -1;
  let currentFrameStartCycle = 0;
  const replyAckReplay = createMainReplyAckReplayForTape(args.cmdTape, args.replyAckTape, {
    useEmbedded: args.useEmbeddedReplyAckTape,
  });
  const mainReplyAckCycle = replyAckReplay === undefined
    ? undefined
    : (event: MainReplyWriteEvent): number | undefined => {
      const ackCycle = replyAckReplay.schedule(event);
      const frame = event.frame ?? currentFrame;
      if (ackCycle !== undefined && Number.isFinite(ackCycle) && frame >= 0 && inWindow(frame, args)) {
        events.push({
          kind: "mainReplyAck",
          frame,
          cycle: ackCycle,
          cycleInFrame: event.cycleInFrame === undefined
            ? ackCycle - currentFrameStartCycle
            : event.cycleInFrame + (ackCycle - event.cycle),
          soundPc: hex(event.pc, 4),
          addr: hex(0xfc0000, 6),
          val: hex(event.val, 2),
        });
      }
      return ackCycle;
    };
  const createTraceableSoundChip = createSoundChip as (
    cfg: Parameters<typeof createSoundChip>[0] & {
      readonly onCpuStep?: (event: SoundCpuStepEvent) => void;
    },
  ) => ReturnType<typeof createSoundChip>;
  const chip = createTraceableSoundChip({
    roms: { rom421, rom422 },
    ...(args.statusBase === undefined ? {} : { statusBase: as_u8(args.statusBase) }),
    mainReplyAckDelayCycles: args.replyAckDelayCycles,
    ...(mainReplyAckCycle === undefined ? {} : { mainReplyAckCycle }),
    ...(args.ymWriteEventCycleOffsetCycles === 0
      ? {}
      : { ymWriteEventCycleOffsetCycles: args.ymWriteEventCycleOffsetCycles }),
    ...(args.ymWriteEventCycleOffsetRegs.size === 0
      ? {}
      : { ymWriteEventCycleOffsetByReg: args.ymWriteEventCycleOffsetRegs }),
    ...(args.ymWriteEventCycleOffsetMatches.length === 0
      ? {}
      : { ymWriteEventCycleOffsetMatches: args.ymWriteEventCycleOffsetMatches }),
    ...(args.irqServiceDelayCycles > 0 ? { irqServiceDelayCycles: args.irqServiceDelayCycles } : {}),
    ...(args.ymIrqAssertionDelayCycles > 0
      ? { ymIrqAssertionDelayCycles: args.ymIrqAssertionDelayCycles }
      : {}),
    ...(args.ymIrqNewAssertionInstructionDelay > 0
      ? { ymIrqNewAssertionInstructionDelay: args.ymIrqNewAssertionInstructionDelay }
      : {}),
    ...(args.deferYmTimerControlWriteTiming ? { deferYmTimerControlWriteTiming: true } : {}),
    ...(args.traceIrqState
      ? {
        onCpuStep: (event: SoundCpuStepEvent): void => {
          const frame = event.frame ?? currentFrame;
          if (frame < 0 || !inWindow(frame, args)) return;
          events.push(serializeIrqState(event, frame));
        },
      }
      : {}),
  });
  chip.commandNmiDelayInstructions = Math.max(0, Math.trunc(args.commandNmiDelayInstructions));
  chip.ym2151.timerAStartDelayYmCycles = Math.trunc(args.timerAStartDelayCycles * 2);
  chip.ym2151.timerAHoldWhileOverflow = args.timerAHoldWhileOverflow;
  const statusReplay = args.statusTape === undefined
    ? undefined
    : args.statusTapeMode === "frame"
      ? installSoundStatusFrameReplay(chip, args.statusTape, loadSoundStatusReads(args.statusTape), () =>
        currentFrame < 0 ? undefined : currentFrame, { valueMode: args.statusValueMode })
      : installSoundStatusReplay(chip, args.statusTape, loadSoundStatusReads(args.statusTape), { valueMode: args.statusValueMode });
  const currentCycleInFrame = (): number =>
    chip.cpu.cycles - (chip.diagnosticFrameStartCycle ?? currentFrameStartCycle);
  const tracedReadTiming = (pc: number): Pick<TraceEvent, "cycle" | "cycleInFrame" | "actualCycle" | "actualCycleInFrame" | "readCycleOffset"> => {
    const readCycleOffset = diagnosticReadCycleOffset(opcodeAtPc(chip, pc));
    const actualCycle = chip.cpu.cycles;
    const actualCycleInFrame = currentCycleInFrame();
    const cycle = Math.max(0, actualCycle + readCycleOffset);
    const cycleInFrame = cycle - (chip.diagnosticFrameStartCycle ?? currentFrameStartCycle);
    return {
      cycle,
      cycleInFrame,
      ...(readCycleOffset === 0
        ? {}
        : { actualCycle, actualCycleInFrame, readCycleOffset }),
    };
  };
  const originalRead8 = chip.mmu.read8;
  chip.mmu.read8 = (addr: u16): u8 => {
    const value = originalRead8(addr);
    const addrNum = addr as unknown as number;
    if (args.traceZpMode !== "write" &&
      addrNum <= 0xff && args.traceZpAddrs.has(addrNum) && currentFrame >= 0 && inWindow(currentFrame, args)) {
      const pc = chip.cpu.lastOpcodePc ?? (chip.cpu.rf.pc as number);
      const timing = tracedReadTiming(pc);
      events.push({
        kind: "zpRead",
        frame: currentFrame,
        ...timing,
        pc: hex(pc, 4),
        ...cpuRegisters(chip),
        addr: hex(addrNum, 2),
        val: hex(value as unknown as number, 2),
      });
    }
    if (args.traceRamMode !== "write" &&
      addrNum < 0x1000 && args.traceRamAddrs.has(addrNum) && currentFrame >= 0 && inWindow(currentFrame, args)) {
      const pc = chip.cpu.lastOpcodePc ?? (chip.cpu.rf.pc as number);
      const timing = tracedReadTiming(pc);
      events.push({
        kind: "ramRead",
        frame: currentFrame,
        ...timing,
        pc: hex(pc, 4),
        ...cpuRegisters(chip),
        addr: hex(addrNum, 4),
        val: hex(value as unknown as number, 2),
      });
    }
    if (currentFrame >= 0 && inWindow(currentFrame, args) &&
      addrNum === chip.cpu.lastOpcodePc && shouldTracePc(addrNum, args)) {
      events.push({
        kind: "pcFetch",
        frame: currentFrame,
        cycle: chip.cpu.cycles,
        cycleInFrame: currentCycleInFrame(),
        pc: hex(addrNum, 4),
        opcode: hex(value as unknown as number, 2),
        ...cpuRegisters(chip),
      });
    }
    if (args.traceVectors && addrNum >= 0xfffa && addrNum <= 0xffff &&
      currentFrame >= 0 && inWindow(currentFrame, args)) {
      const pc = chip.cpu.lastOpcodePc ?? (chip.cpu.rf.pc as number);
      const cycleOffset = vectorReadBusCycleOffset(addrNum);
      const cycle = chip.cpu.cycles + cycleOffset;
      events.push({
        kind: "vectorRead",
        frame: currentFrame,
        cycle,
        cycleInFrame: cycle - (chip.diagnosticFrameStartCycle ?? currentFrameStartCycle),
        pc: hex(pc, 4),
        ...cpuRegisters(chip),
        addr: hex(addrNum, 4),
        val: hex(value as unknown as number, 2),
        vector: vectorNameForAddress(addrNum),
      });
    }
    if ((addrNum === 0x1810 || addrNum === 0x1820) && currentFrame >= 0 && inWindow(currentFrame, args)) {
      const pc = chip.cpu.lastOpcodePc ?? (chip.cpu.rf.pc as number);
      const timing = tracedReadTiming(pc);
      events.push({
        kind: addrNum === 0x1810 ? "cmdRead" : "statusRead",
        frame: currentFrame,
        ...timing,
        pc: hex(pc, 4),
        ...cpuRegisters(chip),
        addr: hex(addrNum, 4),
        val: hex(value as unknown as number, 2),
      });
    }
    if (args.traceYmStatus && (addrNum === 0x1800 || addrNum === 0x1801) &&
      currentFrame >= 0 && inWindow(currentFrame, args)) {
      const pc = chip.cpu.lastOpcodePc ?? (chip.cpu.rf.pc as number);
      const timing = tracedReadTiming(pc);
      events.push({
        kind: "ymStatusRead",
        frame: currentFrame,
        ...timing,
        pc: hex(pc, 4),
        ...cpuRegisters(chip),
        addr: hex(addrNum, 4),
        val: hex(value as unknown as number, 2),
      });
    }
    return value;
  };
  const originalWrite8 = chip.mmu.write8;
  chip.mmu.write8 = (addr: u16, value: u8): void => {
    const addrNum = addr as unknown as number;
    const pc = chip.cpu.lastOpcodePc ?? (chip.cpu.rf.pc as number);
    const cycle = chip.cpu.cycles;
    const cycleInFrame = currentCycleInFrame();
    const regs = cpuRegisters(chip);
    originalWrite8(addr, value);
    if (args.traceZpMode !== "read" &&
      addrNum <= 0xff && args.traceZpAddrs.has(addrNum) && currentFrame >= 0 && inWindow(currentFrame, args)) {
      events.push({
        kind: "zpWrite",
        frame: currentFrame,
        cycle,
        cycleInFrame,
        pc: hex(pc, 4),
        ...regs,
        addr: hex(addrNum, 2),
        val: hex(value as unknown as number, 2),
      });
    }
    if (args.traceRamMode !== "read" &&
      addrNum < 0x1000 && args.traceRamAddrs.has(addrNum) && currentFrame >= 0 && inWindow(currentFrame, args)) {
      events.push({
        kind: "ramWrite",
        frame: currentFrame,
        cycle,
        cycleInFrame,
        pc: hex(pc, 4),
        ...regs,
        addr: hex(addrNum, 4),
        val: hex(value as unknown as number, 2),
      });
    }
    if (addrNum === 0x1810 && currentFrame >= 0 && inWindow(currentFrame, args)) {
      events.push({
        kind: "replyWrite",
        frame: currentFrame,
        cycle,
        cycleInFrame,
        pc: hex(pc, 4),
        ...regs,
        addr: hex(addrNum, 4),
        val: hex(value as unknown as number, 2),
      });
    }
    if (addrNum >= 0x1820 && addrNum <= 0x1827 && currentFrame >= 0 && inWindow(currentFrame, args)) {
      events.push({
        kind: "latchWrite",
        frame: currentFrame,
        cycle,
        cycleInFrame,
        pc: hex(pc, 4),
        ...regs,
        addr: hex(addrNum, 4),
        val: hex(value as unknown as number, 2),
      });
    }
  };

  for (let frame = 0; frame < args.frames; frame++) {
    currentFrame = frame;
    currentFrameStartCycle = chip.cpu.cycles;
    const commandCycleOffsetCycles =
      args.commandCycleOffsetStartFrame === undefined || frame >= args.commandCycleOffsetStartFrame
        ? args.commandCycleOffsetCycles
        : 0;
    const tickOpts: TickOptionsWithSubmit = {
      autoReleaseReset: true,
      drainReplies: true,
      resetReleaseDelayCycles: args.resetReleaseDelayCycles,
      resetFirstFetchDelayAfterCommandCycles: args.resetFirstFetchDelayAfterCommandCycles,
      commandNmiSampleCycle: args.commandNmiSampleCycle,
      commandNmiBoundaryDelayInstructions: args.commandNmiBoundaryDelayInstructions,
      ...(args.commandNmiDelayMatches.length === 0 && args.commandNmiDelayChipWriteBoundaryInstructions === undefined
        && args.commandNmiDelayCompletedChipWritePreemptions === undefined
        ? {}
        : {
          commandNmiDelayOverride: (event: {
            readonly frame: number;
            readonly byte: number;
            readonly cycleInFrame: number;
            readonly currentChipIoStore?: unknown;
            readonly preemptedChipWrite?: {
              readonly pc?: number;
              readonly completedInstructionBeforeTarget?: boolean;
            };
          }) => commandNmiDelayOverrideForArgs(args, event),
        }),
      commandCycleOffsetCycles,
      ...(args.commandPreemptChipWriteLookaheadCycles > 0
        ? { commandPreemptChipWriteLookaheadCycles: args.commandPreemptChipWriteLookaheadCycles }
        : {}),
      ...(args.commandPreemptChipWriteBeforeOnly ? { commandPreemptChipWriteBeforeOnly: true } : {}),
      ...(args.commandPreemptChipWritePcs.size === 0
        ? {}
        : { commandPreemptChipWritePcs: args.commandPreemptChipWritePcs }),
      ...(args.commandPreemptChipWriteCompleteBeforeTarget
        ? { commandPreemptChipWriteCompleteBeforeTarget: true }
        : {}),
      ...(args.commandPreemptPendingIrqLookaheadCycles > 0
        ? { commandPreemptPendingIrqLookaheadCycles: args.commandPreemptPendingIrqLookaheadCycles }
        : {}),
      onCommandSubmit: (event) => {
        if (!inWindow(event.frame, args)) return;
        const submitEvent = event as typeof event & {
          readonly actualCycle?: number;
          readonly actualCycleInFrame?: number;
        };
        const traceEvent: TraceEvent = {
          kind: "cmdSubmit",
          frame: event.frame,
          cycle: event.cycle,
          cycleInFrame: event.cycleInFrame,
          byte: hex(event.byte, 2),
          soundPc: hex(chip.cpu.rf.pc as number, 4),
          ...(event.expectedSoundPc === undefined ? {} : { expectedSoundPc: hex(event.expectedSoundPc, 4) }),
          ...(event.expectedSoundA === undefined ? {} : { expectedSoundA: hex(event.expectedSoundA, 2) }),
          ...(event.expectedSoundX === undefined ? {} : { expectedSoundX: hex(event.expectedSoundX, 2) }),
          ...(event.expectedSoundY === undefined ? {} : { expectedSoundY: hex(event.expectedSoundY, 2) }),
          ...(event.expectedSoundP === undefined ? {} : { expectedSoundP: hex(event.expectedSoundP, 2) }),
          ...(event.expectedSoundSp === undefined ? {} : { expectedSoundSp: hex(event.expectedSoundSp, 2) }),
          ...(event.expectedInstPc === undefined ? {} : { expectedInstPc: hex(event.expectedInstPc, 4) }),
          ...(event.expectedInstOpcode === undefined ? {} : { expectedInstOpcode: hex(event.expectedInstOpcode, 2) }),
          ...(event.expectedInstDeltaCycles === undefined
            ? {}
            : { expectedInstDeltaCycles: event.expectedInstDeltaCycles }),
          ...(event.expectedNextChronoInstPc === undefined
            ? {}
            : { expectedNextChronoInstPc: hex(event.expectedNextChronoInstPc, 4) }),
          ...(event.expectedNextChronoInstOpcode === undefined
            ? {}
            : { expectedNextChronoInstOpcode: hex(event.expectedNextChronoInstOpcode, 2) }),
          ...(event.expectedNextChronoInstDeltaCycles === undefined
            ? {}
            : { expectedNextChronoInstDeltaCycles: event.expectedNextChronoInstDeltaCycles }),
          ...(chip.lastStepPc === undefined ? {} : { lastStepPc: hex(chip.lastStepPc, 4) }),
          ...(chip.lastStepStartCycle === undefined ? {} : { lastStepStartCycle: chip.lastStepStartCycle }),
          ...(chip.lastStepEndCycle === undefined ? {} : { lastStepEndCycle: chip.lastStepEndCycle }),
          ...cpuRegisters(chip),
          commandNmiDelayInstructions: event.commandNmiDelayInstructions,
        };
        if (event.preemptedChipWrite !== undefined) {
          const preempted = event.preemptedChipWrite as typeof event.preemptedChipWrite & {
            readonly completedInstructionBeforeTarget?: boolean;
          };
          (traceEvent as { preemptedChipWrite: NonNullable<TraceEvent["preemptedChipWrite"]> }).preemptedChipWrite = {
            pc: hex(preempted.pc, 4),
            opcode: hex(preempted.opcode, 2),
            address: hex(preempted.address, 4),
            stepStart: preempted.stepStart,
            stepEnd: preempted.stepEnd,
            writeCycle: preempted.writeCycle,
            targetDeltaFromWrite: preempted.targetDeltaFromWrite,
            ...(preempted.completedInstructionBeforeTarget === true
              ? { completedInstructionBeforeTarget: true }
              : {}),
          };
        }
        if (submitEvent.actualCycle !== undefined) {
          (traceEvent as { actualCycle: number }).actualCycle = submitEvent.actualCycle;
        }
        if (submitEvent.actualCycleInFrame !== undefined) {
          (traceEvent as { actualCycleInFrame: number }).actualCycleInFrame = submitEvent.actualCycleInFrame;
        }
        events.push(traceEvent);
      },
    };
    tickFrameWithTape(chip, tape, frame, tickOpts);
    for (const event of drainChipWriteEvents(chip)) {
      if ((event.kind === "ym2151" || event.kind === "pokey") && event.frame !== undefined && inWindow(event.frame, args)) {
        events.push(serializeYmWrite(event));
      }
    }
  }

  const commandExpectedState = commandExpectedStateSummary(events);
  const commandInstContext = commandInstContextSummary(events);
  const ymStatus = ymStatusSummary(events);
  const report = {
    fromFrame: args.fromFrame,
    toFrame: args.toFrame,
    frames: args.frames,
    cmdTape: args.cmdTape,
    cyclePreciseTape: tape.cyclePrecise,
    resetReleaseDelayCycles: args.resetReleaseDelayCycles,
    resetFirstFetchDelayAfterCommandCycles: args.resetFirstFetchDelayAfterCommandCycles,
    replyAckDelayCycles: args.replyAckDelayCycles,
    useEmbeddedReplyAckTape: args.useEmbeddedReplyAckTape,
    timerAStartDelayCycles: args.timerAStartDelayCycles,
    timerAHoldWhileOverflow: args.timerAHoldWhileOverflow,
    deferYmTimerControlWriteTiming: args.deferYmTimerControlWriteTiming,
    irqServiceDelayCycles: args.irqServiceDelayCycles,
    ymIrqAssertionDelayCycles: args.ymIrqAssertionDelayCycles,
    ymIrqNewAssertionInstructionDelay: args.ymIrqNewAssertionInstructionDelay,
    commandNmiDelayInstructions: args.commandNmiDelayInstructions,
    commandNmiSampleCycle: args.commandNmiSampleCycle,
    commandNmiBoundaryDelayInstructions: args.commandNmiBoundaryDelayInstructions,
    ...(args.commandNmiDelayMatches.length === 0 ? {} : { commandNmiDelayMatches: args.commandNmiDelayMatches }),
    ...(args.commandNmiDelayChipWriteBoundaryInstructions === undefined
      ? {}
      : { commandNmiDelayChipWriteBoundaryInstructions: args.commandNmiDelayChipWriteBoundaryInstructions }),
    ...(args.commandNmiDelayCompletedChipWritePreemptions === undefined
      ? {}
      : { commandNmiDelayCompletedChipWritePreemptions: args.commandNmiDelayCompletedChipWritePreemptions }),
    commandCycleOffsetCycles: args.commandCycleOffsetCycles,
    ...(args.commandCycleOffsetStartFrame === undefined ? {} : { commandCycleOffsetStartFrame: args.commandCycleOffsetStartFrame }),
    ...(args.commandPreemptChipWriteLookaheadCycles <= 0
      ? {}
      : { commandPreemptChipWriteLookaheadCycles: args.commandPreemptChipWriteLookaheadCycles }),
    ...(args.commandPreemptChipWriteBeforeOnly ? { commandPreemptChipWriteBeforeOnly: true } : {}),
    ...(args.commandPreemptChipWritePcs.size === 0
      ? {}
      : { commandPreemptChipWritePcs: Array.from(args.commandPreemptChipWritePcs).map((pc) => hex(pc, 4)) }),
    ...(args.commandPreemptChipWriteCompleteBeforeTarget
      ? { commandPreemptChipWriteCompleteBeforeTarget: true }
      : {}),
    ...(args.commandPreemptPendingIrqLookaheadCycles <= 0
      ? {}
      : { commandPreemptPendingIrqLookaheadCycles: args.commandPreemptPendingIrqLookaheadCycles }),
    ymWriteEventCycleOffsetCycles: args.ymWriteEventCycleOffsetCycles,
    ...(args.ymWriteEventCycleOffsetRegs.size === 0
      ? {}
      : { ymWriteEventCycleOffsetRegs: registerCycleOffsetsToJson(args.ymWriteEventCycleOffsetRegs) }),
    ...(args.ymWriteEventCycleOffsetMatches.length === 0
      ? {}
      : { ymWriteEventCycleOffsetMatches: args.ymWriteEventCycleOffsetMatches }),
    tracePc: args.tracePc,
    tracePcFull: args.tracePcFull,
    traceVectors: args.traceVectors,
    traceYmStatus: args.traceYmStatus,
    traceIrqState: args.traceIrqState,
    ...(args.traceZpAddrs.size === 0
      ? {}
      : {
        traceZpAddrs: Array.from(args.traceZpAddrs, (addr) => `0x${addr.toString(16).padStart(2, "0")}`),
        traceZpMode: args.traceZpMode,
      }),
    ...(args.traceRamAddrs.size === 0
      ? {}
      : {
        traceRamAddrs: Array.from(args.traceRamAddrs, (addr) => `0x${addr.toString(16).padStart(4, "0")}`),
        traceRamMode: args.traceRamMode,
      }),
    ...(args.statusBase === undefined ? {} : { statusBase: `0x${args.statusBase.toString(16).padStart(2, "0")}` }),
    ...(statusReplayReport(statusReplay) === undefined ? {} : { statusReplay: statusReplayReport(statusReplay) }),
    ...(mainReplyAckReplayReport(replyAckReplay) === undefined ? {} : { replyAckReplay: mainReplyAckReplayReport(replyAckReplay) }),
    commandExpectedState,
    ...(commandInstContext.expectedInstCount === 0 ? {} : { commandInstContext }),
    ...(ymStatus.readCount === 0 ? {} : { ymStatus }),
    eventCount: events.length,
    events,
  };
  mkdirSync(dirname(args.out), { recursive: true });
  writeFileSync(args.out, JSON.stringify(report, null, 2));
  console.log(`[ts_sound_window_trace] saved ${events.length} events -> ${args.out}`);
  console.log(`[ts_sound_window_trace] tape cyclePrecise=${tape.cyclePrecise} resetFrame=${tape.resetFrame ?? "n/a"}`);
  if (args.resetReleaseDelayCycles !== 0) {
    console.log(`[ts_sound_window_trace] resetReleaseDelayCycles=${args.resetReleaseDelayCycles}`);
  }
  if (args.resetFirstFetchDelayAfterCommandCycles !== 0) {
    console.log(
      `[ts_sound_window_trace] resetFirstFetchDelayAfterCommandCycles=${args.resetFirstFetchDelayAfterCommandCycles}`,
    );
  }
  if (args.replyAckDelayCycles !== 0) {
    console.log(`[ts_sound_window_trace] replyAckDelayCycles=${args.replyAckDelayCycles}`);
  }
  if (args.timerAStartDelayCycles !== 0) {
    console.log(`[ts_sound_window_trace] timerAStartDelayCycles=${args.timerAStartDelayCycles}`);
  }
  if (args.timerAHoldWhileOverflow) {
    console.log("[ts_sound_window_trace] timerAHoldWhileOverflow=true");
  }
  if (args.deferYmTimerControlWriteTiming) {
    console.log("[ts_sound_window_trace] deferYmTimerControlWriteTiming=true");
  }
  if (args.irqServiceDelayCycles !== 0) {
    console.log(`[ts_sound_window_trace] irqServiceDelayCycles=${args.irqServiceDelayCycles}`);
  }
  if (args.ymIrqAssertionDelayCycles !== 0) {
    console.log(`[ts_sound_window_trace] ymIrqAssertionDelayCycles=${args.ymIrqAssertionDelayCycles}`);
  }
  if (args.ymIrqNewAssertionInstructionDelay !== 0) {
    console.log(
      `[ts_sound_window_trace] ymIrqNewAssertionInstructionDelay=${args.ymIrqNewAssertionInstructionDelay}`,
    );
  }
  if (args.commandNmiDelayInstructions !== 0) {
    console.log(`[ts_sound_window_trace] commandNmiDelayInstructions=${args.commandNmiDelayInstructions}`);
  }
  console.log(`[ts_sound_window_trace] commandNmiSampleCycle=${args.commandNmiSampleCycle}`);
  if (args.commandNmiBoundaryDelayInstructions !== 0) {
    console.log(
      `[ts_sound_window_trace] commandNmiBoundaryDelayInstructions=${args.commandNmiBoundaryDelayInstructions}`,
    );
  }
  if (args.commandNmiDelayMatches.length > 0) {
    console.log(`[ts_sound_window_trace] commandNmiDelayMatches=${args.commandNmiDelayMatches.length}`);
  }
  if (commandExpectedState.expectedCommandCount > 0) {
    const first = commandExpectedState.firstMismatch;
    console.log(
      `[ts_sound_window_trace] commandExpectedState expected=${commandExpectedState.expectedCommandCount}/` +
        `${commandExpectedState.commandCount} mismatches=${commandExpectedState.mismatchCount}` +
        (first === undefined
          ? ""
          : ` first=#${first.index} frame=${first.event.frame} fields=${first.fields.join(",")}`),
    );
  }
  if (commandInstContext.expectedInstCount > 0) {
    const first = commandInstContext.samples[0];
    console.log(
      `[ts_sound_window_trace] commandInstContext expected=${commandInstContext.expectedInstCount}/` +
        `${commandInstContext.commandCount} matchedPcFetch=${commandInstContext.matchedPcFetchCount} ` +
        `exactCycle=${commandInstContext.exactCycleCount} maxAbsDelta=${commandInstContext.nearestAbsDeltaMax ?? "n/a"}` +
        (first === undefined || first.nearestDeltaCycles === undefined
          ? ""
          : ` first=#${first.index} frame=${first.frame} instPc=${first.expectedInstPc} nearestDelta=${first.nearestDeltaCycles}`),
    );
  }
  if (args.commandNmiDelayChipWriteBoundaryInstructions !== undefined) {
    console.log(
      `[ts_sound_window_trace] commandNmiDelayChipWriteBoundaryInstructions=${args.commandNmiDelayChipWriteBoundaryInstructions}`,
    );
  }
  if (args.commandNmiDelayCompletedChipWritePreemptions !== undefined) {
    console.log(
      `[ts_sound_window_trace] commandNmiDelayCompletedChipWritePreemptions=${args.commandNmiDelayCompletedChipWritePreemptions}`,
    );
  }
  if (args.commandCycleOffsetCycles !== 0 || args.commandCycleOffsetStartFrame !== undefined) {
    console.log(
      `[ts_sound_window_trace] commandCycleOffsetCycles=${args.commandCycleOffsetCycles}` +
        (args.commandCycleOffsetStartFrame === undefined ? "" : ` startFrame=${args.commandCycleOffsetStartFrame}`),
    );
  }
  if (args.commandPreemptChipWriteLookaheadCycles > 0) {
    console.log(`[ts_sound_window_trace] commandPreemptChipWriteLookaheadCycles=${args.commandPreemptChipWriteLookaheadCycles}`);
  }
  if (args.commandPreemptChipWritePcs.size > 0) {
    console.log(
      `[ts_sound_window_trace] commandPreemptChipWritePcs=${Array.from(args.commandPreemptChipWritePcs)
        .map((pc) => hex(pc, 4)).join(",")}`,
    );
  }
  if (args.commandPreemptChipWriteCompleteBeforeTarget) {
    console.log("[ts_sound_window_trace] commandPreemptChipWriteCompleteBeforeTarget=true");
  }
  if (args.commandPreemptChipWriteBeforeOnly) {
    console.log("[ts_sound_window_trace] commandPreemptChipWriteBeforeOnly=true");
  }
  if (args.commandPreemptPendingIrqLookaheadCycles > 0) {
    console.log(`[ts_sound_window_trace] commandPreemptPendingIrqLookaheadCycles=${args.commandPreemptPendingIrqLookaheadCycles}`);
  }
  if (args.ymWriteEventCycleOffsetCycles !== 0) {
    console.log(`[ts_sound_window_trace] ymWriteEventCycleOffsetCycles=${args.ymWriteEventCycleOffsetCycles}`);
  }
  if (args.ymWriteEventCycleOffsetRegs.size > 0) {
    console.log(
      `[ts_sound_window_trace] ymWriteEventCycleOffsetRegs=${JSON.stringify(registerCycleOffsetsToJson(args.ymWriteEventCycleOffsetRegs))}`,
    );
  }
  if (args.ymWriteEventCycleOffsetMatches.length > 0) {
    console.log(`[ts_sound_window_trace] ymWriteEventCycleOffsetMatches=${args.ymWriteEventCycleOffsetMatches.length}`);
  }
  if (!args.useEmbeddedReplyAckTape) {
    console.log("[ts_sound_window_trace] embeddedReplyAckTape=false");
  }
  if (args.traceYmStatus) {
    console.log("[ts_sound_window_trace] traceYmStatus=true");
    if (ymStatus.readCount > 0) {
      const waitPc = ymStatus.byPc["0x8ff5"];
      console.log(
        `[ts_sound_window_trace] ymStatus reads=${ymStatus.readCount} busy=${ymStatus.busyReadCount} ` +
        `timerA=${ymStatus.timerAReadCount} clear=${ymStatus.clearReadCount}`,
      );
      if (waitPc !== undefined) {
        console.log(
          `[ts_sound_window_trace] ymStatus pc=0x8ff5 reads=${waitPc.readCount} busy=${waitPc.busyReadCount} ` +
          `timerA=${waitPc.timerAReadCount} firstCycle=${waitPc.firstCycleInFrame} lastCycle=${waitPc.lastCycleInFrame}`,
        );
      }
    }
  }
  if (args.traceVectors) {
    console.log("[ts_sound_window_trace] traceVectors=true");
  }
  if (args.traceIrqState) {
    const irqEvents = events.filter((event) => event.kind === "irqState");
    const irqServices = irqEvents.filter((event) => event.interruptService === "irq");
    const firstIrq = irqServices[0];
    console.log(
      `[ts_sound_window_trace] traceIrqState=true events=${irqEvents.length} ` +
      `irqServices=${irqServices.length}` +
      (firstIrq === undefined
        ? ""
        : ` firstIrq=${firstIrq.frame}:${firstIrq.cycleInFrame} pc=${firstIrq.pc} next=${firstIrq.nextPc}`),
    );
  }
  if (args.traceZpAddrs.size > 0) {
    console.log(
      `[ts_sound_window_trace] traceZp=${Array.from(args.traceZpAddrs, (addr) =>
        `0x${addr.toString(16).padStart(2, "0")}`).join(",")} mode=${args.traceZpMode}`,
    );
  }
  if (args.traceRamAddrs.size > 0) {
    console.log(
      `[ts_sound_window_trace] traceRam=${Array.from(args.traceRamAddrs, (addr) =>
        `0x${addr.toString(16).padStart(4, "0")}`).join(",")} mode=${args.traceRamMode}`,
    );
  }
  if (statusReplay !== undefined) {
    console.log(
      `[ts_sound_window_trace] statusReplay applied=${statusReplay.appliedReadCount}/${statusReplay.mameReadCount} ` +
      `tsReads=${statusReplay.tsReadCount} exhausted=${statusReplay.exhaustedReadCount} ` +
      `baseMismatches=${statusReplay.baseMismatchCount} valueMismatches=${statusReplay.valueMismatchCount} ` +
      `mode=${statusReplay.mode} valueMode=${statusReplay.valueMode}`,
    );
  }
  if (replyAckReplay !== undefined) {
    const stats = replyAckReplay.stats;
    console.log(
      `[ts_sound_window_trace] replyAckReplay scheduled=${stats.scheduledWriteCount}/${stats.ackCount} ` +
      `exhausted=${stats.exhaustedWriteCount} skipped=${stats.skippedAckCount} source=${stats.source}`,
    );
  }
}

main();
