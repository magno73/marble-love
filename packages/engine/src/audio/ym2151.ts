/**
 * ym2151.ts — Yamaha YM2151 OPM FM synthesis chip, Phase 5 register-state parity.
 *
 * Scope V2 (vedi plan):
 *   - Register file 256 byte, scrivibile via address/data port ($1800/$1801).
 *   - Read status register: bit 0=Timer A overflow, bit 1=Timer B overflow.
 *   - Reg shadow esposto per diff vs MAME oracle (Phase 8 differential testing).
 *   - **NON** implementato in V2: envelope generator, operator FM synthesis, LFO,
 *     audio sample output. Quelli sono V3 (sample-level audio parity).
 *
 * Hardware ref (per MAME ym2151.cpp + Yamaha datasheet OPM):
 *   - 8 channels × 4 operators (32 operatori totali)
 *   - Clock 3.579545 MHz (Atari System 1)
 *   - 256-byte register file, indirizzato 2 step: WR_ADDR($1800) + WR_DATA($1801)
 *   - Status read da $1800 o $1801 (stessa risposta): Timer flags + busy bit
 *
 * Register map (riferimento, non decodificato in V2):
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
 *   0x40-5F  Operator: DT1/MUL (32 reg, 4 op × 8 ch)
 *   0x60-7F  Operator: TL (total level)
 *   0x80-9F  Operator: KS/AR (key scale + attack rate)
 *   0xA0-BF  Operator: AMS-EN/D1R (decay 1 rate)
 *   0xC0-DF  Operator: DT2/D2R (decay 2 rate)
 *   0xE0-FF  Operator: D1L/RR (decay 1 level + release rate)
 *
 * Pattern d'uso (dal 6502 boot code Marble):
 *   STA $1800   ; write reg select (byte addr 0x00..0xFF)
 *   STA $1801   ; write reg data
 *   LDA $1800   ; read status → bit 0/1 timer overflow
 *
 * Phase 5 V2 stesso comportamento di MAME register file: scrittura a $1800
 * imposta `selectedReg`, scrittura a $1801 stora `regs[selectedReg] = data`.
 * Lo "status" non e' un registro nel file: e' calcolato da timerA/B internal
 * counters (stub V2: sempre 0, no overflow → boot code che attende busy clear
 * passa al primo poll).
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
  /** 256-byte register shadow. Esposto per oracle diff. NON mutare manualmente:
   * usa writeData() per simulare il path MAME (selectedReg → regs). */
  readonly regs: Uint8Array;
  /** Reg index selezionato dall'ultima writeAddr(). Default 0 a reset. */
  selectedReg: number;
  /** Timer A overflow flag (status bit 0). Latched on counter overflow only
   * when Timer A enable is set, cleared via write $14 bit 4. */
  timerAOverflow: boolean;
  /** Timer B overflow flag (status bit 1). Latched on counter overflow only
   * when Timer B enable is set. */
  timerBOverflow: boolean;
  /** Timer A active (count-down running). Armato via $14 bit 0. */
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
  /** Timer B active (count-down running). Armato via $14 bit 1. */
  timerBActive: boolean;
  /** Timer B countdown counter in tick units (1 tick = 1024 cycle YM2151). */
  timerBCounter: number;
  /** Timer B prescaler in YM master cycles. */
  timerBAccumulator: number;
  /** Timer B IRQ enable. */
  timerBIrqEnable: boolean;
  /** YM2151 cycle accumulator (modulo 64 / 1024 per scattare Timer A/B tick).
   * tickCycles converte cycle 6502 in cycle YM (×2 ratio). */
  ymCycleAccumulator: number;
  /** 8 channels FM (V3 chip-perfect). Ogni channel ha 4 operatori. */
  readonly channels: Channel[];
  /** Sample accumulator: cycle 6502 → sample stream YM (1 sample ogni 64 YM cycle = 32 cycle 6502). */
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
  /** LFO frequency (LFRQ, reg $18). Bassa = lenta, alta = veloce. */
  lfoFreq: number;
  /** LFO waveform: 0=saw, 1=square, 2=triangle, 3=random (reg $1B bit 1-0). */
  lfoWaveform: number;
  /** Amplitude modulation depth (AMD, reg $19 bit 6-0). */
  lfoAmd: number;
  /** Phase modulation depth (PMD, reg $19 bit 7-set indicates PMD value). */
  lfoPmd: number;
  /** LFO phase accumulator 0..1 (normalized). */
  lfoPhase: number;
  /** LFO output corrente: -1..+1 (saw/triangle) o 0..1 (square/random). */
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
  /** Busy flag remaining in YM master cycles. Real hardware: 64 master clock
   * dopo write a $1801 (data); $1800 (addr) NON triggera busy. Verificato
   * 2026-05-18 via oracle/mame_1801_busy_tap.lua; riconfermato sul tap PC
   * cycle-precise 2026-05-22. Boot $8FED polla bit 7. */
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

/** Avanza LFO per 1 sample @ YM native rate.
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

/** Apply reg shadow → channel/operator params. Chiamato da writeData. */
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
      // V3 minimal: tutto bit set → keyOn, bit clear → keyOff
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

/** Produce 1 sample stereo da tutti 8 channel attivi. Output [-1..+1] L+R.
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

/** Carica il Timer A counter dal valore corrente di reg $10/$11 (10-bit:
 * high8 = $10, low2 = $11 bit 1-0). Period = 1024 - val tick. */
function timerALoadValue(ym: YM2151): number {
  const high8 = ym.regs[0x10] ?? 0;
  const low2 = (ym.regs[0x11] ?? 0) & 0x03;
  const val10 = (high8 << 2) | low2;
  return 1024 - val10;
}

