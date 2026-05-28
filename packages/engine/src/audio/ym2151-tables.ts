/**
 * ym2151-tables.ts - hardware-oriented lookup tables for YM2151 FM synthesis.
 *
 * Reference: Yamaha YM2151 OPM datasheet + MAME ym2151.cpp + reverse-engineered
 * tables (Jarek Burczynski's documentation).
 *
 * Tables are computed once at module initialization.
 *
 * Hardware constants:
 *   Clock 3.579545 MHz / 64 (output divisor) = 55930 Hz native sample rate.
 *   Sine LUT: 1024 entries (10-bit phase fraction), 14-bit signed output.
 *   Envelope: log2 attenuation table 0..4095 (12-bit), then exp lookup.
 */

/** Sine LUT: 1024 entries x 14-bit signed (-8192..+8191).
 * Pre-computed sin(2*pi*i/1024)*8191. Phase uses a 10-bit index. */
export const SINE_TABLE: Int16Array = (() => {
  const t = new Int16Array(1024);
  for (let i = 0; i < 1024; i++) {
    t[i] = Math.round(Math.sin((2 * Math.PI * i) / 1024) * 8191);
  }
  return t;
})();

/** YM2151 detune (DT1) table: 4 levels x 32 keycodes -> frequency offset.
 * DT1=0 is no detune; DT1=1..3 are progressively sharp approximations. */
export const DT1_TABLE: Int8Array = (() => {
  const t = new Int8Array(4 * 32);
  // Approximation of MAME ym2151.cpp dt1_freq[4][32]. This stays deliberately
  // simple until the next chip-accuracy pass.
  for (let lev = 0; lev < 4; lev++) {
    for (let kc = 0; kc < 32; kc++) {
      t[lev * 32 + kc] = (lev * (kc + 8)) >> 2;  // Approximation.
    }
  }
  return t;
})();

/** Multiplier (MUL 0..15) -> frequency factor (1/2, 1, 2, 3, ..., 15). */
export const MUL_TABLE: Float32Array = (() => {
  const t = new Float32Array(16);
  t[0] = 0.5;
  for (let i = 1; i < 16; i++) t[i] = i;
  return t;
})();

/** Key code -> frequency Hz table (32 entries x 8 octaves = 256; OPM uses
 * 12 notes per octave, skipping 3,7,11,15). Reference: A4 ($4A) approx 277.18Hz
 * (D#/Eb in OPM mapping). Hardware uses log2 phase increment lookup. */
export const KC_TO_FREQ: Float32Array = (() => {
  const t = new Float32Array(256);
  // OPM note codes per octave: 0,1,2,4,5,6,8,9,10,12,13,14 (skip 3,7,11,15).
  const noteSemi: Record<number, number> = {
    0: 0, 1: 1, 2: 2, /*3 skip*/
    4: 3, 5: 4, 6: 5, /*7 skip*/
    8: 6, 9: 7, 10: 8, /*11 skip*/
    12: 9, 13: 10, 14: 11, /*15 skip*/
  };
  for (let kc = 0; kc < 256; kc++) {
    const octave = (kc >> 4) & 7;
    const noteIdx = kc & 0x0f;
    const semi = noteSemi[noteIdx];
    if (semi === undefined) { t[kc] = 0; continue; }
    // Reference: KC $4A (octave 4, note 10 = A in mapping) -> A4 = ~440Hz.
    // Actually OPM A4 mapping differs; using musical standard A4=440 @ KC=$4A
    // is an approximation. Real OPM: f = 8.1758 * 2^(octave + semi/12).
    t[kc] = 8.1758 * Math.pow(2, octave + semi / 12);
  }
  return t;
})();

/**
 * ENV_RATE_SHIFT: for each rate (0..63), right shift applied to the envelope
 * counter before checking whether the envelope increments.
 *
 * Source: MAME `ym2151.cpp::eg_rate_shift`.
 */
export const ENV_RATE_SHIFT: Uint8Array = new Uint8Array([
  11, 11, 11, 11, 11, 11, 11, 11,  //  0..7
  11, 11, 11, 11, 10, 10, 10, 10,  //  8..15
   9,  9,  9,  9,  8,  8,  8,  8,  // 16..23
   7,  7,  7,  7,  6,  6,  6,  6,  // 24..31
   5,  5,  5,  5,  4,  4,  4,  4,  // 32..39
   3,  3,  3,  3,  2,  2,  2,  2,  // 40..47
   1,  1,  1,  1,  0,  0,  0,  0,  // 48..55
   0,  0,  0,  0,  0,  0,  0,  0,  // 56..63
]);

