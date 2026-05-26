// probe-sound-window-trace-diff.ts — compare focused MAME/TS sound window traces.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

type TraceKind = "ymWrite" | "pokeyWrite";

interface Args {
  readonly mame: string;
  readonly ts: string;
  readonly kinds: TraceKind[];
  readonly report: string | undefined;
  readonly mismatchSamples: number;
  readonly pcSequenceSamples: number;
  readonly pcTransitionAnchor: number | undefined;
  readonly pcTransitionLookahead: number;
  readonly statusLookaheadPcFetches: number;
  readonly maxPayloadMismatches: number;
  readonly maxPcToWriteDeltaMismatches: number;
  readonly alignAfterFirstCommand: boolean;
  readonly sortByFrameCycle: boolean;
}

interface RawTraceEvent {
  readonly kind?: string;
  readonly frame?: unknown;
  readonly cycle?: unknown;
  readonly relativeCycle?: unknown;
  readonly cycleInFrame?: unknown;
  readonly actualCycleInFrame?: unknown;
  readonly videoCycleInFrame?: unknown;
  readonly pc?: unknown;
  readonly soundPc?: unknown;
  readonly soundA?: unknown;
  readonly soundX?: unknown;
  readonly soundY?: unknown;
  readonly soundP?: unknown;
  readonly soundSp?: unknown;
  readonly expectedSoundPc?: unknown;
  readonly expectedSoundA?: unknown;
  readonly expectedSoundX?: unknown;
  readonly expectedSoundY?: unknown;
  readonly expectedSoundP?: unknown;
  readonly expectedSoundSp?: unknown;
  readonly a?: unknown;
  readonly x?: unknown;
  readonly y?: unknown;
  readonly p?: unknown;
  readonly sp?: unknown;
  readonly curpc?: unknown;
  readonly genpc?: unknown;
  readonly ir?: unknown;
  readonly opcode?: unknown;
  readonly vector?: unknown;
  readonly addr?: unknown;
  readonly byte?: unknown;
  readonly reg?: unknown;
  readonly val?: unknown;
  readonly preemptedChipWrite?: RawPreemptedChipWrite;
}

interface RawPreemptedChipWrite {
  readonly pc?: unknown;
  readonly opcode?: unknown;
  readonly address?: unknown;
  readonly stepStart?: unknown;
  readonly stepEnd?: unknown;
  readonly writeCycle?: unknown;
  readonly targetDeltaFromWrite?: unknown;
  readonly completedInstructionBeforeTarget?: unknown;
}

interface TraceFile {
  readonly events?: RawTraceEvent[];
}

interface TraceEvent {
  readonly kind: string;
  readonly frame: number | undefined;
  readonly cycle: number | undefined;
  readonly cycleInFrame: number | undefined;
  readonly actualCycleInFrame: number | undefined;
  readonly videoCycleInFrame: number | undefined;
  readonly pc: number | undefined;
  readonly soundPc: number | undefined;
  readonly expectedSoundPc: number | undefined;
  readonly expectedSoundA: number | undefined;
  readonly expectedSoundX: number | undefined;
  readonly expectedSoundY: number | undefined;
  readonly expectedSoundP: number | undefined;
  readonly expectedSoundSp: number | undefined;
  readonly a: number | undefined;
  readonly x: number | undefined;
  readonly y: number | undefined;
  readonly p: number | undefined;
  readonly sp: number | undefined;
  readonly curpc: number | undefined;
  readonly genpc: number | undefined;
  readonly ir: number | undefined;
  readonly opcode: number | undefined;
  readonly vector: string | undefined;
  readonly addr: number | undefined;
  readonly byte: number | undefined;
  readonly reg: number | undefined;
  readonly val: number | undefined;
  readonly preemptedChipWrite: PreemptedChipWrite | undefined;
}

interface PreemptedChipWrite {
  readonly pc: number | undefined;
  readonly opcode: number | undefined;
  readonly address: number | undefined;
  readonly stepStart: number | undefined;
  readonly stepEnd: number | undefined;
  readonly writeCycle: number | undefined;
  readonly targetDeltaFromWrite: number | undefined;
  readonly completedInstructionBeforeTarget: boolean | undefined;
}

interface WriteWithFetch {
  readonly write: TraceEvent;
  readonly pcFetch: TraceEvent | undefined;
  readonly writeMinusFetch: number | undefined;
}

interface DeltaStats {
  count: number;
  min: number | undefined;
  max: number | undefined;
  maxAbs: number | undefined;
  meanAbs: number | undefined;
  counts: Record<string, number>;
}

interface KindSummary {
  readonly kind: TraceKind;
  readonly pairedCount: number;
  readonly pcFetchComparableCount: number;
  readonly mameCount: number;
  readonly tsCount: number;
  readonly unpairedCount: number;
  readonly payloadMismatchCount: number;
  readonly pcFetchMissingCount: number;
  readonly pcToWriteDeltaMismatchCount: number;
  readonly writeCycleDelta: DeltaStats;
  readonly pcFetchCycleDelta: DeltaStats;
  readonly pcToWriteDelta: DeltaStats;
  readonly mameWriteMinusFetch: DeltaStats;
  readonly tsWriteMinusFetch: DeltaStats;
  readonly writeCycleDeltaRunCount: number;
  readonly writeCycleDeltaRuns: WriteCycleDeltaRun[];
  readonly samples: SampleMismatch[];
}

interface PcFetchEvent {
  readonly frame: number | undefined;
  readonly cycleInFrame: number | undefined;
  readonly pc: number | undefined;
  readonly a: number | undefined;
  readonly x: number | undefined;
  readonly y: number | undefined;
  readonly p: number | undefined;
  readonly sp: number | undefined;
  readonly curpc: number | undefined;
  readonly genpc: number | undefined;
  readonly ir: number | undefined;
  readonly opcode: number | undefined;
}

interface PcSequenceSummary {
  readonly mode: "all" | "dropInterruptPrefetch";
  readonly mameCount: number;
  readonly tsCount: number;
  readonly pairedCount: number;
  readonly firstPcMismatch: PcSequenceMismatch | undefined;
  readonly firstStateMismatch: PcSequenceMismatch | undefined;
  readonly firstNonBaselineDelta: PcSequenceMismatch | undefined;
  readonly stateMismatchCount: number;
  readonly cycleDelta: DeltaStats;
  readonly sampleWindow: PcSequenceMismatch[];
}

interface PcSequenceMismatch {
  readonly index: number;
  readonly fields: string[];
  readonly delta: number | undefined;
  readonly samePc: boolean;
  readonly mame: SerializedPcFetch | undefined;
  readonly ts: SerializedPcFetch | undefined;
}

interface SerializedPcFetch {
  readonly frame: number | undefined;
  readonly cycleInFrame: number | undefined;
  readonly pc: string | undefined;
  readonly a: string | undefined;
  readonly x: string | undefined;
  readonly y: string | undefined;
  readonly p: string | undefined;
  readonly sp: string | undefined;
  readonly curpc: string | undefined;
  readonly genpc: string | undefined;
  readonly ir: string | undefined;
  readonly opcode: string | undefined;
}

interface PcTransition {
  readonly index: number;
  readonly from: PcFetchEvent;
  readonly to: PcFetchEvent;
  readonly cycles: number | undefined;
}

interface SerializedPcTransition {
  readonly index: number;
  readonly from: SerializedPcFetch;
  readonly to: SerializedPcFetch;
  readonly cycles: number | undefined;
}

interface PcTransitionMismatch {
  readonly anchorOccurrence: number;
  readonly offset: number;
  readonly fields: string[];
  readonly fromCycleDelta: number | undefined;
  readonly toCycleDelta: number | undefined;
  readonly durationDelta: number | undefined;
  readonly mame: SerializedPcTransition | undefined;
  readonly ts: SerializedPcTransition | undefined;
}

interface PcTransitionAnchorWindow {
  readonly anchorOccurrence: number;
  readonly anchorCycleDelta: number | undefined;
  readonly mameAnchor: SerializedPcFetch | undefined;
  readonly tsAnchor: SerializedPcFetch | undefined;
  readonly firstMismatch: PcTransitionMismatch | undefined;
  readonly samples: PcTransitionMismatch[];
}

interface PcTransitionAnchorSummary {
  readonly mode: "dropInterruptPrefetch";
  readonly anchorPc: string | undefined;
  readonly lookahead: number;
  readonly mameAnchorCount: number;
  readonly tsAnchorCount: number;
  readonly pairedAnchorCount: number;
  readonly unpairedAnchorCount: number;
  readonly mismatchWindowCount: number;
  readonly firstMismatch: PcTransitionMismatch | undefined;
  readonly windows: PcTransitionAnchorWindow[];
}

interface VectorReadEvent {
  readonly frame: number | undefined;
  readonly cycle: number | undefined;
  readonly cycleInFrame: number | undefined;
  readonly pc: number | undefined;
  readonly a: number | undefined;
  readonly x: number | undefined;
  readonly y: number | undefined;
  readonly p: number | undefined;
  readonly sp: number | undefined;
  readonly addr: number | undefined;
  readonly val: number | undefined;
  readonly vector: string | undefined;
}

interface SerializedVectorRead {
  readonly frame: number | undefined;
  readonly cycleInFrame: number | undefined;
  readonly pc: string | undefined;
  readonly a: string | undefined;
  readonly x: string | undefined;
  readonly y: string | undefined;
  readonly p: string | undefined;
  readonly sp: string | undefined;
  readonly addr: string | undefined;
  readonly val: string | undefined;
  readonly vector: string | undefined;
}

interface VectorReadMismatch {
  readonly index: number;
  readonly fields: string[];
  readonly delta: number | undefined;
  readonly mame: SerializedVectorRead | undefined;
  readonly ts: SerializedVectorRead | undefined;
}

interface VectorReadSummary {
  readonly pairedCount: number;
  readonly mameCount: number;
  readonly tsCount: number;
  readonly unpairedCount: number;
  readonly payloadMismatchCount: number;
  readonly cycleDelta: DeltaStats;
  readonly firstMismatch: VectorReadMismatch | undefined;
  readonly samples: VectorReadMismatch[];
}

interface StatusReadEvent {
  readonly frame: number | undefined;
  readonly cycle: number | undefined;
  readonly cycleInFrame: number | undefined;
  readonly pc: number | undefined;
  readonly a: number | undefined;
  readonly x: number | undefined;
  readonly y: number | undefined;
  readonly p: number | undefined;
  readonly sp: number | undefined;
  readonly addr: number | undefined;
  readonly val: number | undefined;
}

interface StatusReadSummary {
  readonly pairedCount: number;
  readonly mameCount: number;
  readonly tsCount: number;
  readonly unpairedCount: number;
  readonly payloadMismatchCount: number;
  readonly mainToSoundPendingBitMismatchCount: number;
  readonly soundToMainPendingBitMismatchCount: number;
  readonly cycleDelta: DeltaStats;
  readonly firstMismatch: StatusReadMismatch | undefined;
  readonly firstMainToSoundPendingBitMismatch: StatusReadMismatch | undefined;
  readonly firstSoundToMainPendingBitMismatch: StatusReadMismatch | undefined;
  readonly firstBranchingMismatch: StatusReadMismatch | undefined;
  readonly samples: StatusReadMismatch[];
}

interface StatusReadMismatch {
  readonly index: number;
  readonly fields: string[];
  readonly delta: number | undefined;
  readonly mame: SerializedStatusRead | undefined;
  readonly ts: SerializedStatusRead | undefined;
  readonly nextPcMismatch: PcSequenceMismatch | undefined;
}

interface SerializedStatusRead {
  readonly frame: number | undefined;
  readonly cycleInFrame: number | undefined;
  readonly pc: string | undefined;
  readonly a: string | undefined;
  readonly x: string | undefined;
  readonly y: string | undefined;
  readonly p: string | undefined;
  readonly sp: string | undefined;
  readonly addr: string | undefined;
  readonly val: string | undefined;
}

interface SampleMismatch {
  readonly index: number;
  readonly fields: string[];
  readonly mame: SerializedWriteWithFetch | undefined;
  readonly ts: SerializedWriteWithFetch | undefined;
}

interface SerializedWritePair {
  readonly mame: SerializedWriteWithFetch | undefined;
  readonly ts: SerializedWriteWithFetch | undefined;
}

interface WriteCycleDeltaRun {
  readonly startIndex: number;
  readonly endIndex: number;
  readonly count: number;
  readonly delta: number | undefined;
  readonly first: SerializedWritePair;
  readonly last: SerializedWritePair;
}

interface SerializedWriteWithFetch {
  readonly frame: number | undefined;
  readonly cycleInFrame: number | undefined;
  readonly pc: string | undefined;
  readonly reg: string | undefined;
  readonly val: string | undefined;
  readonly pcFetchCycleInFrame: number | undefined;
  readonly writeMinusFetch: number | undefined;
}

interface CommandBoundaryEvent {
  readonly frame: number | undefined;
  readonly cycle: number | undefined;
  readonly cycleInFrame: number | undefined;
  readonly actualCycleInFrame: number | undefined;
  readonly videoCycleInFrame: number | undefined;
  readonly pc: number | undefined;
  readonly soundPc: number | undefined;
  readonly expectedSoundPc: number | undefined;
  readonly expectedSoundA: number | undefined;
  readonly expectedSoundX: number | undefined;
  readonly expectedSoundY: number | undefined;
  readonly expectedSoundP: number | undefined;
  readonly expectedSoundSp: number | undefined;
  readonly a: number | undefined;
  readonly x: number | undefined;
  readonly y: number | undefined;
  readonly p: number | undefined;
  readonly sp: number | undefined;
  readonly byte: number | undefined;
  readonly preemptedChipWrite: PreemptedChipWrite | undefined;
}

interface SerializedCommandBoundary {
  readonly frame: number | undefined;
  readonly cycleInFrame: number | undefined;
  readonly actualCycleInFrame: number | undefined;
  readonly videoCycleInFrame: number | undefined;
  readonly pc: string | undefined;
  readonly soundPc: string | undefined;
  readonly expectedSoundPc: string | undefined;
  readonly expectedSoundA: string | undefined;
  readonly expectedSoundX: string | undefined;
  readonly expectedSoundY: string | undefined;
  readonly expectedSoundP: string | undefined;
  readonly expectedSoundSp: string | undefined;
  readonly a: string | undefined;
  readonly x: string | undefined;
  readonly y: string | undefined;
  readonly p: string | undefined;
  readonly sp: string | undefined;
  readonly byte: string | undefined;
  readonly preemptedChipWrite: SerializedPreemptedChipWrite | undefined;
}

interface SerializedPreemptedChipWrite {
  readonly pc: string | undefined;
  readonly opcode: string | undefined;
  readonly address: string | undefined;
  readonly stepStart: number | undefined;
  readonly stepEnd: number | undefined;
  readonly writeCycle: number | undefined;
  readonly targetDeltaFromWrite: number | undefined;
  readonly completedInstructionBeforeTarget: boolean | undefined;
}

interface CommandBoundaryMismatch {
  readonly index: number;
  readonly fields: string[];
  readonly delta: number | undefined;
  readonly mame: SerializedCommandBoundary | undefined;
  readonly ts: SerializedCommandBoundary | undefined;
}

interface CommandBoundarySummary {
  readonly pairedCount: number;
  readonly mameCount: number;
  readonly tsCount: number;
  readonly unpairedCount: number;
  readonly byteMismatchCount: number;
  readonly soundPcMismatchCount: number;
  readonly expectedStateMismatchCount: number;
  readonly cycleDelta: DeltaStats;
  readonly firstMismatch: CommandBoundaryMismatch | undefined;
  readonly samples: CommandBoundaryMismatch[];
}

