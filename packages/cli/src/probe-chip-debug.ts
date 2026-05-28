import { readFileSync } from "node:fs";
import { createSoundChip, releaseSoundReset, drainYm2151Samples, drainPokeySamples, loadCmdTape, submitCommand, tickCycles, drainReplyEvents, getRegisterShadow } from "../../engine/src/m6502/sound-chip.js";
import { SOUND_CYCLES_PER_FRAME } from "../../engine/src/m6502/sound-clock.js";
import { as_u8 } from "../../engine/src/wrap.js";

const rom421 = new Uint8Array(readFileSync("/tmp/sound-roms/136033.421"));
const rom422 = new Uint8Array(readFileSync("/tmp/sound-roms/136033.422"));
const tape = loadCmdTape(JSON.parse(readFileSync("oracle/scenarios/sound-cmd-tape-attract.json", "utf8")));

const chip = createSoundChip({ roms: { rom421, rom422 } });
// CRITICAL: in MAME the main 68K keeps the sound 6502 in reset until the first
// command (~f244 in the attract tape). If TS releases reset at f0, the 6502 runs
// 244 idle frames and accumulates divergent state. Release only when a command
// arrives.
const firstCmdFrame = Math.min(...Array.from(tape.byFrame.keys()));
// MAME hardware ordering at f244: $FE0001 write (cmd, sound CPU in reset),
// then $860001 bit7=1 (release). The command reaches the sound latch without
// NMI because the CPU in reset does not latch the edge; the 6502 then leaves
// reset and polls $1810. To mirror that, submit commands before release at
// firstCmdFrame; submitCommand suppresses NMI while inReset=true.
const RESET_RELEASE_OFFSET = Number(process.env.RESET_OFFSET ?? "0");
const releaseFrame = Math.max(0, firstCmdFrame - RESET_RELEASE_OFFSET);
console.log(`First cmd frame: ${firstCmdFrame}, release at: ${releaseFrame}`);

let totalYm = 0, totalPk = 0, maxAbsYm = 0, maxAbsPk = 0;
let released = false;
for (let f = 0; f < 600; f++) {
  // STEP 1: submit this frame's commands. submitCommand suppresses NMI in reset.
  const frameCmds = tape.byFrame.get(f);
  if (frameCmds !== undefined) {
    for (const b of frameCmds) submitCommand(chip, as_u8(b));
  }
  // STEP 2: release reset at the target frame, after submit to match MAME.
  if (!released && f >= releaseFrame) {
    releaseSoundReset(chip);
    released = true;
    console.log(`Released sound reset at f${f}`);
  }
  // STEP 3: tick one frame worth of cycles.
  tickCycles(chip, SOUND_CYCLES_PER_FRAME);
  // STEP 4: drain reply queue, simulating the main 68K reading $FC0001 in the
  // IRQ6 handler. Without draining, soundToMain.pending stays true and the
  // sound 6502 stalls in the NMI handler waiting for the response buffer.
  drainReplyEvents(chip);
  const ym = drainYm2151Samples(chip);
  const pk = drainPokeySamples(chip);
  for (const s of ym) { totalYm++; if (Math.abs(s) > maxAbsYm) maxAbsYm = Math.abs(s); }
  for (const s of pk) { totalPk++; if (Math.abs(s) > maxAbsPk) maxAbsPk = Math.abs(s); }
  if (f === 300 || f === 599) {
    const shadow = getRegisterShadow(chip);
    const nonZeroYm = Array.from(shadow.ym2151Regs).map((v,i)=>({i,v})).filter(x => x.v !== 0);
    const nonZeroPk = Array.from(shadow.pokeyWriteRegs).map((v,i)=>({i,v})).filter(x => x.v !== 0);
    console.log(`f${f}: ym2151 non-zero regs (${nonZeroYm.length}):`, nonZeroYm.slice(0,30).map(x=>`$${x.i.toString(16)}=$${x.v.toString(16)}`).join(' '));
    console.log(`f${f}: pokey non-zero regs (${nonZeroPk.length}):`, nonZeroPk.map(x=>`$${x.i.toString(16)}=$${x.v.toString(16)}`).join(' '));
  }
}
console.log(`Total YM samples=${totalYm} maxAbs=${maxAbsYm.toExponential(3)}`);
console.log(`Total PK samples=${totalPk} maxAbs=${maxAbsPk.toExponential(3)}`);
console.log(`Reply queue: ${chip.replyQueue.length}, pending main->snd: ${chip.mainToSound.pending}`);
console.log(`6502 cycles: ${chip.cpu.cycles}`);
let audioRamNonZero = 0;
for (let i = 0; i < chip.mmu.ram.length; i++) if (chip.mmu.ram[i] !== 0) audioRamNonZero++;
console.log(`audioRam non-zero bytes: ${audioRamNonZero}/${chip.mmu.ram.length}`);
console.log(`audioRam[0..63]:`, Array.from(chip.mmu.ram.slice(0,64)).map(b=>b.toString(16).padStart(2,'0')).join(' '));
// Print non-zero byte offsets to see what 6502 wrote
const nonZeroOffsets: number[] = [];
for (let i = 0; i < chip.mmu.ram.length; i++) if (chip.mmu.ram[i] !== 0) nonZeroOffsets.push(i);
console.log(`Non-zero offsets:`, nonZeroOffsets.slice(0,30).map(o => `$${o.toString(16)}=$${chip.mmu.ram[o]!.toString(16).padStart(2,'0')}`).join(' '));
const cpuInner = chip.cpu as unknown as { rf?: { pc?: number; sp?: number; a?: number; x?: number; y?: number } };
const rf = cpuInner.rf;
if (rf) console.log(`CPU rf: PC=$${(rf.pc??0).toString(16)} SP=$${(rf.sp??0).toString(16)} A=$${(rf.a??0).toString(16)} X=$${(rf.x??0).toString(16)} Y=$${(rf.y??0).toString(16)}`);
console.log(`CPU state keys:`, Object.keys(chip.cpu).slice(0,20).join(','));
console.log(`YM2151 keys:`, Object.keys(chip.ym2151).slice(0,30).join(','));
const ym = chip.ym2151 as unknown as Record<string, unknown>;
console.log(`YM2151 timerA: enable=${ym.timerAIrqEnable} overflow=${ym.timerAOverflow}`);
console.log(`YM2151 timerB: enable=${ym.timerBIrqEnable} overflow=${ym.timerBOverflow}`);
console.log(`6502 irq=${chip.cpu.irq} nmi=${chip.cpu.nmi}`);
