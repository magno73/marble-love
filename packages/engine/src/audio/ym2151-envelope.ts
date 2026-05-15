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

import { ENV_RATE_TABLE } from "./ym2151-tables.js";

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

/** Avanza envelope per 1 sample. ar/d1r/d2r/rr sono rate 0..31 (1F).
 * d1l è sustain level 0..15 (4-bit). Ritorna attenuation effettivo 0..1023. */
export function envelopeAdvance(
  env: EnvelopeState,
  ar: number, d1r: number, d2r: number, rr: number, d1l: number,
): number {
  // Aumenta subCounter ogni sample (modulo 8).
  env.subCounter = (env.subCounter + 1) & 7;
  const phase = env.subCounter;

  switch (env.state) {
    case ENV_STATE_ATTACK: {
      // AR rate * 2 = effective rate (OPM convention).
      const rate = Math.min(63, ar * 2);
      const step = ENV_RATE_TABLE[rate * 8 + phase] ?? 0;
      if (step > 0) {
        // Attack curve: decay verso 0, ma con shape esponenziale.
        // MAME approximation: counter -= ((counter >> 4) + 1) * step
        env.counter -= ((env.counter >> 4) + 1) * step;
        if (env.counter <= 0) {
          env.counter = 0;
          env.state = ENV_STATE_DECAY;
        }
      }
      break;
    }
    case ENV_STATE_DECAY: {
      const rate = Math.min(63, d1r * 2);
      const step = ENV_RATE_TABLE[rate * 8 + phase] ?? 0;
      env.counter += step;
      // Sustain level = d1l * 64 (d1l è 4-bit, mapped a 6-bit shift).
      // d1l = 15 → silence target (= sustain mai raggiunto, decay continua).
      const sustainTarget = d1l === 15 ? 1023 : d1l * 64;
      if (env.counter >= sustainTarget) {
        env.counter = sustainTarget;
        env.state = ENV_STATE_SUSTAIN;
      }
      break;
    }
    case ENV_STATE_SUSTAIN: {
      const rate = Math.min(63, d2r * 2);
      const step = ENV_RATE_TABLE[rate * 8 + phase] ?? 0;
      env.counter += step;
      if (env.counter >= 1023) {
        env.counter = 1023;
        env.state = ENV_STATE_OFF;
      }
      break;
    }
    case ENV_STATE_RELEASE: {
      // RR è 4-bit; effective rate = rr * 2 + 1.
      const rate = Math.min(63, rr * 2 + 1);
      const step = ENV_RATE_TABLE[rate * 8 + phase] ?? 0;
      env.counter += step;
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
