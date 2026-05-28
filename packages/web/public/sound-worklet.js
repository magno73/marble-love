// sound-worklet.js - AudioWorklet processor for Marble Madness.
//
// MVP V1 receives voice events from the main thread via postMessage and
// synthesizes 8 sine-wave voices (YM2151 channels) plus 4 square/noise voices
// (POKEY), then mixes them to stereo at the AudioContext sample rate.
//
// Accepted events (via this.port.onmessage):
//   { type: "ym_voice", ch: 0..7, on: true, freq: Hz, vol: 0..1 }
//   { type: "ym_voice", ch: 0..7, on: false }
//   { type: "pokey_voice", ch: 0..3, on: true, freq: Hz, vol: 0..1, noise: bool }
//   { type: "pokey_voice", ch: 0..3, on: false }
//   { type: "cue", freq: Hz, vol: 0..1, noise: bool, durationMs: number }
//   { type: "reset" }
//
// Later chip-accurate work can replace this fallback path with YM2151
// DR/AR/SR/RR envelopes and the POKEY 17-bit LFSR. This fallback keeps the
// browser responsive when raw chip PCM is unavailable.

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
    // Separate PCM queues keep YM2151 and POKEY sample streams time-aligned
    // when both chips are pushed during the same frame.
    this.ymPcm = this.createPcmQueue();
    this.pokeyPcm = this.createPcmQueue();
    this.port.onmessage = (e) => this.handleMessage(e.data);
  }

  createPcmQueue() {
    return {
      l: new Float32Array(48000),  // 1 sec @ 48kHz buffer
      r: new Float32Array(48000),
      readIdx: 0,
      writeIdx: 0,
      available: 0,
    };
  }

  enqueuePcm(queue, left, right) {
    const N = left.length;
    const cap = queue.l.length;
    for (let i = 0; i < N; i++) {
      queue.l[queue.writeIdx] = left[i];
      queue.r[queue.writeIdx] = right[i];
      queue.writeIdx = (queue.writeIdx + 1) % cap;
      if (queue.available < cap) queue.available++;
      else queue.readIdx = (queue.readIdx + 1) % cap;  // overflow: drop oldest
    }
  }

  dequeuePcm(queue) {
    if (queue.available === 0) return null;
    const l = queue.l[queue.readIdx];
    const r = queue.r[queue.readIdx];
    queue.readIdx = (queue.readIdx + 1) % queue.l.length;
    queue.available--;
    return [l, r];
  }

  resetPcm(queue) {
    queue.readIdx = 0;
    queue.writeIdx = 0;
    queue.available = 0;
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
    } else if (msg.type === "ym_pcm") {
      // Raw YM2151 simulator PCM, already resampled to the AudioContext rate.
      if (msg.left instanceof Float32Array && msg.right instanceof Float32Array) {
        this.enqueuePcm(this.ymPcm, msg.left, msg.right);
      }
    } else if (msg.type === "pokey_pcm") {
      // POKEY has its own queue so it mixes with YM instead of playing after it.
      if (msg.left instanceof Float32Array && msg.right instanceof Float32Array) {
        this.enqueuePcm(this.pokeyPcm, msg.left, msg.right);
      }
    } else if (msg.type === "reset") {
      for (const v of this.ymVoices) { v.on = false; v.target = 0; v.env = 0; }
      for (const v of this.pokeyVoices) { v.on = false; v.target = 0; v.env = 0; }
      for (const v of this.cueVoices) { v.target = 0; v.env = 0; v.remaining = 0; }
      this.resetPcm(this.ymPcm);
      this.resetPcm(this.pokeyPcm);
    } else if (msg.type === "reset_pcm") {
      this.resetPcm(this.ymPcm);
      this.resetPcm(this.pokeyPcm);
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
          sample = v.lastNoise * v.env * 0.28;
        } else {
          sample = Math.sin(v.phase) * v.env * 0.28;
          v.phase += (2 * Math.PI * v.freq) / sr;
          if (v.phase > 2 * Math.PI) v.phase -= 2 * Math.PI;
        }
        mix += sample;
      }

      // V3 chip-perfect: mix YM2151 + POKEY PCM streams sample-aligned.
      const ymPcm = this.dequeuePcm(this.ymPcm);
      const pokeyPcm = this.dequeuePcm(this.pokeyPcm);
      const pcmL = (ymPcm !== null ? ymPcm[0] : 0) + (pokeyPcm !== null ? pokeyPcm[0] : 0);
      const pcmR = (ymPcm !== null ? ymPcm[1] : 0) + (pokeyPcm !== null ? pokeyPcm[1] : 0);

      // Keep the bit-perfect replay path linear when only chip PCM is active.
      // Synthetic fallback voices still use soft clipping when explicitly mixed.
      if (mix === 0) {
        left[i] = pcmL;
        right[i] = pcmR;
      } else {
        mix = Math.tanh(mix * 0.7);
        left[i] = Math.tanh(mix + pcmL);
        right[i] = Math.tanh(mix + pcmR);
      }
    }
    return true;
  }
}

registerProcessor("marble-sound", MarbleSoundProcessor);
