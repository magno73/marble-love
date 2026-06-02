// Probe: per-byte map of the 215B gameplay drift at f+99.
//
// For each divergent byte:
//  - absolute workRam offset
//  - TS vs MAME value
//  - owning struct field (best effort through static tables)
//  - first divergence frame (from f+1 to f+99)
//  - candidate writer sub (heuristic from cluster and repo knowledge)
//
// Output:
//  - console: top-10 "early diverge" bottlenecks plus cluster summary
//  - file: docs/gameplay-drift-byte-map.md (table ordered by cluster)
//
// Constraint: no sub/state edits. Drift at f+99 must remain 215.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { state as stateNs, bus as busNs, bootInit, tick, applySlapsticBank } from "@marble-love/engine";

// ─── Setup: ROM + ground truth + warm state ──────────────────────────────────

const rom = busNs.emptyRomImage();
applySlapsticBank.loadRomBlob(rom, readFileSync(resolve("ghidra_project/marble_program.bin")));

const groundTruth = JSON.parse(readFileSync("/tmp/mame_100f.json", "utf-8")) as {
  frames: number[];
  snapshots: {
    frame: number;
    workRam: string;
    spriteRam: string;
    playfieldRam: string;
    alphaRam: string;
    colorRam: string;
  }[];
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
  // Slapstic 103 active bank at MAME f=12000 attract = 1.
  slapsticBank: 1,
};

const lastIdx = groundTruth.snapshots.length - 1; // = 99
const lastFrame = groundTruth.snapshots[lastIdx]!;
const mameW99 = hex2bytes(lastFrame.workRam, 0x2000);

// ─── Stack-residue mask (excluded from invariant) ────────────────────────────

function isStackResidue(off: number): boolean {
  return (
    (off >= 0x440 && off < 0x448) ||
    (off >= 0x1D40 && off < 0x1E80) ||
    (off >= 0x1EE0 && off < 0x1F00)
  );
}

// ─── Run 99 TS frames with snapshots for first-divergence search ─────────────

function runTs99Snapshots(): Uint8Array[] {
  const s = stateNs.emptyGameState();
  bootInit(s, rom, { warmState: warm });
  // snapshots[k] = workRam @ f+k (k=0..99). snapshots[0] = warm.
  const snapshots: Uint8Array[] = [];
  snapshots.push(new Uint8Array(s.workRam));
  for (let i = 1; i <= lastIdx; i++) {
    tick(s, { rom, runMainLoopBody: true, p1X: 0xff, p1Y: 0xff, p2X: 0xff, p2Y: 0xff });
    snapshots.push(new Uint8Array(s.workRam));
  }
  return snapshots;
}

const tsSnapshots = runTs99Snapshots();

// Sanity: drift @ f+99 (gameplay only)
let totW = 0;
let totGameplay = 0;
const divergentOffsets: number[] = [];
for (let off = 0; off < 0x2000; off++) {
  if (tsSnapshots[lastIdx]![off] !== mameW99[off]) {
    totW++;
    if (!isStackResidue(off)) {
      totGameplay++;
      divergentOffsets.push(off);
    }
  }
}
console.log(`f+${lastIdx}: total=${totW} | gameplay=${totGameplay} | stack=${totW - totGameplay}`);

// ─── First-diverge frame (linear sweep over snapshots TS vs MAME @ that frame) ──
//
// MAME has snapshots at frames 0..99 (snapshots[k] = MAME f12000+k).
// For each byte, find the smallest k where ts[k][off] != mame[k][off].
// Binary search over precomputed arrays is not more useful than a linear sweep
// over 99 frames here: O(99 * 215) = 21k operations, which is negligible.

interface MameSnap {
  workRam: Uint8Array;
}
const mameSnapshotsCache: (MameSnap | null)[] = new Array(lastIdx + 1).fill(null);
function getMameSnapshot(k: number): MameSnap {
  if (mameSnapshotsCache[k]) return mameSnapshotsCache[k]!;
  const snap = groundTruth.snapshots[k]!;
  const m: MameSnap = { workRam: hex2bytes(snap.workRam, 0x2000) };
  mameSnapshotsCache[k] = m;
  return m;
}

function firstDivergeFrame(off: number): number {
  for (let k = 1; k <= lastIdx; k++) {
    const mame = getMameSnapshot(k);
    if (tsSnapshots[k]![off] !== mame.workRam[off]) return k;
  }
  return lastIdx; // Fallback; should not happen when off diverges at f+99.
}

