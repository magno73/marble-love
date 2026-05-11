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

function getSrtgt(buf: Uint8Array): number {
  return ((buf[0x97c]! << 24) | (buf[0x97d]! << 16) | (buf[0x97e]! << 8) | buf[0x97f]!) >>> 0;
}

for (let i = 1; i <= 99; i++) {
  tick(s, { rom, runMainLoopBody: true, p1X: 0xff, p1Y: 0xff, p2X: 0xff, p2Y: 0xff });
  const ts = getSrtgt(s.workRam);
  const m = getSrtgt(hex2bytes(gt.snapshots[i]!.workRam, 0x2000));
  if (ts !== m) {
    console.log(`f+${i.toString().padStart(2)}: srtgt TS=0x${ts.toString(16).padStart(8,"0")} MAME=0x${m.toString(16).padStart(8,"0")} (diff=${(ts-m)|0})`);
    if (i > 65) break;
  }
}
