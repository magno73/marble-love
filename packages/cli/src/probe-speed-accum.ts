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

for (let i = 1; i <= 99; i++) {
  tick(s, { rom, runMainLoopBody: true, p1X: 0xff, p1Y: 0xff, p2X: 0xff, p2Y: 0xff });
  const mw = hex2bytes(gt.snapshots[i]!.workRam, 0x2000);
  const tsSpd = s.workRam[0xa]!; const mSpd = mw[0xa]!;
  const tsAcc = (s.workRam[0xc]! << 8) | s.workRam[0xd]!; const mAcc = (mw[0xc]! << 8) | mw[0xd]!;
  const tsHud = (s.workRam[0x97e]! << 8) | s.workRam[0x97f]!; const mHud = (mw[0x97e]! << 8) | mw[0x97f]!;
  if (tsSpd !== mSpd || tsAcc !== mAcc) {
    console.log(`f+${i.toString().padStart(2)}: spd TS=${tsSpd} MAME=${mSpd} | accum TS=0x${tsAcc.toString(16)} MAME=0x${mAcc.toString(16)} | hudOff TS=0x${tsHud.toString(16)} MAME=0x${mHud.toString(16)}`);
    if (i > 70) break;
  }
}
