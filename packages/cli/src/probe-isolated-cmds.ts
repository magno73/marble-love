// probe-isolated-cmds.ts — submit specifici cmd byte direttamente al chip per
// vedere se almeno UNO triggera write a YM2151 voice register o POKEY voice.
// Bypassa la tape completa per isolare "il chip puo' suonare" vs "tape e' errata".

import { readFileSync } from "node:fs";
import {
  createSoundChip,
  releaseSoundReset,
  submitCommand,
  tickCycles,
  drainYm2151Samples,
  drainPokeySamples,
} from "../../engine/src/m6502/sound-chip.js";
import { SOUND_CYCLES_PER_FRAME } from "../../engine/src/m6502/sound-clock.js";
import { as_u8 } from "../../engine/src/wrap.js";

const rom421 = new Uint8Array(readFileSync("/tmp/sound-roms/136033.421"));
const rom422 = new Uint8Array(readFileSync("/tmp/sound-roms/136033.422"));

function tryCmd(cmd: number, settleFrames: number = 60): { voiceWritten: number; nonZeroRam: number } {
  const chip = createSoundChip({ roms: { rom421, rom422 } });
  releaseSoundReset(chip);
  // Boot warmup
  for (let f = 0; f < 60; f++) tickCycles(chip, SOUND_CYCLES_PER_FRAME);
  // Now submit cmd
  submitCommand(chip, as_u8(cmd));
  for (let f = 0; f < settleFrames; f++) tickCycles(chip, SOUND_CYCLES_PER_FRAME);
  // Drain to avoid memory bloat
  drainYm2151Samples(chip);
  drainPokeySamples(chip);
  // Inspect YM2151 voice registers ($20-$7F = channel + op params)
  let voiceWritten = 0;
  for (let r = 0x20; r < 0x80; r++) {
    if (chip.ym2151.regs[r] !== 0) voiceWritten++;
  }
  let nonZero = 0;
  for (let i = 0; i < chip.mmu.ram.length; i++) if (chip.mmu.ram[i] !== 0) nonZero++;
  return { voiceWritten, nonZeroRam: nonZero };
}

const testBytes = [0x00, 0x01, 0x03, 0x07, 0x08, 0x0a, 0x2f, 0x32, 0x34, 0x39, 0x3a, 0x3b, 0x3d, 0x40, 0x42, 0x45, 0x46, 0x61];
console.log(`Testing ${testBytes.length} cmd bytes in isolation (60f boot + cmd + 60f settle):`);
for (const cmd of testBytes) {
  const r = tryCmd(cmd);
  console.log(`  cmd 0x${cmd.toString(16).padStart(2,'0')}: ym2151 voice regs non-zero=${r.voiceWritten}/96, audioRam non-zero=${r.nonZeroRam}`);
}

// Also try: cmd 0x61 followed by 0x01 (as in tape f305) — paired init
{
  const chip = createSoundChip({ roms: { rom421, rom422 } });
  releaseSoundReset(chip);
  for (let f = 0; f < 60; f++) tickCycles(chip, SOUND_CYCLES_PER_FRAME);
  submitCommand(chip, as_u8(0x61));
  for (let f = 0; f < 5; f++) tickCycles(chip, SOUND_CYCLES_PER_FRAME);
  submitCommand(chip, as_u8(0x01));
  for (let f = 0; f < 60; f++) tickCycles(chip, SOUND_CYCLES_PER_FRAME);
  drainYm2151Samples(chip);
  let voiceWritten = 0;
  for (let r = 0x20; r < 0x80; r++) {
    if (chip.ym2151.regs[r] !== 0) voiceWritten++;
  }
  let nonZero = 0;
  for (let i = 0; i < chip.mmu.ram.length; i++) if (chip.mmu.ram[i] !== 0) nonZero++;
  console.log(`  cmd 0x61 + 0x01 paired (5f gap): ym2151 voice regs=${voiceWritten}/96, audioRam non-zero=${nonZero}`);
}

// Try cmd 0x03 stream (60 ticks) then 0x61 — simulate music init timing
{
  const chip = createSoundChip({ roms: { rom421, rom422 } });
  releaseSoundReset(chip);
  for (let f = 0; f < 60; f++) tickCycles(chip, SOUND_CYCLES_PER_FRAME);
  for (let f = 0; f < 60; f++) {
    submitCommand(chip, as_u8(0x03));
    tickCycles(chip, SOUND_CYCLES_PER_FRAME);
  }
  submitCommand(chip, as_u8(0x61));
  for (let f = 0; f < 5; f++) tickCycles(chip, SOUND_CYCLES_PER_FRAME);
  submitCommand(chip, as_u8(0x01));
  for (let f = 0; f < 120; f++) {
    submitCommand(chip, as_u8(0x03));
    tickCycles(chip, SOUND_CYCLES_PER_FRAME);
  }
  drainYm2151Samples(chip);
  let voiceWritten = 0;
  for (let r = 0x20; r < 0x80; r++) {
    if (chip.ym2151.regs[r] !== 0) voiceWritten++;
  }
  let nonZero = 0;
  for (let i = 0; i < chip.mmu.ram.length; i++) if (chip.mmu.ram[i] !== 0) nonZero++;
  console.log(`  60×0x03 + 0x61 + 0x01 + 120×0x03 sustained: ym2151 voice regs=${voiceWritten}/96, audioRam non-zero=${nonZero}`);
}
