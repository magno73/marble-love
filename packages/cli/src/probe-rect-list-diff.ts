// Probe: byte-by-byte mapping del rect-list cluster (workRam[0x01DC..0x02BC]).
//
// For each divergent byte:
//  - slot index (= (off - 0x1DC) / 14)
//  - field name (type/sub/xMin/yMin/zMin/xMax/yMax/zMax)
//  - TS value vs MAME value
//  - first divergence frame
//
// Also, for each divergent slot:
//  - quale entity byte (= entityList[idx]) si mappa al slot
//  - quale typeCode/subIdx ha
//  - where coords are read from (ROM or workRam obj struct)
//
// Output: console + opzionale markdown report.
//
// Constraint: no state edits. Drift at f+99 must remain unchanged.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { state as stateNs, bus as busNs, bootInit, tick } from "@marble-love/engine";

// ─── Setup ───────────────────────────────────────────────────────────────────

const rom = busNs.emptyRomImage();
rom.program.set(
  readFileSync(resolve("ghidra_project/marble_program.bin")).subarray(0, rom.program.length),
);

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
};

const lastIdx = groundTruth.snapshots.length - 1; // = 99

// ─── Run TS with snapshots for each frame ────────────────────────────────────

function runTs99Snapshots(): Uint8Array[] {
  const s = stateNs.emptyGameState();
  bootInit(s, rom, { warmState: warm });
  const snapshots: Uint8Array[] = [];
  snapshots.push(new Uint8Array(s.workRam));
  for (let i = 1; i <= lastIdx; i++) {
    tick(s, { rom, runMainLoopBody: true, p1X: 0xff, p1Y: 0xff, p2X: 0xff, p2Y: 0xff });
    snapshots.push(new Uint8Array(s.workRam));
  }
  return snapshots;
}

const tsSnapshots = runTs99Snapshots();
const mameSnaps: Uint8Array[] = groundTruth.snapshots.map((s) => hex2bytes(s.workRam, 0x2000));

// ─── Rect-list constants ─────────────────────────────────────────────────────

const RECT_BASE = 0x1dc;
const RECT_STRIDE = 14;
const RECT_SLOTS = 32;
const RECT_END = RECT_BASE + RECT_STRIDE * RECT_SLOTS; // 0x39C — but cluster only goes to 0x2BC
const ENTITY_BASE = 0x3bc; // workRam offset
const ENTITY_END = 0x3dc;
const ROM_LOOKUP = 0x1f0e2;

const FIELD_NAMES = [
  "type",   // 0
  "sub",    // 1
  "xMin_hi","xMin_lo", // 2,3
  "yMin_hi","yMin_lo", // 4,5
  "zMin_hi","zMin_lo", // 6,7
  "xMax_hi","xMax_lo", // 8,9
  "yMax_hi","yMax_lo", // a,b
  "zMax_hi","zMax_lo", // c,d
];

function slotForOffset(off: number): { slot: number; field: number; fieldName: string } | null {
  if (off < RECT_BASE || off >= RECT_END) return null;
  const rel = off - RECT_BASE;
  const slot = Math.floor(rel / RECT_STRIDE);
  const field = rel % RECT_STRIDE;
  return { slot, field, fieldName: FIELD_NAMES[field] ?? `f${field}` };
}

// ─── Resolve entity byte → rectBufPtr (TS perspective) ───────────────────────

function s8(v: number): number {
  return v & 0x80 ? v - 0x100 : v;
}
function romR32(off: number): number {
  return (
    ((rom.program[off] ?? 0) << 24) |
    ((rom.program[off + 1] ?? 0) << 16) |
    ((rom.program[off + 2] ?? 0) << 8) |
    (rom.program[off + 3] ?? 0)
  ) >>> 0;
}

