// probe-pc-cycles.ts — cycle timing checkpoints for the sound 6502.
// Replays the same cycle-precise cmd tape used by the chip-write probes, steps
// instruction-by-instruction, and records the first cycle/frame at selected PCs.
import { readFileSync, writeFileSync } from "node:fs";
import {
  createSoundChip,
  releaseSoundReset,
  submitCommand,
  loadCmdTape,
  cmdTapeCommandCycleInFrame,
  cmdTapeFrameCycles,
  setSoundFrameContext,
  drainReplyEvents,
  servicePendingCommandNmi,
  DEFAULT_COMMAND_NMI_SAMPLE_CYCLE,
  SOUND_CMD_TAPE_CPU_HZ_NUMERATOR,
  SOUND_CMD_TAPE_CPU_HZ_DENOMINATOR,
} from "../../engine/src/m6502/sound-chip.js";
import { step as cpuStep, requestIrq, clearIrq } from "../../engine/src/m6502/cpu.js";
import { ym2151TickCycles } from "../../engine/src/audio/ym2151.js";
import { pokeyTickCycles } from "../../engine/src/audio/pokey.js";
import { as_u8 } from "../../engine/src/wrap.js";
import {
  installSoundStatusFrameReplay,
  installSoundStatusReplay,
  loadSoundStatusReads,
  statusReplayReport,
} from "./sound-status-replay.js";
import {
  createMainReplyAckReplayForTape,
  mainReplyAckReplayReport,
} from "./sound-reply-ack-replay.js";

const CHECKPOINTS = [
  0x8002, 0x8016, 0x802C, 0x808F, 0x80A3, 0x80A6, 0x80AD, 0x80AE,
  0x80B5, 0x80C3, 0x80C8, 0x80E7, 0x80EA, 0x80EE,
  0x8177, 0x8179, 0x8188, 0x81A2, 0x81A5,
  0x81A6, 0x81B1, 0x81B8, 0x81C3,
  0x81C6, 0x81C8, 0x81CA, 0x81CC, 0x81CE, 0x81D0, 0x81D2,
  0x81D5, 0x81D7, 0x81DC, 0x81E0, 0x81E2, 0x81E4, 0x81E7,
  0x81E9, 0x81EA, 0x81EC, 0x81EF, 0x81F0, 0x81F3, 0x81F5,
  0x81F8, 0x81FB, 0x81FC, 0x81FD, 0x81FE, 0x81FF, 0x8201, 0x8203,
  0x8205, 0x8208, 0x820A, 0x900A,
  0xE4E5, 0xE4E8, 0xE4EA, 0xE4ED, 0xE4EF, 0xE4F1, 0xE4F2,
  0xE4F4, 0xE4F6, 0xE4F8, 0xE4F9, 0xE4FB, 0xE4FD, 0xE4FF,
  0xE500, 0xE502, 0xE505, 0xE507, 0xE50A, 0xE50B, 0xE50C,
  0xE50E, 0xE510, 0xE512, 0xE514, 0xE516, 0xE518, 0xE51B,
  0xE51D, 0xE51F, 0xE520, 0xE522, 0xE525, 0xE528, 0xE52B,
  0xE52D, 0xE52F, 0xE531, 0xE533, 0xE535, 0xE537, 0xE539,
  0xE53B, 0xE53D, 0xE53F, 0xE541, 0xE542,
  0x824D, 0x829E, 0x8359, 0x84E9, 0x85C0, 0x85D5,
  0x8722, 0x8724, 0x873D,
  0x9566, 0x9569, 0x956C,
];
const cpSet = new Set(CHECKPOINTS);

interface Args {
  frames: number;
  cmdTape: string;
  out: string;
  mame: string | undefined;
  traceFrom: number | undefined;
  traceTo: number | undefined;
  statusBase: number | undefined;
  statusTape: string | undefined;
  statusTapeMode: StatusTapeMode;
  resetReleaseDelayCycles: number;
  replyAckDelayCycles: number;
  replyAckTape: string | undefined;
  useEmbeddedReplyAckTape: boolean;
  timerAStartDelayCycles: number;
  commandNmiDelayInstructions: number;
  commandNmiSampleCycle: number;
  tracePcFull: boolean;
}

