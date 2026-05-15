/**
 * sound-renderer.ts — Bridge SoundChip ↔ Web Audio (AudioWorklet).
 *
 * MVP V1: poll register shadow YM2151+POKEY, interpreta pattern key-on/key-off
 * + frequency + volume, posta eventi all'AudioWorklet che sintetizza sample.
 *
 * Niente bit-perfect chip simulation: solo "audio sentibile in browser" per
 * dare feedback acustico al gameplay. V2 V3 (sample-level chip-perfect) sara'
 * full envelope generator + operator FM + LFSR poly via AudioWorklet che
 * riceve register writes diretti.
 *
 * Pattern di decode (basato su Yamaha OPM datasheet):
 *
 * YM2151 channel N (N=0..7):
 *   - Reg $20+N bit 7-6 = RL (right/left enable)
 *   - Reg $28+N = KC (key code: octave + note)
 *   - Reg $30+N = KF (key fraction)
 *   - Reg $40+N..$5F+N = operator DT1/MUL (multiple)
 *   - Reg $60+N..$7F+N = operator TL (total level, 7-bit, 0=loudest, 127=silent)
 *   - Reg $08 = KEY ON byte: bit 6-3 = slot mask, bit 2-0 = channel
 *
 * Frequency from KC: KC = octave × 16 + (note × 16 / 12)
 *   Actual freq ≈ 220 × 2^((kc - 0x4A) / 12) for note A4 at $4A
 *
 * POKEY channel N (N=0..3):
 *   - Reg $00+2N = AUDFn (period)
 *   - Reg $01+2N = AUDCn (vol bit 0-3, dist bit 5-7)
 *   - Distortion bit 7=poly off (square), bit 5=poly9 on, bit 4=poly5 on
 *     Combinations: pure tone vs noise variants
 *
 * Poll frequency: 60Hz (1 frame). Sufficiente per gameplay rumble + tones.
 *
 * Usage:
 *   const renderer = await createSoundRenderer();
 *   await renderer.start();
 *   renderer.update(soundChip);  // chiama ogni frame TS
 *   renderer.stop();
 */

export interface SoundRenderer {
  start: () => Promise<void>;
  stop: () => Promise<void>;
  update: (chip: { ym2151: { regs: Uint8Array }; pokey: { writeRegs: Uint8Array } }) => void;
  playCommandCue: (cmd: number, options?: { force?: boolean }) => void;
  /** V3 chip-perfect: stream PCM raw da YM2151 simulator. samples = interleaved
   * L/R Float numeri @ nativeSampleRate Hz (55930 default). Renderer fa
   * resampling a output sampleRate context e post al worklet via postMessage. */
  pushYm2151Samples: (samples: number[], nativeSampleRate: number) => void;
  /** V3 chip-perfect POKEY: stream mono PCM. Resamplato + replicato L=R. */
  pushPokeySamples: (samples: number[], nativeSampleRate: number) => void;
  isRunning: () => boolean;
  /** Output AudioContext sample rate (per resampling-side ratio compute). */
  getSampleRate: () => number;
}

export interface SoundCommandCue {
  freq: number;
  vol: number;
  noise: boolean;
  durationMs: number;
}

interface PrevState {
  ymOn: boolean[];        // 8 channels
  ymFreq: number[];       // 8 channels
  pokeyOn: boolean[];     // 4 channels
  pokeyFreq: number[];    // 4 channels
}

type AudioContextConstructor = new () => AudioContext;

function getAudioContextConstructor(): AudioContextConstructor | undefined {
  const globalWithWebAudio = globalThis as typeof globalThis & {
    webkitAudioContext?: AudioContextConstructor;
  };
  return globalWithWebAudio.AudioContext ?? globalWithWebAudio.webkitAudioContext;
}

/** YM2151 KC byte → frequenza Hz. Convention OPM:
 *   octave = (kc >> 4) & 7, note = kc & 0x0F (skipping invalid note codes)
 *   Note codes valid: 0,1,2,4,5,6,8,9,10,12,13,14 (skip 3,7,11,15)
 *   Reference A4 = ~440Hz at kc=$4A (octave 4, note 10 = A).
 */