interface SerializedTracePoint {
  readonly kind: string | undefined;
  readonly frame: number | undefined;
  readonly cycleInFrame: number | undefined;
  readonly pc: string | undefined;
  readonly addr: string | undefined;
  readonly reg: string | undefined;
  readonly val: string | undefined;
  readonly vector: string | undefined;
}

export interface CommandNmiWindow {
  readonly command: CommandBoundaryEvent;
  readonly nmiVector: TraceEvent | undefined;
  readonly cmdRead: TraceEvent | undefined;
  readonly firstYmWrite: TraceEvent | undefined;
  readonly firstPokeyWrite: TraceEvent | undefined;
  readonly firstChipWrite: TraceEvent | undefined;
  readonly nmiFromCommand: number | undefined;
  readonly cmdReadFromCommand: number | undefined;
  readonly cmdReadFromNmi: number | undefined;
  readonly firstYmWriteFromCommand: number | undefined;
  readonly firstYmWriteFromNmi: number | undefined;
  readonly firstChipWriteFromCommand: number | undefined;
  readonly firstChipWriteFromNmi: number | undefined;
}

interface SerializedCommandNmiWindow {
  readonly command: SerializedCommandBoundary;
  readonly nmiVector: SerializedTracePoint | undefined;
  readonly cmdRead: SerializedTracePoint | undefined;
  readonly firstYmWrite: SerializedTracePoint | undefined;
  readonly firstPokeyWrite: SerializedTracePoint | undefined;
  readonly firstChipWrite: SerializedTracePoint | undefined;
  readonly nmiFromCommand: number | undefined;
  readonly cmdReadFromCommand: number | undefined;
  readonly cmdReadFromNmi: number | undefined;
  readonly firstYmWriteFromCommand: number | undefined;
  readonly firstYmWriteFromNmi: number | undefined;
  readonly firstChipWriteFromCommand: number | undefined;
  readonly firstChipWriteFromNmi: number | undefined;
}

interface CommandNmiWindowMismatch {
  readonly index: number;
  readonly fields: string[];
  readonly nmiFromCommandDelta: number | undefined;
  readonly cmdReadFromNmiDelta: number | undefined;
  readonly firstChipWriteFromNmiDelta: number | undefined;
  readonly mame: SerializedCommandNmiWindow | undefined;
  readonly ts: SerializedCommandNmiWindow | undefined;
}

export interface CommandNmiSummary {
  readonly pairedCount: number;
  readonly mameCount: number;
  readonly tsCount: number;
  readonly unpairedCount: number;
  readonly nmiMissingCount: number;
  readonly cmdReadMissingCount: number;
  readonly firstChipWriteMissingCount: number;
  readonly firstChipWriteKindMismatchCount: number;
  readonly firstChipWritePayloadMismatchCount: number;
  readonly firstChipWriteCrossFrameCount: {
    readonly mame: number;
    readonly ts: number;
    readonly mismatch: number;
  };
  readonly nmiFromCommandDelta: DeltaStats;
  readonly cmdReadFromNmiDelta: DeltaStats;
  readonly firstChipWriteFromNmiDelta: DeltaStats;
  readonly firstMismatch: CommandNmiWindowMismatch | undefined;
  readonly samples: CommandNmiWindowMismatch[];
}

interface ReplyHandshakeEvent {
  readonly frame: number | undefined;
  readonly cycle: number | undefined;
  readonly cycleInFrame: number | undefined;
  readonly pc: number | undefined;
  readonly soundPc: number | undefined;
  readonly addr: number | undefined;
  readonly val: number | undefined;
}

interface SerializedReplyHandshakeEvent {
  readonly frame: number | undefined;
  readonly cycleInFrame: number | undefined;
  readonly pc: string | undefined;
  readonly soundPc: string | undefined;
  readonly addr: string | undefined;
  readonly val: string | undefined;
}

interface ReplyHandshakeWindow {
  readonly replyWrite: ReplyHandshakeEvent;
  readonly ack: ReplyHandshakeEvent | undefined;
  readonly ackDelayCycles: number | undefined;
  readonly statusReadCountBeforeAck: number;
  readonly statusReadSoundPendingCountBeforeAck: number;
  readonly firstStatusReadAfterWrite: StatusReadEvent | undefined;
  readonly firstStatusReadWithSoundPending: StatusReadEvent | undefined;
  readonly firstStatusReadWithoutSoundPendingBeforeAck: StatusReadEvent | undefined;
}

interface SerializedReplyHandshakeWindow {
  readonly replyWrite: SerializedReplyHandshakeEvent;
  readonly ack: SerializedReplyHandshakeEvent | undefined;
  readonly ackDelayCycles: number | undefined;
  readonly statusReadCountBeforeAck: number;
  readonly statusReadSoundPendingCountBeforeAck: number;
  readonly firstStatusReadAfterWrite: SerializedStatusRead | undefined;
  readonly firstStatusReadWithSoundPending: SerializedStatusRead | undefined;
  readonly firstStatusReadWithoutSoundPendingBeforeAck: SerializedStatusRead | undefined;
}

interface ReplyHandshakeMismatch {
  readonly index: number;
  readonly fields: string[];
  readonly replyWriteDelta: number | undefined;
  readonly ackDelayDelta: number | undefined;
  readonly mame: SerializedReplyHandshakeWindow | undefined;
  readonly ts: SerializedReplyHandshakeWindow | undefined;
}

interface ReplyHandshakeSummary {
  readonly pairedCount: number;
  readonly mameReplyWriteCount: number;
  readonly tsReplyWriteCount: number;
  readonly mameAckCount: number;
  readonly tsAckCount: number;
  readonly unpairedReplyWriteCount: number;
  readonly replyValueMismatchCount: number;
  readonly soundPendingPollVisibilityMismatchCount: number;
  readonly replyWriteCycleDelta: DeltaStats;
  readonly mameAckDelay: DeltaStats;
  readonly tsAckDelay: DeltaStats;
  readonly ackDelayDelta: DeltaStats;
  readonly firstMismatch: ReplyHandshakeMismatch | undefined;
  readonly samples: ReplyHandshakeMismatch[];
}

type ZeroPageKind = "zpRead" | "zpWrite";

interface ZeroPageEvent {
  readonly kind: ZeroPageKind;
  readonly frame: number | undefined;
  readonly cycle: number | undefined;
  readonly cycleInFrame: number | undefined;
  readonly pc: number | undefined;
  readonly a: number | undefined;
  readonly x: number | undefined;
  readonly y: number | undefined;
  readonly p: number | undefined;
  readonly sp: number | undefined;
  readonly addr: number;
  readonly val: number | undefined;
}

interface SerializedZeroPageEvent {
  readonly frame: number | undefined;
  readonly cycleInFrame: number | undefined;
  readonly pc: string | undefined;
  readonly a: string | undefined;
  readonly x: string | undefined;
  readonly y: string | undefined;
  readonly p: string | undefined;
  readonly sp: string | undefined;
  readonly addr: string;
  readonly val: string | undefined;
}

interface ZeroPageMismatch {
  readonly index: number;
  readonly fields: string[];
  readonly delta: number | undefined;
  readonly mame: SerializedZeroPageEvent | undefined;
  readonly ts: SerializedZeroPageEvent | undefined;
}

interface ZeroPageGroupSummary {
  readonly kind: ZeroPageKind;
  readonly addr: string;
  readonly pairedCount: number;
  readonly mameCount: number;
  readonly tsCount: number;
  readonly unpairedCount: number;
  readonly valueMismatchCount: number;
  readonly pcMismatchCount: number;
  readonly stateMismatchCount: number;
  readonly cycleDelta: DeltaStats;
  readonly firstMismatch: ZeroPageMismatch | undefined;
  readonly samples: ZeroPageMismatch[];
}

interface ZeroPageSummary {
  readonly groupCount: number;
  readonly groups: ZeroPageGroupSummary[];
}

function readArg(args: string[], name: string): string | undefined {
  const idx = args.indexOf(name);
  return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : undefined;
}

function parseKinds(value: string | undefined): TraceKind[] {
  const raw = value ?? "ymWrite,pokeyWrite";
  return raw.split(",")
    .map((part) => part.trim())
    .filter((part): part is TraceKind => part === "ymWrite" || part === "pokeyWrite");
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  const mame = readArg(args, "--mame");
  const ts = readArg(args, "--ts");
  if (mame === undefined) throw new Error("--mame is required");
  if (ts === undefined) throw new Error("--ts is required");
  const kinds = parseKinds(readArg(args, "--kinds"));
  if (kinds.length === 0) throw new Error("--kinds must include ymWrite and/or pokeyWrite");
  return {
    mame,
    ts,
    kinds,
    report: readArg(args, "--report"),
    mismatchSamples: Math.max(1, Number(readArg(args, "--mismatch-samples") ?? "8")),
    pcSequenceSamples: Math.max(1, Number(readArg(args, "--pc-sequence-samples") ?? "12")),
    pcTransitionAnchor: parseNumber(readArg(args, "--pc-transition-anchor")),
    pcTransitionLookahead: Math.max(1, Number(readArg(args, "--pc-transition-lookahead") ?? "256")),
    statusLookaheadPcFetches: Math.max(1, Number(readArg(args, "--status-lookahead-pc-fetches") ?? "32")),
    maxPayloadMismatches: Math.max(0, Number(readArg(args, "--max-payload-mismatches") ?? "0")),
    maxPcToWriteDeltaMismatches: Math.max(0, Number(readArg(args, "--max-pc-to-write-delta-mismatches") ?? "0")),
    alignAfterFirstCommand: args.includes("--align-after-first-command"),
    sortByFrameCycle: args.includes("--sort-by-frame-cycle"),
  };
}

function parseNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return undefined;
  const parsed = Number.parseInt(value, value.startsWith("0x") ? 16 : 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parsePreemptedChipWrite(value: RawPreemptedChipWrite | undefined): PreemptedChipWrite | undefined {
  if (value === undefined) return undefined;
  return {
    pc: parseNumber(value.pc),
    opcode: parseNumber(value.opcode),
    address: parseNumber(value.address),
    stepStart: parseNumber(value.stepStart),
    stepEnd: parseNumber(value.stepEnd),
    writeCycle: parseNumber(value.writeCycle),
    targetDeltaFromWrite: parseNumber(value.targetDeltaFromWrite),
    completedInstructionBeforeTarget:
      typeof value.completedInstructionBeforeTarget === "boolean"
        ? value.completedInstructionBeforeTarget
        : undefined,
  };
}

function readTrace(path: string): TraceEvent[] {
  const parsed = JSON.parse(readFileSync(path, "utf8")) as TraceFile;
  return (parsed.events ?? []).map((event) => ({
    kind: event.kind ?? "",
    frame: parseNumber(event.frame),
    cycle: parseNumber(event.cycle) ?? parseNumber(event.relativeCycle),
    cycleInFrame: parseNumber(event.videoCycleInFrame) ?? parseNumber(event.cycleInFrame),
    actualCycleInFrame: parseNumber(event.actualCycleInFrame),
    videoCycleInFrame: parseNumber(event.videoCycleInFrame),
    pc: parseNumber(event.pc),
    soundPc: parseNumber(event.soundPc),
    expectedSoundPc: parseNumber(event.expectedSoundPc),
    expectedSoundA: parseNumber(event.expectedSoundA) ?? parseNumber(event.soundA),
    expectedSoundX: parseNumber(event.expectedSoundX) ?? parseNumber(event.soundX),
    expectedSoundY: parseNumber(event.expectedSoundY) ?? parseNumber(event.soundY),
    expectedSoundP: parseNumber(event.expectedSoundP) ?? parseNumber(event.soundP),
    expectedSoundSp: parseNumber(event.expectedSoundSp) ?? parseNumber(event.soundSp),
    a: parseNumber(event.a),
    x: parseNumber(event.x),
    y: parseNumber(event.y),
    p: parseNumber(event.p),
    sp: parseNumber(event.sp),
    curpc: parseNumber(event.curpc),
    genpc: parseNumber(event.genpc),
    ir: parseNumber(event.ir),
    opcode: parseNumber(event.opcode),
    vector: typeof event.vector === "string" ? event.vector : undefined,
    addr: parseNumber(event.addr),
    byte: parseNumber(event.byte),
    reg: parseNumber(event.reg),
    val: parseNumber(event.val),
    preemptedChipWrite: parsePreemptedChipWrite(event.preemptedChipWrite),
  }));
}

function isCommandBoundary(event: TraceEvent): boolean {
  return event.kind === "mainCmdWrite" || event.kind === "cmdSubmit";
}

function trimBeforeFirstCommand(events: readonly TraceEvent[]): TraceEvent[] {
  const index = events.findIndex(isCommandBoundary);
  return index < 0 ? events.slice() : events.slice(index);
}

function traceKindOrder(kind: string): number {
  switch (kind) {
    case "mainCmdWrite":
    case "cmdSubmit":
      return 0;
    case "pcFetch":
    case "vectorRead":
      return 1;
    case "statusRead":
    case "cmdRead":
      return 2;
    case "ymWrite":
    case "pokeyWrite":
      return 3;
    default:
      return 4;
  }
}

function sortTraceByFrameCycle(events: readonly TraceEvent[]): TraceEvent[] {
  return events
    .map((event, index) => ({ event, index }))
    .sort((a, b) =>
      (a.event.frame ?? Number.MAX_SAFE_INTEGER) - (b.event.frame ?? Number.MAX_SAFE_INTEGER) ||
      (a.event.cycleInFrame ?? Number.MAX_SAFE_INTEGER) - (b.event.cycleInFrame ?? Number.MAX_SAFE_INTEGER) ||
      traceKindOrder(a.event.kind) - traceKindOrder(b.event.kind) ||
      a.index - b.index)
    .map(({ event }) => event);
}

function makeStats(): DeltaStats {
  return {
    count: 0,
    min: undefined,
    max: undefined,
    maxAbs: undefined,
    meanAbs: undefined,
    counts: {},
  };
}

function addDelta(stats: DeltaStats, absSum: { value: number }, delta: number): void {
  const abs = Math.abs(delta);
  stats.count++;
  stats.min = stats.min === undefined ? delta : Math.min(stats.min, delta);
  stats.max = stats.max === undefined ? delta : Math.max(stats.max, delta);
  stats.maxAbs = stats.maxAbs === undefined ? abs : Math.max(stats.maxAbs, abs);
  absSum.value += abs;
  stats.meanAbs = absSum.value / stats.count;
  const key = String(delta);
  stats.counts[key] = (stats.counts[key] ?? 0) + 1;
}

function sameFrame(a: TraceEvent, b: TraceEvent): boolean {
  return a.frame === undefined || b.frame === undefined || a.frame === b.frame;
}

function findLastPcFetch(events: readonly TraceEvent[], write: TraceEvent): TraceEvent | undefined {
  if (write.pc === undefined) return undefined;
  let best: TraceEvent | undefined;
  for (const event of events) {
    if (event.kind !== "pcFetch" || event.pc !== write.pc || !sameFrame(event, write)) continue;
    if (event.cycleInFrame === undefined || write.cycleInFrame === undefined) continue;
    if (event.cycleInFrame > write.cycleInFrame) continue;
    if (best?.cycleInFrame === undefined || event.cycleInFrame > best.cycleInFrame) {
      best = event;
    }
  }
  return best;
}

function writesWithFetch(events: readonly TraceEvent[], kind: TraceKind): WriteWithFetch[] {
  const out: WriteWithFetch[] = [];
  for (const write of events) {
    if (write.kind !== kind) continue;
    const pcFetch = findLastPcFetch(events, write);
    const writeMinusFetch = write.cycleInFrame === undefined || pcFetch?.cycleInFrame === undefined
      ? undefined
      : write.cycleInFrame - pcFetch.cycleInFrame;
    out.push({ write, pcFetch, writeMinusFetch });
  }
  return out;
}

function hex(value: number | undefined, width: number): string | undefined {
  return value === undefined ? undefined : `0x${value.toString(16).padStart(width, "0")}`;
}

function serialize(entry: WriteWithFetch | undefined): SerializedWriteWithFetch | undefined {
  if (entry === undefined) return undefined;
  return {
    frame: entry.write.frame,
    cycleInFrame: entry.write.cycleInFrame,
    pc: hex(entry.write.pc, 4),
    reg: hex(entry.write.reg, 2),
    val: hex(entry.write.val, 2),
    pcFetchCycleInFrame: entry.pcFetch?.cycleInFrame,
    writeMinusFetch: entry.writeMinusFetch,
  };
}

function writeCycleDelta(
  mame: WriteWithFetch | undefined,
  ts: WriteWithFetch | undefined,
): number | undefined {
  return mame?.write.cycleInFrame === undefined || ts?.write.cycleInFrame === undefined
    ? undefined
    : ts.write.cycleInFrame - mame.write.cycleInFrame;
}

function serializeWritePair(
  mame: WriteWithFetch | undefined,
  ts: WriteWithFetch | undefined,
): SerializedWritePair {
  return {
    mame: serialize(mame),
    ts: serialize(ts),
  };
}

function sameOptionalNumber(a: number | undefined, b: number | undefined): boolean {
  return a === b || (a === undefined && b === undefined);
}

function summarizeWriteCycleDeltaRuns(
  mame: readonly WriteWithFetch[],
  ts: readonly WriteWithFetch[],
  sampleLimit: number,
): { runCount: number; runs: WriteCycleDeltaRun[] } {
  const pairedCount = Math.min(mame.length, ts.length);
  const runs: WriteCycleDeltaRun[] = [];
  let currentStart = 0;
  let currentDelta: number | undefined;
  let runCount = 0;

  const closeRun = (endIndex: number): void => {
    if (endIndex < currentStart) return;
    runCount++;
    if (runs.length >= sampleLimit) return;
    runs.push({
      startIndex: currentStart,
      endIndex,
      count: endIndex - currentStart + 1,
      delta: currentDelta,
      first: serializeWritePair(mame[currentStart], ts[currentStart]),
      last: serializeWritePair(mame[endIndex], ts[endIndex]),
    });
  };

  for (let i = 0; i < pairedCount; i++) {
    const delta = writeCycleDelta(mame[i], ts[i]);
    if (i === 0) {
      currentDelta = delta;
      continue;
    }
    if (sameOptionalNumber(delta, currentDelta)) continue;
    closeRun(i - 1);
    currentStart = i;
    currentDelta = delta;
  }
  if (pairedCount > 0) closeRun(pairedCount - 1);
  return { runCount, runs };
}

function pcFetchEvents(events: readonly TraceEvent[]): PcFetchEvent[] {
  return events
    .filter((event) => event.kind === "pcFetch")
    .map((event) => ({
      frame: event.frame,
      cycleInFrame: event.cycleInFrame,
      pc: event.pc,
      a: event.a,
      x: event.x,
      y: event.y,
      p: event.p,
      sp: event.sp,
      curpc: event.curpc,
      genpc: event.genpc,
      ir: event.ir,
      opcode: event.opcode,
    }));
}

function vectorReadEvents(events: readonly TraceEvent[]): VectorReadEvent[] {
  return events
    .filter((event) => event.kind === "vectorRead")
    .map((event) => ({
      frame: event.frame,
      cycle: event.cycle,
      cycleInFrame: event.cycleInFrame,
      pc: event.pc,
      a: event.a,
      x: event.x,
      y: event.y,
      p: event.p,
      sp: event.sp,
      addr: event.addr,
      val: event.val,
      vector: event.vector,
    }));
}

function statusReadEvents(events: readonly TraceEvent[]): StatusReadEvent[] {
  return events
    .filter((event) => event.kind === "statusRead")
    .map((event) => ({
      frame: event.frame,
      cycle: event.cycle,
      cycleInFrame: event.cycleInFrame,
      pc: event.pc,
      a: event.a,
      x: event.x,
      y: event.y,
      p: event.p,
      sp: event.sp,
      addr: event.addr,
      val: event.val,
    }));
}

function isInterruptPrefetchPair(events: readonly PcFetchEvent[], index: number): boolean {
  const current = events[index];
  const next = events[index + 1];
  const after = events[index + 2];
  if (current === undefined || next === undefined || after === undefined) return false;
  if (current.pc === undefined || next.pc === undefined || after.pc === undefined) return false;
  if (current.pc !== next.pc || after.pc === current.pc) return false;
  // MAME's 6502 core exposes the prefetch/dummy fetch at an IRQ boundary as a
  // repeated PC with GENPC already equal to PC and IR cleared. TS has no
  // prefetch state, so this pair is not an executed-instruction mismatch.
  return next.genpc === next.pc && next.ir === 0;
}

function dropInterruptPrefetchPairs(events: readonly PcFetchEvent[]): PcFetchEvent[] {
  const out: PcFetchEvent[] = [];
  for (let i = 0; i < events.length; i++) {
    if (isInterruptPrefetchPair(events, i)) {
      i++;
      continue;
    }
    out.push(events[i]!);
  }
  return out;
}

function serializePcFetch(event: PcFetchEvent | undefined): SerializedPcFetch | undefined {
  if (event === undefined) return undefined;
  return {
    frame: event.frame,
    cycleInFrame: event.cycleInFrame,
    pc: hex(event.pc, 4),
    a: hex(event.a, 2),
    x: hex(event.x, 2),
    y: hex(event.y, 2),
    p: hex(event.p, 2),
    sp: hex(event.sp, 2),
    curpc: hex(event.curpc, 4),
    genpc: hex(event.genpc, 4),
    ir: hex(event.ir, 2),
    opcode: hex(event.opcode, 2),
  };
}

function pcTransitionCycles(from: PcFetchEvent, to: PcFetchEvent): number | undefined {
  if (
    from.frame !== undefined &&
    to.frame !== undefined &&
    from.frame === to.frame &&
    from.cycleInFrame !== undefined &&
    to.cycleInFrame !== undefined
  ) {
    return to.cycleInFrame - from.cycleInFrame;
  }
  return undefined;
}

function pcTransitionsFrom(events: readonly PcFetchEvent[], anchorIndex: number, lookahead: number): PcTransition[] {
  const out: PcTransition[] = [];
  const maxOffset = Math.min(lookahead, events.length - anchorIndex - 1);
  for (let offset = 0; offset < maxOffset; offset++) {
    const from = events[anchorIndex + offset]!;
    const to = events[anchorIndex + offset + 1]!;
    out.push({
      index: anchorIndex + offset,
      from,
      to,
      cycles: pcTransitionCycles(from, to),
    });
  }
  return out;
}

function serializePcTransition(transition: PcTransition | undefined): SerializedPcTransition | undefined {
  if (transition === undefined) return undefined;
  return {
    index: transition.index,
    from: serializePcFetch(transition.from)!,
    to: serializePcFetch(transition.to)!,
    cycles: transition.cycles,
  };
}

function pcTransitionMismatchFields(
  mame: PcTransition | undefined,
  ts: PcTransition | undefined,
): string[] {
  if (mame === undefined || ts === undefined) return ["missing"];
  const fields: string[] = [];
  if (mame.from.pc !== ts.from.pc) fields.push("fromPc");
  if (mame.to.pc !== ts.to.pc) fields.push("toPc");
  if (mame.from.opcode !== ts.from.opcode) fields.push("fromOpcode");
  if (mame.to.opcode !== ts.to.opcode) fields.push("toOpcode");
  return fields;
}

function summarizePcTransitionAnchor(
  mameEvents: readonly TraceEvent[],
  tsEvents: readonly TraceEvent[],
  anchorPc: number | undefined,
  lookahead: number,
  sampleLimit: number,
): PcTransitionAnchorSummary | undefined {
  if (anchorPc === undefined) return undefined;
  const mamePc = dropInterruptPrefetchPairs(pcFetchEvents(mameEvents));
  const tsPc = dropInterruptPrefetchPairs(pcFetchEvents(tsEvents));
  const mameAnchors = mamePc
    .map((event, index) => ({ event, index }))
    .filter(({ event }) => event.pc === anchorPc);
  const tsAnchors = tsPc
    .map((event, index) => ({ event, index }))
    .filter(({ event }) => event.pc === anchorPc);
  const pairedAnchorCount = Math.min(mameAnchors.length, tsAnchors.length);
  const windows: PcTransitionAnchorWindow[] = [];
  let mismatchWindowCount = 0;
  let firstMismatch: PcTransitionMismatch | undefined;

  for (let anchorOccurrence = 0; anchorOccurrence < pairedAnchorCount; anchorOccurrence++) {
    const mameAnchor = mameAnchors[anchorOccurrence]!;
    const tsAnchor = tsAnchors[anchorOccurrence]!;
    const mameTransitions = pcTransitionsFrom(mamePc, mameAnchor.index, lookahead);
    const tsTransitions = pcTransitionsFrom(tsPc, tsAnchor.index, lookahead);
    const pairedTransitionCount = Math.min(mameTransitions.length, tsTransitions.length);
    const samples: PcTransitionMismatch[] = [];
    let windowFirstMismatch: PcTransitionMismatch | undefined;

    for (let offset = 0; offset < pairedTransitionCount; offset++) {
      const mameTransition = mameTransitions[offset]!;
      const tsTransition = tsTransitions[offset]!;
      const fields = pcTransitionMismatchFields(mameTransition, tsTransition);
      const fromCycleDelta = mameTransition.from.cycleInFrame === undefined || tsTransition.from.cycleInFrame === undefined
        ? undefined
        : tsTransition.from.cycleInFrame - mameTransition.from.cycleInFrame;
      const toCycleDelta = mameTransition.to.cycleInFrame === undefined || tsTransition.to.cycleInFrame === undefined
        ? undefined
        : tsTransition.to.cycleInFrame - mameTransition.to.cycleInFrame;
      const durationDelta = mameTransition.cycles === undefined || tsTransition.cycles === undefined
        ? undefined
        : tsTransition.cycles - mameTransition.cycles;
      if (durationDelta !== undefined && durationDelta !== 0) fields.push("duration");
      if (fields.length === 0) continue;

      const mismatch: PcTransitionMismatch = {
        anchorOccurrence,
        offset,
        fields: Array.from(new Set(fields)),
        fromCycleDelta,
        toCycleDelta,
        durationDelta,
        mame: serializePcTransition(mameTransition),
        ts: serializePcTransition(tsTransition),
      };
      windowFirstMismatch ??= mismatch;
      firstMismatch ??= mismatch;
      if (samples.length < sampleLimit) samples.push(mismatch);
    }

    const unpairedTransitionCount = Math.abs(mameTransitions.length - tsTransitions.length);
    if (unpairedTransitionCount > 0 && samples.length < sampleLimit) {
      const longer = mameTransitions.length > tsTransitions.length ? mameTransitions : tsTransitions;
      for (let offset = pairedTransitionCount; offset < longer.length && samples.length < sampleLimit; offset++) {
        const mismatch: PcTransitionMismatch = {
          anchorOccurrence,
          offset,
          fields: ["missing"],
          fromCycleDelta: undefined,
          toCycleDelta: undefined,
          durationDelta: undefined,
          mame: serializePcTransition(mameTransitions[offset]),
          ts: serializePcTransition(tsTransitions[offset]),
        };
        windowFirstMismatch ??= mismatch;
        firstMismatch ??= mismatch;
        samples.push(mismatch);
      }
    }

    if (windowFirstMismatch !== undefined) mismatchWindowCount++;
    if (windowFirstMismatch !== undefined || windows.length < sampleLimit) {
      windows.push({
        anchorOccurrence,
        anchorCycleDelta: mameAnchor.event.cycleInFrame === undefined || tsAnchor.event.cycleInFrame === undefined
          ? undefined
          : tsAnchor.event.cycleInFrame - mameAnchor.event.cycleInFrame,
        mameAnchor: serializePcFetch(mameAnchor.event),
        tsAnchor: serializePcFetch(tsAnchor.event),
        firstMismatch: windowFirstMismatch,
        samples,
      });
    }
  }

  return {
    mode: "dropInterruptPrefetch",
    anchorPc: hex(anchorPc, 4),
    lookahead,
    mameAnchorCount: mameAnchors.length,
    tsAnchorCount: tsAnchors.length,
    pairedAnchorCount,
    unpairedAnchorCount: Math.abs(mameAnchors.length - tsAnchors.length),
    mismatchWindowCount,
    firstMismatch,
    windows: windows.slice(0, sampleLimit),
  };
}

function serializeVectorRead(event: VectorReadEvent | undefined): SerializedVectorRead | undefined {
  if (event === undefined) return undefined;
  return {
    frame: event.frame,
    cycleInFrame: event.cycleInFrame,
    pc: hex(event.pc, 4),
    a: hex(event.a, 2),
    x: hex(event.x, 2),
    y: hex(event.y, 2),
    p: hex(event.p, 2),
    sp: hex(event.sp, 2),
    addr: hex(event.addr, 4),
    val: hex(event.val, 2),
    vector: event.vector,
  };
}

function pcFetchMismatchFields(mame: PcFetchEvent | undefined, ts: PcFetchEvent | undefined): string[] {
  const fields: string[] = [];
  if (mame?.pc !== ts?.pc) fields.push("pc");
  if (mame?.a !== ts?.a) fields.push("a");
  if (mame?.x !== ts?.x) fields.push("x");
  if (mame?.y !== ts?.y) fields.push("y");
  if (mame?.p !== ts?.p) fields.push("p");
  if (mame?.sp !== ts?.sp) fields.push("sp");
  if (mame?.opcode !== ts?.opcode) fields.push("opcode");
  return fields;
}

function serializeStatusRead(event: StatusReadEvent | undefined): SerializedStatusRead | undefined {
  if (event === undefined) return undefined;
  return {
    frame: event.frame,
    cycleInFrame: event.cycleInFrame,
    pc: hex(event.pc, 4),
    a: hex(event.a, 2),
    x: hex(event.x, 2),
    y: hex(event.y, 2),
    p: hex(event.p, 2),
    sp: hex(event.sp, 2),
    addr: hex(event.addr, 4),
    val: hex(event.val, 2),
  };
}

function zeroPageEvents(events: readonly TraceEvent[]): ZeroPageEvent[] {
  return events
    .filter((event) => (event.kind === "zpRead" || event.kind === "zpWrite") && event.addr !== undefined)
    .map((event) => ({
      kind: event.kind as ZeroPageKind,
      frame: event.frame,
      cycle: event.cycle,
      cycleInFrame: event.cycleInFrame,
      pc: event.pc,
      a: event.a,
      x: event.x,
      y: event.y,
      p: event.p,
      sp: event.sp,
      addr: event.addr!,
      val: event.val,
    }));
}

function serializeZeroPage(event: ZeroPageEvent | undefined): SerializedZeroPageEvent | undefined {
  if (event === undefined) return undefined;
  return {
    frame: event.frame,
    cycleInFrame: event.cycleInFrame,
    pc: hex(event.pc, 4),
    a: hex(event.a, 2),
    x: hex(event.x, 2),
    y: hex(event.y, 2),
    p: hex(event.p, 2),
    sp: hex(event.sp, 2),
    addr: hex(event.addr, 2)!,
    val: hex(event.val, 2),
  };
}

function zeroPageKey(event: ZeroPageEvent): string {
  return `${event.kind}:${event.addr & 0xff}`;
}

function groupZeroPageEvents(events: readonly ZeroPageEvent[]): Map<string, ZeroPageEvent[]> {
  const groups = new Map<string, ZeroPageEvent[]>();
  for (const event of events) {
    const key = zeroPageKey(event);
    let bucket = groups.get(key);
    if (bucket === undefined) {
      bucket = [];
      groups.set(key, bucket);
    }
    bucket.push(event);
  }
  return groups;
}

function zeroPageStateFields(mame: ZeroPageEvent | undefined, ts: ZeroPageEvent | undefined): string[] {
  const fields: string[] = [];
  if (mame?.frame !== ts?.frame) fields.push("frame");
  if (mame?.pc !== ts?.pc) fields.push("pc");
  if (mame?.a !== ts?.a) fields.push("a");
  if (mame?.x !== ts?.x) fields.push("x");
  if (mame?.y !== ts?.y) fields.push("y");
  if (mame?.p !== ts?.p) fields.push("p");
  if (mame?.sp !== ts?.sp) fields.push("sp");
  if (mame?.val !== ts?.val) fields.push("val");
  return fields;
}

function commandByte(event: TraceEvent): number | undefined {
  return event.byte ?? event.val;
}

function commandBoundaryEvents(events: readonly TraceEvent[], source: "mame" | "ts"): CommandBoundaryEvent[] {
  const kind = source === "mame" ? "mainCmdWrite" : "cmdSubmit";
  return events
    .filter((event) => event.kind === kind)
    .map((event) => ({
      frame: event.frame,
      cycle: event.cycle,
      cycleInFrame: event.cycleInFrame,
      actualCycleInFrame: event.actualCycleInFrame,
      videoCycleInFrame: event.videoCycleInFrame,
      pc: event.pc,
      soundPc: event.soundPc,
      expectedSoundPc: event.expectedSoundPc,
      expectedSoundA: event.expectedSoundA,
      expectedSoundX: event.expectedSoundX,
      expectedSoundY: event.expectedSoundY,
      expectedSoundP: event.expectedSoundP,
      expectedSoundSp: event.expectedSoundSp,
      a: event.a,
      x: event.x,
      y: event.y,
      p: event.p,
      sp: event.sp,
      byte: commandByte(event),
      preemptedChipWrite: event.preemptedChipWrite,
    }));
}

function serializePreemptedChipWrite(
  preempted: PreemptedChipWrite | undefined,
): SerializedPreemptedChipWrite | undefined {
  if (preempted === undefined) return undefined;
  return {
    pc: hex(preempted.pc, 4),
    opcode: hex(preempted.opcode, 2),
    address: hex(preempted.address, 4),
    stepStart: preempted.stepStart,
    stepEnd: preempted.stepEnd,
    writeCycle: preempted.writeCycle,
    targetDeltaFromWrite: preempted.targetDeltaFromWrite,
    completedInstructionBeforeTarget: preempted.completedInstructionBeforeTarget,
  };
}

function serializeCommandBoundary(
  event: CommandBoundaryEvent | undefined,
): SerializedCommandBoundary | undefined {
  if (event === undefined) return undefined;
  return {
    frame: event.frame,
    cycleInFrame: event.cycleInFrame,
    actualCycleInFrame: event.actualCycleInFrame,
    videoCycleInFrame: event.videoCycleInFrame,
    pc: hex(event.pc, 4),
    soundPc: hex(event.soundPc, 4),
    expectedSoundPc: hex(event.expectedSoundPc, 4),
    expectedSoundA: hex(event.expectedSoundA, 2),
    expectedSoundX: hex(event.expectedSoundX, 2),
    expectedSoundY: hex(event.expectedSoundY, 2),
    expectedSoundP: hex(event.expectedSoundP, 2),
    expectedSoundSp: hex(event.expectedSoundSp, 2),
    a: hex(event.a, 2),
    x: hex(event.x, 2),
    y: hex(event.y, 2),
    p: hex(event.p, 2),
    sp: hex(event.sp, 2),
    byte: hex(event.byte, 2),
    preemptedChipWrite: serializePreemptedChipWrite(event.preemptedChipWrite),
  };
}

function isAfterTracePoint(event: PcFetchEvent, anchor: StatusReadEvent): boolean {
  if (event.frame !== undefined && anchor.frame !== undefined) {
    if (event.frame !== anchor.frame) return event.frame > anchor.frame;
  }
  if (event.cycleInFrame === undefined || anchor.cycleInFrame === undefined) return false;
  return event.cycleInFrame > anchor.cycleInFrame;
}

function pcFetchesAfterStatus(
  events: readonly TraceEvent[],
  status: StatusReadEvent,
  mode: PcSequenceSummary["mode"],
): PcFetchEvent[] {
  const pcFetches = mode === "dropInterruptPrefetch"
    ? dropInterruptPrefetchPairs(pcFetchEvents(events))
    : pcFetchEvents(events);
  return pcFetches.filter((event) => isAfterTracePoint(event, status));
}

function findPcMismatchAfterStatus(
  mameEvents: readonly TraceEvent[],
  tsEvents: readonly TraceEvent[],
  mameStatus: StatusReadEvent,
  tsStatus: StatusReadEvent,
  lookahead: number,
): PcSequenceMismatch | undefined {
  const mame = pcFetchesAfterStatus(mameEvents, mameStatus, "dropInterruptPrefetch").slice(0, lookahead);
  const ts = pcFetchesAfterStatus(tsEvents, tsStatus, "dropInterruptPrefetch").slice(0, lookahead);
  const pairedCount = Math.min(mame.length, ts.length);
  for (let i = 0; i < pairedCount; i++) {
    const mameEntry = mame[i]!;
    const tsEntry = ts[i]!;
    if (mameEntry.pc === tsEntry.pc) continue;
    const delta = mameEntry.cycleInFrame === undefined || tsEntry.cycleInFrame === undefined
      ? undefined
      : tsEntry.cycleInFrame - mameEntry.cycleInFrame;
    return {
      index: i,
      fields: ["pc"],
      delta,
      samePc: false,
      mame: serializePcFetch(mameEntry),
      ts: serializePcFetch(tsEntry),
    };
  }
  return undefined;
}

function summarizePcSequence(
  mameEvents: readonly TraceEvent[],
  tsEvents: readonly TraceEvent[],
  sampleLimit: number,
  mode: PcSequenceSummary["mode"],
): PcSequenceSummary {
  const rawMame = pcFetchEvents(mameEvents);
  const rawTs = pcFetchEvents(tsEvents);
  const mame = mode === "dropInterruptPrefetch" ? dropInterruptPrefetchPairs(rawMame) : rawMame;
  const ts = mode === "dropInterruptPrefetch" ? dropInterruptPrefetchPairs(rawTs) : rawTs;
  const pairedCount = Math.min(mame.length, ts.length);
  const cycleDelta = makeStats();
  const cycleDeltaAbs = { value: 0 };
  let firstPcMismatch: PcSequenceMismatch | undefined;
  let firstStateMismatch: PcSequenceMismatch | undefined;
  let firstNonBaselineDelta: PcSequenceMismatch | undefined;
  let baselineDelta: number | undefined;
  let stateMismatchCount = 0;

  for (let i = 0; i < pairedCount; i++) {
    const mameEntry = mame[i]!;
    const tsEntry = ts[i]!;
    const fields = pcFetchMismatchFields(mameEntry, tsEntry);
    const delta = mameEntry.cycleInFrame === undefined || tsEntry.cycleInFrame === undefined
      ? undefined
      : tsEntry.cycleInFrame - mameEntry.cycleInFrame;
    if (delta !== undefined) {
      baselineDelta ??= delta;
      addDelta(cycleDelta, cycleDeltaAbs, delta);
    }
    const samePc = mameEntry.pc === tsEntry.pc;
    const mismatch: PcSequenceMismatch = {
      index: i,
      fields,
      delta,
      samePc,
      mame: serializePcFetch(mameEntry),
      ts: serializePcFetch(tsEntry),
    };
    if (!samePc) firstPcMismatch ??= mismatch;
    if (fields.length > 0) {
      stateMismatchCount++;
      firstStateMismatch ??= mismatch;
    }
    if (delta !== undefined && baselineDelta !== undefined && delta !== baselineDelta) {
      firstNonBaselineDelta ??= mismatch;
    }
  }

  const sampleStart = Math.max(0, (firstPcMismatch?.index ?? firstNonBaselineDelta?.index ?? 0) - 8);
  const sampleEnd = Math.min(pairedCount, sampleStart + sampleLimit);
  const sampleWindow: PcSequenceMismatch[] = [];
  for (let i = sampleStart; i < sampleEnd; i++) {
    const mameEntry = mame[i];
    const tsEntry = ts[i];
    const delta = mameEntry?.cycleInFrame === undefined || tsEntry?.cycleInFrame === undefined
      ? undefined
      : tsEntry.cycleInFrame - mameEntry.cycleInFrame;
    sampleWindow.push({
      index: i,
      fields: pcFetchMismatchFields(mameEntry, tsEntry),
      delta,
      samePc: mameEntry?.pc === tsEntry?.pc,
      mame: serializePcFetch(mameEntry),
      ts: serializePcFetch(tsEntry),
    });
  }

  return {
    mode,
    mameCount: mame.length,
    tsCount: ts.length,
    pairedCount,
    firstPcMismatch,
    firstStateMismatch,
    firstNonBaselineDelta,
    stateMismatchCount,
    cycleDelta,
    sampleWindow,
  };
}

function summarizeVectorReads(
  mameEvents: readonly TraceEvent[],
  tsEvents: readonly TraceEvent[],
  sampleLimit: number,
): VectorReadSummary {
  const mame = vectorReadEvents(mameEvents);
  const ts = vectorReadEvents(tsEvents);
  const pairedCount = Math.min(mame.length, ts.length);
  const cycleDelta = makeStats();
  const cycleDeltaAbs = { value: 0 };
  const samples: VectorReadMismatch[] = [];
  let payloadMismatchCount = 0;
  let firstMismatch: VectorReadMismatch | undefined;

  for (let i = 0; i < pairedCount; i++) {
    const mameEntry = mame[i]!;
    const tsEntry = ts[i]!;
    const fields: string[] = [];
    if (mameEntry.vector !== tsEntry.vector) fields.push("vector");
    if (mameEntry.addr !== tsEntry.addr) fields.push("addr");
    if (mameEntry.val !== tsEntry.val) fields.push("val");
    if (mameEntry.pc !== tsEntry.pc) fields.push("pc");
    const delta = mameEntry.cycleInFrame === undefined || tsEntry.cycleInFrame === undefined
      ? undefined
      : tsEntry.cycleInFrame - mameEntry.cycleInFrame;
    if (delta !== undefined) addDelta(cycleDelta, cycleDeltaAbs, delta);
    if (fields.length === 0) continue;
    payloadMismatchCount++;
    const mismatch: VectorReadMismatch = {
      index: i,
      fields,
      delta,
      mame: serializeVectorRead(mameEntry),
      ts: serializeVectorRead(tsEntry),
    };
    firstMismatch ??= mismatch;
    if (samples.length < sampleLimit) samples.push(mismatch);
  }

  const unpairedCount = Math.abs(mame.length - ts.length);
  if (unpairedCount > 0 && samples.length < sampleLimit) {
    const longer = mame.length > ts.length ? mame : ts;
    for (let i = pairedCount; i < longer.length && samples.length < sampleLimit; i++) {
      samples.push({
        index: i,
        fields: ["missing"],
        delta: undefined,
        mame: serializeVectorRead(mame[i]),
        ts: serializeVectorRead(ts[i]),
      });
    }
  }

  return {
    pairedCount,
    mameCount: mame.length,
    tsCount: ts.length,
    unpairedCount,
    payloadMismatchCount,
    cycleDelta,
    firstMismatch,
    samples,
  };
}

function summarizeStatusReads(
  mameEvents: readonly TraceEvent[],
  tsEvents: readonly TraceEvent[],
  sampleLimit: number,
  pcLookahead: number,
): StatusReadSummary {
  const mame = statusReadEvents(mameEvents);
  const ts = statusReadEvents(tsEvents);
  const pairedCount = Math.min(mame.length, ts.length);
  const cycleDelta = makeStats();
  const cycleDeltaAbs = { value: 0 };
  const samples: StatusReadMismatch[] = [];
  let payloadMismatchCount = 0;
  let mainToSoundPendingBitMismatchCount = 0;
  let soundToMainPendingBitMismatchCount = 0;
  let firstMismatch: StatusReadMismatch | undefined;
  let firstMainToSoundPendingBitMismatch: StatusReadMismatch | undefined;
  let firstSoundToMainPendingBitMismatch: StatusReadMismatch | undefined;
  let firstBranchingMismatch: StatusReadMismatch | undefined;

  for (let i = 0; i < pairedCount; i++) {
    const mameEntry = mame[i]!;
    const tsEntry = ts[i]!;
    const fields: string[] = [];
    if (mameEntry.pc !== tsEntry.pc) fields.push("pc");
    if (mameEntry.addr !== tsEntry.addr) fields.push("addr");
    if (mameEntry.val !== tsEntry.val) fields.push("val");
    const delta = mameEntry.cycleInFrame === undefined || tsEntry.cycleInFrame === undefined
      ? undefined
      : tsEntry.cycleInFrame - mameEntry.cycleInFrame;
    if (delta !== undefined) addDelta(cycleDelta, cycleDeltaAbs, delta);
    if (fields.length === 0) continue;

    payloadMismatchCount++;
    const mainPendingMismatch = ((mameEntry.val ?? 0) & 0x08) !== ((tsEntry.val ?? 0) & 0x08);
    const soundPendingMismatch = ((mameEntry.val ?? 0) & 0x10) !== ((tsEntry.val ?? 0) & 0x10);
    const nextPcMismatch = findPcMismatchAfterStatus(mameEvents, tsEvents, mameEntry, tsEntry, pcLookahead);
    const mismatch: StatusReadMismatch = {
      index: i,
      fields,
      delta,
      mame: serializeStatusRead(mameEntry),
      ts: serializeStatusRead(tsEntry),
      nextPcMismatch,
    };
    if (mainPendingMismatch) {
      mainToSoundPendingBitMismatchCount++;
      firstMainToSoundPendingBitMismatch ??= mismatch;
    }
    if (soundPendingMismatch) {
      soundToMainPendingBitMismatchCount++;
      firstSoundToMainPendingBitMismatch ??= mismatch;
    }
    firstMismatch ??= mismatch;
    if (nextPcMismatch !== undefined) firstBranchingMismatch ??= mismatch;
    if (samples.length < sampleLimit) samples.push(mismatch);
  }

  const unpairedCount = Math.abs(mame.length - ts.length);
  if (unpairedCount > 0 && samples.length < sampleLimit) {
    const longer = mame.length > ts.length ? mame : ts;
    for (let i = pairedCount; i < longer.length && samples.length < sampleLimit; i++) {
      samples.push({
        index: i,
        fields: ["missing"],
        delta: undefined,
        mame: serializeStatusRead(mame[i]),
        ts: serializeStatusRead(ts[i]),
        nextPcMismatch: undefined,
      });
    }
  }

  return {
    pairedCount,
    mameCount: mame.length,
    tsCount: ts.length,
    unpairedCount,
    payloadMismatchCount,
    mainToSoundPendingBitMismatchCount,
    soundToMainPendingBitMismatchCount,
    cycleDelta,
    firstMismatch,
    firstMainToSoundPendingBitMismatch,
    firstSoundToMainPendingBitMismatch,
    firstBranchingMismatch,
    samples,
  };
}

function summarizeCommandBoundaries(
  mameEvents: readonly TraceEvent[],
  tsEvents: readonly TraceEvent[],
  sampleLimit: number,
): CommandBoundarySummary {
  const mame = commandBoundaryEvents(mameEvents, "mame");
  const ts = commandBoundaryEvents(tsEvents, "ts");
  const pairedCount = Math.min(mame.length, ts.length);
  const cycleDelta = makeStats();
  const cycleDeltaAbs = { value: 0 };
  const samples: CommandBoundaryMismatch[] = [];
  let byteMismatchCount = 0;
  let soundPcMismatchCount = 0;
  let expectedStateMismatchCount = 0;
  let firstMismatch: CommandBoundaryMismatch | undefined;

  for (let i = 0; i < pairedCount; i++) {
    const mameEntry = mame[i]!;
    const tsEntry = ts[i]!;
    const fields: string[] = [];
    if (mameEntry.frame !== tsEntry.frame) fields.push("frame");
    if (mameEntry.byte !== tsEntry.byte) {
      fields.push("byte");
      byteMismatchCount++;
    }
    if (mameEntry.soundPc !== tsEntry.soundPc) {
      fields.push("soundPc");
      soundPcMismatchCount++;
    }
    const expectedFields: string[] = [];
    if (tsEntry.expectedSoundPc !== undefined && tsEntry.expectedSoundPc !== tsEntry.soundPc) {
      expectedFields.push("expectedSoundPc");
    }
    if (tsEntry.expectedSoundA !== undefined && tsEntry.expectedSoundA !== tsEntry.a) {
      expectedFields.push("expectedSoundA");
    }
    if (tsEntry.expectedSoundX !== undefined && tsEntry.expectedSoundX !== tsEntry.x) {
      expectedFields.push("expectedSoundX");
    }
    if (tsEntry.expectedSoundY !== undefined && tsEntry.expectedSoundY !== tsEntry.y) {
      expectedFields.push("expectedSoundY");
    }
    if (tsEntry.expectedSoundP !== undefined && tsEntry.expectedSoundP !== tsEntry.p) {
      expectedFields.push("expectedSoundP");
    }
    if (tsEntry.expectedSoundSp !== undefined && tsEntry.expectedSoundSp !== tsEntry.sp) {
      expectedFields.push("expectedSoundSp");
    }
    if (expectedFields.length > 0) {
      fields.push(...expectedFields);
      expectedStateMismatchCount++;
    }
    const delta = mameEntry.cycleInFrame === undefined || tsEntry.cycleInFrame === undefined
      ? undefined
      : tsEntry.cycleInFrame - mameEntry.cycleInFrame;
    if (delta !== undefined) addDelta(cycleDelta, cycleDeltaAbs, delta);
    if (fields.length === 0) continue;

    const mismatch: CommandBoundaryMismatch = {
      index: i,
      fields,
      delta,
      mame: serializeCommandBoundary(mameEntry),
      ts: serializeCommandBoundary(tsEntry),
    };
    firstMismatch ??= mismatch;
    if (samples.length < sampleLimit) samples.push(mismatch);
  }

  const unpairedCount = Math.abs(mame.length - ts.length);
  if (unpairedCount > 0 && samples.length < sampleLimit) {
    const longer = mame.length > ts.length ? mame : ts;
    for (let i = pairedCount; i < longer.length && samples.length < sampleLimit; i++) {
      samples.push({
        index: i,
        fields: ["missing"],
        delta: undefined,
        mame: serializeCommandBoundary(mame[i]),
        ts: serializeCommandBoundary(ts[i]),
      });
    }
  }

  return {
    pairedCount,
    mameCount: mame.length,
    tsCount: ts.length,
    unpairedCount,
    byteMismatchCount,
    soundPcMismatchCount,
    expectedStateMismatchCount,
    cycleDelta,
    firstMismatch,
    samples,
  };
}

function serializeTracePoint(event: TraceEvent | undefined): SerializedTracePoint | undefined {
  if (event === undefined) return undefined;
  return {
    kind: event.kind,
    frame: event.frame,
    cycleInFrame: event.cycleInFrame,
    pc: hex(event.pc, 4),
    addr: hex(event.addr, 4),
    reg: hex(event.reg, 2),
    val: hex(event.val, 2),
    vector: event.vector,
  };
}

function firstEventAfter(
  events: readonly TraceEvent[],
  anchor: OrderedTracePoint,
  predicate: (event: TraceEvent) => boolean,
): TraceEvent | undefined {
  return events.find((event) => predicate(event) && isAfterEvent(event, anchor));
}

function earlierEvent(a: TraceEvent | undefined, b: TraceEvent | undefined): TraceEvent | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  const aKey = eventOrderKey(a);
  const bKey = eventOrderKey(b);
  if (aKey !== undefined && bKey !== undefined) return aKey <= bKey ? a : b;
  if (isBeforeEvent(a, b)) return a;
  return b;
}

