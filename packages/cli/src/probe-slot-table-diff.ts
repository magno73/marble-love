// Probe: identify divergent bytes in slot table @ 0x400a9c (25 slots x 0x56 stride) @ f+99
// and show where diffs concentrate by slot/field.
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

const SLOT_BASE = 0xa9c;
const STRIDE = 0x56;
const N_SLOTS = 25;
// Slot table end @ SLOT_BASE + N_SLOTS * STRIDE = 0x1306 (reference only).

// Find frame index for f+99 (last)
const lastIdx = groundTruth.snapshots.length - 1;
const lastFrame = groundTruth.snapshots[lastIdx]!;

// Advance TS up to f+99
for (let i = 1; i <= lastIdx; i++) {
  tick(s, { rom, runMainLoopBody: true, p1X: 0xff, p1Y: 0xff, p2X: 0xff, p2Y: 0xff });
}

const mameW = hex2bytes(lastFrame.workRam, 0x2000);

// 1) Total workRam diff
let totW = 0;
for (let i = 0; i < 0x2000; i++) if (s.workRam[i] !== mameW[i]) totW++;
console.log(`f+${lastIdx} total workRam diff = ${totW}`);

// 2) Diff in the slot table 0xa9c..0x1306
let slotDiffCount = 0;
const perSlotDiff: number[] = Array(N_SLOTS).fill(0);
const perFieldDiff: Map<number, number> = new Map();
for (let slot = 0; slot < N_SLOTS; slot++) {
  for (let f = 0; f < STRIDE; f++) {
    const off = SLOT_BASE + slot * STRIDE + f;
    if (s.workRam[off] !== mameW[off]) {
      slotDiffCount++;
      perSlotDiff[slot]!++;
      perFieldDiff.set(f, (perFieldDiff.get(f) ?? 0) + 1);
    }
  }
}
console.log(`Slot table (0xa9c..0x1306) diff = ${slotDiffCount} / ${N_SLOTS * STRIDE} bytes`);
console.log(`Non-slot-table workRam diff = ${totW - slotDiffCount}`);
console.log();

// 3) Per-slot summary
console.log("Per-slot diff counts:");
for (let slot = 0; slot < N_SLOTS; slot++) {
  if (perSlotDiff[slot]! > 0) {
    const base = SLOT_BASE + slot * STRIDE;
    console.log(`  slot ${slot.toString().padStart(2)} @ 0x${base.toString(16)}: ${perSlotDiff[slot]} diff bytes`);
  }
}
console.log();

// 4) Per-field summary (which struct fields most often diverge)
console.log("Per-field (offset within slot) diff distribution:");
const sortedFields = Array.from(perFieldDiff.entries()).sort((a, b) => b[1] - a[1]);
for (const [f, count] of sortedFields.slice(0, 20)) {
  console.log(`  +0x${f.toString(16).padStart(2, "0")}: ${count} slots`);
}
console.log();

// 5) Dump full diff per-slot per-byte (compact)
console.log("Per-byte diff (slot, offset, TS=val, MAME=val):");
for (let slot = 0; slot < N_SLOTS; slot++) {
  if (perSlotDiff[slot]! === 0) continue;
  const base = SLOT_BASE + slot * STRIDE;
  const diffs: string[] = [];
  for (let f = 0; f < STRIDE; f++) {
    const off = base + f;
    if (s.workRam[off] !== mameW[off]) {
      diffs.push(`+${f.toString(16).padStart(2, "0")}:T=${s.workRam[off]!.toString(16).padStart(2, "0")},M=${mameW[off]!.toString(16).padStart(2, "0")}`);
    }
  }
  console.log(`  slot ${slot.toString().padStart(2)}: ${diffs.join(" ")}`);
}
