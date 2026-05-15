/**
 * ym2151-tables.ts — Lookup tables hardware-accurate per YM2151 FM synthesis.
 *
 * Reference: Yamaha YM2151 OPM datasheet + MAME ym2151.cpp + reverse-engineered
 * tables (Jarek Burczynski's documentation).
 *
 * Tutte le tabelle sono compute una sola volta (lazy init module-level).
 *
 * Hardware constants:
 *   Clock 3.579545 MHz / 64 (output divisor) = 55930 Hz native sample rate.
 *   Sine LUT: 1024 entries (10-bit phase fraction), 14-bit signed output.
 *   Envelope: log2 attenuation table 0..4095 (12-bit), then exp lookup.
 */

/** Sine LUT: 1024 entries × 14-bit signed (-8192..+8191).
 * Pre-computed sin(2π × i / 1024) × 8191. Phase è indice 10-bit. */
export const SINE_TABLE: Int16Array = (() => {
  const t = new Int16Array(1024);
  for (let i = 0; i < 1024; i++) {
    t[i] = Math.round(Math.sin((2 * Math.PI * i) / 1024) * 8191);
  }
  return t;
})();

/** YM2151 detune (DT1) table: 4 levels × 32 keycode → freq offset in cents.
 * DT1=0 → no detune. DT1=1..3 progressive sharp. Hardware semplificato. */
export const DT1_TABLE: Int8Array = (() => {
  const t = new Int8Array(4 * 32);
  // MAME ym2151.cpp dt1_freq[4][32] approximation. Per V3 minimal: stub
  // costanti per ogni level (perfezionamento V3.1).
  for (let lev = 0; lev < 4; lev++) {
    for (let kc = 0; kc < 32; kc++) {
      t[lev * 32 + kc] = (lev * (kc + 8)) >> 2;  // approssimato
    }
  }
  return t;
})();

/** Multiplier (MUL 0..15) → fattore frequenza (1/2, 1, 2, 3, ..., 15). */
export const MUL_TABLE: Float32Array = (() => {
  const t = new Float32Array(16);
  t[0] = 0.5;
  for (let i = 1; i < 16; i++) t[i] = i;
  return t;
})();

/** Key code → frequency Hz table (32 entries × 8 octaves = 256, ma OPM usa
 * 12 note per octave skipping 3,7,11,15). Reference: A4 ($4A) ≈ 277.18Hz
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
    // Reference: KC $4A (octave 4, note 10 = A in mapping) → A4 = ~440Hz
    // Actually OPM A4 mapping differs; using musical standard A4=440 @ KC=$4A
    // is approximation. Real OPM: f = 8.1758 × 2^(octave + semi/12).
    t[kc] = 8.1758 * Math.pow(2, octave + semi / 12);
  }
  return t;
})();

/** Envelope rate table: 64 entries × 8 sub-step. Per ogni rate value (0-63)
 * dà un increment per envelope counter @ sample rate native.
 * Rate 0 → never advance (silent). Rate 63 → fastest (instant).
 * Hardware: each rate has 8 phases di durata variable (esponenziale). */
export const ENV_RATE_TABLE: Uint16Array = (() => {
  const t = new Uint16Array(64 * 8);
  // Approssimazione esponenziale: rate r → step (2^(r/8)) per sample
  for (let r = 0; r < 64; r++) {
    for (let p = 0; p < 8; p++) {
      // MAME-style: rate < 2 = 0 step (silent), rate >= 62 = full step
      if (r < 2) { t[r * 8 + p] = 0; continue; }
      if (r >= 62) { t[r * 8 + p] = 8; continue; }
      const shift = (r >> 2);
      const stepIdx = r & 3;
      // 4 step pattern per quarter-octave: [1,1,1,1] / [1,1,1,2] / [1,1,2,2] / [1,2,2,2]
      const stepPatterns = [
        [1, 1, 1, 1, 1, 1, 1, 1],
        [2, 1, 1, 1, 2, 1, 1, 1],
        [2, 1, 2, 1, 2, 1, 2, 1],
        [2, 2, 2, 1, 2, 2, 2, 1],
      ];
      const base = stepPatterns[stepIdx]![p]!;
      t[r * 8 + p] = base << Math.max(0, shift - 11);
    }
  }
  return t;
})();
