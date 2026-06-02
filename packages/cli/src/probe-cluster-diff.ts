// Cluster diff probe @ f+99: dumps ALL workRam diff offsets grouped by buckets
// for drift cluster localization analysis.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { state as stateNs, bus as busNs, bootInit, tick } from "@marble-love/engine";

const rom = busNs.emptyRomImage();
rom.program.set(readFileSync(resolve("ghidra_project/marble_program.bin")).subarray(0, rom.program.length));

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
};

const s = stateNs.emptyGameState();
bootInit(s, rom, { warmState: warm });

const lastIdx = groundTruth.snapshots.length - 1;
const lastFrame = groundTruth.snapshots[lastIdx]!;

for (let i = 1; i <= lastIdx; i++) {
  tick(s, { rom, runMainLoopBody: true, p1X: 0xff, p1Y: 0xff, p2X: 0xff, p2Y: 0xff });
}

const mameW = hex2bytes(lastFrame.workRam, 0x2000);

interface Bucket {
  name: string;
  lo: number;
  hi: number; // inclusive
  count: number;
  diffs: { off: number; ts: number; mame: number }[];
}

const buckets: Bucket[] = [
  { name: "0x000-0x017 header globals", lo: 0x000, hi: 0x017, count: 0, diffs: [] },
  { name: "0x018-0x0F9 obj0 struct", lo: 0x018, hi: 0x0f9, count: 0, diffs: [] },
  { name: "0x0FA-0x1DB obj1 struct", lo: 0x0fa, hi: 0x1db, count: 0, diffs: [] },
  { name: "0x1DC-0x6FF other objs + globals", lo: 0x1dc, hi: 0x6ff, count: 0, diffs: [] },
  { name: "0x700-0xA9B pre-slot region", lo: 0x700, hi: 0xa9b, count: 0, diffs: [] },
  { name: "0xA9C-0x12FF slot table", lo: 0xa9c, hi: 0x12ff, count: 0, diffs: [] },
  { name: "0x1300-0x1421 4-slot script array", lo: 0x1300, hi: 0x1421, count: 0, diffs: [] },
  { name: "0x1422-0x14FF slot3-4 + tail", lo: 0x1422, hi: 0x14ff, count: 0, diffs: [] },
  { name: "0x1500-0x1FFF scratch + STRUCT @ 0x1C28", lo: 0x1500, hi: 0x1fff, count: 0, diffs: [] },
];

let total = 0;
for (let off = 0; off < 0x2000; off++) {
  const ts = s.workRam[off]!;
  const m = mameW[off]!;
  if (ts !== m) {
    total++;
    for (const b of buckets) {
      if (off >= b.lo && off <= b.hi) {
        b.count++;
        b.diffs.push({ off, ts, mame: m });
        break;
      }
    }
  }
}

console.log(`Total workRam diff @ f+${lastIdx} = ${total} bytes\n`);
console.log("=== BUCKET SUMMARY ===");
for (const b of buckets) {
  console.log(`  ${b.name.padEnd(48)} : ${b.count.toString().padStart(4)} byte`);
}
console.log();

console.log("=== TOP 3 BUCKETS — DETAIL DUMP ===");
const sorted = [...buckets].sort((a, b) => b.count - a.count);
for (const b of sorted.slice(0, 3)) {
  console.log(`\n--- ${b.name} (${b.count} bytes) ---`);
  // mini-cluster: group consecutive offsets
  let runStart = -1;
  let runEnd = -1;
  const runs: { lo: number; hi: number; len: number }[] = [];
  for (const d of b.diffs) {
    if (runStart < 0) {
      runStart = d.off;
      runEnd = d.off;
    } else if (d.off === runEnd + 1) {
      runEnd = d.off;
    } else {
      runs.push({ lo: runStart, hi: runEnd, len: runEnd - runStart + 1 });
      runStart = d.off;
      runEnd = d.off;
    }
  }
  if (runStart >= 0) runs.push({ lo: runStart, hi: runEnd, len: runEnd - runStart + 1 });
  runs.sort((a, b) => b.len - a.len);
  console.log(`  consecutive runs (top 12):`);
  for (const r of runs.slice(0, 12)) {
    console.log(`    0x${r.lo.toString(16).padStart(4, "0")}..0x${r.hi.toString(16).padStart(4, "0")} (${r.len} byte)`);
  }
  console.log(`  first 32 diff bytes (off T=ts M=mame):`);
  for (const d of b.diffs.slice(0, 32)) {
    console.log(`    0x${d.off.toString(16).padStart(4, "0")}: T=${d.ts.toString(16).padStart(2, "0")} M=${d.mame.toString(16).padStart(2, "0")}`);
  }
}

