// probe-p2-slot0-writers.ts - proxy-wraps workRam and logs each write in:
//   1) 0x97c..0x97f   (= 0x40097c..0x40097f, srtgt)
//   2) 0xa00..0xa1f   (= 0x400a00..0x400a1f, P2 slot pair header)
//   3) 0xa20..0xa3f   (= 0x400a20..0x400a3f, P2.slot0 struct)
// Logs frame, offset, value, and stack trace to identify the calling TS sub.
// Output: /tmp/ts_p2_slot0_writers.json (structure compatible with the MAME tap).
//
// Window: tick by tick from f12000 through f+80 (= absolute f12080), warm-started
// from the MAME ground truth.
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

// ─── workRam proxy setup ────────────────────────────────────────────────────
// Regions of interest relative to workRam base 0x400000:
function inRegion(offset: number): string | null {
  if (offset >= 0x97c && offset <= 0x97f) return "srtgt";
  if (offset >= 0xa00 && offset <= 0xa1f) return "p2hdr";
  if (offset >= 0xa20 && offset <= 0xa3f) return "p2slot0";
  return null;
}

interface Sample {
  frame: number;
  abs_frame: number;
  abs_addr: string;
  off: number;
  value: number;
  label: string;
  stack: string[];
}

const samples: Sample[] = [];
let currentFrame = 0;
let logging = false;

