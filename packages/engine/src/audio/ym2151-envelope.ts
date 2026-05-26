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

/** Envelope clock counter (shared tra tutti gli operator).
 * Incrementa ogni sample, usato come "tempo" globale del envelope generator. */
let globalEnvClock = 0;
let globalEnvDivider = 0;
let globalEnvClockAdvanced = false;
export function resetEnvClock(): void {
  globalEnvClock = 0;
  globalEnvDivider = 0;
  globalEnvClockAdvanced = false;
}
export function tickEnvClock(): void {
  globalEnvClockAdvanced = false;
  globalEnvDivider++;
  if (globalEnvDivider < 3) return;
  globalEnvDivider = 0;
  globalEnvClock = (globalEnvClock + 1) & 0xffffffff;
  globalEnvClockAdvanced = true;
}
export function getEnvClock(): number { return globalEnvClock; }

const ATTENUATION_INCREMENT: ReadonlyArray<number> = [
  0x00000000, 0x00000000, 0x10101010, 0x10101010,
  0x10101010, 0x10101010, 0x11101110, 0x11101110,
  0x10101010, 0x10111010, 0x11101110, 0x11111110,
  0x10101010, 0x10111010, 0x11101110, 0x11111110,
  0x10101010, 0x10111010, 0x11101110, 0x11111110,
  0x10101010, 0x10111010, 0x11101110, 0x11111110,
  0x10101010, 0x10111010, 0x11101110, 0x11111110,
  0x10101010, 0x10111010, 0x11101110, 0x11111110,
  0x10101010, 0x10111010, 0x11101110, 0x11111110,
  0x10101010, 0x10111010, 0x11101110, 0x11111110,
  0x10101010, 0x10111010, 0x11101110, 0x11111110,
  0x10101010, 0x10111010, 0x11101110, 0x11111110,
  0x11111111, 0x21112111, 0x21212121, 0x22212221,
  0x22222222, 0x42224222, 0x42424242, 0x44424442,
  0x44444444, 0x84448444, 0x84848484, 0x88848884,
  0x88888888, 0x88888888, 0x88888888, 0x88888888,
];

/** Compute step amount per il rate corrente + env clock corrente.
 * ymfm-faithful: env_counter is a divided EG clock, then rate controls both
 * the fractional clock gate and the 3-bit nibble selected from the increment
 * table. */
function rateStep(rate: number): number {
  if (rate < 2 || !globalEnvClockAdvanced) return 0;
  const r = Math.min(63, rate);
  const rateShift = r >> 2;
  const shiftedClock = globalEnvClock * (2 ** rateShift);
  if (shiftedClock % 0x800 !== 0) return 0;
  const relevantShift = rateShift <= 11 ? 11 : rateShift;
  const relevantBits = Math.floor(shiftedClock / (2 ** relevantShift)) & 7;
  return ((ATTENUATION_INCREMENT[r] ?? 0) >> (4 * relevantBits)) & 0x0f;
}

function effectiveRate(rawRate: number, ks: number, keyCode: number): number {
  if (rawRate === 0) return 0;
  const ksr = (keyCode & 0x1f) >> ((ks & 0x03) ^ 0x03);
  return Math.min(63, rawRate + ksr);
}

function sustainLevel(d1l: number): number {
  const level = (d1l & 0x0f) | (((d1l & 0x0f) + 1) & 0x10);
  return level << 5;
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
   * In ATTACK: scende verso 0 partendo dall'attenuazione corrente.
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

/** Key ON: transizione → ATTACK fase. OPM non resetta l'attenuazione a
 * silenzio sui retrigger; l'attacco riparte dal counter corrente. */
export function envelopeKeyOn(env: EnvelopeState): void {
  env.state = ENV_STATE_ATTACK;
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
  ar: number, d1r: number, d2r: number, rr: number, d1l: number, ks = 0, keyCode = 0,
): number {
  switch (env.state) {
    case ENV_STATE_ATTACK: {
      const rate = effectiveRate(ar * 2, ks, keyCode);
      if (rate >= 62) {
        env.counter = 0;
        env.state = ENV_STATE_DECAY;
        break;
      }
      const step = rateStep(rate);
      if (step > 0) {
        // Attack: exponential curve verso 0. ymfm applies a negative delta:
        // attenuation += (~attenuation * step) >> 4.
        env.counter += ((~env.counter * step) >> 4);
        if (env.counter <= 0) {
          env.counter = 0;
          env.state = ENV_STATE_DECAY;
        }
      }
      break;
    }
    case ENV_STATE_DECAY: {
      const step = rateStep(effectiveRate(d1r * 2, ks, keyCode));
      env.counter += step;
      const sustainTarget = sustainLevel(d1l);
      if (env.counter >= sustainTarget) {
        env.counter = sustainTarget;
        env.state = ENV_STATE_SUSTAIN;
      }
      break;
    }
    case ENV_STATE_SUSTAIN: {
      env.counter += rateStep(effectiveRate(d2r * 2, ks, keyCode));
      if (env.counter >= 1023) {
        env.counter = 1023;
        env.state = ENV_STATE_OFF;
      }
      break;
    }
    case ENV_STATE_RELEASE: {
      env.counter += rateStep(effectiveRate(rr * 4 + 2, ks, keyCode));
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
