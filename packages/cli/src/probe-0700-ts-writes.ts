// probe-0700-ts-writes.ts — Proxy-wrap of workRam per loggare each write
// in the cluster 0x400700..0x40077F during the first 5 tick post-warm.
//
// Output: /tmp/ts_0700_writes.json simmetrico al MAME tap
// (oracle/mame_0700_first_body_tap.lua / mame_cluster_0706.json).
//
// Warm state da /tmp/mame_100f.json (snapshot[0] = f12000).
// Window logging: tick 1..5 (= absolute f12001..f12005).
import { readFileSync, writeFileSync } from "node:fs";
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

// Region 0x700..0x77F (relative to workRam base 0x400000).
const REGION_LO = 0x700;
const REGION_HI = 0x77F;

interface Sample {
  frame: number;        // 1..5
  abs_frame: number;    // 12001..12005
  off: number;          // offset in workRam
  abs_addr: string;     // 0x400xxx
  value: number;        // byte
  stack: string[];      // top-N TS frames
}

const samples: Sample[] = [];
let currentFrame = 0;
let logging = false;

function captureStack(): string[] {
  const err = new Error();
  const stk = (err.stack ?? "").split("\n");
  const out: string[] = [];
  for (const line of stk.slice(3)) {
    const t = line.trim();
    if (t.includes("packages/engine/src/") || t.includes("packages/cli/src/")) {
      out.push(t.replace(/file:\/\/[^\s]*marble-love\//, ""));
      if (out.length >= 6) break;
    }
  }
  return out;
}

const origWorkRam = s.workRam;
const proxy = new Proxy(origWorkRam, {
  get(target, prop) {
    const v = Reflect.get(target, prop, target);
    if (typeof v === "function") return v.bind(target);
    return v;
  },
  set(target, prop, value) {
    const idx = typeof prop === "string" ? Number(prop) : NaN;
    if (Number.isInteger(idx) && idx >= 0 && idx < target.length) {
      if (logging && idx >= REGION_LO && idx <= REGION_HI) {
        samples.push({
          frame: currentFrame,
          abs_frame: 12000 + currentFrame,
          off: idx,
          abs_addr: "0x" + (0x400000 + idx).toString(16),
          value: value as number,
          stack: captureStack(),
        });
      }
    }
    return Reflect.set(target, prop, value, target);
  },
});
(s as { workRam: Uint8Array }).workRam = proxy as unknown as Uint8Array;

// Drive 5 ticks. Logging from tick 1 (= TS body for absolute frame 12001).
const TOTAL = 5;
for (let i = 1; i <= TOTAL; i++) {
  currentFrame = i;
  logging = true;
  tick(s, { rom, runMainLoopBody: true, p1X: 0xff, p1Y: 0xff, p2X: 0xff, p2Y: 0xff });
}

// Snapshot final state per frame.
function snapshotCluster(workRam: Uint8Array): string {
  let h = "";
  for (let off = REGION_LO; off <= REGION_HI; off++) h += workRam[off]!.toString(16).padStart(2, "0");
  return h;
}

const finalCluster = snapshotCluster(origWorkRam);

// ─── Build per-frame TS final byte map ──────────────────────────────────────
// Last write per (off, frame).
function tsFinalMap(absFrame: number): Map<number, { value: number; stack: string }> {
  const m = new Map<number, { value: number; stack: string }>();
  for (const sm of samples) {
    if (sm.abs_frame !== absFrame) continue;
    m.set(sm.off, { value: sm.value, stack: sm.stack[0] ?? "" });
  }
  return m;
}

// ─── MAME tap parsing (re-use /tmp/mame_cluster_0706.json which covers 0x706..0x751) ─
const mameTap = JSON.parse(readFileSync("/tmp/mame_cluster_0706.json", "utf-8")) as {
  samples: { f: number; pc: string; addr: string; data: string; mask: string }[];
};

// Convention: MAME tap labels writes via frame_count incremented at frame_done START.
// So real frame N writes appear with f=N-1. We compensate.
function mameFinalMap(absFrame: number): Map<number, { value: number; pc: string; size: number }> {
  const m = new Map<number, { value: number; pc: string; size: number }>();
  const tapFrame = absFrame - 1;
  for (const sm of mameTap.samples) {
    if (sm.f !== tapFrame) continue;
    const addr = parseInt(sm.addr, 16);
    const data = parseInt(sm.data, 16);
    const mask = parseInt(sm.mask, 16);
    const off = addr - 0x400000;
    // Determine size from mask.
    let size = 0;
    if (mask === 0xff || mask === 0xff00 || mask === 0xff0000 || mask === 0xff000000) size = 1;
    else if (mask === 0xffff || mask === 0xffff0000) size = 2;
    else if (mask === 0xffffffff) size = 4;
    else size = 0;
    if (size === 1) {
      let v: number;
      let baseOff: number;
      if (mask === 0xff) { v = data & 0xff; baseOff = off + 1; }
      else if (mask === 0xff00) { v = (data >>> 8) & 0xff; baseOff = off; }
      else if (mask === 0xff0000) { v = (data >>> 16) & 0xff; baseOff = off; }
      else { v = (data >>> 24) & 0xff; baseOff = off; }
      m.set(baseOff, { value: v, pc: sm.pc, size });
    } else if (size === 2) {
      const v = data & 0xffff;
      const o = mask === 0xffff0000 ? off : off;
      m.set(o,     { value: (v >>> 8) & 0xff, pc: sm.pc, size });
      m.set(o + 1, { value: v & 0xff,         pc: sm.pc, size });
    } else if (size === 4) {
      const v = data >>> 0;
      m.set(off,     { value: (v >>> 24) & 0xff, pc: sm.pc, size });
      m.set(off + 1, { value: (v >>> 16) & 0xff, pc: sm.pc, size });
      m.set(off + 2, { value: (v >>>  8) & 0xff, pc: sm.pc, size });
      m.set(off + 3, { value: v & 0xff,          pc: sm.pc, size });
    }
  }
  return m;
}

// ─── Compare per-frame (cluster 0x706..0x751 only, where MAME tap covers) ────
console.log("--- Per-frame cluster 0x706..0x751 diff (TS vs MAME final byte map) ---");
const COMPARE_LO = 0x706;
const COMPARE_HI = 0x751;

const perFrame: unknown[] = [];
for (let abs = 12001; abs <= 12005; abs++) {
  const mame = mameFinalMap(abs);
  const tsm = tsFinalMap(abs);
  let mameWrites = 0;
  let tsWrites = 0;
  for (const k of mame.keys()) if (k >= COMPARE_LO && k <= COMPARE_HI) mameWrites++;
  for (const k of tsm.keys()) if (k >= COMPARE_LO && k <= COMPARE_HI) tsWrites++;
  const diffs: { off: number; ts: number | null; mame: number | null; tsStack: string; mamePc: string }[] = [];
  for (let off = COMPARE_LO; off <= COMPARE_HI; off++) {
    const m = mame.get(off);
    const t = tsm.get(off);
    if (m === undefined && t === undefined) continue;
    const mv = m?.value ?? null;
    const tv = t?.value ?? null;
    if (mv !== tv) {
      diffs.push({ off, ts: tv, mame: mv, tsStack: t?.stack ?? "(no TS write)", mamePc: m?.pc ?? "(no MAME write)" });
    }
  }
  console.log(`f${abs}: MAME_writes=${mameWrites} TS_writes=${tsWrites} diffs=${diffs.length}`);
  if (diffs.length > 0) {
    console.log("  first 8 diffs:");
    for (const d of diffs.slice(0, 8)) {
      const tsVal = d.ts === null ? "—" : "0x" + d.ts.toString(16).padStart(2, "0");
      const mameVal = d.mame === null ? "—" : "0x" + d.mame.toString(16).padStart(2, "0");
      console.log(`    +0x${(d.off - 0x700).toString(16).padStart(2, "0")} (0x${(0x400000 + d.off).toString(16)})  TS=${tsVal}  MAME=${mameVal}  ts:${d.tsStack.slice(0, 80)}  mamePC:${d.mamePc}`);
    }
  }
  perFrame.push({ frame: abs, mameWrites, tsWrites, diffs });
}

// Aggregate writers stats.
const writersByStack = new Map<string, number>();
const writersByOffset = new Map<number, string>();
for (const sm of samples) {
  if (sm.off < COMPARE_LO || sm.off > COMPARE_HI) continue;
  const key = sm.stack[0] ?? "(empty)";
  writersByStack.set(key, (writersByStack.get(key) ?? 0) + 1);
  if (!writersByOffset.has(sm.off)) writersByOffset.set(sm.off, key);
}

console.log("\n--- Top TS writer stack frames (in cluster 0x706..0x751) ---");
const sorted = [...writersByStack.entries()].sort((a, b) => b[1] - a[1]);
for (const [k, c] of sorted.slice(0, 10)) {
  console.log(`  ${c.toString().padStart(4)}  ${k.slice(0, 110)}`);
}

console.log("\n--- Final cluster snapshot at end of tick 5 ---");
console.log(`TS 0x700..0x77F: ${finalCluster}`);
const mameFinalSnap = groundTruth.snapshots[5]!.workRam.substr(REGION_LO * 2, (REGION_HI - REGION_LO + 1) * 2);
console.log(`MAME f12005   : ${mameFinalSnap}`);

writeFileSync(
  "/tmp/ts_0700_writes.json",
  JSON.stringify(
    {
      region_lo: "0x" + (0x400000 + REGION_LO).toString(16),
      region_hi: "0x" + (0x400000 + REGION_HI).toString(16),
      from_frame: 12001,
      to_frame: 12005,
      total_samples: samples.length,
      samples,
      per_frame: perFrame,
      final_cluster_ts: finalCluster,
      final_cluster_mame_f12005: mameFinalSnap,
    },
    null,
    2,
  ),
);
console.log(`\nOutput: /tmp/ts_0700_writes.json (samples=${samples.length})`);
