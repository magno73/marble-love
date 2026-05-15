/**
 * ym2151-envelope.ts — Envelope generator per YM2151 operator (4-stage ADSR).
 *
 * Hardware state machine OPM:
 *   ATTACK (AR)    → counter sale rapidamente verso 0 (= max volume)
 *   DECAY 1 (D1R)  → counter scende fino a D1L (sustain level)
 *   DECAY 2 (D2R)  → counter continua a scendere lentamente verso silence
 *   RELEASE (RR)   → su KEY OFF, counter scende verso silence con RR rate
 *
 * Envelope counter: 10-bit, 0=max volume, 0x3FF=silence.
 * Final attenuation: counter + TL (total level, 0..127).
 *
 * Reference: Yamaha OPM application manual + MAME ym2151.cpp:envelope_update.
 */

import { ENV_RATE_SHIFT, ENV_RATE_SELECT, EG_INC } from "./ym2151-tables.js";

/** Envelope clock counter (shared tra tutti gli operator).
 * Incrementa ogni sample, usato come "tempo" globale del envelope generator. */
let globalEnvClock = 0;
export function resetEnvClock(): void { globalEnvClock = 0; }
export function tickEnvClock(): void { globalEnvClock = (globalEnvClock + 1) & 0xffffffff; }
export function getEnvClock(): number { return globalEnvClock; }

/** Compute step amount per il rate corrente + env clock corrente.
 * MAME-faithful: (clock >> rate_shift[r]) & 7 → eg_inc index → step amount. */
function rateStep(rate: number): number {
  if (rate < 2) return 0;
  const r = Math.min(63, rate);
  const shift = ENV_RATE_SHIFT[r]!;
  // Skip steps based on shift: counter checked solo se (clock & ((1<<shift)-1)) == 0
  // Then phase = (clock >> shift) & 7 → eg_inc table index
  if (shift > 0 && (globalEnvClock & ((1 << shift) - 1)) !== 0) return 0;
  const select = ENV_RATE_SELECT[r]!;
  const phase = (globalEnvClock >> shift) & 7;
  return EG_INC[select * 8 + phase] ?? 0;
}

export const ENV_STATE_OFF = 0;
export const ENV_STATE_ATTACK = 1;
export const ENV_STATE_DECAY = 2;   // D1R fase
export const ENV_STATE_SUSTAIN = 3; // D2R fase (post D1L reached)
export const ENV_STATE_RELEASE = 4;

export interface EnvelopeState {
  /** Phase corrente: OFF / ATTACK / DECAY / SUSTAIN / RELEASE. */
  state: number;
  /** Envelope counter 0..1023 (0 = max volume, 1023 = silence).
   * In ATTACK: parte da 1023, scende verso 0.
   * In DECAY: parte da 0, sale verso D1L (sustain level).
   * In SUSTAIN: continua a salire verso 1023 col D2R rate.
   * In RELEASE: sale verso 1023 col RR rate. */
  counter: number;
  /** Sub-counter per gestire i 8 step di ENV_RATE_TABLE. */
  subCounter: number;
}

export function createEnvelope(): EnvelopeState {
  return { state: ENV_STATE_OFF, counter: 1023, subCounter: 0 };
}

/** Key ON: transizione → ATTACK fase, counter resetta a 1023 (poi scende). */
export function envelopeKeyOn(env: EnvelopeState): void {
  env.state = ENV_STATE_ATTACK;
  env.counter = 1023;
  env.subCounter = 0;
}

/** Key OFF: transizione → RELEASE fase. */
export function envelopeKeyOff(env: EnvelopeState): void {
  if (env.state !== ENV_STATE_OFF) env.state = ENV_STATE_RELEASE;
}

/** Avanza envelope per 1 sample (MAME-faithful rate table + eg_inc pattern).
 * ar/d1r/d2r 0..31, rr 0..15, d1l 0..15. Ritorna attenuation 0..1023. */
export function envelopeAdvance(
  env: EnvelopeState,
  ar: number, d1r: number, d2r: number, rr: number, d1l: number,
): number {
  switch (env.state) {
    case ENV_STATE_ATTACK: {
      const rate = ar * 2;  // OPM: AR rate * 2 = effective rate
      const step = rateStep(rate);
      if (step > 0) {
        // Attack: exponential curve verso 0. MAME formula:
        // counter = ~((~counter * step) >> 4)
        env.counter = ~((~env.counter * step) >> 4);
        if (env.counter <= 0) {
          env.counter = 0;
          env.state = ENV_STATE_DECAY;
        }
      }
      break;
    }
    case ENV_STATE_DECAY: {
      const step = rateStep(d1r * 2);
      env.counter += step;
      const sustainTarget = d1l === 15 ? 1023 : d1l * 64;
      if (env.counter >= sustainTarget) {
        env.counter = sustainTarget;
        env.state = ENV_STATE_SUSTAIN;
      }
      break;
    }
    case ENV_STATE_SUSTAIN: {
      env.counter += rateStep(d2r * 2);
      if (env.counter >= 1023) {
        env.counter = 1023;
        env.state = ENV_STATE_OFF;
      }
      break;
    }
    case ENV_STATE_RELEASE: {
      // RR è 4-bit; effective rate = rr * 2 + 1
      env.counter += rateStep(rr * 2 + 1);
      if (env.counter >= 1023) {
        env.counter = 1023;
        env.state = ENV_STATE_OFF;
      }
      break;
    }
    case ENV_STATE_OFF:
    default:
      env.counter = 1023;
      break;
  }
  return env.counter;
}