type StatusTapeMode = "readIndex" | "frame";

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

function parseArgs(): Args {
  const args = process.argv.slice(2);
  return {
    frames: Number(readArg(args, "--frames") ?? process.env.TARGET_FRAME ?? "500"),
    cmdTape: readArg(args, "--cmd-tape") ?? "oracle/scenarios/sound-cmd-tape-attract-cycle-precise.json",
    out: readArg(args, "--out") ?? "/tmp/marble-love/audio-bitperfect/ts_pc_cycles.json",
    mame: readArg(args, "--mame"),
    traceFrom: parseNumber(readArg(args, "--trace-from")),
    traceTo: parseNumber(readArg(args, "--trace-to")),
    statusBase: parseNumber(readArg(args, "--status-base")),
    statusTape: readArg(args, "--status-tape"),
    statusTapeMode: parseStatusTapeMode(readArg(args, "--status-tape-mode")),
    resetReleaseDelayCycles: Number(readArg(args, "--reset-release-delay") ?? "0"),
    replyAckDelayCycles: Number(readArg(args, "--reply-ack-delay") ?? "0"),
    replyAckTape: readArg(args, "--reply-ack-tape"),
    useEmbeddedReplyAckTape: !args.includes("--no-embedded-reply-ack"),
    timerAStartDelayCycles: Number(readArg(args, "--timer-a-start-delay") ?? "0"),
    commandNmiDelayInstructions: Number(readArg(args, "--command-nmi-delay-instructions") ?? "0"),
    commandNmiSampleCycle: Number(readArg(args, "--command-nmi-sample-cycle") ?? String(DEFAULT_COMMAND_NMI_SAMPLE_CYCLE)),
    tracePcFull: args.includes("--trace-pc-full"),
  };
}

interface TsHit {
  cycle: number;
  delta: number;
  frame: number;
}

interface MameHit {
  secs?: number;
  attos?: string;
  cycle?: number;
  delta?: number;
  frame: number;
}

interface PcComparison {
  pc: string;
  tsFrame: number | undefined;
  mameFrame: number | undefined;
  tsDelta: number | undefined;
  mameDelta: number | undefined;
  deltaDiff: number | undefined;
}

interface PcTraceEvent {
  kind: "pcFetch" | "statusRead" | "cmdSubmit" | "nmiService" | "irqService" | "timerAOverflow" | "timerBOverflow" | "irqPin";
  frame: number;
  cycle: number;
  pc?: string;
  value?: string;
  byte?: string;
  targetCycle?: number;
  actualCycle?: number;
  overrunCycles?: number;
  lastStepStart?: number;
  lastStepEnd?: number;
  lastStepPc?: string;
  lastStepCycles?: number;
  commandNmiDelayInstructions?: number;
  p?: string;
  irq?: boolean;
  nmi?: boolean;
  timerAActive?: boolean;
  timerAOverflow?: boolean;
  timerAIrqEnable?: boolean;
  timerACounter?: number;
  timerAAccumulator?: number;
  timerBActive?: boolean;
  timerBOverflow?: boolean;
  timerBIrqEnable?: boolean;
  timerBCounter?: number;
  timerBAccumulator?: number;
}

interface YM2151WithTimerPhaseDiagnostic {
  timerAStartDelayYmCycles: number;
}

interface SoundChipWithCommandNmiDiagnostic {
  commandNmiDelayInstructions: number;
}

function hexPc(pc: number): string {
  return `0x${pc.toString(16).padStart(4, "0")}`;
}

function mameCycle(hit: MameHit): number | undefined {
  if (hit.cycle !== undefined) return hit.cycle;
  if (hit.secs === undefined || hit.attos === undefined) return undefined;
  const attos = BigInt(hit.attos);
  const totalAttos = BigInt(Math.trunc(hit.secs)) * 1_000_000_000_000_000_000n + attos;
  return Number(totalAttos * BigInt(SOUND_CMD_TAPE_CPU_HZ_NUMERATOR) /
    (BigInt(SOUND_CMD_TAPE_CPU_HZ_DENOMINATOR) * 1_000_000_000_000_000_000n));
}

