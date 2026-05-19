// probe-pc-cycles.ts — Drill A1 cycle-exact.
// Avvia il sound chip TS via cmd-tape replay (stessa cmd-tape attract usata da
// MAME oracle), step istruzione-per-istruzione, registra il cycle count alla
// PRIMA volta che ogni PC checkpoint viene raggiunto. Output JSON in stesso
// formato di oracle/mame_sound_pc_cycles.lua per diff diretto.
import { readFileSync, writeFileSync } from "node:fs";
import { createSoundChip, releaseSoundReset, submitCommand, loadCmdTape } from "../../engine/src/m6502/sound-chip.js";
import { SOUND_CYCLES_PER_FRAME } from "../../engine/src/m6502/sound-clock.js";
import { step as cpuStep, requestIrq, clearIrq } from "../../engine/src/m6502/cpu.js";
import { ym2151TickCycles } from "../../engine/src/audio/ym2151.js";
import { pokeyTickCycles } from "../../engine/src/audio/pokey.js";
import { as_u8 } from "../../engine/src/wrap.js";

const CHECKPOINTS = [
  0x8002, 0x8016, 0x802C, 0x808F, 0x80A3, 0x80A6, 0x80AD, 0x80AE,
  0x80B5, 0x80C3, 0x80C8, 0x80E7, 0x80EA, 0x80EE,
  0x8177, 0x8179, 0x81A2, 0x81A5,
  0x81A6, 0x81B1, 0x81B8, 0x81C3, 0x81FE,
  0x8359, 0x84E9, 0x85C0, 0x85D5,
  0x8722, 0x8724, 0x873D,
  0x9566, 0x9569, 0x956C,
];
const cpSet = new Set(CHECKPOINTS);

const rom421 = new Uint8Array(readFileSync("/tmp/sound-roms/136033.421"));
const rom422 = new Uint8Array(readFileSync("/tmp/sound-roms/136033.422"));
const tape = loadCmdTape(JSON.parse(readFileSync("oracle/scenarios/sound-cmd-tape-attract.json", "utf8")));
const firstCmdFrame = Math.min(...Array.from(tape.byFrame.keys()));

const chip = createSoundChip({ roms: { rom421, rom422 } });

const hits = new Map<number, { cycle: number; frame: number }>();
const TARGET_FRAME = Number(process.env.TARGET_FRAME ?? "500");

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

  // Replica logica di tickCycles ma con PC tap dopo ogni step.
  const startCycle = chip.cpu.cycles;
  while (chip.cpu.cycles - startCycle < SOUND_CYCLES_PER_FRAME) {
    const pcBefore = chip.cpu.rf.pc as number;
    if (cpSet.has(pcBefore) && !hits.has(pcBefore)) {
      hits.set(pcBefore, { cycle: chip.cpu.cycles, frame: f });
    }
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
}

// Normalize: cycle delta vs PC=0x8002 ref (match MAME output style).
const refHit = hits.get(0x8002);
const ref = refHit !== undefined ? refHit.cycle : 0;

const obj: { hits: Record<string, { cycle: number; delta: number; frame: number }> } = { hits: {} };
const sorted = [...hits.keys()].sort((a, b) => a - b);
for (const pc of sorted) {
  const h = hits.get(pc)!;
  obj.hits[`0x${pc.toString(16).padStart(4, "0")}`] = {
    cycle: h.cycle,
    delta: h.cycle - ref,
    frame: h.frame,
  };
}
writeFileSync("/tmp/ts_pc_cycles.json", JSON.stringify(obj, null, 2));
console.log(`[ts_pc_cycles] saved ${hits.size}/${CHECKPOINTS.length} checkpoint hits`);
console.log(`ref (PC=0x8002) cycle = ${ref.toLocaleString()}`);
for (const pc of sorted) {
  const h = hits.get(pc)!;
  console.log(`  PC=0x${pc.toString(16).padStart(4, "0")}: cycle+${(h.cycle - ref).toString().padStart(10, " ")} frame=${h.frame}`);
}
const missed = CHECKPOINTS.filter((pc) => !hits.has(pc));
if (missed.length > 0) {
  console.log(`MISSED: ${missed.map((pc) => "0x" + pc.toString(16)).join(", ")}`);
}