function commandNmiWindows(events: readonly TraceEvent[], source: "mame" | "ts"): CommandNmiWindow[] {
  return commandBoundaryEvents(events, source).map((command) => {
    const nmiVector = firstEventAfter(events, command, (event) =>
      event.kind === "vectorRead" && event.vector === "nmi" && event.addr === 0xfffa);
    const cmdRead = firstEventAfter(events, command, (event) => event.kind === "cmdRead");
    const firstYmWrite = firstEventAfter(events, command, (event) => event.kind === "ymWrite");
    const firstPokeyWrite = firstEventAfter(events, command, (event) => event.kind === "pokeyWrite");
    const firstChipWrite = earlierEvent(firstYmWrite, firstPokeyWrite);
    return {
      command,
      nmiVector,
      cmdRead,
      firstYmWrite,
      firstPokeyWrite,
      firstChipWrite,
      nmiFromCommand: cycleDeltaWithinTrace(nmiVector, command),
      cmdReadFromCommand: cycleDeltaWithinTrace(cmdRead, command),
      cmdReadFromNmi: cycleDeltaWithinTrace(cmdRead, nmiVector),
      firstYmWriteFromCommand: cycleDeltaWithinTrace(firstYmWrite, command),
      firstYmWriteFromNmi: cycleDeltaWithinTrace(firstYmWrite, nmiVector),
      firstChipWriteFromCommand: cycleDeltaWithinTrace(firstChipWrite, command),
      firstChipWriteFromNmi: cycleDeltaWithinTrace(firstChipWrite, nmiVector),
    };
  });
}

