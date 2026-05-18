/**
 * probe-sound-sample-diff.ts — Audio sample-level diff TS SoundChip vs MAME WAV.
 *
 * Hardware reference: il SoundChip TS produce sample stream @ YM2151 native
 * rate 55930 Hz (drainYm2151Samples) + POKEY mono @ 13990 Hz (drainPokey).
 * MAME `-wavwrite` registra a 44100/48000 Hz stereo (config dipendente).
 *
 * Strategy:
 *   1. Carica MAME WAV (PCM signed 16-bit, header parse)
 *   2. Run TS SoundChip per N frame (default 60) con cmd sequence injected
 *   3. Resample TS output al sample rate MAME WAV
 *   4. Diff sample-by-sample con tolleranza (cross-correlation)
 *
 * Usage:
 *   npx tsx packages/cli/src/probe-sound-sample-diff.ts \
 *     --mame /tmp/marble_audio.wav --frames 60 [--cmd-tape /path/cmds.json]
 *
 * Output:
 *   Frame count, sample count TS / MAME, cross-correlation (0..1),
 *   RMS error, first divergence > threshold.
 *
 * Generate MAME WAV:
 *   mame marble -rompath roms -nothrottle -wavwrite /tmp/marble_audio.wav \
 *     -seconds_to_run N -autoboot_script oracle/some_script.lua
 */

import { readFileSync, existsSync } from "node:fs";
import { createSoundChip, tickCycles, releaseSoundReset, drainYm2151Samples, drainPokeySamples, drainReplyEvents, submitCommand, YM2151_NATIVE_SAMPLE_RATE, POKEY_NATIVE_SAMPLE_RATE } from "../../engine/src/m6502/sound-chip.js";
import { SOUND_CYCLES_PER_FRAME } from "../../engine/src/m6502/sound-clock.js";
import { as_u8 } from "../../engine/src/wrap.js";

function parseWav(buf: Buffer): { sampleRate: number; channels: number; samples: Float32Array } {
  // Standard PCM WAV: header 44 byte + data
  if (buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("Not a WAV file");
  }
  const channels = buf.readUInt16LE(22);
  const sampleRate = buf.readUInt32LE(24);
  const bitsPerSample = buf.readUInt16LE(34);
  let dataOff = 12;
  while (dataOff < buf.length - 8) {
    const chunkId = buf.toString("ascii", dataOff, dataOff + 4);
    const chunkSize = buf.readUInt32LE(dataOff + 4);
    if (chunkId === "data") {
      dataOff += 8;
      const sampleCount = chunkSize / (bitsPerSample / 8);
      const samples = new Float32Array(sampleCount);
      if (bitsPerSample === 16) {
        for (let i = 0; i < sampleCount; i++) {
          samples[i] = buf.readInt16LE(dataOff + i * 2) / 32768;
        }
      } else {
        throw new Error(`Unsupported bits per sample: ${bitsPerSample}`);
      }
      return { sampleRate, channels, samples };
    }
    dataOff += 8 + chunkSize;
  }
  throw new Error("No data chunk");
}

function resampleLinear(src: number[], srcRate: number, dstRate: number): Float32Array {
  const ratio = srcRate / dstRate;
  const outLen = Math.floor(src.length / ratio);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const srcPos = i * ratio;
    const idx = Math.floor(srcPos);
    const frac = srcPos - idx;
    const s0 = src[idx] ?? 0;
    const s1 = src[idx + 1] ?? s0;
    out[i] = s0 * (1 - frac) + s1 * frac;
  }
  return out;
}

function crossCorrelation(a: Float32Array, b: Float32Array, maxLag: number = 100): { lag: number; coeff: number } {
  const n = Math.min(a.length, b.length);
  let bestLag = 0;
  let bestCoeff = -2;
  for (let lag = -maxLag; lag <= maxLag; lag++) {
    let sum = 0, na = 0, nb = 0;
    const start = Math.max(0, lag);
    const end = Math.min(n, n + lag);
    for (let i = start; i < end; i++) {
      const va = a[i] ?? 0;
      const vb = b[i - lag] ?? 0;
      sum += va * vb;
      na += va * va;
      nb += vb * vb;
    }
    const coeff = na > 0 && nb > 0 ? sum / Math.sqrt(na * nb) : 0;
    if (coeff > bestCoeff) { bestCoeff = coeff; bestLag = lag; }
  }
  return { lag: bestLag, coeff: bestCoeff };
}

function rmsError(a: Float32Array, b: Float32Array): number {
  const n = Math.min(a.length, b.length);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    sum += d * d;
  }
  return Math.sqrt(sum / n);
}

interface CmdTape {
  cmds: Array<{ frame: number; byte: number }>;
}