// Build entityIdx → slotOffset map for f+99
function buildEntitySlotMap(wr: Uint8Array): { entIdx: number; entByte: number; rectPtr: number; slotOff: number }[] {
  const out: { entIdx: number; entByte: number; rectPtr: number; slotOff: number }[] = [];
  for (let i = 0; i < ENTITY_END - ENTITY_BASE; i++) {
    const eb = wr[ENTITY_BASE + i]!;
    if (eb === 0xff) break;
    const d1 = s8(eb) << 2;
    const rectPtr = romR32(ROM_LOOKUP + d1) >>> 0;
    const slotOff = rectPtr - 0x400000;
    out.push({ entIdx: i, entByte: eb, rectPtr, slotOff });
  }
  return out;
}

// ─── First-diverge frame ─────────────────────────────────────────────────────

function firstDivergeFrame(off: number): number {
  for (let k = 1; k <= lastIdx; k++) {
    if (tsSnapshots[k]![off] !== mameSnaps[k]![off]) return k;
  }
  return -1;
}

// ─── Build divergent byte list in rect-list range ────────────────────────────

interface Row {
  off: number;
  slot: number;
  field: number;
  fieldName: string;
  tsVal: number;
  mameVal: number;
  firstDiverge: number;
}

const rows: Row[] = [];
for (let off = RECT_BASE; off < RECT_END; off++) {
  if (tsSnapshots[lastIdx]![off] !== mameSnaps[lastIdx]![off]) {
    const sf = slotForOffset(off)!;
    rows.push({
      off,
      slot: sf.slot,
      field: sf.field,
      fieldName: sf.fieldName,
      tsVal: tsSnapshots[lastIdx]![off]!,
      mameVal: mameSnaps[lastIdx]![off]!,
      firstDiverge: firstDivergeFrame(off),
    });
  }
}

console.log(`\n=== Rect-list cluster byte map @ f+${lastIdx} ===`);
console.log(`Total divergent bytes: ${rows.length}\n`);

// Per-byte table
console.log(`  off    | slot | field    | TS  MAME | first`);
console.log(`  -------+------+----------+----------+------`);
for (const r of rows) {
  console.log(
    `  0x${r.off.toString(16).padStart(4, "0")} | ${r.slot.toString().padStart(2)} | ${r.fieldName.padEnd(8)} | ${r.tsVal
      .toString(16).padStart(2, "0").toUpperCase()}  ${r.mameVal.toString(16).padStart(2, "0").toUpperCase()}   | f+${r.firstDiverge}`,
  );
}

// ─── Aggregate per slot ──────────────────────────────────────────────────────

const perSlot = new Map<number, Row[]>();
for (const r of rows) {
  if (!perSlot.has(r.slot)) perSlot.set(r.slot, []);
  perSlot.get(r.slot)!.push(r);
}

console.log(`\n=== Per-slot summary ===`);
const tsMapF0 = buildEntitySlotMap(tsSnapshots[lastIdx]!);
const mameMapF0 = buildEntitySlotMap(mameSnaps[lastIdx]!);
console.log(`Entity list @ f+99 (TS):  ${tsMapF0.map(e => `idx=${e.entIdx}→ent=0x${e.entByte.toString(16)}→slot=0x${e.slotOff.toString(16)}`).join(", ")}`);
console.log(`Entity list @ f+99 (MAME): ${mameMapF0.map(e => `idx=${e.entIdx}→ent=0x${e.entByte.toString(16)}→slot=0x${e.slotOff.toString(16)}`).join(", ")}`);

for (const [slot, items] of [...perSlot.entries()].sort((a, b) => a[0] - b[0])) {
  const slotOff = RECT_BASE + slot * RECT_STRIDE;
  console.log(`\nSlot ${slot} (workRam @ 0x${slotOff.toString(16)}) — ${items.length}B divergent:`);
  // Print TS slot contents and MAME slot contents
  let tsSlot = "  TS:   ";
  let mameSlot = "  MAME: ";
  for (let f = 0; f < RECT_STRIDE; f++) {
    const o = slotOff + f;
    tsSlot += `${tsSnapshots[lastIdx]![o]!.toString(16).padStart(2,'0')} `;
    mameSlot += `${mameSnaps[lastIdx]![o]!.toString(16).padStart(2,'0')} `;
  }
  console.log(tsSlot);
  console.log(mameSlot);
  // Which fields diverge
  console.log(`  fields: ${items.map(r => `${r.fieldName}(TS=${r.tsVal.toString(16)}/M=${r.mameVal.toString(16)},f+${r.firstDiverge})`).join(", ")}`);

  // Identify obj source for this slot: read typeCode (first byte of slot, MAME side)
  const typeCode = mameSnaps[lastIdx]![slotOff]!;
  const subIdx = mameSnaps[lastIdx]![slotOff + 1]!;
  console.log(`  typeCode=0x${typeCode.toString(16)} subIdx=0x${subIdx.toString(16)} — obj source: ${describeObjSource(typeCode, subIdx)}`);
}