export function ymKcToFreq(kc: number, kf: number): number {
  const octave = (kc >> 4) & 7;
  const note = kc & 0x0F;
  // Map OPM note codes → semitones from C
  const noteTable = [0, 1, 2, -1, 3, 4, 5, -1, 6, 7, 8, -1, 9, 10, 11, -1];
  const semi = noteTable[note];
  if (semi === undefined || semi < 0) return 0;
  // KF: fraction in 1/64 semitone, bits 7-2 used
  const kfFraction = ((kf >> 2) & 0x3f) / 64;
  // Freq formula (OPM): f = 8.18 * 2^(octave + (semi + kfFraction)/12)
  // 8.18 Hz = C-1 (note 0, octave 0)
  return 8.1758 * Math.pow(2, octave + (semi + kfFraction) / 12);
}

/** POKEY AUDF byte → frequenza Hz (clock 64KHz default, dist bit 7=pure). */
export function pokeyAudfToFreq(audf: number, audc: number): { freq: number; noise: boolean } {
  // Default clock 64 KHz, divide by (audf + 1)
  // Real POKEY clock select via AUDCTL bits, V1 stub: 64KHz default
  const clock = 64000;
  const freq = clock / ((audf + 1) * 2);  // tone toggles per 2 cycles → /2
  // Distortion bit 7=0 means poly applied (noise-like)
  const noise = (audc & 0x80) === 0;
  return { freq, noise };
}

/** YM2151 channel volume da TL min su 4 operatori. TL: 0=loud, 127=silent.
 * V1 stub: usa solo op0 TL ($60+N) come volume globale del canale.
 * Linear mapping vol = (127 - tl) / 127. */
export function ymTlToVol(tl: number): number {
  return Math.max(0, 1 - (tl & 0x7f) / 127);
}

/** POKEY AUDC vol = bit 3-0. */
export function pokeyAudcToVol(audc: number): number {
  return (audc & 0x0f) / 15;
}

/**
 * Audible V1 fallback for logical sound commands.
 *
 * The TS SoundChip still models YM2151/POKEY as register-state devices, and the
 * current 6502 path can run without producing gameplay register writes. Keep the
 * real command mailbox wired, but also turn each main-CPU sound command into a
 * short deterministic cue so browser play has immediate audio feedback.
 */
export function soundCommandCue(cmd: number): SoundCommandCue {
  const b = cmd & 0xff;
  const semitone = b % 24;
  const octaveBump = (b >>> 5) & 0x03;
  const base = 185 + octaveBump * 55;
  const freq = base * Math.pow(2, (semitone - 7) / 12);
  const durationMs = 130 + (((b >>> 3) & 0x03) * 35);
  const vol = 0.72 + (((b >>> 6) & 0x03) * 0.07);
  const noise = (b & 0x08) !== 0 || b >= 0x58;
  return { freq, vol, noise, durationMs };
}