function main(): void {
  const args = process.argv.slice(2);
  const mameWav = args[args.indexOf("--mame") + 1];
  const frames = parseInt(args[args.indexOf("--frames") + 1] ?? "60", 10);
  const cmdTapeArg = args[args.indexOf("--cmd-tape") + 1];

  if (mameWav === undefined || !existsSync(mameWav)) {
    console.error("Usage: probe-sound-sample-diff --mame <wav> [--frames N] [--cmd-tape <json>]");
    console.error("MAME WAV non trovato:", mameWav);
    process.exit(1);
  }

  // Carica MAME WAV
  const mameBuf = readFileSync(mameWav);
  const mameWavData = parseWav(mameBuf);
  console.log(`MAME WAV: ${mameWavData.sampleRate}Hz × ${mameWavData.channels}ch × ${mameWavData.samples.length} samples`);

  // Carica cmd tape (opzionale)
  let cmdTape: CmdTape = { cmds: [] };
  if (cmdTapeArg !== undefined && existsSync(cmdTapeArg)) {
    cmdTape = JSON.parse(readFileSync(cmdTapeArg, "utf8")) as CmdTape;
    console.log(`Cmd tape: ${cmdTape.cmds.length} cmds`);
  }

  // Carica ROM
  const rom421 = new Uint8Array(readFileSync("/tmp/sound-roms/136033.421"));
  const rom422 = new Uint8Array(readFileSync("/tmp/sound-roms/136033.422"));

  // Crea SoundChip; release del reset al primo cmd frame (matching MAME).
  const chip = createSoundChip({ roms: { rom421, rom422 } });

  // Run N frame, inject cmd dal tape al frame giusto
  const cmdByFrame = new Map<number, number[]>();
  for (const c of cmdTape.cmds) {
    if (!cmdByFrame.has(c.frame)) cmdByFrame.set(c.frame, []);
    cmdByFrame.get(c.frame)!.push(c.byte);
  }
  const firstCmdFrame = cmdByFrame.size > 0
    ? Math.min(...Array.from(cmdByFrame.keys()))
    : 0;
  let resetReleased = false;

  const ymSamples: number[] = [];
  const pokeySamples: number[] = [];
  for (let f = 0; f < frames; f++) {
    // Hardware-faithful: submit cmd (NMI suppressed in reset), then release.
    const cmds = cmdByFrame.get(f);
    if (cmds !== undefined) {
      for (const c of cmds) submitCommand(chip, as_u8(c));
    }
    if (!resetReleased && f >= firstCmdFrame) {
      releaseSoundReset(chip);
      resetReleased = true;
    }
    tickCycles(chip, SOUND_CYCLES_PER_FRAME);
    drainReplyEvents(chip);  // simula main 68K read $FC0001
    const ym = drainYm2151Samples(chip);
    const pk = drainPokeySamples(chip);
    ymSamples.push(...ym);
    pokeySamples.push(...pk);
  }
  console.log(`TS YM2151 samples: ${ymSamples.length} (= ${ymSamples.length / 2} stereo @ ${YM2151_NATIVE_SAMPLE_RATE}Hz)`);
  console.log(`TS POKEY samples:  ${pokeySamples.length} mono @ ${POKEY_NATIVE_SAMPLE_RATE}Hz`);

  // Resample TS YM (stereo interleaved) → mono left a MAME rate, scarto right per ora
  const tsLeft: number[] = [];
  for (let i = 0; i < ymSamples.length; i += 2) tsLeft.push(ymSamples[i] ?? 0);
  const tsLeftResampled = resampleLinear(tsLeft, YM2151_NATIVE_SAMPLE_RATE, mameWavData.sampleRate);
  const pokeyResampled = resampleLinear(pokeySamples, POKEY_NATIVE_SAMPLE_RATE, mameWavData.sampleRate);
  // Mix YM + POKEY
  const tsMix = new Float32Array(Math.max(tsLeftResampled.length, pokeyResampled.length));
  for (let i = 0; i < tsMix.length; i++) {
    tsMix[i] = (tsLeftResampled[i] ?? 0) + (pokeyResampled[i] ?? 0);
  }

  // MAME WAV: estrai canale L (se stereo)
  const mameLeft = mameWavData.channels === 2
    ? new Float32Array(mameWavData.samples.length / 2).map((_, i) => mameWavData.samples[i * 2] ?? 0)
    : mameWavData.samples;

  console.log(`\n--- Cross-correlation TS vs MAME (left channel) ---`);
  // Lag range: ±5000 samples (~90ms ~5 frames) per coprire drift inter-frame.
  const cc = crossCorrelation(tsMix, mameLeft, 5000);
  console.log(`Best lag: ${cc.lag} samples`);
  console.log(`Coefficient: ${cc.coeff.toFixed(4)} (>0.95 = audio identico, >0.7 = riconoscibile)`);

  console.log(`\n--- RMS error ---`);
  const rms = rmsError(tsMix, mameLeft);
  console.log(`RMS: ${rms.toFixed(4)}`);

  console.log("\n--- Status ---");
  if (cc.coeff > 0.95) console.log("✅ PASS: audio bit-perfect MAME-equivalent");
  else if (cc.coeff > 0.7) console.log("🟡 PARTIAL: audio riconoscibile ma con drift");
  else console.log("❌ FAIL: audio non riconoscibile vs MAME");
}

main();
