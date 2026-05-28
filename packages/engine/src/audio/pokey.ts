/**
 * pokey.ts — Atari POKEY (custom co-processor), Phase 6 register-state parity.
 *
 * Scope V2:
 *   - 16-byte read register file and 16-byte write register file, matching
 *     MAME's distinct read/write address spaces.
 *   - Decoder write a $00-$0F (AUDF1/AUDC1..AUDF4/AUDC4, AUDCTL, IRQEN, SKCTL).
 *   - Register shadow exposed for oracle diffs.
 *   - V2 did not model waveform generation, pot scan, serial I/O, keyboard
 *     scan, or IRQ generation; later passes added sample-level audio.
 *
 * Hardware ref (MAME pokey.cpp + Atari Hardware Manual):
 *   - 4 independent tone channels
 *   - 17-bit poly LFSR (noise source) + 9-bit + 5-bit + 4-bit poly
 *   - Clock 1.789773 MHz (Atari System 1 sound CPU clock)
 *   - 8 paddle pot inputs, not expected to be used by Marble Madness
 *   - Serial I/O and keyboard scan, also not expected to be used here
 *
 * Register map WRITE ($1870-$187F):
 *   $00 AUDF1   Frequency channel 1 (low byte)
 *   $01 AUDC1   Control channel 1 (volume + distortion poly select)
 *   $02 AUDF2   Frequency channel 2
 *   $03 AUDC2   Control channel 2
 *   $04 AUDF3   Frequency channel 3
 *   $05 AUDC3   Control channel 3
 *   $06 AUDF4   Frequency channel 4
 *   $07 AUDC4   Control channel 4
 *   $08 AUDCTL  Clock + filter + 16-bit join + poly 9-bit mode
 *   $09 STIMER  Start timers (write-only trigger)
 *   $0A SKRES   Serial reset
 *   $0B POTGO   Start pot scan
 *   $0D SEROUT  Serial out
 *   $0E IRQEN   IRQ enable mask
 *   $0F SKCTL   Serial control + 2-tone mode
 *
 * Register map READ ($1870-$187F):
 *   $00-$07 POT0..POT7  Paddle pots (stub V2: 0)
 *   $08 ALLPOT  Pot done flags (stub V2: 0xFF = all done)
 *   $09 KBCODE  Keyboard scan code (stub V2: 0)
 *   $0A RANDOM  LFSR output (stub V2: 0)
 *   $0B SERIN   Serial in (stub V2: 0)
 *   $0D IRQST   IRQ status (stub V2: 0xFF = no IRQ pending, active-low)
 *   $0F SKSTAT  Serial status (stub V2: 0xFF)
 *
 * Marble usage from mailbox tracing: POKEY supplies the marble rolling rumble,
 * using four tone channels plus noise LFSR modulation.
 */

import type { u8 } from "../wrap.js";
import { as_u8 } from "../wrap.js";

/**
 * POKEY clock as exposed by MAME `marble -listxml`.
 *
 * Default native sample output is clock / 28, resampled later by the renderer.
 */
export const POKEY_CLOCK_HZ = 1_789_772;
export const POKEY_NATIVE_SAMPLE_RATE = POKEY_CLOCK_HZ / 28;
const POKEY_CYCLES_PER_SAMPLE = 28;

interface PokeyChannel {
  /** 8-bit channel counter. MAME increments until wrap, then starts borrow. */
  counter: number;
  /** Delayed borrow countdown (3/4/7 clocks in MAME depending on mode). */
  borrowCnt: number;
  /** Output flip-flop: 0 / 1, matching MAME's legacy linear POKEY stream. */
  output: number;
  /** High-pass filter sample latch. */
  filterSample: number;
}