export async function createSoundRenderer(): Promise<SoundRenderer> {
  let ctx: AudioContext | null = null;
  let node: AudioWorkletNode | null = null;
  let directCueOnly = false;
  let mediaCueOnly = false;
  let lastCueWallTime = 0;
  let lastCueAudioTime = -1;
  const mediaCueCache = new Map<string, string>();
  const prev: PrevState = {
    ymOn: new Array(8).fill(false),
    ymFreq: new Array(8).fill(0),
    pokeyOn: new Array(4).fill(false),
    pokeyFreq: new Array(4).fill(0),
  };

  async function start(): Promise<void> {
    if (ctx !== null) {
      if (ctx.state === "suspended") await ctx.resume();
      return;
    }
    const AudioContextCtor = getAudioContextConstructor();
    if (AudioContextCtor === undefined) {
      if (globalThis.Audio === undefined) {
        throw new Error("Web Audio API is not available in this browser");
      }
      mediaCueOnly = true;
      console.warn("[sound] AudioContext unavailable, using media cue fallback");
      return;
    }
    ctx = new AudioContextCtor();
    const audioWorklet = ctx.audioWorklet;
    const AudioWorkletNodeCtor = globalThis.AudioWorkletNode;
    if (audioWorklet !== undefined && AudioWorkletNodeCtor !== undefined) {
      try {
        await audioWorklet.addModule("/sound-worklet.js");
        node = new AudioWorkletNodeCtor(ctx, "marble-sound", {
          outputChannelCount: [2],
        });
        node.connect(ctx.destination);
      } catch (e) {
        directCueOnly = true;
        console.warn("[sound] AudioWorklet unavailable, using direct cue fallback:", e);
      }
    } else {
      directCueOnly = true;
      console.warn("[sound] AudioWorklet unavailable, using direct cue fallback");
    }
    // Resume on user gesture if needed
    if (ctx.state === "suspended") {
      await ctx.resume();
    }
  }

  async function stop(): Promise<void> {
    if (node !== null) { node.disconnect(); node = null; }
    if (ctx !== null) { await ctx.close(); ctx = null; }
    directCueOnly = false;
    mediaCueOnly = false;
    for (let i = 0; i < 8; i++) { prev.ymOn[i] = false; prev.ymFreq[i] = 0; }
    for (let i = 0; i < 4; i++) { prev.pokeyOn[i] = false; prev.pokeyFreq[i] = 0; }
  }

  function update(chip: { ym2151: { regs: Uint8Array }; pokey: { writeRegs: Uint8Array } }): void {
    if (node === null) return;
    const ymRegs = chip.ym2151.regs;
    const pkRegs = chip.pokey.writeRegs;

    // ─── YM2151: 8 canali ───
    for (let ch = 0; ch < 8; ch++) {
      const kc = ymRegs[0x28 + ch] ?? 0;
      const kf = ymRegs[0x30 + ch] ?? 0;
      const tl = ymRegs[0x60 + ch] ?? 0;
      const freq = ymKcToFreq(kc, kf);
      const vol = ymTlToVol(tl);
      // KEY ON: reg $08 = bit 6-3 mask + bit 2-0 channel. Pattern Marble usa
      // mask=0x78 (tutti op on) o 0 (off). Simplification: ANY non-zero key
      // on byte sull'ultimo ch select.
      // V1 heuristic: channel on if TL < 127 (= non muto). Real OPM needs
      // KEY ON tracking, V2 si.
      const isOn = vol > 0.01 && freq > 0;
      const wasOn = prev.ymOn[ch];
      const lastFreq = prev.ymFreq[ch] ?? 0;

      if (isOn && (!wasOn || Math.abs(freq - lastFreq) > 1)) {
        node.port.postMessage({ type: "ym_voice", ch, on: true, freq, vol });
        prev.ymOn[ch] = true;
        prev.ymFreq[ch] = freq;
      } else if (!isOn && wasOn) {
        node.port.postMessage({ type: "ym_voice", ch, on: false });
        prev.ymOn[ch] = false;
      }
    }

    // ─── POKEY: 4 canali ───
    for (let ch = 0; ch < 4; ch++) {
      const audf = pkRegs[ch * 2] ?? 0;
      const audc = pkRegs[ch * 2 + 1] ?? 0;
      const { freq, noise } = pokeyAudfToFreq(audf, audc);
      const vol = pokeyAudcToVol(audc);
      const isOn = vol > 0.01 && freq > 20 && freq < 10000;
      const wasOn = prev.pokeyOn[ch];
      const lastFreq = prev.pokeyFreq[ch] ?? 0;

      if (isOn && (!wasOn || Math.abs(freq - lastFreq) > 1)) {
        node.port.postMessage({ type: "pokey_voice", ch, on: true, freq, vol, noise });
        prev.pokeyOn[ch] = true;
        prev.pokeyFreq[ch] = freq;
      } else if (!isOn && wasOn) {
        node.port.postMessage({ type: "pokey_voice", ch, on: false });
        prev.pokeyOn[ch] = false;
      }
    }
  }

  function playCommandCue(cmd: number, options?: { force?: boolean }): void {
    const cue = soundCommandCue(cmd);
    if (options?.force !== true && shouldDropCommandCue()) return;
    if (ctx !== null) {
      if (ctx.state === "suspended") void ctx.resume();
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = cue.noise ? "square" : "sine";
      osc.frequency.setValueAtTime(cue.freq, now);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(cue.vol * 0.22, now + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + cue.durationMs / 1000);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now);
      osc.stop(now + cue.durationMs / 1000 + 0.03);
    }
    if (ctx === null && mediaCueOnly) {
      playMediaCue(cue);
    }
    if (node !== null) node.port.postMessage({ type: "cue", ...cue });
  }

  function shouldDropCommandCue(): boolean {
    if (ctx !== null) {
      const now = ctx.currentTime;
      if (lastCueAudioTime >= 0 && now - lastCueAudioTime < 0.055) return true;
      lastCueAudioTime = now;
      return false;
    }
    const now = Date.now();
    if (now - lastCueWallTime < 55) return true;
    lastCueWallTime = now;
    return false;
  }

  function isRunning(): boolean {
    return mediaCueOnly || (ctx !== null && (node !== null || directCueOnly));
  }

  function playMediaCue(cue: SoundCommandCue): void {
    const key = `${Math.round(cue.freq)}:${cue.noise ? 1 : 0}:${cue.durationMs}`;
    let dataUrl = mediaCueCache.get(key);
    if (dataUrl === undefined) {
      dataUrl = makeCueWavDataUrl(cue);
      mediaCueCache.set(key, dataUrl);
    }
    const audio = new Audio(dataUrl);
    audio.volume = Math.max(0, Math.min(1, cue.vol));
    void audio.play().catch((e: unknown) => {
      console.warn("[sound] media cue playback failed:", e);
    });
  }

  function getSampleRate(): number {
    return ctx?.sampleRate ?? 44100;
  }

  /** V3 chip-perfect: prende samples interleaved L/R @ nativeSampleRate,
   * resample lineare a output ctx.sampleRate, posta come Float32Array al
   * worklet. Resample ratio = native/output (es. 55930/44100 ≈ 1.268). */
  function pushYm2151Samples(samples: number[], nativeSampleRate: number): void {
    if (node === null || samples.length === 0) return;
    const outSr = getSampleRate();
    const ratio = nativeSampleRate / outSr;
    const outSamples = Math.floor((samples.length / 2) / ratio);
    if (outSamples <= 0) return;
    const left = new Float32Array(outSamples);
    const right = new Float32Array(outSamples);
    // Linear interpolation resampling
    for (let i = 0; i < outSamples; i++) {
      const srcPos = i * ratio;
      const srcIdx = Math.floor(srcPos) * 2;
      const frac = srcPos - Math.floor(srcPos);
      const l0 = samples[srcIdx] ?? 0;
      const r0 = samples[srcIdx + 1] ?? 0;
      const l1 = samples[srcIdx + 2] ?? l0;
      const r1 = samples[srcIdx + 3] ?? r0;
      left[i] = l0 * (1 - frac) + l1 * frac;
      right[i] = r0 * (1 - frac) + r1 * frac;
    }
    node.port.postMessage({ type: "ym_pcm", left, right }, [left.buffer, right.buffer]);
  }

  /** POKEY samples mono → resample + duplicate L=R per stereo output. */
  function pushPokeySamples(samples: number[], nativeSampleRate: number): void {
    if (node === null || samples.length === 0) return;
    const outSr = getSampleRate();
    const ratio = nativeSampleRate / outSr;
    const outSamples = Math.floor(samples.length / ratio);
    if (outSamples <= 0) return;
    const left = new Float32Array(outSamples);
    const right = new Float32Array(outSamples);
    for (let i = 0; i < outSamples; i++) {
      const srcPos = i * ratio;
      const srcIdx = Math.floor(srcPos);
      const frac = srcPos - srcIdx;
      const s0 = samples[srcIdx] ?? 0;
      const s1 = samples[srcIdx + 1] ?? s0;
      const v = s0 * (1 - frac) + s1 * frac;
      left[i] = v;
      right[i] = v;
    }
    node.port.postMessage({ type: "ym_pcm", left, right }, [left.buffer, right.buffer]);
  }

  return { start, stop, update, playCommandCue, pushYm2151Samples, pushPokeySamples, isRunning, getSampleRate };
}

