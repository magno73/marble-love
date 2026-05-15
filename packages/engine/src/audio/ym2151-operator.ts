/**
 * ym2151-operator.ts — Un singolo operatore FM YM2151.
 *
 * Hardware: 32 operatori totali = 8 channel × 4 operator per channel.
 * Ogni operatore: phase accumulator + sine LUT + envelope generator + TL.
 *
 * Output sample = SINE[phase] × envelope_attenuation × TL_attenuation
 *
 * Reference: Yamaha OPM datasheet § 4.2.
 */

import { type EnvelopeState, createEnvelope, envelopeAdvance, envelopeKeyOn, envelopeKeyOff } from "./ym2151-envelope.js";
import { SINE_TABLE, MUL_TABLE, ATT_TO_LINEAR } from "./ym2151-tables.js";

export interface Operator {
  /** Phase accumulator 20-bit (top 10 bit = sine LUT index). */
  phase: number;
  /** Phase increment per sample, calcolato da KC+KF+DT1+MUL. */
  phaseInc: number;
  /** Envelope generator state. */
  env: EnvelopeState;
  /** Total level (TL) 0..127, 0 = loud, 127 = silent. */
  tl: number;
  /** Detune 1 level 0..7. */
  dt1: number;
  /** Multiplier 0..15 (mapped via MUL_TABLE). */
  mul: number;
  /** Key scale 0..3. */
  ks: number;
  /** Attack rate 0..31. */
  ar: number;
  /** Decay 1 rate 0..31. */
  d1r: number;
  /** Decay 2 rate 0..31. */
  d2r: number;
  /** Release rate 0..15. */
  rr: number;
  /** Decay 1 level 0..15 (sustain transition point). */
  d1l: number;
}

export function createOperator(): Operator {
  return {
    phase: 0,
    phaseInc: 0,
    env: createEnvelope(),
    tl: 127,  // silent default
    dt1: 0, mul: 1, ks: 0,
    ar: 0, d1r: 0, d2r: 0, rr: 0, d1l: 0,
  };
}

/** Aggiorna phaseInc dato il key code base (Hz) e MUL.
 * phaseInc è in unità di phase per sample @ 55930Hz (sample rate native).
 * 1024 phase units = 1 ciclo sinusoide. */
export function operatorSetFreq(op: Operator, baseFreqHz: number, sampleRate: number): void {
  const mul = MUL_TABLE[op.mul] ?? 1;
  // Phase increment per sample: (freq_Hz × mul / sample_rate) × 1024 phase units
  op.phaseInc = (baseFreqHz * mul / sampleRate) * 1024;
}

/** Avanza phase per 1 sample. Ritorna sine output × envelope attenuation.
 * Input `modulation`: phase offset da modulator operatori (FM). */
export function operatorSample(op: Operator, modulation: number = 0): number {
  // Advance envelope (sub-counter)
  const envAtt = envelopeAdvance(op.env, op.ar, op.d1r, op.d2r, op.rr, op.d1l);
  // Total attenuation = envelope + TL_shift
  // TL contribution: 0=loud, 127=silent. Linear mapping a 0..1023 (= 10 bit).
  const tlAtt = op.tl << 3;  // TL × 8 = 0..1016
  const totalAtt = Math.min(1023, envAtt + tlAtt);
  if (totalAtt >= 1023) {
    // Below noise floor, skip sine compute
    op.phase += op.phaseInc;
    return 0;
  }
  // Read sine table at (phase + modulation) >> 10 bits index
  const phaseIdx = (((op.phase + modulation) >>> 0) >> 10) & 0x3ff;
  const sineRaw = SINE_TABLE[phaseIdx] ?? 0;  // -8192..+8191
  // dB-domain attenuation (MAME-faithful): exponential curve, 96dB span.
  const scaled = sineRaw * (ATT_TO_LINEAR[totalAtt] ?? 0);
  op.phase += op.phaseInc;
  if (op.phase >= (1 << 20)) op.phase -= (1 << 20);
  return scaled;
}

/** Key ON: trigger envelope attack. */
export function operatorKeyOn(op: Operator): void {
  envelopeKeyOn(op.env);
  op.phase = 0;
}

/** Key OFF: trigger envelope release. */
export function operatorKeyOff(op: Operator): void {
  envelopeKeyOff(op.env);
}