// Per-struct sub-buckets for obj0/obj1 (stride 0x42 per slot like workRam 0x18 + objStride)
console.log("\n=== OBJ0 (0x18-0xF9, stride 0xE2) FIELD-LEVEL ===");
for (const d of buckets[1]!.diffs) {
  const fieldOff = d.off - 0x18;
  console.log(`  obj0+0x${fieldOff.toString(16).padStart(2, "0")} (abs 0x${d.off.toString(16)}): T=${d.ts.toString(16).padStart(2, "0")} M=${d.mame.toString(16).padStart(2, "0")}`);
}

console.log("\n=== OBJ1 (0xFA-0x1DB, stride 0xE2) FIELD-LEVEL ===");
for (const d of buckets[2]!.diffs) {
  const fieldOff = d.off - 0xfa;
  console.log(`  obj1+0x${fieldOff.toString(16).padStart(2, "0")} (abs 0x${d.off.toString(16)}): T=${d.ts.toString(16).padStart(2, "0")} M=${d.mame.toString(16).padStart(2, "0")}`);
}

// 4-slot script array breakdown
console.log("\n=== 4-SLOT SCRIPT ARRAY (0x1300-0x1421, stride 0x48) ===");
const SCRIPT_BASE = 0x1300;
const SCRIPT_STRIDE = 0x48;
const SCRIPT_N = 4;
for (let i = 0; i < SCRIPT_N; i++) {
  const base = SCRIPT_BASE + i * SCRIPT_STRIDE;
  let cnt = 0;
  const detail: string[] = [];
  for (let f = 0; f < SCRIPT_STRIDE; f++) {
    const off = base + f;
    if (off > 0x1421) break;
    if (s.workRam[off] !== mameW[off]) {
      cnt++;
      if (detail.length < 10) detail.push(`+${f.toString(16).padStart(2, "0")}:T=${s.workRam[off]!.toString(16).padStart(2, "0")},M=${mameW[off]!.toString(16).padStart(2, "0")}`);
    }
  }
  console.log(`  script[${i}] @ 0x${base.toString(16)}: ${cnt} diff bytes  ${detail.join(" ")}`);
}

// Globals 0x1500-0x1FFF — below-bucket per 256 byte
console.log("\n=== SUB-BUCKETS 0x1500-0x1FFF (per 256 byte) ===");
const last = buckets[8]!;
const subBuckets = new Map<number, number>();
for (const d of last.diffs) {
  const sb = (d.off >> 8) << 8;
  subBuckets.set(sb, (subBuckets.get(sb) ?? 0) + 1);
}
const sortedSub = Array.from(subBuckets.entries()).sort((a, b) => b[1] - a[1]);
for (const [k, c] of sortedSub) {
  console.log(`  0x${k.toString(16).padStart(4, "0")}-0x${(k + 0xff).toString(16)}: ${c} byte`);
}

// STRUCT @ 0x1C28 specific check
console.log("\n=== STRUCT @ 0x1C28 (0x1C28..0x1FFF) ===");
let s1c28 = 0;
for (let off = 0x1c28; off <= 0x1fff; off++) {
  if (s.workRam[off] !== mameW[off]) s1c28++;
}
console.log(`  diff bytes in 0x1C28..0x1FFF = ${s1c28}`);

// Pre-slot region 0x700-0xA9B sub-buckets (256-byte)
console.log("\n=== SUB-BUCKETS 0x700-0xA9B (per 256 byte) ===");
const pre = buckets[4]!;
const preSub = new Map<number, number>();
for (const d of pre.diffs) {
  const sb = (d.off >> 8) << 8;
  preSub.set(sb, (preSub.get(sb) ?? 0) + 1);
}
for (const [k, c] of Array.from(preSub.entries()).sort((a, b) => b[1] - a[1])) {
  console.log(`  0x${k.toString(16).padStart(4, "0")}-0x${(k + 0xff).toString(16)}: ${c} byte`);
}

// Slot table breakdown
console.log("\n=== SLOT TABLE 0xA9C-0x12FF (stride 0x56, 25 slot) ===");
const SLOT_BASE = 0xa9c;
const STRIDE = 0x56;
const N_SLOTS = 25;
for (let slot = 0; slot < N_SLOTS; slot++) {
  let cnt = 0;
  for (let f = 0; f < STRIDE; f++) {
    const off = SLOT_BASE + slot * STRIDE + f;
    if (s.workRam[off] !== mameW[off]) cnt++;
  }
  if (cnt > 0) {
    const base = SLOT_BASE + slot * STRIDE;
    console.log(`  slot ${slot.toString().padStart(2)} @ 0x${base.toString(16)}: ${cnt} byte`);
  }
}
