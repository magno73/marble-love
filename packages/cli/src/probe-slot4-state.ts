// Quick probe: dump slot4 array (4 slot × 0x60 byte) at warm state.
// Reports state-relevant fields for each slot.
import { readFileSync } from "node:fs";

const groundTruth = JSON.parse(readFileSync("/tmp/mame_100f.json", "utf-8")) as {
  snapshots: { frame: number; workRam: string }[];
};

function hex2bytes(hex: string, len: number): Uint8Array {
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

const FRAMES = [0, 1, 2, 3, 4, 5, 10, 20, 50, 99];
const SLOT_BASE = 0x1302;
const SLOT_STRIDE = 0x60;

console.log("# Slot4 array per-frame state dump (MAME)\n");

for (const f of FRAMES) {
  const snap = groundTruth.snapshots[f];
  if (!snap) continue;
  const wram = hex2bytes(snap.workRam, 0x2000);
  console.log(`f=${f}:`);
  for (let i = 0; i < 4; i++) {
    const b = SLOT_BASE + i * SLOT_STRIDE;
    const armed = wram[b + 0x18]!;
    const state = wram[b + 0x1a]!;
    const subst = wram[b + 0x1b]!;
    const ticker = wram[b + 0x24]!;
    const limit = wram[b + 0x25]!;
    const step = wram[b + 0x26]!;
    const substep = wram[b + 0x27]!;
    const pc58 = ((wram[b + 0x58]! << 24) | (wram[b + 0x59]! << 16) | (wram[b + 0x5a]! << 8) | wram[b + 0x5b]!) >>> 0;
    const base5c = ((wram[b + 0x5c]! << 24) | (wram[b + 0x5d]! << 16) | (wram[b + 0x5e]! << 8) | wram[b + 0x5f]!) >>> 0;
    console.log(`  slot${i} @${b.toString(16).padStart(4, "0")}: armed=${armed} state=${state.toString(16)} subst=${subst.toString(16)} | ticker=${ticker.toString(16).padStart(2,"0")} limit=${limit.toString(16).padStart(2,"0")} step=${step.toString(16).padStart(2,"0")} substep=${substep.toString(16).padStart(2,"0")} | pc58=${pc58.toString(16).padStart(8,"0")} base5c=${base5c.toString(16).padStart(8,"0")}`);
  }
}
