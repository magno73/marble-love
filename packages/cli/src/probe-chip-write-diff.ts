/**
 * probe-chip-write-diff.ts — ordered YM2151/POKEY write diff, TS SoundChip vs MAME.
 *
 * Typical flow:
 *   MARBLE_YM_TARGET=2000 MARBLE_YM_TAP_OUT=/tmp/mame_ym_writes.json \
 *     mame marble -rompath roms -video none -sound none -skip_gameinfo \
 *     -autoboot_script oracle/mame_ym2151_write_log.lua -autoboot_delay 0
 *
 *   npx tsx packages/cli/src/probe-chip-write-diff.ts \
 *     --mame-ym /tmp/mame_ym_writes.json --frames 2000 --compare-count 1098
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import {
  createSoundChip,
  type CmdTape,
  drainChipWriteEvents,
  drainPokeyDiagnosticRawTransitions,
  drainSoundCommandReadEvents,
  loadCmdTape,
  setPokeyDiagnosticRawTransitions,
  tickFrameWithTape,
  cmdTapeAbsoluteCycle,
  cmdTapeReplayCycleInFrame,
  cmdTapeReplaySignedCycleInFrame,
  type ChipWriteEvent,
  type CmdTapeCommandTiming,
  type PokeyRawTransition,
  type SoundCommandReadEvent,
  DEFAULT_COMMAND_NMI_SAMPLE_CYCLE,
  SOUND_CMD_TAPE_CPU_HZ,
  SOUND_CMD_TAPE_CPU_HZ_NUMERATOR,
  SOUND_CMD_TAPE_CPU_HZ_DENOMINATOR,
} from "../../engine/src/m6502/sound-chip.js";
import { SOUND_CYCLES_PER_FRAME } from "../../engine/src/m6502/sound-clock.js";
import { as_u8 } from "../../engine/src/wrap.js";
import {
  installSoundStatusFrameReplay,
  installSoundStatusReplay,
  loadSoundStatusReads,
  statusReplayReport,
  type SoundStatusReplayStats,
  type SoundStatusReplayValueMode,
} from "./sound-status-replay.js";
import {
  createMainReplyAckReplayForTape,
  mainReplyAckReplayReport,
  type MainReplyAckReplay,
} from "./sound-reply-ack-replay.js";
import {
  hasFlagWithAudioBitperfectPreset,
  readArgWithAudioBitperfectPreset,
  resolveAudioBitperfectPreset,
} from "./audio-bitperfect-presets.js";

type Kind = "ym2151" | "pokey";
type StatusTapeMode = "readIndex" | "frame";
type RawBusWriteParityMode = "absolute" | "offset" | "both";
type MameWriteCycleTiming = "attos" | "log";
type ReplayOptions = NonNullable<Parameters<typeof tickFrameWithTape>[3]> & {
  readonly commandCycleOffsetCycles?: number;
  readonly commandNmiBoundaryDelayInstructions?: number;
};

interface CmdTapeAdjustment {
  readonly tape: CmdTape;
  readonly adjustedCommandCount: number;
}

interface Args {
  audioBitperfectPreset: string | undefined;
  requireCommandContext: boolean;
  frames: number;
  cmdTape: string;
  cmdTapeCommandTiming: CmdTapeCommandTiming;
  mameYm: string | undefined;
  mamePokey: string | undefined;
  mameWriteCycleTiming: MameWriteCycleTiming;
  kinds: Kind[];
  compareCount: number | undefined;
  maxMismatches: number;
  mismatchSamples: number;
  frameTolerance: number;
  cycleTolerance: number;
  sampleRate: number | undefined;
  sampleTolerance: number;
  samplePhaseCycles: number;
  samplePhaseSweepCycles: number[] | undefined;
  report: string | undefined;
  commandSubmitOut: string | undefined;
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
  commandNmiDelayInstructions: number;
  commandNmiServiceDelayCycles: number;
  commandNmiSampleCycle: number;
  commandNmiBoundaryDelayInstructions: number;
  commandNmiDelayMatches: readonly CommandNmiDelayMatch[];
  commandNmiDelayChipWriteBoundaryInstructions: number | undefined;
  commandNmiDelayCompletedChipWritePreemptions: number | undefined;
  commandCycleOffsetCycles: number;
  commandCycleOffsetStartFrame: number | undefined;
  commandCycleOffsetBytes: number[] | undefined;
  commandSubmitBeforeCpuCatchup: boolean;
  tsEventCycleAdjustOpcodes: ReadonlyMap<number, number>;
  tsEventCycleAdjustMatches: readonly TsEventCycleAdjustMatch[];
  commandPreemptChipWriteLookaheadCycles: number;
  commandPreemptChipWritePcs: number[] | undefined;
  commandPreemptChipWriteCompleteBeforeTarget: boolean;
  commandPreemptChipWriteBeforeOnly: boolean;
  fixedFrameCycles: boolean;
  frameBudgetSmoothingWindow: number;
  deferChipIoWriteTiming: boolean;
  deferYmTimerControlWriteTiming: boolean;
  disableYmReset: boolean;
  cpuCliIrqDelay: boolean;
  cpuIrqPrefetchLatch: boolean;
  ymWriteEventCycleOffsetCycles: number;
  ymWriteEventCycleOffsetRegs: ReadonlyMap<number, number>;
  ymWriteEventCycleOffsetMatches: readonly YmWriteEventCycleOffsetMatch[];
  ymKeyOnWriteEventCycleOffsetCycles: number;
  ymIrqAssertionDelayCycles: number;
  ymIrqNewAssertionInstructionDelay: number;
  ymCommandEdgeEventDelayCycles: number | undefined;
  ymCommandEdgeEventAfterCycles: number;
  ymCommandEdgeEventBytes: number[] | undefined;
  ymCommandEdgeEventPcs: number[] | undefined;
  ymCommandEdgeEventRelation: CommandEdgeEventRelation;
  ymCommandEdgeEventRawDeltaMin: number | undefined;
  ymCommandEdgeEventRawDeltaMax: number | undefined;
  ymCommandEdgeEventRules: readonly CommandEdgeEventRule[];
  pokeyCommandEdgeEventAfterCycles: number;
  pokeyCommandEdgeEventRules: readonly CommandEdgeEventRule[];
  pokeyEventBoundaryDelayCycles: number;
  irqServiceDelayCycles: number;
  pokeyWriteApplyDelayCycles: number;
  pokeyWriteApplyDelayOpcodes: ReadonlyMap<number, number>;
  pokeyWriteApplyBoundaryDelayCycles: number;
  pokeyWriteApplyBoundaryDelaySampleRate: number;
  pokeyEffectiveApplyTiming: boolean;
  pcDeltaReport: boolean;
  pcDeltaReportLimit: number;
  pcDeltaReportSamples: number;
  pcDeltaReportPcs: number[] | undefined;
  pcDeltaOffsetSweepCycles: number[] | undefined;
  frameDeltaReport: boolean;
  frameDeltaReportLimit: number;
  frameOffsetSweepCycles: number[] | undefined;
  frameOffsetSweepReportLimit: number;
  pokeyBoundaryGuardSweepCycles: number[] | undefined;
  pokeyBoundaryCandidateReportCycles: number | undefined;
  pokeyStreamCursorReport: boolean;
  pokeyLofiCursorReport: boolean;
  eventDeltaReportMatches: readonly WriteEventDeltaReportMatch[];
  eventDeltaReportSamples: number;
  eventDeltaTargetNativeSampleDelta: number | undefined;
  requireRawBusWriteParity: boolean;
  rawBusWriteParityMode: RawBusWriteParityMode;
  rawBusWriteToleranceCycles: number;
  rawBusWriteMaxMismatches: number;
  tsYmWriteOut: string | undefined;
  tsYmWriteOutOrigin: "absolute" | "replay";
}

interface YmWriteEventCycleOffsetMatch {
  readonly frame?: number;
  readonly pc?: number;
  readonly reg?: number;
  readonly val?: number;
  readonly cycleInFrameMin?: number;
  readonly cycleInFrameMax?: number;
  readonly deltaCycles: number;
}

interface TsEventCycleAdjustMatch {
  readonly kind?: Kind;
  readonly frame?: number;
  readonly pc?: number;
  readonly reg?: number;
  readonly val?: number;
  readonly cycleInFrameMin?: number;
  readonly cycleInFrameMax?: number;
  readonly deltaCycles: number;
}

interface WriteEventDeltaReportMatch {
  readonly frame?: number;
  readonly pc?: number;
  readonly reg?: number;
  readonly val?: number;
}

interface CommandNmiDelayMatch {
  readonly frame?: number;
  readonly byte?: number;
  readonly cycleInFrame?: number;
  readonly delayInstructions: number;
}

interface NormalizedWrite {
  kind: Kind;
  frame: number | undefined;
  cycle: number | undefined;
  cycleInFrame: number | undefined;
  replayCycle: number | undefined;
  rawCycle: number | undefined;
  rawCycleInFrame: number | undefined;
  rawReplayCycle: number | undefined;
  busCycle: number | undefined;
  busCycleInFrame: number | undefined;
  busReplayCycle: number | undefined;
  pc: number | undefined;
  opcode: number | undefined;
  instFrame: number | undefined;
  instPc: number | undefined;
  instOpcode: number | undefined;
  instDeltaCycles: number | undefined;
  writeCycleOffset: number | undefined;
  rawWriteCycleOffset: number | undefined;
  busWriteCycleOffset: number | undefined;
  chipEventCycleOffset: number | undefined;
  eventCycleAdjust: number | undefined;
  pokeyEffectiveApplyDelayCycles: number | undefined;
  commandEdgeEventAdjust: CommandEdgeEventAdjust | undefined;
  schedulerFrameStartDelta: number | undefined;
  schedulerFrameEndDelta: number | undefined;
  schedulerFrameCycles: number | undefined;
  schedulerFrameCommandCount: number | undefined;
  reg: number;
  val: number;
}

interface CommandEdgeEventAdjust {
  readonly ruleIndex: number;
  readonly sourceIndex: number;
  readonly frame: number | undefined;
  readonly byte: number;
  readonly soundPc: number | undefined;
  readonly cycleInFrame: number | undefined;
  readonly commandReplayCycle: number;
  readonly relation: Exclude<CommandEdgeEventRelation, "both">;
  readonly rawDeltaFromCommand: number;
  readonly targetReplayCycle: number;
  readonly targetAnchor: CommandEdgeEventAnchor;
  readonly targetDelayCycles: number;
  readonly deltaCycles: number;
  readonly commandDeltaFromRawStepStart: number;
  readonly rawReplayCycle: number;
  readonly rawStepStart: number;
  readonly rawWriteCycleOffset: number;
  readonly rawCycleInFrame: number | undefined;
  readonly targetWriteCycleOffset: number;
  readonly writeFrame: number | undefined;
  readonly writeCycleInFrame: number | undefined;
  readonly writePc: number | undefined;
  readonly writeOpcode: number | undefined;
  readonly writeReg: number;
  readonly writeVal: number;
  readonly firstTsCommandRead: CommandReadContext | undefined;
  readonly rawDeltaFromFirstTsCommandRead: number | undefined;
  readonly targetDeltaFromFirstTsCommandRead: number | undefined;
  readonly commandSubmit: CommandSubmitContext | undefined;
}

interface PokeyEventBoundaryDelaySummary {
  readonly thresholdCycles: number;
  readonly applied: number;
  readonly byOffsetToEnd: Record<string, number>;
}

interface PokeyEffectiveApplyTimingSummary {
  readonly enabled: boolean;
  readonly applied: number;
  readonly baseDelayCycles: number;
  readonly boundaryThresholdCycles: number;
  readonly boundarySampleRate: number;
  readonly opcodeDelayCount: number;
  readonly boundaryDelayCount: number;
  readonly byTotalDelay: Record<string, number>;
  readonly byOpcodeDelay: Record<string, number>;
  readonly byBoundaryDelay: Record<string, number>;
}

interface CommandEdgeEventRule {
  readonly delayCycles: number;
  readonly anchor: CommandEdgeEventAnchor;
  readonly afterCycles: number | undefined;
  readonly beforeCycles: number | undefined;
  readonly bytes: readonly number[] | undefined;
  readonly pcs: readonly number[] | undefined;
  readonly commandPcs: readonly number[] | undefined;
  readonly excludedCommandPcs: readonly number[] | undefined;
  readonly writeRegs: readonly number[] | undefined;
  readonly writeVals: readonly number[] | undefined;
  readonly writeRegVals: readonly CommandEdgeWriteRegVal[] | undefined;
  readonly relation: CommandEdgeEventRelation;
  readonly rawDeltaMin: number | undefined;
  readonly rawDeltaMax: number | undefined;
}

interface CommandEdgeWriteRegVal {
  readonly reg: number;
  readonly val: number;
}

type CommandEdgeEventRelation = "both" | "raw-before" | "raw-crossing" | "raw-after";
type CommandEdgeEventAnchor = "command" | "first-read" | "current-event";

type OpcodeReader = (pc: number | undefined) => number | undefined;

type ChipWriteEventWithRawTiming = ChipWriteEvent & {
  readonly rawCycle?: number;
  readonly rawCycleInFrame?: number;
  readonly rawWriteCycleOffset?: number;
  readonly eventCycleOffset?: number;
};

interface TimingOrigin {
  readonly frame: number;
  readonly secs?: number;
  readonly attos?: string;
  readonly absoluteCycle?: bigint;
  readonly replayCycle?: number;
}

function cmdFrameOriginAbsoluteCycle(cmd: {
  readonly secs?: number;
  readonly attos?: string;
  readonly cycleInFrame?: number;
}): bigint | undefined {
  const absoluteCycle = cmdTapeAbsoluteCycle(cmd);
  if (absoluteCycle === undefined) return undefined;
  if (cmd.cycleInFrame === undefined) return absoluteCycle;
  return absoluteCycle - BigInt(Math.trunc(cmd.cycleInFrame));
}

function cmdFrameOriginAbsoluteCycleForTiming(
  cmd: {
    readonly secs?: number;
    readonly attos?: string;
    readonly cycleInFrame?: number;
  },
  commandTiming: CmdTapeCommandTiming,
): bigint | undefined {
  return commandTiming === "secsAttos" ? cmdTapeAbsoluteCycle(cmd) : cmdFrameOriginAbsoluteCycle(cmd);
}

interface CommandReplayEvent {
  readonly sourceIndex: number;
  readonly frame: number | undefined;
  readonly byte: number;
  readonly cycleInFrame: number | undefined;
  readonly replayCycle: number;
  readonly soundPc: number | undefined;
  readonly soundA: number | undefined;
  readonly soundX: number | undefined;
  readonly soundY: number | undefined;
  readonly soundP: number | undefined;
  readonly soundSp: number | undefined;
  readonly instFrame: number | undefined;
  readonly instPc: number | undefined;
  readonly instOpcode: number | undefined;
  readonly instDeltaCycles: number | undefined;
  readonly nextInstFrame: number | undefined;
  readonly nextInstPc: number | undefined;
  readonly nextInstOpcode: number | undefined;
  readonly nextInstDeltaCycles: number | undefined;
  readonly nextChronoInstFrame: number | undefined;
  readonly nextChronoInstPc: number | undefined;
  readonly nextChronoInstOpcode: number | undefined;
  readonly nextChronoInstDeltaCycles: number | undefined;
}

interface MameSoundCommandReadEvent {
  readonly sourceIndex: number | undefined;
  readonly frame: number | undefined;
  readonly byte: number;
  readonly cycleInFrame: number | undefined;
  readonly replayCycle: number;
  readonly pc: number | undefined;
  readonly instFrame: number | undefined;
  readonly instPc: number | undefined;
  readonly instOpcode: number | undefined;
  readonly instDeltaCycles: number | undefined;
  readonly deltaFromCommand: number | undefined;
}

interface CommandContextSummary {
  readonly total: number;
  readonly withCycleTiming: number;
  readonly withSoundPc: number;
  readonly withInstContext: number;
  readonly withNextInstContext: number;
  readonly withNextChronoInstContext: number;
}

interface MameSoundCommandReadSummary {
  readonly total: number;
  readonly withSourceIndex: number;
  readonly withCommandDelta: number;
  readonly withInstContext: number;
}

interface CommandReadComparisonSummary {
  readonly totalCommands: number;
  readonly withTsRead: number;
  readonly withMameRead: number;
  readonly withBothReads: number;
  readonly mameMinusTsReadDeltaStats: {
    readonly compared: number;
    readonly min: number | undefined;
    readonly max: number | undefined;
    readonly maxAbs: number | undefined;
    readonly meanAbs: number | undefined;
  };
  readonly byTsReadDeltaFromCommand: Record<string, number>;
  readonly byMameReadDeltaFromCommand: Record<string, number>;
  readonly byMameMinusTsReadDelta: Record<string, number>;
  readonly bySubmitNmiDelayInstructions: Record<string, number>;
  readonly bySubmitNmiDelayAndReadDelta: Record<string, number>;
  readonly byCommandByteCycle: Record<string, number>;
  readonly byCommandSoundPc: Record<string, number>;
  readonly firstMaxAbsReadDelta?: CommandReadComparisonSample;
  readonly samples: CommandReadComparisonSample[];
}

interface CommandReadComparisonSample {
  readonly sourceIndex: number;
  readonly frame: number | undefined;
  readonly byte: string;
  readonly cycleInFrame: number | undefined;
  readonly soundPc?: string;
  readonly submitDelay?: number;
  readonly submitActualDeltaFromCommand?: number;
  readonly tsReadDeltaFromCommand?: number;
  readonly mameReadDeltaFromCommand?: number;
  readonly mameMinusTsReadDelta?: number;
  readonly tsReadPc?: string;
  readonly mameReadPc?: string;
}

interface CommandSubmitStateComparisonSummary {
  totalCommands: number;
  withExpectedState: number;
  withActualState: number;
  exact: number;
  exactIgnoringP: number;
  mismatch: number;
  byMismatchField: Record<string, number>;
  byExpectedPc: Record<string, number>;
  byActualPc: Record<string, number>;
  byActualPcRelation: Record<string, number>;
  firstMismatch?: CommandSubmitStateMismatchSample;
  samples: CommandSubmitStateMismatchSample[];
}

interface CommandSubmitStateMismatchSample {
  readonly sourceIndex: number | undefined;
  readonly frame: number;
  readonly byte: string;
  readonly cycleInFrame: number;
  readonly actualCycleInFrame: number;
  readonly fields: string[];
  readonly actualPcRelation: string;
  readonly expected: CommandSubmitCpuStateJson;
  readonly actual: CommandSubmitCpuStateJson;
}

interface CommandCrossing {
  commandCycle: number;
  tsDelta: number | undefined;
  mameDelta: number | undefined;
  tsStepStart: number | undefined;
  tsWriteOffset: number | undefined;
  targetInsideTsWriteInstruction: boolean;
  rawTsDelta?: number | undefined;
  rawTsStepStart?: number | undefined;
  rawTsWriteOffset?: number | undefined;
  rawTargetInsideTsWriteInstruction?: boolean;
  chipEventCycleOffset?: number | undefined;
}

interface CommandNearMiss {
  commandCycle: number;
  tsDeltaBeforeCommand: number;
  mameDelta: number | undefined;
}

interface CommandContextEntry {
  sourceIndex: number;
  frame: number | undefined;
  byte: number;
  cycleInFrame: number | undefined;
  replayCycle: number;
  soundPc: number | undefined;
  instFrame: number | undefined;
  instPc: number | undefined;
  instOpcode: number | undefined;
  instDeltaCycles: number | undefined;
  nextInstFrame: number | undefined;
  nextInstPc: number | undefined;
  nextInstOpcode: number | undefined;
  nextInstDeltaCycles: number | undefined;
  nextChronoInstFrame: number | undefined;
  nextChronoInstPc: number | undefined;
  nextChronoInstOpcode: number | undefined;
  nextChronoInstDeltaCycles: number | undefined;
  tsDelta: number | undefined;
  mameDelta: number | undefined;
  firstTsCommandRead?: CommandReadContext;
  submit?: CommandSubmitContext;
}

interface CommandReadContext {
  frame: number | undefined;
  cycleInFrame: number | undefined;
  replayCycle: number;
  pc: number;
  val: number;
  readCycleOffset: number;
  deltaFromCommand: number;
  deltaFromTsWrite: number | undefined;
}

interface CommandContext {
  previous?: CommandContextEntry;
  next?: CommandContextEntry;
  nearest?: CommandContextEntry;
}

interface MismatchCluster {
  pc: string;
  count: number;
  commandCrossings: number;
  rawCommandCrossings: number;
  commandNearMisses: number;
  rawCommandNearMisses: number;
  firstIndex: number;
  firstFields: string[];
  firstTs: NormalizedWrite | undefined;
  firstMame: NormalizedWrite | undefined;
  fieldCounts: Record<string, number>;
  replayCycleDelta: {
    compared: number;
    min: number | undefined;
    max: number | undefined;
    maxAbs: number | undefined;
    meanAbs: number | undefined;
  };
  nativeSampleDelta: {
    sampleRate: number | undefined;
    samplePhaseCycles: number;
    compared: number;
    min: number | undefined;
    max: number | undefined;
    maxAbs: number | undefined;
    meanAbs: number | undefined;
  };
  firstCommandCrossing?: {
    index: number;
    crossing: CommandCrossing;
  };
  firstRawCommandCrossing?: {
    index: number;
    crossing: CommandCrossing;
  };
  firstCommandNearMiss?: {
    index: number;
    nearMiss: CommandNearMiss;
  };
  firstRawCommandNearMiss?: {
    index: number;
    nearMiss: CommandNearMiss;
  };
}

interface PcDeltaReportEntry {
  pc: string;
  compared: number;
  mismatchCount: number;
  firstIndex: number;
  lastIndex: number;
  firstTs: NormalizedWrite | undefined;
  firstMame: NormalizedWrite | undefined;
  lastTs: NormalizedWrite | undefined;
  lastMame: NormalizedWrite | undefined;
  fieldCounts: Record<string, number>;
  replayCycleDelta: {
    compared: number;
    min: number | undefined;
    max: number | undefined;
    maxAbs: number | undefined;
    meanAbs: number | undefined;
  };
  nativeSampleDelta: {
    sampleRate: number | undefined;
    samplePhaseCycles: number;
    compared: number;
    min: number | undefined;
    max: number | undefined;
    maxAbs: number | undefined;
    meanAbs: number | undefined;
  };
  nativeSampleDeltaHistogram: Record<string, number>;
  nativeSampleMismatchTargetCycleOffset: {
    sampleRate: number | undefined;
    samplePhaseCycles: number;
    targetNativeSampleDelta: number;
    compared: number;
    min: number | undefined;
    max: number | undefined;
    maxAbs: number | undefined;
    meanAbs: number | undefined;
  };
  nativeSampleMismatchTargetCycleOffsetHistogram: Record<string, number>;
  intervalDelta: {
    compared: number;
    min: number | undefined;
    max: number | undefined;
    maxAbs: number | undefined;
    meanAbs: number | undefined;
  };
  offsetSweep?: PcDeltaOffsetSweepEntry[] | undefined;
  firstReplayCycleDelta: number | undefined;
  lastReplayCycleDelta: number | undefined;
  driftReplayCycleDelta: number | undefined;
  mismatchSamples: Array<{
    index: number;
    fields: string[];
    replayCycleDelta: number | undefined;
    nativeSampleDelta: number | undefined;
    nativeSampleTargetCycleOffset: number | undefined;
    nativeSampleTargetCycleOffsetRange: { min: number; max: number } | undefined;
    previousIndex: number | undefined;
    intervalDelta: number | undefined;
    tsInterval: number | undefined;
    mameInterval: number | undefined;
    ts: NormalizedWrite | undefined;
    mame: NormalizedWrite | undefined;
    commandContext?: CommandContext;
  }>;
  intervalOutliers: Array<{
    index: number;
    previousIndex: number | undefined;
    intervalDelta: number;
    tsInterval: number;
    mameInterval: number;
    previousTs: NormalizedWrite | undefined;
    previousMame: NormalizedWrite | undefined;
    ts: NormalizedWrite | undefined;
    mame: NormalizedWrite | undefined;
    previousCommandContext?: CommandContext;
    commandContext?: CommandContext;
  }>;
  intervalCatchUpPairs: Array<{
    first: {
      index: number;
      previousIndex: number | undefined;
      intervalDelta: number;
      tsInterval: number;
      mameInterval: number;
      ts: NormalizedWrite | undefined;
      mame: NormalizedWrite | undefined;
      previousCommandContext?: CommandContext;
      commandContext?: CommandContext;
    };
    second: {
      index: number;
      previousIndex: number | undefined;
      intervalDelta: number;
      tsInterval: number;
      mameInterval: number;
      ts: NormalizedWrite | undefined;
      mame: NormalizedWrite | undefined;
      previousCommandContext?: CommandContext;
      commandContext?: CommandContext;
    };
    netIntervalDelta: number;
  }>;
}

interface PcDeltaOffsetSweepEntry {
  offsetCycles: number;
  mismatchCount: number;
  nativeSampleDelta: {
    sampleRate: number | undefined;
    samplePhaseCycles: number;
    compared: number;
    min: number | undefined;
    max: number | undefined;
    maxAbs: number | undefined;
    meanAbs: number | undefined;
  };
  nativeSampleDeltaHistogram: Record<string, number>;
}

interface EventDeltaReportEntry {
  selector: Record<string, number | string>;
  compared: number;
  mismatchCount: number;
  fieldCounts: Record<string, number>;
  replayCycleDelta: {
    compared: number;
    min: number | undefined;
    max: number | undefined;
    maxAbs: number | undefined;
    meanAbs: number | undefined;
  };
  nativeSampleDelta: {
    sampleRate: number | undefined;
    samplePhaseCycles: number;
    compared: number;
    min: number | undefined;
    max: number | undefined;
    maxAbs: number | undefined;
    meanAbs: number | undefined;
  };
  nativeSampleDeltaHistogram: Record<string, number>;
  targetCycleOffset?: {
    sampleRate: number | undefined;
    samplePhaseCycles: number;
    targetNativeSampleDelta: number;
    compared: number;
    min: number | undefined;
    max: number | undefined;
    maxAbs: number | undefined;
    meanAbs: number | undefined;
  };
  targetCycleOffsetHistogram?: Record<string, number>;
  samples: Array<{
    index: number;
    fields: string[];
    replayCycleDelta: number | undefined;
    nativeSampleDelta: number | undefined;
    targetCycleOffset: number | undefined;
    targetCycleOffsetRange: { min: number; max: number } | undefined;
    ts: NormalizedWrite | undefined;
    mame: NormalizedWrite | undefined;
    commandContext?: CommandContext;
  }>;
}

interface NativeSampleDeltaBreakdownEntry {
  label: string;
  kind: Kind;
  category: string;
  reg?: string;
  compared: number;
  nativeSampleMismatchCount: number;
  firstNativeSampleMismatch: {
    index: number;
    nativeSampleDelta: number;
    ts: NormalizedWrite | undefined;
    mame: NormalizedWrite | undefined;
  } | undefined;
  nativeSampleDelta: {
    sampleRate: number | undefined;
    samplePhaseCycles: number;
    compared: number;
    min: number | undefined;
    max: number | undefined;
    maxAbs: number | undefined;
    meanAbs: number | undefined;
  };
  nativeSampleDeltaHistogram: Record<string, number>;
}

type NativeSampleMismatchCommandRelation = "raw-crossing" | "crossing" | "raw-near" | "near" | "far";

interface NativeSampleCommandMismatchBreakdownEntry {
  label: string;
  relation: NativeSampleMismatchCommandRelation;
  commandByte: string | undefined;
  commandSoundPc: string | undefined;
  count: number;
  firstMismatch: {
    index: number;
    nativeSampleDelta: number;
    replayCycleDelta: number | undefined;
    ts: NormalizedWrite | undefined;
    mame: NormalizedWrite | undefined;
    commandContext: CommandContext | undefined;
  };
  replayCycleDelta: {
    compared: number;
    min: number | undefined;
    max: number | undefined;
    maxAbs: number | undefined;
    meanAbs: number | undefined;
  };
  nativeSampleDelta: {
    sampleRate: number | undefined;
    samplePhaseCycles: number;
    compared: number;
    min: number | undefined;
    max: number | undefined;
    maxAbs: number | undefined;
    meanAbs: number | undefined;
  };
  nativeSampleDeltaHistogram: Record<string, number>;
  nativeSampleTargetCycleOffset: {
    sampleRate: number | undefined;
    samplePhaseCycles: number;
    targetNativeSampleDelta: number;
    compared: number;
    min: number | undefined;
    max: number | undefined;
    maxAbs: number | undefined;
    meanAbs: number | undefined;
  };
  nativeSampleTargetCycleOffsetHistogram: Record<string, number>;
  tsDeltaFromCommand: {
    compared: number;
    min: number | undefined;
    max: number | undefined;
    maxAbs: number | undefined;
    meanAbs: number | undefined;
  };
  mameDeltaFromCommand: {
    compared: number;
    min: number | undefined;
    max: number | undefined;
    maxAbs: number | undefined;
    meanAbs: number | undefined;
  };
  targetDelayWindowFromCommand: {
    sampleRate: number | undefined;
    sampleTolerance: number;
    compared: number;
    minStart: number | undefined;
    maxStart: number | undefined;
    minEnd: number | undefined;
    maxEnd: number | undefined;
    intersectionMin: number | undefined;
    intersectionMax: number | undefined;
    hasIntersection: boolean | undefined;
  };
  byTsDeltaFromCommand: Record<string, number>;
  byMameDeltaFromCommand: Record<string, number>;
  byTargetDelayWindowFromCommand: Record<string, number>;
  byNearestCommandSide: Record<string, number>;
  byNearestDeltaSign: Record<string, number>;
  byWritePc: Record<string, number>;
  byWriteOpcode: Record<string, number>;
  byWritePcOpcode: Record<string, number>;
  byWriteRegister: Record<string, number>;
  byWritePcRegister: Record<string, number>;
  byWritePcOpcodeRegister: Record<string, number>;
  byFirstReadPc: Record<string, number>;
  byFirstReadPcDeltaFromCommand: Record<string, number>;
  byFirstReadDeltaFromCommand: Record<string, number>;
  byFirstReadDeltaFromTsWrite: Record<string, number>;
  bySubmitActualDeltaFromCommand: Record<string, number>;
  bySubmitActualCycleInFrame: Record<string, number>;
  bySubmitNmiDelayInstructions: Record<string, number>;
  bySubmitOverrideDelayInstructions: Record<string, number>;
  bySubmitPendingBefore: Record<string, number>;
}

interface NativeSampleMismatchContextSummary {
  count: number;
  nativeSampleTargetCycleOffset: {
    sampleRate: number | undefined;
    samplePhaseCycles: number;
    targetNativeSampleDelta: number;
    compared: number;
    min: number | undefined;
    max: number | undefined;
    maxAbs: number | undefined;
    meanAbs: number | undefined;
  };
  nativeSampleTargetCycleOffsetHistogram: Record<string, number>;
  mameNativeSampleOffsetFromStart: {
    sampleRate: number | undefined;
    samplePhaseCycles: number;
    compared: number;
    min: number | undefined;
    max: number | undefined;
    maxAbs: number | undefined;
    meanAbs: number | undefined;
  };
  mameNativeSampleOffsetToEnd: {
    sampleRate: number | undefined;
    samplePhaseCycles: number;
    compared: number;
    min: number | undefined;
    max: number | undefined;
    maxAbs: number | undefined;
    meanAbs: number | undefined;
  };
  tsNativeSampleOffsetFromStart: {
    sampleRate: number | undefined;
    samplePhaseCycles: number;
    compared: number;
    min: number | undefined;
    max: number | undefined;
    maxAbs: number | undefined;
    meanAbs: number | undefined;
  };
  tsNativeSampleOffsetToEnd: {
    sampleRate: number | undefined;
    samplePhaseCycles: number;
    compared: number;
    min: number | undefined;
    max: number | undefined;
    maxAbs: number | undefined;
    meanAbs: number | undefined;
  };
  byMameNativeSampleOffsetFromStart: Record<string, number>;
  byMameNativeSampleOffsetToEnd: Record<string, number>;
  byTsNativeSampleOffsetFromStart: Record<string, number>;
  byTsNativeSampleOffsetToEnd: Record<string, number>;
  byRelation: Record<string, number>;
  byNativeSampleDelta: Record<string, number>;
  byNativeSampleDeltaAndTargetOffset: Record<string, number>;
  byNativeSampleDeltaAndTsOffsetToEnd: Record<string, number>;
  byNativeSampleDeltaAndMameOffsetToEnd: Record<string, number>;
  byNativeSampleDeltaAndPokeyApplyDelay: Record<string, number>;
  byPokeyApplyDelayAndTargetOffset: Record<string, number>;
  byNativeSampleDeltaAndWritePcOpcodeRegister: Record<string, number>;
  byNearestCommandSide: Record<string, number>;
  byNearestDeltaSign: Record<string, number>;
  byCommandByte: Record<string, number>;
  byCommandSoundPc: Record<string, number>;
  byCommandByteSoundPc: Record<string, number>;
  byWritePc: Record<string, number>;
  byWriteOpcode: Record<string, number>;
  byWritePcOpcode: Record<string, number>;
  byWriteRegister: Record<string, number>;
  byWritePcRegister: Record<string, number>;
  byWritePcOpcodeRegister: Record<string, number>;
  byFirstReadPc: Record<string, number>;
  byFirstReadDeltaFromCommand: Record<string, number>;
  byFirstReadPcDeltaFromCommand: Record<string, number>;
  bySubmitActualDeltaFromCommand: Record<string, number>;
  bySubmitActualCycleInFrame: Record<string, number>;
  bySubmitPreAdvanceDeltaToTarget: Record<string, number>;
  bySubmitPreAdvanceDeltaBucket: Record<string, number>;
  bySubmitPreAdvancePcOpcode: Record<string, number>;
  byMameSoundPcVsSubmitPreAdvanceRelation: Record<string, number>;
  bySubmitNmiDelayInstructions: Record<string, number>;
  bySubmitOverrideDelayInstructions: Record<string, number>;
  bySubmitPendingBefore: Record<string, number>;
  byRelationWriteOpcode: Record<string, number>;
  byNearestSignWriteOpcode: Record<string, number>;
  byCommandEdgeRule: Record<string, number>;
  byCommandEdgeRuleDeltaCycles: Record<string, number>;
  byCommandEdgeRuleTargetDelay: Record<string, number>;
  byCommandEdgeRuleWritePc: Record<string, number>;
}

interface InstructionFetchDeltaSummary {
  count: number;
  tsWriteOffsetDelta: {
    compared: number;
    min: number | undefined;
    max: number | undefined;
    maxAbs: number | undefined;
    meanAbs: number | undefined;
  };
  tsRawWriteOffsetDelta: {
    compared: number;
    min: number | undefined;
    max: number | undefined;
    maxAbs: number | undefined;
    meanAbs: number | undefined;
  };
  byMameInstDeltaCycles: Record<string, number>;
  byMameInstOpcode: Record<string, number>;
  byMameInstPcOpcode: Record<string, number>;
  byTsWriteOffset: Record<string, number>;
  byTsRawWriteOffset: Record<string, number>;
  byTsMinusMameInstDelta: Record<string, number>;
  byTsRawMinusMameInstDelta: Record<string, number>;
  byWritePc: Record<string, number>;
  byWritePcOpcode: Record<string, number>;
}

interface RawBusWriteParitySummary {
  required: boolean;
  mode: RawBusWriteParityMode;
  toleranceCycles: number;
  maxMismatches: number;
  passed: boolean;
  compared: number;
  timingCompared: number;
  missingTimingCount: number;
  orderPayloadMismatchCount: number;
  mismatchCount: number;
  replayCycleDelta: {
    compared: number;
    min: number | undefined;
    max: number | undefined;
    maxAbs: number | undefined;
    meanAbs: number | undefined;
  };
  writeOffsetDelta: {
    compared: number;
    min: number | undefined;
    max: number | undefined;
    maxAbs: number | undefined;
    meanAbs: number | undefined;
  };
  replayCycleDeltaHistogram: Record<string, number>;
  writeOffsetDeltaHistogram: Record<string, number>;
  frameDrift: RawBusFrameDriftEntry[];
  firstMismatch: {
    index: number;
    reasons: string[];
    replayCycleDelta: number | undefined;
    writeOffsetDelta: number | undefined;
    ts: NormalizedWrite | undefined;
    mame: NormalizedWrite | undefined;
  } | undefined;
}

interface RawBusFrameDriftEntry {
  frame: string;
  compared: number;
  firstIndex: number;
  firstReplayCycleDelta: number;
  replayCycleDelta: {
    compared: number;
    min: number | undefined;
    max: number | undefined;
    maxAbs: number | undefined;
    meanAbs: number | undefined;
  };
  replayCycleDeltaHistogram: Record<string, number>;
  firstTs: NormalizedWrite | undefined;
  firstMame: NormalizedWrite | undefined;
}

interface FrameDeltaReportEntry {
  frame: string;
  compared: number;
  mismatchCount: number;
  nativeSampleNonExactCount: number;
  firstIndex: number;
  firstMismatchIndex: number | undefined;
  firstNativeSampleNonExactIndex: number | undefined;
  replayCycleDelta: {
    compared: number;
    min: number | undefined;
    max: number | undefined;
    maxAbs: number | undefined;
    meanAbs: number | undefined;
  };
  replayCycleDeltaHistogram: Record<string, number>;
  busReplayCycleDelta: {
    compared: number;
    min: number | undefined;
    max: number | undefined;
    maxAbs: number | undefined;
    meanAbs: number | undefined;
  };
  busReplayCycleDeltaHistogram: Record<string, number>;
  nativeSampleDelta: {
    sampleRate: number | undefined;
    samplePhaseCycles: number;
    compared: number;
    min: number | undefined;
    max: number | undefined;
    maxAbs: number | undefined;
    meanAbs: number | undefined;
  };
  nativeSampleDeltaHistogram: Record<string, number>;
  nativeSampleTargetCycleOffset: {
    sampleRate: number | undefined;
    samplePhaseCycles: number;
    targetNativeSampleDelta: number;
    compared: number;
    min: number | undefined;
    max: number | undefined;
    maxAbs: number | undefined;
    meanAbs: number | undefined;
  };
  nativeSampleTargetCycleOffsetHistogram: Record<string, number>;
  writePcHistogram: Record<string, number>;
  commandByteHistogram: Record<string, number>;
  replayCycleDeltaSegments: FrameDeltaSegmentEntry[];
  firstTs: NormalizedWrite | undefined;
  firstMame: NormalizedWrite | undefined;
  firstMismatchTs: NormalizedWrite | undefined;
  firstMismatchMame: NormalizedWrite | undefined;
}

interface FrameDeltaSegmentEntry {
  startIndex: number;
  endIndex: number;
  compared: number;
  mismatchCount: number;
  nativeSampleNonExactCount: number;
  replayCycleDelta: number | undefined;
  busReplayCycleDelta: number | undefined;
  nativeSampleDeltaHistogram: Record<string, number>;
  firstTs: NormalizedWrite | undefined;
  firstMame: NormalizedWrite | undefined;
}

interface FrameOffsetSweepFrameEntry {
  frame: string;
  compared: number;
  baselineMismatchCount: number;
  bestMismatchCount: number;
  bestOffsetCycles: number;
  firstIndex: number;
  baselineNativeSampleDeltaHistogram: Record<string, number>;
  bestNativeSampleDeltaHistogram: Record<string, number>;
  firstTs: NormalizedWrite | undefined;
  firstMame: NormalizedWrite | undefined;
}

interface FrameOffsetSweepSummary {
  offsetCycles: number[];
  sampleRate: number | undefined;
  samplePhaseCycles: number;
  sampleTolerance: number;
  comparedFrames: number;
  exactFrameCount: number;
  compared: number;
  baselineMismatchCount: number;
  bestMismatchCount: number;
  improvementCount: number;
  bestOffsetHistogram: Record<string, number>;
  baselineNativeSampleDelta: {
    sampleRate: number | undefined;
    samplePhaseCycles: number;
    compared: number;
    min: number | undefined;
    max: number | undefined;
    maxAbs: number | undefined;
    meanAbs: number | undefined;
  };
  bestNativeSampleDelta: {
    sampleRate: number | undefined;
    samplePhaseCycles: number;
    compared: number;
    min: number | undefined;
    max: number | undefined;
    maxAbs: number | undefined;
    meanAbs: number | undefined;
  };
  baselineNativeSampleDeltaHistogram: Record<string, number>;
  bestNativeSampleDeltaHistogram: Record<string, number>;
  frames: FrameOffsetSweepFrameEntry[];
}

type PokeyBoundaryGuardSweepGuard =
  | "all"
  | "baseline-delta-lt0"
  | "baseline-delta-lte0"
  | "target-offset-gte0"
  | "target-offset-gte-delay";

interface PokeyBoundaryGuardSweepEntry {
  thresholdCycles: number;
  guard: PokeyBoundaryGuardSweepGuard;
  compared: number;
  applied: number;
  baselineMismatchCount: number;
  mismatchCount: number;
  improvementCount: number;
  nativeSampleDelta: {
    sampleRate: number | undefined;
    samplePhaseCycles: number;
    compared: number;
    min: number | undefined;
    max: number | undefined;
    maxAbs: number | undefined;
    meanAbs: number | undefined;
  };
  nativeSampleDeltaHistogram: Record<string, number>;
  appliedBoundaryDelayHistogram: Record<string, number>;
  firstMismatch: {
    index: number;
    nativeSampleDelta: number;
    baselineNativeSampleDelta: number;
    boundaryDelayCycles: number;
    totalDelayCycles: number;
    targetCycleOffset: number | undefined;
    tsPhaseBefore: { offsetFromStart: number; offsetToEnd: number } | undefined;
    tsPhaseAfter: { offsetFromStart: number; offsetToEnd: number } | undefined;
    ts: NormalizedWrite | undefined;
    mame: NormalizedWrite | undefined;
  } | undefined;
}

interface PokeyBoundaryCandidateBucket {
  key: string;
  compared: number;
  earlyCount: number;
  exactCount: number;
  lateCount: number;
  baselineMismatchCount: number;
  baselineNativeSampleDeltaHistogram: Record<string, number>;
  first: {
    index: number;
    baselineNativeSampleDelta: number;
    boundaryDelayCycles: number;
    ts: NormalizedWrite | undefined;
    mame: NormalizedWrite | undefined;
  } | undefined;
}

interface PokeyBoundaryCandidateReport {
  thresholdCycles: number;
  sampleRate: number | undefined;
  samplePhaseCycles: number;
  compared: number;
  candidateCount: number;
  earlyCount: number;
  exactCount: number;
  lateCount: number;
  baselineMismatchCount: number;
  baselineNativeSampleDeltaHistogram: Record<string, number>;
  byBoundaryDelay: PokeyBoundaryCandidateBucket[];
  byTsOffsetToEnd: PokeyBoundaryCandidateBucket[];
  byWriteRegister: PokeyBoundaryCandidateBucket[];
  byWriteEffect: PokeyBoundaryCandidateBucket[];
  byWriteEffectBoundaryDelay: PokeyBoundaryCandidateBucket[];
  byWritePc: PokeyBoundaryCandidateBucket[];
  byWritePcReg: PokeyBoundaryCandidateBucket[];
  byWritePcRegVal: PokeyBoundaryCandidateBucket[];
  byWriteCycleOffset: PokeyBoundaryCandidateBucket[];
  bySchedulerFrameStartDelta: PokeyBoundaryCandidateBucket[];
  byCommandEdgeRule: PokeyBoundaryCandidateBucket[];
}

interface PokeyStreamCursorBucket {
  key: string;
  compared: number;
  earlyCount: number;
  exactCount: number;
  lateCount: number;
  baselineMismatchCount: number;
  nativeSampleDeltaHistogram: Record<string, number>;
}

interface PokeyStreamCursorReport {
  transitionCount: number;
  compared: number;
  earlyCount: number;
  exactCount: number;
  lateCount: number;
  nativeSampleDeltaHistogram: Record<string, number>;
  byPreviousTransitionDelta: PokeyStreamCursorBucket[];
  byNextTransitionDelta: PokeyStreamCursorBucket[];
  byTransitionWindow: PokeyStreamCursorBucket[];
  bySameSampleTransition: PokeyStreamCursorBucket[];
  byNextTransitionSampleDelta: PokeyStreamCursorBucket[];
}

interface PokeyLofiCursorSweepEntry {
  sourceRate: number;
  sourceDivide: number;
  newRawSourceSampleOffset: number;
  lofiMismatchCount: number;
  improvementCount: number;
  lofiNativeSampleDeltaHistogram: Record<string, number>;
}

interface PokeyLofiCursorReport extends PokeyLofiCursorSweepEntry {
  targetRate: number;
  compared: number;
  earlyCount: number;
  exactCount: number;
  lateCount: number;
  baselineMismatchCount: number;
  baselineNativeSampleDeltaHistogram: Record<string, number>;
  sweep: PokeyLofiCursorSweepEntry[];
  byBaselineToLofiDelta: PokeyStreamCursorBucket[];
  byTsLofiOffsetFromSimple: PokeyStreamCursorBucket[];
  byMameLofiOffsetFromSimple: PokeyStreamCursorBucket[];
  byTsSourceOffsetInBlock: PokeyStreamCursorBucket[];
  byTsSimpleWindowEndDelta: PokeyStreamCursorBucket[];
}

interface DiffResult {
  kind: Kind;
  compared: number;
  tsCount: number;
  mameCount: number;
  mismatchCount: number;
  frameDelta: {
    compared: number;
    min: number | undefined;
    max: number | undefined;
    maxAbs: number | undefined;
    meanAbs: number | undefined;
  };
  sameFrameCycleDelta: {
    compared: number;
    min: number | undefined;
    max: number | undefined;
    maxAbs: number | undefined;
    meanAbs: number | undefined;
  };
  replayCycleDelta: {
    compared: number;
    min: number | undefined;
    max: number | undefined;
    maxAbs: number | undefined;
    meanAbs: number | undefined;
  };
  nativeSampleDelta: {
    sampleRate: number | undefined;
    samplePhaseCycles: number;
    compared: number;
    min: number | undefined;
    max: number | undefined;
    maxAbs: number | undefined;
    meanAbs: number | undefined;
  };
  nativeSampleDeltaHistogram: Record<string, number>;
  nativeSampleDeltaByRegisterCategory: NativeSampleDeltaBreakdownEntry[];
  nativeSampleDeltaByRegister: NativeSampleDeltaBreakdownEntry[];
  nativeSampleDeltaByPokeyEffectiveApplyDelay?: NativeSampleDeltaBreakdownEntry[];
  nativeSampleNonExactContext: NativeSampleMismatchContextSummary;
  nativeSampleMismatchContext: NativeSampleMismatchContextSummary;
  nativeSampleMismatchByCommandSource: NativeSampleCommandMismatchBreakdownEntry[];
  instructionFetchDelta: InstructionFetchDeltaSummary;
  rawBusWriteParity: RawBusWriteParitySummary;
  commandCrossings: {
    mismatchCount: number;
    firstMismatch: {
      index: number;
      crossing: CommandCrossing;
    } | undefined;
  };
  rawCommandCrossings: {
    mismatchCount: number;
    firstMismatch: {
      index: number;
      crossing: CommandCrossing;
    } | undefined;
  };
  commandNearMisses: {
    lookaheadCycles: number;
    mismatchCount: number;
    firstMismatch: {
      index: number;
      nearMiss: CommandNearMiss;
    } | undefined;
  };
  rawCommandNearMisses: {
    lookaheadCycles: number;
    mismatchCount: number;
    firstMismatch: {
      index: number;
      nearMiss: CommandNearMiss;
    } | undefined;
  };
  firstMismatch: {
    index: number;
    fields: string[];
    ts: NormalizedWrite | undefined;
    mame: NormalizedWrite | undefined;
    commandCrossing?: CommandCrossing;
    rawCommandCrossing?: CommandCrossing;
    commandNearMiss?: CommandNearMiss;
    rawCommandNearMiss?: CommandNearMiss;
    commandContext?: CommandContext;
  } | undefined;
  mismatchSamples: Array<{
    index: number;
    fields: string[];
    ts: NormalizedWrite | undefined;
    mame: NormalizedWrite | undefined;
    commandCrossing?: CommandCrossing;
    rawCommandCrossing?: CommandCrossing;
    commandNearMiss?: CommandNearMiss;
    rawCommandNearMiss?: CommandNearMiss;
    commandContext?: CommandContext;
  }>;
  mismatchClusters: MismatchCluster[];
  samplePhaseSweep?: Array<{
    phaseCycles: number;
    mismatchCount: number;
    nativeSampleDelta: {
      sampleRate: number | undefined;
      samplePhaseCycles: number;
      compared: number;
      min: number | undefined;
      max: number | undefined;
      maxAbs: number | undefined;
      meanAbs: number | undefined;
    };
  }>;
  pcDeltaReport?: PcDeltaReportEntry[];
  frameDeltaReport?: FrameDeltaReportEntry[];
  frameOffsetSweep?: FrameOffsetSweepSummary;
  pokeyBoundaryGuardSweep?: PokeyBoundaryGuardSweepEntry[];
  pokeyBoundaryCandidateReport?: PokeyBoundaryCandidateReport;
  pokeyStreamCursorReport?: PokeyStreamCursorReport;
  pokeyLofiCursorReport?: PokeyLofiCursorReport;
  eventDeltaReports?: EventDeltaReportEntry[];
}

interface YM2151WithTimerPhaseDiagnostic {
  timerAStartDelayYmCycles: number;
  timerAHoldWhileOverflow: boolean;
}

interface SoundChipWithCommandNmiDiagnostic {
  commandNmiDelayInstructions: number;
}

interface PreemptedChipWriteSummary {
  commandCount: number;
  byPc: Array<{
    pc: string;
    count: number;
    firstCommand: {
      frame: number;
      cycle: number;
      address: string;
      targetDeltaFromWrite: number;
    };
  }>;
}

interface CommandSubmitDiagnostics {
  commandCount: number;
  pendingBeforeCount: number;
  nmiDelayHistogram: Record<string, number>;
  byDelay: Record<string, CommandNmiDelaySubmitSummary>;
  overrideMatchCount: number;
  overridePendingBeforeCount: number;
  overrideBySelector: Record<string, CommandNmiDelayOverrideSelectorSummary>;
  overrideSamples: Array<{
    frame: number;
    byte: string;
    cycleInFrame: number;
    actualCycleInFrame: number;
    pendingBefore: boolean;
    commandNmiDelayInstructions: number;
    overrideDelayInstructions: number;
    lastStep?: CommandSubmitStepContextJson;
    mameCommandInst?: MameCommandInstContextJson;
    mameSoundCommandRead?: MameSoundCommandReadContextJson;
  }>;
}

interface FrameAdvanceDiagnosticRow {
  frame: number;
  frameStart: number;
  frameEnd: number;
  frameCycles: number;
  cpuStart: number;
  cpuEnd: number;
  cpuStartDelta: number;
  cpuEndDelta: number;
  commandCount: number;
  releaseOnThisFrame: boolean;
  inResetAfter: boolean;
}

interface SchedulerDriftSummary {
  frameCount: number;
  activeFrameCount: number;
  commandFrameCount: number;
  minCpuStartDelta: number;
  maxCpuStartDelta: number;
  minCpuEndDelta: number;
  maxCpuEndDelta: number;
  maxAbsCpuStartDelta: number;
  maxAbsCpuEndDelta: number;
  byCpuStartDelta: Record<string, number>;
  byCpuEndDelta: Record<string, number>;
  worstFrames: FrameAdvanceDiagnosticRow[];
}

interface CommandSubmitStepContextJson {
  startCycleInFrame: number;
  endCycleInFrame: number;
  targetOffset: number;
  actualEndDelta: number;
  pc?: string;
  opcode?: string;
  nextPc: string;
  nextOpcode?: string;
  interruptService: boolean;
}

interface CommandSubmitCpuStateJson {
  pc?: string;
  opcode?: string;
  a?: string;
  x?: string;
  y?: string;
  p?: string;
  sp?: string;
}

interface CommandSubmitPreAdvanceContextJson {
  cpuCycleInFrame: number;
  deltaToTarget: number;
  pc?: string;
  opcode?: string;
  inReset: boolean;
  currentChipIoStore?: {
    pc: string;
    opcode: string;
    address: string;
    writeCycleOffset: number;
    stepCycles: number;
  };
}

interface MameCommandInstContextJson {
  soundPc?: string;
  soundA?: string;
  soundX?: string;
  soundY?: string;
  soundP?: string;
  soundSp?: string;
  instFrame?: number;
  instPc?: string;
  instOpcode?: string;
  instDeltaCycles?: number;
  nextInstFrame?: number;
  nextInstPc?: string;
  nextInstOpcode?: string;
  nextInstDeltaCycles?: number;
  nextChronoInstFrame?: number;
  nextChronoInstPc?: string;
  nextChronoInstOpcode?: string;
  nextChronoInstDeltaCycles?: number;
}

interface MameSoundCommandReadContextJson {
  frame?: number;
  byte: string;
  cycleInFrame?: number;
  replayCycle: number;
  pc?: string;
  deltaFromCommand?: number;
  instFrame?: number;
  instPc?: string;
  instOpcode?: string;
  instDeltaCycles?: number;
}

interface CommandSubmitDiagnosticRow {
  sourceIndex?: number;
  frame: number;
  byte: string;
  cycleInFrame: number;
  actualCycleInFrame: number;
  actualCycleDelta: number;
  pendingBefore: boolean;
  commandNmiDelayInstructions: number;
  overrideDelayInstructions?: number;
  actualState?: CommandSubmitCpuStateJson;
  preAdvance?: CommandSubmitPreAdvanceContextJson;
  lastStep?: CommandSubmitStepContextJson;
  mameCommandInst?: MameCommandInstContextJson;
  mameSoundCommandRead?: MameSoundCommandReadContextJson;
}

interface CommandSubmitStepContext {
  readonly startCycle: number;
  readonly endCycle: number;
  readonly startCycleInFrame: number;
  readonly endCycleInFrame: number;
  readonly targetOffset: number;
  readonly actualEndDelta: number;
  readonly pc?: number;
  readonly opcode?: number;
  readonly nextPc: number;
  readonly nextOpcode?: number;
  readonly interruptService: boolean;
}

interface CommandSubmitPreAdvanceContext {
  readonly cpuCycle: number;
  readonly cpuCycleInFrame: number;
  readonly deltaToTarget: number;
  readonly pc?: number;
  readonly opcode?: number;
  readonly inReset: boolean;
  readonly currentChipIoStore?: {
    readonly pc: number;
    readonly opcode: number;
    readonly address: number;
    readonly writeCycleOffset: number;
    readonly stepCycles: number;
  };
}

interface CommandNmiDelayOverrideSelection {
  readonly delayInstructions: number;
  readonly selector: string;
}

interface CommandNmiDelaySubmitSummary {
  count: number;
  pendingBeforeCount: number;
  overrideCount: number;
  byByte: Record<string, number>;
  byByteCycle: Record<string, number>;
  byActualCycleDelta: Record<string, number>;
  byPreAdvanceDeltaToTarget: Record<string, number>;
  byPreAdvancePcOpcode: Record<string, number>;
  byPreAdvanceCurrentChipIoStorePcOpcode: Record<string, number>;
  byMameCommandSoundPcVsTsPreAdvanceRelation: Record<string, number>;
  byLastStepPcOpcode: Record<string, number>;
  byLastStepTargetOffset: Record<string, number>;
  byLastStepActualEndDelta: Record<string, number>;
  byLastStepInterruptService: Record<string, number>;
  byMameCommandSoundPc: Record<string, number>;
  byMameCommandSoundPcVsTsStepRelation: Record<string, number>;
  byMameCommandInstPcOpcode: Record<string, number>;
  byMameCommandInstDeltaCycles: Record<string, number>;
  byMameCommandInstDeltaMinusTsTargetOffset: Record<string, number>;
  byMameCommandNextInstPcOpcode: Record<string, number>;
  byMameCommandNextInstDeltaCycles: Record<string, number>;
  byMameCommandNextInstDeltaMinusTsActualEndDelta: Record<string, number>;
  byMameCommandInstVsTsStepRelation: Record<string, number>;
  byMameCommandNextChronoInstDeltaCycles: Record<string, number>;
  byMameCommandNextChronoInstDeltaMinusTsActualEndDelta: Record<string, number>;
  byMameCommandNextChronoInstVsTsStepRelation: Record<string, number>;
  byMameSoundCommandReadPc: Record<string, number>;
  byMameSoundCommandReadDeltaCycles: Record<string, number>;
  byMameSoundCommandReadDeltaMinusTsActualSubmit: Record<string, number>;
  byMameSoundCommandReadDeltaMinusTsActualEndDelta: Record<string, number>;
  byMameSoundCommandReadInstPcOpcode: Record<string, number>;
  byMameSoundCommandReadInstDeltaCycles: Record<string, number>;
  samples: Array<{
    frame: number;
    byte: string;
    cycleInFrame: number;
    actualCycleInFrame: number;
    actualCycleDelta: number;
    pendingBefore: boolean;
    overrideDelayInstructions?: number;
    preAdvance?: CommandSubmitPreAdvanceContextJson;
    lastStep?: CommandSubmitStepContextJson;
    mameCommandInst?: MameCommandInstContextJson;
    mameSoundCommandRead?: MameSoundCommandReadContextJson;
  }>;
}

interface CommandNmiDelayOverrideSelectorSummary {
  count: number;
  pendingBeforeCount: number;
  byFrame: Record<string, number>;
  byByteCycle: Record<string, number>;
  byActualCycleDelta: Record<string, number>;
  byPreAdvanceDeltaToTarget: Record<string, number>;
  byPreAdvancePcOpcode: Record<string, number>;
  byPreAdvanceCurrentChipIoStorePcOpcode: Record<string, number>;
  byMameCommandSoundPcVsTsPreAdvanceRelation: Record<string, number>;
  byLastStepPcOpcode: Record<string, number>;
  byLastStepTargetOffset: Record<string, number>;
  byLastStepActualEndDelta: Record<string, number>;
  byLastStepInterruptService: Record<string, number>;
  byMameCommandSoundPc: Record<string, number>;
  byMameCommandSoundPcVsTsStepRelation: Record<string, number>;
  byMameCommandInstPcOpcode: Record<string, number>;
  byMameCommandInstDeltaCycles: Record<string, number>;
  byMameCommandInstDeltaMinusTsTargetOffset: Record<string, number>;
  byMameCommandNextInstPcOpcode: Record<string, number>;
  byMameCommandNextInstDeltaCycles: Record<string, number>;
  byMameCommandNextInstDeltaMinusTsActualEndDelta: Record<string, number>;
  byMameCommandInstVsTsStepRelation: Record<string, number>;
  byMameCommandNextChronoInstDeltaCycles: Record<string, number>;
  byMameCommandNextChronoInstDeltaMinusTsActualEndDelta: Record<string, number>;
  byMameCommandNextChronoInstVsTsStepRelation: Record<string, number>;
  byMameSoundCommandReadPc: Record<string, number>;
  byMameSoundCommandReadDeltaCycles: Record<string, number>;
  byMameSoundCommandReadDeltaMinusTsActualSubmit: Record<string, number>;
  byMameSoundCommandReadDeltaMinusTsActualEndDelta: Record<string, number>;
  byMameSoundCommandReadInstPcOpcode: Record<string, number>;
  byMameSoundCommandReadInstDeltaCycles: Record<string, number>;
  samples: Array<{
    frame: number;
    byte: string;
    cycleInFrame: number;
    actualCycleInFrame: number;
    actualCycleDelta: number;
    pendingBefore: boolean;
    commandNmiDelayInstructions: number;
    overrideDelayInstructions: number;
    preAdvance?: CommandSubmitPreAdvanceContextJson;
    lastStep?: CommandSubmitStepContextJson;
    mameCommandInst?: MameCommandInstContextJson;
    mameSoundCommandRead?: MameSoundCommandReadContextJson;
  }>;
}

interface CommandEdgeEventAdjustSummary {
  applied: number;
  delayCycles: number | undefined;
  afterCycles: number;
  bytes: string[] | undefined;
  pcs: string[] | undefined;
  relation: CommandEdgeEventRelation;
  rawDeltaMin: number | undefined;
  rawDeltaMax: number | undefined;
  rules: CommandEdgeEventRuleSummary[] | undefined;
  byRelation: Record<string, number>;
  byCommandByte: Record<string, number>;
  byCommandSoundPc: Record<string, number>;
  byRawDeltaFromCommand: Record<string, number>;
  byCommandDeltaFromRawStepStart: Record<string, number>;
  byTargetDelayCycles: Record<string, number>;
  byTargetWriteCycleOffset: Record<string, number>;
  byFirstReadDeltaFromCommand: Record<string, number>;
  byRawDeltaFromFirstRead: Record<string, number>;
  byTargetDeltaFromFirstRead: Record<string, number>;
  byDeltaCycles: Record<string, number>;
  byRule: Record<string, number>;
  byPc: Array<{ pc: string; count: number }>;
  byWriteContext: CommandEdgeEventAdjustWriteContextSummary[];
  byCommandReadContext: CommandEdgeEventAdjustCommandReadContextSummary[];
  samples: CommandEdgeEventAdjust[];
}

interface CommandEdgeEventAdjustWriteContextSummary {
  count: number;
  writePc: string;
  writeOpcode: string;
  writeReg: string;
  byWriteVal: Record<string, number>;
  byCommandByte: Record<string, number>;
  byCommandSoundPc: Record<string, number>;
  byRelation: Record<string, number>;
  byFirstReadDeltaFromCommand: Record<string, number>;
  byTargetDeltaFromFirstRead: Record<string, number>;
  byRawDeltaFromCommand: Record<string, number>;
}

interface CommandEdgeEventAdjustCommandReadContextSummary {
  count: number;
  commandByte: string;
  commandSoundPc: string;
  firstReadDeltaFromCommand: string;
  targetDeltaFromFirstRead: string;
  byWritePc: Record<string, number>;
  byWriteOpcode: Record<string, number>;
  byWriteReg: Record<string, number>;
  byRelation: Record<string, number>;
  byRawDeltaFromCommand: Record<string, number>;
}

interface CommandEdgeEventRuleSummary {
  delayCycles: number;
  anchor: CommandEdgeEventAnchor;
  afterCycles: number;
  beforeCycles: number;
  bytes: string[] | undefined;
  pcs: string[] | undefined;
  commandPcs: string[] | undefined;
  excludedCommandPcs: string[] | undefined;
  writeRegs: string[] | undefined;
  writeVals: string[] | undefined;
  writeRegVals: string[] | undefined;
  relation: CommandEdgeEventRelation;
  rawDeltaMin: number | undefined;
  rawDeltaMax: number | undefined;
}

interface CommandSubmitContext {
  actualCycle: number;
  actualCycleInFrame: number;
  pendingBefore: boolean;
  commandNmiDelayInstructions: number;
  overrideDelayInstructions: number | undefined;
  actualState?: CommandSubmitCpuStateJson;
  preAdvance?: CommandSubmitPreAdvanceContextJson;
  lastStep?: CommandSubmitStepContextJson;
  mameCommandInst?: MameCommandInstContextJson;
  mameSoundCommandRead?: MameSoundCommandReadContextJson;
}

function readArg(args: string[], name: string): string | undefined {
  const idx = args.indexOf(name);
  return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : undefined;
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

function parsePcList(value: string | undefined): number[] | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  return value.split(",").map((raw) => {
    const trimmed = raw.trim();
    const pc = Number.parseInt(trimmed, trimmed.startsWith("0x") ? 16 : 10);
    if (!Number.isFinite(pc)) throw new Error(`Unsupported PC in --pc-delta-report-pcs: ${raw}`);
    return pc;
  });
}

function parseByteList(value: string | undefined, argName: string): number[] | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  return value.split(",").map((raw) => {
    const trimmed = raw.trim();
    const byte = Number.parseInt(trimmed, trimmed.startsWith("0x") ? 16 : 10);
    if (!Number.isFinite(byte) || byte < 0 || byte > 0xff) {
      throw new Error(`Unsupported byte in ${argName}: ${raw}`);
    }
    return byte & 0xff;
  });
}

function parseCommandEdgeRuleByteList(value: string, argName: string): number[] | undefined {
  const trimmed = value.trim();
  if (trimmed === "" || trimmed === "*") return undefined;
  return trimmed.split("+").map((raw) => {
    const part = raw.trim();
    const byte = Number.parseInt(part, part.startsWith("0x") ? 16 : 10);
    if (!Number.isFinite(byte) || byte < 0 || byte > 0xff) {
      throw new Error(`Unsupported byte in ${argName}: ${raw}`);
    }
    return byte & 0xff;
  });
}

function parseCommandEdgeRuleRegValPairs(
  value: string | undefined,
  argName: string,
): CommandEdgeWriteRegVal[] | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (trimmed === "" || trimmed === "*") return undefined;
  return trimmed.split("+").map((raw) => {
    const [regRaw, valRaw, extra] = raw.split("=");
    if (regRaw === undefined || valRaw === undefined || extra !== undefined) {
      throw new Error(`Unsupported reg=value pair in ${argName}: ${raw}`);
    }
    const regPart = regRaw.trim();
    const valPart = valRaw.trim();
    const reg = Number.parseInt(regPart, regPart.startsWith("0x") ? 16 : 10);
    const val = Number.parseInt(valPart, valPart.startsWith("0x") ? 16 : 10);
    if (!Number.isFinite(reg) || reg < 0 || reg > 0xff ||
      !Number.isFinite(val) || val < 0 || val > 0xff) {
      throw new Error(`Unsupported reg=value pair in ${argName}: ${raw}`);
    }
    return { reg: reg & 0xff, val: val & 0xff };
  });
}

function parseCommandEdgeRulePcList(value: string | undefined, argName: string): number[] | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (trimmed === "" || trimmed === "*") return undefined;
  return trimmed.split("+").map((raw) => {
    const part = raw.trim();
    const pc = Number.parseInt(part, part.startsWith("0x") ? 16 : 10);
    if (!Number.isFinite(pc) || pc < 0 || pc > 0xffff) {
      throw new Error(`Unsupported PC in ${argName}: ${raw}`);
    }
    return pc & 0xffff;
  });
}

function parseCommandEdgeRuleCommandPcFilter(
  value: string | undefined,
  argName: string,
): { commandPcs: number[] | undefined; excludedCommandPcs: number[] | undefined } {
  if (value === undefined) return { commandPcs: undefined, excludedCommandPcs: undefined };
  const trimmed = value.trim();
  if (trimmed === "" || trimmed === "*") return { commandPcs: undefined, excludedCommandPcs: undefined };
  if (trimmed.startsWith("!")) {
    return {
      commandPcs: undefined,
      excludedCommandPcs: parseCommandEdgeRulePcList(trimmed.slice(1), argName),
    };
  }
  return {
    commandPcs: parseCommandEdgeRulePcList(trimmed, argName),
    excludedCommandPcs: undefined,
  };
}

function parseCommandEdgeEventRules(value: string | undefined, defaultAfterCycles: number): readonly CommandEdgeEventRule[] {
  const argName = "--ym-command-edge-event-rules";
  if (value === undefined || value.trim() === "") return [];
  return value.split(/[;,]/).map((rawEntry) => {
    const entry = rawEntry.trim();
    const parts = entry.split(":");
    if (parts.length < 4 || parts.length > 13) {
      throw new Error(
        `Unsupported ${argName} entry: ${rawEntry}; ` +
        `expected bytes:minRawDelta:maxRawDelta:delay[:relation[:after[:before[:commandPcs[:anchor[:writePcs[:writeRegs[:writeVals[:writeRegVals]]]]]]]]]; ` +
        `prefix commandPcs with ! to exclude PCs`,
      );
    }
    const [
      bytesRaw,
      minRaw,
      maxRaw,
      delayRaw,
      relationRaw,
      afterRaw,
      beforeRaw,
      commandPcsRaw,
      anchorRaw,
      writePcsRaw,
      writeRegsRaw,
      writeValsRaw,
      writeRegValsRaw,
    ] = parts;
    const delayCycles = Number(delayRaw);
    const afterCycles = afterRaw === undefined || afterRaw.trim() === "" ? undefined : Number(afterRaw);
    const beforeCycles = beforeRaw === undefined || beforeRaw.trim() === "" ? undefined : Number(beforeRaw);
    if (!Number.isFinite(delayCycles)) throw new Error(`Unsupported ${argName} delay in entry: ${rawEntry}`);
    if (afterCycles !== undefined && !Number.isFinite(afterCycles)) {
      throw new Error(`Unsupported ${argName} after-cycles in entry: ${rawEntry}`);
    }
    if (beforeCycles !== undefined && !Number.isFinite(beforeCycles)) {
      throw new Error(`Unsupported ${argName} before-cycles in entry: ${rawEntry}`);
    }
    const commandPcFilter = parseCommandEdgeRuleCommandPcFilter(commandPcsRaw, argName);
    return {
      delayCycles: Math.trunc(delayCycles),
      anchor: parseCommandEdgeEventAnchor(anchorRaw),
      afterCycles: afterCycles === undefined ? defaultAfterCycles : Math.max(0, Math.trunc(afterCycles)),
      beforeCycles: beforeCycles === undefined ? 0 : Math.max(0, Math.trunc(beforeCycles)),
      bytes: parseCommandEdgeRuleByteList(bytesRaw ?? "", argName),
      pcs: parseCommandEdgeRulePcList(writePcsRaw, argName),
      commandPcs: commandPcFilter.commandPcs,
      excludedCommandPcs: commandPcFilter.excludedCommandPcs,
      writeRegs: parseCommandEdgeRuleByteList(writeRegsRaw ?? "", argName),
      writeVals: parseCommandEdgeRuleByteList(writeValsRaw ?? "", argName),
      writeRegVals: parseCommandEdgeRuleRegValPairs(writeRegValsRaw, argName),
      relation: parseCommandEdgeEventRelation(relationRaw),
      rawDeltaMin: parseOptionalIntegerPart(minRaw ?? ""),
      rawDeltaMax: parseOptionalIntegerPart(maxRaw ?? ""),
    };
  });
}

function parseCommandEdgeEventAnchor(value: string | undefined): CommandEdgeEventAnchor {
  if (value === undefined || value.trim() === "" || value === "command") return "command";
  if (value === "first-read" || value === "read") return "first-read";
  if (value === "current-event" || value === "event" || value === "offset" || value === "write") {
    return "current-event";
  }
  throw new Error(`invalid command edge event anchor ${value}; expected command, first-read, or current-event`);
}

function parseOpcodeAdjustments(
  value: string | undefined,
  name = "--ts-event-cycle-adjust-opcodes",
): ReadonlyMap<number, number> {
  const adjustments = new Map<number, number>();
  if (value === undefined || value.trim() === "") return adjustments;
  for (const rawEntry of value.split(",")) {
    const [opcodeRaw, deltaRaw] = rawEntry.split("=");
    if (opcodeRaw === undefined || deltaRaw === undefined) {
      throw new Error(`Unsupported ${name} entry: ${rawEntry}`);
    }
    const opcodeTrimmed = opcodeRaw.trim();
    const opcode = Number.parseInt(opcodeTrimmed, opcodeTrimmed.startsWith("0x") ? 16 : 10);
    const delta = Number(deltaRaw.trim());
    if (!Number.isFinite(opcode) || opcode < 0 || opcode > 0xff || !Number.isFinite(delta)) {
      throw new Error(`Unsupported ${name} entry: ${rawEntry}`);
    }
    adjustments.set(opcode & 0xff, Math.trunc(delta));
  }
  return adjustments;
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
    const regTrimmed = regRaw.trim();
    const reg = Number.parseInt(regTrimmed, regTrimmed.startsWith("0x") ? 16 : 10);
    const delta = Number(deltaRaw.trim());
    if (!Number.isFinite(reg) || reg < 0 || reg > 0xff || !Number.isFinite(delta)) {
      throw new Error(`Unsupported ${name} entry: ${rawEntry}`);
    }
    offsets.set(reg & 0xff, Math.trunc(delta));
  }
  return offsets;
}

function parseOptionalIntegerPart(raw: string): number | undefined {
  const trimmed = raw.trim();
  if (trimmed === "" || trimmed === "*") return undefined;
  const value = Number.parseInt(trimmed, trimmed.startsWith("0x") ? 16 : 10);
  if (!Number.isFinite(value)) throw new Error(`Unsupported selector value: ${raw}`);
  return value;
}

function parseYmWriteEventCycleOffsetMatches(
  value: string | undefined,
  name: string,
): readonly YmWriteEventCycleOffsetMatch[] {
  if (value === undefined || value.trim() === "") return [];
  return value.split(",").map((rawEntry) => {
    const parts = rawEntry.trim().split(":");
    if (parts.length !== 5 && parts.length !== 7) {
      throw new Error(`Unsupported ${name} entry: ${rawEntry}; expected frame:pc:reg:val:delta[:cycleMin:cycleMax]`);
    }
    const [frameRaw, pcRaw, regRaw, valRaw, deltaRaw, cycleMinRaw, cycleMaxRaw] = parts;
    const deltaCycles = Number(deltaRaw);
    if (!Number.isFinite(deltaCycles)) throw new Error(`Unsupported ${name} delta in entry: ${rawEntry}`);
    const frame = parseOptionalIntegerPart(frameRaw ?? "");
    const pc = parseOptionalIntegerPart(pcRaw ?? "");
    const reg = parseOptionalIntegerPart(regRaw ?? "");
    const val = parseOptionalIntegerPart(valRaw ?? "");
    const cycleInFrameMin = parseOptionalIntegerPart(cycleMinRaw ?? "");
    const cycleInFrameMax = parseOptionalIntegerPart(cycleMaxRaw ?? "");
    if (frame !== undefined && frame < 0) throw new Error(`Unsupported ${name} frame in entry: ${rawEntry}`);
    if (pc !== undefined && (pc < 0 || pc > 0xffff)) throw new Error(`Unsupported ${name} pc in entry: ${rawEntry}`);
    if (reg !== undefined && (reg < 0 || reg > 0xff)) throw new Error(`Unsupported ${name} reg in entry: ${rawEntry}`);
    if (val !== undefined && (val < 0 || val > 0xff)) throw new Error(`Unsupported ${name} val in entry: ${rawEntry}`);
    if (cycleInFrameMin !== undefined && cycleInFrameMin < 0) {
      throw new Error(`Unsupported ${name} cycleMin in entry: ${rawEntry}`);
    }
    if (cycleInFrameMax !== undefined && cycleInFrameMax < 0) {
      throw new Error(`Unsupported ${name} cycleMax in entry: ${rawEntry}`);
    }
    return {
      ...(frame === undefined ? {} : { frame: Math.trunc(frame) }),
      ...(pc === undefined ? {} : { pc: Math.trunc(pc) }),
      ...(reg === undefined ? {} : { reg: Math.trunc(reg) }),
      ...(val === undefined ? {} : { val: Math.trunc(val) }),
      ...(cycleInFrameMin === undefined ? {} : { cycleInFrameMin: Math.trunc(cycleInFrameMin) }),
      ...(cycleInFrameMax === undefined ? {} : { cycleInFrameMax: Math.trunc(cycleInFrameMax) }),
      deltaCycles: Math.trunc(deltaCycles),
    };
  });
}

function parseOptionalKindPart(raw: string): Kind | undefined {
  const trimmed = raw.trim();
  if (trimmed === "" || trimmed === "*") return undefined;
  if (trimmed === "ym" || trimmed === "ym2151") return "ym2151";
  if (trimmed === "pokey") return "pokey";
  throw new Error(`Unsupported kind selector value: ${raw}`);
}

function parseTsEventCycleAdjustMatches(
  value: string | undefined,
  name: string,
): readonly TsEventCycleAdjustMatch[] {
  if (value === undefined || value.trim() === "") return [];
  return value.split(",").map((rawEntry) => {
    const parts = rawEntry.trim().split(":");
    if (parts.length !== 6 && parts.length !== 8) {
      throw new Error(`Unsupported ${name} entry: ${rawEntry}; expected kind:frame:pc:reg:val:delta[:cycleMin:cycleMax]`);
    }
    const [kindRaw, frameRaw, pcRaw, regRaw, valRaw, deltaRaw, cycleMinRaw, cycleMaxRaw] = parts;
    const kind = parseOptionalKindPart(kindRaw ?? "");
    const frame = parseOptionalIntegerPart(frameRaw ?? "");
    const pc = parseOptionalIntegerPart(pcRaw ?? "");
    const reg = parseOptionalIntegerPart(regRaw ?? "");
    const val = parseOptionalIntegerPart(valRaw ?? "");
    const deltaCycles = Number(deltaRaw);
    const cycleInFrameMin = parseOptionalIntegerPart(cycleMinRaw ?? "");
    const cycleInFrameMax = parseOptionalIntegerPart(cycleMaxRaw ?? "");
    if (!Number.isFinite(deltaCycles)) throw new Error(`Unsupported ${name} delta in entry: ${rawEntry}`);
    if (frame !== undefined && frame < 0) throw new Error(`Unsupported ${name} frame in entry: ${rawEntry}`);
    if (pc !== undefined && (pc < 0 || pc > 0xffff)) throw new Error(`Unsupported ${name} pc in entry: ${rawEntry}`);
    if (reg !== undefined && (reg < 0 || reg > 0xff)) throw new Error(`Unsupported ${name} reg in entry: ${rawEntry}`);
    if (val !== undefined && (val < 0 || val > 0xff)) throw new Error(`Unsupported ${name} val in entry: ${rawEntry}`);
    if (cycleInFrameMin !== undefined && cycleInFrameMin < 0) {
      throw new Error(`Unsupported ${name} cycleMin in entry: ${rawEntry}`);
    }
    if (cycleInFrameMax !== undefined && cycleInFrameMax < 0) {
      throw new Error(`Unsupported ${name} cycleMax in entry: ${rawEntry}`);
    }
    return {
      ...(kind === undefined ? {} : { kind }),
      ...(frame === undefined ? {} : { frame: Math.trunc(frame) }),
      ...(pc === undefined ? {} : { pc: Math.trunc(pc) }),
      ...(reg === undefined ? {} : { reg: Math.trunc(reg) }),
      ...(val === undefined ? {} : { val: Math.trunc(val) }),
      ...(cycleInFrameMin === undefined ? {} : { cycleInFrameMin: Math.trunc(cycleInFrameMin) }),
      ...(cycleInFrameMax === undefined ? {} : { cycleInFrameMax: Math.trunc(cycleInFrameMax) }),
      deltaCycles: Math.trunc(deltaCycles),
    };
  }).filter((match) => match.deltaCycles !== 0);
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

function parseWriteEventDeltaReportMatches(
  value: string | undefined,
  name: string,
): readonly WriteEventDeltaReportMatch[] {
  if (value === undefined || value.trim() === "") return [];
  return value.split(",").map((rawEntry) => {
    const parts = rawEntry.trim().split(":");
    if (parts.length !== 4) {
      throw new Error(`Unsupported ${name} entry: ${rawEntry}; expected frame:pc:reg:val`);
    }
    const [frameRaw, pcRaw, regRaw, valRaw] = parts;
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
    };
  });
}

function parseCycleSweepRange(value: string, name: string): number[] {
  const [startRaw, endRaw, stepRaw] = value.split(":");
  const start = Number(startRaw);
  const end = Number(endRaw);
  const stepMagnitude = Math.abs(Number(stepRaw ?? "1"));
  if (!Number.isFinite(start) || !Number.isFinite(end) || !Number.isFinite(stepMagnitude) || stepMagnitude === 0) {
    throw new Error(`Unsupported ${name} range: ${value}`);
  }
  const step = start <= end ? stepMagnitude : -stepMagnitude;
  const phases: number[] = [];
  for (let phase = start; step > 0 ? phase <= end : phase >= end; phase += step) {
    phases.push(phase);
    if (phases.length > 10000) throw new Error(`${name} range is too large: ${value}`);
  }
  return phases;
}

function parseCycleSweep(value: string | undefined, name: string): number[] | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const phases = value.includes(":")
    ? parseCycleSweepRange(value.trim(), name)
    : value.split(",").map((raw) => Number(raw.trim()));
  const unique = Array.from(new Set(phases.map((phase) => {
    if (!Number.isFinite(phase)) throw new Error(`Unsupported ${name} value: ${value}`);
    return phase;
  })));
  return unique.length === 0 ? undefined : unique;
}

function parseSamplePhaseSweep(value: string | undefined): number[] | undefined {
  return parseCycleSweep(value, "--sample-phase-sweep");
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  const audioBitperfectPreset = resolveAudioBitperfectPreset(args);
  const readPresetArg = (name: string): string | undefined =>
    readArgWithAudioBitperfectPreset(args, audioBitperfectPreset, name);
  const hasPresetFlag = (name: string): boolean =>
    hasFlagWithAudioBitperfectPreset(args, audioBitperfectPreset, name);
  const kindsArg = readPresetArg("--kinds") ?? "ym2151,pokey";
  const compareCountArg = readArg(args, "--compare-count");
  const statusBaseArg = readPresetArg("--status-base");
  const pokeyWriteApplyDelayArg = Number(readPresetArg("--pokey-write-apply-delay") ?? "0");
  const pokeyWriteApplyBoundaryDelayArg =
    Number(readPresetArg("--pokey-write-apply-boundary-delay-cycles") ?? "0");
  const pokeyWriteApplyBoundaryDelaySampleRateArg =
    Number(readPresetArg("--pokey-write-apply-boundary-delay-sample-rate") ?? "55930");
  const irqServiceDelayArg = Number(readPresetArg("--irq-service-delay") ?? "0");
  const ymIrqAssertionDelayArg = Number(readPresetArg("--ym-irq-assertion-delay") ?? "0");
  const ymIrqNewAssertionInstructionDelayArg =
    Number(readPresetArg("--ym-irq-new-assertion-instruction-delay") ?? "0");
  const ymWriteEventCycleOffsetArg = Number(readPresetArg("--ym-write-event-cycle-offset") ?? "0");
  const ymKeyOnWriteEventCycleOffsetArg = Number(readPresetArg("--ym-keyon-write-event-cycle-offset") ?? "0");
  const pcDeltaReportPcs = parsePcList(readPresetArg("--pc-delta-report-pcs"));
  const samplePhaseCycles = Number(readPresetArg("--sample-phase-cycles") ?? "0");
  const commandCycleOffsetBytes = parseByteList(readPresetArg("--command-cycle-offset-bytes"), "--command-cycle-offset-bytes");
  const tsEventCycleAdjustOpcodes = parseOpcodeAdjustments(readPresetArg("--ts-event-cycle-adjust-opcodes"));
  const pokeyWriteApplyDelayOpcodes = parseOpcodeAdjustments(
    readPresetArg("--pokey-write-apply-delay-opcodes"),
    "--pokey-write-apply-delay-opcodes",
  );
  const tsEventCycleAdjustMatches = parseTsEventCycleAdjustMatches(
    readPresetArg("--ts-event-cycle-adjust-matches"),
    "--ts-event-cycle-adjust-matches",
  );
  const ymCommandEdgeEventDelayArg = readPresetArg("--ym-command-edge-event-delay");
  const ymCommandEdgeEventDelayCycles = ymCommandEdgeEventDelayArg === undefined
    ? undefined
    : Number(ymCommandEdgeEventDelayArg);
  if (ymCommandEdgeEventDelayCycles !== undefined && !Number.isFinite(ymCommandEdgeEventDelayCycles)) {
    throw new Error(`Unsupported --ym-command-edge-event-delay: ${ymCommandEdgeEventDelayArg}`);
  }
  const ymCommandEdgeEventBytes = parseByteList(
    readPresetArg("--ym-command-edge-event-bytes"),
    "--ym-command-edge-event-bytes",
  );
  const ymCommandEdgeEventPcs = parsePcList(readPresetArg("--ym-command-edge-event-pcs"));
  const ymCommandEdgeEventAfterCycles =
    Math.max(0, Math.trunc(Number(readPresetArg("--ym-command-edge-event-after") ?? "0")));
  const ymCommandEdgeEventRules = parseCommandEdgeEventRules(
    readPresetArg("--ym-command-edge-event-rules"),
    ymCommandEdgeEventAfterCycles,
  );
  const pokeyCommandEdgeEventAfterCycles =
    Math.max(0, Math.trunc(Number(readPresetArg("--pokey-command-edge-event-after") ?? "0")));
  const pokeyCommandEdgeEventRules = parseCommandEdgeEventRules(
    readPresetArg("--pokey-command-edge-event-rules"),
    pokeyCommandEdgeEventAfterCycles,
  );
  const pokeyEventBoundaryDelayCycles = Math.max(
    0,
    Math.trunc(Number(readPresetArg("--pokey-event-boundary-delay-cycles") ?? "0")),
  );
  const eventDeltaReportMatches = parseWriteEventDeltaReportMatches(
    readArg(args, "--event-delta-report-matches"),
    "--event-delta-report-matches",
  );
  const ymWriteEventCycleOffsetRegs =
    parseRegisterCycleOffsets(readPresetArg("--ym-write-event-cycle-offset-regs"), "--ym-write-event-cycle-offset-regs");
  const ymWriteEventCycleOffsetMatches = parseYmWriteEventCycleOffsetMatches(
    readPresetArg("--ym-write-event-cycle-offset-matches"),
    "--ym-write-event-cycle-offset-matches",
  );
  const pcDeltaOffsetSweepCycles = parseSamplePhaseSweep(readPresetArg("--pc-delta-offset-sweep"));
  const commandNmiDelayMatches = parseCommandNmiDelayMatches(
    readPresetArg("--command-nmi-delay-matches"),
    "--command-nmi-delay-matches",
  );
  const commandNmiDelayChipWriteBoundaryArg = readPresetArg("--command-nmi-delay-chip-write-boundary");
  const commandNmiDelayCompletedChipWritePreemptionsArg =
    readPresetArg("--command-nmi-delay-completed-chip-write-preemptions");
  return {
    audioBitperfectPreset: audioBitperfectPreset?.name,
    requireCommandContext: hasPresetFlag("--require-command-context"),
    frames: Number(readPresetArg("--frames") ?? process.env.TARGET_FRAME ?? "2000"),
    cmdTape: readPresetArg("--cmd-tape") ?? "oracle/scenarios/sound-cmd-tape-attract-cycle-precise.json",
    cmdTapeCommandTiming: parseCmdTapeCommandTiming(readPresetArg("--cmd-tape-command-timing")),
    mameYm: readArg(args, "--mame-ym"),
    mamePokey: readArg(args, "--mame-pokey"),
    mameWriteCycleTiming: parseMameWriteCycleTiming(readPresetArg("--mame-write-cycle-timing")),
    kinds: kindsArg.split(",").map((s) => s.trim()).filter((s): s is Kind => s === "ym2151" || s === "pokey"),
    compareCount: compareCountArg === undefined ? undefined : Number(compareCountArg),
    maxMismatches: Number(readPresetArg("--max-mismatches") ?? "0"),
    mismatchSamples: Math.max(1, Number(readPresetArg("--mismatch-samples") ?? "1")),
    frameTolerance: Number(readPresetArg("--frame-tolerance") ?? "0"),
    cycleTolerance: Number(readPresetArg("--cycle-tolerance") ?? "0"),
    sampleRate: readPresetArg("--sample-rate") === undefined
      ? undefined
      : Number(readPresetArg("--sample-rate")),
    sampleTolerance: Number(readPresetArg("--sample-tolerance") ?? "0"),
    samplePhaseCycles: Number.isFinite(samplePhaseCycles) ? samplePhaseCycles : 0,
    samplePhaseSweepCycles: parseSamplePhaseSweep(readArg(args, "--sample-phase-sweep")),
    report: readArg(args, "--report"),
    commandSubmitOut: readArg(args, "--command-submit-out"),
    statusBase: statusBaseArg === undefined ? undefined : Number.parseInt(statusBaseArg, statusBaseArg.startsWith("0x") ? 16 : 10),
    statusTape: readPresetArg("--status-tape"),
    statusTapeMode: parseStatusTapeMode(readPresetArg("--status-tape-mode")),
    statusValueMode: parseStatusValueMode(readPresetArg("--status-value-mode")),
    resetReleaseDelayCycles: Number(readPresetArg("--reset-release-delay") ?? "0"),
    resetFirstFetchDelayAfterCommandCycles:
      Number(readPresetArg("--reset-first-fetch-after-command") ?? "0"),
    replyAckDelayCycles: Number(readPresetArg("--reply-ack-delay") ?? "0"),
    replyAckTape: readPresetArg("--reply-ack-tape"),
    useEmbeddedReplyAckTape: !args.includes("--no-embedded-reply-ack"),
    timerAStartDelayCycles: Number(readPresetArg("--timer-a-start-delay") ?? "0"),
    timerAHoldWhileOverflow: args.includes("--timer-a-hold-while-overflow"),
    commandNmiDelayInstructions: Number(readPresetArg("--command-nmi-delay-instructions") ?? "0"),
    commandNmiServiceDelayCycles: Number(readPresetArg("--command-nmi-service-delay") ?? "0"),
    commandNmiSampleCycle: Number(readPresetArg("--command-nmi-sample-cycle") ?? String(DEFAULT_COMMAND_NMI_SAMPLE_CYCLE)),
    commandNmiBoundaryDelayInstructions: Number(readPresetArg("--command-nmi-boundary-delay-instructions") ?? "0"),
    commandNmiDelayMatches,
    commandNmiDelayChipWriteBoundaryInstructions: commandNmiDelayChipWriteBoundaryArg === undefined
      ? undefined
      : Math.max(0, Math.trunc(Number(commandNmiDelayChipWriteBoundaryArg))),
    commandNmiDelayCompletedChipWritePreemptions:
      commandNmiDelayCompletedChipWritePreemptionsArg === undefined
        ? undefined
        : Math.max(0, Math.trunc(Number(commandNmiDelayCompletedChipWritePreemptionsArg))),
    commandCycleOffsetCycles: Number(readPresetArg("--command-cycle-offset") ?? "0"),
    commandCycleOffsetStartFrame: readPresetArg("--command-cycle-offset-start-frame") === undefined
      ? undefined
      : Number(readPresetArg("--command-cycle-offset-start-frame")),
    commandCycleOffsetBytes,
    commandSubmitBeforeCpuCatchup: args.includes("--command-submit-before-cpu-catchup"),
    tsEventCycleAdjustOpcodes,
    tsEventCycleAdjustMatches,
    commandPreemptChipWriteLookaheadCycles: Number(readArg(args, "--command-preempt-chip-write-lookahead") ?? "0"),
    commandPreemptChipWritePcs: parsePcList(readArg(args, "--command-preempt-chip-write-pcs")),
    commandPreemptChipWriteCompleteBeforeTarget:
      args.includes("--command-preempt-chip-write-complete-before-target"),
    commandPreemptChipWriteBeforeOnly: args.includes("--command-preempt-chip-write-before-only"),
    fixedFrameCycles: args.includes("--fixed-frame-cycles"),
    frameBudgetSmoothingWindow:
      Math.max(0, Math.trunc(Number(readPresetArg("--frame-budget-smoothing-window") ?? "0"))),
    deferChipIoWriteTiming: args.includes("--defer-chip-write-timing"),
    deferYmTimerControlWriteTiming: args.includes("--defer-ym-timer-control-write-timing"),
    disableYmReset: args.includes("--disable-ym-reset"),
    cpuCliIrqDelay: args.includes("--cpu-cli-irq-delay"),
    cpuIrqPrefetchLatch: args.includes("--cpu-irq-prefetch-latch"),
    ymWriteEventCycleOffsetCycles: Number.isFinite(ymWriteEventCycleOffsetArg)
      ? Math.trunc(ymWriteEventCycleOffsetArg)
      : 0,
    ymWriteEventCycleOffsetRegs,
    ymWriteEventCycleOffsetMatches,
    ymKeyOnWriteEventCycleOffsetCycles: Number.isFinite(ymKeyOnWriteEventCycleOffsetArg)
      ? Math.trunc(ymKeyOnWriteEventCycleOffsetArg)
      : 0,
    ymIrqAssertionDelayCycles: Number.isFinite(ymIrqAssertionDelayArg)
      ? Math.max(0, Math.trunc(ymIrqAssertionDelayArg))
      : 0,
    ymIrqNewAssertionInstructionDelay: Number.isFinite(ymIrqNewAssertionInstructionDelayArg)
      ? Math.max(0, Math.trunc(ymIrqNewAssertionInstructionDelayArg))
      : 0,
    ymCommandEdgeEventDelayCycles: ymCommandEdgeEventDelayCycles === undefined
      ? undefined
      : Math.trunc(ymCommandEdgeEventDelayCycles),
    ymCommandEdgeEventAfterCycles,
    ymCommandEdgeEventBytes,
    ymCommandEdgeEventPcs,
    ymCommandEdgeEventRelation: parseCommandEdgeEventRelation(readPresetArg("--ym-command-edge-event-relation")),
    ymCommandEdgeEventRawDeltaMin: readPresetArg("--ym-command-edge-event-raw-delta-min") === undefined
      ? undefined
      : Math.trunc(Number(readPresetArg("--ym-command-edge-event-raw-delta-min"))),
    ymCommandEdgeEventRawDeltaMax: readPresetArg("--ym-command-edge-event-raw-delta-max") === undefined
      ? undefined
      : Math.trunc(Number(readPresetArg("--ym-command-edge-event-raw-delta-max"))),
    ymCommandEdgeEventRules,
    pokeyCommandEdgeEventAfterCycles,
    pokeyCommandEdgeEventRules,
    pokeyEventBoundaryDelayCycles,
    irqServiceDelayCycles: Number.isFinite(irqServiceDelayArg)
      ? Math.max(0, Math.trunc(irqServiceDelayArg))
      : 0,
    pokeyWriteApplyDelayCycles: Number.isFinite(pokeyWriteApplyDelayArg)
      ? Math.max(0, Math.trunc(pokeyWriteApplyDelayArg))
      : 0,
    pokeyWriteApplyDelayOpcodes,
    pokeyWriteApplyBoundaryDelayCycles: Number.isFinite(pokeyWriteApplyBoundaryDelayArg)
      ? Math.max(0, Math.trunc(pokeyWriteApplyBoundaryDelayArg))
      : 0,
    pokeyWriteApplyBoundaryDelaySampleRate: Number.isFinite(pokeyWriteApplyBoundaryDelaySampleRateArg)
      ? Math.max(1, Math.trunc(pokeyWriteApplyBoundaryDelaySampleRateArg))
      : 55_930,
    pokeyEffectiveApplyTiming: hasPresetFlag("--pokey-effective-apply-timing"),
    pcDeltaReport: args.includes("--pc-delta-report") ||
      pcDeltaReportPcs !== undefined ||
      pcDeltaOffsetSweepCycles !== undefined,
    pcDeltaReportLimit: Math.max(1, Number(readPresetArg("--pc-delta-report-limit") ?? "12")),
    pcDeltaReportSamples: Math.max(0, Number(readPresetArg("--pc-delta-report-samples") ?? "0")),
    pcDeltaReportPcs,
    pcDeltaOffsetSweepCycles,
    frameDeltaReport: args.includes("--frame-delta-report"),
    frameDeltaReportLimit: Math.max(1, Number(readPresetArg("--frame-delta-report-limit") ?? "12")),
    frameOffsetSweepCycles: parseCycleSweep(
      readPresetArg("--frame-offset-sweep-cycles") ?? readPresetArg("--frame-offset-sweep"),
      "--frame-offset-sweep-cycles",
    ),
    frameOffsetSweepReportLimit: Math.max(1, Number(readPresetArg("--frame-offset-sweep-report-limit") ?? "12")),
    pokeyBoundaryGuardSweepCycles: parseCycleSweep(
      readPresetArg("--pokey-boundary-guard-sweep-cycles") ??
        (args.includes("--pokey-boundary-guard-sweep") ? "1:32:1" : undefined),
      "--pokey-boundary-guard-sweep-cycles",
    ),
    pokeyBoundaryCandidateReportCycles: readPresetArg("--pokey-boundary-candidate-report-cycles") === undefined
      ? undefined
      : Math.max(1, Math.trunc(Number(readPresetArg("--pokey-boundary-candidate-report-cycles")))),
    pokeyStreamCursorReport: hasPresetFlag("--pokey-stream-cursor-report"),
    pokeyLofiCursorReport: hasPresetFlag("--pokey-lofi-cursor-report"),
    eventDeltaReportMatches,
    eventDeltaReportSamples: Math.max(0, Number(readArg(args, "--event-delta-report-samples") ?? "16")),
    eventDeltaTargetNativeSampleDelta: readArg(args, "--event-delta-target-native-sample-delta") === undefined
      ? undefined
      : Number(readArg(args, "--event-delta-target-native-sample-delta")),
    requireRawBusWriteParity: hasPresetFlag("--require-raw-bus-write-parity"),
    rawBusWriteParityMode: parseRawBusWriteParityMode(readPresetArg("--raw-bus-write-parity-mode")),
    rawBusWriteToleranceCycles: Math.max(
      0,
      Math.trunc(Number(readPresetArg("--raw-bus-write-tolerance") ?? "0")),
    ),
    rawBusWriteMaxMismatches: Math.max(
      0,
      Math.trunc(Number(readPresetArg("--raw-bus-write-max-mismatches") ?? "0")),
    ),
    tsYmWriteOut: readArg(args, "--ts-ym-write-out"),
    tsYmWriteOutOrigin: parseTsYmWriteOutOrigin(readArg(args, "--ts-ym-write-out-origin")),
  };
}

function parseCmdTapeCommandTiming(value: string | undefined): CmdTapeCommandTiming {
  if (value === undefined || value === "cycle" || value === "cycle-in-frame" || value === "cycleInFrame") {
    return "cycleInFrame";
  }
  if (value === "attos" || value === "secs-attos" || value === "secsAttos") return "secsAttos";
  throw new Error(`invalid --cmd-tape-command-timing ${value}; expected cycle or attos`);
}

function parseMameWriteCycleTiming(value: string | undefined): MameWriteCycleTiming {
  if (value === undefined || value === "attos" || value === "secs-attos" || value === "secsAttos") return "attos";
  if (value === "log" || value === "cycle" || value === "cycle-in-frame" || value === "cycleInFrame") return "log";
  throw new Error(`invalid --mame-write-cycle-timing ${value}; expected attos or log`);
}

function parseRawBusWriteParityMode(value: string | undefined): RawBusWriteParityMode {
  if (value === undefined || value === "both") return "both";
  if (value === "absolute" || value === "offset") return value;
  throw new Error(`invalid --raw-bus-write-parity-mode ${value}; expected absolute, offset, or both`);
}

function parseTsYmWriteOutOrigin(value: string | undefined): Args["tsYmWriteOutOrigin"] {
  if (value === undefined || value === "absolute") return "absolute";
  if (value === "replay") return "replay";
  throw new Error(`invalid --ts-ym-write-out-origin ${value}; expected absolute or replay`);
}

function parseCommandEdgeEventRelation(value: string | undefined): Args["ymCommandEdgeEventRelation"] {
  if (value === undefined || value === "both") return "both";
  if (value === "raw-before" || value === "raw-crossing" || value === "raw-after") return value;
  throw new Error(`invalid --ym-command-edge-event-relation ${value}; expected both, raw-before, raw-crossing, or raw-after`);
}

function parseHexOrNumber(value: unknown): number | undefined {
  if (typeof value === "number") return value;
  if (typeof value !== "string") return undefined;
  return Number.parseInt(value, value.startsWith("0x") ? 16 : 10);
}

function readSoundRomOpcodeReader(): OpcodeReader {
  const rom421 = new Uint8Array(readFileSync("/tmp/sound-roms/136033.421"));
  const rom422 = new Uint8Array(readFileSync("/tmp/sound-roms/136033.422"));
  return (pc) => {
    if (pc === undefined) return undefined;
    if (pc >= 0x8000 && pc < 0xc000) return rom421[pc - 0x8000];
    if (pc >= 0xc000 && pc <= 0xffff) return rom422[pc - 0xc000];
    return undefined;
  };
}

function adjustedCycle(value: number | undefined, delta: number): number | undefined {
  return value === undefined ? undefined : value + delta;
}

function tsEventCycleAdjustForMatches(
  matches: readonly TsEventCycleAdjustMatch[],
  event: ChipWriteEvent,
  frame: number | undefined,
  cycleInFrame: number | undefined,
): number {
  let offset = 0;
  for (const match of matches) {
    if (match.kind !== undefined && match.kind !== event.kind) continue;
    if (match.frame !== undefined && frame !== match.frame) continue;
    if (match.pc !== undefined && (event.pc & 0xffff) !== match.pc) continue;
    if (match.reg !== undefined && (event.reg & 0xff) !== match.reg) continue;
    if (match.val !== undefined && (event.val & 0xff) !== match.val) continue;
    if (match.cycleInFrameMin !== undefined &&
      (cycleInFrame === undefined || cycleInFrame < match.cycleInFrameMin)) {
      continue;
    }
    if (match.cycleInFrameMax !== undefined &&
      (cycleInFrame === undefined || cycleInFrame > match.cycleInFrameMax)) {
      continue;
    }
    offset += match.deltaCycles;
  }
  return offset;
}

function normalizeTs(
  event: ChipWriteEvent,
  opcodeReader: OpcodeReader,
  args: Args,
  frameAdvance: FrameAdvanceDiagnosticRow | undefined,
): NormalizedWrite {
  const timedEvent = event as ChipWriteEventWithRawTiming;
  const opcode = opcodeReader(event.pc);
  const opcodeEventCycleAdjust = opcode === undefined ? 0 : (args.tsEventCycleAdjustOpcodes.get(opcode) ?? 0);
  const matchEventCycleAdjust = tsEventCycleAdjustForMatches(
    args.tsEventCycleAdjustMatches,
    event,
    event.frame,
    adjustedCycle(event.cycleInFrame, opcodeEventCycleAdjust),
  );
  const eventCycleAdjust = opcodeEventCycleAdjust + matchEventCycleAdjust;
  const rawCycle = adjustedCycle(timedEvent.rawCycle, eventCycleAdjust);
  const rawCycleInFrame = adjustedCycle(timedEvent.rawCycleInFrame, eventCycleAdjust);
  const rawWriteCycleOffset = timedEvent.rawWriteCycleOffset === undefined
    ? undefined
    : timedEvent.rawWriteCycleOffset + eventCycleAdjust;
  const eventFrameAdvance = frameAdvance?.frame === event.frame ? frameAdvance : undefined;
  const busCycle = timedEvent.rawCycle ?? event.cycle;
  const busCycleInFrame = timedEvent.rawCycleInFrame ?? event.cycleInFrame;
  const busWriteCycleOffset = timedEvent.rawWriteCycleOffset ?? event.writeCycleOffset;
  return {
    kind: event.kind,
    frame: event.frame,
    cycle: adjustedCycle(event.cycle, eventCycleAdjust),
    cycleInFrame: adjustedCycle(event.cycleInFrame, eventCycleAdjust),
    replayCycle: adjustedCycle(event.cycle, eventCycleAdjust),
    rawCycle,
    rawCycleInFrame,
    rawReplayCycle: rawCycle,
    busCycle,
    busCycleInFrame,
    busReplayCycle: busCycle,
    pc: event.pc,
    opcode,
    instFrame: undefined,
    instPc: undefined,
    instOpcode: undefined,
    instDeltaCycles: undefined,
    writeCycleOffset: event.writeCycleOffset + eventCycleAdjust,
    rawWriteCycleOffset,
    busWriteCycleOffset,
    chipEventCycleOffset: timedEvent.eventCycleOffset,
    eventCycleAdjust: eventCycleAdjust === 0 ? undefined : eventCycleAdjust,
    pokeyEffectiveApplyDelayCycles: undefined,
    commandEdgeEventAdjust: undefined,
    schedulerFrameStartDelta: eventFrameAdvance?.cpuStartDelta,
    schedulerFrameEndDelta: eventFrameAdvance?.cpuEndDelta,
    schedulerFrameCycles: eventFrameAdvance?.frameCycles,
    schedulerFrameCommandCount: eventFrameAdvance?.commandCount,
    reg: event.reg,
    val: event.val,
  };
}

function normalizeMameWrite(
  raw: Record<string, unknown>,
  kind: Kind,
  origin: TimingOrigin | undefined,
  replayOriginCycle: bigint | undefined,
  opcodeReader: OpcodeReader,
  mameWriteCycleTiming: MameWriteCycleTiming,
): NormalizedWrite {
  const frame = parseHexOrNumber(raw.frame);
  const explicitCycle = parseHexOrNumber(raw.cycleInFrame);
  const secs = parseHexOrNumber(raw.secs);
  const attos = typeof raw.attos === "string" ? raw.attos : undefined;
  const timing: {
    frame: number;
    secs?: number;
    attos?: string;
    cycleInFrame?: number;
  } | undefined = frame === undefined ? undefined : { frame };
  if (timing !== undefined) {
    if (secs !== undefined) timing.secs = secs;
    if (attos !== undefined) timing.attos = attos;
    if (explicitCycle !== undefined) timing.cycleInFrame = explicitCycle;
  }
  const cycleInFrame = timing === undefined ? explicitCycle : cmdTapeReplaySignedCycleInFrame(timing, origin);
  const rawCycle = parseHexOrNumber(raw.cycle);
  const absoluteCycle = secs === undefined || attos === undefined
    ? undefined
    : cmdTapeAbsoluteCycle({ secs, attos });
  const logReplayCycle = origin?.replayCycle !== undefined && cycleInFrame !== undefined
    ? origin.replayCycle + cycleInFrame
    : rawCycle;
  const attosReplayCycle = absoluteCycle !== undefined && replayOriginCycle !== undefined
    ? Number(absoluteCycle - replayOriginCycle)
    : logReplayCycle;
  const replayCycle = mameWriteCycleTiming === "log" ? logReplayCycle : attosReplayCycle;
  const reg = parseHexOrNumber(raw.reg) ?? 0;
  const val = parseHexOrNumber(raw.val ?? raw.data) ?? 0;
  const instOpcode = parseHexOrNumber(raw.instOpcode);
  const instDeltaCycles = parseHexOrNumber(raw.instDeltaCycles);
  const writeCycleOffset = parseHexOrNumber(raw.writeCycleOffset);
  return {
    kind,
    frame,
    cycle: rawCycle,
    cycleInFrame,
    replayCycle,
    rawCycle: undefined,
    rawCycleInFrame: undefined,
    rawReplayCycle: undefined,
    busCycle: rawCycle,
    busCycleInFrame: cycleInFrame,
    busReplayCycle: replayCycle,
    pc: parseHexOrNumber(raw.pc),
    opcode: instOpcode ?? opcodeReader(parseHexOrNumber(raw.pc)),
    instFrame: parseHexOrNumber(raw.instFrame),
    instPc: parseHexOrNumber(raw.instPc),
    instOpcode,
    instDeltaCycles,
    writeCycleOffset,
    rawWriteCycleOffset: undefined,
    busWriteCycleOffset: writeCycleOffset ?? instDeltaCycles,
    chipEventCycleOffset: undefined,
    eventCycleAdjust: undefined,
    pokeyEffectiveApplyDelayCycles: undefined,
    commandEdgeEventAdjust: undefined,
    schedulerFrameStartDelta: undefined,
    schedulerFrameEndDelta: undefined,
    schedulerFrameCycles: undefined,
    schedulerFrameCommandCount: undefined,
    reg,
    val,
  };
}

function readMameWrites(
  path: string,
  kind: Kind,
  origins: ReadonlyMap<number, TimingOrigin>,
  replayOriginCycle: bigint | undefined,
  opcodeReader: OpcodeReader,
  mameWriteCycleTiming: MameWriteCycleTiming,
): NormalizedWrite[] {
  if (!existsSync(path)) throw new Error(`MAME ${kind} write log not found: ${path}`);
  const parsed = JSON.parse(readFileSync(path, "utf8")) as { writes?: Array<Record<string, unknown>> };
  return (parsed.writes ?? []).map((w) => {
    const frame = parseHexOrNumber(w.frame);
    return normalizeMameWrite(
      w,
      kind,
      frame === undefined ? undefined : origins.get(frame),
      replayOriginCycle,
      opcodeReader,
      mameWriteCycleTiming,
    );
  });
}

function readCmdTapeJson(cmdTapePath: string): CmdTape {
  return JSON.parse(readFileSync(cmdTapePath, "utf8")) as CmdTape;
}

function adjustCmdTapeCommandCycles(tape: CmdTape, args: Args): CmdTapeAdjustment {
  const selectedBytes = args.commandCycleOffsetBytes;
  const offset = args.commandCycleOffsetCycles;
  if (selectedBytes === undefined || offset === 0) {
    return { tape, adjustedCommandCount: 0 };
  }
  const selected = new Set(selectedBytes.map((byte) => byte & 0xff));
  const origins = new Map<number, TimingOrigin>();
  for (const cmd of tape.cmds) {
    if (cmd.secs === undefined || cmd.attos === undefined || origins.has(cmd.frame)) continue;
    const absoluteCycle = cmdFrameOriginAbsoluteCycleForTiming(cmd, args.cmdTapeCommandTiming);
    origins.set(cmd.frame, {
      frame: cmd.frame,
      secs: cmd.secs,
      attos: cmd.attos,
      ...(absoluteCycle === undefined ? {} : { absoluteCycle }),
    });
  }

  let adjustedCommandCount = 0;
  const cmds = tape.cmds.map((cmd) => {
    const byte = cmd.byte & 0xff;
    const frameAllowed = args.commandCycleOffsetStartFrame === undefined ||
      cmd.frame >= args.commandCycleOffsetStartFrame;
    if (!frameAllowed || !selected.has(byte)) return cmd;
    const cycleInFrame = cmdTapeReplayCycleInFrame(cmd, origins.get(cmd.frame), args.cmdTapeCommandTiming);
    if (cycleInFrame === undefined) return cmd;
    adjustedCommandCount++;
    return {
      ...cmd,
      cycleInFrame: cycleInFrame + offset,
    };
  });
  return { tape: { cmds }, adjustedCommandCount };
}

function readTimingOriginsFromTape(tape: CmdTape, commandTiming: CmdTapeCommandTiming): {
  origins: Map<number, TimingOrigin>;
  replayOriginCycle: bigint | undefined;
  firstFrame: number;
} {
  const firstFrame = tape.cmds.reduce((min, cmd) => Math.min(min, cmd.frame), Number.POSITIVE_INFINITY);
  const rawOrigins = new Map<number, TimingOrigin>();
  let replayOriginCycle: bigint | undefined;
  for (const c of tape.cmds) {
    if (c.frame === undefined || c.secs === undefined || c.attos === undefined || rawOrigins.has(c.frame)) continue;
    const absoluteCycle = cmdFrameOriginAbsoluteCycleForTiming(c, commandTiming);
    replayOriginCycle ??= absoluteCycle;
    rawOrigins.set(c.frame, {
      frame: c.frame,
      secs: c.secs,
      attos: c.attos,
      ...(absoluteCycle === undefined ? {} : { absoluteCycle }),
    });
  }
  const origins = new Map<number, TimingOrigin>();
  for (const [frame, origin] of rawOrigins) {
    const replayCycle = origin.absoluteCycle === undefined || replayOriginCycle === undefined
      ? undefined
      : Number(origin.absoluteCycle - replayOriginCycle);
    origins.set(frame, { ...origin, ...(replayCycle === undefined ? {} : { replayCycle }) });
  }
  return { origins, replayOriginCycle, firstFrame: Number.isFinite(firstFrame) ? firstFrame : 0 };
}

function commandReplayEventFromTapeCommand(
  cmd: CmdTape["cmds"][number],
  sourceIndex: number,
  origins: ReadonlyMap<number, TimingOrigin>,
  replayOriginCycle: bigint | undefined,
  firstFrame: number,
  commandTiming: CmdTapeCommandTiming,
): CommandReplayEvent | undefined {
  const origin = origins.get(cmd.frame);
  const cycleInFrame = cmdTapeReplaySignedCycleInFrame(
    {
      frame: cmd.frame,
      ...(cmd.secs === undefined ? {} : { secs: cmd.secs }),
      ...(cmd.attos === undefined ? {} : { attos: cmd.attos }),
      ...(cmd.cycleInFrame === undefined ? {} : { cycleInFrame: cmd.cycleInFrame }),
    },
    origin,
    commandTiming,
  );
  let replayCycle: number | undefined;
  if (commandTiming === "secsAttos" || cmd.cycleInFrame === undefined) {
    const absoluteCycle = cmdTapeAbsoluteCycle(cmd);
    if (absoluteCycle !== undefined && replayOriginCycle !== undefined) {
      replayCycle = Number(absoluteCycle - replayOriginCycle);
    }
  }
  if (replayCycle === undefined && cmd.cycleInFrame !== undefined && origin?.replayCycle !== undefined) {
    replayCycle = origin.replayCycle + Math.trunc(cmd.cycleInFrame);
  }
  if (replayCycle === undefined) {
    const absoluteCycle = cmdTapeAbsoluteCycle(cmd);
    if (absoluteCycle !== undefined && replayOriginCycle !== undefined) {
      replayCycle = Number(absoluteCycle - replayOriginCycle);
    }
  }
  if (replayCycle === undefined && origin?.replayCycle !== undefined && cycleInFrame !== undefined) {
    replayCycle = origin.replayCycle + cycleInFrame;
  }
  if (replayCycle === undefined && cycleInFrame !== undefined) {
    replayCycle = ((cmd.frame - firstFrame) * SOUND_CYCLES_PER_FRAME) + cycleInFrame;
  }
  if (replayCycle === undefined) return undefined;
  const commandContext = cmd as CmdTape["cmds"][number] & {
    readonly soundPc?: unknown;
    readonly soundA?: unknown;
    readonly soundX?: unknown;
    readonly soundY?: unknown;
    readonly soundP?: unknown;
    readonly soundSp?: unknown;
    readonly instFrame?: unknown;
    readonly instPc?: unknown;
    readonly instOpcode?: unknown;
    readonly instDeltaCycles?: unknown;
    readonly nextInstFrame?: unknown;
    readonly nextInstPc?: unknown;
    readonly nextInstOpcode?: unknown;
    readonly nextInstDeltaCycles?: unknown;
    readonly nextChronoInstFrame?: unknown;
    readonly nextChronoInstPc?: unknown;
    readonly nextChronoInstOpcode?: unknown;
    readonly nextChronoInstDeltaCycles?: unknown;
  };
  const soundPc = parseHexOrNumber(commandContext.soundPc);
  const soundA = parseHexOrNumber(commandContext.soundA);
  const soundX = parseHexOrNumber(commandContext.soundX);
  const soundY = parseHexOrNumber(commandContext.soundY);
  const soundP = parseHexOrNumber(commandContext.soundP);
  const soundSp = parseHexOrNumber(commandContext.soundSp);
  const instFrame = parseHexOrNumber(commandContext.instFrame);
  const instPc = parseHexOrNumber(commandContext.instPc);
  const instOpcode = parseHexOrNumber(commandContext.instOpcode);
  const instDeltaCycles = parseHexOrNumber(commandContext.instDeltaCycles);
  const nextInstFrame = parseHexOrNumber(commandContext.nextInstFrame);
  const nextInstPc = parseHexOrNumber(commandContext.nextInstPc);
  const nextInstOpcode = parseHexOrNumber(commandContext.nextInstOpcode);
  const nextInstDeltaCycles = parseHexOrNumber(commandContext.nextInstDeltaCycles);
  const nextChronoInstFrame = parseHexOrNumber(commandContext.nextChronoInstFrame);
  const nextChronoInstPc = parseHexOrNumber(commandContext.nextChronoInstPc);
  const nextChronoInstOpcode = parseHexOrNumber(commandContext.nextChronoInstOpcode);
  const nextChronoInstDeltaCycles = parseHexOrNumber(commandContext.nextChronoInstDeltaCycles);
  return {
    sourceIndex,
    frame: cmd.frame,
    byte: cmd.byte & 0xff,
    cycleInFrame,
    replayCycle,
    soundPc: soundPc === undefined ? undefined : soundPc & 0xffff,
    soundA: soundA === undefined ? undefined : soundA & 0xff,
    soundX: soundX === undefined ? undefined : soundX & 0xff,
    soundY: soundY === undefined ? undefined : soundY & 0xff,
    soundP: soundP === undefined ? undefined : soundP & 0xff,
    soundSp: soundSp === undefined ? undefined : soundSp & 0xff,
    instFrame,
    instPc: instPc === undefined ? undefined : instPc & 0xffff,
    instOpcode: instOpcode === undefined ? undefined : instOpcode & 0xff,
    instDeltaCycles,
    nextInstFrame,
    nextInstPc: nextInstPc === undefined ? undefined : nextInstPc & 0xffff,
    nextInstOpcode: nextInstOpcode === undefined ? undefined : nextInstOpcode & 0xff,
    nextInstDeltaCycles,
    nextChronoInstFrame,
    nextChronoInstPc: nextChronoInstPc === undefined ? undefined : nextChronoInstPc & 0xffff,
    nextChronoInstOpcode: nextChronoInstOpcode === undefined ? undefined : nextChronoInstOpcode & 0xff,
    nextChronoInstDeltaCycles,
  };
}

function readCommandReplayEventsFromTape(
  tape: CmdTape,
  origins: ReadonlyMap<number, TimingOrigin>,
  replayOriginCycle: bigint | undefined,
  firstFrame: number,
  commandTiming: CmdTapeCommandTiming,
): CommandReplayEvent[] {
  const events: CommandReplayEvent[] = [];
  for (const [sourceIndex, cmd] of tape.cmds.entries()) {
    const event = commandReplayEventFromTapeCommand(
      cmd,
      sourceIndex,
      origins,
      replayOriginCycle,
      firstFrame,
      commandTiming,
    );
    if (event !== undefined) events.push(event);
  }
  events.sort((a, b) => a.replayCycle - b.replayCycle || a.sourceIndex - b.sourceIndex);
  return events;
}

function mameSoundCommandReadEventFromTapeRead(
  raw: Record<string, unknown>,
  origins: ReadonlyMap<number, TimingOrigin>,
  replayOriginCycle: bigint | undefined,
  commandEventsBySource: ReadonlyMap<number, CommandReplayEvent>,
  commandTiming: CmdTapeCommandTiming,
): MameSoundCommandReadEvent | undefined {
  const frame = parseHexOrNumber(raw.frame);
  const explicitCycle = parseHexOrNumber(raw.cycleInFrame);
  const secs = parseHexOrNumber(raw.secs);
  const attos = typeof raw.attos === "string" ? raw.attos : undefined;
  const timing: {
    frame: number;
    secs?: number;
    attos?: string;
    cycleInFrame?: number;
  } | undefined = frame === undefined ? undefined : { frame };
  if (timing !== undefined) {
    if (secs !== undefined) timing.secs = secs;
    if (attos !== undefined) timing.attos = attos;
    if (explicitCycle !== undefined) timing.cycleInFrame = explicitCycle;
  }
  const origin = frame === undefined ? undefined : origins.get(frame);
  const cycleInFrame = timing === undefined
    ? explicitCycle
    : cmdTapeReplaySignedCycleInFrame(timing, origin, commandTiming);
  const absoluteCycle = secs === undefined || attos === undefined
    ? undefined
    : cmdTapeAbsoluteCycle({ secs, attos });
  let replayCycle = absoluteCycle !== undefined && replayOriginCycle !== undefined
    ? Number(absoluteCycle - replayOriginCycle)
    : undefined;
  if (replayCycle === undefined && origin?.replayCycle !== undefined && cycleInFrame !== undefined) {
    replayCycle = origin.replayCycle + cycleInFrame;
  }
  if (replayCycle === undefined) return undefined;
  const sourceIndex = parseHexOrNumber(raw.sourceIndex);
  const command = sourceIndex === undefined ? undefined : commandEventsBySource.get(sourceIndex);
  const byte = parseHexOrNumber(raw.byte ?? raw.val) ?? 0;
  const pc = parseHexOrNumber(raw.pc);
  const instFrame = parseHexOrNumber(raw.instFrame);
  const instPc = parseHexOrNumber(raw.instPc);
  const instOpcode = parseHexOrNumber(raw.instOpcode);
  const instDeltaCycles = parseHexOrNumber(raw.instDeltaCycles);
  return {
    sourceIndex,
    frame,
    byte: byte & 0xff,
    cycleInFrame,
    replayCycle,
    pc: pc === undefined ? undefined : pc & 0xffff,
    instFrame,
    instPc: instPc === undefined ? undefined : instPc & 0xffff,
    instOpcode: instOpcode === undefined ? undefined : instOpcode & 0xff,
    instDeltaCycles,
    deltaFromCommand: command === undefined ? undefined : replayCycle - command.replayCycle,
  };
}

function readMameSoundCommandReadsFromTape(
  tape: CmdTape,
  origins: ReadonlyMap<number, TimingOrigin>,
  replayOriginCycle: bigint | undefined,
  commandEventsBySource: ReadonlyMap<number, CommandReplayEvent>,
  commandTiming: CmdTapeCommandTiming,
): MameSoundCommandReadEvent[] {
  const rawTape = tape as CmdTape & { readonly soundCmdReads?: readonly Record<string, unknown>[] };
  const reads: MameSoundCommandReadEvent[] = [];
  for (const rawRead of rawTape.soundCmdReads ?? []) {
    const read = mameSoundCommandReadEventFromTapeRead(
      rawRead,
      origins,
      replayOriginCycle,
      commandEventsBySource,
      commandTiming,
    );
    if (read !== undefined) reads.push(read);
  }
  reads.sort((a, b) =>
    a.replayCycle - b.replayCycle ||
    (a.sourceIndex ?? Number.POSITIVE_INFINITY) - (b.sourceIndex ?? Number.POSITIVE_INFINITY));
  return reads;
}

function summarizeMameSoundCommandReads(reads: readonly MameSoundCommandReadEvent[]): MameSoundCommandReadSummary {
  let withSourceIndex = 0;
  let withCommandDelta = 0;
  let withInstContext = 0;
  for (const read of reads) {
    if (read.sourceIndex !== undefined) withSourceIndex++;
    if (read.deltaFromCommand !== undefined) withCommandDelta++;
    if (read.instPc !== undefined && read.instOpcode !== undefined && read.instDeltaCycles !== undefined) {
      withInstContext++;
    }
  }
  return {
    total: reads.length,
    withSourceIndex,
    withCommandDelta,
    withInstContext,
  };
}

function summarizeCommandContextFromTape(
  tape: CmdTape,
  origins: ReadonlyMap<number, TimingOrigin>,
): CommandContextSummary {
  let withCycleTiming = 0;
  let withSoundPc = 0;
  let withInstContext = 0;
  let withNextInstContext = 0;
  let withNextChronoInstContext = 0;
  for (const cmd of tape.cmds) {
    if (cmdTapeReplaySignedCycleInFrame(cmd, origins.get(cmd.frame)) !== undefined) withCycleTiming++;
    const commandContext = cmd as CmdTape["cmds"][number] & {
      readonly soundPc?: unknown;
      readonly instPc?: unknown;
      readonly instOpcode?: unknown;
      readonly instDeltaCycles?: unknown;
      readonly nextInstPc?: unknown;
      readonly nextInstOpcode?: unknown;
      readonly nextInstDeltaCycles?: unknown;
      readonly nextChronoInstPc?: unknown;
      readonly nextChronoInstOpcode?: unknown;
      readonly nextChronoInstDeltaCycles?: unknown;
    };
    const soundPc = parseHexOrNumber(commandContext.soundPc);
    if (soundPc !== undefined && Number.isFinite(soundPc)) withSoundPc++;
    const instPc = parseHexOrNumber(commandContext.instPc);
    const instOpcode = parseHexOrNumber(commandContext.instOpcode);
    const instDeltaCycles = parseHexOrNumber(commandContext.instDeltaCycles);
    if (instPc !== undefined && Number.isFinite(instPc) &&
      instOpcode !== undefined && Number.isFinite(instOpcode) &&
      instDeltaCycles !== undefined && Number.isFinite(instDeltaCycles)) {
      withInstContext++;
    }
    const nextInstPc = parseHexOrNumber(commandContext.nextInstPc);
    const nextInstOpcode = parseHexOrNumber(commandContext.nextInstOpcode);
    const nextInstDeltaCycles = parseHexOrNumber(commandContext.nextInstDeltaCycles);
    if (nextInstPc !== undefined && Number.isFinite(nextInstPc) &&
      nextInstOpcode !== undefined && Number.isFinite(nextInstOpcode) &&
      nextInstDeltaCycles !== undefined && Number.isFinite(nextInstDeltaCycles)) {
      withNextInstContext++;
    }
    const nextChronoInstPc = parseHexOrNumber(commandContext.nextChronoInstPc);
    const nextChronoInstOpcode = parseHexOrNumber(commandContext.nextChronoInstOpcode);
    const nextChronoInstDeltaCycles = parseHexOrNumber(commandContext.nextChronoInstDeltaCycles);
    if (nextChronoInstPc !== undefined && Number.isFinite(nextChronoInstPc) &&
      nextChronoInstOpcode !== undefined && Number.isFinite(nextChronoInstOpcode) &&
      nextChronoInstDeltaCycles !== undefined && Number.isFinite(nextChronoInstDeltaCycles)) {
      withNextChronoInstContext++;
    }
  }
  return {
    total: tape.cmds.length,
    withCycleTiming,
    withSoundPc,
    withInstContext,
    withNextInstContext,
    withNextChronoInstContext,
  };
}

function assertRequiredCommandContext(summary: CommandContextSummary, flagName: string): void {
  if (summary.total > 0 &&
    summary.withCycleTiming === summary.total &&
    summary.withSoundPc === summary.total) {
    return;
  }
  throw new Error(
    `${flagName} requires every cmd-tape command to carry cycle timing and soundPc context; ` +
    `commands=${summary.total} cycleTiming=${summary.withCycleTiming} soundPc=${summary.withSoundPc}`,
  );
}

function readCommandReplayCyclesFromEvents(events: readonly CommandReplayEvent[]): number[] {
  return events.map((event) => event.replayCycle);
}

function soundCycleToAttoseconds(cycle: bigint): { secs: number; attos: string } {
  const totalAttos = cycle * BigInt(SOUND_CMD_TAPE_CPU_HZ_DENOMINATOR) *
    1_000_000_000_000_000_000n / BigInt(SOUND_CMD_TAPE_CPU_HZ_NUMERATOR);
  const secs = totalAttos / 1_000_000_000_000_000_000n;
  const attos = totalAttos % 1_000_000_000_000_000_000n;
  return { secs: Number(secs), attos: attos.toString() };
}

function writeTsYmWriteLog(
  path: string,
  writes: readonly NormalizedWrite[],
  replayOriginCycle: bigint | undefined,
  frames: number,
  cmdTape: string,
  origin: Args["tsYmWriteOutOrigin"],
): void {
  if (origin === "absolute" && replayOriginCycle === undefined) {
    throw new Error("--ts-ym-write-out requires a cmd tape with secs/attos timing origins");
  }
  const ymWrites = writes.filter((w) => w.kind === "ym2151");
  writeFileSync(path, JSON.stringify({
    frames,
    cmdTape,
    source: "ts-sound-chip",
    origin,
    writes: ymWrites.map((w, index) => {
      const replayCycle = Math.max(0, Math.trunc(w.replayCycle ?? w.cycle ?? 0));
      const cycle = origin === "absolute"
        ? replayOriginCycle! + BigInt(replayCycle)
        : BigInt(replayCycle);
      const { secs, attos } = soundCycleToAttoseconds(cycle);
      return {
        index,
        frame: w.frame,
        cycleInFrame: w.cycleInFrame,
        replayCycle,
        secs,
        attos,
        pc: w.pc,
        reg: w.reg,
        val: w.val,
      };
    }),
  }, null, 2));
}

function runTsWrites(
  frames: number,
  cmdTapeData: CmdTape,
  cmdTapePath: string,
  commandEventsBySource: ReadonlyMap<number, CommandReplayEvent>,
  mameCommandReadsBySource: ReadonlyMap<number, MameSoundCommandReadEvent>,
  opcodeReader: OpcodeReader,
  args: Args,
  statusBase: number | undefined,
  statusTape: string | undefined,
  statusTapeMode: StatusTapeMode,
  resetReleaseDelayCycles: number,
  replyAckDelayCycles: number,
  replyAckTape: string | undefined,
  timerAStartDelayCycles: number,
  timerAHoldWhileOverflow: boolean,
  commandNmiDelayInstructions: number,
  commandNmiServiceDelayCycles: number,
  commandNmiSampleCycle: number,
  commandNmiBoundaryDelayInstructions: number,
  commandNmiDelayMatches: readonly CommandNmiDelayMatch[],
  commandNmiDelayCompletedChipWritePreemptions: number | undefined,
  commandCycleOffsetCycles: number,
  commandCycleOffsetStartFrame: number | undefined,
  commandSubmitBeforeCpuCatchup: boolean,
  commandPreemptChipWriteLookaheadCycles: number,
  commandPreemptChipWritePcs: number[] | undefined,
  commandPreemptChipWriteCompleteBeforeTarget: boolean,
  commandPreemptChipWriteBeforeOnly: boolean,
  deferChipIoWriteTiming: boolean,
  deferYmTimerControlWriteTiming: boolean,
  disableYmReset: boolean,
  cpuCliIrqDelay: boolean,
  cpuIrqPrefetchLatch: boolean,
  ymWriteEventCycleOffsetCycles: number,
  ymWriteEventCycleOffsetRegs: ReadonlyMap<number, number>,
  ymWriteEventCycleOffsetMatches: readonly YmWriteEventCycleOffsetMatch[],
  ymKeyOnWriteEventCycleOffsetCycles: number,
  ymIrqAssertionDelayCycles: number,
  ymIrqNewAssertionInstructionDelay: number,
  irqServiceDelayCycles: number,
  pokeyWriteApplyDelayCycles: number,
  pokeyWriteApplyDelayOpcodes: ReadonlyMap<number, number>,
  pokeyWriteApplyBoundaryDelayCycles: number,
  pokeyWriteApplyBoundaryDelaySampleRate: number,
): {
  writes: NormalizedWrite[];
  commandReads: SoundCommandReadEvent[];
  cyclePreciseTape: boolean;
  statusReplay: SoundStatusReplayStats | undefined;
  replyAckReplay: MainReplyAckReplay | undefined;
  preemptedChipWrites: PreemptedChipWriteSummary;
  commandSubmitDiagnostics: CommandSubmitDiagnostics;
  commandSubmitRows: CommandSubmitDiagnosticRow[];
  commandSubmissions: ReadonlyMap<number, CommandSubmitContext>;
  schedulerDrift: SchedulerDriftSummary;
  pokeyRawTransitions: PokeyRawTransition[];
} {
  const rom421 = new Uint8Array(readFileSync("/tmp/sound-roms/136033.421"));
  const rom422 = new Uint8Array(readFileSync("/tmp/sound-roms/136033.422"));
  const tape = loadCmdTape(cmdTapeData, {
    commandTiming: args.cmdTapeCommandTiming,
    frameBudgetSmoothingWindow: args.frameBudgetSmoothingWindow,
  });
  if (args.fixedFrameCycles) tape.frameCycleBudgets.clear();
  const replyAckReplay = createMainReplyAckReplayForTape(cmdTapePath, replyAckTape, {
    useEmbedded: args.useEmbeddedReplyAckTape,
  });
  const pokeyOpcodeApplyDelayFor = (opcode: number | undefined): number =>
    opcode === undefined ? 0 : (pokeyWriteApplyDelayOpcodes.get(opcode & 0xff) ?? 0);
  const pokeyBoundaryApplyDelayFor = (cycle: number): number =>
    boundaryDelayToNextSample(
      cycle,
      pokeyWriteApplyBoundaryDelayCycles,
      pokeyWriteApplyBoundaryDelaySampleRate,
    );
  const pokeyWriteApplyDelayProvider =
    pokeyWriteApplyDelayOpcodes.size === 0 && pokeyWriteApplyBoundaryDelayCycles === 0
      ? undefined
      : (ctx: {
          readonly opcode: number | undefined;
          readonly rawCycle: number;
          readonly currentApplyDelayCycles: number;
        }) => {
          const opcodeDelay = pokeyOpcodeApplyDelayFor(ctx.opcode);
          const boundaryDelay = pokeyBoundaryApplyDelayFor(
            ctx.rawCycle + ctx.currentApplyDelayCycles + opcodeDelay,
          );
          const totalDelay = opcodeDelay + boundaryDelay;
          return totalDelay === 0 ? undefined : totalDelay;
        };
  let currentFrame = -1;
  const chip = createSoundChip(statusBase === undefined
    ? {
      roms: { rom421, rom422 },
      mainReplyAckDelayCycles: replyAckDelayCycles,
      ...(deferChipIoWriteTiming ? { deferChipIoWriteTiming: true } : {}),
      ...(deferYmTimerControlWriteTiming ? { deferYmTimerControlWriteTiming: true } : {}),
      ...(disableYmReset ? { disableYmReset: true } : {}),
      ...(cpuCliIrqDelay ? { cpuCliIrqDelay: true } : {}),
      ...(cpuIrqPrefetchLatch ? { cpuIrqPrefetchLatch: true } : {}),
      ...(ymWriteEventCycleOffsetCycles === 0 ? {} : { ymWriteEventCycleOffsetCycles }),
      ...(ymWriteEventCycleOffsetRegs.size === 0 ? {} : { ymWriteEventCycleOffsetByReg: ymWriteEventCycleOffsetRegs }),
      ...(ymWriteEventCycleOffsetMatches.length === 0
        ? {}
        : { ymWriteEventCycleOffsetMatches }),
      ...(ymKeyOnWriteEventCycleOffsetCycles === 0 ? {} : { ymKeyOnWriteEventCycleOffsetCycles }),
      ...(commandNmiServiceDelayCycles > 0 ? { commandNmiServiceDelayCycles } : {}),
      ...(ymIrqAssertionDelayCycles > 0 ? { ymIrqAssertionDelayCycles } : {}),
      ...(ymIrqNewAssertionInstructionDelay > 0 ? { ymIrqNewAssertionInstructionDelay } : {}),
      ...(irqServiceDelayCycles > 0 ? { irqServiceDelayCycles } : {}),
      ...(pokeyWriteApplyDelayCycles > 0 ? { pokeyWriteApplyDelayCycles } : {}),
      ...(pokeyWriteApplyDelayProvider === undefined ? {} : { pokeyWriteApplyDelayProvider }),
      ...(replyAckReplay === undefined ? {} : { mainReplyAckCycle: replyAckReplay.schedule }),
    }
    : {
      roms: { rom421, rom422 },
      statusBase: as_u8(statusBase),
      mainReplyAckDelayCycles: replyAckDelayCycles,
      ...(deferChipIoWriteTiming ? { deferChipIoWriteTiming: true } : {}),
      ...(deferYmTimerControlWriteTiming ? { deferYmTimerControlWriteTiming: true } : {}),
      ...(disableYmReset ? { disableYmReset: true } : {}),
      ...(cpuCliIrqDelay ? { cpuCliIrqDelay: true } : {}),
      ...(cpuIrqPrefetchLatch ? { cpuIrqPrefetchLatch: true } : {}),
      ...(ymWriteEventCycleOffsetCycles === 0 ? {} : { ymWriteEventCycleOffsetCycles }),
      ...(ymWriteEventCycleOffsetRegs.size === 0 ? {} : { ymWriteEventCycleOffsetByReg: ymWriteEventCycleOffsetRegs }),
      ...(ymWriteEventCycleOffsetMatches.length === 0
        ? {}
        : { ymWriteEventCycleOffsetMatches }),
      ...(ymKeyOnWriteEventCycleOffsetCycles === 0 ? {} : { ymKeyOnWriteEventCycleOffsetCycles }),
      ...(commandNmiServiceDelayCycles > 0 ? { commandNmiServiceDelayCycles } : {}),
      ...(ymIrqAssertionDelayCycles > 0 ? { ymIrqAssertionDelayCycles } : {}),
      ...(ymIrqNewAssertionInstructionDelay > 0 ? { ymIrqNewAssertionInstructionDelay } : {}),
      ...(irqServiceDelayCycles > 0 ? { irqServiceDelayCycles } : {}),
      ...(pokeyWriteApplyDelayCycles > 0 ? { pokeyWriteApplyDelayCycles } : {}),
      ...(pokeyWriteApplyDelayProvider === undefined ? {} : { pokeyWriteApplyDelayProvider }),
      ...(replyAckReplay === undefined ? {} : { mainReplyAckCycle: replyAckReplay.schedule }),
    });
  const statusReplay = statusTape === undefined
    ? undefined
    : statusTapeMode === "frame"
      ? installSoundStatusFrameReplay(chip, statusTape, loadSoundStatusReads(statusTape), () =>
        currentFrame < 0 ? undefined : currentFrame, { valueMode: args.statusValueMode })
      : installSoundStatusReplay(chip, statusTape, loadSoundStatusReads(statusTape), { valueMode: args.statusValueMode });
  ((chip.ym2151 as unknown) as YM2151WithTimerPhaseDiagnostic).timerAStartDelayYmCycles =
    Math.trunc(timerAStartDelayCycles * 2);
  ((chip.ym2151 as unknown) as YM2151WithTimerPhaseDiagnostic).timerAHoldWhileOverflow =
    timerAHoldWhileOverflow;
  ((chip as unknown) as SoundChipWithCommandNmiDiagnostic).commandNmiDelayInstructions =
    Math.max(0, Math.trunc(commandNmiDelayInstructions));
  if (args.pokeyStreamCursorReport) setPokeyDiagnosticRawTransitions(chip, true);
  const writes: NormalizedWrite[] = [];
  const pokeyRawTransitions: PokeyRawTransition[] = [];
  const commandPreemptChipWritePcSet = commandPreemptChipWritePcs === undefined
    ? undefined
    : new Set(commandPreemptChipWritePcs.map((pc) => pc & 0xffff));
  const preemptedByPc = new Map<string, {
    count: number;
    firstCommand: {
      frame: number;
      cycle: number;
      address: string;
      targetDeltaFromWrite: number;
    };
  }>();
  const commandSubmitDiagnostics: CommandSubmitDiagnostics = {
    commandCount: 0,
    pendingBeforeCount: 0,
    nmiDelayHistogram: {},
    byDelay: {},
    overrideMatchCount: 0,
    overridePendingBeforeCount: 0,
    overrideBySelector: {},
    overrideSamples: [],
  };
  const commandSubmissions = new Map<number, CommandSubmitContext>();
  const commandSubmitRows: CommandSubmitDiagnosticRow[] = [];
  const frameAdvanceRows: FrameAdvanceDiagnosticRow[] = [];
  const commandReads: SoundCommandReadEvent[] = [];
  for (let f = 0; f < frames; f++) {
    currentFrame = f;
    const frameCommandCycleOffsetCycles =
      commandCycleOffsetStartFrame === undefined || f >= commandCycleOffsetStartFrame
        ? commandCycleOffsetCycles
        : 0;
    const replayOptions = {
      autoReleaseReset: true,
      drainReplies: true,
      resetReleaseDelayCycles,
      resetFirstFetchDelayAfterCommandCycles: args.resetFirstFetchDelayAfterCommandCycles,
      commandNmiSampleCycle,
      commandNmiBoundaryDelayInstructions,
      ...(commandNmiDelayMatches.length === 0 && args.commandNmiDelayChipWriteBoundaryInstructions === undefined
        && commandNmiDelayCompletedChipWritePreemptions === undefined
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
      commandCycleOffsetCycles: frameCommandCycleOffsetCycles,
      ...(commandSubmitBeforeCpuCatchup ? { commandSubmitBeforeCpuCatchup } : {}),
      ...(commandPreemptChipWriteLookaheadCycles > 0
        ? { commandPreemptChipWriteLookaheadCycles }
        : {}),
      ...(commandPreemptChipWritePcSet === undefined
        ? {}
        : { commandPreemptChipWritePcs: commandPreemptChipWritePcSet }),
      ...(commandPreemptChipWriteCompleteBeforeTarget
        ? { commandPreemptChipWriteCompleteBeforeTarget: true }
        : {}),
      ...(commandPreemptChipWriteBeforeOnly ? { commandPreemptChipWriteBeforeOnly } : {}),
      onFrameAdvance: (event) => {
        const frameEvent = event as typeof event & { readonly inResetAfter?: boolean };
        frameAdvanceRows.push({
          frame: event.frame,
          frameStart: event.frameStart,
          frameEnd: event.frameEnd,
          frameCycles: event.frameCycles,
          cpuStart: event.cpuStart,
          cpuEnd: event.cpuEnd,
          cpuStartDelta: event.cpuStartDelta,
          cpuEndDelta: event.cpuEndDelta,
          commandCount: event.commandCount,
          releaseOnThisFrame: event.releaseOnThisFrame,
          inResetAfter: frameEvent.inResetAfter ?? false,
        });
      },
      onCommandSubmit: (event) => {
        const pendingBefore = chip.mainToSound.pending;
        const sourceIndex = (event as { readonly sourceIndex?: number }).sourceIndex;
        const preAdvance =
          ((event as unknown) as { readonly preAdvance?: CommandSubmitPreAdvanceContext }).preAdvance;
        const lastStep = ((event as unknown) as { readonly lastStep?: CommandSubmitStepContext }).lastStep;
        const mameCommand = sourceIndex === undefined ? undefined : commandEventsBySource.get(sourceIndex);
        const mameCommandRead = sourceIndex === undefined ? undefined : mameCommandReadsBySource.get(sourceIndex);
        const overrideSelection = commandNmiDelayOverrideSelectionForArgs(args, event);
        const overrideDelay = overrideSelection?.delayInstructions;
        const actualStateJson = commandSubmitActualStateToJson(event as unknown as {
          readonly actualSoundPc?: number;
          readonly actualSoundOpcode?: number;
          readonly actualSoundA?: number;
          readonly actualSoundX?: number;
          readonly actualSoundY?: number;
          readonly actualSoundP?: number;
          readonly actualSoundSp?: number;
        });
        const preAdvanceJson = commandSubmitPreAdvanceContextToJson(preAdvance);
        const lastStepJson = commandSubmitStepContextToJson(lastStep);
        const mameCommandInstJson = mameCommandInstContextToJson(mameCommand);
        const mameSoundCommandReadJson = mameSoundCommandReadContextToJson(mameCommandRead);
        commandSubmitRows.push({
          ...(sourceIndex === undefined ? {} : { sourceIndex }),
          frame: event.frame,
          byte: hexByte(event.byte),
          cycleInFrame: event.cycleInFrame,
          actualCycleInFrame: event.actualCycleInFrame,
          actualCycleDelta: event.actualCycleInFrame - event.cycleInFrame,
          pendingBefore,
          commandNmiDelayInstructions: event.commandNmiDelayInstructions,
          ...(overrideDelay === undefined ? {} : { overrideDelayInstructions: overrideDelay }),
          ...(actualStateJson === undefined ? {} : { actualState: actualStateJson }),
          ...(preAdvanceJson === undefined ? {} : { preAdvance: preAdvanceJson }),
          ...(lastStepJson === undefined ? {} : { lastStep: lastStepJson }),
          ...(mameCommandInstJson === undefined ? {} : { mameCommandInst: mameCommandInstJson }),
          ...(mameSoundCommandReadJson === undefined ? {} : { mameSoundCommandRead: mameSoundCommandReadJson }),
        });
        if (sourceIndex !== undefined) {
          commandSubmissions.set(sourceIndex, {
            actualCycle: event.actualCycle,
            actualCycleInFrame: event.actualCycleInFrame,
            pendingBefore,
            commandNmiDelayInstructions: event.commandNmiDelayInstructions,
            overrideDelayInstructions: overrideDelay,
            ...(actualStateJson === undefined ? {} : { actualState: actualStateJson }),
            ...(preAdvanceJson === undefined ? {} : { preAdvance: preAdvanceJson }),
            ...(lastStepJson === undefined ? {} : { lastStep: lastStepJson }),
            ...(mameCommandInstJson === undefined ? {} : { mameCommandInst: mameCommandInstJson }),
            ...(mameSoundCommandReadJson === undefined ? {} : { mameSoundCommandRead: mameSoundCommandReadJson }),
          });
        }
        commandSubmitDiagnostics.commandCount++;
        if (pendingBefore) commandSubmitDiagnostics.pendingBeforeCount++;
        const delayKey = String(event.commandNmiDelayInstructions);
        commandSubmitDiagnostics.nmiDelayHistogram[delayKey] =
          (commandSubmitDiagnostics.nmiDelayHistogram[delayKey] ?? 0) + 1;
        recordCommandNmiDelaySubmit(
          commandSubmitDiagnostics,
          {
            ...event,
            ...(preAdvance === undefined ? {} : { preAdvance }),
            ...(lastStep === undefined ? {} : { lastStep }),
            ...(mameCommand === undefined ? {} : { mameCommand }),
            ...(mameCommandRead === undefined ? {} : { mameCommandRead }),
          },
          pendingBefore,
          overrideDelay,
        );
        if (overrideDelay !== undefined) {
          commandSubmitDiagnostics.overrideMatchCount++;
          if (pendingBefore) commandSubmitDiagnostics.overridePendingBeforeCount++;
          if (overrideSelection !== undefined) {
            recordCommandNmiDelayOverrideSelector(
              commandSubmitDiagnostics,
              overrideSelection.selector,
              {
                ...event,
                ...(preAdvance === undefined ? {} : { preAdvance }),
                ...(lastStep === undefined ? {} : { lastStep }),
                ...(mameCommand === undefined ? {} : { mameCommand }),
                ...(mameCommandRead === undefined ? {} : { mameCommandRead }),
              },
              pendingBefore,
              overrideDelay,
            );
          }
          if (commandSubmitDiagnostics.overrideSamples.length < 32) {
            commandSubmitDiagnostics.overrideSamples.push({
              frame: event.frame,
              byte: `0x${event.byte.toString(16).padStart(2, "0")}`,
              cycleInFrame: event.cycleInFrame,
              actualCycleInFrame: event.actualCycleInFrame,
              pendingBefore,
              commandNmiDelayInstructions: event.commandNmiDelayInstructions,
              overrideDelayInstructions: overrideDelay,
              ...(preAdvanceJson === undefined ? {} : { preAdvance: preAdvanceJson }),
              ...(lastStepJson === undefined ? {} : { lastStep: lastStepJson }),
              ...(mameCommandInstJson === undefined ? {} : { mameCommandInst: mameCommandInstJson }),
              ...(mameSoundCommandReadJson === undefined ? {} : { mameSoundCommandRead: mameSoundCommandReadJson }),
            });
          }
        }
        const preempted = event.preemptedChipWrite;
        if (preempted === undefined) return;
        const pc = `0x${preempted.pc.toString(16).padStart(4, "0")}`;
        const existing = preemptedByPc.get(pc);
        if (existing === undefined) {
          preemptedByPc.set(pc, {
            count: 1,
            firstCommand: {
              frame: event.frame,
              cycle: event.cycle,
              address: `0x${preempted.address.toString(16).padStart(4, "0")}`,
              targetDeltaFromWrite: preempted.targetDeltaFromWrite,
            },
          });
        } else {
          existing.count++;
        }
      },
    } as ReplayOptions;
    tickFrameWithTape(chip, tape, f, replayOptions);
    const frameAdvance = frameAdvanceRows[frameAdvanceRows.length - 1];
    writes.push(...drainChipWriteEvents(chip).map((event) => normalizeTs(event, opcodeReader, args, frameAdvance)));
    commandReads.push(...drainSoundCommandReadEvents(chip));
    if (args.pokeyStreamCursorReport) {
      pokeyRawTransitions.push(...(drainPokeyDiagnosticRawTransitions(chip) ?? []));
    }
  }
  const byPc = Array.from(preemptedByPc.entries())
    .map(([pc, summary]) => ({ pc, count: summary.count, firstCommand: summary.firstCommand }))
    .sort((a, b) => b.count - a.count || a.pc.localeCompare(b.pc));
  return {
    writes,
    commandReads,
    cyclePreciseTape: tape.cyclePrecise,
    statusReplay,
    replyAckReplay,
    preemptedChipWrites: {
      commandCount: byPc.reduce((sum, entry) => sum + entry.count, 0),
      byPc,
    },
    commandSubmitDiagnostics: {
      ...commandSubmitDiagnostics,
      nmiDelayHistogram: Object.fromEntries(
        Object.entries(commandSubmitDiagnostics.nmiDelayHistogram)
          .sort((a, b) => Number(a[0]) - Number(b[0])),
      ),
    },
    commandSubmitRows,
    commandSubmissions,
    schedulerDrift: summarizeSchedulerDrift(frameAdvanceRows),
    pokeyRawTransitions,
  };
}

function fieldsDiffer(
  ts: NormalizedWrite | undefined,
  mame: NormalizedWrite | undefined,
  frameTolerance: number,
  cycleTolerance: number,
  sampleRate: number | undefined,
  sampleTolerance: number,
  samplePhaseCycles: number,
): string[] {
  if (ts === undefined || mame === undefined) return ["missing"];
  const fields: string[] = [];
  if (ts.reg !== mame.reg) fields.push("reg");
  if (ts.val !== mame.val) fields.push("val");
  if (ts.pc !== undefined && mame.pc !== undefined && ts.pc !== mame.pc) fields.push("pc");
  if (ts.replayCycle !== undefined && mame.replayCycle !== undefined) {
    if (Math.abs(ts.replayCycle - mame.replayCycle) > cycleTolerance) {
      fields.push("replayCycle");
    }
  } else {
    if (ts.frame !== undefined && mame.frame !== undefined &&
      Math.abs(ts.frame - mame.frame) > frameTolerance) fields.push("frame");
    if (ts.cycleInFrame !== undefined && mame.cycleInFrame !== undefined &&
      Math.abs(ts.cycleInFrame - mame.cycleInFrame) > cycleTolerance) {
      fields.push("cycleInFrame");
    }
  }
  if (sampleRate !== undefined && Number.isFinite(sampleRate) &&
    ts.replayCycle !== undefined && mame.replayCycle !== undefined) {
    const tsSample = nativeSampleIndex(ts.replayCycle, sampleRate, samplePhaseCycles);
    const mameSample = nativeSampleIndex(mame.replayCycle, sampleRate, samplePhaseCycles);
    if (Math.abs(tsSample - mameSample) > sampleTolerance) fields.push("nativeSample");
  }
  return fields;
}

function makeEmptyDeltaStats(): DiffResult["frameDelta"] {
  return {
    compared: 0,
    min: undefined,
    max: undefined,
    maxAbs: undefined,
    meanAbs: undefined,
  };
}

function addDelta(stats: DiffResult["frameDelta"], absDeltaSum: { value: number }, delta: number): void {
  const absDelta = Math.abs(delta);
  stats.compared++;
  stats.min = stats.min === undefined ? delta : Math.min(stats.min, delta);
  stats.max = stats.max === undefined ? delta : Math.max(stats.max, delta);
  stats.maxAbs = stats.maxAbs === undefined ? absDelta : Math.max(stats.maxAbs, absDelta);
  absDeltaSum.value += absDelta;
  stats.meanAbs = absDeltaSum.value / stats.compared;
}

function nativeSampleIndex(replayCycle: number, sampleRate: number, samplePhaseCycles: number): number {
  return Math.floor(((replayCycle + samplePhaseCycles) * sampleRate) / SOUND_CMD_TAPE_CPU_HZ);
}

function firstCycleForNativeSample(sampleIndex: number, sampleRate: number, samplePhaseCycles: number): number {
  return Math.ceil((sampleIndex * SOUND_CMD_TAPE_CPU_HZ / sampleRate) - samplePhaseCycles);
}

function boundaryDelayToNextSample(cycle: number, thresholdCycles: number, sampleRate: number): number {
  if (thresholdCycles <= 0) return 0;
  const rate = Math.max(1, sampleRate);
  const sample = Math.floor(cycle * rate / SOUND_CMD_TAPE_CPU_HZ);
  const nextStart = Math.ceil(((sample + 1) * SOUND_CMD_TAPE_CPU_HZ) / rate);
  const offsetToEnd = nextStart - cycle - 1;
  return offsetToEnd >= 0 && offsetToEnd < thresholdCycles ? nextStart - cycle : 0;
}

function nativeSamplePhaseFor(
  replayCycle: number | undefined,
  sampleRate: number | undefined,
  samplePhaseCycles: number,
): { offsetFromStart: number; offsetToEnd: number } | undefined {
  if (replayCycle === undefined || sampleRate === undefined || !Number.isFinite(sampleRate)) return undefined;
  const sample = nativeSampleIndex(replayCycle, sampleRate, samplePhaseCycles);
  const start = firstCycleForNativeSample(sample, sampleRate, samplePhaseCycles);
  const end = firstCycleForNativeSample(sample + 1, sampleRate, samplePhaseCycles) - 1;
  return {
    offsetFromStart: replayCycle - start,
    offsetToEnd: end - replayCycle,
  };
}

function delayPokeyEventsNearSampleBoundary(
  writes: readonly NormalizedWrite[],
  args: Args,
): { readonly writes: NormalizedWrite[]; readonly summary: PokeyEventBoundaryDelaySummary | undefined } {
  if (args.pokeyEventBoundaryDelayCycles <= 0) return { writes: [...writes], summary: undefined };
  if (args.sampleRate === undefined || !Number.isFinite(args.sampleRate)) {
    throw new Error("--pokey-event-boundary-delay-cycles requires --sample-rate");
  }
  const sampleRate = args.sampleRate;
  const byOffsetToEnd: Record<string, number> = {};
  let applied = 0;
  const delayed = writes.map((write) => {
    if (write.kind !== "pokey" || write.replayCycle === undefined || write.cycle === undefined) return write;
    const phase = nativeSamplePhaseFor(write.replayCycle, sampleRate, args.samplePhaseCycles);
    if (phase === undefined || phase.offsetToEnd >= args.pokeyEventBoundaryDelayCycles) return write;
    const targetCycle = firstCycleForNativeSample(
      nativeSampleIndex(write.replayCycle, sampleRate, args.samplePhaseCycles) + 1,
      sampleRate,
      args.samplePhaseCycles,
    );
    const deltaCycles = targetCycle - write.replayCycle;
    if (deltaCycles <= 0) return write;
    applied++;
    incrementHistogram(byOffsetToEnd, String(phase.offsetToEnd));
    return {
      ...write,
      cycle: write.cycle + deltaCycles,
      cycleInFrame: write.cycleInFrame === undefined ? undefined : write.cycleInFrame + deltaCycles,
      replayCycle: write.replayCycle + deltaCycles,
      writeCycleOffset: write.writeCycleOffset === undefined ? undefined : write.writeCycleOffset + deltaCycles,
      eventCycleAdjust: (write.eventCycleAdjust ?? 0) + deltaCycles,
    };
  });
  return {
    writes: delayed,
    summary: {
      thresholdCycles: args.pokeyEventBoundaryDelayCycles,
      applied,
      byOffsetToEnd: topHistogram(byOffsetToEnd),
    },
  };
}

function applyPokeyEffectiveApplyTiming(
  writes: readonly NormalizedWrite[],
  args: Args,
): { readonly writes: NormalizedWrite[]; readonly summary: PokeyEffectiveApplyTimingSummary | undefined } {
  if (!args.pokeyEffectiveApplyTiming) return { writes: [...writes], summary: undefined };
  const byTotalDelay: Record<string, number> = {};
  const byOpcodeDelay: Record<string, number> = {};
  const byBoundaryDelay: Record<string, number> = {};
  let applied = 0;
  let opcodeDelayCount = 0;
  let boundaryDelayCount = 0;
  const shifted = writes.map((write) => {
    if (write.kind !== "pokey" || write.replayCycle === undefined || write.cycle === undefined) return write;
    const opcodeDelay = write.opcode === undefined
      ? 0
      : (args.pokeyWriteApplyDelayOpcodes.get(write.opcode & 0xff) ?? 0);
    const boundaryCycle = write.replayCycle + args.pokeyWriteApplyDelayCycles + opcodeDelay;
    const boundaryDelay = boundaryDelayToNextSample(
      boundaryCycle,
      args.pokeyWriteApplyBoundaryDelayCycles,
      args.pokeyWriteApplyBoundaryDelaySampleRate,
    );
    const totalDelay = args.pokeyWriteApplyDelayCycles + opcodeDelay + boundaryDelay;
    incrementHistogram(byTotalDelay, String(totalDelay));
    if (opcodeDelay !== 0) {
      opcodeDelayCount++;
      incrementHistogram(byOpcodeDelay, String(opcodeDelay));
    }
    if (boundaryDelay !== 0) {
      boundaryDelayCount++;
      incrementHistogram(byBoundaryDelay, String(boundaryDelay));
    }
    if (totalDelay === 0) {
      return {
        ...write,
        pokeyEffectiveApplyDelayCycles: 0,
      };
    }
    applied++;
    return {
      ...write,
      cycle: write.cycle + totalDelay,
      cycleInFrame: write.cycleInFrame === undefined ? undefined : write.cycleInFrame + totalDelay,
      replayCycle: write.replayCycle + totalDelay,
      writeCycleOffset: write.writeCycleOffset === undefined ? undefined : write.writeCycleOffset + totalDelay,
      eventCycleAdjust: (write.eventCycleAdjust ?? 0) + totalDelay,
      pokeyEffectiveApplyDelayCycles: totalDelay,
    };
  });
  return {
    writes: shifted,
    summary: {
      enabled: true,
      applied,
      baseDelayCycles: args.pokeyWriteApplyDelayCycles,
      boundaryThresholdCycles: args.pokeyWriteApplyBoundaryDelayCycles,
      boundarySampleRate: args.pokeyWriteApplyBoundaryDelaySampleRate,
      opcodeDelayCount,
      boundaryDelayCount,
      byTotalDelay: topHistogram(byTotalDelay),
      byOpcodeDelay: topHistogram(byOpcodeDelay),
      byBoundaryDelay: topHistogram(byBoundaryDelay),
    },
  };
}

function nativeSampleDeltaFor(
  ts: NormalizedWrite | undefined,
  mame: NormalizedWrite | undefined,
  sampleRate: number | undefined,
  samplePhaseCycles: number,
): number | undefined {
  if (sampleRate === undefined || !Number.isFinite(sampleRate) ||
    ts?.replayCycle === undefined || mame?.replayCycle === undefined) {
    return undefined;
  }
  return nativeSampleIndex(ts.replayCycle, sampleRate, samplePhaseCycles) -
    nativeSampleIndex(mame.replayCycle, sampleRate, samplePhaseCycles);
}

function nativeSampleDeltaForTsCycleOffset(
  ts: NormalizedWrite | undefined,
  mame: NormalizedWrite | undefined,
  sampleRate: number | undefined,
  samplePhaseCycles: number,
  tsCycleOffset: number,
): number | undefined {
  if (sampleRate === undefined || !Number.isFinite(sampleRate) ||
    ts?.replayCycle === undefined || mame?.replayCycle === undefined) {
    return undefined;
  }
  return nativeSampleIndex(ts.replayCycle + tsCycleOffset, sampleRate, samplePhaseCycles) -
    nativeSampleIndex(mame.replayCycle, sampleRate, samplePhaseCycles);
}

function targetNativeSampleCycleOffsetFor(
  ts: NormalizedWrite | undefined,
  mame: NormalizedWrite | undefined,
  sampleRate: number | undefined,
  samplePhaseCycles: number,
  targetNativeSampleDelta: number | undefined,
): { offset: number; range: { min: number; max: number } } | undefined {
  if (sampleRate === undefined || !Number.isFinite(sampleRate) ||
    targetNativeSampleDelta === undefined || !Number.isFinite(targetNativeSampleDelta) ||
    ts?.replayCycle === undefined || mame?.replayCycle === undefined) {
    return undefined;
  }
  const targetDelta = Math.trunc(targetNativeSampleDelta);
  const mameSample = nativeSampleIndex(mame.replayCycle, sampleRate, samplePhaseCycles);
  const targetSample = mameSample + targetDelta;
  const minCycle = firstCycleForNativeSample(targetSample, sampleRate, samplePhaseCycles);
  const maxCycle = firstCycleForNativeSample(targetSample + 1, sampleRate, samplePhaseCycles) - 1;
  const minOffset = minCycle - ts.replayCycle;
  const maxOffset = maxCycle - ts.replayCycle;
  const offset = minOffset <= 0 && maxOffset >= 0
    ? 0
    : minOffset > 0
      ? minOffset
      : maxOffset;
  return { offset, range: { min: minOffset, max: maxOffset } };
}

type FrameDeltaReportAccumulator = FrameDeltaReportEntry & {
  replayCycleDeltaAbsSum: { value: number };
  replayCycleDeltaHistogramMutable: Record<string, number>;
  busReplayCycleDeltaAbsSum: { value: number };
  busReplayCycleDeltaHistogramMutable: Record<string, number>;
  nativeSampleDeltaAbsSum: { value: number };
  nativeSampleTargetCycleOffsetAbsSum: { value: number };
  replayCycleDeltaSegmentsMutable: FrameDeltaSegmentAccumulator[];
  currentReplayCycleDeltaSegment: FrameDeltaSegmentAccumulator | undefined;
};

type FrameDeltaSegmentAccumulator = FrameDeltaSegmentEntry;

function frameDeltaReportKey(ts: NormalizedWrite | undefined, mame: NormalizedWrite | undefined): string {
  if (ts?.frame !== undefined && mame?.frame !== undefined && ts.frame === mame.frame) return String(ts.frame);
  return `${ts?.frame ?? "?"}->${mame?.frame ?? "?"}`;
}

function writePcHistogramKey(ts: NormalizedWrite | undefined, mame: NormalizedWrite | undefined): string {
  const pc = ts?.pc ?? mame?.pc;
  return pc === undefined ? "?" : `0x${pc.toString(16).padStart(4, "0")}`;
}

function replayCycleDeltaFor(ts: NormalizedWrite | undefined, mame: NormalizedWrite | undefined): number | undefined {
  return ts?.replayCycle === undefined || mame?.replayCycle === undefined
    ? undefined
    : ts.replayCycle - mame.replayCycle;
}

function busReplayCycleDeltaFor(ts: NormalizedWrite | undefined, mame: NormalizedWrite | undefined): number | undefined {
  return ts?.busReplayCycle === undefined || mame?.busReplayCycle === undefined
    ? undefined
    : ts.busReplayCycle - mame.busReplayCycle;
}

function updateFrameDeltaReportSegment(
  entry: FrameDeltaReportAccumulator,
  index: number,
  ts: NormalizedWrite | undefined,
  mame: NormalizedWrite | undefined,
  fields: readonly string[],
  nativeSampleDelta: number | undefined,
  replayCycleDelta: number | undefined,
  busReplayCycleDelta: number | undefined,
): void {
  let segment = entry.currentReplayCycleDeltaSegment;
  if (segment === undefined ||
    segment.replayCycleDelta !== replayCycleDelta ||
    segment.busReplayCycleDelta !== busReplayCycleDelta) {
    segment = {
      startIndex: index,
      endIndex: index,
      compared: 0,
      mismatchCount: 0,
      nativeSampleNonExactCount: 0,
      replayCycleDelta,
      busReplayCycleDelta,
      nativeSampleDeltaHistogram: {},
      firstTs: ts,
      firstMame: mame,
    };
    entry.replayCycleDeltaSegmentsMutable.push(segment);
    entry.currentReplayCycleDeltaSegment = segment;
  }
  segment.endIndex = index;
  segment.compared++;
  if (fields.length > 0) segment.mismatchCount++;
  if (nativeSampleDelta !== undefined) {
    incrementHistogram(segment.nativeSampleDeltaHistogram, String(nativeSampleDelta));
    if (nativeSampleDelta !== 0) segment.nativeSampleNonExactCount++;
  }
}

function updateFrameDeltaReport(
  reports: Map<string, FrameDeltaReportAccumulator>,
  index: number,
  ts: NormalizedWrite | undefined,
  mame: NormalizedWrite | undefined,
  fields: readonly string[],
  nativeSampleDelta: number | undefined,
  nativeSampleTargetCycleOffset: number | undefined,
  commandContext: CommandContext | undefined,
  args: Args,
): void {
  if (!args.frameDeltaReport) return;
  const key = frameDeltaReportKey(ts, mame);
  let entry = reports.get(key);
  if (entry === undefined) {
    entry = {
      frame: key,
      compared: 0,
      mismatchCount: 0,
      nativeSampleNonExactCount: 0,
      firstIndex: index,
      firstMismatchIndex: undefined,
      firstNativeSampleNonExactIndex: undefined,
      replayCycleDelta: makeEmptyDeltaStats(),
      replayCycleDeltaAbsSum: { value: 0 },
      replayCycleDeltaHistogram: {},
      replayCycleDeltaHistogramMutable: {},
      busReplayCycleDelta: makeEmptyDeltaStats(),
      busReplayCycleDeltaAbsSum: { value: 0 },
      busReplayCycleDeltaHistogram: {},
      busReplayCycleDeltaHistogramMutable: {},
      nativeSampleDelta: {
        sampleRate: args.sampleRate,
        samplePhaseCycles: args.samplePhaseCycles,
        ...makeEmptyDeltaStats(),
      },
      nativeSampleDeltaAbsSum: { value: 0 },
      nativeSampleDeltaHistogram: {},
      nativeSampleTargetCycleOffset: {
        sampleRate: args.sampleRate,
        samplePhaseCycles: args.samplePhaseCycles,
        targetNativeSampleDelta: 0,
        ...makeEmptyDeltaStats(),
      },
      nativeSampleTargetCycleOffsetAbsSum: { value: 0 },
      nativeSampleTargetCycleOffsetHistogram: {},
      writePcHistogram: {},
      commandByteHistogram: {},
      replayCycleDeltaSegments: [],
      replayCycleDeltaSegmentsMutable: [],
      currentReplayCycleDeltaSegment: undefined,
      firstTs: ts,
      firstMame: mame,
      firstMismatchTs: undefined,
      firstMismatchMame: undefined,
    };
    reports.set(key, entry);
  }

  entry.compared++;
  if (fields.length > 0) {
    entry.mismatchCount++;
    entry.firstMismatchIndex ??= index;
    entry.firstMismatchTs ??= ts;
    entry.firstMismatchMame ??= mame;
  }
  const replayCycleDelta = replayCycleDeltaFor(ts, mame);
  const busReplayCycleDelta = busReplayCycleDeltaFor(ts, mame);
  if (replayCycleDelta !== undefined) {
    addDelta(entry.replayCycleDelta, entry.replayCycleDeltaAbsSum, replayCycleDelta);
    incrementHistogram(entry.replayCycleDeltaHistogramMutable, String(replayCycleDelta));
  }
  if (busReplayCycleDelta !== undefined) {
    addDelta(entry.busReplayCycleDelta, entry.busReplayCycleDeltaAbsSum, busReplayCycleDelta);
    incrementHistogram(entry.busReplayCycleDeltaHistogramMutable, String(busReplayCycleDelta));
  }
  if (nativeSampleDelta !== undefined) {
    addDelta(entry.nativeSampleDelta, entry.nativeSampleDeltaAbsSum, nativeSampleDelta);
    incrementHistogram(entry.nativeSampleDeltaHistogram, String(nativeSampleDelta));
    if (nativeSampleDelta !== 0) {
      entry.nativeSampleNonExactCount++;
      entry.firstNativeSampleNonExactIndex ??= index;
      if (nativeSampleTargetCycleOffset !== undefined) {
        addDelta(
          entry.nativeSampleTargetCycleOffset,
          entry.nativeSampleTargetCycleOffsetAbsSum,
          nativeSampleTargetCycleOffset,
        );
        incrementHistogram(entry.nativeSampleTargetCycleOffsetHistogram, String(nativeSampleTargetCycleOffset));
      }
      const commandByte = commandContext?.nearest?.byte ?? commandContext?.previous?.byte ?? commandContext?.next?.byte;
      incrementHistogram(
        entry.commandByteHistogram,
        commandByte === undefined ? "?" : `0x${commandByte.toString(16).padStart(2, "0")}`,
      );
    }
  }
  incrementHistogram(entry.writePcHistogram, writePcHistogramKey(ts, mame));
  updateFrameDeltaReportSegment(
    entry,
    index,
    ts,
    mame,
    fields,
    nativeSampleDelta,
    replayCycleDelta,
    busReplayCycleDelta,
  );
}

function finalizedFrameDeltaReport(
  reports: Map<string, FrameDeltaReportAccumulator>,
  args: Args,
): FrameDeltaReportEntry[] {
  return Array.from(reports.values())
    .sort((a, b) =>
      b.nativeSampleNonExactCount - a.nativeSampleNonExactCount ||
      b.mismatchCount - a.mismatchCount ||
      (b.replayCycleDelta.maxAbs ?? -1) - (a.replayCycleDelta.maxAbs ?? -1) ||
      a.firstIndex - b.firstIndex ||
      a.frame.localeCompare(b.frame))
    .slice(0, args.frameDeltaReportLimit)
    .map((entry) => ({
      frame: entry.frame,
      compared: entry.compared,
      mismatchCount: entry.mismatchCount,
      nativeSampleNonExactCount: entry.nativeSampleNonExactCount,
      firstIndex: entry.firstIndex,
      firstMismatchIndex: entry.firstMismatchIndex,
      firstNativeSampleNonExactIndex: entry.firstNativeSampleNonExactIndex,
      replayCycleDelta: entry.replayCycleDelta,
      replayCycleDeltaHistogram: topHistogram(entry.replayCycleDeltaHistogramMutable),
      busReplayCycleDelta: entry.busReplayCycleDelta,
      busReplayCycleDeltaHistogram: topHistogram(entry.busReplayCycleDeltaHistogramMutable),
      nativeSampleDelta: entry.nativeSampleDelta,
      nativeSampleDeltaHistogram: sortedNumericHistogram(entry.nativeSampleDeltaHistogram),
      nativeSampleTargetCycleOffset: entry.nativeSampleTargetCycleOffset,
      nativeSampleTargetCycleOffsetHistogram: topHistogram(entry.nativeSampleTargetCycleOffsetHistogram),
      writePcHistogram: topHistogram(entry.writePcHistogram),
      commandByteHistogram: topHistogram(entry.commandByteHistogram),
      replayCycleDeltaSegments: entry.replayCycleDeltaSegmentsMutable
        .slice(0, 24)
        .map((segment) => ({
          ...segment,
          nativeSampleDeltaHistogram: sortedNumericHistogram(segment.nativeSampleDeltaHistogram),
        })),
      firstTs: entry.firstTs,
      firstMame: entry.firstMame,
      firstMismatchTs: entry.firstMismatchTs,
      firstMismatchMame: entry.firstMismatchMame,
    }));
}

interface FrameOffsetSweepEvent {
  readonly index: number;
  readonly tsReplayCycle: number;
  readonly mameReplayCycle: number;
  readonly baselineNativeSampleDelta: number;
}

interface FrameOffsetSweepAccumulator {
  readonly frame: string;
  readonly firstIndex: number;
  readonly firstTs: NormalizedWrite | undefined;
  readonly firstMame: NormalizedWrite | undefined;
  readonly events: FrameOffsetSweepEvent[];
}

function updateFrameOffsetSweep(
  frames: Map<string, FrameOffsetSweepAccumulator>,
  index: number,
  ts: NormalizedWrite | undefined,
  mame: NormalizedWrite | undefined,
  nativeSampleDelta: number | undefined,
  args: Args,
): void {
  if (args.frameOffsetSweepCycles === undefined ||
    args.sampleRate === undefined ||
    !Number.isFinite(args.sampleRate) ||
    ts?.replayCycle === undefined ||
    mame?.replayCycle === undefined ||
    nativeSampleDelta === undefined) {
    return;
  }
  const key = frameDeltaReportKey(ts, mame);
  let entry = frames.get(key);
  if (entry === undefined) {
    entry = {
      frame: key,
      firstIndex: index,
      firstTs: ts,
      firstMame: mame,
      events: [],
    };
    frames.set(key, entry);
  }
  entry.events.push({
    index,
    tsReplayCycle: ts.replayCycle,
    mameReplayCycle: mame.replayCycle,
    baselineNativeSampleDelta: nativeSampleDelta,
  });
}

function nativeSampleDeltaForReplayCycles(
  tsReplayCycle: number,
  mameReplayCycle: number,
  tsCycleOffset: number,
  sampleRate: number,
  samplePhaseCycles: number,
): number {
  return nativeSampleIndex(tsReplayCycle + tsCycleOffset, sampleRate, samplePhaseCycles) -
    nativeSampleIndex(mameReplayCycle, sampleRate, samplePhaseCycles);
}

function finalizedFrameOffsetSweep(
  frames: Map<string, FrameOffsetSweepAccumulator>,
  args: Args,
): FrameOffsetSweepSummary | undefined {
  if (args.frameOffsetSweepCycles === undefined ||
    args.sampleRate === undefined ||
    !Number.isFinite(args.sampleRate)) {
    return undefined;
  }

  const baselineNativeSampleDelta = {
    sampleRate: args.sampleRate,
    samplePhaseCycles: args.samplePhaseCycles,
    ...makeEmptyDeltaStats(),
  };
  const bestNativeSampleDelta = {
    sampleRate: args.sampleRate,
    samplePhaseCycles: args.samplePhaseCycles,
    ...makeEmptyDeltaStats(),
  };
  const baselineNativeSampleDeltaAbsSum = { value: 0 };
  const bestNativeSampleDeltaAbsSum = { value: 0 };
  const baselineNativeSampleDeltaHistogram: Record<string, number> = {};
  const bestNativeSampleDeltaHistogram: Record<string, number> = {};
  const bestOffsetHistogram: Record<string, number> = {};
  const frameEntries: FrameOffsetSweepFrameEntry[] = [];
  let compared = 0;
  let baselineMismatchCount = 0;
  let bestMismatchCount = 0;
  let exactFrameCount = 0;

  for (const frame of frames.values()) {
    let frameBaselineMismatchCount = 0;
    const frameBaselineHistogram: Record<string, number> = {};
    for (const event of frame.events) {
      compared++;
      addDelta(baselineNativeSampleDelta, baselineNativeSampleDeltaAbsSum, event.baselineNativeSampleDelta);
      incrementHistogram(baselineNativeSampleDeltaHistogram, String(event.baselineNativeSampleDelta));
      incrementHistogram(frameBaselineHistogram, String(event.baselineNativeSampleDelta));
      if (Math.abs(event.baselineNativeSampleDelta) > args.sampleTolerance) {
        baselineMismatchCount++;
        frameBaselineMismatchCount++;
      }
    }

    let bestOffsetCycles = args.frameOffsetSweepCycles[0] ?? 0;
    let bestFrameMismatchCount = Number.POSITIVE_INFINITY;
    let bestFrameMeanAbs = Number.POSITIVE_INFINITY;
    let bestFrameAbsOffset = Number.POSITIVE_INFINITY;
    let bestFrameHistogram: Record<string, number> = {};
    for (const offsetCycles of args.frameOffsetSweepCycles) {
      let offsetMismatchCount = 0;
      let offsetAbsSum = 0;
      const offsetHistogram: Record<string, number> = {};
      for (const event of frame.events) {
        const delta = nativeSampleDeltaForReplayCycles(
          event.tsReplayCycle,
          event.mameReplayCycle,
          offsetCycles,
          args.sampleRate,
          args.samplePhaseCycles,
        );
        offsetAbsSum += Math.abs(delta);
        incrementHistogram(offsetHistogram, String(delta));
        if (Math.abs(delta) > args.sampleTolerance) offsetMismatchCount++;
      }
      const offsetMeanAbs = frame.events.length === 0 ? 0 : offsetAbsSum / frame.events.length;
      const offsetAbs = Math.abs(offsetCycles);
      if (offsetMismatchCount < bestFrameMismatchCount ||
        (offsetMismatchCount === bestFrameMismatchCount && offsetMeanAbs < bestFrameMeanAbs) ||
        (offsetMismatchCount === bestFrameMismatchCount && offsetMeanAbs === bestFrameMeanAbs &&
          offsetAbs < bestFrameAbsOffset) ||
        (offsetMismatchCount === bestFrameMismatchCount && offsetMeanAbs === bestFrameMeanAbs &&
          offsetAbs === bestFrameAbsOffset && offsetCycles < bestOffsetCycles)) {
        bestOffsetCycles = offsetCycles;
        bestFrameMismatchCount = offsetMismatchCount;
        bestFrameMeanAbs = offsetMeanAbs;
        bestFrameAbsOffset = offsetAbs;
        bestFrameHistogram = offsetHistogram;
      }
    }

    bestMismatchCount += bestFrameMismatchCount;
    if (bestFrameMismatchCount === 0) exactFrameCount++;
    incrementHistogram(bestOffsetHistogram, String(bestOffsetCycles));
    for (const event of frame.events) {
      const delta = nativeSampleDeltaForReplayCycles(
        event.tsReplayCycle,
        event.mameReplayCycle,
        bestOffsetCycles,
        args.sampleRate,
        args.samplePhaseCycles,
      );
      addDelta(bestNativeSampleDelta, bestNativeSampleDeltaAbsSum, delta);
      incrementHistogram(bestNativeSampleDeltaHistogram, String(delta));
    }
    frameEntries.push({
      frame: frame.frame,
      compared: frame.events.length,
      baselineMismatchCount: frameBaselineMismatchCount,
      bestMismatchCount: bestFrameMismatchCount,
      bestOffsetCycles,
      firstIndex: frame.firstIndex,
      baselineNativeSampleDeltaHistogram: sortedNumericHistogram(frameBaselineHistogram),
      bestNativeSampleDeltaHistogram: sortedNumericHistogram(bestFrameHistogram),
      firstTs: frame.firstTs,
      firstMame: frame.firstMame,
    });
  }

  return {
    offsetCycles: args.frameOffsetSweepCycles,
    sampleRate: args.sampleRate,
    samplePhaseCycles: args.samplePhaseCycles,
    sampleTolerance: args.sampleTolerance,
    comparedFrames: frames.size,
    exactFrameCount,
    compared,
    baselineMismatchCount,
    bestMismatchCount,
    improvementCount: baselineMismatchCount - bestMismatchCount,
    bestOffsetHistogram: topHistogram(bestOffsetHistogram),
    baselineNativeSampleDelta,
    bestNativeSampleDelta,
    baselineNativeSampleDeltaHistogram: sortedNumericHistogram(baselineNativeSampleDeltaHistogram),
    bestNativeSampleDeltaHistogram: sortedNumericHistogram(bestNativeSampleDeltaHistogram),
    frames: frameEntries
      .sort((a, b) =>
        b.bestMismatchCount - a.bestMismatchCount ||
        (b.baselineMismatchCount - b.bestMismatchCount) - (a.baselineMismatchCount - a.bestMismatchCount) ||
        b.baselineMismatchCount - a.baselineMismatchCount ||
        a.firstIndex - b.firstIndex ||
        a.frame.localeCompare(b.frame))
      .slice(0, args.frameOffsetSweepReportLimit),
  };
}

const POKEY_BOUNDARY_GUARD_SWEEP_GUARDS: readonly PokeyBoundaryGuardSweepGuard[] = [
  "all",
  "baseline-delta-lt0",
  "baseline-delta-lte0",
  "target-offset-gte0",
  "target-offset-gte-delay",
];

type PokeyBoundaryGuardSweepAccumulator = PokeyBoundaryGuardSweepEntry & {
  nativeSampleDeltaAbsSum: { value: number };
};

function makePokeyBoundaryGuardSweepAccumulator(
  thresholdCycles: number,
  guard: PokeyBoundaryGuardSweepGuard,
  args: Args,
): PokeyBoundaryGuardSweepAccumulator {
  return {
    thresholdCycles,
    guard,
    compared: 0,
    applied: 0,
    baselineMismatchCount: 0,
    mismatchCount: 0,
    improvementCount: 0,
    nativeSampleDelta: {
      sampleRate: args.sampleRate,
      samplePhaseCycles: args.samplePhaseCycles,
      ...makeEmptyDeltaStats(),
    },
    nativeSampleDeltaAbsSum: { value: 0 },
    nativeSampleDeltaHistogram: {},
    appliedBoundaryDelayHistogram: {},
    firstMismatch: undefined,
  };
}

function pokeyBoundaryGuardAllows(
  guard: PokeyBoundaryGuardSweepGuard,
  baselineNativeSampleDelta: number,
  targetCycleOffset: number | undefined,
  totalDelayCycles: number,
): boolean {
  switch (guard) {
    case "all":
      return true;
    case "baseline-delta-lt0":
      return baselineNativeSampleDelta < 0;
    case "baseline-delta-lte0":
      return baselineNativeSampleDelta <= 0;
    case "target-offset-gte0":
      return targetCycleOffset !== undefined && targetCycleOffset >= 0;
    case "target-offset-gte-delay":
      return targetCycleOffset !== undefined && targetCycleOffset >= totalDelayCycles;
  }
}

function computePokeyBoundaryGuardSweep(
  kind: Kind,
  ts: readonly NormalizedWrite[],
  mame: readonly NormalizedWrite[],
  compared: number,
  args: Args,
): PokeyBoundaryGuardSweepEntry[] | undefined {
  if (kind !== "pokey" ||
    args.pokeyBoundaryGuardSweepCycles === undefined ||
    args.sampleRate === undefined ||
    !Number.isFinite(args.sampleRate)) {
    return undefined;
  }

  const opcodeDelayFor = (opcode: number | undefined): number =>
    opcode === undefined ? 0 : (args.pokeyWriteApplyDelayOpcodes.get(opcode & 0xff) ?? 0);
  const entries: PokeyBoundaryGuardSweepAccumulator[] = [];
  for (const thresholdCycles of args.pokeyBoundaryGuardSweepCycles) {
    for (const guard of POKEY_BOUNDARY_GUARD_SWEEP_GUARDS) {
      entries.push(makePokeyBoundaryGuardSweepAccumulator(thresholdCycles, guard, args));
    }
  }

  for (let index = 0; index < compared; index++) {
    const tsi = ts[index];
    const mamei = mame[index];
    if (tsi?.replayCycle === undefined || mamei?.replayCycle === undefined) continue;
    const baselineNativeSampleDelta = nativeSampleDeltaForReplayCycles(
      tsi.replayCycle,
      mamei.replayCycle,
      0,
      args.sampleRate,
      args.samplePhaseCycles,
    );
    const targetCycleOffset = targetNativeSampleCycleOffsetFor(
      tsi,
      mamei,
      args.sampleRate,
      args.samplePhaseCycles,
      0,
    )?.offset;
    const opcodeDelay = opcodeDelayFor(tsi.opcode);

    for (const entry of entries) {
      const boundaryCycle = tsi.replayCycle + args.pokeyWriteApplyDelayCycles + opcodeDelay;
      const boundaryDelay = boundaryDelayToNextSample(
        boundaryCycle,
        entry.thresholdCycles,
        args.pokeyWriteApplyBoundaryDelaySampleRate,
      );
      const totalDelay = args.pokeyWriteApplyDelayCycles + opcodeDelay + boundaryDelay;
      const shouldApply = totalDelay !== 0 &&
        pokeyBoundaryGuardAllows(entry.guard, baselineNativeSampleDelta, targetCycleOffset, totalDelay);
      const appliedDelay = shouldApply ? totalDelay : 0;
      const nativeSampleDelta = nativeSampleDeltaForReplayCycles(
        tsi.replayCycle,
        mamei.replayCycle,
        appliedDelay,
        args.sampleRate,
        args.samplePhaseCycles,
      );
      entry.compared++;
      if (Math.abs(baselineNativeSampleDelta) > args.sampleTolerance) entry.baselineMismatchCount++;
      addDelta(entry.nativeSampleDelta, entry.nativeSampleDeltaAbsSum, nativeSampleDelta);
      incrementHistogram(entry.nativeSampleDeltaHistogram, String(nativeSampleDelta));
      if (shouldApply) {
        entry.applied++;
        incrementHistogram(entry.appliedBoundaryDelayHistogram, String(boundaryDelay));
      }
      if (Math.abs(nativeSampleDelta) > args.sampleTolerance) {
        entry.mismatchCount++;
        entry.firstMismatch ??= {
          index,
          nativeSampleDelta,
          baselineNativeSampleDelta,
          boundaryDelayCycles: boundaryDelay,
          totalDelayCycles: totalDelay,
          targetCycleOffset,
          tsPhaseBefore: nativeSamplePhaseFor(tsi.replayCycle, args.sampleRate, args.samplePhaseCycles),
          tsPhaseAfter: nativeSamplePhaseFor(tsi.replayCycle + appliedDelay, args.sampleRate, args.samplePhaseCycles),
          ts: tsi,
          mame: mamei,
        };
      }
    }
  }

  return entries
    .map((entry) => ({
      thresholdCycles: entry.thresholdCycles,
      guard: entry.guard,
      compared: entry.compared,
      applied: entry.applied,
      baselineMismatchCount: entry.baselineMismatchCount,
      mismatchCount: entry.mismatchCount,
      improvementCount: entry.baselineMismatchCount - entry.mismatchCount,
      nativeSampleDelta: entry.nativeSampleDelta,
      nativeSampleDeltaHistogram: sortedNumericHistogram(entry.nativeSampleDeltaHistogram),
      appliedBoundaryDelayHistogram: sortedNumericHistogram(entry.appliedBoundaryDelayHistogram),
      firstMismatch: entry.firstMismatch,
    }))
    .sort((a, b) =>
      a.mismatchCount - b.mismatchCount ||
      b.applied - a.applied ||
      a.thresholdCycles - b.thresholdCycles ||
      a.guard.localeCompare(b.guard));
}

type PokeyBoundaryCandidateBucketAccumulator = PokeyBoundaryCandidateBucket;

function updatePokeyBoundaryCandidateBucket(
  buckets: Map<string, PokeyBoundaryCandidateBucketAccumulator>,
  key: string,
  index: number,
  baselineNativeSampleDelta: number,
  boundaryDelayCycles: number,
  ts: NormalizedWrite | undefined,
  mame: NormalizedWrite | undefined,
  args: Args,
): void {
  let bucket = buckets.get(key);
  if (bucket === undefined) {
    bucket = {
      key,
      compared: 0,
      earlyCount: 0,
      exactCount: 0,
      lateCount: 0,
      baselineMismatchCount: 0,
      baselineNativeSampleDeltaHistogram: {},
      first: undefined,
    };
    buckets.set(key, bucket);
  }
  bucket.compared++;
  if (baselineNativeSampleDelta < 0) bucket.earlyCount++;
  else if (baselineNativeSampleDelta > 0) bucket.lateCount++;
  else bucket.exactCount++;
  if (Math.abs(baselineNativeSampleDelta) > args.sampleTolerance) bucket.baselineMismatchCount++;
  incrementHistogram(bucket.baselineNativeSampleDeltaHistogram, String(baselineNativeSampleDelta));
  bucket.first ??= {
    index,
    baselineNativeSampleDelta,
    boundaryDelayCycles,
    ts,
    mame,
  };
}

function finalizedPokeyBoundaryCandidateBuckets(
  buckets: Map<string, PokeyBoundaryCandidateBucketAccumulator>,
  limit = 16,
): PokeyBoundaryCandidateBucket[] {
  return Array.from(buckets.values())
    .sort((a, b) =>
      b.earlyCount - a.earlyCount ||
      a.exactCount - b.exactCount ||
      a.lateCount - b.lateCount ||
      b.baselineMismatchCount - a.baselineMismatchCount ||
      b.compared - a.compared ||
      a.key.localeCompare(b.key))
    .slice(0, limit)
    .map((bucket) => ({
      ...bucket,
      baselineNativeSampleDeltaHistogram: sortedNumericHistogram(bucket.baselineNativeSampleDeltaHistogram),
    }));
}

function pokeyWriteEffectClass(reg: number, val: number, previousVal: number): string {
  const idx = reg & 0x0f;
  if (idx < 0x08) return (idx & 1) === 0 ? "audf-frequency" : "audc-raw";
  if (idx === 0x08) return previousVal === (val & 0xff) ? "audctl-same" : "audctl-raw";
  if (idx === 0x09) return "stimer-raw";
  if (idx === 0x0f) return previousVal === (val & 0xff) ? "skctl-same" : "skctl-raw";
  if (idx === 0x0a) return "skrest";
  if (idx === 0x0b) return "potgo";
  if (idx === 0x0d) return "serout";
  if (idx === 0x0e) return "irqen";
  return "other";
}

function computePokeyBoundaryCandidateReport(
  kind: Kind,
  ts: readonly NormalizedWrite[],
  mame: readonly NormalizedWrite[],
  compared: number,
  args: Args,
): PokeyBoundaryCandidateReport | undefined {
  if (kind !== "pokey" ||
    args.pokeyBoundaryCandidateReportCycles === undefined ||
    args.sampleRate === undefined ||
    !Number.isFinite(args.sampleRate)) {
    return undefined;
  }

  const byBoundaryDelay = new Map<string, PokeyBoundaryCandidateBucketAccumulator>();
  const byTsOffsetToEnd = new Map<string, PokeyBoundaryCandidateBucketAccumulator>();
  const byWriteRegister = new Map<string, PokeyBoundaryCandidateBucketAccumulator>();
  const byWriteEffect = new Map<string, PokeyBoundaryCandidateBucketAccumulator>();
  const byWriteEffectBoundaryDelay = new Map<string, PokeyBoundaryCandidateBucketAccumulator>();
  const byWritePc = new Map<string, PokeyBoundaryCandidateBucketAccumulator>();
  const byWritePcReg = new Map<string, PokeyBoundaryCandidateBucketAccumulator>();
  const byWritePcRegVal = new Map<string, PokeyBoundaryCandidateBucketAccumulator>();
  const byWriteCycleOffset = new Map<string, PokeyBoundaryCandidateBucketAccumulator>();
  const bySchedulerFrameStartDelta = new Map<string, PokeyBoundaryCandidateBucketAccumulator>();
  const byCommandEdgeRule = new Map<string, PokeyBoundaryCandidateBucketAccumulator>();
  const baselineNativeSampleDeltaHistogram: Record<string, number> = {};
  const opcodeDelayFor = (opcode: number | undefined): number =>
    opcode === undefined ? 0 : (args.pokeyWriteApplyDelayOpcodes.get(opcode & 0xff) ?? 0);
  const pokeyWriteRegs = new Uint8Array(16);
  let candidateCount = 0;
  let earlyCount = 0;
  let exactCount = 0;
  let lateCount = 0;
  let baselineMismatchCount = 0;

  const update = (
    buckets: Map<string, PokeyBoundaryCandidateBucketAccumulator>,
    key: string,
    index: number,
    baselineNativeSampleDelta: number,
    boundaryDelay: number,
    tsi: NormalizedWrite,
    mamei: NormalizedWrite,
  ): void => updatePokeyBoundaryCandidateBucket(
    buckets,
    key,
    index,
    baselineNativeSampleDelta,
    boundaryDelay,
    tsi,
    mamei,
    args,
  );

  for (let index = 0; index < compared; index++) {
    const tsi = ts[index];
    const mamei = mame[index];
    if (tsi?.replayCycle === undefined || mamei?.replayCycle === undefined) {
      if (tsi !== undefined) pokeyWriteRegs[tsi.reg & 0x0f] = tsi.val & 0xff;
      continue;
    }
    const reg = tsi.reg & 0x0f;
    const previousVal = pokeyWriteRegs[reg] ?? 0;
    const writeEffect = pokeyWriteEffectClass(reg, tsi.val, previousVal);
    pokeyWriteRegs[reg] = tsi.val & 0xff;
    const boundaryCycle = tsi.replayCycle + args.pokeyWriteApplyDelayCycles + opcodeDelayFor(tsi.opcode);
    const boundaryDelay = boundaryDelayToNextSample(
      boundaryCycle,
      args.pokeyBoundaryCandidateReportCycles,
      args.pokeyWriteApplyBoundaryDelaySampleRate,
    );
    if (boundaryDelay <= 0) continue;

    const baselineNativeSampleDelta = nativeSampleDeltaForReplayCycles(
      tsi.replayCycle,
      mamei.replayCycle,
      0,
      args.sampleRate,
      args.samplePhaseCycles,
    );
    const phase = nativeSamplePhaseFor(boundaryCycle, args.sampleRate, args.samplePhaseCycles);
    candidateCount++;
    if (baselineNativeSampleDelta < 0) earlyCount++;
    else if (baselineNativeSampleDelta > 0) lateCount++;
    else exactCount++;
    if (Math.abs(baselineNativeSampleDelta) > args.sampleTolerance) baselineMismatchCount++;
    incrementHistogram(baselineNativeSampleDeltaHistogram, String(baselineNativeSampleDelta));

    update(byBoundaryDelay, String(boundaryDelay), index, baselineNativeSampleDelta, boundaryDelay, tsi, mamei);
    update(byWriteRegister, hexByte(reg), index, baselineNativeSampleDelta, boundaryDelay, tsi, mamei);
    update(byWriteEffect, writeEffect, index, baselineNativeSampleDelta, boundaryDelay, tsi, mamei);
    update(
      byWriteEffectBoundaryDelay,
      `${writeEffect}@${boundaryDelay}`,
      index,
      baselineNativeSampleDelta,
      boundaryDelay,
      tsi,
      mamei,
    );
    update(
      byTsOffsetToEnd,
      phase === undefined ? "?" : String(phase.offsetToEnd),
      index,
      baselineNativeSampleDelta,
      boundaryDelay,
      tsi,
      mamei,
    );
    update(byWritePc, hexWord(tsi.pc), index, baselineNativeSampleDelta, boundaryDelay, tsi, mamei);
    update(
      byWritePcReg,
      `${hexWord(tsi.pc)}:${hexByte(tsi.reg)}`,
      index,
      baselineNativeSampleDelta,
      boundaryDelay,
      tsi,
      mamei,
    );
    update(
      byWritePcRegVal,
      `${hexWord(tsi.pc)}:${hexByte(tsi.reg)}:${hexByte(tsi.val)}`,
      index,
      baselineNativeSampleDelta,
      boundaryDelay,
      tsi,
      mamei,
    );
    update(
      byWriteCycleOffset,
      numericKey(tsi.writeCycleOffset),
      index,
      baselineNativeSampleDelta,
      boundaryDelay,
      tsi,
      mamei,
    );
    update(
      bySchedulerFrameStartDelta,
      numericKey(tsi.schedulerFrameStartDelta),
      index,
      baselineNativeSampleDelta,
      boundaryDelay,
      tsi,
      mamei,
    );
    update(
      byCommandEdgeRule,
      tsi.commandEdgeEventAdjust === undefined ? "none" : String(tsi.commandEdgeEventAdjust.ruleIndex),
      index,
      baselineNativeSampleDelta,
      boundaryDelay,
      tsi,
      mamei,
    );
  }

  return {
    thresholdCycles: args.pokeyBoundaryCandidateReportCycles,
    sampleRate: args.sampleRate,
    samplePhaseCycles: args.samplePhaseCycles,
    compared,
    candidateCount,
    earlyCount,
    exactCount,
    lateCount,
    baselineMismatchCount,
    baselineNativeSampleDeltaHistogram: sortedNumericHistogram(baselineNativeSampleDeltaHistogram),
    byBoundaryDelay: finalizedPokeyBoundaryCandidateBuckets(byBoundaryDelay),
    byTsOffsetToEnd: finalizedPokeyBoundaryCandidateBuckets(byTsOffsetToEnd),
    byWriteRegister: finalizedPokeyBoundaryCandidateBuckets(byWriteRegister),
    byWriteEffect: finalizedPokeyBoundaryCandidateBuckets(byWriteEffect),
    byWriteEffectBoundaryDelay: finalizedPokeyBoundaryCandidateBuckets(byWriteEffectBoundaryDelay),
    byWritePc: finalizedPokeyBoundaryCandidateBuckets(byWritePc),
    byWritePcReg: finalizedPokeyBoundaryCandidateBuckets(byWritePcReg),
    byWritePcRegVal: finalizedPokeyBoundaryCandidateBuckets(byWritePcRegVal),
    byWriteCycleOffset: finalizedPokeyBoundaryCandidateBuckets(byWriteCycleOffset),
    bySchedulerFrameStartDelta: finalizedPokeyBoundaryCandidateBuckets(bySchedulerFrameStartDelta),
    byCommandEdgeRule: finalizedPokeyBoundaryCandidateBuckets(byCommandEdgeRule),
  };
}

type PokeyStreamCursorBucketAccumulator = PokeyStreamCursorBucket;

function updatePokeyStreamCursorBucket(
  buckets: Map<string, PokeyStreamCursorBucketAccumulator>,
  key: string,
  nativeSampleDelta: number,
  args: Args,
): void {
  let bucket = buckets.get(key);
  if (bucket === undefined) {
    bucket = {
      key,
      compared: 0,
      earlyCount: 0,
      exactCount: 0,
      lateCount: 0,
      baselineMismatchCount: 0,
      nativeSampleDeltaHistogram: {},
    };
    buckets.set(key, bucket);
  }
  bucket.compared++;
  if (nativeSampleDelta < 0) bucket.earlyCount++;
  else if (nativeSampleDelta > 0) bucket.lateCount++;
  else bucket.exactCount++;
  if (Math.abs(nativeSampleDelta) > args.sampleTolerance) bucket.baselineMismatchCount++;
  incrementHistogram(bucket.nativeSampleDeltaHistogram, String(nativeSampleDelta));
}

function finalizedPokeyStreamCursorBuckets(
  buckets: Map<string, PokeyStreamCursorBucketAccumulator>,
  limit = 16,
): PokeyStreamCursorBucket[] {
  return Array.from(buckets.values())
    .sort((a, b) =>
      b.earlyCount - a.earlyCount ||
      a.exactCount - b.exactCount ||
      a.lateCount - b.lateCount ||
      b.baselineMismatchCount - a.baselineMismatchCount ||
      b.compared - a.compared ||
      a.key.localeCompare(b.key))
    .slice(0, limit)
    .map((bucket) => ({
      ...bucket,
      nativeSampleDeltaHistogram: sortedNumericHistogram(bucket.nativeSampleDeltaHistogram),
    }));
}

function signedBucket(value: number | undefined): string {
  if (value === undefined) return "?";
  if (value < -256) return "<-256";
  if (value > 256) return ">256";
  return String(value);
}

function boolBucket(value: boolean | undefined): string {
  return value === undefined ? "?" : value ? "yes" : "no";
}

function computePokeyStreamCursorReport(
  kind: Kind,
  ts: readonly NormalizedWrite[],
  mame: readonly NormalizedWrite[],
  compared: number,
  rawTransitions: readonly PokeyRawTransition[],
  args: Args,
): PokeyStreamCursorReport | undefined {
  if (kind !== "pokey" ||
    !args.pokeyStreamCursorReport ||
    args.sampleRate === undefined ||
    !Number.isFinite(args.sampleRate)) {
    return undefined;
  }
  const transitionCycles = rawTransitions.map((transition) => transition.cycle);
  const byPreviousTransitionDelta = new Map<string, PokeyStreamCursorBucketAccumulator>();
  const byNextTransitionDelta = new Map<string, PokeyStreamCursorBucketAccumulator>();
  const byTransitionWindow = new Map<string, PokeyStreamCursorBucketAccumulator>();
  const bySameSampleTransition = new Map<string, PokeyStreamCursorBucketAccumulator>();
  const byNextTransitionSampleDelta = new Map<string, PokeyStreamCursorBucketAccumulator>();
  const nativeSampleDeltaHistogram: Record<string, number> = {};
  let total = 0;
  let earlyCount = 0;
  let exactCount = 0;
  let lateCount = 0;

  for (let index = 0; index < compared; index++) {
    const tsi = ts[index];
    const mamei = mame[index];
    if (tsi?.replayCycle === undefined || mamei?.replayCycle === undefined) continue;
    const nativeSampleDelta = nativeSampleDeltaForReplayCycles(
      tsi.replayCycle,
      mamei.replayCycle,
      0,
      args.sampleRate,
      args.samplePhaseCycles,
    );
    const insert = lowerBound(transitionCycles, tsi.replayCycle);
    const previous = insert > 0 ? rawTransitions[insert - 1] : undefined;
    const next = rawTransitions[insert];
    const previousDelta = previous === undefined ? undefined : tsi.replayCycle - previous.cycle;
    const nextDelta = next === undefined ? undefined : next.cycle - tsi.replayCycle;
    const writeSample = nativeSampleIndex(tsi.replayCycle, args.sampleRate, args.samplePhaseCycles);
    const previousSample = previous === undefined
      ? undefined
      : nativeSampleIndex(previous.cycle, args.sampleRate, args.samplePhaseCycles);
    const nextSample = next === undefined
      ? undefined
      : nativeSampleIndex(next.cycle, args.sampleRate, args.samplePhaseCycles);
    const sameSampleTransition =
      (previousSample !== undefined && previousSample === writeSample) ||
      (nextSample !== undefined && nextSample === writeSample);
    const nextSampleDelta = nextSample === undefined ? undefined : nextSample - writeSample;
    const windowKey = `${signedBucket(previousDelta)}..${signedBucket(nextDelta)}`;

    total++;
    if (nativeSampleDelta < 0) earlyCount++;
    else if (nativeSampleDelta > 0) lateCount++;
    else exactCount++;
    incrementHistogram(nativeSampleDeltaHistogram, String(nativeSampleDelta));
    updatePokeyStreamCursorBucket(byPreviousTransitionDelta, signedBucket(previousDelta), nativeSampleDelta, args);
    updatePokeyStreamCursorBucket(byNextTransitionDelta, signedBucket(nextDelta), nativeSampleDelta, args);
    updatePokeyStreamCursorBucket(byTransitionWindow, windowKey, nativeSampleDelta, args);
    updatePokeyStreamCursorBucket(bySameSampleTransition, boolBucket(sameSampleTransition), nativeSampleDelta, args);
    updatePokeyStreamCursorBucket(byNextTransitionSampleDelta, signedBucket(nextSampleDelta), nativeSampleDelta, args);
  }

  return {
    transitionCount: rawTransitions.length,
    compared: total,
    earlyCount,
    exactCount,
    lateCount,
    nativeSampleDeltaHistogram: sortedNumericHistogram(nativeSampleDeltaHistogram),
    byPreviousTransitionDelta: finalizedPokeyStreamCursorBuckets(byPreviousTransitionDelta),
    byNextTransitionDelta: finalizedPokeyStreamCursorBuckets(byNextTransitionDelta),
    byTransitionWindow: finalizedPokeyStreamCursorBuckets(byTransitionWindow),
    bySameSampleTransition: finalizedPokeyStreamCursorBuckets(bySameSampleTransition),
    byNextTransitionSampleDelta: finalizedPokeyStreamCursorBuckets(byNextTransitionSampleDelta),
  };
}

interface LofiWindow {
  readonly start: number;
  readonly end: number;
}

function lofiSourceDivide(sourceRate: number, targetRate: number): number {
  return sourceRate <= targetRate ? 1 : 1 + Math.floor(sourceRate / targetRate);
}

function lofiWindowForDestSample(
  destSample: number,
  sourceRate: number,
  targetRate: number,
  sourceDivide: number,
): LofiWindow {
  const dest = Math.max(0, Math.trunc(destSample));
  const seconds = Math.floor(dest / targetRate);
  const destInSecond = dest - seconds * targetRate;
  const sourceFixed = Math.floor(destInSecond * sourceRate * 0x1000 / targetRate);
  let sourceSample = Math.floor(sourceFixed / 0x1000) + sourceRate * seconds;
  if (sourceDivide > 1) sourceSample -= sourceSample % sourceDivide;
  const start = sourceSample - 4 * sourceDivide;
  return {
    start,
    end: start + 4 * sourceDivide - 1,
  };
}

function lofiFirstDestSampleForSourceSample(
  sourceSample: number,
  sourceRate: number,
  targetRate: number,
  sourceDivide: number,
): number {
  const source = Math.max(0, Math.trunc(sourceSample));
  let high = Math.max(1, Math.ceil(source * targetRate / sourceRate) + 8);
  while (lofiWindowForDestSample(high, sourceRate, targetRate, sourceDivide).end < source) {
    high *= 2;
  }
  let low = 0;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (lofiWindowForDestSample(mid, sourceRate, targetRate, sourceDivide).end >= source) high = mid;
    else low = mid + 1;
  }
  return low;
}

function replayCycleToLofiSourceSample(
  replayCycle: number,
  sourceRate: number,
  samplePhaseCycles: number,
): number {
  const phasedCycle = replayCycle + samplePhaseCycles;
  const sourceSample = Math.floor(phasedCycle * sourceRate / SOUND_CMD_TAPE_CPU_HZ);
  return Math.max(0, sourceSample);
}

function pokeyLofiSourceRateCandidates(): number[] {
  const rates = [
    Math.trunc(SOUND_CMD_TAPE_CPU_HZ),
    Math.round(SOUND_CMD_TAPE_CPU_HZ),
    Math.ceil(SOUND_CMD_TAPE_CPU_HZ),
  ];
  return Array.from(new Set(rates.filter((rate) => rate > 0)));
}

function pokeyLofiOffsetCandidates(): number[] {
  return [-4, -3, -2, -1, 0, 1, 2, 3, 4];
}

function scorePokeyLofiCursor(
  sourceRate: number,
  targetRate: number,
  newRawSourceSampleOffset: number,
  ts: readonly NormalizedWrite[],
  mame: readonly NormalizedWrite[],
  compared: number,
  args: Args,
): PokeyLofiCursorSweepEntry {
  const sourceDivide = lofiSourceDivide(sourceRate, targetRate);
  const lofiNativeSampleDeltaHistogram: Record<string, number> = {};
  let lofiMismatchCount = 0;
  let improvementCount = 0;

  for (let index = 0; index < compared; index++) {
    const tsi = ts[index];
    const mamei = mame[index];
    if (tsi?.replayCycle === undefined || mamei?.replayCycle === undefined) continue;
    const baselineDelta = nativeSampleDeltaForReplayCycles(
      tsi.replayCycle,
      mamei.replayCycle,
      0,
      args.sampleRate!,
      args.samplePhaseCycles,
    );
    const tsSourceSample = replayCycleToLofiSourceSample(
      tsi.replayCycle,
      sourceRate,
      args.samplePhaseCycles,
    ) + newRawSourceSampleOffset;
    const mameSourceSample = replayCycleToLofiSourceSample(
      mamei.replayCycle,
      sourceRate,
      args.samplePhaseCycles,
    ) + newRawSourceSampleOffset;
    const lofiDelta = lofiFirstDestSampleForSourceSample(
      tsSourceSample,
      sourceRate,
      targetRate,
      sourceDivide,
    ) - lofiFirstDestSampleForSourceSample(
      mameSourceSample,
      sourceRate,
      targetRate,
      sourceDivide,
    );
    const baselineMismatch = Math.abs(baselineDelta) > args.sampleTolerance;
    const lofiMismatch = Math.abs(lofiDelta) > args.sampleTolerance;
    if (lofiMismatch) lofiMismatchCount++;
    if (baselineMismatch && !lofiMismatch) improvementCount++;
    incrementHistogram(lofiNativeSampleDeltaHistogram, String(lofiDelta));
  }

  return {
    sourceRate,
    sourceDivide,
    newRawSourceSampleOffset,
    lofiMismatchCount,
    improvementCount,
    lofiNativeSampleDeltaHistogram: sortedNumericHistogram(lofiNativeSampleDeltaHistogram),
  };
}

function computePokeyLofiCursorReport(
  kind: Kind,
  ts: readonly NormalizedWrite[],
  mame: readonly NormalizedWrite[],
  compared: number,
  args: Args,
): PokeyLofiCursorReport | undefined {
  if (kind !== "pokey" ||
    !args.pokeyLofiCursorReport ||
    args.sampleRate === undefined ||
    !Number.isFinite(args.sampleRate)) {
    return undefined;
  }

  const targetRate = Math.max(1, Math.trunc(args.sampleRate));
  const sweep = pokeyLofiSourceRateCandidates()
    .flatMap((sourceRate) => pokeyLofiOffsetCandidates().map((offset) =>
      scorePokeyLofiCursor(sourceRate, targetRate, offset, ts, mame, compared, args)))
    .sort((a, b) =>
      a.lofiMismatchCount - b.lofiMismatchCount ||
      b.improvementCount - a.improvementCount ||
      a.sourceRate - b.sourceRate ||
      a.newRawSourceSampleOffset - b.newRawSourceSampleOffset);
  const best = sweep[0];
  if (best === undefined) return undefined;
  const sourceRate = best.sourceRate;
  const sourceDivide = best.sourceDivide;
  const newRawSourceSampleOffset = best.newRawSourceSampleOffset;
  const baselineNativeSampleDeltaHistogram: Record<string, number> = {};
  const lofiNativeSampleDeltaHistogram: Record<string, number> = {};
  const byBaselineToLofiDelta = new Map<string, PokeyStreamCursorBucketAccumulator>();
  const byTsLofiOffsetFromSimple = new Map<string, PokeyStreamCursorBucketAccumulator>();
  const byMameLofiOffsetFromSimple = new Map<string, PokeyStreamCursorBucketAccumulator>();
  const byTsSourceOffsetInBlock = new Map<string, PokeyStreamCursorBucketAccumulator>();
  const byTsSimpleWindowEndDelta = new Map<string, PokeyStreamCursorBucketAccumulator>();
  let total = 0;
  let earlyCount = 0;
  let exactCount = 0;
  let lateCount = 0;
  let baselineMismatchCount = 0;
  let lofiMismatchCount = 0;
  let improvementCount = 0;

  for (let index = 0; index < compared; index++) {
    const tsi = ts[index];
    const mamei = mame[index];
    if (tsi?.replayCycle === undefined || mamei?.replayCycle === undefined) continue;
    const baselineDelta = nativeSampleDeltaForReplayCycles(
      tsi.replayCycle,
      mamei.replayCycle,
      0,
      args.sampleRate,
      args.samplePhaseCycles,
    );
    const tsSourceSample = replayCycleToLofiSourceSample(
      tsi.replayCycle,
      sourceRate,
      args.samplePhaseCycles,
    ) + newRawSourceSampleOffset;
    const mameSourceSample = replayCycleToLofiSourceSample(
      mamei.replayCycle,
      sourceRate,
      args.samplePhaseCycles,
    ) + newRawSourceSampleOffset;
    const tsLofiSample = lofiFirstDestSampleForSourceSample(
      tsSourceSample,
      sourceRate,
      targetRate,
      sourceDivide,
    );
    const mameLofiSample = lofiFirstDestSampleForSourceSample(
      mameSourceSample,
      sourceRate,
      targetRate,
      sourceDivide,
    );
    const lofiDelta = tsLofiSample - mameLofiSample;
    const baselineMismatch = Math.abs(baselineDelta) > args.sampleTolerance;
    const lofiMismatch = Math.abs(lofiDelta) > args.sampleTolerance;
    const tsSimpleSample = nativeSampleIndex(tsi.replayCycle, args.sampleRate, args.samplePhaseCycles);
    const mameSimpleSample = nativeSampleIndex(mamei.replayCycle, args.sampleRate, args.samplePhaseCycles);
    const tsSimpleWindow = lofiWindowForDestSample(tsSimpleSample, sourceRate, targetRate, sourceDivide);

    total++;
    if (baselineDelta < 0) earlyCount++;
    else if (baselineDelta > 0) lateCount++;
    else exactCount++;
    if (baselineMismatch) baselineMismatchCount++;
    if (lofiMismatch) lofiMismatchCount++;
    if (baselineMismatch && !lofiMismatch) improvementCount++;
    incrementHistogram(baselineNativeSampleDeltaHistogram, String(baselineDelta));
    incrementHistogram(lofiNativeSampleDeltaHistogram, String(lofiDelta));
    updatePokeyStreamCursorBucket(
      byBaselineToLofiDelta,
      `${baselineDelta}->${lofiDelta}`,
      baselineDelta,
      args,
    );
    updatePokeyStreamCursorBucket(
      byTsLofiOffsetFromSimple,
      signedBucket(tsLofiSample - tsSimpleSample),
      baselineDelta,
      args,
    );
    updatePokeyStreamCursorBucket(
      byMameLofiOffsetFromSimple,
      signedBucket(mameLofiSample - mameSimpleSample),
      baselineDelta,
      args,
    );
    updatePokeyStreamCursorBucket(
      byTsSourceOffsetInBlock,
      String(tsSourceSample % sourceDivide),
      baselineDelta,
      args,
    );
    updatePokeyStreamCursorBucket(
      byTsSimpleWindowEndDelta,
      signedBucket(tsSimpleWindow.end - tsSourceSample),
      baselineDelta,
      args,
    );
  }

  return {
    sourceRate,
    targetRate,
    sourceDivide,
    newRawSourceSampleOffset,
    compared: total,
    earlyCount,
    exactCount,
    lateCount,
    baselineMismatchCount,
    lofiMismatchCount,
    improvementCount,
    baselineNativeSampleDeltaHistogram: sortedNumericHistogram(baselineNativeSampleDeltaHistogram),
    lofiNativeSampleDeltaHistogram: sortedNumericHistogram(lofiNativeSampleDeltaHistogram),
    sweep: sweep.slice(0, 12),
    byBaselineToLofiDelta: finalizedPokeyStreamCursorBuckets(byBaselineToLofiDelta),
    byTsLofiOffsetFromSimple: finalizedPokeyStreamCursorBuckets(byTsLofiOffsetFromSimple),
    byMameLofiOffsetFromSimple: finalizedPokeyStreamCursorBuckets(byMameLofiOffsetFromSimple),
    byTsSourceOffsetInBlock: finalizedPokeyStreamCursorBuckets(byTsSourceOffsetInBlock),
    byTsSimpleWindowEndDelta: finalizedPokeyStreamCursorBuckets(byTsSimpleWindowEndDelta),
  };
}

function lowerBound(values: readonly number[], target: number): number {
  let lo = 0;
  let hi = values.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if ((values[mid] ?? 0) < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function commandCrossingFor(
  ts: NormalizedWrite | undefined,
  mame: NormalizedWrite | undefined,
  commandCycles: readonly number[],
  basis: "adjusted" | "raw" = "adjusted",
): CommandCrossing | undefined {
  const replayCycle = basis === "raw" ? (ts?.rawReplayCycle ?? ts?.replayCycle) : ts?.replayCycle;
  const writeCycleOffset = basis === "raw" ? (ts?.rawWriteCycleOffset ?? ts?.writeCycleOffset) : ts?.writeCycleOffset;
  if (replayCycle === undefined || writeCycleOffset === undefined) return undefined;
  const tsStepStart = replayCycle - writeCycleOffset;
  const idx = lowerBound(commandCycles, tsStepStart);
  const commandCycle = commandCycles[idx];
  if (commandCycle === undefined || commandCycle > replayCycle) return undefined;
  const rawReplayCycle = ts?.rawReplayCycle;
  const rawWriteCycleOffset = ts?.rawWriteCycleOffset;
  const rawStepStart = rawReplayCycle === undefined || rawWriteCycleOffset === undefined
    ? undefined
    : rawReplayCycle - rawWriteCycleOffset;
  const rawTargetInside = rawReplayCycle === undefined || rawStepStart === undefined
    ? undefined
    : commandCycle >= rawStepStart && commandCycle <= rawReplayCycle;
  return {
    commandCycle,
    tsDelta: replayCycle - commandCycle,
    mameDelta: mame?.replayCycle === undefined ? undefined : mame.replayCycle - commandCycle,
    tsStepStart,
    tsWriteOffset: writeCycleOffset,
    targetInsideTsWriteInstruction: true,
    ...(rawReplayCycle === undefined
      ? {}
      : {
        rawTsDelta: rawReplayCycle - commandCycle,
        ...(rawStepStart === undefined ? {} : { rawTsStepStart: rawStepStart }),
        ...(rawWriteCycleOffset === undefined ? {} : { rawTsWriteOffset: rawWriteCycleOffset }),
        ...(rawTargetInside === undefined ? {} : { rawTargetInsideTsWriteInstruction: rawTargetInside }),
        ...(ts?.chipEventCycleOffset === undefined ? {} : { chipEventCycleOffset: ts.chipEventCycleOffset }),
      }),
  };
}

const COMMAND_NEAR_MISS_LOOKAHEAD_CYCLES = 64;

function commandNearMissFor(
  ts: NormalizedWrite | undefined,
  mame: NormalizedWrite | undefined,
  commandCycles: readonly number[],
  basis: "adjusted" | "raw" = "adjusted",
): CommandNearMiss | undefined {
  const replayCycle = basis === "raw" ? (ts?.rawReplayCycle ?? ts?.replayCycle) : ts?.replayCycle;
  if (replayCycle === undefined) return undefined;
  const idx = lowerBound(commandCycles, replayCycle + 1);
  const commandCycle = commandCycles[idx];
  if (commandCycle === undefined) return undefined;
  const tsDeltaBeforeCommand = commandCycle - replayCycle;
  if (tsDeltaBeforeCommand <= 0 || tsDeltaBeforeCommand > COMMAND_NEAR_MISS_LOOKAHEAD_CYCLES) return undefined;
  const mameDelta = mame?.replayCycle === undefined ? undefined : mame.replayCycle - commandCycle;
  if (mameDelta !== undefined && mameDelta < 0) return undefined;
  return {
    commandCycle,
    tsDeltaBeforeCommand,
    mameDelta,
  };
}

function lowerBoundCommandEvents(events: readonly CommandReplayEvent[], target: number): number {
  let lo = 0;
  let hi = events.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if ((events[mid]?.replayCycle ?? 0) < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function commandEdgeFrameCycle(
  event: CommandReplayEvent,
  delayCycles: number,
): { frame: number | undefined; cycleInFrame: number | undefined } {
  if (event.frame === undefined || event.cycleInFrame === undefined) {
    return { frame: event.frame, cycleInFrame: undefined };
  }
  let frame = event.frame;
  let cycleInFrame = event.cycleInFrame + delayCycles;
  while (cycleInFrame >= SOUND_CYCLES_PER_FRAME) {
    frame++;
    cycleInFrame -= SOUND_CYCLES_PER_FRAME;
  }
  while (cycleInFrame < 0) {
    frame--;
    cycleInFrame += SOUND_CYCLES_PER_FRAME;
  }
  return { frame, cycleInFrame };
}

function commandEdgeEventRuleSummary(rule: CommandEdgeEventRule & { readonly afterCycles: number }): CommandEdgeEventRuleSummary {
  return {
    delayCycles: rule.delayCycles,
    anchor: rule.anchor,
    afterCycles: rule.afterCycles,
    beforeCycles: rule.beforeCycles ?? 0,
    bytes: rule.bytes?.map((byte) => `0x${byte.toString(16).padStart(2, "0")}`),
    pcs: rule.pcs?.map((pc) => `0x${pc.toString(16).padStart(4, "0")}`),
    commandPcs: rule.commandPcs?.map((pc) => `0x${pc.toString(16).padStart(4, "0")}`),
    excludedCommandPcs: rule.excludedCommandPcs?.map((pc) => `0x${pc.toString(16).padStart(4, "0")}`),
    writeRegs: rule.writeRegs?.map((reg) => `0x${reg.toString(16).padStart(2, "0")}`),
    writeVals: rule.writeVals?.map((val) => `0x${val.toString(16).padStart(2, "0")}`),
    writeRegVals: rule.writeRegVals?.map(
      (pair) => `0x${pair.reg.toString(16).padStart(2, "0")}=0x${pair.val.toString(16).padStart(2, "0")}`,
    ),
    relation: rule.relation,
    rawDeltaMin: rule.rawDeltaMin,
    rawDeltaMax: rule.rawDeltaMax,
  };
}

function commandEdgeEventRulesForArgs(
  args: Args,
  kind: Kind,
): readonly (CommandEdgeEventRule & { readonly afterCycles: number })[] {
  if (kind === "pokey") {
    return args.pokeyCommandEdgeEventRules.map((rule) => ({
      ...rule,
      afterCycles: rule.afterCycles ?? args.pokeyCommandEdgeEventAfterCycles,
      beforeCycles: rule.beforeCycles ?? 0,
    }));
  }
  if (args.ymCommandEdgeEventRules.length > 0) {
    return args.ymCommandEdgeEventRules.map((rule) => ({
      ...rule,
      afterCycles: rule.afterCycles ?? args.ymCommandEdgeEventAfterCycles,
      beforeCycles: rule.beforeCycles ?? 0,
    }));
  }
  if (args.ymCommandEdgeEventDelayCycles === undefined) return [];
  return [{
    delayCycles: args.ymCommandEdgeEventDelayCycles,
    anchor: "command",
    afterCycles: args.ymCommandEdgeEventAfterCycles,
    beforeCycles: 0,
    bytes: args.ymCommandEdgeEventBytes,
    pcs: args.ymCommandEdgeEventPcs,
    commandPcs: undefined,
    excludedCommandPcs: undefined,
    writeRegs: undefined,
    writeVals: undefined,
    writeRegVals: undefined,
    relation: args.ymCommandEdgeEventRelation,
    rawDeltaMin: args.ymCommandEdgeEventRawDeltaMin,
    rawDeltaMax: args.ymCommandEdgeEventRawDeltaMax,
  }];
}

function commandEdgeEventAdjustFor(
  write: NormalizedWrite,
  commandEvents: readonly CommandReplayEvent[],
  rules: readonly (CommandEdgeEventRule & { readonly afterCycles: number })[],
  kind: Kind,
  commandSubmissions: ReadonlyMap<number, CommandSubmitContext>,
  commandReads: readonly SoundCommandReadEvent[],
): CommandEdgeEventAdjust | undefined {
  const rawReplayCycle = write.rawReplayCycle ?? write.replayCycle;
  const rawWriteCycleOffset = write.rawWriteCycleOffset ?? write.writeCycleOffset;
  if (rules.length === 0 || write.kind !== kind ||
    rawReplayCycle === undefined || rawWriteCycleOffset === undefined ||
    commandEvents.length === 0) {
    return undefined;
  }
  const rawStepStart = rawReplayCycle - rawWriteCycleOffset;
  const maxBeforeCycles = Math.max(...rules.map((rule) => rule.beforeCycles ?? 0));
  const afterLimit = rawReplayCycle + Math.max(...rules.map((rule) => rule.afterCycles));
  let idx = lowerBoundCommandEvents(commandEvents, rawStepStart - maxBeforeCycles);
  while (idx < commandEvents.length) {
    const event = commandEvents[idx]!;
    if (event.replayCycle > afterLimit) return undefined;
    idx++;
    const relation: Exclude<CommandEdgeEventRelation, "both"> = event.replayCycle < rawStepStart
      ? "raw-before"
      : event.replayCycle <= rawReplayCycle
        ? "raw-crossing"
        : "raw-after";
    const rawDeltaFromCommand = rawReplayCycle - event.replayCycle;
    for (const [ruleIndex, rule] of rules.entries()) {
      if (event.replayCycle < rawStepStart - (rule.beforeCycles ?? 0)) continue;
      if (event.replayCycle > rawReplayCycle + rule.afterCycles) continue;
      if (rule.bytes !== undefined && !rule.bytes.includes(event.byte)) continue;
      if (rule.pcs !== undefined && (write.pc === undefined || !rule.pcs.includes(write.pc & 0xffff))) continue;
      if (rule.writeRegs !== undefined && !rule.writeRegs.includes(write.reg & 0xff)) continue;
      if (rule.writeVals !== undefined && !rule.writeVals.includes(write.val & 0xff)) continue;
      if (rule.writeRegVals !== undefined &&
        !rule.writeRegVals.some((pair) => pair.reg === (write.reg & 0xff) && pair.val === (write.val & 0xff))) {
        continue;
      }
      if (rule.commandPcs !== undefined &&
        (event.soundPc === undefined || !rule.commandPcs.includes(event.soundPc & 0xffff))) {
        continue;
      }
      if (rule.excludedCommandPcs !== undefined &&
        event.soundPc !== undefined && rule.excludedCommandPcs.includes(event.soundPc & 0xffff)) {
        continue;
      }
      if (rule.relation === "both" ? relation === "raw-before" : relation !== rule.relation) continue;
      if (rule.rawDeltaMin !== undefined && rawDeltaFromCommand < rule.rawDeltaMin) continue;
      if (rule.rawDeltaMax !== undefined && rawDeltaFromCommand > rule.rawDeltaMax) continue;
      const firstTsCommandRead = firstCommandReadAfter(event, write, commandReads);
      if (rule.anchor === "first-read" && firstTsCommandRead === undefined) continue;
      const targetAnchorCycle = rule.anchor === "first-read"
        ? firstTsCommandRead!.replayCycle
        : rule.anchor === "current-event"
          ? write.replayCycle ?? rawReplayCycle
          : event.replayCycle;
      const targetReplayCycle = targetAnchorCycle + rule.delayCycles;
      const rawDeltaFromFirstTsCommandRead = firstTsCommandRead === undefined
        ? undefined
        : rawReplayCycle - firstTsCommandRead.replayCycle;
      const targetDeltaFromFirstTsCommandRead = firstTsCommandRead === undefined
        ? undefined
        : targetReplayCycle - firstTsCommandRead.replayCycle;
      return {
        ruleIndex,
        sourceIndex: event.sourceIndex,
        frame: event.frame,
        byte: event.byte,
        soundPc: event.soundPc,
        cycleInFrame: event.cycleInFrame,
        commandReplayCycle: event.replayCycle,
        relation,
        rawDeltaFromCommand,
        targetReplayCycle,
        targetAnchor: rule.anchor,
        targetDelayCycles: rule.delayCycles,
        deltaCycles: targetReplayCycle - rawReplayCycle,
        commandDeltaFromRawStepStart: event.replayCycle - rawStepStart,
        rawReplayCycle,
        rawStepStart,
        rawWriteCycleOffset,
        rawCycleInFrame: write.rawCycleInFrame ?? write.cycleInFrame,
        targetWriteCycleOffset: targetReplayCycle - rawStepStart,
        writeFrame: write.frame,
        writeCycleInFrame: write.cycleInFrame,
        writePc: write.pc,
        writeOpcode: write.opcode,
        writeReg: write.reg,
        writeVal: write.val,
        firstTsCommandRead,
        rawDeltaFromFirstTsCommandRead,
        targetDeltaFromFirstTsCommandRead,
        commandSubmit: commandSubmissions.get(event.sourceIndex),
      };
    }
  }
  return undefined;
}

function applyCommandEdgeEventAdjust(write: NormalizedWrite, adjust: CommandEdgeEventAdjust): NormalizedWrite {
  const rawReplayCycle = write.rawReplayCycle ?? write.replayCycle;
  const rawWriteCycleOffset = write.rawWriteCycleOffset ?? write.writeCycleOffset;
  const frameCycle = commandEdgeFrameCycle({
    sourceIndex: adjust.sourceIndex,
    frame: adjust.frame,
    byte: adjust.byte,
    soundPc: adjust.soundPc,
    soundA: undefined,
    soundX: undefined,
    soundY: undefined,
    soundP: undefined,
    soundSp: undefined,
    cycleInFrame: adjust.cycleInFrame,
    replayCycle: adjust.commandReplayCycle,
    instFrame: undefined,
    instPc: undefined,
    instOpcode: undefined,
    instDeltaCycles: undefined,
    nextInstFrame: undefined,
    nextInstPc: undefined,
    nextInstOpcode: undefined,
    nextInstDeltaCycles: undefined,
    nextChronoInstFrame: undefined,
    nextChronoInstPc: undefined,
    nextChronoInstOpcode: undefined,
    nextChronoInstDeltaCycles: undefined,
  }, adjust.targetReplayCycle - adjust.commandReplayCycle);
  const rawStepStart = rawReplayCycle === undefined || rawWriteCycleOffset === undefined
    ? undefined
    : rawReplayCycle - rawWriteCycleOffset;
  const writeCycleOffset = rawStepStart === undefined ? write.writeCycleOffset : adjust.targetReplayCycle - rawStepStart;
  const chipEventCycleOffset = rawReplayCycle === undefined ? write.chipEventCycleOffset : adjust.targetReplayCycle - rawReplayCycle;
  return {
    ...write,
    frame: frameCycle.frame,
    cycle: adjust.targetReplayCycle,
    cycleInFrame: frameCycle.cycleInFrame,
    replayCycle: adjust.targetReplayCycle,
    writeCycleOffset,
    chipEventCycleOffset,
    commandEdgeEventAdjust: adjust,
  };
}

interface CommandEdgeEventAdjustWriteContextAccumulator {
  count: number;
  writePc: string;
  writeOpcode: string;
  writeReg: string;
  byWriteVal: Record<string, number>;
  byCommandByte: Record<string, number>;
  byCommandSoundPc: Record<string, number>;
  byRelation: Record<string, number>;
  byFirstReadDeltaFromCommand: Record<string, number>;
  byTargetDeltaFromFirstRead: Record<string, number>;
  byRawDeltaFromCommand: Record<string, number>;
}

interface CommandEdgeEventAdjustCommandReadContextAccumulator {
  count: number;
  commandByte: string;
  commandSoundPc: string;
  firstReadDeltaFromCommand: string;
  targetDeltaFromFirstRead: string;
  byWritePc: Record<string, number>;
  byWriteOpcode: Record<string, number>;
  byWriteReg: Record<string, number>;
  byRelation: Record<string, number>;
  byRawDeltaFromCommand: Record<string, number>;
}

function hexByte(value: number | undefined): string {
  return value === undefined ? "?" : `0x${(value & 0xff).toString(16).padStart(2, "0")}`;
}

function hexWord(value: number | undefined): string {
  return value === undefined ? "?" : `0x${(value & 0xffff).toString(16).padStart(4, "0")}`;
}

function numericKey(value: number | undefined): string {
  return value === undefined ? "?" : String(value);
}

function incrementHistogram(histogram: Record<string, number>, key: string): void {
  histogram[key] = (histogram[key] ?? 0) + 1;
}

function topHistogram(histogram: Record<string, number>, limit = 16): Record<string, number> {
  return Object.fromEntries(
    Object.entries(histogram)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, limit),
  );
}

function summarizeSchedulerDrift(rows: readonly FrameAdvanceDiagnosticRow[]): SchedulerDriftSummary {
  if (rows.length === 0) {
    return {
      frameCount: 0,
      activeFrameCount: 0,
      commandFrameCount: 0,
      minCpuStartDelta: 0,
      maxCpuStartDelta: 0,
      minCpuEndDelta: 0,
      maxCpuEndDelta: 0,
      maxAbsCpuStartDelta: 0,
      maxAbsCpuEndDelta: 0,
      byCpuStartDelta: {},
      byCpuEndDelta: {},
      worstFrames: [],
    };
  }

  const activeRows = rows.filter((row) => !row.inResetAfter);
  const measuredRows = activeRows.length === 0 ? rows : activeRows;

  let minCpuStartDelta = Number.POSITIVE_INFINITY;
  let maxCpuStartDelta = Number.NEGATIVE_INFINITY;
  let minCpuEndDelta = Number.POSITIVE_INFINITY;
  let maxCpuEndDelta = Number.NEGATIVE_INFINITY;
  let maxAbsCpuStartDelta = 0;
  let maxAbsCpuEndDelta = 0;
  let commandFrameCount = 0;
  const byCpuStartDelta: Record<string, number> = {};
  const byCpuEndDelta: Record<string, number> = {};

  for (const row of measuredRows) {
    if (row.commandCount > 0) commandFrameCount++;
    minCpuStartDelta = Math.min(minCpuStartDelta, row.cpuStartDelta);
    maxCpuStartDelta = Math.max(maxCpuStartDelta, row.cpuStartDelta);
    minCpuEndDelta = Math.min(minCpuEndDelta, row.cpuEndDelta);
    maxCpuEndDelta = Math.max(maxCpuEndDelta, row.cpuEndDelta);
    maxAbsCpuStartDelta = Math.max(maxAbsCpuStartDelta, Math.abs(row.cpuStartDelta));
    maxAbsCpuEndDelta = Math.max(maxAbsCpuEndDelta, Math.abs(row.cpuEndDelta));
    incrementHistogram(byCpuStartDelta, String(row.cpuStartDelta));
    incrementHistogram(byCpuEndDelta, String(row.cpuEndDelta));
  }

  const worstFrames = measuredRows.slice()
    .sort((a, b) => {
      const bMax = Math.max(Math.abs(b.cpuStartDelta), Math.abs(b.cpuEndDelta));
      const aMax = Math.max(Math.abs(a.cpuStartDelta), Math.abs(a.cpuEndDelta));
      return bMax - aMax || a.frame - b.frame;
    })
    .slice(0, 16);

  return {
    frameCount: rows.length,
    activeFrameCount: activeRows.length,
    commandFrameCount,
    minCpuStartDelta,
    maxCpuStartDelta,
    minCpuEndDelta,
    maxCpuEndDelta,
    maxAbsCpuStartDelta,
    maxAbsCpuEndDelta,
    byCpuStartDelta: topHistogram(byCpuStartDelta, 16),
    byCpuEndDelta: topHistogram(byCpuEndDelta, 16),
    worstFrames,
  };
}

function commandSubmitStepContextToJson(
  step: CommandSubmitStepContext | undefined,
): CommandSubmitStepContextJson | undefined {
  if (step === undefined) return undefined;
  return {
    startCycleInFrame: step.startCycleInFrame,
    endCycleInFrame: step.endCycleInFrame,
    targetOffset: step.targetOffset,
    actualEndDelta: step.actualEndDelta,
    ...(step.pc === undefined ? {} : { pc: hexWord(step.pc) }),
    ...(step.opcode === undefined ? {} : { opcode: hexByte(step.opcode) }),
    nextPc: hexWord(step.nextPc),
    ...(step.nextOpcode === undefined ? {} : { nextOpcode: hexByte(step.nextOpcode) }),
    interruptService: step.interruptService,
  };
}

function commandSubmitActualStateToJson(event: {
  readonly actualSoundPc?: number;
  readonly actualSoundOpcode?: number;
  readonly actualSoundA?: number;
  readonly actualSoundX?: number;
  readonly actualSoundY?: number;
  readonly actualSoundP?: number;
  readonly actualSoundSp?: number;
}): CommandSubmitCpuStateJson | undefined {
  if (
    event.actualSoundPc === undefined &&
    event.actualSoundOpcode === undefined &&
    event.actualSoundA === undefined &&
    event.actualSoundX === undefined &&
    event.actualSoundY === undefined &&
    event.actualSoundP === undefined &&
    event.actualSoundSp === undefined
  ) {
    return undefined;
  }
  return {
    ...(event.actualSoundPc === undefined ? {} : { pc: hexWord(event.actualSoundPc) }),
    ...(event.actualSoundOpcode === undefined ? {} : { opcode: hexByte(event.actualSoundOpcode) }),
    ...(event.actualSoundA === undefined ? {} : { a: hexByte(event.actualSoundA) }),
    ...(event.actualSoundX === undefined ? {} : { x: hexByte(event.actualSoundX) }),
    ...(event.actualSoundY === undefined ? {} : { y: hexByte(event.actualSoundY) }),
    ...(event.actualSoundP === undefined ? {} : { p: hexByte(event.actualSoundP) }),
    ...(event.actualSoundSp === undefined ? {} : { sp: hexByte(event.actualSoundSp) }),
  };
}

function commandSubmitPreAdvanceContextToJson(
  preAdvance: CommandSubmitPreAdvanceContext | undefined,
): CommandSubmitPreAdvanceContextJson | undefined {
  if (preAdvance === undefined) return undefined;
  return {
    cpuCycleInFrame: preAdvance.cpuCycleInFrame,
    deltaToTarget: preAdvance.deltaToTarget,
    ...(preAdvance.pc === undefined ? {} : { pc: hexWord(preAdvance.pc) }),
    ...(preAdvance.opcode === undefined ? {} : { opcode: hexByte(preAdvance.opcode) }),
    inReset: preAdvance.inReset,
    ...(preAdvance.currentChipIoStore === undefined
      ? {}
      : {
        currentChipIoStore: {
          pc: hexWord(preAdvance.currentChipIoStore.pc),
          opcode: hexByte(preAdvance.currentChipIoStore.opcode),
          address: hexWord(preAdvance.currentChipIoStore.address),
          writeCycleOffset: preAdvance.currentChipIoStore.writeCycleOffset,
          stepCycles: preAdvance.currentChipIoStore.stepCycles,
        },
      }),
  };
}

function commandSubmitStepPcOpcodeKey(step: CommandSubmitStepContext | undefined): string {
  if (step === undefined) return "?";
  if (step.interruptService) return "interrupt-service";
  return `${hexWord(step.pc)}:${hexByte(step.opcode)}`;
}

function commandSubmitPreAdvancePcOpcodeKey(preAdvance: CommandSubmitPreAdvanceContext | undefined): string {
  if (preAdvance === undefined) return "?";
  if (preAdvance.inReset) return "reset";
  return `${hexWord(preAdvance.pc)}:${hexByte(preAdvance.opcode)}`;
}

function commandSubmitPreAdvanceStorePcOpcodeKey(preAdvance: CommandSubmitPreAdvanceContext | undefined): string {
  const store = preAdvance?.currentChipIoStore;
  if (store === undefined) return "?";
  return `${hexWord(store.pc)}:${hexByte(store.opcode)}`;
}

function mameCommandInstContextToJson(
  command: CommandReplayEvent | undefined,
): MameCommandInstContextJson | undefined {
  if (command === undefined ||
    (command.soundPc === undefined &&
      command.soundA === undefined &&
      command.soundX === undefined &&
      command.soundY === undefined &&
      command.soundP === undefined &&
      command.soundSp === undefined &&
      command.instFrame === undefined &&
      command.instPc === undefined &&
      command.instOpcode === undefined &&
      command.instDeltaCycles === undefined &&
      command.nextInstFrame === undefined &&
      command.nextInstPc === undefined &&
      command.nextInstOpcode === undefined &&
      command.nextInstDeltaCycles === undefined &&
      command.nextChronoInstFrame === undefined &&
      command.nextChronoInstPc === undefined &&
      command.nextChronoInstOpcode === undefined &&
      command.nextChronoInstDeltaCycles === undefined)) {
    return undefined;
  }
  return {
    ...(command.soundPc === undefined ? {} : { soundPc: hexWord(command.soundPc) }),
    ...(command.soundA === undefined ? {} : { soundA: hexByte(command.soundA) }),
    ...(command.soundX === undefined ? {} : { soundX: hexByte(command.soundX) }),
    ...(command.soundY === undefined ? {} : { soundY: hexByte(command.soundY) }),
    ...(command.soundP === undefined ? {} : { soundP: hexByte(command.soundP) }),
    ...(command.soundSp === undefined ? {} : { soundSp: hexByte(command.soundSp) }),
    ...(command.instFrame === undefined ? {} : { instFrame: command.instFrame }),
    ...(command.instPc === undefined ? {} : { instPc: hexWord(command.instPc) }),
    ...(command.instOpcode === undefined ? {} : { instOpcode: hexByte(command.instOpcode) }),
    ...(command.instDeltaCycles === undefined ? {} : { instDeltaCycles: command.instDeltaCycles }),
    ...(command.nextInstFrame === undefined ? {} : { nextInstFrame: command.nextInstFrame }),
    ...(command.nextInstPc === undefined ? {} : { nextInstPc: hexWord(command.nextInstPc) }),
    ...(command.nextInstOpcode === undefined ? {} : { nextInstOpcode: hexByte(command.nextInstOpcode) }),
    ...(command.nextInstDeltaCycles === undefined ? {} : { nextInstDeltaCycles: command.nextInstDeltaCycles }),
    ...(command.nextChronoInstFrame === undefined ? {} : { nextChronoInstFrame: command.nextChronoInstFrame }),
    ...(command.nextChronoInstPc === undefined ? {} : { nextChronoInstPc: hexWord(command.nextChronoInstPc) }),
    ...(command.nextChronoInstOpcode === undefined ? {} : { nextChronoInstOpcode: hexByte(command.nextChronoInstOpcode) }),
    ...(command.nextChronoInstDeltaCycles === undefined
      ? {}
      : { nextChronoInstDeltaCycles: command.nextChronoInstDeltaCycles }),
  };
}

function mameCommandSoundPcKey(command: CommandReplayEvent | undefined): string {
  return hexWord(command?.soundPc);
}

function mameCommandSoundPcVsTsStepRelationKey(
  command: CommandReplayEvent | undefined,
  step: CommandSubmitStepContext | undefined,
): string {
  if (command === undefined || step === undefined) return "?";
  return commandPcToTsStepRelation(command.soundPc, step);
}

function mameCommandSoundPcVsTsPreAdvanceRelationKey(
  command: CommandReplayEvent | undefined,
  preAdvance: CommandSubmitPreAdvanceContext | undefined,
): string {
  const pc = command?.soundPc;
  if (pc === undefined || preAdvance === undefined) return "?";
  if (preAdvance.pc !== undefined && pc === preAdvance.pc) return "pre-pc";
  if (preAdvance.currentChipIoStore?.pc !== undefined && pc === preAdvance.currentChipIoStore.pc) {
    return "pre-store-pc";
  }
  return "other";
}

function mameSoundCommandReadContextToJson(
  read: MameSoundCommandReadEvent | undefined,
): MameSoundCommandReadContextJson | undefined {
  if (read === undefined) return undefined;
  return {
    ...(read.frame === undefined ? {} : { frame: read.frame }),
    byte: hexByte(read.byte),
    ...(read.cycleInFrame === undefined ? {} : { cycleInFrame: read.cycleInFrame }),
    replayCycle: read.replayCycle,
    ...(read.pc === undefined ? {} : { pc: hexWord(read.pc) }),
    ...(read.deltaFromCommand === undefined ? {} : { deltaFromCommand: read.deltaFromCommand }),
    ...(read.instFrame === undefined ? {} : { instFrame: read.instFrame }),
    ...(read.instPc === undefined ? {} : { instPc: hexWord(read.instPc) }),
    ...(read.instOpcode === undefined ? {} : { instOpcode: hexByte(read.instOpcode) }),
    ...(read.instDeltaCycles === undefined ? {} : { instDeltaCycles: read.instDeltaCycles }),
  };
}

function mameCommandInstPcOpcodeKey(command: CommandReplayEvent | undefined): string {
  if (command?.instPc === undefined || command.instOpcode === undefined) return "?";
  return `${hexWord(command.instPc)}:${hexByte(command.instOpcode)}`;
}

function mameCommandInstDeltaMinusTsTargetOffsetKey(
  command: CommandReplayEvent | undefined,
  step: CommandSubmitStepContext | undefined,
): string {
  if (command?.instDeltaCycles === undefined || step?.targetOffset === undefined) return "?";
  return String(command.instDeltaCycles - step.targetOffset);
}

function mameCommandNextInstPcOpcodeKey(command: CommandReplayEvent | undefined): string {
  if (command?.nextInstPc === undefined || command.nextInstOpcode === undefined) return "?";
  return `${hexWord(command.nextInstPc)}:${hexByte(command.nextInstOpcode)}`;
}

function mameCommandNextInstDeltaMinusTsActualEndDeltaKey(
  command: CommandReplayEvent | undefined,
  step: CommandSubmitStepContext | undefined,
): string {
  if (command?.nextInstDeltaCycles === undefined || step?.actualEndDelta === undefined) return "?";
  return String(command.nextInstDeltaCycles - step.actualEndDelta);
}

function commandPcToTsStepRelation(pc: number | undefined, step: CommandSubmitStepContext | undefined): string {
  if (pc === undefined || step === undefined) return "?";
  if (step.pc !== undefined && pc === step.pc) return "step-pc";
  if (pc === step.nextPc) return "step-next";
  return "other";
}

function mameCommandInstVsTsStepRelationKey(
  command: CommandReplayEvent | undefined,
  step: CommandSubmitStepContext | undefined,
): string {
  if (command === undefined || step === undefined) return "?";
  return `inst:${commandPcToTsStepRelation(command.instPc, step)}/` +
    `next:${commandPcToTsStepRelation(command.nextInstPc, step)}`;
}

function mameCommandNextChronoInstDeltaMinusTsActualEndDeltaKey(
  command: CommandReplayEvent | undefined,
  step: CommandSubmitStepContext | undefined,
): string {
  if (command?.nextChronoInstDeltaCycles === undefined || step?.actualEndDelta === undefined) return "?";
  return String(command.nextChronoInstDeltaCycles - step.actualEndDelta);
}

function mameCommandNextChronoInstVsTsStepRelationKey(
  command: CommandReplayEvent | undefined,
  step: CommandSubmitStepContext | undefined,
): string {
  if (command === undefined || step === undefined) return "?";
  return commandPcToTsStepRelation(command.nextChronoInstPc, step);
}

function mameSoundCommandReadInstPcOpcodeKey(read: MameSoundCommandReadEvent | undefined): string {
  if (read?.instPc === undefined || read.instOpcode === undefined) return "?";
  return `${hexWord(read.instPc)}:${hexByte(read.instOpcode)}`;
}

function mameSoundCommandReadDeltaMinusTsActualSubmitKey(
  read: MameSoundCommandReadEvent | undefined,
  event: { readonly actualCycle?: number },
): string {
  if (read === undefined || event.actualCycle === undefined) return "?";
  return String(read.replayCycle - event.actualCycle);
}

function mameSoundCommandReadDeltaMinusTsActualEndDeltaKey(
  read: MameSoundCommandReadEvent | undefined,
  step: CommandSubmitStepContext | undefined,
): string {
  if (read?.deltaFromCommand === undefined || step?.actualEndDelta === undefined) return "?";
  return String(read.deltaFromCommand - step.actualEndDelta);
}

function recordCommandNmiDelaySubmit(
  diagnostics: CommandSubmitDiagnostics,
  event: {
    readonly frame: number;
    readonly byte: number;
    readonly cycleInFrame: number;
    readonly actualCycle: number;
    readonly actualCycleInFrame: number;
    readonly commandNmiDelayInstructions: number;
    readonly preAdvance?: CommandSubmitPreAdvanceContext;
    readonly lastStep?: CommandSubmitStepContext;
    readonly mameCommand?: CommandReplayEvent;
    readonly mameCommandRead?: MameSoundCommandReadEvent;
  },
  pendingBefore: boolean,
  overrideDelayInstructions: number | undefined,
): void {
  const delayKey = String(event.commandNmiDelayInstructions);
  let summary = diagnostics.byDelay[delayKey];
  if (summary === undefined) {
    summary = {
      count: 0,
      pendingBeforeCount: 0,
      overrideCount: 0,
      byByte: {},
      byByteCycle: {},
      byActualCycleDelta: {},
      byPreAdvanceDeltaToTarget: {},
      byPreAdvancePcOpcode: {},
      byPreAdvanceCurrentChipIoStorePcOpcode: {},
      byMameCommandSoundPcVsTsPreAdvanceRelation: {},
      byLastStepPcOpcode: {},
      byLastStepTargetOffset: {},
      byLastStepActualEndDelta: {},
      byLastStepInterruptService: {},
      byMameCommandSoundPc: {},
      byMameCommandSoundPcVsTsStepRelation: {},
      byMameCommandInstPcOpcode: {},
      byMameCommandInstDeltaCycles: {},
      byMameCommandInstDeltaMinusTsTargetOffset: {},
      byMameCommandNextInstPcOpcode: {},
      byMameCommandNextInstDeltaCycles: {},
      byMameCommandNextInstDeltaMinusTsActualEndDelta: {},
      byMameCommandInstVsTsStepRelation: {},
      byMameCommandNextChronoInstDeltaCycles: {},
      byMameCommandNextChronoInstDeltaMinusTsActualEndDelta: {},
      byMameCommandNextChronoInstVsTsStepRelation: {},
      byMameSoundCommandReadPc: {},
      byMameSoundCommandReadDeltaCycles: {},
      byMameSoundCommandReadDeltaMinusTsActualSubmit: {},
      byMameSoundCommandReadDeltaMinusTsActualEndDelta: {},
      byMameSoundCommandReadInstPcOpcode: {},
      byMameSoundCommandReadInstDeltaCycles: {},
      samples: [],
    };
    diagnostics.byDelay[delayKey] = summary;
  }
  const actualCycleDelta = event.actualCycleInFrame - event.cycleInFrame;
  summary.count++;
  if (pendingBefore) summary.pendingBeforeCount++;
  if (overrideDelayInstructions !== undefined) summary.overrideCount++;
  incrementHistogram(summary.byByte, hexByte(event.byte));
  incrementHistogram(summary.byByteCycle, `${hexByte(event.byte)}@${event.cycleInFrame}`);
  incrementHistogram(summary.byActualCycleDelta, String(actualCycleDelta));
  incrementHistogram(summary.byPreAdvanceDeltaToTarget, numericKey(event.preAdvance?.deltaToTarget));
  incrementHistogram(summary.byPreAdvancePcOpcode, commandSubmitPreAdvancePcOpcodeKey(event.preAdvance));
  incrementHistogram(
    summary.byPreAdvanceCurrentChipIoStorePcOpcode,
    commandSubmitPreAdvanceStorePcOpcodeKey(event.preAdvance),
  );
  incrementHistogram(
    summary.byMameCommandSoundPcVsTsPreAdvanceRelation,
    mameCommandSoundPcVsTsPreAdvanceRelationKey(event.mameCommand, event.preAdvance),
  );
  incrementHistogram(summary.byLastStepPcOpcode, commandSubmitStepPcOpcodeKey(event.lastStep));
  incrementHistogram(summary.byLastStepTargetOffset, numericKey(event.lastStep?.targetOffset));
  incrementHistogram(summary.byLastStepActualEndDelta, numericKey(event.lastStep?.actualEndDelta));
  incrementHistogram(summary.byLastStepInterruptService, booleanKey(event.lastStep?.interruptService));
  incrementHistogram(summary.byMameCommandSoundPc, mameCommandSoundPcKey(event.mameCommand));
  incrementHistogram(
    summary.byMameCommandSoundPcVsTsStepRelation,
    mameCommandSoundPcVsTsStepRelationKey(event.mameCommand, event.lastStep),
  );
  incrementHistogram(summary.byMameCommandInstPcOpcode, mameCommandInstPcOpcodeKey(event.mameCommand));
  incrementHistogram(summary.byMameCommandInstDeltaCycles, numericKey(event.mameCommand?.instDeltaCycles));
  incrementHistogram(
    summary.byMameCommandInstDeltaMinusTsTargetOffset,
    mameCommandInstDeltaMinusTsTargetOffsetKey(event.mameCommand, event.lastStep),
  );
  incrementHistogram(summary.byMameCommandNextInstPcOpcode, mameCommandNextInstPcOpcodeKey(event.mameCommand));
  incrementHistogram(summary.byMameCommandNextInstDeltaCycles, numericKey(event.mameCommand?.nextInstDeltaCycles));
  incrementHistogram(
    summary.byMameCommandNextInstDeltaMinusTsActualEndDelta,
    mameCommandNextInstDeltaMinusTsActualEndDeltaKey(event.mameCommand, event.lastStep),
  );
  incrementHistogram(
    summary.byMameCommandInstVsTsStepRelation,
    mameCommandInstVsTsStepRelationKey(event.mameCommand, event.lastStep),
  );
  incrementHistogram(
    summary.byMameCommandNextChronoInstDeltaCycles,
    numericKey(event.mameCommand?.nextChronoInstDeltaCycles),
  );
  incrementHistogram(
    summary.byMameCommandNextChronoInstDeltaMinusTsActualEndDelta,
    mameCommandNextChronoInstDeltaMinusTsActualEndDeltaKey(event.mameCommand, event.lastStep),
  );
  incrementHistogram(
    summary.byMameCommandNextChronoInstVsTsStepRelation,
    mameCommandNextChronoInstVsTsStepRelationKey(event.mameCommand, event.lastStep),
  );
  incrementHistogram(summary.byMameSoundCommandReadPc, hexWord(event.mameCommandRead?.pc));
  incrementHistogram(summary.byMameSoundCommandReadDeltaCycles, numericKey(event.mameCommandRead?.deltaFromCommand));
  incrementHistogram(
    summary.byMameSoundCommandReadDeltaMinusTsActualSubmit,
    mameSoundCommandReadDeltaMinusTsActualSubmitKey(event.mameCommandRead, event),
  );
  incrementHistogram(
    summary.byMameSoundCommandReadDeltaMinusTsActualEndDelta,
    mameSoundCommandReadDeltaMinusTsActualEndDeltaKey(event.mameCommandRead, event.lastStep),
  );
  incrementHistogram(summary.byMameSoundCommandReadInstPcOpcode, mameSoundCommandReadInstPcOpcodeKey(event.mameCommandRead));
  incrementHistogram(
    summary.byMameSoundCommandReadInstDeltaCycles,
    numericKey(event.mameCommandRead?.instDeltaCycles),
  );
  if (summary.samples.length < 16) {
    const preAdvance = commandSubmitPreAdvanceContextToJson(event.preAdvance);
    const lastStep = commandSubmitStepContextToJson(event.lastStep);
    const mameCommandInst = mameCommandInstContextToJson(event.mameCommand);
    const mameSoundCommandRead = mameSoundCommandReadContextToJson(event.mameCommandRead);
    summary.samples.push({
      frame: event.frame,
      byte: hexByte(event.byte),
      cycleInFrame: event.cycleInFrame,
      actualCycleInFrame: event.actualCycleInFrame,
      actualCycleDelta,
      pendingBefore,
      ...(overrideDelayInstructions === undefined ? {} : { overrideDelayInstructions }),
      ...(preAdvance === undefined ? {} : { preAdvance }),
      ...(lastStep === undefined ? {} : { lastStep }),
      ...(mameCommandInst === undefined ? {} : { mameCommandInst }),
      ...(mameSoundCommandRead === undefined ? {} : { mameSoundCommandRead }),
    });
  }
}

function recordCommandNmiDelayOverrideSelector(
  diagnostics: CommandSubmitDiagnostics,
  selector: string,
  event: {
    readonly frame: number;
    readonly byte: number;
    readonly cycleInFrame: number;
    readonly actualCycle: number;
    readonly actualCycleInFrame: number;
    readonly commandNmiDelayInstructions: number;
    readonly preAdvance?: CommandSubmitPreAdvanceContext;
    readonly lastStep?: CommandSubmitStepContext;
    readonly mameCommand?: CommandReplayEvent;
    readonly mameCommandRead?: MameSoundCommandReadEvent;
  },
  pendingBefore: boolean,
  overrideDelayInstructions: number,
): void {
  let summary = diagnostics.overrideBySelector[selector];
  if (summary === undefined) {
    summary = {
      count: 0,
      pendingBeforeCount: 0,
      byFrame: {},
      byByteCycle: {},
      byActualCycleDelta: {},
      byPreAdvanceDeltaToTarget: {},
      byPreAdvancePcOpcode: {},
      byPreAdvanceCurrentChipIoStorePcOpcode: {},
      byMameCommandSoundPcVsTsPreAdvanceRelation: {},
      byLastStepPcOpcode: {},
      byLastStepTargetOffset: {},
      byLastStepActualEndDelta: {},
      byLastStepInterruptService: {},
      byMameCommandSoundPc: {},
      byMameCommandSoundPcVsTsStepRelation: {},
      byMameCommandInstPcOpcode: {},
      byMameCommandInstDeltaCycles: {},
      byMameCommandInstDeltaMinusTsTargetOffset: {},
      byMameCommandNextInstPcOpcode: {},
      byMameCommandNextInstDeltaCycles: {},
      byMameCommandNextInstDeltaMinusTsActualEndDelta: {},
      byMameCommandInstVsTsStepRelation: {},
      byMameCommandNextChronoInstDeltaCycles: {},
      byMameCommandNextChronoInstDeltaMinusTsActualEndDelta: {},
      byMameCommandNextChronoInstVsTsStepRelation: {},
      byMameSoundCommandReadPc: {},
      byMameSoundCommandReadDeltaCycles: {},
      byMameSoundCommandReadDeltaMinusTsActualSubmit: {},
      byMameSoundCommandReadDeltaMinusTsActualEndDelta: {},
      byMameSoundCommandReadInstPcOpcode: {},
      byMameSoundCommandReadInstDeltaCycles: {},
      samples: [],
    };
    diagnostics.overrideBySelector[selector] = summary;
  }
  const actualCycleDelta = event.actualCycleInFrame - event.cycleInFrame;
  summary.count++;
  if (pendingBefore) summary.pendingBeforeCount++;
  incrementHistogram(summary.byFrame, String(event.frame));
  incrementHistogram(summary.byByteCycle, `${hexByte(event.byte)}@${event.cycleInFrame}`);
  incrementHistogram(summary.byActualCycleDelta, String(actualCycleDelta));
  incrementHistogram(summary.byPreAdvanceDeltaToTarget, numericKey(event.preAdvance?.deltaToTarget));
  incrementHistogram(summary.byPreAdvancePcOpcode, commandSubmitPreAdvancePcOpcodeKey(event.preAdvance));
  incrementHistogram(
    summary.byPreAdvanceCurrentChipIoStorePcOpcode,
    commandSubmitPreAdvanceStorePcOpcodeKey(event.preAdvance),
  );
  incrementHistogram(
    summary.byMameCommandSoundPcVsTsPreAdvanceRelation,
    mameCommandSoundPcVsTsPreAdvanceRelationKey(event.mameCommand, event.preAdvance),
  );
  incrementHistogram(summary.byLastStepPcOpcode, commandSubmitStepPcOpcodeKey(event.lastStep));
  incrementHistogram(summary.byLastStepTargetOffset, numericKey(event.lastStep?.targetOffset));
  incrementHistogram(summary.byLastStepActualEndDelta, numericKey(event.lastStep?.actualEndDelta));
  incrementHistogram(summary.byLastStepInterruptService, booleanKey(event.lastStep?.interruptService));
  incrementHistogram(summary.byMameCommandSoundPc, mameCommandSoundPcKey(event.mameCommand));
  incrementHistogram(
    summary.byMameCommandSoundPcVsTsStepRelation,
    mameCommandSoundPcVsTsStepRelationKey(event.mameCommand, event.lastStep),
  );
  incrementHistogram(summary.byMameCommandInstPcOpcode, mameCommandInstPcOpcodeKey(event.mameCommand));
  incrementHistogram(summary.byMameCommandInstDeltaCycles, numericKey(event.mameCommand?.instDeltaCycles));
  incrementHistogram(
    summary.byMameCommandInstDeltaMinusTsTargetOffset,
    mameCommandInstDeltaMinusTsTargetOffsetKey(event.mameCommand, event.lastStep),
  );
  incrementHistogram(summary.byMameCommandNextInstPcOpcode, mameCommandNextInstPcOpcodeKey(event.mameCommand));
  incrementHistogram(summary.byMameCommandNextInstDeltaCycles, numericKey(event.mameCommand?.nextInstDeltaCycles));
  incrementHistogram(
    summary.byMameCommandNextInstDeltaMinusTsActualEndDelta,
    mameCommandNextInstDeltaMinusTsActualEndDeltaKey(event.mameCommand, event.lastStep),
  );
  incrementHistogram(
    summary.byMameCommandInstVsTsStepRelation,
    mameCommandInstVsTsStepRelationKey(event.mameCommand, event.lastStep),
  );
  incrementHistogram(
    summary.byMameCommandNextChronoInstDeltaCycles,
    numericKey(event.mameCommand?.nextChronoInstDeltaCycles),
  );
  incrementHistogram(
    summary.byMameCommandNextChronoInstDeltaMinusTsActualEndDelta,
    mameCommandNextChronoInstDeltaMinusTsActualEndDeltaKey(event.mameCommand, event.lastStep),
  );
  incrementHistogram(
    summary.byMameCommandNextChronoInstVsTsStepRelation,
    mameCommandNextChronoInstVsTsStepRelationKey(event.mameCommand, event.lastStep),
  );
  incrementHistogram(summary.byMameSoundCommandReadPc, hexWord(event.mameCommandRead?.pc));
  incrementHistogram(summary.byMameSoundCommandReadDeltaCycles, numericKey(event.mameCommandRead?.deltaFromCommand));
  incrementHistogram(
    summary.byMameSoundCommandReadDeltaMinusTsActualSubmit,
    mameSoundCommandReadDeltaMinusTsActualSubmitKey(event.mameCommandRead, event),
  );
  incrementHistogram(
    summary.byMameSoundCommandReadDeltaMinusTsActualEndDelta,
    mameSoundCommandReadDeltaMinusTsActualEndDeltaKey(event.mameCommandRead, event.lastStep),
  );
  incrementHistogram(summary.byMameSoundCommandReadInstPcOpcode, mameSoundCommandReadInstPcOpcodeKey(event.mameCommandRead));
  incrementHistogram(
    summary.byMameSoundCommandReadInstDeltaCycles,
    numericKey(event.mameCommandRead?.instDeltaCycles),
  );
  if (summary.samples.length < 16) {
    const preAdvance = commandSubmitPreAdvanceContextToJson(event.preAdvance);
    const lastStep = commandSubmitStepContextToJson(event.lastStep);
    const mameCommandInst = mameCommandInstContextToJson(event.mameCommand);
    const mameSoundCommandRead = mameSoundCommandReadContextToJson(event.mameCommandRead);
    summary.samples.push({
      frame: event.frame,
      byte: hexByte(event.byte),
      cycleInFrame: event.cycleInFrame,
      actualCycleInFrame: event.actualCycleInFrame,
      actualCycleDelta,
      pendingBefore,
      commandNmiDelayInstructions: event.commandNmiDelayInstructions,
      overrideDelayInstructions,
      ...(preAdvance === undefined ? {} : { preAdvance }),
      ...(lastStep === undefined ? {} : { lastStep }),
      ...(mameCommandInst === undefined ? {} : { mameCommandInst }),
      ...(mameSoundCommandRead === undefined ? {} : { mameSoundCommandRead }),
    });
  }
}

function addCommandEdgeEventAdjustContext(
  adjust: CommandEdgeEventAdjust,
  byWriteContext: Map<string, CommandEdgeEventAdjustWriteContextAccumulator>,
  byCommandReadContext: Map<string, CommandEdgeEventAdjustCommandReadContextAccumulator>,
): void {
  const writePc = hexWord(adjust.writePc);
  const writeOpcode = hexByte(adjust.writeOpcode);
  const writeReg = hexByte(adjust.writeReg);
  const writeKey = `${writePc}:${writeOpcode}:${writeReg}`;
  let writeEntry = byWriteContext.get(writeKey);
  if (writeEntry === undefined) {
    writeEntry = {
      count: 0,
      writePc,
      writeOpcode,
      writeReg,
      byWriteVal: {},
      byCommandByte: {},
      byCommandSoundPc: {},
      byRelation: {},
      byFirstReadDeltaFromCommand: {},
      byTargetDeltaFromFirstRead: {},
      byRawDeltaFromCommand: {},
    };
    byWriteContext.set(writeKey, writeEntry);
  }
  writeEntry.count++;
  incrementHistogram(writeEntry.byWriteVal, hexByte(adjust.writeVal));
  incrementHistogram(writeEntry.byCommandByte, hexByte(adjust.byte));
  incrementHistogram(writeEntry.byCommandSoundPc, hexWord(adjust.soundPc));
  incrementHistogram(writeEntry.byRelation, adjust.relation);
  incrementHistogram(writeEntry.byFirstReadDeltaFromCommand, numericKey(adjust.firstTsCommandRead?.deltaFromCommand));
  incrementHistogram(writeEntry.byTargetDeltaFromFirstRead, numericKey(adjust.targetDeltaFromFirstTsCommandRead));
  incrementHistogram(writeEntry.byRawDeltaFromCommand, String(adjust.rawDeltaFromCommand));

  const commandByte = hexByte(adjust.byte);
  const commandSoundPc = hexWord(adjust.soundPc);
  const firstReadDeltaFromCommand = numericKey(adjust.firstTsCommandRead?.deltaFromCommand);
  const targetDeltaFromFirstRead = numericKey(adjust.targetDeltaFromFirstTsCommandRead);
  const readKey = `${commandByte}:${commandSoundPc}:${firstReadDeltaFromCommand}:${targetDeltaFromFirstRead}`;
  let readEntry = byCommandReadContext.get(readKey);
  if (readEntry === undefined) {
    readEntry = {
      count: 0,
      commandByte,
      commandSoundPc,
      firstReadDeltaFromCommand,
      targetDeltaFromFirstRead,
      byWritePc: {},
      byWriteOpcode: {},
      byWriteReg: {},
      byRelation: {},
      byRawDeltaFromCommand: {},
    };
    byCommandReadContext.set(readKey, readEntry);
  }
  readEntry.count++;
  incrementHistogram(readEntry.byWritePc, writePc);
  incrementHistogram(readEntry.byWriteOpcode, writeOpcode);
  incrementHistogram(readEntry.byWriteReg, writeReg);
  incrementHistogram(readEntry.byRelation, adjust.relation);
  incrementHistogram(readEntry.byRawDeltaFromCommand, String(adjust.rawDeltaFromCommand));
}

function finalizeCommandEdgeEventAdjustWriteContexts(
  contexts: Map<string, CommandEdgeEventAdjustWriteContextAccumulator>,
): CommandEdgeEventAdjustWriteContextSummary[] {
  return Array.from(contexts.values())
    .sort((a, b) => b.count - a.count ||
      a.writePc.localeCompare(b.writePc) ||
      a.writeReg.localeCompare(b.writeReg))
    .slice(0, 32)
    .map((entry) => ({
      count: entry.count,
      writePc: entry.writePc,
      writeOpcode: entry.writeOpcode,
      writeReg: entry.writeReg,
      byWriteVal: topHistogram(entry.byWriteVal),
      byCommandByte: topHistogram(entry.byCommandByte),
      byCommandSoundPc: topHistogram(entry.byCommandSoundPc),
      byRelation: topHistogram(entry.byRelation),
      byFirstReadDeltaFromCommand: topHistogram(entry.byFirstReadDeltaFromCommand),
      byTargetDeltaFromFirstRead: topHistogram(entry.byTargetDeltaFromFirstRead),
      byRawDeltaFromCommand: topHistogram(entry.byRawDeltaFromCommand),
    }));
}

function finalizeCommandEdgeEventAdjustCommandReadContexts(
  contexts: Map<string, CommandEdgeEventAdjustCommandReadContextAccumulator>,
): CommandEdgeEventAdjustCommandReadContextSummary[] {
  return Array.from(contexts.values())
    .sort((a, b) => b.count - a.count ||
      a.commandByte.localeCompare(b.commandByte) ||
      a.commandSoundPc.localeCompare(b.commandSoundPc) ||
      a.firstReadDeltaFromCommand.localeCompare(b.firstReadDeltaFromCommand) ||
      a.targetDeltaFromFirstRead.localeCompare(b.targetDeltaFromFirstRead))
    .slice(0, 32)
    .map((entry) => ({
      count: entry.count,
      commandByte: entry.commandByte,
      commandSoundPc: entry.commandSoundPc,
      firstReadDeltaFromCommand: entry.firstReadDeltaFromCommand,
      targetDeltaFromFirstRead: entry.targetDeltaFromFirstRead,
      byWritePc: topHistogram(entry.byWritePc),
      byWriteOpcode: topHistogram(entry.byWriteOpcode),
      byWriteReg: topHistogram(entry.byWriteReg),
      byRelation: topHistogram(entry.byRelation),
      byRawDeltaFromCommand: topHistogram(entry.byRawDeltaFromCommand),
    }));
}

function applyCommandEdgeEventAdjustForKind(
  writes: readonly NormalizedWrite[],
  commandEvents: readonly CommandReplayEvent[],
  args: Args,
  kind: Kind,
  commandSubmissions: ReadonlyMap<number, CommandSubmitContext>,
  commandReads: readonly SoundCommandReadEvent[],
): { writes: NormalizedWrite[]; summary: CommandEdgeEventAdjustSummary | undefined } {
  const rules = commandEdgeEventRulesForArgs(args, kind);
  if (rules.length === 0) return { writes: [...writes], summary: undefined };
  const byRelation: Record<string, number> = {};
  const byCommandByte: Record<string, number> = {};
  const byCommandSoundPc: Record<string, number> = {};
  const byRawDeltaFromCommand: Record<string, number> = {};
  const byCommandDeltaFromRawStepStart: Record<string, number> = {};
  const byTargetDelayCycles: Record<string, number> = {};
  const byTargetWriteCycleOffset: Record<string, number> = {};
  const byFirstReadDeltaFromCommand: Record<string, number> = {};
  const byRawDeltaFromFirstRead: Record<string, number> = {};
  const byTargetDeltaFromFirstRead: Record<string, number> = {};
  const byDeltaCycles: Record<string, number> = {};
  const byRule: Record<string, number> = {};
  const byPc = new Map<string, number>();
  const byWriteContext = new Map<string, CommandEdgeEventAdjustWriteContextAccumulator>();
  const byCommandReadContext = new Map<string, CommandEdgeEventAdjustCommandReadContextAccumulator>();
  const samples: CommandEdgeEventAdjust[] = [];
  let applied = 0;
  const adjustedWrites = writes.map((write) => {
    const adjust = commandEdgeEventAdjustFor(write, commandEvents, rules, kind, commandSubmissions, commandReads);
    if (adjust === undefined) return write;
    applied++;
    byRelation[adjust.relation] = (byRelation[adjust.relation] ?? 0) + 1;
    const byteKey = `0x${adjust.byte.toString(16).padStart(2, "0")}`;
    byCommandByte[byteKey] = (byCommandByte[byteKey] ?? 0) + 1;
    const soundPcKey = adjust.soundPc === undefined ? "?" : `0x${adjust.soundPc.toString(16).padStart(4, "0")}`;
    byCommandSoundPc[soundPcKey] = (byCommandSoundPc[soundPcKey] ?? 0) + 1;
    const rawDeltaKey = String(adjust.rawDeltaFromCommand);
    byRawDeltaFromCommand[rawDeltaKey] = (byRawDeltaFromCommand[rawDeltaKey] ?? 0) + 1;
    const stepDeltaKey = String(adjust.commandDeltaFromRawStepStart);
    byCommandDeltaFromRawStepStart[stepDeltaKey] = (byCommandDeltaFromRawStepStart[stepDeltaKey] ?? 0) + 1;
    const targetDelayKey = String(adjust.targetDelayCycles);
    byTargetDelayCycles[targetDelayKey] = (byTargetDelayCycles[targetDelayKey] ?? 0) + 1;
    const targetWriteOffsetKey = String(adjust.targetWriteCycleOffset);
    byTargetWriteCycleOffset[targetWriteOffsetKey] = (byTargetWriteCycleOffset[targetWriteOffsetKey] ?? 0) + 1;
    const firstReadDelta = adjust.firstTsCommandRead?.deltaFromCommand;
    if (firstReadDelta !== undefined) {
      const firstReadDeltaKey = String(firstReadDelta);
      byFirstReadDeltaFromCommand[firstReadDeltaKey] = (byFirstReadDeltaFromCommand[firstReadDeltaKey] ?? 0) + 1;
    }
    if (adjust.rawDeltaFromFirstTsCommandRead !== undefined) {
      const rawFromReadKey = String(adjust.rawDeltaFromFirstTsCommandRead);
      byRawDeltaFromFirstRead[rawFromReadKey] = (byRawDeltaFromFirstRead[rawFromReadKey] ?? 0) + 1;
    }
    if (adjust.targetDeltaFromFirstTsCommandRead !== undefined) {
      const targetFromReadKey = String(adjust.targetDeltaFromFirstTsCommandRead);
      byTargetDeltaFromFirstRead[targetFromReadKey] = (byTargetDeltaFromFirstRead[targetFromReadKey] ?? 0) + 1;
    }
    const deltaCyclesKey = String(adjust.deltaCycles);
    byDeltaCycles[deltaCyclesKey] = (byDeltaCycles[deltaCyclesKey] ?? 0) + 1;
    const ruleKey = String(adjust.ruleIndex);
    byRule[ruleKey] = (byRule[ruleKey] ?? 0) + 1;
    const pcKey = write.pc === undefined ? "?" : `0x${write.pc.toString(16).padStart(4, "0")}`;
    byPc.set(pcKey, (byPc.get(pcKey) ?? 0) + 1);
    addCommandEdgeEventAdjustContext(adjust, byWriteContext, byCommandReadContext);
    if (samples.length < 256) samples.push(adjust);
    return applyCommandEdgeEventAdjust(write, adjust);
  });
  return {
    writes: adjustedWrites,
    summary: {
      applied,
      delayCycles: rules.length === 1 ? rules[0]!.delayCycles : undefined,
      afterCycles: Math.max(...rules.map((rule) => rule.afterCycles)),
      bytes: rules.length === 1 ? rules[0]!.bytes?.map((byte) => `0x${byte.toString(16).padStart(2, "0")}`) : undefined,
      pcs: rules.length === 1 ? rules[0]!.pcs?.map((pc) => `0x${pc.toString(16).padStart(4, "0")}`) : undefined,
      relation: rules.length === 1 ? rules[0]!.relation : "both",
      rawDeltaMin: rules.length === 1 ? rules[0]!.rawDeltaMin : undefined,
      rawDeltaMax: rules.length === 1 ? rules[0]!.rawDeltaMax : undefined,
      rules: (kind === "ym2151" ? args.ymCommandEdgeEventRules : args.pokeyCommandEdgeEventRules).length === 0
        ? undefined
        : rules.map(commandEdgeEventRuleSummary),
      byRelation: Object.fromEntries(Object.entries(byRelation).sort((a, b) => a[0].localeCompare(b[0]))),
      byCommandByte: Object.fromEntries(Object.entries(byCommandByte).sort((a, b) => a[0].localeCompare(b[0]))),
      byCommandSoundPc: Object.fromEntries(
        Object.entries(byCommandSoundPc).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
      ),
      byRawDeltaFromCommand: Object.fromEntries(
        Object.entries(byRawDeltaFromCommand).sort((a, b) => Number(a[0]) - Number(b[0])),
      ),
      byCommandDeltaFromRawStepStart: Object.fromEntries(
        Object.entries(byCommandDeltaFromRawStepStart).sort((a, b) => Number(a[0]) - Number(b[0])),
      ),
      byTargetDelayCycles: Object.fromEntries(
        Object.entries(byTargetDelayCycles).sort((a, b) => Number(a[0]) - Number(b[0])),
      ),
      byTargetWriteCycleOffset: Object.fromEntries(
        Object.entries(byTargetWriteCycleOffset).sort((a, b) => Number(a[0]) - Number(b[0])),
      ),
      byFirstReadDeltaFromCommand: Object.fromEntries(
        Object.entries(byFirstReadDeltaFromCommand).sort((a, b) => Number(a[0]) - Number(b[0])),
      ),
      byRawDeltaFromFirstRead: Object.fromEntries(
        Object.entries(byRawDeltaFromFirstRead).sort((a, b) => Number(a[0]) - Number(b[0])),
      ),
      byTargetDeltaFromFirstRead: Object.fromEntries(
        Object.entries(byTargetDeltaFromFirstRead).sort((a, b) => Number(a[0]) - Number(b[0])),
      ),
      byDeltaCycles: Object.fromEntries(
        Object.entries(byDeltaCycles).sort((a, b) => Number(a[0]) - Number(b[0])),
      ),
      byRule: Object.fromEntries(
        Object.entries(byRule).sort((a, b) => Number(a[0]) - Number(b[0])),
      ),
      byPc: Array.from(byPc.entries())
        .map(([pc, count]) => ({ pc, count }))
        .sort((a, b) => b.count - a.count || a.pc.localeCompare(b.pc))
        .slice(0, 16),
      byWriteContext: finalizeCommandEdgeEventAdjustWriteContexts(byWriteContext),
      byCommandReadContext: finalizeCommandEdgeEventAdjustCommandReadContexts(byCommandReadContext),
      samples,
    },
  };
}

function commandContextEntryFor(
  event: CommandReplayEvent,
  ts: NormalizedWrite | undefined,
  mame: NormalizedWrite | undefined,
  commandSubmissions: ReadonlyMap<number, CommandSubmitContext>,
  commandReads: readonly SoundCommandReadEvent[],
): CommandContextEntry {
  const submit = commandSubmissions.get(event.sourceIndex);
  const firstTsCommandRead = firstCommandReadAfter(event, ts, commandReads);
  return {
    sourceIndex: event.sourceIndex,
    frame: event.frame,
    byte: event.byte,
    cycleInFrame: event.cycleInFrame,
    replayCycle: event.replayCycle,
    soundPc: event.soundPc,
    instFrame: event.instFrame,
    instPc: event.instPc,
    instOpcode: event.instOpcode,
    instDeltaCycles: event.instDeltaCycles,
    nextInstFrame: event.nextInstFrame,
    nextInstPc: event.nextInstPc,
    nextInstOpcode: event.nextInstOpcode,
    nextInstDeltaCycles: event.nextInstDeltaCycles,
    nextChronoInstFrame: event.nextChronoInstFrame,
    nextChronoInstPc: event.nextChronoInstPc,
    nextChronoInstOpcode: event.nextChronoInstOpcode,
    nextChronoInstDeltaCycles: event.nextChronoInstDeltaCycles,
    tsDelta: ts?.replayCycle === undefined ? undefined : ts.replayCycle - event.replayCycle,
    mameDelta: mame?.replayCycle === undefined ? undefined : mame.replayCycle - event.replayCycle,
    ...(firstTsCommandRead === undefined ? {} : { firstTsCommandRead }),
    ...(submit === undefined ? {} : { submit }),
  };
}

function firstCommandReadAfter(
  event: CommandReplayEvent,
  ts: NormalizedWrite | undefined,
  commandReads: readonly SoundCommandReadEvent[],
): CommandReadContext | undefined {
  for (const read of commandReads) {
    if (read.cycle < event.replayCycle) continue;
    if ((read.val & 0xff) !== event.byte) continue;
    return {
      frame: read.frame,
      cycleInFrame: read.cycleInFrame,
      replayCycle: read.cycle,
      pc: read.pc,
      val: read.val & 0xff,
      readCycleOffset: read.readCycleOffset,
      deltaFromCommand: read.cycle - event.replayCycle,
      deltaFromTsWrite: ts?.replayCycle === undefined ? undefined : read.cycle - ts.replayCycle,
    };
  }
  return undefined;
}

function commandContextDistance(entry: CommandContextEntry): number {
  const delta = entry.tsDelta ?? entry.mameDelta;
  return delta === undefined ? Number.POSITIVE_INFINITY : Math.abs(delta);
}

function commandContextFor(
  ts: NormalizedWrite | undefined,
  mame: NormalizedWrite | undefined,
  commandEvents: readonly CommandReplayEvent[],
  commandSubmissions: ReadonlyMap<number, CommandSubmitContext>,
  commandReads: readonly SoundCommandReadEvent[],
): CommandContext | undefined {
  const referenceCycle = ts?.replayCycle ?? mame?.replayCycle;
  if (referenceCycle === undefined || commandEvents.length === 0) return undefined;
  const nextIndex = lowerBoundCommandEvents(commandEvents, referenceCycle + 1);
  const previousEvent = commandEvents[nextIndex - 1];
  const nextEvent = commandEvents[nextIndex];
  const previous = previousEvent === undefined
    ? undefined
    : commandContextEntryFor(previousEvent, ts, mame, commandSubmissions, commandReads);
  const next = nextEvent === undefined
    ? undefined
    : commandContextEntryFor(nextEvent, ts, mame, commandSubmissions, commandReads);
  const nearest = previous === undefined
    ? next
    : next === undefined
      ? previous
      : commandContextDistance(previous) <= commandContextDistance(next)
        ? previous
        : next;
  return {
    ...(previous === undefined ? {} : { previous }),
    ...(next === undefined ? {} : { next }),
    ...(nearest === undefined ? {} : { nearest }),
  };
}

function commandReadComparisonSummary(
  commandEvents: readonly CommandReplayEvent[],
  mameReadsBySource: ReadonlyMap<number, MameSoundCommandReadEvent>,
  commandSubmissions: ReadonlyMap<number, CommandSubmitContext>,
  commandReads: readonly SoundCommandReadEvent[],
): CommandReadComparisonSummary {
  const byTsReadDeltaFromCommand: Record<string, number> = {};
  const byMameReadDeltaFromCommand: Record<string, number> = {};
  const byMameMinusTsReadDelta: Record<string, number> = {};
  const bySubmitNmiDelayInstructions: Record<string, number> = {};
  const bySubmitNmiDelayAndReadDelta: Record<string, number> = {};
  const byCommandByteCycle: Record<string, number> = {};
  const byCommandSoundPc: Record<string, number> = {};
  const mameMinusTsReadDeltaStats = makeEmptyDeltaStats();
  const mameMinusTsReadDeltaAbsSum = { value: 0 };
  const samples: CommandReadComparisonSample[] = [];
  let firstMaxAbsReadDelta: CommandReadComparisonSample | undefined;
  let withTsRead = 0;
  let withMameRead = 0;
  let withBothReads = 0;
  for (const event of commandEvents) {
    const tsRead = firstCommandReadAfter(event, undefined, commandReads);
    const mameRead = mameReadsBySource.get(event.sourceIndex);
    const submit = commandSubmissions.get(event.sourceIndex);
    if (tsRead !== undefined) withTsRead++;
    if (mameRead !== undefined) withMameRead++;
    if (tsRead !== undefined && mameRead !== undefined) withBothReads++;
    const tsDelta = tsRead?.deltaFromCommand;
    const mameDelta = mameRead?.deltaFromCommand;
    const mameMinusTs = tsDelta === undefined || mameDelta === undefined
      ? undefined
      : mameDelta - tsDelta;
    incrementHistogram(byTsReadDeltaFromCommand, numericKey(tsDelta));
    incrementHistogram(byMameReadDeltaFromCommand, numericKey(mameDelta));
    incrementHistogram(byMameMinusTsReadDelta, numericKey(mameMinusTs));
    incrementHistogram(bySubmitNmiDelayInstructions, numericKey(submit?.commandNmiDelayInstructions));
    incrementHistogram(
      bySubmitNmiDelayAndReadDelta,
      `${numericKey(submit?.commandNmiDelayInstructions)}:${numericKey(mameMinusTs)}`,
    );
    incrementHistogram(byCommandByteCycle, `${hexByte(event.byte)}@${event.cycleInFrame ?? "?"}`);
    incrementHistogram(byCommandSoundPc, hexWord(event.soundPc));
    const sample: CommandReadComparisonSample = {
      sourceIndex: event.sourceIndex,
      frame: event.frame,
      byte: hexByte(event.byte),
      cycleInFrame: event.cycleInFrame,
      ...(event.soundPc === undefined ? {} : { soundPc: hexWord(event.soundPc) }),
      ...(submit?.commandNmiDelayInstructions === undefined
        ? {}
        : { submitDelay: submit.commandNmiDelayInstructions }),
      ...(submit === undefined
        ? {}
        : { submitActualDeltaFromCommand: submit.actualCycle - event.replayCycle }),
      ...(tsDelta === undefined ? {} : { tsReadDeltaFromCommand: tsDelta }),
      ...(mameDelta === undefined ? {} : { mameReadDeltaFromCommand: mameDelta }),
      ...(mameMinusTs === undefined ? {} : { mameMinusTsReadDelta: mameMinusTs }),
      ...(tsRead?.pc === undefined ? {} : { tsReadPc: hexWord(tsRead.pc) }),
      ...(mameRead?.pc === undefined ? {} : { mameReadPc: hexWord(mameRead.pc) }),
    };
    if (mameMinusTs !== undefined) {
      addDelta(mameMinusTsReadDeltaStats, mameMinusTsReadDeltaAbsSum, mameMinusTs);
      if (
        firstMaxAbsReadDelta === undefined ||
        Math.abs(mameMinusTs) > Math.abs(firstMaxAbsReadDelta.mameMinusTsReadDelta ?? 0)
      ) {
        firstMaxAbsReadDelta = sample;
      }
    }
    if (samples.length < 32 && (mameMinusTs !== undefined ? mameMinusTs !== 0 : tsRead === undefined || mameRead === undefined)) {
      samples.push(sample);
    }
  }
  return {
    totalCommands: commandEvents.length,
    withTsRead,
    withMameRead,
    withBothReads,
    mameMinusTsReadDeltaStats,
    byTsReadDeltaFromCommand: topHistogram(byTsReadDeltaFromCommand),
    byMameReadDeltaFromCommand: topHistogram(byMameReadDeltaFromCommand),
    byMameMinusTsReadDelta: topHistogram(byMameMinusTsReadDelta),
    bySubmitNmiDelayInstructions: topHistogram(bySubmitNmiDelayInstructions),
    bySubmitNmiDelayAndReadDelta: topHistogram(bySubmitNmiDelayAndReadDelta),
    byCommandByteCycle: topHistogram(byCommandByteCycle),
    byCommandSoundPc: topHistogram(byCommandSoundPc),
    ...(firstMaxAbsReadDelta === undefined ? {} : { firstMaxAbsReadDelta }),
    samples,
  };
}

function commandSubmitExpectedState(event: CommandReplayEvent): CommandSubmitCpuStateJson | undefined {
  if (
    event.soundPc === undefined &&
    event.soundA === undefined &&
    event.soundX === undefined &&
    event.soundY === undefined &&
    event.soundP === undefined &&
    event.soundSp === undefined
  ) {
    return undefined;
  }
  return {
    ...(event.soundPc === undefined ? {} : { pc: hexWord(event.soundPc) }),
    ...(event.soundA === undefined ? {} : { a: hexByte(event.soundA) }),
    ...(event.soundX === undefined ? {} : { x: hexByte(event.soundX) }),
    ...(event.soundY === undefined ? {} : { y: hexByte(event.soundY) }),
    ...(event.soundP === undefined ? {} : { p: hexByte(event.soundP) }),
    ...(event.soundSp === undefined ? {} : { sp: hexByte(event.soundSp) }),
  };
}

function commandSubmitStateMismatchFields(
  expected: CommandSubmitCpuStateJson | undefined,
  actual: CommandSubmitCpuStateJson | undefined,
): string[] {
  const fields: Array<keyof CommandSubmitCpuStateJson> = ["pc", "a", "x", "y", "p", "sp"];
  const mismatches: string[] = [];
  for (const field of fields) {
    const expectedValue = expected?.[field];
    if (expectedValue === undefined) continue;
    const actualValue = actual?.[field];
    if (actualValue !== expectedValue) mismatches.push(field);
  }
  return mismatches;
}

function commandSubmitActualPcRelation(
  event: CommandReplayEvent,
  actual: CommandSubmitCpuStateJson | undefined,
): string {
  const pc = actual?.pc;
  if (pc === undefined) return "?";
  if (event.soundPc !== undefined && pc === hexWord(event.soundPc)) return "soundPc";
  if (event.instPc !== undefined && pc === hexWord(event.instPc)) return "instPc";
  if (event.nextInstPc !== undefined && pc === hexWord(event.nextInstPc)) return "nextInstPc";
  if (event.nextChronoInstPc !== undefined && pc === hexWord(event.nextChronoInstPc)) return "nextChronoInstPc";
  return "other";
}

function commandSubmitStateComparisonSummary(
  commandEvents: readonly CommandReplayEvent[],
  commandSubmissions: ReadonlyMap<number, CommandSubmitContext>,
): CommandSubmitStateComparisonSummary {
  const out: CommandSubmitStateComparisonSummary = {
    totalCommands: commandEvents.length,
    withExpectedState: 0,
    withActualState: 0,
    exact: 0,
    exactIgnoringP: 0,
    mismatch: 0,
    byMismatchField: {},
    byExpectedPc: {},
    byActualPc: {},
    byActualPcRelation: {},
    samples: [],
  };
  for (const event of commandEvents) {
    const expected = commandSubmitExpectedState(event);
    const actual = commandSubmissions.get(event.sourceIndex)?.actualState;
    const actualPcRelation = commandSubmitActualPcRelation(event, actual);
    if (expected !== undefined) out.withExpectedState++;
    if (actual !== undefined) out.withActualState++;
    incrementHistogram(out.byExpectedPc, expected?.pc ?? "?");
    incrementHistogram(out.byActualPc, actual?.pc ?? "?");
    incrementHistogram(out.byActualPcRelation, actualPcRelation);
    const fields = commandSubmitStateMismatchFields(expected, actual);
    const fieldsIgnoringP = fields.filter((field) => field !== "p");
    if (expected !== undefined && actual !== undefined && fieldsIgnoringP.length === 0) {
      out.exactIgnoringP++;
    }
    if (expected !== undefined && actual !== undefined && fields.length === 0) {
      out.exact++;
      continue;
    }
    if (expected === undefined || fields.length === 0) continue;
    out.mismatch++;
    for (const field of fields) incrementHistogram(out.byMismatchField, field);
    const sample: CommandSubmitStateMismatchSample = {
      sourceIndex: event.sourceIndex,
      frame: event.frame ?? -1,
      byte: hexByte(event.byte),
      cycleInFrame: event.cycleInFrame ?? -1,
      actualCycleInFrame: commandSubmissions.get(event.sourceIndex)?.actualCycleInFrame ?? -1,
      fields,
      actualPcRelation,
      expected,
      actual: actual ?? {},
    };
    out.firstMismatch ??= sample;
    if (out.samples.length < 32) out.samples.push(sample);
  }
  out.byMismatchField = topHistogram(out.byMismatchField);
  out.byExpectedPc = topHistogram(out.byExpectedPc);
  out.byActualPc = topHistogram(out.byActualPc);
  out.byActualPcRelation = topHistogram(out.byActualPcRelation);
  return out;
}

function fmtPcValue(pc: number | undefined): string {
  return pc === undefined ? "?" : `0x${pc.toString(16).padStart(4, "0")}`;
}

function fmtRegValue(reg: number | undefined): string {
  return reg === undefined ? "?" : `0x${reg.toString(16).padStart(2, "0")}`;
}

function pcClusterKey(ts: NormalizedWrite | undefined, mame: NormalizedWrite | undefined): string {
  if (ts?.pc !== undefined && mame?.pc !== undefined) {
    if (ts.pc === mame.pc) return fmtPcValue(ts.pc);
    return `${fmtPcValue(ts.pc)}!=${fmtPcValue(mame.pc)}`;
  }
  if (ts?.pc !== undefined) return `ts:${fmtPcValue(ts.pc)}`;
  if (mame?.pc !== undefined) return `mame:${fmtPcValue(mame.pc)}`;
  return "?";
}

function sortedFieldCounts(fieldCounts: Record<string, number>): Record<string, number> {
  return Object.fromEntries(
    Object.entries(fieldCounts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
  );
}

type NativeSampleDeltaBreakdownAccumulator = NativeSampleDeltaBreakdownEntry & {
  nativeSampleDeltaAbsSum: { value: number };
};

type NativeSampleCommandMismatchBreakdownAccumulator = NativeSampleCommandMismatchBreakdownEntry & {
  replayCycleDeltaAbsSum: { value: number };
  nativeSampleDeltaAbsSum: { value: number };
  nativeSampleTargetCycleOffsetAbsSum: { value: number };
  tsDeltaFromCommandAbsSum: { value: number };
  mameDeltaFromCommandAbsSum: { value: number };
};

type NativeSampleMismatchContextAccumulator = NativeSampleMismatchContextSummary & {
  nativeSampleTargetCycleOffsetAbsSum: { value: number };
  mameNativeSampleOffsetFromStartAbsSum: { value: number };
  mameNativeSampleOffsetToEndAbsSum: { value: number };
  tsNativeSampleOffsetFromStartAbsSum: { value: number };
  tsNativeSampleOffsetToEndAbsSum: { value: number };
};

function targetDelayWindowFromCommandForNativeSample(
  mame: NormalizedWrite | undefined,
  command: CommandContextEntry | undefined,
  args: Args,
): { min: number; max: number } | undefined {
  if (args.sampleRate === undefined || !Number.isFinite(args.sampleRate) ||
    mame?.replayCycle === undefined || command === undefined) {
    return undefined;
  }
  const mameSample = nativeSampleIndex(mame.replayCycle, args.sampleRate, args.samplePhaseCycles);
  const firstAcceptedSample = mameSample - args.sampleTolerance;
  const lastAcceptedSample = mameSample + args.sampleTolerance;
  const minCycle = firstCycleForNativeSample(firstAcceptedSample, args.sampleRate, args.samplePhaseCycles);
  const maxCycle = firstCycleForNativeSample(lastAcceptedSample + 1, args.sampleRate, args.samplePhaseCycles) - 1;
  return {
    min: minCycle - command.replayCycle,
    max: maxCycle - command.replayCycle,
  };
}

function addTargetDelayWindowFromCommand(
  entry: NativeSampleCommandMismatchBreakdownAccumulator,
  window: { min: number; max: number } | undefined,
): void {
  if (window === undefined) return;
  const stats = entry.targetDelayWindowFromCommand;
  stats.compared++;
  stats.minStart = stats.minStart === undefined ? window.min : Math.min(stats.minStart, window.min);
  stats.maxStart = stats.maxStart === undefined ? window.min : Math.max(stats.maxStart, window.min);
  stats.minEnd = stats.minEnd === undefined ? window.max : Math.min(stats.minEnd, window.max);
  stats.maxEnd = stats.maxEnd === undefined ? window.max : Math.max(stats.maxEnd, window.max);
  stats.intersectionMin = stats.intersectionMin === undefined
    ? window.min
    : Math.max(stats.intersectionMin, window.min);
  stats.intersectionMax = stats.intersectionMax === undefined
    ? window.max
    : Math.min(stats.intersectionMax, window.max);
  stats.hasIntersection = stats.intersectionMin <= stats.intersectionMax;
  incrementHistogram(entry.byTargetDelayWindowFromCommand, `${window.min}..${window.max}`);
}

function ym2151RegisterCategory(reg: number): string {
  const r = reg & 0xff;
  if (r === 0x08) return "key-on";
  if (r >= 0x10 && r <= 0x14) return "timer";
  if (r === 0x0f || r === 0x18 || r === 0x19 || r === 0x1b) return "lfo-noise";
  if (r >= 0x20 && r <= 0x3f) return "channel-freq-algo";
  if (r >= 0x40 && r <= 0xff) return "operator";
  if (r === 0x01) return "global";
  return "other";
}

function pokeyRegisterCategory(reg: number): string {
  switch (reg & 0x0f) {
    case 0x00:
    case 0x02:
    case 0x04:
    case 0x06:
      return "frequency";
    case 0x01:
    case 0x03:
    case 0x05:
    case 0x07:
      return "control-volume";
    case 0x08:
      return "audctl";
    case 0x09:
      return "stimer";
    case 0x0f:
      return "skctl";
    default:
      return "other";
  }
}

function chipRegisterCategory(kind: Kind, reg: number): string {
  return kind === "ym2151" ? ym2151RegisterCategory(reg) : pokeyRegisterCategory(reg);
}

function chipRegisterBreakdown(
  kind: Kind,
  ts: NormalizedWrite | undefined,
  mame: NormalizedWrite | undefined,
): { category: string; reg: string | undefined; registerLabel: string } {
  if (ts?.reg !== undefined && mame?.reg !== undefined && ts.reg !== mame.reg) {
    return {
      category: "reg-mismatch",
      reg: undefined,
      registerLabel: `${fmtRegValue(ts.reg)}!=${fmtRegValue(mame.reg)}`,
    };
  }
  const reg = mame?.reg ?? ts?.reg;
  if (reg === undefined) {
    return {
      category: "missing",
      reg: undefined,
      registerLabel: "missing",
    };
  }
  const category = chipRegisterCategory(kind, reg);
  const regLabel = fmtRegValue(reg);
  return {
    category,
    reg: regLabel,
    registerLabel: `${regLabel} ${category}`,
  };
}

function updateNativeSampleDeltaBreakdownEntry(
  entries: Map<string, NativeSampleDeltaBreakdownAccumulator>,
  key: string,
  details: Pick<NativeSampleDeltaBreakdownEntry, "label" | "kind" | "category" | "reg">,
  index: number,
  ts: NormalizedWrite | undefined,
  mame: NormalizedWrite | undefined,
  nativeSampleDelta: number,
  args: Args,
): void {
  let entry = entries.get(key);
  if (entry === undefined) {
    entry = {
      ...details,
      compared: 0,
      nativeSampleMismatchCount: 0,
      firstNativeSampleMismatch: undefined,
      nativeSampleDelta: {
        sampleRate: args.sampleRate,
        samplePhaseCycles: args.samplePhaseCycles,
        ...makeEmptyDeltaStats(),
      },
      nativeSampleDeltaAbsSum: { value: 0 },
      nativeSampleDeltaHistogram: {},
    };
    entries.set(key, entry);
  }
  entry.compared++;
  addDelta(entry.nativeSampleDelta, entry.nativeSampleDeltaAbsSum, nativeSampleDelta);
  const sampleKey = String(nativeSampleDelta);
  entry.nativeSampleDeltaHistogram[sampleKey] = (entry.nativeSampleDeltaHistogram[sampleKey] ?? 0) + 1;
  if (Math.abs(nativeSampleDelta) > args.sampleTolerance) {
    entry.nativeSampleMismatchCount++;
    entry.firstNativeSampleMismatch ??= {
      index,
      nativeSampleDelta,
      ts,
      mame,
    };
  }
}

function updateNativeSampleDeltaBreakdowns(
  categoryEntries: Map<string, NativeSampleDeltaBreakdownAccumulator>,
  registerEntries: Map<string, NativeSampleDeltaBreakdownAccumulator>,
  kind: Kind,
  index: number,
  ts: NormalizedWrite | undefined,
  mame: NormalizedWrite | undefined,
  nativeSampleDelta: number,
  args: Args,
): void {
  const breakdown = chipRegisterBreakdown(kind, ts, mame);
  updateNativeSampleDeltaBreakdownEntry(
    categoryEntries,
    `${kind}:${breakdown.category}`,
    {
      label: breakdown.category,
      kind,
      category: breakdown.category,
    },
    index,
    ts,
    mame,
    nativeSampleDelta,
    args,
  );
  updateNativeSampleDeltaBreakdownEntry(
    registerEntries,
    `${kind}:${breakdown.registerLabel}`,
    {
      label: breakdown.registerLabel,
      kind,
      category: breakdown.category,
      ...(breakdown.reg === undefined ? {} : { reg: breakdown.reg }),
    },
    index,
    ts,
    mame,
    nativeSampleDelta,
    args,
  );
}

function finalizedNativeSampleDeltaBreakdown(
  entries: Map<string, NativeSampleDeltaBreakdownAccumulator>,
): NativeSampleDeltaBreakdownEntry[] {
  return Array.from(entries.values())
    .sort((a, b) =>
      b.nativeSampleMismatchCount - a.nativeSampleMismatchCount ||
      b.compared - a.compared ||
      a.label.localeCompare(b.label))
    .map((entry) => ({
      label: entry.label,
      kind: entry.kind,
      category: entry.category,
      ...(entry.reg === undefined ? {} : { reg: entry.reg }),
      compared: entry.compared,
      nativeSampleMismatchCount: entry.nativeSampleMismatchCount,
      firstNativeSampleMismatch: entry.firstNativeSampleMismatch,
      nativeSampleDelta: entry.nativeSampleDelta,
      nativeSampleDeltaHistogram: Object.fromEntries(
        Object.entries(entry.nativeSampleDeltaHistogram)
          .sort((a, b) => Number(a[0]) - Number(b[0])),
      ),
    }));
}

function nativeSampleMismatchCommandRelation(
  commandCrossing: CommandCrossing | undefined,
  rawCommandCrossing: CommandCrossing | undefined,
  commandNearMiss: CommandNearMiss | undefined,
  rawCommandNearMiss: CommandNearMiss | undefined,
): NativeSampleMismatchCommandRelation {
  if (rawCommandCrossing !== undefined) return "raw-crossing";
  if (commandCrossing !== undefined) return "crossing";
  if (rawCommandNearMiss !== undefined) return "raw-near";
  if (commandNearMiss !== undefined) return "near";
  return "far";
}

function commandContextNearestSide(commandContext: CommandContext | undefined): string {
  const nearest = commandContext?.nearest;
  if (nearest === undefined) return "?";
  if (nearest.tsDelta === 0 || nearest.mameDelta === 0) return "same-cycle";
  if (commandContext?.previous?.sourceIndex === nearest.sourceIndex &&
    commandContext.previous.replayCycle === nearest.replayCycle) {
    return "previous";
  }
  if (commandContext?.next?.sourceIndex === nearest.sourceIndex &&
    commandContext.next.replayCycle === nearest.replayCycle) {
    return "next";
  }
  return "?";
}

function commandContextNearestDeltaSign(command: CommandContextEntry | undefined): string {
  const delta = command?.tsDelta ?? command?.mameDelta;
  if (delta === undefined) return "?";
  if (delta < 0) return "next-command";
  if (delta > 0) return "previous-command";
  return "same-cycle";
}

function submitPreAdvanceDeltaBucket(delta: number | undefined): string {
  if (delta === undefined) return "?";
  if (delta < 0) {
    const lag = Math.abs(delta);
    if (lag >= 10_000) return "lag>=10000";
    if (lag >= 1_000) return "lag1000..9999";
    if (lag >= 100) return "lag100..999";
    return "lag1..99";
  }
  if (delta <= 7) return `overshoot${delta}`;
  return "overshoot>7";
}

function submitPreAdvancePcOpcodeKey(preAdvance: CommandSubmitPreAdvanceContextJson | undefined): string {
  if (preAdvance === undefined) return "?";
  if (preAdvance.inReset) return "reset";
  return `${preAdvance.pc ?? "????"}:${preAdvance.opcode ?? "??"}`;
}

function mameSoundPcVsSubmitPreAdvanceRelation(
  soundPc: number | undefined,
  preAdvance: CommandSubmitPreAdvanceContextJson | undefined,
): string {
  if (soundPc === undefined || preAdvance === undefined) return "?";
  const pc = hexWord(soundPc);
  if (preAdvance.pc === pc) return "pre-pc";
  if (preAdvance.currentChipIoStore?.pc === pc) return "pre-store-pc";
  return "other";
}

function booleanKey(value: boolean | undefined): string {
  return value === undefined ? "?" : value ? "true" : "false";
}

function makeNativeSampleMismatchContextAccumulator(args: Args): NativeSampleMismatchContextAccumulator {
  return {
    count: 0,
    nativeSampleTargetCycleOffset: {
      sampleRate: args.sampleRate,
      samplePhaseCycles: args.samplePhaseCycles,
      targetNativeSampleDelta: 0,
      ...makeEmptyDeltaStats(),
    },
    nativeSampleTargetCycleOffsetAbsSum: { value: 0 },
    nativeSampleTargetCycleOffsetHistogram: {},
    mameNativeSampleOffsetFromStart: {
      sampleRate: args.sampleRate,
      samplePhaseCycles: args.samplePhaseCycles,
      ...makeEmptyDeltaStats(),
    },
    mameNativeSampleOffsetFromStartAbsSum: { value: 0 },
    mameNativeSampleOffsetToEnd: {
      sampleRate: args.sampleRate,
      samplePhaseCycles: args.samplePhaseCycles,
      ...makeEmptyDeltaStats(),
    },
    mameNativeSampleOffsetToEndAbsSum: { value: 0 },
    tsNativeSampleOffsetFromStart: {
      sampleRate: args.sampleRate,
      samplePhaseCycles: args.samplePhaseCycles,
      ...makeEmptyDeltaStats(),
    },
    tsNativeSampleOffsetFromStartAbsSum: { value: 0 },
    tsNativeSampleOffsetToEnd: {
      sampleRate: args.sampleRate,
      samplePhaseCycles: args.samplePhaseCycles,
      ...makeEmptyDeltaStats(),
    },
    tsNativeSampleOffsetToEndAbsSum: { value: 0 },
    byMameNativeSampleOffsetFromStart: {},
    byMameNativeSampleOffsetToEnd: {},
    byTsNativeSampleOffsetFromStart: {},
    byTsNativeSampleOffsetToEnd: {},
    byRelation: {},
    byNativeSampleDelta: {},
    byNativeSampleDeltaAndTargetOffset: {},
    byNativeSampleDeltaAndTsOffsetToEnd: {},
    byNativeSampleDeltaAndMameOffsetToEnd: {},
    byNativeSampleDeltaAndPokeyApplyDelay: {},
    byPokeyApplyDelayAndTargetOffset: {},
    byNativeSampleDeltaAndWritePcOpcodeRegister: {},
    byNearestCommandSide: {},
    byNearestDeltaSign: {},
    byCommandByte: {},
    byCommandSoundPc: {},
    byCommandByteSoundPc: {},
    byWritePc: {},
    byWriteOpcode: {},
    byWritePcOpcode: {},
    byWriteRegister: {},
    byWritePcRegister: {},
    byWritePcOpcodeRegister: {},
    byFirstReadPc: {},
    byFirstReadDeltaFromCommand: {},
    byFirstReadPcDeltaFromCommand: {},
    bySubmitActualDeltaFromCommand: {},
    bySubmitActualCycleInFrame: {},
    bySubmitPreAdvanceDeltaToTarget: {},
    bySubmitPreAdvanceDeltaBucket: {},
    bySubmitPreAdvancePcOpcode: {},
    byMameSoundPcVsSubmitPreAdvanceRelation: {},
    bySubmitNmiDelayInstructions: {},
    bySubmitOverrideDelayInstructions: {},
    bySubmitPendingBefore: {},
    byRelationWriteOpcode: {},
    byNearestSignWriteOpcode: {},
    byCommandEdgeRule: {},
    byCommandEdgeRuleDeltaCycles: {},
    byCommandEdgeRuleTargetDelay: {},
    byCommandEdgeRuleWritePc: {},
  };
}

function updateNativeSampleMismatchContext(
  summary: NativeSampleMismatchContextAccumulator,
  ts: NormalizedWrite | undefined,
  mame: NormalizedWrite | undefined,
  nativeSampleDelta: number,
  nativeSampleTargetCycleOffset: number | undefined,
  commandContext: CommandContext | undefined,
  relation: NativeSampleMismatchCommandRelation,
  args: Args,
): void {
  const nearestCommand = commandContext?.nearest;
  const commandByte = hexByte(nearestCommand?.byte);
  const commandSoundPc = hexWord(nearestCommand?.soundPc);
  const writePc = ts?.pc ?? mame?.pc;
  const writeOpcode = ts?.opcode ?? mame?.opcode;
  const writeReg = ts?.reg ?? mame?.reg;
  const firstRead = nearestCommand?.firstTsCommandRead;
  const submit = nearestCommand?.submit;
  const preAdvance = submit?.preAdvance;
  const nearestSign = commandContextNearestDeltaSign(nearestCommand);
  const commandEdge = ts?.commandEdgeEventAdjust;
  const commandEdgeRule = commandEdge === undefined ? "none" : String(commandEdge.ruleIndex);
  const pokeyApplyDelay = numericKey(ts?.pokeyEffectiveApplyDelayCycles);
  const writePcOpcodeRegister = `${hexWord(writePc)}:${hexByte(writeOpcode)}:${hexByte(writeReg)}`;
  const submitActualDeltaFromCommand = submit === undefined || nearestCommand === undefined
    ? undefined
    : submit.actualCycle - nearestCommand.replayCycle;
  let mameOffsetToEnd: number | undefined;
  let tsOffsetToEnd: number | undefined;

  summary.count++;
  if (nativeSampleTargetCycleOffset !== undefined) {
    addDelta(
      summary.nativeSampleTargetCycleOffset,
      summary.nativeSampleTargetCycleOffsetAbsSum,
      nativeSampleTargetCycleOffset,
    );
    incrementHistogram(summary.nativeSampleTargetCycleOffsetHistogram, String(nativeSampleTargetCycleOffset));
  }
  const mamePhase = nativeSamplePhaseFor(mame?.replayCycle, args.sampleRate, args.samplePhaseCycles);
  if (mamePhase !== undefined) {
    addDelta(
      summary.mameNativeSampleOffsetFromStart,
      summary.mameNativeSampleOffsetFromStartAbsSum,
      mamePhase.offsetFromStart,
    );
    addDelta(
      summary.mameNativeSampleOffsetToEnd,
      summary.mameNativeSampleOffsetToEndAbsSum,
      mamePhase.offsetToEnd,
    );
    mameOffsetToEnd = mamePhase.offsetToEnd;
    incrementHistogram(summary.byMameNativeSampleOffsetFromStart, String(mamePhase.offsetFromStart));
    incrementHistogram(summary.byMameNativeSampleOffsetToEnd, String(mamePhase.offsetToEnd));
  }
  const tsPhase = nativeSamplePhaseFor(ts?.replayCycle, args.sampleRate, args.samplePhaseCycles);
  if (tsPhase !== undefined) {
    addDelta(
      summary.tsNativeSampleOffsetFromStart,
      summary.tsNativeSampleOffsetFromStartAbsSum,
      tsPhase.offsetFromStart,
    );
    addDelta(
      summary.tsNativeSampleOffsetToEnd,
      summary.tsNativeSampleOffsetToEndAbsSum,
      tsPhase.offsetToEnd,
    );
    tsOffsetToEnd = tsPhase.offsetToEnd;
    incrementHistogram(summary.byTsNativeSampleOffsetFromStart, String(tsPhase.offsetFromStart));
    incrementHistogram(summary.byTsNativeSampleOffsetToEnd, String(tsPhase.offsetToEnd));
  }
  incrementHistogram(summary.byRelation, relation);
  incrementHistogram(summary.byNativeSampleDelta, String(nativeSampleDelta));
  incrementHistogram(
    summary.byNativeSampleDeltaAndTargetOffset,
    `${nativeSampleDelta}:${numericKey(nativeSampleTargetCycleOffset)}`,
  );
  incrementHistogram(
    summary.byNativeSampleDeltaAndTsOffsetToEnd,
    `${nativeSampleDelta}:${numericKey(tsOffsetToEnd)}`,
  );
  incrementHistogram(
    summary.byNativeSampleDeltaAndMameOffsetToEnd,
    `${nativeSampleDelta}:${numericKey(mameOffsetToEnd)}`,
  );
  incrementHistogram(summary.byNativeSampleDeltaAndPokeyApplyDelay, `${nativeSampleDelta}:${pokeyApplyDelay}`);
  incrementHistogram(
    summary.byPokeyApplyDelayAndTargetOffset,
    `${pokeyApplyDelay}:${numericKey(nativeSampleTargetCycleOffset)}`,
  );
  incrementHistogram(summary.byNativeSampleDeltaAndWritePcOpcodeRegister, `${nativeSampleDelta}:${writePcOpcodeRegister}`);
  incrementHistogram(summary.byNearestCommandSide, commandContextNearestSide(commandContext));
  incrementHistogram(summary.byNearestDeltaSign, nearestSign);
  incrementHistogram(summary.byCommandByte, commandByte);
  incrementHistogram(summary.byCommandSoundPc, commandSoundPc);
  incrementHistogram(summary.byCommandByteSoundPc, `${commandByte}@${commandSoundPc}`);
  incrementHistogram(summary.byWritePc, hexWord(writePc));
  incrementHistogram(summary.byWriteOpcode, hexByte(writeOpcode));
  incrementHistogram(summary.byWritePcOpcode, `${hexWord(writePc)}:${hexByte(writeOpcode)}`);
  incrementHistogram(summary.byWriteRegister, hexByte(writeReg));
  incrementHistogram(summary.byWritePcRegister, `${hexWord(writePc)}:${hexByte(writeReg)}`);
  incrementHistogram(summary.byWritePcOpcodeRegister, writePcOpcodeRegister);
  incrementHistogram(summary.byFirstReadPc, hexWord(firstRead?.pc));
  incrementHistogram(summary.byFirstReadDeltaFromCommand, numericKey(firstRead?.deltaFromCommand));
  incrementHistogram(summary.byFirstReadPcDeltaFromCommand, `${hexWord(firstRead?.pc)}:${numericKey(firstRead?.deltaFromCommand)}`);
  incrementHistogram(summary.bySubmitActualDeltaFromCommand, numericKey(submitActualDeltaFromCommand));
  incrementHistogram(summary.bySubmitActualCycleInFrame, numericKey(submit?.actualCycleInFrame));
  incrementHistogram(summary.bySubmitPreAdvanceDeltaToTarget, numericKey(preAdvance?.deltaToTarget));
  incrementHistogram(summary.bySubmitPreAdvanceDeltaBucket, submitPreAdvanceDeltaBucket(preAdvance?.deltaToTarget));
  incrementHistogram(summary.bySubmitPreAdvancePcOpcode, submitPreAdvancePcOpcodeKey(preAdvance));
  incrementHistogram(
    summary.byMameSoundPcVsSubmitPreAdvanceRelation,
    mameSoundPcVsSubmitPreAdvanceRelation(nearestCommand?.soundPc, preAdvance),
  );
  incrementHistogram(summary.bySubmitNmiDelayInstructions, numericKey(submit?.commandNmiDelayInstructions));
  incrementHistogram(summary.bySubmitOverrideDelayInstructions, numericKey(submit?.overrideDelayInstructions));
  incrementHistogram(summary.bySubmitPendingBefore, booleanKey(submit?.pendingBefore));
  incrementHistogram(summary.byRelationWriteOpcode, `${relation}:${hexByte(writeOpcode)}`);
  incrementHistogram(summary.byNearestSignWriteOpcode, `${nearestSign}:${hexByte(writeOpcode)}`);
  incrementHistogram(summary.byCommandEdgeRule, commandEdgeRule);
  incrementHistogram(
    summary.byCommandEdgeRuleDeltaCycles,
    `${commandEdgeRule}:${numericKey(commandEdge?.deltaCycles)}`,
  );
  incrementHistogram(
    summary.byCommandEdgeRuleTargetDelay,
    `${commandEdgeRule}:${numericKey(commandEdge?.targetDelayCycles)}`,
  );
  incrementHistogram(summary.byCommandEdgeRuleWritePc, `${commandEdgeRule}:${hexWord(writePc)}`);
}

function finalizedNativeSampleMismatchContext(
  summary: NativeSampleMismatchContextAccumulator,
): NativeSampleMismatchContextSummary {
  return {
    count: summary.count,
    nativeSampleTargetCycleOffset: summary.nativeSampleTargetCycleOffset,
    nativeSampleTargetCycleOffsetHistogram: topHistogram(summary.nativeSampleTargetCycleOffsetHistogram),
    mameNativeSampleOffsetFromStart: summary.mameNativeSampleOffsetFromStart,
    mameNativeSampleOffsetToEnd: summary.mameNativeSampleOffsetToEnd,
    tsNativeSampleOffsetFromStart: summary.tsNativeSampleOffsetFromStart,
    tsNativeSampleOffsetToEnd: summary.tsNativeSampleOffsetToEnd,
    byMameNativeSampleOffsetFromStart: topHistogram(summary.byMameNativeSampleOffsetFromStart),
    byMameNativeSampleOffsetToEnd: topHistogram(summary.byMameNativeSampleOffsetToEnd),
    byTsNativeSampleOffsetFromStart: topHistogram(summary.byTsNativeSampleOffsetFromStart),
    byTsNativeSampleOffsetToEnd: topHistogram(summary.byTsNativeSampleOffsetToEnd),
    byRelation: topHistogram(summary.byRelation),
    byNativeSampleDelta: topHistogram(summary.byNativeSampleDelta),
    byNativeSampleDeltaAndTargetOffset: topHistogram(summary.byNativeSampleDeltaAndTargetOffset),
    byNativeSampleDeltaAndTsOffsetToEnd: topHistogram(summary.byNativeSampleDeltaAndTsOffsetToEnd),
    byNativeSampleDeltaAndMameOffsetToEnd: topHistogram(summary.byNativeSampleDeltaAndMameOffsetToEnd),
    byNativeSampleDeltaAndPokeyApplyDelay: topHistogram(summary.byNativeSampleDeltaAndPokeyApplyDelay),
    byPokeyApplyDelayAndTargetOffset: topHistogram(summary.byPokeyApplyDelayAndTargetOffset),
    byNativeSampleDeltaAndWritePcOpcodeRegister: topHistogram(summary.byNativeSampleDeltaAndWritePcOpcodeRegister),
    byNearestCommandSide: topHistogram(summary.byNearestCommandSide),
    byNearestDeltaSign: topHistogram(summary.byNearestDeltaSign),
    byCommandByte: topHistogram(summary.byCommandByte),
    byCommandSoundPc: topHistogram(summary.byCommandSoundPc),
    byCommandByteSoundPc: topHistogram(summary.byCommandByteSoundPc),
    byWritePc: topHistogram(summary.byWritePc),
    byWriteOpcode: topHistogram(summary.byWriteOpcode),
    byWritePcOpcode: topHistogram(summary.byWritePcOpcode),
    byWriteRegister: topHistogram(summary.byWriteRegister),
    byWritePcRegister: topHistogram(summary.byWritePcRegister),
    byWritePcOpcodeRegister: topHistogram(summary.byWritePcOpcodeRegister),
    byFirstReadPc: topHistogram(summary.byFirstReadPc),
    byFirstReadDeltaFromCommand: topHistogram(summary.byFirstReadDeltaFromCommand),
    byFirstReadPcDeltaFromCommand: topHistogram(summary.byFirstReadPcDeltaFromCommand),
    bySubmitActualDeltaFromCommand: topHistogram(summary.bySubmitActualDeltaFromCommand),
    bySubmitActualCycleInFrame: topHistogram(summary.bySubmitActualCycleInFrame),
    bySubmitPreAdvanceDeltaToTarget: topHistogram(summary.bySubmitPreAdvanceDeltaToTarget),
    bySubmitPreAdvanceDeltaBucket: topHistogram(summary.bySubmitPreAdvanceDeltaBucket),
    bySubmitPreAdvancePcOpcode: topHistogram(summary.bySubmitPreAdvancePcOpcode),
    byMameSoundPcVsSubmitPreAdvanceRelation: topHistogram(summary.byMameSoundPcVsSubmitPreAdvanceRelation),
    bySubmitNmiDelayInstructions: topHistogram(summary.bySubmitNmiDelayInstructions),
    bySubmitOverrideDelayInstructions: topHistogram(summary.bySubmitOverrideDelayInstructions),
    bySubmitPendingBefore: topHistogram(summary.bySubmitPendingBefore),
    byRelationWriteOpcode: topHistogram(summary.byRelationWriteOpcode),
    byNearestSignWriteOpcode: topHistogram(summary.byNearestSignWriteOpcode),
    byCommandEdgeRule: topHistogram(summary.byCommandEdgeRule),
    byCommandEdgeRuleDeltaCycles: topHistogram(summary.byCommandEdgeRuleDeltaCycles),
    byCommandEdgeRuleTargetDelay: topHistogram(summary.byCommandEdgeRuleTargetDelay),
    byCommandEdgeRuleWritePc: topHistogram(summary.byCommandEdgeRuleWritePc),
  };
}

function makeInstructionFetchDeltaSummary(): InstructionFetchDeltaSummary {
  return {
    count: 0,
    tsWriteOffsetDelta: makeEmptyDeltaStats(),
    tsRawWriteOffsetDelta: makeEmptyDeltaStats(),
    byMameInstDeltaCycles: {},
    byMameInstOpcode: {},
    byMameInstPcOpcode: {},
    byTsWriteOffset: {},
    byTsRawWriteOffset: {},
    byTsMinusMameInstDelta: {},
    byTsRawMinusMameInstDelta: {},
    byWritePc: {},
    byWritePcOpcode: {},
  };
}

function updateInstructionFetchDeltaSummary(
  summary: InstructionFetchDeltaSummary,
  ts: NormalizedWrite | undefined,
  mame: NormalizedWrite | undefined,
  tsWriteOffsetAbsSum: { value: number },
  tsRawWriteOffsetAbsSum: { value: number },
): void {
  if (mame?.instDeltaCycles === undefined) return;
  summary.count++;
  incrementHistogram(summary.byMameInstDeltaCycles, String(mame.instDeltaCycles));
  incrementHistogram(summary.byMameInstOpcode, hexByte(mame.instOpcode));
  incrementHistogram(summary.byMameInstPcOpcode, `${hexWord(mame.instPc)}:${hexByte(mame.instOpcode)}`);
  incrementHistogram(summary.byWritePc, hexWord(mame.pc));
  incrementHistogram(summary.byWritePcOpcode, `${hexWord(mame.pc)}:${hexByte(mame.opcode)}`);
  incrementHistogram(summary.byTsWriteOffset, numericKey(ts?.writeCycleOffset));
  incrementHistogram(summary.byTsRawWriteOffset, numericKey(ts?.rawWriteCycleOffset));
  if (ts?.writeCycleOffset !== undefined) {
    const delta = ts.writeCycleOffset - mame.instDeltaCycles;
    addDelta(summary.tsWriteOffsetDelta, tsWriteOffsetAbsSum, delta);
    incrementHistogram(summary.byTsMinusMameInstDelta, String(delta));
  }
  if (ts?.rawWriteCycleOffset !== undefined) {
    const delta = ts.rawWriteCycleOffset - mame.instDeltaCycles;
    addDelta(summary.tsRawWriteOffsetDelta, tsRawWriteOffsetAbsSum, delta);
    incrementHistogram(summary.byTsRawMinusMameInstDelta, String(delta));
  }
}

function finalizedInstructionFetchDeltaSummary(
  summary: InstructionFetchDeltaSummary,
): InstructionFetchDeltaSummary {
  return {
    count: summary.count,
    tsWriteOffsetDelta: summary.tsWriteOffsetDelta,
    tsRawWriteOffsetDelta: summary.tsRawWriteOffsetDelta,
    byMameInstDeltaCycles: topHistogram(summary.byMameInstDeltaCycles),
    byMameInstOpcode: topHistogram(summary.byMameInstOpcode),
    byMameInstPcOpcode: topHistogram(summary.byMameInstPcOpcode),
    byTsWriteOffset: topHistogram(summary.byTsWriteOffset),
    byTsRawWriteOffset: topHistogram(summary.byTsRawWriteOffset),
    byTsMinusMameInstDelta: topHistogram(summary.byTsMinusMameInstDelta),
    byTsRawMinusMameInstDelta: topHistogram(summary.byTsRawMinusMameInstDelta),
    byWritePc: topHistogram(summary.byWritePc),
    byWritePcOpcode: topHistogram(summary.byWritePcOpcode),
  };
}

type RawBusWriteParityAccumulator = RawBusWriteParitySummary & {
  replayCycleDeltaAbsSum: { value: number };
  writeOffsetDeltaAbsSum: { value: number };
  frameDriftByFrame: Map<string, RawBusFrameDriftEntry & { replayCycleDeltaAbsSum: { value: number } }>;
};

function makeRawBusWriteParityAccumulator(args: Args): RawBusWriteParityAccumulator {
  return {
    required: args.requireRawBusWriteParity,
    mode: args.rawBusWriteParityMode,
    toleranceCycles: args.rawBusWriteToleranceCycles,
    maxMismatches: args.rawBusWriteMaxMismatches,
    passed: true,
    compared: 0,
    timingCompared: 0,
    missingTimingCount: 0,
    orderPayloadMismatchCount: 0,
    mismatchCount: 0,
    replayCycleDelta: makeEmptyDeltaStats(),
    writeOffsetDelta: makeEmptyDeltaStats(),
    replayCycleDeltaAbsSum: { value: 0 },
    writeOffsetDeltaAbsSum: { value: 0 },
    replayCycleDeltaHistogram: {},
    writeOffsetDeltaHistogram: {},
    frameDrift: [],
    frameDriftByFrame: new Map(),
    firstMismatch: undefined,
  };
}

function sortedNumericHistogram(histogram: Record<string, number>): Record<string, number> {
  return Object.fromEntries(
    Object.entries(histogram).sort((a, b) => Number(a[0]) - Number(b[0])),
  );
}

function updateRawBusWriteParity(
  summary: RawBusWriteParityAccumulator,
  index: number,
  ts: NormalizedWrite | undefined,
  mame: NormalizedWrite | undefined,
): void {
  summary.compared++;
  const reasons: string[] = [];
  if (ts === undefined || mame === undefined) {
    reasons.push("missing");
    summary.missingTimingCount++;
  } else {
    if (ts.reg !== mame.reg) reasons.push("reg");
    if (ts.val !== mame.val) reasons.push("val");
    if (ts.pc !== undefined && mame.pc !== undefined && ts.pc !== mame.pc) reasons.push("pc");

    const replayCycleDelta = ts.busReplayCycle === undefined || mame.busReplayCycle === undefined
      ? undefined
      : ts.busReplayCycle - mame.busReplayCycle;
    const mameWriteOffset = mame.busWriteCycleOffset ?? mame.instDeltaCycles;
    const writeOffsetDelta = ts.busWriteCycleOffset === undefined || mameWriteOffset === undefined
      ? undefined
      : ts.busWriteCycleOffset - mameWriteOffset;

    if (replayCycleDelta !== undefined) {
      summary.timingCompared++;
      addDelta(summary.replayCycleDelta, summary.replayCycleDeltaAbsSum, replayCycleDelta);
      incrementHistogram(summary.replayCycleDeltaHistogram, String(replayCycleDelta));
      updateRawBusFrameDrift(summary, index, ts, mame, replayCycleDelta);
      if (summary.mode !== "offset" && Math.abs(replayCycleDelta) > summary.toleranceCycles) {
        reasons.push("rawReplayCycle");
      }
    } else if (summary.mode !== "offset") {
      reasons.push("rawReplayCycleMissing");
      summary.missingTimingCount++;
    }

    if (writeOffsetDelta !== undefined) {
      addDelta(summary.writeOffsetDelta, summary.writeOffsetDeltaAbsSum, writeOffsetDelta);
      incrementHistogram(summary.writeOffsetDeltaHistogram, String(writeOffsetDelta));
      if (summary.mode !== "absolute" && Math.abs(writeOffsetDelta) > summary.toleranceCycles) {
        reasons.push("rawWriteOffset");
      }
    } else if (summary.mode !== "absolute") {
      reasons.push("rawWriteOffsetMissing");
    }

    if (reasons.some((reason) => reason === "reg" || reason === "val" || reason === "pc")) {
      summary.orderPayloadMismatchCount++;
    }
  }

  if (reasons.length === 0) return;
  summary.mismatchCount++;
  const firstMameWriteOffset = mame?.busWriteCycleOffset ?? mame?.instDeltaCycles;
  summary.firstMismatch ??= {
    index,
    reasons,
    replayCycleDelta: ts?.busReplayCycle === undefined || mame?.busReplayCycle === undefined
      ? undefined
      : ts.busReplayCycle - mame.busReplayCycle,
    writeOffsetDelta: ts?.busWriteCycleOffset === undefined || firstMameWriteOffset === undefined
      ? undefined
      : ts.busWriteCycleOffset - firstMameWriteOffset,
    ts,
    mame,
  };
}

function rawBusFrameDriftKey(
  ts: NormalizedWrite | undefined,
  mame: NormalizedWrite | undefined,
): string {
  const tsFrame = ts?.frame;
  const mameFrame = mame?.frame;
  if (tsFrame === undefined && mameFrame === undefined) return "?";
  if (tsFrame === mameFrame || tsFrame === undefined) return String(mameFrame);
  if (mameFrame === undefined) return String(tsFrame);
  return `${tsFrame}->${mameFrame}`;
}

function updateRawBusFrameDrift(
  summary: RawBusWriteParityAccumulator,
  index: number,
  ts: NormalizedWrite | undefined,
  mame: NormalizedWrite | undefined,
  replayCycleDelta: number,
): void {
  const frame = rawBusFrameDriftKey(ts, mame);
  let entry = summary.frameDriftByFrame.get(frame);
  if (entry === undefined) {
    entry = {
      frame,
      compared: 0,
      firstIndex: index,
      firstReplayCycleDelta: replayCycleDelta,
      replayCycleDelta: makeEmptyDeltaStats(),
      replayCycleDeltaAbsSum: { value: 0 },
      replayCycleDeltaHistogram: {},
      firstTs: ts,
      firstMame: mame,
    };
    summary.frameDriftByFrame.set(frame, entry);
  }
  entry.compared++;
  addDelta(entry.replayCycleDelta, entry.replayCycleDeltaAbsSum, replayCycleDelta);
  incrementHistogram(entry.replayCycleDeltaHistogram, String(replayCycleDelta));
}

function finalizedRawBusWriteParity(
  summary: RawBusWriteParityAccumulator,
): RawBusWriteParitySummary {
  return {
    required: summary.required,
    mode: summary.mode,
    toleranceCycles: summary.toleranceCycles,
    maxMismatches: summary.maxMismatches,
    passed: summary.mismatchCount <= summary.maxMismatches,
    compared: summary.compared,
    timingCompared: summary.timingCompared,
    missingTimingCount: summary.missingTimingCount,
    orderPayloadMismatchCount: summary.orderPayloadMismatchCount,
    mismatchCount: summary.mismatchCount,
    replayCycleDelta: summary.replayCycleDelta,
    writeOffsetDelta: summary.writeOffsetDelta,
    replayCycleDeltaHistogram: sortedNumericHistogram(summary.replayCycleDeltaHistogram),
    writeOffsetDeltaHistogram: sortedNumericHistogram(summary.writeOffsetDeltaHistogram),
    frameDrift: Array.from(summary.frameDriftByFrame.values())
      .sort((a, b) =>
        (b.replayCycleDelta.maxAbs ?? -1) - (a.replayCycleDelta.maxAbs ?? -1) ||
        b.compared - a.compared ||
        a.firstIndex - b.firstIndex)
      .slice(0, 24)
      .map((entry) => ({
        frame: entry.frame,
        compared: entry.compared,
        firstIndex: entry.firstIndex,
        firstReplayCycleDelta: entry.firstReplayCycleDelta,
        replayCycleDelta: entry.replayCycleDelta,
        replayCycleDeltaHistogram: sortedNumericHistogram(entry.replayCycleDeltaHistogram),
        firstTs: entry.firstTs,
        firstMame: entry.firstMame,
      })),
    firstMismatch: summary.firstMismatch,
  };
}

function updateNativeSampleCommandMismatchBreakdowns(
  entries: Map<string, NativeSampleCommandMismatchBreakdownAccumulator>,
  index: number,
  ts: NormalizedWrite | undefined,
  mame: NormalizedWrite | undefined,
  nativeSampleDelta: number,
  nativeSampleTargetCycleOffset: number | undefined,
  commandContext: CommandContext | undefined,
  relation: NativeSampleMismatchCommandRelation,
  args: Args,
): void {
  const nearestCommand = commandContext?.nearest;
  const commandByte = nearestCommand === undefined ? undefined : hexByte(nearestCommand.byte);
  const commandSoundPc = nearestCommand === undefined ? undefined : hexWord(nearestCommand.soundPc);
  const label = `${relation}:${commandByte ?? "?"}@${commandSoundPc ?? "?"}`;
  let entry = entries.get(label);
  const replayCycleDelta = ts?.replayCycle === undefined || mame?.replayCycle === undefined
    ? undefined
    : ts.replayCycle - mame.replayCycle;
  const tsDeltaFromCommand = nearestCommand?.tsDelta;
  const mameDeltaFromCommand = nearestCommand?.mameDelta;
  const targetDelayWindowFromCommand = targetDelayWindowFromCommandForNativeSample(mame, nearestCommand, args);
  if (entry === undefined) {
    entry = {
      label,
      relation,
      commandByte,
      commandSoundPc,
      count: 0,
      firstMismatch: {
        index,
        nativeSampleDelta,
        replayCycleDelta,
        ts,
        mame,
        commandContext,
      },
      replayCycleDelta: makeEmptyDeltaStats(),
      replayCycleDeltaAbsSum: { value: 0 },
      nativeSampleDelta: {
        sampleRate: args.sampleRate,
        samplePhaseCycles: args.samplePhaseCycles,
        ...makeEmptyDeltaStats(),
      },
      nativeSampleDeltaAbsSum: { value: 0 },
      nativeSampleDeltaHistogram: {},
      nativeSampleTargetCycleOffset: {
        sampleRate: args.sampleRate,
        samplePhaseCycles: args.samplePhaseCycles,
        targetNativeSampleDelta: 0,
        ...makeEmptyDeltaStats(),
      },
      nativeSampleTargetCycleOffsetAbsSum: { value: 0 },
      nativeSampleTargetCycleOffsetHistogram: {},
      tsDeltaFromCommand: makeEmptyDeltaStats(),
      tsDeltaFromCommandAbsSum: { value: 0 },
      mameDeltaFromCommand: makeEmptyDeltaStats(),
      mameDeltaFromCommandAbsSum: { value: 0 },
      targetDelayWindowFromCommand: {
        sampleRate: args.sampleRate,
        sampleTolerance: args.sampleTolerance,
        compared: 0,
        minStart: undefined,
        maxStart: undefined,
        minEnd: undefined,
        maxEnd: undefined,
        intersectionMin: undefined,
        intersectionMax: undefined,
        hasIntersection: undefined,
      },
      byTsDeltaFromCommand: {},
      byMameDeltaFromCommand: {},
      byTargetDelayWindowFromCommand: {},
      byNearestCommandSide: {},
      byNearestDeltaSign: {},
      byWritePc: {},
      byWriteOpcode: {},
      byWritePcOpcode: {},
      byWriteRegister: {},
      byWritePcRegister: {},
      byWritePcOpcodeRegister: {},
      byFirstReadPc: {},
      byFirstReadPcDeltaFromCommand: {},
      byFirstReadDeltaFromCommand: {},
      byFirstReadDeltaFromTsWrite: {},
      bySubmitActualDeltaFromCommand: {},
      bySubmitActualCycleInFrame: {},
      bySubmitNmiDelayInstructions: {},
      bySubmitOverrideDelayInstructions: {},
      bySubmitPendingBefore: {},
    };
    entries.set(label, entry);
  }
  entry.count++;
  if (replayCycleDelta !== undefined) addDelta(entry.replayCycleDelta, entry.replayCycleDeltaAbsSum, replayCycleDelta);
  addDelta(entry.nativeSampleDelta, entry.nativeSampleDeltaAbsSum, nativeSampleDelta);
  incrementHistogram(entry.nativeSampleDeltaHistogram, String(nativeSampleDelta));
  if (nativeSampleTargetCycleOffset !== undefined) {
    addDelta(
      entry.nativeSampleTargetCycleOffset,
      entry.nativeSampleTargetCycleOffsetAbsSum,
      nativeSampleTargetCycleOffset,
    );
    incrementHistogram(entry.nativeSampleTargetCycleOffsetHistogram, String(nativeSampleTargetCycleOffset));
  }
  if (tsDeltaFromCommand !== undefined) addDelta(entry.tsDeltaFromCommand, entry.tsDeltaFromCommandAbsSum, tsDeltaFromCommand);
  if (mameDeltaFromCommand !== undefined) {
    addDelta(entry.mameDeltaFromCommand, entry.mameDeltaFromCommandAbsSum, mameDeltaFromCommand);
  }
  incrementHistogram(entry.byTsDeltaFromCommand, numericKey(tsDeltaFromCommand));
  incrementHistogram(entry.byMameDeltaFromCommand, numericKey(mameDeltaFromCommand));
  addTargetDelayWindowFromCommand(entry, targetDelayWindowFromCommand);
  const writePc = ts?.pc ?? mame?.pc;
  const writeOpcode = ts?.opcode ?? mame?.opcode;
  const writeReg = ts?.reg ?? mame?.reg;
  const firstRead = nearestCommand?.firstTsCommandRead;
  const submit = nearestCommand?.submit;
  const submitActualDeltaFromCommand = submit === undefined || nearestCommand === undefined
    ? undefined
    : submit.actualCycle - nearestCommand.replayCycle;
  incrementHistogram(entry.byNearestCommandSide, commandContextNearestSide(commandContext));
  incrementHistogram(entry.byNearestDeltaSign, commandContextNearestDeltaSign(nearestCommand));
  incrementHistogram(entry.byWritePc, hexWord(writePc));
  incrementHistogram(entry.byWriteOpcode, hexByte(writeOpcode));
  incrementHistogram(entry.byWritePcOpcode, `${hexWord(writePc)}:${hexByte(writeOpcode)}`);
  incrementHistogram(entry.byWriteRegister, hexByte(writeReg));
  incrementHistogram(entry.byWritePcRegister, `${hexWord(writePc)}:${hexByte(writeReg)}`);
  incrementHistogram(entry.byWritePcOpcodeRegister, `${hexWord(writePc)}:${hexByte(writeOpcode)}:${hexByte(writeReg)}`);
  incrementHistogram(entry.byFirstReadPc, hexWord(firstRead?.pc));
  incrementHistogram(entry.byFirstReadPcDeltaFromCommand, `${hexWord(firstRead?.pc)}:${numericKey(firstRead?.deltaFromCommand)}`);
  incrementHistogram(entry.byFirstReadDeltaFromCommand, numericKey(nearestCommand?.firstTsCommandRead?.deltaFromCommand));
  incrementHistogram(entry.byFirstReadDeltaFromTsWrite, numericKey(nearestCommand?.firstTsCommandRead?.deltaFromTsWrite));
  incrementHistogram(entry.bySubmitActualDeltaFromCommand, numericKey(submitActualDeltaFromCommand));
  incrementHistogram(entry.bySubmitActualCycleInFrame, numericKey(submit?.actualCycleInFrame));
  incrementHistogram(entry.bySubmitNmiDelayInstructions, numericKey(submit?.commandNmiDelayInstructions));
  incrementHistogram(entry.bySubmitOverrideDelayInstructions, numericKey(submit?.overrideDelayInstructions));
  incrementHistogram(entry.bySubmitPendingBefore, booleanKey(submit?.pendingBefore));
}

function finalizedNativeSampleCommandMismatchBreakdown(
  entries: Map<string, NativeSampleCommandMismatchBreakdownAccumulator>,
): NativeSampleCommandMismatchBreakdownEntry[] {
  return Array.from(entries.values())
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .map((entry) => ({
      label: entry.label,
      relation: entry.relation,
      commandByte: entry.commandByte,
      commandSoundPc: entry.commandSoundPc,
      count: entry.count,
      firstMismatch: entry.firstMismatch,
      replayCycleDelta: entry.replayCycleDelta,
      nativeSampleDelta: entry.nativeSampleDelta,
      nativeSampleDeltaHistogram: Object.fromEntries(
        Object.entries(entry.nativeSampleDeltaHistogram)
          .sort((a, b) => Number(a[0]) - Number(b[0])),
      ),
      nativeSampleTargetCycleOffset: entry.nativeSampleTargetCycleOffset,
      nativeSampleTargetCycleOffsetHistogram: topHistogram(entry.nativeSampleTargetCycleOffsetHistogram),
      tsDeltaFromCommand: entry.tsDeltaFromCommand,
      mameDeltaFromCommand: entry.mameDeltaFromCommand,
      targetDelayWindowFromCommand: entry.targetDelayWindowFromCommand,
      byTsDeltaFromCommand: topHistogram(entry.byTsDeltaFromCommand),
      byMameDeltaFromCommand: topHistogram(entry.byMameDeltaFromCommand),
      byTargetDelayWindowFromCommand: topHistogram(entry.byTargetDelayWindowFromCommand),
      byNearestCommandSide: topHistogram(entry.byNearestCommandSide),
      byNearestDeltaSign: topHistogram(entry.byNearestDeltaSign),
      byWritePc: topHistogram(entry.byWritePc),
      byWriteOpcode: topHistogram(entry.byWriteOpcode),
      byWritePcOpcode: topHistogram(entry.byWritePcOpcode),
      byWriteRegister: topHistogram(entry.byWriteRegister),
      byWritePcRegister: topHistogram(entry.byWritePcRegister),
      byWritePcOpcodeRegister: topHistogram(entry.byWritePcOpcodeRegister),
      byFirstReadPc: topHistogram(entry.byFirstReadPc),
      byFirstReadPcDeltaFromCommand: topHistogram(entry.byFirstReadPcDeltaFromCommand),
      byFirstReadDeltaFromCommand: topHistogram(entry.byFirstReadDeltaFromCommand),
      byFirstReadDeltaFromTsWrite: topHistogram(entry.byFirstReadDeltaFromTsWrite),
      bySubmitActualDeltaFromCommand: topHistogram(entry.bySubmitActualDeltaFromCommand),
      bySubmitActualCycleInFrame: topHistogram(entry.bySubmitActualCycleInFrame),
      bySubmitNmiDelayInstructions: topHistogram(entry.bySubmitNmiDelayInstructions),
      bySubmitOverrideDelayInstructions: topHistogram(entry.bySubmitOverrideDelayInstructions),
      bySubmitPendingBefore: topHistogram(entry.bySubmitPendingBefore),
    }));
}

type PcDeltaReportAccumulator = PcDeltaReportEntry & {
  replayCycleDeltaAbsSum: { value: number };
  nativeSampleDeltaAbsSum: { value: number };
  nativeSampleMismatchTargetCycleOffsetAbsSum: { value: number };
  intervalDeltaAbsSum: { value: number };
  offsetSweepAccumulators: PcDeltaOffsetSweepAccumulator[] | undefined;
  lastIntervalForCatchUp: PcDeltaReportEntry["intervalCatchUpPairs"][number]["first"] | undefined;
  lastTsReplayCycle: number | undefined;
  lastMameReplayCycle: number | undefined;
  lastComparedIndex: number | undefined;
  previousTs: NormalizedWrite | undefined;
  previousMame: NormalizedWrite | undefined;
  previousCommandContext: CommandContext | undefined;
};

type PcDeltaOffsetSweepAccumulator = PcDeltaOffsetSweepEntry & {
  nativeSampleDeltaAbsSum: { value: number };
};

const PC_DELTA_CATCH_UP_INTERVAL_MIN_ABS = 32;
const PC_DELTA_CATCH_UP_NET_MAX_ABS = 8;

function pcMatchesSelection(
  ts: NormalizedWrite | undefined,
  mame: NormalizedWrite | undefined,
  selectedPcs: readonly number[] | undefined,
): boolean {
  if (selectedPcs === undefined) return true;
  return (ts?.pc !== undefined && selectedPcs.includes(ts.pc)) ||
    (mame?.pc !== undefined && selectedPcs.includes(mame.pc));
}

function updatePcDeltaReport(
  clusters: Map<string, PcDeltaReportAccumulator>,
  index: number,
  ts: NormalizedWrite | undefined,
  mame: NormalizedWrite | undefined,
  fields: readonly string[],
  args: Args,
  commandContext: CommandContext | undefined,
): void {
  if (!args.pcDeltaReport || !pcMatchesSelection(ts, mame, args.pcDeltaReportPcs)) return;
  if (ts?.pc === undefined && mame?.pc === undefined) return;
  const key = pcClusterKey(ts, mame);
  let cluster = clusters.get(key);
  if (cluster === undefined) {
    cluster = {
      pc: key,
      compared: 0,
      mismatchCount: 0,
      firstIndex: index,
      lastIndex: index,
      firstTs: ts,
      firstMame: mame,
      lastTs: ts,
      lastMame: mame,
      fieldCounts: {},
      replayCycleDelta: makeEmptyDeltaStats(),
      replayCycleDeltaAbsSum: { value: 0 },
      nativeSampleDelta: {
        sampleRate: args.sampleRate,
        samplePhaseCycles: args.samplePhaseCycles,
        ...makeEmptyDeltaStats(),
      },
      nativeSampleDeltaAbsSum: { value: 0 },
      nativeSampleDeltaHistogram: {},
      nativeSampleMismatchTargetCycleOffset: {
        sampleRate: args.sampleRate,
        samplePhaseCycles: args.samplePhaseCycles,
        targetNativeSampleDelta: 0,
        ...makeEmptyDeltaStats(),
      },
      nativeSampleMismatchTargetCycleOffsetAbsSum: { value: 0 },
      nativeSampleMismatchTargetCycleOffsetHistogram: {},
      intervalDelta: makeEmptyDeltaStats(),
      intervalDeltaAbsSum: { value: 0 },
      offsetSweepAccumulators: args.pcDeltaOffsetSweepCycles === undefined
        ? undefined
        : args.pcDeltaOffsetSweepCycles.map((offsetCycles) => ({
            offsetCycles,
            mismatchCount: 0,
            nativeSampleDelta: {
              sampleRate: args.sampleRate,
              samplePhaseCycles: args.samplePhaseCycles,
              ...makeEmptyDeltaStats(),
            },
            nativeSampleDeltaAbsSum: { value: 0 },
            nativeSampleDeltaHistogram: {},
          })),
      firstReplayCycleDelta: undefined,
      lastReplayCycleDelta: undefined,
      driftReplayCycleDelta: undefined,
      mismatchSamples: [],
      intervalOutliers: [],
      intervalCatchUpPairs: [],
      lastIntervalForCatchUp: undefined,
      lastTsReplayCycle: undefined,
      lastMameReplayCycle: undefined,
      lastComparedIndex: undefined,
      previousTs: undefined,
      previousMame: undefined,
      previousCommandContext: undefined,
    };
    clusters.set(key, cluster);
  }
  cluster.compared++;
  cluster.lastIndex = index;
  cluster.lastTs = ts;
  cluster.lastMame = mame;
  if (fields.length > 0) {
    cluster.mismatchCount++;
    for (const field of fields) cluster.fieldCounts[field] = (cluster.fieldCounts[field] ?? 0) + 1;
    if (cluster.mismatchSamples.length < args.pcDeltaReportSamples) {
      cluster.mismatchSamples.push({
        index,
        fields: [...fields],
        replayCycleDelta: ts?.replayCycle === undefined || mame?.replayCycle === undefined
          ? undefined
          : ts.replayCycle - mame.replayCycle,
        nativeSampleDelta: nativeSampleDeltaFor(ts, mame, args.sampleRate, args.samplePhaseCycles),
        nativeSampleTargetCycleOffset: undefined,
        nativeSampleTargetCycleOffsetRange: undefined,
        previousIndex: undefined,
        intervalDelta: undefined,
        tsInterval: undefined,
        mameInterval: undefined,
        ts,
        mame,
        ...(commandContext === undefined ? {} : { commandContext }),
      });
    }
  }
  if (ts?.replayCycle !== undefined && mame?.replayCycle !== undefined) {
    const replayDelta = ts.replayCycle - mame.replayCycle;
    addDelta(cluster.replayCycleDelta, cluster.replayCycleDeltaAbsSum, replayDelta);
    cluster.firstReplayCycleDelta ??= replayDelta;
    cluster.lastReplayCycleDelta = replayDelta;
    cluster.driftReplayCycleDelta = cluster.firstReplayCycleDelta === undefined
      ? undefined
      : replayDelta - cluster.firstReplayCycleDelta;
    if (cluster.lastTsReplayCycle !== undefined && cluster.lastMameReplayCycle !== undefined) {
      const intervalDelta =
        (ts.replayCycle - cluster.lastTsReplayCycle) -
        (mame.replayCycle - cluster.lastMameReplayCycle);
      const tsInterval = ts.replayCycle - cluster.lastTsReplayCycle;
      const mameInterval = mame.replayCycle - cluster.lastMameReplayCycle;
      addDelta(cluster.intervalDelta, cluster.intervalDeltaAbsSum, intervalDelta);
      const lastSample = cluster.mismatchSamples[cluster.mismatchSamples.length - 1];
      if (lastSample !== undefined && lastSample.index === index) {
        lastSample.previousIndex = cluster.lastComparedIndex;
        lastSample.intervalDelta = intervalDelta;
        lastSample.tsInterval = tsInterval;
        lastSample.mameInterval = mameInterval;
      }
      const intervalEvent = {
        index,
        previousIndex: cluster.lastComparedIndex,
        intervalDelta,
        tsInterval,
        mameInterval,
        ts,
        mame,
        ...(cluster.previousCommandContext === undefined
          ? {}
          : { previousCommandContext: cluster.previousCommandContext }),
        ...(commandContext === undefined ? {} : { commandContext }),
      };
      const previousIntervalEvent = cluster.lastIntervalForCatchUp;
      if (previousIntervalEvent !== undefined &&
        Math.abs(previousIntervalEvent.intervalDelta) >= PC_DELTA_CATCH_UP_INTERVAL_MIN_ABS &&
        Math.abs(intervalDelta) >= PC_DELTA_CATCH_UP_INTERVAL_MIN_ABS &&
        Math.sign(previousIntervalEvent.intervalDelta) === -Math.sign(intervalDelta)) {
        const netIntervalDelta = previousIntervalEvent.intervalDelta + intervalDelta;
        if (Math.abs(netIntervalDelta) <= PC_DELTA_CATCH_UP_NET_MAX_ABS) {
          cluster.intervalCatchUpPairs.push({
            first: previousIntervalEvent,
            second: intervalEvent,
            netIntervalDelta,
          });
          cluster.intervalCatchUpPairs.sort((a, b) => {
            const aMagnitude = Math.max(Math.abs(a.first.intervalDelta), Math.abs(a.second.intervalDelta));
            const bMagnitude = Math.max(Math.abs(b.first.intervalDelta), Math.abs(b.second.intervalDelta));
            return bMagnitude - aMagnitude ||
              Math.abs(a.netIntervalDelta) - Math.abs(b.netIntervalDelta) ||
              a.second.index - b.second.index;
          });
          if (cluster.intervalCatchUpPairs.length > args.pcDeltaReportSamples) {
            cluster.intervalCatchUpPairs.length = args.pcDeltaReportSamples;
          }
        }
      }
      cluster.lastIntervalForCatchUp = intervalEvent;
      if (args.pcDeltaReportSamples > 0) {
        const outlier = {
          ...intervalEvent,
          previousTs: cluster.previousTs,
          previousMame: cluster.previousMame,
        };
        cluster.intervalOutliers.push(outlier);
        cluster.intervalOutliers.sort((a, b) =>
          Math.abs(b.intervalDelta) - Math.abs(a.intervalDelta) ||
          a.index - b.index);
        if (cluster.intervalOutliers.length > args.pcDeltaReportSamples) {
          cluster.intervalOutliers.length = args.pcDeltaReportSamples;
        }
      }
    }
    cluster.lastTsReplayCycle = ts.replayCycle;
    cluster.lastMameReplayCycle = mame.replayCycle;
    cluster.lastComparedIndex = index;
    cluster.previousTs = ts;
    cluster.previousMame = mame;
    cluster.previousCommandContext = commandContext;
    if (args.sampleRate !== undefined && Number.isFinite(args.sampleRate)) {
      const sampleDelta = nativeSampleDeltaFor(ts, mame, args.sampleRate, args.samplePhaseCycles)!;
      addDelta(cluster.nativeSampleDelta, cluster.nativeSampleDeltaAbsSum, sampleDelta);
      const sampleKey = String(sampleDelta);
      cluster.nativeSampleDeltaHistogram[sampleKey] =
        (cluster.nativeSampleDeltaHistogram[sampleKey] ?? 0) + 1;
      if (cluster.offsetSweepAccumulators !== undefined) {
        for (const sweep of cluster.offsetSweepAccumulators) {
          const sweepDelta = nativeSampleDeltaForTsCycleOffset(
            ts,
            mame,
            args.sampleRate,
            args.samplePhaseCycles,
            sweep.offsetCycles,
          );
          if (sweepDelta === undefined) continue;
          addDelta(sweep.nativeSampleDelta, sweep.nativeSampleDeltaAbsSum, sweepDelta);
          incrementHistogram(sweep.nativeSampleDeltaHistogram, String(sweepDelta));
          if (Math.abs(sweepDelta) > args.sampleTolerance) sweep.mismatchCount++;
        }
      }
      if (fields.includes("nativeSample")) {
        const targetOffset = targetNativeSampleCycleOffsetFor(
          ts,
          mame,
          args.sampleRate,
          args.samplePhaseCycles,
          0,
        );
        if (targetOffset !== undefined) {
          addDelta(
            cluster.nativeSampleMismatchTargetCycleOffset,
            cluster.nativeSampleMismatchTargetCycleOffsetAbsSum,
            targetOffset.offset,
          );
          const offsetKey = String(targetOffset.offset);
          cluster.nativeSampleMismatchTargetCycleOffsetHistogram[offsetKey] =
            (cluster.nativeSampleMismatchTargetCycleOffsetHistogram[offsetKey] ?? 0) + 1;
          const lastSample = cluster.mismatchSamples[cluster.mismatchSamples.length - 1];
          if (lastSample !== undefined && lastSample.index === index) {
            lastSample.nativeSampleTargetCycleOffset = targetOffset.offset;
            lastSample.nativeSampleTargetCycleOffsetRange = targetOffset.range;
          }
        }
      }
    }
  }
}

function finalizedPcDeltaReport(
  clusters: Map<string, PcDeltaReportAccumulator>,
  limit: number,
): PcDeltaReportEntry[] {
  return Array.from(clusters.values())
    .sort((a, b) =>
      b.mismatchCount - a.mismatchCount ||
      b.compared - a.compared ||
      a.firstIndex - b.firstIndex ||
      a.pc.localeCompare(b.pc))
    .slice(0, limit)
    .map((cluster) => ({
      pc: cluster.pc,
      compared: cluster.compared,
      mismatchCount: cluster.mismatchCount,
      firstIndex: cluster.firstIndex,
      lastIndex: cluster.lastIndex,
      firstTs: cluster.firstTs,
      firstMame: cluster.firstMame,
      lastTs: cluster.lastTs,
      lastMame: cluster.lastMame,
      fieldCounts: sortedFieldCounts(cluster.fieldCounts),
      replayCycleDelta: cluster.replayCycleDelta,
      nativeSampleDelta: cluster.nativeSampleDelta,
      nativeSampleDeltaHistogram: Object.fromEntries(
        Object.entries(cluster.nativeSampleDeltaHistogram)
          .sort((a, b) => Number(a[0]) - Number(b[0])),
      ),
      nativeSampleMismatchTargetCycleOffset: cluster.nativeSampleMismatchTargetCycleOffset,
      nativeSampleMismatchTargetCycleOffsetHistogram: Object.fromEntries(
        Object.entries(cluster.nativeSampleMismatchTargetCycleOffsetHistogram)
          .sort((a, b) => Number(a[0]) - Number(b[0])),
      ),
      intervalDelta: cluster.intervalDelta,
      ...(cluster.offsetSweepAccumulators === undefined
        ? {}
        : {
            offsetSweep: cluster.offsetSweepAccumulators.map((entry) => ({
              offsetCycles: entry.offsetCycles,
              mismatchCount: entry.mismatchCount,
              nativeSampleDelta: entry.nativeSampleDelta,
              nativeSampleDeltaHistogram: Object.fromEntries(
                Object.entries(entry.nativeSampleDeltaHistogram)
                  .sort((a, b) => Number(a[0]) - Number(b[0])),
              ),
            })),
          }),
      firstReplayCycleDelta: cluster.firstReplayCycleDelta,
      lastReplayCycleDelta: cluster.lastReplayCycleDelta,
      driftReplayCycleDelta: cluster.driftReplayCycleDelta,
      mismatchSamples: cluster.mismatchSamples,
      intervalOutliers: cluster.intervalOutliers,
      intervalCatchUpPairs: cluster.intervalCatchUpPairs,
    }));
}

interface EventDeltaReportAccumulator {
  selector: WriteEventDeltaReportMatch;
  compared: number;
  mismatchCount: number;
  fieldCounts: Record<string, number>;
  replayCycleDelta: EventDeltaReportEntry["replayCycleDelta"];
  replayCycleDeltaAbsSum: { value: number };
  nativeSampleDelta: EventDeltaReportEntry["nativeSampleDelta"];
  nativeSampleDeltaAbsSum: { value: number };
  nativeSampleDeltaHistogram: Record<string, number>;
  targetCycleOffset: NonNullable<EventDeltaReportEntry["targetCycleOffset"]> | undefined;
  targetCycleOffsetAbsSum: { value: number };
  targetCycleOffsetHistogram: Record<string, number>;
  samples: EventDeltaReportEntry["samples"];
}

function eventDeltaReportSelectorToJson(
  selector: WriteEventDeltaReportMatch,
): Record<string, number | string> {
  return {
    ...(selector.frame === undefined ? {} : { frame: selector.frame }),
    ...(selector.pc === undefined ? {} : { pc: `0x${selector.pc.toString(16).padStart(4, "0")}` }),
    ...(selector.reg === undefined ? {} : { reg: `0x${selector.reg.toString(16).padStart(2, "0")}` }),
    ...(selector.val === undefined ? {} : { val: `0x${selector.val.toString(16).padStart(2, "0")}` }),
  };
}

function fmtEventDeltaReportSelector(selector: WriteEventDeltaReportMatch): string {
  return `${selector.frame ?? "*"}:` +
    `${selector.pc === undefined ? "*" : `0x${selector.pc.toString(16).padStart(4, "0")}`}:` +
    `${selector.reg === undefined ? "*" : `0x${selector.reg.toString(16).padStart(2, "0")}`}:` +
    `${selector.val === undefined ? "*" : `0x${selector.val.toString(16).padStart(2, "0")}`}`;
}

function commandNmiDelayMatchesToJson(
  matches: readonly CommandNmiDelayMatch[],
): Array<Record<string, number | string>> {
  return matches.map((match) => ({
    ...(match.frame === undefined ? {} : { frame: match.frame }),
    ...(match.byte === undefined ? {} : { byte: `0x${match.byte.toString(16).padStart(2, "0")}` }),
    ...(match.cycleInFrame === undefined ? {} : { cycleInFrame: match.cycleInFrame }),
    delayInstructions: match.delayInstructions,
  }));
}

function fmtCommandNmiDelayMatches(matches: readonly CommandNmiDelayMatch[]): string {
  return matches.map((match) =>
    `${match.frame ?? "*"}:` +
    `${match.byte === undefined ? "*" : `0x${match.byte.toString(16).padStart(2, "0")}`}:` +
    `${match.cycleInFrame ?? "*"}:` +
    `${match.delayInstructions}`).join(",");
}

function fmtCommandNmiDelayMatch(match: CommandNmiDelayMatch): string {
  return `${match.frame ?? "*"}:` +
    `${match.byte === undefined ? "*" : `0x${match.byte.toString(16).padStart(2, "0")}`}:` +
    `${match.cycleInFrame ?? "*"}:` +
    `${match.delayInstructions}`;
}

function commandNmiDelayOverrideSelectionForMatch(
  matches: readonly CommandNmiDelayMatch[],
  frame: number,
  byte: number,
  cycleInFrame: number,
): CommandNmiDelayOverrideSelection | undefined {
  let selection: CommandNmiDelayOverrideSelection | undefined;
  for (const match of matches) {
    if (match.frame !== undefined && match.frame !== frame) continue;
    if (match.byte !== undefined && match.byte !== (byte & 0xff)) continue;
    if (match.cycleInFrame !== undefined && match.cycleInFrame !== cycleInFrame) continue;
    selection = {
      delayInstructions: match.delayInstructions,
      selector: fmtCommandNmiDelayMatch(match),
    };
  }
  return selection;
}

function commandNmiDelayOverrideSelectionForArgs(
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
): CommandNmiDelayOverrideSelection | undefined {
  const explicit = commandNmiDelayOverrideSelectionForMatch(
    args.commandNmiDelayMatches,
    event.frame,
    event.byte,
    event.cycleInFrame,
  );
  if (explicit !== undefined) return explicit;
  if (args.commandNmiDelayChipWriteBoundaryInstructions !== undefined &&
    event.cycleInFrame === 0 && event.currentChipIoStore !== undefined) {
    return {
      delayInstructions: args.commandNmiDelayChipWriteBoundaryInstructions,
      selector: `chip-write-boundary:0:${args.commandNmiDelayChipWriteBoundaryInstructions}`,
    };
  }
  if (args.commandNmiDelayCompletedChipWritePreemptions !== undefined &&
    event.preemptedChipWrite?.completedInstructionBeforeTarget === true) {
    return {
      delayInstructions: args.commandNmiDelayCompletedChipWritePreemptions,
      selector: `completed-chip-write-preemption:${args.commandNmiDelayCompletedChipWritePreemptions}`,
    };
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
  return commandNmiDelayOverrideSelectionForArgs(args, event)?.delayInstructions;
}

function writeMatchesEventDeltaSelector(
  write: NormalizedWrite | undefined,
  selector: WriteEventDeltaReportMatch,
): boolean {
  if (write === undefined) return false;
  if (selector.frame !== undefined && write.frame !== selector.frame) return false;
  if (selector.pc !== undefined && write.pc !== selector.pc) return false;
  if (selector.reg !== undefined && write.reg !== selector.reg) return false;
  if (selector.val !== undefined && write.val !== selector.val) return false;
  return true;
}

function updateEventDeltaReports(
  reports: EventDeltaReportAccumulator[],
  index: number,
  ts: NormalizedWrite | undefined,
  mame: NormalizedWrite | undefined,
  fields: readonly string[],
  args: Args,
  commandEvents: readonly CommandReplayEvent[],
  commandSubmissions: ReadonlyMap<number, CommandSubmitContext>,
  commandReads: readonly SoundCommandReadEvent[],
): void {
  if (reports.length === 0) return;
  for (const report of reports) {
    if (!writeMatchesEventDeltaSelector(ts, report.selector) &&
      !writeMatchesEventDeltaSelector(mame, report.selector)) {
      continue;
    }
    report.compared++;
    for (const field of fields) report.fieldCounts[field] = (report.fieldCounts[field] ?? 0) + 1;
    if (fields.length > 0) report.mismatchCount++;
    const replayDelta = ts?.replayCycle === undefined || mame?.replayCycle === undefined
      ? undefined
      : ts.replayCycle - mame.replayCycle;
    const sampleDelta = nativeSampleDeltaFor(ts, mame, args.sampleRate, args.samplePhaseCycles);
    const targetOffset = targetNativeSampleCycleOffsetFor(
      ts,
      mame,
      args.sampleRate,
      args.samplePhaseCycles,
      args.eventDeltaTargetNativeSampleDelta,
    );
    if (replayDelta !== undefined) addDelta(report.replayCycleDelta, report.replayCycleDeltaAbsSum, replayDelta);
    if (sampleDelta !== undefined) {
      addDelta(report.nativeSampleDelta, report.nativeSampleDeltaAbsSum, sampleDelta);
      const sampleKey = String(sampleDelta);
      report.nativeSampleDeltaHistogram[sampleKey] = (report.nativeSampleDeltaHistogram[sampleKey] ?? 0) + 1;
    }
    if (targetOffset !== undefined && report.targetCycleOffset !== undefined) {
      addDelta(report.targetCycleOffset, report.targetCycleOffsetAbsSum, targetOffset.offset);
      const offsetKey = String(targetOffset.offset);
      report.targetCycleOffsetHistogram[offsetKey] = (report.targetCycleOffsetHistogram[offsetKey] ?? 0) + 1;
    }
    if (report.samples.length < args.eventDeltaReportSamples) {
      const commandContext = commandContextFor(ts, mame, commandEvents, commandSubmissions, commandReads);
      report.samples.push({
        index,
        fields: [...fields],
        replayCycleDelta: replayDelta,
        nativeSampleDelta: sampleDelta,
        targetCycleOffset: targetOffset?.offset,
        targetCycleOffsetRange: targetOffset?.range,
        ts,
        mame,
        ...(commandContext === undefined ? {} : { commandContext }),
      });
    }
  }
}

function createEventDeltaReportAccumulators(args: Args): EventDeltaReportAccumulator[] {
  return args.eventDeltaReportMatches.map((selector) => ({
    selector,
    compared: 0,
    mismatchCount: 0,
    fieldCounts: {},
    replayCycleDelta: makeEmptyDeltaStats(),
    replayCycleDeltaAbsSum: { value: 0 },
    nativeSampleDelta: {
      sampleRate: args.sampleRate,
      samplePhaseCycles: args.samplePhaseCycles,
      ...makeEmptyDeltaStats(),
    },
    nativeSampleDeltaAbsSum: { value: 0 },
    nativeSampleDeltaHistogram: {},
    targetCycleOffset: args.eventDeltaTargetNativeSampleDelta === undefined
      ? undefined
      : {
          sampleRate: args.sampleRate,
          samplePhaseCycles: args.samplePhaseCycles,
          targetNativeSampleDelta: args.eventDeltaTargetNativeSampleDelta,
          ...makeEmptyDeltaStats(),
        },
    targetCycleOffsetAbsSum: { value: 0 },
    targetCycleOffsetHistogram: {},
    samples: [],
  }));
}

function finalizedEventDeltaReports(
  reports: readonly EventDeltaReportAccumulator[],
): EventDeltaReportEntry[] {
  return reports.map((report) => ({
    selector: eventDeltaReportSelectorToJson(report.selector),
    compared: report.compared,
    mismatchCount: report.mismatchCount,
    fieldCounts: sortedFieldCounts(report.fieldCounts),
    replayCycleDelta: report.replayCycleDelta,
    nativeSampleDelta: report.nativeSampleDelta,
    nativeSampleDeltaHistogram: Object.fromEntries(
      Object.entries(report.nativeSampleDeltaHistogram)
        .sort((a, b) => Number(a[0]) - Number(b[0])),
    ),
    ...(report.targetCycleOffset === undefined
      ? {}
      : {
          targetCycleOffset: report.targetCycleOffset,
          targetCycleOffsetHistogram: Object.fromEntries(
            Object.entries(report.targetCycleOffsetHistogram)
              .sort((a, b) => Number(a[0]) - Number(b[0])),
          ),
        }),
    samples: report.samples,
  }));
}

function computeSamplePhaseSweep(
  ts: NormalizedWrite[],
  mame: NormalizedWrite[],
  compared: number,
  args: Args,
): DiffResult["samplePhaseSweep"] {
  if (args.sampleRate === undefined || !Number.isFinite(args.sampleRate) ||
    args.samplePhaseSweepCycles === undefined) {
    return undefined;
  }
  return args.samplePhaseSweepCycles.map((phaseCycles) => {
    const nativeSampleDelta = {
      sampleRate: args.sampleRate,
      samplePhaseCycles: phaseCycles,
      ...makeEmptyDeltaStats(),
    };
    const nativeSampleDeltaAbsSum = { value: 0 };
    let mismatchCount = 0;
    for (let i = 0; i < compared; i++) {
      const delta = nativeSampleDeltaFor(ts[i], mame[i], args.sampleRate, phaseCycles);
      if (delta === undefined) continue;
      addDelta(nativeSampleDelta, nativeSampleDeltaAbsSum, delta);
      if (Math.abs(delta) > args.sampleTolerance) mismatchCount++;
    }
    return {
      phaseCycles,
      mismatchCount,
      nativeSampleDelta,
    };
  });
}

function diffWrites(
  kind: Kind,
  ts: NormalizedWrite[],
  mame: NormalizedWrite[],
  args: Args,
  commandCycles: readonly number[],
  commandEvents: readonly CommandReplayEvent[],
  commandSubmissions: ReadonlyMap<number, CommandSubmitContext>,
  commandReads: readonly SoundCommandReadEvent[],
  pokeyRawTransitions: readonly PokeyRawTransition[],
): DiffResult {
  const compareLimit = args.compareCount ?? Math.max(ts.length, mame.length);
  const compared = Math.min(compareLimit, Math.max(ts.length, mame.length));
  let mismatchCount = 0;
  let firstMismatch: DiffResult["firstMismatch"];
  const mismatchSamples: DiffResult["mismatchSamples"] = [];
  let commandCrossingMismatchCount = 0;
  let firstCommandCrossingMismatch: DiffResult["commandCrossings"]["firstMismatch"];
  let rawCommandCrossingMismatchCount = 0;
  let firstRawCommandCrossingMismatch: DiffResult["rawCommandCrossings"]["firstMismatch"];
  let commandNearMissMismatchCount = 0;
  let firstCommandNearMissMismatch: DiffResult["commandNearMisses"]["firstMismatch"];
  let rawCommandNearMissMismatchCount = 0;
  let firstRawCommandNearMissMismatch: DiffResult["rawCommandNearMisses"]["firstMismatch"];
  const frameDelta = makeEmptyDeltaStats();
  const frameDeltaAbsSum = { value: 0 };
  const sameFrameCycleDelta = makeEmptyDeltaStats();
  const sameFrameCycleDeltaAbsSum = { value: 0 };
  const replayCycleDelta = makeEmptyDeltaStats();
  const replayCycleDeltaAbsSum = { value: 0 };
  const nativeSampleDelta = {
    sampleRate: args.sampleRate,
    samplePhaseCycles: args.samplePhaseCycles,
    ...makeEmptyDeltaStats(),
  };
  const nativeSampleDeltaAbsSum = { value: 0 };
  const nativeSampleDeltaHistogram: Record<string, number> = {};
  const nativeSampleDeltaByRegisterCategory = new Map<string, NativeSampleDeltaBreakdownAccumulator>();
  const nativeSampleDeltaByRegister = new Map<string, NativeSampleDeltaBreakdownAccumulator>();
  const nativeSampleDeltaByPokeyEffectiveApplyDelay = new Map<string, NativeSampleDeltaBreakdownAccumulator>();
  const nativeSampleNonExactContext = makeNativeSampleMismatchContextAccumulator(args);
  const nativeSampleMismatchContext = makeNativeSampleMismatchContextAccumulator(args);
  const nativeSampleMismatchByCommandSource = new Map<string, NativeSampleCommandMismatchBreakdownAccumulator>();
  const instructionFetchDelta = makeInstructionFetchDeltaSummary();
  const rawBusWriteParity = makeRawBusWriteParityAccumulator(args);
  const instructionFetchTsWriteOffsetAbsSum = { value: 0 };
  const instructionFetchTsRawWriteOffsetAbsSum = { value: 0 };
  const mismatchClusters = new Map<string, MismatchCluster & {
    replayCycleDeltaAbsSum: { value: number };
    nativeSampleDeltaAbsSum: { value: number };
  }>();
  const pcDeltaClusters = new Map<string, PcDeltaReportAccumulator>();
  const frameDeltaReports = new Map<string, FrameDeltaReportAccumulator>();
  const frameOffsetSweepFrames = new Map<string, FrameOffsetSweepAccumulator>();
  const eventDeltaReports = createEventDeltaReportAccumulators(args);
  for (let i = 0; i < compared; i++) {
    const tsi = ts[i];
    const mamei = mame[i];
    if (tsi?.frame !== undefined && mamei?.frame !== undefined) {
      addDelta(frameDelta, frameDeltaAbsSum, tsi.frame - mamei.frame);
    }
    if (tsi?.frame === mamei?.frame && tsi?.cycleInFrame !== undefined && mamei?.cycleInFrame !== undefined) {
      addDelta(sameFrameCycleDelta, sameFrameCycleDeltaAbsSum, tsi.cycleInFrame - mamei.cycleInFrame);
    }
    if (tsi?.replayCycle !== undefined && mamei?.replayCycle !== undefined) {
      addDelta(replayCycleDelta, replayCycleDeltaAbsSum, tsi.replayCycle - mamei.replayCycle);
    }
    updateInstructionFetchDeltaSummary(
      instructionFetchDelta,
      tsi,
      mamei,
      instructionFetchTsWriteOffsetAbsSum,
      instructionFetchTsRawWriteOffsetAbsSum,
    );
    updateRawBusWriteParity(rawBusWriteParity, i, tsi, mamei);
    const nativeSampleDeltaValue = nativeSampleDeltaFor(tsi, mamei, args.sampleRate, args.samplePhaseCycles);
    const nativeSampleTargetCycleOffset = targetNativeSampleCycleOffsetFor(
      tsi,
      mamei,
      args.sampleRate,
      args.samplePhaseCycles,
      0,
    )?.offset;
    let nonExactCommandCrossing: CommandCrossing | undefined;
    let nonExactRawCommandCrossing: CommandCrossing | undefined;
    let nonExactCommandNearMiss: CommandNearMiss | undefined;
    let nonExactRawCommandNearMiss: CommandNearMiss | undefined;
    let nonExactCommandContext: CommandContext | undefined;
    if (nativeSampleDeltaValue !== undefined) {
      if (args.sampleRate !== undefined && Number.isFinite(args.sampleRate)) {
        addDelta(nativeSampleDelta, nativeSampleDeltaAbsSum, nativeSampleDeltaValue);
        const sampleKey = String(nativeSampleDeltaValue);
        nativeSampleDeltaHistogram[sampleKey] = (nativeSampleDeltaHistogram[sampleKey] ?? 0) + 1;
        updateNativeSampleDeltaBreakdowns(
          nativeSampleDeltaByRegisterCategory,
          nativeSampleDeltaByRegister,
          kind,
          i,
          tsi,
          mamei,
          nativeSampleDeltaValue,
          args,
        );
        if (kind === "pokey" && tsi?.pokeyEffectiveApplyDelayCycles !== undefined) {
          const delayCycles = tsi.pokeyEffectiveApplyDelayCycles;
          updateNativeSampleDeltaBreakdownEntry(
            nativeSampleDeltaByPokeyEffectiveApplyDelay,
            `pokey-effective-apply-delay:${delayCycles}`,
            {
              label: `${delayCycles} cycles`,
              kind,
              category: "pokey-effective-apply-delay",
            },
            i,
            tsi,
            mamei,
            nativeSampleDeltaValue,
            args,
          );
        }
        if (nativeSampleDeltaValue !== 0) {
          nonExactCommandCrossing = commandCrossingFor(tsi, mamei, commandCycles);
          nonExactRawCommandCrossing = commandCrossingFor(tsi, mamei, commandCycles, "raw");
          nonExactCommandNearMiss = nonExactCommandCrossing === undefined
            ? commandNearMissFor(tsi, mamei, commandCycles)
            : undefined;
          nonExactRawCommandNearMiss = nonExactRawCommandCrossing === undefined
            ? commandNearMissFor(tsi, mamei, commandCycles, "raw")
            : undefined;
          nonExactCommandContext = commandContextFor(tsi, mamei, commandEvents, commandSubmissions, commandReads);
          updateNativeSampleMismatchContext(
            nativeSampleNonExactContext,
            tsi,
            mamei,
            nativeSampleDeltaValue,
            nativeSampleTargetCycleOffset,
            nonExactCommandContext,
            nativeSampleMismatchCommandRelation(
              nonExactCommandCrossing,
              nonExactRawCommandCrossing,
              nonExactCommandNearMiss,
              nonExactRawCommandNearMiss,
            ),
            args,
          );
        }
      }
    }
    const fields = fieldsDiffer(
      ts[i],
      mame[i],
      args.frameTolerance,
      args.cycleTolerance,
      args.sampleRate,
      args.sampleTolerance,
      args.samplePhaseCycles,
    );
    const pcDeltaCommandContext = args.pcDeltaReport && pcMatchesSelection(tsi, mamei, args.pcDeltaReportPcs)
      ? nonExactCommandContext ?? commandContextFor(tsi, mamei, commandEvents, commandSubmissions, commandReads)
      : undefined;
    updatePcDeltaReport(pcDeltaClusters, i, tsi, mamei, fields, args, pcDeltaCommandContext);
    updateEventDeltaReports(
      eventDeltaReports,
      i,
      tsi,
      mamei,
      fields,
      args,
      commandEvents,
      commandSubmissions,
      commandReads,
    );
    updateFrameDeltaReport(
      frameDeltaReports,
      i,
      tsi,
      mamei,
      fields,
      nativeSampleDeltaValue,
      nativeSampleTargetCycleOffset,
      nonExactCommandContext,
      args,
    );
    updateFrameOffsetSweep(frameOffsetSweepFrames, i, tsi, mamei, nativeSampleDeltaValue, args);
    if (fields.length > 0) {
      const commandCrossing = nonExactCommandCrossing ?? commandCrossingFor(ts[i], mame[i], commandCycles);
      const rawCommandCrossing = nonExactRawCommandCrossing ?? commandCrossingFor(ts[i], mame[i], commandCycles, "raw");
      const commandNearMiss = nonExactCommandNearMiss ?? (commandCrossing === undefined
        ? commandNearMissFor(ts[i], mame[i], commandCycles)
        : undefined);
      const rawCommandNearMiss = nonExactRawCommandNearMiss ?? (rawCommandCrossing === undefined
        ? commandNearMissFor(ts[i], mame[i], commandCycles, "raw")
        : undefined);
      const commandContext = nonExactCommandContext ??
        commandContextFor(ts[i], mame[i], commandEvents, commandSubmissions, commandReads);
      if (nativeSampleDeltaValue !== undefined && fields.includes("nativeSample")) {
        const commandRelation = nativeSampleMismatchCommandRelation(
          commandCrossing,
          rawCommandCrossing,
          commandNearMiss,
          rawCommandNearMiss,
        );
        updateNativeSampleMismatchContext(
          nativeSampleMismatchContext,
          tsi,
          mamei,
          nativeSampleDeltaValue,
          nativeSampleTargetCycleOffset,
          commandContext,
          commandRelation,
          args,
        );
        updateNativeSampleCommandMismatchBreakdowns(
          nativeSampleMismatchByCommandSource,
          i,
          tsi,
          mamei,
          nativeSampleDeltaValue,
          nativeSampleTargetCycleOffset,
          commandContext,
          commandRelation,
          args,
        );
      }
      if (commandCrossing !== undefined) {
        commandCrossingMismatchCount++;
        firstCommandCrossingMismatch ??= { index: i, crossing: commandCrossing };
      }
      if (rawCommandCrossing !== undefined) {
        rawCommandCrossingMismatchCount++;
        firstRawCommandCrossingMismatch ??= { index: i, crossing: rawCommandCrossing };
      }
      if (commandNearMiss !== undefined) {
        commandNearMissMismatchCount++;
        firstCommandNearMissMismatch ??= { index: i, nearMiss: commandNearMiss };
      }
      if (rawCommandNearMiss !== undefined) {
        rawCommandNearMissMismatchCount++;
        firstRawCommandNearMissMismatch ??= { index: i, nearMiss: rawCommandNearMiss };
      }
      const clusterKey = pcClusterKey(tsi, mamei);
      let cluster = mismatchClusters.get(clusterKey);
      if (cluster === undefined) {
        cluster = {
          pc: clusterKey,
          count: 0,
          commandCrossings: 0,
          rawCommandCrossings: 0,
          commandNearMisses: 0,
          rawCommandNearMisses: 0,
          firstIndex: i,
          firstFields: fields,
          firstTs: tsi,
          firstMame: mamei,
          fieldCounts: {},
          replayCycleDelta: makeEmptyDeltaStats(),
          replayCycleDeltaAbsSum: { value: 0 },
          nativeSampleDelta: {
            sampleRate: args.sampleRate,
            samplePhaseCycles: args.samplePhaseCycles,
            ...makeEmptyDeltaStats(),
          },
          nativeSampleDeltaAbsSum: { value: 0 },
          ...(commandCrossing === undefined ? {} : { firstCommandCrossing: { index: i, crossing: commandCrossing } }),
          ...(rawCommandCrossing === undefined ? {} : { firstRawCommandCrossing: { index: i, crossing: rawCommandCrossing } }),
          ...(commandNearMiss === undefined ? {} : { firstCommandNearMiss: { index: i, nearMiss: commandNearMiss } }),
          ...(rawCommandNearMiss === undefined ? {} : { firstRawCommandNearMiss: { index: i, nearMiss: rawCommandNearMiss } }),
        };
        mismatchClusters.set(clusterKey, cluster);
      }
      cluster.count++;
      if (commandCrossing !== undefined) {
        cluster.commandCrossings++;
        cluster.firstCommandCrossing ??= { index: i, crossing: commandCrossing };
      }
      if (rawCommandCrossing !== undefined) {
        cluster.rawCommandCrossings++;
        cluster.firstRawCommandCrossing ??= { index: i, crossing: rawCommandCrossing };
      }
      if (commandNearMiss !== undefined) {
        cluster.commandNearMisses++;
        cluster.firstCommandNearMiss ??= { index: i, nearMiss: commandNearMiss };
      }
      if (rawCommandNearMiss !== undefined) {
        cluster.rawCommandNearMisses++;
        cluster.firstRawCommandNearMiss ??= { index: i, nearMiss: rawCommandNearMiss };
      }
      for (const field of fields) cluster.fieldCounts[field] = (cluster.fieldCounts[field] ?? 0) + 1;
      if (tsi?.replayCycle !== undefined && mamei?.replayCycle !== undefined) {
        addDelta(cluster.replayCycleDelta, cluster.replayCycleDeltaAbsSum, tsi.replayCycle - mamei.replayCycle);
        if (args.sampleRate !== undefined && Number.isFinite(args.sampleRate)) {
          addDelta(
            cluster.nativeSampleDelta,
            cluster.nativeSampleDeltaAbsSum,
            nativeSampleDeltaFor(tsi, mamei, args.sampleRate, args.samplePhaseCycles)!,
          );
        }
      }
      mismatchCount++;
      firstMismatch ??= {
        index: i,
        fields,
        ts: ts[i],
        mame: mame[i],
        ...(commandCrossing === undefined ? {} : { commandCrossing }),
        ...(rawCommandCrossing === undefined ? {} : { rawCommandCrossing }),
        ...(commandNearMiss === undefined ? {} : { commandNearMiss }),
        ...(rawCommandNearMiss === undefined ? {} : { rawCommandNearMiss }),
        ...(commandContext === undefined ? {} : { commandContext }),
      };
      if (mismatchSamples.length < args.mismatchSamples) {
        mismatchSamples.push({
          index: i,
          fields,
          ts: ts[i],
          mame: mame[i],
          ...(commandCrossing === undefined ? {} : { commandCrossing }),
          ...(rawCommandCrossing === undefined ? {} : { rawCommandCrossing }),
          ...(commandNearMiss === undefined ? {} : { commandNearMiss }),
          ...(rawCommandNearMiss === undefined ? {} : { rawCommandNearMiss }),
          ...(commandContext === undefined ? {} : { commandContext }),
        });
      }
    }
  }
  const samplePhaseSweep = computeSamplePhaseSweep(ts, mame, compared, args);
  const frameOffsetSweep = finalizedFrameOffsetSweep(frameOffsetSweepFrames, args);
  const pokeyBoundaryGuardSweep = computePokeyBoundaryGuardSweep(kind, ts, mame, compared, args);
  const pokeyBoundaryCandidateReport = computePokeyBoundaryCandidateReport(kind, ts, mame, compared, args);
  const pokeyStreamCursorReport = computePokeyStreamCursorReport(kind, ts, mame, compared, pokeyRawTransitions, args);
  const pokeyLofiCursorReport = computePokeyLofiCursorReport(kind, ts, mame, compared, args);
  return {
    kind,
    compared,
    tsCount: ts.length,
    mameCount: mame.length,
    mismatchCount,
    frameDelta,
    sameFrameCycleDelta,
    replayCycleDelta,
    nativeSampleDelta,
    nativeSampleDeltaHistogram: Object.fromEntries(
      Object.entries(nativeSampleDeltaHistogram)
        .sort((a, b) => Number(a[0]) - Number(b[0])),
    ),
    nativeSampleDeltaByRegisterCategory: finalizedNativeSampleDeltaBreakdown(nativeSampleDeltaByRegisterCategory),
    nativeSampleDeltaByRegister: finalizedNativeSampleDeltaBreakdown(nativeSampleDeltaByRegister),
    ...(nativeSampleDeltaByPokeyEffectiveApplyDelay.size === 0
      ? {}
      : {
        nativeSampleDeltaByPokeyEffectiveApplyDelay: finalizedNativeSampleDeltaBreakdown(
          nativeSampleDeltaByPokeyEffectiveApplyDelay,
        ),
      }),
    nativeSampleNonExactContext: finalizedNativeSampleMismatchContext(nativeSampleNonExactContext),
    nativeSampleMismatchContext: finalizedNativeSampleMismatchContext(nativeSampleMismatchContext),
    nativeSampleMismatchByCommandSource: finalizedNativeSampleCommandMismatchBreakdown(
      nativeSampleMismatchByCommandSource,
    ),
    instructionFetchDelta: finalizedInstructionFetchDeltaSummary(instructionFetchDelta),
    rawBusWriteParity: finalizedRawBusWriteParity(rawBusWriteParity),
    commandCrossings: {
      mismatchCount: commandCrossingMismatchCount,
      firstMismatch: firstCommandCrossingMismatch,
    },
    rawCommandCrossings: {
      mismatchCount: rawCommandCrossingMismatchCount,
      firstMismatch: firstRawCommandCrossingMismatch,
    },
    commandNearMisses: {
      lookaheadCycles: COMMAND_NEAR_MISS_LOOKAHEAD_CYCLES,
      mismatchCount: commandNearMissMismatchCount,
      firstMismatch: firstCommandNearMissMismatch,
    },
    rawCommandNearMisses: {
      lookaheadCycles: COMMAND_NEAR_MISS_LOOKAHEAD_CYCLES,
      mismatchCount: rawCommandNearMissMismatchCount,
      firstMismatch: firstRawCommandNearMissMismatch,
    },
    firstMismatch,
    mismatchSamples,
    mismatchClusters: Array.from(mismatchClusters.values())
      .sort((a, b) => b.count - a.count || a.firstIndex - b.firstIndex || a.pc.localeCompare(b.pc))
      .slice(0, 16)
      .map((cluster) => ({
        pc: cluster.pc,
        count: cluster.count,
        commandCrossings: cluster.commandCrossings,
        rawCommandCrossings: cluster.rawCommandCrossings,
        commandNearMisses: cluster.commandNearMisses,
        rawCommandNearMisses: cluster.rawCommandNearMisses,
        firstIndex: cluster.firstIndex,
        firstFields: cluster.firstFields,
        firstTs: cluster.firstTs,
        firstMame: cluster.firstMame,
        fieldCounts: sortedFieldCounts(cluster.fieldCounts),
        replayCycleDelta: cluster.replayCycleDelta,
        nativeSampleDelta: cluster.nativeSampleDelta,
        ...(cluster.firstCommandCrossing === undefined ? {} : { firstCommandCrossing: cluster.firstCommandCrossing }),
        ...(cluster.firstRawCommandCrossing === undefined ? {} : { firstRawCommandCrossing: cluster.firstRawCommandCrossing }),
        ...(cluster.firstCommandNearMiss === undefined ? {} : { firstCommandNearMiss: cluster.firstCommandNearMiss }),
        ...(cluster.firstRawCommandNearMiss === undefined ? {} : { firstRawCommandNearMiss: cluster.firstRawCommandNearMiss }),
      })),
    ...(samplePhaseSweep === undefined ? {} : { samplePhaseSweep }),
    ...(args.pcDeltaReport
      ? { pcDeltaReport: finalizedPcDeltaReport(pcDeltaClusters, args.pcDeltaReportLimit) }
      : {}),
    ...(args.frameDeltaReport
      ? { frameDeltaReport: finalizedFrameDeltaReport(frameDeltaReports, args) }
      : {}),
    ...(frameOffsetSweep === undefined ? {} : { frameOffsetSweep }),
    ...(pokeyBoundaryGuardSweep === undefined ? {} : { pokeyBoundaryGuardSweep }),
    ...(pokeyBoundaryCandidateReport === undefined ? {} : { pokeyBoundaryCandidateReport }),
    ...(pokeyStreamCursorReport === undefined ? {} : { pokeyStreamCursorReport }),
    ...(pokeyLofiCursorReport === undefined ? {} : { pokeyLofiCursorReport }),
    ...(eventDeltaReports.length === 0
      ? {}
      : { eventDeltaReports: finalizedEventDeltaReports(eventDeltaReports) }),
  };
}

function fmtWrite(w: NormalizedWrite | undefined): string {
  if (w === undefined) return "<missing>";
  const frame = w.frame === undefined ? "?" : String(w.frame);
  const cycle = w.cycleInFrame === undefined ? "?" : String(w.cycleInFrame);
  const replayCycle = w.replayCycle === undefined ? "?" : String(w.replayCycle);
  const pc = fmtPcValue(w.pc);
  const opcode = w.opcode === undefined ? "?" : `0x${w.opcode.toString(16).padStart(2, "0")}`;
  const writeOffset = w.writeCycleOffset === undefined ? "?" : String(w.writeCycleOffset);
  const raw = w.rawReplayCycle === undefined
    ? ""
    : `, rawCycleInFrame:${w.rawCycleInFrame ?? "?"}, rawReplayCycle:${w.rawReplayCycle}, rawWriteOffset:${w.rawWriteCycleOffset ?? "?"}`;
  const bus = w.busReplayCycle === undefined
    ? ""
    : `, busCycleInFrame:${w.busCycleInFrame ?? "?"}, busReplayCycle:${w.busReplayCycle}, busWriteOffset:${w.busWriteCycleOffset ?? "?"}`;
  const chipOffset = w.chipEventCycleOffset === undefined ? "" : `, chipEventOffset:${w.chipEventCycleOffset}`;
  const adjust = w.eventCycleAdjust === undefined ? "" : `, eventAdjust:${w.eventCycleAdjust}`;
  const pokeyApplyDelay = w.pokeyEffectiveApplyDelayCycles === undefined
    ? ""
    : `, pokeyApplyDelay:${w.pokeyEffectiveApplyDelayCycles}`;
  const inst = w.instPc === undefined
    ? ""
    : `, instPc:${fmtPcValue(w.instPc)}, instOpcode:${w.instOpcode === undefined ? "?" : `0x${w.instOpcode.toString(16).padStart(2, "0")}`}, instDelta:${w.instDeltaCycles ?? "?"}`;
  const commandEdge = w.commandEdgeEventAdjust === undefined
    ? ""
    : `, commandEdge:${w.commandEdgeEventAdjust.relation}@#${w.commandEdgeEventAdjust.sourceIndex}+${w.commandEdgeEventAdjust.targetReplayCycle - w.commandEdgeEventAdjust.commandReplayCycle}`;
  const scheduler = w.schedulerFrameStartDelta === undefined
    ? ""
    : `, frameStartDelta:${w.schedulerFrameStartDelta}, frameEndDelta:${w.schedulerFrameEndDelta ?? "?"}`;
  return `{frame:${frame}, cycleInFrame:${cycle}, replayCycle:${replayCycle}, pc:${pc}, opcode:${opcode}, writeOffset:${writeOffset}${raw}${bus}${chipOffset}${adjust}${pokeyApplyDelay}${inst}${commandEdge}${scheduler}, reg:0x${w.reg.toString(16).padStart(2, "0")}, val:0x${w.val.toString(16).padStart(2, "0")}}`;
}

function fmtCommandCrossing(crossing: CommandCrossing): string {
  const mameDelta = crossing.mameDelta === undefined ? "?" : String(crossing.mameDelta);
  const raw = crossing.rawTsDelta === undefined
    ? ""
    : `, rawTsDelta:${crossing.rawTsDelta}, rawStepStart:${crossing.rawTsStepStart ?? "?"}, rawWriteOffset:${crossing.rawTsWriteOffset ?? "?"}, chipEventOffset:${crossing.chipEventCycleOffset ?? "?"}`;
  return `{commandCycle:${crossing.commandCycle}, tsDelta:${crossing.tsDelta ?? "?"}, mameDelta:${mameDelta}, tsStepStart:${crossing.tsStepStart ?? "?"}, tsWriteOffset:${crossing.tsWriteOffset ?? "?"}${raw}}`;
}

function fmtCommandNearMiss(nearMiss: CommandNearMiss): string {
  const mameDelta = nearMiss.mameDelta === undefined ? "?" : String(nearMiss.mameDelta);
  return `{commandCycle:${nearMiss.commandCycle}, tsBefore:${nearMiss.tsDeltaBeforeCommand}, mameDelta:${mameDelta}}`;
}

function fmtCommandContextEntry(entry: CommandContextEntry): string {
  const frame = entry.frame === undefined ? "?" : String(entry.frame);
  const cycleInFrame = entry.cycleInFrame === undefined ? "?" : String(entry.cycleInFrame);
  const tsDelta = entry.tsDelta === undefined ? "?" : String(entry.tsDelta);
  const mameDelta = entry.mameDelta === undefined ? "?" : String(entry.mameDelta);
  const soundPc = entry.soundPc === undefined ? "" : ` soundPc=0x${entry.soundPc.toString(16).padStart(4, "0")}`;
  const inst = entry.instPc === undefined
    ? ""
    : ` inst=0x${entry.instPc.toString(16).padStart(4, "0")}:` +
      `${entry.instOpcode === undefined ? "??" : entry.instOpcode.toString(16).padStart(2, "0")}` +
      `+${entry.instDeltaCycles ?? "?"}`;
  const nextInst = entry.nextInstPc === undefined
    ? ""
    : ` nextInst=0x${entry.nextInstPc.toString(16).padStart(4, "0")}:` +
      `${entry.nextInstOpcode === undefined ? "??" : entry.nextInstOpcode.toString(16).padStart(2, "0")}` +
      `+${entry.nextInstDeltaCycles ?? "?"}`;
  const nextChronoInst = entry.nextChronoInstPc === undefined
    ? ""
    : ` nextChrono=0x${entry.nextChronoInstPc.toString(16).padStart(4, "0")}:` +
      `${entry.nextChronoInstOpcode === undefined ? "??" : entry.nextChronoInstOpcode.toString(16).padStart(2, "0")}` +
      `+${entry.nextChronoInstDeltaCycles ?? "?"}`;
  const submit = entry.submit === undefined
    ? ""
    : ` actual=${entry.submit.actualCycleInFrame}` +
      ` delay=${entry.submit.commandNmiDelayInstructions}` +
      ` pending=${entry.submit.pendingBefore ? "1" : "0"}` +
      (entry.submit.overrideDelayInstructions === undefined
        ? ""
        : ` override=${entry.submit.overrideDelayInstructions}`);
  return `#${entry.sourceIndex}:f${frame}:0x${entry.byte.toString(16).padStart(2, "0")}@${cycleInFrame}` +
    ` replay=${entry.replayCycle} tsDelta=${tsDelta} mameDelta=${mameDelta}` +
    `${soundPc}${inst}${nextInst}${nextChronoInst}${submit}`;
}

function fmtCommandContext(context: CommandContext): string {
  const previous = context.previous === undefined ? "" : `prev={${fmtCommandContextEntry(context.previous)}}`;
  const next = context.next === undefined ? "" : `next={${fmtCommandContextEntry(context.next)}}`;
  const nearest = context.nearest === undefined ? "" : `nearest={${fmtCommandContextEntry(context.nearest)}}`;
  return [previous, next, nearest].filter((part) => part !== "").join(" ");
}

function fmtCompactCommandContextEntry(entry: CommandContextEntry): string {
  const frame = entry.frame ?? "?";
  const cycleInFrame = entry.cycleInFrame ?? "?";
  const soundPc = entry.soundPc === undefined ? "????" : entry.soundPc.toString(16).padStart(4, "0");
  const firstRead = entry.firstTsCommandRead === undefined
    ? ""
    : `/read+${entry.firstTsCommandRead.deltaFromCommand}`;
  const submit = entry.submit === undefined ? "" : `/submit@${entry.submit.actualCycleInFrame}`;
  const lastStep = entry.submit?.lastStep;
  const step = lastStep === undefined
    ? ""
    : `/step=${lastStep.interruptService ? "irq" : `${lastStep.pc ?? "?"}:${lastStep.opcode ?? "?"}`}` +
      `+${lastStep.targetOffset}->${lastStep.actualEndDelta}`;
  const mameInst = entry.submit?.mameCommandInst;
  const mame = mameInst === undefined
    ? ""
    : `/mameInst=${mameInst.instPc ?? "?"}:${mameInst.instOpcode ?? "?"}` +
      `+${mameInst.instDeltaCycles ?? "?"}`;
  const mameRead = entry.submit?.mameSoundCommandRead;
  const read = mameRead === undefined
    ? ""
    : `/mameRead=${mameRead.pc ?? "?"}+${mameRead.deltaFromCommand ?? "?"}`;
  return `#${entry.sourceIndex}:f${frame}:0x${entry.byte.toString(16).padStart(2, "0")}` +
    `@${cycleInFrame}/pc=${soundPc}/d=${entry.tsDelta ?? "?"}:${entry.mameDelta ?? "?"}` +
    `${firstRead}${submit}${step}${mame}${read}`;
}

function fmtCompactCommandContext(context: CommandContext | undefined): string {
  if (context?.nearest === undefined) return "";
  return fmtCompactCommandContextEntry(context.nearest);
}

function fmtCatchUpCommandContext(
  pair: PcDeltaReportEntry["intervalCatchUpPairs"][number],
): string {
  const first = fmtCompactCommandContext(pair.first.commandContext);
  const second = fmtCompactCommandContext(pair.second.commandContext);
  const previousFirst = fmtCompactCommandContext(pair.first.previousCommandContext);
  const previousSecond = fmtCompactCommandContext(pair.second.previousCommandContext);
  const parts = [
    first === "" ? "" : `firstCmd={${first}}`,
    second === "" || second === first ? "" : `secondCmd={${second}}`,
    previousFirst === "" || previousFirst === first ? "" : `prevFirstCmd={${previousFirst}}`,
    previousSecond === "" || previousSecond === second || previousSecond === first
      ? ""
      : `prevSecondCmd={${previousSecond}}`,
  ].filter((part) => part !== "");
  return parts.length === 0 ? "" : ` ${parts.join(" ")}`;
}

function fmtFieldCounts(fieldCounts: Record<string, number>): string {
  return Object.entries(fieldCounts).map(([field, count]) => `${field}:${count}`).join(",");
}

function fmtDeltaStats(stats: PcDeltaReportEntry["replayCycleDelta"]): string {
  if (stats.compared === 0) return "n/a";
  return `[${stats.min},${stats.max}] meanAbs=${stats.meanAbs?.toFixed(2)}`;
}

function fmtHistogram(histogram: Record<string, number>): string {
  const entries = Object.entries(histogram);
  if (entries.length === 0) return "";
  return entries
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .slice(0, 8)
    .map(([delta, count]) => `${delta}:${count}`)
    .join(",");
}

function fmtTopHistogram(histogram: Record<string, number>, limit = 8): string {
  const entries = Object.entries(histogram);
  if (entries.length === 0) return "";
  return entries
    .sort((a, b) => b[1] - a[1] || Number(a[0]) - Number(b[0]) || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([delta, count]) => `${delta}:${count}`)
    .join(",");
}

function fmtNativeSampleDeltaBreakdown(
  entries: readonly NativeSampleDeltaBreakdownEntry[],
  limit = 8,
): string {
  return entries
    .slice(0, limit)
    .map((entry) => {
      const first = entry.firstNativeSampleMismatch === undefined
        ? ""
        : ` first=#${entry.firstNativeSampleMismatch.index}:${entry.firstNativeSampleMismatch.nativeSampleDelta}`;
      return `${entry.label}: compared=${entry.compared} nativeMismatches=${entry.nativeSampleMismatchCount}` +
        `${first} delta=${fmtDeltaStats(entry.nativeSampleDelta)} hist={${fmtHistogram(entry.nativeSampleDeltaHistogram)}}`;
    })
    .join(" | ");
}

function fmtNativeSampleCommandMismatchBreakdown(
  entries: readonly NativeSampleCommandMismatchBreakdownEntry[],
  limit = 5,
): string {
  return entries
    .slice(0, limit)
    .map((entry) => {
      const first = ` first=#${entry.firstMismatch.index}:${entry.firstMismatch.nativeSampleDelta}`;
      return `${entry.label}: count=${entry.count}${first} ` +
        `delta=${fmtDeltaStats(entry.nativeSampleDelta)} hist={${fmtHistogram(entry.nativeSampleDeltaHistogram)}} ` +
        `targetOffset=${fmtDeltaStats(entry.nativeSampleTargetCycleOffset)} ` +
        `targetTop={${fmtTopHistogram(entry.nativeSampleTargetCycleOffsetHistogram)}} ` +
        `side={${fmtHistogram(entry.byNearestCommandSide)}} sign={${fmtHistogram(entry.byNearestDeltaSign)}} ` +
        `writePc={${fmtHistogram(entry.byWritePc)}} opcode={${fmtHistogram(entry.byWriteOpcode)}} ` +
        `readPc={${fmtHistogram(entry.byFirstReadPc)}} submitDelta={${fmtHistogram(entry.bySubmitActualDeltaFromCommand)}}`;
    })
    .join(" | ");
}

function fmtNativeSampleMismatchContext(summary: NativeSampleMismatchContextSummary): string {
  if (summary.count === 0) return "count=0";
  return `count=${summary.count} relation={${fmtHistogram(summary.byRelation)}} ` +
    `delta={${fmtHistogram(summary.byNativeSampleDelta)}} side={${fmtHistogram(summary.byNearestCommandSide)}} ` +
    `sign={${fmtHistogram(summary.byNearestDeltaSign)}} cmd={${fmtHistogram(summary.byCommandByteSoundPc)}} ` +
    `targetOffset=${fmtDeltaStats(summary.nativeSampleTargetCycleOffset)} ` +
    `targetTop={${fmtTopHistogram(summary.nativeSampleTargetCycleOffsetHistogram)}} ` +
    `mameSampleStart={${fmtTopHistogram(summary.byMameNativeSampleOffsetFromStart)}} ` +
    `mameSampleEnd={${fmtTopHistogram(summary.byMameNativeSampleOffsetToEnd)}} ` +
    `tsSampleStart={${fmtTopHistogram(summary.byTsNativeSampleOffsetFromStart)}} ` +
    `tsSampleEnd={${fmtTopHistogram(summary.byTsNativeSampleOffsetToEnd)}} ` +
    `edgeRule={${fmtTopHistogram(summary.byCommandEdgeRule)}} ` +
    `writePc={${fmtHistogram(summary.byWritePc)}} opcode={${fmtHistogram(summary.byWriteOpcode)}} ` +
    `readPc={${fmtHistogram(summary.byFirstReadPc)}} submitDelta={${fmtHistogram(summary.bySubmitActualDeltaFromCommand)}} ` +
    `preBucket={${fmtHistogram(summary.bySubmitPreAdvanceDeltaBucket)}} ` +
    `preRel={${fmtHistogram(summary.byMameSoundPcVsSubmitPreAdvanceRelation)}}`;
}

function fmtOpcodeAdjustments(adjustments: ReadonlyMap<number, number>): string {
  return Array.from(adjustments.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([opcode, delta]) => `0x${opcode.toString(16).padStart(2, "0")}=${delta}`)
    .join(",");
}

function registerCycleOffsetsToJson(offsets: ReadonlyMap<number, number>): Record<string, number> {
  return Object.fromEntries(
    Array.from(offsets.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([reg, delta]) => [`0x${reg.toString(16).padStart(2, "0")}`, delta]),
  );
}

function fmtRegisterCycleOffsets(offsets: ReadonlyMap<number, number>): string {
  return Array.from(offsets.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([reg, delta]) => `0x${reg.toString(16).padStart(2, "0")}=${delta}`)
    .join(",");
}

function ymWriteEventCycleOffsetMatchesToJson(
  matches: readonly YmWriteEventCycleOffsetMatch[],
): Array<Record<string, number | string>> {
  return matches.map((match) => ({
    ...(match.frame === undefined ? {} : { frame: match.frame }),
    ...(match.pc === undefined ? {} : { pc: `0x${match.pc.toString(16).padStart(4, "0")}` }),
    ...(match.reg === undefined ? {} : { reg: `0x${match.reg.toString(16).padStart(2, "0")}` }),
    ...(match.val === undefined ? {} : { val: `0x${match.val.toString(16).padStart(2, "0")}` }),
    ...(match.cycleInFrameMin === undefined ? {} : { cycleInFrameMin: match.cycleInFrameMin }),
    ...(match.cycleInFrameMax === undefined ? {} : { cycleInFrameMax: match.cycleInFrameMax }),
    deltaCycles: match.deltaCycles,
  }));
}

function fmtYmWriteEventCycleOffsetMatches(matches: readonly YmWriteEventCycleOffsetMatch[]): string {
  return matches.map((match) =>
    `${match.frame ?? "*"}:` +
    `${match.pc === undefined ? "*" : `0x${match.pc.toString(16).padStart(4, "0")}`}:` +
    `${match.reg === undefined ? "*" : `0x${match.reg.toString(16).padStart(2, "0")}`}:` +
    `${match.val === undefined ? "*" : `0x${match.val.toString(16).padStart(2, "0")}`}:` +
    `${match.deltaCycles}` +
    (match.cycleInFrameMin === undefined && match.cycleInFrameMax === undefined
      ? ""
      : `:${match.cycleInFrameMin ?? "*"}:${match.cycleInFrameMax ?? "*"}`)).join(",");
}

function tsEventCycleAdjustMatchesToJson(
  matches: readonly TsEventCycleAdjustMatch[],
): Array<Record<string, number | string>> {
  return matches.map((match) => ({
    ...(match.kind === undefined ? {} : { kind: match.kind }),
    ...(match.frame === undefined ? {} : { frame: match.frame }),
    ...(match.pc === undefined ? {} : { pc: `0x${match.pc.toString(16).padStart(4, "0")}` }),
    ...(match.reg === undefined ? {} : { reg: `0x${match.reg.toString(16).padStart(2, "0")}` }),
    ...(match.val === undefined ? {} : { val: `0x${match.val.toString(16).padStart(2, "0")}` }),
    ...(match.cycleInFrameMin === undefined ? {} : { cycleInFrameMin: match.cycleInFrameMin }),
    ...(match.cycleInFrameMax === undefined ? {} : { cycleInFrameMax: match.cycleInFrameMax }),
    deltaCycles: match.deltaCycles,
  }));
}

function fmtTsEventCycleAdjustMatches(matches: readonly TsEventCycleAdjustMatch[]): string {
  return matches.map((match) =>
    `${match.kind ?? "*"}:` +
    `${match.frame ?? "*"}:` +
    `${match.pc === undefined ? "*" : `0x${match.pc.toString(16).padStart(4, "0")}`}:` +
    `${match.reg === undefined ? "*" : `0x${match.reg.toString(16).padStart(2, "0")}`}:` +
    `${match.val === undefined ? "*" : `0x${match.val.toString(16).padStart(2, "0")}`}:` +
    `${match.deltaCycles}` +
    (match.cycleInFrameMin === undefined && match.cycleInFrameMax === undefined
      ? ""
      : `:${match.cycleInFrameMin ?? "*"}:${match.cycleInFrameMax ?? "*"}`)).join(",");
}

function fmtCommandEdgeEventRules(
  rules: readonly (CommandEdgeEventRule & { readonly afterCycles: number })[],
): string {
  return rules.map((rule) => {
    const bytes = rule.bytes === undefined
      ? "*"
      : rule.bytes.map((byte) => `0x${byte.toString(16).padStart(2, "0")}`).join("+");
    const commandPcs = rule.commandPcs === undefined
      ? "*"
      : rule.commandPcs.map((pc) => `0x${pc.toString(16).padStart(4, "0")}`).join("+");
    const commandPcFilter = rule.excludedCommandPcs === undefined
      ? commandPcs
      : `!${rule.excludedCommandPcs.map((pc) => `0x${pc.toString(16).padStart(4, "0")}`).join("+")}`;
    const writePcs = rule.pcs === undefined
      ? "*"
      : rule.pcs.map((pc) => `0x${pc.toString(16).padStart(4, "0")}`).join("+");
    const writeRegs = rule.writeRegs === undefined
      ? "*"
      : rule.writeRegs.map((reg) => `0x${reg.toString(16).padStart(2, "0")}`).join("+");
    const writeVals = rule.writeVals === undefined
      ? "*"
      : rule.writeVals.map((val) => `0x${val.toString(16).padStart(2, "0")}`).join("+");
    const writeRegVals = rule.writeRegVals === undefined
      ? "*"
      : rule.writeRegVals.map(
        (pair) => `0x${pair.reg.toString(16).padStart(2, "0")}=0x${pair.val.toString(16).padStart(2, "0")}`,
      ).join("+");
    return `${bytes}:${rule.rawDeltaMin ?? "*"}:${rule.rawDeltaMax ?? "*"}:` +
      `${rule.delayCycles}:${rule.relation}:${rule.afterCycles}:${rule.beforeCycles ?? 0}:` +
      `${commandPcFilter}:${rule.anchor}:${writePcs}:${writeRegs}:${writeVals}:${writeRegVals}`;
  }).join(";");
}

function main(): void {
  const args = parseArgs();
  if (args.kinds.length === 0) throw new Error("--kinds must include ym2151 and/or pokey");
  if (args.kinds.includes("ym2151") && args.mameYm === undefined) throw new Error("--mame-ym is required for ym2151 diff");
  if (args.kinds.includes("pokey") && args.mamePokey === undefined) throw new Error("--mame-pokey is required for pokey diff");

  const rawCmdTape = readCmdTapeJson(args.cmdTape);
  const adjustedCmdTape = adjustCmdTapeCommandCycles(rawCmdTape, args);
  const timing = readTimingOriginsFromTape(adjustedCmdTape.tape, args.cmdTapeCommandTiming);
  const commandContextSummary = summarizeCommandContextFromTape(adjustedCmdTape.tape, timing.origins);
  if (args.requireCommandContext) assertRequiredCommandContext(commandContextSummary, "--require-command-context");
  const commandEvents = readCommandReplayEventsFromTape(
    adjustedCmdTape.tape,
    timing.origins,
    timing.replayOriginCycle,
    timing.firstFrame,
    args.cmdTapeCommandTiming,
  );
  const commandCycles = readCommandReplayCyclesFromEvents(commandEvents);
  const commandEventsBySource = new Map(commandEvents.map((event) => [event.sourceIndex, event]));
  const mameSoundCommandReads = readMameSoundCommandReadsFromTape(
    adjustedCmdTape.tape,
    timing.origins,
    timing.replayOriginCycle,
    commandEventsBySource,
    args.cmdTapeCommandTiming,
  );
  const mameSoundCommandReadContext = summarizeMameSoundCommandReads(mameSoundCommandReads);
  const mameCommandReadsBySource = new Map(
    mameSoundCommandReads.flatMap((read) => read.sourceIndex === undefined ? [] : [[read.sourceIndex, read] as const]),
  );
  const opcodeReader = readSoundRomOpcodeReader();
  const replayCommandCycleOffsetCycles = args.commandCycleOffsetBytes === undefined
    ? args.commandCycleOffsetCycles
    : 0;
  const tsRun = runTsWrites(
    args.frames,
    adjustedCmdTape.tape,
    args.cmdTape,
    commandEventsBySource,
    mameCommandReadsBySource,
    opcodeReader,
    args,
    args.statusBase,
    args.statusTape,
    args.statusTapeMode,
    args.resetReleaseDelayCycles,
    args.replyAckDelayCycles,
    args.replyAckTape,
    args.timerAStartDelayCycles,
    args.timerAHoldWhileOverflow,
    args.commandNmiDelayInstructions,
    args.commandNmiServiceDelayCycles,
    args.commandNmiSampleCycle,
    args.commandNmiBoundaryDelayInstructions,
    args.commandNmiDelayMatches,
    args.commandNmiDelayCompletedChipWritePreemptions,
    replayCommandCycleOffsetCycles,
    args.commandCycleOffsetStartFrame,
    args.commandSubmitBeforeCpuCatchup,
    args.commandPreemptChipWriteLookaheadCycles,
    args.commandPreemptChipWritePcs,
    args.commandPreemptChipWriteCompleteBeforeTarget,
    args.commandPreemptChipWriteBeforeOnly,
    args.deferChipIoWriteTiming,
    args.deferYmTimerControlWriteTiming,
    args.disableYmReset,
    args.cpuCliIrqDelay,
    args.cpuIrqPrefetchLatch,
    args.ymWriteEventCycleOffsetCycles,
    args.ymWriteEventCycleOffsetRegs,
    args.ymWriteEventCycleOffsetMatches,
    args.ymKeyOnWriteEventCycleOffsetCycles,
    args.ymIrqAssertionDelayCycles,
    args.ymIrqNewAssertionInstructionDelay,
    args.irqServiceDelayCycles,
    args.pokeyWriteApplyDelayCycles,
    args.pokeyWriteApplyDelayOpcodes,
    args.pokeyWriteApplyBoundaryDelayCycles,
    args.pokeyWriteApplyBoundaryDelaySampleRate,
  );
  const ymCommandEdgeEventAdjust =
    applyCommandEdgeEventAdjustForKind(tsRun.writes, commandEvents, args, "ym2151", tsRun.commandSubmissions, tsRun.commandReads);
  const pokeyCommandEdgeEventAdjust =
    applyCommandEdgeEventAdjustForKind(
      ymCommandEdgeEventAdjust.writes,
      commandEvents,
      args,
      "pokey",
      tsRun.commandSubmissions,
      tsRun.commandReads,
    );
  const pokeyEffectiveApplyTiming = applyPokeyEffectiveApplyTiming(pokeyCommandEdgeEventAdjust.writes, args);
  const pokeyEventBoundaryDelay = delayPokeyEventsNearSampleBoundary(pokeyEffectiveApplyTiming.writes, args);
  const tsWrites = pokeyEventBoundaryDelay.writes;
  if (args.tsYmWriteOut !== undefined) {
    writeTsYmWriteLog(
      args.tsYmWriteOut,
      tsWrites,
      timing.replayOriginCycle,
      args.frames,
      args.cmdTape,
      args.tsYmWriteOutOrigin,
    );
  }
  const results: DiffResult[] = [];
  for (const kind of args.kinds) {
    const ts = tsWrites.filter((w) => w.kind === kind);
    const mamePath = kind === "ym2151" ? args.mameYm! : args.mamePokey!;
    const mame = readMameWrites(
      mamePath,
      kind,
      timing.origins,
      timing.replayOriginCycle,
      opcodeReader,
      args.mameWriteCycleTiming,
    );
    results.push(diffWrites(
      kind,
      ts,
      mame,
      args,
      commandCycles,
      commandEvents,
      tsRun.commandSubmissions,
      tsRun.commandReads,
      tsRun.pokeyRawTransitions,
    ));
  }
  const commandReadComparison = commandReadComparisonSummary(
    commandEvents,
    mameCommandReadsBySource,
    tsRun.commandSubmissions,
    tsRun.commandReads,
  );
  const commandSubmitStateComparison = commandSubmitStateComparisonSummary(commandEvents, tsRun.commandSubmissions);
  if (args.commandSubmitOut !== undefined) {
    writeFileSync(args.commandSubmitOut, JSON.stringify({
      frames: args.frames,
      cmdTape: args.cmdTape,
      audioBitperfectPreset: args.audioBitperfectPreset,
      rowCount: tsRun.commandSubmitRows.length,
      commandSubmitStateComparison,
      rows: tsRun.commandSubmitRows,
    }, null, 2));
  }
  const eventDiffPassed = results.every((r) => r.mismatchCount <= args.maxMismatches);
  const rawBusWriteParityPassed = !args.requireRawBusWriteParity ||
    results.every((r) => r.rawBusWriteParity.mismatchCount <= args.rawBusWriteMaxMismatches);
  const summary = {
    passed: eventDiffPassed && rawBusWriteParityPassed,
    maxMismatches: args.maxMismatches,
    rawBusWriteParityRequired: args.requireRawBusWriteParity,
    rawBusWriteParityMode: args.rawBusWriteParityMode,
    rawBusWriteToleranceCycles: args.rawBusWriteToleranceCycles,
    rawBusWriteMaxMismatches: args.rawBusWriteMaxMismatches,
    rawBusWriteParityPassed,
    results: results.map((r) => ({
      kind: r.kind,
      compared: r.compared,
      tsCount: r.tsCount,
      mameCount: r.mameCount,
      mismatchCount: r.mismatchCount,
      frameMaxAbs: r.frameDelta.maxAbs,
      cycleMaxAbs: r.replayCycleDelta.maxAbs ?? r.sameFrameCycleDelta.maxAbs,
      nativeSampleMaxAbs: r.nativeSampleDelta.maxAbs,
      nativeSampleMismatchCount: r.nativeSampleMismatchContext.count,
      rawBusWriteMismatchCount: r.rawBusWriteParity.mismatchCount,
      rawBusWriteReplayMaxAbs: r.rawBusWriteParity.replayCycleDelta.maxAbs,
      rawBusWriteOffsetMaxAbs: r.rawBusWriteParity.writeOffsetDelta.maxAbs,
    })),
  };

  const report = {
    summary,
    ...(args.audioBitperfectPreset === undefined ? {} : { audioBitperfectPreset: args.audioBitperfectPreset }),
    frames: args.frames,
    cmdTape: args.cmdTape,
    cmdTapeCommandTiming: args.cmdTapeCommandTiming,
    mameWriteCycleTiming: args.mameWriteCycleTiming,
    cyclePreciseTape: tsRun.cyclePreciseTape,
    requireCommandContext: args.requireCommandContext,
    commandContext: commandContextSummary,
    mameSoundCommandReadContext,
    commandSubmitStateComparison,
    commandCount: commandCycles.length,
    maxMismatches: args.maxMismatches,
    frameTolerance: args.frameTolerance,
    cycleTolerance: args.cycleTolerance,
    sampleRate: args.sampleRate,
    sampleTolerance: args.sampleTolerance,
    samplePhaseCycles: args.samplePhaseCycles,
    requireRawBusWriteParity: args.requireRawBusWriteParity,
    rawBusWriteParityMode: args.rawBusWriteParityMode,
    rawBusWriteToleranceCycles: args.rawBusWriteToleranceCycles,
    rawBusWriteMaxMismatches: args.rawBusWriteMaxMismatches,
    ...(args.samplePhaseSweepCycles === undefined ? {} : { samplePhaseSweepCycles: args.samplePhaseSweepCycles }),
    resetReleaseDelayCycles: args.resetReleaseDelayCycles,
    resetFirstFetchDelayAfterCommandCycles: args.resetFirstFetchDelayAfterCommandCycles,
    replyAckDelayCycles: args.replyAckDelayCycles,
    useEmbeddedReplyAckTape: args.useEmbeddedReplyAckTape,
    timerAStartDelayCycles: args.timerAStartDelayCycles,
    timerAHoldWhileOverflow: args.timerAHoldWhileOverflow,
    commandNmiDelayInstructions: args.commandNmiDelayInstructions,
    commandNmiServiceDelayCycles: args.commandNmiServiceDelayCycles,
    commandNmiSampleCycle: args.commandNmiSampleCycle,
    commandNmiBoundaryDelayInstructions: args.commandNmiBoundaryDelayInstructions,
    ...(args.commandNmiDelayMatches.length === 0
      ? {}
      : { commandNmiDelayMatches: commandNmiDelayMatchesToJson(args.commandNmiDelayMatches) }),
    ...(args.commandNmiDelayChipWriteBoundaryInstructions === undefined
      ? {}
      : { commandNmiDelayChipWriteBoundaryInstructions: args.commandNmiDelayChipWriteBoundaryInstructions }),
    ...(args.commandNmiDelayCompletedChipWritePreemptions === undefined
      ? {}
      : { commandNmiDelayCompletedChipWritePreemptions: args.commandNmiDelayCompletedChipWritePreemptions }),
    commandCycleOffsetCycles: args.commandCycleOffsetCycles,
    ...(args.commandCycleOffsetStartFrame === undefined ? {} : { commandCycleOffsetStartFrame: args.commandCycleOffsetStartFrame }),
    ...(args.commandCycleOffsetBytes === undefined
      ? {}
      : { commandCycleOffsetBytes: args.commandCycleOffsetBytes.map((byte) => `0x${byte.toString(16).padStart(2, "0")}`) }),
    commandSubmitBeforeCpuCatchup: args.commandSubmitBeforeCpuCatchup,
    adjustedCommandCycleOffsetCount: adjustedCmdTape.adjustedCommandCount,
    ...(ymCommandEdgeEventAdjust.summary === undefined
      ? {}
      : { ymCommandEdgeEventAdjust: ymCommandEdgeEventAdjust.summary }),
    ...(pokeyCommandEdgeEventAdjust.summary === undefined
      ? {}
      : { pokeyCommandEdgeEventAdjust: pokeyCommandEdgeEventAdjust.summary }),
    ...(pokeyEffectiveApplyTiming.summary === undefined
      ? {}
      : { pokeyEffectiveApplyTimingSummary: pokeyEffectiveApplyTiming.summary }),
    ...(pokeyEventBoundaryDelay.summary === undefined
      ? {}
      : { pokeyEventBoundaryDelay: pokeyEventBoundaryDelay.summary }),
    ...(args.tsEventCycleAdjustOpcodes.size === 0
      ? {}
      : { tsEventCycleAdjustOpcodes: Object.fromEntries(
        Array.from(args.tsEventCycleAdjustOpcodes.entries())
          .sort((a, b) => a[0] - b[0])
          .map(([opcode, delta]) => [`0x${opcode.toString(16).padStart(2, "0")}`, delta]),
    ) }),
    ...(args.tsEventCycleAdjustMatches.length === 0
      ? {}
      : { tsEventCycleAdjustMatches: tsEventCycleAdjustMatchesToJson(args.tsEventCycleAdjustMatches) }),
    deferChipIoWriteTiming: args.deferChipIoWriteTiming,
    deferYmTimerControlWriteTiming: args.deferYmTimerControlWriteTiming,
    disableYmReset: args.disableYmReset,
    cpuCliIrqDelay: args.cpuCliIrqDelay,
    cpuIrqPrefetchLatch: args.cpuIrqPrefetchLatch,
    ymWriteEventCycleOffsetCycles: args.ymWriteEventCycleOffsetCycles,
    ...(args.ymWriteEventCycleOffsetRegs.size === 0
      ? {}
      : { ymWriteEventCycleOffsetRegs: registerCycleOffsetsToJson(args.ymWriteEventCycleOffsetRegs) }),
    ...(args.ymWriteEventCycleOffsetMatches.length === 0
      ? {}
      : { ymWriteEventCycleOffsetMatches: ymWriteEventCycleOffsetMatchesToJson(args.ymWriteEventCycleOffsetMatches) }),
    ymKeyOnWriteEventCycleOffsetCycles: args.ymKeyOnWriteEventCycleOffsetCycles,
    ymIrqAssertionDelayCycles: args.ymIrqAssertionDelayCycles,
    ymIrqNewAssertionInstructionDelay: args.ymIrqNewAssertionInstructionDelay,
    irqServiceDelayCycles: args.irqServiceDelayCycles,
    commandPreemptChipWriteLookaheadCycles: args.commandPreemptChipWriteLookaheadCycles,
    ...(args.commandPreemptChipWritePcs === undefined
      ? {}
      : { commandPreemptChipWritePcs: args.commandPreemptChipWritePcs.map((pc) => `0x${pc.toString(16).padStart(4, "0")}`) }),
    commandPreemptChipWriteCompleteBeforeTarget: args.commandPreemptChipWriteCompleteBeforeTarget,
    commandPreemptChipWriteBeforeOnly: args.commandPreemptChipWriteBeforeOnly,
    fixedFrameCycles: args.fixedFrameCycles,
    frameBudgetSmoothingWindow: args.frameBudgetSmoothingWindow,
    pokeyEffectiveApplyTiming: args.pokeyEffectiveApplyTiming,
    pokeyWriteApplyDelayCycles: args.pokeyWriteApplyDelayCycles,
    ...(args.pokeyWriteApplyDelayOpcodes.size === 0
      ? {}
      : { pokeyWriteApplyDelayOpcodes: Object.fromEntries(
        Array.from(args.pokeyWriteApplyDelayOpcodes.entries())
          .sort((a, b) => a[0] - b[0])
          .map(([opcode, delta]) => [`0x${opcode.toString(16).padStart(2, "0")}`, delta]),
    ) }),
    pokeyWriteApplyBoundaryDelayCycles: args.pokeyWriteApplyBoundaryDelayCycles,
    pokeyWriteApplyBoundaryDelaySampleRate: args.pokeyWriteApplyBoundaryDelaySampleRate,
    tsYmWriteOut: args.tsYmWriteOut,
    tsYmWriteOutOrigin: args.tsYmWriteOutOrigin,
    pcDeltaReport: args.pcDeltaReport,
    pcDeltaReportLimit: args.pcDeltaReportLimit,
    pcDeltaReportSamples: args.pcDeltaReportSamples,
    frameDeltaReport: args.frameDeltaReport,
    frameDeltaReportLimit: args.frameDeltaReportLimit,
    ...(args.frameOffsetSweepCycles === undefined
      ? {}
      : {
          frameOffsetSweepCycles: args.frameOffsetSweepCycles,
          frameOffsetSweepReportLimit: args.frameOffsetSweepReportLimit,
        }),
    ...(args.pokeyBoundaryGuardSweepCycles === undefined
      ? {}
      : { pokeyBoundaryGuardSweepCycles: args.pokeyBoundaryGuardSweepCycles }),
    ...(args.pokeyBoundaryCandidateReportCycles === undefined
      ? {}
      : { pokeyBoundaryCandidateReportCycles: args.pokeyBoundaryCandidateReportCycles }),
    pokeyStreamCursorReport: args.pokeyStreamCursorReport,
    pokeyLofiCursorReport: args.pokeyLofiCursorReport,
    ...(args.pcDeltaOffsetSweepCycles === undefined
      ? {}
      : { pcDeltaOffsetSweepCycles: args.pcDeltaOffsetSweepCycles }),
    ...(args.commandSubmitOut === undefined ? {} : { commandSubmitOut: args.commandSubmitOut }),
    ...(args.pcDeltaReportPcs === undefined
      ? {}
      : { pcDeltaReportPcs: args.pcDeltaReportPcs.map((pc) => `0x${pc.toString(16).padStart(4, "0")}`) }),
    ...(args.eventDeltaReportMatches.length === 0
      ? {}
      : {
          eventDeltaReportMatches: args.eventDeltaReportMatches.map(eventDeltaReportSelectorToJson),
          eventDeltaReportSamples: args.eventDeltaReportSamples,
          eventDeltaTargetNativeSampleDelta: args.eventDeltaTargetNativeSampleDelta,
        }),
    preemptedChipWrites: tsRun.preemptedChipWrites,
    commandSubmitDiagnostics: tsRun.commandSubmitDiagnostics,
    schedulerDrift: tsRun.schedulerDrift,
    commandReadComparison,
    ...(mainReplyAckReplayReport(tsRun.replyAckReplay) === undefined ? {} : { replyAckReplay: mainReplyAckReplayReport(tsRun.replyAckReplay) }),
    ...(args.statusBase === undefined ? {} : { statusBase: `0x${args.statusBase.toString(16).padStart(2, "0")}` }),
    ...(statusReplayReport(tsRun.statusReplay) === undefined ? {} : { statusReplay: statusReplayReport(tsRun.statusReplay) }),
    results,
  };
  if (args.report !== undefined) writeFileSync(args.report, JSON.stringify(report, null, 2));

  let failed = false;
  console.log(
    `TS tape cyclePrecise=${tsRun.cyclePreciseTape}; frames=${args.frames}; ` +
    (args.audioBitperfectPreset === undefined ? "" : `audioBitperfectPreset=${args.audioBitperfectPreset}; `) +
    (args.requireCommandContext
      ? `requireCommandContext=true; commandContext=${commandContextSummary.withCycleTiming}/` +
        `${commandContextSummary.total} cycleTiming ${commandContextSummary.withSoundPc}/` +
        `${commandContextSummary.total} soundPc ${commandContextSummary.withInstContext}/` +
        `${commandContextSummary.total} instFetch ${commandContextSummary.withNextInstContext}/` +
        `${commandContextSummary.total} nextInstFetch ${commandContextSummary.withNextChronoInstContext}/` +
        `${commandContextSummary.total} nextChronoInstFetch; ` +
        `mameSoundReads=${mameSoundCommandReadContext.withSourceIndex}/` +
        `${mameSoundCommandReadContext.total} sourceIndex ${mameSoundCommandReadContext.withCommandDelta}/` +
        `${mameSoundCommandReadContext.total} commandDelta ${mameSoundCommandReadContext.withInstContext}/` +
        `${mameSoundCommandReadContext.total} instFetch; `
      : "") +
    `commandTiming=${args.cmdTapeCommandTiming}; frameTolerance=${args.frameTolerance}; cycleTolerance=${args.cycleTolerance}` +
    `; mameWriteCycleTiming=${args.mameWriteCycleTiming}` +
    (args.sampleRate === undefined
      ? ""
      : `; sampleRate=${args.sampleRate}; sampleTolerance=${args.sampleTolerance}; samplePhaseCycles=${args.samplePhaseCycles}`) +
    (args.pcDeltaOffsetSweepCycles === undefined
      ? ""
      : `; pcDeltaOffsetSweep=${args.pcDeltaOffsetSweepCycles.join(",")}`) +
    (args.frameOffsetSweepCycles === undefined
      ? ""
      : `; frameOffsetSweep=${args.frameOffsetSweepCycles.join(",")}`) +
    (args.resetReleaseDelayCycles === 0 ? "" : `; resetReleaseDelayCycles=${args.resetReleaseDelayCycles}`) +
    (args.resetFirstFetchDelayAfterCommandCycles === 0
      ? ""
      : `; resetFirstFetchDelayAfterCommandCycles=${args.resetFirstFetchDelayAfterCommandCycles}`) +
    (args.replyAckDelayCycles === 0 ? "" : `; replyAckDelayCycles=${args.replyAckDelayCycles}`) +
    (args.timerAStartDelayCycles === 0 ? "" : `; timerAStartDelayCycles=${args.timerAStartDelayCycles}`) +
    (args.commandNmiDelayInstructions === 0 ? "" : `; commandNmiDelayInstructions=${args.commandNmiDelayInstructions}`) +
    (args.commandNmiServiceDelayCycles === 0 ? "" : `; commandNmiServiceDelayCycles=${args.commandNmiServiceDelayCycles}`) +
    `; commandNmiSampleCycle=${args.commandNmiSampleCycle}` +
    (args.commandNmiBoundaryDelayInstructions === 0
      ? ""
      : `; commandNmiBoundaryDelayInstructions=${args.commandNmiBoundaryDelayInstructions}`) +
    (args.commandNmiDelayMatches.length === 0
      ? ""
      : `; commandNmiDelayMatches=${fmtCommandNmiDelayMatches(args.commandNmiDelayMatches)}`) +
    (args.commandNmiDelayChipWriteBoundaryInstructions === undefined
      ? ""
      : `; commandNmiDelayChipWriteBoundaryInstructions=${args.commandNmiDelayChipWriteBoundaryInstructions}`) +
    (args.commandNmiDelayCompletedChipWritePreemptions === undefined
      ? ""
      : `; commandNmiDelayCompletedChipWritePreemptions=${args.commandNmiDelayCompletedChipWritePreemptions}`) +
    (args.commandCycleOffsetCycles === 0 ? "" : `; commandCycleOffsetCycles=${args.commandCycleOffsetCycles}`) +
    (args.commandCycleOffsetStartFrame === undefined ? "" : `; commandCycleOffsetStartFrame=${args.commandCycleOffsetStartFrame}`) +
    (args.commandCycleOffsetBytes === undefined
      ? ""
      : `; commandCycleOffsetBytes=${args.commandCycleOffsetBytes.map((byte) => `0x${byte.toString(16).padStart(2, "0")}`).join(",")}` +
        `; adjustedCommandCycleOffsetCount=${adjustedCmdTape.adjustedCommandCount}`) +
    (args.commandSubmitBeforeCpuCatchup ? "; commandSubmitBeforeCpuCatchup=true" : "") +
    (args.tsEventCycleAdjustOpcodes.size === 0 ? "" : `; tsEventCycleAdjustOpcodes=${fmtOpcodeAdjustments(args.tsEventCycleAdjustOpcodes)}`) +
    (args.tsEventCycleAdjustMatches.length === 0
      ? ""
      : `; tsEventCycleAdjustMatches=${fmtTsEventCycleAdjustMatches(args.tsEventCycleAdjustMatches)}`) +
    (args.deferChipIoWriteTiming ? "; deferChipIoWriteTiming=true" : "") +
    (args.deferYmTimerControlWriteTiming ? "; deferYmTimerControlWriteTiming=true" : "") +
    (args.disableYmReset ? "; disableYmReset=true" : "") +
    (args.cpuCliIrqDelay ? "; cpuCliIrqDelay=true" : "") +
    (args.cpuIrqPrefetchLatch ? "; cpuIrqPrefetchLatch=true" : "") +
    (args.ymWriteEventCycleOffsetCycles === 0 ? "" : `; ymWriteEventCycleOffsetCycles=${args.ymWriteEventCycleOffsetCycles}`) +
    (args.ymWriteEventCycleOffsetRegs.size === 0
      ? ""
      : `; ymWriteEventCycleOffsetRegs=${fmtRegisterCycleOffsets(args.ymWriteEventCycleOffsetRegs)}`) +
    (args.ymWriteEventCycleOffsetMatches.length === 0
      ? ""
      : `; ymWriteEventCycleOffsetMatches=${fmtYmWriteEventCycleOffsetMatches(args.ymWriteEventCycleOffsetMatches)}`) +
    (args.ymKeyOnWriteEventCycleOffsetCycles === 0
      ? ""
      : `; ymKeyOnWriteEventCycleOffsetCycles=${args.ymKeyOnWriteEventCycleOffsetCycles}`) +
    (args.ymIrqAssertionDelayCycles === 0
      ? ""
      : `; ymIrqAssertionDelayCycles=${args.ymIrqAssertionDelayCycles}`) +
    (args.ymIrqNewAssertionInstructionDelay === 0
      ? ""
      : `; ymIrqNewAssertionInstructionDelay=${args.ymIrqNewAssertionInstructionDelay}`) +
    (args.ymCommandEdgeEventRules.length > 0
      ? `; ymCommandEdgeEventRules=${fmtCommandEdgeEventRules(commandEdgeEventRulesForArgs(args, "ym2151"))}`
      : args.ymCommandEdgeEventDelayCycles === undefined
        ? ""
        : `; ymCommandEdgeEventDelay=${args.ymCommandEdgeEventDelayCycles}` +
        `; ymCommandEdgeEventAfter=${args.ymCommandEdgeEventAfterCycles}` +
        `; ymCommandEdgeEventRelation=${args.ymCommandEdgeEventRelation}` +
        (args.ymCommandEdgeEventBytes === undefined
          ? ""
          : `; ymCommandEdgeEventBytes=${args.ymCommandEdgeEventBytes.map((byte) => `0x${byte.toString(16).padStart(2, "0")}`).join(",")}`) +
        (args.ymCommandEdgeEventPcs === undefined
          ? ""
          : `; ymCommandEdgeEventPcs=${args.ymCommandEdgeEventPcs.map((pc) => `0x${pc.toString(16).padStart(4, "0")}`).join(",")}`) +
        (args.ymCommandEdgeEventRawDeltaMin === undefined
          ? ""
          : `; ymCommandEdgeEventRawDeltaMin=${args.ymCommandEdgeEventRawDeltaMin}`) +
        (args.ymCommandEdgeEventRawDeltaMax === undefined
          ? ""
          : `; ymCommandEdgeEventRawDeltaMax=${args.ymCommandEdgeEventRawDeltaMax}`)) +
    (args.pokeyCommandEdgeEventRules.length > 0
      ? `; pokeyCommandEdgeEventRules=${fmtCommandEdgeEventRules(commandEdgeEventRulesForArgs(args, "pokey"))}`
      : "") +
    (pokeyEventBoundaryDelay.summary === undefined
      ? ""
      : `; pokeyEventBoundaryDelay=${pokeyEventBoundaryDelay.summary.applied}` +
        `/${pokeyEventBoundaryDelay.summary.thresholdCycles}`) +
    (args.irqServiceDelayCycles === 0 ? "" : `; irqServiceDelayCycles=${args.irqServiceDelayCycles}`) +
    (args.pokeyEffectiveApplyTiming ? "; pokeyEffectiveApplyTiming=true" : "") +
    (args.pokeyWriteApplyDelayCycles === 0 ? "" : `; pokeyWriteApplyDelayCycles=${args.pokeyWriteApplyDelayCycles}`) +
    (args.pokeyWriteApplyDelayOpcodes.size === 0
      ? ""
      : `; pokeyWriteApplyDelayOpcodes=${fmtOpcodeAdjustments(args.pokeyWriteApplyDelayOpcodes)}`) +
    (args.pokeyWriteApplyBoundaryDelayCycles === 0
      ? ""
      : `; pokeyWriteApplyBoundaryDelay=${args.pokeyWriteApplyBoundaryDelayCycles}` +
        `@${args.pokeyWriteApplyBoundaryDelaySampleRate}Hz`) +
    (args.tsYmWriteOut === undefined ? "" : `; tsYmWriteOut=${args.tsYmWriteOut}; tsYmWriteOutOrigin=${args.tsYmWriteOutOrigin}`) +
    (args.commandPreemptChipWriteLookaheadCycles === 0 ? "" : `; commandPreemptChipWriteLookaheadCycles=${args.commandPreemptChipWriteLookaheadCycles}`) +
    (args.commandPreemptChipWritePcs === undefined
      ? ""
      : `; commandPreemptChipWritePcs=${args.commandPreemptChipWritePcs.map((pc) => `0x${pc.toString(16).padStart(4, "0")}`).join(",")}`) +
    (args.commandPreemptChipWriteCompleteBeforeTarget
      ? "; commandPreemptChipWriteCompleteBeforeTarget=true"
      : "") +
    (args.commandPreemptChipWriteBeforeOnly ? "; commandPreemptChipWriteBeforeOnly=true" : "") +
    (args.fixedFrameCycles ? "; fixedFrameCycles=true" : "") +
    (args.frameBudgetSmoothingWindow === 0
      ? ""
      : `; frameBudgetSmoothingWindow=${args.frameBudgetSmoothingWindow}`) +
    (args.pcDeltaReport ? `; pcDeltaReportLimit=${args.pcDeltaReportLimit}; pcDeltaReportSamples=${args.pcDeltaReportSamples}` : "") +
    (args.eventDeltaReportMatches.length === 0
      ? ""
      : `; eventDeltaReportMatches=${args.eventDeltaReportMatches.map(fmtEventDeltaReportSelector).join(",")}` +
        `; eventDeltaReportSamples=${args.eventDeltaReportSamples}` +
        (args.eventDeltaTargetNativeSampleDelta === undefined
          ? ""
          : `; eventDeltaTargetNativeSampleDelta=${args.eventDeltaTargetNativeSampleDelta}`)) +
    (args.requireRawBusWriteParity
      ? `; requireRawBusWriteParity=true; rawBusWriteParityMode=${args.rawBusWriteParityMode}` +
        `; rawBusWriteToleranceCycles=${args.rawBusWriteToleranceCycles}` +
        `; rawBusWriteMaxMismatches=${args.rawBusWriteMaxMismatches}`
      : "") +
    (args.useEmbeddedReplyAckTape ? "" : "; embeddedReplyAckTape=false") +
    (tsRun.replyAckReplay === undefined ? "" : `; replyAckTapeAcks=${tsRun.replyAckReplay.stats.ackCount}`) +
    (args.statusBase === undefined ? "" : `; statusBase=0x${args.statusBase.toString(16).padStart(2, "0")}`) +
    (tsRun.statusReplay === undefined ? "" : `; statusTapeReads=${tsRun.statusReplay.mameReadCount}` +
      `; statusTapeMode=${tsRun.statusReplay.mode}; statusValueMode=${tsRun.statusReplay.valueMode}`),
  );
  console.log(
    `schedulerDrift: frames=${tsRun.schedulerDrift.frameCount} ` +
    `activeFrames=${tsRun.schedulerDrift.activeFrameCount} ` +
    `commandFrames=${tsRun.schedulerDrift.commandFrameCount} ` +
    `startDelta=[${tsRun.schedulerDrift.minCpuStartDelta},${tsRun.schedulerDrift.maxCpuStartDelta}] ` +
    `endDelta=[${tsRun.schedulerDrift.minCpuEndDelta},${tsRun.schedulerDrift.maxCpuEndDelta}] ` +
    `maxAbsStart=${tsRun.schedulerDrift.maxAbsCpuStartDelta} ` +
    `maxAbsEnd=${tsRun.schedulerDrift.maxAbsCpuEndDelta} ` +
    `topStart={${fmtTopHistogram(tsRun.schedulerDrift.byCpuStartDelta)}} ` +
    `topEnd={${fmtTopHistogram(tsRun.schedulerDrift.byCpuEndDelta)}}`,
  );
  if (tsRun.statusReplay !== undefined) {
    console.log(
      `statusReplay: applied=${tsRun.statusReplay.appliedReadCount}/${tsRun.statusReplay.mameReadCount} ` +
      `tsReads=${tsRun.statusReplay.tsReadCount} exhausted=${tsRun.statusReplay.exhaustedReadCount} ` +
      `baseMismatches=${tsRun.statusReplay.baseMismatchCount} ` +
      `valueMismatches=${tsRun.statusReplay.valueMismatchCount}`,
    );
  }
  if (tsRun.replyAckReplay !== undefined) {
    const stats = tsRun.replyAckReplay.stats;
    console.log(
      `replyAckReplay: scheduled=${stats.scheduledWriteCount}/${stats.ackCount} ` +
      `exhausted=${stats.exhaustedWriteCount} skipped=${stats.skippedAckCount} source=${stats.source}`,
    );
  }
  if (ymCommandEdgeEventAdjust.summary !== undefined) {
    const top = ymCommandEdgeEventAdjust.summary.byPc.slice(0, 5)
      .map((entry) => `${entry.pc}:${entry.count}`)
      .join(" | ");
    const writeContextTop = ymCommandEdgeEventAdjust.summary.byWriteContext.slice(0, 3)
      .map((entry) => `${entry.writePc}/${entry.writeReg}:${entry.count} targetFromRead={${fmtHistogram(entry.byTargetDeltaFromFirstRead)}}`)
      .join(" | ");
    console.log(
      `ymCommandEdgeEventAdjust: applied=${ymCommandEdgeEventAdjust.summary.applied} ` +
      `relations={${fmtHistogram(ymCommandEdgeEventAdjust.summary.byRelation)}} ` +
      `bytes={${fmtHistogram(ymCommandEdgeEventAdjust.summary.byCommandByte)}} ` +
      `cmdPc={${fmtHistogram(ymCommandEdgeEventAdjust.summary.byCommandSoundPc)}} ` +
      `rawDelta={${fmtHistogram(ymCommandEdgeEventAdjust.summary.byRawDeltaFromCommand)}} ` +
      `targetDelay={${fmtHistogram(ymCommandEdgeEventAdjust.summary.byTargetDelayCycles)}} ` +
      `readDelta={${fmtHistogram(ymCommandEdgeEventAdjust.summary.byFirstReadDeltaFromCommand)}} ` +
      `targetFromRead={${fmtHistogram(ymCommandEdgeEventAdjust.summary.byTargetDeltaFromFirstRead)}}` +
      (top === "" ? "" : ` top=${top}`) +
      (writeContextTop === "" ? "" : ` writeContext=${writeContextTop}`),
    );
  }
  if (pokeyCommandEdgeEventAdjust.summary !== undefined) {
    const top = pokeyCommandEdgeEventAdjust.summary.byPc.slice(0, 5)
      .map((entry) => `${entry.pc}:${entry.count}`)
      .join(" | ");
    const writeContextTop = pokeyCommandEdgeEventAdjust.summary.byWriteContext.slice(0, 3)
      .map((entry) => `${entry.writePc}/${entry.writeReg}:${entry.count} targetFromRead={${fmtHistogram(entry.byTargetDeltaFromFirstRead)}}`)
      .join(" | ");
    console.log(
      `pokeyCommandEdgeEventAdjust: applied=${pokeyCommandEdgeEventAdjust.summary.applied} ` +
      `relations={${fmtHistogram(pokeyCommandEdgeEventAdjust.summary.byRelation)}} ` +
      `bytes={${fmtHistogram(pokeyCommandEdgeEventAdjust.summary.byCommandByte)}} ` +
      `cmdPc={${fmtHistogram(pokeyCommandEdgeEventAdjust.summary.byCommandSoundPc)}} ` +
      `rawDelta={${fmtHistogram(pokeyCommandEdgeEventAdjust.summary.byRawDeltaFromCommand)}} ` +
      `targetDelay={${fmtHistogram(pokeyCommandEdgeEventAdjust.summary.byTargetDelayCycles)}} ` +
      `readDelta={${fmtHistogram(pokeyCommandEdgeEventAdjust.summary.byFirstReadDeltaFromCommand)}} ` +
      `targetFromRead={${fmtHistogram(pokeyCommandEdgeEventAdjust.summary.byTargetDeltaFromFirstRead)}}` +
      (top === "" ? "" : ` top=${top}`) +
      (writeContextTop === "" ? "" : ` writeContext=${writeContextTop}`),
    );
  }
  if (tsRun.preemptedChipWrites.commandCount > 0) {
    const top = tsRun.preemptedChipWrites.byPc.slice(0, 5)
      .map((entry) => `${entry.pc}:${entry.count} firstFrame=${entry.firstCommand.frame} delta=${entry.firstCommand.targetDeltaFromWrite}`)
      .join(" | ");
    console.log(`preemptedChipWrites: commands=${tsRun.preemptedChipWrites.commandCount} top=${top}`);
  }
  if (tsRun.commandSubmitDiagnostics.overrideMatchCount > 0) {
    const samples = tsRun.commandSubmitDiagnostics.overrideSamples
      .map((sample) =>
        `f${sample.frame}:${sample.byte}@${sample.cycleInFrame}` +
        ` actual=${sample.actualCycleInFrame}` +
        ` pending=${sample.pendingBefore ? "1" : "0"}` +
        ` delay=${sample.commandNmiDelayInstructions}` +
        ` override=${sample.overrideDelayInstructions}`)
      .join(" | ");
    console.log(
      `commandSubmitDiagnostics: commands=${tsRun.commandSubmitDiagnostics.commandCount} ` +
      `pendingBefore=${tsRun.commandSubmitDiagnostics.pendingBeforeCount} ` +
      `delayHist={${fmtHistogram(tsRun.commandSubmitDiagnostics.nmiDelayHistogram)}} ` +
      `overrideMatches=${tsRun.commandSubmitDiagnostics.overrideMatchCount} ` +
      `overridePendingBefore=${tsRun.commandSubmitDiagnostics.overridePendingBeforeCount}` +
      (samples === "" ? "" : ` samples=${samples}`),
    );
  }
  if (commandReadComparison.withMameRead > 0) {
    console.log(
      `commandReadComparison: ts=${commandReadComparison.withTsRead}/${commandReadComparison.totalCommands} ` +
      `mame=${commandReadComparison.withMameRead}/${commandReadComparison.totalCommands} ` +
      `both=${commandReadComparison.withBothReads}/${commandReadComparison.totalCommands} ` +
      `mameMinusTs={${fmtHistogram(commandReadComparison.byMameMinusTsReadDelta)}} ` +
      `mameMinusTsStats=${fmtDeltaStats(commandReadComparison.mameMinusTsReadDeltaStats)} ` +
      `delayDelta={${fmtHistogram(commandReadComparison.bySubmitNmiDelayAndReadDelta)}}`,
    );
  }
  if (commandSubmitStateComparison.withExpectedState > 0) {
    const first = commandSubmitStateComparison.firstMismatch === undefined
      ? ""
      : ` first=f${commandSubmitStateComparison.firstMismatch.frame}` +
        `:${commandSubmitStateComparison.firstMismatch.byte}` +
        `@${commandSubmitStateComparison.firstMismatch.cycleInFrame}` +
        ` fields=${commandSubmitStateComparison.firstMismatch.fields.join(",")}` +
        ` pcRelation=${commandSubmitStateComparison.firstMismatch.actualPcRelation}` +
        ` expected=${JSON.stringify(commandSubmitStateComparison.firstMismatch.expected)}` +
        ` actual=${JSON.stringify(commandSubmitStateComparison.firstMismatch.actual)}`;
    console.log(
      `commandSubmitStateComparison: expected=${commandSubmitStateComparison.withExpectedState}/` +
      `${commandSubmitStateComparison.totalCommands} actual=${commandSubmitStateComparison.withActualState}/` +
      `${commandSubmitStateComparison.totalCommands} exact=${commandSubmitStateComparison.exact} ` +
      `exactIgnoringP=${commandSubmitStateComparison.exactIgnoringP} ` +
      `mismatch=${commandSubmitStateComparison.mismatch} ` +
      `fields={${fmtHistogram(commandSubmitStateComparison.byMismatchField)}} ` +
      `pcRelation={${fmtHistogram(commandSubmitStateComparison.byActualPcRelation)}}` +
      first,
    );
  }
  for (const r of results) {
    const status = r.mismatchCount <= args.maxMismatches ? "PASS" : "FAIL";
    console.log(`${status} ${r.kind}: compared=${r.compared} mismatches=${r.mismatchCount} TS=${r.tsCount} MAME=${r.mameCount}`);
    if (r.frameDelta.compared > 0) {
      console.log(
        `  frameDelta(ts-mame): min=${r.frameDelta.min} max=${r.frameDelta.max} ` +
        `maxAbs=${r.frameDelta.maxAbs} meanAbs=${r.frameDelta.meanAbs?.toFixed(2)}`,
      );
    }
    if (r.sameFrameCycleDelta.compared > 0) {
      console.log(
        `  sameFrameCycleDelta(ts-mame): min=${r.sameFrameCycleDelta.min} max=${r.sameFrameCycleDelta.max} ` +
        `maxAbs=${r.sameFrameCycleDelta.maxAbs} meanAbs=${r.sameFrameCycleDelta.meanAbs?.toFixed(2)}`,
      );
    }
    if (r.replayCycleDelta.compared > 0) {
      console.log(
        `  replayCycleDelta(ts-mame): min=${r.replayCycleDelta.min} max=${r.replayCycleDelta.max} ` +
        `maxAbs=${r.replayCycleDelta.maxAbs} meanAbs=${r.replayCycleDelta.meanAbs?.toFixed(2)}`,
      );
    }
    if (r.instructionFetchDelta.count > 0) {
      const writeDelta = r.instructionFetchDelta.tsWriteOffsetDelta.compared === 0
        ? ""
        : ` tsWriteMinusMameFetchDelta={${fmtHistogram(r.instructionFetchDelta.byTsMinusMameInstDelta)}}` +
          ` meanAbs=${r.instructionFetchDelta.tsWriteOffsetDelta.meanAbs?.toFixed(2)}`;
      const rawWriteDelta = r.instructionFetchDelta.tsRawWriteOffsetDelta.compared === 0
        ? ""
        : ` tsRawWriteMinusMameFetchDelta={${fmtHistogram(r.instructionFetchDelta.byTsRawMinusMameInstDelta)}}` +
          ` rawMeanAbs=${r.instructionFetchDelta.tsRawWriteOffsetDelta.meanAbs?.toFixed(2)}`;
      console.log(
        `  instructionFetchDelta: count=${r.instructionFetchDelta.count} ` +
        `mameInstDelta={${fmtHistogram(r.instructionFetchDelta.byMameInstDeltaCycles)}} ` +
        `mameOpcode={${fmtHistogram(r.instructionFetchDelta.byMameInstOpcode)}} ` +
        `tsWriteOffset={${fmtHistogram(r.instructionFetchDelta.byTsWriteOffset)}}` +
        writeDelta +
        rawWriteDelta,
      );
    }
    if (r.rawBusWriteParity.compared > 0) {
      const rawBusStatus = r.rawBusWriteParity.passed ? "PASS" : "FAIL";
      const first = r.rawBusWriteParity.firstMismatch === undefined
        ? ""
        : ` first=#${r.rawBusWriteParity.firstMismatch.index}` +
          ` reasons=${r.rawBusWriteParity.firstMismatch.reasons.join(",")}` +
          ` dReplay=${r.rawBusWriteParity.firstMismatch.replayCycleDelta ?? "?"}` +
          ` dOffset=${r.rawBusWriteParity.firstMismatch.writeOffsetDelta ?? "?"}`;
      console.log(
        `  ${rawBusStatus} rawBusWriteParity` +
        (r.rawBusWriteParity.required ? "[required]" : "") +
        ` mode=${r.rawBusWriteParity.mode}` +
        `: compared=${r.rawBusWriteParity.compared}` +
        ` timing=${r.rawBusWriteParity.timingCompared}` +
        ` mismatches=${r.rawBusWriteParity.mismatchCount}` +
        ` orderPayload=${r.rawBusWriteParity.orderPayloadMismatchCount}` +
        ` missingTiming=${r.rawBusWriteParity.missingTimingCount}` +
        ` replayDelta=${fmtDeltaStats(r.rawBusWriteParity.replayCycleDelta)}` +
        ` replayHist={${fmtHistogram(r.rawBusWriteParity.replayCycleDeltaHistogram)}}` +
        ` offsetDelta=${fmtDeltaStats(r.rawBusWriteParity.writeOffsetDelta)}` +
        ` offsetHist={${fmtHistogram(r.rawBusWriteParity.writeOffsetDeltaHistogram)}}` +
        first,
      );
      if (r.rawBusWriteParity.frameDrift.length > 0) {
        const frameDrift = r.rawBusWriteParity.frameDrift.slice(0, 8).map((entry) =>
          `${entry.frame}:n=${entry.compared}` +
          ` delta=${fmtDeltaStats(entry.replayCycleDelta)}` +
          ` first=#${entry.firstIndex}:${entry.firstReplayCycleDelta}`)
          .join(" | ");
        console.log(`  rawBusFrameDrift: ${frameDrift}`);
      }
    }
    if (r.nativeSampleDelta.compared > 0) {
      console.log(
        `  nativeSampleDelta@${r.nativeSampleDelta.sampleRate}Hz phase=${r.nativeSampleDelta.samplePhaseCycles}c(ts-mame): ` +
        `min=${r.nativeSampleDelta.min} max=${r.nativeSampleDelta.max} ` +
        `maxAbs=${r.nativeSampleDelta.maxAbs} meanAbs=${r.nativeSampleDelta.meanAbs?.toFixed(2)}`,
      );
      console.log(`  nativeSampleDeltaHistogram: {${fmtHistogram(r.nativeSampleDeltaHistogram)}}`);
      if (r.nativeSampleDeltaByRegisterCategory.length > 0) {
        console.log(`  nativeSampleDeltaByCategory: ${fmtNativeSampleDeltaBreakdown(r.nativeSampleDeltaByRegisterCategory)}`);
      }
      if (r.nativeSampleDeltaByRegister.length > 0) {
        console.log(`  nativeSampleDeltaByRegister: ${fmtNativeSampleDeltaBreakdown(r.nativeSampleDeltaByRegister)}`);
      }
      if ((r.nativeSampleDeltaByPokeyEffectiveApplyDelay?.length ?? 0) > 0) {
        console.log(
          `  nativeSampleDeltaByPokeyApplyDelay: ` +
          fmtNativeSampleDeltaBreakdown(r.nativeSampleDeltaByPokeyEffectiveApplyDelay!),
        );
      }
      if (r.nativeSampleNonExactContext.count > 0 &&
        r.nativeSampleNonExactContext.count !== r.nativeSampleMismatchContext.count) {
        console.log(`  nativeSampleNonExactContext: ${fmtNativeSampleMismatchContext(r.nativeSampleNonExactContext)}`);
      }
      if (r.nativeSampleMismatchContext.count > 0) {
        console.log(`  nativeSampleMismatchContext: ${fmtNativeSampleMismatchContext(r.nativeSampleMismatchContext)}`);
      }
      if (r.nativeSampleMismatchByCommandSource.length > 0) {
        console.log(
          `  nativeSampleMismatchByCommandSource: ` +
          fmtNativeSampleCommandMismatchBreakdown(r.nativeSampleMismatchByCommandSource),
        );
      }
    }
    if (r.samplePhaseSweep !== undefined && r.samplePhaseSweep.length > 0) {
      const topPhases = [...r.samplePhaseSweep]
        .sort((a, b) =>
          a.mismatchCount - b.mismatchCount ||
          (a.nativeSampleDelta.meanAbs ?? Number.POSITIVE_INFINITY) -
            (b.nativeSampleDelta.meanAbs ?? Number.POSITIVE_INFINITY) ||
          a.phaseCycles - b.phaseCycles)
        .slice(0, 8)
        .map((entry) =>
          `${entry.phaseCycles}c:${entry.mismatchCount}` +
          (entry.nativeSampleDelta.meanAbs === undefined
            ? ""
            : ` meanAbs=${entry.nativeSampleDelta.meanAbs.toFixed(2)}`))
        .join(" | ");
      console.log(`  samplePhaseSweep(best): ${topPhases}`);
    }
    if (r.commandCrossings.mismatchCount > 0) {
      console.log(
        `  commandCrossings: mismatches=${r.commandCrossings.mismatchCount}` +
        (r.commandCrossings.firstMismatch === undefined
          ? ""
          : ` first=#${r.commandCrossings.firstMismatch.index} ${fmtCommandCrossing(r.commandCrossings.firstMismatch.crossing)}`),
      );
    }
    if (r.rawCommandCrossings.mismatchCount > 0 &&
      r.rawCommandCrossings.mismatchCount !== r.commandCrossings.mismatchCount) {
      console.log(
        `  rawCommandCrossings: mismatches=${r.rawCommandCrossings.mismatchCount}` +
        (r.rawCommandCrossings.firstMismatch === undefined
          ? ""
          : ` first=#${r.rawCommandCrossings.firstMismatch.index} ${fmtCommandCrossing(r.rawCommandCrossings.firstMismatch.crossing)}`),
      );
    }
    if (r.commandNearMisses.mismatchCount > 0) {
      console.log(
        `  commandNearMisses(${r.commandNearMisses.lookaheadCycles}c): mismatches=${r.commandNearMisses.mismatchCount}` +
        (r.commandNearMisses.firstMismatch === undefined
          ? ""
          : ` first=#${r.commandNearMisses.firstMismatch.index} ${fmtCommandNearMiss(r.commandNearMisses.firstMismatch.nearMiss)}`),
      );
    }
    if (r.rawCommandNearMisses.mismatchCount > 0 &&
      r.rawCommandNearMisses.mismatchCount !== r.commandNearMisses.mismatchCount) {
      console.log(
        `  rawCommandNearMisses(${r.rawCommandNearMisses.lookaheadCycles}c): mismatches=${r.rawCommandNearMisses.mismatchCount}` +
        (r.rawCommandNearMisses.firstMismatch === undefined
          ? ""
          : ` first=#${r.rawCommandNearMisses.firstMismatch.index} ${fmtCommandNearMiss(r.rawCommandNearMisses.firstMismatch.nearMiss)}`),
      );
    }
    if (r.mismatchClusters.length > 0) {
      const clusters = r.mismatchClusters.slice(0, 5).map((cluster) => {
        const replayDelta = cluster.replayCycleDelta.compared === 0
          ? ""
          : ` replayDelta=[${cluster.replayCycleDelta.min},${cluster.replayCycleDelta.max}] meanAbs=${cluster.replayCycleDelta.meanAbs?.toFixed(2)}`;
        const sampleDelta = cluster.nativeSampleDelta.compared === 0
          ? ""
          : ` sampleDelta=[${cluster.nativeSampleDelta.min},${cluster.nativeSampleDelta.max}] meanAbs=${cluster.nativeSampleDelta.meanAbs?.toFixed(2)}`;
        const crossings = cluster.commandCrossings === 0 ? "" : ` crossings=${cluster.commandCrossings}`;
        const rawCrossings = cluster.rawCommandCrossings === cluster.commandCrossings || cluster.rawCommandCrossings === 0
          ? ""
          : ` rawCrossings=${cluster.rawCommandCrossings}`;
        const nearMisses = cluster.commandNearMisses === 0 ? "" : ` nearMisses=${cluster.commandNearMisses}`;
        const rawNearMisses = cluster.rawCommandNearMisses === cluster.commandNearMisses || cluster.rawCommandNearMisses === 0
          ? ""
          : ` rawNearMisses=${cluster.rawCommandNearMisses}`;
        return `${cluster.pc}:${cluster.count}${crossings}${rawCrossings}${nearMisses}${rawNearMisses} first=#${cluster.firstIndex} fields=${fmtFieldCounts(cluster.fieldCounts)}${replayDelta}${sampleDelta}`;
      }).join(" | ");
      console.log(`  topMismatchClusters: ${clusters}`);
    }
    if (r.pcDeltaReport !== undefined && r.pcDeltaReport.length > 0) {
      const pcDeltas = r.pcDeltaReport.map((entry) => {
        const sample = entry.nativeSampleDelta.compared === 0
          ? ""
          : ` sampleDelta=${fmtDeltaStats(entry.nativeSampleDelta)} hist={${fmtHistogram(entry.nativeSampleDeltaHistogram)}}`;
        const target = entry.nativeSampleMismatchTargetCycleOffset.compared === 0
          ? ""
          : ` targetOffset=${fmtDeltaStats(entry.nativeSampleMismatchTargetCycleOffset)}` +
            ` top={${fmtTopHistogram(entry.nativeSampleMismatchTargetCycleOffsetHistogram)}}`;
        const interval = entry.intervalDelta.compared === 0
          ? ""
          : ` intervalDelta=${fmtDeltaStats(entry.intervalDelta)}`;
        const offsetSweep = entry.offsetSweep === undefined || entry.offsetSweep.length === 0
          ? ""
          : ` offsetSweep=` + [...entry.offsetSweep]
            .sort((a, b) =>
              a.mismatchCount - b.mismatchCount ||
              (a.nativeSampleDelta.meanAbs ?? Number.POSITIVE_INFINITY) -
                (b.nativeSampleDelta.meanAbs ?? Number.POSITIVE_INFINITY) ||
              a.offsetCycles - b.offsetCycles)
            .slice(0, 6)
            .map((sweep) =>
              `${sweep.offsetCycles}c:${sweep.mismatchCount}` +
              (sweep.nativeSampleDelta.meanAbs === undefined
                ? ""
                : ` meanAbs=${sweep.nativeSampleDelta.meanAbs.toFixed(2)}`))
            .join(",");
        const fields = Object.keys(entry.fieldCounts).length === 0
          ? ""
          : ` fields=${fmtFieldCounts(entry.fieldCounts)}`;
        const worstInterval = entry.intervalOutliers.length === 0
          ? ""
          : ` worstInterval=#${entry.intervalOutliers[0]!.index}:${entry.intervalOutliers[0]!.intervalDelta}`;
        const catchUpPair = entry.intervalCatchUpPairs[0];
        const catchUp = catchUpPair === undefined
          ? ""
          : ` catchUp=#${catchUpPair.first.index}` +
            `/${catchUpPair.second.index}:` +
            `${catchUpPair.first.intervalDelta}` +
            `/${catchUpPair.second.intervalDelta}` +
            ` net=${catchUpPair.netIntervalDelta}` +
            fmtCatchUpCommandContext(catchUpPair);
        return `${entry.pc}: compared=${entry.compared} mismatches=${entry.mismatchCount}${fields} ` +
          `replayDelta=${fmtDeltaStats(entry.replayCycleDelta)} drift=${entry.driftReplayCycleDelta ?? "?"}` +
          `${sample}${target}${interval}${offsetSweep}${worstInterval}${catchUp}`;
      }).join(" | ");
      console.log(`  pcDeltaReport: ${pcDeltas}`);
    }
    if (r.frameDeltaReport !== undefined && r.frameDeltaReport.length > 0) {
      const frameDeltas = r.frameDeltaReport.slice(0, args.frameDeltaReportLimit).map((entry) => {
        const sample = entry.nativeSampleDelta.compared === 0
          ? ""
          : ` sampleDelta=${fmtDeltaStats(entry.nativeSampleDelta)} hist={${fmtHistogram(entry.nativeSampleDeltaHistogram)}}`;
        const target = entry.nativeSampleTargetCycleOffset.compared === 0
          ? ""
          : ` targetOffset=${fmtDeltaStats(entry.nativeSampleTargetCycleOffset)}` +
            ` top={${fmtTopHistogram(entry.nativeSampleTargetCycleOffsetHistogram)}}`;
        const replayHist = Object.keys(entry.replayCycleDeltaHistogram).length === 0
          ? ""
          : ` replayHist={${fmtTopHistogram(entry.replayCycleDeltaHistogram)}}`;
        const busHist = Object.keys(entry.busReplayCycleDeltaHistogram).length === 0
          ? ""
          : ` busHist={${fmtTopHistogram(entry.busReplayCycleDeltaHistogram)}}`;
        const segments = entry.replayCycleDeltaSegments.length === 0
          ? ""
          : ` segments=` + entry.replayCycleDeltaSegments.slice(0, 8).map((segment) =>
            `#${segment.startIndex}-${segment.endIndex}` +
            ` n=${segment.compared}` +
            ` d=${segment.replayCycleDelta ?? "?"}` +
            ` bus=${segment.busReplayCycleDelta ?? "?"}` +
            ` nonExact=${segment.nativeSampleNonExactCount}` +
            ` hist={${fmtHistogram(segment.nativeSampleDeltaHistogram)}}`)
            .join(",");
        const pcs = Object.keys(entry.writePcHistogram).length === 0
          ? ""
          : ` pc={${fmtTopHistogram(entry.writePcHistogram)}}`;
        const cmds = Object.keys(entry.commandByteHistogram).length === 0
          ? ""
          : ` cmd={${fmtTopHistogram(entry.commandByteHistogram)}}`;
        return `${entry.frame}: compared=${entry.compared}` +
          ` mismatches=${entry.mismatchCount}` +
          ` nonExact=${entry.nativeSampleNonExactCount}` +
          ` first=#${entry.firstIndex}` +
          (entry.firstMismatchIndex === undefined ? "" : ` firstMismatch=#${entry.firstMismatchIndex}`) +
          ` replayDelta=${fmtDeltaStats(entry.replayCycleDelta)}` +
          ` busDelta=${fmtDeltaStats(entry.busReplayCycleDelta)}` +
          `${replayHist}${busHist}${sample}${target}${pcs}${cmds}${segments}`;
      }).join(" | ");
      console.log(`  frameDeltaReport: ${frameDeltas}`);
    }
    if (r.frameOffsetSweep !== undefined) {
      const sweep = r.frameOffsetSweep;
      const frames = sweep.frames.slice(0, args.frameOffsetSweepReportLimit).map((entry) =>
        `${entry.frame}:n=${entry.compared}` +
        ` baseline=${entry.baselineMismatchCount}` +
        ` best=${entry.bestMismatchCount}@${entry.bestOffsetCycles}c` +
        ` baseHist={${fmtHistogram(entry.baselineNativeSampleDeltaHistogram)}}` +
        ` bestHist={${fmtHistogram(entry.bestNativeSampleDeltaHistogram)}}`)
        .join(" | ");
      console.log(
        `  frameOffsetSweep: frames=${sweep.comparedFrames}` +
        ` exactFrames=${sweep.exactFrameCount}` +
        ` compared=${sweep.compared}` +
        ` baseline=${sweep.baselineMismatchCount}` +
        ` best=${sweep.bestMismatchCount}` +
        ` improvement=${sweep.improvementCount}` +
        ` bestOffset={${fmtTopHistogram(sweep.bestOffsetHistogram)}}` +
        ` baselineDelta=${fmtDeltaStats(sweep.baselineNativeSampleDelta)}` +
        ` bestDelta=${fmtDeltaStats(sweep.bestNativeSampleDelta)}` +
        (frames === "" ? "" : ` frames=${frames}`),
      );
    }
    if (r.pokeyBoundaryGuardSweep !== undefined && r.pokeyBoundaryGuardSweep.length > 0) {
      const sweep = r.pokeyBoundaryGuardSweep.slice(0, 10).map((entry) => {
        const first = entry.firstMismatch === undefined
          ? ""
          : ` first=#${entry.firstMismatch.index}` +
            ` dS=${entry.firstMismatch.nativeSampleDelta}` +
            ` base=${entry.firstMismatch.baselineNativeSampleDelta}` +
            ` delay=${entry.firstMismatch.totalDelayCycles}` +
            ` target=${entry.firstMismatch.targetCycleOffset ?? "?"}`;
        return `${entry.guard}@${entry.thresholdCycles}c` +
          ` applied=${entry.applied}` +
          ` baseline=${entry.baselineMismatchCount}` +
          ` mismatches=${entry.mismatchCount}` +
          ` improvement=${entry.improvementCount}` +
          ` delta=${fmtDeltaStats(entry.nativeSampleDelta)}` +
          ` hist={${fmtHistogram(entry.nativeSampleDeltaHistogram)}}` +
          ` delayHist={${fmtHistogram(entry.appliedBoundaryDelayHistogram)}}` +
          first;
      }).join(" | ");
      console.log(`  pokeyBoundaryGuardSweep(best): ${sweep}`);
    }
    if (r.pokeyBoundaryCandidateReport !== undefined) {
      const report = r.pokeyBoundaryCandidateReport;
      const fmtBuckets = (buckets: PokeyBoundaryCandidateBucket[]): string => buckets.slice(0, 5)
        .map((bucket) =>
          `${bucket.key}:n=${bucket.compared}` +
          ` early=${bucket.earlyCount}` +
          ` exact=${bucket.exactCount}` +
          ` late=${bucket.lateCount}` +
          ` hist={${fmtHistogram(bucket.baselineNativeSampleDeltaHistogram)}}`)
        .join(" | ");
      console.log(
        `  pokeyBoundaryCandidateReport@${report.thresholdCycles}c:` +
        ` candidates=${report.candidateCount}/${report.compared}` +
        ` early=${report.earlyCount}` +
        ` exact=${report.exactCount}` +
        ` late=${report.lateCount}` +
        ` mismatches=${report.baselineMismatchCount}` +
        ` hist={${fmtHistogram(report.baselineNativeSampleDeltaHistogram)}}` +
        ` delay=${fmtBuckets(report.byBoundaryDelay)}` +
        ` reg=${fmtBuckets(report.byWriteRegister)}` +
        ` effect=${fmtBuckets(report.byWriteEffect)}` +
        ` effectDelay=${fmtBuckets(report.byWriteEffectBoundaryDelay)}` +
        ` pc=${fmtBuckets(report.byWritePc)}` +
        ` pcReg=${fmtBuckets(report.byWritePcReg)}` +
        ` frameStart=${fmtBuckets(report.bySchedulerFrameStartDelta)}`,
      );
    }
    if (r.pokeyStreamCursorReport !== undefined) {
      const report = r.pokeyStreamCursorReport;
      const fmtBuckets = (buckets: PokeyStreamCursorBucket[]): string => buckets.slice(0, 5)
        .map((bucket) =>
          `${bucket.key}:n=${bucket.compared}` +
          ` early=${bucket.earlyCount}` +
          ` exact=${bucket.exactCount}` +
          ` late=${bucket.lateCount}` +
          ` hist={${fmtHistogram(bucket.nativeSampleDeltaHistogram)}}`)
        .join(" | ");
      console.log(
        `  pokeyStreamCursorReport:` +
        ` transitions=${report.transitionCount}` +
        ` compared=${report.compared}` +
        ` early=${report.earlyCount}` +
        ` exact=${report.exactCount}` +
        ` late=${report.lateCount}` +
        ` hist={${fmtHistogram(report.nativeSampleDeltaHistogram)}}` +
        ` prev=${fmtBuckets(report.byPreviousTransitionDelta)}` +
        ` next=${fmtBuckets(report.byNextTransitionDelta)}` +
        ` sameSample=${fmtBuckets(report.bySameSampleTransition)}` +
        ` nextSample=${fmtBuckets(report.byNextTransitionSampleDelta)}`,
      );
    }
    if (r.pokeyLofiCursorReport !== undefined) {
      const report = r.pokeyLofiCursorReport;
      const fmtBuckets = (buckets: PokeyStreamCursorBucket[]): string => buckets.slice(0, 5)
        .map((bucket) =>
          `${bucket.key}:n=${bucket.compared}` +
          ` early=${bucket.earlyCount}` +
          ` exact=${bucket.exactCount}` +
          ` late=${bucket.lateCount}` +
          ` hist={${fmtHistogram(bucket.nativeSampleDeltaHistogram)}}`)
        .join(" | ");
      console.log(
        `  pokeyLofiCursorReport:` +
        ` sourceRate=${report.sourceRate}` +
        ` targetRate=${report.targetRate}` +
        ` divide=${report.sourceDivide}` +
        ` rawOffset=${report.newRawSourceSampleOffset}` +
        ` compared=${report.compared}` +
        ` baselineMismatch=${report.baselineMismatchCount}` +
        ` lofiMismatch=${report.lofiMismatchCount}` +
        ` improved=${report.improvementCount}` +
        ` baselineHist={${fmtHistogram(report.baselineNativeSampleDeltaHistogram)}}` +
        ` lofiHist={${fmtHistogram(report.lofiNativeSampleDeltaHistogram)}}` +
        ` sweep=${report.sweep.slice(0, 5).map((entry) =>
          `${entry.sourceRate}/${entry.newRawSourceSampleOffset}:` +
          `${entry.lofiMismatchCount} hist={${fmtHistogram(entry.lofiNativeSampleDeltaHistogram)}}`).join(" | ")}` +
        ` delta=${fmtBuckets(report.byBaselineToLofiDelta)}` +
        ` tsOffset=${fmtBuckets(report.byTsLofiOffsetFromSimple)}` +
        ` tsBlock=${fmtBuckets(report.byTsSourceOffsetInBlock)}` +
        ` tsWindowEnd=${fmtBuckets(report.byTsSimpleWindowEndDelta)}`,
      );
    }
    if (r.eventDeltaReports !== undefined && r.eventDeltaReports.length > 0) {
      const eventDeltas = r.eventDeltaReports.map((entry) => {
        const sample = entry.nativeSampleDelta.compared === 0
          ? ""
          : ` sampleDelta=${fmtDeltaStats(entry.nativeSampleDelta)} hist={${fmtHistogram(entry.nativeSampleDeltaHistogram)}}`;
        const targetOffset = entry.targetCycleOffset === undefined
          ? ""
          : ` targetOffset=${fmtDeltaStats(entry.targetCycleOffset)}` +
            ` hist={${fmtHistogram(entry.targetCycleOffsetHistogram ?? {})}}`;
        const fields = Object.keys(entry.fieldCounts).length === 0
          ? ""
          : ` fields=${fmtFieldCounts(entry.fieldCounts)}`;
        const samples = entry.samples.length === 0
          ? ""
          : " samples=" + entry.samples.map((sampleEntry) =>
            `#${sampleEntry.index}:f${sampleEntry.mame?.frame ?? sampleEntry.ts?.frame ?? "?"}` +
            ` dC=${sampleEntry.replayCycleDelta ?? "?"}` +
            ` dS=${sampleEntry.nativeSampleDelta ?? "?"}` +
            (sampleEntry.targetCycleOffset === undefined
              ? ""
              : ` targetOffset=${sampleEntry.targetCycleOffset}`)).join(",");
        return `${JSON.stringify(entry.selector)} compared=${entry.compared} mismatches=${entry.mismatchCount}${fields} ` +
          `replayDelta=${fmtDeltaStats(entry.replayCycleDelta)}${sample}${targetOffset}${samples}`;
      }).join(" | ");
      console.log(`  eventDeltaReport: ${eventDeltas}`);
    }
    if (r.firstMismatch !== undefined) {
      console.log(`  first mismatch #${r.firstMismatch.index} fields=${r.firstMismatch.fields.join(",")}`);
      console.log(`  TS   ${fmtWrite(r.firstMismatch.ts)}`);
      console.log(`  MAME ${fmtWrite(r.firstMismatch.mame)}`);
      if (r.firstMismatch.commandCrossing !== undefined) {
        console.log(`  CMD  ${fmtCommandCrossing(r.firstMismatch.commandCrossing)}`);
      }
      if (r.firstMismatch.commandNearMiss !== undefined) {
        console.log(`  CMD_NEAR ${fmtCommandNearMiss(r.firstMismatch.commandNearMiss)}`);
      }
      if (r.firstMismatch.rawCommandNearMiss !== undefined) {
        console.log(`  RAW_CMD_NEAR ${fmtCommandNearMiss(r.firstMismatch.rawCommandNearMiss)}`);
      }
      if (r.firstMismatch.commandContext !== undefined) {
        console.log(`  CMD_CTX ${fmtCommandContext(r.firstMismatch.commandContext)}`);
      }
    }
    if (r.mismatchCount > args.maxMismatches) failed = true;
    if (args.requireRawBusWriteParity && r.rawBusWriteParity.mismatchCount > args.rawBusWriteMaxMismatches) {
      failed = true;
    }
  }
  if (failed) process.exitCode = 1;
}

main();
