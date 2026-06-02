/**
 * ym2151.ts - Yamaha YM2151 OPM FM synthesis chip model.
 *
 * Early scope:
 *   - 256-byte register file written through the address/data ports
 *     `$1800`/`$1801`.
 *   - Read status register: bit 0=Timer A overflow, bit 1=Timer B overflow.
 *   - Register shadow exposed for MAME oracle diffs.
 *
 * Later passes added envelope, operator FM synthesis, LFO, timers, and sample
 * output for sample-level audio parity.
 *
 * Hardware reference: MAME `ym2151.cpp` and the Yamaha OPM datasheet.
 *   - 8 channels x 4 operators (32 total operators)
 *   - Clock 3.579545 MHz (Atari System 1)
 *   - 256-byte register file selected in two steps: address then data
 *   - Status reads at `$1800` or `$1801` return timer flags plus busy bit
 *
 * Register map:
 *   0x01     TEST / LFO reset
 *   0x08     Key ON (operator slot mask + channel select)
 *   0x0F     Noise enable + freq
 *   0x10-12  Timer A high / Timer A low / Timer B
 *   0x14     IRQ enable / clear / reset
 *   0x18-1B  LFO frequency / waveform / PMD / AMD
 *   0x20-27  Channel: RL+FB+CONN
 *   0x28-2F  Channel: KC (key code)
 *   0x30-37  Channel: KF (key fraction)
 *   0x38-3F  Channel: PMS/AMS
 *   0x40-5F  Operator: DT1/MUL (32 reg, 4 op x 8 ch)
 *   0x60-7F  Operator: TL (total level)
 *   0x80-9F  Operator: KS/AR (key scale + attack rate)
 *   0xA0-BF  Operator: AMS-EN/D1R (decay 1 rate)
 *   0xC0-DF  Operator: DT2/D2R (decay 2 rate)
 *   0xE0-FF  Operator: D1L/RR (decay 1 level + release rate)
 *
 * Marble 6502 boot-code pattern:
 *   STA $1800   ; write reg select (byte addr 0x00..0xFF)
 *   STA $1801   ; write reg data
 *   LDA $1800   ; read status bit 0/1 timer overflow
 */

import type { u8 } from "../wrap.js";
import { as_u8 } from "../wrap.js";
import {
  type Channel,
  createChannel,
  channelSample,
  channelSetKeyLiveMask,
  channelClockKeyState,
} from "./ym2151-channel.js";
import { operatorSetOpmBlockFreq } from "./ym2151-operator.js";
import { resetEnvClock, tickEnvClock } from "./ym2151-envelope.js";

/** Sample rate native YM2151 used by the current MAME-aligned DSP tables. */
export const YM2151_NATIVE_SAMPLE_RATE = 55_930.375;
/** MAME WAV stream cadence for the YM2151 device output on Atari System 1. */
export const YM2151_MAME_STREAM_SAMPLE_RATE = 55_930;
/** MAME atarisy1 routes each YM2151 output to the stereo speaker at gain 0.48. */
const YM2151_MAME_ROUTE_GAIN = 0.48;
const YM2151_PCM_SCALE = YM2151_MAME_ROUTE_GAIN / 32768;

