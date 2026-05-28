// probe-srtgt-f56.ts - compares workRam regions @ f+55 and f+56 to explain srtgt drift.
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

// Run ticks
for (let i = 1; i <= 56; i++) {
  tick(s, { rom, runMainLoopBody: true, p1X: 0xff, p1Y: 0xff, p2X: 0xff, p2Y: 0xff });
}

// Compare TS @ f+56 vs MAME @ f+56
const mame = hex2bytes(gt.snapshots[56].workRam, 0x2000);
console.log(`Cluster-by-cluster diff @ f+56 (TS post tick 56 vs MAME f+56):`);

const BUCKET = 0x40;
for (let cs = 0; cs < 0x2000; cs += BUCKET) {
  // Exclude stack scratch regions
  if (cs >= 0x1d40 && cs < 0x1e80) continue;
  if (cs >= 0x440 && cs < 0x448) continue;
  if (cs >= 0x1ee0 && cs < 0x1f00) continue;
  let d = 0;
  for (let o = cs; o < cs + BUCKET; o++) if (s.workRam[o] !== mame[o]) d++;
  if (d > 0) console.log(`  0x${cs.toString(16).padStart(4, "0")}..0x${(cs + BUCKET - 1).toString(16).padStart(4, "0")}: ${d} byte`);
}

console.log(`\nKey state @ f+56:`);
function dumpRange(label: string, off: number, len: number) {
  const ts = Array.from(s.workRam.subarray(off, off + len)).map(b => b.toString(16).padStart(2, "0")).join(" ");
  const ma = Array.from(mame.subarray(off, off + len)).map(b => b.toString(16).padStart(2, "0")).join(" ");
  console.log(`  ${label} @ 0x${off.toString(16)}: TS=${ts}\n    MA=${ma}`);
}
// Object 0 marble (P1)
dumpRange("obj0 x_long", 0x18, 4);
dumpRange("obj0 y_long", 0x1c, 4);
dumpRange("obj0 vx", 0x24, 4);
dumpRange("obj0 vy", 0x28, 4);
// Scroll target + speed accum
dumpRange("scroll srtgt", 0x97c, 4);
dumpRange("scroll xscroll", 0x394, 4);
dumpRange("scroll yscroll", 0x398, 4);
// Velocity globals area 0x0640..0x067F
dumpRange("0x0640", 0x640, 32);
dumpRange("0x0660", 0x660, 32);
