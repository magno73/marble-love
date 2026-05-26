/**
 * probe-sound-sample-diff.ts — PCM-level gate for TS SoundChip vs MAME WAV.
 *
 * The probe renders TS audio from a cmd-tape through the same cycle-aware replay
 * helper used by browser soundReplay, resamples to the MAME WAV rate, and
 * reports correlation/RMS/maxAbs on audible windows.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import {
  createSoundChip,
  cmdTapeAbsoluteCycle,
  cmdTapeCycleInFrame,
  DEFAULT_COMMAND_NMI_SAMPLE_CYCLE,
  drainChipWriteEvents,
  drainPokeyDiagnosticChannelSamples,
  drainPokeyDiagnosticRawTransitions,
  drainPokeyDiagnosticWrites,
  drainPokeySamples,
  drainSoundCommandReadEvents,
  drainYm2151DiagnosticChannelStateTrace,
  drainYm2151Samples,
  getPokeySampleRate,
  loadCmdTape,
  setPokeySampleAfterClock,
  setPokeySampleCycles,
  setPokeyDiagnosticChannelSamples,
  setPokeyDiagnosticRawTransitions,
  setPokeyDiagnosticWrites,
  SOUND_CMD_TAPE_CPU_HZ,
  setYm2151DiagnosticChannelStateTrace,
  tickFrameWithTape,
  YM2151_NATIVE_SAMPLE_RATE,
  POKEY_NATIVE_SAMPLE_RATE,
  type ChipWriteEvent,
  type CmdTape,
  type CmdTapeCommandTiming,
  type PokeyWriteSnapshot,
  type SoundCommandReadEvent,
} from "../../engine/src/m6502/sound-chip.js";
import { SOUND_CYCLES_PER_FRAME } from "../../engine/src/m6502/sound-clock.js";
import {
  createYM2151,
  type YM2151ChannelStateSnapshot,
  ym2151DrainDiagnosticChannelStateTrace as drainDirectYmDiagnosticChannelStateTrace,
  ym2151Sample as sampleDirectYm,
  ym2151DrainDiagnosticChannelSamples as drainDirectYmDiagnosticChannelSamples,
  ym2151DrainSamples as drainDirectYmSamples,
  ym2151SetDiagnosticChannelSamples as setDirectYmDiagnosticChannelSamples,
  ym2151SetDiagnosticChannelStateTrace as setDirectYmDiagnosticChannelStateTrace,
  ym2151TickCycles as tickDirectYmCycles,
  ym2151WriteAddr,
  ym2151WriteData,
} from "../../engine/src/audio/ym2151.js";
import {
  createPOKEY,
  POKEY_CLOCK_HZ,
  pokeyDrainDiagnosticChannelSamples as drainDirectPokeyDiagnosticChannelSamples,
  pokeyDrainDiagnosticRawTransitions as drainDirectPokeyDiagnosticRawTransitions,
  pokeyDrainDiagnosticWrites as drainDirectPokeyDiagnosticWrites,
  pokeyDrainSamples as drainDirectPokeySamples,
  pokeySampleRate as directPokeySampleRate,
  pokeySetDiagnosticChannelSamples as setDirectPokeyDiagnosticChannelSamples,
  pokeySetDiagnosticRawTransitions as setDirectPokeyDiagnosticRawTransitions,
  pokeySetDiagnosticWrites as setDirectPokeyDiagnosticWrites,
  pokeySetSampleAfterClock as setDirectPokeySampleAfterClock,
  pokeySetSampleCycles as setDirectPokeySampleCycles,
  pokeyTickCycles as tickDirectPokeyCycles,
  pokeyWrite,
  type PokeyRawTransition,
} from "../../engine/src/audio/pokey.js";
import {
  resampleLinear,
  resampleMameLofi,
  StreamingLinearResampler,
  StreamingMameLofiResampler,
} from "../../engine/src/audio/resample.js";
import { as_u8 } from "../../engine/src/wrap.js";
import { tickEnvClock } from "../../engine/src/audio/ym2151-envelope.js";
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
  type AudioBitperfectPreset,
} from "./audio-bitperfect-presets.js";

type ReplayTickOptions = NonNullable<Parameters<typeof tickFrameWithTape>[3]> & {
  readonly resetFirstFetchDelayAfterCommandCycles?: number;
  readonly commandNmiBoundaryDelayInstructions?: number;
  readonly commandCycleOffsetCycles?: number;
};

interface YmWriteEventCycleOffsetMatch {
  readonly frame?: number;
  readonly pc?: number;
  readonly reg?: number;
  readonly val?: number;
  readonly cycleInFrameMin?: number;
  readonly cycleInFrameMax?: number;
  readonly deltaCycles: number;
}

interface DirectYmWriteSampleOffsetMatch {
  readonly frame?: number;
  readonly pc?: number;
  readonly reg?: number;
  readonly val?: number;
  readonly deltaSamples: number;
}

interface CommandNmiDelayMatch {
  readonly frame?: number;
  readonly byte?: number;
  readonly cycleInFrame?: number;
  readonly delayInstructions: number;
}

type CommandEdgeEventRelation = "both" | "raw-before" | "raw-crossing" | "raw-after";
type CommandEdgeEventAnchor = "command" | "first-read" | "current-event";

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

interface CommandReplayEvent {
  readonly sourceIndex: number;
  readonly frame: number;
  readonly byte: number;
  readonly soundPc: number | undefined;
  readonly cycleInFrame: number;
  readonly replayCycle: number;
  readonly actualCycle: number;
  readonly actualCycleInFrame: number;
  readonly commandNmiDelayInstructions: number;
  readonly expectedInstPc?: number;
  readonly expectedInstOpcode?: number;
  readonly expectedInstDeltaCycles?: number;
  readonly expectedNextChronoInstPc?: number;
  readonly expectedNextChronoInstOpcode?: number;
  readonly expectedNextChronoInstDeltaCycles?: number;
  readonly actualSoundPc?: number;
  readonly actualSoundOpcode?: number;
  readonly preAdvance?: {
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
  };
  readonly lastStep?: {
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
  };
  readonly preemptedChipWrite?: {
    readonly pc: number;
    readonly opcode: number;
    readonly address: number;
    readonly stepStart: number;
    readonly stepEnd: number;
    readonly writeCycle: number;
    readonly targetDeltaFromWrite: number;
    readonly completedInstructionBeforeTarget?: boolean;
  };
}

interface CommandReplayEventSummary {
  readonly count: number;
  readonly withExpectedPc: number;
  readonly withActualPc: number;
  readonly pcExact: number;
  readonly pcMismatch: number;
  readonly actualMatchesSoundPc: number;
  readonly actualMatchesExpectedInstPc: number;
  readonly actualMatchesExpectedNextChronoInstPc: number;
  readonly opcodeExact: number;
  readonly opcodeMismatch: number;
  readonly negativePreAdvanceCount: number;
  readonly byPcRelation: Record<string, number>;
  readonly byCommandByte: Record<string, number>;
  readonly byCycleInFrame: Record<string, number>;
  readonly byActualCycleDelta: Record<string, number>;
  readonly byPreAdvanceDeltaToTarget: Record<string, number>;
  readonly byCommandNmiDelay: Record<string, number>;
  readonly firstPcMismatch?: unknown;
  readonly firstNegativePreAdvance?: unknown;
  readonly mismatchSamples: readonly unknown[];
  readonly negativePreAdvanceSamples: readonly unknown[];
}

interface CommandContextSummary {
  readonly total: number;
  readonly withCycleTiming: number;
  readonly withSoundPc: number;
}

interface CommandReadContext {
  readonly frame: number | undefined;
  readonly cycleInFrame: number | undefined;
  readonly replayCycle: number;
  readonly pc: number;
  readonly val: number;
  readonly readCycleOffset: number;
  readonly deltaFromCommand: number;
  readonly deltaFromTsWrite: number | undefined;
}

interface YmCommandEdgeRuntimeAdjustSummary {
  applied: number;
  readonly rules: Array<Record<string, number | string | string[] | undefined>>;
  readonly byRelation: Record<string, number>;
  readonly byCommandByte: Record<string, number>;
  readonly byCommandSoundPc: Record<string, number>;
  readonly byTargetAnchor: Record<string, number>;
  readonly byRuleIndex: Record<string, number>;
  readonly byWriteFrame: Record<string, number>;
  readonly byWritePc: Record<string, number>;
  readonly byWriteOpcode: Record<string, number>;
  readonly byWriteReg: Record<string, number>;
  readonly byRawDeltaFromCommand: Record<string, number>;
  readonly byFirstReadDeltaFromCommand: Record<string, number>;
  readonly byRawDeltaFromFirstRead: Record<string, number>;
  readonly byTargetDeltaFromFirstRead: Record<string, number>;
  readonly byDeltaCycles: Record<string, number>;
  readonly samples: Array<Record<string, number | string | undefined>>;
}

type YmWriteEventSampleOffsetMatch = DirectYmWriteSampleOffsetMatch;

interface Args {
  audioBitperfectPreset: string | undefined;
  mameWav: string | undefined;
  frames: number;
  cmdTape: string;
  cmdTapeCommandTiming: CmdTapeCommandTiming;
  fixedFrameCycles: boolean;
  frameBudgetSmoothingWindow: number;
  requireCommandContext: boolean;
  source: "mix" | "ym" | "pokey";
  windowSource: "mame" | "ts" | "ym" | "pokey";
  mameSubtractWav: string | undefined;
  mameSubtractWavGain: number;
  mameSubtractSource: "none" | "ym" | "pokey";
  mameSubtractGain: number;
  referenceMameYmWrites: string | undefined;
  referenceMamePokeyWrites: string | undefined;
  referenceMameComponentsOnly: boolean;
  referencePokeyResampleOffset: number | undefined;
  referencePokeyWriteCycleOffset: number | undefined;
  ymChannelDiagnostics: boolean;
  pokeyChannelDiagnostics: boolean;
  windowStart: number | undefined;
  windowSize: number;
  windowHop: number;
  maxWindows: number;
  maxLag: number;
  padResetSilence: boolean;
  audibleThreshold: number;
  minCorrelation: number;
  maxAbsLag: number;
  lagTieCorrelationEpsilon: number;
  maxRms: number;
  maxAbs: number;
  sampleTraceRadius: number;
  sampleTraceCenterSample: number | undefined;
  traceFrameAdvance: boolean;
  ymStreamWriteTraceRadius: number;
  ymStreamWriteTraceLimit: number;
  ymStreamWriteTraceCenterSample: number | undefined;
  ymStreamWriteTraceMameYmWrites: string | undefined;
  ymStreamWriteTraceMameSampleTiming: "attos" | "cycle";
  ymStateTraceChannel: number | undefined;
  ymStateTraceNativeStart: number | undefined;
  ymStateTraceNativeEnd: number | undefined;
  pokeyRawTraceRadius: number;
  pokeyRawTraceCenterSample: number | undefined;
  pokeyRawTracePcmRadius: number;
  pokeyRawTracePcmMaxLag: number;
  report: string | undefined;
  compactReport: boolean;
  statusTape: string | undefined;
  statusTapeMode: StatusTapeMode;
  statusValueMode: SoundStatusReplayValueMode;
  resetReleaseDelayCycles: number;
  resetFirstFetchDelayAfterCommandCycles: number;
  replyAckDelayCycles: number;
  replyAckTape: string | undefined;
  useEmbeddedReplyAckTape: boolean;
  timerAStartDelayCycles: number;
  commandNmiDelayInstructions: number;
  commandNmiSampleCycle: number;
  commandNmiBoundaryDelayInstructions: number;
  commandNmiDelayMatches: readonly CommandNmiDelayMatch[];
  commandNmiDelayChipWriteBoundaryInstructions: number | undefined;
  commandNmiDelayCompletedChipWritePreemptions: number | undefined;
  commandCycleOffsetCycles: number;
  commandCycleOffsetStartFrame: number | undefined;
  commandSubmitBeforeCpuCatchup: boolean;
  commandPreemptChipWriteLookaheadCycles: number;
  commandPreemptChipWritePcs: readonly number[] | undefined;
  commandPreemptChipWriteCompleteBeforeTarget: boolean;
  commandPreemptChipWriteBeforeOnly: boolean;
  deferChipIoWriteTiming: boolean;
  deferYmAudioWriteTiming: boolean;
  deferYmParameterWriteTiming: boolean;
  deferYmTimerControlWriteTiming: boolean;
  disableYmReset: boolean;
  ymWriteEventCycleOffsetCycles: number;
  ymWriteEventCycleOffsetRegs: ReadonlyMap<number, number>;
  ymWriteEventCycleOffsetMatches: readonly YmWriteEventCycleOffsetMatch[];
  ymWriteEventSampleOffsetMatches: readonly YmWriteEventSampleOffsetMatch[];
  ymKeyOnWriteEventCycleOffsetCycles: number;
  ymCommandEdgeEventAfterCycles: number;
  ymCommandEdgeEventRules: readonly CommandEdgeEventRule[];
  pokeyCommandEdgeEventAfterCycles: number;
  pokeyCommandEdgeEventRules: readonly CommandEdgeEventRule[];
  irqServiceDelayCycles: number;
  mameYmWrites: string | undefined;
  mamePokeyWrites: string | undefined;
  directChipWriteOrigin: "absolute" | "cmd-tape-replay";
  directChipWriteSampleTiming: "attos" | "cycle";
  directChipWriteCycleTiming: "attos" | "log";
  directChipWriteCycleRateMode: "auto" | "sound" | "pokey";
  directYmWriteSampleOffset: number;
  directYmWriteSampleOffsetRegs: ReadonlyMap<number, number>;
  directYmWriteSampleOffsetMatches: readonly DirectYmWriteSampleOffsetMatch[];
  ymPhaseAdvanceAfterOutput: boolean;
  ymScheduler: "cycle" | "mame-stream";
  ymStreamAbsoluteOrigin: boolean;
  resampler: "linear" | "mame-lofi";
  ymResampler: "linear" | "mame-lofi";
  pokeyResampler: "linear" | "mame-lofi";
  ymNativeSampleRate: number | undefined;
  ymResampleOffset: number;
  pokeyResampleOffset: number;
  ymOutputSampleOffset: number;
  pokeyOutputSampleOffset: number;
  pokeyWriteCycleOffset: number;
  pokeyWriteApplyDelayCycles: number;
  pokeyWriteApplyDelayOpcodes: ReadonlyMap<number, number>;
  pokeyWriteApplyDelayMatches: readonly YmWriteEventCycleOffsetMatch[];
  pokeyWriteApplyBoundaryDelayCycles: number;
  pokeyWriteApplyBoundaryDelaySampleRate: number;
  pokeyCommandEdgeRawCycleOffsetOpcodes: ReadonlyMap<number, number>;
  pokeySampleCycles: number;
  pokeySampleAfterClock: boolean;
}

type StatusTapeMode = "readIndex" | "frame";

interface WavData {
  sampleRate: number;
  channels: number;
  samples: Float32Array;
}

interface WindowStats {
  start: number;
  size: number;
  lag: number;
  correlation: number;
  absoluteBestLag: number;
  absoluteBestCorrelation: number;
  bestGain: number;
  rms: number;
  maxAbs: number;
  gainCorrectedRms: number;
  gainCorrectedMaxAbs: number;
  tsMaxAbs: number;
  mameMaxAbs: number;
  tsYmRms: number;
  tsPokeyRms: number;
  tsYmMaxAbs: number;
  tsPokeyMaxAbs: number;
  tsYmEnergyShare: number;
  dominantSource: "ym" | "pokey" | "mixed" | "silent";
  maxAbsSample: {
    sample: number;
    mameSample: number;
    ts: number;
    mame: number;
    diff: number;
    tsYm: number;
    tsPokey: number;
    refYm?: number;
    refPokey?: number;
    tsYmChannels?: Array<{ channel: number; value: number }>;
    tsPokeyChannels?: Array<{ channel: number; value: number }>;
    refYmChannels?: Array<{ channel: number; value: number }>;
    refPokeyChannels?: Array<{ channel: number; value: number }>;
    traceCenterSample?: number;
    traceCenterMameSample?: number;
    ymStreamWriteTrace?: YmStreamWriteTrace;
    trace?: Array<{
      offset: number;
      sample: number;
      mameSample: number;
      ts: number;
      mame: number;
      diff: number;
      tsYm: number;
      tsPokey: number;
      refYm?: number;
      refPokey?: number;
      tsYmChannels?: Array<{ channel: number; value: number }>;
      tsPokeyChannels?: Array<{ channel: number; value: number }>;
      refYmChannels?: Array<{ channel: number; value: number }>;
      refPokeyChannels?: Array<{ channel: number; value: number }>;
    }>;
  };
  tsYmTopChannel?: number;
  tsYmChannelRms?: Array<{ channel: number; rms: number; maxAbs: number }>;
  tsPokeyTopChannel?: number;
  tsPokeyChannelRms?: Array<{ channel: number; rms: number; maxAbs: number }>;
}

interface SoundChipWithYmDiagnostics {
  ym2151: {
    diagnosticChannelSampleBuffers: number[][] | undefined;
    channels?: unknown[];
  };
}

interface WindowLagRunSummary {
  readonly lag: number;
  readonly count: number;
  readonly start: number;
  readonly end: number;
  readonly minCorrelation: number;
  readonly maxRms: number;
  readonly maxAbs: number;
}

interface WindowWorstSummary {
  readonly start: number;
  readonly lag: number;
  readonly correlation: number;
  readonly rms: number;
  readonly maxAbs: number;
  readonly dominantSource: WindowStats["dominantSource"];
}

interface HistogramEntry {
  readonly value: number;
  readonly count: number;
}

interface StringHistogramEntry {
  readonly value: string;
  readonly count: number;
}

interface PokeyRawTraceAlignedStateMismatch {
  readonly tsIndex: number;
  readonly referenceIndex: number;
  readonly prevRaw: string;
  readonly raw: string;
  readonly tsEstimatedOutputSample: number;
  readonly referenceEstimatedOutputSample: number;
  readonly tsCycle: number;
  readonly referenceCycle: number;
  readonly cycleDelta: number;
  readonly mismatchFields: readonly string[];
  readonly counterDelta: readonly number[];
  readonly borrowCntDelta: readonly number[];
  readonly outputDelta: readonly number[];
  readonly filterSampleDelta: readonly number[];
  readonly polyDelta: readonly number[];
  readonly polyModuloDelta: readonly number[];
  readonly polyClockDelta: number | undefined;
  readonly polyClockDelta28Ticks: number | undefined;
  readonly changedChannels: readonly number[];
  readonly changedChannelCounterDelta: string;
  readonly changedChannelBorrowCntDelta: string;
  readonly changedChannelOutputDelta: string;
  readonly clockCnt28Delta: number;
  readonly clockCnt114Delta: number;
}

interface PokeyRawTraceDominantStateAlignment {
  readonly outputSampleDelta: number;
  readonly compared: number;
  readonly exactStateMatches: number;
  readonly exactStateMismatches: number;
  readonly fieldMismatchCounts: Record<string, number>;
  readonly eventIndexDeltaHistogram: Record<string, number>;
  readonly counterDeltaHistogram: Record<string, number>;
  readonly borrowCntDeltaHistogram: Record<string, number>;
  readonly outputDeltaHistogram: Record<string, number>;
  readonly filterSampleDeltaHistogram: Record<string, number>;
  readonly polyDeltaHistogram: Record<string, number>;
  readonly polyModuloDeltaHistogram: Record<string, number>;
  readonly polyClockDeltaHistogram: Record<string, number>;
  readonly polyClockDelta28TicksHistogram: Record<string, number>;
  readonly changedChannelHistogram: Record<string, number>;
  readonly changedChannelCounterDeltaHistogram: Record<string, number>;
  readonly changedChannelBorrowCntDeltaHistogram: Record<string, number>;
  readonly changedChannelOutputDeltaHistogram: Record<string, number>;
  readonly clockCnt28DeltaHistogram: Record<string, number>;
  readonly clockCnt114DeltaHistogram: Record<string, number>;
  readonly transitionCycleModulo28DeltaHistogram: Record<string, number>;
  readonly transitionCycleModulo114DeltaHistogram: Record<string, number>;
  readonly firstMismatches: readonly PokeyRawTraceAlignedStateMismatch[];
}

interface PokeyRawTraceDominantStateAlignmentSummary {
  readonly outputSampleDelta: number;
  readonly compared: number;
  readonly exactStateMatches: number;
  readonly exactStateMismatches: number;
  readonly fieldMismatchTop: readonly StringHistogramEntry[];
  readonly eventIndexDeltaTop: readonly HistogramEntry[];
  readonly counterDeltaTop: readonly StringHistogramEntry[];
  readonly borrowCntDeltaTop: readonly StringHistogramEntry[];
  readonly outputDeltaTop: readonly StringHistogramEntry[];
  readonly filterSampleDeltaTop: readonly StringHistogramEntry[];
  readonly polyDeltaTop: readonly StringHistogramEntry[];
  readonly polyModuloDeltaTop: readonly StringHistogramEntry[];
  readonly polyClockDeltaTop: readonly HistogramEntry[];
  readonly polyClockDelta28TicksTop: readonly HistogramEntry[];
  readonly changedChannelTop: readonly StringHistogramEntry[];
  readonly changedChannelCounterDeltaTop: readonly StringHistogramEntry[];
  readonly changedChannelBorrowCntDeltaTop: readonly StringHistogramEntry[];
  readonly changedChannelOutputDeltaTop: readonly StringHistogramEntry[];
  readonly clockCnt28DeltaTop: readonly HistogramEntry[];
  readonly clockCnt114DeltaTop: readonly HistogramEntry[];
  readonly transitionCycleModulo28DeltaTop: readonly HistogramEntry[];
  readonly transitionCycleModulo114DeltaTop: readonly HistogramEntry[];
  readonly firstMismatches: readonly PokeyRawTraceAlignedStateMismatch[];
}

interface PokeyRawTraceComparisonSummary {
  readonly compared: number;
  readonly rawMismatchCount: number;
  readonly cycleDeltaMode: number | undefined;
  readonly cycleDeltaResidualTop: readonly HistogramEntry[];
  readonly outputSampleDeltaTop: readonly HistogramEntry[];
  readonly rawOutputSampleDeltaTop: readonly HistogramEntry[];
  readonly rawTransitionOutputSampleDeltaTop: readonly HistogramEntry[];
  readonly dominantRawTransitionStateAlignment: PokeyRawTraceDominantStateAlignmentSummary | undefined;
}

interface PokeyRawTracePcmResidualSummary {
  readonly compared: number;
  readonly sameOutputRmsMean: number;
  readonly eventAlignedRmsMean: number;
  readonly bestLagRmsMean: number;
  readonly bestLagHistogramTop: readonly HistogramEntry[];
  readonly worstBestLagMaxAbs: number | undefined;
}

interface YmPhaseDiagnosticTarget {
  diagnosticPhaseAdvanceAfterOutput?: boolean;
}

interface YM2151WithTimerPhaseDiagnostic {
  timerAStartDelayYmCycles: number;
}

interface SoundChipWithCommandNmiDiagnostic {
  commandNmiDelayInstructions: number;
}

interface PokeyRawTraceEvent {
  readonly cycle: number;
  readonly nativeSample: number;
  readonly cycleInNativeSample: number;
  readonly projectedOutputSample: number;
  readonly projectedOutputFraction: number;
  readonly estimatedOutputSampleFloor: number;
  readonly estimatedOutputSample: number;
  readonly estimatedOutputSampleCeil: number;
  readonly lofiSourceDivide: number;
  readonly lofiSourceBlockOffset: number;
  readonly lofiS1OutputSample: number;
  readonly lofiS2OutputSample: number;
  readonly lofiS3OutputSample: number;
  readonly prevRaw: string;
  readonly raw: string;
  readonly prevChannels: readonly number[];
  readonly channels: readonly number[];
  readonly audf: readonly number[];
  readonly audc: readonly number[];
  readonly audctl: number;
  readonly skctl: number;
  readonly counters: readonly number[];
  readonly borrowCnt: readonly number[];
  readonly outputs: readonly number[];
  readonly filterSamples: readonly number[];
  readonly poly4: number;
  readonly poly5: number;
  readonly poly9: number;
  readonly poly17: number;
  readonly clockCnt28: number;
  readonly clockCnt114: number;
}

interface PokeyRawTrace {
  readonly centerSample: number;
  readonly radius: number;
  readonly totalTransitions: number;
  readonly matchedTransitions: number;
  readonly events: readonly PokeyRawTraceEvent[];
}

interface PokeyRawTraceComparison {
  readonly compared: number;
  readonly outputSampleDeltaMin: number | undefined;
  readonly outputSampleDeltaMax: number | undefined;
  readonly outputSampleDeltaMeanAbs: number | undefined;
  readonly outputSampleDeltaHistogram: Record<string, number>;
  readonly cycleDeltaMin: number | undefined;
  readonly cycleDeltaMax: number | undefined;
  readonly cycleDeltaMeanAbs: number | undefined;
  readonly cycleDeltaHistogram: Record<string, number>;
  readonly cycleDeltaMode: number | undefined;
  readonly cycleDeltaResidualMin: number | undefined;
  readonly cycleDeltaResidualMax: number | undefined;
  readonly cycleDeltaResidualMeanAbs: number | undefined;
  readonly cycleDeltaResidualHistogram: Record<string, number>;
  readonly estimatedOutputSampleFloorDeltaHistogram: Record<string, number>;
  readonly estimatedOutputSampleCeilDeltaHistogram: Record<string, number>;
  readonly lofiS1OutputSampleDeltaHistogram: Record<string, number>;
  readonly lofiS2OutputSampleDeltaHistogram: Record<string, number>;
  readonly lofiS3OutputSampleDeltaHistogram: Record<string, number>;
  readonly lofiSourceBlockOffsetDeltaHistogram: Record<string, number>;
  readonly outputSampleDeltaByCycleDeltaResidual: Record<string, Record<string, number>>;
  readonly outputSampleDeltaByLofiSourceBlockOffsetDelta: Record<string, Record<string, number>>;
  readonly outputSampleDeltaByTsCycleInNativeSample: Record<string, Record<string, number>>;
  readonly outputSampleDeltaByReferenceCycleInNativeSample: Record<string, Record<string, number>>;
  readonly rawOutputSampleDeltaHistogram: Record<string, number>;
  readonly rawTransitionOutputSampleDeltaHistogram: Record<string, number>;
  readonly dominantRawTransitionStateAlignment: PokeyRawTraceDominantStateAlignment | undefined;
  readonly rawMismatchCount: number;
  readonly cycleDeltaRuns: ReadonlyArray<{
    readonly startIndex: number;
    readonly endIndex: number;
    readonly count: number;
    readonly cycleDelta: number;
    readonly tsStartEstimatedOutputSample: number;
    readonly tsEndEstimatedOutputSample: number;
    readonly referenceStartEstimatedOutputSample: number;
    readonly referenceEndEstimatedOutputSample: number;
    readonly outputSampleDeltaMin: number;
    readonly outputSampleDeltaMax: number;
    readonly outputSampleDeltaMeanAbs: number;
    readonly outputSampleDeltaHistogram: Record<string, number>;
  }>;
  readonly cycleDeltaSummary: ReadonlyArray<{
    readonly cycleDelta: number;
    readonly count: number;
    readonly firstIndex: number;
    readonly lastIndex: number;
    readonly tsFirstEstimatedOutputSample: number;
    readonly tsLastEstimatedOutputSample: number;
    readonly referenceFirstEstimatedOutputSample: number;
    readonly referenceLastEstimatedOutputSample: number;
    readonly outputSampleDeltaMin: number;
    readonly outputSampleDeltaMax: number;
    readonly outputSampleDeltaMeanAbs: number;
    readonly outputSampleDeltaHistogram: Record<string, number>;
    readonly rawMismatchCount: number;
  }>;
  readonly pairs: ReadonlyArray<{
    readonly index: number;
    readonly raw: string;
    readonly prevRaw: string;
    readonly referenceRaw: string;
    readonly referencePrevRaw: string;
    readonly rawMatch: boolean;
    readonly tsEstimatedOutputSample: number;
    readonly referenceEstimatedOutputSample: number;
    readonly outputSampleDelta: number;
    readonly tsCycle: number;
    readonly referenceCycle: number;
    readonly cycleDelta: number;
    readonly tsNativeSample: number;
    readonly referenceNativeSample: number;
    readonly nativeSampleDelta: number;
    readonly tsCycleInNativeSample: number;
    readonly referenceCycleInNativeSample: number;
    readonly estimatedOutputSampleFloorDelta: number;
    readonly estimatedOutputSampleCeilDelta: number;
    readonly tsLofiSourceBlockOffset: number;
    readonly referenceLofiSourceBlockOffset: number;
    readonly lofiSourceBlockOffsetDelta: number;
    readonly lofiS1OutputSampleDelta: number;
    readonly lofiS2OutputSampleDelta: number;
    readonly lofiS3OutputSampleDelta: number;
  }>;
}

interface LocalPcmResidualStats {
  readonly samples: number;
  readonly rms: number;
  readonly meanAbs: number;
  readonly maxAbs: number;
  readonly correlation: number;
  readonly bestGain: number;
  readonly gainCorrectedRms: number;
  readonly gainCorrectedMaxAbs: number;
  readonly lag?: number;
}

interface LocalPcmResidualAggregate {
  readonly count: number;
  readonly samples: number;
  readonly rmsMean: number;
  readonly rmsMax: number;
  readonly meanAbsMean: number;
  readonly maxAbsMax: number;
  readonly correlationMean: number;
  readonly correlationMin: number;
  readonly bestGainMean: number;
  readonly bestGainMin: number;
  readonly bestGainMax: number;
  readonly gainCorrectedRmsMean: number;
  readonly gainCorrectedRmsMax: number;
  readonly gainCorrectedMaxAbsMax: number;
}

interface PokeyPcmResidualBucket {
  readonly count: number;
  readonly firstIndex: number;
  readonly lastIndex: number;
  readonly sameOutputRmsMean: number;
  readonly sameOutputRmsMax: number;
  readonly eventAlignedRmsMean: number;
  readonly eventAlignedRmsMax: number;
  readonly bestLagRmsMean: number;
  readonly bestLagRmsMax: number;
  readonly bestLagRmsImprovementMean: number;
  readonly bestLagRmsImprovementMax: number;
  readonly outputSampleDeltaHistogram: Record<string, number>;
  readonly cycleDeltaResidualHistogram: Record<string, number>;
  readonly bestLagHistogram: Record<string, number>;
  readonly rawTransitionHistogram: Record<string, number>;
  readonly counterDeltaHistogram: Record<string, number>;
  readonly polyDeltaHistogram: Record<string, number>;
  readonly polyModuloDeltaHistogram: Record<string, number>;
  readonly polyClockDeltaHistogram: Record<string, number>;
  readonly polyClockDelta28TicksHistogram: Record<string, number>;
  readonly changedChannelHistogram: Record<string, number>;
  readonly changedChannelCounterDeltaHistogram: Record<string, number>;
  readonly changedChannelBorrowCntDeltaHistogram: Record<string, number>;
  readonly changedChannelOutputDeltaHistogram: Record<string, number>;
  readonly clockCnt28DeltaHistogram: Record<string, number>;
  readonly clockCnt114DeltaHistogram: Record<string, number>;
}

interface PokeyPcmResidualTransitionGroup {
  readonly prevRaw: string;
  readonly raw: string;
  readonly prevChannels: readonly number[];
  readonly channels: readonly number[];
  readonly audf: readonly number[];
  readonly audc: readonly number[];
  readonly audctl: number;
  readonly skctl: number;
  readonly outputSampleDelta: number;
  readonly cycleDeltaResidual: number | undefined;
  readonly bestLag: number;
  readonly count: number;
  readonly firstIndex: number;
  readonly lastIndex: number;
  readonly sameOutputRmsMean: number;
  readonly eventAlignedRmsMean: number;
  readonly bestLagRmsMean: number;
  readonly bestLagRmsMax: number;
  readonly bestLagRmsImprovementMean: number;
}

interface PokeyRawTraceEventContext {
  readonly cycle: number;
  readonly nativeSample: number;
  readonly estimatedOutputSample: number;
  readonly projectedOutputFraction: number;
  readonly lofiSourceBlockOffset: number;
  readonly prevRaw: string;
  readonly raw: string;
  readonly audf: readonly number[];
  readonly audc: readonly number[];
  readonly audctl: number;
  readonly skctl: number;
  readonly counters: readonly number[];
  readonly borrowCnt: readonly number[];
  readonly outputs: readonly number[];
  readonly filterSamples: readonly number[];
  readonly poly4: number;
  readonly poly5: number;
  readonly poly9: number;
  readonly poly17: number;
  readonly clockCnt28: number | undefined;
  readonly clockCnt114: number | undefined;
}

interface PokeyRawTraceWriteContext {
  readonly index: number;
  readonly source: PokeyWriteTraceEvent["source"];
  readonly cycle: number;
  readonly applyCycle: number;
  readonly cyclesSinceApply: number;
  readonly applyDelayCycles: number;
  readonly frame: number | undefined;
  readonly cycleInFrame: number | undefined;
  readonly rawCycle: number | undefined;
  readonly rawCycleInFrame: number | undefined;
  readonly pc: string | undefined;
  readonly reg: string;
  readonly val: string;
}

interface PokeyRawTracePcmResidualContextSample {
  readonly index: number;
  readonly outputSampleDelta: number;
  readonly cycleDelta: number;
  readonly cycleDeltaResidual: number | undefined;
  readonly bestLag: number;
  readonly counterDelta: readonly number[];
  readonly polyDelta: readonly number[];
  readonly polyModuloDelta: readonly number[];
  readonly polyClockDelta: number | undefined;
  readonly polyClockDelta28Ticks: number | undefined;
  readonly outputDelta: readonly number[];
  readonly clockCnt28Delta: number | undefined;
  readonly clockCnt114Delta: number | undefined;
  readonly ts: PokeyRawTraceEventContext;
  readonly reference: PokeyRawTraceEventContext;
  readonly tsRecentWrites: readonly PokeyRawTraceWriteContext[];
  readonly referenceRecentWrites: readonly PokeyRawTraceWriteContext[];
  readonly tsRecentRelevantWrites: readonly PokeyRawTraceWriteContext[];
  readonly referenceRecentRelevantWrites: readonly PokeyRawTraceWriteContext[];
}

interface PokeyRawTracePcmResidualTimingRun {
  readonly startIndex: number;
  readonly endIndex: number;
  readonly count: number;
  readonly firstTs: PokeyRawTraceEventContext;
  readonly firstReference: PokeyRawTraceEventContext;
  readonly lastTs: PokeyRawTraceEventContext;
  readonly lastReference: PokeyRawTraceEventContext;
  readonly firstTsLastRelevantWrite: PokeyRawTraceWriteContext | undefined;
  readonly firstReferenceLastRelevantWrite: PokeyRawTraceWriteContext | undefined;
  readonly lastTsLastRelevantWrite: PokeyRawTraceWriteContext | undefined;
  readonly lastReferenceLastRelevantWrite: PokeyRawTraceWriteContext | undefined;
  readonly outputSampleDeltaHistogram: Record<string, number>;
  readonly cycleDeltaResidualHistogram: Record<string, number>;
  readonly bestLagHistogram: Record<string, number>;
  readonly rawTransitionHistogram: Record<string, number>;
  readonly counterDeltaHistogram: Record<string, number>;
  readonly polyDeltaHistogram: Record<string, number>;
  readonly polyModuloDeltaHistogram: Record<string, number>;
  readonly polyClockDeltaHistogram: Record<string, number>;
  readonly polyClockDelta28TicksHistogram: Record<string, number>;
  readonly changedChannelHistogram: Record<string, number>;
  readonly changedChannelCounterDeltaHistogram: Record<string, number>;
  readonly changedChannelBorrowCntDeltaHistogram: Record<string, number>;
  readonly changedChannelOutputDeltaHistogram: Record<string, number>;
  readonly clockCnt28DeltaHistogram: Record<string, number>;
  readonly clockCnt114DeltaHistogram: Record<string, number>;
  readonly tsLastRelevantWriteHistogram: Record<string, number>;
  readonly referenceLastRelevantWriteHistogram: Record<string, number>;
  readonly lastRelevantWritePairHistogram: Record<string, number>;
  readonly transitionCycleModulo28DeltaHistogram: Record<string, number>;
  readonly transitionCycleModulo114DeltaHistogram: Record<string, number>;
  readonly lastRelevantApplyCycleDeltaHistogram: Record<string, number>;
  readonly lastRelevantApplyCycleModulo28DeltaHistogram: Record<string, number>;
  readonly lastRelevantApplyCycleModulo114DeltaHistogram: Record<string, number>;
  readonly lastRelevantCyclesSinceApplyDeltaHistogram: Record<string, number>;
  readonly lastRelevantCyclesSinceApplyModulo28DeltaHistogram: Record<string, number>;
  readonly lastRelevantCyclesSinceApplyModulo114DeltaHistogram: Record<string, number>;
  readonly lastRelevantApplyDelayDeltaHistogram: Record<string, number>;
  readonly lastRelevantCycleInFrameDeltaHistogram: Record<string, number>;
  readonly lastRelevantFrameHistogram: Record<string, number>;
  readonly sameOutputRmsMean: number;
  readonly sameOutputRmsMax: number;
  readonly eventAlignedRmsMean: number;
  readonly eventAlignedRmsMax: number;
  readonly bestLagRmsMean: number;
  readonly bestLagRmsMax: number;
}

interface PokeyRawTracePcmResidualComparison {
  readonly radius: number;
  readonly maxLag: number;
  readonly compared: number;
  readonly skipped: number;
  readonly cycleDeltaMode: number | undefined;
  readonly sameOutput: LocalPcmResidualAggregate;
  readonly eventAligned: LocalPcmResidualAggregate;
  readonly bestLag: LocalPcmResidualAggregate;
  readonly bestLagHistogram: Record<string, number>;
  readonly byBestLag: Record<string, PokeyPcmResidualBucket>;
  readonly byCycleDeltaResidual: Record<string, PokeyPcmResidualBucket>;
  readonly byOutputSampleDelta: Record<string, {
    readonly count: number;
    readonly sameOutputRmsMean: number;
    readonly sameOutputRmsMax: number;
    readonly eventAlignedRmsMean: number;
    readonly eventAlignedRmsMax: number;
    readonly bestLagRmsMean: number;
    readonly bestLagRmsMax: number;
    readonly eventAlignedRmsImprovementMean: number;
    readonly eventAlignedRmsImprovementMax: number;
    readonly bestLagRmsImprovementMean: number;
    readonly bestLagRmsImprovementMax: number;
  }>;
  readonly topTransitionGroups: ReadonlyArray<PokeyPcmResidualTransitionGroup>;
  readonly topImprovingTransitionGroups: ReadonlyArray<PokeyPcmResidualTransitionGroup>;
  readonly topTimingRuns: ReadonlyArray<PokeyRawTracePcmResidualTimingRun>;
  readonly contextSamples: ReadonlyArray<PokeyRawTracePcmResidualContextSample>;
  readonly worstSameOutput: ReadonlyArray<{
    readonly index: number;
    readonly prevRaw: string;
    readonly raw: string;
    readonly rawMatch: boolean;
    readonly prevChannels: readonly number[];
    readonly channels: readonly number[];
    readonly outputSampleDelta: number;
    readonly cycleDelta: number;
    readonly cycleDeltaResidual: number | undefined;
    readonly tsEstimatedOutputSample: number;
    readonly referenceEstimatedOutputSample: number;
    readonly sameOutput: LocalPcmResidualStats;
    readonly eventAligned: LocalPcmResidualStats;
    readonly bestLag: LocalPcmResidualStats;
  }>;
  readonly worstEventAligned: ReadonlyArray<{
    readonly index: number;
    readonly prevRaw: string;
    readonly raw: string;
    readonly rawMatch: boolean;
    readonly prevChannels: readonly number[];
    readonly channels: readonly number[];
    readonly outputSampleDelta: number;
    readonly cycleDelta: number;
    readonly cycleDeltaResidual: number | undefined;
    readonly tsEstimatedOutputSample: number;
    readonly referenceEstimatedOutputSample: number;
    readonly sameOutput: LocalPcmResidualStats;
    readonly eventAligned: LocalPcmResidualStats;
    readonly bestLag: LocalPcmResidualStats;
  }>;
  readonly worstBestLag: ReadonlyArray<{
    readonly index: number;
    readonly prevRaw: string;
    readonly raw: string;
    readonly rawMatch: boolean;
    readonly prevChannels: readonly number[];
    readonly channels: readonly number[];
    readonly outputSampleDelta: number;
    readonly cycleDelta: number;
    readonly cycleDeltaResidual: number | undefined;
    readonly tsEstimatedOutputSample: number;
    readonly referenceEstimatedOutputSample: number;
    readonly sameOutput: LocalPcmResidualStats;
    readonly eventAligned: LocalPcmResidualStats;
    readonly bestLag: LocalPcmResidualStats;
  }>;
}

interface RenderedTsAudio {
  mix: Float32Array;
  ym: Float32Array;
  pokey: Float32Array;
  ymChannels: Float32Array[] | undefined;
  pokeyChannels: Float32Array[] | undefined;
  ymSamples: number;
  pokeySamples: number;
  paddedSamples: number;
  ymPaddedSamples: number;
  pokeyPaddedSamples: number;
  cyclePreciseTape: boolean;
  resetFrame: number | undefined;
  statusReplay: SoundStatusReplayStats | undefined;
  replyAckReplay: MainReplyAckReplay | undefined;
  renderMode: "sound-chip" | "mame-chip-writes";
  mameYmWrites: string | undefined;
  mamePokeyWrites: string | undefined;
  directChipWriteOrigin: "absolute" | "cmd-tape-replay";
  directChipWriteSampleTiming: "attos" | "cycle";
  directChipWriteCycleTiming: "attos" | "log";
  directChipWriteCycleRate: number;
  directYmWriteSampleOffset: number;
  ymNativeSampleRate: number;
  ymScheduler: "cycle" | "mame-stream";
  ymStreamAbsoluteOrigin: boolean;
  ymStreamSampleOffset: number;
  ymStreamCycleOffsetCycles: string | undefined;
  resampler: "linear" | "mame-lofi";
  ymResampler: "linear" | "mame-lofi";
  pokeyResampler: "linear" | "mame-lofi";
  ymOutputSampleOffset: number;
  pokeyOutputSampleOffset: number;
  pokeyNativeSampleRate: number;
  pokeySampleCycles: number;
  pokeySampleAfterClock: boolean;
  commandContext: CommandContextSummary;
  frameReplayEvents?: FrameReplayEvent[];
  ymStreamWriteDiagnostics?: YmStreamWriteDiagnostics;
  ymCommandEdgeEventAdjust?: YmCommandEdgeRuntimeAdjustSummary;
  pokeyCommandEdgeEventAdjust?: YmCommandEdgeRuntimeAdjustSummary;
  commandReplayEvents?: CommandReplayEvent[];
  ymStreamWriteTraceEvents?: YmStreamWriteEventSummary[];
  ymStateTrace?: YM2151ChannelStateSnapshot[];
  pokeyRawTrace?: PokeyRawTrace;
  pokeyWriteEvents?: PokeyWriteTraceEvent[];
  pokeyDeviceWriteSnapshots?: PokeyDeviceWriteSnapshotTraceEvent[];
}

interface FrameReplayEvent {
  readonly frame: number;
  readonly frameStart: number;
  readonly frameEnd: number;
  readonly frameCycles: number;
  readonly cpuStart: number;
  readonly cpuEnd: number;
  readonly cpuStartDelta: number;
  readonly cpuEndDelta: number;
  readonly commandCount: number;
  readonly releaseOnThisFrame: boolean;
  readonly inResetAfter: boolean;
}

interface YmStreamWriteDiagnostics {
  writeCount: number;
  generatedWriteCount: number;
  zeroGeneratedWriteCount: number;
  generatedAtWrites: number;
  alreadyGeneratedWriteCount: number;
  maxAlreadyGeneratedSamples: number;
  targetSampleMin: number | undefined;
  targetSampleMax: number | undefined;
  generatedBeforeMax: number;
  generatedAfterMax: number;
  eventCycleOffsetHistogram: Record<string, number>;
  firstEventCycleOffsetWrites: YmStreamWriteEventSummary[];
  ymWriteEventCycleOffsetMatchHits: Record<string, YmStreamWriteEventCycleOffsetMatchHit>;
  firstAlreadyGeneratedWrites: Array<{
    index: number;
    frame: number | undefined;
    cycleInFrame: number | undefined;
    pc: string;
    reg: string;
    val: string;
    targetSample: number;
    generatedBefore: number;
    alreadyGeneratedSamples: number;
  }>;
}

interface YmStreamWriteEventSummary {
  index: number;
  frame: number | undefined;
  cycleInFrame: number | undefined;
  rawCycleInFrame: number | undefined;
  pc: string;
  reg: string;
  val: string;
  channel: number | undefined;
  category: string;
  eventCycleOffset: number | undefined;
  targetSample: number;
  generatedBefore: number;
  matchIndices: number[] | undefined;
}

type YmStreamWriteTraceEvent = YmStreamWriteEventSummary & {
  targetOutputSample: number;
  deltaFromTraceCenter: number;
  deltaFromMaxAbsSample: number;
  mame?: {
    sourceIndex: number;
    frame: number | undefined;
    pc: string | undefined;
    targetSample: number;
    targetOutputSample: number;
    nativeSampleDelta: number;
    outputSampleDelta: number;
  };
};

interface YmStreamWriteTrace {
  radiusOutputSamples: number;
  centerOutputSample: number;
  centerSource: "max-abs" | "arg";
  totalInRadius: number;
  approximatedFromNativeTargetSample: boolean;
  mameYmWrites: string | undefined;
  mameSampleOrigin: "absolute" | "cmd-tape-replay" | undefined;
  writes: YmStreamWriteTraceEvent[];
}

interface YmStreamWriteEventCycleOffsetMatchHit {
  count: number;
  byFrame: Record<string, number>;
  firstWrites: YmStreamWriteEventSummary[];
}

type ChipWriteEventWithOffsetMatchDiagnostics = ChipWriteEvent & {
  readonly ymWriteEventCycleOffsetMatchIndices?: readonly number[];
};

interface MameChipWrite {
  readonly kind: "ym" | "pokey";
  readonly cycle: bigint;
  readonly sampleIndex?: bigint;
  readonly frame?: number;
  readonly cycleInFrame?: number;
  readonly pc?: number;
  readonly reg: number;
  readonly val: number;
  readonly sourceIndex: number;
}

interface PokeyWriteTraceEvent {
  readonly index: number;
  readonly source: "sound-chip" | "mame-chip-writes";
  readonly sourceIndex?: number;
  readonly cycle: number;
  readonly applyCycle: number;
  readonly applyDelayCycles: number;
  readonly frame?: number;
  readonly cycleInFrame?: number;
  readonly rawCycle?: number;
  readonly rawCycleInFrame?: number;
  readonly pc?: string;
  readonly reg: string;
  readonly val: string;
}

type PokeyDeviceWriteSnapshotTraceEvent = PokeyWriteSnapshot & {
  readonly index: number;
  readonly source: "sound-chip" | "mame-chip-writes";
};

interface PokeyDeviceWriteSnapshotComparison {
  readonly compared: number;
  readonly tsCount: number;
  readonly referenceCount: number;
  readonly countDelta: number;
  readonly cycleDeltaHistogram: Record<string, number>;
  readonly beforeClockCnt28DeltaHistogram: Record<string, number>;
  readonly beforeClockCnt114DeltaHistogram: Record<string, number>;
  readonly beforeCounterDeltaHistograms: ReadonlyArray<Record<string, number>>;
  readonly beforePolyDeltaHistograms: ReadonlyArray<Record<string, number>>;
  readonly beforePolyModuloDeltaHistogram: Record<string, number>;
  readonly beforePolyClockDeltaHistogram: Record<string, number>;
  readonly beforePolyClockDelta28TicksHistogram: Record<string, number>;
  readonly relativeOrigins: readonly PokeyDeviceWriteSnapshotRelativeOriginComparison[];
  readonly firstRegValMismatch?: PokeyDeviceWriteSnapshotMismatch;
  readonly firstBeforeClockCnt28Mismatch?: PokeyDeviceWriteSnapshotMismatch;
  readonly firstBeforeClockCnt114Mismatch?: PokeyDeviceWriteSnapshotMismatch;
  readonly firstBeforeCounterMismatch?: PokeyDeviceWriteSnapshotMismatch;
  readonly firstBeforePolyMismatch?: PokeyDeviceWriteSnapshotMismatch;
}

interface PokeyDeviceWriteSnapshotRelativeOriginComparison {
  readonly name: "first-write" | "first-skctl-enable";
  readonly originIndex: number;
  readonly tsOriginCycle: number;
  readonly referenceOriginCycle: number;
  readonly originCycleDelta: number;
  readonly relativeCycleDeltaHistogram: Record<string, number>;
  readonly beforeClockCnt114DeltaHistogram: Record<string, number>;
  readonly beforePolyModuloDeltaHistogram: Record<string, number>;
  readonly beforePolyClockDeltaHistogram: Record<string, number>;
  readonly beforePolyClockDelta28TicksHistogram: Record<string, number>;
  readonly beforePolyClockPlusRelativeCycleDeltaHistogram: Record<string, number>;
  readonly firstBeforePolyClockPlusRelativeCycleDeltaMismatches:
    readonly PokeyDeviceWriteSnapshotRelativeMismatch[];
  readonly firstNonzeroRelativeCycleDelta?: PokeyDeviceWriteSnapshotRelativeMismatch;
  readonly firstBeforeClockCnt28Mismatch?: PokeyDeviceWriteSnapshotRelativeMismatch;
  readonly firstBeforeClockCnt114Mismatch?: PokeyDeviceWriteSnapshotRelativeMismatch;
  readonly firstBeforeCounterMismatch?: PokeyDeviceWriteSnapshotRelativeMismatch;
  readonly firstBeforePolyMismatch?: PokeyDeviceWriteSnapshotRelativeMismatch;
}

interface PokeyDeviceWriteSnapshotMismatch {
  readonly index: number;
  readonly cycleDelta: number;
  readonly beforeClockCnt28Delta: number;
  readonly beforeClockCnt114Delta: number;
  readonly beforeCounterDelta: readonly number[];
  readonly beforePolyDelta: readonly number[];
  readonly beforePolyModuloDelta: readonly number[];
  readonly beforePolyClockDelta: number | undefined;
  readonly beforePolyClockDelta28Ticks: number | undefined;
  readonly ts: PokeyDeviceWriteSnapshotSummary;
  readonly reference: PokeyDeviceWriteSnapshotSummary;
  readonly tsWrite?: PokeyWriteTraceEvent;
  readonly referenceWrite?: PokeyWriteTraceEvent;
}

interface PokeyDeviceWriteSnapshotRelativeMismatch extends PokeyDeviceWriteSnapshotMismatch {
  readonly originIndex: number;
  readonly tsRelativeCycle: number;
  readonly referenceRelativeCycle: number;
  readonly relativeCycleDelta: number;
  readonly beforePolyClockPlusRelativeCycleDelta: number | undefined;
}

interface PokeyDeviceWriteSnapshotSummary {
  readonly cycle: number;
  readonly nativeSample: number;
  readonly cycleInNativeSample: number;
  readonly reg: string;
  readonly val: string;
  readonly beforeAudctl: string;
  readonly beforeSkctl: string;
  readonly beforeClockCnt28: number;
  readonly beforeClockCnt114: number;
  readonly beforeCounters: readonly number[];
  readonly beforePoly: readonly number[];
  readonly afterAudctl: string;
  readonly afterSkctl: string;
  readonly afterClockCnt28: number;
  readonly afterClockCnt114: number;
  readonly afterCounters: readonly number[];
  readonly afterPoly: readonly number[];
}

interface ComponentPaddedSamples {
  readonly ym: number;
  readonly pokey: number;
}

function asYmDiagnostics(chip: unknown): SoundChipWithYmDiagnostics {
  return chip as SoundChipWithYmDiagnostics;
}

function createYmStreamWriteDiagnostics(): YmStreamWriteDiagnostics {
  return {
    writeCount: 0,
    generatedWriteCount: 0,
    zeroGeneratedWriteCount: 0,
    generatedAtWrites: 0,
    alreadyGeneratedWriteCount: 0,
    maxAlreadyGeneratedSamples: 0,
    targetSampleMin: undefined,
    targetSampleMax: undefined,
    generatedBeforeMax: 0,
    generatedAfterMax: 0,
    eventCycleOffsetHistogram: {},
    firstEventCycleOffsetWrites: [],
    ymWriteEventCycleOffsetMatchHits: {},
    firstAlreadyGeneratedWrites: [],
  };
}

function ymWriteChannel(reg: number, val: number): number | undefined {
  const r = reg & 0xff;
  if (r === 0x08) return val & 0x07;
  if (r >= 0x20) return r & 0x07;
  return undefined;
}

function ymWriteCategory(reg: number): string {
  const r = reg & 0xff;
  if (r === 0x08) return "key-on";
  if (r >= 0x10 && r <= 0x14) return "timer";
  if (r === 0x0f || r === 0x18 || r === 0x19 || r === 0x1b) return "lfo-noise";
  if (r >= 0x20 && r <= 0x3f) return "channel-freq-algo";
  if (r >= 0x40) return "operator";
  return "global";
}

function ymStreamWriteEventSummary(
  index: number,
  event: ChipWriteEventWithOffsetMatchDiagnostics,
): YmStreamWriteEventSummary {
  return {
    index,
    frame: event.frame,
    cycleInFrame: event.cycleInFrame,
    rawCycleInFrame: event.rawCycleInFrame,
    pc: `0x${event.pc.toString(16).padStart(4, "0")}`,
    reg: `0x${event.reg.toString(16).padStart(2, "0")}`,
    val: `0x${event.val.toString(16).padStart(2, "0")}`,
    channel: ymWriteChannel(event.reg, event.val),
    category: ymWriteCategory(event.reg),
    eventCycleOffset: event.eventCycleOffset,
    targetSample: event.ymStreamTargetSample ?? -1,
    generatedBefore: event.ymStreamGeneratedBefore ?? -1,
    matchIndices: event.ymWriteEventCycleOffsetMatchIndices === undefined
      ? undefined
      : [...event.ymWriteEventCycleOffsetMatchIndices],
  };
}

function accumulateYmStreamWriteDiagnostics(
  stats: YmStreamWriteDiagnostics,
  events: readonly ChipWriteEvent[],
  retainedWrites: YmStreamWriteEventSummary[] | undefined = undefined,
): void {
  for (const rawEvent of events) {
    const event = rawEvent as ChipWriteEventWithOffsetMatchDiagnostics;
    if (event.kind !== "ym2151" || event.ymStreamTargetSample === undefined ||
      event.ymStreamGeneratedBefore === undefined || event.ymStreamGeneratedAfter === undefined ||
      event.ymStreamGeneratedCount === undefined || event.ymStreamAlreadyGeneratedSamples === undefined) {
      continue;
    }
    const index = stats.writeCount;
    const summary = ymStreamWriteEventSummary(index, event);
    retainedWrites?.push(summary);
    stats.writeCount++;
    if (event.ymStreamGeneratedCount > 0) {
      stats.generatedWriteCount++;
      stats.generatedAtWrites += event.ymStreamGeneratedCount;
    } else {
      stats.zeroGeneratedWriteCount++;
    }
    stats.targetSampleMin = stats.targetSampleMin === undefined
      ? event.ymStreamTargetSample
      : Math.min(stats.targetSampleMin, event.ymStreamTargetSample);
    stats.targetSampleMax = stats.targetSampleMax === undefined
      ? event.ymStreamTargetSample
      : Math.max(stats.targetSampleMax, event.ymStreamTargetSample);
    stats.generatedBeforeMax = Math.max(stats.generatedBeforeMax, event.ymStreamGeneratedBefore);
    stats.generatedAfterMax = Math.max(stats.generatedAfterMax, event.ymStreamGeneratedAfter);
    if (event.eventCycleOffset !== undefined) {
      const key = String(event.eventCycleOffset);
      stats.eventCycleOffsetHistogram[key] = (stats.eventCycleOffsetHistogram[key] ?? 0) + 1;
      if (stats.firstEventCycleOffsetWrites.length < 16) {
        stats.firstEventCycleOffsetWrites.push(summary);
      }
    }
    for (const matchIndex of event.ymWriteEventCycleOffsetMatchIndices ?? []) {
      const key = String(matchIndex);
      const hit = stats.ymWriteEventCycleOffsetMatchHits[key] ?? { count: 0, byFrame: {}, firstWrites: [] };
      hit.count++;
      const frameKey = event.frame === undefined ? "undefined" : String(event.frame);
      hit.byFrame[frameKey] = (hit.byFrame[frameKey] ?? 0) + 1;
      if (hit.firstWrites.length < 8) hit.firstWrites.push(summary);
      stats.ymWriteEventCycleOffsetMatchHits[key] = hit;
    }
    if (event.ymStreamAlreadyGeneratedSamples > 0) {
      stats.alreadyGeneratedWriteCount++;
      stats.maxAlreadyGeneratedSamples =
        Math.max(stats.maxAlreadyGeneratedSamples, event.ymStreamAlreadyGeneratedSamples);
      if (stats.firstAlreadyGeneratedWrites.length < 8) {
        stats.firstAlreadyGeneratedWrites.push({
          index,
          frame: event.frame,
          cycleInFrame: event.cycleInFrame,
          pc: `0x${event.pc.toString(16).padStart(4, "0")}`,
          reg: `0x${event.reg.toString(16).padStart(2, "0")}`,
          val: `0x${event.val.toString(16).padStart(2, "0")}`,
          targetSample: event.ymStreamTargetSample,
          generatedBefore: event.ymStreamGeneratedBefore,
          alreadyGeneratedSamples: event.ymStreamAlreadyGeneratedSamples,
        });
      }
    }
  }
}

function setYmPhaseAdvanceAfterOutput(ym: unknown, enabled: boolean): void {
  (ym as YmPhaseDiagnosticTarget).diagnosticPhaseAdvanceAfterOutput = enabled;
}

function setYmDiagnosticChannelSamples(chip: unknown, enabled: boolean): void {
  const target = asYmDiagnostics(chip).ym2151;
  const channelCount = target.channels?.length ?? 8;
  target.diagnosticChannelSampleBuffers = enabled
    ? Array.from({ length: channelCount }, () => [])
    : undefined;
}

function drainYmDiagnosticChannelSamples(chip: unknown): number[][] | undefined {
  const buffers = asYmDiagnostics(chip).ym2151.diagnosticChannelSampleBuffers;
  if (buffers === undefined) return undefined;
  const out = buffers.map((buf) => buf.slice());
  for (const buf of buffers) buf.length = 0;
  return out;
}

function readArg(args: string[], name: string): string | undefined {
  const idx = args.indexOf(name);
  return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : undefined;
}

function parseSource(value: string | undefined): Args["source"] {
  if (value === undefined || value === "mix") return "mix";
  if (value === "ym" || value === "pokey") return value;
  throw new Error(`invalid --source ${value}; expected mix, ym, or pokey`);
}

function parseWindowSource(value: string | undefined): Args["windowSource"] {
  if (value === undefined || value === "mame") return "mame";
  if (value === "ts" || value === "ym" || value === "pokey") return value;
  throw new Error(`invalid --window-source ${value}; expected mame, ts, ym, or pokey`);
}

function parseMameSubtractSource(value: string | undefined): Args["mameSubtractSource"] {
  if (value === undefined || value === "none") return "none";
  if (value === "ym" || value === "pokey") return value;
  throw new Error(`invalid --mame-subtract-source ${value}; expected none, ym, or pokey`);
}

function parseYmScheduler(value: string | undefined): Args["ymScheduler"] {
  if (value === undefined || value === "cycle") return "cycle";
  if (value === "mame-stream") return value;
  throw new Error(`invalid --ym-scheduler ${value}; expected cycle or mame-stream`);
}

function parseDirectChipWriteOrigin(value: string | undefined): Args["directChipWriteOrigin"] {
  if (value === undefined || value === "absolute") return "absolute";
  if (value === "cmd-tape-replay") return "cmd-tape-replay";
  throw new Error(`invalid --direct-chip-write-origin ${value}; expected absolute or cmd-tape-replay`);
}

function parseDirectChipWriteSampleTiming(value: string | undefined): Args["directChipWriteSampleTiming"] {
  if (value === undefined || value === "attos") return "attos";
  if (value === "cycle") return "cycle";
  throw new Error(`invalid --direct-chip-write-sample-timing ${value}; expected attos or cycle`);
}

function parseDirectChipWriteCycleTiming(value: string | undefined): Args["directChipWriteCycleTiming"] {
  if (value === undefined || value === "attos") return "attos";
  if (value === "log" || value === "logged" || value === "cycle" || value === "cycle-field") return "log";
  throw new Error(`invalid --direct-chip-write-cycle-timing ${value}; expected attos or log`);
}

function parseDirectChipWriteCycleRateMode(value: string | undefined): Args["directChipWriteCycleRateMode"] {
  if (value === undefined || value === "auto") return "auto";
  if (value === "sound" || value === "sound-cpu" || value === "sound-cmd") return "sound";
  if (value === "pokey" || value === "pokey-clock") return "pokey";
  throw new Error(`invalid --direct-chip-write-cycle-rate-mode ${value}; expected auto, sound, or pokey`);
}

function parseCmdTapeCommandTiming(value: string | undefined): CmdTapeCommandTiming {
  if (value === undefined || value === "attos" || value === "secs-attos" || value === "secsAttos") {
    return "secsAttos";
  }
  if (value === "cycle" || value === "cycle-in-frame" || value === "cycleInFrame") return "cycleInFrame";
  throw new Error(`invalid --cmd-tape-command-timing ${value}; expected attos or cycle`);
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

function parseResampler(value: string | undefined): Args["resampler"] {
  if (value === undefined || value === "linear") return "linear";
  if (value === "mame-lofi") return value;
  throw new Error(`invalid --resampler ${value}; expected linear or mame-lofi`);
}

function parseIntegerArg(
  args: string[],
  name: string,
  defaultValue: number,
  preset?: AudioBitperfectPreset,
): number {
  const raw = readArgWithAudioBitperfectPreset(args, preset, name);
  if (raw === undefined) return defaultValue;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`invalid ${name} ${raw}; expected a finite integer`);
  return Math.trunc(value);
}

function parseOptionalNumberArg(
  args: string[],
  name: string,
  preset?: AudioBitperfectPreset,
): number | undefined {
  const raw = readArgWithAudioBitperfectPreset(args, preset, name);
  if (raw === undefined) return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`invalid ${name} ${raw}; expected a finite number`);
  return value;
}

function parseOptionalIntegerArg(
  args: string[],
  name: string,
  preset?: AudioBitperfectPreset,
): number | undefined {
  const value = parseOptionalNumberArg(args, name, preset);
  return value === undefined ? undefined : Math.trunc(value);
}

function parsePcListArg(
  args: string[],
  name: string,
  preset?: AudioBitperfectPreset,
): number[] | undefined {
  const raw = readArgWithAudioBitperfectPreset(args, preset, name);
  if (raw === undefined || raw.trim() === "") return undefined;
  return raw.split(",").map((part) => {
    const trimmed = part.trim();
    const pc = Number.parseInt(trimmed, trimmed.startsWith("0x") || trimmed.startsWith("0X") ? 16 : 10);
    if (!Number.isFinite(pc) || pc < 0 || pc > 0xffff) {
      throw new Error(`invalid ${name} entry ${part}; expected a 16-bit PC`);
    }
    return pc & 0xffff;
  });
}

function parseRegisterCycleOffsets(
  args: string[],
  name: string,
  preset?: AudioBitperfectPreset,
  label = "register",
): ReadonlyMap<number, number> {
  const raw = readArgWithAudioBitperfectPreset(args, preset, name);
  const offsets = new Map<number, number>();
  if (raw === undefined || raw.trim() === "") return offsets;
  for (const rawEntry of raw.split(",")) {
    const entry = rawEntry.trim();
    const separator = entry.includes("=") ? "=" : ":";
    const [regRaw, deltaRaw] = entry.split(separator);
    if (regRaw === undefined || deltaRaw === undefined || regRaw.trim() === "" || deltaRaw.trim() === "") {
      throw new Error(`invalid ${name} entry ${rawEntry}; expected 0x18:+5 or 0x18=5`);
    }
    const reg = Number.parseInt(regRaw.trim(), regRaw.trim().startsWith("0x") ? 16 : 10);
    const delta = Number(deltaRaw.trim());
    if (!Number.isFinite(reg) || reg < 0 || reg > 0xff || !Number.isFinite(delta)) {
      throw new Error(`invalid ${name} entry ${rawEntry}; ${label} must be 0..255 and delta a finite integer`);
    }
    offsets.set(reg & 0xff, Math.trunc(delta));
  }
  return offsets;
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

function parseOptionalIntegerPart(raw: string): number | undefined {
  const trimmed = raw.trim();
  if (trimmed === "" || trimmed === "*") return undefined;
  const value = Number.parseInt(trimmed, trimmed.startsWith("0x") ? 16 : 10);
  if (!Number.isFinite(value)) throw new Error(`invalid selector value ${raw}`);
  return value;
}

function parseCommandEdgeRuleByteList(value: string, argName: string): number[] | undefined {
  const trimmed = value.trim();
  if (trimmed === "" || trimmed === "*") return undefined;
  return trimmed.split("+").map((raw) => {
    const part = raw.trim();
    const byte = Number.parseInt(part, part.startsWith("0x") ? 16 : 10);
    if (!Number.isFinite(byte) || byte < 0 || byte > 0xff) {
      throw new Error(`invalid byte in ${argName}: ${raw}`);
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
      throw new Error(`invalid reg=value pair in ${argName}: ${raw}`);
    }
    const regPart = regRaw.trim();
    const valPart = valRaw.trim();
    const reg = Number.parseInt(regPart, regPart.startsWith("0x") ? 16 : 10);
    const val = Number.parseInt(valPart, valPart.startsWith("0x") ? 16 : 10);
    if (!Number.isFinite(reg) || reg < 0 || reg > 0xff ||
      !Number.isFinite(val) || val < 0 || val > 0xff) {
      throw new Error(`invalid reg=value pair in ${argName}: ${raw}`);
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
      throw new Error(`invalid PC in ${argName}: ${raw}`);
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

function parseCommandEdgeEventRelation(value: string | undefined): CommandEdgeEventRelation {
  if (value === undefined || value === "" || value === "both") return "both";
  if (value === "raw-before" || value === "raw-crossing" || value === "raw-after") return value;
  throw new Error(`invalid command-edge relation ${value}`);
}

function parseCommandEdgeEventAnchor(value: string | undefined): CommandEdgeEventAnchor {
  if (value === undefined || value.trim() === "" || value === "command") return "command";
  if (value === "first-read" || value === "read") return "first-read";
  if (value === "current-event" || value === "event" || value === "offset" || value === "write") {
    return "current-event";
  }
  throw new Error(`invalid command-edge anchor ${value}; expected command, first-read, or current-event`);
}

function parseCommandEdgeEventRules(
  value: string | undefined,
  defaultAfterCycles: number,
  argName: string,
): readonly CommandEdgeEventRule[] {
  if (value === undefined || value.trim() === "") return [];
  return value.split(/[;,]/).map((rawEntry) => {
    const entry = rawEntry.trim();
    const parts = entry.split(":");
    if (parts.length < 4 || parts.length > 13) {
      throw new Error(
        `invalid ${argName} entry ${rawEntry}; ` +
        "expected bytes:minRawDelta:maxRawDelta:delay[:relation[:after[:before[:commandPcs[:anchor[:writePcs[:writeRegs[:writeVals[:writeRegVals]]]]]]]]]",
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
    if (!Number.isFinite(delayCycles)) throw new Error(`invalid ${argName} delay in ${rawEntry}`);
    if (afterCycles !== undefined && !Number.isFinite(afterCycles)) {
      throw new Error(`invalid ${argName} after-cycles in ${rawEntry}`);
    }
    if (beforeCycles !== undefined && !Number.isFinite(beforeCycles)) {
      throw new Error(`invalid ${argName} before-cycles in ${rawEntry}`);
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

function parseYmWriteEventCycleOffsetMatches(
  args: string[],
  name: string,
  preset?: AudioBitperfectPreset,
): readonly YmWriteEventCycleOffsetMatch[] {
  const raw = readArgWithAudioBitperfectPreset(args, preset, name);
  if (raw === undefined || raw.trim() === "") return [];
  return raw.split(",").map((rawEntry) => {
    const parts = rawEntry.trim().split(":");
    if (parts.length !== 5 && parts.length !== 7) {
      throw new Error(
        `invalid ${name} entry ${rawEntry}; expected frame:pc:reg:val:delta[:cycleMin:cycleMax], with * wildcards`,
      );
    }
    const [frameRaw, pcRaw, regRaw, valRaw, deltaRaw, cycleMinRaw, cycleMaxRaw] = parts;
    const deltaCycles = Number(deltaRaw);
    if (!Number.isFinite(deltaCycles)) throw new Error(`invalid ${name} delta in ${rawEntry}`);
    const frame = parseOptionalIntegerPart(frameRaw ?? "");
    const pc = parseOptionalIntegerPart(pcRaw ?? "");
    const reg = parseOptionalIntegerPart(regRaw ?? "");
    const val = parseOptionalIntegerPart(valRaw ?? "");
    const cycleInFrameMin = parseOptionalIntegerPart(cycleMinRaw ?? "");
    const cycleInFrameMax = parseOptionalIntegerPart(cycleMaxRaw ?? "");
    if (frame !== undefined && frame < 0) throw new Error(`invalid ${name} frame in ${rawEntry}`);
    if (pc !== undefined && (pc < 0 || pc > 0xffff)) throw new Error(`invalid ${name} pc in ${rawEntry}`);
    if (reg !== undefined && (reg < 0 || reg > 0xff)) throw new Error(`invalid ${name} reg in ${rawEntry}`);
    if (val !== undefined && (val < 0 || val > 0xff)) throw new Error(`invalid ${name} val in ${rawEntry}`);
    if (cycleInFrameMin !== undefined && cycleInFrameMin < 0) {
      throw new Error(`invalid ${name} cycleMin in ${rawEntry}`);
    }
    if (cycleInFrameMax !== undefined && cycleInFrameMax < 0) {
      throw new Error(`invalid ${name} cycleMax in ${rawEntry}`);
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

function writeEventCycleOffsetForMatches(
  matches: readonly YmWriteEventCycleOffsetMatch[],
  event: {
    readonly frame: number | undefined;
    readonly cycleInFrame: number | undefined;
    readonly pc: number;
    readonly reg: number;
    readonly val: number;
  },
): number {
  let offset = 0;
  for (const match of matches) {
    if (match.frame !== undefined && event.frame !== match.frame) continue;
    if (match.pc !== undefined && (event.pc & 0xffff) !== match.pc) continue;
    if (match.reg !== undefined && (event.reg & 0xff) !== match.reg) continue;
    if (match.val !== undefined && (event.val & 0xff) !== match.val) continue;
    if (
      match.cycleInFrameMin !== undefined &&
      (event.cycleInFrame === undefined || event.cycleInFrame < match.cycleInFrameMin)
    ) {
      continue;
    }
    if (
      match.cycleInFrameMax !== undefined &&
      (event.cycleInFrame === undefined || event.cycleInFrame > match.cycleInFrameMax)
    ) {
      continue;
    }
    offset += match.deltaCycles;
  }
  return offset;
}

function parseCommandNmiDelayMatches(
  args: string[],
  name: string,
  preset?: AudioBitperfectPreset,
): readonly CommandNmiDelayMatch[] {
  const raw = readArgWithAudioBitperfectPreset(args, preset, name);
  if (raw === undefined || raw.trim() === "") return [];
  return raw.split(",").map((rawEntry) => {
    const parts = rawEntry.trim().split(":");
    if (parts.length !== 4) {
      throw new Error(`invalid ${name} entry ${rawEntry}; expected frame:byte:cycleInFrame:delay, with * wildcards`);
    }
    const [frameRaw, byteRaw, cycleRaw, delayRaw] = parts;
    const frame = parseOptionalIntegerPart(frameRaw ?? "");
    const byte = parseOptionalIntegerPart(byteRaw ?? "");
    const cycleInFrame = parseOptionalIntegerPart(cycleRaw ?? "");
    const delayInstructions = Number(delayRaw);
    if (frame !== undefined && frame < 0) throw new Error(`invalid ${name} frame in ${rawEntry}`);
    if (byte !== undefined && (byte < 0 || byte > 0xff)) throw new Error(`invalid ${name} byte in ${rawEntry}`);
    if (cycleInFrame !== undefined && cycleInFrame < 0) throw new Error(`invalid ${name} cycleInFrame in ${rawEntry}`);
    if (!Number.isFinite(delayInstructions) || delayInstructions < 0) throw new Error(`invalid ${name} delay in ${rawEntry}`);
    return {
      ...(frame === undefined ? {} : { frame: Math.trunc(frame) }),
      ...(byte === undefined ? {} : { byte: Math.trunc(byte) & 0xff }),
      ...(cycleInFrame === undefined ? {} : { cycleInFrame: Math.trunc(cycleInFrame) }),
      delayInstructions: Math.trunc(delayInstructions),
    };
  });
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

function commandNmiDelayOverrideForMatch(
  matches: readonly CommandNmiDelayMatch[],
  frame: number,
  byte: number,
  cycleInFrame: number,
): number | undefined {
  let delay: number | undefined;
  for (const match of matches) {
    if (match.frame !== undefined && match.frame !== frame) continue;
    if (match.byte !== undefined && match.byte !== (byte & 0xff)) continue;
    if (match.cycleInFrame !== undefined && match.cycleInFrame !== cycleInFrame) continue;
    delay = match.delayInstructions;
  }
  return delay;
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

function parseDirectYmWriteSampleOffsetMatches(
  args: string[],
  name: string,
): readonly DirectYmWriteSampleOffsetMatch[] {
  const raw = readArg(args, name);
  if (raw === undefined || raw.trim() === "") return [];
  return raw.split(",").map((rawEntry) => {
    const parts = rawEntry.trim().split(":");
    if (parts.length !== 5) {
      throw new Error(`invalid ${name} entry ${rawEntry}; expected frame:pc:reg:val:delta, with * wildcards`);
    }
    const [frameRaw, pcRaw, regRaw, valRaw, deltaRaw] = parts;
    const deltaSamples = Number(deltaRaw);
    if (!Number.isFinite(deltaSamples)) throw new Error(`invalid ${name} delta in ${rawEntry}`);
    const frame = parseOptionalIntegerPart(frameRaw ?? "");
    const pc = parseOptionalIntegerPart(pcRaw ?? "");
    const reg = parseOptionalIntegerPart(regRaw ?? "");
    const val = parseOptionalIntegerPart(valRaw ?? "");
    if (frame !== undefined && frame < 0) throw new Error(`invalid ${name} frame in ${rawEntry}`);
    if (pc !== undefined && (pc < 0 || pc > 0xffff)) throw new Error(`invalid ${name} pc in ${rawEntry}`);
    if (reg !== undefined && (reg < 0 || reg > 0xff)) throw new Error(`invalid ${name} reg in ${rawEntry}`);
    if (val !== undefined && (val < 0 || val > 0xff)) throw new Error(`invalid ${name} val in ${rawEntry}`);
    return {
      ...(frame === undefined ? {} : { frame: Math.trunc(frame) }),
      ...(pc === undefined ? {} : { pc: Math.trunc(pc) }),
      ...(reg === undefined ? {} : { reg: Math.trunc(reg) }),
      ...(val === undefined ? {} : { val: Math.trunc(val) }),
      deltaSamples: Math.trunc(deltaSamples),
    };
  });
}

function directYmWriteSampleOffsetMatchesToJson(
  matches: readonly DirectYmWriteSampleOffsetMatch[],
): Array<Record<string, number | string>> {
  return matches.map((match) => ({
    ...(match.frame === undefined ? {} : { frame: match.frame }),
    ...(match.pc === undefined ? {} : { pc: `0x${match.pc.toString(16).padStart(4, "0")}` }),
    ...(match.reg === undefined ? {} : { reg: `0x${match.reg.toString(16).padStart(2, "0")}` }),
    ...(match.val === undefined ? {} : { val: `0x${match.val.toString(16).padStart(2, "0")}` }),
    deltaSamples: match.deltaSamples,
  }));
}

function fmtDirectYmWriteSampleOffsetMatches(matches: readonly DirectYmWriteSampleOffsetMatch[]): string {
  return matches.map((match) =>
    `${match.frame ?? "*"}:` +
    `${match.pc === undefined ? "*" : `0x${match.pc.toString(16).padStart(4, "0")}`}:` +
    `${match.reg === undefined ? "*" : `0x${match.reg.toString(16).padStart(2, "0")}`}:` +
    `${match.val === undefined ? "*" : `0x${match.val.toString(16).padStart(2, "0")}`}:` +
    `${match.deltaSamples}`).join(",");
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  const audioBitperfectPreset = resolveAudioBitperfectPreset(args);
  const readPresetArg = (name: string): string | undefined =>
    readArgWithAudioBitperfectPreset(args, audioBitperfectPreset, name);
  const hasPresetFlag = (name: string): boolean =>
    hasFlagWithAudioBitperfectPreset(args, audioBitperfectPreset, name);
  const windowStartArg = readPresetArg("--window-start");
  const pokeySampleCyclesArg = Number(readPresetArg("--pokey-sample-cycles") ?? "28");
  const pokeyWriteCycleOffsetArg = Number(readPresetArg("--pokey-write-cycle-offset") ?? "0");
  const pokeyWriteApplyDelayArg = Number(readPresetArg("--pokey-write-apply-delay") ?? "0");
  const pokeyWriteApplyBoundaryDelayArg = Number(readPresetArg("--pokey-write-apply-boundary-delay-cycles") ?? "0");
  const pokeyWriteApplyBoundaryDelaySampleRateArg =
    Number(readPresetArg("--pokey-write-apply-boundary-delay-sample-rate") ?? "55930");
  const ymCommandEdgeEventAfterCycles = Number(readPresetArg("--ym-command-edge-event-after") ?? "64");
  const pokeyCommandEdgeEventAfterCycles = Number(readPresetArg("--pokey-command-edge-event-after") ?? "0");
  const resampler = parseResampler(readPresetArg("--resampler"));
  const pokeyRawTraceRadiusArg = Number(readPresetArg("--pokey-raw-trace-radius") ?? "0");
  const pokeyRawTracePcmRadiusArg = Number(readPresetArg("--pokey-raw-trace-pcm-radius") ?? "0");
  const pokeyRawTracePcmMaxLagArg = Number(readPresetArg("--pokey-raw-trace-pcm-max-lag") ?? "2");
  const pokeyRawTraceCenterArg =
    readPresetArg("--pokey-raw-trace-center-sample") ?? readPresetArg("--sample-trace-center-sample");
  const pokeyRawTraceCenterSample = pokeyRawTraceCenterArg === undefined
    ? undefined
    : Number(pokeyRawTraceCenterArg);
  const commandNmiDelayCompletedChipWritePreemptionsArg =
    readPresetArg("--command-nmi-delay-completed-chip-write-preemptions");
  return {
    audioBitperfectPreset: audioBitperfectPreset?.name,
    mameWav: readPresetArg("--mame"),
    frames: Number(readPresetArg("--frames") ?? "14000"),
    cmdTape: readPresetArg("--cmd-tape") ?? "oracle/scenarios/sound-cmd-tape-attract-cycle-precise.json",
    cmdTapeCommandTiming: parseCmdTapeCommandTiming(readPresetArg("--cmd-tape-command-timing")),
    fixedFrameCycles: hasPresetFlag("--fixed-frame-cycles"),
    frameBudgetSmoothingWindow:
      Math.max(0, Math.trunc(Number(readPresetArg("--frame-budget-smoothing-window") ?? "0"))),
    requireCommandContext: hasPresetFlag("--require-command-context"),
    source: parseSource(readPresetArg("--source")),
    windowSource: parseWindowSource(readPresetArg("--window-source")),
    mameSubtractWav: readPresetArg("--mame-subtract-wav"),
    mameSubtractWavGain: Number(readPresetArg("--mame-subtract-wav-gain") ?? "1"),
    mameSubtractSource: parseMameSubtractSource(readPresetArg("--mame-subtract-source")),
    mameSubtractGain: Number(readPresetArg("--mame-subtract-gain") ?? "1"),
    referenceMameYmWrites: readPresetArg("--reference-mame-ym-writes"),
    referenceMamePokeyWrites: readPresetArg("--reference-mame-pokey-writes"),
    referenceMameComponentsOnly: hasPresetFlag("--reference-mame-components-only"),
    referencePokeyResampleOffset:
      parseOptionalNumberArg(args, "--reference-pokey-resample-offset", audioBitperfectPreset),
    referencePokeyWriteCycleOffset:
      parseOptionalIntegerArg(args, "--reference-pokey-write-cycle-offset", audioBitperfectPreset),
    ymChannelDiagnostics: hasPresetFlag("--ym-channel-diagnostics"),
    pokeyChannelDiagnostics: hasPresetFlag("--pokey-channel-diagnostics"),
    windowStart: windowStartArg === undefined ? undefined : Number(windowStartArg),
    windowSize: Number(readPresetArg("--window-size") ?? "8192"),
    windowHop: Number(readPresetArg("--window-hop") ?? "8192"),
    maxWindows: Number(readPresetArg("--max-windows") ?? "4"),
    maxLag: Number(readPresetArg("--max-lag") ?? "2000"),
    padResetSilence: readPresetArg("--pad-reset-silence") !== "0",
    audibleThreshold: Number(readPresetArg("--audible-threshold") ?? "0.01"),
    minCorrelation: Number(readPresetArg("--min-correlation") ?? "0.90"),
    maxAbsLag: Number(readPresetArg("--max-abs-lag") ?? "Infinity"),
    lagTieCorrelationEpsilon: Math.max(0, Number(readPresetArg("--lag-tie-correlation-epsilon") ?? "0")),
    maxRms: Number(readPresetArg("--max-rms") ?? "Infinity"),
    maxAbs: Number(readPresetArg("--max-abs") ?? "Infinity"),
    sampleTraceRadius: Math.max(0, Number(readPresetArg("--sample-trace-radius") ?? "0")),
    sampleTraceCenterSample: readPresetArg("--sample-trace-center-sample") === undefined
      ? undefined
      : Math.trunc(Number(readPresetArg("--sample-trace-center-sample"))),
    traceFrameAdvance: hasPresetFlag("--trace-frame-advance"),
    ymStreamWriteTraceRadius: Math.max(0, Number(readPresetArg("--ym-stream-write-trace-radius") ?? "0")),
    ymStreamWriteTraceLimit: Math.max(0, Number(readPresetArg("--ym-stream-write-trace-limit") ?? "64")),
    ymStreamWriteTraceCenterSample: readPresetArg("--ym-stream-write-trace-center-sample") === undefined
      ? undefined
      : Math.trunc(Number(readPresetArg("--ym-stream-write-trace-center-sample"))),
    ymStreamWriteTraceMameYmWrites: readPresetArg("--ym-stream-write-trace-mame-ym-writes"),
    ymStreamWriteTraceMameSampleTiming:
      parseDirectChipWriteSampleTiming(readPresetArg("--ym-stream-write-trace-mame-sample-timing")),
    ymStateTraceChannel: readPresetArg("--ym-state-trace-channel") === undefined
      ? undefined
      : Math.max(0, Math.min(7, Math.trunc(Number(readPresetArg("--ym-state-trace-channel"))))),
    ymStateTraceNativeStart: readPresetArg("--ym-state-trace-native-start") === undefined
      ? undefined
      : Math.max(0, Math.trunc(Number(readPresetArg("--ym-state-trace-native-start")))),
    ymStateTraceNativeEnd: readPresetArg("--ym-state-trace-native-end") === undefined
      ? undefined
      : Math.max(0, Math.trunc(Number(readPresetArg("--ym-state-trace-native-end")))),
    pokeyRawTraceRadius: Number.isFinite(pokeyRawTraceRadiusArg)
      ? Math.max(0, Math.trunc(pokeyRawTraceRadiusArg))
      : 0,
    pokeyRawTraceCenterSample:
      pokeyRawTraceCenterSample === undefined || !Number.isFinite(pokeyRawTraceCenterSample)
        ? undefined
        : Math.max(0, Math.trunc(pokeyRawTraceCenterSample)),
    pokeyRawTracePcmRadius: Number.isFinite(pokeyRawTracePcmRadiusArg)
      ? Math.max(0, Math.trunc(pokeyRawTracePcmRadiusArg))
      : 0,
    pokeyRawTracePcmMaxLag: Number.isFinite(pokeyRawTracePcmMaxLagArg)
      ? Math.max(0, Math.trunc(pokeyRawTracePcmMaxLagArg))
      : 2,
    report: readPresetArg("--report"),
    compactReport: hasPresetFlag("--compact-report"),
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
    commandNmiDelayInstructions: Number(readPresetArg("--command-nmi-delay-instructions") ?? "0"),
    commandNmiSampleCycle: Number(readPresetArg("--command-nmi-sample-cycle") ?? String(DEFAULT_COMMAND_NMI_SAMPLE_CYCLE)),
    commandNmiBoundaryDelayInstructions: Number(readPresetArg("--command-nmi-boundary-delay-instructions") ?? "0"),
    commandNmiDelayMatches: parseCommandNmiDelayMatches(args, "--command-nmi-delay-matches", audioBitperfectPreset),
    commandNmiDelayChipWriteBoundaryInstructions: readPresetArg("--command-nmi-delay-chip-write-boundary") === undefined
      ? undefined
      : Math.max(0, Math.trunc(Number(readPresetArg("--command-nmi-delay-chip-write-boundary")))),
    commandNmiDelayCompletedChipWritePreemptions:
      commandNmiDelayCompletedChipWritePreemptionsArg === undefined
        ? undefined
        : Math.max(0, Math.trunc(Number(commandNmiDelayCompletedChipWritePreemptionsArg))),
    commandCycleOffsetCycles: Number(readPresetArg("--command-cycle-offset") ?? "0"),
    commandCycleOffsetStartFrame: readPresetArg("--command-cycle-offset-start-frame") === undefined
      ? undefined
      : Number(readPresetArg("--command-cycle-offset-start-frame")),
    commandSubmitBeforeCpuCatchup: hasPresetFlag("--command-submit-before-cpu-catchup"),
    commandPreemptChipWriteLookaheadCycles: Number(readPresetArg("--command-preempt-chip-write-lookahead") ?? "0"),
    commandPreemptChipWritePcs:
      parsePcListArg(args, "--command-preempt-chip-write-pcs", audioBitperfectPreset),
    commandPreemptChipWriteCompleteBeforeTarget:
      hasPresetFlag("--command-preempt-chip-write-complete-before-target"),
    commandPreemptChipWriteBeforeOnly: hasPresetFlag("--command-preempt-chip-write-before-only"),
    deferChipIoWriteTiming: hasPresetFlag("--defer-chip-write-timing"),
    deferYmAudioWriteTiming: hasPresetFlag("--defer-ym-audio-write-timing"),
    deferYmParameterWriteTiming: hasPresetFlag("--defer-ym-parameter-write-timing"),
    deferYmTimerControlWriteTiming: hasPresetFlag("--defer-ym-timer-control-write-timing"),
    disableYmReset: hasPresetFlag("--disable-ym-reset"),
    ymWriteEventCycleOffsetCycles: parseIntegerArg(args, "--ym-write-event-cycle-offset", 0, audioBitperfectPreset),
    ymWriteEventCycleOffsetRegs: parseRegisterCycleOffsets(args, "--ym-write-event-cycle-offset-regs", audioBitperfectPreset),
    ymWriteEventCycleOffsetMatches:
      parseYmWriteEventCycleOffsetMatches(args, "--ym-write-event-cycle-offset-matches", audioBitperfectPreset),
    ymWriteEventSampleOffsetMatches:
      parseDirectYmWriteSampleOffsetMatches(args, "--ym-write-event-sample-offset-matches"),
    ymKeyOnWriteEventCycleOffsetCycles: parseIntegerArg(args, "--ym-keyon-write-event-cycle-offset", 0, audioBitperfectPreset),
    ymCommandEdgeEventAfterCycles,
    ymCommandEdgeEventRules: parseCommandEdgeEventRules(
      readPresetArg("--ym-command-edge-event-rules"),
      ymCommandEdgeEventAfterCycles,
      "--ym-command-edge-event-rules",
    ),
    pokeyCommandEdgeEventAfterCycles,
    pokeyCommandEdgeEventRules: parseCommandEdgeEventRules(
      readPresetArg("--pokey-command-edge-event-rules"),
      pokeyCommandEdgeEventAfterCycles,
      "--pokey-command-edge-event-rules",
    ),
    irqServiceDelayCycles: Math.max(0, parseIntegerArg(args, "--irq-service-delay", 0, audioBitperfectPreset)),
    mameYmWrites: readPresetArg("--mame-ym-writes"),
    mamePokeyWrites: readPresetArg("--mame-pokey-writes"),
    directChipWriteOrigin: parseDirectChipWriteOrigin(readPresetArg("--direct-chip-write-origin")),
    directChipWriteSampleTiming: parseDirectChipWriteSampleTiming(readPresetArg("--direct-chip-write-sample-timing")),
    directChipWriteCycleTiming: parseDirectChipWriteCycleTiming(readPresetArg("--direct-chip-write-cycle-timing")),
    directChipWriteCycleRateMode:
      parseDirectChipWriteCycleRateMode(readPresetArg("--direct-chip-write-cycle-rate-mode")),
    directYmWriteSampleOffset: parseIntegerArg(args, "--direct-ym-write-sample-offset", 0, audioBitperfectPreset),
    directYmWriteSampleOffsetRegs: parseRegisterCycleOffsets(args, "--direct-ym-write-sample-offset-regs", audioBitperfectPreset),
    directYmWriteSampleOffsetMatches:
      parseDirectYmWriteSampleOffsetMatches(args, "--direct-ym-write-sample-offset-matches"),
    ymPhaseAdvanceAfterOutput: hasPresetFlag("--ym-phase-advance-after-output"),
    ymScheduler: parseYmScheduler(readPresetArg("--ym-scheduler")),
    ymStreamAbsoluteOrigin: hasPresetFlag("--ym-stream-absolute-origin"),
    resampler,
    ymResampler: parseResampler(readPresetArg("--ym-resampler") ?? readPresetArg("--resampler")),
    pokeyResampler: parseResampler(readPresetArg("--pokey-resampler") ?? readPresetArg("--resampler")),
    ymNativeSampleRate: readPresetArg("--ym-native-sample-rate") === undefined
      ? undefined
      : Number(readPresetArg("--ym-native-sample-rate")),
    ymResampleOffset: Number(readPresetArg("--ym-resample-offset") ?? "0"),
    pokeyResampleOffset: Number(readPresetArg("--pokey-resample-offset") ?? "0"),
    ymOutputSampleOffset: parseIntegerArg(args, "--ym-output-sample-offset", 0, audioBitperfectPreset),
    pokeyOutputSampleOffset: parseIntegerArg(args, "--pokey-output-sample-offset", 0, audioBitperfectPreset),
    pokeyWriteCycleOffset: Number.isFinite(pokeyWriteCycleOffsetArg)
      ? Math.trunc(pokeyWriteCycleOffsetArg)
      : 0,
    pokeyWriteApplyDelayCycles: Number.isFinite(pokeyWriteApplyDelayArg)
      ? Math.max(0, Math.trunc(pokeyWriteApplyDelayArg))
      : 0,
    pokeyWriteApplyDelayOpcodes:
      parseRegisterCycleOffsets(args, "--pokey-write-apply-delay-opcodes", audioBitperfectPreset, "opcode"),
    pokeyWriteApplyDelayMatches:
      parseYmWriteEventCycleOffsetMatches(args, "--pokey-write-apply-delay-matches", audioBitperfectPreset),
    pokeyWriteApplyBoundaryDelayCycles: Number.isFinite(pokeyWriteApplyBoundaryDelayArg)
      ? Math.max(0, Math.trunc(pokeyWriteApplyBoundaryDelayArg))
      : 0,
    pokeyWriteApplyBoundaryDelaySampleRate: Number.isFinite(pokeyWriteApplyBoundaryDelaySampleRateArg)
      ? Math.max(1, Math.trunc(pokeyWriteApplyBoundaryDelaySampleRateArg))
      : 55_930,
    pokeyCommandEdgeRawCycleOffsetOpcodes:
      parseRegisterCycleOffsets(args, "--pokey-command-edge-raw-cycle-offset-opcodes", audioBitperfectPreset, "opcode"),
    pokeySampleCycles: Number.isFinite(pokeySampleCyclesArg)
      ? Math.max(1, Math.trunc(pokeySampleCyclesArg))
      : 28,
    pokeySampleAfterClock: hasPresetFlag("--pokey-sample-after-clock"),
  };
}

function parseWav(buf: Buffer): WavData {
  if (buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("not a RIFF/WAVE file");
  }
  let channels: number | undefined;
  let sampleRate: number | undefined;
  let bitsPerSample: number | undefined;
  let dataOffset: number | undefined;
  let dataSize: number | undefined;
  let off = 12;
  while (off <= buf.length - 8) {
    const id = buf.toString("ascii", off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    const body = off + 8;
    if (id === "fmt ") {
      const audioFormat = buf.readUInt16LE(body);
      if (audioFormat !== 1) throw new Error(`unsupported WAV format ${audioFormat}; expected PCM`);
      channels = buf.readUInt16LE(body + 2);
      sampleRate = buf.readUInt32LE(body + 4);
      bitsPerSample = buf.readUInt16LE(body + 14);
    } else if (id === "data") {
      dataOffset = body;
      dataSize = size;
    }
    off = body + size + (size & 1);
  }
  if (channels === undefined || sampleRate === undefined || bitsPerSample === undefined ||
    dataOffset === undefined || dataSize === undefined) {
    throw new Error("WAV missing fmt or data chunk");
  }
  const sampleCount = Math.floor(dataSize / (bitsPerSample / 8));
  const samples = new Float32Array(sampleCount);
  if (bitsPerSample === 16) {
    for (let i = 0; i < sampleCount; i++) samples[i] = buf.readInt16LE(dataOffset + i * 2) / 32768;
  } else {
    throw new Error(`unsupported bits per sample: ${bitsPerSample}`);
  }
  return { sampleRate, channels, samples };
}

function soundCyclesToSamples(cycles: bigint, sampleRate: number): number {
  const cycleNumber = Number(cycles);
  if (!Number.isSafeInteger(cycleNumber)) {
    throw new Error(`sound cycle count too large: ${cycles.toString()}`);
  }
  return Math.round(cycleNumber * Math.max(1, sampleRate) / SOUND_CMD_TAPE_CPU_HZ);
}

function samplesToSoundCycles(samples: number, sampleRate: number): bigint {
  const cycles = Math.ceil(Math.max(0, Math.trunc(samples)) * SOUND_CMD_TAPE_CPU_HZ / Math.max(1, sampleRate));
  if (!Number.isSafeInteger(cycles)) throw new Error(`sample count too large: ${samples}`);
  return BigInt(cycles);
}

function samplesToCyclesAtRate(samples: number, sampleRate: number, cycleRate: number): bigint {
  if (cycleRate === SOUND_CMD_TAPE_CPU_HZ) return samplesToSoundCycles(samples, sampleRate);
  const cycles = Math.ceil(Math.max(0, Math.trunc(samples)) * Math.max(1, cycleRate) / Math.max(1, sampleRate));
  if (!Number.isSafeInteger(cycles)) throw new Error(`sample count too large: ${samples}`);
  return BigInt(cycles);
}

function soundCycleToSampleIndex(cycle: bigint, sampleRate: number): bigint {
  const cycleNumber = Number(cycle);
  if (!Number.isSafeInteger(cycleNumber)) {
    throw new Error(`sound cycle count too large: ${cycle.toString()}`);
  }
  return BigInt(Math.floor(cycleNumber * Math.max(1, sampleRate) / SOUND_CMD_TAPE_CPU_HZ));
}

function firstSoundCycleForSample(sampleIndex: number, sampleRate: number): number {
  return Math.ceil(sampleIndex * SOUND_CMD_TAPE_CPU_HZ / Math.max(1, sampleRate));
}

function boundaryDelayToNextSample(
  cycle: number,
  thresholdCycles: number,
  sampleRate: number,
): number {
  if (thresholdCycles <= 0) return 0;
  const rate = Math.max(1, sampleRate);
  const sample = Math.floor(cycle * rate / SOUND_CMD_TAPE_CPU_HZ);
  const nextStart = firstSoundCycleForSample(sample + 1, rate);
  const offsetToEnd = nextStart - cycle - 1;
  return offsetToEnd >= 0 && offsetToEnd < thresholdCycles ? nextStart - cycle : 0;
}

function soundCycleToSampleIndexAtRate(cycle: bigint, sampleRate: number, cycleRate: number): bigint {
  if (cycleRate === SOUND_CMD_TAPE_CPU_HZ) return soundCycleToSampleIndex(cycle, sampleRate);
  const cycleNumber = Number(cycle);
  if (!Number.isSafeInteger(cycleNumber)) {
    throw new Error(`sound cycle count too large: ${cycle.toString()}`);
  }
  return BigInt(Math.floor(cycleNumber * Math.max(1, sampleRate) / Math.max(1, cycleRate)));
}

function attosecondsToSampleIndex(secs: number, attos: string, sampleRate: number): bigint {
  const seconds = Math.trunc(secs) + Number(BigInt(attos)) / 1_000_000_000_000_000_000;
  const sample = Math.floor(seconds * Math.max(1, sampleRate));
  if (!Number.isSafeInteger(sample)) throw new Error(`sample index too large for ${secs}:${attos}`);
  return BigInt(sample);
}

function attosecondsToCyclesAtRate(secs: number, attos: string, cycleRate: number): bigint {
  if (cycleRate === SOUND_CMD_TAPE_CPU_HZ) {
    const cycle = cmdTapeAbsoluteCycle({ secs, attos });
    if (cycle === undefined) throw new Error(`cycle index missing for ${secs}:${attos}`);
    return cycle;
  }
  const totalAttos =
    (BigInt(Math.max(0, Math.trunc(secs))) * 1_000_000_000_000_000_000n) + BigInt(attos);
  return totalAttos * BigInt(Math.max(1, Math.trunc(cycleRate))) / 1_000_000_000_000_000_000n;
}

function soundCyclesToCyclesAtRate(cycles: bigint, cycleRate: number): bigint {
  if (cycleRate === SOUND_CMD_TAPE_CPU_HZ) return cycles;
  const cycleNumber = Number(cycles);
  if (!Number.isSafeInteger(cycleNumber)) {
    throw new Error(`sound cycle count too large: ${cycles.toString()}`);
  }
  const scaled = Math.floor(cycleNumber * Math.max(1, cycleRate) / SOUND_CMD_TAPE_CPU_HZ);
  if (!Number.isSafeInteger(scaled)) throw new Error(`scaled cycle count too large: ${cycles.toString()}`);
  return BigInt(scaled);
}

function firstResetFrameCommand(
  cmds: ReadonlyArray<{ frame: number; byte: number; secs?: number; attos?: string; cycleInFrame?: number }> | undefined,
  resetFrame: number | undefined,
): { frame: number; byte: number; secs?: number; attos?: string; cycleInFrame?: number } | undefined {
  if (cmds === undefined || resetFrame === undefined) return undefined;
  return cmds.find((c) => c.frame === resetFrame);
}

function cmdTapeYmStreamSampleOffset(
  cmd: { frame: number; secs?: number; attos?: string; cycleInFrame?: number },
  sampleRate: number,
): number {
  const offset = cmd.secs !== undefined && cmd.attos !== undefined
    ? attosecondsToSampleIndex(cmd.secs, cmd.attos, sampleRate)
    : BigInt(soundCyclesToSamples(
        (BigInt(Math.max(0, Math.trunc(cmd.frame))) * BigInt(SOUND_CYCLES_PER_FRAME)) +
          BigInt(cmdTapeCycleInFrame(cmd) ?? 0),
        sampleRate,
      ));
  const asNumber = Number(offset);
  if (!Number.isSafeInteger(asNumber)) {
    throw new Error(`YM stream sample offset too large: ${offset.toString()}`);
  }
  return asNumber;
}

function directChipWriteOrigins(
  cmdTapePath: string,
  ymSampleRate: number,
  originMode: Args["directChipWriteOrigin"],
  cycleRate = SOUND_CMD_TAPE_CPU_HZ,
): { cycleOrigin: bigint; ymSampleOrigin: bigint } {
  if (originMode === "absolute") return { cycleOrigin: 0n, ymSampleOrigin: 0n };
  const tapeJson = JSON.parse(readFileSync(cmdTapePath, "utf8")) as CmdTape;
  const tape = loadCmdTape(tapeJson);
  const firstCmd = firstResetFrameCommand(tapeJson.cmds, tape.resetFrame);
  if (firstCmd === undefined) {
    throw new Error("--direct-chip-write-origin cmd-tape-replay requires a cmd tape with a reset-frame command");
  }
  const cycleOrigin = firstCmd.secs !== undefined && firstCmd.attos !== undefined
    ? attosecondsToCyclesAtRate(firstCmd.secs, firstCmd.attos, cycleRate)
    : soundCyclesToCyclesAtRate(
        (BigInt(Math.max(0, Math.trunc(firstCmd.frame))) * BigInt(SOUND_CYCLES_PER_FRAME)) +
          BigInt(cmdTapeCycleInFrame(firstCmd) ?? 0),
        cycleRate,
      );
  const ymSampleOrigin = firstCmd.secs !== undefined && firstCmd.attos !== undefined
    ? attosecondsToSampleIndex(firstCmd.secs, firstCmd.attos, ymSampleRate)
    : cycleRate === SOUND_CMD_TAPE_CPU_HZ
      ? BigInt(soundCyclesToSamples(cycleOrigin, ymSampleRate))
      : soundCycleToSampleIndexAtRate(cycleOrigin, ymSampleRate, cycleRate);
  return { cycleOrigin, ymSampleOrigin };
}

function leftChannel(wav: WavData): Float32Array {
  if (wav.channels === 1) return wav.samples;
  const frames = Math.floor(wav.samples.length / wav.channels);
  const out = new Float32Array(frames);
  for (let i = 0; i < frames; i++) out[i] = wav.samples[i * wav.channels] ?? 0;
  return out;
}

function parseNumberLike(value: unknown, field: string): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    const parsed = trimmed.startsWith("0x") || trimmed.startsWith("0X")
      ? Number.parseInt(trimmed, 16)
      : Number(trimmed);
    if (Number.isFinite(parsed)) return parsed;
  }
  throw new Error(`invalid ${field}: ${String(value)}`);
}

function commandReplayEventFromSubmit(
  tapeJson: CmdTape,
  event: Parameters<NonNullable<ReplayTickOptions["onCommandSubmit"]>>[0],
): CommandReplayEvent {
  const rawCmd = tapeJson.cmds[event.sourceIndex] as { readonly soundPc?: unknown } | undefined;
  const soundPc = rawCmd?.soundPc === undefined
    ? undefined
    : parseNumberLike(rawCmd.soundPc, `cmds[${event.sourceIndex}].soundPc`) & 0xffff;
  return {
    sourceIndex: event.sourceIndex,
    frame: event.frame,
    byte: event.byte & 0xff,
    soundPc,
    cycleInFrame: event.cycleInFrame,
    replayCycle: event.cycle,
    actualCycle: event.actualCycle,
    actualCycleInFrame: event.actualCycleInFrame,
    commandNmiDelayInstructions: event.commandNmiDelayInstructions,
    ...(event.expectedInstPc === undefined ? {} : { expectedInstPc: event.expectedInstPc }),
    ...(event.expectedInstOpcode === undefined ? {} : { expectedInstOpcode: event.expectedInstOpcode }),
    ...(event.expectedInstDeltaCycles === undefined ? {} : { expectedInstDeltaCycles: event.expectedInstDeltaCycles }),
    ...(event.expectedNextChronoInstPc === undefined ? {} : { expectedNextChronoInstPc: event.expectedNextChronoInstPc }),
    ...(event.expectedNextChronoInstOpcode === undefined
      ? {}
      : { expectedNextChronoInstOpcode: event.expectedNextChronoInstOpcode }),
    ...(event.expectedNextChronoInstDeltaCycles === undefined
      ? {}
      : { expectedNextChronoInstDeltaCycles: event.expectedNextChronoInstDeltaCycles }),
    ...(event.actualSoundPc === undefined ? {} : { actualSoundPc: event.actualSoundPc }),
    ...(event.actualSoundOpcode === undefined ? {} : { actualSoundOpcode: event.actualSoundOpcode }),
    ...(event.preAdvance === undefined ? {} : { preAdvance: event.preAdvance }),
    ...(event.lastStep === undefined ? {} : { lastStep: event.lastStep }),
    ...(event.preemptedChipWrite === undefined ? {} : { preemptedChipWrite: event.preemptedChipWrite }),
  };
}

function isNumberLike(value: unknown): boolean {
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (trimmed === "") return false;
  const parsed = trimmed.startsWith("0x") || trimmed.startsWith("0X")
    ? Number.parseInt(trimmed, 16)
    : Number(trimmed);
  return Number.isFinite(parsed);
}

function summarizeCmdTapeCommandContext(tape: CmdTape): CommandContextSummary {
  let withCycleTiming = 0;
  let withSoundPc = 0;
  for (const cmd of tape.cmds) {
    if (cmd.cycleInFrame !== undefined || (cmd.secs !== undefined && cmd.attos !== undefined)) withCycleTiming++;
    const commandContext = cmd as CmdTape["cmds"][number] & { readonly soundPc?: unknown };
    if (isNumberLike(commandContext.soundPc)) withSoundPc++;
  }
  return { total: tape.cmds.length, withCycleTiming, withSoundPc };
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

function commandEdgeEventRulesToJson(
  rules: readonly CommandEdgeEventRule[],
): Array<Record<string, number | string | string[] | undefined>> {
  return rules.map((rule) => ({
    delayCycles: rule.delayCycles,
    anchor: rule.anchor,
    afterCycles: rule.afterCycles,
    beforeCycles: rule.beforeCycles,
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
  }));
}

function fmtCommandEdgeEventRules(rules: readonly CommandEdgeEventRule[]): string {
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
      `${rule.delayCycles}:${rule.relation}:${rule.afterCycles ?? 0}:${rule.beforeCycles ?? 0}:` +
      `${commandPcFilter}:${rule.anchor}:${writePcs}:${writeRegs}:${writeVals}:${writeRegVals}`;
  }).join(";");
}

function sortedRecord(record: Record<string, number>): Record<string, number> {
  return Object.fromEntries(Object.entries(record).sort((a, b) => a[0].localeCompare(b[0])));
}

function hexByte(value: number): string {
  return `0x${(value & 0xff).toString(16).padStart(2, "0")}`;
}

function hexWord(value: number): string {
  return `0x${(value & 0xffff).toString(16).padStart(4, "0")}`;
}

function commandReplayExpectedPc(event: CommandReplayEvent): number | undefined {
  return event.expectedInstPc ?? event.soundPc;
}

function commandReplayPcRelation(event: CommandReplayEvent): string {
  const actual = event.actualSoundPc;
  if (actual === undefined) return "missing-actual";
  if (event.soundPc !== undefined && actual === event.soundPc) return "soundPc";
  if (event.expectedInstPc !== undefined && actual === event.expectedInstPc) return "expectedInstPc";
  if (event.expectedNextChronoInstPc !== undefined && actual === event.expectedNextChronoInstPc) {
    return "expectedNextChronoInstPc";
  }
  if (event.lastStep?.nextPc !== undefined && actual === event.lastStep.nextPc) return "lastStepNextPc";
  if (event.preAdvance?.pc !== undefined && actual === event.preAdvance.pc) return "preAdvancePc";
  return "other";
}

function commandReplaySample(event: CommandReplayEvent): unknown {
  const expectedPc = commandReplayExpectedPc(event);
  return {
    sourceIndex: event.sourceIndex,
    frame: event.frame,
    byte: hexByte(event.byte),
    cycleInFrame: event.cycleInFrame,
    actualCycleInFrame: event.actualCycleInFrame,
    actualCycleDelta: event.actualCycle - event.replayCycle,
    pcRelation: commandReplayPcRelation(event),
    ...(expectedPc === undefined ? {} : { expectedPc: hexWord(expectedPc) }),
    ...(event.soundPc === undefined ? {} : { soundPc: hexWord(event.soundPc) }),
    ...(event.expectedInstPc === undefined ? {} : { expectedInstPc: hexWord(event.expectedInstPc) }),
    ...(event.expectedInstOpcode === undefined ? {} : { expectedInstOpcode: hexByte(event.expectedInstOpcode) }),
    ...(event.expectedNextChronoInstPc === undefined
      ? {}
      : { expectedNextChronoInstPc: hexWord(event.expectedNextChronoInstPc) }),
    ...(event.actualSoundPc === undefined ? {} : { actualSoundPc: hexWord(event.actualSoundPc) }),
    ...(event.actualSoundOpcode === undefined ? {} : { actualSoundOpcode: hexByte(event.actualSoundOpcode) }),
    ...(event.preAdvance === undefined
      ? {}
      : {
          preAdvance: {
            cpuCycleInFrame: event.preAdvance.cpuCycleInFrame,
            deltaToTarget: event.preAdvance.deltaToTarget,
            inReset: event.preAdvance.inReset,
            ...(event.preAdvance.pc === undefined ? {} : { pc: hexWord(event.preAdvance.pc) }),
            ...(event.preAdvance.opcode === undefined ? {} : { opcode: hexByte(event.preAdvance.opcode) }),
            ...(event.preAdvance.currentChipIoStore === undefined
              ? {}
              : {
                  currentChipIoStore: {
                    pc: hexWord(event.preAdvance.currentChipIoStore.pc),
                    opcode: hexByte(event.preAdvance.currentChipIoStore.opcode),
                    address: hexWord(event.preAdvance.currentChipIoStore.address),
                    writeCycleOffset: event.preAdvance.currentChipIoStore.writeCycleOffset,
                    stepCycles: event.preAdvance.currentChipIoStore.stepCycles,
                  },
                }),
          },
        }),
    ...(event.lastStep === undefined
      ? {}
      : {
          lastStep: {
            startCycleInFrame: event.lastStep.startCycleInFrame,
            endCycleInFrame: event.lastStep.endCycleInFrame,
            targetOffset: event.lastStep.targetOffset,
            actualEndDelta: event.lastStep.actualEndDelta,
            ...(event.lastStep.pc === undefined ? {} : { pc: hexWord(event.lastStep.pc) }),
            ...(event.lastStep.opcode === undefined ? {} : { opcode: hexByte(event.lastStep.opcode) }),
            nextPc: hexWord(event.lastStep.nextPc),
            ...(event.lastStep.nextOpcode === undefined ? {} : { nextOpcode: hexByte(event.lastStep.nextOpcode) }),
            interruptService: event.lastStep.interruptService,
          },
        }),
  };
}

function commandReplayEventsSummary(
  events: readonly CommandReplayEvent[] | undefined,
): CommandReplayEventSummary | undefined {
  if (events === undefined) return undefined;
  const summary: {
    count: number;
    withExpectedPc: number;
    withActualPc: number;
    pcExact: number;
    pcMismatch: number;
    actualMatchesSoundPc: number;
    actualMatchesExpectedInstPc: number;
    actualMatchesExpectedNextChronoInstPc: number;
    opcodeExact: number;
    opcodeMismatch: number;
    negativePreAdvanceCount: number;
    byPcRelation: Record<string, number>;
    byCommandByte: Record<string, number>;
    byCycleInFrame: Record<string, number>;
    byActualCycleDelta: Record<string, number>;
    byPreAdvanceDeltaToTarget: Record<string, number>;
    byCommandNmiDelay: Record<string, number>;
    firstPcMismatch?: unknown;
    firstNegativePreAdvance?: unknown;
    mismatchSamples: unknown[];
    negativePreAdvanceSamples: unknown[];
  } = {
    count: events.length,
    withExpectedPc: 0,
    withActualPc: 0,
    pcExact: 0,
    pcMismatch: 0,
    actualMatchesSoundPc: 0,
    actualMatchesExpectedInstPc: 0,
    actualMatchesExpectedNextChronoInstPc: 0,
    opcodeExact: 0,
    opcodeMismatch: 0,
    negativePreAdvanceCount: 0,
    byPcRelation: {},
    byCommandByte: {},
    byCycleInFrame: {},
    byActualCycleDelta: {},
    byPreAdvanceDeltaToTarget: {},
    byCommandNmiDelay: {},
    mismatchSamples: [],
    negativePreAdvanceSamples: [],
  };

  for (const event of events) {
    const expectedPc = commandReplayExpectedPc(event);
    const actualPc = event.actualSoundPc;
    const pcRelation = commandReplayPcRelation(event);
    incRecord(summary.byPcRelation, pcRelation);
    incRecord(summary.byCommandByte, hexByte(event.byte));
    incRecord(summary.byCycleInFrame, String(event.cycleInFrame));
    incRecord(summary.byActualCycleDelta, String(event.actualCycle - event.replayCycle));
    incRecord(summary.byCommandNmiDelay, String(event.commandNmiDelayInstructions));
    if (event.preAdvance !== undefined) {
      incRecord(summary.byPreAdvanceDeltaToTarget, String(event.preAdvance.deltaToTarget));
      if (event.preAdvance.deltaToTarget < 0) {
        summary.negativePreAdvanceCount++;
        if (summary.firstNegativePreAdvance === undefined) {
          summary.firstNegativePreAdvance = commandReplaySample(event);
        }
        if (summary.negativePreAdvanceSamples.length < 16) {
          summary.negativePreAdvanceSamples.push(commandReplaySample(event));
        }
      }
    }
    if (expectedPc !== undefined) summary.withExpectedPc++;
    if (actualPc !== undefined) summary.withActualPc++;
    if (actualPc !== undefined && event.soundPc !== undefined && actualPc === event.soundPc) {
      summary.actualMatchesSoundPc++;
    }
    if (actualPc !== undefined && event.expectedInstPc !== undefined && actualPc === event.expectedInstPc) {
      summary.actualMatchesExpectedInstPc++;
    }
    if (
      actualPc !== undefined &&
      event.expectedNextChronoInstPc !== undefined &&
      actualPc === event.expectedNextChronoInstPc
    ) {
      summary.actualMatchesExpectedNextChronoInstPc++;
    }
    if (expectedPc !== undefined && actualPc !== undefined && expectedPc === actualPc) {
      summary.pcExact++;
    } else if (expectedPc !== undefined) {
      summary.pcMismatch++;
      if (summary.firstPcMismatch === undefined) summary.firstPcMismatch = commandReplaySample(event);
      if (summary.mismatchSamples.length < 32) summary.mismatchSamples.push(commandReplaySample(event));
    }
    if (event.expectedInstOpcode !== undefined && event.actualSoundOpcode !== undefined) {
      if (event.expectedInstOpcode === event.actualSoundOpcode) summary.opcodeExact++;
      else summary.opcodeMismatch++;
    }
  }

  return summary;
}

function createYmCommandEdgeRuntimeAdjustSummary(
  rules: readonly CommandEdgeEventRule[],
): YmCommandEdgeRuntimeAdjustSummary | undefined {
  if (rules.length === 0) return undefined;
  return {
    applied: 0,
    rules: commandEdgeEventRulesToJson(rules),
    byRelation: {},
    byCommandByte: {},
    byCommandSoundPc: {},
    byTargetAnchor: {},
    byRuleIndex: {},
    byWriteFrame: {},
    byWritePc: {},
    byWriteOpcode: {},
    byWriteReg: {},
    byRawDeltaFromCommand: {},
    byFirstReadDeltaFromCommand: {},
    byRawDeltaFromFirstRead: {},
    byTargetDeltaFromFirstRead: {},
    byDeltaCycles: {},
    samples: [],
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

function lowerBoundCommandReads(events: readonly SoundCommandReadEvent[], target: number): number {
  let lo = 0;
  let hi = events.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if ((events[mid]?.cycle ?? 0) < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function incRecord(record: Record<string, number>, key: string): void {
  record[key] = (record[key] ?? 0) + 1;
}

function firstCommandReadAfter(
  event: CommandReplayEvent,
  rawWriteCycle: number,
  commandReads: readonly SoundCommandReadEvent[],
): CommandReadContext | undefined {
  let idx = lowerBoundCommandReads(commandReads, event.replayCycle);
  while (idx < commandReads.length) {
    const read = commandReads[idx]!;
    idx++;
    if ((read.val & 0xff) !== event.byte) continue;
    return {
      frame: read.frame,
      cycleInFrame: read.cycleInFrame,
      replayCycle: read.cycle,
      pc: read.pc,
      val: read.val & 0xff,
      readCycleOffset: read.readCycleOffset,
      deltaFromCommand: read.cycle - event.replayCycle,
      deltaFromTsWrite: read.cycle - rawWriteCycle,
    };
  }
  return undefined;
}

function ymCommandEdgeRuntimeOffsetFor(
  ctx: {
    readonly frame: number | undefined;
    readonly pc: number;
    readonly opcode: number | undefined;
    readonly reg: number;
    readonly val: number;
    readonly rawCycle: number;
    readonly rawCycleInFrame: number | undefined;
    readonly rawWriteCycleOffset: number;
    readonly currentEventCycleOffset: number;
  },
  commandEvents: readonly CommandReplayEvent[],
  commandReads: readonly SoundCommandReadEvent[],
  rules: readonly CommandEdgeEventRule[],
  summary: YmCommandEdgeRuntimeAdjustSummary | undefined,
): number | undefined {
  if (rules.length === 0 || commandEvents.length === 0) return undefined;
  const rawStepStart = ctx.rawCycle - ctx.rawWriteCycleOffset;
  const maxBeforeCycles = Math.max(...rules.map((rule) => rule.beforeCycles ?? 0));
  const afterLimit = ctx.rawCycle + Math.max(...rules.map((rule) => rule.afterCycles ?? 0));
  let idx = lowerBoundCommandEvents(commandEvents, rawStepStart - maxBeforeCycles);
  while (idx < commandEvents.length) {
    const event = commandEvents[idx]!;
    if (event.replayCycle > afterLimit) return undefined;
    idx++;
    const relation: Exclude<CommandEdgeEventRelation, "both"> = event.replayCycle < rawStepStart
      ? "raw-before"
      : event.replayCycle <= ctx.rawCycle
        ? "raw-crossing"
        : "raw-after";
    const rawDeltaFromCommand = ctx.rawCycle - event.replayCycle;
    for (const [ruleIndex, rule] of rules.entries()) {
      if (event.replayCycle < rawStepStart - (rule.beforeCycles ?? 0)) continue;
      if (event.replayCycle > ctx.rawCycle + (rule.afterCycles ?? 0)) continue;
      if (rule.bytes !== undefined && !rule.bytes.includes(event.byte)) continue;
      if (rule.pcs !== undefined && !rule.pcs.includes(ctx.pc & 0xffff)) continue;
      if (rule.writeRegs !== undefined && !rule.writeRegs.includes(ctx.reg & 0xff)) continue;
      if (rule.writeVals !== undefined && !rule.writeVals.includes(ctx.val & 0xff)) continue;
      if (rule.writeRegVals !== undefined &&
        !rule.writeRegVals.some((pair) => pair.reg === (ctx.reg & 0xff) && pair.val === (ctx.val & 0xff))) {
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
      const firstTsCommandRead = firstCommandReadAfter(event, ctx.rawCycle, commandReads);
      if (rule.anchor === "first-read" && firstTsCommandRead === undefined) continue;
      const targetAnchorCycle = rule.anchor === "first-read"
        ? firstTsCommandRead!.replayCycle
        : rule.anchor === "current-event"
          ? ctx.rawCycle + ctx.currentEventCycleOffset
          : event.replayCycle;
      const targetReplayCycle = targetAnchorCycle + rule.delayCycles;
      const deltaCycles = targetReplayCycle - ctx.rawCycle;
      const extraCycles = deltaCycles - ctx.currentEventCycleOffset;
      if (summary !== undefined) {
        summary.applied++;
        incRecord(summary.byRelation, relation);
        incRecord(summary.byCommandByte, hexByte(event.byte));
        incRecord(
          summary.byCommandSoundPc,
          event.soundPc === undefined ? "?" : hexWord(event.soundPc),
        );
        incRecord(summary.byTargetAnchor, rule.anchor);
        incRecord(summary.byRuleIndex, String(ruleIndex));
        incRecord(summary.byWriteFrame, ctx.frame === undefined ? "?" : String(ctx.frame));
        incRecord(summary.byWritePc, hexWord(ctx.pc));
        incRecord(summary.byWriteOpcode, ctx.opcode === undefined ? "?" : hexByte(ctx.opcode));
        incRecord(summary.byWriteReg, hexByte(ctx.reg));
        incRecord(summary.byRawDeltaFromCommand, String(rawDeltaFromCommand));
        if (firstTsCommandRead !== undefined) {
          incRecord(summary.byFirstReadDeltaFromCommand, String(firstTsCommandRead.deltaFromCommand));
          incRecord(summary.byRawDeltaFromFirstRead, String(ctx.rawCycle - firstTsCommandRead.replayCycle));
          incRecord(summary.byTargetDeltaFromFirstRead, String(targetReplayCycle - firstTsCommandRead.replayCycle));
        }
        incRecord(summary.byDeltaCycles, String(deltaCycles));
        if (summary.samples.length < 128) {
          summary.samples.push({
            ruleIndex,
            sourceIndex: event.sourceIndex,
            frame: event.frame,
            byte: hexByte(event.byte),
            soundPc: event.soundPc === undefined ? undefined : hexWord(event.soundPc),
            relation,
            rawDeltaFromCommand,
            targetAnchor: rule.anchor,
            targetDelayCycles: rule.delayCycles,
            deltaCycles,
            extraCycles,
            writeFrame: ctx.frame,
            writePc: hexWord(ctx.pc),
            writeOpcode: ctx.opcode === undefined ? undefined : hexByte(ctx.opcode),
            writeReg: hexByte(ctx.reg),
            writeVal: hexByte(ctx.val),
            firstReadFrame: firstTsCommandRead?.frame,
            firstReadCycleInFrame: firstTsCommandRead?.cycleInFrame,
            firstReadPc: firstTsCommandRead === undefined
              ? undefined
              : hexWord(firstTsCommandRead.pc),
            firstReadDeltaFromCommand: firstTsCommandRead?.deltaFromCommand,
            rawDeltaFromFirstRead: firstTsCommandRead === undefined
              ? undefined
              : ctx.rawCycle - firstTsCommandRead.replayCycle,
            targetDeltaFromFirstRead: firstTsCommandRead === undefined
              ? undefined
              : targetReplayCycle - firstTsCommandRead.replayCycle,
          });
        }
      }
      return extraCycles;
    }
  }
  return undefined;
}

function finalizeYmCommandEdgeRuntimeAdjustSummary(
  summary: YmCommandEdgeRuntimeAdjustSummary | undefined,
): YmCommandEdgeRuntimeAdjustSummary | undefined {
  if (summary === undefined) return undefined;
  return {
    ...summary,
    byRelation: sortedRecord(summary.byRelation),
    byCommandByte: sortedRecord(summary.byCommandByte),
    byCommandSoundPc: sortedRecord(summary.byCommandSoundPc),
    byTargetAnchor: sortedRecord(summary.byTargetAnchor),
    byRuleIndex: sortedRecord(summary.byRuleIndex),
    byWriteFrame: sortedRecord(summary.byWriteFrame),
    byWritePc: sortedRecord(summary.byWritePc),
    byWriteOpcode: sortedRecord(summary.byWriteOpcode),
    byWriteReg: sortedRecord(summary.byWriteReg),
    byRawDeltaFromCommand: sortedRecord(summary.byRawDeltaFromCommand),
    byFirstReadDeltaFromCommand: sortedRecord(summary.byFirstReadDeltaFromCommand),
    byRawDeltaFromFirstRead: sortedRecord(summary.byRawDeltaFromFirstRead),
    byTargetDeltaFromFirstRead: sortedRecord(summary.byTargetDeltaFromFirstRead),
    byDeltaCycles: sortedRecord(summary.byDeltaCycles),
  };
}

function loadMameChipWrites(
  path: string,
  kind: "ym" | "pokey",
  sampleRate?: number,
  origins: { cycleOrigin: bigint; ymSampleOrigin: bigint } = { cycleOrigin: 0n, ymSampleOrigin: 0n },
  sampleTiming: Args["directChipWriteSampleTiming"] = "attos",
  cycleTiming: Args["directChipWriteCycleTiming"] = "attos",
  ymWriteSampleOffset = 0,
  ymWriteSampleOffsetRegs: ReadonlyMap<number, number> = new Map(),
  ymWriteSampleOffsetMatches: readonly DirectYmWriteSampleOffsetMatch[] = [],
  cycleRate = SOUND_CMD_TAPE_CPU_HZ,
): MameChipWrite[] {
  const raw = JSON.parse(readFileSync(path, "utf8")) as {
    writes?: unknown[];
  };
  const writes = raw.writes;
  if (!Array.isArray(writes)) throw new Error(`MAME ${kind} write log missing writes[]: ${path}`);
  return writes.map((entry, sourceIndex) => {
    const e = entry as {
      readonly secs?: number;
      readonly attos?: string | number;
      readonly frame?: unknown;
      readonly cycle?: unknown;
      readonly cycleInFrame?: unknown;
      readonly pc?: unknown;
      readonly reg?: unknown;
      readonly val?: unknown;
      readonly data?: unknown;
    };
    if (e.secs === undefined || e.attos === undefined) {
      throw new Error(`MAME ${kind} write #${sourceIndex} missing secs/attos`);
    }
    const frame = e.frame !== undefined
      ? parseNumberLike(e.frame, `${kind}.writes[${sourceIndex}].frame`)
      : undefined;
    const cycleInFrame = e.cycleInFrame !== undefined
      ? parseNumberLike(e.cycleInFrame, `${kind}.writes[${sourceIndex}].cycleInFrame`)
      : undefined;
    const loggedAbsoluteCycle = e.cycle !== undefined
      ? BigInt(parseNumberLike(e.cycle, `${kind}.writes[${sourceIndex}].cycle`))
      : frame !== undefined && cycleInFrame !== undefined
        ? (BigInt(Math.max(0, Math.trunc(frame))) * BigInt(SOUND_CYCLES_PER_FRAME)) +
          BigInt(Math.max(0, Math.trunc(cycleInFrame)))
        : undefined;
    if (cycleTiming === "log" && loggedAbsoluteCycle === undefined) {
      throw new Error(
        `MAME ${kind} write #${sourceIndex} missing cycle/cycleInFrame for --direct-chip-write-cycle-timing log`,
      );
    }
    const attosAbsoluteCycle = attosecondsToCyclesAtRate(e.secs, String(e.attos), cycleRate);
    const absoluteCycle = cycleTiming === "log" && loggedAbsoluteCycle !== undefined
      ? loggedAbsoluteCycle
      : attosAbsoluteCycle;
    const cycle = absoluteCycle <= origins.cycleOrigin ? 0n : absoluteCycle - origins.cycleOrigin;
    const absoluteSampleIndex = sampleRate === undefined
      ? undefined
      : sampleTiming === "cycle"
        ? soundCycleToSampleIndexAtRate(absoluteCycle, sampleRate, cycleRate)
        : attosecondsToSampleIndex(e.secs, String(e.attos), sampleRate);
    const unshiftedSampleIndex = absoluteSampleIndex === undefined
      ? undefined
      : absoluteSampleIndex <= origins.ymSampleOrigin
        ? 0n
        : absoluteSampleIndex - origins.ymSampleOrigin;
    const reg = parseNumberLike(e.reg, `${kind}.writes[${sourceIndex}].reg`) & 0xff;
    const val = parseNumberLike(kind === "ym" ? e.val : (e.data ?? e.val), `${kind}.writes[${sourceIndex}].val`) & 0xff;
    const pc = e.pc !== undefined
      ? parseNumberLike(e.pc, `${kind}.writes[${sourceIndex}].pc`) & 0xffff
      : undefined;
    const matchedSampleOffset = kind === "ym"
      ? ymWriteSampleOffsetMatches.reduce((sum, match) => {
          if (match.frame !== undefined && match.frame !== frame) return sum;
          if (match.pc !== undefined && match.pc !== pc) return sum;
          if (match.reg !== undefined && match.reg !== reg) return sum;
          if (match.val !== undefined && match.val !== val) return sum;
          return sum + match.deltaSamples;
        }, 0)
      : 0;
    const writeSampleOffset = kind === "ym"
      ? ymWriteSampleOffset + (ymWriteSampleOffsetRegs.get(reg) ?? 0) + matchedSampleOffset
      : 0;
    const sampleIndex = unshiftedSampleIndex === undefined || writeSampleOffset === 0
      ? unshiftedSampleIndex
      : (() => {
          const shifted = unshiftedSampleIndex + BigInt(writeSampleOffset);
          return shifted < 0n ? 0n : shifted;
        })();
    return {
      kind,
      cycle,
      ...(sampleIndex === undefined ? {} : { sampleIndex }),
      ...(frame === undefined ? {} : { frame }),
      ...(cycleInFrame === undefined ? {} : { cycleInFrame }),
      ...(pc === undefined ? {} : { pc }),
      reg,
      val,
      sourceIndex,
    };
  });
}

function bigintCycleToSafeNumber(value: bigint, label: string): number {
  const numeric = Number(value);
  if (!Number.isSafeInteger(numeric)) {
    throw new Error(`${label} too large for diagnostic report: ${value.toString()}`);
  }
  return numeric;
}

function chipPokeyWriteTraceEvent(index: number, event: ChipWriteEvent): PokeyWriteTraceEvent | undefined {
  if (event.kind !== "pokey") return undefined;
  return {
    index,
    source: "sound-chip",
    cycle: event.cycle,
    applyCycle: event.pokeyApplyCycle ?? event.cycle,
    applyDelayCycles: event.pokeyApplyDelayCycles ?? 0,
    ...(event.frame === undefined ? {} : { frame: event.frame }),
    ...(event.cycleInFrame === undefined ? {} : { cycleInFrame: event.cycleInFrame }),
    ...(event.rawCycle === undefined ? {} : { rawCycle: event.rawCycle }),
    ...(event.rawCycleInFrame === undefined ? {} : { rawCycleInFrame: event.rawCycleInFrame }),
    pc: hexWord(event.pc),
    reg: hexByte(event.reg),
    val: hexByte(event.val),
  };
}

function appendPokeyWriteTraceEvents(
  out: PokeyWriteTraceEvent[],
  events: readonly ChipWriteEvent[],
): void {
  for (const event of events) {
    const summary = chipPokeyWriteTraceEvent(out.length, event);
    if (summary !== undefined) out.push(summary);
  }
}

function mamePokeyWriteTraceEvent(
  index: number,
  write: MameChipWrite,
  renderCycle: bigint,
): PokeyWriteTraceEvent | undefined {
  if (write.kind !== "pokey") return undefined;
  const cycle = bigintCycleToSafeNumber(write.cycle, "MAME POKEY write cycle");
  const applyCycle = bigintCycleToSafeNumber(renderCycle, "MAME POKEY render cycle");
  return {
    index,
    source: "mame-chip-writes",
    sourceIndex: write.sourceIndex,
    cycle,
    applyCycle,
    applyDelayCycles: applyCycle - cycle,
    ...(write.frame === undefined ? {} : { frame: write.frame }),
    ...(write.cycleInFrame === undefined ? {} : { cycleInFrame: write.cycleInFrame }),
    ...(write.pc === undefined ? {} : { pc: hexWord(write.pc) }),
    reg: hexByte(write.reg),
    val: hexByte(write.val),
  };
}

function pokeyDeviceWriteSnapshotTraceEvents(
  snapshots: readonly PokeyWriteSnapshot[] | undefined,
  source: PokeyDeviceWriteSnapshotTraceEvent["source"],
): PokeyDeviceWriteSnapshotTraceEvent[] | undefined {
  if (snapshots === undefined) return undefined;
  return snapshots.map((snapshot, index) => ({ index, source, ...snapshot }));
}

function pokeyWriteSnapshotPolyState(
  state: PokeyWriteSnapshot["before"],
): readonly number[] {
  return [state.poly4, state.poly5, state.poly9, state.poly17];
}

function pokeyWriteSnapshotPolyDelta(
  ts: PokeyWriteSnapshot["before"],
  reference: PokeyWriteSnapshot["before"],
): readonly number[] {
  const tsPoly = pokeyWriteSnapshotPolyState(ts);
  const referencePoly = pokeyWriteSnapshotPolyState(reference);
  return tsPoly.map((value, index) => value - (referencePoly[index] ?? 0));
}

function pokeyWriteSnapshotPolyModuloDelta(
  ts: PokeyWriteSnapshot["before"],
  reference: PokeyWriteSnapshot["before"],
): readonly number[] {
  const tsPoly = pokeyWriteSnapshotPolyState(ts);
  const referencePoly = pokeyWriteSnapshotPolyState(reference);
  return tsPoly.map((value, index) =>
    positiveModulo(value - (referencePoly[index] ?? 0), POKEY_POLY_PERIODS[index] ?? 1));
}

function pokeyPolyClockDelta28Ticks(polyClockDelta: number | undefined): number | undefined {
  return polyClockDelta === undefined || polyClockDelta % 28 !== 0
    ? undefined
    : polyClockDelta / 28;
}

function pokeyDeviceWriteSnapshotSummary(
  snapshot: PokeyDeviceWriteSnapshotTraceEvent,
): PokeyDeviceWriteSnapshotSummary {
  return {
    cycle: snapshot.cycle,
    nativeSample: snapshot.nativeSample,
    cycleInNativeSample: snapshot.cycleInNativeSample,
    reg: hexByte(snapshot.reg),
    val: hexByte(snapshot.val),
    beforeAudctl: hexByte(snapshot.before.audctl),
    beforeSkctl: hexByte(snapshot.before.skctl),
    beforeClockCnt28: snapshot.before.clockCnt28,
    beforeClockCnt114: snapshot.before.clockCnt114,
    beforeCounters: snapshot.before.counters,
    beforePoly: pokeyWriteSnapshotPolyState(snapshot.before),
    afterAudctl: hexByte(snapshot.after.audctl),
    afterSkctl: hexByte(snapshot.after.skctl),
    afterClockCnt28: snapshot.after.clockCnt28,
    afterClockCnt114: snapshot.after.clockCnt114,
    afterCounters: snapshot.after.counters,
    afterPoly: pokeyWriteSnapshotPolyState(snapshot.after),
  };
}

function pokeyDeviceWriteSnapshotMismatch(
  index: number,
  ts: PokeyDeviceWriteSnapshotTraceEvent,
  reference: PokeyDeviceWriteSnapshotTraceEvent,
  tsWrites: readonly PokeyWriteTraceEvent[] | undefined,
  referenceWrites: readonly PokeyWriteTraceEvent[] | undefined,
): PokeyDeviceWriteSnapshotMismatch {
  const beforePolyModuloDelta = pokeyWriteSnapshotPolyModuloDelta(ts.before, reference.before);
  const beforePolyClockDelta = inferPokeyPolyClockDelta(beforePolyModuloDelta);
  return {
    index,
    cycleDelta: reference.cycle - ts.cycle,
    beforeClockCnt28Delta: ts.before.clockCnt28 - reference.before.clockCnt28,
    beforeClockCnt114Delta: ts.before.clockCnt114 - reference.before.clockCnt114,
    beforeCounterDelta: ts.before.counters.map((value, ch) => value - (reference.before.counters[ch] ?? 0)),
    beforePolyDelta: pokeyWriteSnapshotPolyDelta(ts.before, reference.before),
    beforePolyModuloDelta,
    beforePolyClockDelta,
    beforePolyClockDelta28Ticks: pokeyPolyClockDelta28Ticks(beforePolyClockDelta),
    ts: pokeyDeviceWriteSnapshotSummary(ts),
    reference: pokeyDeviceWriteSnapshotSummary(reference),
    ...(tsWrites?.[index] === undefined ? {} : { tsWrite: tsWrites[index] }),
    ...(referenceWrites?.[index] === undefined ? {} : { referenceWrite: referenceWrites[index] }),
  };
}

function pokeyDeviceWriteSnapshotRelativeMismatch(
  index: number,
  originIndex: number,
  ts: PokeyDeviceWriteSnapshotTraceEvent,
  reference: PokeyDeviceWriteSnapshotTraceEvent,
  tsOrigin: PokeyDeviceWriteSnapshotTraceEvent,
  referenceOrigin: PokeyDeviceWriteSnapshotTraceEvent,
  tsWrites: readonly PokeyWriteTraceEvent[] | undefined,
  referenceWrites: readonly PokeyWriteTraceEvent[] | undefined,
): PokeyDeviceWriteSnapshotRelativeMismatch {
  const mismatch = pokeyDeviceWriteSnapshotMismatch(index, ts, reference, tsWrites, referenceWrites);
  const tsRelativeCycle = ts.cycle - tsOrigin.cycle;
  const referenceRelativeCycle = reference.cycle - referenceOrigin.cycle;
  return {
    ...mismatch,
    originIndex,
    tsRelativeCycle,
    referenceRelativeCycle,
    relativeCycleDelta: referenceRelativeCycle - tsRelativeCycle,
    beforePolyClockPlusRelativeCycleDelta: mismatch.beforePolyClockDelta === undefined
      ? undefined
      : mismatch.beforePolyClockDelta + (referenceRelativeCycle - tsRelativeCycle),
  };
}

function firstPokeySkctlEnableSnapshotIndex(
  tsSnapshots: readonly PokeyDeviceWriteSnapshotTraceEvent[],
  referenceSnapshots: readonly PokeyDeviceWriteSnapshotTraceEvent[],
  compared: number,
): number | undefined {
  for (let i = 0; i < compared; i++) {
    const ts = tsSnapshots[i]!;
    const reference = referenceSnapshots[i]!;
    if (
      ts.reg === 0x0f &&
      reference.reg === 0x0f &&
      (ts.val & 0x03) === 0x03 &&
      (reference.val & 0x03) === 0x03
    ) {
      return i;
    }
  }
  return undefined;
}

function comparePokeyDeviceWriteSnapshotRelativeOrigin(
  name: PokeyDeviceWriteSnapshotRelativeOriginComparison["name"],
  originIndex: number,
  tsSnapshots: readonly PokeyDeviceWriteSnapshotTraceEvent[],
  referenceSnapshots: readonly PokeyDeviceWriteSnapshotTraceEvent[],
  compared: number,
  tsWrites: readonly PokeyWriteTraceEvent[] | undefined,
  referenceWrites: readonly PokeyWriteTraceEvent[] | undefined,
): PokeyDeviceWriteSnapshotRelativeOriginComparison {
  const tsOrigin = tsSnapshots[originIndex]!;
  const referenceOrigin = referenceSnapshots[originIndex]!;
  const originCycleDelta = referenceOrigin.cycle - tsOrigin.cycle;
  const relativeCycleDeltaHistogram: Record<string, number> = {};
  const beforeClockCnt114DeltaHistogram: Record<string, number> = {};
  const beforePolyModuloDeltaHistogram: Record<string, number> = {};
  const beforePolyClockDeltaHistogram: Record<string, number> = {};
  const beforePolyClockDelta28TicksHistogram: Record<string, number> = {};
  const beforePolyClockPlusRelativeCycleDeltaHistogram: Record<string, number> = {};
  const firstBeforePolyClockPlusRelativeCycleDeltaMismatches: PokeyDeviceWriteSnapshotRelativeMismatch[] = [];
  const seenPolyClockPlusRelativeCycleDeltaMismatches = new Set<number>();
  let firstNonzeroRelativeCycleDelta: PokeyDeviceWriteSnapshotRelativeMismatch | undefined;
  let firstBeforeClockCnt28Mismatch: PokeyDeviceWriteSnapshotRelativeMismatch | undefined;
  let firstBeforeClockCnt114Mismatch: PokeyDeviceWriteSnapshotRelativeMismatch | undefined;
  let firstBeforeCounterMismatch: PokeyDeviceWriteSnapshotRelativeMismatch | undefined;
  let firstBeforePolyMismatch: PokeyDeviceWriteSnapshotRelativeMismatch | undefined;

  for (let i = 0; i < compared; i++) {
    const ts = tsSnapshots[i]!;
    const reference = referenceSnapshots[i]!;
    const relativeCycleDelta = (reference.cycle - ts.cycle) - originCycleDelta;
    incrementHistogram(relativeCycleDeltaHistogram, relativeCycleDelta);
    const clockCnt28Delta = ts.before.clockCnt28 - reference.before.clockCnt28;
    const clockCnt114Delta = ts.before.clockCnt114 - reference.before.clockCnt114;
    incrementHistogram(beforeClockCnt114DeltaHistogram, clockCnt114Delta);
    const counterDelta = ts.before.counters.map((value, ch) => value - (reference.before.counters[ch] ?? 0));
    const polyDelta = pokeyWriteSnapshotPolyDelta(ts.before, reference.before);
    const polyModuloDelta = pokeyWriteSnapshotPolyModuloDelta(ts.before, reference.before);
    incrementHistogram(beforePolyModuloDeltaHistogram, polyModuloDelta.join(","));
    const polyClockDelta = inferPokeyPolyClockDelta(polyModuloDelta);
    const polyClockDelta28Ticks = pokeyPolyClockDelta28Ticks(polyClockDelta);
    if (polyClockDelta !== undefined) incrementHistogram(beforePolyClockDeltaHistogram, polyClockDelta);
    if (polyClockDelta28Ticks !== undefined) {
      incrementHistogram(beforePolyClockDelta28TicksHistogram, polyClockDelta28Ticks);
    }
    if (polyClockDelta !== undefined) {
      const phaseResidual = polyClockDelta + relativeCycleDelta;
      incrementHistogram(beforePolyClockPlusRelativeCycleDeltaHistogram, phaseResidual);
      if (
        phaseResidual !== 0 &&
        !seenPolyClockPlusRelativeCycleDeltaMismatches.has(phaseResidual) &&
        firstBeforePolyClockPlusRelativeCycleDeltaMismatches.length < 8
      ) {
        seenPolyClockPlusRelativeCycleDeltaMismatches.add(phaseResidual);
        firstBeforePolyClockPlusRelativeCycleDeltaMismatches.push(
          pokeyDeviceWriteSnapshotRelativeMismatch(
            i,
            originIndex,
            ts,
            reference,
            tsOrigin,
            referenceOrigin,
            tsWrites,
            referenceWrites,
          ),
        );
      }
    }
    if (firstNonzeroRelativeCycleDelta === undefined && relativeCycleDelta !== 0) {
      firstNonzeroRelativeCycleDelta = pokeyDeviceWriteSnapshotRelativeMismatch(
        i,
        originIndex,
        ts,
        reference,
        tsOrigin,
        referenceOrigin,
        tsWrites,
        referenceWrites,
      );
    }
    if (firstBeforeClockCnt28Mismatch === undefined && clockCnt28Delta !== 0) {
      firstBeforeClockCnt28Mismatch = pokeyDeviceWriteSnapshotRelativeMismatch(
        i,
        originIndex,
        ts,
        reference,
        tsOrigin,
        referenceOrigin,
        tsWrites,
        referenceWrites,
      );
    }
    if (firstBeforeClockCnt114Mismatch === undefined && clockCnt114Delta !== 0) {
      firstBeforeClockCnt114Mismatch = pokeyDeviceWriteSnapshotRelativeMismatch(
        i,
        originIndex,
        ts,
        reference,
        tsOrigin,
        referenceOrigin,
        tsWrites,
        referenceWrites,
      );
    }
    if (firstBeforeCounterMismatch === undefined && counterDelta.some((delta) => delta !== 0)) {
      firstBeforeCounterMismatch = pokeyDeviceWriteSnapshotRelativeMismatch(
        i,
        originIndex,
        ts,
        reference,
        tsOrigin,
        referenceOrigin,
        tsWrites,
        referenceWrites,
      );
    }
    if (firstBeforePolyMismatch === undefined && polyDelta.some((delta) => delta !== 0)) {
      firstBeforePolyMismatch = pokeyDeviceWriteSnapshotRelativeMismatch(
        i,
        originIndex,
        ts,
        reference,
        tsOrigin,
        referenceOrigin,
        tsWrites,
        referenceWrites,
      );
    }
  }

  return {
    name,
    originIndex,
    tsOriginCycle: tsOrigin.cycle,
    referenceOriginCycle: referenceOrigin.cycle,
    originCycleDelta,
    relativeCycleDeltaHistogram,
    beforeClockCnt114DeltaHistogram,
    beforePolyModuloDeltaHistogram,
    beforePolyClockDeltaHistogram,
    beforePolyClockDelta28TicksHistogram,
    beforePolyClockPlusRelativeCycleDeltaHistogram,
    firstBeforePolyClockPlusRelativeCycleDeltaMismatches,
    ...(firstNonzeroRelativeCycleDelta === undefined ? {} : { firstNonzeroRelativeCycleDelta }),
    ...(firstBeforeClockCnt28Mismatch === undefined ? {} : { firstBeforeClockCnt28Mismatch }),
    ...(firstBeforeClockCnt114Mismatch === undefined ? {} : { firstBeforeClockCnt114Mismatch }),
    ...(firstBeforeCounterMismatch === undefined ? {} : { firstBeforeCounterMismatch }),
    ...(firstBeforePolyMismatch === undefined ? {} : { firstBeforePolyMismatch }),
  };
}

function comparePokeyDeviceWriteSnapshots(
  tsSnapshots: readonly PokeyDeviceWriteSnapshotTraceEvent[] | undefined,
  referenceSnapshots: readonly PokeyDeviceWriteSnapshotTraceEvent[] | undefined,
  tsWrites: readonly PokeyWriteTraceEvent[] | undefined,
  referenceWrites: readonly PokeyWriteTraceEvent[] | undefined,
): PokeyDeviceWriteSnapshotComparison | undefined {
  if (tsSnapshots === undefined || referenceSnapshots === undefined) return undefined;
  const compared = Math.min(tsSnapshots.length, referenceSnapshots.length);
  const cycleDeltaHistogram: Record<string, number> = {};
  const beforeClockCnt28DeltaHistogram: Record<string, number> = {};
  const beforeClockCnt114DeltaHistogram: Record<string, number> = {};
  const beforeCounterDeltaHistograms = Array.from({ length: 4 }, () => ({} as Record<string, number>));
  const beforePolyDeltaHistograms = Array.from({ length: 4 }, () => ({} as Record<string, number>));
  const beforePolyModuloDeltaHistogram: Record<string, number> = {};
  const beforePolyClockDeltaHistogram: Record<string, number> = {};
  const beforePolyClockDelta28TicksHistogram: Record<string, number> = {};
  let firstRegValMismatch: PokeyDeviceWriteSnapshotMismatch | undefined;
  let firstBeforeClockCnt28Mismatch: PokeyDeviceWriteSnapshotMismatch | undefined;
  let firstBeforeClockCnt114Mismatch: PokeyDeviceWriteSnapshotMismatch | undefined;
  let firstBeforeCounterMismatch: PokeyDeviceWriteSnapshotMismatch | undefined;
  let firstBeforePolyMismatch: PokeyDeviceWriteSnapshotMismatch | undefined;
  for (let i = 0; i < compared; i++) {
    const ts = tsSnapshots[i]!;
    const reference = referenceSnapshots[i]!;
    incrementHistogram(cycleDeltaHistogram, reference.cycle - ts.cycle);
    const clockCnt28Delta = ts.before.clockCnt28 - reference.before.clockCnt28;
    incrementHistogram(beforeClockCnt28DeltaHistogram, clockCnt28Delta);
    const clockCnt114Delta = ts.before.clockCnt114 - reference.before.clockCnt114;
    incrementHistogram(beforeClockCnt114DeltaHistogram, clockCnt114Delta);
    const counterDelta = ts.before.counters.map((value, ch) => value - (reference.before.counters[ch] ?? 0));
    for (let ch = 0; ch < beforeCounterDeltaHistograms.length; ch++) {
      incrementHistogram(beforeCounterDeltaHistograms[ch]!, counterDelta[ch] ?? 0);
    }
    const polyDelta = pokeyWriteSnapshotPolyDelta(ts.before, reference.before);
    const polyModuloDelta = pokeyWriteSnapshotPolyModuloDelta(ts.before, reference.before);
    for (let index = 0; index < beforePolyDeltaHistograms.length; index++) {
      incrementHistogram(beforePolyDeltaHistograms[index]!, polyDelta[index] ?? 0);
    }
    incrementHistogram(beforePolyModuloDeltaHistogram, polyModuloDelta.join(","));
    const polyClockDelta = inferPokeyPolyClockDelta(polyModuloDelta);
    const polyClockDelta28Ticks = pokeyPolyClockDelta28Ticks(polyClockDelta);
    if (polyClockDelta !== undefined) incrementHistogram(beforePolyClockDeltaHistogram, polyClockDelta);
    if (polyClockDelta28Ticks !== undefined) {
      incrementHistogram(beforePolyClockDelta28TicksHistogram, polyClockDelta28Ticks);
    }
    if (
      firstRegValMismatch === undefined &&
      (ts.reg !== reference.reg || ts.val !== reference.val)
    ) {
      firstRegValMismatch =
        pokeyDeviceWriteSnapshotMismatch(i, ts, reference, tsWrites, referenceWrites);
    }
    if (firstBeforeClockCnt28Mismatch === undefined && clockCnt28Delta !== 0) {
      firstBeforeClockCnt28Mismatch =
        pokeyDeviceWriteSnapshotMismatch(i, ts, reference, tsWrites, referenceWrites);
    }
    if (firstBeforeClockCnt114Mismatch === undefined && clockCnt114Delta !== 0) {
      firstBeforeClockCnt114Mismatch =
        pokeyDeviceWriteSnapshotMismatch(i, ts, reference, tsWrites, referenceWrites);
    }
    if (firstBeforeCounterMismatch === undefined && counterDelta.some((delta) => delta !== 0)) {
      firstBeforeCounterMismatch =
        pokeyDeviceWriteSnapshotMismatch(i, ts, reference, tsWrites, referenceWrites);
    }
    if (firstBeforePolyMismatch === undefined && polyDelta.some((delta) => delta !== 0)) {
      firstBeforePolyMismatch =
        pokeyDeviceWriteSnapshotMismatch(i, ts, reference, tsWrites, referenceWrites);
    }
  }
  const relativeOrigins: PokeyDeviceWriteSnapshotRelativeOriginComparison[] = [];
  if (compared > 0) {
    relativeOrigins.push(comparePokeyDeviceWriteSnapshotRelativeOrigin(
      "first-write",
      0,
      tsSnapshots,
      referenceSnapshots,
      compared,
      tsWrites,
      referenceWrites,
    ));
    const firstSkctlEnableIndex = firstPokeySkctlEnableSnapshotIndex(tsSnapshots, referenceSnapshots, compared);
    if (firstSkctlEnableIndex !== undefined && firstSkctlEnableIndex !== 0) {
      relativeOrigins.push(comparePokeyDeviceWriteSnapshotRelativeOrigin(
        "first-skctl-enable",
        firstSkctlEnableIndex,
        tsSnapshots,
        referenceSnapshots,
        compared,
        tsWrites,
        referenceWrites,
      ));
    }
  }
  return {
    compared,
    tsCount: tsSnapshots.length,
    referenceCount: referenceSnapshots.length,
    countDelta: tsSnapshots.length - referenceSnapshots.length,
    cycleDeltaHistogram,
    beforeClockCnt28DeltaHistogram,
    beforeClockCnt114DeltaHistogram,
    beforeCounterDeltaHistograms,
    beforePolyDeltaHistograms,
    beforePolyModuloDeltaHistogram,
    beforePolyClockDeltaHistogram,
    beforePolyClockDelta28TicksHistogram,
    relativeOrigins,
    ...(firstRegValMismatch === undefined ? {} : { firstRegValMismatch }),
    ...(firstBeforeClockCnt28Mismatch === undefined ? {} : { firstBeforeClockCnt28Mismatch }),
    ...(firstBeforeClockCnt114Mismatch === undefined ? {} : { firstBeforeClockCnt114Mismatch }),
    ...(firstBeforeCounterMismatch === undefined ? {} : { firstBeforeCounterMismatch }),
    ...(firstBeforePolyMismatch === undefined ? {} : { firstBeforePolyMismatch }),
  };
}

function appendYmSamples(
  ymLeft: number[],
  ymChannelLeft: number[][] | undefined,
  ym: ReturnType<typeof createYM2151>,
): void {
  const samples = drainDirectYmSamples(ym);
  for (let i = 0; i < samples.length; i += 2) ymLeft.push(samples[i] ?? 0);
  const channelSamples = drainDirectYmDiagnosticChannelSamples(ym);
  if (ymChannelLeft !== undefined && channelSamples !== undefined) {
    for (let ch = 0; ch < ymChannelLeft.length; ch++) {
      const samplesForChannel = channelSamples[ch] ?? [];
      for (let i = 0; i < samplesForChannel.length; i += 2) ymChannelLeft[ch]!.push(samplesForChannel[i] ?? 0);
    }
  }
}

function appendDirectYmDiagnosticSamples(
  ymChannelLeft: number[][] | undefined,
  ym: ReturnType<typeof createYM2151>,
): void {
  if (ymChannelLeft === undefined) return;
  const channelSamples = drainDirectYmDiagnosticChannelSamples(ym);
  if (channelSamples === undefined) return;
  for (let ch = 0; ch < ymChannelLeft.length; ch++) {
    const samples = channelSamples[ch] ?? [];
    for (let i = 0; i < samples.length; i += 2) ymChannelLeft[ch]!.push(samples[i] ?? 0);
  }
}

function generateDirectYmStreamTo(
  ymLeft: number[],
  ymChannelLeft: number[][] | undefined,
  ym: ReturnType<typeof createYM2151>,
  sampleIndex: bigint,
): void {
  const target = Number(sampleIndex);
  if (!Number.isSafeInteger(target)) throw new Error(`YM stream sample index too large: ${sampleIndex.toString()}`);
  while (ymLeft.length <= target) {
    tickEnvClock();
    const [left] = sampleDirectYm(ym);
    ymLeft.push(left);
  }
  appendDirectYmDiagnosticSamples(ymChannelLeft, ym);
}

function appendPokeySamples(
  pokeySamples: number[],
  pokeyChannelSamples: number[][] | undefined,
  pokey: ReturnType<typeof createPOKEY>,
): void {
  const samples = drainDirectPokeySamples(pokey);
  for (const sample of samples) pokeySamples.push(sample);
  const channelSamples = drainDirectPokeyDiagnosticChannelSamples(pokey);
  if (pokeyChannelSamples !== undefined && channelSamples !== undefined) {
    for (let ch = 0; ch < pokeyChannelSamples.length; ch++) {
      const samplesForChannel = channelSamples[ch] ?? [];
      for (const sample of samplesForChannel) pokeyChannelSamples[ch]!.push(sample);
    }
  }
}

interface NativeStreamingResampler {
  push(samples: readonly number[] | Float32Array): Float32Array;
  finish(): Float32Array;
}

function appendFloat32(out: number[], samples: Float32Array): void {
  for (const sample of samples) out.push(sample);
}

function createProbeStreamingResampler(
  nativeRate: number,
  dstRate: number,
  resampler: Args["resampler"],
  offset: number,
): NativeStreamingResampler {
  return resampler === "mame-lofi"
    ? new StreamingMameLofiResampler(nativeRate, dstRate, offset)
    : new StreamingLinearResampler(nativeRate, dstRate, offset);
}

function resamplePcm(
  samples: readonly number[] | Float32Array,
  nativeRate: number,
  dstRate: number,
  resampler: Args["resampler"],
  offset: number,
  outSamples: number | undefined,
): Float32Array {
  return resampler === "mame-lofi"
    ? resampleMameLofi(samples, nativeRate, dstRate, outSamples, offset)
    : resampleLinear(samples, nativeRate, dstRate, offset);
}

function shiftSamples(samples: Float32Array, offset: number): Float32Array {
  if (offset === 0) return samples;
  if (offset > 0) {
    const out = new Float32Array(samples.length + offset);
    out.set(samples, offset);
    return out;
  }
  const skip = Math.min(samples.length, -offset);
  return samples.subarray(skip);
}

function mixPreparedComponents(
  ymResampled: Float32Array,
  pokeyResampled: Float32Array,
  ymChannels: Float32Array[] | undefined,
  pokeyChannels: Float32Array[] | undefined,
  paddedSamples: ComponentPaddedSamples,
  outputSampleOffsets: { ym: number; pokey: number },
): Pick<RenderedTsAudio, "mix" | "ym" | "pokey" | "ymChannels" | "pokeyChannels"> {
  const componentPaddedSamples: ComponentPaddedSamples = {
    ym: Math.max(0, Math.trunc(paddedSamples.ym)),
    pokey: Math.max(0, Math.trunc(paddedSamples.pokey)),
  };
  const ymShifted = shiftSamples(ymResampled, outputSampleOffsets.ym);
  const pokeyShifted = shiftSamples(pokeyResampled, outputSampleOffsets.pokey);
  const ymChannelsShifted = ymChannels?.map((samples) => shiftSamples(samples, outputSampleOffsets.ym));
  const pokeyChannelsShifted = pokeyChannels?.map((samples) => shiftSamples(samples, outputSampleOffsets.pokey));
  const totalLength = Math.max(
    componentPaddedSamples.ym + ymShifted.length,
    componentPaddedSamples.pokey + pokeyShifted.length,
  );
  const mix = new Float32Array(totalLength);
  const ymPadded = new Float32Array(totalLength);
  const pokeyPadded = new Float32Array(totalLength);
  if (componentPaddedSamples.ym < totalLength) {
    ymPadded.set(ymShifted.subarray(0, totalLength - componentPaddedSamples.ym), componentPaddedSamples.ym);
  }
  if (componentPaddedSamples.pokey < totalLength) {
    pokeyPadded.set(
      pokeyShifted.subarray(0, totalLength - componentPaddedSamples.pokey),
      componentPaddedSamples.pokey,
    );
  }
  for (let i = 0; i < totalLength; i++) {
    mix[i] = (ymPadded[i] ?? 0) + (pokeyPadded[i] ?? 0);
  }
  const padChannel = (ch: Float32Array, component: keyof ComponentPaddedSamples): Float32Array => {
    const pad = componentPaddedSamples[component];
    const padded = new Float32Array(totalLength);
    if (pad < totalLength) padded.set(ch.subarray(0, totalLength - pad), pad);
    return padded;
  };
  return {
    mix,
    ym: ymPadded,
    pokey: pokeyPadded,
    ymChannels: ymChannels === undefined
      ? undefined
      : ymChannelsShifted!.map((ch) => padChannel(ch, "ym")),
    pokeyChannels: pokeyChannels === undefined
      ? undefined
      : pokeyChannelsShifted!.map((ch) => padChannel(ch, "pokey")),
  };
}

function mixResampledComponents(
  ymLeft: readonly number[],
  pokey: readonly number[],
  ymChannelLeft: readonly (readonly number[])[] | undefined,
  pokeyChannelSamples: readonly (readonly number[])[] | undefined,
  dstRate: number,
  paddedSamples: ComponentPaddedSamples,
  ymNativeSampleRate: number,
  pokeyNativeSampleRate: number,
  resampleOffsets: { ym: number; pokey: number },
  resamplers: { ym: Args["ymResampler"]; pokey: Args["pokeyResampler"] },
  outputSampleOffsets: { ym: number; pokey: number },
  targetSamples: number | undefined,
): Pick<RenderedTsAudio, "mix" | "ym" | "pokey" | "ymChannels" | "pokeyChannels"> {
  const componentPaddedSamples: ComponentPaddedSamples = {
    ym: Math.max(0, Math.trunc(paddedSamples.ym)),
    pokey: Math.max(0, Math.trunc(paddedSamples.pokey)),
  };
  const componentTargetSamples = (component: keyof ComponentPaddedSamples): number | undefined =>
    targetSamples === undefined
      ? undefined
      : Math.max(0, targetSamples - componentPaddedSamples[component]);
  const ymTargetSamples = componentTargetSamples("ym");
  const pokeyTargetSamples = componentTargetSamples("pokey");
  const ymResampled = resamplePcm(ymLeft, ymNativeSampleRate, dstRate, resamplers.ym, resampleOffsets.ym, ymTargetSamples);
  const ymChannels = ymChannelLeft?.map((samples) =>
    resamplePcm(samples, ymNativeSampleRate, dstRate, resamplers.ym, resampleOffsets.ym, ymTargetSamples));
  const pokeyResampled =
    resamplePcm(pokey, pokeyNativeSampleRate, dstRate, resamplers.pokey, resampleOffsets.pokey, pokeyTargetSamples);
  const pokeyChannels = pokeyChannelSamples?.map((samples) =>
    resamplePcm(samples, pokeyNativeSampleRate, dstRate, resamplers.pokey, resampleOffsets.pokey, pokeyTargetSamples));
  return mixPreparedComponents(
    ymResampled,
    pokeyResampled,
    ymChannels,
    pokeyChannels,
    componentPaddedSamples,
    outputSampleOffsets,
  );
}

function tickDirectDevices(
  ym: ReturnType<typeof createYM2151> | undefined,
  pokey: ReturnType<typeof createPOKEY> | undefined,
  cycles: bigint,
): void {
  if (cycles <= 0n) return;
  const n = Number(cycles);
  if (!Number.isSafeInteger(n)) throw new Error(`direct chip-write render delta too large: ${cycles.toString()} cycles`);
  if (ym !== undefined) tickDirectYmCycles(ym, n);
  if (pokey !== undefined) tickDirectPokeyCycles(pokey, n);
}

function pokeyRawChannels(raw: number): readonly number[] {
  return [0, 1, 2, 3].map((ch) => (raw >>> (ch * 4)) & 0x0f);
}

function pokeyPolyState(event: PokeyRawTraceEvent): readonly number[] {
  return [event.poly4, event.poly5, event.poly9, event.poly17];
}

const POKEY_POLY_PERIODS = [0x0f, 0x1f, 0x1ff, 0x1ffff] as const;

function pokeyPolyModuloDelta(tsEvent: PokeyRawTraceEvent, refEvent: PokeyRawTraceEvent): readonly number[] {
  const tsPoly = pokeyPolyState(tsEvent);
  const refPoly = pokeyPolyState(refEvent);
  return tsPoly.map((value, index) =>
    positiveModulo(value - (refPoly[index] ?? 0), POKEY_POLY_PERIODS[index] ?? 1));
}

function centeredModuloDelta(value: number, period: number): number {
  const mod = positiveModulo(value, period);
  return mod > period / 2 ? mod - period : mod;
}

function inferPokeyPolyClockDelta(polyModuloDelta: readonly number[]): number | undefined {
  const period = POKEY_POLY_PERIODS[POKEY_POLY_PERIODS.length - 1]!;
  const candidate = centeredModuloDelta(polyModuloDelta[polyModuloDelta.length - 1] ?? 0, period);
  return POKEY_POLY_PERIODS.every((polyPeriod, index) =>
    positiveModulo(candidate, polyPeriod) === (polyModuloDelta[index] ?? 0))
    ? candidate
    : undefined;
}

function pokeyChangedChannels(event: PokeyRawTraceEvent): readonly number[] {
  const changed: number[] = [];
  const n = Math.max(event.prevChannels.length, event.channels.length);
  for (let ch = 0; ch < n; ch++) {
    if ((event.prevChannels[ch] ?? 0) !== (event.channels[ch] ?? 0)) changed.push(ch);
  }
  return changed;
}

function formatChangedChannelDeltas(channels: readonly number[], deltas: readonly number[]): string {
  return channels.length === 0
    ? "none"
    : channels.map((ch) => `${ch}:${deltas[ch] ?? 0}`).join(",");
}

interface MameLofiRawProjection {
  readonly sourceDivide: number;
  readonly sourceBlockOffset: number;
  readonly s1OutputSample: number;
  readonly s2OutputSample: number;
  readonly s3OutputSample: number;
}

function mameLofiOutputForSourceAdvance(advance: number, phase: number, step: number): number {
  if (advance <= 0) return 0;
  return Math.max(0, Math.ceil(((advance * 0x1000000) - phase) / step));
}

function mameLofiRawProjection(
  nativeSample: number,
  srcRate: number,
  dstRate: number,
  offsetSamples: number,
  paddedSamples: number,
  outputSampleOffset: number,
): MameLofiRawProjection {
  const fs = Math.max(1, Math.trunc(srcRate));
  const ft = Math.max(1, Math.trunc(dstRate));
  const sourceDivide = fs <= ft ? 1 : 1 + Math.floor(fs / ft);
  const step = Math.floor((fs * 0x1000000) / ft / sourceDivide);
  let ssamp = Math.trunc(offsetSamples * 4096);
  let ssample = ssamp >> 12;
  let phase = ssamp & 0xfff;
  if (sourceDivide > 1) {
    const delta = ssample % sourceDivide;
    phase = Math.floor((phase | (delta << 12)) / sourceDivide);
    ssample -= delta;
  }
  const initialBlockSample = ssample - (4 * sourceDivide);
  const sourceBlock = Math.floor((nativeSample - initialBlockSample) / sourceDivide);
  const sourceBlockOffset = nativeSample - (initialBlockSample + (sourceBlock * sourceDivide));
  const outputBase = paddedSamples + outputSampleOffset;
  const phase24 = phase << 12;
  return {
    sourceDivide,
    sourceBlockOffset,
    s1OutputSample:
      mameLofiOutputForSourceAdvance(sourceBlock - 1, phase24, step) + outputBase,
    s2OutputSample:
      mameLofiOutputForSourceAdvance(sourceBlock - 2, phase24, step) + outputBase,
    s3OutputSample:
      mameLofiOutputForSourceAdvance(sourceBlock - 3, phase24, step) + outputBase,
  };
}

function buildPokeyRawTrace(
  transitions: readonly PokeyRawTransition[] | undefined,
  centerSample: number | undefined,
  radius: number,
  dstRate: number,
  pokeyNativeSampleRate: number,
  paddedSamples: number,
  resampleOffset: number,
  outputSampleOffset: number,
): PokeyRawTrace | undefined {
  if (transitions === undefined || radius <= 0 || centerSample === undefined) return undefined;
  const center = Math.max(0, Math.trunc(centerSample));
  const windowRadius = Math.max(0, Math.trunc(radius));
  const events = transitions
    .map((transition): PokeyRawTraceEvent => {
      const projectedOutputSample =
        (((transition.nativeSample - resampleOffset) * dstRate) / pokeyNativeSampleRate) +
        paddedSamples + outputSampleOffset;
      const projectedOutputFloor = Math.floor(projectedOutputSample);
      const lofiProjection = mameLofiRawProjection(
        transition.nativeSample,
        pokeyNativeSampleRate,
        dstRate,
        resampleOffset,
        paddedSamples,
        outputSampleOffset,
      );
      return {
        cycle: transition.cycle,
        nativeSample: transition.nativeSample,
        cycleInNativeSample: transition.cycleInNativeSample,
        projectedOutputSample,
        projectedOutputFraction: projectedOutputSample - projectedOutputFloor,
        estimatedOutputSampleFloor: projectedOutputFloor,
        estimatedOutputSample: Math.round(projectedOutputSample),
        estimatedOutputSampleCeil: Math.ceil(projectedOutputSample),
        lofiSourceDivide: lofiProjection.sourceDivide,
        lofiSourceBlockOffset: lofiProjection.sourceBlockOffset,
        lofiS1OutputSample: lofiProjection.s1OutputSample,
        lofiS2OutputSample: lofiProjection.s2OutputSample,
        lofiS3OutputSample: lofiProjection.s3OutputSample,
        prevRaw: `0x${transition.prevRaw.toString(16).padStart(4, "0")}`,
        raw: `0x${transition.raw.toString(16).padStart(4, "0")}`,
        prevChannels: pokeyRawChannels(transition.prevRaw),
        channels: pokeyRawChannels(transition.raw),
        audf: transition.audf,
        audc: transition.audc,
        audctl: transition.audctl,
        skctl: transition.skctl,
        counters: transition.counters,
        borrowCnt: transition.borrowCnt,
        outputs: transition.outputs,
        filterSamples: transition.filterSamples,
        poly4: transition.poly4,
        poly5: transition.poly5,
        poly9: transition.poly9,
        poly17: transition.poly17,
        clockCnt28: transition.clockCnt28,
        clockCnt114: transition.clockCnt114,
      };
    })
    .filter((event) => Math.abs(event.estimatedOutputSample - center) <= windowRadius);
  return {
    centerSample: center,
    radius: windowRadius,
    totalTransitions: transitions.length,
    matchedTransitions: events.length,
    events,
  };
}

function incrementHistogram(hist: Record<string, number>, key: number | string): void {
  const k = String(key);
  hist[k] = (hist[k] ?? 0) + 1;
}

function positiveModulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}

function incrementModuloDeltaHistogram(
  hist: Record<string, number>,
  tsValue: number,
  referenceValue: number,
  divisor: number,
): void {
  incrementHistogram(hist, positiveModulo(tsValue, divisor) - positiveModulo(referenceValue, divisor));
}

function incrementNestedHistogram(
  hist: Record<string, Record<string, number>>,
  outerKey: number,
  innerKey: number,
): void {
  const outer = String(outerKey);
  const inner = String(innerKey);
  const bucket = hist[outer] ?? {};
  bucket[inner] = (bucket[inner] ?? 0) + 1;
  hist[outer] = bucket;
}

function numberArrayDelta(ts: readonly number[], reference: readonly number[]): number[] {
  return ts.map((value, index) => value - (reference[index] ?? 0));
}

function numberArrayEqual(ts: readonly number[], reference: readonly number[]): boolean {
  return ts.length === reference.length && ts.every((value, index) => value === reference[index]);
}

function fieldMismatch(fields: string[], counts: Record<string, number>, field: string, matches: boolean): void {
  if (matches) return;
  fields.push(field);
  incrementHistogram(counts, field);
}

function numericHistogramMode(hist: Record<string, number>): number | undefined {
  let bestKey: number | undefined;
  let bestCount = -1;
  for (const [key, count] of Object.entries(hist)) {
    const numericKey = Number(key);
    if (!Number.isFinite(numericKey)) continue;
    if (count > bestCount || (count === bestCount && bestKey !== undefined && numericKey < bestKey)) {
      bestKey = numericKey;
      bestCount = count;
    }
  }
  return bestKey;
}

function formatNumericHistogram(hist: Record<string, number>): string {
  return Object.entries(hist)
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([delta, count]) => `${delta}:${count}`)
    .join(",");
}

function formatTopHistogram(hist: Record<string, number>, limit: number): string {
  return Object.entries(hist)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([key, count]) => `${key}:${count}`)
    .join(",");
}

function comparePokeyRawTraceDominantStateAlignment(
  ts: PokeyRawTrace,
  reference: PokeyRawTrace,
  outputSampleDelta: number,
): PokeyRawTraceDominantStateAlignment {
  let compared = 0;
  let exactStateMatches = 0;
  const fieldMismatchCounts: Record<string, number> = {};
  const eventIndexDeltaHistogram: Record<string, number> = {};
  const counterDeltaHistogram: Record<string, number> = {};
  const borrowCntDeltaHistogram: Record<string, number> = {};
  const outputDeltaHistogram: Record<string, number> = {};
  const filterSampleDeltaHistogram: Record<string, number> = {};
  const polyDeltaHistogram: Record<string, number> = {};
  const polyModuloDeltaHistogram: Record<string, number> = {};
  const polyClockDeltaHistogram: Record<string, number> = {};
  const polyClockDelta28TicksHistogram: Record<string, number> = {};
  const changedChannelHistogram: Record<string, number> = {};
  const changedChannelCounterDeltaHistogram: Record<string, number> = {};
  const changedChannelBorrowCntDeltaHistogram: Record<string, number> = {};
  const changedChannelOutputDeltaHistogram: Record<string, number> = {};
  const clockCnt28DeltaHistogram: Record<string, number> = {};
  const clockCnt114DeltaHistogram: Record<string, number> = {};
  const transitionCycleModulo28DeltaHistogram: Record<string, number> = {};
  const transitionCycleModulo114DeltaHistogram: Record<string, number> = {};
  const firstMismatches: PokeyRawTraceAlignedStateMismatch[] = [];
  for (let tsIndex = 0; tsIndex < ts.events.length; tsIndex++) {
    const tsEvent = ts.events[tsIndex]!;
    for (let referenceIndex = 0; referenceIndex < reference.events.length; referenceIndex++) {
      const refEvent = reference.events[referenceIndex]!;
      if (tsEvent.estimatedOutputSample - refEvent.estimatedOutputSample !== outputSampleDelta) continue;
      if (tsEvent.raw !== refEvent.raw || tsEvent.prevRaw !== refEvent.prevRaw) continue;

      compared++;
      const counterDelta = numberArrayDelta(tsEvent.counters, refEvent.counters);
      const borrowCntDelta = numberArrayDelta(tsEvent.borrowCnt, refEvent.borrowCnt);
      const outputDelta = numberArrayDelta(tsEvent.outputs, refEvent.outputs);
      const filterSampleDelta = numberArrayDelta(tsEvent.filterSamples, refEvent.filterSamples);
      const tsPoly = pokeyPolyState(tsEvent);
      const refPoly = pokeyPolyState(refEvent);
      const polyDelta = numberArrayDelta(tsPoly, refPoly);
      const polyModuloDelta = pokeyPolyModuloDelta(tsEvent, refEvent);
      const polyClockDelta = inferPokeyPolyClockDelta(polyModuloDelta);
      const polyClockDelta28Ticks =
        polyClockDelta === undefined || polyClockDelta % 28 !== 0 ? undefined : polyClockDelta / 28;
      const changedChannels = pokeyChangedChannels(tsEvent);
      const changedChannelCounterDelta = formatChangedChannelDeltas(changedChannels, counterDelta);
      const changedChannelBorrowCntDelta = formatChangedChannelDeltas(changedChannels, borrowCntDelta);
      const changedChannelOutputDelta = formatChangedChannelDeltas(changedChannels, outputDelta);
      const clockCnt28Delta = tsEvent.clockCnt28 - refEvent.clockCnt28;
      const clockCnt114Delta = tsEvent.clockCnt114 - refEvent.clockCnt114;
      const mismatchFields: string[] = [];

      fieldMismatch(mismatchFields, fieldMismatchCounts, "audf", numberArrayEqual(tsEvent.audf, refEvent.audf));
      fieldMismatch(mismatchFields, fieldMismatchCounts, "audc", numberArrayEqual(tsEvent.audc, refEvent.audc));
      fieldMismatch(mismatchFields, fieldMismatchCounts, "audctl", tsEvent.audctl === refEvent.audctl);
      fieldMismatch(mismatchFields, fieldMismatchCounts, "skctl", tsEvent.skctl === refEvent.skctl);
      fieldMismatch(
        mismatchFields,
        fieldMismatchCounts,
        "counters",
        numberArrayEqual(tsEvent.counters, refEvent.counters),
      );
      fieldMismatch(
        mismatchFields,
        fieldMismatchCounts,
        "borrowCnt",
        numberArrayEqual(tsEvent.borrowCnt, refEvent.borrowCnt),
      );
      fieldMismatch(mismatchFields, fieldMismatchCounts, "outputs", numberArrayEqual(tsEvent.outputs, refEvent.outputs));
      fieldMismatch(
        mismatchFields,
        fieldMismatchCounts,
        "filterSamples",
        numberArrayEqual(tsEvent.filterSamples, refEvent.filterSamples),
      );
      fieldMismatch(mismatchFields, fieldMismatchCounts, "poly", numberArrayEqual(tsPoly, refPoly));
      fieldMismatch(mismatchFields, fieldMismatchCounts, "clockCnt28", clockCnt28Delta === 0);
      fieldMismatch(mismatchFields, fieldMismatchCounts, "clockCnt114", clockCnt114Delta === 0);

      incrementHistogram(eventIndexDeltaHistogram, tsIndex - referenceIndex);
      incrementHistogram(counterDeltaHistogram, counterDelta.join(","));
      incrementHistogram(borrowCntDeltaHistogram, borrowCntDelta.join(","));
      incrementHistogram(outputDeltaHistogram, outputDelta.join(","));
      incrementHistogram(filterSampleDeltaHistogram, filterSampleDelta.join(","));
      incrementHistogram(polyDeltaHistogram, polyDelta.join(","));
      incrementHistogram(polyModuloDeltaHistogram, polyModuloDelta.join(","));
      if (polyClockDelta !== undefined) incrementHistogram(polyClockDeltaHistogram, polyClockDelta);
      if (polyClockDelta28Ticks !== undefined) {
        incrementHistogram(polyClockDelta28TicksHistogram, polyClockDelta28Ticks);
      }
      incrementHistogram(changedChannelHistogram, changedChannels.join(",") || "none");
      incrementHistogram(changedChannelCounterDeltaHistogram, changedChannelCounterDelta);
      incrementHistogram(changedChannelBorrowCntDeltaHistogram, changedChannelBorrowCntDelta);
      incrementHistogram(changedChannelOutputDeltaHistogram, changedChannelOutputDelta);
      incrementHistogram(clockCnt28DeltaHistogram, clockCnt28Delta);
      incrementHistogram(clockCnt114DeltaHistogram, clockCnt114Delta);
      incrementModuloDeltaHistogram(transitionCycleModulo28DeltaHistogram, tsEvent.cycle, refEvent.cycle, 28);
      incrementModuloDeltaHistogram(transitionCycleModulo114DeltaHistogram, tsEvent.cycle, refEvent.cycle, 114);

      if (mismatchFields.length === 0) {
        exactStateMatches++;
      } else if (firstMismatches.length < 12) {
        firstMismatches.push({
          tsIndex,
          referenceIndex,
          prevRaw: tsEvent.prevRaw,
          raw: tsEvent.raw,
          tsEstimatedOutputSample: tsEvent.estimatedOutputSample,
          referenceEstimatedOutputSample: refEvent.estimatedOutputSample,
          tsCycle: tsEvent.cycle,
          referenceCycle: refEvent.cycle,
          cycleDelta: refEvent.cycle - tsEvent.cycle,
          mismatchFields,
          counterDelta,
          borrowCntDelta,
          outputDelta,
          filterSampleDelta,
          polyDelta,
          polyModuloDelta,
          polyClockDelta,
          polyClockDelta28Ticks,
          changedChannels,
          changedChannelCounterDelta,
          changedChannelBorrowCntDelta,
          changedChannelOutputDelta,
          clockCnt28Delta,
          clockCnt114Delta,
        });
      }
    }
  }
  return {
    outputSampleDelta,
    compared,
    exactStateMatches,
    exactStateMismatches: compared - exactStateMatches,
    fieldMismatchCounts,
    eventIndexDeltaHistogram,
    counterDeltaHistogram,
    borrowCntDeltaHistogram,
    outputDeltaHistogram,
    filterSampleDeltaHistogram,
    polyDeltaHistogram,
    polyModuloDeltaHistogram,
    polyClockDeltaHistogram,
    polyClockDelta28TicksHistogram,
    changedChannelHistogram,
    changedChannelCounterDeltaHistogram,
    changedChannelBorrowCntDeltaHistogram,
    changedChannelOutputDeltaHistogram,
    clockCnt28DeltaHistogram,
    clockCnt114DeltaHistogram,
    transitionCycleModulo28DeltaHistogram,
    transitionCycleModulo114DeltaHistogram,
    firstMismatches,
  };
}

function comparePokeyRawTraces(
  ts: PokeyRawTrace | undefined,
  reference: PokeyRawTrace | undefined,
): PokeyRawTraceComparison | undefined {
  if (ts === undefined || reference === undefined) return undefined;
  const compared = Math.min(ts.events.length, reference.events.length);
  if (compared === 0) {
    return {
      compared: 0,
      outputSampleDeltaMin: undefined,
      outputSampleDeltaMax: undefined,
      outputSampleDeltaMeanAbs: undefined,
      outputSampleDeltaHistogram: {},
      cycleDeltaMin: undefined,
      cycleDeltaMax: undefined,
      cycleDeltaMeanAbs: undefined,
      cycleDeltaHistogram: {},
      cycleDeltaMode: undefined,
      cycleDeltaResidualMin: undefined,
      cycleDeltaResidualMax: undefined,
      cycleDeltaResidualMeanAbs: undefined,
      cycleDeltaResidualHistogram: {},
      estimatedOutputSampleFloorDeltaHistogram: {},
      estimatedOutputSampleCeilDeltaHistogram: {},
      lofiS1OutputSampleDeltaHistogram: {},
      lofiS2OutputSampleDeltaHistogram: {},
      lofiS3OutputSampleDeltaHistogram: {},
      lofiSourceBlockOffsetDeltaHistogram: {},
      outputSampleDeltaByCycleDeltaResidual: {},
      outputSampleDeltaByLofiSourceBlockOffsetDelta: {},
      outputSampleDeltaByTsCycleInNativeSample: {},
      outputSampleDeltaByReferenceCycleInNativeSample: {},
      rawOutputSampleDeltaHistogram: {},
      rawTransitionOutputSampleDeltaHistogram: {},
      dominantRawTransitionStateAlignment: undefined,
      rawMismatchCount: 0,
      cycleDeltaRuns: [],
      cycleDeltaSummary: [],
      pairs: [],
    };
  }
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  let sumAbs = 0;
  let cycleDeltaMin = Number.POSITIVE_INFINITY;
  let cycleDeltaMax = Number.NEGATIVE_INFINITY;
  let cycleDeltaAbsSum = 0;
  let rawMismatchCount = 0;
  const hist: Record<string, number> = {};
  const cycleDeltaHistogram: Record<string, number> = {};
  const estimatedOutputSampleFloorDeltaHistogram: Record<string, number> = {};
  const estimatedOutputSampleCeilDeltaHistogram: Record<string, number> = {};
  const lofiS1OutputSampleDeltaHistogram: Record<string, number> = {};
  const lofiS2OutputSampleDeltaHistogram: Record<string, number> = {};
  const lofiS3OutputSampleDeltaHistogram: Record<string, number> = {};
  const lofiSourceBlockOffsetDeltaHistogram: Record<string, number> = {};
  const outputSampleDeltaByLofiSourceBlockOffsetDelta: Record<string, Record<string, number>> = {};
  const outputSampleDeltaByTsCycleInNativeSample: Record<string, Record<string, number>> = {};
  const outputSampleDeltaByReferenceCycleInNativeSample: Record<string, Record<string, number>> = {};
  const rawOutputSampleDeltaHistogram: Record<string, number> = {};
  const rawTransitionOutputSampleDeltaHistogram: Record<string, number> = {};
  const pairs: Array<PokeyRawTraceComparison["pairs"][number]> = [];
  const cycleDeltaRuns: Array<PokeyRawTraceComparison["cycleDeltaRuns"][number]> = [];
  const cycleDeltaSummary = new Map<
    number,
    PokeyRawTraceComparison["cycleDeltaSummary"][number] & { readonly outputSampleDeltaAbsSum: number }
  >();
  const startRun = (
    index: number,
    cycleDelta: number,
    tsEvent: PokeyRawTraceEvent,
    refEvent: PokeyRawTraceEvent,
    outputSampleDelta: number,
  ) => ({
    startIndex: index,
    endIndex: index,
    count: 1,
    cycleDelta,
    tsStartEstimatedOutputSample: tsEvent.estimatedOutputSample,
    tsEndEstimatedOutputSample: tsEvent.estimatedOutputSample,
    referenceStartEstimatedOutputSample: refEvent.estimatedOutputSample,
    referenceEndEstimatedOutputSample: refEvent.estimatedOutputSample,
    outputSampleDeltaMin: outputSampleDelta,
    outputSampleDeltaMax: outputSampleDelta,
    outputSampleDeltaAbsSum: Math.abs(outputSampleDelta),
    outputSampleDeltaHistogram: { [String(outputSampleDelta)]: 1 },
  });
  let currentRun: ReturnType<typeof startRun> | undefined;
  for (const tsEvent of ts.events) {
    for (const refEvent of reference.events) {
      const outputSampleDelta = tsEvent.estimatedOutputSample - refEvent.estimatedOutputSample;
      if (tsEvent.raw === refEvent.raw) {
        incrementHistogram(rawOutputSampleDeltaHistogram, outputSampleDelta);
      }
      if (tsEvent.raw === refEvent.raw && tsEvent.prevRaw === refEvent.prevRaw) {
        incrementHistogram(rawTransitionOutputSampleDeltaHistogram, outputSampleDelta);
      }
    }
  }
  for (let i = 0; i < compared; i++) {
    const tsEvent = ts.events[i]!;
    const refEvent = reference.events[i]!;
    const delta = tsEvent.estimatedOutputSample - refEvent.estimatedOutputSample;
    const floorDelta = tsEvent.estimatedOutputSampleFloor - refEvent.estimatedOutputSampleFloor;
    const ceilDelta = tsEvent.estimatedOutputSampleCeil - refEvent.estimatedOutputSampleCeil;
    const lofiS1Delta = tsEvent.lofiS1OutputSample - refEvent.lofiS1OutputSample;
    const lofiS2Delta = tsEvent.lofiS2OutputSample - refEvent.lofiS2OutputSample;
    const lofiS3Delta = tsEvent.lofiS3OutputSample - refEvent.lofiS3OutputSample;
    const lofiSourceBlockOffsetDelta = tsEvent.lofiSourceBlockOffset - refEvent.lofiSourceBlockOffset;
    const cycleDelta = refEvent.cycle - tsEvent.cycle;
    const rawMatch = tsEvent.raw === refEvent.raw && tsEvent.prevRaw === refEvent.prevRaw;
    min = Math.min(min, delta);
    max = Math.max(max, delta);
    sumAbs += Math.abs(delta);
    incrementHistogram(hist, delta);
    incrementHistogram(estimatedOutputSampleFloorDeltaHistogram, floorDelta);
    incrementHistogram(estimatedOutputSampleCeilDeltaHistogram, ceilDelta);
    incrementHistogram(lofiS1OutputSampleDeltaHistogram, lofiS1Delta);
    incrementHistogram(lofiS2OutputSampleDeltaHistogram, lofiS2Delta);
    incrementHistogram(lofiS3OutputSampleDeltaHistogram, lofiS3Delta);
    incrementHistogram(lofiSourceBlockOffsetDeltaHistogram, lofiSourceBlockOffsetDelta);
    incrementNestedHistogram(
      outputSampleDeltaByLofiSourceBlockOffsetDelta,
      lofiSourceBlockOffsetDelta,
      delta,
    );
    cycleDeltaMin = Math.min(cycleDeltaMin, cycleDelta);
    cycleDeltaMax = Math.max(cycleDeltaMax, cycleDelta);
    cycleDeltaAbsSum += Math.abs(cycleDelta);
    incrementHistogram(cycleDeltaHistogram, cycleDelta);
    incrementNestedHistogram(outputSampleDeltaByTsCycleInNativeSample, tsEvent.cycleInNativeSample, delta);
    incrementNestedHistogram(
      outputSampleDeltaByReferenceCycleInNativeSample,
      refEvent.cycleInNativeSample,
      delta,
    );
    if (!rawMatch) rawMismatchCount++;

    if (currentRun === undefined || currentRun.cycleDelta !== cycleDelta) {
      if (currentRun !== undefined) {
        cycleDeltaRuns.push({
          startIndex: currentRun.startIndex,
          endIndex: currentRun.endIndex,
          count: currentRun.count,
          cycleDelta: currentRun.cycleDelta,
          tsStartEstimatedOutputSample: currentRun.tsStartEstimatedOutputSample,
          tsEndEstimatedOutputSample: currentRun.tsEndEstimatedOutputSample,
          referenceStartEstimatedOutputSample: currentRun.referenceStartEstimatedOutputSample,
          referenceEndEstimatedOutputSample: currentRun.referenceEndEstimatedOutputSample,
          outputSampleDeltaMin: currentRun.outputSampleDeltaMin,
          outputSampleDeltaMax: currentRun.outputSampleDeltaMax,
          outputSampleDeltaMeanAbs: currentRun.outputSampleDeltaAbsSum / currentRun.count,
          outputSampleDeltaHistogram: currentRun.outputSampleDeltaHistogram,
        });
      }
      currentRun = startRun(i, cycleDelta, tsEvent, refEvent, delta);
    } else {
      currentRun = {
        ...currentRun,
        endIndex: i,
        count: currentRun.count + 1,
        tsEndEstimatedOutputSample: tsEvent.estimatedOutputSample,
        referenceEndEstimatedOutputSample: refEvent.estimatedOutputSample,
        outputSampleDeltaMin: Math.min(currentRun.outputSampleDeltaMin, delta),
        outputSampleDeltaMax: Math.max(currentRun.outputSampleDeltaMax, delta),
        outputSampleDeltaAbsSum: currentRun.outputSampleDeltaAbsSum + Math.abs(delta),
        outputSampleDeltaHistogram: {
          ...currentRun.outputSampleDeltaHistogram,
          [String(delta)]: (currentRun.outputSampleDeltaHistogram[String(delta)] ?? 0) + 1,
        },
      };
    }

    const summary = cycleDeltaSummary.get(cycleDelta);
    if (summary === undefined) {
      cycleDeltaSummary.set(cycleDelta, {
        cycleDelta,
        count: 1,
        firstIndex: i,
        lastIndex: i,
        tsFirstEstimatedOutputSample: tsEvent.estimatedOutputSample,
        tsLastEstimatedOutputSample: tsEvent.estimatedOutputSample,
        referenceFirstEstimatedOutputSample: refEvent.estimatedOutputSample,
        referenceLastEstimatedOutputSample: refEvent.estimatedOutputSample,
        outputSampleDeltaMin: delta,
        outputSampleDeltaMax: delta,
        outputSampleDeltaMeanAbs: Math.abs(delta),
        outputSampleDeltaHistogram: { [String(delta)]: 1 },
        rawMismatchCount: rawMatch ? 0 : 1,
        outputSampleDeltaAbsSum: Math.abs(delta),
      });
    } else {
      const count = summary.count + 1;
      const outputSampleDeltaAbsSum = summary.outputSampleDeltaAbsSum + Math.abs(delta);
      cycleDeltaSummary.set(cycleDelta, {
        cycleDelta,
        count,
        firstIndex: summary.firstIndex,
        lastIndex: i,
        tsFirstEstimatedOutputSample: summary.tsFirstEstimatedOutputSample,
        tsLastEstimatedOutputSample: tsEvent.estimatedOutputSample,
        referenceFirstEstimatedOutputSample: summary.referenceFirstEstimatedOutputSample,
        referenceLastEstimatedOutputSample: refEvent.estimatedOutputSample,
        outputSampleDeltaMin: Math.min(summary.outputSampleDeltaMin, delta),
        outputSampleDeltaMax: Math.max(summary.outputSampleDeltaMax, delta),
        outputSampleDeltaMeanAbs: outputSampleDeltaAbsSum / count,
        outputSampleDeltaHistogram: {
          ...summary.outputSampleDeltaHistogram,
          [String(delta)]: (summary.outputSampleDeltaHistogram[String(delta)] ?? 0) + 1,
        },
        rawMismatchCount: summary.rawMismatchCount + (rawMatch ? 0 : 1),
        outputSampleDeltaAbsSum,
      });
    }

    pairs.push({
      index: i,
      raw: tsEvent.raw,
      prevRaw: tsEvent.prevRaw,
      referenceRaw: refEvent.raw,
      referencePrevRaw: refEvent.prevRaw,
      rawMatch,
      tsEstimatedOutputSample: tsEvent.estimatedOutputSample,
      referenceEstimatedOutputSample: refEvent.estimatedOutputSample,
      outputSampleDelta: delta,
      tsCycle: tsEvent.cycle,
      referenceCycle: refEvent.cycle,
      cycleDelta,
      tsNativeSample: tsEvent.nativeSample,
      referenceNativeSample: refEvent.nativeSample,
      nativeSampleDelta: refEvent.nativeSample - tsEvent.nativeSample,
      tsCycleInNativeSample: tsEvent.cycleInNativeSample,
      referenceCycleInNativeSample: refEvent.cycleInNativeSample,
      estimatedOutputSampleFloorDelta: floorDelta,
      estimatedOutputSampleCeilDelta: ceilDelta,
      tsLofiSourceBlockOffset: tsEvent.lofiSourceBlockOffset,
      referenceLofiSourceBlockOffset: refEvent.lofiSourceBlockOffset,
      lofiSourceBlockOffsetDelta,
      lofiS1OutputSampleDelta: lofiS1Delta,
      lofiS2OutputSampleDelta: lofiS2Delta,
      lofiS3OutputSampleDelta: lofiS3Delta,
    });
  }
  if (currentRun !== undefined) {
    cycleDeltaRuns.push({
      startIndex: currentRun.startIndex,
      endIndex: currentRun.endIndex,
      count: currentRun.count,
      cycleDelta: currentRun.cycleDelta,
      tsStartEstimatedOutputSample: currentRun.tsStartEstimatedOutputSample,
      tsEndEstimatedOutputSample: currentRun.tsEndEstimatedOutputSample,
      referenceStartEstimatedOutputSample: currentRun.referenceStartEstimatedOutputSample,
      referenceEndEstimatedOutputSample: currentRun.referenceEndEstimatedOutputSample,
      outputSampleDeltaMin: currentRun.outputSampleDeltaMin,
      outputSampleDeltaMax: currentRun.outputSampleDeltaMax,
      outputSampleDeltaMeanAbs: currentRun.outputSampleDeltaAbsSum / currentRun.count,
      outputSampleDeltaHistogram: currentRun.outputSampleDeltaHistogram,
    });
  }
  const cycleDeltaMode = numericHistogramMode(cycleDeltaHistogram);
  let cycleDeltaResidualMin = Number.POSITIVE_INFINITY;
  let cycleDeltaResidualMax = Number.NEGATIVE_INFINITY;
  let cycleDeltaResidualAbsSum = 0;
  const cycleDeltaResidualHistogram: Record<string, number> = {};
  const outputSampleDeltaByCycleDeltaResidual: Record<string, Record<string, number>> = {};
  if (cycleDeltaMode !== undefined) {
    for (const pair of pairs) {
      const residual = pair.cycleDelta - cycleDeltaMode;
      cycleDeltaResidualMin = Math.min(cycleDeltaResidualMin, residual);
      cycleDeltaResidualMax = Math.max(cycleDeltaResidualMax, residual);
      cycleDeltaResidualAbsSum += Math.abs(residual);
      incrementHistogram(cycleDeltaResidualHistogram, residual);
      incrementNestedHistogram(outputSampleDeltaByCycleDeltaResidual, residual, pair.outputSampleDelta);
    }
  }
  const dominantRawTransitionOutputDelta = numericHistogramTop(rawTransitionOutputSampleDeltaHistogram, 1)[0]?.value;
  const dominantRawTransitionStateAlignment =
    dominantRawTransitionOutputDelta === undefined
      ? undefined
      : comparePokeyRawTraceDominantStateAlignment(ts, reference, dominantRawTransitionOutputDelta);
  return {
    compared,
    outputSampleDeltaMin: min,
    outputSampleDeltaMax: max,
    outputSampleDeltaMeanAbs: sumAbs / compared,
    outputSampleDeltaHistogram: hist,
    cycleDeltaMin,
    cycleDeltaMax,
    cycleDeltaMeanAbs: cycleDeltaAbsSum / compared,
    cycleDeltaHistogram,
    cycleDeltaMode,
    cycleDeltaResidualMin: cycleDeltaMode === undefined ? undefined : cycleDeltaResidualMin,
    cycleDeltaResidualMax: cycleDeltaMode === undefined ? undefined : cycleDeltaResidualMax,
    cycleDeltaResidualMeanAbs:
      cycleDeltaMode === undefined ? undefined : cycleDeltaResidualAbsSum / compared,
    cycleDeltaResidualHistogram,
    estimatedOutputSampleFloorDeltaHistogram,
    estimatedOutputSampleCeilDeltaHistogram,
    lofiS1OutputSampleDeltaHistogram,
    lofiS2OutputSampleDeltaHistogram,
    lofiS3OutputSampleDeltaHistogram,
    lofiSourceBlockOffsetDeltaHistogram,
    outputSampleDeltaByCycleDeltaResidual,
    outputSampleDeltaByLofiSourceBlockOffsetDelta,
    outputSampleDeltaByTsCycleInNativeSample,
    outputSampleDeltaByReferenceCycleInNativeSample,
    rawOutputSampleDeltaHistogram,
    rawTransitionOutputSampleDeltaHistogram,
    dominantRawTransitionStateAlignment,
    rawMismatchCount,
    cycleDeltaRuns,
    cycleDeltaSummary: Array.from(cycleDeltaSummary.values())
      .map(({ outputSampleDeltaAbsSum: _outputSampleDeltaAbsSum, ...entry }) => entry)
      .sort((a, b) => b.count - a.count || a.cycleDelta - b.cycleDelta),
    pairs,
  };
}

interface LocalPcmResidualAccumulator {
  count: number;
  samples: number;
  rmsSum: number;
  rmsMax: number;
  meanAbsSum: number;
  maxAbsMax: number;
  correlationSum: number;
  correlationMin: number;
  bestGainSum: number;
  bestGainMin: number;
  bestGainMax: number;
  gainCorrectedRmsSum: number;
  gainCorrectedRmsMax: number;
  gainCorrectedMaxAbsMax: number;
}

function createLocalPcmResidualAccumulator(): LocalPcmResidualAccumulator {
  return {
    count: 0,
    samples: 0,
    rmsSum: 0,
    rmsMax: 0,
    meanAbsSum: 0,
    maxAbsMax: 0,
    correlationSum: 0,
    correlationMin: Number.POSITIVE_INFINITY,
    bestGainSum: 0,
    bestGainMin: Number.POSITIVE_INFINITY,
    bestGainMax: Number.NEGATIVE_INFINITY,
    gainCorrectedRmsSum: 0,
    gainCorrectedRmsMax: 0,
    gainCorrectedMaxAbsMax: 0,
  };
}

function addLocalPcmResidual(
  acc: LocalPcmResidualAccumulator,
  stats: LocalPcmResidualStats,
): void {
  acc.count++;
  acc.samples += stats.samples;
  acc.rmsSum += stats.rms;
  acc.rmsMax = Math.max(acc.rmsMax, stats.rms);
  acc.meanAbsSum += stats.meanAbs;
  acc.maxAbsMax = Math.max(acc.maxAbsMax, stats.maxAbs);
  acc.correlationSum += stats.correlation;
  acc.correlationMin = Math.min(acc.correlationMin, stats.correlation);
  acc.bestGainSum += stats.bestGain;
  acc.bestGainMin = Math.min(acc.bestGainMin, stats.bestGain);
  acc.bestGainMax = Math.max(acc.bestGainMax, stats.bestGain);
  acc.gainCorrectedRmsSum += stats.gainCorrectedRms;
  acc.gainCorrectedRmsMax = Math.max(acc.gainCorrectedRmsMax, stats.gainCorrectedRms);
  acc.gainCorrectedMaxAbsMax = Math.max(acc.gainCorrectedMaxAbsMax, stats.gainCorrectedMaxAbs);
}

function finalizeLocalPcmResidualAggregate(acc: LocalPcmResidualAccumulator): LocalPcmResidualAggregate {
  if (acc.count === 0) {
    return {
      count: 0,
      samples: 0,
      rmsMean: 0,
      rmsMax: 0,
      meanAbsMean: 0,
      maxAbsMax: 0,
      correlationMean: 0,
      correlationMin: 0,
      bestGainMean: 0,
      bestGainMin: 0,
      bestGainMax: 0,
      gainCorrectedRmsMean: 0,
      gainCorrectedRmsMax: 0,
      gainCorrectedMaxAbsMax: 0,
    };
  }
  return {
    count: acc.count,
    samples: acc.samples,
    rmsMean: acc.rmsSum / acc.count,
    rmsMax: acc.rmsMax,
    meanAbsMean: acc.meanAbsSum / acc.count,
    maxAbsMax: acc.maxAbsMax,
    correlationMean: acc.correlationSum / acc.count,
    correlationMin: acc.correlationMin,
    bestGainMean: acc.bestGainSum / acc.count,
    bestGainMin: acc.bestGainMin,
    bestGainMax: acc.bestGainMax,
    gainCorrectedRmsMean: acc.gainCorrectedRmsSum / acc.count,
    gainCorrectedRmsMax: acc.gainCorrectedRmsMax,
    gainCorrectedMaxAbsMax: acc.gainCorrectedMaxAbsMax,
  };
}

function localPcmResidualStats(
  tsSignal: Float32Array,
  referenceSignal: Float32Array,
  tsCenter: number,
  referenceCenter: number,
  radius: number,
): LocalPcmResidualStats | undefined {
  let samples = 0;
  let diffSq = 0;
  let diffAbs = 0;
  let maxAbs = 0;
  let tsSq = 0;
  let refSq = 0;
  let cross = 0;
  let gainCorrectedSq = 0;
  let gainCorrectedMaxAbs = 0;
  for (let offset = -radius; offset <= radius; offset++) {
    const tsIndex = tsCenter + offset;
    const refIndex = referenceCenter + offset;
    if (tsIndex < 0 || tsIndex >= tsSignal.length || refIndex < 0 || refIndex >= referenceSignal.length) {
      continue;
    }
    const tsSample = tsSignal[tsIndex] ?? 0;
    const refSample = referenceSignal[refIndex] ?? 0;
    const diff = tsSample - refSample;
    const abs = Math.abs(diff);
    samples++;
    diffSq += diff * diff;
    diffAbs += abs;
    maxAbs = Math.max(maxAbs, abs);
    tsSq += tsSample * tsSample;
    refSq += refSample * refSample;
    cross += tsSample * refSample;
  }
  if (samples === 0) return undefined;
  const bestGain = tsSq === 0 ? 0 : cross / tsSq;
  for (let offset = -radius; offset <= radius; offset++) {
    const tsIndex = tsCenter + offset;
    const refIndex = referenceCenter + offset;
    if (tsIndex < 0 || tsIndex >= tsSignal.length || refIndex < 0 || refIndex >= referenceSignal.length) {
      continue;
    }
    const gainCorrectedDiff = ((tsSignal[tsIndex] ?? 0) * bestGain) - (referenceSignal[refIndex] ?? 0);
    const gainCorrectedAbs = Math.abs(gainCorrectedDiff);
    gainCorrectedSq += gainCorrectedDiff * gainCorrectedDiff;
    gainCorrectedMaxAbs = Math.max(gainCorrectedMaxAbs, gainCorrectedAbs);
  }
  return {
    samples,
    rms: Math.sqrt(diffSq / samples),
    meanAbs: diffAbs / samples,
    maxAbs,
    correlation: tsSq > 0 && refSq > 0 ? cross / Math.sqrt(tsSq * refSq) : 0,
    bestGain,
    gainCorrectedRms: Math.sqrt(gainCorrectedSq / samples),
    gainCorrectedMaxAbs,
  };
}

function bestLocalPcmResidualStats(
  tsSignal: Float32Array,
  referenceSignal: Float32Array,
  tsCenter: number,
  referenceCenter: number,
  radius: number,
  maxLag: number,
): LocalPcmResidualStats | undefined {
  let best: LocalPcmResidualStats | undefined;
  let bestLag = 0;
  for (let lag = -maxLag; lag <= maxLag; lag++) {
    const stats = localPcmResidualStats(tsSignal, referenceSignal, tsCenter, referenceCenter + lag, radius);
    if (stats === undefined) continue;
    if (
      best === undefined ||
      stats.rms < best.rms ||
      (stats.rms === best.rms && stats.correlation > best.correlation)
    ) {
      best = stats;
      bestLag = lag;
    }
  }
  return best === undefined ? undefined : { ...best, lag: bestLag };
}

interface PokeyPcmResidualBucketAccumulator {
  count: number;
  firstIndex: number;
  lastIndex: number;
  sameOutputRmsSum: number;
  sameOutputRmsMax: number;
  eventAlignedRmsSum: number;
  eventAlignedRmsMax: number;
  bestLagRmsSum: number;
  bestLagRmsMax: number;
  bestLagRmsImprovementSum: number;
  bestLagRmsImprovementMax: number;
  outputSampleDeltaHistogram: Record<string, number>;
  cycleDeltaResidualHistogram: Record<string, number>;
  bestLagHistogram: Record<string, number>;
  rawTransitionHistogram: Record<string, number>;
  counterDeltaHistogram: Record<string, number>;
  polyDeltaHistogram: Record<string, number>;
  polyModuloDeltaHistogram: Record<string, number>;
  polyClockDeltaHistogram: Record<string, number>;
  polyClockDelta28TicksHistogram: Record<string, number>;
  changedChannelHistogram: Record<string, number>;
  changedChannelCounterDeltaHistogram: Record<string, number>;
  changedChannelBorrowCntDeltaHistogram: Record<string, number>;
  changedChannelOutputDeltaHistogram: Record<string, number>;
  clockCnt28DeltaHistogram: Record<string, number>;
  clockCnt114DeltaHistogram: Record<string, number>;
}

interface PokeyPcmResidualTransitionGroupAccumulator {
  prevRaw: string;
  raw: string;
  prevChannels: readonly number[];
  channels: readonly number[];
  audf: readonly number[];
  audc: readonly number[];
  audctl: number;
  skctl: number;
  outputSampleDelta: number;
  cycleDeltaResidual: number | undefined;
  bestLag: number;
  count: number;
  firstIndex: number;
  lastIndex: number;
  sameOutputRmsSum: number;
  eventAlignedRmsSum: number;
  bestLagRmsSum: number;
  bestLagRmsMax: number;
  bestLagRmsImprovementSum: number;
}

interface PokeyRawTracePcmResidualTimingRunAccumulator {
  signature: string;
  startIndex: number;
  endIndex: number;
  count: number;
  firstTs: PokeyRawTraceEventContext;
  firstReference: PokeyRawTraceEventContext;
  lastTs: PokeyRawTraceEventContext;
  lastReference: PokeyRawTraceEventContext;
  firstTsLastRelevantWrite: PokeyRawTraceWriteContext | undefined;
  firstReferenceLastRelevantWrite: PokeyRawTraceWriteContext | undefined;
  lastTsLastRelevantWrite: PokeyRawTraceWriteContext | undefined;
  lastReferenceLastRelevantWrite: PokeyRawTraceWriteContext | undefined;
  outputSampleDeltaHistogram: Record<string, number>;
  cycleDeltaResidualHistogram: Record<string, number>;
  bestLagHistogram: Record<string, number>;
  rawTransitionHistogram: Record<string, number>;
  counterDeltaHistogram: Record<string, number>;
  polyDeltaHistogram: Record<string, number>;
  polyModuloDeltaHistogram: Record<string, number>;
  polyClockDeltaHistogram: Record<string, number>;
  polyClockDelta28TicksHistogram: Record<string, number>;
  changedChannelHistogram: Record<string, number>;
  changedChannelCounterDeltaHistogram: Record<string, number>;
  changedChannelBorrowCntDeltaHistogram: Record<string, number>;
  changedChannelOutputDeltaHistogram: Record<string, number>;
  clockCnt28DeltaHistogram: Record<string, number>;
  clockCnt114DeltaHistogram: Record<string, number>;
  tsLastRelevantWriteHistogram: Record<string, number>;
  referenceLastRelevantWriteHistogram: Record<string, number>;
  lastRelevantWritePairHistogram: Record<string, number>;
  transitionCycleModulo28DeltaHistogram: Record<string, number>;
  transitionCycleModulo114DeltaHistogram: Record<string, number>;
  lastRelevantApplyCycleDeltaHistogram: Record<string, number>;
  lastRelevantApplyCycleModulo28DeltaHistogram: Record<string, number>;
  lastRelevantApplyCycleModulo114DeltaHistogram: Record<string, number>;
  lastRelevantCyclesSinceApplyDeltaHistogram: Record<string, number>;
  lastRelevantCyclesSinceApplyModulo28DeltaHistogram: Record<string, number>;
  lastRelevantCyclesSinceApplyModulo114DeltaHistogram: Record<string, number>;
  lastRelevantApplyDelayDeltaHistogram: Record<string, number>;
  lastRelevantCycleInFrameDeltaHistogram: Record<string, number>;
  lastRelevantFrameHistogram: Record<string, number>;
  sameOutputRmsSum: number;
  sameOutputRmsMax: number;
  eventAlignedRmsSum: number;
  eventAlignedRmsMax: number;
  bestLagRmsSum: number;
  bestLagRmsMax: number;
}

function createPokeyPcmResidualBucketAccumulator(): PokeyPcmResidualBucketAccumulator {
  return {
    count: 0,
    firstIndex: Number.POSITIVE_INFINITY,
    lastIndex: Number.NEGATIVE_INFINITY,
    sameOutputRmsSum: 0,
    sameOutputRmsMax: 0,
    eventAlignedRmsSum: 0,
    eventAlignedRmsMax: 0,
    bestLagRmsSum: 0,
    bestLagRmsMax: 0,
    bestLagRmsImprovementSum: 0,
    bestLagRmsImprovementMax: Number.NEGATIVE_INFINITY,
    outputSampleDeltaHistogram: {},
    cycleDeltaResidualHistogram: {},
    bestLagHistogram: {},
    rawTransitionHistogram: {},
    counterDeltaHistogram: {},
    polyDeltaHistogram: {},
    polyModuloDeltaHistogram: {},
    polyClockDeltaHistogram: {},
    polyClockDelta28TicksHistogram: {},
    changedChannelHistogram: {},
    changedChannelCounterDeltaHistogram: {},
    changedChannelBorrowCntDeltaHistogram: {},
    changedChannelOutputDeltaHistogram: {},
    clockCnt28DeltaHistogram: {},
    clockCnt114DeltaHistogram: {},
  };
}

function addPokeyPcmResidualBucket(
  acc: PokeyPcmResidualBucketAccumulator,
  index: number,
  sameOutput: LocalPcmResidualStats,
  eventAligned: LocalPcmResidualStats,
  bestLag: LocalPcmResidualStats,
  outputSampleDelta: number,
  cycleDeltaResidual: number | undefined,
  rawTransition: string,
  counterDelta: readonly number[],
  polyDelta: readonly number[],
  polyModuloDelta: readonly number[],
  changedChannels: readonly number[],
  borrowCntDelta: readonly number[],
  outputDelta: readonly number[],
  clockCnt28Delta: number | undefined,
  clockCnt114Delta: number | undefined,
): void {
  const bestLagValue = bestLag.lag ?? 0;
  const bestLagImprovement = sameOutput.rms - bestLag.rms;
  acc.count++;
  acc.firstIndex = Math.min(acc.firstIndex, index);
  acc.lastIndex = Math.max(acc.lastIndex, index);
  acc.sameOutputRmsSum += sameOutput.rms;
  acc.sameOutputRmsMax = Math.max(acc.sameOutputRmsMax, sameOutput.rms);
  acc.eventAlignedRmsSum += eventAligned.rms;
  acc.eventAlignedRmsMax = Math.max(acc.eventAlignedRmsMax, eventAligned.rms);
  acc.bestLagRmsSum += bestLag.rms;
  acc.bestLagRmsMax = Math.max(acc.bestLagRmsMax, bestLag.rms);
  acc.bestLagRmsImprovementSum += bestLagImprovement;
  acc.bestLagRmsImprovementMax = Math.max(acc.bestLagRmsImprovementMax, bestLagImprovement);
  incrementHistogram(acc.outputSampleDeltaHistogram, outputSampleDelta);
  if (cycleDeltaResidual !== undefined) incrementHistogram(acc.cycleDeltaResidualHistogram, cycleDeltaResidual);
  incrementHistogram(acc.bestLagHistogram, bestLagValue);
  incrementHistogram(acc.rawTransitionHistogram, rawTransition);
  incrementHistogram(acc.counterDeltaHistogram, counterDelta.join(","));
  incrementHistogram(acc.polyDeltaHistogram, polyDelta.join(","));
  incrementHistogram(acc.polyModuloDeltaHistogram, polyModuloDelta.join(","));
  const polyClockDelta = inferPokeyPolyClockDelta(polyModuloDelta);
  const polyClockDelta28Ticks =
    polyClockDelta === undefined || polyClockDelta % 28 !== 0 ? undefined : polyClockDelta / 28;
  if (polyClockDelta !== undefined) incrementHistogram(acc.polyClockDeltaHistogram, polyClockDelta);
  if (polyClockDelta28Ticks !== undefined) {
    incrementHistogram(acc.polyClockDelta28TicksHistogram, polyClockDelta28Ticks);
  }
  incrementHistogram(acc.changedChannelHistogram, changedChannels.join(",") || "none");
  incrementHistogram(acc.changedChannelCounterDeltaHistogram, formatChangedChannelDeltas(changedChannels, counterDelta));
  incrementHistogram(
    acc.changedChannelBorrowCntDeltaHistogram,
    formatChangedChannelDeltas(changedChannels, borrowCntDelta),
  );
  incrementHistogram(acc.changedChannelOutputDeltaHistogram, formatChangedChannelDeltas(changedChannels, outputDelta));
  if (clockCnt28Delta !== undefined) incrementHistogram(acc.clockCnt28DeltaHistogram, clockCnt28Delta);
  if (clockCnt114Delta !== undefined) incrementHistogram(acc.clockCnt114DeltaHistogram, clockCnt114Delta);
}

function finalizePokeyPcmResidualBucket(acc: PokeyPcmResidualBucketAccumulator): PokeyPcmResidualBucket {
  if (acc.count === 0) {
    return {
      count: 0,
      firstIndex: 0,
      lastIndex: 0,
      sameOutputRmsMean: 0,
      sameOutputRmsMax: 0,
      eventAlignedRmsMean: 0,
      eventAlignedRmsMax: 0,
      bestLagRmsMean: 0,
      bestLagRmsMax: 0,
      bestLagRmsImprovementMean: 0,
      bestLagRmsImprovementMax: 0,
      outputSampleDeltaHistogram: {},
      cycleDeltaResidualHistogram: {},
      bestLagHistogram: {},
      rawTransitionHistogram: {},
      counterDeltaHistogram: {},
      polyDeltaHistogram: {},
      polyModuloDeltaHistogram: {},
      polyClockDeltaHistogram: {},
      polyClockDelta28TicksHistogram: {},
      changedChannelHistogram: {},
      changedChannelCounterDeltaHistogram: {},
      changedChannelBorrowCntDeltaHistogram: {},
      changedChannelOutputDeltaHistogram: {},
      clockCnt28DeltaHistogram: {},
      clockCnt114DeltaHistogram: {},
    };
  }
  return {
    count: acc.count,
    firstIndex: acc.firstIndex,
    lastIndex: acc.lastIndex,
    sameOutputRmsMean: acc.sameOutputRmsSum / acc.count,
    sameOutputRmsMax: acc.sameOutputRmsMax,
    eventAlignedRmsMean: acc.eventAlignedRmsSum / acc.count,
    eventAlignedRmsMax: acc.eventAlignedRmsMax,
    bestLagRmsMean: acc.bestLagRmsSum / acc.count,
    bestLagRmsMax: acc.bestLagRmsMax,
    bestLagRmsImprovementMean: acc.bestLagRmsImprovementSum / acc.count,
    bestLagRmsImprovementMax: acc.bestLagRmsImprovementMax,
    outputSampleDeltaHistogram: acc.outputSampleDeltaHistogram,
    cycleDeltaResidualHistogram: acc.cycleDeltaResidualHistogram,
    bestLagHistogram: acc.bestLagHistogram,
    rawTransitionHistogram: acc.rawTransitionHistogram,
    counterDeltaHistogram: acc.counterDeltaHistogram,
    polyDeltaHistogram: acc.polyDeltaHistogram,
    polyModuloDeltaHistogram: acc.polyModuloDeltaHistogram,
    polyClockDeltaHistogram: acc.polyClockDeltaHistogram,
    polyClockDelta28TicksHistogram: acc.polyClockDelta28TicksHistogram,
    changedChannelHistogram: acc.changedChannelHistogram,
    changedChannelCounterDeltaHistogram: acc.changedChannelCounterDeltaHistogram,
    changedChannelBorrowCntDeltaHistogram: acc.changedChannelBorrowCntDeltaHistogram,
    changedChannelOutputDeltaHistogram: acc.changedChannelOutputDeltaHistogram,
    clockCnt28DeltaHistogram: acc.clockCnt28DeltaHistogram,
    clockCnt114DeltaHistogram: acc.clockCnt114DeltaHistogram,
  };
}

function finalizePokeyPcmResidualBucketMap(
  map: ReadonlyMap<string, PokeyPcmResidualBucketAccumulator>,
): Record<string, PokeyPcmResidualBucket> {
  const out: Record<string, PokeyPcmResidualBucket> = {};
  for (const [key, value] of Array.from(map.entries()).sort((a, b) => Number(a[0]) - Number(b[0]))) {
    out[key] = finalizePokeyPcmResidualBucket(value);
  }
  return out;
}

function finalizePokeyPcmResidualTransitionGroup(
  acc: PokeyPcmResidualTransitionGroupAccumulator,
): PokeyPcmResidualTransitionGroup {
  return {
    prevRaw: acc.prevRaw,
    raw: acc.raw,
    prevChannels: acc.prevChannels,
    channels: acc.channels,
    audf: acc.audf,
    audc: acc.audc,
    audctl: acc.audctl,
    skctl: acc.skctl,
    outputSampleDelta: acc.outputSampleDelta,
    cycleDeltaResidual: acc.cycleDeltaResidual,
    bestLag: acc.bestLag,
    count: acc.count,
    firstIndex: acc.firstIndex,
    lastIndex: acc.lastIndex,
    sameOutputRmsMean: acc.sameOutputRmsSum / acc.count,
    eventAlignedRmsMean: acc.eventAlignedRmsSum / acc.count,
    bestLagRmsMean: acc.bestLagRmsSum / acc.count,
    bestLagRmsMax: acc.bestLagRmsMax,
    bestLagRmsImprovementMean: acc.bestLagRmsImprovementSum / acc.count,
  };
}

function pokeyTraceEventContext(event: PokeyRawTraceEvent): PokeyRawTraceEventContext {
  return {
    cycle: event.cycle,
    nativeSample: event.nativeSample,
    estimatedOutputSample: event.estimatedOutputSample,
    projectedOutputFraction: event.projectedOutputFraction,
    lofiSourceBlockOffset: event.lofiSourceBlockOffset,
    prevRaw: event.prevRaw,
    raw: event.raw,
    audf: event.audf,
    audc: event.audc,
    audctl: event.audctl,
    skctl: event.skctl,
    counters: event.counters,
    borrowCnt: event.borrowCnt,
    outputs: event.outputs,
    filterSamples: event.filterSamples,
    poly4: event.poly4,
    poly5: event.poly5,
    poly9: event.poly9,
    poly17: event.poly17,
    clockCnt28: event.clockCnt28,
    clockCnt114: event.clockCnt114,
  };
}

function pokeyWriteRegNumber(write: PokeyWriteTraceEvent): number | undefined {
  const parsed = Number.parseInt(write.reg, 16);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function pokeyWriteContext(write: PokeyWriteTraceEvent, transitionCycle: number): PokeyRawTraceWriteContext {
  return {
    index: write.index,
    source: write.source,
    cycle: write.cycle,
    applyCycle: write.applyCycle,
    cyclesSinceApply: transitionCycle - write.applyCycle,
    applyDelayCycles: write.applyDelayCycles,
    frame: write.frame,
    cycleInFrame: write.cycleInFrame,
    rawCycle: write.rawCycle,
    rawCycleInFrame: write.rawCycleInFrame,
    pc: write.pc,
    reg: write.reg,
    val: write.val,
  };
}

function recentPokeyWritesBefore(
  writes: readonly PokeyWriteTraceEvent[] | undefined,
  transitionCycle: number,
  limit: number,
  relevantRegs?: ReadonlySet<number>,
): PokeyRawTraceWriteContext[] {
  if (writes === undefined || limit <= 0) return [];
  const out: PokeyRawTraceWriteContext[] = [];
  for (let i = writes.length - 1; i >= 0 && out.length < limit; i--) {
    const write = writes[i]!;
    if (write.applyCycle > transitionCycle) continue;
    if (relevantRegs !== undefined) {
      const reg = pokeyWriteRegNumber(write);
      if (reg === undefined || !relevantRegs.has(reg)) continue;
    }
    out.push(pokeyWriteContext(write, transitionCycle));
  }
  out.reverse();
  return out;
}

function lastRelevantPokeyWriteBefore(
  writes: readonly PokeyWriteTraceEvent[] | undefined,
  transitionCycle: number,
  relevantRegs: ReadonlySet<number>,
): PokeyRawTraceWriteContext | undefined {
  const recent = recentPokeyWritesBefore(writes, transitionCycle, 1, relevantRegs);
  return recent.length === 0 ? undefined : recent[recent.length - 1];
}

function pokeyWriteSignature(write: PokeyRawTraceWriteContext | undefined): string {
  if (write === undefined) return "none";
  return `${write.pc ?? "?"}:${write.reg}:${write.val}`;
}

function pokeyWriteCycleInFrame(write: PokeyRawTraceWriteContext | undefined): number | undefined {
  return write?.rawCycleInFrame ?? write?.cycleInFrame;
}

function createPokeyRawTracePcmResidualTimingRun(
  signature: string,
  index: number,
  tsEvent: PokeyRawTraceEvent,
  refEvent: PokeyRawTraceEvent,
  tsLastRelevantWrite: PokeyRawTraceWriteContext | undefined,
  referenceLastRelevantWrite: PokeyRawTraceWriteContext | undefined,
): PokeyRawTracePcmResidualTimingRunAccumulator {
  return {
    signature,
    startIndex: index,
    endIndex: index,
    count: 0,
    firstTs: pokeyTraceEventContext(tsEvent),
    firstReference: pokeyTraceEventContext(refEvent),
    lastTs: pokeyTraceEventContext(tsEvent),
    lastReference: pokeyTraceEventContext(refEvent),
    firstTsLastRelevantWrite: tsLastRelevantWrite,
    firstReferenceLastRelevantWrite: referenceLastRelevantWrite,
    lastTsLastRelevantWrite: tsLastRelevantWrite,
    lastReferenceLastRelevantWrite: referenceLastRelevantWrite,
    outputSampleDeltaHistogram: {},
    cycleDeltaResidualHistogram: {},
    bestLagHistogram: {},
    rawTransitionHistogram: {},
    counterDeltaHistogram: {},
    polyDeltaHistogram: {},
    polyModuloDeltaHistogram: {},
    polyClockDeltaHistogram: {},
    polyClockDelta28TicksHistogram: {},
    changedChannelHistogram: {},
    changedChannelCounterDeltaHistogram: {},
    changedChannelBorrowCntDeltaHistogram: {},
    changedChannelOutputDeltaHistogram: {},
    clockCnt28DeltaHistogram: {},
    clockCnt114DeltaHistogram: {},
    tsLastRelevantWriteHistogram: {},
    referenceLastRelevantWriteHistogram: {},
    lastRelevantWritePairHistogram: {},
    transitionCycleModulo28DeltaHistogram: {},
    transitionCycleModulo114DeltaHistogram: {},
    lastRelevantApplyCycleDeltaHistogram: {},
    lastRelevantApplyCycleModulo28DeltaHistogram: {},
    lastRelevantApplyCycleModulo114DeltaHistogram: {},
    lastRelevantCyclesSinceApplyDeltaHistogram: {},
    lastRelevantCyclesSinceApplyModulo28DeltaHistogram: {},
    lastRelevantCyclesSinceApplyModulo114DeltaHistogram: {},
    lastRelevantApplyDelayDeltaHistogram: {},
    lastRelevantCycleInFrameDeltaHistogram: {},
    lastRelevantFrameHistogram: {},
    sameOutputRmsSum: 0,
    sameOutputRmsMax: 0,
    eventAlignedRmsSum: 0,
    eventAlignedRmsMax: 0,
    bestLagRmsSum: 0,
    bestLagRmsMax: 0,
  };
}

function addPokeyRawTracePcmResidualTimingRunEvent(
  acc: PokeyRawTracePcmResidualTimingRunAccumulator,
  index: number,
  tsEvent: PokeyRawTraceEvent,
  refEvent: PokeyRawTraceEvent,
  sameOutput: LocalPcmResidualStats,
  eventAligned: LocalPcmResidualStats,
  bestLag: LocalPcmResidualStats,
  outputSampleDelta: number,
  cycleDeltaResidual: number | undefined,
  rawTransition: string,
  counterDelta: readonly number[],
  polyDelta: readonly number[],
  polyModuloDelta: readonly number[],
  changedChannels: readonly number[],
  borrowCntDelta: readonly number[],
  outputDelta: readonly number[],
  clockCnt28Delta: number | undefined,
  clockCnt114Delta: number | undefined,
  tsLastRelevantWrite: PokeyRawTraceWriteContext | undefined,
  referenceLastRelevantWrite: PokeyRawTraceWriteContext | undefined,
): void {
  const tsSignature = pokeyWriteSignature(tsLastRelevantWrite);
  const referenceSignature = pokeyWriteSignature(referenceLastRelevantWrite);
  const tsCycleInFrame = pokeyWriteCycleInFrame(tsLastRelevantWrite);
  const referenceCycleInFrame = pokeyWriteCycleInFrame(referenceLastRelevantWrite);
  acc.endIndex = index;
  acc.count++;
  acc.lastTs = pokeyTraceEventContext(tsEvent);
  acc.lastReference = pokeyTraceEventContext(refEvent);
  acc.lastTsLastRelevantWrite = tsLastRelevantWrite;
  acc.lastReferenceLastRelevantWrite = referenceLastRelevantWrite;
  acc.sameOutputRmsSum += sameOutput.rms;
  acc.sameOutputRmsMax = Math.max(acc.sameOutputRmsMax, sameOutput.rms);
  acc.eventAlignedRmsSum += eventAligned.rms;
  acc.eventAlignedRmsMax = Math.max(acc.eventAlignedRmsMax, eventAligned.rms);
  acc.bestLagRmsSum += bestLag.rms;
  acc.bestLagRmsMax = Math.max(acc.bestLagRmsMax, bestLag.rms);
  incrementHistogram(acc.outputSampleDeltaHistogram, outputSampleDelta);
  if (cycleDeltaResidual !== undefined) incrementHistogram(acc.cycleDeltaResidualHistogram, cycleDeltaResidual);
  incrementHistogram(acc.bestLagHistogram, bestLag.lag ?? 0);
  incrementHistogram(acc.rawTransitionHistogram, rawTransition);
  incrementHistogram(acc.counterDeltaHistogram, counterDelta.join(","));
  incrementHistogram(acc.polyDeltaHistogram, polyDelta.join(","));
  incrementHistogram(acc.polyModuloDeltaHistogram, polyModuloDelta.join(","));
  const polyClockDelta = inferPokeyPolyClockDelta(polyModuloDelta);
  const polyClockDelta28Ticks =
    polyClockDelta === undefined || polyClockDelta % 28 !== 0 ? undefined : polyClockDelta / 28;
  if (polyClockDelta !== undefined) incrementHistogram(acc.polyClockDeltaHistogram, polyClockDelta);
  if (polyClockDelta28Ticks !== undefined) {
    incrementHistogram(acc.polyClockDelta28TicksHistogram, polyClockDelta28Ticks);
  }
  incrementHistogram(acc.changedChannelHistogram, changedChannels.join(",") || "none");
  incrementHistogram(acc.changedChannelCounterDeltaHistogram, formatChangedChannelDeltas(changedChannels, counterDelta));
  incrementHistogram(
    acc.changedChannelBorrowCntDeltaHistogram,
    formatChangedChannelDeltas(changedChannels, borrowCntDelta),
  );
  incrementHistogram(acc.changedChannelOutputDeltaHistogram, formatChangedChannelDeltas(changedChannels, outputDelta));
  if (clockCnt28Delta !== undefined) incrementHistogram(acc.clockCnt28DeltaHistogram, clockCnt28Delta);
  if (clockCnt114Delta !== undefined) incrementHistogram(acc.clockCnt114DeltaHistogram, clockCnt114Delta);
  incrementHistogram(acc.tsLastRelevantWriteHistogram, tsSignature);
  incrementHistogram(acc.referenceLastRelevantWriteHistogram, referenceSignature);
  incrementHistogram(
    acc.lastRelevantWritePairHistogram,
    tsSignature === referenceSignature ? `${tsSignature}/same` : `${tsSignature}/${referenceSignature}`,
  );
  incrementModuloDeltaHistogram(acc.transitionCycleModulo28DeltaHistogram, tsEvent.cycle, refEvent.cycle, 28);
  incrementModuloDeltaHistogram(acc.transitionCycleModulo114DeltaHistogram, tsEvent.cycle, refEvent.cycle, 114);
  if (tsLastRelevantWrite !== undefined && referenceLastRelevantWrite !== undefined) {
    incrementHistogram(
      acc.lastRelevantApplyCycleDeltaHistogram,
      tsLastRelevantWrite.applyCycle - referenceLastRelevantWrite.applyCycle,
    );
    incrementModuloDeltaHistogram(
      acc.lastRelevantApplyCycleModulo28DeltaHistogram,
      tsLastRelevantWrite.applyCycle,
      referenceLastRelevantWrite.applyCycle,
      28,
    );
    incrementModuloDeltaHistogram(
      acc.lastRelevantApplyCycleModulo114DeltaHistogram,
      tsLastRelevantWrite.applyCycle,
      referenceLastRelevantWrite.applyCycle,
      114,
    );
    incrementHistogram(
      acc.lastRelevantCyclesSinceApplyDeltaHistogram,
      tsLastRelevantWrite.cyclesSinceApply - referenceLastRelevantWrite.cyclesSinceApply,
    );
    incrementModuloDeltaHistogram(
      acc.lastRelevantCyclesSinceApplyModulo28DeltaHistogram,
      tsLastRelevantWrite.cyclesSinceApply,
      referenceLastRelevantWrite.cyclesSinceApply,
      28,
    );
    incrementModuloDeltaHistogram(
      acc.lastRelevantCyclesSinceApplyModulo114DeltaHistogram,
      tsLastRelevantWrite.cyclesSinceApply,
      referenceLastRelevantWrite.cyclesSinceApply,
      114,
    );
    if (
      tsLastRelevantWrite.applyDelayCycles !== undefined &&
      referenceLastRelevantWrite.applyDelayCycles !== undefined
    ) {
      incrementHistogram(
        acc.lastRelevantApplyDelayDeltaHistogram,
        tsLastRelevantWrite.applyDelayCycles - referenceLastRelevantWrite.applyDelayCycles,
      );
    }
  }
  if (tsCycleInFrame !== undefined && referenceCycleInFrame !== undefined) {
    incrementHistogram(acc.lastRelevantCycleInFrameDeltaHistogram, tsCycleInFrame - referenceCycleInFrame);
  }
  if (tsLastRelevantWrite?.frame !== undefined || referenceLastRelevantWrite?.frame !== undefined) {
    incrementHistogram(
      acc.lastRelevantFrameHistogram,
      `${tsLastRelevantWrite?.frame ?? "?"}/${referenceLastRelevantWrite?.frame ?? "?"}`,
    );
  }
}

function finalizePokeyRawTracePcmResidualTimingRun(
  acc: PokeyRawTracePcmResidualTimingRunAccumulator,
): PokeyRawTracePcmResidualTimingRun {
  return {
    startIndex: acc.startIndex,
    endIndex: acc.endIndex,
    count: acc.count,
    firstTs: acc.firstTs,
    firstReference: acc.firstReference,
    lastTs: acc.lastTs,
    lastReference: acc.lastReference,
    firstTsLastRelevantWrite: acc.firstTsLastRelevantWrite,
    firstReferenceLastRelevantWrite: acc.firstReferenceLastRelevantWrite,
    lastTsLastRelevantWrite: acc.lastTsLastRelevantWrite,
    lastReferenceLastRelevantWrite: acc.lastReferenceLastRelevantWrite,
    outputSampleDeltaHistogram: acc.outputSampleDeltaHistogram,
    cycleDeltaResidualHistogram: acc.cycleDeltaResidualHistogram,
    bestLagHistogram: acc.bestLagHistogram,
    rawTransitionHistogram: acc.rawTransitionHistogram,
    counterDeltaHistogram: acc.counterDeltaHistogram,
    polyDeltaHistogram: acc.polyDeltaHistogram,
    polyModuloDeltaHistogram: acc.polyModuloDeltaHistogram,
    polyClockDeltaHistogram: acc.polyClockDeltaHistogram,
    polyClockDelta28TicksHistogram: acc.polyClockDelta28TicksHistogram,
    changedChannelHistogram: acc.changedChannelHistogram,
    changedChannelCounterDeltaHistogram: acc.changedChannelCounterDeltaHistogram,
    changedChannelBorrowCntDeltaHistogram: acc.changedChannelBorrowCntDeltaHistogram,
    changedChannelOutputDeltaHistogram: acc.changedChannelOutputDeltaHistogram,
    clockCnt28DeltaHistogram: acc.clockCnt28DeltaHistogram,
    clockCnt114DeltaHistogram: acc.clockCnt114DeltaHistogram,
    tsLastRelevantWriteHistogram: acc.tsLastRelevantWriteHistogram,
    referenceLastRelevantWriteHistogram: acc.referenceLastRelevantWriteHistogram,
    lastRelevantWritePairHistogram: acc.lastRelevantWritePairHistogram,
    transitionCycleModulo28DeltaHistogram: acc.transitionCycleModulo28DeltaHistogram,
    transitionCycleModulo114DeltaHistogram: acc.transitionCycleModulo114DeltaHistogram,
    lastRelevantApplyCycleDeltaHistogram: acc.lastRelevantApplyCycleDeltaHistogram,
    lastRelevantApplyCycleModulo28DeltaHistogram: acc.lastRelevantApplyCycleModulo28DeltaHistogram,
    lastRelevantApplyCycleModulo114DeltaHistogram: acc.lastRelevantApplyCycleModulo114DeltaHistogram,
    lastRelevantCyclesSinceApplyDeltaHistogram: acc.lastRelevantCyclesSinceApplyDeltaHistogram,
    lastRelevantCyclesSinceApplyModulo28DeltaHistogram: acc.lastRelevantCyclesSinceApplyModulo28DeltaHistogram,
    lastRelevantCyclesSinceApplyModulo114DeltaHistogram: acc.lastRelevantCyclesSinceApplyModulo114DeltaHistogram,
    lastRelevantApplyDelayDeltaHistogram: acc.lastRelevantApplyDelayDeltaHistogram,
    lastRelevantCycleInFrameDeltaHistogram: acc.lastRelevantCycleInFrameDeltaHistogram,
    lastRelevantFrameHistogram: acc.lastRelevantFrameHistogram,
    sameOutputRmsMean: acc.sameOutputRmsSum / acc.count,
    sameOutputRmsMax: acc.sameOutputRmsMax,
    eventAlignedRmsMean: acc.eventAlignedRmsSum / acc.count,
    eventAlignedRmsMax: acc.eventAlignedRmsMax,
    bestLagRmsMean: acc.bestLagRmsSum / acc.count,
    bestLagRmsMax: acc.bestLagRmsMax,
  };
}

function comparePokeyRawTracePcmResiduals(
  ts: PokeyRawTrace | undefined,
  reference: PokeyRawTrace | undefined,
  tsSignal: Float32Array,
  referenceSignal: Float32Array | undefined,
  radius: number,
  maxLag: number,
  tsWrites: readonly PokeyWriteTraceEvent[] | undefined = undefined,
  referenceWrites: readonly PokeyWriteTraceEvent[] | undefined = undefined,
): PokeyRawTracePcmResidualComparison | undefined {
  if (ts === undefined || reference === undefined || referenceSignal === undefined || radius < 0) return undefined;
  const compared = Math.min(ts.events.length, reference.events.length);
  const cycleDeltaHistogram: Record<string, number> = {};
  for (let i = 0; i < compared; i++) {
    incrementHistogram(cycleDeltaHistogram, reference.events[i]!.cycle - ts.events[i]!.cycle);
  }
  const cycleDeltaMode = numericHistogramMode(cycleDeltaHistogram);
  const sameOutputAcc = createLocalPcmResidualAccumulator();
  const eventAlignedAcc = createLocalPcmResidualAccumulator();
  const bestLagAcc = createLocalPcmResidualAccumulator();
  const bestLagHistogram: Record<string, number> = {};
  const byBestLag = new Map<string, PokeyPcmResidualBucketAccumulator>();
  const byCycleDeltaResidual = new Map<string, PokeyPcmResidualBucketAccumulator>();
  const byOutputSampleDelta = new Map<string, {
    count: number;
    sameOutputRmsSum: number;
    sameOutputRmsMax: number;
    eventAlignedRmsSum: number;
    eventAlignedRmsMax: number;
    bestLagRmsSum: number;
    bestLagRmsMax: number;
    eventAlignedRmsImprovementSum: number;
    eventAlignedRmsImprovementMax: number;
    bestLagRmsImprovementSum: number;
    bestLagRmsImprovementMax: number;
  }>();
  const transitionGroups = new Map<string, PokeyPcmResidualTransitionGroupAccumulator>();
  const timingContextSamples: PokeyRawTracePcmResidualContextSample[] = [];
  const outputContextSamples: PokeyRawTracePcmResidualContextSample[] = [];
  const timingRunAccs: PokeyRawTracePcmResidualTimingRunAccumulator[] = [];
  let activeTimingRun: PokeyRawTracePcmResidualTimingRunAccumulator | undefined;
  const relevantPokeyTimingRegs = new Set([0x04, 0x05, 0x08, 0x09, 0x0f]);
  const bucketFor = (
    map: Map<string, PokeyPcmResidualBucketAccumulator>,
    key: string,
  ): PokeyPcmResidualBucketAccumulator => {
    const existing = map.get(key);
    if (existing !== undefined) return existing;
    const created = createPokeyPcmResidualBucketAccumulator();
    map.set(key, created);
    return created;
  };
  const finishTimingRun = (): void => {
    if (activeTimingRun === undefined) return;
    timingRunAccs.push(activeTimingRun);
    activeTimingRun = undefined;
  };
  const entries: Array<PokeyRawTracePcmResidualComparison["worstSameOutput"][number]> = [];
  let skipped = 0;
  for (let i = 0; i < compared; i++) {
    const tsEvent = ts.events[i]!;
    const refEvent = reference.events[i]!;
    const tsCenter = tsEvent.estimatedOutputSample;
    const refCenter = refEvent.estimatedOutputSample;
    const sameOutput = localPcmResidualStats(tsSignal, referenceSignal, tsCenter, tsCenter, radius);
    const eventAligned = localPcmResidualStats(tsSignal, referenceSignal, tsCenter, refCenter, radius);
    const bestLag = bestLocalPcmResidualStats(
      tsSignal,
      referenceSignal,
      tsCenter,
      tsCenter,
      radius,
      maxLag,
    );
    if (sameOutput === undefined || eventAligned === undefined || bestLag === undefined) {
      skipped++;
      continue;
    }
    addLocalPcmResidual(sameOutputAcc, sameOutput);
    addLocalPcmResidual(eventAlignedAcc, eventAligned);
    addLocalPcmResidual(bestLagAcc, bestLag);
    incrementHistogram(bestLagHistogram, bestLag.lag ?? 0);
    const outputSampleDelta = tsCenter - refCenter;
    const cycleDelta = refEvent.cycle - tsEvent.cycle;
    const cycleDeltaResidual = cycleDeltaMode === undefined ? undefined : cycleDelta - cycleDeltaMode;
    const rawMatch = tsEvent.raw === refEvent.raw && tsEvent.prevRaw === refEvent.prevRaw;
    const rawTransition = `${tsEvent.prevRaw}->${tsEvent.raw}`;
    const bestLagValue = bestLag.lag ?? 0;
    const counterDelta = tsEvent.counters.map((value, ch) => value - (refEvent.counters[ch] ?? 0));
    const tsPoly = pokeyPolyState(tsEvent);
    const refPoly = pokeyPolyState(refEvent);
    const polyDelta = tsPoly.map((value, index) => value - (refPoly[index] ?? 0));
    const polyModuloDelta = pokeyPolyModuloDelta(tsEvent, refEvent);
    const polyClockDelta = inferPokeyPolyClockDelta(polyModuloDelta);
    const polyClockDelta28Ticks =
      polyClockDelta === undefined || polyClockDelta % 28 !== 0 ? undefined : polyClockDelta / 28;
    const changedChannels = pokeyChangedChannels(tsEvent);
    const borrowCntDelta = tsEvent.borrowCnt.map((value, ch) => value - (refEvent.borrowCnt[ch] ?? 0));
    const outputDelta = tsEvent.outputs.map((value, ch) => value - (refEvent.outputs[ch] ?? 0));
    const clockCnt28Delta = tsEvent.clockCnt28 === undefined || refEvent.clockCnt28 === undefined
      ? undefined
      : tsEvent.clockCnt28 - refEvent.clockCnt28;
    const clockCnt114Delta = tsEvent.clockCnt114 === undefined || refEvent.clockCnt114 === undefined
      ? undefined
      : tsEvent.clockCnt114 - refEvent.clockCnt114;
    const timingAnomaly = (cycleDeltaResidual !== undefined && cycleDeltaResidual !== 0) || bestLagValue !== 0;
    const timingRunSignature = `res=${cycleDeltaResidual ?? "unknown"}|lag=${bestLagValue}`;
    if (timingAnomaly) {
      const tsLastRelevantWrite = lastRelevantPokeyWriteBefore(tsWrites, tsEvent.cycle, relevantPokeyTimingRegs);
      const referenceLastRelevantWrite =
        lastRelevantPokeyWriteBefore(referenceWrites, refEvent.cycle, relevantPokeyTimingRegs);
      if (
        activeTimingRun === undefined ||
        activeTimingRun.endIndex + 1 !== i ||
        activeTimingRun.signature !== timingRunSignature
      ) {
        finishTimingRun();
        activeTimingRun = createPokeyRawTracePcmResidualTimingRun(
          timingRunSignature,
          i,
          tsEvent,
          refEvent,
          tsLastRelevantWrite,
          referenceLastRelevantWrite,
        );
      }
      addPokeyRawTracePcmResidualTimingRunEvent(
        activeTimingRun,
        i,
        tsEvent,
        refEvent,
        sameOutput,
        eventAligned,
        bestLag,
        outputSampleDelta,
        cycleDeltaResidual,
        rawTransition,
        counterDelta,
        polyDelta,
        polyModuloDelta,
        changedChannels,
        borrowCntDelta,
        outputDelta,
        clockCnt28Delta,
        clockCnt114Delta,
        tsLastRelevantWrite,
        referenceLastRelevantWrite,
      );
    } else {
      finishTimingRun();
    }
    addPokeyPcmResidualBucket(
      bucketFor(byBestLag, String(bestLagValue)),
      i,
      sameOutput,
      eventAligned,
      bestLag,
      outputSampleDelta,
      cycleDeltaResidual,
      rawTransition,
      counterDelta,
      polyDelta,
      polyModuloDelta,
      changedChannels,
      borrowCntDelta,
      outputDelta,
      clockCnt28Delta,
      clockCnt114Delta,
    );
    addPokeyPcmResidualBucket(
      bucketFor(byCycleDeltaResidual, cycleDeltaResidual === undefined ? "unknown" : String(cycleDeltaResidual)),
      i,
      sameOutput,
      eventAligned,
      bestLag,
      outputSampleDelta,
      cycleDeltaResidual,
      rawTransition,
      counterDelta,
      polyDelta,
      polyModuloDelta,
      changedChannels,
      borrowCntDelta,
      outputDelta,
      clockCnt28Delta,
      clockCnt114Delta,
    );
    const contextSample = (): PokeyRawTracePcmResidualContextSample => ({
        index: i,
        outputSampleDelta,
        cycleDelta,
        cycleDeltaResidual,
        bestLag: bestLagValue,
        counterDelta,
        polyDelta,
        polyModuloDelta,
        polyClockDelta,
        polyClockDelta28Ticks,
        outputDelta,
        clockCnt28Delta,
        clockCnt114Delta,
        ts: pokeyTraceEventContext(tsEvent),
        reference: pokeyTraceEventContext(refEvent),
        tsRecentWrites: recentPokeyWritesBefore(tsWrites, tsEvent.cycle, 8),
        referenceRecentWrites: recentPokeyWritesBefore(referenceWrites, refEvent.cycle, 8),
        tsRecentRelevantWrites: recentPokeyWritesBefore(tsWrites, tsEvent.cycle, 8, relevantPokeyTimingRegs),
        referenceRecentRelevantWrites:
          recentPokeyWritesBefore(referenceWrites, refEvent.cycle, 8, relevantPokeyTimingRegs),
      });
    if ((cycleDeltaResidual !== undefined && cycleDeltaResidual !== 0) || bestLagValue !== 0) {
      if (timingContextSamples.length < 64) timingContextSamples.push(contextSample());
    } else if (outputSampleDelta !== 0 && outputContextSamples.length < 64) {
      outputContextSamples.push(contextSample());
    }
    const key = String(outputSampleDelta);
    const prev = byOutputSampleDelta.get(key) ?? {
      count: 0,
      sameOutputRmsSum: 0,
      sameOutputRmsMax: 0,
      eventAlignedRmsSum: 0,
      eventAlignedRmsMax: 0,
      bestLagRmsSum: 0,
      bestLagRmsMax: 0,
      eventAlignedRmsImprovementSum: 0,
      eventAlignedRmsImprovementMax: Number.NEGATIVE_INFINITY,
      bestLagRmsImprovementSum: 0,
      bestLagRmsImprovementMax: Number.NEGATIVE_INFINITY,
    };
    const eventAlignedImprovement = sameOutput.rms - eventAligned.rms;
    const bestLagImprovement = sameOutput.rms - bestLag.rms;
    byOutputSampleDelta.set(key, {
      count: prev.count + 1,
      sameOutputRmsSum: prev.sameOutputRmsSum + sameOutput.rms,
      sameOutputRmsMax: Math.max(prev.sameOutputRmsMax, sameOutput.rms),
      eventAlignedRmsSum: prev.eventAlignedRmsSum + eventAligned.rms,
      eventAlignedRmsMax: Math.max(prev.eventAlignedRmsMax, eventAligned.rms),
      bestLagRmsSum: prev.bestLagRmsSum + bestLag.rms,
      bestLagRmsMax: Math.max(prev.bestLagRmsMax, bestLag.rms),
      eventAlignedRmsImprovementSum: prev.eventAlignedRmsImprovementSum + eventAlignedImprovement,
      eventAlignedRmsImprovementMax: Math.max(prev.eventAlignedRmsImprovementMax, eventAlignedImprovement),
      bestLagRmsImprovementSum: prev.bestLagRmsImprovementSum + bestLagImprovement,
      bestLagRmsImprovementMax: Math.max(prev.bestLagRmsImprovementMax, bestLagImprovement),
    });
    const transitionGroupKey =
      `${rawTransition}|out=${outputSampleDelta}|res=${cycleDeltaResidual ?? "unknown"}|lag=${bestLagValue}`;
    const transitionGroup = transitionGroups.get(transitionGroupKey);
    if (transitionGroup === undefined) {
      transitionGroups.set(transitionGroupKey, {
        prevRaw: tsEvent.prevRaw,
        raw: tsEvent.raw,
        prevChannels: tsEvent.prevChannels,
        channels: tsEvent.channels,
        audf: tsEvent.audf,
        audc: tsEvent.audc,
        audctl: tsEvent.audctl,
        skctl: tsEvent.skctl,
        outputSampleDelta,
        cycleDeltaResidual,
        bestLag: bestLagValue,
        count: 1,
        firstIndex: i,
        lastIndex: i,
        sameOutputRmsSum: sameOutput.rms,
        eventAlignedRmsSum: eventAligned.rms,
        bestLagRmsSum: bestLag.rms,
        bestLagRmsMax: bestLag.rms,
        bestLagRmsImprovementSum: bestLagImprovement,
      });
    } else {
      transitionGroups.set(transitionGroupKey, {
        ...transitionGroup,
        count: transitionGroup.count + 1,
        lastIndex: i,
        sameOutputRmsSum: transitionGroup.sameOutputRmsSum + sameOutput.rms,
        eventAlignedRmsSum: transitionGroup.eventAlignedRmsSum + eventAligned.rms,
        bestLagRmsSum: transitionGroup.bestLagRmsSum + bestLag.rms,
        bestLagRmsMax: Math.max(transitionGroup.bestLagRmsMax, bestLag.rms),
        bestLagRmsImprovementSum: transitionGroup.bestLagRmsImprovementSum + bestLagImprovement,
      });
    }
    entries.push({
      index: i,
      prevRaw: tsEvent.prevRaw,
      raw: tsEvent.raw,
      rawMatch,
      prevChannels: tsEvent.prevChannels,
      channels: tsEvent.channels,
      outputSampleDelta,
      cycleDelta,
      cycleDeltaResidual,
      tsEstimatedOutputSample: tsCenter,
      referenceEstimatedOutputSample: refCenter,
      sameOutput,
      eventAligned,
      bestLag,
    });
  }
  finishTimingRun();
  const byOutputSampleDeltaJson: PokeyRawTracePcmResidualComparison["byOutputSampleDelta"] = {};
  for (const [key, value] of byOutputSampleDelta) {
    byOutputSampleDeltaJson[key] = {
      count: value.count,
      sameOutputRmsMean: value.sameOutputRmsSum / value.count,
      sameOutputRmsMax: value.sameOutputRmsMax,
      eventAlignedRmsMean: value.eventAlignedRmsSum / value.count,
      eventAlignedRmsMax: value.eventAlignedRmsMax,
      bestLagRmsMean: value.bestLagRmsSum / value.count,
      bestLagRmsMax: value.bestLagRmsMax,
      eventAlignedRmsImprovementMean: value.eventAlignedRmsImprovementSum / value.count,
      eventAlignedRmsImprovementMax: value.eventAlignedRmsImprovementMax,
      bestLagRmsImprovementMean: value.bestLagRmsImprovementSum / value.count,
      bestLagRmsImprovementMax: value.bestLagRmsImprovementMax,
    };
  }
  const sortedBySameOutput = entries.slice().sort((a, b) => b.sameOutput.rms - a.sameOutput.rms);
  const sortedByEventAligned = entries.slice().sort((a, b) => b.eventAligned.rms - a.eventAligned.rms);
  const sortedByBestLag = entries.slice().sort((a, b) => b.bestLag.rms - a.bestLag.rms);
  const topTransitionGroups = Array.from(transitionGroups.values())
    .map(finalizePokeyPcmResidualTransitionGroup)
    .sort((a, b) =>
      b.count - a.count ||
      b.bestLagRmsImprovementMean - a.bestLagRmsImprovementMean ||
      a.firstIndex - b.firstIndex)
    .slice(0, 16);
  const topImprovingTransitionGroups = Array.from(transitionGroups.values())
    .map(finalizePokeyPcmResidualTransitionGroup)
    .sort((a, b) =>
      b.bestLagRmsImprovementMean - a.bestLagRmsImprovementMean ||
      b.count - a.count ||
      a.firstIndex - b.firstIndex)
    .slice(0, 16);
  const topTimingRuns = timingRunAccs
    .map(finalizePokeyRawTracePcmResidualTimingRun)
    .sort((a, b) =>
      b.count - a.count ||
      b.bestLagRmsMax - a.bestLagRmsMax ||
      a.startIndex - b.startIndex)
    .slice(0, 16);
  return {
    radius,
    maxLag,
    compared: entries.length,
    skipped,
    cycleDeltaMode,
    sameOutput: finalizeLocalPcmResidualAggregate(sameOutputAcc),
    eventAligned: finalizeLocalPcmResidualAggregate(eventAlignedAcc),
    bestLag: finalizeLocalPcmResidualAggregate(bestLagAcc),
    bestLagHistogram,
    byBestLag: finalizePokeyPcmResidualBucketMap(byBestLag),
    byCycleDeltaResidual: finalizePokeyPcmResidualBucketMap(byCycleDeltaResidual),
    byOutputSampleDelta: byOutputSampleDeltaJson,
    topTransitionGroups,
    topImprovingTransitionGroups,
    topTimingRuns,
    contextSamples: [...timingContextSamples, ...outputContextSamples].slice(0, 64),
    worstSameOutput: sortedBySameOutput.slice(0, 16),
    worstEventAligned: sortedByEventAligned.slice(0, 16),
    worstBestLag: sortedByBestLag.slice(0, 16),
  };
}

function compactArrayReport<T>(
  values: readonly T[] | undefined,
  edgeCount = 8,
): { readonly count: number; readonly first: readonly T[]; readonly last: readonly T[] } | undefined {
  if (values === undefined) return undefined;
  const edge = Math.max(0, Math.trunc(edgeCount));
  if (edge === 0) return { count: values.length, first: [], last: [] };
  return {
    count: values.length,
    first: values.slice(0, edge),
    last: values.slice(Math.max(edge, values.length - edge)),
  };
}

function pokeyRawTraceReport(trace: PokeyRawTrace | undefined, compact: boolean): PokeyRawTrace | unknown {
  if (trace === undefined || !compact) return trace;
  const { events, ...summary } = trace;
  return { ...summary, events: compactArrayReport(events) };
}

function pokeyRawTraceComparisonReport(
  comparison: PokeyRawTraceComparison | undefined,
  compact: boolean,
): PokeyRawTraceComparison | unknown {
  if (comparison === undefined || !compact) return comparison;
  const {
    pairs,
    rawOutputSampleDeltaHistogram,
    rawTransitionOutputSampleDeltaHistogram,
    ...summary
  } = comparison;
  return {
    ...summary,
    rawOutputSampleDeltaTop: numericHistogramTop(rawOutputSampleDeltaHistogram, 16),
    rawTransitionOutputSampleDeltaTop: numericHistogramTop(rawTransitionOutputSampleDeltaHistogram, 16),
    pairs: compactArrayReport(pairs),
  };
}

function pokeyRawTracePcmResidualComparisonReport(
  comparison: PokeyRawTracePcmResidualComparison | undefined,
  compact: boolean,
): PokeyRawTracePcmResidualComparison | unknown {
  if (comparison === undefined || !compact) return comparison;
  return {
    ...comparison,
    contextSamples: compactArrayReport(comparison.contextSamples, 4),
    worstSameOutput: compactArrayReport(comparison.worstSameOutput, 4),
    worstEventAligned: compactArrayReport(comparison.worstEventAligned, 4),
    worstBestLag: compactArrayReport(comparison.worstBestLag, 4),
  };
}

function offsetChipWriteCycle(write: MameChipWrite, pokeyWriteCycleOffset: number): bigint {
  if (write.kind !== "pokey" || pokeyWriteCycleOffset === 0) return write.cycle;
  const shifted = write.cycle + BigInt(pokeyWriteCycleOffset);
  return shifted < 0n ? 0n : shifted;
}

function effectiveYmSampleRate(
  ymNativeSampleRate: number | undefined,
  ymScheduler: Args["ymScheduler"],
): number {
  if (ymNativeSampleRate !== undefined) return ymNativeSampleRate;
  if (ymScheduler === "mame-stream") return Math.trunc(YM2151_NATIVE_SAMPLE_RATE);
  return YM2151_NATIVE_SAMPLE_RATE;
}

function directChipWriteCycleRateForMode(
  mode: Args["directChipWriteCycleRateMode"],
  ym: ReturnType<typeof createYM2151> | undefined,
  pokey: ReturnType<typeof createPOKEY> | undefined,
  ymScheduler: Args["ymScheduler"],
): number {
  if (mode === "sound") return SOUND_CMD_TAPE_CPU_HZ;
  if (mode === "pokey") return POKEY_CLOCK_HZ;
  return pokey !== undefined && (ym === undefined || ymScheduler === "mame-stream")
    ? POKEY_CLOCK_HZ
    : SOUND_CMD_TAPE_CPU_HZ;
}

function renderMameChipWrites(
  dstRate: number,
  dstSamples: number,
  mameYmWrites: string | undefined,
  mamePokeyWrites: string | undefined,
  captureYmChannels = false,
  capturePokeyChannels = false,
  ymPhaseAdvanceAfterOutput = false,
  ymNativeSampleRateArg: number | undefined = undefined,
  ymScheduler: Args["ymScheduler"] = "cycle",
  ymResampleOffset = 0,
  pokeyResampleOffset = 0,
  pokeyWriteCycleOffset = 0,
  pokeySampleCycles = 28,
  pokeySampleAfterClock = false,
  resampler: Args["resampler"] = "linear",
  ymResampler: Args["ymResampler"] = resampler,
  pokeyResampler: Args["pokeyResampler"] = resampler,
  ymOutputSampleOffset = 0,
  pokeyOutputSampleOffset = 0,
  cmdTapePath = "oracle/scenarios/sound-cmd-tape-attract-cycle-precise.json",
  directChipWriteOrigin: Args["directChipWriteOrigin"] = "absolute",
  directChipWriteSampleTiming: Args["directChipWriteSampleTiming"] = "attos",
  directChipWriteCycleTiming: Args["directChipWriteCycleTiming"] = "attos",
  directChipWriteCycleRateMode: Args["directChipWriteCycleRateMode"] = "auto",
  directYmWriteSampleOffset = 0,
  directYmWriteSampleOffsetRegs: ReadonlyMap<number, number> = new Map(),
  directYmWriteSampleOffsetMatches: readonly DirectYmWriteSampleOffsetMatch[] = [],
  ymStateTraceChannel: number | undefined = undefined,
  ymStateTraceNativeStart = 0,
  ymStateTraceNativeEnd = 0,
  pokeyRawTraceCenterSample: number | undefined = undefined,
  pokeyRawTraceRadius = 0,
): RenderedTsAudio {
  const ym = mameYmWrites === undefined ? undefined : createYM2151();
  const pokey = mamePokeyWrites === undefined ? undefined : createPOKEY();
  const ymLeft: number[] = [];
  const ymChannelLeft = captureYmChannels && ym !== undefined
    ? Array.from({ length: 8 }, () => [] as number[])
    : undefined;
  if (ym !== undefined && captureYmChannels) setDirectYmDiagnosticChannelSamples(ym, true);
  if (ym !== undefined && ymStateTraceChannel !== undefined) {
    setDirectYmDiagnosticChannelStateTrace(ym, ymStateTraceChannel, ymStateTraceNativeStart, ymStateTraceNativeEnd);
  }
  if (ym !== undefined) setYmPhaseAdvanceAfterOutput(ym, ymPhaseAdvanceAfterOutput);
  const pokeySamples: number[] = [];
  const pokeyChannelSamples = capturePokeyChannels && pokey !== undefined
    ? Array.from({ length: 4 }, () => [] as number[])
    : undefined;
  if (pokey !== undefined && capturePokeyChannels) setDirectPokeyDiagnosticChannelSamples(pokey, true);
  if (pokey !== undefined && pokeyRawTraceRadius > 0) setDirectPokeyDiagnosticRawTransitions(pokey, true);
  if (pokey !== undefined && pokeyRawTraceRadius > 0) setDirectPokeyDiagnosticWrites(pokey, true);
  if (pokey !== undefined) {
    setDirectPokeySampleCycles(pokey, pokeySampleCycles);
    if (pokeySampleAfterClock) setDirectPokeySampleAfterClock(pokey, true);
  }
  const ymNativeSampleRate = effectiveYmSampleRate(ymNativeSampleRateArg, ymScheduler);
  const ymStreamRate = Math.max(1, ymNativeSampleRate);
  const directChipWriteCycleRate =
    directChipWriteCycleRateForMode(directChipWriteCycleRateMode, ym, pokey, ymScheduler);
  const chipWriteOrigins =
    directChipWriteOrigins(cmdTapePath, ymStreamRate, directChipWriteOrigin, directChipWriteCycleRate);
  const writes = [
    ...(mameYmWrites === undefined
      ? []
      : loadMameChipWrites(
          mameYmWrites,
          "ym",
          ymScheduler === "mame-stream" ? ymStreamRate : undefined,
          chipWriteOrigins,
          directChipWriteSampleTiming,
          directChipWriteCycleTiming,
          directYmWriteSampleOffset,
          directYmWriteSampleOffsetRegs,
          directYmWriteSampleOffsetMatches,
          directChipWriteCycleRate,
        )),
    ...(mamePokeyWrites === undefined
      ? []
      : loadMameChipWrites(
          mamePokeyWrites,
          "pokey",
          undefined,
          chipWriteOrigins,
          directChipWriteSampleTiming,
          directChipWriteCycleTiming,
          0,
          new Map(),
          [],
          directChipWriteCycleRate,
        )),
  ].map((write) => ({ write, renderCycle: offsetChipWriteCycle(write, pokeyWriteCycleOffset) }))
    .sort((a, b) => {
      if (a.renderCycle !== b.renderCycle) return a.renderCycle < b.renderCycle ? -1 : 1;
      if (a.write.cycle !== b.write.cycle) return a.write.cycle < b.write.cycle ? -1 : 1;
      if (a.write.kind !== b.write.kind) return a.write.kind.localeCompare(b.write.kind);
      return a.write.sourceIndex - b.write.sourceIndex;
    });
  const pokeyWriteEvents = pokeyRawTraceRadius > 0
    ? writes.reduce<PokeyWriteTraceEvent[]>((out, { write, renderCycle }) => {
        const summary = mamePokeyWriteTraceEvent(out.length, write, renderCycle);
        if (summary !== undefined) out.push(summary);
        return out;
      }, [])
    : undefined;
  const endCycle = samplesToCyclesAtRate(dstSamples, dstRate, directChipWriteCycleRate);
  let cycle = 0n;
  for (const { write, renderCycle } of writes) {
    if (renderCycle > endCycle) break;
    tickDirectDevices(ymScheduler === "mame-stream" ? undefined : ym, pokey, renderCycle - cycle);
    cycle = renderCycle;
    if (ym !== undefined && ymScheduler === "cycle") appendYmSamples(ymLeft, ymChannelLeft, ym);
    if (pokey !== undefined) appendPokeySamples(pokeySamples, pokeyChannelSamples, pokey);
    if (write.kind === "ym") {
      if (ym === undefined) continue;
      if (ymScheduler === "mame-stream") {
        if (write.sampleIndex === undefined) throw new Error("MAME-stream YM write missing sample index");
        generateDirectYmStreamTo(ymLeft, ymChannelLeft, ym, write.sampleIndex);
      }
      ym2151WriteAddr(ym, as_u8(write.reg));
      ym2151WriteData(ym, as_u8(write.val));
    } else {
      if (pokey === undefined) continue;
      pokeyWrite(pokey, as_u8(write.reg), as_u8(write.val));
    }
  }
  tickDirectDevices(ymScheduler === "mame-stream" ? undefined : ym, pokey, endCycle - cycle);
  if (ym !== undefined) {
    if (ymScheduler === "mame-stream") {
      const endYmSample = BigInt(Math.ceil(dstSamples * ymStreamRate / Math.max(1, dstRate)) + 1024);
      generateDirectYmStreamTo(ymLeft, ymChannelLeft, ym, endYmSample);
    } else {
      appendYmSamples(ymLeft, ymChannelLeft, ym);
    }
  }
  const ymStateTrace = ym === undefined ? undefined : drainDirectYmDiagnosticChannelStateTrace(ym);
  if (pokey !== undefined) appendPokeySamples(pokeySamples, pokeyChannelSamples, pokey);
  const pokeyRawTransitions = pokey === undefined ? undefined : drainDirectPokeyDiagnosticRawTransitions(pokey);
  const pokeyDeviceWriteSnapshots = pokeyDeviceWriteSnapshotTraceEvents(
    pokey === undefined ? undefined : drainDirectPokeyDiagnosticWrites(pokey),
    "mame-chip-writes",
  );
  const pokeyNativeSampleRate = pokey === undefined ? POKEY_NATIVE_SAMPLE_RATE : directPokeySampleRate(pokey);
  const components = mixResampledComponents(
    ymLeft,
    pokeySamples,
    ymChannelLeft,
    pokeyChannelSamples,
    dstRate,
    { ym: 0, pokey: 0 },
    ymNativeSampleRate,
    pokeyNativeSampleRate,
    { ym: ymResampleOffset, pokey: pokeyResampleOffset },
    { ym: ymResampler, pokey: pokeyResampler },
    { ym: ymOutputSampleOffset, pokey: pokeyOutputSampleOffset },
    dstSamples,
  );
  const pokeyRawTrace = buildPokeyRawTrace(
    pokeyRawTransitions,
    pokeyRawTraceCenterSample,
    pokeyRawTraceRadius,
    dstRate,
    pokeyNativeSampleRate,
    0,
    pokeyResampleOffset,
    pokeyOutputSampleOffset,
  );
  return {
    ...components,
    ymSamples: ymLeft.length,
    pokeySamples: pokeySamples.length,
    paddedSamples: 0,
    ymPaddedSamples: 0,
    pokeyPaddedSamples: 0,
    cyclePreciseTape: true,
    resetFrame: undefined,
    statusReplay: undefined,
    replyAckReplay: undefined,
    renderMode: "mame-chip-writes",
    mameYmWrites,
    mamePokeyWrites,
    directChipWriteOrigin,
    directChipWriteSampleTiming,
    directChipWriteCycleTiming,
    directChipWriteCycleRate,
    directYmWriteSampleOffset,
    ymNativeSampleRate,
    ymScheduler,
    ymStreamAbsoluteOrigin: false,
    ymStreamSampleOffset: 0,
    ymStreamCycleOffsetCycles: undefined,
    resampler,
    ymResampler,
    pokeyResampler,
    ymOutputSampleOffset,
    pokeyOutputSampleOffset,
    pokeyNativeSampleRate,
    pokeySampleCycles,
    pokeySampleAfterClock,
    commandContext: { total: 0, withCycleTiming: 0, withSoundPc: 0 },
    ...(ymStateTrace === undefined ? {} : { ymStateTrace }),
    ...(pokeyRawTrace === undefined ? {} : { pokeyRawTrace }),
    ...(pokeyWriteEvents === undefined ? {} : { pokeyWriteEvents }),
    ...(pokeyDeviceWriteSnapshots === undefined ? {} : { pokeyDeviceWriteSnapshots }),
  };
}

function renderTsMix(
  frames: number,
  cmdTapePath: string,
  dstRate: number,
  statusTapePath: string | undefined,
  statusTapeMode: StatusTapeMode,
  statusValueMode: SoundStatusReplayValueMode,
  resetReleaseDelayCycles: number,
  resetFirstFetchDelayAfterCommandCycles: number,
  replyAckDelayCycles: number,
  replyAckTapePath: string | undefined,
  useEmbeddedReplyAckTape: boolean,
  timerAStartDelayCycles: number,
  commandNmiDelayInstructions: number,
  commandNmiSampleCycle: number,
  commandNmiBoundaryDelayInstructions: number,
  commandNmiDelayMatches: readonly CommandNmiDelayMatch[],
  commandNmiDelayChipWriteBoundaryInstructions: number | undefined,
  commandNmiDelayCompletedChipWritePreemptions: number | undefined,
  commandCycleOffsetCycles: number,
  commandCycleOffsetStartFrame: number | undefined,
  commandSubmitBeforeCpuCatchup: boolean,
  commandPreemptChipWriteLookaheadCycles: number,
  commandPreemptChipWritePcs: readonly number[] | undefined,
  commandPreemptChipWriteCompleteBeforeTarget: boolean,
  commandPreemptChipWriteBeforeOnly: boolean,
  deferChipIoWriteTiming: boolean,
  deferYmAudioWriteTiming: boolean,
  deferYmParameterWriteTiming: boolean,
  deferYmTimerControlWriteTiming: boolean,
  disableYmReset: boolean,
  ymWriteEventCycleOffsetCycles: number,
  ymWriteEventCycleOffsetRegs: ReadonlyMap<number, number>,
  ymWriteEventCycleOffsetMatches: readonly YmWriteEventCycleOffsetMatch[],
  ymWriteEventSampleOffsetMatches: readonly YmWriteEventSampleOffsetMatch[],
  ymKeyOnWriteEventCycleOffsetCycles: number,
  ymCommandEdgeEventRules: readonly CommandEdgeEventRule[],
  pokeyCommandEdgeEventRules: readonly CommandEdgeEventRule[],
  requireCommandContext: boolean,
  irqServiceDelayCycles: number,
  captureYmChannels = false,
  capturePokeyChannels = false,
  ymPhaseAdvanceAfterOutput = false,
  ymNativeSampleRateArg: number | undefined = undefined,
  ymScheduler: Args["ymScheduler"] = "cycle",
  ymStreamAbsoluteOrigin = false,
  ymResampleOffset = 0,
  pokeyResampleOffset = 0,
  pokeySampleCycles = 28,
  pokeySampleAfterClock = false,
  resampler: Args["resampler"] = "linear",
  ymResampler: Args["ymResampler"] = resampler,
  pokeyResampler: Args["pokeyResampler"] = resampler,
  ymOutputSampleOffset = 0,
  pokeyOutputSampleOffset = 0,
  pokeyWriteApplyDelayCycles = 0,
  pokeyWriteApplyDelayOpcodes: ReadonlyMap<number, number> = new Map(),
  pokeyWriteApplyDelayMatches: readonly YmWriteEventCycleOffsetMatch[] = [],
  pokeyWriteApplyBoundaryDelayCycles = 0,
  pokeyWriteApplyBoundaryDelaySampleRate = 55_930,
  pokeyCommandEdgeRawCycleOffsetOpcodes: ReadonlyMap<number, number> = new Map(),
  retainYmStreamWriteTrace = false,
  traceFrameAdvance = false,
  ymStateTraceChannel: number | undefined = undefined,
  ymStateTraceNativeStart = 0,
  ymStateTraceNativeEnd = 0,
  pokeyRawTraceCenterSample: number | undefined = undefined,
  pokeyRawTraceRadius = 0,
  cmdTapeCommandTiming: CmdTapeCommandTiming = "secsAttos",
  fixedFrameCycles = false,
  frameBudgetSmoothingWindow = 0,
): RenderedTsAudio {
  const rom421 = new Uint8Array(readFileSync("/tmp/sound-roms/136033.421"));
  const rom422 = new Uint8Array(readFileSync("/tmp/sound-roms/136033.422"));
  const tapeJson = JSON.parse(readFileSync(cmdTapePath, "utf8")) as CmdTape;
  const tape = loadCmdTape(tapeJson, {
    commandTiming: cmdTapeCommandTiming,
    frameBudgetSmoothingWindow,
  });
  if (fixedFrameCycles) tape.frameCycleBudgets.clear();
  const commandContext = summarizeCmdTapeCommandContext(tapeJson);
  if (requireCommandContext) assertRequiredCommandContext(commandContext, "--require-command-context");
  const replyAckReplay = createMainReplyAckReplayForTape(cmdTapePath, replyAckTapePath, {
    useEmbedded: useEmbeddedReplyAckTape,
  });
  const ymNativeSampleRate = effectiveYmSampleRate(ymNativeSampleRateArg, ymScheduler);
  const resetFrameCommand = firstResetFrameCommand(tapeJson.cmds, tape.resetFrame);
  const useYmStreamAbsoluteOrigin = ymScheduler === "mame-stream" && ymStreamAbsoluteOrigin;
  if (useYmStreamAbsoluteOrigin && resetFrameCommand === undefined) {
    throw new Error("--ym-stream-absolute-origin requires a cmd tape with a reset-frame command");
  }
  const ymStreamSampleOffset = useYmStreamAbsoluteOrigin && resetFrameCommand !== undefined
    ? cmdTapeYmStreamSampleOffset(resetFrameCommand, ymNativeSampleRate)
    : 0;
  const ymStreamCycleOffsetCycles = useYmStreamAbsoluteOrigin && resetFrameCommand !== undefined
    ? cmdTapeAbsoluteCycle(resetFrameCommand)
    : undefined;
  const commandEvents: CommandReplayEvent[] = [];
  const frameReplayEvents: FrameReplayEvent[] | undefined = traceFrameAdvance ? [] : undefined;
  const commandEdgeUsesPrecomputedContext =
    ymCommandEdgeEventRules.length > 0 || pokeyCommandEdgeEventRules.length > 0;
  const commandPreemptChipWritePcSet = commandPreemptChipWritePcs === undefined
    ? undefined
    : new Set(commandPreemptChipWritePcs.map((pc) => pc & 0xffff));
  const pokeyOpcodeApplyDelayFor = (opcode: number | undefined): number =>
    opcode === undefined ? 0 : (pokeyWriteApplyDelayOpcodes.get(opcode & 0xff) ?? 0);
  const pokeyBoundaryApplyDelayFor = (cycle: number): number =>
    boundaryDelayToNextSample(
      cycle,
      pokeyWriteApplyBoundaryDelayCycles,
      pokeyWriteApplyBoundaryDelaySampleRate,
    );
  const precomputedCommandEdgeContext = commandEdgeUsesPrecomputedContext
    ? (() => {
        const preTape = loadCmdTape(tapeJson, {
          commandTiming: cmdTapeCommandTiming,
          frameBudgetSmoothingWindow,
        });
        if (fixedFrameCycles) preTape.frameCycleBudgets.clear();
        const preReplyAckReplay = createMainReplyAckReplayForTape(cmdTapePath, replyAckTapePath, {
          useEmbedded: useEmbeddedReplyAckTape,
        });
        const preChip = createSoundChip({
          roms: { rom421, rom422 },
          mainReplyAckDelayCycles: replyAckDelayCycles,
          ...(deferChipIoWriteTiming ? { deferChipIoWriteTiming: true } : {}),
          ...(deferYmAudioWriteTiming ? { deferYmAudioWriteTiming: true } : {}),
          ...(deferYmParameterWriteTiming ? { deferYmParameterWriteTiming: true } : {}),
          ...(deferYmTimerControlWriteTiming ? { deferYmTimerControlWriteTiming: true } : {}),
          ...(disableYmReset ? { disableYmReset: true } : {}),
          ...(irqServiceDelayCycles > 0 ? { irqServiceDelayCycles } : {}),
          ...(pokeyWriteApplyDelayCycles > 0 ? { pokeyWriteApplyDelayCycles } : {}),
          ...(pokeyWriteApplyDelayOpcodes.size === 0 && pokeyWriteApplyDelayMatches.length === 0 &&
            pokeyWriteApplyBoundaryDelayCycles === 0
            ? {}
            : {
                pokeyWriteApplyDelayProvider: (ctx: {
                  readonly frame: number | undefined;
                  readonly pc: number;
                  readonly opcode: number | undefined;
                  readonly reg: number;
                  readonly val: number;
                  readonly rawCycle: number;
                  readonly rawCycleInFrame: number | undefined;
                  readonly currentApplyDelayCycles: number;
                }) => {
                  const opcodeDelay = pokeyOpcodeApplyDelayFor(ctx.opcode);
                  const matchDelay = writeEventCycleOffsetForMatches(pokeyWriteApplyDelayMatches, {
                    frame: ctx.frame,
                    cycleInFrame: ctx.rawCycleInFrame,
                    pc: ctx.pc,
                    reg: ctx.reg,
                    val: ctx.val,
                  });
                  const boundaryDelay =
                    pokeyBoundaryApplyDelayFor(ctx.rawCycle + ctx.currentApplyDelayCycles + opcodeDelay + matchDelay);
                  const totalDelay = opcodeDelay + matchDelay + boundaryDelay;
                  return totalDelay === 0 ? undefined : totalDelay;
                },
              }),
          ...(preReplyAckReplay === undefined ? {} : { mainReplyAckCycle: preReplyAckReplay.schedule }),
        });
        let preCurrentFrame = -1;
        if (statusTapePath !== undefined) {
          if (statusTapeMode === "frame") {
            installSoundStatusFrameReplay(
              preChip,
              statusTapePath,
              loadSoundStatusReads(statusTapePath),
              () => preCurrentFrame < 0 ? undefined : preCurrentFrame,
              { valueMode: statusValueMode },
            );
          } else {
            installSoundStatusReplay(
              preChip,
              statusTapePath,
              loadSoundStatusReads(statusTapePath),
              { valueMode: statusValueMode },
            );
          }
        }
        ((preChip.ym2151 as unknown) as YM2151WithTimerPhaseDiagnostic).timerAStartDelayYmCycles =
          Math.trunc(timerAStartDelayCycles * 2);
        ((preChip as unknown) as SoundChipWithCommandNmiDiagnostic).commandNmiDelayInstructions =
          Math.max(0, Math.trunc(commandNmiDelayInstructions));
        const preCommandEvents: CommandReplayEvent[] = [];
        const preCommandReads: SoundCommandReadEvent[] = [];
        for (let f = 0; f < frames; f++) {
          preCurrentFrame = f;
          const frameCommandCycleOffsetCycles =
            commandCycleOffsetStartFrame === undefined || f >= commandCycleOffsetStartFrame
              ? commandCycleOffsetCycles
              : 0;
          const tickOpts: ReplayTickOptions = {
            autoReleaseReset: true,
            drainReplies: true,
            resetReleaseDelayCycles,
            resetFirstFetchDelayAfterCommandCycles,
            commandNmiSampleCycle,
            commandNmiBoundaryDelayInstructions,
            ...(commandNmiDelayMatches.length === 0 &&
              commandNmiDelayChipWriteBoundaryInstructions === undefined &&
              commandNmiDelayCompletedChipWritePreemptions === undefined
              ? {}
              : {
                  commandNmiDelayOverride: (event: {
                    readonly frame: number;
                    readonly byte: number;
                    readonly cycleInFrame: number;
                    readonly currentChipIoStore?: unknown;
                    readonly preemptedChipWrite?: {
                      readonly completedInstructionBeforeTarget?: boolean;
                    };
                  }) => commandNmiDelayOverrideForArgs(
                    {
                      commandNmiDelayMatches,
                      commandNmiDelayChipWriteBoundaryInstructions,
                      commandNmiDelayCompletedChipWritePreemptions,
                    },
                    event,
                  ),
                }),
            commandCycleOffsetCycles: frameCommandCycleOffsetCycles,
            ...(commandSubmitBeforeCpuCatchup ? { commandSubmitBeforeCpuCatchup: true } : {}),
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
            onCommandSubmit: (event) => {
              preCommandEvents.push(commandReplayEventFromSubmit(tapeJson, event));
            },
          };
          tickFrameWithTape(preChip, preTape, f, tickOpts);
          drainChipWriteEvents(preChip);
          preCommandReads.push(...drainSoundCommandReadEvents(preChip));
          drainYm2151Samples(preChip);
          drainPokeySamples(preChip);
        }
        return { commandEvents: preCommandEvents, commandReads: preCommandReads };
      })()
    : undefined;
  let runtimeCommandReadChip: ReturnType<typeof createSoundChip> | undefined;
  const ymCommandEdgeEventAdjust =
    createYmCommandEdgeRuntimeAdjustSummary(ymCommandEdgeEventRules);
  const pokeyCommandEdgeEventAdjust =
    createYmCommandEdgeRuntimeAdjustSummary(pokeyCommandEdgeEventRules);
  const pokeyWriteApplyDelayOffsetFor = (ctx: {
    readonly frame: number | undefined;
    readonly pc: number;
    readonly opcode: number | undefined;
    readonly reg: number;
    readonly val: number;
    readonly rawCycle: number;
    readonly rawCycleInFrame: number | undefined;
    readonly rawWriteCycleOffset: number;
    readonly currentApplyDelayCycles: number;
  }): number | undefined => {
    const opcodeApplyDelayCycles = pokeyOpcodeApplyDelayFor(ctx.opcode);
    const matchApplyDelayCycles = writeEventCycleOffsetForMatches(pokeyWriteApplyDelayMatches, {
      frame: ctx.frame,
      cycleInFrame: ctx.rawCycleInFrame,
      pc: ctx.pc,
      reg: ctx.reg,
      val: ctx.val,
    });
    const rawCycleOffset = ctx.opcode === undefined
      ? 0
      : (pokeyCommandEdgeRawCycleOffsetOpcodes.get(ctx.opcode & 0xff) ?? 0);
    const commandEdgeDelayCycles = pokeyCommandEdgeEventRules.length === 0
      ? 0
      : ymCommandEdgeRuntimeOffsetFor(
          {
            frame: ctx.frame,
            pc: ctx.pc,
            opcode: ctx.opcode,
            reg: ctx.reg,
            val: ctx.val,
            rawCycle: ctx.rawCycle + rawCycleOffset,
            rawCycleInFrame: ctx.rawCycleInFrame,
            rawWriteCycleOffset: ctx.rawWriteCycleOffset + rawCycleOffset,
            currentEventCycleOffset:
              ctx.currentApplyDelayCycles + opcodeApplyDelayCycles + matchApplyDelayCycles - rawCycleOffset,
          },
          precomputedCommandEdgeContext?.commandEvents ?? commandEvents,
          precomputedCommandEdgeContext?.commandReads ?? runtimeCommandReadChip?.commandReadEvents ?? [],
          pokeyCommandEdgeEventRules,
          pokeyCommandEdgeEventAdjust,
        ) ?? 0;
    const baseDelayCycles = opcodeApplyDelayCycles + matchApplyDelayCycles + commandEdgeDelayCycles;
    const boundaryDelayCycles = pokeyBoundaryApplyDelayFor(ctx.rawCycle + ctx.currentApplyDelayCycles + baseDelayCycles);
    const totalDelayCycles = baseDelayCycles + boundaryDelayCycles;
    return totalDelayCycles === 0 ? undefined : totalDelayCycles;
  };
  const chip = createSoundChip({
    roms: { rom421, rom422 },
    mainReplyAckDelayCycles: replyAckDelayCycles,
    ...(deferChipIoWriteTiming ? { deferChipIoWriteTiming: true } : {}),
    ...(deferYmAudioWriteTiming ? { deferYmAudioWriteTiming: true } : {}),
    ...(deferYmParameterWriteTiming ? { deferYmParameterWriteTiming: true } : {}),
    ...(deferYmTimerControlWriteTiming ? { deferYmTimerControlWriteTiming: true } : {}),
    ...(disableYmReset ? { disableYmReset: true } : {}),
    ...(ymWriteEventCycleOffsetCycles === 0 ? {} : { ymWriteEventCycleOffsetCycles }),
    ...(ymWriteEventCycleOffsetRegs.size === 0 ? {} : { ymWriteEventCycleOffsetByReg: ymWriteEventCycleOffsetRegs }),
    ...(ymWriteEventCycleOffsetMatches.length === 0
      ? {}
      : { ymWriteEventCycleOffsetMatches }),
    ...(ymCommandEdgeEventRules.length === 0
      ? {}
      : {
          ymWriteEventCycleOffsetProvider: (ctx: Parameters<typeof ymCommandEdgeRuntimeOffsetFor>[0]) =>
            ymCommandEdgeRuntimeOffsetFor(
              ctx,
              precomputedCommandEdgeContext?.commandEvents ?? commandEvents,
              precomputedCommandEdgeContext?.commandReads ?? runtimeCommandReadChip?.commandReadEvents ?? [],
              ymCommandEdgeEventRules,
              ymCommandEdgeEventAdjust,
            ),
        }),
    ...(ymWriteEventSampleOffsetMatches.length === 0
      ? {}
      : { ymWriteEventSampleOffsetMatches }),
    ...(ymKeyOnWriteEventCycleOffsetCycles === 0 ? {} : { ymKeyOnWriteEventCycleOffsetCycles }),
    ...(pokeyCommandEdgeEventRules.length === 0 && pokeyWriteApplyDelayOpcodes.size === 0 &&
      pokeyWriteApplyDelayMatches.length === 0 && pokeyWriteApplyBoundaryDelayCycles === 0
      ? {}
      : {
          pokeyWriteApplyDelayProvider: pokeyWriteApplyDelayOffsetFor,
        }),
    ...(irqServiceDelayCycles > 0 ? { irqServiceDelayCycles } : {}),
    ...(ymScheduler === "mame-stream"
      ? {
          ymAudioScheduler: "mame-stream" as const,
          ymStreamSampleRate: ymNativeSampleRate,
          ...(ymStreamSampleOffset === 0 ? {} : { ymStreamSampleOffset }),
          ...(ymStreamCycleOffsetCycles === undefined ? {} : { ymStreamCycleOffsetCycles }),
        }
      : {}),
    ...(pokeyWriteApplyDelayCycles > 0 ? { pokeyWriteApplyDelayCycles } : {}),
    ...(replyAckReplay === undefined ? {} : { mainReplyAckCycle: replyAckReplay.schedule }),
  });
  runtimeCommandReadChip = chip;
  let currentFrame = -1;
  const statusReplay = statusTapePath === undefined
    ? undefined
    : statusTapeMode === "frame"
      ? installSoundStatusFrameReplay(chip, statusTapePath, loadSoundStatusReads(statusTapePath), () =>
        currentFrame < 0 ? undefined : currentFrame, { valueMode: statusValueMode })
      : installSoundStatusReplay(chip, statusTapePath, loadSoundStatusReads(statusTapePath), { valueMode: statusValueMode });
  ((chip.ym2151 as unknown) as YM2151WithTimerPhaseDiagnostic).timerAStartDelayYmCycles =
    Math.trunc(timerAStartDelayCycles * 2);
  ((chip as unknown) as SoundChipWithCommandNmiDiagnostic).commandNmiDelayInstructions =
    Math.max(0, Math.trunc(commandNmiDelayInstructions));
  setYmPhaseAdvanceAfterOutput(chip.ym2151, ymPhaseAdvanceAfterOutput);
  setPokeySampleCycles(chip, pokeySampleCycles);
  if (pokeySampleAfterClock) setPokeySampleAfterClock(chip, true);
  const ymLeft: number[] = [];
  const ymChannelLeft = captureYmChannels
    ? Array.from({ length: 8 }, () => [] as number[])
    : undefined;
  if (captureYmChannels) setYmDiagnosticChannelSamples(chip, true);
  if (ymStateTraceChannel !== undefined) {
    setYm2151DiagnosticChannelStateTrace(chip, ymStateTraceChannel, ymStateTraceNativeStart, ymStateTraceNativeEnd);
  }
  if (capturePokeyChannels) setPokeyDiagnosticChannelSamples(chip, true);
  if (pokeyRawTraceRadius > 0) setPokeyDiagnosticRawTransitions(chip, true);
  if (pokeyRawTraceRadius > 0) setPokeyDiagnosticWrites(chip, true);
  const pokey: number[] = [];
  const pokeyChannelSamples = capturePokeyChannels
    ? Array.from({ length: 4 }, () => [] as number[])
    : undefined;
  const pokeyNativeSampleRate = getPokeySampleRate(chip);
  const pokeyStreamingResampler = pokeyChannelSamples === undefined
    ? createProbeStreamingResampler(pokeyNativeSampleRate, dstRate, pokeyResampler, pokeyResampleOffset)
    : undefined;
  const pokeyResampledStream: number[] = [];
  let pokeyNativeSampleCount = 0;
  const pokeyWriteEvents = pokeyRawTraceRadius > 0 ? [] as PokeyWriteTraceEvent[] : undefined;
  const ymStreamWriteDiagnostics = createYmStreamWriteDiagnostics();
  const ymStreamWriteTraceEvents = retainYmStreamWriteTrace ? [] as YmStreamWriteEventSummary[] : undefined;

  for (let f = 0; f < frames; f++) {
    currentFrame = f;
    const frameCommandCycleOffsetCycles =
      commandCycleOffsetStartFrame === undefined || f >= commandCycleOffsetStartFrame
        ? commandCycleOffsetCycles
        : 0;
    const tickOpts: ReplayTickOptions = {
      autoReleaseReset: true,
      drainReplies: true,
      resetReleaseDelayCycles,
      resetFirstFetchDelayAfterCommandCycles,
      commandNmiSampleCycle,
      commandNmiBoundaryDelayInstructions,
      ...(commandNmiDelayMatches.length === 0 &&
        commandNmiDelayChipWriteBoundaryInstructions === undefined &&
        commandNmiDelayCompletedChipWritePreemptions === undefined
        ? {}
        : {
            commandNmiDelayOverride: (event: {
              readonly frame: number;
              readonly byte: number;
              readonly cycleInFrame: number;
              readonly currentChipIoStore?: unknown;
              readonly preemptedChipWrite?: {
                readonly completedInstructionBeforeTarget?: boolean;
              };
            }) => commandNmiDelayOverrideForArgs(
              {
                commandNmiDelayMatches,
                commandNmiDelayChipWriteBoundaryInstructions,
                commandNmiDelayCompletedChipWritePreemptions,
              },
              event,
            ),
          }),
      commandCycleOffsetCycles: frameCommandCycleOffsetCycles,
      ...(commandSubmitBeforeCpuCatchup ? { commandSubmitBeforeCpuCatchup: true } : {}),
      ...(frameReplayEvents === undefined
        ? {}
        : { onFrameAdvance: (event: FrameReplayEvent) => frameReplayEvents.push(event) }),
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
      onCommandSubmit: (event) => {
        commandEvents.push(commandReplayEventFromSubmit(tapeJson, event));
      },
    };
    tickFrameWithTape(chip, tape, f, tickOpts);
    const chipWriteEvents = drainChipWriteEvents(chip);
    accumulateYmStreamWriteDiagnostics(ymStreamWriteDiagnostics, chipWriteEvents, ymStreamWriteTraceEvents);
    if (pokeyWriteEvents !== undefined) appendPokeyWriteTraceEvents(pokeyWriteEvents, chipWriteEvents);
    const beforeResetRelease = useYmStreamAbsoluteOrigin && tape.resetFrame !== undefined && f < tape.resetFrame;
    if (!beforeResetRelease) {
      const ym = drainYm2151Samples(chip);
      for (let i = 0; i < ym.length; i += 2) ymLeft.push(ym[i] ?? 0);
      const channelSamples = drainYmDiagnosticChannelSamples(chip);
      if (ymChannelLeft !== undefined && channelSamples !== undefined) {
        for (let ch = 0; ch < ymChannelLeft.length; ch++) {
          const samples = channelSamples[ch] ?? [];
          for (let i = 0; i < samples.length; i += 2) ymChannelLeft[ch]!.push(samples[i] ?? 0);
        }
      }
    }
    const drainedPokey = drainPokeySamples(chip);
    pokeyNativeSampleCount += drainedPokey.length;
    if (pokeyStreamingResampler === undefined) {
      pokey.push(...drainedPokey);
    } else {
      appendFloat32(pokeyResampledStream, pokeyStreamingResampler.push(drainedPokey));
    }
    const pokeyChannels = drainPokeyDiagnosticChannelSamples(chip);
    if (pokeyChannelSamples !== undefined && pokeyChannels !== undefined) {
      for (let ch = 0; ch < pokeyChannelSamples.length; ch++) {
        const samples = pokeyChannels[ch] ?? [];
        for (const sample of samples) pokeyChannelSamples[ch]!.push(sample);
      }
    }
  }
  if (pokeyStreamingResampler !== undefined) {
    appendFloat32(pokeyResampledStream, pokeyStreamingResampler.finish());
  }
  const pokeyRawTransitions = drainPokeyDiagnosticRawTransitions(chip);
  const pokeyDeviceWriteSnapshots = pokeyDeviceWriteSnapshotTraceEvents(
    drainPokeyDiagnosticWrites(chip),
    "sound-chip",
  );

  let resetPaddedSamples = 0;
  const firstCmd = resetFrameCommand;
  if (firstCmd !== undefined) {
    const absoluteCycle = cmdTapeAbsoluteCycle(firstCmd);
    if (absoluteCycle !== undefined) {
      resetPaddedSamples = soundCyclesToSamples(absoluteCycle, dstRate);
    } else {
      const samplesPerFrame = dstRate * SOUND_CYCLES_PER_FRAME / SOUND_CMD_TAPE_CPU_HZ;
      const firstCycle = cmdTapeCycleInFrame(firstCmd) ?? 0;
      resetPaddedSamples = Math.max(0, Math.round((firstCmd.frame * samplesPerFrame) +
        (firstCycle * dstRate / SOUND_CMD_TAPE_CPU_HZ)));
    }
  }
  const paddedSamples = useYmStreamAbsoluteOrigin ? 0 : resetPaddedSamples;
  const componentPaddedSamples: ComponentPaddedSamples = useYmStreamAbsoluteOrigin
    ? { ym: 0, pokey: resetPaddedSamples }
    : { ym: paddedSamples, pokey: paddedSamples };
  const components = pokeyStreamingResampler === undefined
    ? mixResampledComponents(
        ymLeft,
        pokey,
        ymChannelLeft,
        pokeyChannelSamples,
        dstRate,
        componentPaddedSamples,
        ymNativeSampleRate,
        pokeyNativeSampleRate,
        { ym: ymResampleOffset, pokey: pokeyResampleOffset },
        { ym: ymResampler, pokey: pokeyResampler },
        { ym: ymOutputSampleOffset, pokey: pokeyOutputSampleOffset },
        undefined,
      )
    : mixPreparedComponents(
        resamplePcm(ymLeft, ymNativeSampleRate, dstRate, ymResampler, ymResampleOffset, undefined),
        Float32Array.from(pokeyResampledStream),
        ymChannelLeft?.map((samples) =>
          resamplePcm(samples, ymNativeSampleRate, dstRate, ymResampler, ymResampleOffset, undefined)),
        undefined,
        componentPaddedSamples,
        { ym: ymOutputSampleOffset, pokey: pokeyOutputSampleOffset },
      );
  const pokeyRawTrace = buildPokeyRawTrace(
    pokeyRawTransitions,
    pokeyRawTraceCenterSample,
    pokeyRawTraceRadius,
    dstRate,
    pokeyNativeSampleRate,
    componentPaddedSamples.pokey,
    pokeyResampleOffset,
    pokeyOutputSampleOffset,
  );
  const finalizedYmCommandEdgeEventAdjust =
    finalizeYmCommandEdgeRuntimeAdjustSummary(ymCommandEdgeEventAdjust);
  const finalizedPokeyCommandEdgeEventAdjust =
    finalizeYmCommandEdgeRuntimeAdjustSummary(pokeyCommandEdgeEventAdjust);
  const ymStateTrace = drainYm2151DiagnosticChannelStateTrace(chip);
  return {
    ...components,
    ymSamples: ymLeft.length,
    pokeySamples: pokeyStreamingResampler === undefined ? pokey.length : pokeyNativeSampleCount,
    paddedSamples,
    ymPaddedSamples: componentPaddedSamples.ym,
    pokeyPaddedSamples: componentPaddedSamples.pokey,
    cyclePreciseTape: tape.cyclePrecise,
    resetFrame: tape.resetFrame,
    statusReplay,
    replyAckReplay,
    renderMode: "sound-chip",
    mameYmWrites: undefined,
    mamePokeyWrites: undefined,
    directChipWriteOrigin: "absolute",
    directChipWriteSampleTiming: "attos",
    directChipWriteCycleTiming: "attos",
    directChipWriteCycleRate: SOUND_CMD_TAPE_CPU_HZ,
    directYmWriteSampleOffset: 0,
    ymNativeSampleRate,
    ymScheduler,
    ymStreamAbsoluteOrigin: useYmStreamAbsoluteOrigin,
    ymStreamSampleOffset,
    ymStreamCycleOffsetCycles: ymStreamCycleOffsetCycles?.toString(),
    resampler,
    ymResampler,
    pokeyResampler,
    ymOutputSampleOffset,
    pokeyOutputSampleOffset,
    pokeyNativeSampleRate,
    pokeySampleCycles,
    pokeySampleAfterClock,
    commandContext,
    ...(frameReplayEvents === undefined ? {} : { frameReplayEvents }),
    ...(commandEvents.length === 0 ? {} : { commandReplayEvents: commandEvents }),
    ...(ymScheduler === "mame-stream" ? { ymStreamWriteDiagnostics } : {}),
    ...(ymStreamWriteTraceEvents === undefined ? {} : { ymStreamWriteTraceEvents }),
    ...(ymStateTrace === undefined ? {} : { ymStateTrace }),
    ...(pokeyRawTrace === undefined ? {} : { pokeyRawTrace }),
    ...(pokeyWriteEvents === undefined ? {} : { pokeyWriteEvents }),
    ...(pokeyDeviceWriteSnapshots === undefined ? {} : { pokeyDeviceWriteSnapshots }),
    ...(finalizedYmCommandEdgeEventAdjust === undefined
      ? {}
      : { ymCommandEdgeEventAdjust: finalizedYmCommandEdgeEventAdjust }),
    ...(finalizedPokeyCommandEdgeEventAdjust === undefined
      ? {}
      : { pokeyCommandEdgeEventAdjust: finalizedPokeyCommandEdgeEventAdjust }),
  };
}

function maxAbsInRange(a: Float32Array, start: number, size: number): number {
  let max = 0;
  const end = Math.min(a.length, start + size);
  for (let i = start; i < end; i++) {
    const v = Math.abs(a[i] ?? 0);
    if (v > max) max = v;
  }
  return max;
}

function signalStats(a: Float32Array): { rms: number; maxAbs: number } {
  let sum = 0;
  let maxAbs = 0;
  for (const sample of a) {
    sum += sample * sample;
    const abs = Math.abs(sample);
    if (abs > maxAbs) maxAbs = abs;
  }
  return {
    rms: a.length === 0 ? 0 : Math.sqrt(sum / a.length),
    maxAbs,
  };
}

function windowLagHistogram(stats: readonly WindowStats[]): Array<{ lag: number; count: number }> {
  const counts = new Map<number, number>();
  for (const s of stats) counts.set(s.lag, (counts.get(s.lag) ?? 0) + 1);
  return [...counts.entries()]
    .map(([lag, count]) => ({ lag, count }))
    .sort((a, b) => b.count - a.count || a.lag - b.lag);
}

function windowLagRuns(stats: readonly WindowStats[]): WindowLagRunSummary[] {
  const runs: WindowLagRunSummary[] = [];
  for (const s of [...stats].sort((a, b) => a.start - b.start)) {
    const last = runs[runs.length - 1];
    if (last !== undefined && last.lag === s.lag && last.end + s.size >= s.start) {
      runs[runs.length - 1] = {
        lag: last.lag,
        count: last.count + 1,
        start: last.start,
        end: Math.max(last.end, s.start + s.size),
        minCorrelation: Math.min(last.minCorrelation, s.correlation),
        maxRms: Math.max(last.maxRms, s.rms),
        maxAbs: Math.max(last.maxAbs, s.maxAbs),
      };
      continue;
    }
    runs.push({
      lag: s.lag,
      count: 1,
      start: s.start,
      end: s.start + s.size,
      minCorrelation: s.correlation,
      maxRms: s.rms,
      maxAbs: s.maxAbs,
    });
  }
  return runs;
}

function worstWindowSummaries(stats: readonly WindowStats[], limit = 12): WindowWorstSummary[] {
  return [...stats]
    .sort((a, b) =>
      a.correlation === b.correlation
        ? b.rms - a.rms
        : a.correlation - b.correlation)
    .slice(0, Math.max(0, Math.trunc(limit)))
    .map((s) => ({
      start: s.start,
      lag: s.lag,
      correlation: s.correlation,
      rms: s.rms,
      maxAbs: s.maxAbs,
      dominantSource: s.dominantSource,
    }));
}

function numericHistogramTop(histogram: Record<string, number>, limit = 8): HistogramEntry[] {
  return Object.entries(histogram)
    .map(([value, count]) => ({ value: Number(value), count }))
    .filter((entry) => Number.isFinite(entry.value))
    .sort((a, b) => b.count - a.count || Math.abs(a.value) - Math.abs(b.value) || a.value - b.value)
    .slice(0, Math.max(0, Math.trunc(limit)));
}

function stringHistogramTop(histogram: Record<string, number>, limit = 8): StringHistogramEntry[] {
  return Object.entries(histogram)
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))
    .slice(0, Math.max(0, Math.trunc(limit)));
}

function pokeyRawTraceDominantStateAlignmentSummary(
  alignment: PokeyRawTraceDominantStateAlignment | undefined,
): PokeyRawTraceDominantStateAlignmentSummary | undefined {
  if (alignment === undefined) return undefined;
  return {
    outputSampleDelta: alignment.outputSampleDelta,
    compared: alignment.compared,
    exactStateMatches: alignment.exactStateMatches,
    exactStateMismatches: alignment.exactStateMismatches,
    fieldMismatchTop: stringHistogramTop(alignment.fieldMismatchCounts),
    eventIndexDeltaTop: numericHistogramTop(alignment.eventIndexDeltaHistogram),
    counterDeltaTop: stringHistogramTop(alignment.counterDeltaHistogram),
    borrowCntDeltaTop: stringHistogramTop(alignment.borrowCntDeltaHistogram),
    outputDeltaTop: stringHistogramTop(alignment.outputDeltaHistogram),
    filterSampleDeltaTop: stringHistogramTop(alignment.filterSampleDeltaHistogram),
    polyDeltaTop: stringHistogramTop(alignment.polyDeltaHistogram),
    polyModuloDeltaTop: stringHistogramTop(alignment.polyModuloDeltaHistogram),
    polyClockDeltaTop: numericHistogramTop(alignment.polyClockDeltaHistogram),
    polyClockDelta28TicksTop: numericHistogramTop(alignment.polyClockDelta28TicksHistogram),
    changedChannelTop: stringHistogramTop(alignment.changedChannelHistogram),
    changedChannelCounterDeltaTop: stringHistogramTop(alignment.changedChannelCounterDeltaHistogram),
    changedChannelBorrowCntDeltaTop: stringHistogramTop(alignment.changedChannelBorrowCntDeltaHistogram),
    changedChannelOutputDeltaTop: stringHistogramTop(alignment.changedChannelOutputDeltaHistogram),
    clockCnt28DeltaTop: numericHistogramTop(alignment.clockCnt28DeltaHistogram),
    clockCnt114DeltaTop: numericHistogramTop(alignment.clockCnt114DeltaHistogram),
    transitionCycleModulo28DeltaTop: numericHistogramTop(alignment.transitionCycleModulo28DeltaHistogram),
    transitionCycleModulo114DeltaTop: numericHistogramTop(alignment.transitionCycleModulo114DeltaHistogram),
    firstMismatches: alignment.firstMismatches,
  };
}

function pokeyRawTraceComparisonSummary(
  comparison: PokeyRawTraceComparison | undefined,
): PokeyRawTraceComparisonSummary | undefined {
  if (comparison === undefined) return undefined;
  return {
    compared: comparison.compared,
    rawMismatchCount: comparison.rawMismatchCount,
    cycleDeltaMode: comparison.cycleDeltaMode,
    cycleDeltaResidualTop: numericHistogramTop(comparison.cycleDeltaResidualHistogram),
    outputSampleDeltaTop: numericHistogramTop(comparison.outputSampleDeltaHistogram),
    rawOutputSampleDeltaTop: numericHistogramTop(comparison.rawOutputSampleDeltaHistogram),
    rawTransitionOutputSampleDeltaTop: numericHistogramTop(comparison.rawTransitionOutputSampleDeltaHistogram),
    dominantRawTransitionStateAlignment:
      pokeyRawTraceDominantStateAlignmentSummary(comparison.dominantRawTransitionStateAlignment),
  };
}

function pokeyRawTracePcmResidualSummary(
  comparison: PokeyRawTracePcmResidualComparison | undefined,
): PokeyRawTracePcmResidualSummary | undefined {
  if (comparison === undefined) return undefined;
  return {
    compared: comparison.compared,
    sameOutputRmsMean: comparison.sameOutput.rmsMean,
    eventAlignedRmsMean: comparison.eventAligned.rmsMean,
    bestLagRmsMean: comparison.bestLag.rmsMean,
    bestLagHistogramTop: numericHistogramTop(comparison.bestLagHistogram),
    worstBestLagMaxAbs: comparison.worstBestLag.reduce<number | undefined>(
      (max, sample) => max === undefined
        ? sample.bestLag.maxAbs
        : Math.max(max, sample.bestLag.maxAbs),
      undefined,
    ),
  };
}

function subtractSignal(base: Float32Array, sub: Float32Array, gain: number): Float32Array {
  const out = new Float32Array(base.length);
  for (let i = 0; i < base.length; i++) out[i] = (base[i] ?? 0) - ((sub[i] ?? 0) * gain);
  return out;
}

function chooseWindows(signal: Float32Array, args: Args): { windows: Array<{ start: number; size: number }>; audibleCount: number } {
  const size = Math.max(1, args.windowSize);
  if (args.windowStart !== undefined) return { windows: [{ start: Math.max(0, args.windowStart), size }], audibleCount: 1 };
  const windows: Array<{ start: number; size: number }> = [];
  const hop = Math.max(1, args.windowHop);
  let audibleCount = 0;
  for (let start = 0; start + size <= signal.length; start += hop) {
    if (maxAbsInRange(signal, start, size) >= args.audibleThreshold) {
      audibleCount++;
      if (windows.length < args.maxWindows) windows.push({ start, size });
    }
  }
  if (windows.length === 0) windows.push({ start: 0, size: Math.min(size, signal.length) });
  return { windows, audibleCount };
}

function correlationAtLag(a: Float32Array, b: Float32Array, start: number, size: number, lag: number): number {
  let sum = 0;
  let na = 0;
  let nb = 0;
  const end = Math.min(start + size, a.length);
  for (let i = start; i < end; i++) {
    const j = i - lag;
    if (j < 0 || j >= b.length) continue;
    const va = a[i] ?? 0;
    const vb = b[j] ?? 0;
    sum += va * vb;
    na += va * va;
    nb += vb * vb;
  }
  return na > 0 && nb > 0 ? sum / Math.sqrt(na * nb) : 0;
}

function bestCorrelation(
  a: Float32Array,
  b: Float32Array,
  start: number,
  size: number,
  maxLag: number,
  tieCorrelationEpsilon: number,
): { lag: number; correlation: number; absoluteBestLag: number; absoluteBestCorrelation: number } {
  let absoluteBestLag = 0;
  let absoluteBestCorrelation = -Infinity;
  for (let lag = -maxLag; lag <= maxLag; lag++) {
    const corr = correlationAtLag(a, b, start, size, lag);
    if (corr > absoluteBestCorrelation) {
      absoluteBestCorrelation = corr;
      absoluteBestLag = lag;
    }
  }
  if (tieCorrelationEpsilon <= 0) {
    return {
      lag: absoluteBestLag,
      correlation: absoluteBestCorrelation,
      absoluteBestLag,
      absoluteBestCorrelation,
    };
  }

  let selectedLag = absoluteBestLag;
  let selectedCorrelation = absoluteBestCorrelation;
  for (let lag = -maxLag; lag <= maxLag; lag++) {
    const corr = correlationAtLag(a, b, start, size, lag);
    if (corr < absoluteBestCorrelation - tieCorrelationEpsilon) continue;
    const absLag = Math.abs(lag);
    const selectedAbsLag = Math.abs(selectedLag);
    if (absLag < selectedAbsLag || (absLag === selectedAbsLag && corr > selectedCorrelation)) {
      selectedLag = lag;
      selectedCorrelation = corr;
    }
  }
  return {
    lag: selectedLag,
    correlation: selectedCorrelation,
    absoluteBestLag,
    absoluteBestCorrelation,
  };
}

function componentStats(
  components: { ym: Float32Array; pokey: Float32Array },
  start: number,
  size: number,
): Pick<WindowStats, "tsYmRms" | "tsPokeyRms" | "tsYmMaxAbs" | "tsPokeyMaxAbs" | "tsYmEnergyShare" | "dominantSource"> {
  let ymSum = 0;
  let pokeySum = 0;
  let count = 0;
  let tsYmMaxAbs = 0;
  let tsPokeyMaxAbs = 0;
  const end = Math.min(start + size, components.ym.length, components.pokey.length);
  for (let i = start; i < end; i++) {
    const y = components.ym[i] ?? 0;
    const p = components.pokey[i] ?? 0;
    ymSum += y * y;
    pokeySum += p * p;
    const yAbs = Math.abs(y);
    const pAbs = Math.abs(p);
    if (yAbs > tsYmMaxAbs) tsYmMaxAbs = yAbs;
    if (pAbs > tsPokeyMaxAbs) tsPokeyMaxAbs = pAbs;
    count++;
  }
  const total = ymSum + pokeySum;
  const tsYmEnergyShare = total === 0 ? 0 : ymSum / total;
  const dominantSource = total === 0
    ? "silent"
    : tsYmEnergyShare >= 0.75
      ? "ym"
      : tsYmEnergyShare <= 0.25
        ? "pokey"
        : "mixed";
  return {
    tsYmRms: count === 0 ? 0 : Math.sqrt(ymSum / count),
    tsPokeyRms: count === 0 ? 0 : Math.sqrt(pokeySum / count),
    tsYmMaxAbs,
    tsPokeyMaxAbs,
    tsYmEnergyShare,
    dominantSource,
  };
}

function ymChannelWindowStats(
  channels: Float32Array[] | undefined,
  start: number,
  size: number,
): Pick<WindowStats, "tsYmTopChannel" | "tsYmChannelRms"> {
  if (channels === undefined) return {};
  const tsYmChannelRms = channels.map((samples, channel) => {
    let sum = 0;
    let count = 0;
    let maxAbs = 0;
    const end = Math.min(start + size, samples.length);
    for (let i = start; i < end; i++) {
      const sample = samples[i] ?? 0;
      sum += sample * sample;
      const abs = Math.abs(sample);
      if (abs > maxAbs) maxAbs = abs;
      count++;
    }
    return { channel, rms: count === 0 ? 0 : Math.sqrt(sum / count), maxAbs };
  });
  let tsYmTopChannel = 0;
  for (const item of tsYmChannelRms) {
    if (item.rms > (tsYmChannelRms[tsYmTopChannel]?.rms ?? -Infinity)) tsYmTopChannel = item.channel;
  }
  return { tsYmTopChannel, tsYmChannelRms };
}

function pokeyChannelWindowStats(
  channels: Float32Array[] | undefined,
  start: number,
  size: number,
): Pick<WindowStats, "tsPokeyTopChannel" | "tsPokeyChannelRms"> {
  if (channels === undefined) return {};
  const tsPokeyChannelRms = channels.map((samples, channel) => {
    let sum = 0;
    let count = 0;
    let maxAbs = 0;
    const end = Math.min(start + size, samples.length);
    for (let i = start; i < end; i++) {
      const sample = samples[i] ?? 0;
      sum += sample * sample;
      const abs = Math.abs(sample);
      if (abs > maxAbs) maxAbs = abs;
      count++;
    }
    return { channel, rms: count === 0 ? 0 : Math.sqrt(sum / count), maxAbs };
  });
  let tsPokeyTopChannel = 0;
  for (const item of tsPokeyChannelRms) {
    if (item.rms > (tsPokeyChannelRms[tsPokeyTopChannel]?.rms ?? -Infinity)) tsPokeyTopChannel = item.channel;
  }
  return { tsPokeyTopChannel, tsPokeyChannelRms };
}

function sampleTrace(
  ts: Float32Array,
  mame: Float32Array,
  components: { ym: Float32Array; pokey: Float32Array },
  referenceComponents: { ym: Float32Array; pokey: Float32Array } | undefined,
  ymChannels: Float32Array[] | undefined,
  pokeyChannels: Float32Array[] | undefined,
  referenceYmChannels: Float32Array[] | undefined,
  referencePokeyChannels: Float32Array[] | undefined,
  sample: number,
  lag: number,
  radius: number,
): NonNullable<WindowStats["maxAbsSample"]["trace"]> | undefined {
  if (radius <= 0) return undefined;
  const trace: NonNullable<WindowStats["maxAbsSample"]["trace"]> = [];
  for (let offset = -radius; offset <= radius; offset++) {
    const i = sample + offset;
    const j = i - lag;
    const tv = i < 0 || i >= ts.length ? 0 : (ts[i] ?? 0);
    const mv = j < 0 || j >= mame.length ? 0 : (mame[j] ?? 0);
    const tsYmChannels = ymChannels?.map((samples, channel) => ({
      channel,
      value: i < 0 || i >= samples.length ? 0 : (samples[i] ?? 0),
    }));
    const tsPokeyChannels = pokeyChannels?.map((samples, channel) => ({
      channel,
      value: i < 0 || i >= samples.length ? 0 : (samples[i] ?? 0),
    }));
    const refYmChannels = referenceYmChannels?.map((samples, channel) => ({
      channel,
      value: j < 0 || j >= samples.length ? 0 : (samples[j] ?? 0),
    }));
    const refPokeyChannels = referencePokeyChannels?.map((samples, channel) => ({
      channel,
      value: j < 0 || j >= samples.length ? 0 : (samples[j] ?? 0),
    }));
    trace.push({
      offset,
      sample: i,
      mameSample: j,
      ts: tv,
      mame: mv,
      diff: tv - mv,
      tsYm: i < 0 || i >= components.ym.length ? 0 : (components.ym[i] ?? 0),
      tsPokey: i < 0 || i >= components.pokey.length ? 0 : (components.pokey[i] ?? 0),
      ...(referenceComponents === undefined ? {} : {
        refYm: j < 0 || j >= referenceComponents.ym.length ? 0 : (referenceComponents.ym[j] ?? 0),
        refPokey: j < 0 || j >= referenceComponents.pokey.length ? 0 : (referenceComponents.pokey[j] ?? 0),
      }),
      ...(tsYmChannels === undefined ? {} : { tsYmChannels }),
      ...(tsPokeyChannels === undefined ? {} : { tsPokeyChannels }),
      ...(refYmChannels === undefined ? {} : { refYmChannels }),
      ...(refPokeyChannels === undefined ? {} : { refPokeyChannels }),
    });
  }
  return trace;
}

function statsForWindow(
  ts: Float32Array,
  mame: Float32Array,
  components: { ym: Float32Array; pokey: Float32Array },
  referenceComponents: { ym: Float32Array; pokey: Float32Array } | undefined,
  ymChannels: Float32Array[] | undefined,
  pokeyChannels: Float32Array[] | undefined,
  referenceYmChannels: Float32Array[] | undefined,
  referencePokeyChannels: Float32Array[] | undefined,
  start: number,
  size: number,
  maxLag: number,
  lagTieCorrelationEpsilon: number,
  sampleTraceRadius: number,
  sampleTraceCenterSample: number | undefined,
): WindowStats {
  const { lag, correlation, absoluteBestLag, absoluteBestCorrelation } = bestCorrelation(
    ts,
    mame,
    start,
    size,
    maxLag,
    lagTieCorrelationEpsilon,
  );
  let sum = 0;
  let gainCorrectedSum = 0;
  let count = 0;
  let maxAbs = 0;
  let gainCorrectedMaxAbs = 0;
  let tsMaxAbs = 0;
  let mameMaxAbs = 0;
  let tsSquared = 0;
  let tsMame = 0;
  let maxAbsSample: WindowStats["maxAbsSample"] = {
    sample: start,
    mameSample: start,
    ts: 0,
    mame: 0,
    diff: 0,
    tsYm: 0,
    tsPokey: 0,
  };
  const end = Math.min(start + size, ts.length);
  for (let i = start; i < end; i++) {
    const j = i - lag;
    if (j < 0 || j >= mame.length) continue;
    const tv = ts[i] ?? 0;
    const mv = mame[j] ?? 0;
    tsSquared += tv * tv;
    tsMame += tv * mv;
  }
  const bestGain = tsSquared === 0 ? 0 : tsMame / tsSquared;
  for (let i = start; i < end; i++) {
    const j = i - lag;
    if (j < 0 || j >= mame.length) continue;
    const tv = ts[i] ?? 0;
    const mv = mame[j] ?? 0;
    const diff = tv - mv;
    const gainCorrectedDiff = (tv * bestGain) - mv;
    const abs = Math.abs(diff);
    const gainCorrectedAbs = Math.abs(gainCorrectedDiff);
    if (abs > maxAbs) {
      maxAbs = abs;
      const tsYmChannels = ymChannels?.map((samples, channel) => ({ channel, value: samples[i] ?? 0 }));
      const tsPokeyChannels = pokeyChannels?.map((samples, channel) => ({ channel, value: samples[i] ?? 0 }));
      const refYmChannels = referenceYmChannels?.map((samples, channel) => ({ channel, value: samples[j] ?? 0 }));
      const refPokeyChannels = referencePokeyChannels?.map((samples, channel) => ({ channel, value: samples[j] ?? 0 }));
      maxAbsSample = {
        sample: i,
        mameSample: j,
        ts: tv,
        mame: mv,
        diff,
        tsYm: components.ym[i] ?? 0,
        tsPokey: components.pokey[i] ?? 0,
        ...(referenceComponents === undefined ? {} : {
          refYm: referenceComponents.ym[j] ?? 0,
          refPokey: referenceComponents.pokey[j] ?? 0,
        }),
        ...(tsYmChannels === undefined ? {} : { tsYmChannels }),
        ...(tsPokeyChannels === undefined ? {} : { tsPokeyChannels }),
        ...(refYmChannels === undefined ? {} : { refYmChannels }),
        ...(refPokeyChannels === undefined ? {} : { refPokeyChannels }),
      };
    }
    if (gainCorrectedAbs > gainCorrectedMaxAbs) gainCorrectedMaxAbs = gainCorrectedAbs;
    const tsAbs = Math.abs(tv);
    const mameAbs = Math.abs(mv);
    if (tsAbs > tsMaxAbs) tsMaxAbs = tsAbs;
    if (mameAbs > mameMaxAbs) mameMaxAbs = mameAbs;
    sum += diff * diff;
    gainCorrectedSum += gainCorrectedDiff * gainCorrectedDiff;
    count++;
  }
  const traceCenterSample =
    sampleTraceCenterSample !== undefined && sampleTraceCenterSample >= start && sampleTraceCenterSample < end
      ? sampleTraceCenterSample
      : maxAbsSample.sample;
  const trace = sampleTrace(
    ts,
    mame,
    components,
    referenceComponents,
    ymChannels,
    pokeyChannels,
    referenceYmChannels,
    referencePokeyChannels,
    traceCenterSample,
    lag,
    sampleTraceRadius,
  );
  if (trace !== undefined) {
    maxAbsSample = {
      ...maxAbsSample,
      traceCenterSample,
      traceCenterMameSample: traceCenterSample - lag,
      trace,
    };
  }
  return {
    start,
    size,
    lag,
    correlation,
    absoluteBestLag,
    absoluteBestCorrelation,
    bestGain,
    rms: count === 0 ? Infinity : Math.sqrt(sum / count),
    maxAbs,
    gainCorrectedRms: count === 0 ? Infinity : Math.sqrt(gainCorrectedSum / count),
    gainCorrectedMaxAbs,
    tsMaxAbs,
    mameMaxAbs,
    maxAbsSample,
    ...componentStats(components, start, size),
    ...ymChannelWindowStats(ymChannels, start, size),
    ...pokeyChannelWindowStats(pokeyChannels, start, size),
  };
}

function globalGainStats(ts: Float32Array, mame: Float32Array, stats: WindowStats[]): {
  bestGlobalGain: number;
  globalGainCorrectedRms: number;
  globalGainCorrectedMaxAbs: number;
} {
  let tsSquared = 0;
  let tsMame = 0;
  for (const s of stats) {
    const end = Math.min(s.start + s.size, ts.length);
    for (let i = s.start; i < end; i++) {
      const j = i - s.lag;
      if (j < 0 || j >= mame.length) continue;
      const tv = ts[i] ?? 0;
      const mv = mame[j] ?? 0;
      tsSquared += tv * tv;
      tsMame += tv * mv;
    }
  }
  const bestGlobalGain = tsSquared === 0 ? 0 : tsMame / tsSquared;
  let sum = 0;
  let maxAbs = 0;
  let count = 0;
  for (const s of stats) {
    const end = Math.min(s.start + s.size, ts.length);
    for (let i = s.start; i < end; i++) {
      const j = i - s.lag;
      if (j < 0 || j >= mame.length) continue;
      const tv = ts[i] ?? 0;
      const mv = mame[j] ?? 0;
      const diff = (tv * bestGlobalGain) - mv;
      const abs = Math.abs(diff);
      if (abs > maxAbs) maxAbs = abs;
      sum += diff * diff;
      count++;
    }
  }
  return {
    bestGlobalGain,
    globalGainCorrectedRms: count === 0 ? Infinity : Math.sqrt(sum / count),
    globalGainCorrectedMaxAbs: maxAbs,
  };
}

function ymStreamTargetOutputSample(
  targetSample: number,
  dstRate: number,
  ymNativeSampleRate: number,
  ymResampleOffset: number,
  ymOutputSampleOffset: number,
  ymPaddedSamples: number,
  removedPaddedSamples: number,
): number {
  const resampled = Math.round(((targetSample - ymResampleOffset) * dstRate) / ymNativeSampleRate);
  return resampled + ymOutputSampleOffset + ymPaddedSamples - removedPaddedSamples;
}

function loadMameYmStreamTraceWrites(
  path: string | undefined,
  args: Args,
  renderedTs: RenderedTsAudio,
): Map<number, MameChipWrite> | undefined {
  if (path === undefined) return undefined;
  const origins = directChipWriteOrigins(
    args.cmdTape,
    renderedTs.ymNativeSampleRate,
    renderedTs.ymStreamAbsoluteOrigin ? "absolute" : "cmd-tape-replay",
  );
  const writes = loadMameChipWrites(
    path,
    "ym",
    renderedTs.ymNativeSampleRate,
    origins,
    args.ymStreamWriteTraceMameSampleTiming,
    "attos",
  );
  return new Map(writes.map((write) => [write.sourceIndex, write]));
}

function attachYmStreamWriteTraces(
  stats: WindowStats[],
  events: readonly YmStreamWriteEventSummary[] | undefined,
  mameYmWrites: ReadonlyMap<number, MameChipWrite> | undefined,
  dstRate: number,
  renderedTs: RenderedTsAudio,
  args: Args,
): WindowStats[] {
  if (events === undefined || args.ymStreamWriteTraceRadius <= 0) return stats;
  const radius = Math.trunc(args.ymStreamWriteTraceRadius);
  const limit = Math.trunc(args.ymStreamWriteTraceLimit);
  const removedPaddedSamples = args.padResetSilence ? 0 : renderedTs.paddedSamples;
  return stats.map((stat) => {
    const center = args.ymStreamWriteTraceCenterSample ?? stat.maxAbsSample.sample;
    const centerSource = args.ymStreamWriteTraceCenterSample === undefined ? "max-abs" : "arg";
    const nearby: YmStreamWriteTraceEvent[] = [];
    for (const event of events) {
      if (event.targetSample < 0) continue;
      const targetOutputSample = ymStreamTargetOutputSample(
        event.targetSample,
        dstRate,
        renderedTs.ymNativeSampleRate,
        args.ymResampleOffset,
        renderedTs.ymOutputSampleOffset,
        renderedTs.ymPaddedSamples,
        removedPaddedSamples,
      );
      const deltaFromTraceCenter = targetOutputSample - center;
      if (Math.abs(deltaFromTraceCenter) <= radius) {
        const deltaFromMaxAbsSample = targetOutputSample - stat.maxAbsSample.sample;
        const mame = mameYmWrites?.get(event.index);
        const mameTargetSample = mame?.sampleIndex === undefined ? undefined : Number(mame.sampleIndex);
        const mameTargetOutputSample = mameTargetSample === undefined
          ? undefined
          : ymStreamTargetOutputSample(
              mameTargetSample,
              dstRate,
              renderedTs.ymNativeSampleRate,
              args.ymResampleOffset,
              renderedTs.ymOutputSampleOffset,
              renderedTs.ymPaddedSamples,
              removedPaddedSamples,
            );
        nearby.push({
          ...event,
          targetOutputSample,
          deltaFromTraceCenter,
          deltaFromMaxAbsSample,
          ...(mame === undefined || mameTargetSample === undefined || mameTargetOutputSample === undefined
            ? {}
            : {
                mame: {
                  sourceIndex: mame.sourceIndex,
                  frame: mame.frame,
                  pc: mame.pc === undefined ? undefined : `0x${mame.pc.toString(16).padStart(4, "0")}`,
                  targetSample: mameTargetSample,
                  targetOutputSample: mameTargetOutputSample,
                  nativeSampleDelta: event.targetSample - mameTargetSample,
                  outputSampleDelta: targetOutputSample - mameTargetOutputSample,
                },
              }),
        });
      }
    }
    nearby.sort((a, b) =>
      Math.abs(a.deltaFromTraceCenter) - Math.abs(b.deltaFromTraceCenter) ||
      a.targetOutputSample - b.targetOutputSample ||
      a.index - b.index);
    const writes = (limit === 0 ? nearby : nearby.slice(0, limit))
      .sort((a, b) => a.targetOutputSample - b.targetOutputSample || a.index - b.index);
    return {
      ...stat,
      maxAbsSample: {
        ...stat.maxAbsSample,
        ymStreamWriteTrace: {
          radiusOutputSamples: radius,
          centerOutputSample: center,
          centerSource,
          totalInRadius: nearby.length,
          approximatedFromNativeTargetSample: true,
          mameYmWrites: args.ymStreamWriteTraceMameYmWrites,
          mameSampleOrigin: mameYmWrites === undefined
            ? undefined
            : renderedTs.ymStreamAbsoluteOrigin
              ? "absolute"
              : "cmd-tape-replay",
          writes,
        },
      },
    };
  });
}

function main(): void {
  const args = parseArgs();
  if (args.mameWav === undefined || !existsSync(args.mameWav)) {
    console.error("Usage: probe-sound-sample-diff --mame <wav> [--frames N] [--cmd-tape <json>]");
    console.error("MAME WAV not found:", args.mameWav);
    process.exit(2);
  }

  const mameWav = parseWav(readFileSync(args.mameWav));
  const mameLeft = leftChannel(mameWav);
  const mameSubtractLeft = args.mameSubtractWav === undefined
    ? undefined
    : leftChannel(parseWav(readFileSync(args.mameSubtractWav)));
  if (mameSubtractLeft !== undefined && mameSubtractLeft.length !== mameLeft.length) {
    throw new Error(
      `--mame-subtract-wav sample count mismatch: base=${mameLeft.length} subtract=${mameSubtractLeft.length}`,
    );
  }
  const directChipWriteMode = args.mameYmWrites !== undefined || args.mamePokeyWrites !== undefined;
  const referenceDirectChipWriteMode =
    args.referenceMameYmWrites !== undefined || args.referenceMamePokeyWrites !== undefined;
  if (args.referenceMameComponentsOnly && !referenceDirectChipWriteMode) {
    throw new Error("--reference-mame-components-only requires --reference-mame-ym-writes and/or --reference-mame-pokey-writes");
  }
  if (directChipWriteMode && args.source === "ym" && args.mameYmWrites === undefined) {
    throw new Error("--source ym with direct chip-write render requires --mame-ym-writes");
  }
  if (directChipWriteMode && args.source === "pokey" && args.mamePokeyWrites === undefined) {
    throw new Error("--source pokey with direct chip-write render requires --mame-pokey-writes");
  }
  if (referenceDirectChipWriteMode && directChipWriteMode) {
    throw new Error("--reference-mame-*-writes compares SoundChip replay against direct chip writes; do not combine with --mame-*-writes direct render mode");
  }
  if (referenceDirectChipWriteMode && !args.referenceMameComponentsOnly && args.mameSubtractWav !== undefined) {
    throw new Error("--mame-subtract-wav cannot be combined with --reference-mame-*-writes");
  }
  if (referenceDirectChipWriteMode && !args.referenceMameComponentsOnly && args.mameSubtractSource !== "none") {
    throw new Error("--mame-subtract-source cannot be combined with --reference-mame-*-writes");
  }
  if (referenceDirectChipWriteMode && args.source === "ym" && args.referenceMameYmWrites === undefined) {
    throw new Error("--source ym with --reference-mame-*-writes requires --reference-mame-ym-writes");
  }
  if (referenceDirectChipWriteMode && args.source === "pokey" && args.referenceMamePokeyWrites === undefined) {
    throw new Error("--source pokey with --reference-mame-*-writes requires --reference-mame-pokey-writes");
  }
  if (
    referenceDirectChipWriteMode &&
    args.source === "mix" &&
    (args.referenceMameYmWrites === undefined || args.referenceMamePokeyWrites === undefined)
  ) {
    throw new Error("--source mix with --reference-mame-*-writes requires both reference YM and POKEY write logs");
  }
  if (directChipWriteMode && args.pokeyWriteApplyDelayCycles !== 0) {
    throw new Error("--pokey-write-apply-delay is for SoundChip replay; use --pokey-write-cycle-offset in direct chip-write mode");
  }
  if (directChipWriteMode && args.pokeyWriteApplyDelayOpcodes.size !== 0) {
    throw new Error("--pokey-write-apply-delay-opcodes is for SoundChip replay; use --pokey-write-cycle-offset in direct chip-write mode");
  }
  if (directChipWriteMode && args.pokeyWriteApplyDelayMatches.length !== 0) {
    throw new Error("--pokey-write-apply-delay-matches is for SoundChip replay; use --pokey-write-cycle-offset in direct chip-write mode");
  }
  if (directChipWriteMode && args.pokeyWriteApplyBoundaryDelayCycles !== 0) {
    throw new Error("--pokey-write-apply-boundary-delay-cycles is for SoundChip replay; use --pokey-write-cycle-offset in direct chip-write mode");
  }
  if (
    !directChipWriteMode &&
    !referenceDirectChipWriteMode &&
    (args.directYmWriteSampleOffset !== 0 ||
      args.directYmWriteSampleOffsetRegs.size !== 0 ||
      args.directYmWriteSampleOffsetMatches.length !== 0)
  ) {
    throw new Error("--direct-ym-write-sample-offset is for direct chip-write render");
  }
  if (directChipWriteMode && args.timerAStartDelayCycles !== 0) {
    throw new Error("--timer-a-start-delay is for SoundChip replay timing diagnostics");
  }
  if (directChipWriteMode && args.ymStreamAbsoluteOrigin) {
    throw new Error("--ym-stream-absolute-origin is for SoundChip replay, not direct chip-write render");
  }
  if (
    (directChipWriteMode || referenceDirectChipWriteMode) &&
    args.ymScheduler !== "mame-stream" &&
    (args.directYmWriteSampleOffset !== 0 ||
      args.directYmWriteSampleOffsetRegs.size !== 0 ||
      args.directYmWriteSampleOffsetMatches.length !== 0)
  ) {
    throw new Error("--direct-ym-write-sample-offset requires direct chip-write --ym-scheduler mame-stream");
  }
  if (args.ymStreamAbsoluteOrigin && args.ymScheduler !== "mame-stream") {
    throw new Error("--ym-stream-absolute-origin requires --ym-scheduler mame-stream");
  }
  const renderedTs = directChipWriteMode
    ? renderMameChipWrites(
        mameWav.sampleRate,
        mameLeft.length,
        args.mameYmWrites,
        args.mamePokeyWrites,
        args.ymChannelDiagnostics,
        args.pokeyChannelDiagnostics,
        args.ymPhaseAdvanceAfterOutput,
        args.ymNativeSampleRate,
        args.ymScheduler,
        args.ymResampleOffset,
        args.pokeyResampleOffset,
        args.pokeyWriteCycleOffset,
        args.pokeySampleCycles,
        args.pokeySampleAfterClock,
        args.resampler,
        args.ymResampler,
        args.pokeyResampler,
        args.ymOutputSampleOffset,
        args.pokeyOutputSampleOffset,
        args.cmdTape,
        args.directChipWriteOrigin,
        args.directChipWriteSampleTiming,
        args.directChipWriteCycleTiming,
        args.directChipWriteCycleRateMode,
        args.directYmWriteSampleOffset,
        args.directYmWriteSampleOffsetRegs,
        args.directYmWriteSampleOffsetMatches,
        args.ymStateTraceChannel,
        args.ymStateTraceNativeStart ?? 0,
        args.ymStateTraceNativeEnd ?? 0,
        args.pokeyRawTraceCenterSample,
        args.pokeyRawTraceRadius,
      )
    : renderTsMix(
        args.frames,
        args.cmdTape,
        mameWav.sampleRate,
        args.statusTape,
        args.statusTapeMode,
        args.statusValueMode,
        args.resetReleaseDelayCycles,
        args.resetFirstFetchDelayAfterCommandCycles,
        args.replyAckDelayCycles,
        args.replyAckTape,
        args.useEmbeddedReplyAckTape,
        args.timerAStartDelayCycles,
        args.commandNmiDelayInstructions,
        args.commandNmiSampleCycle,
        args.commandNmiBoundaryDelayInstructions,
        args.commandNmiDelayMatches,
        args.commandNmiDelayChipWriteBoundaryInstructions,
        args.commandNmiDelayCompletedChipWritePreemptions,
        args.commandCycleOffsetCycles,
        args.commandCycleOffsetStartFrame,
        args.commandSubmitBeforeCpuCatchup,
        args.commandPreemptChipWriteLookaheadCycles,
        args.commandPreemptChipWritePcs,
        args.commandPreemptChipWriteCompleteBeforeTarget,
        args.commandPreemptChipWriteBeforeOnly,
        args.deferChipIoWriteTiming,
        args.deferYmAudioWriteTiming,
        args.deferYmParameterWriteTiming,
        args.deferYmTimerControlWriteTiming,
        args.disableYmReset,
        args.ymWriteEventCycleOffsetCycles,
        args.ymWriteEventCycleOffsetRegs,
        args.ymWriteEventCycleOffsetMatches,
        args.ymWriteEventSampleOffsetMatches,
        args.ymKeyOnWriteEventCycleOffsetCycles,
        args.ymCommandEdgeEventRules,
        args.pokeyCommandEdgeEventRules,
        args.requireCommandContext,
        args.irqServiceDelayCycles,
        args.ymChannelDiagnostics,
        args.pokeyChannelDiagnostics,
        args.ymPhaseAdvanceAfterOutput,
        args.ymNativeSampleRate,
        args.ymScheduler,
        args.ymStreamAbsoluteOrigin,
        args.ymResampleOffset,
        args.pokeyResampleOffset,
        args.pokeySampleCycles,
        args.pokeySampleAfterClock,
        args.resampler,
        args.ymResampler,
        args.pokeyResampler,
        args.ymOutputSampleOffset,
        args.pokeyOutputSampleOffset,
        args.pokeyWriteApplyDelayCycles,
        args.pokeyWriteApplyDelayOpcodes,
        args.pokeyWriteApplyDelayMatches,
        args.pokeyWriteApplyBoundaryDelayCycles,
        args.pokeyWriteApplyBoundaryDelaySampleRate,
        args.pokeyCommandEdgeRawCycleOffsetOpcodes,
        args.ymStreamWriteTraceRadius > 0,
        args.traceFrameAdvance,
        args.ymStateTraceChannel,
        args.ymStateTraceNativeStart ?? 0,
        args.ymStateTraceNativeEnd ?? 0,
        args.pokeyRawTraceCenterSample,
        args.pokeyRawTraceRadius,
        args.cmdTapeCommandTiming,
        args.fixedFrameCycles,
        args.frameBudgetSmoothingWindow,
      );
  const renderedReference = referenceDirectChipWriteMode
    ? renderMameChipWrites(
        mameWav.sampleRate,
        mameLeft.length,
        args.referenceMameYmWrites,
        args.referenceMamePokeyWrites,
        args.ymChannelDiagnostics,
        args.pokeyChannelDiagnostics,
        args.ymPhaseAdvanceAfterOutput,
        args.ymNativeSampleRate,
        args.ymScheduler,
        args.ymResampleOffset,
        args.referencePokeyResampleOffset ?? args.pokeyResampleOffset,
        args.referencePokeyWriteCycleOffset ?? args.pokeyWriteCycleOffset,
        args.pokeySampleCycles,
        args.pokeySampleAfterClock,
        args.resampler,
        args.ymResampler,
        args.pokeyResampler,
        args.ymOutputSampleOffset,
        args.pokeyOutputSampleOffset,
        args.cmdTape,
        args.directChipWriteOrigin,
        args.directChipWriteSampleTiming,
        args.directChipWriteCycleTiming,
        args.directChipWriteCycleRateMode,
        args.directYmWriteSampleOffset,
        args.directYmWriteSampleOffsetRegs,
        args.directYmWriteSampleOffsetMatches,
        args.ymStateTraceChannel,
        args.ymStateTraceNativeStart ?? 0,
        args.ymStateTraceNativeEnd ?? 0,
        args.pokeyRawTraceCenterSample,
        args.pokeyRawTraceRadius,
      )
    : undefined;
  const selectedTs = args.source === "ym"
    ? renderedTs.ym
    : args.source === "pokey"
      ? renderedTs.pokey
      : renderedTs.mix;
  const tsMix = args.padResetSilence
    ? selectedTs
    : selectedTs.subarray(renderedTs.paddedSamples);
  const tsComponents = args.padResetSilence
    ? { ym: renderedTs.ym, pokey: renderedTs.pokey }
    : {
        ym: renderedTs.ym.subarray(renderedTs.paddedSamples),
        pokey: renderedTs.pokey.subarray(renderedTs.paddedSamples),
      };
  const tsYmChannels = args.padResetSilence
    ? renderedTs.ymChannels
    : renderedTs.ymChannels?.map((ch) => ch.subarray(renderedTs.paddedSamples));
  const tsPokeyChannels = args.padResetSilence
    ? renderedTs.pokeyChannels
    : renderedTs.pokeyChannels?.map((ch) => ch.subarray(renderedTs.paddedSamples));
  const mameWithWavSubtract = mameSubtractLeft === undefined
    ? mameLeft
    : subtractSignal(mameLeft, mameSubtractLeft, args.mameSubtractWavGain);
  const referenceSelected = renderedReference === undefined
    ? undefined
    : args.source === "ym"
      ? renderedReference.ym
      : args.source === "pokey"
        ? renderedReference.pokey
        : renderedReference.mix;
  const referenceComponents = renderedReference === undefined
    ? undefined
    : { ym: renderedReference.ym, pokey: renderedReference.pokey };
  const referenceYmChannels = renderedReference?.ymChannels;
  const referencePokeyChannels = renderedReference?.pokeyChannels;
  const pokeyRawTraceComparison = comparePokeyRawTraces(renderedTs.pokeyRawTrace, renderedReference?.pokeyRawTrace);
  const pokeyRawTracePcmResidualComparison =
    args.pokeyRawTracePcmRadius > 0 && args.source !== "ym" && args.padResetSilence
      ? comparePokeyRawTracePcmResiduals(
          renderedTs.pokeyRawTrace,
          renderedReference?.pokeyRawTrace,
          tsMix,
          referenceSelected,
          args.pokeyRawTracePcmRadius,
          args.pokeyRawTracePcmMaxLag,
          renderedTs.pokeyWriteEvents,
          renderedReference?.pokeyWriteEvents,
        )
      : undefined;
  const mameCompare = referenceSelected !== undefined && !args.referenceMameComponentsOnly
    ? referenceSelected
    : args.mameSubtractSource === "ym"
      ? subtractSignal(mameWithWavSubtract, tsComponents.ym, args.mameSubtractGain)
      : args.mameSubtractSource === "pokey"
        ? subtractSignal(mameWithWavSubtract, tsComponents.pokey, args.mameSubtractGain)
        : mameWithWavSubtract;
  const windowSignal = args.windowSource === "mame"
    ? mameCompare
    : args.windowSource === "ts"
      ? tsMix
      : args.windowSource === "ym"
        ? tsComponents.ym
        : tsComponents.pokey;
  const selectedWindows = chooseWindows(windowSignal, args);
  const windows = selectedWindows.windows
    .filter((w) => w.start < tsMix.length && w.start < mameCompare.length);
  const baseStats = windows.map((w) =>
    statsForWindow(
      tsMix,
      mameCompare,
      tsComponents,
      referenceComponents,
      tsYmChannels,
      tsPokeyChannels,
      referenceYmChannels,
      referencePokeyChannels,
      w.start,
      w.size,
      args.maxLag,
      args.lagTieCorrelationEpsilon,
      args.sampleTraceRadius,
      args.sampleTraceCenterSample,
    ));
  const mameYmStreamTraceWrites = loadMameYmStreamTraceWrites(
    args.ymStreamWriteTraceMameYmWrites,
    args,
    renderedTs,
  );
  const stats = attachYmStreamWriteTraces(
    baseStats,
    renderedTs.ymStreamWriteTraceEvents,
    mameYmStreamTraceWrites,
    mameWav.sampleRate,
    renderedTs,
    args,
  );
  const tsSignalStats = signalStats(tsMix);
  const ymSignalStats = signalStats(tsComponents.ym);
  const pokeySignalStats = signalStats(tsComponents.pokey);
  const windowSignalStats = signalStats(windowSignal);
  const mameCompareStats = signalStats(mameCompare);
  const worstCorrelation = Math.min(...stats.map((s) => s.correlation));
  const worstAbsLag = Math.max(...stats.map((s) => Math.abs(s.lag)));
  const worstRms = Math.max(...stats.map((s) => s.rms));
  const worstMaxAbs = Math.max(...stats.map((s) => s.maxAbs));
  const worstGainCorrectedRms = Math.max(...stats.map((s) => s.gainCorrectedRms));
  const worstGainCorrectedMaxAbs = Math.max(...stats.map((s) => s.gainCorrectedMaxAbs));
  const bestGainMin = Math.min(...stats.map((s) => s.bestGain));
  const bestGainMax = Math.max(...stats.map((s) => s.bestGain));
  const dominantSources = stats.reduce<Record<WindowStats["dominantSource"], number>>(
    (counts, s) => {
      counts[s.dominantSource]++;
      return counts;
    },
    { ym: 0, pokey: 0, mixed: 0, silent: 0 },
  );
  const globalGain = globalGainStats(tsMix, mameCompare, stats);
  const passed = worstCorrelation >= args.minCorrelation &&
    worstAbsLag <= args.maxAbsLag &&
    worstRms <= args.maxRms &&
    worstMaxAbs <= args.maxAbs;
  const pokeyWriteCycleRate = renderedTs.renderMode === "mame-chip-writes"
    ? renderedTs.directChipWriteCycleRate
    : SOUND_CMD_TAPE_CPU_HZ;
  const pokeyWriteCycleOffsetOutputSamples =
    (args.pokeyWriteCycleOffset * mameWav.sampleRate) / pokeyWriteCycleRate;
  const pokeyWriteApplyDelayOutputSamples =
    (args.pokeyWriteApplyDelayCycles * mameWav.sampleRate) / SOUND_CMD_TAPE_CPU_HZ;
  const pokeyDeviceWriteSnapshotComparison = comparePokeyDeviceWriteSnapshots(
    renderedTs.pokeyDeviceWriteSnapshots,
    renderedReference?.pokeyDeviceWriteSnapshots,
    renderedTs.pokeyWriteEvents,
    renderedReference?.pokeyWriteEvents,
  );

  const report = {
    probe: {
      argv: process.argv.slice(2),
      ...(args.audioBitperfectPreset === undefined ? {} : { audioBitperfectPreset: args.audioBitperfectPreset }),
      cwd: process.cwd(),
      windowStart: args.windowStart,
      windowSize: args.windowSize,
      windowHop: args.windowHop,
      maxWindows: args.maxWindows,
      maxLag: args.maxLag,
      padResetSilence: args.padResetSilence,
      audibleThreshold: args.audibleThreshold,
      sampleTraceCenterSample: args.sampleTraceCenterSample,
      ymStreamWriteTraceRadius: args.ymStreamWriteTraceRadius,
      ymStreamWriteTraceLimit: args.ymStreamWriteTraceLimit,
      ymStreamWriteTraceCenterSample: args.ymStreamWriteTraceCenterSample,
      ymStreamWriteTraceMameYmWrites: args.ymStreamWriteTraceMameYmWrites,
      ymStreamWriteTraceMameSampleTiming: args.ymStreamWriteTraceMameSampleTiming,
      ymStateTraceChannel: args.ymStateTraceChannel,
      ymStateTraceNativeStart: args.ymStateTraceNativeStart,
      ymStateTraceNativeEnd: args.ymStateTraceNativeEnd,
      pokeyRawTraceRadius: args.pokeyRawTraceRadius,
      pokeyRawTraceCenterSample: args.pokeyRawTraceCenterSample,
      pokeyRawTracePcmRadius: args.pokeyRawTracePcmRadius,
      pokeyRawTracePcmMaxLag: args.pokeyRawTracePcmMaxLag,
      directChipWriteCycleRateMode: args.directChipWriteCycleRateMode,
      compactReport: args.compactReport,
    },
    mame: { path: args.mameWav, sampleRate: mameWav.sampleRate, channels: mameWav.channels, samples: mameLeft.length },
    mameCompare: {
      source: referenceSelected === undefined
        ? "wav"
        : args.referenceMameComponentsOnly
          ? "wav-with-direct-chip-reference-components"
          : "direct-chip-writes",
      subtractWav: args.mameSubtractWav,
      subtractWavGain: args.mameSubtractWavGain,
      subtractSource: args.mameSubtractSource,
      subtractGain: args.mameSubtractGain,
      referenceMameYmWrites: args.referenceMameYmWrites,
      referenceMamePokeyWrites: args.referenceMamePokeyWrites,
      referenceMameComponentsOnly: args.referenceMameComponentsOnly,
      referenceRenderMode: renderedReference?.renderMode,
      referenceDirectChipWriteOrigin: renderedReference?.directChipWriteOrigin,
      referenceDirectChipWriteSampleTiming: renderedReference?.directChipWriteSampleTiming,
      referenceDirectChipWriteCycleTiming: renderedReference?.directChipWriteCycleTiming,
      referenceDirectChipWriteCycleRateMode: renderedReference === undefined
        ? undefined
        : args.directChipWriteCycleRateMode,
      referenceDirectChipWriteCycleRate: renderedReference?.directChipWriteCycleRate,
      referencePokeyResampleOffset: renderedReference === undefined
        ? undefined
        : (args.referencePokeyResampleOffset ?? args.pokeyResampleOffset),
      referencePokeyWriteCycleOffset: renderedReference === undefined
        ? undefined
        : (args.referencePokeyWriteCycleOffset ?? args.pokeyWriteCycleOffset),
      referencePokeySampleAfterClock: renderedReference?.pokeySampleAfterClock,
      referenceYmSamples: renderedReference?.ymSamples,
      referencePokeySamples: renderedReference?.pokeySamples,
      referenceYmStateTrace: args.compactReport
        ? compactArrayReport(renderedReference?.ymStateTrace)
        : renderedReference?.ymStateTrace,
      referencePokeyRawTrace: pokeyRawTraceReport(renderedReference?.pokeyRawTrace, args.compactReport),
      referencePokeyWriteEvents: args.compactReport
        ? compactArrayReport(renderedReference?.pokeyWriteEvents)
        : renderedReference?.pokeyWriteEvents,
      referencePokeyDeviceWriteSnapshots: args.compactReport
        ? compactArrayReport(renderedReference?.pokeyDeviceWriteSnapshots)
        : renderedReference?.pokeyDeviceWriteSnapshots,
      referencePokeyDeviceWriteSnapshotComparison: pokeyDeviceWriteSnapshotComparison,
      referencePokeyRawTraceComparison: pokeyRawTraceComparisonReport(pokeyRawTraceComparison, args.compactReport),
      referencePokeyRawTracePcmResidualComparison:
        pokeyRawTracePcmResidualComparisonReport(pokeyRawTracePcmResidualComparison, args.compactReport),
      ...mameCompareStats,
    },
    ts: {
      frames: args.frames,
      cmdTape: args.cmdTape,
      cmdTapeCommandTiming: args.cmdTapeCommandTiming,
      fixedFrameCycles: args.fixedFrameCycles,
      frameBudgetSmoothingWindow: args.frameBudgetSmoothingWindow,
      renderMode: renderedTs.renderMode,
      mameYmWrites: renderedTs.mameYmWrites,
      mamePokeyWrites: renderedTs.mamePokeyWrites,
      directChipWriteOrigin: renderedTs.directChipWriteOrigin,
      directChipWriteSampleTiming: renderedTs.directChipWriteSampleTiming,
      directChipWriteCycleTiming: renderedTs.directChipWriteCycleTiming,
      directChipWriteCycleRateMode: directChipWriteMode ? args.directChipWriteCycleRateMode : undefined,
      directChipWriteCycleRate: renderedTs.directChipWriteCycleRate,
      directYmWriteSampleOffset: renderedTs.directYmWriteSampleOffset,
      ...(args.directYmWriteSampleOffsetRegs.size === 0
        ? {}
        : { directYmWriteSampleOffsetRegs: registerCycleOffsetsToJson(args.directYmWriteSampleOffsetRegs) }),
      ...(args.directYmWriteSampleOffsetMatches.length === 0
        ? {}
        : {
            directYmWriteSampleOffsetMatches:
              directYmWriteSampleOffsetMatchesToJson(args.directYmWriteSampleOffsetMatches),
          }),
      source: args.source,
      windowSource: args.windowSource,
      cyclePreciseTape: renderedTs.cyclePreciseTape,
      requireCommandContext: args.requireCommandContext,
      commandContext: renderedTs.commandContext,
      frameReplayEvents: renderedTs.frameReplayEvents,
      commandReplaySummary: commandReplayEventsSummary(renderedTs.commandReplayEvents),
      commandReplayEvents: args.compactReport
        ? compactArrayReport(renderedTs.commandReplayEvents)
        : renderedTs.commandReplayEvents,
      resetFrame: renderedTs.resetFrame,
      resetReleaseDelayCycles: args.resetReleaseDelayCycles,
      resetFirstFetchDelayAfterCommandCycles: args.resetFirstFetchDelayAfterCommandCycles,
      replyAckDelayCycles: args.replyAckDelayCycles,
      useEmbeddedReplyAckTape: args.useEmbeddedReplyAckTape,
      timerAStartDelayCycles: args.timerAStartDelayCycles,
      commandNmiDelayInstructions: args.commandNmiDelayInstructions,
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
        : {
            commandNmiDelayCompletedChipWritePreemptions:
              args.commandNmiDelayCompletedChipWritePreemptions,
          }),
      commandCycleOffsetCycles: args.commandCycleOffsetCycles,
      ...(args.commandCycleOffsetStartFrame === undefined ? {} : { commandCycleOffsetStartFrame: args.commandCycleOffsetStartFrame }),
      commandSubmitBeforeCpuCatchup: args.commandSubmitBeforeCpuCatchup,
      commandPreemptChipWriteLookaheadCycles: args.commandPreemptChipWriteLookaheadCycles,
      ...(args.commandPreemptChipWritePcs === undefined
        ? {}
        : {
            commandPreemptChipWritePcs:
              args.commandPreemptChipWritePcs.map((pc) => `0x${pc.toString(16).padStart(4, "0")}`),
          }),
      commandPreemptChipWriteCompleteBeforeTarget: args.commandPreemptChipWriteCompleteBeforeTarget,
      commandPreemptChipWriteBeforeOnly: args.commandPreemptChipWriteBeforeOnly,
      deferChipIoWriteTiming: args.deferChipIoWriteTiming,
      deferYmAudioWriteTiming: args.deferYmAudioWriteTiming,
      deferYmParameterWriteTiming: args.deferYmParameterWriteTiming,
      deferYmTimerControlWriteTiming: args.deferYmTimerControlWriteTiming,
      disableYmReset: args.disableYmReset,
      ymWriteEventCycleOffsetCycles: args.ymWriteEventCycleOffsetCycles,
      ...(args.ymWriteEventCycleOffsetRegs.size === 0
        ? {}
        : { ymWriteEventCycleOffsetRegs: registerCycleOffsetsToJson(args.ymWriteEventCycleOffsetRegs) }),
      ...(args.ymWriteEventCycleOffsetMatches.length === 0
        ? {}
        : { ymWriteEventCycleOffsetMatches: ymWriteEventCycleOffsetMatchesToJson(args.ymWriteEventCycleOffsetMatches) }),
      ...(args.ymWriteEventSampleOffsetMatches.length === 0
        ? {}
        : {
            ymWriteEventSampleOffsetMatches:
              directYmWriteSampleOffsetMatchesToJson(args.ymWriteEventSampleOffsetMatches),
          }),
      ymKeyOnWriteEventCycleOffsetCycles: args.ymKeyOnWriteEventCycleOffsetCycles,
      ...(args.ymCommandEdgeEventRules.length === 0
        ? {}
        : {
            ymCommandEdgeEventAfterCycles: args.ymCommandEdgeEventAfterCycles,
            ymCommandEdgeEventRules: commandEdgeEventRulesToJson(args.ymCommandEdgeEventRules),
            ymCommandEdgeEventAdjust: renderedTs.ymCommandEdgeEventAdjust,
          }),
      ...(args.pokeyCommandEdgeEventRules.length === 0
        ? {}
        : {
            pokeyCommandEdgeEventAfterCycles: args.pokeyCommandEdgeEventAfterCycles,
            pokeyCommandEdgeEventRules: commandEdgeEventRulesToJson(args.pokeyCommandEdgeEventRules),
            pokeyCommandEdgeEventAdjust: renderedTs.pokeyCommandEdgeEventAdjust,
          }),
      irqServiceDelayCycles: args.irqServiceDelayCycles,
      ymPhaseAdvanceAfterOutput: args.ymPhaseAdvanceAfterOutput,
      ymScheduler: renderedTs.ymScheduler,
      ymStreamAbsoluteOrigin: renderedTs.ymStreamAbsoluteOrigin,
      ymStreamSampleOffset: renderedTs.ymStreamSampleOffset,
      ymStreamCycleOffsetCycles: renderedTs.ymStreamCycleOffsetCycles,
      resampler: renderedTs.resampler,
      ymResampler: renderedTs.ymResampler,
      pokeyResampler: renderedTs.pokeyResampler,
      ymNativeSampleRate: renderedTs.ymNativeSampleRate,
      ymResampleOffset: args.ymResampleOffset,
      pokeyResampleOffset: args.pokeyResampleOffset,
      ymOutputSampleOffset: renderedTs.ymOutputSampleOffset,
      pokeyOutputSampleOffset: renderedTs.pokeyOutputSampleOffset,
      pokeyWriteCycleOffset: args.pokeyWriteCycleOffset,
      pokeyWriteCycleOffsetOutputSamples,
      pokeyWriteApplyDelayCycles: args.pokeyWriteApplyDelayCycles,
      pokeyWriteApplyDelayOutputSamples,
      ...(args.pokeyWriteApplyDelayOpcodes.size === 0
        ? {}
        : { pokeyWriteApplyDelayOpcodes: registerCycleOffsetsToJson(args.pokeyWriteApplyDelayOpcodes) }),
      ...(args.pokeyWriteApplyDelayMatches.length === 0
        ? {}
        : { pokeyWriteApplyDelayMatches: ymWriteEventCycleOffsetMatchesToJson(args.pokeyWriteApplyDelayMatches) }),
      ...(args.pokeyWriteApplyBoundaryDelayCycles === 0
        ? {}
        : {
            pokeyWriteApplyBoundaryDelayCycles: args.pokeyWriteApplyBoundaryDelayCycles,
            pokeyWriteApplyBoundaryDelaySampleRate: args.pokeyWriteApplyBoundaryDelaySampleRate,
          }),
      ...(args.pokeyCommandEdgeRawCycleOffsetOpcodes.size === 0
        ? {}
        : {
            pokeyCommandEdgeRawCycleOffsetOpcodes:
              registerCycleOffsetsToJson(args.pokeyCommandEdgeRawCycleOffsetOpcodes),
          }),
      pokeySampleCycles: renderedTs.pokeySampleCycles,
      pokeySampleAfterClock: renderedTs.pokeySampleAfterClock,
      pokeyNativeSampleRate: renderedTs.pokeyNativeSampleRate,
      ...(renderedTs.ymStreamWriteDiagnostics === undefined
        ? {}
        : { ymStreamWriteDiagnostics: renderedTs.ymStreamWriteDiagnostics }),
      mameSubtractWav: args.mameSubtractWav,
      mameSubtractWavGain: args.mameSubtractWavGain,
      mameSubtractSource: args.mameSubtractSource,
      mameSubtractGain: args.mameSubtractGain,
      ymChannelDiagnostics: args.ymChannelDiagnostics,
      pokeyChannelDiagnostics: args.pokeyChannelDiagnostics,
      ymStateTrace: args.compactReport ? compactArrayReport(renderedTs.ymStateTrace) : renderedTs.ymStateTrace,
      pokeyRawTrace: pokeyRawTraceReport(renderedTs.pokeyRawTrace, args.compactReport),
      pokeyWriteEvents: args.compactReport
        ? compactArrayReport(renderedTs.pokeyWriteEvents)
        : renderedTs.pokeyWriteEvents,
      pokeyDeviceWriteSnapshots: args.compactReport
        ? compactArrayReport(renderedTs.pokeyDeviceWriteSnapshots)
        : renderedTs.pokeyDeviceWriteSnapshots,
      samples: tsMix.length,
      ymSamples: renderedTs.ymSamples,
      pokeySamples: renderedTs.pokeySamples,
      paddedSamples: args.padResetSilence ? renderedTs.paddedSamples : 0,
      ymPaddedSamples: args.padResetSilence
        ? renderedTs.ymPaddedSamples
        : Math.max(0, renderedTs.ymPaddedSamples - renderedTs.paddedSamples),
      pokeyPaddedSamples: args.padResetSilence
        ? renderedTs.pokeyPaddedSamples
        : Math.max(0, renderedTs.pokeyPaddedSamples - renderedTs.paddedSamples),
      ...(args.statusTape === undefined ? {} : { statusTapeMode: args.statusTapeMode, statusValueMode: args.statusValueMode }),
      ...(statusReplayReport(renderedTs.statusReplay) === undefined ? {} : { statusReplay: statusReplayReport(renderedTs.statusReplay) }),
      ...(mainReplyAckReplayReport(renderedTs.replyAckReplay) === undefined ? {} : { replyAckReplay: mainReplyAckReplayReport(renderedTs.replyAckReplay) }),
    },
    thresholds: {
      minCorrelation: args.minCorrelation,
      maxAbsLag: args.maxAbsLag,
      maxRms: args.maxRms,
      maxAbs: args.maxAbs,
      maxLag: args.maxLag,
      lagTieCorrelationEpsilon: args.lagTieCorrelationEpsilon,
      sampleTraceRadius: args.sampleTraceRadius,
      ymStreamWriteTraceRadius: args.ymStreamWriteTraceRadius,
      ymStreamWriteTraceLimit: args.ymStreamWriteTraceLimit,
      ymStreamWriteTraceCenterSample: args.ymStreamWriteTraceCenterSample,
      ymStreamWriteTraceMameYmWrites: args.ymStreamWriteTraceMameYmWrites,
      ymStreamWriteTraceMameSampleTiming: args.ymStreamWriteTraceMameSampleTiming,
      pokeyRawTraceRadius: args.pokeyRawTraceRadius,
      pokeyRawTraceCenterSample: args.pokeyRawTraceCenterSample,
      pokeyRawTracePcmRadius: args.pokeyRawTracePcmRadius,
      pokeyRawTracePcmMaxLag: args.pokeyRawTracePcmMaxLag,
    },
    summary: {
      passed,
      worstCorrelation,
      worstAbsLag,
      worstRms,
      worstMaxAbs,
      worstGainCorrectedRms,
      worstGainCorrectedMaxAbs,
      bestGainMin,
      bestGainMax,
      ...globalGain,
      lagHistogram: windowLagHistogram(stats),
      lagRuns: windowLagRuns(stats),
      worstWindows: worstWindowSummaries(stats),
      pokeyRawTraceComparison: pokeyRawTraceComparisonSummary(pokeyRawTraceComparison),
      pokeyRawTracePcmResidual: pokeyRawTracePcmResidualSummary(pokeyRawTracePcmResidualComparison),
      dominantSources,
      sourceStats: {
        mameCompare: mameCompareStats,
        ts: tsSignalStats,
        ym: ymSignalStats,
        pokey: pokeySignalStats,
        windowSignal: windowSignalStats,
      },
      windowSelection: {
        source: args.windowSource,
        audibleThreshold: args.audibleThreshold,
        audibleCount: selectedWindows.audibleCount,
        selectedCount: windows.length,
      },
    },
    windows: stats,
  };
  if (args.report !== undefined) writeFileSync(args.report, JSON.stringify(report, null, 2));

  console.log(`MAME WAV: ${mameWav.sampleRate}Hz ch=${mameWav.channels} samples=${mameLeft.length}`);
  if (args.mameSubtractWav !== undefined || args.mameSubtractSource !== "none") {
    console.log(
      `MAME compare: subtractWav=${args.mameSubtractWav ?? "none"} wavGain=${args.mameSubtractWavGain} ` +
      `subtract=${args.mameSubtractSource} gain=${args.mameSubtractGain} ` +
      `rms=${mameCompareStats.rms.toFixed(6)} maxAbs=${mameCompareStats.maxAbs.toFixed(6)}`,
    );
  }
  if (renderedReference !== undefined) {
    console.log(
      `MAME compare: source=${args.referenceMameComponentsOnly ? "wav+direct-chip-reference-components" : "direct-chip-writes"} ` +
      `ym=${args.referenceMameYmWrites ?? "none"} ` +
      `pokey=${args.referenceMamePokeyWrites ?? "none"} samples=${mameCompare.length} ` +
      (args.referencePokeyWriteCycleOffset === undefined
        ? ""
        : `referencePokeyWriteCycleOffset=${args.referencePokeyWriteCycleOffset} `) +
      (args.referencePokeyResampleOffset === undefined
        ? ""
        : `referencePokeyResampleOffset=${args.referencePokeyResampleOffset} `) +
      `rms=${mameCompareStats.rms.toFixed(6)} maxAbs=${mameCompareStats.maxAbs.toFixed(6)}`,
    );
  }
  console.log(
    `TS: mode=${renderedTs.renderMode} source=${args.source} frames=${args.frames} samples=${tsMix.length} ym=${renderedTs.ymSamples} ` +
    `pokey=${renderedTs.pokeySamples} padded=${args.padResetSilence ? renderedTs.paddedSamples : 0}` +
    (args.audioBitperfectPreset === undefined ? "" : ` preset=${args.audioBitperfectPreset}`) +
    (renderedTs.ymPaddedSamples !== renderedTs.paddedSamples ||
      renderedTs.pokeyPaddedSamples !== renderedTs.paddedSamples
      ? ` componentPadding=ym:${renderedTs.ymPaddedSamples},pokey:${renderedTs.pokeyPaddedSamples}`
      : ""),
  );
  if (pokeyDeviceWriteSnapshotComparison !== undefined) {
    console.log(
      `POKEY write snapshot compare: compared=${pokeyDeviceWriteSnapshotComparison.compared} ` +
      `cycleDelta={${formatTopHistogram(pokeyDeviceWriteSnapshotComparison.cycleDeltaHistogram, 4)}} ` +
      `clk28={${formatTopHistogram(pokeyDeviceWriteSnapshotComparison.beforeClockCnt28DeltaHistogram, 4)}} ` +
      `clk114={${formatTopHistogram(pokeyDeviceWriteSnapshotComparison.beforeClockCnt114DeltaHistogram, 4)}} ` +
      `polyClock={${formatTopHistogram(pokeyDeviceWriteSnapshotComparison.beforePolyClockDeltaHistogram, 4)}} ` +
      `polyClock28Ticks={` +
      `${formatTopHistogram(pokeyDeviceWriteSnapshotComparison.beforePolyClockDelta28TicksHistogram, 4)}} ` +
      `polyMod={${formatTopHistogram(pokeyDeviceWriteSnapshotComparison.beforePolyModuloDeltaHistogram, 4)}}`,
    );
  }
  if (renderedTs.pokeyRawTrace !== undefined) {
    console.log(
      `POKEY raw trace: center=${renderedTs.pokeyRawTrace.centerSample} ` +
      `radius=${renderedTs.pokeyRawTrace.radius} matched=${renderedTs.pokeyRawTrace.matchedTransitions}/` +
      `${renderedTs.pokeyRawTrace.totalTransitions}`,
    );
    if (pokeyRawTraceComparison !== undefined) {
      const cycleDeltaTop = Object.entries(pokeyRawTraceComparison.cycleDeltaHistogram)
        .sort((a, b) => b[1] - a[1] || Number(a[0]) - Number(b[0]))
        .slice(0, 6)
        .map(([delta, count]) => `${delta}:${count}`)
        .join(",");
      const cycleDeltaResidualTop = Object.entries(pokeyRawTraceComparison.cycleDeltaResidualHistogram)
        .sort((a, b) => b[1] - a[1] || Number(a[0]) - Number(b[0]))
        .slice(0, 6)
        .map(([delta, count]) => `${delta}:${count}`)
        .join(",");
      console.log(
        `POKEY raw trace compare: compared=${pokeyRawTraceComparison.compared} ` +
        `outputDelta={${formatNumericHistogram(pokeyRawTraceComparison.outputSampleDeltaHistogram)}} ` +
        `lofiS2Delta={${formatNumericHistogram(pokeyRawTraceComparison.lofiS2OutputSampleDeltaHistogram)}} ` +
        `lofiBlockOffsetDelta={${formatNumericHistogram(pokeyRawTraceComparison.lofiSourceBlockOffsetDeltaHistogram)}} ` +
        `cycleDelta=[${pokeyRawTraceComparison.cycleDeltaMin ?? "?"},` +
        `${pokeyRawTraceComparison.cycleDeltaMax ?? "?"}] ` +
        `cycleDeltaTop={${cycleDeltaTop}} ` +
        `cycleDeltaMode=${pokeyRawTraceComparison.cycleDeltaMode ?? "?"} ` +
        `cycleResidual=[${pokeyRawTraceComparison.cycleDeltaResidualMin ?? "?"},` +
        `${pokeyRawTraceComparison.cycleDeltaResidualMax ?? "?"}] ` +
        `cycleResidualTop={${cycleDeltaResidualTop}} ` +
        `rawDeltaTop={${formatTopHistogram(pokeyRawTraceComparison.rawOutputSampleDeltaHistogram, 6)}} ` +
        `rawTransitionDeltaTop={` +
        `${formatTopHistogram(pokeyRawTraceComparison.rawTransitionOutputSampleDeltaHistogram, 6)}} ` +
        `rawMismatches=${pokeyRawTraceComparison.rawMismatchCount}`,
      );
      const longestRuns = pokeyRawTraceComparison.cycleDeltaRuns
        .slice()
        .sort((a, b) => b.count - a.count || a.startIndex - b.startIndex)
        .slice(0, 5)
        .map((run) =>
          `#${run.startIndex}-${run.endIndex}:n=${run.count}:dCyc=${run.cycleDelta}:` +
          `out=${run.tsStartEstimatedOutputSample}-${run.tsEndEstimatedOutputSample}:` +
          `dOut={${formatNumericHistogram(run.outputSampleDeltaHistogram)}}`)
        .join(" | ");
      if (longestRuns.length > 0) console.log(`POKEY raw trace cycleDeltaRuns: ${longestRuns}`);
      const stateAlignment = pokeyRawTraceComparison.dominantRawTransitionStateAlignment;
      if (stateAlignment !== undefined) {
        console.log(
          `POKEY raw trace dominant state alignment: dOut=${stateAlignment.outputSampleDelta} ` +
          `compared=${stateAlignment.compared} exact=${stateAlignment.exactStateMatches}/` +
          `${stateAlignment.compared} fields={${formatTopHistogram(stateAlignment.fieldMismatchCounts, 8)}} ` +
          `indexDelta={${formatTopHistogram(stateAlignment.eventIndexDeltaHistogram, 4)}} ` +
          `counterDelta={${formatTopHistogram(stateAlignment.counterDeltaHistogram, 4)}} ` +
          `borrowDelta={${formatTopHistogram(stateAlignment.borrowCntDeltaHistogram, 4)}} ` +
          `outputDelta={${formatTopHistogram(stateAlignment.outputDeltaHistogram, 4)}} ` +
          `polyModDelta={${formatTopHistogram(stateAlignment.polyModuloDeltaHistogram, 4)}} ` +
          `polyClockDelta={${formatTopHistogram(stateAlignment.polyClockDeltaHistogram, 4)}} ` +
          `polyClock28Ticks={${formatTopHistogram(stateAlignment.polyClockDelta28TicksHistogram, 4)}} ` +
          `changedCh={${formatTopHistogram(stateAlignment.changedChannelHistogram, 4)}} ` +
          `changedCtr={${formatTopHistogram(stateAlignment.changedChannelCounterDeltaHistogram, 4)}} ` +
          `changedOut={${formatTopHistogram(stateAlignment.changedChannelOutputDeltaHistogram, 4)}} ` +
          `clk28={${formatTopHistogram(stateAlignment.clockCnt28DeltaHistogram, 4)}} ` +
          `clk114={${formatTopHistogram(stateAlignment.clockCnt114DeltaHistogram, 4)}}`,
        );
      }
    }
    if (pokeyRawTracePcmResidualComparison !== undefined) {
      const byDelta = Object.entries(pokeyRawTracePcmResidualComparison.byOutputSampleDelta)
        .sort((a, b) => Number(a[0]) - Number(b[0]))
        .map(([delta, stats]) =>
          `${delta}:n=${stats.count}:same=${stats.sameOutputRmsMean.toFixed(5)}:` +
          `event=${stats.eventAlignedRmsMean.toFixed(5)}:best=${stats.bestLagRmsMean.toFixed(5)}`)
        .join(",");
      console.log(
        `POKEY raw trace PCM residual: radius=${pokeyRawTracePcmResidualComparison.radius} ` +
        `maxLag=${pokeyRawTracePcmResidualComparison.maxLag} ` +
        `compared=${pokeyRawTracePcmResidualComparison.compared} ` +
        `sameRmsMean=${pokeyRawTracePcmResidualComparison.sameOutput.rmsMean.toFixed(6)} ` +
        `sameRmsMax=${pokeyRawTracePcmResidualComparison.sameOutput.rmsMax.toFixed(6)} ` +
        `eventAlignedRmsMean=${pokeyRawTracePcmResidualComparison.eventAligned.rmsMean.toFixed(6)} ` +
        `eventAlignedRmsMax=${pokeyRawTracePcmResidualComparison.eventAligned.rmsMax.toFixed(6)} ` +
        `bestLagRmsMean=${pokeyRawTracePcmResidualComparison.bestLag.rmsMean.toFixed(6)} ` +
        `bestLagRmsMax=${pokeyRawTracePcmResidualComparison.bestLag.rmsMax.toFixed(6)} ` +
        `bestLagGainRmsMean=${pokeyRawTracePcmResidualComparison.bestLag.gainCorrectedRmsMean.toFixed(6)} ` +
        `bestLagGainRange=${pokeyRawTracePcmResidualComparison.bestLag.bestGainMin.toFixed(4)}..` +
        `${pokeyRawTracePcmResidualComparison.bestLag.bestGainMax.toFixed(4)} ` +
        `bestLagHist={${formatNumericHistogram(pokeyRawTracePcmResidualComparison.bestLagHistogram)}} ` +
        `byOutputDelta={${byDelta}}`,
      );
      const byLag = Object.entries(pokeyRawTracePcmResidualComparison.byBestLag)
        .sort((a, b) => Number(a[0]) - Number(b[0]))
        .map(([lag, stats]) =>
          `${lag}:n=${stats.count}:out={${formatNumericHistogram(stats.outputSampleDeltaHistogram)}}:` +
          `res={${formatNumericHistogram(stats.cycleDeltaResidualHistogram)}}:` +
          `raw={${formatTopHistogram(stats.rawTransitionHistogram, 3)}}`)
        .join(" | ");
      const topTransitions = pokeyRawTracePcmResidualComparison.topTransitionGroups
        .slice(0, 6)
        .map((group) =>
          `${group.prevRaw}->${group.raw}:out=${group.outputSampleDelta}:` +
          `res=${group.cycleDeltaResidual ?? "?"}:lag=${group.bestLag}:n=${group.count}:` +
          `best=${group.bestLagRmsMean.toFixed(5)}:gain=${group.bestLagRmsImprovementMean.toFixed(5)}`)
        .join(" | ");
      const topImprovingTransitions = pokeyRawTracePcmResidualComparison.topImprovingTransitionGroups
        .slice(0, 6)
        .map((group) =>
          `${group.prevRaw}->${group.raw}:out=${group.outputSampleDelta}:` +
          `res=${group.cycleDeltaResidual ?? "?"}:lag=${group.bestLag}:n=${group.count}:` +
          `best=${group.bestLagRmsMean.toFixed(5)}:gain=${group.bestLagRmsImprovementMean.toFixed(5)}`)
        .join(" | ");
      const timingRuns = pokeyRawTracePcmResidualComparison.topTimingRuns
        .slice(0, 6)
        .map((run) =>
          `#${run.startIndex}-${run.endIndex}:n=${run.count}:` +
          `lag={${formatNumericHistogram(run.bestLagHistogram)}}:` +
          `res={${formatNumericHistogram(run.cycleDeltaResidualHistogram)}}:` +
          `out={${formatNumericHistogram(run.outputSampleDeltaHistogram)}}:` +
          `raw={${formatTopHistogram(run.rawTransitionHistogram, 3)}}:` +
          `last={${formatTopHistogram(run.lastRelevantWritePairHistogram, 3)}}:` +
          `dSince={${formatNumericHistogram(run.lastRelevantCyclesSinceApplyDeltaHistogram)}}:` +
          `frame={${formatTopHistogram(run.lastRelevantFrameHistogram, 3)}}`)
        .join(" | ");
      if (byLag.length > 0) console.log(`POKEY raw trace PCM by lag: ${byLag}`);
      if (topTransitions.length > 0) console.log(`POKEY raw trace PCM top transitions: ${topTransitions}`);
      if (topImprovingTransitions.length > 0) {
        console.log(`POKEY raw trace PCM improving transitions: ${topImprovingTransitions}`);
      }
      if (timingRuns.length > 0) console.log(`POKEY raw trace PCM timing runs: ${timingRuns}`);
    }
  }
  console.log(
    `Window source=${args.windowSource} audible=${selectedWindows.audibleCount} selected=${windows.length} ` +
    `sourceRms=${windowSignalStats.rms.toFixed(6)} sourceMaxAbs=${windowSignalStats.maxAbs.toFixed(6)} ` +
    `ymMaxAbs=${ymSignalStats.maxAbs.toFixed(6)} pokeyMaxAbs=${pokeySignalStats.maxAbs.toFixed(6)}`,
  );
  console.log(
    `Tape: cyclePrecise=${renderedTs.cyclePreciseTape} resetFrame=${renderedTs.resetFrame ?? "n/a"} ` +
    `commandTiming=${args.cmdTapeCommandTiming} ` +
    (args.fixedFrameCycles ? "fixedFrameCycles=true " : "") +
    (args.frameBudgetSmoothingWindow === 0
      ? ""
      : `frameBudgetSmoothingWindow=${args.frameBudgetSmoothingWindow} `) +
    `resetReleaseDelayCycles=${args.resetReleaseDelayCycles}` +
    (args.resetFirstFetchDelayAfterCommandCycles === 0
      ? ""
      : ` resetFirstFetchDelayAfterCommandCycles=${args.resetFirstFetchDelayAfterCommandCycles}`) +
    ` replyAckDelayCycles=${args.replyAckDelayCycles}` +
    (args.requireCommandContext
      ? ` requireCommandContext=true commandContext=${renderedTs.commandContext.withCycleTiming}/` +
        `${renderedTs.commandContext.total} cycleTiming ${renderedTs.commandContext.withSoundPc}/` +
        `${renderedTs.commandContext.total} soundPc`
      : "") +
    (args.useEmbeddedReplyAckTape ? "" : " embeddedReplyAckTape=false") +
    (args.timerAStartDelayCycles !== 0 ? ` timerAStartDelayCycles=${args.timerAStartDelayCycles}` : "") +
    (args.commandNmiDelayInstructions !== 0
      ? ` commandNmiDelayInstructions=${args.commandNmiDelayInstructions}`
      : "") +
    ` commandNmiSampleCycle=${args.commandNmiSampleCycle}` +
    (args.commandNmiBoundaryDelayInstructions !== 0
      ? ` commandNmiBoundaryDelayInstructions=${args.commandNmiBoundaryDelayInstructions}`
      : "") +
    (args.commandNmiDelayMatches.length === 0
      ? ""
      : ` commandNmiDelayMatches=${fmtCommandNmiDelayMatches(args.commandNmiDelayMatches)}`) +
    (args.commandNmiDelayChipWriteBoundaryInstructions === undefined
      ? ""
      : ` commandNmiDelayChipWriteBoundaryInstructions=${args.commandNmiDelayChipWriteBoundaryInstructions}`) +
    (args.commandNmiDelayCompletedChipWritePreemptions === undefined
      ? ""
      : ` commandNmiDelayCompletedChipWritePreemptions=${args.commandNmiDelayCompletedChipWritePreemptions}`) +
    (args.commandCycleOffsetCycles !== 0 ? ` commandCycleOffsetCycles=${args.commandCycleOffsetCycles}` : "") +
    (args.commandCycleOffsetStartFrame === undefined
      ? ""
      : ` commandCycleOffsetStartFrame=${args.commandCycleOffsetStartFrame}`) +
    (args.commandSubmitBeforeCpuCatchup ? " commandSubmitBeforeCpuCatchup=true" : "") +
    (args.traceFrameAdvance ? " traceFrameAdvance=true" : "") +
    (args.commandPreemptChipWriteLookaheadCycles !== 0
      ? ` commandPreemptChipWriteLookahead=${args.commandPreemptChipWriteLookaheadCycles}`
      : "") +
    (args.commandPreemptChipWritePcs === undefined
      ? ""
      : ` commandPreemptChipWritePcs=${args.commandPreemptChipWritePcs
        .map((pc) => `0x${pc.toString(16).padStart(4, "0")}`).join(",")}`) +
    (args.commandPreemptChipWriteCompleteBeforeTarget
      ? " commandPreemptChipWriteCompleteBeforeTarget=true"
      : "") +
    (args.commandPreemptChipWriteBeforeOnly ? " commandPreemptChipWriteBeforeOnly=true" : "") +
    (args.pokeySampleCycles !== 28 ? ` pokeySampleCycles=${args.pokeySampleCycles}` : "") +
    (args.pokeySampleAfterClock ? " pokeySampleAfterClock=true" : "") +
    (args.deferChipIoWriteTiming ? " deferChipIoWriteTiming=true" : "") +
    (args.deferYmAudioWriteTiming ? " deferYmAudioWriteTiming=true" : "") +
    (args.deferYmParameterWriteTiming ? " deferYmParameterWriteTiming=true" : "") +
    (args.deferYmTimerControlWriteTiming ? " deferYmTimerControlWriteTiming=true" : "") +
    (args.disableYmReset ? " disableYmReset=true" : "") +
    (args.ymWriteEventCycleOffsetCycles === 0 ? "" : ` ymWriteEventCycleOffsetCycles=${args.ymWriteEventCycleOffsetCycles}`) +
    (args.ymWriteEventCycleOffsetRegs.size === 0
      ? ""
      : ` ymWriteEventCycleOffsetRegs=${fmtRegisterCycleOffsets(args.ymWriteEventCycleOffsetRegs)}`) +
    (args.ymWriteEventCycleOffsetMatches.length === 0
      ? ""
      : ` ymWriteEventCycleOffsetMatches=${fmtYmWriteEventCycleOffsetMatches(args.ymWriteEventCycleOffsetMatches)}`) +
    (args.ymWriteEventSampleOffsetMatches.length === 0
      ? ""
      : ` ymWriteEventSampleOffsetMatches=${fmtDirectYmWriteSampleOffsetMatches(args.ymWriteEventSampleOffsetMatches)}`) +
    (args.ymKeyOnWriteEventCycleOffsetCycles === 0
      ? ""
      : ` ymKeyOnWriteEventCycleOffsetCycles=${args.ymKeyOnWriteEventCycleOffsetCycles}`) +
    (args.ymCommandEdgeEventRules.length === 0
      ? ""
      : ` ymCommandEdgeEventRules=${fmtCommandEdgeEventRules(args.ymCommandEdgeEventRules)}` +
        ` ymCommandEdgeApplied=${renderedTs.ymCommandEdgeEventAdjust?.applied ?? 0}`) +
    (args.pokeyCommandEdgeEventRules.length === 0
      ? ""
      : ` pokeyCommandEdgeEventRules=${fmtCommandEdgeEventRules(args.pokeyCommandEdgeEventRules)}` +
        ` pokeyCommandEdgeApplied=${renderedTs.pokeyCommandEdgeEventAdjust?.applied ?? 0}`) +
    (args.pokeyCommandEdgeRawCycleOffsetOpcodes.size === 0
      ? ""
      : ` pokeyCommandEdgeRawCycleOffsetOpcodes=${fmtRegisterCycleOffsets(args.pokeyCommandEdgeRawCycleOffsetOpcodes)}`) +
    (args.irqServiceDelayCycles === 0 ? "" : ` irqServiceDelayCycles=${args.irqServiceDelayCycles}`) +
    (args.ymPhaseAdvanceAfterOutput ? " ymPhaseAdvanceAfterOutput=true" : "") +
    ` ymScheduler=${renderedTs.ymScheduler} resampler=${renderedTs.resampler}` +
    (renderedTs.ymStreamAbsoluteOrigin
      ? ` ymStreamAbsoluteOrigin=true ymStreamSampleOffset=${renderedTs.ymStreamSampleOffset}` +
        (renderedTs.ymStreamCycleOffsetCycles === undefined
          ? ""
          : ` ymStreamCycleOffsetCycles=${renderedTs.ymStreamCycleOffsetCycles}`)
      : "") +
    (renderedTs.ymResampler !== renderedTs.resampler || renderedTs.pokeyResampler !== renderedTs.resampler
      ? ` ymResampler=${renderedTs.ymResampler} pokeyResampler=${renderedTs.pokeyResampler}`
      : "") +
    (args.lagTieCorrelationEpsilon !== 0 ? ` lagTieCorrelationEpsilon=${args.lagTieCorrelationEpsilon}` : "") +
    (args.ymResampleOffset !== 0 ? ` ymResampleOffset=${args.ymResampleOffset}` : "") +
    (args.ymOutputSampleOffset !== 0 ? ` ymOutputSampleOffset=${args.ymOutputSampleOffset}` : "") +
    (args.pokeyWriteCycleOffset !== 0
      ? ` pokeyWriteCycleOffset=${args.pokeyWriteCycleOffset}` +
        ` (~${pokeyWriteCycleOffsetOutputSamples.toFixed(2)} output samples)`
      : "") +
    (args.pokeyWriteApplyDelayCycles !== 0
      ? ` pokeyWriteApplyDelay=${args.pokeyWriteApplyDelayCycles}` +
        ` (~${pokeyWriteApplyDelayOutputSamples.toFixed(2)} output samples)`
      : "") +
    (args.pokeyWriteApplyDelayOpcodes.size === 0
      ? ""
      : ` pokeyWriteApplyDelayOpcodes=${fmtRegisterCycleOffsets(args.pokeyWriteApplyDelayOpcodes)}`) +
    (args.pokeyWriteApplyDelayMatches.length === 0
      ? ""
      : ` pokeyWriteApplyDelayMatches=${fmtYmWriteEventCycleOffsetMatches(args.pokeyWriteApplyDelayMatches)}`) +
    (args.pokeyWriteApplyBoundaryDelayCycles === 0
      ? ""
      : ` pokeyWriteApplyBoundaryDelay=${args.pokeyWriteApplyBoundaryDelayCycles}` +
        `@${args.pokeyWriteApplyBoundaryDelaySampleRate}Hz`) +
    (args.pokeyResampleOffset !== 0 ? ` pokeyResampleOffset=${args.pokeyResampleOffset}` : "") +
    (args.pokeyOutputSampleOffset !== 0 ? ` pokeyOutputSampleOffset=${args.pokeyOutputSampleOffset}` : ""),
  );
  if (directChipWriteMode) {
    console.log(
      `MAME chip writes: ym=${args.mameYmWrites ?? "none"} pokey=${args.mamePokeyWrites ?? "none"} ` +
      `origin=${renderedTs.directChipWriteOrigin} sampleTiming=${renderedTs.directChipWriteSampleTiming} ` +
      `cycleTiming=${renderedTs.directChipWriteCycleTiming} ` +
      `cycleRateMode=${args.directChipWriteCycleRateMode} cycleRate=${renderedTs.directChipWriteCycleRate}` +
      (renderedTs.directYmWriteSampleOffset === 0
        ? ""
        : ` ymWriteSampleOffset=${renderedTs.directYmWriteSampleOffset}`) +
      (args.directYmWriteSampleOffsetRegs.size === 0
        ? ""
        : ` ymWriteSampleOffsetRegs=${fmtRegisterCycleOffsets(args.directYmWriteSampleOffsetRegs)}`) +
      (args.directYmWriteSampleOffsetMatches.length === 0
        ? ""
        : ` ymWriteSampleOffsetMatches=${fmtDirectYmWriteSampleOffsetMatches(args.directYmWriteSampleOffsetMatches)}`),
    );
  }
  if (renderedTs.statusReplay !== undefined) {
    console.log(
      `Status replay: applied=${renderedTs.statusReplay.appliedReadCount}/${renderedTs.statusReplay.mameReadCount} ` +
      `tsReads=${renderedTs.statusReplay.tsReadCount} exhausted=${renderedTs.statusReplay.exhaustedReadCount} ` +
      `baseMismatches=${renderedTs.statusReplay.baseMismatchCount} ` +
      `valueMismatches=${renderedTs.statusReplay.valueMismatchCount} ` +
      `mode=${renderedTs.statusReplay.mode} valueMode=${renderedTs.statusReplay.valueMode}`,
    );
  }
  if (renderedTs.replyAckReplay !== undefined) {
    const stats = renderedTs.replyAckReplay.stats;
    console.log(
      `Reply ack replay: scheduled=${stats.scheduledWriteCount}/${stats.ackCount} ` +
      `exhausted=${stats.exhaustedWriteCount} skipped=${stats.skippedAckCount} source=${stats.source}`,
    );
  }
  for (const s of stats) {
    console.log(
      `window start=${s.start} size=${s.size} lag=${s.lag} ` +
      `corr=${s.correlation.toFixed(4)} rms=${s.rms.toFixed(5)} maxAbs=${s.maxAbs.toFixed(5)} ` +
      `gain=${s.bestGain.toFixed(4)} gainRms=${s.gainCorrectedRms.toFixed(5)} ` +
      `gainMaxAbs=${s.gainCorrectedMaxAbs.toFixed(5)} ` +
      `tsPeak=${s.tsMaxAbs.toFixed(5)} mamePeak=${s.mameMaxAbs.toFixed(5)} ` +
      `source=${s.dominantSource} ymRms=${s.tsYmRms.toFixed(5)} pokeyRms=${s.tsPokeyRms.toFixed(5)} ` +
      `ymShare=${s.tsYmEnergyShare.toFixed(3)}` +
      (s.absoluteBestLag !== s.lag
        ? ` absoluteBestLag=${s.absoluteBestLag} absoluteBestCorr=${s.absoluteBestCorrelation.toFixed(4)}`
        : "") +
      (s.tsYmTopChannel === undefined ? "" : ` ymTopCh=${s.tsYmTopChannel}`) +
      (s.tsPokeyTopChannel === undefined ? "" : ` pokeyTopCh=${s.tsPokeyTopChannel}`),
    );
  }
  console.log(
    `${passed ? "PASS" : "FAIL"} thresholds: ` +
    `worstCorr=${worstCorrelation.toFixed(4)} >= ${args.minCorrelation}, ` +
    `worstAbsLag=${worstAbsLag} <= ${args.maxAbsLag}, ` +
    `worstRms=${worstRms.toFixed(5)} <= ${args.maxRms}, ` +
    `worstMaxAbs=${worstMaxAbs.toFixed(5)} <= ${args.maxAbs}`,
  );
  console.log(
    `Gain diagnostics: bestGlobalGain=${globalGain.bestGlobalGain.toFixed(4)} ` +
    `globalGainRms=${globalGain.globalGainCorrectedRms.toFixed(5)} ` +
    `globalGainMaxAbs=${globalGain.globalGainCorrectedMaxAbs.toFixed(5)} ` +
    `dominant=${JSON.stringify(dominantSources)}`,
  );
  if (!passed) process.exitCode = 1;
}

main();