export interface YM2151 {
  /**
   * 256-byte register shadow exposed for oracle diffs.
   *
   * Do not mutate manually; use `writeData()` to preserve the selected-register
   * path used by MAME.
   */
  readonly regs: Uint8Array;
  /** Register index selected by the latest `writeAddr()`. */
  selectedReg: number;
  /** Timer A overflow flag (status bit 0). Latched on counter overflow only
   * when Timer A enable is set, cleared via write $14 bit 4. */
  timerAOverflow: boolean;
  /** Timer B overflow flag (status bit 1). Latched on counter overflow only
   * when Timer B enable is set. */
  timerBOverflow: boolean;
  /** Timer A active, armed via register $14 bit 0. */
  timerAActive: boolean;
  /** Timer A countdown counter in tick units (1 tick = 64 cycle YM2151). */
  timerACounter: number;
  /** Timer A prescaler in YM master cycles. Reloading Timer A restarts this
   * prescaler; it must not share the sample/envelope accumulator. */
  timerAAccumulator: number;
  /** Diagnostics-only YM-cycle phase offset applied when Timer A is first
   * armed. Positive values delay the first overflow; negative values advance
   * it. Default 0 preserves the emulation path. */
  timerAStartDelayYmCycles: number;
  /** Diagnostics-only experiment: stop Timer A countdown while status bit A is
   * pending. Default false preserves the ymfm-style auto-reschedule path. */
  timerAHoldWhileOverflow: boolean;
  /** Timer A IRQ enable (write $14 bit 4). */
  timerAIrqEnable: boolean;
  /** Timer B active, armed via register $14 bit 1. */
  timerBActive: boolean;
  /** Timer B countdown counter in tick units (1 tick = 1024 cycle YM2151). */
  timerBCounter: number;
  /** Timer B prescaler in YM master cycles. */
  timerBAccumulator: number;
  /** Timer B IRQ enable. */
  timerBIrqEnable: boolean;
  /** YM2151 cycle accumulator, modulo 64/1024 for Timer A/B ticks. */
  ymCycleAccumulator: number;
  /** Eight FM channels, each with four operators. */
  readonly channels: Channel[];
  /** Sample accumulator from 6502 cycles to the native YM sample stream. */
  sampleAccumulator: number;
  /** Diagnostics/replay mode: external sound-stream scheduler owns audio sample generation. */
  externalSampleClock: boolean;
  /** Output sample buffer (interleaved L/R Float32). Drain via getSampleBuffer. */
  sampleBuffer: number[];
  /** Diagnostics-only per-channel sample buffers, enabled by probes. */
  diagnosticChannelSampleBuffers: number[][] | undefined;
  /** Diagnostics-only per-native-sample channel state trace. */
  diagnosticChannelStateTrace: YM2151ChannelStateTrace | undefined;
  /** Diagnostics-only phase generator experiment. Default false preserves the
   * current sample path. */
  diagnosticPhaseAdvanceAfterOutput: boolean;
  /** Bitmask of channels whose register-derived audio params need sample-clock prepare. */
  modifiedChannels: number;
  // ─── LFO state (Phase A2) ───────────────────────────────────────────────
  /** LFO frequency (`LFRQ`, reg $18). */
  lfoFreq: number;
  /** LFO waveform: 0=saw, 1=square, 2=triangle, 3=random (reg $1B bit 1-0). */
  lfoWaveform: number;
  /** Amplitude modulation depth (AMD, reg $19 bit 6-0). */
  lfoAmd: number;
  /** Phase modulation depth (PMD, reg $19 bit 7-set indicates PMD value). */
  lfoPmd: number;
  /** LFO phase accumulator 0..1 (normalized). */
  lfoPhase: number;
  /** Current LFO output: -1..+1 for saw/triangle or 0..1 for square/random. */
  lfoOutput: number;
  /** OPM LFO counter; bits 22..29 select the waveform index. */
  lfoCounter: number;
  /** Current OPM AM value after AMD depth. */
  lfoAm: number;
  /** Current signed OPM PM value after PMD depth. */
  lfoRawPm: number;
  /** OPM noise LFSR. Clocked continuously and sampled by LFO waveform 3. */
  lfoNoiseLfsr: number;
  /** OPM noise frequency counter. */
  lfoNoiseCounter: number;
  /** Latched OPM noise output bit, also used by channel 7 noise output. */
  lfoNoiseState: number;
  /** Dynamic LFO noise waveform table. AM in low 8 bits, signed PM in high 8. */
  readonly lfoNoiseWaveform: Int16Array;
  /**
   * Busy flag remaining in YM master cycles.
   *
   * Real hardware stays busy for 64 master clocks after a `$1801` data write;
   * `$1800` address writes do not trigger busy. Verified against
   * `oracle/mame_1801_busy_tap.lua` on 2026-05-18 and the cycle-precise PC tap
   * on 2026-05-22.
   */
  busyCycles: number;
}

export interface YM2151OperatorStateSnapshot {
  readonly phase: number;
  readonly phaseInc: number;
  readonly keyOn: boolean;
  readonly envState: number;
  readonly envCounter: number;
  readonly tl: number;
  readonly dt1: number;
  readonly dt2: number;
  readonly mul: number;
  readonly ks: number;
  readonly keyCode: number;
  readonly ar: number;
  readonly d1r: number;
  readonly d2r: number;
  readonly rr: number;
  readonly d1l: number;
}

