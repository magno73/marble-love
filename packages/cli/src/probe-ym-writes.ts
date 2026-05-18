// probe-ym-writes.ts — log ogni write YM2151 di TS sulla cmd-tape attract.
// Output equivalente a oracle/mame_ym2151_write_log.lua per diff diretto.
import { readFileSync, writeFileSync } from "node:fs";
import { createSoundChip, releaseSoundReset, submitCommand, drainReplyEvents } from "../../engine/src/m6502/sound-chip.js";
import { SOUND_CYCLES_PER_FRAME } from "../../engine/src/m6502/sound-clock.js";
import { step as cpuStep, requestIrq, clearIrq } from "../../engine/src/m6502/cpu.js";
import { ym2151TickCycles } from "../../engine/src/audio/ym2151.js";
import { pokeyTickCycles } from "../../engine/src/audio/pokey.js";
import { as_u8 } from "../../engine/src/wrap.js";

const TARGET_FRAME = Number(process.env.TARGET_FRAME ?? "2000");
const rom421 = new Uint8Array(readFileSync("/tmp/sound-roms/136033.421"));
const rom422 = new Uint8Array(readFileSync("/tmp/sound-roms/136033.422"));
// Cycle-precise tape: ogni cmd ha secs+attos del momento di write MAME.
// TS replay submette al cycle 6502 corrispondente entro il frame.
const CPU_HZ = 1789772;
type RawCmd = { frame: number; byte: number; secs?: number; attos?: string };
const rawTape: { cmds: RawCmd[] } = JSON.parse(readFileSync(
  "oracle/scenarios/sound-cmd-tape-attract-cycle-precise.json", "utf8"));
function cmdAbsCyc(c: RawCmd): bigint {
  const a = BigInt(c.attos ?? "0");
  const s = BigInt(c.secs ?? 0);
  return (s * 10n ** 18n + a) * BigInt(CPU_HZ) / 10n ** 18n;
}
// Reference cycle: first cmd. Relative cycle = absCyc - refCyc.
const firstCmdRef = cmdAbsCyc(rawTape.cmds[0]!);
const firstCmdFrame = rawTape.cmds[0]!.frame;
// Build per-frame cmd list with sub-frame cycle offset.
type FrameCmd = { byte: number; cycleInFrame: number };
const byFrame = new Map<number, FrameCmd[]>();
for (const c of rawTape.cmds) {
  const absCyc = cmdAbsCyc(c);
  const relCyc = Number(absCyc - firstCmdRef);  // cyc since first cmd
  // First cmd is at frame=firstCmdFrame, so cyc=0 at that frame start.
  // cycleInFrame = relCyc mod SOUND_CYCLES_PER_FRAME (approssimazione).
  const frame = c.frame;
  const frameStartCyc = (frame - firstCmdFrame) * SOUND_CYCLES_PER_FRAME;
  const cycleInFrame = Math.max(0, relCyc - frameStartCyc);
  let bucket = byFrame.get(frame);
  if (bucket === undefined) { bucket = []; byFrame.set(frame, bucket); }
  bucket.push({ byte: c.byte, cycleInFrame });
}

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

function tickToCycle(targetCycInFrame: number, frameStartCycle: number) {
  while (chip.cpu.cycles - frameStartCycle < targetCycInFrame) {
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

for (let f = 0; f < TARGET_FRAME; f++) {
  currentFrame = f;
  if (!released && f >= firstCmdFrame) {
    releaseSoundReset(chip);
    released = true;
  }
  if (!released) continue;
  const cmds = byFrame.get(f);
  const frameStart = chip.cpu.cycles;
  if (cmds !== undefined && cmds.length > 0) {
    // Cycle-precise: tick fino al cycle di ogni cmd, poi submit.
    for (const c of cmds) {
      tickToCycle(c.cycleInFrame, frameStart);
      submitCommand(chip, as_u8(c.byte));
    }
  }
  tickToCycle(SOUND_CYCLES_PER_FRAME, frameStart);
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
