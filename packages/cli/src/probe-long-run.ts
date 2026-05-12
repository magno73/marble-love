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

for (let i = 1; i <= 1000; i++) {
  tick(s, { rom, runMainLoopBody: true, p1X: 0xff, p1Y: 0xff, p2X: 0xff, p2Y: 0xff });
  if (i === 99 || i === 200 || i === 500 || i === 1000) {
    const x = ((s.workRam[0x18+0xc]! << 24) | (s.workRam[0x18+0xd]! << 16) | (s.workRam[0x18+0xe]! << 8) | s.workRam[0x18+0xf]!) >>> 0;
    const y = ((s.workRam[0x18+0x10]! << 24) | (s.workRam[0x18+0x11]! << 16) | (s.workRam[0x18+0x12]! << 8) | s.workRam[0x18+0x13]!) >>> 0;
    const z = ((s.workRam[0x18+0x14]! << 24) | (s.workRam[0x18+0x15]! << 16) | (s.workRam[0x18+0x16]! << 8) | s.workRam[0x18+0x17]!) >>> 0;
    const vx = ((s.workRam[0x18+0x0]! << 24) | (s.workRam[0x18+0x1]! << 16) | (s.workRam[0x18+0x2]! << 8) | s.workRam[0x18+0x3]!) >>> 0;
    const sprNz = Array.from(s.spriteRam).filter(b => b !== 0).length;
    console.log(`f+${i.toString().padStart(4)}: obj0.x=0x${x.toString(16).padStart(8,"0")} y=0x${y.toString(16).padStart(8,"0")} z=0x${z.toString(16).padStart(8,"0")} vx=0x${vx.toString(16).padStart(8,"0")} | spriteRam nz=${sprNz}`);
  }
}
