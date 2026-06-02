import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { state as stateNs, bus as busNs, bootInit, tick, applySlapsticBank } from "@marble-love/engine";

const rom = busNs.emptyRomImage();
applySlapsticBank.loadRomBlob(rom, readFileSync(resolve("ghidra_project/marble_program.bin")));
const gt = JSON.parse(readFileSync("/tmp/mame_100f.json","utf-8")) as { snapshots: { workRam: string; playfieldRam: string; spriteRam: string; alphaRam: string; colorRam: string }[] };
const hex2bytes = (h: string, l: number) => { const o = new Uint8Array(l); for (let i = 0; i < l; i++) o[i] = parseInt(h.substr(i*2,2),16); return o; };
const f0 = gt.snapshots[0]!;
const warm = { workRam: hex2bytes(f0.workRam, 0x2000), playfieldRam: hex2bytes(f0.playfieldRam, 0x2000), spriteRam: hex2bytes(f0.spriteRam, 0x1000), alphaRam: hex2bytes(f0.alphaRam, 0x1000), colorRam: hex2bytes(f0.colorRam, 0x800), videoScrollX: 0, videoScrollY: 0, slapsticBank: 1 };
const s = stateNs.emptyGameState();
bootInit(s, rom, { warmState: warm });

// Tick + override obj0.z_long from MAME on each tick
for (let i = 1; i <= 99; i++) {
  tick(s, { rom, runMainLoopBody: true, p1X: 0xff, p1Y: 0xff, p2X: 0xff, p2Y: 0xff });
  // Override obj0.z_long (offset 0x2c..0x2f) from MAME snapshot[i]
  const mw = hex2bytes(gt.snapshots[i]!.workRam, 0x2000);
  s.workRam[0x2c] = mw[0x2c]!;
  s.workRam[0x2d] = mw[0x2d]!;
  s.workRam[0x2e] = mw[0x2e]!;
  s.workRam[0x2f] = mw[0x2f]!;
}

// Final drift
const mw99 = hex2bytes(gt.snapshots[99]!.workRam, 0x2000);
let total = 0, gameplay = 0, stack = 0;
const isStack = (o: number) => (o >= 0x440 && o < 0x448) || (o >= 0x1D40 && o < 0x1E80) || (o >= 0x1EE0 && o < 0x1F00);
for (let i = 0; i < 0x2000; i++) {
  if (s.workRam[i] !== mw99[i]) {
    total++;
    if (isStack(i)) stack++; else gameplay++;
  }
}
console.log(`POST-EXPERIMENT (obj0.z override @ each tick): total=${total} gameplay=${gameplay} stack-residue=${stack}`);
console.log(`Baseline drift: total=376 gameplay=204 stack-residue=172`);
console.log(`Delta drift: ${376-total} (gameplay: ${204-gameplay})`);