function serializeCommandNmiWindow(window: CommandNmiWindow | undefined): SerializedCommandNmiWindow | undefined {
  if (window === undefined) return undefined;
  return {
    command: serializeCommandBoundary(window.command)!,
    nmiVector: serializeTracePoint(window.nmiVector),
    cmdRead: serializeTracePoint(window.cmdRead),
    firstYmWrite: serializeTracePoint(window.firstYmWrite),
    firstPokeyWrite: serializeTracePoint(window.firstPokeyWrite),
    firstChipWrite: serializeTracePoint(window.firstChipWrite),
    nmiFromCommand: window.nmiFromCommand,
    cmdReadFromCommand: window.cmdReadFromCommand,
    cmdReadFromNmi: window.cmdReadFromNmi,
    firstYmWriteFromCommand: window.firstYmWriteFromCommand,
    firstYmWriteFromNmi: window.firstYmWriteFromNmi,
    firstChipWriteFromCommand: window.firstChipWriteFromCommand,
    firstChipWriteFromNmi: window.firstChipWriteFromNmi,
  };
}

function deltaBetween(
  ts: number | undefined,
  mame: number | undefined,
): number | undefined {
  return ts === undefined || mame === undefined ? undefined : ts - mame;
}

function isCrossFrame(
  event: Pick<OrderedTracePoint, "frame"> | undefined,
  anchor: Pick<OrderedTracePoint, "frame"> | undefined,
): boolean {
  return event?.frame !== undefined && anchor?.frame !== undefined && event.frame !== anchor.frame;
}

function summarizeCommandNmiWindows(
  mameEvents: readonly TraceEvent[],
  tsEvents: readonly TraceEvent[],
  sampleLimit: number,
): CommandNmiSummary {
  const mame = commandNmiWindows(mameEvents, "mame");
  const ts = commandNmiWindows(tsEvents, "ts");
  const pairedCount = Math.min(mame.length, ts.length);
  const nmiFromCommandDelta = makeStats();
  const nmiFromCommandDeltaAbs = { value: 0 };
  const cmdReadFromNmiDelta = makeStats();
  const cmdReadFromNmiDeltaAbs = { value: 0 };
  const firstChipWriteFromNmiDelta = makeStats();
  const firstChipWriteFromNmiDeltaAbs = { value: 0 };
  const samples: CommandNmiWindowMismatch[] = [];
  let nmiMissingCount = 0;
  let cmdReadMissingCount = 0;
  let firstChipWriteMissingCount = 0;
  let firstChipWriteKindMismatchCount = 0;
  let firstChipWritePayloadMismatchCount = 0;
  let mameFirstChipWriteCrossFrameCount = 0;
  let tsFirstChipWriteCrossFrameCount = 0;
  let firstChipWriteCrossFrameMismatchCount = 0;
  let firstMismatch: CommandNmiWindowMismatch | undefined;

  for (let i = 0; i < pairedCount; i++) {
    const mameEntry = mame[i]!;
    const tsEntry = ts[i]!;
    const fields: string[] = [];
    if (mameEntry.nmiVector === undefined || tsEntry.nmiVector === undefined) {
      fields.push("nmiVector");
      nmiMissingCount++;
    }
    if (mameEntry.cmdRead === undefined || tsEntry.cmdRead === undefined) {
      fields.push("cmdRead");
      cmdReadMissingCount++;
    }
    if (mameEntry.firstChipWrite === undefined || tsEntry.firstChipWrite === undefined) {
      fields.push("firstChipWrite");
      firstChipWriteMissingCount++;
    }
    if (mameEntry.nmiVector?.pc !== tsEntry.nmiVector?.pc) fields.push("nmiPc");
    if (mameEntry.cmdRead?.pc !== tsEntry.cmdRead?.pc) fields.push("cmdReadPc");
    const mameFirstChipWriteCrossFrame = isCrossFrame(mameEntry.firstChipWrite, mameEntry.command);
    const tsFirstChipWriteCrossFrame = isCrossFrame(tsEntry.firstChipWrite, tsEntry.command);
    if (mameFirstChipWriteCrossFrame) mameFirstChipWriteCrossFrameCount++;
    if (tsFirstChipWriteCrossFrame) tsFirstChipWriteCrossFrameCount++;
    if (mameFirstChipWriteCrossFrame !== tsFirstChipWriteCrossFrame) {
      fields.push("firstChipWriteCrossFrame");
      firstChipWriteCrossFrameMismatchCount++;
    }
    if (mameEntry.firstChipWrite?.kind !== tsEntry.firstChipWrite?.kind) {
      fields.push("firstChipWriteKind");
      firstChipWriteKindMismatchCount++;
    }
    if (
      mameEntry.firstChipWrite?.kind === tsEntry.firstChipWrite?.kind &&
      (mameEntry.firstChipWrite?.pc !== tsEntry.firstChipWrite?.pc ||
        mameEntry.firstChipWrite?.reg !== tsEntry.firstChipWrite?.reg ||
        mameEntry.firstChipWrite?.val !== tsEntry.firstChipWrite?.val)
    ) {
      fields.push("firstChipWritePayload");
      firstChipWritePayloadMismatchCount++;
    }
    const nmiDelta = deltaBetween(tsEntry.nmiFromCommand, mameEntry.nmiFromCommand);
    const cmdReadDelta = deltaBetween(tsEntry.cmdReadFromNmi, mameEntry.cmdReadFromNmi);
    const chipWriteDelta = deltaBetween(tsEntry.firstChipWriteFromNmi, mameEntry.firstChipWriteFromNmi);
    if (nmiDelta !== undefined) addDelta(nmiFromCommandDelta, nmiFromCommandDeltaAbs, nmiDelta);
    if (cmdReadDelta !== undefined) addDelta(cmdReadFromNmiDelta, cmdReadFromNmiDeltaAbs, cmdReadDelta);
    if (chipWriteDelta !== undefined) {
      addDelta(firstChipWriteFromNmiDelta, firstChipWriteFromNmiDeltaAbs, chipWriteDelta);
    }
    if (nmiDelta !== 0) fields.push("nmiFromCommand");
    if (cmdReadDelta !== 0) fields.push("cmdReadFromNmi");
    if (chipWriteDelta !== 0) fields.push("firstChipWriteFromNmi");

    if (fields.length > 0) {
      const mismatch: CommandNmiWindowMismatch = {
        index: i,
        fields: Array.from(new Set(fields)),
        nmiFromCommandDelta: nmiDelta,
        cmdReadFromNmiDelta: cmdReadDelta,
        firstChipWriteFromNmiDelta: chipWriteDelta,
        mame: serializeCommandNmiWindow(mameEntry),
        ts: serializeCommandNmiWindow(tsEntry),
      };
      firstMismatch ??= mismatch;
      if (samples.length < sampleLimit) samples.push(mismatch);
    }
  }

  const unpairedCount = Math.abs(mame.length - ts.length);
  if (unpairedCount > 0 && samples.length < sampleLimit) {
    const longer = mame.length > ts.length ? mame : ts;
    for (let i = pairedCount; i < longer.length && samples.length < sampleLimit; i++) {
      samples.push({
        index: i,
        fields: ["missing"],
        nmiFromCommandDelta: undefined,
        cmdReadFromNmiDelta: undefined,
        firstChipWriteFromNmiDelta: undefined,
        mame: serializeCommandNmiWindow(mame[i]),
        ts: serializeCommandNmiWindow(ts[i]),
      });
    }
  }

  return {
    pairedCount,
    mameCount: mame.length,
    tsCount: ts.length,
    unpairedCount,
    nmiMissingCount,
    cmdReadMissingCount,
    firstChipWriteMissingCount,
    firstChipWriteKindMismatchCount,
    firstChipWritePayloadMismatchCount,
    firstChipWriteCrossFrameCount: {
      mame: mameFirstChipWriteCrossFrameCount,
      ts: tsFirstChipWriteCrossFrameCount,
      mismatch: firstChipWriteCrossFrameMismatchCount,
    },
    nmiFromCommandDelta,
    cmdReadFromNmiDelta,
    firstChipWriteFromNmiDelta,
    firstMismatch,
    samples,
  };
}

type OrderedTracePoint = Pick<
  TraceEvent | StatusReadEvent | ReplyHandshakeEvent | CommandBoundaryEvent,
  "frame" | "cycle" | "cycleInFrame"
>;

function eventOrderKey(event: OrderedTracePoint): number | undefined {
  if (event.cycle !== undefined) return event.cycle;
  if (event.frame !== undefined && event.cycleInFrame !== undefined) {
    return event.frame * 1_000_000 + event.cycleInFrame;
  }
  return undefined;
}

function isAfterEvent(
  event: OrderedTracePoint,
  anchor: OrderedTracePoint,
): boolean {
  const eventKey = eventOrderKey(event);
  const anchorKey = eventOrderKey(anchor);
  if (eventKey !== undefined && anchorKey !== undefined) return eventKey > anchorKey;
  if (event.frame !== undefined && anchor.frame !== undefined && event.frame !== anchor.frame) {
    return event.frame > anchor.frame;
  }
  if (event.cycleInFrame === undefined || anchor.cycleInFrame === undefined) return false;
  return event.cycleInFrame > anchor.cycleInFrame;
}

