// Probe video parity: compare spriteRam / playfieldRam / alphaRam / colorRam
// TS vs MAME a various frame. Output: byte diff for each video buffer.
// If all the buffers are == 0 byte diff → output visual IDENTICO bit-perfect.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { state as stateNs, bus as busNs, bootInit, tick, applySlapsticBank } from "@marble-love/engine";

const rom = busNs.emptyRomImage();
applySlapsticBank.loadRomBlob(rom, readFileSync(resolve("ghidra_project/marble_program.bin")));

const groundTruth = JSON.parse(readFileSync("/tmp/mame_100f.json", "utf-8")) as {
  snapshots: { frame: number; workRam: string; spriteRam: string; playfieldRam: string; alphaRam: string; colorRam: string }[];
};

function hex2bytes(hex: string, len: number): Uint8Array {
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

const frame0 = groundTruth.snapshots[0]!;
const warm = {
  workRam: hex2bytes(frame0.workRam, 0x2000),
  playfieldRam: hex2bytes(frame0.playfieldRam, 0x2000),
  spriteRam: hex2bytes(frame0.spriteRam, 0x1000),
  alphaRam: hex2bytes(frame0.alphaRam, 0x1000),
  colorRam: hex2bytes(frame0.colorRam, 0x800),
  videoScrollX: 0,
  videoScrollY: 0,
  slapsticBank: 1,
};

const s = stateNs.emptyGameState();
bootInit(s, rom, { warmState: warm });

function countDiff(a: Uint8Array, b: Uint8Array): number {
  let d = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) d++;
  return d;
}

const CHECK_FRAMES = [1, 10, 25, 50, 75, 99];
console.log("frame | spriteRam   | playfieldRam | alphaRam    | colorRam    | total video diff");
console.log("------+-------------+--------------+-------------+-------------+-----------------");

let lastF = 0;
for (const f of CHECK_FRAMES) {
  for (let i = lastF + 1; i <= f; i++) {
    tick(s, { rom, runMainLoopBody: true, p1X: 0xff, p1Y: 0xff, p2X: 0xff, p2Y: 0xff });
  }
  lastF = f;
  const sn = groundTruth.snapshots[f]!;
  const mSp = hex2bytes(sn.spriteRam, 0x1000);
  const mPf = hex2bytes(sn.playfieldRam, 0x2000);
  const mAl = hex2bytes(sn.alphaRam, 0x1000);
  const mCol = hex2bytes(sn.colorRam, 0x800);

  const dSp = countDiff(s.spriteRam, mSp);
  const dPf = countDiff(s.playfieldRam, mPf);
  const dAl = countDiff(s.alphaRam, mAl);
  const dCol = countDiff(s.colorRam, mCol);
  const tot = dSp + dPf + dAl + dCol;

  const fStr = `f+${f}`.padStart(5);
  console.log(`${fStr} | ${dSp.toString().padStart(4)}/${(0x1000).toString(16)}  | ${dPf.toString().padStart(4)}/${(0x2000).toString(16)}   | ${dAl.toString().padStart(4)}/${(0x1000).toString(16)}  | ${dCol.toString().padStart(4)}/${(0x800).toString(16)}   | ${tot}`);
}

console.log("\nNote: diff < 50/buffer = visivamente impercettibile. diff == 0 = bit-perfect.");