function makeCueWavDataUrl(cue: SoundCommandCue): string {
  const sampleRate = 22050;
  const sampleCount = Math.max(1, Math.round(sampleRate * cue.durationMs / 1000));
  const bytes = new Uint8Array(44 + sampleCount * 2);
  const view = new DataView(bytes.buffer);
  writeAscii(bytes, 0, "RIFF");
  view.setUint32(4, 36 + sampleCount * 2, true);
  writeAscii(bytes, 8, "WAVEfmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(bytes, 36, "data");
  view.setUint32(40, sampleCount * 2, true);

  let noise = 0x12345678;
  for (let i = 0; i < sampleCount; i++) {
    const t = i / sampleRate;
    const env = Math.min(1, i / 160) * Math.max(0, 1 - i / sampleCount);
    let sample: number;
    if (cue.noise) {
      noise = ((noise * 1664525) + 1013904223) >>> 0;
      sample = (((noise >>> 16) & 0xffff) / 32768 - 1);
    } else {
      sample = Math.sin(2 * Math.PI * cue.freq * t);
    }
    view.setInt16(44 + i * 2, Math.round(sample * env * 0x5fff), true);
  }

  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return `data:audio/wav;base64,${btoa(binary)}`;
}

function writeAscii(bytes: Uint8Array, offset: number, text: string): void {
  for (let i = 0; i < text.length; i++) {
    bytes[offset + i] = text.charCodeAt(i);
  }
}