function isBeforeEvent(
  event: OrderedTracePoint,
  anchor: OrderedTracePoint,
): boolean {
  const eventKey = eventOrderKey(event);
  const anchorKey = eventOrderKey(anchor);
  if (eventKey !== undefined && anchorKey !== undefined) return eventKey < anchorKey;
  if (event.frame !== undefined && anchor.frame !== undefined && event.frame !== anchor.frame) {
    return event.frame < anchor.frame;
  }
  if (event.cycleInFrame === undefined || anchor.cycleInFrame === undefined) return false;
  return event.cycleInFrame < anchor.cycleInFrame;
}

function cycleDeltaWithinTrace(
  later: OrderedTracePoint | undefined,
  earlier: OrderedTracePoint | undefined,
): number | undefined {
  if (later === undefined || earlier === undefined) return undefined;
  if (later.cycle !== undefined && earlier.cycle !== undefined) return later.cycle - earlier.cycle;
  if (
    later.frame !== undefined &&
    earlier.frame !== undefined &&
    later.frame === earlier.frame &&
    later.cycleInFrame !== undefined &&
    earlier.cycleInFrame !== undefined
  ) {
    return later.cycleInFrame - earlier.cycleInFrame;
  }
  return undefined;
}

function replyHandshakeEvents(events: readonly TraceEvent[], kind: "replyWrite" | "mainReplyRead" | "mainReplyAck"): ReplyHandshakeEvent[] {
  return events
    .filter((event) => event.kind === kind)
    .map((event) => ({
      frame: event.frame,
      cycle: event.cycle,
      cycleInFrame: event.cycleInFrame,
      pc: event.pc,
      soundPc: event.soundPc,
      addr: event.addr,
      val: event.val,
    }));
}

function serializeReplyHandshakeEvent(
  event: ReplyHandshakeEvent | undefined,
): SerializedReplyHandshakeEvent | undefined {
  if (event === undefined) return undefined;
  return {
    frame: event.frame,
    cycleInFrame: event.cycleInFrame,
    pc: hex(event.pc, 4),
    soundPc: hex(event.soundPc, 4),
    addr: hex(event.addr, 6),
    val: hex(event.val, 2),
  };
}

function serializeReplyHandshakeWindow(
  window: ReplyHandshakeWindow | undefined,
): SerializedReplyHandshakeWindow | undefined {
  if (window === undefined) return undefined;
  return {
    replyWrite: serializeReplyHandshakeEvent(window.replyWrite)!,
    ack: serializeReplyHandshakeEvent(window.ack),
    ackDelayCycles: window.ackDelayCycles,
    statusReadCountBeforeAck: window.statusReadCountBeforeAck,
    statusReadSoundPendingCountBeforeAck: window.statusReadSoundPendingCountBeforeAck,
    firstStatusReadAfterWrite: serializeStatusRead(window.firstStatusReadAfterWrite),
    firstStatusReadWithSoundPending: serializeStatusRead(window.firstStatusReadWithSoundPending),
    firstStatusReadWithoutSoundPendingBeforeAck:
      serializeStatusRead(window.firstStatusReadWithoutSoundPendingBeforeAck),
  };
}

function buildReplyHandshakeWindows(
  events: readonly TraceEvent[],
  source: "mame" | "ts",
): ReplyHandshakeWindow[] {
  const replies = replyHandshakeEvents(events, "replyWrite");
  const acks = source === "mame"
    ? replyHandshakeEvents(events, "mainReplyRead")
    : [
      ...replyHandshakeEvents(events, "mainReplyAck"),
      ...replyHandshakeEvents(events, "mainReplyRead"),
    ].sort((a, b) => (eventOrderKey(a) ?? 0) - (eventOrderKey(b) ?? 0));
  const statusReads = statusReadEvents(events);
  const windows: ReplyHandshakeWindow[] = [];

  for (const replyWrite of replies) {
    const ack = acks.find((candidate) => isAfterEvent(candidate, replyWrite));
    const readsBeforeAck = statusReads.filter((status) =>
      isAfterEvent(status, replyWrite) && (ack === undefined || isBeforeEvent(status, ack)));
    const firstStatusReadAfterWrite = statusReads.find((status) => isAfterEvent(status, replyWrite));
    const firstStatusReadWithSoundPending = readsBeforeAck.find((status) => ((status.val ?? 0) & 0x10) !== 0);
    const firstStatusReadWithoutSoundPendingBeforeAck = readsBeforeAck.find((status) =>
      ((status.val ?? 0) & 0x10) === 0);
    windows.push({
      replyWrite,
      ack,
      ackDelayCycles: cycleDeltaWithinTrace(ack, replyWrite),
      statusReadCountBeforeAck: readsBeforeAck.length,
      statusReadSoundPendingCountBeforeAck: readsBeforeAck.filter((status) =>
        ((status.val ?? 0) & 0x10) !== 0).length,
      firstStatusReadAfterWrite,
      firstStatusReadWithSoundPending,
      firstStatusReadWithoutSoundPendingBeforeAck,
    });
  }

  return windows;
}

function summarizeReplyHandshakes(
  mameEvents: readonly TraceEvent[],
  tsEvents: readonly TraceEvent[],
  sampleLimit: number,
): ReplyHandshakeSummary {
  const mame = buildReplyHandshakeWindows(mameEvents, "mame");
  const ts = buildReplyHandshakeWindows(tsEvents, "ts");
  const pairedCount = Math.min(mame.length, ts.length);
  const replyWriteCycleDelta = makeStats();
  const replyWriteCycleDeltaAbs = { value: 0 };
  const mameAckDelay = makeStats();
  const mameAckDelayAbs = { value: 0 };
  const tsAckDelay = makeStats();
  const tsAckDelayAbs = { value: 0 };
  const ackDelayDelta = makeStats();
  const ackDelayDeltaAbs = { value: 0 };
  const samples: ReplyHandshakeMismatch[] = [];
  let replyValueMismatchCount = 0;
  let soundPendingPollVisibilityMismatchCount = 0;
  let firstMismatch: ReplyHandshakeMismatch | undefined;

  for (let i = 0; i < pairedCount; i++) {
    const mameEntry = mame[i]!;
    const tsEntry = ts[i]!;
    const fields: string[] = [];
    if (mameEntry.replyWrite.val !== tsEntry.replyWrite.val) {
      fields.push("replyVal");
      replyValueMismatchCount++;
    }
    const replyDelta = mameEntry.replyWrite.cycleInFrame === undefined || tsEntry.replyWrite.cycleInFrame === undefined
      ? undefined
      : tsEntry.replyWrite.cycleInFrame - mameEntry.replyWrite.cycleInFrame;
    if (replyDelta !== undefined) addDelta(replyWriteCycleDelta, replyWriteCycleDeltaAbs, replyDelta);
    if (mameEntry.ackDelayCycles !== undefined) addDelta(mameAckDelay, mameAckDelayAbs, mameEntry.ackDelayCycles);
    if (tsEntry.ackDelayCycles !== undefined) addDelta(tsAckDelay, tsAckDelayAbs, tsEntry.ackDelayCycles);
    const delayDelta = mameEntry.ackDelayCycles === undefined || tsEntry.ackDelayCycles === undefined
      ? undefined
      : tsEntry.ackDelayCycles - mameEntry.ackDelayCycles;
    if (delayDelta !== undefined) addDelta(ackDelayDelta, ackDelayDeltaAbs, delayDelta);
    const mameSawPending = mameEntry.statusReadSoundPendingCountBeforeAck > 0;
    const tsSawPending = tsEntry.statusReadSoundPendingCountBeforeAck > 0;
    if (mameSawPending !== tsSawPending) {
      fields.push("soundPendingPolls");
      soundPendingPollVisibilityMismatchCount++;
    }
    if ((mameEntry.ack === undefined) !== (tsEntry.ack === undefined)) fields.push("ackMissing");

    if (fields.length > 0) {
      const mismatch: ReplyHandshakeMismatch = {
        index: i,
        fields,
        replyWriteDelta: replyDelta,
        ackDelayDelta: delayDelta,
        mame: serializeReplyHandshakeWindow(mameEntry),
        ts: serializeReplyHandshakeWindow(tsEntry),
      };
      firstMismatch ??= mismatch;
      if (samples.length < sampleLimit) samples.push(mismatch);
    }
  }

  const unpairedReplyWriteCount = Math.abs(mame.length - ts.length);
  if (unpairedReplyWriteCount > 0 && samples.length < sampleLimit) {
    const longer = mame.length > ts.length ? mame : ts;
    for (let i = pairedCount; i < longer.length && samples.length < sampleLimit; i++) {
      samples.push({
        index: i,
        fields: ["missing"],
        replyWriteDelta: undefined,
        ackDelayDelta: undefined,
        mame: serializeReplyHandshakeWindow(mame[i]),
        ts: serializeReplyHandshakeWindow(ts[i]),
      });
    }
  }

  return {
    pairedCount,
    mameReplyWriteCount: mame.length,
    tsReplyWriteCount: ts.length,
    mameAckCount: replyHandshakeEvents(mameEvents, "mainReplyRead").length,
    tsAckCount: replyHandshakeEvents(tsEvents, "mainReplyAck").length +
      replyHandshakeEvents(tsEvents, "mainReplyRead").length,
    unpairedReplyWriteCount,
    replyValueMismatchCount,
    soundPendingPollVisibilityMismatchCount,
    replyWriteCycleDelta,
    mameAckDelay,
    tsAckDelay,
    ackDelayDelta,
    firstMismatch,
    samples,
  };
}

function summarizeZeroPageGroup(
  kind: ZeroPageKind,
  addr: number,
  mame: readonly ZeroPageEvent[],
  ts: readonly ZeroPageEvent[],
  sampleLimit: number,
): ZeroPageGroupSummary {
  const pairedCount = Math.min(mame.length, ts.length);
  const cycleDelta = makeStats();
  const cycleDeltaAbs = { value: 0 };
  const samples: ZeroPageMismatch[] = [];
  let valueMismatchCount = 0;
  let pcMismatchCount = 0;
  let stateMismatchCount = 0;
  let firstMismatch: ZeroPageMismatch | undefined;

  for (let i = 0; i < pairedCount; i++) {
    const mameEntry = mame[i]!;
    const tsEntry = ts[i]!;
    const fields = zeroPageStateFields(mameEntry, tsEntry);
    const delta = mameEntry.cycleInFrame === undefined || tsEntry.cycleInFrame === undefined
      ? undefined
      : tsEntry.cycleInFrame - mameEntry.cycleInFrame;
    if (delta !== undefined) addDelta(cycleDelta, cycleDeltaAbs, delta);
    if (mameEntry.val !== tsEntry.val) valueMismatchCount++;
    if (mameEntry.pc !== tsEntry.pc) pcMismatchCount++;
    if (fields.length === 0) continue;

    stateMismatchCount++;
    const mismatch: ZeroPageMismatch = {
      index: i,
      fields,
      delta,
      mame: serializeZeroPage(mameEntry),
      ts: serializeZeroPage(tsEntry),
    };
    firstMismatch ??= mismatch;
    if (samples.length < sampleLimit) samples.push(mismatch);
  }

  const unpairedCount = Math.abs(mame.length - ts.length);
  if (unpairedCount > 0 && samples.length < sampleLimit) {
    const longer = mame.length > ts.length ? mame : ts;
    for (let i = pairedCount; i < longer.length && samples.length < sampleLimit; i++) {
      samples.push({
        index: i,
        fields: ["missing"],
        delta: undefined,
        mame: serializeZeroPage(mame[i]),
        ts: serializeZeroPage(ts[i]),
      });
    }
  }

  return {
    kind,
    addr: hex(addr, 2)!,
    pairedCount,
    mameCount: mame.length,
    tsCount: ts.length,
    unpairedCount,
    valueMismatchCount,
    pcMismatchCount,
    stateMismatchCount,
    cycleDelta,
    firstMismatch,
    samples,
  };
}

function summarizeZeroPage(
  mameEvents: readonly TraceEvent[],
  tsEvents: readonly TraceEvent[],
  sampleLimit: number,
): ZeroPageSummary {
  const mameGroups = groupZeroPageEvents(zeroPageEvents(mameEvents));
  const tsGroups = groupZeroPageEvents(zeroPageEvents(tsEvents));
  const keys = new Set([...mameGroups.keys(), ...tsGroups.keys()]);
  const groups = [...keys]
    .map((key) => {
      const [kindRaw, addrRaw] = key.split(":");
      if (kindRaw !== "zpRead" && kindRaw !== "zpWrite") {
        throw new Error(`Unexpected zero-page group kind: ${key}`);
      }
      const kind: ZeroPageKind = kindRaw;
      const addr = Number(addrRaw);
      if (!Number.isFinite(addr)) throw new Error(`Unexpected zero-page group address: ${key}`);
      return summarizeZeroPageGroup(kind, addr, mameGroups.get(key) ?? [], tsGroups.get(key) ?? [], sampleLimit);
    })
    .sort((a, b) =>
      a.kind.localeCompare(b.kind) ||
      Number.parseInt(a.addr, 16) - Number.parseInt(b.addr, 16));
  return {
    groupCount: groups.length,
    groups,
  };
}

function summarizeKind(
  kind: TraceKind,
  mameEvents: readonly TraceEvent[],
  tsEvents: readonly TraceEvent[],
  sampleLimit: number,
): KindSummary {
  const mame = writesWithFetch(mameEvents, kind);
  const ts = writesWithFetch(tsEvents, kind);
  const pairedCount = Math.min(mame.length, ts.length);
  const writeCycleDeltaRuns = summarizeWriteCycleDeltaRuns(mame, ts, sampleLimit);
  const writeCycleDelta = makeStats();
  const writeCycleDeltaAbs = { value: 0 };
  const pcFetchCycleDelta = makeStats();
  const pcFetchCycleDeltaAbs = { value: 0 };
  const pcToWriteDelta = makeStats();
  const pcToWriteDeltaAbs = { value: 0 };
  const mameWriteMinusFetch = makeStats();
  const mameWriteMinusFetchAbs = { value: 0 };
  const tsWriteMinusFetch = makeStats();
  const tsWriteMinusFetchAbs = { value: 0 };
  const samples: SampleMismatch[] = [];
  let payloadMismatchCount = 0;
  let pcFetchMissingCount = 0;
  let pcFetchComparableCount = 0;
  let pcToWriteDeltaMismatchCount = 0;

  for (let i = 0; i < pairedCount; i++) {
    const mameEntry = mame[i]!;
    const tsEntry = ts[i]!;
    const fields: string[] = [];
    if (mameEntry.write.pc !== tsEntry.write.pc) fields.push("pc");
    if (mameEntry.write.reg !== tsEntry.write.reg) fields.push("reg");
    if (mameEntry.write.val !== tsEntry.write.val) fields.push("val");
    if (fields.length > 0) payloadMismatchCount++;

    if (mameEntry.write.cycleInFrame !== undefined && tsEntry.write.cycleInFrame !== undefined) {
      addDelta(writeCycleDelta, writeCycleDeltaAbs, tsEntry.write.cycleInFrame - mameEntry.write.cycleInFrame);
    }
    if (mameEntry.pcFetch?.cycleInFrame !== undefined && tsEntry.pcFetch?.cycleInFrame !== undefined) {
      addDelta(pcFetchCycleDelta, pcFetchCycleDeltaAbs, tsEntry.pcFetch.cycleInFrame - mameEntry.pcFetch.cycleInFrame);
    }
    if (mameEntry.writeMinusFetch !== undefined) {
      addDelta(mameWriteMinusFetch, mameWriteMinusFetchAbs, mameEntry.writeMinusFetch);
    }
    if (tsEntry.writeMinusFetch !== undefined) {
      addDelta(tsWriteMinusFetch, tsWriteMinusFetchAbs, tsEntry.writeMinusFetch);
    }
    if (mameEntry.writeMinusFetch === undefined || tsEntry.writeMinusFetch === undefined) {
      pcFetchMissingCount++;
      fields.push("pcFetch");
    } else {
      pcFetchComparableCount++;
      const delta = tsEntry.writeMinusFetch - mameEntry.writeMinusFetch;
      addDelta(pcToWriteDelta, pcToWriteDeltaAbs, delta);
      if (delta !== 0) {
        pcToWriteDeltaMismatchCount++;
        fields.push("pcToWriteDelta");
      }
    }

    if (fields.length > 0 && samples.length < sampleLimit) {
      samples.push({ index: i, fields, mame: serialize(mameEntry), ts: serialize(tsEntry) });
    }
  }

  const unpairedCount = Math.abs(mame.length - ts.length);
  if (unpairedCount > 0 && samples.length < sampleLimit) {
    const longer = mame.length > ts.length ? mame : ts;
    for (let i = pairedCount; i < longer.length && samples.length < sampleLimit; i++) {
      samples.push({
        index: i,
        fields: ["missing"],
        mame: serialize(mame[i]),
        ts: serialize(ts[i]),
      });
    }
  }

  return {
    kind,
    pairedCount,
    pcFetchComparableCount,
    mameCount: mame.length,
    tsCount: ts.length,
    unpairedCount,
    payloadMismatchCount,
    pcFetchMissingCount,
    pcToWriteDeltaMismatchCount,
    writeCycleDelta,
    pcFetchCycleDelta,
    pcToWriteDelta,
    mameWriteMinusFetch,
    tsWriteMinusFetch,
    writeCycleDeltaRunCount: writeCycleDeltaRuns.runCount,
    writeCycleDeltaRuns: writeCycleDeltaRuns.runs,
    samples,
  };
}