// Filter stack frames to relevant TS source files (avoid noise from runtime).
// Keep up to 8 frames going from the writer leaf upward.
function captureStack(): string[] {
  const err = new Error();
  const stk = (err.stack ?? "").split("\n");
  // Skip the first 3 frames (Error, set handler, captureStack itself).
  const out: string[] = [];
  for (const line of stk.slice(3)) {
    const t = line.trim();
    // Keep only frames that point into packages/engine/src/ — strip prefix.
    if (t.includes("packages/engine/src/") || t.includes("packages/cli/src/")) {
      out.push(t.replace(/file:\/\/[^\s]*marble-love\//, ""));
      if (out.length >= 8) break;
    }
  }
  return out;
}

const origWorkRam = s.workRam;
// Replace s.workRam with a Proxy that intercepts numeric-index writes.
// For TypedArrays, traps must use Reflect to preserve the internal-slot semantics.
const proxy = new Proxy(origWorkRam, {
  get(target, prop) {
    const v = Reflect.get(target, prop, target);
    if (typeof v === "function") return v.bind(target);
    return v;
  },
  set(target, prop, value) {
    const idx = typeof prop === "string" ? Number(prop) : NaN;
    if (Number.isInteger(idx) && idx >= 0 && idx < target.length) {
      if (logging) {
        const label = inRegion(idx);
        if (label !== null) {
          samples.push({
            frame: currentFrame,
            abs_frame: 12000 + currentFrame,
            abs_addr: "0x" + (0x400000 + idx).toString(16),
            off: idx,
            value: value as number,
            label,
            stack: captureStack(),
          });
        }
      }
    }
    return Reflect.set(target, prop, value, target);
  },
});
// Cast Proxy back to Uint8Array for the engine.
(s as { workRam: Uint8Array }).workRam = proxy as unknown as Uint8Array;

// ─── Drive ticks ────────────────────────────────────────────────────────────
// For each frame, TS tick(); if inside the window, log writes.
// Window MAME tap: f12059..f12080 (TS f+59..f+80).
const WINDOW_LO = 1;
const WINDOW_HI = 80;
const TOTAL = 80;

const endStates: { frame: number; xLong: number; yLong: number }[] = [];
for (let i = 1; i <= TOTAL; i++) {
  currentFrame = i;
  logging = i >= WINDOW_LO && i <= WINDOW_HI;
  tick(s, { rom, runMainLoopBody: true, p1X: 0xff, p1Y: 0xff, p2X: 0xff, p2Y: 0xff });
  // Snapshot P2.slot0 X.long, Y.long after tick
  const wr = origWorkRam;
  const xL = ((wr[0xa20]! << 24) | (wr[0xa21]! << 16) | (wr[0xa22]! << 8) | wr[0xa23]!) >>> 0;
  const yL = ((wr[0xa24]! << 24) | (wr[0xa25]! << 16) | (wr[0xa26]! << 8) | wr[0xa27]!) >>> 0;
  endStates.push({ frame: 12000 + i, xLong: xL, yLong: yL });
}
console.log("\n--- Per-frame TS end-state P2.slot0 X.long vs MAME ---");
const mameSnap = JSON.parse(readFileSync("/tmp/mame_100f.json", "utf-8")) as { snapshots: { workRam: string }[] };
for (const e of endStates) {
  const i = e.frame - 12000;
  const hex = mameSnap.snapshots[i]!.workRam.substr(0xa20 * 2, 16);
  const mx = parseInt(hex.substr(0, 8), 16);
  const my = parseInt(hex.substr(8, 8), 16);
  if (e.xLong !== mx || e.yLong !== my) {
    console.log(`f${e.frame}: TS X=${e.xLong.toString(16).padStart(8, "0")} Y=${e.yLong.toString(16).padStart(8, "0")} | MAME X=${mx.toString(16).padStart(8, "0")} Y=${my.toString(16).padStart(8, "0")}  ${e.xLong !== mx ? "X✗" : ""}${e.yLong !== my ? "Y✗" : ""}`);
  }
}

// ─── Per-frame summary + diff vs MAME ───────────────────────────────────────
const mameTap = JSON.parse(readFileSync("/tmp/mame_p2_slot0_writers.json", "utf-8")) as {
  samples: { f: number; pc: string; addr: string; data: string; mask: string; size: number; lbl: string }[];
};

// Build per-frame final value snapshot from MAME tap: last write per (addr,frame).
// NB: MAME tap uses `register_frame_done` which fires AT END of frame, but writes
// happen DURING the frame. Since frame_count increments at the START of frame_done,
// writes captured during real frame N are labeled as `f = N-1`. We compensate by
// matching MAME label `absFrame - 1` to the canonical absolute frame number.
function mameSnapshotAtFrame(absFrame: number): Map<number, { value: number; pc: string; size: number }> {
  const m = new Map<number, { value: number; pc: string; size: number }>();
  const tapFrame = absFrame - 1;
  for (const sm of mameTap.samples) {
    if (sm.f !== tapFrame) continue;
    const addr = parseInt(sm.addr, 16);
    const data = parseInt(sm.data, 16);
    const mask = parseInt(sm.mask, 16);
    // Decompose into bytes (M68k stores big-endian; data lower bytes carry the value).
    // size 2 = word (data & 0xffff), size 1 = byte. The mask tells which byte slot.
    if (sm.size === 1) {
      // Byte write: which byte? Use mask: 0xff = low byte at addr+1 (M68k MOVE.B aligned),
      // 0xff00 = byte at addr. Looking at mame samples: addr+lbl shows the actual byte.
      // For mask 0x0000ff00 the byte is at addr+0; for 0x000000ff at addr+1.
      // But MAME write_tap reports the addr where the access starts; we just
      // record per byte. Simpler: log per-byte: split data into bytes within mask.
      // We'll use the addr as-is and the byte value extracted.
      let v: number;
      if (mask === 0xff) {
        v = data & 0xff;
        m.set(addr + 1, { value: v, pc: sm.pc, size: 1 });
      } else if (mask === 0xff00) {
        v = (data >>> 8) & 0xff;
        m.set(addr, { value: v, pc: sm.pc, size: 1 });
      } else if (mask === 0xff0000) {
        v = (data >>> 16) & 0xff;
        m.set(addr, { value: v, pc: sm.pc, size: 1 });
      } else if (mask === 0xff000000) {
        v = (data >>> 24) & 0xff;
        m.set(addr, { value: v, pc: sm.pc, size: 1 });
      } else {
        // Partial unaligned, just record raw
        m.set(addr, { value: data & 0xff, pc: sm.pc, size: 1 });
      }
    } else if (sm.size === 2) {
      const v = data & 0xffff;
      m.set(addr,     { value: (v >>> 8) & 0xff, pc: sm.pc, size: 2 });
      m.set(addr + 1, { value: v & 0xff,         pc: sm.pc, size: 2 });
    } else if (sm.size === 4) {
      const v = data >>> 0;
      m.set(addr,     { value: (v >>> 24) & 0xff, pc: sm.pc, size: 4 });
      m.set(addr + 1, { value: (v >>> 16) & 0xff, pc: sm.pc, size: 4 });
      m.set(addr + 2, { value: (v >>>  8) & 0xff, pc: sm.pc, size: 4 });
      m.set(addr + 3, { value: v & 0xff,          pc: sm.pc, size: 4 });
    }
  }
  return m;
}

function tsSnapshotAtFrame(absFrame: number): Map<number, { value: number; topStack: string }> {
  const m = new Map<number, { value: number; topStack: string }>();
  for (const sm of samples) {
    if (sm.abs_frame !== absFrame) continue;
    m.set(parseInt(sm.abs_addr, 16), { value: sm.value, topStack: sm.stack[0] ?? "" });
  }
  return m;
}

// Address range to compare: 0x40097c..0x40097f, 0x400a00..0x400a3f.
function compareFrame(absFrame: number): { firstDiff: { addr: number; ts: number | null; mame: number | null; tsStack: string; mamePc: string } | null; totalDiffs: number } {
  const mame = mameSnapshotAtFrame(absFrame);
  const ts = tsSnapshotAtFrame(absFrame);
  const all = new Set<number>([...mame.keys(), ...ts.keys()]);
  const addrs = [...all].sort((a, b) => a - b);
  let firstDiff: { addr: number; ts: number | null; mame: number | null; tsStack: string; mamePc: string } | null = null;
  let total = 0;
  for (const a of addrs) {
    const mv = mame.get(a);
    const tv = ts.get(a);
    const mb = mv?.value ?? -1;
    const tb = tv?.value ?? -1;
    if (mb !== tb) {
      total++;
      if (firstDiff === null) {
        firstDiff = {
          addr: a,
          ts: tv?.value ?? null,
          mame: mv?.value ?? null,
          tsStack: tv?.topStack ?? "(no TS write)",
          mamePc: mv?.pc ?? "(no MAME write)",
        };
      }
    }
  }
  return { firstDiff, totalDiffs: total };
}

console.log("--- Per-frame writes (MAME final byte map vs TS) ---");
console.log("absFrame | mame_addrs | ts_addrs | first_diff_addr  TS  MAME  TS_caller (PC_MAME)");
let firstDivFrame = -1;
const perFrame: unknown[] = [];
for (let abs = 12001; abs <= 12080; abs++) {
  const mame = mameSnapshotAtFrame(abs);
  const ts = tsSnapshotAtFrame(abs);
  const { firstDiff, totalDiffs } = compareFrame(abs);
  perFrame.push({ frame: abs, mame_addrs: mame.size, ts_addrs: ts.size, totalDiffs, firstDiff });
  if (firstDiff) {
    if (firstDivFrame < 0) firstDivFrame = abs;
    console.log(
      `f${abs}    | ${mame.size.toString().padStart(3)}        | ${ts.size.toString().padStart(3)}      | 0x${firstDiff.addr.toString(16).padStart(6, "0")}  TS=0x${(firstDiff.ts ?? -1).toString(16)} MAME=0x${(firstDiff.mame ?? -1).toString(16)}  diffs=${totalDiffs}`
    );
    console.log(`         TS caller stack[0]: ${firstDiff.tsStack}`);
    console.log(`         MAME PC: ${firstDiff.mamePc}`);
  } else {
    console.log(`f${abs}    | ${mame.size.toString().padStart(3)}        | ${ts.size.toString().padStart(3)}      | (match)`);
  }
}

// Save full samples for inspection.
writeFileSync(
  "/tmp/ts_p2_slot0_writers.json",
  JSON.stringify({ total_samples: samples.length, samples, per_frame: perFrame, first_diff_frame: firstDivFrame }, null, 2),
);
console.log(`\nTS samples written: ${samples.length}; first diverging frame = f${firstDivFrame >= 0 ? firstDivFrame : "(none in window)"}`);
console.log("Output: /tmp/ts_p2_slot0_writers.json");
