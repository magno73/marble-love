// probe-isolated-cmds.ts - submit specific command bytes directly to the chip to
// see whether any command triggers YM2151 or POKEY voice writes. This bypasses
// the full tape to separate "the chip can make sound" from "the tape is wrong".

import { readFileSync } from "node:fs";
import {
  createSoundChip,
  releaseSoundReset,
  submitCommand,
  tickCycles,
  drainYm2151Samples,
  drainPokeySamples,
  drainReplyEvents,
} from "../../engine/src/m6502/sound-chip.js";
import { SOUND_CYCLES_PER_FRAME } from "../../engine/src/m6502/sound-clock.js";
import { as_u8 } from "../../engine/src/wrap.js";

const rom421 = new Uint8Array(readFileSync("/tmp/sound-roms/136033.421"));
const rom422 = new Uint8Array(readFileSync("/tmp/sound-roms/136033.422"));

function inspect(chip: ReturnType<typeof createSoundChip>): { voiceWritten: number; nonZeroRam: number; ymInit: number } {
  let voiceWritten = 0;
  for (let r = 0x20; r < 0x80; r++) {
    if (chip.ym2151.regs[r] !== 0) voiceWritten++;
  }
  let ymInit = 0;
  for (let r = 0x00; r < 0x20; r++) {
    if (chip.ym2151.regs[r] !== 0) ymInit++;
  }
  let nonZero = 0;
  for (let i = 0; i < chip.mmu.ram.length; i++) if (chip.mmu.ram[i] !== 0) nonZero++;
  return { voiceWritten, nonZeroRam: nonZero, ymInit };
}

function tryCmd(cmd: number, settleFrames: number = 60): { voiceWritten: number; nonZeroRam: number; ymInit: number } {
  const chip = createSoundChip({ roms: { rom421, rom422 } });
  // Hardware-faithful: submit cmd during reset (NMI suppressed), then release.
  // releaseSoundReset fires NMI for the queued cmd, matching MAME's edge-latch.
  submitCommand(chip, as_u8(cmd));
  releaseSoundReset(chip);
  for (let f = 0; f < settleFrames; f++) {
    tickCycles(chip, SOUND_CYCLES_PER_FRAME);
    drainReplyEvents(chip);
  }
  drainYm2151Samples(chip);
  drainPokeySamples(chip);
  return inspect(chip);
}

const testBytes = [0x00, 0x01, 0x03, 0x07, 0x08, 0x0a, 0x2f, 0x32, 0x34, 0x39, 0x3a, 0x3b, 0x3d, 0x40, 0x42, 0x45, 0x46, 0x61];
console.log(`Testing ${testBytes.length} cmd bytes in isolation (60f settle):`);
for (const cmd of testBytes) {
  const r = tryCmd(cmd);
  console.log(`  cmd 0x${cmd.toString(16).padStart(2,'0')}: voice regs=${r.voiceWritten}/96, ymInit regs=${r.ymInit}/32, audioRam=${r.nonZeroRam}`);
}

// Stream of 0x03 ticks plus paired 0x61 + 0x01 commands to simulate music start.
{
  const chip = createSoundChip({ roms: { rom421, rom422 } });
  submitCommand(chip, as_u8(0x00));
  releaseSoundReset(chip);
  for (let f = 0; f < 60; f++) {
    submitCommand(chip, as_u8(0x03));
    tickCycles(chip, SOUND_CYCLES_PER_FRAME);
    drainReplyEvents(chip);
  }
  submitCommand(chip, as_u8(0x61));
  for (let f = 0; f < 5; f++) {
    tickCycles(chip, SOUND_CYCLES_PER_FRAME);
    drainReplyEvents(chip);
  }
  submitCommand(chip, as_u8(0x01));
  for (let f = 0; f < 120; f++) {
    submitCommand(chip, as_u8(0x03));
    tickCycles(chip, SOUND_CYCLES_PER_FRAME);
    drainReplyEvents(chip);
  }
  drainYm2151Samples(chip);
  const r = inspect(chip);
  console.log(`  0x00 + 60×0x03 + 0x61 + 0x01 + 120×0x03 sustained: voice=${r.voiceWritten}/96, ymInit=${r.ymInit}/32, audioRam=${r.nonZeroRam}`);
}
