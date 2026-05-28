// probe-audioram-snapshot.ts — snapshot TS audioRam a frame target.
// Output JSON in the same format as mame_audioram_snapshot.lua for diffing.
import { readFileSync, writeFileSync } from "node:fs";
import { createSoundChip, releaseSoundReset, submitCommand, loadCmdTape, tickCycles, drainReplyEvents } from "../../engine/src/m6502/sound-chip.js";
import { SOUND_CYCLES_PER_FRAME } from "../../engine/src/m6502/sound-clock.js";
import { as_u8 } from "../../engine/src/wrap.js";

const SNAPSHOT_FRAMES = [350, 360, 370, 374, 375, 380, 400];
const TARGET_FRAME = 410;

const rom421 = new Uint8Array(readFileSync("/tmp/sound-roms/136033.421"));
const rom422 = new Uint8Array(readFileSync("/tmp/sound-roms/136033.422"));
const tape = loadCmdTape(JSON.parse(readFileSync("oracle/scenarios/sound-cmd-tape-attract-music.json", "utf8")));
const firstCmdFrame = Math.min(...Array.from(tape.byFrame.keys()));

const chip = createSoundChip({ roms: { rom421, rom422 } });
const snapshots: Record<number, number[]> = {};

let released = false;
for (let f = 0; f < TARGET_FRAME; f++) {
  const cmds = tape.byFrame.get(f);
  if (cmds !== undefined) {
    for (const b of cmds) submitCommand(chip, as_u8(b));
  }
  if (!released && f >= firstCmdFrame) {
    releaseSoundReset(chip);
    released = true;
  }
  if (!released) continue;
  tickCycles(chip, SOUND_CYCLES_PER_FRAME);
  drainReplyEvents(chip);
  if (SNAPSHOT_FRAMES.includes(f)) {
    snapshots[f] = Array.from(chip.mmu.ram);
  }
}

writeFileSync("/tmp/ts_audioram.json", JSON.stringify({ snapshots }));
console.log(`Saved snapshots: ${Object.keys(snapshots).join(', ')}`);