export interface YM2151ChannelStateSnapshot {
  readonly nativeSample: number;
  readonly channel: number;
  readonly alg: number;
  readonly fb: number;
  readonly lr: number;
  readonly pms: number;
  readonly ams: number;
  readonly kc: number;
  readonly kf: number;
  readonly keyLiveMask: number;
  readonly fbHistory: readonly number[];
  readonly operators: readonly YM2151OperatorStateSnapshot[];
}

export interface YM2151ChannelStateTrace {
  channel: number;
  nativeSample: number;
  startNativeSample: number;
  endNativeSample: number;
  buffer: YM2151ChannelStateSnapshot[];
}

export function createYM2151(): YM2151 {
  resetEnvClock();
  return {
    regs: new Uint8Array(256),
    selectedReg: 0,
    timerAOverflow: false,
    timerBOverflow: false,
    timerAActive: false,
    timerACounter: 0,
    timerAAccumulator: 0,
    timerAStartDelayYmCycles: 0,
    timerAHoldWhileOverflow: false,
    timerAIrqEnable: false,
    timerBActive: false,
    timerBCounter: 0,
    timerBAccumulator: 0,
    timerBIrqEnable: false,
    ymCycleAccumulator: 0,
    channels: Array.from({ length: 8 }, () => createChannel()),
    sampleAccumulator: 0,
    externalSampleClock: false,
    sampleBuffer: [],
    diagnosticChannelSampleBuffers: undefined,
    diagnosticChannelStateTrace: undefined,
    diagnosticPhaseAdvanceAfterOutput: false,
    modifiedChannels: 0xff,
    lfoFreq: 0,
    lfoWaveform: 0,
    lfoAmd: 0,
    lfoPmd: 0,
    lfoPhase: 0,
    lfoOutput: 0,
    lfoCounter: 0,
    lfoAm: 0,
    lfoRawPm: 0,
    lfoNoiseLfsr: 1,
    lfoNoiseCounter: 0,
    lfoNoiseState: 0,
    lfoNoiseWaveform: new Int16Array(256),
    busyCycles: 0,
  };
}

function channelBlockFreq(ch: Channel): number {
  return ((ch.kc & 0x7f) << 6) | ((ch.kf >> 2) & 0x3f);
}

function recomputeChannelPhase(ch: Channel, pmDelta = 0): void {
  const blockFreq = channelBlockFreq(ch);
  for (const op of ch.op) {
    operatorSetOpmBlockFreq(op, blockFreq, YM2151_NATIVE_SAMPLE_RATE, pmDelta, pmDelta === 0);
  }
}

function physicalRegisterBlockForLogicalOperator(logicalOp: number): number {
  return [0, 2, 1, 3][logicalOp] ?? 0;
}

function markChannelModified(ym: YM2151, channelIndex: number): void {
  ym.modifiedChannels |= 1 << (channelIndex & 7);
}

function markAllChannelsModified(ym: YM2151): void {
  ym.modifiedChannels = 0xff;
}

function prepareChannelFromRegs(ym: YM2151, channelIndex: number): void {
  const ch = ym.channels[channelIndex];
  if (ch === undefined) return;

  const conn = ym.regs[0x20 + channelIndex] ?? 0;
  ch.lr = conn & 0xc0;
  ch.fb = (conn >> 3) & 7;
  ch.alg = conn & 7;
  ch.kc = (ym.regs[0x28 + channelIndex] ?? 0) & 0x7f;
  ch.kf = (ym.regs[0x30 + channelIndex] ?? 0) & 0xfc;
  const pmsAms = ym.regs[0x38 + channelIndex] ?? 0;
  ch.pms = (pmsAms >> 4) & 7;
  ch.ams = pmsAms & 3;

  for (let logicalOp = 0; logicalOp < 4; logicalOp++) {
    const op = ch.op[logicalOp];
    if (op === undefined) continue;
    const block = physicalRegisterBlockForLogicalOperator(logicalOp);
    const reg = 0x40 + block * 8 + channelIndex;
    const dtMul = ym.regs[reg] ?? 0;
    const tl = ym.regs[reg + 0x20] ?? 0;
    const ar = ym.regs[reg + 0x40] ?? 0;
    const d1r = ym.regs[reg + 0x60] ?? 0;
    const d2r = ym.regs[reg + 0x80] ?? 0;
    const rr = ym.regs[reg + 0xa0] ?? 0;

    op.dt1 = (dtMul >> 4) & 7;
    op.mul = dtMul & 0x0f;
    op.tl = tl & 0x7f;
    op.ks = (ar >> 6) & 3;
    op.ar = ar & 0x1f;
    op.amEnabled = (d1r & 0x80) !== 0;
    op.d1r = d1r & 0x1f;
    op.dt2 = (d2r >> 6) & 3;
    op.d2r = d2r & 0x1f;
    op.d1l = (rr >> 4) & 0x0f;
    op.rr = rr & 0x0f;
  }
  recomputeChannelPhase(ch);
}