/** Carica il Timer B counter dal valore di reg $12 (8-bit). Period = 256 -
 * val tick. */
function timerBLoadValue(ym: YM2151): number {
  return 256 - (ym.regs[0x12] ?? 0);
}

/** Write a $1800: imposta il register address per la prossima writeData. */
export function ym2151WriteAddr(ym: YM2151, addr: u8): void {
  ym.selectedReg = (addr as number) & 0xff;
}

/** Write a $1801: stora il byte nel reg selezionato + processa side effects
 * Timer A/B (V3) + apply al channel/operator params (V3 chip-perfect). */
export function ym2151WriteData(ym: YM2151, data: u8): void {
  const reg = ym.selectedReg;
  const v = data as number;
  ym.regs[reg] = v;
  ym.busyCycles = 64;
  // ymfm marks all channels modified for every engine write, then prepares
  // their cached operator data on the next sample clock.
  markAllChannelsModified(ym);
  // V3 chip-perfect: applica il reg ai parametri channel/operator.
  applyReg(ym, reg, v);
  // Side effects V3 Timer A/B (reg $14 = control register).
  //
  // Bit mapping CORRETTO (verificato 2026-05-17 contro ymfm_opm.h + ymfm_fm.ipp
  // → handler ymfm::set_reset_status):
  //   bit 0 = load_timer_a  (arm Timer A counter from regs $10/$11)
  //   bit 1 = load_timer_b
  //   bit 2 = enable_timer_a (= IRQ "enable" semantica MAME: quando timer overflows
  //                            E enable_timer_a=1, status TIMERA = 1 → IRQ asserito)
  //   bit 3 = enable_timer_b
  //   bit 4 = reset_timer_a (= clear status TIMERA = clear overflow flag)
  //   bit 5 = reset_timer_b
  //   bit 6 = unused
  //   bit 7 = CSM (key-on-with-timer, V3 deferito)
  //
  // ❌ Era SBAGLIATO prima (commit 7671a9d): bit 2/3 trattati come "clear flag",
  // bit 4/5 come "IRQA/B enable". Esattamente l'opposto del bit layout MAME ymfm.
  // Conseguenza: boot init scrive $14=$05 = LOAD A + bit 2 → in MAME = abilita
  // Timer A IRQ → IRQ fires su overflow. In TS interpretava bit 2 come "clear
  // flag" → Timer A IRQ MAI abilitato → chicken-and-egg con $14=$11 mai scritto.
  if (reg === 0x14) {
    // Reset overflow flag (bit 4/5 = reset_timer_a/b)
    if ((v & 0x10) !== 0) ym.timerAOverflow = false;
    if ((v & 0x20) !== 0) ym.timerBOverflow = false;
    // Enable bits (bit 2/3 = enable_timer_a/b: gates IRQ assertion on overflow)
    ym.timerAIrqEnable = (v & 0x04) !== 0;
    ym.timerBIrqEnable = (v & 0x08) !== 0;
    // Arm Timer A: load from regs $10/$11 (bit 0 = load_timer_a). Per ymfm
    // semantics: il reload e' EDGE-TRIGGERED su inactive→active. Se il timer
    // e' gia' attivo e bit 0 ancora set, NON resetta il counter (il timer
    // continua il count corrente). Verificato 2026-05-18 via ym_writes diff
    // MAME vs TS: senza edge-trigger, l'IRQ handler che scrive $14=$11 e
    // $14=$05 con bit 0 set ENTRAMBI causava 2 reset counter per IRQ →
    // ~103 cyc drift per IRQ cycle vs MAME.
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

/** Avanza i Timer A/B per N cycle 6502 (clock 1.789 MHz). Internamente
 * converte a cycle YM2151 (×2 ratio = 3.579 MHz). Timer A tick = 64 cycle YM,
 * Timer B tick = 1024 cycle YM.
 *
 * On overflow: set flag bit only when the corresponding enable bit is set.
 * IRQ wire al 6502 e' lasciato al chiamante (SoundChip facade chiama
 * requestIrq se timer*IrqEnable e overflow set). */
export function ym2151TickCycles(ym: YM2151, cycles6502: number): void {
  // 2× ratio: 6502 @ 1.789 MHz, YM2151 @ 3.579 MHz
  const ymCycles = cycles6502 * 2;
  if (ym.busyCycles > 0) {
    ym.busyCycles = Math.max(0, ym.busyCycles - ymCycles);
  }
  if (!ym.externalSampleClock) {
    ym.ymCycleAccumulator += ymCycles;
    // Timer A: 1 tick ogni 64 cycle YM
    // Timer B: 1 tick ogni 1024 cycle YM (= 16× Timer A)
    // Sample: 1 stereo sample ogni 64 cycle YM.
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

/** Read da $1800/$1801: ritorna status byte. Phase 5 stub timer flags=false. */
export function ym2151ReadStatus(ym: YM2151): u8 {
  const b0 = ym.timerAOverflow ? 0x01 : 0;
  const b1 = ym.timerBOverflow ? 0x02 : 0;
  // bit 7 = BUSY: rimane high per 64 master clock dopo write a $1801 (data).
  // Verificato via oracle/mame_1801_busy_tap.lua 2026-05-18: read $1801 a
  // Δ=24..30 cyc post-write = busy; Δ=38..44 cyc post-write = clear. Write
  // a $1800 (addr) NON triggera busy.
  const b7 = ym.busyCycles > 0 ? 0x80 : 0;
  return as_u8(b0 | b1 | b7);
}

/** Hard reset: pulisce reg file e flag. Chiamato da LS259 outlatch bit 0
 * (vedi `sound-mmu.ts` $1820). */
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
