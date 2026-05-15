// sound-worklet.js — AudioWorklet processor per Marble Madness.
//
// MVP V1: riceve "voice events" via postMessage dal main thread e sintetizza
// 8 voci × sine wave (YM2151 channels) + 4 voci × square+noise (POKEY) → mix
// → output stereo @ sample rate AudioContext default (tipicamente 44100Hz).
//
// Eventi accettati (via this.port.onmessage):
//   { type: "ym_voice", ch: 0..7, on: true, freq: Hz, vol: 0..1 }
//   { type: "ym_voice", ch: 0..7, on: false }
//   { type: "pokey_voice", ch: 0..3, on: true, freq: Hz, vol: 0..1, noise: bool }
//   { type: "pokey_voice", ch: 0..3, on: false }
//   { type: "cue", freq: Hz, vol: 0..1, noise: bool, durationMs: number }
//   { type: "reset" }
//
// Phase 5/6 V3 chip-perfect (deferito): qui useremmo envelope DR/AR/SR/RR
// per YM2151 e LFSR 17-bit per POKEY. V1 = ADSR fixed snappy + white noise
// (Math.random) per "rumble" basic.

class MarbleSoundProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.sampleRate_ = sampleRate;  // global AudioWorklet
    this.ymVoices = Array.from({ length: 8 }, () => ({
      on: false, freq: 0, vol: 0, phase: 0,
      env: 0, target: 0,  // envelope follower
    }));
    this.pokeyVoices = Array.from({ length: 4 }, () => ({
      on: false, freq: 0, vol: 0, noise: false, phase: 0,
      env: 0, target: 0, lastNoise: 0,
    }));
    this.cueVoices = Array.from({ length: 4 }, () => ({
      freq: 0, vol: 0, noise: false, phase: 0,
      env: 0, target: 0, lastNoise: 0, remaining: 0,
    }));
    this.nextCueVoice = 0;
    this.port.onmessage = (e) => this.handleMessage(e.data);
  }

  handleMessage(msg) {
    if (msg.type === "ym_voice") {
      const v = this.ymVoices[msg.ch];
      if (v === undefined) return;
      if (msg.on) {
        v.on = true;
        v.freq = msg.freq;
        v.vol = msg.vol;
        v.target = msg.vol;
        // Snap attack: env tende a target in ~5ms
      } else {
        v.on = false;
        v.target = 0;  // decay to silence
      }
    } else if (msg.type === "pokey_voice") {
      const v = this.pokeyVoices[msg.ch];
      if (v === undefined) return;
      if (msg.on) {
        v.on = true;
        v.freq = msg.freq;
        v.vol = msg.vol;
        v.noise = msg.noise === true;
        v.target = msg.vol;
      } else {
        v.on = false;
        v.target = 0;
      }
    } else if (msg.type === "cue") {
      const v = this.cueVoices[this.nextCueVoice % this.cueVoices.length];
      this.nextCueVoice++;
      if (v === undefined) return;
      v.freq = Math.max(20, Math.min(3000, Number(msg.freq) || 220));
      v.vol = Math.max(0, Math.min(1, Number(msg.vol) || 0.5));
      v.noise = msg.noise === true;
      v.target = v.vol;
      v.remaining = Math.max(1, Math.round((Number(msg.durationMs) || 90) * this.sampleRate_ / 1000));
      v.phase = 0;
    } else if (msg.type === "reset") {
      for (const v of this.ymVoices) { v.on = false; v.target = 0; v.env = 0; }
      for (const v of this.pokeyVoices) { v.on = false; v.target = 0; v.env = 0; }
      for (const v of this.cueVoices) { v.target = 0; v.env = 0; v.remaining = 0; }
    }
  }

  process(_inputs, outputs) {
    const out = outputs[0];
    if (out === undefined || out.length === 0) return true;
    const left = out[0];
    const right = out[1] ?? left;
    const n = left.length;
    const sr = this.sampleRate_;
    // Envelope time constant (samples to reach 1-1/e of target)
    const envRate = 1 / (sr * 0.008);  // ~8ms tau

    for (let i = 0; i < n; i++) {
      let mix = 0;

      // YM2151 voices: pure sine
      for (const v of this.ymVoices) {
        // Smooth envelope toward target
        v.env += (v.target - v.env) * envRate * 50;  // ~5ms attack
        if (v.env < 0.0001 && !v.on) continue;
        if (v.freq <= 0) continue;
        const sample = Math.sin(v.phase) * v.env * 0.12;
        mix += sample;
        v.phase += (2 * Math.PI * v.freq) / sr;
        if (v.phase > 2 * Math.PI) v.phase -= 2 * Math.PI;
      }

      // POKEY voices: square or noise
      for (const v of this.pokeyVoices) {
        v.env += (v.target - v.env) * envRate * 50;
        if (v.env < 0.0001 && !v.on) continue;
        if (v.freq <= 0) continue;
        let sample;
        if (v.noise) {
          // Noise: random sample held for 1/freq seconds (white-ish)
          v.phase += v.freq / sr;
          if (v.phase >= 1) { v.lastNoise = Math.random() * 2 - 1; v.phase -= 1; }
          sample = v.lastNoise * v.env * 0.08;
        } else {
          // Square wave
          v.phase += v.freq / sr;
          if (v.phase >= 1) v.phase -= 1;
          sample = (v.phase < 0.5 ? 1 : -1) * v.env * 0.08;
        }
        mix += sample;
      }

      // Command cue voices: short audible fallback for main-CPU sound commands.
      for (const v of this.cueVoices) {
        if (v.remaining > 0) {
          v.remaining--;
        } else {
          v.target = 0;
        }
        v.env += (v.target - v.env) * envRate * 50;
        if (v.env < 0.0001 && v.remaining <= 0) continue;
        if (v.freq <= 0) continue;
        let sample;
        if (v.noise) {
          v.phase += v.freq / sr;
          if (v.phase >= 1) { v.lastNoise = Math.random() * 2 - 1; v.phase -= 1; }
          sample = v.lastNoise * v.env * 0.16;
        } else {
          sample = Math.sin(v.phase) * v.env * 0.16;
          v.phase += (2 * Math.PI * v.freq) / sr;
          if (v.phase > 2 * Math.PI) v.phase -= 2 * Math.PI;
        }
        mix += sample;
      }

      // Soft clip
      mix = Math.tanh(mix * 0.7);
      left[i] = mix;
      right[i] = mix;
    }
    return true;
  }
}

registerProcessor("marble-sound", MarbleSoundProcessor);