// ─── Struct field identification (heuristic) ─────────────────────────────────

/**
 * Maps offset → string label. Combination of:
 *  - globals header
 *  - obj0 struct (0x18..0xF0 +0xD9 = 0xF1)
 *  - obj1 / obj2 / obj3 following structures
 *  - velocity / world globals 0x66x..0x69x
 *  - scroll srtgt 0x97c..
 *  - slot pair 0x9A4 (P1) / 0xA20 (P2), stride 0x7C
 *  - script slot table 0xA9C, stride 0x56, 25 slot
 *  - 4-slot script array @ 0x1302 stride 0x60
 *  - string slot array @ 0x1482 stride 0x42
 *  - hit-test slot array @ 0x19F8 stride 0x38
 *  - STRUCT 0x1C28 (16 word)
 */

function objField(off: number, base: number, label: string): string | null {
  const f = off - base;
  if (f < 0 || f >= 0xd9) return null;
  // Common fields (subset from helper-121b8 + object-helpers + state.ts)
  const map: Record<number, string> = {
    0x00: "vx_long_b0",
    0x01: "vx_long_b1",
    0x02: "vx_long_b2",
    0x03: "vx_long_b3",
    0x04: "vy_long_b0",
    0x05: "vy_long_b1",
    0x06: "vy_long_b2",
    0x07: "vy_long_b3",
    0x08: "vz_long_b0",
    0x09: "vz_long_b1",
    0x0a: "vz_long_b2",
    0x0b: "vz_long_b3",
    0x0c: "x_long_b0",
    0x0d: "x_long_b1",
    0x0e: "x_long_b2",
    0x0f: "x_long_b3",
    0x10: "y_long_b0",
    0x11: "y_long_b1",
    0x12: "y_long_b2",
    0x13: "y_long_b3",
    0x14: "z_long_b0",
    0x15: "z_long_b1",
    0x16: "z_long_b2",
    0x17: "z_long_b3",
    0x18: "globals_copy_b0",
    0x19: "type_byte",
    0x1a: "state_byte",
    0x1b: "substate_byte",
    0x1c: "flags_b0",
    0x1d: "flags_b1",
    0x2a: "savedZ_b0",
    0x2b: "savedZ_b1",
    0x2c: "savedZ_b2",
    0x2d: "savedZ_b3",
    0x2e: "tileX_word_hi",
    0x2f: "tileX_word_lo",
    0x30: "tileY_word_hi",
    0x31: "tileY_word_lo",
    0x32: "trackX_hi",
    0x33: "trackX_lo",
    0x34: "trackY_hi",
    0x35: "trackY_lo",
    0x36: "gravity_flag",
    0x57: "event_code",
    0x58: "dispatch_code",
    0x68: "anim_flag_a",
    0x69: "anim_flag_b",
    0x6a: "obj6a_word_hi",
    0x6b: "obj6a_word_lo",
    0x6c: "timer_b0",
    0x6d: "timer_b1",
    0x6e: "ptrA_b0",
    0x6f: "ptrA_b1",
    0x70: "ptrA_b2",
    0x71: "ptrA_b3",
    0x72: "ptrB_b0",
    0x73: "ptrB_b1",
    0x74: "ptrB_b2",
    0x75: "ptrB_b3",
    0xbc: "accum_b0",
    0xbd: "accum_b1",
    0xbe: "accum_b2",
    0xbf: "accum_b3",
    0xca: "fillCount",
    0xd4: "eventLong_b0",
    0xd5: "eventLong_b1",
    0xd6: "eventLong_b2",
    0xd7: "eventLong_b3",
    0xd8: "trigger_flag",
  };
  const fieldName = map[f] ?? `field_+0x${f.toString(16)}`;
  return `${label}.${fieldName}`;
}

function slotPairField(off: number, base: number, slotLabel: string): string | null {
  const f = off - base;
  if (f < 0 || f >= 0x7c) return null;
  // Slot pair fields (0x4009A4 P1 / 0x400A20 P2). Same layout obj-like
  // limited to 0x7C bytes.
  const subFields: Record<number, string> = {
    0x00: "vx_b0",
    0x01: "vx_b1",
    0x02: "vx_b2",
    0x03: "vx_b3",
    0x04: "vy_b0",
    0x05: "vy_b1",
    0x06: "vy_b2",
    0x07: "vy_b3",
    0x08: "vz_b0",
    0x09: "vz_b1",
    0x0a: "vz_b2",
    0x0b: "vz_b3",
    0x0c: "x_b0",
    0x0d: "x_b1",
    0x0e: "x_b2",
    0x0f: "x_b3",
    0x10: "y_b0",
    0x11: "y_b1",
    0x12: "y_b2",
    0x13: "y_b3",
    0x14: "z_b0",
    0x15: "z_b1",
    0x16: "z_b2",
    0x17: "z_b3",
    0x18: "state",
    0x19: "type",
  };
  const fn = subFields[f] ?? `+0x${f.toString(16)}`;
  return `${slotLabel}.${fn}`;
}