function prepareModifiedChannels(ym: YM2151): void {
  const mask = ym.modifiedChannels & 0xff;
  if (mask === 0) return;
  for (let channelIndex = 0; channelIndex < ym.channels.length; channelIndex++) {
    if ((mask & (1 << channelIndex)) !== 0) prepareChannelFromRegs(ym, channelIndex);
  }
  ym.modifiedChannels = 0;
}

/**
 * Advance the LFO by one native YM sample.
 *
 * Hardware OPM: LFRQ is a 4.4 floating-point step into 256-entry waveforms. */
function toSigned16(value: number): number {
  return (value << 16) >> 16;
}

function lfoWaveformAmpm(ym: YM2151, waveform: number, index: number): number {
  const idx = index & 0xff;
  switch (waveform & 0x03) {
    case 0: {
      const am = idx ^ 0xff;
      return toSigned16(am | (idx << 8));
    }
    case 1: {
      const am = (idx & 0x80) !== 0 ? 0 : 0xff;
      return toSigned16(am | ((am ^ 0x80) << 8));
    }
    case 2: {
      const am = (idx & 0x80) !== 0 ? ((idx << 1) & 0xff) : (((idx ^ 0xff) << 1) & 0xff);
      const pm = (idx & 0x40) !== 0 ? am : (~am & 0xff);
      return toSigned16(am | (pm << 8));
    }
    default:
      return ym.lfoNoiseWaveform[idx] ?? 0;
  }
}

function tickLfo(ym: YM2151): void {
  const noiseFreq = ((ym.regs[0x0f] ?? 0) & 0x1f) ^ 0x1f;
  for (let rep = 0; rep < 2; rep++) {
    ym.lfoNoiseLfsr = (ym.lfoNoiseLfsr << 1) >>> 0;
    const feedback = ((ym.lfoNoiseLfsr >>> 17) ^ (ym.lfoNoiseLfsr >>> 14) ^ 1) & 1;
    ym.lfoNoiseLfsr = (ym.lfoNoiseLfsr | feedback) >>> 0;
    if (ym.lfoNoiseCounter++ >= noiseFreq) {
      ym.lfoNoiseCounter = 0;
      ym.lfoNoiseState = (ym.lfoNoiseLfsr >>> 17) & 1;
    }
  }

  const rate = ym.lfoFreq & 0xff;
  ym.lfoCounter += (0x10 | (rate & 0x0f)) * (2 ** ((rate >> 4) & 0x0f));
  ym.lfoCounter %= 0x40000000;
  if (((ym.regs[0x01] ?? 0) & 0x02) !== 0) ym.lfoCounter = 0;

  const index = Math.floor(ym.lfoCounter / 0x400000) & 0xff;
  const lfoNoise = (ym.lfoNoiseLfsr >>> 17) & 0xff;
  ym.lfoNoiseWaveform[(index + 1) & 0xff] = toSigned16(lfoNoise | (lfoNoise << 8));

  const ampm = lfoWaveformAmpm(ym, ym.lfoWaveform, index);
  const am = ampm & 0xff;
  const pm = ampm >> 8;
  ym.lfoAm = (am * ym.lfoAmd) >> 7;
  ym.lfoRawPm = (pm * ym.lfoPmd) >> 7;
  ym.lfoPhase = index / 256;
  ym.lfoOutput = pm / 128;
}