function compareMameHits(tsHits: Record<string, TsHit>, mamePath: string): PcComparison[] {
  const parsed = JSON.parse(readFileSync(mamePath, "utf8")) as { hits?: Record<string, MameHit> };
  const mameHits = parsed.hits ?? {};
  const tsRef = tsHits["0x8002"]?.cycle;
  const mameRefHit = mameHits["0x8002"];
  const mameRef = mameRefHit === undefined ? undefined : mameCycle(mameRefHit);
  return CHECKPOINTS.map((pc) => {
    const key = hexPc(pc);
    const ts = tsHits[key];
    const mame = mameHits[key];
    const mameAbs = mame === undefined ? undefined : mameCycle(mame);
    const tsDelta = ts === undefined || tsRef === undefined ? undefined : ts.cycle - tsRef;
    const mameDelta = mame?.delta ?? (mameAbs === undefined || mameRef === undefined ? undefined : mameAbs - mameRef);
    return {
      pc: key,
      tsFrame: ts?.frame,
      mameFrame: mame?.frame,
      tsDelta,
      mameDelta,
      deltaDiff: tsDelta === undefined || mameDelta === undefined ? undefined : tsDelta - mameDelta,
    };
  });
}

const rom421 = new Uint8Array(readFileSync("/tmp/sound-roms/136033.421"));
const rom422 = new Uint8Array(readFileSync("/tmp/sound-roms/136033.422"));
const args = parseArgs();
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
((chip.ym2151 as unknown) as YM2151WithTimerPhaseDiagnostic).timerAStartDelayYmCycles =
  Math.trunc(args.timerAStartDelayCycles * 2);
const commandNmiDiagnostic = (chip as unknown) as SoundChipWithCommandNmiDiagnostic;
commandNmiDiagnostic.commandNmiDelayInstructions = Math.max(0, Math.trunc(args.commandNmiDelayInstructions));

const hits = new Map<number, { cycle: number; frame: number }>();
const pcTraceEvents: PcTraceEvent[] = [];
let currentTraceFrame = -1;
const statusReplay = args.statusTape === undefined
  ? undefined
  : args.statusTapeMode === "frame"
    ? installSoundStatusFrameReplay(chip, args.statusTape, loadSoundStatusReads(args.statusTape), () =>
      currentTraceFrame < 0 ? undefined : currentTraceFrame)
    : installSoundStatusReplay(chip, args.statusTape, loadSoundStatusReads(args.statusTape));

function shouldTraceFrame(frame: number): boolean {
  if (args.traceFrom === undefined) return false;
  const to = args.traceTo ?? args.traceFrom;
  return frame >= args.traceFrom && frame <= to;
}

function shouldTracePc(pc: number): boolean {
  if (args.tracePcFull) return pc >= 0x8000 && pc <= 0xffff;
  return (pc >= 0x8100 && pc <= 0x820f) ||
    (pc >= 0x8e80 && pc <= 0x8ec0) ||
    (pc >= 0xe4e5 && pc <= 0xe543) ||
    (pc >= 0x9560 && pc <= 0x95d0) ||
    pc === 0x900a;
}

function traceState(): Partial<PcTraceEvent> {
  return {
    p: `0x${(chip.cpu.rf.p as number).toString(16).padStart(2, "0")}`,
    irq: chip.cpu.irq,
    nmi: chip.cpu.nmi,
    timerAActive: chip.ym2151.timerAActive,
    timerAOverflow: chip.ym2151.timerAOverflow,
    timerAIrqEnable: chip.ym2151.timerAIrqEnable,
    timerACounter: chip.ym2151.timerACounter,
    timerAAccumulator: chip.ym2151.timerAAccumulator,
    timerBActive: chip.ym2151.timerBActive,
    timerBOverflow: chip.ym2151.timerBOverflow,
    timerBIrqEnable: chip.ym2151.timerBIrqEnable,
    timerBCounter: chip.ym2151.timerBCounter,
    timerBAccumulator: chip.ym2151.timerBAccumulator,
  };
}

function traceEvent(frame: number, event: PcTraceEvent): void {
  if (!shouldTraceFrame(frame)) return;
  pcTraceEvents.push({ ...event, ...traceState() });
}

