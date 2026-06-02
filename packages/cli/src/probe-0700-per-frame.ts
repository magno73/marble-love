// probe-0700-per-frame.ts — compare cluster 0x0700..0x077f TS vs MAME on each frame
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { state as stateNs, bus as busNs, bootInit, tick, applySlapsticBank } from "@marble-love/engine";

const rom = busNs.emptyRomImage();
applySlapsticBank.loadRomBlob(rom, readFileSync(resolve("ghidra_project/marble_program.bin")));

const gt = JSON.parse(readFileSync("/tmp/mame_100f.json", "utf-8")) as any;
function hex2bytes(hex: string, len: number): Uint8Array {
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}
const f0 = gt.snapshots[0];
const warm = {
  workRam: hex2bytes(f0.workRam, 0x2000),
  playfieldRam: hex2bytes(f0.playfieldRam, 0x2000),
  spriteRam: hex2bytes(f0.spriteRam, 0x1000),
  alphaRam: hex2bytes(f0.alphaRam, 0x1000),
  colorRam: hex2bytes(f0.colorRam, 0x800),
  videoScrollX: 0,
  videoScrollY: 0,
  slapsticBank: 1,
};
const s = stateNs.emptyGameState();
bootInit(s, rom, { warmState: warm });

const REG_START = 0x0700;
const REG_END = 0x0780; // exclusive

function diffBytes(tsW: Uint8Array, mameW: Uint8Array, start: number, end: number): { diffCount: number; firstDiff: number | null } {
  let diffCount = 0;
  let firstDiff: number | null = null;
  for (let o = start; o < end; o++) {
    if (tsW[o] !== mameW[o]) {
      diffCount++;
      if (firstDiff === null) firstDiff = o;
    }
  }
  return { diffCount, firstDiff };
}

console.log("frame  | diff_0x0700-077F | first_diff_off | TS bytes (first 8 from 0x700)");
console.log("-------|------------------|----------------|-------------------------------");
for (let i = 1; i <= gt.snapshots.length - 1; i++) {
  tick(s, { rom, runMainLoopBody: true, p1X: 0xff, p1Y: 0xff, p2X: 0xff, p2Y: 0xff });
  const mame = hex2bytes(gt.snapshots[i].workRam, 0x2000);
  const { diffCount, firstDiff } = diffBytes(s.workRam, mame, REG_START, REG_END);
  if (diffCount > 0 || i < 5 || i === 99) {
    const tsBytes = Array.from(s.workRam.subarray(0x700, 0x708)).map(b => b.toString(16).padStart(2, "0")).join(" ");
    const mameBytes = Array.from(mame.subarray(0x700, 0x708)).map(b => b.toString(16).padStart(2, "0")).join(" ");
    const fdStr = firstDiff !== null ? "0x" + firstDiff.toString(16) : "-";
    console.log(`f+${i.toString().padStart(2)}  | ${diffCount.toString().padStart(2)}              | ${fdStr.padEnd(14)} | TS=${tsBytes}\n       |                  |                | MA=${mameBytes}`);
  }
}