function channelPmDelta(rawPm: number, pms: number): number {
  if (pms === 0 || rawPm === 0) return 0;
  return pms < 6 ? rawPm >> (6 - pms) : rawPm << (pms - 5);
}

function channelAmOffset(ym: YM2151, ch: Channel): number {
  if (ch.ams === 0 || ym.lfoAmd === 0) return 0;
  return ym.lfoAm << (ch.ams - 1);
}

function roundtripYm3012(value: number): number {
  if (value < -32768) return -32768;
  if (value > 32767) return 32767;

  const intValue = Math.trunc(value);
  const scanValue = (intValue ^ (intValue >> 31)) >>> 0;
  let exponent = 7 - Math.clz32((scanValue << 17) >>> 0);
  exponent = Math.max(exponent, 1) - 1;
  const mask = (1 << exponent) - 1;
  return intValue & ~mask;
}

function routeYm2151Sample(value: number): number {
  return roundtripYm3012(value) * YM2151_PCM_SCALE;
}

function snapshotChannelState(
  ch: Channel,
  channel: number,
  nativeSample: number,
): YM2151ChannelStateSnapshot {
  return {
    nativeSample,
    channel,
    alg: ch.alg,
    fb: ch.fb,
    lr: ch.lr,
    pms: ch.pms,
    ams: ch.ams,
    kc: ch.kc,
    kf: ch.kf,
    keyLiveMask: ch.keyLiveMask,
    fbHistory: ch.fbHistory.slice(),
    operators: ch.op.map((op) => ({
      phase: op.phase,
      phaseInc: op.phaseInc,
      keyOn: op.keyOn,
      envState: op.env.state,
      envCounter: op.env.counter,
      tl: op.tl,
      dt1: op.dt1,
      dt2: op.dt2,
      mul: op.mul,
      ks: op.ks,
      keyCode: op.keyCode,
      ar: op.ar,
      d1r: op.d1r,
      d2r: op.d2r,
      rr: op.rr,
      d1l: op.d1l,
    })),
  };
}

/** Apply the register shadow to channel/operator parameters. Called by `writeData`. */
function applyReg(ym: YM2151, reg: number, val: number): void {
  // LFO control (Phase A2): $18 LFRQ, $19 AMD/PMD, $1B waveform
  if (reg === 0x18) { ym.lfoFreq = val & 0xff; return; }
  if (reg === 0x19) {
    // bit 7: select PMD (1) or AMD (0); bit 6-0 = value
    if ((val & 0x80) !== 0) {
      ym.lfoPmd = val & 0x7f;
      if (ym.lfoPmd === 0) {
        markAllChannelsModified(ym);
      }
    } else ym.lfoAmd = val & 0x7f;
    return;
  }
  if (reg === 0x1b) { ym.lfoWaveform = val & 3; return; }
  // Channel-level reg ($20..$3F): RL+FB+CONN, KC, KF, PMS+AMS
  if (reg >= 0x20 && reg < 0x40) {
    const ch = ym.channels[reg & 7];
    if (ch === undefined) return;
    markChannelModified(ym, reg & 7);
    return;
  }
  // Operator-level reg ($40..$FF): 32 op indexed by (reg - $40)
  // Layout: per 8-byte block, slot in (reg-base)/8, channel in (reg-base)&7
  if (reg >= 0x40 && reg < 0x100) {
    const opIdx = reg & 0x1f;
    const ch = ym.channels[opIdx & 7];
    if (ch === undefined) return;
    markChannelModified(ym, opIdx & 7);
    return;
  }
  // Reg $08: KEY ON byte
  if (reg === 0x08) {
    const chIdx = val & 7;
    const ch = ym.channels[chIdx];
    if (ch !== undefined) {
      // Slot mask convention: bit3=SM1=op1, bit4=SM2=op3, bit5=C1=op2, bit6=C2=op4
      // (OPM mapping: cmp Yamaha datasheet § 4.4.1)
      // Bit set means key on; bit clear means key off.
      const keyMask =
        ((val & 0x08) !== 0 ? 0x10 : 0) |  // op1
        ((val & 0x10) !== 0 ? 0x20 : 0) |  // op2
        ((val & 0x20) !== 0 ? 0x40 : 0) |  // op3
        ((val & 0x40) !== 0 ? 0x80 : 0);   // op4
      channelSetKeyLiveMask(ch, keyMask);
      markChannelModified(ym, chIdx);
    }
  }
}