function fmtCounts(counts: Record<string, number>, limit = 80): string {
  const entries = Object.entries(counts)
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([delta, count]) => `${delta}:${count}`);
  if (entries.length <= limit) return entries.join(",");
  return `${entries.slice(0, limit).join(",")},...+${entries.length - limit}`;
}

function fmtWritePoint(pair: SerializedWritePair): string {
  const m = pair.mame;
  const t = pair.ts;
  return `${m?.frame ?? "?"}:${m?.cycleInFrame ?? "?"} ${m?.pc ?? "?"}:` +
    `${m?.reg ?? "?"}=${m?.val ?? "?"}->${t?.cycleInFrame ?? "?"}`;
}

function fmtWriteDeltaRun(run: WriteCycleDeltaRun): string {
  return `${run.delta ?? "?"}#${run.count}[${run.startIndex}-${run.endIndex}] ` +
    `${fmtWritePoint(run.first)}..${fmtWritePoint(run.last)}`;
}

function main(): void {
  const args = parseArgs();
  const rawMameEvents = args.sortByFrameCycle
    ? sortTraceByFrameCycle(readTrace(args.mame))
    : readTrace(args.mame);
  const rawTsEvents = args.sortByFrameCycle
    ? sortTraceByFrameCycle(readTrace(args.ts))
    : readTrace(args.ts);
  const mameEvents = args.alignAfterFirstCommand
    ? trimBeforeFirstCommand(rawMameEvents)
    : rawMameEvents;
  const tsEvents = args.alignAfterFirstCommand
    ? trimBeforeFirstCommand(rawTsEvents)
    : rawTsEvents;
  const summaries = args.kinds.map((kind) =>
    summarizeKind(kind, mameEvents, tsEvents, args.mismatchSamples));
  const pcSequence = summarizePcSequence(mameEvents, tsEvents, args.pcSequenceSamples, "all");
  const pcSequenceDropInterruptPrefetch = summarizePcSequence(
    mameEvents,
    tsEvents,
    args.pcSequenceSamples,
    "dropInterruptPrefetch",
  );
  const pcTransitionAnchor = summarizePcTransitionAnchor(
    mameEvents,
    tsEvents,
    args.pcTransitionAnchor,
    args.pcTransitionLookahead,
    args.mismatchSamples,
  );
  const vectorReads = summarizeVectorReads(mameEvents, tsEvents, args.mismatchSamples);
  const statusReads = summarizeStatusReads(
    mameEvents,
    tsEvents,
    args.mismatchSamples,
    args.statusLookaheadPcFetches,
  );
  const commandBoundaries = summarizeCommandBoundaries(mameEvents, tsEvents, args.mismatchSamples);
  const commandNmi = summarizeCommandNmiWindows(mameEvents, tsEvents, args.mismatchSamples);
  const replyHandshakes = summarizeReplyHandshakes(mameEvents, tsEvents, args.mismatchSamples);
  const zeroPage = summarizeZeroPage(mameEvents, tsEvents, args.mismatchSamples);
  const report = {
    mame: args.mame,
    ts: args.ts,
    kinds: args.kinds,
    alignAfterFirstCommand: args.alignAfterFirstCommand,
    sortByFrameCycle: args.sortByFrameCycle,
    maxPayloadMismatches: args.maxPayloadMismatches,
    maxPcToWriteDeltaMismatches: args.maxPcToWriteDeltaMismatches,
    pcSequence,
    pcSequenceDropInterruptPrefetch,
    pcTransitionAnchor,
    vectorReads,
    statusReads,
    commandBoundaries,
    commandNmi,
    replyHandshakes,
    zeroPage,
    summaries,
  };
  if (args.report !== undefined) {
    mkdirSync(dirname(args.report), { recursive: true });
    writeFileSync(args.report, JSON.stringify(report, null, 2));
  }

  let failed = false;
  for (const summary of summaries) {
    const pcDeltaOk = summary.pcToWriteDeltaMismatchCount <= args.maxPcToWriteDeltaMismatches;
    const payloadOk = summary.payloadMismatchCount <= args.maxPayloadMismatches && summary.unpairedCount === 0;
    const status = pcDeltaOk && payloadOk ? "PASS" : "FAIL";
    console.log(
      `${status} ${summary.kind}: paired=${summary.pairedCount} ` +
      `pcFetchComparable=${summary.pcFetchComparableCount} ` +
      `MAME=${summary.mameCount} TS=${summary.tsCount} unpaired=${summary.unpairedCount}`,
    );
    console.log(
      `  payloadMismatches=${summary.payloadMismatchCount} ` +
      `pcFetchMissing=${summary.pcFetchMissingCount} ` +
      `pcToWriteDeltaMismatches=${summary.pcToWriteDeltaMismatchCount}`,
    );
    console.log(
      `  writeCycleDelta(ts-mame): min=${summary.writeCycleDelta.min} max=${summary.writeCycleDelta.max} ` +
      `maxAbs=${summary.writeCycleDelta.maxAbs} meanAbs=${summary.writeCycleDelta.meanAbs?.toFixed(2)} ` +
      `counts={${fmtCounts(summary.writeCycleDelta.counts)}}`,
    );
    if (summary.writeCycleDeltaRunCount > 0) {
      console.log(
        `  writeCycleDeltaRuns(first ${summary.writeCycleDeltaRuns.length}/${summary.writeCycleDeltaRunCount}): ` +
        summary.writeCycleDeltaRuns.map(fmtWriteDeltaRun).join(" | "),
      );
    }
    console.log(
      `  pcFetchCycleDelta(ts-mame): min=${summary.pcFetchCycleDelta.min} max=${summary.pcFetchCycleDelta.max} ` +
      `maxAbs=${summary.pcFetchCycleDelta.maxAbs} meanAbs=${summary.pcFetchCycleDelta.meanAbs?.toFixed(2)} ` +
      `counts={${fmtCounts(summary.pcFetchCycleDelta.counts)}}`,
    );
    console.log(
      `  pcToWriteDelta(ts-mame): min=${summary.pcToWriteDelta.min} max=${summary.pcToWriteDelta.max} ` +
      `maxAbs=${summary.pcToWriteDelta.maxAbs} meanAbs=${summary.pcToWriteDelta.meanAbs?.toFixed(2)} ` +
      `counts={${fmtCounts(summary.pcToWriteDelta.counts)}}`,
    );
    if (!pcDeltaOk || !payloadOk) failed = true;
  }
  for (const seq of [pcSequence, pcSequenceDropInterruptPrefetch]) {
    console.log(
      `PC sequence (${seq.mode}): paired=${seq.pairedCount} MAME=${seq.mameCount} TS=${seq.tsCount}`,
    );
    console.log(`  stateMismatches=${seq.stateMismatchCount}`);
    console.log(
      `  pcFetchCycleDelta(ts-mame): min=${seq.cycleDelta.min} max=${seq.cycleDelta.max} ` +
      `maxAbs=${seq.cycleDelta.maxAbs} meanAbs=${seq.cycleDelta.meanAbs?.toFixed(2)} ` +
      `counts={${fmtCounts(seq.cycleDelta.counts)}}`,
    );
    if (seq.firstPcMismatch !== undefined) {
      const m = seq.firstPcMismatch.mame;
      const t = seq.firstPcMismatch.ts;
      console.log(
        `  firstPcMismatch #${seq.firstPcMismatch.index}: ` +
        `MAME ${m?.frame ?? "?"}:${m?.cycleInFrame ?? "?"} ${m?.pc ?? "?"} ` +
        `TS ${t?.frame ?? "?"}:${t?.cycleInFrame ?? "?"} ${t?.pc ?? "?"} ` +
        `delta=${seq.firstPcMismatch.delta ?? "?"}`,
      );
    }
    if (seq.firstStateMismatch !== undefined) {
      const m = seq.firstStateMismatch.mame;
      const t = seq.firstStateMismatch.ts;
      console.log(
        `  firstStateMismatch #${seq.firstStateMismatch.index} fields=${seq.firstStateMismatch.fields.join(",")}: ` +
        `MAME ${m?.frame ?? "?"}:${m?.cycleInFrame ?? "?"} ${m?.pc ?? "?"} ` +
        `A=${m?.a ?? "?"} X=${m?.x ?? "?"} Y=${m?.y ?? "?"} P=${m?.p ?? "?"} SP=${m?.sp ?? "?"} ` +
        `TS ${t?.frame ?? "?"}:${t?.cycleInFrame ?? "?"} ${t?.pc ?? "?"} ` +
        `A=${t?.a ?? "?"} X=${t?.x ?? "?"} Y=${t?.y ?? "?"} P=${t?.p ?? "?"} SP=${t?.sp ?? "?"} ` +
        `delta=${seq.firstStateMismatch.delta ?? "?"}`,
      );
    }
    if (seq.firstNonBaselineDelta !== undefined) {
      const m = seq.firstNonBaselineDelta.mame;
      const t = seq.firstNonBaselineDelta.ts;
      console.log(
        `  firstNonBaselineDelta #${seq.firstNonBaselineDelta.index}: ` +
        `MAME ${m?.frame ?? "?"}:${m?.cycleInFrame ?? "?"} ${m?.pc ?? "?"} ` +
        `TS ${t?.frame ?? "?"}:${t?.cycleInFrame ?? "?"} ${t?.pc ?? "?"} ` +
        `delta=${seq.firstNonBaselineDelta.delta ?? "?"}`,
      );
    }
  }
  if (pcTransitionAnchor !== undefined) {
    console.log(
      `PC transition anchor (${pcTransitionAnchor.mode}) ${pcTransitionAnchor.anchorPc}: ` +
      `pairedAnchors=${pcTransitionAnchor.pairedAnchorCount} ` +
      `MAME=${pcTransitionAnchor.mameAnchorCount} TS=${pcTransitionAnchor.tsAnchorCount} ` +
      `unpaired=${pcTransitionAnchor.unpairedAnchorCount} ` +
      `mismatchWindows=${pcTransitionAnchor.mismatchWindowCount} ` +
      `lookahead=${pcTransitionAnchor.lookahead}`,
    );
    if (pcTransitionAnchor.firstMismatch !== undefined) {
      const mismatch = pcTransitionAnchor.firstMismatch;
      const m = mismatch.mame;
      const t = mismatch.ts;
      console.log(
        `  firstMismatch anchor#${mismatch.anchorOccurrence} +${mismatch.offset} ` +
        `fields=${mismatch.fields.join(",")}: ` +
        `MAME ${m?.from.cycleInFrame ?? "?"} ${m?.from.pc ?? "?"}->` +
        `${m?.to.cycleInFrame ?? "?"} ${m?.to.pc ?? "?"} ` +
        `cycles=${m?.cycles ?? "?"} ` +
        `TS ${t?.from.cycleInFrame ?? "?"} ${t?.from.pc ?? "?"}->` +
        `${t?.to.cycleInFrame ?? "?"} ${t?.to.pc ?? "?"} ` +
        `cycles=${t?.cycles ?? "?"} ` +
        `fromDelta=${mismatch.fromCycleDelta ?? "?"} ` +
        `toDelta=${mismatch.toCycleDelta ?? "?"} ` +
        `durationDelta=${mismatch.durationDelta ?? "?"}`,
      );
    }
    for (const window of pcTransitionAnchor.windows) {
      if (window.firstMismatch === undefined) continue;
      const m = window.mameAnchor;
      const t = window.tsAnchor;
      const first = window.firstMismatch;
      console.log(
        `  anchor#${window.anchorOccurrence}: ` +
        `MAME ${m?.cycleInFrame ?? "?"} ${m?.pc ?? "?"} ` +
        `TS ${t?.cycleInFrame ?? "?"} ${t?.pc ?? "?"} ` +
        `anchorDelta=${window.anchorCycleDelta ?? "?"} ` +
        `firstMismatch=+${first.offset}/${first.fields.join(",")}`,
      );
    }
  }
  if (vectorReads.mameCount > 0 || vectorReads.tsCount > 0) {
    console.log(
      `Vector reads: paired=${vectorReads.pairedCount} MAME=${vectorReads.mameCount} ` +
      `TS=${vectorReads.tsCount} unpaired=${vectorReads.unpairedCount}`,
    );
    console.log(
      `  payloadMismatches=${vectorReads.payloadMismatchCount} ` +
      `cycleDelta(ts-mame): min=${vectorReads.cycleDelta.min} max=${vectorReads.cycleDelta.max} ` +
      `maxAbs=${vectorReads.cycleDelta.maxAbs} meanAbs=${vectorReads.cycleDelta.meanAbs?.toFixed(2)} ` +
      `counts={${fmtCounts(vectorReads.cycleDelta.counts)}}`,
    );
    if (vectorReads.firstMismatch !== undefined) {
      const m = vectorReads.firstMismatch.mame;
      const t = vectorReads.firstMismatch.ts;
      console.log(
        `  firstMismatch #${vectorReads.firstMismatch.index} fields=${vectorReads.firstMismatch.fields.join(",")}: ` +
        `MAME ${m?.frame ?? "?"}:${m?.cycleInFrame ?? "?"} ${m?.vector ?? "?"} ` +
        `${m?.addr ?? "?"}=${m?.val ?? "?"} pc=${m?.pc ?? "?"} ` +
        `TS ${t?.frame ?? "?"}:${t?.cycleInFrame ?? "?"} ${t?.vector ?? "?"} ` +
        `${t?.addr ?? "?"}=${t?.val ?? "?"} pc=${t?.pc ?? "?"} ` +
        `delta=${vectorReads.firstMismatch.delta ?? "?"}`,
      );
    }
  }
  console.log(
    `Status reads: paired=${statusReads.pairedCount} MAME=${statusReads.mameCount} ` +
    `TS=${statusReads.tsCount} unpaired=${statusReads.unpairedCount}`,
  );
  console.log(
    `  payloadMismatches=${statusReads.payloadMismatchCount} ` +
    `mainToSoundBitMismatches=${statusReads.mainToSoundPendingBitMismatchCount} ` +
    `soundToMainBitMismatches=${statusReads.soundToMainPendingBitMismatchCount} ` +
    `cycleDelta(ts-mame): min=${statusReads.cycleDelta.min} max=${statusReads.cycleDelta.max} ` +
    `maxAbs=${statusReads.cycleDelta.maxAbs} meanAbs=${statusReads.cycleDelta.meanAbs?.toFixed(2)} ` +
    `counts={${fmtCounts(statusReads.cycleDelta.counts)}}`,
  );
  if (statusReads.firstMismatch !== undefined) {
    const m = statusReads.firstMismatch.mame;
    const t = statusReads.firstMismatch.ts;
    console.log(
      `  firstMismatch #${statusReads.firstMismatch.index} fields=${statusReads.firstMismatch.fields.join(",")}: ` +
      `MAME ${m?.frame ?? "?"}:${m?.cycleInFrame ?? "?"} ${m?.pc ?? "?"}=${m?.val ?? "?"} ` +
      `TS ${t?.frame ?? "?"}:${t?.cycleInFrame ?? "?"} ${t?.pc ?? "?"}=${t?.val ?? "?"} ` +
      `delta=${statusReads.firstMismatch.delta ?? "?"}`,
    );
  }
  if (statusReads.firstSoundToMainPendingBitMismatch !== undefined) {
    const status = statusReads.firstSoundToMainPendingBitMismatch;
    const m = status.mame;
    const t = status.ts;
    console.log(
      `  firstSoundToMainBitMismatch #${status.index}: ` +
      `MAME ${m?.frame ?? "?"}:${m?.cycleInFrame ?? "?"} ${m?.pc ?? "?"}=${m?.val ?? "?"} ` +
      `TS ${t?.frame ?? "?"}:${t?.cycleInFrame ?? "?"} ${t?.pc ?? "?"}=${t?.val ?? "?"} ` +
      `delta=${status.delta ?? "?"}`,
    );
  }
  if (statusReads.firstMainToSoundPendingBitMismatch !== undefined) {
    const status = statusReads.firstMainToSoundPendingBitMismatch;
    const m = status.mame;
    const t = status.ts;
    console.log(
      `  firstMainToSoundBitMismatch #${status.index}: ` +
      `MAME ${m?.frame ?? "?"}:${m?.cycleInFrame ?? "?"} ${m?.pc ?? "?"}=${m?.val ?? "?"} ` +
      `TS ${t?.frame ?? "?"}:${t?.cycleInFrame ?? "?"} ${t?.pc ?? "?"}=${t?.val ?? "?"} ` +
      `delta=${status.delta ?? "?"}`,
    );
  }
  if (statusReads.firstBranchingMismatch !== undefined) {
    const status = statusReads.firstBranchingMismatch;
    const m = status.mame;
    const t = status.ts;
    const pc = status.nextPcMismatch;
    console.log(
      `  firstBranchingMismatch #${status.index}: ` +
      `MAME ${m?.frame ?? "?"}:${m?.cycleInFrame ?? "?"} ${m?.pc ?? "?"}=${m?.val ?? "?"} ` +
      `TS ${t?.frame ?? "?"}:${t?.cycleInFrame ?? "?"} ${t?.pc ?? "?"}=${t?.val ?? "?"}`,
    );
    if (pc !== undefined) {
      console.log(
        `    nextPcMismatch +${pc.index}: ` +
        `MAME ${pc.mame?.frame ?? "?"}:${pc.mame?.cycleInFrame ?? "?"} ${pc.mame?.pc ?? "?"} ` +
        `TS ${pc.ts?.frame ?? "?"}:${pc.ts?.cycleInFrame ?? "?"} ${pc.ts?.pc ?? "?"} ` +
        `delta=${pc.delta ?? "?"}`,
      );
    }
  }
  console.log(
    `Reply handshakes: paired=${replyHandshakes.pairedCount} ` +
    `MAME replies=${replyHandshakes.mameReplyWriteCount} TS replies=${replyHandshakes.tsReplyWriteCount} ` +
    `MAME acks=${replyHandshakes.mameAckCount} TS acks=${replyHandshakes.tsAckCount} ` +
    `unpairedReplies=${replyHandshakes.unpairedReplyWriteCount}`,
  );
  console.log(
    `  replyValueMismatches=${replyHandshakes.replyValueMismatchCount} ` +
    `soundPendingPollVisibilityMismatches=${replyHandshakes.soundPendingPollVisibilityMismatchCount} ` +
    `replyWriteCycleDelta(ts-mame): min=${replyHandshakes.replyWriteCycleDelta.min} ` +
    `max=${replyHandshakes.replyWriteCycleDelta.max} ` +
    `maxAbs=${replyHandshakes.replyWriteCycleDelta.maxAbs} ` +
    `counts={${fmtCounts(replyHandshakes.replyWriteCycleDelta.counts)}}`,
  );
  console.log(
    `  ackDelay MAME={${fmtCounts(replyHandshakes.mameAckDelay.counts)}} ` +
    `TS={${fmtCounts(replyHandshakes.tsAckDelay.counts)}} ` +
    `delta(ts-mame)={${fmtCounts(replyHandshakes.ackDelayDelta.counts)}}`,
  );
  if (replyHandshakes.firstMismatch !== undefined) {
    const m = replyHandshakes.firstMismatch.mame;
    const t = replyHandshakes.firstMismatch.ts;
    console.log(
      `  firstMismatch #${replyHandshakes.firstMismatch.index} ` +
      `fields=${replyHandshakes.firstMismatch.fields.join(",")}: ` +
      `MAME reply ${m?.replyWrite.frame ?? "?"}:${m?.replyWrite.cycleInFrame ?? "?"}` +
      `=${m?.replyWrite.val ?? "?"} ack=${m?.ack?.cycleInFrame ?? "?"} ` +
      `pendingPolls=${m?.statusReadSoundPendingCountBeforeAck ?? "?"}/` +
      `${m?.statusReadCountBeforeAck ?? "?"} ` +
      `TS reply ${t?.replyWrite.frame ?? "?"}:${t?.replyWrite.cycleInFrame ?? "?"}` +
      `=${t?.replyWrite.val ?? "?"} ack=${t?.ack?.cycleInFrame ?? "?"} ` +
      `pendingPolls=${t?.statusReadSoundPendingCountBeforeAck ?? "?"}/` +
      `${t?.statusReadCountBeforeAck ?? "?"} ` +
      `replyDelta=${replyHandshakes.firstMismatch.replyWriteDelta ?? "?"} ` +
      `ackDelayDelta=${replyHandshakes.firstMismatch.ackDelayDelta ?? "?"}`,
    );
  }
  if (zeroPage.groupCount > 0) {
    const mismatchedZeroPage = zeroPage.groups.filter((group) =>
      group.stateMismatchCount > 0 || group.unpairedCount > 0);
    console.log(
      `Zero-page: groups=${zeroPage.groupCount} mismatchedGroups=${mismatchedZeroPage.length}`,
    );
    for (const group of mismatchedZeroPage.slice(0, args.mismatchSamples)) {
      console.log(
        `  ${group.kind} ${group.addr}: paired=${group.pairedCount} ` +
        `MAME=${group.mameCount} TS=${group.tsCount} unpaired=${group.unpairedCount} ` +
        `stateMismatches=${group.stateMismatchCount} valMismatches=${group.valueMismatchCount} ` +
        `pcMismatches=${group.pcMismatchCount} ` +
        `cycleDelta(ts-mame): min=${group.cycleDelta.min} max=${group.cycleDelta.max} ` +
        `counts={${fmtCounts(group.cycleDelta.counts)}}`,
      );
      if (group.firstMismatch !== undefined) {
        const m = group.firstMismatch.mame;
        const t = group.firstMismatch.ts;
        console.log(
          `    firstMismatch #${group.firstMismatch.index} fields=${group.firstMismatch.fields.join(",")}: ` +
          `MAME ${m?.frame ?? "?"}:${m?.cycleInFrame ?? "?"} pc=${m?.pc ?? "?"} ` +
          `A=${m?.a ?? "?"} X=${m?.x ?? "?"} Y=${m?.y ?? "?"} P=${m?.p ?? "?"} ` +
          `${m?.addr ?? group.addr}=${m?.val ?? "?"} ` +
          `TS ${t?.frame ?? "?"}:${t?.cycleInFrame ?? "?"} pc=${t?.pc ?? "?"} ` +
          `A=${t?.a ?? "?"} X=${t?.x ?? "?"} Y=${t?.y ?? "?"} P=${t?.p ?? "?"} ` +
          `${t?.addr ?? group.addr}=${t?.val ?? "?"} ` +
          `delta=${group.firstMismatch.delta ?? "?"}`,
        );
      }
    }
  }
  console.log(
    `Command boundaries: paired=${commandBoundaries.pairedCount} ` +
    `MAME=${commandBoundaries.mameCount} TS=${commandBoundaries.tsCount} ` +
    `unpaired=${commandBoundaries.unpairedCount}`,
  );
  console.log(
    `  byteMismatches=${commandBoundaries.byteMismatchCount} ` +
    `soundPcMismatches=${commandBoundaries.soundPcMismatchCount} ` +
    `expectedStateMismatches=${commandBoundaries.expectedStateMismatchCount} ` +
    `cycleDelta(ts-mame): min=${commandBoundaries.cycleDelta.min} max=${commandBoundaries.cycleDelta.max} ` +
    `maxAbs=${commandBoundaries.cycleDelta.maxAbs} meanAbs=${commandBoundaries.cycleDelta.meanAbs?.toFixed(2)} ` +
    `counts={${fmtCounts(commandBoundaries.cycleDelta.counts)}}`,
  );
  if (commandBoundaries.firstMismatch !== undefined) {
    const m = commandBoundaries.firstMismatch.mame;
    const t = commandBoundaries.firstMismatch.ts;
    console.log(
      `  firstMismatch #${commandBoundaries.firstMismatch.index} ` +
      `fields=${commandBoundaries.firstMismatch.fields.join(",")}: ` +
      `MAME frame=${m?.frame ?? "?"} cycle=${m?.cycleInFrame ?? "?"} ` +
      `videoCycle=${m?.videoCycleInFrame ?? "?"} pc=${m?.pc ?? "?"} ` +
      `soundPc=${m?.soundPc ?? "?"} byte=${m?.byte ?? "?"} ` +
      `TS frame=${t?.frame ?? "?"} cycle=${t?.cycleInFrame ?? "?"} ` +
      `actualCycle=${t?.actualCycleInFrame ?? "?"} soundPc=${t?.soundPc ?? "?"} ` +
      `A=${t?.a ?? "?"}/${t?.expectedSoundA ?? "?"} ` +
      `X=${t?.x ?? "?"}/${t?.expectedSoundX ?? "?"} ` +
      `Y=${t?.y ?? "?"}/${t?.expectedSoundY ?? "?"} ` +
      `P=${t?.p ?? "?"}/${t?.expectedSoundP ?? "?"} ` +
      `SP=${t?.sp ?? "?"}/${t?.expectedSoundSp ?? "?"} ` +
      `expectedPc=${t?.expectedSoundPc ?? "?"} ` +
      `byte=${t?.byte ?? "?"} delta=${commandBoundaries.firstMismatch.delta ?? "?"}`,
    );
  }
  console.log(
    `Command -> NMI windows: paired=${commandNmi.pairedCount} ` +
    `MAME=${commandNmi.mameCount} TS=${commandNmi.tsCount} unpaired=${commandNmi.unpairedCount}`,
  );
  console.log(
    `  nmiMissing=${commandNmi.nmiMissingCount} cmdReadMissing=${commandNmi.cmdReadMissingCount} ` +
    `firstChipWriteMissing=${commandNmi.firstChipWriteMissingCount} ` +
    `firstChipWriteKindMismatches=${commandNmi.firstChipWriteKindMismatchCount} ` +
    `firstChipWritePayloadMismatches=${commandNmi.firstChipWritePayloadMismatchCount}`,
  );
  console.log(
    `  nmiFromCommandDelta(ts-mame): min=${commandNmi.nmiFromCommandDelta.min} ` +
    `max=${commandNmi.nmiFromCommandDelta.max} maxAbs=${commandNmi.nmiFromCommandDelta.maxAbs} ` +
    `counts={${fmtCounts(commandNmi.nmiFromCommandDelta.counts)}}`,
  );
  console.log(
    `  cmdReadFromNmiDelta(ts-mame): min=${commandNmi.cmdReadFromNmiDelta.min} ` +
    `max=${commandNmi.cmdReadFromNmiDelta.max} maxAbs=${commandNmi.cmdReadFromNmiDelta.maxAbs} ` +
    `counts={${fmtCounts(commandNmi.cmdReadFromNmiDelta.counts)}}`,
  );
  console.log(
    `  firstChipWriteFromNmiDelta(ts-mame): min=${commandNmi.firstChipWriteFromNmiDelta.min} ` +
    `max=${commandNmi.firstChipWriteFromNmiDelta.max} maxAbs=${commandNmi.firstChipWriteFromNmiDelta.maxAbs} ` +
    `counts={${fmtCounts(commandNmi.firstChipWriteFromNmiDelta.counts)}}`,
  );
  console.log(
    `  firstChipWriteCrossFrame: MAME=${commandNmi.firstChipWriteCrossFrameCount.mame} ` +
    `TS=${commandNmi.firstChipWriteCrossFrameCount.ts} ` +
    `mismatch=${commandNmi.firstChipWriteCrossFrameCount.mismatch}`,
  );
  if (commandNmi.firstMismatch !== undefined) {
    const m = commandNmi.firstMismatch.mame;
    const t = commandNmi.firstMismatch.ts;
    console.log(
      `  firstMismatch #${commandNmi.firstMismatch.index} fields=${commandNmi.firstMismatch.fields.join(",")}: ` +
      `MAME cmd ${m?.command.frame ?? "?"}:${m?.command.cycleInFrame ?? "?"} ` +
      `nmi=${m?.nmiVector?.cycleInFrame ?? "?"}/${m?.nmiVector?.pc ?? "?"} ` +
      `read=${m?.cmdRead?.cycleInFrame ?? "?"}/${m?.cmdRead?.pc ?? "?"} ` +
      `chip=${m?.firstChipWrite?.kind ?? "?"}@${m?.firstChipWrite?.cycleInFrame ?? "?"}/` +
      `${m?.firstChipWrite?.pc ?? "?"}:${m?.firstChipWrite?.reg ?? "?"}=${m?.firstChipWrite?.val ?? "?"} ` +
      `TS cmd ${t?.command.frame ?? "?"}:${t?.command.cycleInFrame ?? "?"} ` +
      `nmi=${t?.nmiVector?.cycleInFrame ?? "?"}/${t?.nmiVector?.pc ?? "?"} ` +
      `read=${t?.cmdRead?.cycleInFrame ?? "?"}/${t?.cmdRead?.pc ?? "?"} ` +
      `chip=${t?.firstChipWrite?.kind ?? "?"}@${t?.firstChipWrite?.cycleInFrame ?? "?"}/` +
      `${t?.firstChipWrite?.pc ?? "?"}:${t?.firstChipWrite?.reg ?? "?"}=${t?.firstChipWrite?.val ?? "?"} ` +
      `nmiDelta=${commandNmi.firstMismatch.nmiFromCommandDelta ?? "?"} ` +
      `readDelta=${commandNmi.firstMismatch.cmdReadFromNmiDelta ?? "?"} ` +
      `chipDelta=${commandNmi.firstMismatch.firstChipWriteFromNmiDelta ?? "?"}`,
    );
  }
  if (failed) process.exitCode = 1;
}

main();