/**
 * ENV_RATE_SELECT: for each rate (0..63), index into the EG increment pattern.
 *
 * Source: MAME `ym2151.cpp::eg_rate_select`.
 */
export const ENV_RATE_SELECT: Uint8Array = new Uint8Array([
  18, 18, 18, 18, 18, 18, 18, 18,  //  0..7   (rate <=1: hard-coded zero)
   0,  1,  2,  3,  0,  1,  2,  3,  //  8..15
   0,  1,  2,  3,  0,  1,  2,  3,
   0,  1,  2,  3,  0,  1,  2,  3,
   0,  1,  2,  3,  0,  1,  2,  3,
   0,  1,  2,  3,  0,  1,  2,  3,
   0,  1,  2,  3,  0,  1,  2,  3,
   4,  5,  6,  7,  8,  9, 10, 11,  // 56..63
   12, 12, 12, 12, 12, 12, 12, 12,
].slice(0, 64));

/**
 * EG_INC: 19 select rows times 8 steps.
 *
 * Source: MAME `ym2151.cpp::eg_inc`. Values 0/1/2/4/8 are envelope step
 * amounts.
 */
export const EG_INC: Uint8Array = new Uint8Array([
  // 0: 0,1, 0,1, 0,1, 0,1   slow rate (1/8)
  0, 1, 0, 1, 0, 1, 0, 1,
  // 1: 0,1, 0,1, 1,1, 0,1
  0, 1, 0, 1, 1, 1, 0, 1,
  // 2: 0,1, 1,1, 0,1, 1,1
  0, 1, 1, 1, 0, 1, 1, 1,
  // 3: 0,1, 1,1, 1,1, 1,1
  0, 1, 1, 1, 1, 1, 1, 1,
  // 4: 1,1, 1,1, 1,1, 1,1   medium
  1, 1, 1, 1, 1, 1, 1, 1,
  // 5: 1,1, 1,2, 1,1, 1,2
  1, 1, 1, 2, 1, 1, 1, 2,
  // 6: 1,2, 1,2, 1,2, 1,2
  1, 2, 1, 2, 1, 2, 1, 2,
  // 7: 1,2, 2,2, 1,2, 2,2
  1, 2, 2, 2, 1, 2, 2, 2,
  // 8: 2,2, 2,2, 2,2, 2,2   fast
  2, 2, 2, 2, 2, 2, 2, 2,
  // 9: 2,2, 2,4, 2,2, 2,4
  2, 2, 2, 4, 2, 2, 2, 4,
  // 10: 2,4, 2,4, 2,4, 2,4
  2, 4, 2, 4, 2, 4, 2, 4,
  // 11: 2,4, 4,4, 2,4, 4,4
  2, 4, 4, 4, 2, 4, 4, 4,
  // 12: 4,4, 4,4, 4,4, 4,4
  4, 4, 4, 4, 4, 4, 4, 4,
  // 13: 4,4, 4,8, 4,4, 4,8
  4, 4, 4, 8, 4, 4, 4, 8,
  // 14: 4,8, 4,8, 4,8, 4,8
  4, 8, 4, 8, 4, 8, 4, 8,
  // 15: 4,8, 8,8, 4,8, 8,8
  4, 8, 8, 8, 4, 8, 8, 8,
  // 16: 8,8, 8,8, 8,8, 8,8   fastest
  8, 8, 8, 8, 8, 8, 8, 8,
  // 17: max step (one-shot inst)
  8, 8, 8, 8, 8, 8, 8, 8,
  // 18: zero (rate <=1 silent)
  0, 0, 0, 0, 0, 0, 0, 0,
]);

/** Legacy stub kept for compatibility (unused after envelope refactor). */
export const ENV_RATE_TABLE: Uint16Array = new Uint16Array(64 * 8);

/**
 * Attenuation table in the dB domain: index 0..1023 -> linear amplitude scale.
 *
 * Hardware OPM has roughly 96 dB maximum attenuation at counter 1023.
 */
export const ATT_TO_LINEAR: Float32Array = (() => {
  const t = new Float32Array(1024);
  for (let i = 0; i < 1024; i++) {
    if (i >= 1023) { t[i] = 0; continue; }
    // dB curve: 96 dB span.
    t[i] = Math.pow(10, -(i / 1023) * 4.8);
  }
  return t;
})();
