// render-ts-wav.ts - render TS SoundChip output to a WAV file for listening.
// Uses the attract-music cmd-tape replay and writes /tmp/ts_marble_audio.wav.
import { readFileSync, writeFileSync } from "node:fs";
import { createSoundChip, releaseSoundReset, submitCommand, loadCmdTape, tickCycles, drainReplyEvents, drainYm2151Samples, drainPokeySamples, YM2151_NATIVE_SAMPLE_RATE } from "../../engine/src/m6502/sound-chip.js";
import { SOUND_CYCLES_PER_FRAME } from "../../engine/src/m6502/sound-clock.js";
import { as_u8 } from "../../engine/src/wrap.js";

const FRAMES = Number(process.env.FRAMES ?? "14000");
const OUTPUT = process.env.OUTPUT ?? "/tmp/ts_marble_audio.wav";

const rom421 = new Uint8Array(readFileSync("/tmp/sound-roms/136033.421"));
const rom422 = new Uint8Array(readFileSync("/tmp/sound-roms/136033.422"));
const tape = loadCmdTape(JSON.parse(readFileSync("oracle/scenarios/sound-cmd-tape-attract-music.json", "utf8")));
const firstCmdFrame = Math.min(...Array.from(tape.byFrame.keys()));

const chip = createSoundChip({ roms: { rom421, rom422 } });
let released = false;
const ymStereo: number[] = [];  // interleaved L/R

console.log(`Rendering ${FRAMES} frames...`);
for (let f = 0; f < FRAMES; f++) {
  const cmds = tape.byFrame.get(f);
  if (cmds !== undefined) for (const b of cmds) submitCommand(chip, as_u8(b));
  if (!released && f >= firstCmdFrame) { releaseSoundReset(chip); released = true; }
  if (!released) continue;
  tickCycles(chip, SOUND_CYCLES_PER_FRAME);
  drainReplyEvents(chip);
  const ym = drainYm2151Samples(chip);
  for (const s of ym) ymStereo.push(s);
  drainPokeySamples(chip);  // discard for now
  if (f % 2000 === 0) {
    let maxAbs = 0;
    for (const s of ym) { const a = Math.abs(s); if (a > maxAbs) maxAbs = a; }
    console.log(`  f=${f} samples_total=${ymStereo.length} last_packet_maxAbs=${maxAbs.toExponential(3)}`);
  }
}

// Write WAV 16-bit PCM stereo at YM2151 native rate (55930 Hz)
const sampleRate = YM2151_NATIVE_SAMPLE_RATE;
const numChannels = 2;
const bitsPerSample = 16;
const numSamples = ymStereo.length / 2;
const byteRate = sampleRate * numChannels * bitsPerSample / 8;
const blockAlign = numChannels * bitsPerSample / 8;
const dataSize = numSamples * blockAlign;
const buffer = Buffer.alloc(44 + dataSize);

// RIFF header
buffer.write("RIFF", 0);
buffer.writeUInt32LE(36 + dataSize, 4);
buffer.write("WAVE", 8);
buffer.write("fmt ", 12);
buffer.writeUInt32LE(16, 16);                  // fmt chunk size
buffer.writeUInt16LE(1, 20);                   // PCM
buffer.writeUInt16LE(numChannels, 22);
buffer.writeUInt32LE(sampleRate, 24);
buffer.writeUInt32LE(byteRate, 28);
buffer.writeUInt16LE(blockAlign, 32);
buffer.writeUInt16LE(bitsPerSample, 34);
buffer.write("data", 36);
buffer.writeUInt32LE(dataSize, 40);

// PCM samples (float [-1..1] → int16)
for (let i = 0; i < ymStereo.length; i++) {
  const s = Math.max(-1, Math.min(1, ymStereo[i] ?? 0));
  buffer.writeInt16LE(Math.round(s * 32767), 44 + i * 2);
}

writeFileSync(OUTPUT, buffer);
const durationSec = numSamples / sampleRate;
let globalMax = 0;
for (const s of ymStereo) { const a = Math.abs(s); if (a > globalMax) globalMax = a; }
console.log(`\n✓ Written ${OUTPUT}: ${(buffer.length/1024).toFixed(1)} KB`);
console.log(`  Duration: ${durationSec.toFixed(2)}s @ ${sampleRate}Hz stereo`);
console.log(`  Peak amplitude: ${globalMax.toFixed(4)} (${(20*Math.log10(globalMax+1e-10)).toFixed(1)} dBFS)`);
