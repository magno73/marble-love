// probe-ym-writes.ts — log ogni write YM2151 di TS sulla cmd-tape attract.
// Output equivalente a oracle/mame_ym2151_write_log.lua per diff diretto.
import { readFileSync, writeFileSync } from "node:fs";
import { createSoundChip, releaseSoundReset, submitCommand, loadCmdTape, drainReplyEvents } from "../../engine/src/m6502/sound-chip.js";
import { SOUND_CYCLES_PER_FRAME } from "../../engine/src/m6502/sound-clock.js";
import { step as cpuStep, requestIrq, clearIrq } from "../../engine/src/m6502/cpu.js";
import { ym2151TickCycles } from "../../engine/src/audio/ym2151.js";
import { pokeyTickCycles } from "../../engine/src/audio/pokey.js";
import { as_u8 } from "../../engine/src/wrap.js";

const TARGET_FRAME = Number(process.env.TARGET_FRAME ?? "2000");
const rom421 = new Uint8Array(readFileSync("/tmp/sound-roms/136033.421"));
const rom422 = new Uint8Array(readFileSync("/tmp/sound-roms/136033.422"));
const tape = loadCmdTape(JSON.parse(readFileSync("oracle/scenarios/sound-cmd-tape-attract-music.json", "utf8")));
const firstCmdFrame = Math.min(...Array.from(tape.byFrame.keys()));

const chip = createSoundChip({ roms: { rom421, rom422 } });

interface WriteRec { reg: number; val: number; pc: number; frame: number; cycle: number; }
const writes: WriteRec[] = [];

// Patch MMU to intercept YM writes by wrapping mmu.write8
const origWrite = chip.mmu.write8;
chip.mmu.write8 = (addr: any, value: any) => {
  const a = addr as number;
  if (a === 0x1801) {
    writes.push({
      reg: chip.ym2151.selectedReg,
      val: value as number,
      pc: chip.cpu.rf.pc as number,
      frame: currentFrame,
      cycle: chip.cpu.cycles,
    });
  }
  return origWrite(addr, value);
};

let released = false;
let currentFrame = 0;

for (let f = 0; f < TARGET_FRAME; f++) {
  currentFrame = f;
  const cmds = tape.byFrame.get(f);
  if (cmds !== undefined) {
    for (const b of cmds) submitCommand(chip, as_u8(b));
  }
  if (!released && f >= firstCmdFrame) {
    releaseSoundReset(chip);
    released = true;
  }
  if (!released) continue;
  const startCycle = chip.cpu.cycles;
  while (chip.cpu.cycles - startCycle < SOUND_CYCLES_PER_FRAME) {
    const stepStart = chip.cpu.cycles;
    cpuStep(chip.cpu, chip.mmu);
    const stepCycles = chip.cpu.cycles - stepStart;
    ym2151TickCycles(chip.ym2151, stepCycles);
    pokeyTickCycles(chip.pokey, stepCycles);
    const irqPin =
      (chip.ym2151.timerAOverflow && chip.ym2151.timerAIrqEnable) ||
      (chip.ym2151.timerBOverflow && chip.ym2151.timerBIrqEnable);
    if (irqPin) requestIrq(chip.cpu);
    else clearIrq(chip.cpu);
  }
  drainReplyEvents(chip);
}

writeFileSync("/tmp/ts_ym_writes.json", JSON.stringify({
  writes: writes.map(w => ({
    reg: `0x${w.reg.toString(16).padStart(2,'0')}`,
    val: `0x${w.val.toString(16).padStart(2,'0')}`,
    pc: `0x${w.pc.toString(16).padStart(4,'0')}`,
    frame: w.frame,
    cycle: w.cycle,
  })),
}, null, 2));
console.log(`[ts_ym_writes] saved ${writes.length} writes`);
