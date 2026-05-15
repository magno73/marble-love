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

/** ENV_RATE_SHIFT: per ogni rate (0..63), shift right applicato all'envelope
 * counter prima del check increment. Source: MAME ym2151.cpp eg_rate_shift[].
 * Rate 0..63 = combo (key_scale + base_rate). Pre-shift produce la divisione
 * binaria del clock envelope. */
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

/** ENV_RATE_SELECT: per ogni rate (0..63), indice in eg_inc[8] pattern.
 * Source: MAME ym2151.cpp eg_rate_select[]. */
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

/** EG_INC: pattern di increment per ognuno dei 19 select × 8 step.
 * Source: MAME ym2151.cpp eg_inc[]. Valori 0/1/2/4/8 = step amount. */
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

/** Attenuation table dB-domain: idx 0..1023 → linear amplitude scale 1..0.
 * Hardware OPM: 96dB max attenuation a counter 1023, esponenziale.
 * Curve: amp = 10^(-att/1023 * 4.8) (≈96 dB span con 4.8 = 96/20). */
export const ATT_TO_LINEAR: Float32Array = (() => {
  const t = new Float32Array(1024);
  for (let i = 0; i < 1024; i++) {
    if (i >= 1023) { t[i] = 0; continue; }
    // dB curve: 96 dB span, esponenziale
    t[i] = Math.pow(10, -(i / 1023) * 4.8);
  }
  return t;
})();
