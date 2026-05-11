// Probe: identify byte clusters where TS differs from MAME at f+99.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { state as stateNs, bus as busNs, bootInit, tick } from "@marble-love/engine";

const rom = busNs.emptyRomImage();
rom.program.set(readFileSync(resolve("ghidra_project/marble_program.bin")).subarray(0, rom.program.length));

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
};

const s = stateNs.emptyGameState();
bootInit(s, rom, { warmState: warm });

for (let i = 1; i < groundTruth.snapshots.length; i++) {
  tick(s, { rom, runMainLoopBody: true, p1X: 0xff, p1Y: 0xff, p2X: 0xff, p2Y: 0xff });
}

const f99 = groundTruth.snapshots[99]!;
const mameW = hex2bytes(f99.workRam, 0x2000);
const mameS = hex2bytes(f99.spriteRam, 0x1000);

// Find all diff byte offsets, cluster them by proximity (gap ≤ 16).
function clusters(a: Uint8Array, b: Uint8Array, gap = 16): { start: number; end: number; count: number }[] {
  const diffs: number[] = [];
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diffs.push(i);
  const out: { start: number; end: number; count: number }[] = [];
  let cur: { start: number; end: number; count: number } | null = null;
  for (const d of diffs) {
    if (cur && d - cur.end <= gap) {
      cur.end = d;
      cur.count++;
    } else {
      if (cur) out.push(cur);
      cur = { start: d, end: d, count: 1 };
    }
  }
  if (cur) out.push(cur);
  return out;
}

const wClusters = clusters(s.workRam, mameW);
const sClusters = clusters(s.spriteRam, mameS);

console.log("=== workRam diff clusters @ f+99 ===");
let wTot = 0;
for (const c of wClusters) {
  wTot += c.count;
  console.log(`  0x${c.start.toString(16).padStart(4, "0")}..0x${c.end.toString(16).padStart(4, "0")}  bytes=${c.count.toString().padStart(3)}  width=${(c.end - c.start + 1).toString().padStart(4)}`);
}
console.log(`total workRam diff bytes: ${wTot}`);

console.log("\n=== spriteRam diff clusters @ f+99 ===");
let sTot = 0;
for (const c of sClusters) {
  sTot += c.count;
  console.log(`  0x${c.start.toString(16).padStart(4, "0")}..0x${c.end.toString(16).padStart(4, "0")}  bytes=${c.count.toString().padStart(3)}  width=${(c.end - c.start + 1).toString().padStart(4)}`);
}
console.log(`total spriteRam diff bytes: ${sTot}`);

// STRUCT 0x1c28..0x1c47 specifically
function hexBytes(buf: Uint8Array, off: number, len: number): string {
  const parts: string[] = [];
  for (let i = 0; i < len; i++) parts.push(buf[off + i]!.toString(16).padStart(2, "0"));
  return parts.join("");
}
console.log(`\nSTRUCT @ 0x1c28 TS: ${hexBytes(s.workRam, 0x1c28, 32)}`);
console.log(`STRUCT @ 0x1c28 MAME: ${hexBytes(mameW, 0x1c28, 32)}`);

// obj0 (0x000..0x100)
console.log(`\nobj0 z @0x14 (4 bytes) TS:  ${hexBytes(s.workRam, 0x14, 4)}`);
console.log(`obj0 z @0x14 (4 bytes) MAME: ${hexBytes(mameW, 0x14, 4)}`);
