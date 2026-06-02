/**
 * sound-chip.ts - facade for the Atari System 1 sound subsystem.
 *
 * Aggregates:
 *   - M6502 CPU (sound CPU, 1.789 MHz)
 *   - Sound MMU (memory map + mailbox + device wiring)
 *   - YM2151 device (Phase 5: register-state parity, V3 audio sample-level)
 *   - POKEY device (Phase 6: register-state parity, V3 audio sample-level)
 *   - 68K <-> 6502 mailbox with NMI/IRQ pins
 *
 * Public API (Phase 7 V2):
 *   - createSoundChip({ rom421, rom422 })  factory that instantiates everything
 *   - tickCycles(chip, cycles6502)         advances the 6502 by N cycles and processes NMI/IRQ
 *   - submitCommand(chip, byte)            simula write 68K $FE0001 (cmd to sound)
 *   - drainReplyEvents(chip)               extracts bytes written 6502 -> 68K (cmd reply)
 *   - getRegisterShadow(chip)              snapshots YM2151+POKEY registers for oracle diff
 *   - reset(chip)                          full hardware reset
 *
 * Wire NMI/IRQ:
 *   - main -> sound mailbox write asserts NMI on the 6502 (edge-triggered).
 *   - 6502 read $1810 releases NMI.
 *   - sound -> main mailbox write asserts IRQ6 on the 68010 (here: replyQueue).
 *   - 68010 read $FC0001 simula via drainReplyEvents (pop).
 *
 * Phase 8 (differential testing) usera' getRegisterShadow per probe-sound-diff
 * vs MAME oracle. Phase 9 (Web Audio) connettera' YM2151/POKEY sample output
 * a un AudioWorklet via ring buffer.
 */

import {
  type M6502Cpu,
  createCpu,
  reset as cpuReset,
  requestNmi,
  requestIrq,
  clearIrq,
  step as cpuStep,
  setCliIrqDelay,
  setIrqPrefetchLatch,
  sampleIrqPrefetch,
} from "./cpu.js";
import { type SoundMmu, createSoundMmu } from "./sound-mmu.js";
import {
  type Mailbox8,
  createMailbox, mailboxWrite, mailboxRead,
} from "./mailbox.js";
import {
  type YM2151,
  type YM2151ChannelStateSnapshot,
  createYM2151,
  ym2151DrainDiagnosticChannelSamples,
  ym2151DrainDiagnosticChannelStateTrace,
  ym2151DrainSamples,
  ym2151GenerateSamples,
  ym2151SetDiagnosticChannelSamples,
  ym2151SetDiagnosticChannelStateTrace,
  ym2151SetExternalSampleClock,
  ym2151TickCycles,
  YM2151_MAME_STREAM_SAMPLE_RATE,
  YM2151_NATIVE_SAMPLE_RATE,
} from "../audio/ym2151.js";
import {
  type POKEY,
  type PokeyRawTransition,
  type PokeyWriteSnapshot,
  createPOKEY,
  pokeyTickCycles,
  pokeyDrainSamples,
  pokeyDrainDiagnosticChannelSamples,
  pokeyDrainDiagnosticRawTransitions,
  pokeyDrainDiagnosticWrites,
  pokeySampleRate,
  pokeyReset,
  pokeySetDiagnosticChannelSamples,
  pokeySetDiagnosticRawTransitions,
  pokeySetDiagnosticWrites,
  pokeySetSampleAfterClock,
  pokeySetSampleCycles,
  POKEY_NATIVE_SAMPLE_RATE,
} from "../audio/pokey.js";
import { type SoundRomFiles, buildSoundRom } from "./sound-rom.js";
import { SOUND_CYCLES_PER_FRAME } from "./sound-clock.js";
import { baseCyclesFor } from "./cycle-table.js";
import { FLAG_I, hasFlag } from "./regfile.js";
import { as_u8 } from "../wrap.js";
import type { u8 } from "../wrap.js";

export const SOUND_CMD_TAPE_CPU_HZ_NUMERATOR = 14_318_181;
export const SOUND_CMD_TAPE_CPU_HZ_DENOMINATOR = 8;
export const SOUND_CMD_TAPE_CPU_HZ = SOUND_CMD_TAPE_CPU_HZ_NUMERATOR / SOUND_CMD_TAPE_CPU_HZ_DENOMINATOR;
export const DEFAULT_COMMAND_NMI_SAMPLE_CYCLE = 2;
export const DEFAULT_SOUND_INPUT_PULSE_FRAMES = 15;

export interface ChipWriteEvent {
  readonly kind: "ym2151" | "pokey";
  readonly frame: number | undefined;
  readonly cycle: number;
  readonly cycleInFrame: number | undefined;
  readonly rawCycle?: number;
  readonly rawCycleInFrame?: number;
  readonly pc: number;
  readonly writeCycleOffset: number;
  readonly rawWriteCycleOffset?: number;
  readonly eventCycleOffset?: number;
  readonly ymWriteEventCycleOffsetMatchIndices?: readonly number[];
  readonly reg: number;
  readonly val: number;
  readonly ymStreamTargetSample?: number;
  readonly ymStreamGeneratedBefore?: number;
  readonly ymStreamGeneratedAfter?: number;
  readonly ymStreamGeneratedCount?: number;
  readonly ymStreamAlreadyGeneratedSamples?: number;
  readonly ymStreamSampleOffset?: number;
  readonly pokeyApplyCycle?: number;
  readonly pokeyApplyDelayCycles?: number;
}