function scriptSlotField(off: number): string | null {
  // 25 slot × 0x56 byte from 0xA9C to 0xA9C + 25*0x56 = 0xA9C + 0x86A = 0x1306
  const base = 0xa9c;
  const stride = 0x56;
  const slotCount = 25;
  if (off < base || off >= base + stride * slotCount) return null;
  const idx = Math.floor((off - base) / stride);
  const f = (off - base) % stride;
  return `scriptSlot[${idx}].+0x${f.toString(16)}`;
}

function script4SlotField(off: number): string | null {
  // 0x1302..0x1421 = 4 slot × 0x60
  const base = 0x1302;
  const stride = 0x60;
  if (off < base || off >= base + stride * 4) return null;
  const idx = Math.floor((off - base) / stride);
  const f = (off - base) % stride;
  return `slot4[${idx}].+0x${f.toString(16)}`;
}

function stringSlotField(off: number): string | null {
  // 0x1482..0x1482+7*0x42-1 = 0x1482..0x1614
  const base = 0x1482;
  const stride = 0x42;
  if (off < base || off >= base + stride * 7) return null;
  const idx = Math.floor((off - base) / stride);
  const f = (off - base) % stride;
  return `strSlot[${idx}].+0x${f.toString(16)}`;
}

function hitTestSlotField(off: number): string | null {
  // 0x19F8..0x19F8+10*0x38-1 = 0x19F8..0x1BF7
  const base = 0x19f8;
  const stride = 0x38;
  if (off < base || off >= base + stride * 10) return null;
  const idx = Math.floor((off - base) / stride);
  const f = (off - base) % stride;
  return `hitSlot[${idx}].+0x${f.toString(16)}`;
}

function struct1c28Field(off: number): string | null {
  if (off < 0x1c28 || off >= 0x1c48) return null;
  const wordIdx = Math.floor((off - 0x1c28) / 2);
  const half = (off - 0x1c28) % 2 === 0 ? "hi" : "lo";
  return `struct1C28.w${wordIdx}_${half}`;
}

function globalsField(off: number): string | null {
  // Known globals (subset)
  const known: Record<number, string> = {
    0x000: "g_timer_b0",
    0x001: "g_timer_b1",
    0x002: "g_timer_b2",
    0x003: "g_timer_b3",
    0x016: "g_mailbox_vbl_hi",
    0x017: "g_mailbox_vbl_lo",
    0x396: "g_count_hi",
    0x397: "g_count_lo",
    0x398: "g_mode_mask",
    0x39a: "g_av_latch",
    0x39c: "g_event_flags",
    0x3a4: "g_3a4",
    0x3a6: "g_av_r3a6",
    0x3a7: "g_av_r3a7",
    0x3ae: "g_av_r3ae",
    0x3b0: "g_av_r3b0",
    0x3ba: "g_A4_save",
    0x3dc: "g_3dc_mode",
    0x3e0: "g_3e0",
    0x3f0: "g_frame_counter",
    0x3f1: "g_frame_counter_b1",
    0x3f2: "g_frame_counter_b2",
    0x3f3: "g_frame_counter_b3",
    0x66a: "g_diag_mask",
    0x66c: "g_input_bits_b0",
    0x66d: "g_input_bits_b1",
    0x66e: "g_input_bits_b2",
    0x66f: "g_input_bits_b3",
    0x670: "g_input_bits_b4",
    0x671: "g_input_bits_b5",
    0x672: "g_input_bits_b6",
    0x674: "g_velLeft_hi",
    0x675: "g_velLeft_lo",
    0x676: "g_velDown_hi",
    0x677: "g_velDown_lo",
    0x678: "g_velRight_hi",
    0x679: "g_velRight_lo",
    0x67a: "g_velUp_hi",
    0x67b: "g_velUp_lo",
    0x67c: "g_velNE_hi",
    0x67d: "g_velNE_lo",
    0x67e: "g_velNW_hi",
    0x67f: "g_velNW_lo",
    0x680: "g_velSE_hi",
    0x681: "g_velSE_lo",
    0x682: "g_velSW_hi",
    0x683: "g_velSW_lo",
    0x684: "g_savedX_b0",
    0x685: "g_savedX_b1",
    0x686: "g_savedX_b2",
    0x687: "g_savedX_b3",
    0x688: "g_savedY_b0",
    0x689: "g_savedY_b1",
    0x68a: "g_savedY_b2",
    0x68b: "g_savedY_b3",
    0x68c: "g_savedZ_b0",
    0x68d: "g_savedZ_b1",
    0x68e: "g_savedZ_b2",
    0x68f: "g_savedZ_b3",
    0x690: "g_worldX_hi",
    0x691: "g_worldX_lo",
    0x692: "g_worldY_hi",
    0x693: "g_worldY_lo",
    0x696: "g_tileX_hi",
    0x697: "g_tileX_lo",
    0x698: "g_tileY_hi",
    0x699: "g_tileY_lo",
    0x69a: "g_trackX_hi",
    0x69b: "g_trackX_lo",
    0x69c: "g_trackY_hi",
    0x69d: "g_trackY_lo",
    0x69e: "g_69e",
    0x97c: "g_srtgt_b0",
    0x97d: "g_srtgt_b1",
    0x97e: "g_srtgt_b2",
    0x97f: "g_srtgt_b3",
  };
  return known[off] ?? null;
}

