// Probe: workRam drift histogram at f+99 in 64-byte clusters.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { state as stateNs, bus as busNs, bootInit, tick, applySlapsticBank } from "@marble-love/engine";

const rom = busNs.emptyRomImage();
applySlapsticBank.loadRomBlob(rom, readFileSync(resolve("ghidra_project/marble_program.bin")));

const groundTruth = JSON.parse(readFileSync("/tmp/mame_100f.json", "utf-8")) as {
  frames: number[];
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

const lastIdx = groundTruth.snapshots.length - 1;
const lastFrame = groundTruth.snapshots[lastIdx]!;

for (let i = 1; i <= lastIdx; i++) {
  tick(s, { rom, runMainLoopBody: true, p1X: 0xff, p1Y: 0xff, p2X: 0xff, p2Y: 0xff });
}

const mameW = hex2bytes(lastFrame.workRam, 0x2000);

const BUCKET = 0x40;
const N = 0x2000 / BUCKET;
const counts: number[] = Array(N).fill(0);
// TS does not emulate the M68K register file, so this is non-gameplay residue.
const isStackResidue = (off: number) =>
  (off >= 0x440 && off < 0x448) ||
  (off >= 0x1D40 && off < 0x1E80) ||
  (off >= 0x1EE0 && off < 0x1F00);
let totW = 0;
let totGameplay = 0;
let stackResidue = 0;
for (let i = 0; i < 0x2000; i++) {
  if (s.workRam[i] !== mameW[i]) {
    totW++;
    counts[Math.floor(i / BUCKET)]!++;
    if (isStackResidue(i)) stackResidue++;
    else totGameplay++;
  }
}
console.log(`f+${lastIdx} workRam diff: total=${totW} | gameplay=${totGameplay} | stack-residue=${stackResidue} (excluded)\n`);

const ranked = counts
  .map((c, idx) => ({ start: idx * BUCKET, end: idx * BUCKET + BUCKET - 1, c }))
  .filter((x) => x.c > 0)
  .sort((a, b) => b.c - a.c);

console.log(`Top-30 cluster (BUCKET=0x${BUCKET.toString(16)}):`);
console.log(`  rank  start..end             count`);
let cum = 0;
ranked.slice(0, 30).forEach((r, i) => {
  cum += r.c;
  console.log(
    `  #${(i + 1).toString().padStart(2)}   0x${r.start.toString(16).padStart(4, "0")}..0x${r.end
      .toString(16)
      .padStart(4, "0")}   ${r.c.toString().padStart(3)}   (cum ${cum}, ${((cum / totW) * 100).toFixed(1)}%)`,
  );
});
console.log(`\nTotal clusters with diff>0: ${ranked.length}`);