function recordPc(frame: number): void {
  const pc = chip.cpu.rf.pc as number;
  if (cpSet.has(pc) && !hits.has(pc)) {
    hits.set(pc, { cycle: chip.cpu.cycles, frame });
  }
  if (shouldTraceFrame(frame) && shouldTracePc(pc)) {
    traceEvent(frame, {
      kind: "pcFetch",
      frame,
      cycle: chip.cpu.cycles,
      pc: hexPc(pc),
    });
  }
}

const originalRead8 = chip.mmu.read8;
chip.mmu.read8 = (addr) => {
  const value = originalRead8(addr);
  if ((addr as number) === 0x1820 && shouldTraceFrame(currentTraceFrame)) {
    const pc = chip.cpu.lastOpcodePc ?? (chip.cpu.rf.pc as number);
    traceEvent(currentTraceFrame, {
      kind: "statusRead",
      frame: currentTraceFrame,
      cycle: chip.cpu.cycles,
      pc: hexPc(pc),
      value: `0x${(value as number).toString(16).padStart(2, "0")}`,
    });
  }
  return value;
};

let lastIrqPin =
  (chip.ym2151.timerAOverflow && chip.ym2151.timerAIrqEnable) ||
  (chip.ym2151.timerBOverflow && chip.ym2151.timerBIrqEnable);
let lastStepStart = 0;
let lastStepEnd = 0;
let lastStepPc = 0;

function stepWithTap(frame: number): void {
  currentTraceFrame = frame;
  servicePendingCommandNmi(chip);
  const stepStart = chip.cpu.cycles;
  const stepPc = chip.cpu.rf.pc as number;
  const stepP = chip.cpu.rf.p as number;
  const willServiceNmi = chip.cpu.nmi;
  const willServiceIrq = !willServiceNmi && chip.cpu.irq && (stepP & 0x04) === 0;
  if (willServiceNmi) {
    traceEvent(frame, {
      kind: "nmiService",
      frame,
      cycle: stepStart,
      pc: hexPc(stepPc),
    });
  } else if (willServiceIrq) {
    traceEvent(frame, {
      kind: "irqService",
      frame,
      cycle: stepStart,
      pc: hexPc(stepPc),
    });
  }
  if (!willServiceNmi && !willServiceIrq) recordPc(frame);
  const timerAOverflowBefore = chip.ym2151.timerAOverflow;
  const timerBOverflowBefore = chip.ym2151.timerBOverflow;
  cpuStep(chip.cpu, chip.mmu);
  const stepCycles = chip.cpu.cycles - stepStart;
  lastStepStart = stepStart;
  lastStepEnd = chip.cpu.cycles;
  lastStepPc = stepPc;
  ym2151TickCycles(chip.ym2151, stepCycles);
  pokeyTickCycles(chip.pokey, stepCycles);
  if (!timerAOverflowBefore && chip.ym2151.timerAOverflow) {
    traceEvent(frame, {
      kind: "timerAOverflow",
      frame,
      cycle: chip.cpu.cycles,
      pc: hexPc(stepPc),
    });
  }
  if (!timerBOverflowBefore && chip.ym2151.timerBOverflow) {
    traceEvent(frame, {
      kind: "timerBOverflow",
      frame,
      cycle: chip.cpu.cycles,
      pc: hexPc(stepPc),
    });
  }
  const irqPin =
    (chip.ym2151.timerAOverflow && chip.ym2151.timerAIrqEnable) ||
    (chip.ym2151.timerBOverflow && chip.ym2151.timerBIrqEnable);
  if (irqPin !== lastIrqPin) {
    traceEvent(frame, {
      kind: "irqPin",
      frame,
      cycle: chip.cpu.cycles,
      pc: hexPc(stepPc),
    });
    lastIrqPin = irqPin;
  }
  if (irqPin) requestIrq(chip.cpu);
  else clearIrq(chip.cpu);
}

function advanceTo(frame: number, targetCycle: number): void {
  while (!chip.inReset && chip.cpu.cycles < targetCycle) {
    stepWithTap(frame);
  }
}