function identifyField(off: number): string {
  // 1) known globals
  const g = globalsField(off);
  if (g) return g;
  // 2) obj0 = 0x018..0x0F0 (216 byte)
  const o0 = objField(off, 0x18, "obj0");
  if (o0) return o0;
  // 3) obj1 = 0x0F1..0x1C9 ? Skip if empty; use 0xF1.
  // (previous analysis: obj1 NOT diff). Leave as fallback range.
  if (off >= 0xf1 && off < 0x1ca) {
    return objField(off, 0xf1, "obj1") ?? `obj1.+0x${(off - 0xf1).toString(16)}`;
  }
  if (off >= 0x1ca && off < 0x2a3) {
    return objField(off, 0x1ca, "obj2") ?? `obj2.+0x${(off - 0x1ca).toString(16)}`;
  }
  if (off >= 0x2a3 && off < 0x37c) {
    return objField(off, 0x2a3, "obj3") ?? `obj3.+0x${(off - 0x2a3).toString(16)}`;
  }
  // 4) AV/scroll globals 0x390..0x3FF
  if (off >= 0x390 && off < 0x400) {
    return `avControl.+0x${off.toString(16)}`;
  }
  // 5) state machine 0x400..0x4FF
  if (off >= 0x400 && off < 0x500) {
    return `stateMachine.+0x${off.toString(16)}`;
  }
  // 6) decode buffer 0x700..0x77F (74B known)
  if (off >= 0x700 && off < 0x780) {
    const wordIdx = Math.floor((off - 0x700) / 2);
    const half = (off - 0x700) % 2 === 0 ? "hi" : "lo";
    return `decodeBuf.w${wordIdx}_${half}`;
  }
  // 7) sprite-record table 0x98C base, stride 0xC
  if (off >= 0x98c && off < 0x9a4) {
    return `sprRec.+0x${(off - 0x98c).toString(16)}`;
  }
  // 8) P1 slot pair 0x9A4..0xA1F
  const p1 = slotPairField(off, 0x9a4, "slotP1");
  if (p1) return p1;
  // 9) P2 slot pair 0xA20..0xA9B
  const p2 = slotPairField(off, 0xa20, "slotP2");
  if (p2) return p2;
  // 10) Script slot table 25*0x56 @ 0xA9C
  const ss = scriptSlotField(off);
  if (ss) return ss;
  // 11) 4-slot script array @ 0x1302
  const s4 = script4SlotField(off);
  if (s4) return s4;
  // 12) string slot @ 0x1482
  const ssr = stringSlotField(off);
  if (ssr) return ssr;
  // 13) hit-test slot @ 0x19F8
  const ht = hitTestSlotField(off);
  if (ht) return ht;
  // 14) STRUCT 0x1C28
  const sc = struct1c28Field(off);
  if (sc) return sc;
  // 15) Stack, excluded but identified for completeness.
  if (off >= 0x1d40 && off < 0x1e80) return `STACK_RESIDUE_${off.toString(16)}`;
  if (off >= 0x1ee0 && off < 0x1f00) return `STACK_RESIDUE_${off.toString(16)}`;
  return `unknown_+0x${off.toString(16)}`;
}