function describeObjSource(typeCode: number, subIdx: number): string {
  switch (typeCode) {
    case 0: return "(zero sentinel)";
    case 1: return `ROM table 0x1eff6[${subIdx}] → obj struct (coords from A1[0xc/10/14])`;
    case 2: return `ROM table 0x1effe[${subIdx}] → obj struct`;
    case 4: return `ROM table 0x1f006[${subIdx}] → A2, then A1=A4[A2+0x58]`;
    case 0xe: return `ROM table 0x1f07a[${subIdx}] → A2, then A1=A4[A2+0x3a]`;
    case 0x29: return `workRam 0x401650 + ${subIdx}*16`;
    case 0x2a: return `workRam 0x40098c + ${subIdx}*12`;
    case 0x2c: return "(all zeros)";
    case 7: case 8: case 9: return `ROM table 0x1f096[${subIdx}] → sub via A1[0x1c]`;
    case 0xf: return `ROM table 0x1f0ba[${subIdx}] (flip branch)`;
    default: return `type=0x${typeCode.toString(16)} (default branch — table 0x1f016)`;
  }
}

// ─── Investigate: per slot 4 (idx=4 → ent=0x04 → rectPtr=0x214 = slot 4 if base 0x1dc + 4*14 = 0x214) ──

console.log(`\n=== Per-slot first-diverge timeline ===`);
for (const [slot, items] of [...perSlot.entries()].sort((a, b) => a[0] - b[0])) {
  const slotOff = RECT_BASE + slot * RECT_STRIDE;
  const earliestF = Math.min(...items.map(r => r.firstDiverge));
  console.log(`Slot ${slot} (0x${slotOff.toString(16)}): earliest divergence f+${earliestF}`);

  // Show typeCode/subIdx evolution over frames
  if (earliestF > 0 && earliestF <= 99) {
    const before = earliestF - 1;
    const tsType = tsSnapshots[before]?.[slotOff] ?? 0;
    const tsSub = tsSnapshots[before]?.[slotOff + 1] ?? 0;
    const mameType = mameSnaps[before]?.[slotOff] ?? 0;
    const mameSub = mameSnaps[before]?.[slotOff + 1] ?? 0;
    console.log(`  pre-diverge (f+${before}): type/sub TS=0x${tsType.toString(16)}/0x${tsSub.toString(16)} MAME=0x${mameType.toString(16)}/0x${mameSub.toString(16)}`);
    const tsType2 = tsSnapshots[earliestF]?.[slotOff] ?? 0;
    const tsSub2 = tsSnapshots[earliestF]?.[slotOff + 1] ?? 0;
    const mameType2 = mameSnaps[earliestF]?.[slotOff] ?? 0;
    const mameSub2 = mameSnaps[earliestF]?.[slotOff + 1] ?? 0;
    console.log(`  at-diverge   (f+${earliestF}): type/sub TS=0x${tsType2.toString(16)}/0x${tsSub2.toString(16)} MAME=0x${mameType2.toString(16)}/0x${mameSub2.toString(16)}`);
  }
}

// ─── For each divergent slot's obj source struct: check if THAT struct is bit-perfect ──

console.log(`\n=== Obj-source divergence check ===`);
console.log(`For each slot, identify the source struct address (from typeCode/subIdx) and check if it's bit-perfect at f+earliest-1.`);

