// Cluster diff probe for spriteRam @ f+99 — bucketize the 248-byte drift
// per MO RAM layout: 8 banks × (Y@0x000 / code@0x080 / X@0x100 / Z@0x180),
// 64 entries × 4 fields × 2 byte stride.
//
// Layout: spriteRam[0xA02000..0xA02FFF] = 0x1000 bytes total = 8 banks × 0x200.
// Within each bank (0x200 = 512 byte): Y region @ +0x000..0x07F (64 entries × 2 = 128 byte),
// code @ +0x080..0x0FF, X @ +0x100..0x17F, Z @ +0x180..0x1FF.
// Each field uses 64 word entries (= 128 byte). Entry stride = 2 byte.
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

const mameS = hex2bytes(lastFrame.spriteRam, 0x1000);

// Bank breakdown (8 banks × 0x200)
const bankCount = new Array<number>(8).fill(0);
// Field breakdown per bank (Y/code/X/Z)
const fieldNames = ["Y", "code", "X", "Z"] as const;
const fieldOffs = [0x000, 0x080, 0x100, 0x180];
const bankFieldCount: number[][] = Array.from({ length: 8 }, () => [0, 0, 0, 0]);
// Entry distribution per bank-field
const entryByBankField: number[][][] = Array.from({ length: 8 }, () =>
  Array.from({ length: 4 }, () => new Array<number>(64).fill(0)),
);

interface Diff {
  off: number;
  ts: number;
  mame: number;
}
const allDiffs: Diff[] = [];

let total = 0;
for (let off = 0; off < 0x1000; off++) {
  const ts = s.spriteRam[off]!;
  const m = mameS[off]!;
  if (ts !== m) {
    total++;
    allDiffs.push({ off, ts, mame: m });
    const bank = (off >>> 9) & 7;
    bankCount[bank]!++;
    const inBank = off & 0x1ff;
    const fieldIdx =
      inBank < 0x080 ? 0 : inBank < 0x100 ? 1 : inBank < 0x180 ? 2 : 3;
    bankFieldCount[bank]![fieldIdx]!++;
    const fieldBase = fieldOffs[fieldIdx]!;
    const entry = ((inBank - fieldBase) >>> 1) & 63;
    entryByBankField[bank]![fieldIdx]![entry]!++;
  }
}

console.log(`Total spriteRam diff @ f+${lastIdx} = ${total} bytes\n`);

console.log("=== BANK SUMMARY (8 banks × 0x200) ===");
for (let b = 0; b < 8; b++) {
  const base = b * 0x200;
  console.log(`  bank ${b} (0x${base.toString(16).padStart(3, "0")}-0x${(base + 0x1ff).toString(16).padStart(3, "0")}): ${bankCount[b]!.toString().padStart(4)} byte`);
}

console.log("\n=== BANK × FIELD ===");
console.log("  bank | Y    | code | X    | Z   ");
for (let b = 0; b < 8; b++) {
  const row = bankFieldCount[b]!;
  console.log(`  ${b}    | ${row[0]!.toString().padStart(3)}  | ${row[1]!.toString().padStart(3)}  | ${row[2]!.toString().padStart(3)}  | ${row[3]!.toString().padStart(3)} `);
}

console.log("\n=== TOP BANK-FIELD CELLS (sorted) ===");
interface Cell {
  bank: number;
  field: number;
  count: number;
}
const cells: Cell[] = [];
for (let b = 0; b < 8; b++) {
  for (let f = 0; f < 4; f++) {
    const c = bankFieldCount[b]![f]!;
    if (c > 0) cells.push({ bank: b, field: f, count: c });
  }
}
cells.sort((a, b) => b.count - a.count);
for (const c of cells.slice(0, 12)) {
  console.log(`  bank ${c.bank} ${fieldNames[c.field]!.padStart(4)} : ${c.count.toString().padStart(3)} byte`);
}

console.log("\n=== TOP 3 BANK-FIELD: ENTRY DETAIL ===");
for (const c of cells.slice(0, 3)) {
  const fieldBase = fieldOffs[c.field]!;
  console.log(`\n--- bank ${c.bank} ${fieldNames[c.field]} (${c.count} byte) ---`);
  const entries = entryByBankField[c.bank]![c.field]!;
  // Find consecutive entry runs
  let runStart = -1;
  let runEnd = -1;
  const runs: { lo: number; hi: number }[] = [];
  for (let e = 0; e < 64; e++) {
    if (entries[e]! > 0) {
      if (runStart < 0) {
        runStart = e;
        runEnd = e;
      } else if (e === runEnd + 1) {
        runEnd = e;
      } else {
        runs.push({ lo: runStart, hi: runEnd });
        runStart = e;
        runEnd = e;
      }
    }
  }
  if (runStart >= 0) runs.push({ lo: runStart, hi: runEnd });
  console.log(`  entries diff: ${runs.map((r) => (r.lo === r.hi ? r.lo : `${r.lo}-${r.hi}`)).join(", ")}`);
  // First 16 byte diff
  const bankBase = c.bank * 0x200;
  const fieldAbs = bankBase + fieldBase;
  const detail: string[] = [];
  for (let e = 0; e < 64 && detail.length < 16; e++) {
    if (entries[e]! > 0) {
      const aOff = fieldAbs + e * 2;
      const tsW = (s.spriteRam[aOff]! << 8) | s.spriteRam[aOff + 1]!;
      const mW = (mameS[aOff]! << 8) | mameS[aOff + 1]!;
      detail.push(`e${e}@0x${aOff.toString(16).padStart(3, "0")} T=${tsW.toString(16).padStart(4, "0")} M=${mW.toString(16).padStart(4, "0")}`);
    }
  }
  console.log(`  detail: ${detail.join(" | ")}`);
}