export interface PokeyStateSnapshot {
  readonly outRaw: number;
  readonly rawInvalid: boolean;
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

export interface PokeyRawTransition {
  readonly cycle: number;
  readonly nativeSample: number;
  readonly cycleInNativeSample: number;
  readonly prevRaw: number;
  readonly raw: number;
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

export interface PokeyWriteSnapshot {
  readonly cycle: number;
  readonly nativeSample: number;
  readonly cycleInNativeSample: number;
  readonly reg: number;
  readonly val: number;
  readonly before: PokeyStateSnapshot;
  readonly after: PokeyStateSnapshot;
}

export interface POKEY {
  /** 16-byte write-register shadow, exposed for oracle diffs. */
  readonly writeRegs: Uint8Array;
  /** Four independent tone channels. */
  readonly channels: PokeyChannel[];
  /** 17-bit LFSR, the default polynomial source. */
  poly17: number;
  /** 9-bit LFSR. */
  poly9: number;
  /** 5-bit LFSR used to gate other polynomial sources. */
  poly5: number;
  /** 4-bit LFSR (high-tones). */
  poly4: number;
  /** Cycle accumulator from 6502 cycles to POKEY base clocks. */
  cycleAccumulator: number;
  /** Accumulator used to average high-clock output into the /28 native stream. */
  sampleAccumulator: number;
  /** Total POKEY clocks advanced since reset, used only by diagnostics. */
  elapsedCycles: number;
  /** Number of POKEY clocks averaged into each drained sample. Default 28. */
  sampleCycles: number;
  /** Diagnostics-only boundary selector for native output sampling. */
  sampleAfterClock: boolean;
  /** Per-channel accumulators used only by diagnostics. */
  diagnosticChannelAccumulators: number[];
  /** Optional per-channel sample buffers used only by diagnostics. */
  diagnosticChannelSampleBuffers: number[][] | undefined;
  /** Optional raw-latch transition trace used only by diagnostics. */
  diagnosticRawTransitionBuffer: PokeyRawTransition[] | undefined;
  /** Optional write-apply state trace used only by diagnostics. */
  diagnosticWriteBuffer: PokeyWriteSnapshot[] | undefined;
  /** Bit mask of channels with a non-zero AUDC volume nibble. */
  audibleMask: number;
  /** Bit mask of AUDC registers explicitly written since device creation/reset. */
  audcWrittenMask: number;
  /** Latched raw 4-bit channel volumes, matching MAME's m_out_raw stream source. */
  outRaw: number;
  /** Whether channel/register state must be folded into outRaw after the stream catches up. */
  rawInvalid: boolean;
  /** CLK_28 prescaler counter. */
  clockCnt28: number;
  /** CLK_114 prescaler counter. */
  clockCnt114: number;
  /** Drainable mono Float32 sample buffer. */
  sampleBuffer: number[];
}

export function createPOKEY(): POKEY {
  return {
    writeRegs: new Uint8Array(16),
    channels: Array.from({ length: 4 }, () => ({ counter: 0, borrowCnt: 0, output: 0, filterSample: 0 })),
    poly17: 0,
    poly9: 0,
    poly5: 0,
    poly4: 0,
    cycleAccumulator: 0,
    sampleAccumulator: 0,
    elapsedCycles: 0,
    sampleCycles: POKEY_CYCLES_PER_SAMPLE,
    sampleAfterClock: false,
    diagnosticChannelAccumulators: [0, 0, 0, 0],
    diagnosticChannelSampleBuffers: undefined,
    diagnosticRawTransitionBuffer: undefined,
    diagnosticWriteBuffer: undefined,
    audibleMask: 0,
    audcWrittenMask: 0,
    outRaw: 0,
    rawInvalid: true,
    clockCnt28: 0,
    clockCnt114: 0,
    sampleBuffer: [],
  };
}

function bit(value: number, pos: number): number {
  return (value >>> pos) & 1;
}

function initPoly45(size: 4 | 5): Uint32Array {
  const mask = (1 << size) - 1;
  const poly = new Uint32Array(mask);
  const xorbit = size - 1;
  let lfsr = 0;
  for (let i = 0; i < mask; i++) {
    const input = (~(((lfsr >>> 2) ^ (lfsr >>> xorbit)) & 1)) & 1;
    lfsr = ((lfsr << 1) | input) & mask;
    poly[i] = lfsr;
  }
  return poly;
}

function initPoly917(size: 9 | 17): Uint32Array {
  const mask = size === 17 ? 0x1ffff : 0x1ff;
  const poly = new Uint32Array(mask);
  let lfsr = mask;
  for (let i = 0; i < mask; i++) {
    if (size === 17) {
      const in8 = bit(lfsr, 8) ^ bit(lfsr, 13);
      const input = bit(lfsr, 0);
      lfsr >>>= 1;
      lfsr = (lfsr & 0xff7f) | (in8 << 7);
      lfsr = (input << 16) | lfsr;
    } else {
      const input = bit(lfsr, 0) ^ bit(lfsr, 5);
      lfsr >>>= 1;
      lfsr = (input << 8) | lfsr;
    }
    poly[i] = lfsr;
  }
  return poly;
}

const AUDC_NOT_POLY5 = 0x80;
const AUDC_POLY4 = 0x40;
const AUDC_PURE = 0x20;
const AUDC_VOLUME_ONLY = 0x10;
const AUDCTL_POLY9 = 0x80;
const AUDCTL_CH1_HICLK = 0x40;
const AUDCTL_CH3_HICLK = 0x20;
const AUDCTL_CH12_JOINED = 0x10;
const AUDCTL_CH34_JOINED = 0x08;
const AUDCTL_CH1_FILTER = 0x04;
const AUDCTL_CH2_FILTER = 0x02;
const AUDCTL_CLK_15KHZ = 0x01;
const SKCTL_RESET = 0x03;
const DIV_64 = 28;
const DIV_15 = 114;
const POKEY_MAME_VOLUME_STEP = 0.24 / (11 * 4);
const POKEY_DEFAULT_AUDC = 0xb0;
const POLY4 = initPoly45(4);
const POLY5 = initPoly45(5);
const POLY9 = initPoly917(9);
const POLY17 = initPoly917(17);

function audcForChannel(pk: POKEY, ch: number): number {
  const bit = 1 << ch;
  return (pk.audcWrittenMask & bit) === 0
    ? POKEY_DEFAULT_AUDC
    : (pk.writeRegs[ch * 2 + 1] ?? 0);
}

function incrementPolyPointers(pk: POKEY): void {
  pk.poly4++;
  if (pk.poly4 === 0x0f) pk.poly4 = 0;
  pk.poly5++;
  if (pk.poly5 === 0x1f) pk.poly5 = 0;
  pk.poly9++;
  if (pk.poly9 === 0x1ff) pk.poly9 = 0;
  pk.poly17++;
  if (pk.poly17 === 0x1ffff) pk.poly17 = 0;
}

function incChannel(pk: POKEY, ch: number, cycles: number): void {
  const channel = pk.channels[ch]!;
  channel.counter = (channel.counter + 1) & 0xff;
  if (channel.counter === 0 && channel.borrowCnt === 0) channel.borrowCnt = cycles;
}

function checkBorrow(pk: POKEY, ch: number): boolean {
  const channel = pk.channels[ch]!;
  if (channel.borrowCnt > 0) {
    channel.borrowCnt--;
    return channel.borrowCnt === 0;
  }
  return false;
}

function resetChannel(pk: POKEY, ch: number): void {
  const channel = pk.channels[ch]!;
  channel.counter = (pk.writeRegs[ch * 2] ?? 0) ^ 0xff;
  channel.borrowCnt = 0;
}

function processChannel(pk: POKEY, ch: number): void {
  const audctl = pk.writeRegs[0x08] ?? 0;
  const audc = audcForChannel(pk, ch);
  const channel = pk.channels[ch]!;
  if ((audc & AUDC_NOT_POLY5) !== 0 || ((POLY5[pk.poly5] ?? 0) & 1) !== 0) {
    if ((audc & AUDC_PURE) !== 0) {
      channel.output ^= 1;
    } else if ((audc & AUDC_POLY4) !== 0) {
      channel.output = (POLY4[pk.poly4] ?? 0) & 1;
    } else if ((audctl & AUDCTL_POLY9) !== 0) {
      channel.output = (POLY9[pk.poly9] ?? 0) & 1;
    } else {
      channel.output = (POLY17[pk.poly17] ?? 0) & 1;
    }
    pk.rawInvalid = true;
  }
}

/**
 * Mono sample output. AUDCTL routing:
 *   bit 4 (0x10): CH1+CH2 join -> 16-bit period counter (CH2 audf << 8 | CH1 audf)
 *   bit 3 (0x08): CH3+CH4 join
 *   bit 7 (0x80): poly9 noise mode instead of poly17
 *   bit 6/5 (0x40/0x20): 1.79MHz clock for CH1/CH3 vs the default 64KHz
 *     clock. Period scaling still belongs to the next accuracy pass.
 */
function computeRawSum(pk: POKEY): number {
  let sum = 0;
  for (let ch = 0; ch < 4; ch++) {
    const audc = audcForChannel(pk, ch);
    const vol = audc & 0xf;
    const channel = pk.channels[ch]!;
    if (vol !== 0 && (((channel.output ^ channel.filterSample) !== 0) || (audc & AUDC_VOLUME_ONLY) !== 0)) {
      sum |= vol << (ch * 4);
    }
  }
  return sum;
}

function pokeyChannelSample(pk: POKEY, ch: number): number {
  const vol = (pk.outRaw >>> (ch * 4)) & 0xf;
  return vol * POKEY_MAME_VOLUME_STEP;
}

function pokeyStateSnapshot(pk: POKEY): PokeyStateSnapshot {
  return {
    outRaw: pk.outRaw,
    rawInvalid: pk.rawInvalid,
    audf: [0, 1, 2, 3].map((ch) => pk.writeRegs[ch * 2] ?? 0),
    audc: [0, 1, 2, 3].map((ch) => audcForChannel(pk, ch)),
    audctl: pk.writeRegs[0x08] ?? 0,
    skctl: pk.writeRegs[0x0f] ?? 0,
    counters: pk.channels.map((channel) => channel.counter),
    borrowCnt: pk.channels.map((channel) => channel.borrowCnt),
    outputs: pk.channels.map((channel) => channel.output),
    filterSamples: pk.channels.map((channel) => channel.filterSample),
    poly4: pk.poly4,
    poly5: pk.poly5,
    poly9: pk.poly9,
    poly17: pk.poly17,
    clockCnt28: pk.clockCnt28,
    clockCnt114: pk.clockCnt114,
  };
}

function pokeySample(pk: POKEY, channelAccumulators?: number[]): number {
  let mix = 0;
  for (let ch = 0; ch < 4; ch++) {
    const sample = pokeyChannelSample(pk, ch);
    mix += sample;
    if (channelAccumulators !== undefined) channelAccumulators[ch] = (channelAccumulators[ch] ?? 0) + sample;
  }
  return mix;
}

function updateRawLatch(pk: POKEY, effectiveCycle: number): void {
  if (!pk.rawInvalid) return;
  pk.rawInvalid = false;
  const prevRaw = pk.outRaw;
  const raw = computeRawSum(pk);
  pk.outRaw = raw;
  if (prevRaw === raw || pk.diagnosticRawTransitionBuffer === undefined) return;
  pk.diagnosticRawTransitionBuffer.push({
    cycle: effectiveCycle,
    nativeSample: Math.floor(effectiveCycle / pk.sampleCycles),
    cycleInNativeSample: effectiveCycle % pk.sampleCycles,
    prevRaw,
    raw,
    audf: [0, 1, 2, 3].map((ch) => pk.writeRegs[ch * 2] ?? 0),
    audc: [0, 1, 2, 3].map((ch) => audcForChannel(pk, ch)),
    audctl: pk.writeRegs[0x08] ?? 0,
    skctl: pk.writeRegs[0x0f] ?? 0,
    counters: pk.channels.map((channel) => channel.counter),
    borrowCnt: pk.channels.map((channel) => channel.borrowCnt),
    outputs: pk.channels.map((channel) => channel.output),
    filterSamples: pk.channels.map((channel) => channel.filterSample),
    poly4: pk.poly4,
    poly5: pk.poly5,
    poly9: pk.poly9,
    poly17: pk.poly17,
    clockCnt28: pk.clockCnt28,
    clockCnt114: pk.clockCnt114,
  });
}

function stepOneClock(pk: POKEY, effectiveCycle: number): void {
  const audctl = pk.writeRegs[0x08] ?? 0;
  if ((pk.writeRegs[0x0f] ?? 0) & SKCTL_RESET) {
    incrementPolyPointers(pk);

    let clock28 = false;
    pk.clockCnt28++;
    if (pk.clockCnt28 >= DIV_64) {
      pk.clockCnt28 = 0;
      clock28 = true;
    }

    let clock114 = false;
    pk.clockCnt114++;
    if (pk.clockCnt114 >= DIV_15) {
      pk.clockCnt114 = 0;
      clock114 = true;
    }

    if ((audctl & AUDCTL_CH1_HICLK) !== 0) {
      incChannel(pk, 0, (audctl & AUDCTL_CH12_JOINED) !== 0 ? 7 : 4);
    }

    const baseClock = (audctl & AUDCTL_CLK_15KHZ) !== 0 ? clock114 : clock28;

    if ((audctl & AUDCTL_CH1_HICLK) === 0 && baseClock) incChannel(pk, 0, 1);

    if ((audctl & AUDCTL_CH3_HICLK) !== 0) {
      incChannel(pk, 2, (audctl & AUDCTL_CH34_JOINED) !== 0 ? 7 : 4);
    }

    if ((audctl & AUDCTL_CH3_HICLK) === 0 && baseClock) incChannel(pk, 2, 1);

    if (baseClock) {
      if ((audctl & AUDCTL_CH12_JOINED) === 0) incChannel(pk, 1, 1);
      if ((audctl & AUDCTL_CH34_JOINED) === 0) incChannel(pk, 3, 1);
    }
  }

  if (checkBorrow(pk, 2)) {
    if ((audctl & AUDCTL_CH34_JOINED) !== 0) {
      incChannel(pk, 3, 1);
    } else {
      resetChannel(pk, 2);
    }
    processChannel(pk, 2);
    pk.channels[0]!.filterSample = (audctl & AUDCTL_CH1_FILTER) !== 0 ? pk.channels[0]!.output : 1;
    pk.rawInvalid = true;
  }

  if (checkBorrow(pk, 3)) {
    if ((audctl & AUDCTL_CH34_JOINED) !== 0) resetChannel(pk, 2);
    resetChannel(pk, 3);
    processChannel(pk, 3);
    pk.channels[1]!.filterSample = (audctl & AUDCTL_CH2_FILTER) !== 0 ? pk.channels[1]!.output : 1;
    pk.rawInvalid = true;
  }

  if (checkBorrow(pk, 0)) {
    if ((audctl & AUDCTL_CH12_JOINED) !== 0) {
      incChannel(pk, 1, 1);
    } else {
      resetChannel(pk, 0);
    }
    processChannel(pk, 0);
  }

  if (checkBorrow(pk, 1)) {
    if ((audctl & AUDCTL_CH12_JOINED) !== 0) resetChannel(pk, 0);
    resetChannel(pk, 1);
    processChannel(pk, 1);
  }

  updateRawLatch(pk, effectiveCycle);
}

function accumulateOutputSample(pk: POKEY): void {
  const diagnosticChannelBuffers = pk.diagnosticChannelSampleBuffers;
  const diagnosticChannelAccumulators = diagnosticChannelBuffers === undefined
    ? undefined
    : pk.diagnosticChannelAccumulators;
  if (pk.outRaw !== 0 || pk.audibleMask !== 0) {
    pk.sampleAccumulator += pokeySample(pk, diagnosticChannelAccumulators);
  }
  pk.cycleAccumulator++;
  if (pk.cycleAccumulator >= pk.sampleCycles) {
    pk.cycleAccumulator = 0;
    pk.sampleBuffer.push(pk.sampleAccumulator / pk.sampleCycles);
    if (diagnosticChannelBuffers !== undefined) {
      for (let ch = 0; ch < diagnosticChannelBuffers.length; ch++) {
        diagnosticChannelBuffers[ch]!.push((diagnosticChannelAccumulators?.[ch] ?? 0) / pk.sampleCycles);
        pk.diagnosticChannelAccumulators[ch] = 0;
      }
    }
    pk.sampleAccumulator = 0;
  }
}

/** Advance POKEY by N 6502 cycles and produce native-rate samples. */
export function pokeyTickCycles(pk: POKEY, cycles6502: number): void {
  for (let i = 0; i < cycles6502; i++) {
    const effectiveCycle = pk.elapsedCycles + 1;
    if (pk.sampleAfterClock) {
      stepOneClock(pk, effectiveCycle);
      pk.elapsedCycles = effectiveCycle;
      accumulateOutputSample(pk);
      continue;
    }

    // MAME flushes the sound stream with the current raw output before a
    // clock edge updates channel state; the new raw value is audible after it.
    accumulateOutputSample(pk);
    stepOneClock(pk, effectiveCycle);
    pk.elapsedCycles = effectiveCycle;
  }
}

/** Drain mono samples. */
export function pokeyDrainSamples(pk: POKEY): number[] {
  const buf = pk.sampleBuffer;
  pk.sampleBuffer = [];
  return buf;
}

export function pokeySampleRate(pk: POKEY): number {
  return POKEY_CLOCK_HZ / pk.sampleCycles;
}

export function pokeySetSampleCycles(pk: POKEY, cycles: number): void {
  const sampleCycles = Number.isFinite(cycles) ? Math.max(1, Math.trunc(cycles)) : POKEY_CYCLES_PER_SAMPLE;
  pk.sampleCycles = sampleCycles;
  pk.cycleAccumulator = 0;
  pk.sampleAccumulator = 0;
  pk.diagnosticChannelAccumulators = [0, 0, 0, 0];
  if (pk.diagnosticChannelSampleBuffers !== undefined) {
    pk.diagnosticChannelSampleBuffers = Array.from({ length: 4 }, () => []);
  }
  pk.sampleBuffer = [];
}

export function pokeySetSampleAfterClock(pk: POKEY, enabled: boolean): void {
  pk.sampleAfterClock = enabled;
  pk.cycleAccumulator = 0;
  pk.sampleAccumulator = 0;
  pk.diagnosticChannelAccumulators = [0, 0, 0, 0];
  if (pk.diagnosticChannelSampleBuffers !== undefined) {
    pk.diagnosticChannelSampleBuffers = Array.from({ length: 4 }, () => []);
  }
  pk.sampleBuffer = [];
}

export function pokeySetDiagnosticChannelSamples(pk: POKEY, enabled: boolean): void {
  pk.diagnosticChannelAccumulators = [0, 0, 0, 0];
  pk.diagnosticChannelSampleBuffers = enabled
    ? Array.from({ length: 4 }, () => [])
    : undefined;
}

export function pokeySetDiagnosticRawTransitions(pk: POKEY, enabled: boolean): void {
  pk.diagnosticRawTransitionBuffer = enabled ? [] : undefined;
}

export function pokeySetDiagnosticWrites(pk: POKEY, enabled: boolean): void {
  pk.diagnosticWriteBuffer = enabled ? [] : undefined;
}

export function pokeyDrainDiagnosticRawTransitions(pk: POKEY): PokeyRawTransition[] | undefined {
  const buffer = pk.diagnosticRawTransitionBuffer;
  if (buffer === undefined) return undefined;
  const out = buffer.slice();
  buffer.length = 0;
  return out;
}

export function pokeyDrainDiagnosticWrites(pk: POKEY): PokeyWriteSnapshot[] | undefined {
  const buffer = pk.diagnosticWriteBuffer;
  if (buffer === undefined) return undefined;
  const out = buffer.slice();
  buffer.length = 0;
  return out;
}

export function pokeyDrainDiagnosticChannelSamples(pk: POKEY): number[][] | undefined {
  const buffers = pk.diagnosticChannelSampleBuffers;
  if (buffers === undefined) return undefined;
  const out = buffers.map((buf) => buf.slice());
  for (const buf of buffers) buf.length = 0;
  return out;
}

/** Write to `$1870..$187F`: store the byte in the corresponding write register. */
export function pokeyWrite(pk: POKEY, addr: u8, data: u8): void {
  const idx = (addr as number) & 0x0f;
  const prev = pk.writeRegs[idx] ?? 0;
  const before = pk.diagnosticWriteBuffer === undefined ? undefined : pokeyStateSnapshot(pk);
  pk.writeRegs[idx] = data as number;
  if (idx < 0x08 && (idx & 1) !== 0) {
    const ch = idx >> 1;
    const bit = 1 << ch;
    pk.audcWrittenMask |= bit;
    if (((data as number) & 0x0f) !== 0) pk.audibleMask |= bit;
    else pk.audibleMask &= ~bit;
    pk.rawInvalid = true;
  } else if (idx === 0x08 && prev !== (data as number)) {
    pk.rawInvalid = true;
  }
  if (idx === 0x09) {
    for (let i = 0; i < 4; i++) {
      resetChannel(pk, i);
      pk.channels[i]!.output = 0;
      pk.channels[i]!.filterSample = i < 2 ? 1 : 0;
    }
    pk.rawInvalid = true;
  } else if (idx === 0x0f && prev !== (data as number)) {
    if (((data as number) & SKCTL_RESET) === 0) {
      pk.poly17 = 0;
      pk.poly9 = 0;
      pk.poly5 = 0;
      pk.poly4 = 0;
      pk.clockCnt28 = 0;
      pk.clockCnt114 = 0;
    }
    pk.rawInvalid = true;
  }
  if (pk.diagnosticWriteBuffer !== undefined && before !== undefined) {
    pk.diagnosticWriteBuffer.push({
      cycle: pk.elapsedCycles,
      nativeSample: Math.floor(pk.elapsedCycles / pk.sampleCycles),
      cycleInNativeSample: pk.elapsedCycles % pk.sampleCycles,
      reg: idx,
      val: data as number,
      before,
      after: pokeyStateSnapshot(pk),
    });
  }
}

/**
 * Read from `$1870..$187F`: dispatch through the distinct POKEY read-register
 * address space. Pot, keyboard, and serial inputs return sentinel values.
 */
export function pokeyRead(_pk: POKEY, addr: u8): u8 {
  const idx = (addr as number) & 0x0f;
  switch (idx) {
    case 0x00: case 0x01: case 0x02: case 0x03:
    case 0x04: case 0x05: case 0x06: case 0x07:
      return as_u8(0);     // POT0..POT7
    case 0x08: return as_u8(0xff);   // ALLPOT (all done)
    case 0x09: return as_u8(0);      // KBCODE
    case 0x0a: return as_u8(0);      // RANDOM (V3 LFSR)
    case 0x0b: return as_u8(0);      // SERIN
    case 0x0d: return as_u8(0xff);   // IRQST (no IRQ pending, active-low)
    case 0x0f: return as_u8(0xff);   // SKSTAT
    default:   return as_u8(0xff);   // open bus
  }
}

/** Hard reset the write register file, polynomial state, and channels. */
export function pokeyReset(pk: POKEY): void {
  pk.writeRegs.fill(0);
  pk.poly17 = 0;
  pk.poly9 = 0;
  pk.poly5 = 0;
  pk.poly4 = 0;
  for (const ch of pk.channels) { ch.counter = 0; ch.borrowCnt = 0; ch.output = 0; ch.filterSample = 0; }
  pk.cycleAccumulator = 0;
  pk.sampleAccumulator = 0;
  pk.elapsedCycles = 0;
  pk.sampleCycles = POKEY_CYCLES_PER_SAMPLE;
  pk.sampleAfterClock = false;
  pk.diagnosticChannelAccumulators = [0, 0, 0, 0];
  if (pk.diagnosticChannelSampleBuffers !== undefined) {
    pk.diagnosticChannelSampleBuffers = Array.from({ length: 4 }, () => []);
  }
  if (pk.diagnosticRawTransitionBuffer !== undefined) pk.diagnosticRawTransitionBuffer = [];
  if (pk.diagnosticWriteBuffer !== undefined) pk.diagnosticWriteBuffer = [];
  pk.audibleMask = 0;
  pk.audcWrittenMask = 0;
  pk.outRaw = 0;
  pk.rawInvalid = true;
  pk.clockCnt28 = 0;
  pk.clockCnt114 = 0;
  pk.sampleBuffer = [];
}