// ─── Candidate writer heuristic ──────────────────────────────────────────────

function candidateWriter(off: number): string {
  // Known clusters from status notes and drift-cluster-analysis.
  if (off >= 0x700 && off < 0x780) return "decodeBitstream1A668 (via refreshHelper13EE6)";
  if (off >= 0x640 && off < 0x6c0) return "stateDispatch160F6 (cascade from P2 slot drift)";
  if (off >= 0x66c && off < 0x680) return "helper121B8 / stateDispatch160F6 (input bits + vel)";
  if (off >= 0x9a4 && off < 0xa20) return "objectUpdatePair158CC + fun158F6(P1)";
  if (off >= 0xa20 && off < 0xa9c) return "objectUpdatePair158CC + fun158F6(P2)";
  if (off >= 0xa9c && off < 0x1302) return "claimScriptSlot / scriptSlotStep13068";
  if (off >= 0x1302 && off < 0x1422) return "helper12896 / slotArrayTick (4-slot script)";
  if (off >= 0x1c28 && off < 0x1c48) return "helper-1cd00 STRUCT 0x1C28 (16 word)";
  if (off >= 0x1d40 && off < 0x1e80) return "stack residue (multiple callers)";
  if (off >= 0x1ee0 && off < 0x1f00) return "stack residue (multiple callers)";
  if (off >= 0x18 && off < 0xf1) return "helper121B8(obj0 chain)";
  if (off >= 0xf1 && off < 0x37c) return "helper121B8 or sub-fa0-marble-emit";
  if (off >= 0x390 && off < 0x400) return "AV-control latch / refresh-frame";
  if (off >= 0x400 && off < 0x500) return "stateSub* family";
  if (off >= 0x680 && off < 0x6a0) return "helper121B8 globals snapshot";
  if (off >= 0x690 && off < 0x6a0) return "helper121B8 worldX/Y/tile updates";
  if (off >= 0x97c && off < 0x980) return "refreshHelper13EE6 (srtgt scroll)";
  if (off === 0x39a) return "AV-control latch (main.ts post-tick)";
  if (off === 0x39c) return "triggerObjectEvent / event-flags";
  return "unknown";
}

// ─── Cluster label (64-byte bucket) ──────────────────────────────────────────

function clusterLabel(off: number): string {
  const start = Math.floor(off / 0x40) * 0x40;
  const end = start + 0x3f;
  return `0x${start.toString(16).padStart(4, "0")}..0x${end.toString(16).padStart(4, "0")}`;
}

// ─── Build per-byte rows ─────────────────────────────────────────────────────

interface Row {
  offset: number;
  tsValue: number;
  mameValue: number;
  cluster: string;
  structField: string;
  firstDivergeFrame: number;
  candidateWriter: string;
}

const rows: Row[] = divergentOffsets.map((off) => ({
  offset: off,
  tsValue: tsSnapshots[lastIdx]![off]!,
  mameValue: mameW99[off]!,
  cluster: clusterLabel(off),
  structField: identifyField(off),
  firstDivergeFrame: firstDivergeFrame(off),
  candidateWriter: candidateWriter(off),
}));

// ─── Cluster aggregation ─────────────────────────────────────────────────────

const clusterCounts = new Map<string, Row[]>();
for (const r of rows) {
  if (!clusterCounts.has(r.cluster)) clusterCounts.set(r.cluster, []);
  clusterCounts.get(r.cluster)!.push(r);
}
const clustersRanked = [...clusterCounts.entries()].sort((a, b) => b[1].length - a[1].length);

// ─── Top-10 bottleneck (early diverge) ───────────────────────────────────────

const earlyDiverge = [...rows]
  .sort((a, b) => a.firstDivergeFrame - b.firstDivergeFrame)
  .slice(0, 10);

// ─── Console summary ─────────────────────────────────────────────────────────

console.log(`\n=== Gameplay drift byte map @ f+${lastIdx} ===`);
console.log(`Total gameplay diff: ${rows.length} byte (stack residue ${totW - totGameplay} excluded)\n`);

console.log(`Top-10 early-diverge bytes (root cascade candidates):`);
console.log(`  off    | TS  MAME | first | field                              | writer`);
console.log(`  -------+----------+-------+------------------------------------+--------`);
for (const r of earlyDiverge) {
  console.log(
    `  0x${r.offset.toString(16).padStart(4, "0")} | ${r.tsValue
      .toString(16)
      .padStart(2, "0")
      .toUpperCase()}  ${r.mameValue.toString(16).padStart(2, "0").toUpperCase()}   | f+${r.firstDivergeFrame
      .toString()
      .padStart(2)} | ${r.structField.padEnd(34)} | ${r.candidateWriter}`,
  );
}

