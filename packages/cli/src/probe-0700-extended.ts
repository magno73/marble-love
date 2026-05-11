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
for (let i = 1; i <= 99; i++) tick(s, { rom, runMainLoopBody: true, p1X: 0xff, p1Y: 0xff, p2X: 0xff, p2Y: 0xff });
const mw = hex2bytes(gt.snapshots[99]!.workRam, 0x2000);
// per ogni 16-byte chunk in 0x700..0x77F mostra TS vs MAME
for (let base = 0x700; base < 0x780; base += 0x10) {
  const ts = Array.from(s.workRam.slice(base, base+0x10)).map(b=>b.toString(16).padStart(2,"0")).join(" ");
  const m = Array.from(mw.slice(base, base+0x10)).map(b=>b.toString(16).padStart(2,"0")).join(" ");
  let d = 0; for (let off = base; off < base+0x10; off++) if (s.workRam[off] !== mw[off]) d++;
  if (d > 0) {
    console.log(`@ 0x${base.toString(16)} (diff=${d}):`);
    console.log(`  TS:   ${ts}`);
    console.log(`  MAME: ${m}`);
  }
}