// Consecutive byte-runs ACROSS all spriteRam (largest clusters)
console.log("\n=== LARGEST CONSECUTIVE BYTE RUNS (any-region) ===");
let rs = -1;
let re = -1;
const runs: { lo: number; hi: number; len: number }[] = [];
for (const d of allDiffs) {
  if (rs < 0) {
    rs = d.off;
    re = d.off;
  } else if (d.off === re + 1) {
    re = d.off;
  } else {
    runs.push({ lo: rs, hi: re, len: re - rs + 1 });
    rs = d.off;
    re = d.off;
  }
}
if (rs >= 0) runs.push({ lo: rs, hi: re, len: re - rs + 1 });
runs.sort((a, b) => b.len - a.len);
for (const r of runs.slice(0, 12)) {
  const bank = (r.lo >>> 9) & 7;
  const inBank = r.lo & 0x1ff;
  const fieldIdx = inBank < 0x080 ? 0 : inBank < 0x100 ? 1 : inBank < 0x180 ? 2 : 3;
  console.log(`  0x${r.lo.toString(16).padStart(3, "0")}..0x${r.hi.toString(16).padStart(3, "0")} (${r.len.toString().padStart(3)} byte) — bank ${bank} ${fieldNames[fieldIdx]}`);
}

// X-bank histogram (entries diff per bank, X field only — to spot MO_BUFFER region)
console.log("\n=== X-field diff bytes per bank ===");
for (let b = 0; b < 8; b++) {
  console.log(`  bank ${b}: ${bankFieldCount[b]![2]!} byte`);
}

// Check workRam cursor pointers @ 0x3F6/3FA/3FE/402 to ID active bank/regions
const cursorA1 = ((s.workRam[0x3fa]! << 24) | (s.workRam[0x3fb]! << 16) | (s.workRam[0x3fc]! << 8) | s.workRam[0x3fd]!) >>> 0;
const cursorA2 = ((s.workRam[0x3fe]! << 24) | (s.workRam[0x3ff]! << 16) | (s.workRam[0x400]! << 8) | s.workRam[0x401]!) >>> 0;
const cursorA3 = ((s.workRam[0x3f6]! << 24) | (s.workRam[0x3f7]! << 16) | (s.workRam[0x3f8]! << 8) | s.workRam[0x3f9]!) >>> 0;
const cursorA4 = ((s.workRam[0x402]! << 24) | (s.workRam[0x403]! << 16) | (s.workRam[0x404]! << 8) | s.workRam[0x405]!) >>> 0;
const counterD7 = ((s.workRam[0x406]! << 8) | s.workRam[0x407]!) & 0xffff;

const mameA1 = ((warm.workRam[0x3fa]! << 24) | (warm.workRam[0x3fb]! << 16) | (warm.workRam[0x3fc]! << 8) | warm.workRam[0x3fd]!) >>> 0;
const mameW99 = hex2bytes(lastFrame.workRam, 0x2000);
const mameA1Last = ((mameW99[0x3fa]! << 24) | (mameW99[0x3fb]! << 16) | (mameW99[0x3fc]! << 8) | mameW99[0x3fd]!) >>> 0;
const mameA2Last = ((mameW99[0x3fe]! << 24) | (mameW99[0x3ff]! << 16) | (mameW99[0x400]! << 8) | mameW99[0x401]!) >>> 0;
const mameA3Last = ((mameW99[0x3f6]! << 24) | (mameW99[0x3f7]! << 16) | (mameW99[0x3f8]! << 8) | mameW99[0x3f9]!) >>> 0;
const mameA4Last = ((mameW99[0x402]! << 24) | (mameW99[0x403]! << 16) | (mameW99[0x404]! << 8) | mameW99[0x405]!) >>> 0;
const mameD7Last = ((mameW99[0x406]! << 8) | mameW99[0x407]!) & 0xffff;

console.log("\n=== MO cursor state @ f+99 ===");
console.log(`  A1 (code dest) TS=0x${cursorA1.toString(16).padStart(8, "0")} MAME=0x${mameA1Last.toString(16).padStart(8, "0")} ${cursorA1 === mameA1Last ? "OK" : "DRIFT"}  warm=0x${mameA1.toString(16)}`);
console.log(`  A2 (X dest)    TS=0x${cursorA2.toString(16).padStart(8, "0")} MAME=0x${mameA2Last.toString(16).padStart(8, "0")} ${cursorA2 === mameA2Last ? "OK" : "DRIFT"}`);
console.log(`  A3 (Y dest)    TS=0x${cursorA3.toString(16).padStart(8, "0")} MAME=0x${mameA3Last.toString(16).padStart(8, "0")} ${cursorA3 === mameA3Last ? "OK" : "DRIFT"}`);
console.log(`  A4 (Z dest)    TS=0x${cursorA4.toString(16).padStart(8, "0")} MAME=0x${mameA4Last.toString(16).padStart(8, "0")} ${cursorA4 === mameA4Last ? "OK" : "DRIFT"}`);
console.log(`  D7 (counter)   TS=0x${counterD7.toString(16).padStart(4, "0")}     MAME=0x${mameD7Last.toString(16).padStart(4, "0")}     ${counterD7 === mameD7Last ? "OK" : "DRIFT"}`);