console.log(`\nCluster rank (gameplay only):`);
let cum = 0;
for (let i = 0; i < Math.min(15, clustersRanked.length); i++) {
  const [label, items] = clustersRanked[i]!;
  cum += items.length;
  const minFD = Math.min(...items.map((r) => r.firstDivergeFrame));
  console.log(
    `  #${(i + 1).toString().padStart(2)} ${label}  ${items.length
      .toString()
      .padStart(3)}B  (cum ${cum}, ${((cum / rows.length) * 100).toFixed(1)}%)  earliest=f+${minFD}`,
  );
}

// ─── Markdown report ─────────────────────────────────────────────────────────

function hex(n: number, w: number): string {
  return n.toString(16).padStart(w, "0");
}

const mdLines: string[] = [];
mdLines.push(`# Gameplay drift byte map @ f+${lastIdx}`);
mdLines.push("");
mdLines.push(
  `Total: **${rows.length} byte gameplay** (of which ${
    totW - totGameplay
  }B stack residue excluded from the invariant).`,
);
mdLines.push("");
mdLines.push(`Generated by \`packages/cli/src/probe-gameplay-byte-map.ts\`.`);
mdLines.push("");

mdLines.push(`## Top-10 bottleneck "early diverge"`);
mdLines.push("");
mdLines.push(
  `The bytes that diverge first are the root-cascade candidates. Once these are fixed, many downstream ones collapse.`,
);
mdLines.push("");
mdLines.push(`| offset | TS | MAME | first_diverge | field | candidate writer |`);
mdLines.push(`|---|---|---|---|---|---|`);
for (const r of earlyDiverge) {
  mdLines.push(
    `| 0x${hex(r.offset, 4)} | ${hex(r.tsValue, 2).toUpperCase()} | ${hex(
      r.mameValue,
      2,
    ).toUpperCase()} | f+${r.firstDivergeFrame} | \`${r.structField}\` | ${r.candidateWriter} |`,
  );
}
mdLines.push("");

mdLines.push(`## Cluster ranking (by byte count)`);
mdLines.push("");
mdLines.push(`| rank | cluster | bytes | cum | %tot | earliest diverge | dominant writer |`);
mdLines.push(`|---|---|---:|---:|---:|---|---|`);
let cum2 = 0;
for (let i = 0; i < clustersRanked.length; i++) {
  const [label, items] = clustersRanked[i]!;
  cum2 += items.length;
  const minFD = Math.min(...items.map((r) => r.firstDivergeFrame));
  // mode-writer: pick most common
  const writerCounts = new Map<string, number>();
  for (const it of items) writerCounts.set(it.candidateWriter, (writerCounts.get(it.candidateWriter) ?? 0) + 1);
  const dominantWriter = [...writerCounts.entries()].sort((a, b) => b[1] - a[1])[0]![0];
  mdLines.push(
    `| #${i + 1} | \`${label}\` | ${items.length} | ${cum2} | ${(
      (cum2 / rows.length) *
      100
    ).toFixed(1)}% | f+${minFD} | ${dominantWriter} |`,
  );
}
mdLines.push("");

mdLines.push(`## Per-cluster detail`);
mdLines.push("");

for (let i = 0; i < clustersRanked.length; i++) {
  const [label, items] = clustersRanked[i]!;
  mdLines.push(`### Priority ${i + 1}: cluster \`${label}\` — ${items.length} byte`);
  mdLines.push("");
  mdLines.push(`| offset | TS | MAME | first_diverge | field | candidate writer |`);
  mdLines.push(`|---|---|---|---|---|---|`);
  for (const r of [...items].sort((a, b) => a.offset - b.offset)) {
    mdLines.push(
      `| 0x${hex(r.offset, 4)} | ${hex(r.tsValue, 2).toUpperCase()} | ${hex(
        r.mameValue,
        2,
      ).toUpperCase()} | f+${r.firstDivergeFrame} | \`${r.structField}\` | ${r.candidateWriter} |`,
    );
  }
  mdLines.push("");
}

mkdirSync("docs", { recursive: true });
writeFileSync("docs/gameplay-drift-byte-map.md", mdLines.join("\n"));
console.log(`\nReport written to: docs/gameplay-drift-byte-map.md (${mdLines.length} lines)`);