/** Produces one stereo sample from all eight active channels. Output is [-1..+1] L/R.
 * Phase A2: LFO advance. Phase A4: PM (phase modulation) + AM scale. */
export function ym2151Sample(ym: YM2151): [number, number] {
  prepareModifiedChannels(ym);
  tickLfo(ym);
  let left = 0, right = 0;
  const channelBuffers = ym.diagnosticChannelSampleBuffers;
  for (let chIdx = 0; chIdx < ym.channels.length; chIdx++) {
    const ch = ym.channels[chIdx]!;
    if (ym.lfoPmd !== 0 && ch.pms !== 0) recomputeChannelPhase(ch, channelPmDelta(ym.lfoRawPm, ch.pms));
    channelClockKeyState(ch);
    const [l, r] = channelSample(ch, channelAmOffset(ym, ch), !ym.diagnosticPhaseAdvanceAfterOutput);
    channelBuffers?.[chIdx]?.push(routeYm2151Sample(l), routeYm2151Sample(r));
    left += l;
    right += r;
  }
  const stateTrace = ym.diagnosticChannelStateTrace;
  if (stateTrace !== undefined) {
    const nativeSample = stateTrace.nativeSample;
    if (nativeSample >= stateTrace.startNativeSample && nativeSample <= stateTrace.endNativeSample) {
      const ch = ym.channels[stateTrace.channel & 7];
      if (ch !== undefined) stateTrace.buffer.push(snapshotChannelState(ch, stateTrace.channel & 7, nativeSample));
    }
    stateTrace.nativeSample = nativeSample + 1;
  }
  return [routeYm2151Sample(left), routeYm2151Sample(right)];
}

export function ym2151GenerateSamples(ym: YM2151, count: number): void {
  const n = Math.max(0, Math.trunc(count));
  for (let i = 0; i < n; i++) {
    tickEnvClock();
    const [l, r] = ym2151Sample(ym);
    ym.sampleBuffer.push(l, r);
  }
}

/** Drain accumulated sample buffer. Caller uses returned arrays then sampleBuffer.length = 0. */
export function ym2151DrainSamples(ym: YM2151): number[] {
  const buf = ym.sampleBuffer;
  ym.sampleBuffer = [];
  return buf;
}

export function ym2151SetDiagnosticChannelSamples(ym: YM2151, enabled: boolean): void {
  ym.diagnosticChannelSampleBuffers = enabled
    ? Array.from({ length: ym.channels.length }, () => [])
    : undefined;
}

export function ym2151SetDiagnosticChannelStateTrace(
  ym: YM2151,
  channel: number,
  startNativeSample: number,
  endNativeSample: number,
): void {
  ym.diagnosticChannelStateTrace = {
    channel: Math.max(0, Math.min(7, Math.trunc(channel))),
    nativeSample: 0,
    startNativeSample: Math.max(0, Math.trunc(startNativeSample)),
    endNativeSample: Math.max(0, Math.trunc(endNativeSample)),
    buffer: [],
  };
}

/** @public */
export function ym2151ClearDiagnosticChannelStateTrace(ym: YM2151): void {
  ym.diagnosticChannelStateTrace = undefined;
}

export function ym2151SetDiagnosticPhaseAdvanceAfterOutput(ym: YM2151, enabled: boolean): void {
  ym.diagnosticPhaseAdvanceAfterOutput = enabled;
}

export function ym2151SetExternalSampleClock(ym: YM2151, enabled: boolean): void {
  ym.externalSampleClock = enabled;
  ym.ymCycleAccumulator = 0;
}

export function ym2151DrainDiagnosticChannelSamples(ym: YM2151): number[][] | undefined {
  const buffers = ym.diagnosticChannelSampleBuffers;
  if (buffers === undefined) return undefined;
  const out = buffers.map((buf) => buf.slice());
  for (const buf of buffers) buf.length = 0;
  return out;
}