export interface SoundCpuStepEvent {
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

export interface SoundCommandReadEvent {
  readonly frame: number | undefined;
  readonly cycle: number;
  readonly cycleInFrame: number | undefined;
  readonly pc: number;
  readonly readCycleOffset: number;
  readonly val: number;
}

export interface MainReplyWriteEvent {
  readonly cycle: number;
  readonly frame: number | undefined;
  readonly cycleInFrame: number | undefined;
  readonly pc: number;
  readonly val: number;
}

export interface YmWriteEventCycleOffsetMatch {
  readonly frame?: number;
  readonly pc?: number;
  readonly reg?: number;
  readonly val?: number;
  readonly cycleInFrameMin?: number;
  readonly cycleInFrameMax?: number;
  readonly deltaCycles: number;
}

export interface YmWriteEventCycleOffsetContext {
  readonly frame: number | undefined;
  readonly pc: number;
  readonly opcode: number | undefined;
  readonly reg: number;
  readonly val: number;
  readonly rawCycle: number;
  readonly rawCycleInFrame: number | undefined;
  readonly rawWriteCycleOffset: number;
  readonly currentEventCycleOffset: number;
}

export interface PokeyWriteApplyDelayContext {
  readonly frame: number | undefined;
  readonly pc: number;
  readonly opcode: number | undefined;
  readonly reg: number;
  readonly val: number;
  readonly rawCycle: number;
  readonly rawCycleInFrame: number | undefined;
  readonly rawWriteCycleOffset: number;
  readonly currentApplyDelayCycles: number;
}

export interface YmWriteEventSampleOffsetMatch {
  readonly frame?: number;
  readonly pc?: number;
  readonly reg?: number;
  readonly val?: number;
  readonly deltaSamples: number;
}

function normalizeDiagnosticCycleDelay(cycles: number | undefined): number {
  if (cycles === undefined || !Number.isFinite(cycles)) return 0;
  return Math.max(0, Math.trunc(cycles));
}

function normalizeDiagnosticBigCycleOffset(cycles: number | bigint | undefined): bigint | undefined {
  if (cycles === undefined) return undefined;
  if (typeof cycles === "bigint") return cycles < 0n ? 0n : cycles;
  if (!Number.isFinite(cycles)) return undefined;
  return BigInt(Math.max(0, Math.trunc(cycles)));
}

function opcodeAtPc(chip: SoundChip | undefined, pc: number | undefined): number | undefined {
  if (chip === undefined || pc === undefined || pc < 0x4000 || pc > 0xffff) return undefined;
  return chip.mmu.rom[pc - 0x4000];
}

function romByteAtPc(chip: SoundChip, pc: number): number | undefined {
  if (pc < 0x4000 || pc > 0xffff) return undefined;
  return chip.mmu.rom[pc - 0x4000];
}

function diagnosticWriteCycleOffset(opcode: number | undefined): number {
  switch (opcode) {
    case 0x85: // STA zp
    case 0x86: // STX zp
    case 0x84: // STY zp
      return 2;
    case 0x95: // STA zp,X
    case 0x96: // STX zp,Y
    case 0x94: // STY zp,X
      return 3;
    case 0x8d: // STA abs
    case 0x8e: // STX abs
    case 0x8c: // STY abs
      return 3;
    case 0x9d: // STA abs,X
    case 0x99: // STA abs,Y
      return 4;
    case 0x81: // STA (zp,X)
    case 0x91: // STA (zp),Y
      return 5;
    default:
      return 0;
  }
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

function isChipIoAddress(addr: number): boolean {
  return addr === 0x1800 || addr === 0x1801 || (addr >= 0x1870 && addr < 0x1880);
}

function isYmAudioDataReg(reg: number | undefined): boolean {
  if (reg === undefined) return false;
  const r = reg & 0xff;
  return r !== 0x10 && r !== 0x11 && r !== 0x12 && r !== 0x14;
}

function isYmParameterDataReg(reg: number | undefined): boolean {
  if (reg === undefined) return false;
  if (!isYmAudioDataReg(reg)) return false;
  const r = reg & 0xff;
  return r !== 0x08;
}

function isYmTimerControlDataReg(reg: number | undefined): boolean {
  if (reg === undefined) return false;
  const r = reg & 0xff;
  return r === 0x10 || r === 0x11 || r === 0x12 || r === 0x14;
}

function absoluteOperandAtPc(chip: SoundChip, pc: number): number | undefined {
  const lo = romByteAtPc(chip, pc + 1);
  const hi = romByteAtPc(chip, pc + 2);
  return lo === undefined || hi === undefined ? undefined : (lo | (hi << 8)) & 0xffff;
}

function zeroPageWord(chip: SoundChip, zp: number): number {
  const lo = chip.mmu.ram[zp & 0xff] ?? 0;
  const hi = chip.mmu.ram[(zp + 1) & 0xff] ?? 0;
  return (lo | (hi << 8)) & 0xffff;
}

interface ChipIoStoreInstruction {
  readonly pc: number;
  readonly opcode: number;
  readonly address: number;
  readonly writeCycleOffset: number;
  readonly stepCycles: number;
}

interface DeferredChipIoWrite {
  readonly writeCycleOffset: number;
  readonly apply: () => void;
}

interface PendingPokeyWrite {
  readonly cycle: number;
  readonly sequence: number;
  readonly apply: () => void;
}

interface YmStreamWriteTiming {
  readonly ymStreamTargetSample: number;
  readonly ymStreamGeneratedBefore: number;
  readonly ymStreamGeneratedAfter: number;
  readonly ymStreamGeneratedCount: number;
  readonly ymStreamAlreadyGeneratedSamples: number;
  readonly ymStreamSampleOffset: number;
}

function currentChipIoStoreInstruction(chip: SoundChip): ChipIoStoreInstruction | undefined {
  const pc = chip.cpu.rf.pc as number;
  const opcode = opcodeAtPc(chip, pc);
  if (opcode === undefined) return undefined;
  let address: number | undefined;
  switch (opcode) {
    case 0x8c: // STY abs
    case 0x8d: // STA abs
    case 0x8e: // STX abs
      address = absoluteOperandAtPc(chip, pc);
      break;
    case 0x99: { // STA abs,Y
      const base = absoluteOperandAtPc(chip, pc);
      address = base === undefined ? undefined : (base + (chip.cpu.rf.y as number)) & 0xffff;
      break;
    }
    case 0x9d: { // STA abs,X
      const base = absoluteOperandAtPc(chip, pc);
      address = base === undefined ? undefined : (base + (chip.cpu.rf.x as number)) & 0xffff;
      break;
    }
    case 0x81: { // STA (zp,X)
      const zp = romByteAtPc(chip, pc + 1);
      address = zp === undefined ? undefined : zeroPageWord(chip, (zp + (chip.cpu.rf.x as number)) & 0xff);
      break;
    }
    case 0x91: { // STA (zp),Y
      const zp = romByteAtPc(chip, pc + 1);
      address = zp === undefined ? undefined : (zeroPageWord(chip, zp) + (chip.cpu.rf.y as number)) & 0xffff;
      break;
    }
    default:
      return undefined;
  }
  if (address === undefined || !isChipIoAddress(address)) return undefined;
  return {
    pc,
    opcode,
    address,
    writeCycleOffset: diagnosticWriteCycleOffset(opcode),
    stepCycles: baseCyclesFor(as_u8(opcode)),
  };
}

export interface SoundChip {
  cpu: M6502Cpu;
  mmu: SoundMmu;
  ym2151: YM2151;
  pokey: POKEY;
  mainToSound: Mailbox8;
  soundToMain: Mailbox8;
  /**
   * Queue of bytes written by the 6502 to the main CPU, drained through
   * `drainReplyEvents`. Each 6502 write to $1810 appends here; main drains FIFO.
   */
  replyQueue: number[];
  /**
   * Reset hold: the main CPU holds the sound 6502 in reset until `$860001`
   * bit 7 is set, matching `atarisy1.cpp bankselect_w`.
   */
  inReset: boolean;
  /** Diagnostic frame context, used only for write-event logging. */
  diagnosticFrame: number | undefined;
  diagnosticFrameStartCycle: number | undefined;
  /** Ordered diagnostic log of YM2151/POKEY writes since the last drain. */
  chipWriteEvents: ChipWriteEvent[];
  /** Diagnostic log of sound CPU command-latch reads since chip creation. */
  commandReadEvents: SoundCommandReadEvent[];
  /** Diagnostics-only delayed main-side acknowledgement of sound->main replies. */
  mainReplyAckDelayCycles: number;
  pendingMainReplyAckCycle: number | undefined;
  /** Diagnostics-only delayed assertion of main->sound NMI edges. */
  commandNmiDelayInstructions: number;
  pendingCommandNmiDelayInstructions: number | undefined;
  /** Diagnostics-only cycle stall before servicing a command NMI edge. */
  commandNmiServiceDelayCycles: number;
  pendingCommandNmiServiceDelayCycles: number | undefined;
  /** Last whole-CPU-step context, used for replay/NMI sampling diagnostics. */
  lastStepStartCycle: number | undefined;
  lastStepEndCycle: number | undefined;
  lastStepPc: number | undefined;
  lastStepCycles: number | undefined;
  /** Internal queue for chip I/O writes captured during a whole-opcode CPU
   * step. The facade applies them at the estimated bus cycle while ticking the
   * audio devices in matching segments. */
  deferChipIoWriteTiming: boolean;
  deferYmAudioWriteTiming: boolean;
  deferYmParameterWriteTiming: boolean;
  deferYmTimerControlWriteTiming: boolean;
  disableYmReset: boolean;
  /** Diagnostics/replay YM audio scheduler. Default cycle preserves runtime behavior. */
  ymAudioScheduler: "cycle" | "mame-stream";
  /** Idle fixed/input bits for `$1820`; tape replay may override coin bits per frame. */
  statusBaseIdle: u8;
  statusBaseOverride: u8 | undefined;
  ymStreamSampleRate: number;
  ymStreamGeneratedSamples: number;
  ymStreamSampleOffset: number;
  ymStreamCycleOffsetCycles: bigint | undefined;
  ymWriteEventCycleOffsetCycles: number;
  ymKeyOnWriteEventCycleOffsetCycles: number;
  deferChipIoWrites: boolean;
  deferredChipIoWrites: DeferredChipIoWrite[];
  /** Absolute sound-device cycle. Used only to interleave diagnostics that
   * schedule chip side effects inside a CPU step or after the bus write. */
  soundDeviceCycle: number;
  /** Diagnostics-only POKEY write application delay, in sound CPU cycles.
   * Diagnostic write events keep their bus-write timestamp; only the POKEY
   * state mutation is delayed. Default 0 preserves runtime behavior. */
  pokeyWriteApplyDelayCycles: number;
  /** Diagnostics-only delay before CPU services a visible unmasked IRQ. */
  irqServiceDelayCycles: number;
  /** Diagnostics-only YM IRQ output latency. The CPU keeps executing until the
   * delayed IRQ line becomes visible. */
  ymIrqAssertionDelayCycles: number;
  pendingYmIrqAssertionDelayCycles: number | undefined;
  /** Diagnostics-only instruction-boundary delay for a newly asserted YM IRQ
   * pin. This models IRQ sampling missing a chip edge that appeared too late in
   * the just-finished CPU instruction. */
  ymIrqNewAssertionInstructionDelay: number;
  pendingYmIrqInstructionDelay: number | undefined;
  ymIrqPinSyncedActive: boolean;
  onCpuStep: ((event: SoundCpuStepEvent) => void) | undefined;
  pendingPokeyWrites: PendingPokeyWrite[];
  nextPendingPokeyWriteSequence: number;
}

export interface SoundChipConfig {
  roms: SoundRomFiles;
  /** Istanze chip preesistenti (per testing / state restore). Default: create
   * fresh. */
  ym2151?: YM2151;
  pokey?: POKEY;
  /** Optional live diagnostics. Events are also stored for drainChipWriteEvents. */
  statusBase?: u8;
  /** Diagnostics-only delay before emulating the main CPU read of $FC0001.
   * Default 0 preserves the historical immediate auto-ack behavior. */
  mainReplyAckDelayCycles?: number;
  /** Diagnostics-only scheduler for the main CPU read of $FC0001. Returning an
   * absolute sound-CPU cycle keeps bit 4 of $1820 pending until that cycle. */
  mainReplyAckCycle?: (event: MainReplyWriteEvent) => number | undefined;
  /** Replay timing control: number of 6502 instruction boundaries to wait
   * before asserting NMI after a main->sound command edge. Default 0 preserves
   * the historical immediate NMI behavior; deterministic MAME replay probes may
   * opt into 1 when matching asynchronous command sampling. */
  commandNmiDelayInstructions?: number;
  /** Diagnostics-only replay timing control: once a command NMI edge is
   * visible, stall CPU opcode service by this many sound-CPU cycles while
   * audio devices continue ticking. Default 0 preserves runtime behavior. */
  commandNmiServiceDelayCycles?: number;
  /** Diagnostics-only experiment: apply YM2151/POKEY stores at the estimated
   * 6502 bus-write cycle. Default false preserves the ordered oracle path. */
  deferChipIoWriteTiming?: boolean;
  /** Diagnostics-only experiment: apply non-timer YM2151 data writes at the
   * estimated bus-write cycle, leaving CPU-visible timer/control timing alone. */
  deferYmAudioWriteTiming?: boolean;
  /** Diagnostics-only experiment: like deferYmAudioWriteTiming, but keeps
   * key-on writes at the default timing to isolate parameter-latch effects. */
  deferYmParameterWriteTiming?: boolean;
  /** Diagnostics-only experiment: apply YM timer/control data writes at the
   * estimated 6502 bus-write cycle without moving normal audio parameter data. */
  deferYmTimerControlWriteTiming?: boolean;
  /** Diagnostics-only experiment: ignore LS259 bit 0 YM2151 reset writes. */
  disableYmReset?: boolean;
  /** Diagnostics/replay experiment: generate YM PCM on MAME sound_stream sample
   * boundaries instead of every 64 YM cycles. Default cycle preserves runtime
   * behavior and ordered chip-write parity. */
  ymAudioScheduler?: "cycle" | "mame-stream";
  /** Integer MAME sound_stream sample rate for YM stream mode. */
  ymStreamSampleRate?: number;
  /** Diagnostics-only stream sample offset for mame-stream mode. This lets
   * replay use absolute MAME sound_stream sample indices while CPU cycles stay
   * relative to the replay reset frame. */
  ymStreamSampleOffset?: number;
  /** Diagnostics-only absolute sound-cycle origin for mame-stream mode. When
   * present, sample indices are computed as floor((origin + cycle) * rate / hz)
   * so the fractional phase of the MAME stream origin is preserved. */
  ymStreamCycleOffsetCycles?: number | bigint;
  /** Diagnostics-only experiment: offset YM data-write event timestamps used by
   * diagnostics and the mame-stream PCM scheduler. Does not move CPU state. */
  ymWriteEventCycleOffsetCycles?: number;
  /** Diagnostics-only experiment: add register-specific offsets to YM data-write
   * event timestamps. Entries are added after the global YM event offset and
   * before key-on's extra offset. Does not move CPU state. */
  ymWriteEventCycleOffsetByReg?: ReadonlyMap<number, number>;
  /** Diagnostics-only experiment: add offsets to YM data-write event timestamps
   * when frame/PC/register/value selectors match. Does not move CPU state. */
  ymWriteEventCycleOffsetMatches?: readonly YmWriteEventCycleOffsetMatch[];
  /** Diagnostics-only experiment: add a dynamic offset to YM data-write event
   * timestamps after the static/global offsets above. Does not move CPU state. */
  ymWriteEventCycleOffsetProvider?: (ctx: YmWriteEventCycleOffsetContext) => number | undefined;
  /** Diagnostics-only experiment: add offsets in YM mame-stream sample units
   * for selected writes. This changes only when replay applies a write to the
   * diagnostic stream scheduler; CPU/register event timing remains unchanged. */
  ymWriteEventSampleOffsetMatches?: readonly YmWriteEventSampleOffsetMatch[];
  /** Diagnostics-only experiment: additional event timestamp offset for YM
   * key-on writes (`reg 0x08`). Does not move CPU state. */
  ymKeyOnWriteEventCycleOffsetCycles?: number;
  /** Diagnostics-only experiment: apply POKEY register writes after this many
   * sound CPU cycles from their estimated 6502 bus-write cycle. Default 0
   * preserves ordered write logging and historical POKEY state timing. */
  pokeyWriteApplyDelayCycles?: number;
  /** Diagnostics-only experiment: add a dynamic delay to POKEY register-write
   * application timing. This affects only replay/audio timing; default replay
   * and gameplay leave it unset. */
  pokeyWriteApplyDelayProvider?: (ctx: PokeyWriteApplyDelayContext) => number | undefined;
  /** Diagnostics-only experiment: wait this many sound CPU cycles before
   * serving a visible unmasked IRQ. Default 0 preserves runtime behavior. */
  irqServiceDelayCycles?: number;
  /** Diagnostics-only experiment: model the NMOS 6502 delayed IRQ visibility
   * after CLI. Default false preserves the promoted replay/runtime gate. */
  cpuCliIrqDelay?: boolean;
  /** Diagnostics-only experiment: latch IRQ recognition at opcode prefetch, as
   * MAME does. Default false preserves the promoted replay/runtime gate. */
  cpuIrqPrefetchLatch?: boolean;
  /** Diagnostics-only experiment: wait this many sound CPU cycles after a YM
   * Timer A/B overflow before asserting the 6502 IRQ line. Default 0 preserves
   * runtime behavior. Unlike irqServiceDelayCycles, this lets the CPU continue
   * executing while the chip IRQ output is still not visible. */
  ymIrqAssertionDelayCycles?: number;
  /** Diagnostics-only experiment: for a newly asserted YM IRQ pin, wait this
   * many complete 6502 instruction boundaries before making the IRQ visible to
   * the CPU. Default 0 preserves runtime behavior. */
  ymIrqNewAssertionInstructionDelay?: number;
  /** Optional diagnostics hook called after each sound-CPU instruction or
   * interrupt service. It observes state only and must not mutate the chip. */
  onCpuStep?: (event: SoundCpuStepEvent) => void;
  onYmWrite?: (event: ChipWriteEvent) => void;
  onPokeyWrite?: (event: ChipWriteEvent) => void;
}

export function createSoundChip(cfg: SoundChipConfig): SoundChip {
  const cpu = createCpu();
  setCliIrqDelay(cpu, cfg.cpuCliIrqDelay === true);
  setIrqPrefetchLatch(cpu, cfg.cpuIrqPrefetchLatch === true);
  const mainToSound = createMailbox();
  const soundToMain = createMailbox();
  const ym2151 = cfg.ym2151 ?? createYM2151();
  const pokey = cfg.pokey ?? createPOKEY();
  const replyQueue: number[] = [];
  const chipWriteEvents: ChipWriteEvent[] = [];
  const commandReadEvents: SoundCommandReadEvent[] = [];
  const mainReplyAckDelayCycles = normalizeDiagnosticCycleDelay(cfg.mainReplyAckDelayCycles);
  const commandNmiDelayInstructions = normalizeDiagnosticCycleDelay(cfg.commandNmiDelayInstructions);
  const commandNmiServiceDelayCycles = normalizeDiagnosticCycleDelay(cfg.commandNmiServiceDelayCycles);
  const deferChipIoWriteTiming = cfg.deferChipIoWriteTiming === true;
  const deferYmAudioWriteTiming = cfg.deferYmAudioWriteTiming === true;
  const deferYmParameterWriteTiming = cfg.deferYmParameterWriteTiming === true;
  const deferYmTimerControlWriteTiming = cfg.deferYmTimerControlWriteTiming === true;
  const disableYmReset = cfg.disableYmReset === true;
  const ymAudioScheduler = cfg.ymAudioScheduler ?? "cycle";
  const statusBaseIdle = cfg.statusBase ?? as_u8(0x87);
  const defaultYmStreamSampleRate = ymAudioScheduler === "mame-stream"
    ? YM2151_MAME_STREAM_SAMPLE_RATE
    : YM2151_NATIVE_SAMPLE_RATE;
  const ymStreamSampleRate = Math.max(1, cfg.ymStreamSampleRate ?? defaultYmStreamSampleRate);
  const ymStreamSampleOffset = Math.max(0, Math.trunc(cfg.ymStreamSampleOffset ?? 0));
  const ymStreamCycleOffsetCycles = normalizeDiagnosticBigCycleOffset(cfg.ymStreamCycleOffsetCycles);
  const ymWriteEventCycleOffsetCycles = normalizeDiagnosticSignedCycleOffset(cfg.ymWriteEventCycleOffsetCycles);
  const ymWriteEventCycleOffsetByReg = normalizeDiagnosticRegCycleOffsets(cfg.ymWriteEventCycleOffsetByReg);
  const ymWriteEventCycleOffsetMatches = normalizeYmWriteEventCycleOffsetMatches(
    cfg.ymWriteEventCycleOffsetMatches,
  );
  const ymWriteEventCycleOffsetProvider = cfg.ymWriteEventCycleOffsetProvider;
  const ymWriteEventSampleOffsetMatches = normalizeYmWriteEventSampleOffsetMatches(
    cfg.ymWriteEventSampleOffsetMatches,
  );
  const ymKeyOnWriteEventCycleOffsetCycles =
    normalizeDiagnosticSignedCycleOffset(cfg.ymKeyOnWriteEventCycleOffsetCycles);
  const pokeyWriteApplyDelayCycles = normalizeDiagnosticCycleDelay(cfg.pokeyWriteApplyDelayCycles);
  const pokeyWriteApplyDelayProvider = cfg.pokeyWriteApplyDelayProvider;
  const irqServiceDelayCycles = normalizeDiagnosticCycleDelay(cfg.irqServiceDelayCycles);
  const ymIrqAssertionDelayCycles = normalizeDiagnosticCycleDelay(cfg.ymIrqAssertionDelayCycles);
  const ymIrqNewAssertionInstructionDelay =
    normalizeDiagnosticCycleDelay(cfg.ymIrqNewAssertionInstructionDelay);
  ym2151SetExternalSampleClock(ym2151, ymAudioScheduler === "mame-stream");
  let chipRef: SoundChip | undefined;

  const serviceMainReplyAck = (): void => {
    const ackCycle = chipRef?.pendingMainReplyAckCycle;
    if (chipRef === undefined || ackCycle === undefined || cpu.cycles < ackCycle) return;
    chipRef.soundToMain.pending = false;
    chipRef.pendingMainReplyAckCycle = undefined;
  };

  const makeWriteEvent = (kind: "ym2151" | "pokey", reg: number, val: number): ChipWriteEvent => {
    const pc = cpu.lastOpcodePc ?? (cpu.rf.pc as number);
    const writeCycleOffset = diagnosticWriteCycleOffset(opcodeAtPc(chipRef, pc));
    const rawCycle = Math.max(0, cpu.cycles + writeCycleOffset);
    const frameStart = chipRef?.diagnosticFrameStartCycle;
    const rawCycleInFrame = frameStart === undefined ? undefined : rawCycle - frameStart;
    const regEventCycleOffset = kind === "ym2151" ? (ymWriteEventCycleOffsetByReg.get(reg & 0xff) ?? 0) : 0;
    const matchEventCycleOffset = kind === "ym2151"
      ? ymWriteEventCycleOffsetForMatch(
          ymWriteEventCycleOffsetMatches,
          chipRef?.diagnosticFrame,
          rawCycleInFrame,
          pc,
          reg,
          val,
        )
      : undefined;
    const staticEventCycleOffset = kind === "ym2151"
      ? ymWriteEventCycleOffsetCycles + regEventCycleOffset + (matchEventCycleOffset?.offset ?? 0) +
        (reg === 0x08 ? ymKeyOnWriteEventCycleOffsetCycles : 0)
      : 0;
    const dynamicEventCycleOffset = kind === "ym2151"
      ? normalizeDiagnosticSignedCycleOffset(ymWriteEventCycleOffsetProvider?.({
          frame: chipRef?.diagnosticFrame,
          pc,
          opcode: opcodeAtPc(chipRef, pc),
          reg: reg & 0xff,
          val: val & 0xff,
          rawCycle,
          rawCycleInFrame,
          rawWriteCycleOffset: writeCycleOffset,
          currentEventCycleOffset: staticEventCycleOffset,
        }))
      : 0;
    const eventCycleOffset = staticEventCycleOffset + dynamicEventCycleOffset;
    const hasMatchedEventCycleOffset = (matchEventCycleOffset?.matchIndices.length ?? 0) > 0;
    const cycle = Math.max(0, rawCycle + eventCycleOffset);
    return {
      kind,
      frame: chipRef?.diagnosticFrame,
      cycle,
      cycleInFrame: frameStart === undefined ? undefined : cycle - frameStart,
      ...(eventCycleOffset === 0 && !hasMatchedEventCycleOffset
        ? {}
        : {
          rawCycle,
          ...(frameStart === undefined ? {} : { rawCycleInFrame: rawCycle - frameStart }),
          rawWriteCycleOffset: writeCycleOffset,
          eventCycleOffset,
          ...((matchEventCycleOffset?.matchIndices.length ?? 0) === 0
            ? {}
            : { ymWriteEventCycleOffsetMatchIndices: matchEventCycleOffset!.matchIndices }),
        }),
      pc,
      writeCycleOffset: writeCycleOffset + eventCycleOffset,
      reg: reg & 0xff,
      val: val & 0xff,
    };
  };

  const serviceYmStreamAudioToCycle = (cycle: number, sampleOffset = 0): YmStreamWriteTiming | undefined => {
    const chip = chipRef;
    if (chip === undefined || chip.ymAudioScheduler !== "mame-stream") return undefined;
    const targetSample = ymStreamTargetSample(chip, cycle) + Math.trunc(sampleOffset);
    const generatedBefore = chip.ymStreamGeneratedSamples;
    const needed = (targetSample + 1) - chip.ymStreamGeneratedSamples;
    if (needed > 0) {
      ym2151GenerateSamples(chip.ym2151, needed);
      chip.ymStreamGeneratedSamples += needed;
    }
    return {
      ymStreamTargetSample: targetSample,
      ymStreamGeneratedBefore: generatedBefore,
      ymStreamGeneratedAfter: chip.ymStreamGeneratedSamples,
      ymStreamGeneratedCount: Math.max(0, needed),
      ymStreamAlreadyGeneratedSamples: Math.max(0, generatedBefore - (targetSample + 1)),
      ymStreamSampleOffset: Math.trunc(sampleOffset),
    };
  };

  const recordYmWrite = (event: { readonly reg: number; readonly val: number }): void => {
    const base = makeWriteEvent("ym2151", event.reg, event.val);
    const sampleOffset = ymWriteEventSampleOffsetForMatch(
      ymWriteEventSampleOffsetMatches,
      base.frame,
      base.pc,
      base.reg,
      base.val,
    );
    const streamTiming = serviceYmStreamAudioToCycle(base.cycle, sampleOffset);
    const enriched: ChipWriteEvent = streamTiming === undefined
      ? base
      : { ...base, ...streamTiming };
    chipWriteEvents.push(enriched);
    cfg.onYmWrite?.(enriched);
  };
  const recordPokeyWrite = (event: { readonly reg: number; readonly val: number }): void => {
    const enriched = makeWriteEvent("pokey", event.reg, event.val);
    chipWriteEvents.push(enriched);
    cfg.onPokeyWrite?.(enriched);
  };
  const recordMainToSoundRead = (event: { readonly val: number }): void => {
    const pc = cpu.lastOpcodePc ?? (cpu.rf.pc as number);
    const readCycleOffset = diagnosticReadCycleOffset(opcodeAtPc(chipRef, pc));
    const cycle = Math.max(0, cpu.cycles + readCycleOffset);
    const frameStart = chipRef?.diagnosticFrameStartCycle;
    commandReadEvents.push({
      frame: chipRef?.diagnosticFrame,
      cycle,
      cycleInFrame: frameStart === undefined ? undefined : cycle - frameStart,
      pc,
      readCycleOffset,
      val: event.val & 0xff,
    });
  };

  const pokeyWriteApplyDelayFor = (
    chip: SoundChip,
    event: { readonly reg?: number; readonly val?: number },
  ): { readonly rawCycle: number; readonly delayCycles: number } => {
    const pc = cpu.lastOpcodePc ?? (cpu.rf.pc as number);
    const opcode = opcodeAtPc(chip, pc);
    const rawWriteCycleOffset = diagnosticWriteCycleOffset(opcode);
    const rawCycle = Math.max(0, cpu.cycles + rawWriteCycleOffset);
    const frameStart = chip.diagnosticFrameStartCycle;
    const dynamicDelayCycles = normalizeDiagnosticSignedCycleOffset(pokeyWriteApplyDelayProvider?.({
      frame: chip.diagnosticFrame,
      pc,
      opcode,
      reg: event.reg === undefined ? 0 : event.reg & 0xff,
      val: event.val === undefined ? 0 : event.val & 0xff,
      rawCycle,
      rawCycleInFrame: frameStart === undefined ? undefined : rawCycle - frameStart,
      rawWriteCycleOffset,
      currentApplyDelayCycles: chip.pokeyWriteApplyDelayCycles,
    }));
    return {
      rawCycle,
      delayCycles: Math.max(0, chip.pokeyWriteApplyDelayCycles + dynamicDelayCycles),
    };
  };

  const schedulePokeyWrite = (chip: SoundChip, cycle: number, apply: () => void): void => {
    if (cycle <= chip.soundDeviceCycle) {
      apply();
      syncIrqPin(chip);
      return;
    }
    chip.pendingPokeyWrites.push({
      cycle,
      sequence: chip.nextPendingPokeyWriteSequence++,
      apply,
    });
    chip.pendingPokeyWrites.sort((a, b) =>
      a.cycle === b.cycle ? a.sequence - b.sequence : a.cycle - b.cycle);
  };

  const annotateLastPokeyWriteApplyTiming = (
    chip: SoundChip,
    event: { readonly reg?: number; readonly val?: number },
    rawCycle: number,
    delayCycles: number,
  ): void => {
    const index = chip.chipWriteEvents.length - 1;
    if (index < 0) return;
    const last = chip.chipWriteEvents[index];
    if (last === undefined || last.kind !== "pokey") return;
    if (last.cycle !== rawCycle) return;
    if (last.reg !== ((event.reg ?? 0) & 0xff) || last.val !== ((event.val ?? 0) & 0xff)) return;
    chip.chipWriteEvents[index] = {
      ...last,
      pokeyApplyCycle: rawCycle + delayCycles,
      pokeyApplyDelayCycles: delayCycles,
    };
  };

  const deferChipWrite = (_event: unknown, apply: () => void): boolean => {
    const event = _event as { readonly kind?: string; readonly reg?: number; readonly val?: number };
    const chip = chipRef;
    if (chip !== undefined && event.kind === "pokey") {
      const delayed = pokeyWriteApplyDelayFor(chip, event);
      annotateLastPokeyWriteApplyTiming(chip, event, delayed.rawCycle, delayed.delayCycles);
      if (delayed.delayCycles > 0) {
        schedulePokeyWrite(chip, delayed.rawCycle + delayed.delayCycles, apply);
        return true;
      }
    }
    const deferThisWrite = chip?.deferChipIoWrites === true ||
      (event.kind === "ym2151Data" && (
        (chip?.deferYmAudioWriteTiming === true && isYmAudioDataReg(event.reg)) ||
        (chip?.deferYmParameterWriteTiming === true && isYmParameterDataReg(event.reg)) ||
        (chip?.deferYmTimerControlWriteTiming === true && isYmTimerControlDataReg(event.reg))
      ));
    if (!deferThisWrite) return false;
    const pc = cpu.lastOpcodePc ?? (cpu.rf.pc as number);
    chip.deferredChipIoWrites.push({
      writeCycleOffset: diagnosticWriteCycleOffset(opcodeAtPc(chip, pc)),
      apply,
    });
    return true;
  };

  const mmu = createSoundMmu({
    rom: buildSoundRom(cfg.roms),
    mainToSound,
    soundToMain,
    ym2151,
    pokey,
    onMainToSoundAck: () => {
      // The 6502 read the command via $1810; release the NMI line.
      cpu.nmi = false;
    },
    onMainToSoundRead: recordMainToSoundRead,
    onSoundToMainPost: () => {
      // The 6502 wrote a reply via $1810; push it for main-side draining.
      // Auto-clear pending immediately to model the 68010 IRQ6 service reading
      // $FC0001 within microseconds. Delaying this until frame end stalls the
      // NMI handler in its $1820 polling loop and shifts music dispatch by a
      // frame.
      replyQueue.push(soundToMain.value as number);
      const frameStart = chipRef?.diagnosticFrameStartCycle;
      const ackCycle = cfg.mainReplyAckCycle?.({
        cycle: cpu.cycles,
        frame: chipRef?.diagnosticFrame,
        cycleInFrame: frameStart === undefined ? undefined : cpu.cycles - frameStart,
        pc: cpu.lastOpcodePc ?? (cpu.rf.pc as number),
        val: soundToMain.value as number,
      });
      if (ackCycle !== undefined && Number.isFinite(ackCycle)) {
        const cycle = Math.trunc(ackCycle);
        if (cycle <= cpu.cycles) {
          soundToMain.pending = false;
          if (chipRef !== undefined) chipRef.pendingMainReplyAckCycle = undefined;
        } else if (chipRef !== undefined) {
          chipRef.pendingMainReplyAckCycle = cycle;
        }
      } else if (mainReplyAckDelayCycles === 0) {
        soundToMain.pending = false;
      } else if (chipRef !== undefined) {
        chipRef.pendingMainReplyAckCycle = cpu.cycles + mainReplyAckDelayCycles;
      }
    },
    beforeStatusRead: serviceMainReplyAck,
    statusBase: statusBaseIdle,
    statusBaseProvider: () => chipRef?.statusBaseOverride,
    ...(disableYmReset ? { disableYmReset: true } : {}),
    onYmWrite: recordYmWrite,
    onPokeyWrite: recordPokeyWrite,
    deferChipWrite,
  });

  // Esegue reset sequence: PC = vector $FFFC/$FFFD.
  cpuReset(cpu, mmu);
  // Sound 6502 parte in HOLD reset (hardware). Main 68K dovra' call
  // releaseSoundReset() per liberare il 6502 and farlo iniziare a girare.
  const chip: SoundChip = {
    cpu,
    mmu,
    ym2151,
    pokey,
    mainToSound,
    soundToMain,
    replyQueue,
    inReset: true,
    diagnosticFrame: undefined,
    diagnosticFrameStartCycle: undefined,
    chipWriteEvents,
    commandReadEvents,
    mainReplyAckDelayCycles,
    pendingMainReplyAckCycle: undefined,
    commandNmiDelayInstructions,
    pendingCommandNmiDelayInstructions: undefined,
    commandNmiServiceDelayCycles,
    pendingCommandNmiServiceDelayCycles: undefined,
    lastStepStartCycle: undefined,
    lastStepEndCycle: undefined,
    lastStepPc: undefined,
    lastStepCycles: undefined,
    deferChipIoWriteTiming,
    deferYmAudioWriteTiming,
    deferYmParameterWriteTiming,
    deferYmTimerControlWriteTiming,
    disableYmReset,
    ymAudioScheduler,
    statusBaseIdle,
    statusBaseOverride: undefined,
    ymStreamSampleRate,
    ymStreamGeneratedSamples: 0,
    ymStreamSampleOffset,
    ymStreamCycleOffsetCycles,
    ymWriteEventCycleOffsetCycles,
    ymKeyOnWriteEventCycleOffsetCycles,
    deferChipIoWrites: false,
    deferredChipIoWrites: [],
    soundDeviceCycle: cpu.cycles,
    pokeyWriteApplyDelayCycles,
    irqServiceDelayCycles,
    ymIrqAssertionDelayCycles,
    pendingYmIrqAssertionDelayCycles: undefined,
    ymIrqNewAssertionInstructionDelay,
    pendingYmIrqInstructionDelay: undefined,
    ymIrqPinSyncedActive: false,
    onCpuStep: cfg.onCpuStep,
    pendingPokeyWrites: [],
    nextPendingPokeyWriteSequence: 0,
  };
  chipRef = chip;
  return chip;
}

/**
 * Release the sound 6502 from reset hold. Equivalent to writing `$860001`
 * bit 7 = 1 (`atarisy1.cpp bankselect_w`) and re-running the reset sequence.
 *
 * Pending commands do not reassert NMI here. The boot code explicitly polls
 * `$1810` at `$80DF`; an NMI edge that happened while the CPU was held in reset
 * is not latched by the hardware.
 */
export function releaseSoundReset(chip: SoundChip): void {
  tapeReplayScheduleCycles.delete(chip);
  chip.inReset = false;
  cpuReset(chip.cpu, chip.mmu);
  chip.cpu.cycles = 0;
  chip.soundDeviceCycle = 0;
  chip.pendingPokeyWrites.length = 0;
  chip.nextPendingPokeyWriteSequence = 0;
  chip.ymStreamGeneratedSamples = 0;
  chip.pendingYmIrqAssertionDelayCycles = undefined;
}

/** Put the sound 6502 back into reset hold, equivalent to `$860001` bit 7 = 0. */
export function holdSoundReset(chip: SoundChip): void {
  tapeReplayScheduleCycles.delete(chip);
  chip.inReset = true;
  // Clear volatile state: RAM, mailboxes, and chip shadows.
  chip.mmu.ram.fill(0);
  chip.cpu.cycles = 0;
  chip.soundDeviceCycle = 0;
  chip.cpu.nmi = false;
  chip.cpu.irq = false;
  chip.pendingMainReplyAckCycle = undefined;
  chip.pendingCommandNmiDelayInstructions = undefined;
  chip.pendingCommandNmiServiceDelayCycles = undefined;
  chip.pendingYmIrqAssertionDelayCycles = undefined;
  chip.pendingYmIrqInstructionDelay = undefined;
  chip.ymIrqPinSyncedActive = false;
  chip.statusBaseOverride = undefined;
  chip.lastStepStartCycle = undefined;
  chip.lastStepEndCycle = undefined;
  chip.lastStepPc = undefined;
  chip.lastStepCycles = undefined;
  chip.ymStreamGeneratedSamples = 0;
  chip.deferChipIoWrites = false;
  chip.deferredChipIoWrites.length = 0;
  chip.pendingPokeyWrites.length = 0;
  chip.nextPendingPokeyWriteSequence = 0;
}

function requestCommandNmi(chip: SoundChip): void {
  requestNmi(chip.cpu);
  const delay = chip.commandNmiServiceDelayCycles;
  if (delay > 0) {
    chip.pendingCommandNmiServiceDelayCycles =
      Math.max(chip.pendingCommandNmiServiceDelayCycles ?? 0, delay);
  }
}

/** Services diagnostics-only delayed command NMI edges at instruction
 * boundaries. Default replay never arms this path. */
export function servicePendingCommandNmi(chip: SoundChip): void {
  const pending = chip.pendingCommandNmiDelayInstructions;
  if (pending === undefined) return;
  if (pending <= 0) {
    requestCommandNmi(chip);
    chip.pendingCommandNmiDelayInstructions = undefined;
    return;
  }
  chip.pendingCommandNmiDelayInstructions = pending - 1;
}

function servicePendingCommandNmiCycleDelay(chip: SoundChip): void {
  if (!chip.cpu.nmi) return;
  const delay = chip.pendingCommandNmiServiceDelayCycles;
  if (delay === undefined || delay <= 0) return;
  chip.pendingCommandNmiServiceDelayCycles = undefined;
  tickDevicesWithoutCpu(chip, delay);
}

function irqWillService(chip: SoundChip): boolean {
  if (chip.cpu.irqPrefetchLatchEnabled) {
    return !chip.cpu.nmi && chip.cpu.irqTakenPending;
  }
  return !chip.cpu.nmi &&
    chip.cpu.irq &&
    !hasFlag(chip.cpu.rf.p, FLAG_I) &&
    chip.cpu.irqMaskDelayInstructions <= 0;
}

function ymIrqPinActive(chip: SoundChip): boolean {
  return (
    (chip.ym2151.timerAOverflow && chip.ym2151.timerAIrqEnable) ||
    (chip.ym2151.timerBOverflow && chip.ym2151.timerBIrqEnable)
  );
}

function syncIrqPin(chip: SoundChip): void {
  if (!ymIrqPinActive(chip)) {
    chip.pendingYmIrqAssertionDelayCycles = undefined;
    chip.pendingYmIrqInstructionDelay = undefined;
    chip.ymIrqPinSyncedActive = false;
    clearIrq(chip.cpu);
    return;
  }
  if (!chip.ymIrqPinSyncedActive) {
    chip.ymIrqPinSyncedActive = true;
    if (chip.ymIrqNewAssertionInstructionDelay > 0) {
      chip.pendingYmIrqInstructionDelay = chip.ymIrqNewAssertionInstructionDelay + 1;
    }
  }
  if ((chip.pendingYmIrqInstructionDelay ?? 0) > 0) {
    clearIrq(chip.cpu);
    return;
  }
  if (chip.ymIrqAssertionDelayCycles <= 0) {
    chip.pendingYmIrqAssertionDelayCycles = undefined;
    requestIrq(chip.cpu);
    return;
  }
  if (chip.cpu.irq || chip.pendingYmIrqAssertionDelayCycles !== undefined) return;
  chip.pendingYmIrqAssertionDelayCycles = chip.ymIrqAssertionDelayCycles;
}

function advancePendingYmIrqAssertionDelay(chip: SoundChip, cycles: number): void {
  const pending = chip.pendingYmIrqAssertionDelayCycles;
  if (pending === undefined) return;
  if (!ymIrqPinActive(chip)) {
    chip.pendingYmIrqAssertionDelayCycles = undefined;
    return;
  }
  const remaining = pending - Math.max(0, Math.trunc(cycles));
  if (remaining > 0) {
    chip.pendingYmIrqAssertionDelayCycles = remaining;
    return;
  }
  chip.pendingYmIrqAssertionDelayCycles = undefined;
  requestIrq(chip.cpu);
}

function advancePendingYmIrqInstructionDelay(chip: SoundChip): void {
  const pending = chip.pendingYmIrqInstructionDelay;
  if (pending === undefined) return;
  if (!ymIrqPinActive(chip)) {
    chip.pendingYmIrqInstructionDelay = undefined;
    return;
  }
  if (pending > 0) {
    chip.pendingYmIrqInstructionDelay = pending - 1;
  }
}

function tickSoundDevicesRaw(chip: SoundChip, cycles: number): void {
  const elapsed = Math.max(0, Math.trunc(cycles));
  if (elapsed === 0) return;
  ym2151TickCycles(chip.ym2151, elapsed);
  pokeyTickCycles(chip.pokey, elapsed);
}

function tickSoundDevices(chip: SoundChip, cycles: number): void {
  const elapsed = Math.max(0, Math.trunc(cycles));
  if (elapsed === 0) return;

  const targetCycle = chip.soundDeviceCycle + elapsed;
  let currentCycle = chip.soundDeviceCycle;

  while (chip.pendingPokeyWrites.length > 0) {
    const pending = chip.pendingPokeyWrites[0]!;
    if (pending.cycle > targetCycle) break;
    chip.pendingPokeyWrites.shift();
    const segmentCycles = pending.cycle - currentCycle;
    tickSoundDevicesRaw(chip, segmentCycles);
    advancePendingYmIrqAssertionDelay(chip, segmentCycles);
    currentCycle = Math.max(currentCycle, pending.cycle);
    chip.soundDeviceCycle = currentCycle;
    pending.apply();
    syncIrqPin(chip);
  }

  const tailCycles = targetCycle - currentCycle;
  tickSoundDevicesRaw(chip, tailCycles);
  advancePendingYmIrqAssertionDelay(chip, tailCycles);
  chip.soundDeviceCycle = targetCycle;
  syncIrqPin(chip);
}

function tickDevicesWithoutCpu(chip: SoundChip, cycles: number): void {
  const elapsed = Math.max(0, Math.trunc(cycles));
  if (elapsed === 0) return;
  chip.cpu.cycles += elapsed;
  tickSoundDevices(chip, elapsed);
}

function flushDeferredChipIoWrites(chip: SoundChip, stepStart: number, stepCycles: number): void {
  const writes = chip.deferredChipIoWrites.splice(0)
    .sort((a, b) => a.writeCycleOffset - b.writeCycleOffset);
  if (writes.length === 0) {
    tickSoundDevices(chip, stepCycles);
    return;
  }

  const stepEnd = chip.cpu.cycles;
  let elapsed = 0;
  for (const write of writes) {
    const writeOffset = Math.max(0, Math.min(stepCycles, write.writeCycleOffset));
    tickSoundDevices(chip, writeOffset - elapsed);
    elapsed = writeOffset;

    chip.cpu.cycles = stepStart + writeOffset;
    write.apply();
    syncIrqPin(chip);
    chip.cpu.cycles = stepEnd;
  }
  tickSoundDevices(chip, stepCycles - elapsed);
}

function stepSoundCpuInstruction(chip: SoundChip): void {
  const stepStart = chip.cpu.cycles;
  const stepPc = chip.cpu.rf.pc as number;
  const opcode = opcodeAtPc(chip, stepPc);
  const nmiBefore = chip.cpu.nmi;
  const irqBefore = chip.cpu.irq;
  const irqWillServiceBefore = irqWillService(chip);
  const ymIrqPinBefore = ymIrqPinActive(chip);
  const timerAOverflowBefore = chip.ym2151.timerAOverflow;
  const timerAIrqEnableBefore = chip.ym2151.timerAIrqEnable;
  const timerACounterBefore = chip.ym2151.timerACounter;
  const timerAAccumulatorBefore = chip.ym2151.timerAAccumulator;
  const pendingYmIrqAssertionDelayBefore = chip.pendingYmIrqAssertionDelayCycles;
  const pendingYmIrqInstructionDelayBefore = chip.pendingYmIrqInstructionDelay;
  chip.deferChipIoWrites = chip.deferChipIoWriteTiming;
  try {
    cpuStep(chip.cpu, chip.mmu);
  } finally {
    chip.deferChipIoWrites = false;
  }
  const stepCycles = chip.cpu.cycles - stepStart;
  chip.lastStepStartCycle = stepStart;
  chip.lastStepEndCycle = chip.cpu.cycles;
  chip.lastStepPc = stepPc;
  chip.lastStepCycles = stepCycles;
  flushDeferredChipIoWrites(chip, stepStart, stepCycles);
  advancePendingYmIrqInstructionDelay(chip);
  syncIrqPin(chip);
  sampleIrqPrefetch(chip.cpu);
  chip.onCpuStep?.({
    frame: chip.diagnosticFrame,
    frameStartCycle: chip.diagnosticFrameStartCycle,
    startCycle: stepStart,
    endCycle: chip.cpu.cycles,
    startCycleInFrame: chip.diagnosticFrameStartCycle === undefined
      ? undefined
      : stepStart - chip.diagnosticFrameStartCycle,
    endCycleInFrame: chip.diagnosticFrameStartCycle === undefined
      ? undefined
      : chip.cpu.cycles - chip.diagnosticFrameStartCycle,
    pc: stepPc,
    opcode,
    nextPc: chip.cpu.rf.pc as number,
    interruptService: nmiBefore ? "nmi" : irqWillServiceBefore ? "irq" : undefined,
    nmiBefore,
    irqBefore,
    irqWillServiceBefore,
    ymIrqPinBefore,
    timerAOverflowBefore,
    timerAIrqEnableBefore,
    timerACounterBefore,
    timerAAccumulatorBefore,
    pendingYmIrqAssertionDelayBefore,
    pendingYmIrqInstructionDelayBefore,
    nmiAfter: chip.cpu.nmi,
    irqAfter: chip.cpu.irq,
    ymIrqPinAfter: ymIrqPinActive(chip),
    timerAOverflowAfter: chip.ym2151.timerAOverflow,
    timerAIrqEnableAfter: chip.ym2151.timerAIrqEnable,
    timerACounterAfter: chip.ym2151.timerACounter,
    timerAAccumulatorAfter: chip.ym2151.timerAAccumulator,
    pendingYmIrqAssertionDelayAfter: chip.pendingYmIrqAssertionDelayCycles,
    pendingYmIrqInstructionDelayAfter: chip.pendingYmIrqInstructionDelay,
  });
}

/** Advance the 6502 by `cycles` cycles. Process pending NMI/IRQ before the
 * next opcode. V3: also advance YM2151 Timer A/B and assert 6502 IRQ
 * on overflow when IRQA/B is enabled.
 *
 * IRQ wiring: the 6502 IRQ pin is a wired OR across multiple sources
 * (YM2151 timer, POKEY IRQ). V3 minimal: only YM2151 Timer A/B. POKEY IRQ
 * is deferred. */
export function tickCycles(chip: SoundChip, cycles: number): number {
  // Reset hold: no cycles consumed. RAM stays 0 and the chip stays fresh.
  if (chip.inReset) return 0;
  // Interleave CPU step + chip tick + IRQ pin update per matching hardware
  // real-time IRQ line behavior. Without this, cpu.irq stayed asserted for the
  // whole frame even after the IRQ handler cleared the timer flag, causing the
  // CPU to re-enter the handler every instruction (infinite IRQ loop).
  // Chunk size 32 6502 cycles = 1 Timer A tick (64 YM cycles), which is enough
  // granularity for Timer A IRQ semantics.
  const start = chip.cpu.cycles;
  while (chip.cpu.cycles - start < cycles) {
    servicePendingCommandNmi(chip);
    servicePendingCommandNmiCycleDelay(chip);
    if (chip.irqServiceDelayCycles > 0 && irqWillService(chip)) {
      tickDevicesWithoutCpu(chip, chip.irqServiceDelayCycles);
    }
    stepSoundCpuInstruction(chip);
  }
  return chip.cpu.cycles - start;
}

/**
 * Main CPU writes a command to sound, equivalent to 68K-side write `$FE0001`.
 * NMI is asserted on the 6502 when pending transitions false -> true.
 *
 * NMI is suppressed while the sound CPU is held in reset. Real hardware sees
 * commands before reset release; the low NMI line is not latched as an edge
 * while the CPU is reset, and boot code consumes the command by polling $1820
 * and reading $1810.
 *
 * Without this guard, the first opcode after reset can be skipped for NMI
 * service before the boot init path sets up stack and zero page.
 */
export function submitCommand(chip: SoundChip, byte: u8): void {
  mailboxWrite(chip.mainToSound, byte, () => {
    if (!chip.inReset) {
      if (chip.commandNmiDelayInstructions === 0) {
        requestCommandNmi(chip);
      } else {
        chip.pendingCommandNmiDelayInstructions = chip.commandNmiDelayInstructions;
      }
    }
  });
}

/**
 * Drain sound-to-main reply bytes, equivalent to repeated `$FC0001` reads until
 * the queue is empty. Returns FIFO-ordered bytes.
 */
export function drainReplyEvents(chip: SoundChip): u8[] {
  const out: u8[] = chip.replyQueue.map((b) => as_u8(b));
  chip.replyQueue.length = 0;
  // Pending bit reset: model repeated `$FC0001` reads, each with ack.
  if (chip.soundToMain.pending && chip.pendingMainReplyAckCycle === undefined) {
    mailboxRead(chip.soundToMain);
  }
  return out;
}

/** Drain ordered YM2151/POKEY register writes captured since the last call.
 * This is diagnostics-only; it does not affect chip state or gameplay. */
export function drainChipWriteEvents(chip: SoundChip): ChipWriteEvent[] {
  const out = chip.chipWriteEvents.slice();
  chip.chipWriteEvents.length = 0;
  return out;
}

/** Drain diagnostic command-latch reads captured since the last call. */
export function drainSoundCommandReadEvents(chip: SoundChip): SoundCommandReadEvent[] {
  const out = chip.commandReadEvents.slice();
  chip.commandReadEvents.length = 0;
  return out;
}

/** Sets frame context for subsequent diagnostic write events. */
export function setSoundFrameContext(
  chip: SoundChip,
  frame: number | undefined,
  frameStartCycle = chip.cpu.cycles,
): void {
  chip.diagnosticFrame = frame;
  chip.diagnosticFrameStartCycle = frame === undefined ? undefined : frameStartCycle;
}

/** Drain accumulated YM2151 sample stream (interleaved L/R Float32-style numbers
 * at YM2151 native sample rate). Caller resamples to the output context rate. */
export function drainYm2151Samples(chip: SoundChip): number[] {
  if (chip.ymAudioScheduler === "mame-stream") {
    const targetSample = ymStreamTargetSample(chip, chip.cpu.cycles);
    const needed = (targetSample + 1) - chip.ymStreamGeneratedSamples;
    if (needed > 0) {
      ym2151GenerateSamples(chip.ym2151, needed);
      chip.ymStreamGeneratedSamples += needed;
    }
  }
  return ym2151DrainSamples(chip.ym2151);
}

export function setYm2151DiagnosticChannelSamples(chip: SoundChip, enabled: boolean): void {
  ym2151SetDiagnosticChannelSamples(chip.ym2151, enabled);
}

export function drainYm2151DiagnosticChannelSamples(chip: SoundChip): number[][] | undefined {
  return ym2151DrainDiagnosticChannelSamples(chip.ym2151);
}

export function setYm2151DiagnosticChannelStateTrace(
  chip: SoundChip,
  channel: number,
  startNativeSample: number,
  endNativeSample: number,
): void {
  ym2151SetDiagnosticChannelStateTrace(chip.ym2151, channel, startNativeSample, endNativeSample);
}

export function drainYm2151DiagnosticChannelStateTrace(
  chip: SoundChip,
): YM2151ChannelStateSnapshot[] | undefined {
  return ym2151DrainDiagnosticChannelStateTrace(chip.ym2151);
}

/** Drain accumulated POKEY mono samples @ POKEY_NATIVE_SAMPLE_RATE (~63.9 kHz). */
export function drainPokeySamples(chip: SoundChip): number[] {
  return pokeyDrainSamples(chip.pokey);
}

export function getPokeySampleRate(chip: SoundChip): number {
  return pokeySampleRate(chip.pokey);
}

export function setPokeySampleCycles(chip: SoundChip, cycles: number): void {
  pokeySetSampleCycles(chip.pokey, cycles);
}

export function setPokeySampleAfterClock(chip: SoundChip, enabled: boolean): void {
  pokeySetSampleAfterClock(chip.pokey, enabled);
}

export function setPokeyDiagnosticChannelSamples(chip: SoundChip, enabled: boolean): void {
  pokeySetDiagnosticChannelSamples(chip.pokey, enabled);
}

export function drainPokeyDiagnosticChannelSamples(chip: SoundChip): number[][] | undefined {
  return pokeyDrainDiagnosticChannelSamples(chip.pokey);
}

export function setPokeyDiagnosticRawTransitions(chip: SoundChip, enabled: boolean): void {
  pokeySetDiagnosticRawTransitions(chip.pokey, enabled);
}

export function drainPokeyDiagnosticRawTransitions(chip: SoundChip): PokeyRawTransition[] | undefined {
  return pokeyDrainDiagnosticRawTransitions(chip.pokey);
}

export function setPokeyDiagnosticWrites(chip: SoundChip, enabled: boolean): void {
  pokeySetDiagnosticWrites(chip.pokey, enabled);
}

export function drainPokeyDiagnosticWrites(chip: SoundChip): PokeyWriteSnapshot[] | undefined {
  return pokeyDrainDiagnosticWrites(chip.pokey);
}

export { YM2151_MAME_STREAM_SAMPLE_RATE, YM2151_NATIVE_SAMPLE_RATE, POKEY_NATIVE_SAMPLE_RATE };
export type { PokeyRawTransition, PokeyWriteSnapshot };

/** Snapshot register shadow for oracle diff (Phase 8). Returns shallow
 * Uint8Array references — callers must not mutate them. */
export function getRegisterShadow(chip: SoundChip): {
  audioRam: Uint8Array;
  ym2151Regs: Uint8Array;
  pokeyWriteRegs: Uint8Array;
} {
  return {
    audioRam: chip.mmu.ram,
    ym2151Regs: chip.ym2151.regs,
    pokeyWriteRegs: chip.pokey.writeRegs,
  };
}

/**
 * Cmd-tape replay API.
 *
 * Replay injects commands recorded from MAME so the TS sound chip receives the
 * same input bytes on the same frames, independent of gameplay wiring.
 *
 * Formato tape:
 *   { cmds: [{frame: N, byte: B}, ...] }
 *
 * `loadCmdTape` groups commands by frame, preserves sub-frame offsets when the
 * tape has timestamps, and derives frame cycle budgets from MAME timestamps.
 */
export interface CmdTape {
  readonly coinFrame?: number;
  readonly coinPulseFrames?: number;
  cmds: ReadonlyArray<{
    readonly frame: number;
    readonly byte: number;
    readonly secs?: number;
    readonly attos?: string;
    readonly cycleInFrame?: number;
    readonly soundPc?: number | string;
    readonly soundA?: number | string;
    readonly soundX?: number | string;
    readonly soundY?: number | string;
    readonly soundP?: number | string;
    readonly soundSp?: number | string;
    readonly instPc?: number | string;
    readonly instOpcode?: number | string;
    readonly instDeltaCycles?: number | string;
    readonly nextChronoInstPc?: number | string;
    readonly nextChronoInstOpcode?: number | string;
    readonly nextChronoInstDeltaCycles?: number | string;
  }>;
}

export interface LoadedCmdTapeCommand {
  readonly frame: number;
  readonly byte: number;
  readonly cycleInFrame: number | undefined;
  readonly sourceIndex: number;
  readonly soundPc: number | undefined;
  readonly soundA: number | undefined;
  readonly soundX: number | undefined;
  readonly soundY: number | undefined;
  readonly soundP: number | undefined;
  readonly soundSp: number | undefined;
  readonly instPc: number | undefined;
  readonly instOpcode: number | undefined;
  readonly instDeltaCycles: number | undefined;
  readonly nextChronoInstPc: number | undefined;
  readonly nextChronoInstOpcode: number | undefined;
  readonly nextChronoInstDeltaCycles: number | undefined;
}

export interface LoadedCmdTape {
  byFrame: Map<number, number[]>;
  byFrameCycle: Map<number, LoadedCmdTapeCommand[]>;
  frameCycleBudgets: Map<number, number>;
  totalFrames: number;
  cmdCount: number;
  firstCommandFrame: number | undefined;
  resetFrame: number | undefined;
  cyclePrecise: boolean;
  coinFrame: number | undefined;
  coinPulseFrames: number | undefined;
}

export type CmdTapeCommandTiming = "cycleInFrame" | "secsAttos";

export interface LoadCmdTapeOptions {
  /** Controls which command timestamp wins when a tape has both MAME wall-clock
   * `secs/attos` and diagnostic `cycleInFrame`. The default preserves the
   * historical cycle-precise replay behavior. */
  readonly commandTiming?: CmdTapeCommandTiming;
  /** Diagnostics-only smoothing for replay frame-cycle budgets derived from
   * command frame origins. A positive value is the median half-window in frames. */
  readonly frameBudgetSmoothingWindow?: number;
}

interface CommandChipIoStoreContext {
  readonly pc: number;
  readonly opcode: number;
  readonly address: number;
  readonly writeCycleOffset: number;
  readonly stepCycles: number;
}

function attosecondsToSoundCycles(secs: number, attos: string): bigint {
  const secPart = BigInt(Math.trunc(secs));
  const attosPart = BigInt(attos);
  return ((secPart * 1_000_000_000_000_000_000n) + attosPart) *
    BigInt(SOUND_CMD_TAPE_CPU_HZ_NUMERATOR) /
    (BigInt(SOUND_CMD_TAPE_CPU_HZ_DENOMINATOR) * 1_000_000_000_000_000_000n);
}

export function cmdTapeAbsoluteCycle(cmd: {
  readonly secs?: number;
  readonly attos?: string;
}): bigint | undefined {
  if (cmd.secs === undefined || cmd.attos === undefined) return undefined;
  return attosecondsToSoundCycles(cmd.secs, cmd.attos);
}

export function cmdTapeFrameOriginAbsoluteCycle(cmd: {
  readonly secs?: number;
  readonly attos?: string;
  readonly cycleInFrame?: number;
}): bigint | undefined {
  const absoluteCycle = cmdTapeAbsoluteCycle(cmd);
  if (absoluteCycle === undefined) return undefined;
  if (cmd.cycleInFrame === undefined) return absoluteCycle;
  return absoluteCycle - BigInt(Math.trunc(cmd.cycleInFrame));
}

function cmdTapeReplayFrameOriginAbsoluteCycle(
  cmd: {
    readonly secs?: number;
    readonly attos?: string;
    readonly cycleInFrame?: number;
  },
  commandTiming: CmdTapeCommandTiming,
): bigint | undefined {
  return commandTiming === "secsAttos"
    ? cmdTapeAbsoluteCycle(cmd)
    : cmdTapeFrameOriginAbsoluteCycle(cmd);
}

export function cmdTapeTimestampVideoCycleInFrame(cmd: {
  readonly frame: number;
  readonly secs?: number;
  readonly attos?: string;
}): number | undefined {
  const absoluteCycle = cmdTapeAbsoluteCycle(cmd);
  if (absoluteCycle === undefined) return undefined;
  const frameStart = BigInt(Math.max(0, Math.trunc(cmd.frame))) * BigInt(SOUND_CYCLES_PER_FRAME);
  const rel = absoluteCycle - frameStart;
  if (rel < 0n || rel > BigInt(SOUND_CYCLES_PER_FRAME)) return undefined;
  return Number(rel);
}

function timingOriginAbsoluteCycle(origin: {
  readonly secs?: number;
  readonly attos?: string;
  readonly absoluteCycle?: bigint;
}): bigint | undefined {
  return origin.absoluteCycle ?? cmdTapeAbsoluteCycle(origin);
}

function clampCycleInFrame(cycleInFrame: number): number {
  return Math.max(0, Math.min(SOUND_CYCLES_PER_FRAME, Math.trunc(cycleInFrame)));
}

export function cmdTapeCycleInFrame(cmd: {
  readonly frame: number;
  readonly secs?: number;
  readonly attos?: string;
  readonly cycleInFrame?: number;
}): number | undefined {
  if (cmd.cycleInFrame !== undefined) return clampCycleInFrame(cmd.cycleInFrame);
  const absoluteCycle = cmdTapeAbsoluteCycle(cmd);
  if (absoluteCycle === undefined) {
    return undefined;
  }
  const videoCycle = cmdTapeTimestampVideoCycleInFrame(cmd);
  if (videoCycle !== undefined) return videoCycle;
  const frameStart = BigInt(Math.max(0, Math.trunc(cmd.frame))) * BigInt(SOUND_CYCLES_PER_FRAME);
  return absoluteCycle < frameStart ? 0 : SOUND_CYCLES_PER_FRAME;
}

export function cmdTapeReplayCycleInFrame(
  cmd: {
    readonly frame: number;
    readonly secs?: number;
    readonly attos?: string;
    readonly cycleInFrame?: number;
  },
  origin: {
    readonly frame: number;
    readonly secs?: number;
    readonly attos?: string;
    readonly absoluteCycle?: bigint;
  } | undefined,
  commandTiming: CmdTapeCommandTiming = "cycleInFrame",
): number | undefined {
  if (commandTiming === "cycleInFrame" && cmd.cycleInFrame !== undefined) {
    return clampCycleInFrame(cmd.cycleInFrame);
  }
  const absoluteCycle = cmdTapeAbsoluteCycle(cmd);
  if (origin === undefined) {
    if (absoluteCycle === undefined) {
      return cmd.cycleInFrame === undefined ? undefined : clampCycleInFrame(cmd.cycleInFrame);
    }
    const videoCycle = cmdTapeTimestampVideoCycleInFrame(cmd);
    if (videoCycle !== undefined) return videoCycle;
    const frameStart = BigInt(Math.max(0, Math.trunc(cmd.frame))) * BigInt(SOUND_CYCLES_PER_FRAME);
    return absoluteCycle < frameStart ? 0 : SOUND_CYCLES_PER_FRAME;
  }
  const originCycle = timingOriginAbsoluteCycle(origin);
  if (absoluteCycle === undefined || originCycle === undefined) {
    return cmd.cycleInFrame === undefined ? undefined : clampCycleInFrame(cmd.cycleInFrame);
  }
  const frameStart = BigInt(Math.trunc(cmd.frame - origin.frame)) * BigInt(SOUND_CYCLES_PER_FRAME);
  const rel = absoluteCycle - originCycle - frameStart;
  if (rel <= 0n) return 0;
  if (rel >= BigInt(SOUND_CYCLES_PER_FRAME)) return SOUND_CYCLES_PER_FRAME;
  return Number(rel);
}

export function cmdTapeReplaySignedCycleInFrame(
  cmd: {
    readonly frame: number;
    readonly secs?: number;
    readonly attos?: string;
    readonly cycleInFrame?: number;
  },
  origin: {
    readonly frame: number;
    readonly secs?: number;
    readonly attos?: string;
    readonly absoluteCycle?: bigint;
  } | undefined,
  commandTiming: CmdTapeCommandTiming = "cycleInFrame",
): number | undefined {
  if (commandTiming === "cycleInFrame" && cmd.cycleInFrame !== undefined) {
    return Math.trunc(cmd.cycleInFrame);
  }
  const absoluteCycle = cmdTapeAbsoluteCycle(cmd);
  if (absoluteCycle === undefined) {
    return cmd.cycleInFrame === undefined ? undefined : Math.trunc(cmd.cycleInFrame);
  }
  if (origin === undefined) {
    const frameStart = BigInt(Math.trunc(cmd.frame)) * BigInt(SOUND_CYCLES_PER_FRAME);
    return Number(absoluteCycle - frameStart);
  }
  const originCycle = timingOriginAbsoluteCycle(origin);
  if (originCycle === undefined) {
    return cmd.cycleInFrame === undefined ? undefined : Math.trunc(cmd.cycleInFrame);
  }
  const frameStart = BigInt(Math.trunc(cmd.frame - origin.frame)) * BigInt(SOUND_CYCLES_PER_FRAME);
  return Number(absoluteCycle - originCycle - frameStart);
}

function parseCmdTapeDiagnosticByte(value: number | string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = typeof value === "number"
    ? value
    : Number.parseInt(value, value.startsWith("0x") ? 16 : 10);
  return Number.isFinite(parsed) ? parsed & 0xff : undefined;
}

function parseCmdTapeDiagnosticWord(value: number | string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = typeof value === "number"
    ? value
    : Number.parseInt(value, value.startsWith("0x") ? 16 : 10);
  return Number.isFinite(parsed) ? parsed & 0xffff : undefined;
}

function parseCmdTapeDiagnosticSigned(value: number | string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = typeof value === "number"
    ? value
    : Number.parseInt(value, value.startsWith("0x") ? 16 : 10);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : undefined;
}

function medianBigInt(values: readonly bigint[]): bigint | undefined {
  if (values.length === 0) return undefined;
  const sorted = values.slice().sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
  return sorted[Math.floor(sorted.length / 2)];
}

function smoothedFrameBudgetOrigins(
  rawByFrame: Map<number, readonly bigint[]>,
  smoothingWindow: number,
): Array<{ frame: number; absoluteCycle: bigint }> | undefined {
  const frames = [...rawByFrame.keys()].sort((a, b) => a - b);
  if (frames.length === 0 || smoothingWindow <= 0) return undefined;
  const rawOrigins = new Map<number, bigint>();
  for (const frame of frames) {
    const median = medianBigInt(rawByFrame.get(frame) ?? []);
    if (median !== undefined) rawOrigins.set(frame, median);
  }
  const originFrames = [...rawOrigins.keys()].sort((a, b) => a - b);
  const firstFrame = originFrames[0];
  if (firstFrame === undefined) return undefined;
  const firstOrigin = rawOrigins.get(firstFrame);
  if (firstOrigin === undefined) return undefined;
  return originFrames.map((frame) => {
    const residuals: bigint[] = [];
    for (let near = frame - smoothingWindow; near <= frame + smoothingWindow; near++) {
      const origin = rawOrigins.get(near);
      if (origin === undefined) continue;
      residuals.push(origin - (firstOrigin + BigInt(near - firstFrame) * BigInt(SOUND_CYCLES_PER_FRAME)));
    }
    const residual = medianBigInt(residuals) ?? 0n;
    return {
      frame,
      absoluteCycle: firstOrigin + BigInt(frame - firstFrame) * BigInt(SOUND_CYCLES_PER_FRAME) + residual,
    };
  });
}

export function loadCmdTape(tape: CmdTape, options: LoadCmdTapeOptions = {}): LoadedCmdTape {
  const commandTiming = options.commandTiming ?? "cycleInFrame";
  const frameBudgetSmoothingWindow = Math.max(0, Math.trunc(options.frameBudgetSmoothingWindow ?? 0));
  const byFrame = new Map<number, number[]>();
  const byFrameCycle = new Map<number, LoadedCmdTapeCommand[]>();
  const frameCycleBudgets = new Map<number, number>();
  let maxFrame = 0;
  let firstCommandFrame: number | undefined;
  let cyclePrecise = false;
  const coinFrame = Number.isFinite(tape.coinFrame) ? Math.trunc(tape.coinFrame!) : undefined;
  const coinPulseFrames = coinFrame === undefined
    ? undefined
    : Math.max(1, Math.trunc(tape.coinPulseFrames ?? DEFAULT_SOUND_INPUT_PULSE_FRAMES));
  const frameOrigins = new Map<number, { frame: number; secs?: number; attos?: string; absoluteCycle?: bigint }>();
  const frameBudgetOriginSamples = new Map<number, bigint[]>();
  for (const c of tape.cmds) {
    if (c.secs === undefined || c.attos === undefined) continue;
    const absoluteCycle = cmdTapeReplayFrameOriginAbsoluteCycle(c, commandTiming);
    if (absoluteCycle !== undefined) {
      const samples = frameBudgetOriginSamples.get(c.frame);
      if (samples === undefined) frameBudgetOriginSamples.set(c.frame, [absoluteCycle]);
      else samples.push(absoluteCycle);
    }
    if (!frameOrigins.has(c.frame)) {
      frameOrigins.set(c.frame, {
        frame: c.frame,
        secs: c.secs,
        attos: c.attos,
        ...(absoluteCycle === undefined ? {} : { absoluteCycle }),
      });
    }
  }
  const smoothedOrigins = commandTiming === "cycleInFrame"
    ? smoothedFrameBudgetOrigins(frameBudgetOriginSamples, frameBudgetSmoothingWindow)
    : undefined;
  const origins = (smoothedOrigins ?? [...frameOrigins.values()]
    .filter((o): o is { frame: number; secs: number; attos: string; absoluteCycle: bigint } =>
      o.secs !== undefined && o.attos !== undefined && o.absoluteCycle !== undefined))
    .sort((a, b) => a.frame - b.frame);
  for (let i = 0; i + 1 < origins.length; i++) {
    const current = origins[i]!;
    const next = origins[i + 1]!;
    const frameDelta = next.frame - current.frame;
    const cycleDeltaBig = next.absoluteCycle - current.absoluteCycle;
    if (frameDelta <= 0 || cycleDeltaBig <= 0n) continue;
    const cycleDelta = Number(cycleDeltaBig);
    const base = Math.floor(cycleDelta / frameDelta);
    const remainder = cycleDelta - base * frameDelta;
    for (let offset = 0; offset < frameDelta; offset++) {
      frameCycleBudgets.set(current.frame + offset, base + (offset < remainder ? 1 : 0));
    }
  }
  for (let i = 0; i < tape.cmds.length; i++) {
    const c = tape.cmds[i]!;
    let bucket = byFrame.get(c.frame);
    if (bucket === undefined) {
      bucket = [];
      byFrame.set(c.frame, bucket);
    }
    const byte = c.byte & 0xff;
    bucket.push(byte);
    const cycleInFrame = cmdTapeReplayCycleInFrame(c, frameOrigins.get(c.frame), commandTiming);
    let cycleBucket = byFrameCycle.get(c.frame);
    if (cycleBucket === undefined) {
      cycleBucket = [];
      byFrameCycle.set(c.frame, cycleBucket);
    }
    cycleBucket.push({
      frame: c.frame,
      byte,
      cycleInFrame,
      sourceIndex: i,
      soundPc: parseCmdTapeDiagnosticWord(c.soundPc),
      soundA: parseCmdTapeDiagnosticByte(c.soundA),
      soundX: parseCmdTapeDiagnosticByte(c.soundX),
      soundY: parseCmdTapeDiagnosticByte(c.soundY),
      soundP: parseCmdTapeDiagnosticByte(c.soundP),
      soundSp: parseCmdTapeDiagnosticByte(c.soundSp),
      instPc: parseCmdTapeDiagnosticWord(c.instPc),
      instOpcode: parseCmdTapeDiagnosticByte(c.instOpcode),
      instDeltaCycles: parseCmdTapeDiagnosticSigned(c.instDeltaCycles),
      nextChronoInstPc: parseCmdTapeDiagnosticWord(c.nextChronoInstPc),
      nextChronoInstOpcode: parseCmdTapeDiagnosticByte(c.nextChronoInstOpcode),
      nextChronoInstDeltaCycles: parseCmdTapeDiagnosticSigned(c.nextChronoInstDeltaCycles),
    });
    if (cycleInFrame !== undefined) cyclePrecise = true;
    if (c.frame > maxFrame) maxFrame = c.frame;
    if (firstCommandFrame === undefined || c.frame < firstCommandFrame) firstCommandFrame = c.frame;
  }
  for (const bucket of byFrameCycle.values()) {
    bucket.sort((a, b) => {
      const ac = a.cycleInFrame ?? 0;
      const bc = b.cycleInFrame ?? 0;
      return ac === bc ? a.sourceIndex - b.sourceIndex : ac - bc;
    });
  }
  return {
    byFrame,
    byFrameCycle,
    frameCycleBudgets,
    totalFrames: maxFrame + 1,
    cmdCount: tape.cmds.length,
    firstCommandFrame,
    resetFrame: firstCommandFrame,
    cyclePrecise,
    coinFrame,
    coinPulseFrames,
  };
}

export function cmdTapeSoundStatusBaseForFrame(
  tape: Pick<LoadedCmdTape, "coinFrame" | "coinPulseFrames">,
  frame: number,
  idleStatusBase: u8 = as_u8(0x87),
): u8 | undefined {
  if (tape.coinFrame === undefined) return undefined;
  const pulseFrames = tape.coinPulseFrames ?? DEFAULT_SOUND_INPUT_PULSE_FRAMES;
  // MAME's capture scripts set the input for `frame_count + 1` in frame_done,
  // so a Coin 1 pulse at frame N is visible to the sound CPU in frame N - 1.
  const active = frame >= tape.coinFrame - 1 && frame < tape.coinFrame + pulseFrames - 1;
  return as_u8(active ? ((idleStatusBase as number) & ~0x01) : (idleStatusBase as number));
}

export function cmdTapeFrameCycles(tape: LoadedCmdTape, frame: number): number {
  return tape.frameCycleBudgets.get(frame) ?? SOUND_CYCLES_PER_FRAME;
}

export interface CommandSubmitStepContext {
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

export interface CommandSubmitPreAdvanceContext {
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

/**
 * Advance the sound chip for one replay frame, injecting recorded commands.
 * Cycle-precise tapes provide both frame cycle budget and command offsets;
 * legacy tapes fall back to a fixed frame budget and evenly spread commands.
 */
export interface TickFrameWithTapeOptions {
  readonly autoReleaseReset?: boolean;
  readonly drainReplies?: boolean;
  /** Diagnostics-only: delay the first 6502 cycle after reset release.
   * Default 0 keeps the normal replay path unchanged. */
  readonly resetReleaseDelayCycles?: number;
  /** Diagnostics-only: on the reset-release frame, keep the sound CPU in reset
   * until the first scheduled command is submitted, then place the first opcode
   * fetch this many cycles after that command. This models the Atari System 1
   * `$FE0001` command -> `$860001` release -> 6502 reset-vector cadence. */
  readonly resetFirstFetchDelayAfterCommandCycles?: number;
  readonly onCommandSubmit?: (event: {
    readonly sourceIndex: number;
    readonly frame: number;
    readonly byte: number;
    readonly cycle: number;
    readonly cycleInFrame: number;
    readonly actualCycle: number;
    readonly actualCycleInFrame: number;
    readonly expectedSoundPc?: number;
    readonly expectedSoundA?: number;
    readonly expectedSoundX?: number;
    readonly expectedSoundY?: number;
    readonly expectedSoundP?: number;
    readonly expectedSoundSp?: number;
    readonly expectedInstPc?: number;
    readonly expectedInstOpcode?: number;
    readonly expectedInstDeltaCycles?: number;
    readonly expectedNextChronoInstPc?: number;
    readonly expectedNextChronoInstOpcode?: number;
    readonly expectedNextChronoInstDeltaCycles?: number;
    readonly actualSoundPc?: number;
    readonly actualSoundOpcode?: number;
    readonly actualSoundA?: number;
    readonly actualSoundX?: number;
    readonly actualSoundY?: number;
    readonly actualSoundP?: number;
    readonly actualSoundSp?: number;
    readonly commandNmiDelayInstructions: number;
    readonly preAdvance?: CommandSubmitPreAdvanceContext;
    readonly lastStep?: CommandSubmitStepContext;
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
    readonly currentChipIoStore?: CommandChipIoStoreContext;
  }) => void;
  /** Diagnostics-only frame scheduler tap. Reports the external tape frame
   * window and the 6502 local-time position before/after replay advances the
   * frame. It does not affect CPU/chip state. */
  readonly onFrameAdvance?: (event: {
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
  }) => void;
  /** Command-NMI sample point. When a scheduled
   * command target lands inside the just-completed 6502 instruction at or after
   * this cycle offset, the NMI assertion is delayed by one instruction
   * boundary. Default 2 matches the current MAME-derived replay evidence; use
   * Infinity in diagnostics to restore the old immediate-edge model. */
  readonly commandNmiSampleCycle?: number;
  /** Diagnostics-only command-NMI boundary experiment. When a scheduled command
   * lands exactly on the cycle where the last whole-CPU instruction ended,
   * delay NMI assertion by this many instruction boundaries. Default 0 keeps
   * the current replay model unchanged. */
  readonly commandNmiBoundaryDelayInstructions?: number;
  /** Diagnostics-only command-NMI delay override. When provided, this replaces
   * the chip-level command delay floor for the selected scheduled command; the
   * sampled in-instruction delay may still raise the effective delay. */
  readonly commandNmiDelayOverride?: (event: {
    readonly sourceIndex: number;
    readonly frame: number;
    readonly byte: number;
    readonly cycle: number;
    readonly cycleInFrame: number;
    readonly preAdvance?: CommandSubmitPreAdvanceContext;
    readonly lastStep?: CommandSubmitStepContext;
    readonly currentChipIoStore?: CommandChipIoStoreContext;
    readonly preemptedChipWrite?: ReplayCommandPreemption;
  }) => number | undefined;
  /** Diagnostics-only command-boundary preemption experiment. When non-zero,
   * replay may hold the whole-instruction TS CPU before an imminent YM/POKEY
   * store if the scheduled command target lands before the estimated store bus
   * cycle or shortly after it. Default 0 preserves normal replay behavior. */
  readonly commandPreemptChipWriteLookaheadCycles?: number;
  /** Diagnostics-only stricter preemption experiment. When true, preempts only
   * when the scheduled command target is before or exactly on the estimated
   * chip I/O bus-write cycle, avoiding after-write overcorrection. */
  readonly commandPreemptChipWriteBeforeOnly?: boolean;
  /** Diagnostics-only preemption PC allowlist. When provided, the boundary
   * chip-write preemption experiment only applies to these opcode PCs. */
  readonly commandPreemptChipWritePcs?: ReadonlySet<number>;
  /** Diagnostics-only refinement for after-write command edges. When true and
   * the command target is after the current chip-I/O bus write, replay executes
   * that one CPU instruction first, so the chip write is visible before command
   * NMI preempts the following instruction. */
  readonly commandPreemptChipWriteCompleteBeforeTarget?: boolean;
  /** Diagnostics-only command-boundary IRQ preemption experiment. When set,
   * replay may hold the CPU before servicing a pending IRQ if the next command
   * boundary is within this many cycles. Devices still advance to the boundary.
   * Default undefined preserves normal replay behavior. */
  readonly commandPreemptPendingIrqLookaheadCycles?: number;
  /** Diagnostics-only command delivery offset applied to cmd-tape targets.
   * Default 0 preserves using the captured main CPU write timestamp directly. */
  readonly commandCycleOffsetCycles?: number;
  /** Diagnostics-only scheduler experiment. When true, replay advances chip
   * devices to an external command timestamp but does not execute sound CPU
   * instructions before asserting the command/NMI line. This models MAME's
   * main-CPU write arriving before the sound CPU local-time catch-up. */
  readonly commandSubmitBeforeCpuCatchup?: boolean;
}

const tapeReplayScheduleCycles = new WeakMap<SoundChip, number>();
const tapeReplayBoundaryPreemptions = new WeakMap<SoundChip, ReplayCommandPreemption>();

function normalizeResetReleaseDelay(cycles: number | undefined): number {
  return normalizeDiagnosticCycleDelay(cycles);
}

function normalizeDiagnosticSignedCycleOffset(cycles: number | undefined): number {
  if (cycles === undefined || !Number.isFinite(cycles)) return 0;
  return Math.trunc(cycles);
}

function normalizeDiagnosticRegCycleOffsets(
  offsets: ReadonlyMap<number, number> | undefined,
): ReadonlyMap<number, number> {
  const normalized = new Map<number, number>();
  if (offsets === undefined) return normalized;
  for (const [regRaw, cyclesRaw] of offsets.entries()) {
    if (!Number.isFinite(regRaw) || !Number.isFinite(cyclesRaw)) continue;
    const cycles = normalizeDiagnosticSignedCycleOffset(cyclesRaw);
    if (cycles !== 0) normalized.set(Math.trunc(regRaw) & 0xff, cycles);
  }
  return normalized;
}

function normalizeYmWriteEventCycleOffsetMatches(
  matches: readonly YmWriteEventCycleOffsetMatch[] | undefined,
): readonly YmWriteEventCycleOffsetMatch[] {
  if (matches === undefined) return [];
  return matches.flatMap((match) => {
    const deltaCycles = normalizeDiagnosticSignedCycleOffset(match.deltaCycles);
    if (deltaCycles === 0) return [];
    return [{
      ...(match.frame === undefined ? {} : { frame: Math.trunc(match.frame) }),
      ...(match.pc === undefined ? {} : { pc: Math.trunc(match.pc) & 0xffff }),
      ...(match.reg === undefined ? {} : { reg: Math.trunc(match.reg) & 0xff }),
      ...(match.val === undefined ? {} : { val: Math.trunc(match.val) & 0xff }),
      ...(match.cycleInFrameMin === undefined ? {} : { cycleInFrameMin: Math.trunc(match.cycleInFrameMin) }),
      ...(match.cycleInFrameMax === undefined ? {} : { cycleInFrameMax: Math.trunc(match.cycleInFrameMax) }),
      deltaCycles,
    }];
  });
}

function ymWriteEventCycleOffsetForMatch(
  matches: readonly YmWriteEventCycleOffsetMatch[],
  frame: number | undefined,
  cycleInFrame: number | undefined,
  pc: number,
  reg: number,
  val: number,
): { offset: number; matchIndices: readonly number[] } {
  let offset = 0;
  const matchIndices: number[] = [];
  for (let i = 0; i < matches.length; i++) {
    const match = matches[i]!;
    if (match.frame !== undefined && frame !== match.frame) continue;
    if (match.pc !== undefined && (pc & 0xffff) !== match.pc) continue;
    if (match.reg !== undefined && (reg & 0xff) !== match.reg) continue;
    if (match.val !== undefined && (val & 0xff) !== match.val) continue;
    if (match.cycleInFrameMin !== undefined &&
      (cycleInFrame === undefined || cycleInFrame < match.cycleInFrameMin)) {
      continue;
    }
    if (match.cycleInFrameMax !== undefined &&
      (cycleInFrame === undefined || cycleInFrame > match.cycleInFrameMax)) {
      continue;
    }
    offset += match.deltaCycles;
    matchIndices.push(i);
  }
  return { offset, matchIndices };
}

function normalizeYmWriteEventSampleOffsetMatches(
  matches: readonly YmWriteEventSampleOffsetMatch[] | undefined,
): readonly YmWriteEventSampleOffsetMatch[] {
  if (matches === undefined) return [];
  return matches.flatMap((match) => {
    if (!Number.isFinite(match.deltaSamples)) return [];
    const deltaSamples = Math.trunc(match.deltaSamples);
    if (deltaSamples === 0) return [];
    return [{
      ...(match.frame === undefined ? {} : { frame: Math.trunc(match.frame) }),
      ...(match.pc === undefined ? {} : { pc: Math.trunc(match.pc) & 0xffff }),
      ...(match.reg === undefined ? {} : { reg: Math.trunc(match.reg) & 0xff }),
      ...(match.val === undefined ? {} : { val: Math.trunc(match.val) & 0xff }),
      deltaSamples,
    }];
  });
}

function ymWriteEventSampleOffsetForMatch(
  matches: readonly YmWriteEventSampleOffsetMatch[],
  frame: number | undefined,
  pc: number,
  reg: number,
  val: number,
): number {
  let offset = 0;
  for (const match of matches) {
    if (match.frame !== undefined && frame !== match.frame) continue;
    if (match.pc !== undefined && (pc & 0xffff) !== match.pc) continue;
    if (match.reg !== undefined && (reg & 0xff) !== match.reg) continue;
    if (match.val !== undefined && (val & 0xff) !== match.val) continue;
    offset += match.deltaSamples;
  }
  return offset;
}

function ymStreamTargetSample(chip: SoundChip, cycle: number): number {
  const safeCycle = Math.max(0, Math.trunc(cycle));
  if (chip.ymStreamCycleOffsetCycles === undefined) {
    return chip.ymStreamSampleOffset +
      Math.floor(safeCycle * chip.ymStreamSampleRate / SOUND_CMD_TAPE_CPU_HZ);
  }
  const cycleWithOffset = chip.ymStreamCycleOffsetCycles + BigInt(safeCycle);
  const cycleNumber = Number(cycleWithOffset);
  if (!Number.isSafeInteger(cycleNumber)) {
    throw new Error(`YM stream target cycle too large: ${cycleWithOffset.toString()}`);
  }
  return Math.floor(cycleNumber * chip.ymStreamSampleRate / SOUND_CMD_TAPE_CPU_HZ);
}

export function cmdTapeCommandCycleInFrame(
  cmd: Pick<LoadedCmdTapeCommand, "cycleInFrame">,
  index: number,
  commandCount: number,
  frameCycles: number,
): number {
  const target = cmd.cycleInFrame ??
    (commandCount === 1 ? 0 : Math.floor((frameCycles * index) / commandCount));
  return Math.max(0, Math.min(frameCycles, target));
}

function scheduledCommandTargetCycle(
  frameStart: number,
  cmd: LoadedCmdTapeCommand,
  index: number,
  commandCount: number,
  frameCycles: number,
  opts: TickFrameWithTapeOptions,
): number {
  const base = frameStart + cmdTapeCommandCycleInFrame(cmd, index, commandCount, frameCycles);
  const offset = normalizeDiagnosticSignedCycleOffset(opts.commandCycleOffsetCycles);
  return Math.max(frameStart, Math.min(frameStart + frameCycles, base + offset));
}

function sampledCommandNmiDelay(
  chip: SoundChip,
  targetCycle: number,
  sampleCycle: number | undefined,
  boundaryDelayInstructions: number | undefined,
): number {
  const boundaryDelay = normalizeDiagnosticCycleDelay(boundaryDelayInstructions);
  if (boundaryDelay > 0 && chip.cpu.cycles === targetCycle && chip.lastStepEndCycle === targetCycle) {
    return boundaryDelay;
  }
  const effectiveSampleCycle = sampleCycle ?? DEFAULT_COMMAND_NMI_SAMPLE_CYCLE;
  if (!Number.isFinite(effectiveSampleCycle)) return 0;
  const start = chip.lastStepStartCycle;
  const end = chip.lastStepEndCycle;
  if (start === undefined || end === undefined || chip.cpu.cycles <= targetCycle) return 0;
  if (targetCycle < start || targetCycle >= end) return 0;
  const sample = Math.max(0, Math.trunc(effectiveSampleCycle));
  const offset = targetCycle - start;
  return offset >= sample ? 1 : 0;
}

function commandSubmitStepContext(
  chip: SoundChip,
  frameStart: number,
  targetCycle: number,
): CommandSubmitStepContext | undefined {
  const start = chip.lastStepStartCycle;
  const end = chip.lastStepEndCycle;
  if (start === undefined || end === undefined) return undefined;
  const pc = chip.cpu.lastOpcodePc;
  const opcode = opcodeAtPc(chip, pc);
  const nextPc = chip.cpu.rf.pc as number;
  const nextOpcode = opcodeAtPc(chip, nextPc);
  return {
    startCycle: start,
    endCycle: end,
    startCycleInFrame: start - frameStart,
    endCycleInFrame: end - frameStart,
    targetOffset: targetCycle - start,
    actualEndDelta: chip.cpu.cycles - targetCycle,
    ...(pc === undefined ? {} : { pc }),
    ...(opcode === undefined ? {} : { opcode }),
    nextPc,
    ...(nextOpcode === undefined ? {} : { nextOpcode }),
    interruptService: pc === undefined,
  };
}

function commandSubmitPreAdvanceContext(
  chip: SoundChip,
  frameStart: number,
  targetCycle: number,
): CommandSubmitPreAdvanceContext {
  const pc = chip.inReset ? undefined : chip.cpu.rf.pc as number;
  const opcode = opcodeAtPc(chip, pc);
  const currentChipIoStore = chip.inReset ? undefined : currentChipIoStoreInstruction(chip);
  return {
    cpuCycle: chip.cpu.cycles,
    cpuCycleInFrame: chip.cpu.cycles - frameStart,
    deltaToTarget: chip.cpu.cycles - targetCycle,
    ...(pc === undefined ? {} : { pc }),
    ...(opcode === undefined ? {} : { opcode }),
    inReset: chip.inReset,
    ...(currentChipIoStore === undefined
      ? {}
      : {
        currentChipIoStore: {
          pc: currentChipIoStore.pc,
          opcode: currentChipIoStore.opcode,
          address: currentChipIoStore.address,
          writeCycleOffset: currentChipIoStore.writeCycleOffset,
          stepCycles: currentChipIoStore.stepCycles,
        },
      }),
  };
}

function submitScheduledCommandWithDelay(
  chip: SoundChip,
  byte: number,
  commandNmiDelayInstructions: number,
): void {
  const previousDelay = chip.commandNmiDelayInstructions;
  chip.commandNmiDelayInstructions = Math.max(0, Math.trunc(commandNmiDelayInstructions));
  submitCommand(chip, as_u8(byte));
  chip.commandNmiDelayInstructions = previousDelay;
}

interface ReplayCommandPreemption {
  readonly pc: number;
  readonly opcode: number;
  readonly address: number;
  readonly stepStart: number;
  readonly stepEnd: number;
  readonly writeCycle: number;
  readonly targetDeltaFromWrite: number;
  readonly completedInstructionBeforeTarget?: boolean;
}

function emitScheduledCommand(
  chip: SoundChip,
  frame: number,
  frameStart: number,
  cmd: LoadedCmdTapeCommand,
  targetCycle: number,
  opts: TickFrameWithTapeOptions,
  preemption: ReplayCommandPreemption | undefined,
  preAdvance: CommandSubmitPreAdvanceContext,
): void {
  const currentChipIoStore = currentChipIoStoreInstruction(chip);
  const lastStep = commandSubmitStepContext(chip, frameStart, targetCycle);
  const sampledDelayInstructions = sampledCommandNmiDelay(
    chip,
    targetCycle,
    opts.commandNmiSampleCycle,
    opts.commandNmiBoundaryDelayInstructions,
  );
  const overrideDelayInstructions = opts.commandNmiDelayOverride?.({
    sourceIndex: cmd.sourceIndex,
    frame,
    byte: cmd.byte,
    cycle: targetCycle,
    cycleInFrame: targetCycle - frameStart,
    preAdvance,
    ...(lastStep === undefined ? {} : { lastStep }),
    ...(currentChipIoStore === undefined ? {} : { currentChipIoStore }),
    ...(preemption === undefined ? {} : { preemptedChipWrite: preemption }),
  });
  const baseDelayInstructions = overrideDelayInstructions === undefined
    ? chip.commandNmiDelayInstructions
    : normalizeDiagnosticCycleDelay(overrideDelayInstructions);
  const commandNmiDelayInstructions = Math.max(baseDelayInstructions, sampledDelayInstructions);
  const actualSoundPc = chip.inReset ? undefined : chip.cpu.rf.pc as number;
  const actualSoundOpcode = opcodeAtPc(chip, actualSoundPc);
  opts.onCommandSubmit?.({
    sourceIndex: cmd.sourceIndex,
    frame,
    byte: cmd.byte,
    cycle: targetCycle,
    cycleInFrame: targetCycle - frameStart,
    actualCycle: chip.cpu.cycles,
    actualCycleInFrame: chip.cpu.cycles - frameStart,
    ...(cmd.soundPc === undefined ? {} : { expectedSoundPc: cmd.soundPc }),
    ...(cmd.soundA === undefined ? {} : { expectedSoundA: cmd.soundA }),
    ...(cmd.soundX === undefined ? {} : { expectedSoundX: cmd.soundX }),
    ...(cmd.soundY === undefined ? {} : { expectedSoundY: cmd.soundY }),
    ...(cmd.soundP === undefined ? {} : { expectedSoundP: cmd.soundP }),
    ...(cmd.soundSp === undefined ? {} : { expectedSoundSp: cmd.soundSp }),
    ...(cmd.instPc === undefined ? {} : { expectedInstPc: cmd.instPc }),
    ...(cmd.instOpcode === undefined ? {} : { expectedInstOpcode: cmd.instOpcode }),
    ...(cmd.instDeltaCycles === undefined ? {} : { expectedInstDeltaCycles: cmd.instDeltaCycles }),
    ...(cmd.nextChronoInstPc === undefined ? {} : { expectedNextChronoInstPc: cmd.nextChronoInstPc }),
    ...(cmd.nextChronoInstOpcode === undefined ? {} : { expectedNextChronoInstOpcode: cmd.nextChronoInstOpcode }),
    ...(cmd.nextChronoInstDeltaCycles === undefined
      ? {}
      : { expectedNextChronoInstDeltaCycles: cmd.nextChronoInstDeltaCycles }),
    ...(actualSoundPc === undefined ? {} : { actualSoundPc }),
    ...(actualSoundOpcode === undefined ? {} : { actualSoundOpcode }),
    ...(chip.inReset
      ? {}
      : {
        actualSoundA: chip.cpu.rf.a as number,
        actualSoundX: chip.cpu.rf.x as number,
        actualSoundY: chip.cpu.rf.y as number,
        actualSoundP: chip.cpu.rf.p as number,
        actualSoundSp: chip.cpu.rf.sp as number,
      }),
    commandNmiDelayInstructions,
    preAdvance,
    ...(lastStep === undefined ? {} : { lastStep }),
    ...(currentChipIoStore === undefined ? {} : { currentChipIoStore }),
    ...(preemption === undefined
      ? {}
      : {
        preemptedChipWrite: {
          pc: preemption.pc,
          opcode: preemption.opcode,
          address: preemption.address,
          stepStart: preemption.stepStart,
          stepEnd: preemption.stepEnd,
          writeCycle: preemption.writeCycle,
          targetDeltaFromWrite: preemption.targetDeltaFromWrite,
          ...(preemption.completedInstructionBeforeTarget === true
            ? { completedInstructionBeforeTarget: true }
            : {}),
        },
      }),
  });
  submitScheduledCommandWithDelay(chip, cmd.byte, commandNmiDelayInstructions);
}

function commandPreemptLookahead(opts: TickFrameWithTapeOptions): number | undefined {
  if (opts.commandPreemptChipWriteBeforeOnly === true) return 0;
  const value = opts.commandPreemptChipWriteLookaheadCycles;
  if (value === undefined || !Number.isFinite(value)) return undefined;
  const lookahead = Math.trunc(value);
  return lookahead > 0 ? lookahead : undefined;
}

function commandPreemptPendingIrqLookahead(opts: TickFrameWithTapeOptions): number | undefined {
  const value = opts.commandPreemptPendingIrqLookaheadCycles;
  if (value === undefined || !Number.isFinite(value)) return undefined;
  const lookahead = Math.trunc(value);
  return lookahead > 0 ? lookahead : undefined;
}

function preemptBeforeImminentChipWrite(
  chip: SoundChip,
  targetCycle: number,
  lookaheadCycles: number,
  pcAllowlist: ReadonlySet<number> | undefined,
  completeBeforeTarget: boolean,
): ReplayCommandPreemption | undefined {
  if (chip.inReset || chip.cpu.cycles >= targetCycle) return undefined;
  const instruction = currentChipIoStoreInstruction(chip);
  if (instruction === undefined) return undefined;
  if (pcAllowlist !== undefined && !pcAllowlist.has(instruction.pc & 0xffff)) return undefined;
  const stepStart = chip.cpu.cycles;
  const writeCycle = stepStart + instruction.writeCycleOffset;
  if (targetCycle < stepStart || targetCycle > writeCycle + lookaheadCycles) return undefined;
  if (completeBeforeTarget && targetCycle > writeCycle) {
    stepSoundCpuInstruction(chip);
    if (chip.cpu.cycles < targetCycle) {
      tickDevicesWithoutCpu(chip, targetCycle - chip.cpu.cycles);
    }
    return {
      pc: instruction.pc,
      opcode: instruction.opcode,
      address: instruction.address,
      stepStart,
      stepEnd: stepStart + instruction.stepCycles,
      writeCycle,
      targetDeltaFromWrite: targetCycle - writeCycle,
      completedInstructionBeforeTarget: true,
    };
  }
  const preemption: ReplayCommandPreemption = {
    pc: instruction.pc,
    opcode: instruction.opcode,
    address: instruction.address,
    stepStart,
    stepEnd: stepStart + instruction.stepCycles,
    writeCycle,
    targetDeltaFromWrite: targetCycle - writeCycle,
  };
  tickDevicesWithoutCpu(chip, targetCycle - chip.cpu.cycles);
  return preemption;
}

function advanceReplayCpuTo(
  chip: SoundChip,
  targetCycle: number,
  opts: TickFrameWithTapeOptions = {},
): ReplayCommandPreemption | undefined {
  const lookaheadCycles = commandPreemptLookahead(opts);
  const irqLookaheadCycles = commandPreemptPendingIrqLookahead(opts);
  if (lookaheadCycles === undefined && irqLookaheadCycles === undefined) {
    if (chip.cpu.cycles < targetCycle) {
      tickCycles(chip, targetCycle - chip.cpu.cycles);
    }
    return undefined;
  }
  while (chip.cpu.cycles < targetCycle) {
    if (
      irqLookaheadCycles !== undefined &&
      irqWillService(chip) &&
      targetCycle - chip.cpu.cycles <= irqLookaheadCycles
    ) {
      tickDevicesWithoutCpu(chip, targetCycle - chip.cpu.cycles);
      return undefined;
    }
    if (lookaheadCycles !== undefined) {
      const preemption = preemptBeforeImminentChipWrite(
        chip,
        targetCycle,
        lookaheadCycles,
        opts.commandPreemptChipWritePcs,
        opts.commandPreemptChipWriteCompleteBeforeTarget === true,
      );
      if (preemption !== undefined) return preemption;
    }
    tickCycles(chip, 1);
  }
  return undefined;
}

function advanceReplayToCommandTarget(
  chip: SoundChip,
  targetCycle: number,
  opts: TickFrameWithTapeOptions,
): ReplayCommandPreemption | undefined {
  if (opts.commandSubmitBeforeCpuCatchup === true) {
    if (chip.cpu.cycles < targetCycle) {
      tickDevicesWithoutCpu(chip, targetCycle - chip.cpu.cycles);
    }
    return undefined;
  }
  return advanceReplayCpuTo(chip, targetCycle, opts);
}

function frameHasBoundaryCommand(tape: LoadedCmdTape, frame: number): boolean {
  const cmds = tape.byFrameCycle.get(frame);
  if (cmds === undefined || cmds.length === 0) return false;
  const frameCycles = cmdTapeFrameCycles(tape, frame);
  return cmds.some((cmd, index) => cmdTapeCommandCycleInFrame(cmd, index, cmds.length, frameCycles) === 0);
}

function advanceReplayCpuToFrameEnd(
  chip: SoundChip,
  tape: LoadedCmdTape,
  frame: number,
  frameEnd: number,
  opts: TickFrameWithTapeOptions,
): void {
  const preemption = advanceReplayCpuTo(chip, frameEnd, frameHasBoundaryCommand(tape, frame + 1) ? opts : {});
  if (preemption === undefined) {
    tapeReplayBoundaryPreemptions.delete(chip);
  } else {
    tapeReplayBoundaryPreemptions.set(chip, preemption);
  }
}

export function tickFrameWithTape(
  chip: SoundChip,
  tape: LoadedCmdTape,
  frame: number,
  opts: TickFrameWithTapeOptions = {},
): number {
  const frameCycles = cmdTapeFrameCycles(tape, frame);
  const releaseOnThisFrame = opts.autoReleaseReset === true && chip.inReset &&
    (tape.resetFrame === undefined || frame >= tape.resetFrame);
  const frameStart = releaseOnThisFrame ? 0 : (tapeReplayScheduleCycles.get(chip) ?? chip.cpu.cycles);
  const frameEnd = frameStart + frameCycles;
  const cpuStart = releaseOnThisFrame ? 0 : chip.cpu.cycles;
  setSoundFrameContext(chip, frame, frameStart);
  chip.statusBaseOverride = cmdTapeSoundStatusBaseForFrame(tape, frame, chip.statusBaseIdle);
  const cmds = tape.byFrameCycle.get(frame) ?? [];
  const emitFrameAdvance = (): number => {
    opts.onFrameAdvance?.({
      frame,
      frameStart,
      frameEnd,
      frameCycles,
      cpuStart,
      cpuEnd: chip.cpu.cycles,
      cpuStartDelta: cpuStart - frameStart,
      cpuEndDelta: chip.cpu.cycles - frameEnd,
      commandCount: cmds.length,
      releaseOnThisFrame,
      inResetAfter: chip.inReset,
    });
    return chip.cpu.cycles - cpuStart;
  };
  let boundaryPreemption = tapeReplayBoundaryPreemptions.get(chip);
  tapeReplayBoundaryPreemptions.delete(chip);
  const takeBoundaryPreemption = (targetCycle: number): ReplayCommandPreemption | undefined => {
    if (boundaryPreemption === undefined || targetCycle !== frameStart) return undefined;
    const out = boundaryPreemption;
    boundaryPreemption = undefined;
    return out;
  };

  if (opts.autoReleaseReset === true && chip.inReset) {
    if (tape.resetFrame !== undefined && frame < tape.resetFrame) return emitFrameAdvance();

    let nextCommandIndex = 0;
    const resetFirstFetchAfterCommand =
      normalizeResetReleaseDelay(opts.resetFirstFetchDelayAfterCommandCycles);
    if (resetFirstFetchAfterCommand > 0 && cmds.length > 0) {
      const c = cmds[nextCommandIndex]!;
      const targetCycle = scheduledCommandTargetCycle(frameStart, c, nextCommandIndex, cmds.length, frameCycles, opts);
      if (chip.cpu.cycles < targetCycle) chip.cpu.cycles = targetCycle;
      const preAdvance = commandSubmitPreAdvanceContext(chip, frameStart, targetCycle);
      emitScheduledCommand(chip, frame, frameStart, c, targetCycle, opts, takeBoundaryPreemption(targetCycle), preAdvance);
      nextCommandIndex++;

      releaseSoundReset(chip);
      const delayedCycle = targetCycle + resetFirstFetchAfterCommand;
      if (chip.cpu.cycles < delayedCycle) {
        tickSoundDevices(chip, delayedCycle - chip.cpu.cycles);
        chip.cpu.cycles = delayedCycle;
      }

      for (let i = nextCommandIndex; i < cmds.length; i++) {
        const cmd = cmds[i]!;
        const nextTargetCycle = scheduledCommandTargetCycle(frameStart, cmd, i, cmds.length, frameCycles, opts);
        const preAdvance = commandSubmitPreAdvanceContext(chip, frameStart, nextTargetCycle);
        const preemption = advanceReplayToCommandTarget(chip, nextTargetCycle, opts) ??
          takeBoundaryPreemption(nextTargetCycle);
        emitScheduledCommand(chip, frame, frameStart, cmd, nextTargetCycle, opts, preemption, preAdvance);
      }
      advanceReplayCpuToFrameEnd(chip, tape, frame, frameEnd, opts);
      tapeReplayScheduleCycles.set(chip, frameEnd);
      if (opts.drainReplies === true) drainReplyEvents(chip);
      return emitFrameAdvance();
    }

    while (nextCommandIndex < cmds.length) {
      const c = cmds[nextCommandIndex]!;
      const targetCycle = scheduledCommandTargetCycle(frameStart, c, nextCommandIndex, cmds.length, frameCycles, opts);
      if (targetCycle > frameStart) break;
      const preAdvance = commandSubmitPreAdvanceContext(chip, frameStart, targetCycle);
      emitScheduledCommand(chip, frame, frameStart, c, targetCycle, opts, takeBoundaryPreemption(targetCycle), preAdvance);
      nextCommandIndex++;
    }
    releaseSoundReset(chip);
    const resetDelay = normalizeResetReleaseDelay(opts.resetReleaseDelayCycles);
    if (resetDelay > 0) {
      const delayedCycle = frameStart + resetDelay;
      if (chip.cpu.cycles < delayedCycle) {
        tickSoundDevices(chip, delayedCycle - chip.cpu.cycles);
        chip.cpu.cycles = delayedCycle;
      }
    }

    for (let i = nextCommandIndex; i < cmds.length; i++) {
      const c = cmds[i]!;
      const targetCycle = scheduledCommandTargetCycle(frameStart, c, i, cmds.length, frameCycles, opts);
      const preAdvance = commandSubmitPreAdvanceContext(chip, frameStart, targetCycle);
      const preemption = advanceReplayToCommandTarget(chip, targetCycle, opts) ?? takeBoundaryPreemption(targetCycle);
      emitScheduledCommand(chip, frame, frameStart, c, targetCycle, opts, preemption, preAdvance);
    }
    advanceReplayCpuToFrameEnd(chip, tape, frame, frameEnd, opts);
    tapeReplayScheduleCycles.set(chip, frameEnd);
    if (opts.drainReplies === true) drainReplyEvents(chip);
    return emitFrameAdvance();
  }

  if (cmds.length === 0) {
    advanceReplayCpuToFrameEnd(chip, tape, frame, frameEnd, opts);
    tapeReplayScheduleCycles.set(chip, frameEnd);
    if (opts.drainReplies === true) drainReplyEvents(chip);
    return emitFrameAdvance();
  }

  for (let i = 0; i < cmds.length; i++) {
    const c = cmds[i]!;
    const targetCycle = scheduledCommandTargetCycle(frameStart, c, i, cmds.length, frameCycles, opts);
    const preAdvance = commandSubmitPreAdvanceContext(chip, frameStart, targetCycle);
    const preemption = advanceReplayToCommandTarget(chip, targetCycle, opts) ?? takeBoundaryPreemption(targetCycle);
    emitScheduledCommand(chip, frame, frameStart, c, targetCycle, opts, preemption, preAdvance);
  }
  advanceReplayCpuToFrameEnd(chip, tape, frame, frameEnd, opts);
  tapeReplayScheduleCycles.set(chip, frameEnd);
  if (opts.drainReplies === true) drainReplyEvents(chip);
  return emitFrameAdvance();
}

/** Hard reset: clear all state and return to reset hold. */
export function resetSoundChip(chip: SoundChip): void {
  tapeReplayScheduleCycles.delete(chip);
  tapeReplayBoundaryPreemptions.delete(chip);
  cpuReset(chip.cpu, chip.mmu);
  chip.soundDeviceCycle = chip.cpu.cycles;
  chip.mainToSound.value = as_u8(0);
  chip.mainToSound.pending = false;
  chip.soundToMain.value = as_u8(0);
  chip.soundToMain.pending = false;
  chip.pendingMainReplyAckCycle = undefined;
  chip.pendingCommandNmiDelayInstructions = undefined;
  chip.pendingCommandNmiServiceDelayCycles = undefined;
  chip.pendingYmIrqAssertionDelayCycles = undefined;
  chip.statusBaseOverride = undefined;
  chip.replyQueue.length = 0;
  chip.chipWriteEvents.length = 0;
  chip.deferChipIoWrites = false;
  chip.deferredChipIoWrites.length = 0;
  chip.pendingPokeyWrites.length = 0;
  chip.nextPendingPokeyWriteSequence = 0;
  chip.diagnosticFrame = undefined;
  chip.diagnosticFrameStartCycle = undefined;
  chip.lastStepStartCycle = undefined;
  chip.lastStepEndCycle = undefined;
  chip.lastStepPc = undefined;
  chip.lastStepCycles = undefined;
  chip.ymStreamGeneratedSamples = 0;
  chip.ym2151.regs.fill(0);
  chip.ym2151.selectedReg = 0;
  chip.ym2151.timerAOverflow = false;
  chip.ym2151.timerBOverflow = false;
  pokeyReset(chip.pokey);
  chip.mmu.ram.fill(0);
  chip.inReset = true;
}
