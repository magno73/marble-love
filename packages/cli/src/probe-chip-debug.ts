import { readFileSync } from "node:fs";
import { createSoundChip, releaseSoundReset, drainYm2151Samples, drainPokeySamples, loadCmdTape, tickFrameWithTape, getRegisterShadow } from "../../engine/src/m6502/sound-chip.js";

const rom421 = new Uint8Array(readFileSync("/tmp/sound-roms/136033.421"));
const rom422 = new Uint8Array(readFileSync("/tmp/sound-roms/136033.422"));
const tape = loadCmdTape(JSON.parse(readFileSync("oracle/scenarios/sound-cmd-tape-attract.json", "utf8")));

const chip = createSoundChip({ roms: { rom421, rom422 } });
releaseSoundReset(chip);

let totalYm = 0, totalPk = 0, maxAbsYm = 0, maxAbsPk = 0;
for (let f = 0; f < 600; f++) {
  tickFrameWithTape(chip, tape, f);
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
console.log(`CPU state keys:`, Object.keys(chip.cpu).slice(0,20).join(','));
console.log(`YM2151 keys:`, Object.keys(chip.ym2151).slice(0,30).join(','));
const ym = chip.ym2151 as unknown as Record<string, unknown>;
console.log(`YM2151 timerA: enable=${ym.timerAIrqEnable} overflow=${ym.timerAOverflow}`);
console.log(`YM2151 timerB: enable=${ym.timerBIrqEnable} overflow=${ym.timerBOverflow}`);
console.log(`6502 irq=${chip.cpu.irq} nmi=${chip.cpu.nmi}`);