function getObjSourcePtr(typeCode: number, subIdx: number): { addr: number; src: "ROM" | "workRam" | "indirect" | "none" } {
  switch (typeCode) {
    case 1: return { addr: romR32(0x1eff6 + ((subIdx & 0xff) << 2)) >>> 0, src: "indirect" };
    case 2: return { addr: romR32(0x1effe + ((subIdx & 0xff) << 2)) >>> 0, src: "indirect" };
    case 4: return { addr: romR32(0x1f006 + ((subIdx & 0xff) << 2)) >>> 0, src: "indirect" };
    case 0xe: return { addr: romR32(0x1f07a + ((subIdx & 0xff) << 2)) >>> 0, src: "indirect" };
    case 7: case 8: case 9: return { addr: romR32(0x1f096 + ((subIdx & 0xff) << 2)) >>> 0, src: "indirect" };
    case 0xf: return { addr: romR32(0x1f0ba + ((subIdx & 0xff) << 2)) >>> 0, src: "indirect" };
    case 0x29: return { addr: 0x401650 + (subIdx & 0xff) * 16, src: "workRam" };
    case 0x2a: return { addr: 0x40098c + (subIdx & 0xff) * 12, src: "workRam" };
    default: return { addr: 0, src: "none" };
  }
}

for (const [slot, items] of [...perSlot.entries()].sort((a, b) => a[0] - b[0])) {
  const slotOff = RECT_BASE + slot * RECT_STRIDE;
  const typeCode = mameSnaps[lastIdx]![slotOff]!;
  const subIdx = mameSnaps[lastIdx]![slotOff + 1]!;
  const earliestF = Math.min(...items.map(r => r.firstDiverge));
  if (earliestF < 1) continue;
  const beforeF = earliestF - 1;
  const beforeSnap = tsSnapshots[beforeF]!;
  const beforeMame = mameSnaps[beforeF]!;

  const src = getObjSourcePtr(typeCode, subIdx);
  if (src.src === "none") {
    console.log(`Slot ${slot}: type=0x${typeCode.toString(16)} — no obj source to check`);
    continue;
  }

  console.log(`Slot ${slot} (off 0x${slotOff.toString(16)}, type=0x${typeCode.toString(16)} sub=0x${subIdx.toString(16)}, first diverge f+${earliestF}):`);
  console.log(`  obj source addr = 0x${src.addr.toString(16)} (src=${src.src})`);

  // For ROM-indirect types (1,2,4,0xe,...), the A1 struct is in ROM but its coord fields could be in workRam if A1 points there.
  // Check coord bytes at A1+0xC..0x16 (10 bytes: x,y,z words).
  if (src.addr >= 0x400000 && src.addr < 0x402000) {
    const o = src.addr - 0x400000;
    let tsCoords = "";
    let mameCoords = "";
    for (let i = 0; i < 10; i++) {
      tsCoords += `${beforeSnap[o + 0xc + i]!.toString(16).padStart(2,'0')} `;
      mameCoords += `${beforeMame[o + 0xc + i]!.toString(16).padStart(2,'0')} `;
    }
    console.log(`  coords @ 0x${(o+0xc).toString(16)} (workRam, f+${beforeF}):`);
    console.log(`    TS:   ${tsCoords}`);
    console.log(`    MAME: ${mameCoords}`);
    console.log(`    diff: ${tsCoords === mameCoords ? "MATCH" : "DIFFER"}`);
  } else if (src.addr < 0x80000) {
    console.log(`  coords in ROM (constant) — should be identical`);
  } else {
    console.log(`  addr out of workRam range, src may be slapstic ROM`);
  }
}

// ─── Cluster summary by first-diverge frame ──────────────────────────────────

console.log(`\n=== Cluster summary by first-diverge frame ===`);
const byFrame = new Map<number, number>();
for (const r of rows) byFrame.set(r.firstDiverge, (byFrame.get(r.firstDiverge) ?? 0) + 1);
const fs = [...byFrame.keys()].sort((a, b) => a - b);
for (const f of fs) {
  console.log(`  f+${f}: ${byFrame.get(f)}B`);
}