export function ym2151DrainDiagnosticChannelStateTrace(
  ym: YM2151,
): YM2151ChannelStateSnapshot[] | undefined {
  const trace = ym.diagnosticChannelStateTrace;
  if (trace === undefined) return undefined;
  const out = trace.buffer.slice();
  trace.buffer.length = 0;
  return out;
}

/**
 * Reload Timer A from registers $10/$11.
 *
 * Timer A is a 10-bit value: high 8 bits in $10 and low 2 bits in $11.
 */
function timerALoadValue(ym: YM2151): number {
  const high8 = ym.regs[0x10] ?? 0;
  const low2 = (ym.regs[0x11] ?? 0) & 0x03;
  const val10 = (high8 << 2) | low2;
  return 1024 - val10;
}

/** Reload Timer B from register $12; period is `256 - value`. */
function timerBLoadValue(ym: YM2151): number {
  return 256 - (ym.regs[0x12] ?? 0);
}

/** Write to `$1800`: select the register address for the next data write. */
export function ym2151WriteAddr(ym: YM2151, addr: u8): void {
  ym.selectedReg = (addr as number) & 0xff;
}

/**
 * Write to `$1801`: store the selected register byte and process side effects.
 */
export function ym2151WriteData(ym: YM2151, data: u8): void {
  const reg = ym.selectedReg;
  const v = data as number;
  ym.regs[reg] = v;
  ym.busyCycles = 64;
  // ymfm marks all channels modified for every engine write, then prepares
  // their cached operator data on the next sample clock.
  markAllChannelsModified(ym);
  // Apply the write to cached channel/operator parameters.
  applyReg(ym, reg, v);
  // Side effects V3 Timer A/B (reg $14 = control register).
  //
  // Timer-control bit mapping, verified against `ymfm_opm.h` and
  // `ymfm_fm.ipp::ymfm::set_reset_status` on 2026-05-17:
  //   bit 0 = load_timer_a  (arm Timer A counter from regs $10/$11)
  //   bit 1 = load_timer_b
  //   bit 2 = enable_timer_a, MAME's IRQ-enable semantic for Timer A overflow
  //   bit 3 = enable_timer_b
  //   bit 4 = reset_timer_a (= clear status TIMERA = clear overflow flag)
  //   bit 5 = reset_timer_b
  //   bit 6 = unused
  //   bit 7 = CSM (key-on-with-timer, V3 deferito)
  // Boot init writes $14=$05, meaning LOAD A plus Timer A IRQ enable. Treating
  // bit 2 as a clear flag prevents the IRQ handler from ever writing the later
  // $14=$11 control byte.
  if (reg === 0x14) {
    // Reset overflow flag (bit 4/5 = reset_timer_a/b)
    if ((v & 0x10) !== 0) ym.timerAOverflow = false;
    if ((v & 0x20) !== 0) ym.timerBOverflow = false;
    // Enable bits (bit 2/3 = enable_timer_a/b: gates IRQ assertion on overflow)
    ym.timerAIrqEnable = (v & 0x04) !== 0;
    ym.timerBIrqEnable = (v & 0x08) !== 0;
    // Timer A reload is edge-triggered from inactive to active. Rewriting $14
    // while the timer is active leaves the current count running. Verified by
    // MAME vs TS `ym_writes` diffs on 2026-05-18.
    if ((v & 0x01) !== 0) {
      if (!ym.timerAActive) {
        ym.timerACounter = timerALoadValue(ym);
        ym.timerAAccumulator = -Math.trunc(ym.timerAStartDelayYmCycles);
        ym.timerAActive = true;
      }
    } else {
      ym.timerAActive = false;
      ym.timerAAccumulator = 0;
    }
    if ((v & 0x02) !== 0) {
      if (!ym.timerBActive) {
        ym.timerBCounter = timerBLoadValue(ym);
        ym.timerBAccumulator = 0;
        ym.timerBActive = true;
      }
    } else {
      ym.timerBActive = false;
      ym.timerBAccumulator = 0;
    }
  }
}

/**
 * Advances timers by N 6502 cycles and converts to YM2151 cycles internally.
 *
 * Timer A ticks every 64 YM cycles; Timer B ticks every 1024 YM cycles.
 *
 * On overflow: set flag bit only when the corresponding enable bit is set.
 * The 6502 IRQ wire is handled by the SoundChip facade.
 */