function submitTracedCommand(frame: number, targetCycle: number, byte: number): void {
  let sampledDelay = 0;
  if (Number.isFinite(args.commandNmiSampleCycle) && chip.cpu.cycles > targetCycle &&
    targetCycle >= lastStepStart && targetCycle < lastStepEnd) {
    const sample = Math.max(0, Math.trunc(args.commandNmiSampleCycle));
    sampledDelay = targetCycle - lastStepStart >= sample ? 1 : 0;
  }
  const previousDelay = commandNmiDiagnostic.commandNmiDelayInstructions;
  commandNmiDiagnostic.commandNmiDelayInstructions = Math.max(previousDelay, sampledDelay);
  traceEvent(frame, {
    kind: "cmdSubmit",
    frame,
    cycle: targetCycle,
    targetCycle,
    actualCycle: chip.cpu.cycles,
    overrunCycles: chip.cpu.cycles - targetCycle,
    lastStepStart,
    lastStepEnd,
    lastStepPc: hexPc(lastStepPc),
    lastStepCycles: lastStepEnd - lastStepStart,
    commandNmiDelayInstructions: sampledDelay,
    byte: `0x${byte.toString(16).padStart(2, "0")}`,
  });
  submitCommand(chip, as_u8(byte));
  commandNmiDiagnostic.commandNmiDelayInstructions = previousDelay;
}

let scheduleCycle = 0;
for (let f = 0; f < args.frames; f++) {
  const frameCycles = cmdTapeFrameCycles(tape, f);
  const releaseOnThisFrame = chip.inReset && (tape.resetFrame === undefined || f >= tape.resetFrame);
  const frameStart = releaseOnThisFrame ? 0 : scheduleCycle;
  const frameEnd = frameStart + frameCycles;
  const cmds = tape.byFrameCycle.get(f) ?? [];
  setSoundFrameContext(chip, f, frameStart);

  if (chip.inReset) {
    if (!releaseOnThisFrame) continue;

    let nextCommandIndex = 0;
    while (nextCommandIndex < cmds.length) {
      const cmd = cmds[nextCommandIndex]!;
      const target = frameStart + cmdTapeCommandCycleInFrame(cmd, nextCommandIndex, cmds.length, frameCycles);
      if (target > frameStart) break;
      submitTracedCommand(f, target, cmd.byte);
      nextCommandIndex++;
    }
    releaseSoundReset(chip);
    if (args.resetReleaseDelayCycles > 0) {
      chip.cpu.cycles = Math.max(chip.cpu.cycles, frameStart + Math.trunc(args.resetReleaseDelayCycles));
    }

    for (let i = nextCommandIndex; i < cmds.length; i++) {
      const cmd = cmds[i]!;
      const target = frameStart + cmdTapeCommandCycleInFrame(cmd, i, cmds.length, frameCycles);
      advanceTo(f, Math.max(frameStart, Math.min(frameEnd, target)));
      submitTracedCommand(f, target, cmd.byte);
    }
    advanceTo(f, frameEnd);
    scheduleCycle = frameEnd;
    drainReplyEvents(chip);
    continue;
  }

  for (let i = 0; i < cmds.length; i++) {
    const cmd = cmds[i]!;
    const target = frameStart + cmdTapeCommandCycleInFrame(cmd, i, cmds.length, frameCycles);
    advanceTo(f, Math.max(frameStart, Math.min(frameEnd, target)));
    submitTracedCommand(f, target, cmd.byte);
  }
  advanceTo(f, frameEnd);
  scheduleCycle = frameEnd;
  drainReplyEvents(chip);
}

// Normalize: cycle delta vs PC=0x8002 ref (match MAME output style).
const refHit = hits.get(0x8002);
const ref = refHit !== undefined ? refHit.cycle : 0;

