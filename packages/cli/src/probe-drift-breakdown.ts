import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { state as stateNs, bus as busNs, bootInit, tick } from "@marble-love/engine";

const rom = busNs.emptyRomImage();
rom.program.set(readFileSync(resolve("ghidra_project/marble_program.bin")).subarray(0, rom.program.length));
const j = JSON.parse(readFileSync("/tmp/mame_100f.json", "utf-8")) as { snapshots: { workRam: string }[] };
function h2b(hex: string, len: number) { const o = new Uint8Array(len); for (let i = 0; i < len; i++) o[i] = parseInt(hex.substr(i*2,2),16); return o; }

const f0 = j.snapshots[0]!;
const s = stateNs.emptyGameState();
bootInit(s, rom, { warmState: { workRam: h2b(f0.workRam,0x2000), playfieldRam: h2b((f0 as any).playfieldRam,0x2000), spriteRam: h2b((f0 as any).spriteRam,0x1000), alphaRam: h2b((f0 as any).alphaRam,0x1000), colorRam: h2b((f0 as any).colorRam,0x800), videoScrollX:0, videoScrollY:0 } });
for (let i = 1; i <= 99; i++) tick(s, { rom, runMainLoopBody: true, p1X:0xff, p1Y:0xff, p2X:0xff, p2Y:0xff });

const mameW = h2b(j.snapshots[99]!.workRam, 0x2000);
let total = 0, stack = 0, nonStack = 0;
for (let i = 0; i < 0x2000; i++) {
  if (s.workRam[i] !== mameW[i]) {
    total++;
    if (i >= 0x1d70 && i < 0x1ff0) stack++;
    else nonStack++;
  }
}
console.log(`Drift @ f+99 (workRam):`);
console.log(`  TOTAL:     ${total} / 8192 = ${(total/8192*100).toFixed(1)}% diverging`);
console.log(`  STACK (0x1d70-0x1fef): ${stack} byte (M68K scratch, IRRIDUCIBILE senza byte emulation)`);
console.log(`  NON-STACK: ${nonStack} byte / ${0x2000 - 0x280} = ${(nonStack/(0x2000-0x280)*100).toFixed(2)}% diverging (= zona fixable)`);
console.log(`  Match non-stack: ${100 - nonStack/(0x2000-0x280)*100}%`);