export function ym2151TickCycles(ym: YM2151, cycles6502: number): void {
  // 2x ratio: 6502 @ 1.789 MHz, YM2151 @ 3.579 MHz.
  const ymCycles = cycles6502 * 2;
  if (ym.busyCycles > 0) {
    ym.busyCycles = Math.max(0, ym.busyCycles - ymCycles);
  }
  if (!ym.externalSampleClock) {
    ym.ymCycleAccumulator += ymCycles;
    // Timer A: one tick every 64 YM cycles.
    // Timer B: one tick every 1024 YM cycles (= 16x Timer A).
    // Sample: one stereo sample every 64 YM cycles.
    while (ym.ymCycleAccumulator >= 64) {
      ym.ymCycleAccumulator -= 64;
      ym2151GenerateSamples(ym, 1);
    }
  }
  if (ym.timerAActive && !(ym.timerAHoldWhileOverflow && ym.timerAOverflow)) {
    ym.timerAAccumulator += ymCycles;
    while (ym.timerAAccumulator >= 64) {
      ym.timerAAccumulator -= 64;
      ym.timerACounter--;
      if (ym.timerACounter <= 0) {
        if (ym.timerAIrqEnable) {
          ym.timerAOverflow = true;
        }
        ym.timerACounter = timerALoadValue(ym);
        // Auto-restart: hardware behaviour (Timer A is free-running)
      }
    }
  }
  if (ym.timerBActive) {
    ym.timerBAccumulator += ymCycles;
    while (ym.timerBAccumulator >= 1024) {
      ym.timerBAccumulator -= 1024;
      ym.timerBCounter--;
      if (ym.timerBCounter <= 0) {
        if (ym.timerBIrqEnable) {
          ym.timerBOverflow = true;
        }
        ym.timerBCounter = timerBLoadValue(ym);
      }
    }
  }
}

/** Read from `$1800` or `$1801`: return the YM status byte. */
export function ym2151ReadStatus(ym: YM2151): u8 {
  const b0 = ym.timerAOverflow ? 0x01 : 0;
  const b1 = ym.timerBOverflow ? 0x02 : 0;
  // Bit 7 is BUSY: high for 64 master clocks after a `$1801` data write.
  // Verified by `oracle/mame_1801_busy_tap.lua` on 2026-05-18.
  const b7 = ym.busyCycles > 0 ? 0x80 : 0;
  return as_u8(b0 | b1 | b7);
}

/** Hard reset from the LS259 outlatch bit 0 path in `sound-mmu.ts` (`$1820`). */
export function ym2151Reset(ym: YM2151): void {
  resetEnvClock();
  ym.regs.fill(0);
  ym.selectedReg = 0;
  ym.timerAOverflow = false;
  ym.timerBOverflow = false;
  ym.timerAActive = false;
  ym.timerACounter = 0;
  ym.timerAAccumulator = 0;
  ym.timerAHoldWhileOverflow = false;
  ym.timerAIrqEnable = false;
  ym.timerBActive = false;
  ym.timerBCounter = 0;
  ym.timerBAccumulator = 0;
  ym.timerBIrqEnable = false;
  ym.ymCycleAccumulator = 0;
  ym.sampleAccumulator = 0;
  ym.sampleBuffer = [];
  if (ym.diagnosticChannelSampleBuffers !== undefined) {
    ym.diagnosticChannelSampleBuffers = Array.from({ length: ym.channels.length }, () => []);
  }
  ym.modifiedChannels = 0xff;
  ym.lfoFreq = 0;
  ym.lfoWaveform = 0;
  ym.lfoAmd = 0;
  ym.lfoPmd = 0;
  ym.lfoPhase = 0;
  ym.lfoOutput = 0;
  ym.lfoCounter = 0;
  ym.lfoAm = 0;
  ym.lfoRawPm = 0;
  ym.lfoNoiseLfsr = 1;
  ym.lfoNoiseCounter = 0;
  ym.lfoNoiseState = 0;
  ym.lfoNoiseWaveform.fill(0);
  ym.busyCycles = 0;
  for (let i = 0; i < ym.channels.length; i++) {
    ym.channels[i] = createChannel();
  }
}