const obj: { hits: Record<string, TsHit> } = { hits: {} };
const sorted = [...hits.keys()].sort((a, b) => a - b);
for (const pc of sorted) {
  const h = hits.get(pc)!;
  obj.hits[hexPc(pc)] = {
    cycle: h.cycle,
    delta: h.cycle - ref,
    frame: h.frame,
  };
}
const comparisons = args.mame === undefined ? undefined : compareMameHits(obj.hits, args.mame);
writeFileSync(args.out, JSON.stringify({
  frames: args.frames,
  cmdTape: args.cmdTape,
  cyclePreciseTape: tape.cyclePrecise,
  resetFrame: tape.resetFrame,
  resetReleaseDelayCycles: args.resetReleaseDelayCycles,
  replyAckDelayCycles: args.replyAckDelayCycles,
  useEmbeddedReplyAckTape: args.useEmbeddedReplyAckTape,
  timerAStartDelayCycles: args.timerAStartDelayCycles,
  commandNmiDelayInstructions: args.commandNmiDelayInstructions,
  commandNmiSampleCycle: args.commandNmiSampleCycle,
  tracePcFull: args.tracePcFull,
  ...(args.statusBase === undefined ? {} : { statusBase: `0x${args.statusBase.toString(16).padStart(2, "0")}` }),
  ...(statusReplayReport(statusReplay) === undefined ? {} : { statusReplay: statusReplayReport(statusReplay) }),
  ...(mainReplyAckReplayReport(replyAckReplay) === undefined ? {} : { replyAckReplay: mainReplyAckReplayReport(replyAckReplay) }),
  ...obj,
  ...(comparisons === undefined ? {} : { comparisons }),
  ...(pcTraceEvents.length === 0 ? {} : { pcTraceEvents }),
}, null, 2));
console.log(`[ts_pc_cycles] saved ${hits.size}/${CHECKPOINTS.length} checkpoint hits`);
if (args.resetReleaseDelayCycles !== 0) {
  console.log(`[ts_pc_cycles] resetReleaseDelayCycles=${args.resetReleaseDelayCycles}`);
}
if (args.replyAckDelayCycles !== 0) {
  console.log(`[ts_pc_cycles] replyAckDelayCycles=${args.replyAckDelayCycles}`);
}
if (!args.useEmbeddedReplyAckTape) {
  console.log("[ts_pc_cycles] embeddedReplyAckTape=false");
}
if (args.timerAStartDelayCycles !== 0) {
  console.log(`[ts_pc_cycles] timerAStartDelayCycles=${args.timerAStartDelayCycles}`);
}
if (args.commandNmiDelayInstructions !== 0) {
  console.log(`[ts_pc_cycles] commandNmiDelayInstructions=${args.commandNmiDelayInstructions}`);
}
console.log(`[ts_pc_cycles] commandNmiSampleCycle=${args.commandNmiSampleCycle}`);
if (replyAckReplay !== undefined) {
  const stats = replyAckReplay.stats;
  console.log(
    `[ts_pc_cycles] replyAckReplay scheduled=${stats.scheduledWriteCount}/${stats.ackCount} ` +
    `exhausted=${stats.exhaustedWriteCount} skipped=${stats.skippedAckCount} source=${stats.source}`,
  );
}
console.log(`ref (PC=0x8002) cycle = ${ref.toLocaleString()}`);
for (const pc of sorted) {
  const h = hits.get(pc)!;
  console.log(`  PC=${hexPc(pc)}: cycle+${(h.cycle - ref).toString().padStart(10, " ")} frame=${h.frame}`);
}
const missed = CHECKPOINTS.filter((pc) => !hits.has(pc));
if (missed.length > 0) {
  console.log(`MISSED: ${missed.map((pc) => "0x" + pc.toString(16)).join(", ")}`);
}
if (comparisons !== undefined) {
  const comparable = comparisons.filter((c) => c.deltaDiff !== undefined);
  console.log(`[pc_cycles] compared ${comparable.length}/${CHECKPOINTS.length} checkpoints vs ${args.mame}`);
  for (const c of comparable) {
    console.log(
      `  ${c.pc}: frame ${c.tsFrame}/${c.mameFrame} ` +
      `ts=${c.tsDelta} mame=${c.mameDelta} diff=${c.deltaDiff}`,
    );
  }
}
if (pcTraceEvents.length > 0) {
  console.log(`[pc_cycles] traced ${pcTraceEvents.length} PC/status events`);
}
if (statusReplay !== undefined) {
  console.log(
    `[pc_cycles] statusReplay applied=${statusReplay.appliedReadCount}/${statusReplay.mameReadCount} ` +
    `tsReads=${statusReplay.tsReadCount} exhausted=${statusReplay.exhaustedReadCount} ` +
    `baseMismatches=${statusReplay.baseMismatchCount}`,
  );
}
