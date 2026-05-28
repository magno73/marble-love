// probe-0700-decoder-args.ts — log srtgt, lvlPtr, scrollIdx, ctrlStream,
// extStream before each decodeBitstream1A668 call in the first 5 ticks.
//
// Output console + /tmp/ts_0700_decoder_args.json.
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { state as stateNs, bus as busNs, bootInit, tick } from "@marble-love/engine";

const rom = busNs.emptyRomImage();
rom.program.set(readFileSync(resolve("ghidra_project/marble_program.bin")).subarray(0, rom.program.length));

const groundTruth = JSON.parse(readFileSync("/tmp/mame_100f.json", "utf-8")) as {
  frames: number[];
  snapshots: { frame: number; workRam: string }[];
};

function hex2bytes(hex: string, len: number): Uint8Array {
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

const frame0 = groundTruth.snapshots[0]!;
const warm = {
  workRam: hex2bytes(frame0.workRam, 0x2000),
  playfieldRam: hex2bytes(frame0.workRam, 0x2000), // dummy
  spriteRam: new Uint8Array(0x1000),
  alphaRam: new Uint8Array(0x1000),
  colorRam: new Uint8Array(0x800),
  videoScrollX: 0,
  videoScrollY: 0,
};

const s = stateNs.emptyGameState();
bootInit(s, rom, { warmState: warm });

// Read key vars from workRam.
function rl(off: number): number {
  const w = s.workRam;
  return ((w[off]! << 24) | (w[off+1]! << 16) | (w[off+2]! << 8) | w[off+3]!) >>> 0;
}
function rw(off: number): number {
  const w = s.workRam;
  return ((w[off]! << 8) | w[off+1]!) & 0xffff;
}
function rb(off: number): number { return s.workRam[off]!; }

// Snapshot key vars per tick.
const snaps: unknown[] = [];
function snap(label: string): void {
  const obj = {
    label,
    "*0x400006(active)": "0x" + rb(0x006).toString(16),
    "*0x400474(lvlPtr)": "0x" + rl(0x474).toString(16),
    "*0x40097c(srtgt)":  "0x" + rl(0x97c).toString(16),
    "*0x400978(decNext)":"0x" + rl(0x978).toString(16),
    "*0x400664(lvlCtr)": "0x" + rw(0x664).toString(16),
    "*0x400004(dir)":    "0x" + rb(0x004).toString(16),
    "*0x400974(slot)":   "0x" + rl(0x974).toString(16),
    "decBufAtBeg":       Array.from(s.workRam.subarray(0x706, 0x70e)).map(b => b.toString(16).padStart(2, "0")).join(""),
  };
  snaps.push(obj);
  console.log(label);
  for (const [k, v] of Object.entries(obj)) {
    if (k === "label") continue;
    console.log(`  ${k}: ${v}`);
  }
}

snap("tick 0 (warm = f12000)");
for (let i = 1; i <= 5; i++) {
  tick(s, { rom, runMainLoopBody: true, p1X: 0xff, p1Y: 0xff, p2X: 0xff, p2Y: 0xff });
  snap(`after tick ${i} (= f${12000 + i})`);
}

writeFileSync("/tmp/ts_0700_decoder_args.json", JSON.stringify(snaps, null, 2));
console.log("\nOutput: /tmp/ts_0700_decoder_args.json");

// Also show MAME values for the same workRam offsets at f12000..f12005.
console.log("\n--- MAME ground truth (same offsets) ---");
for (let i = 0; i < 6; i++) {
  const wr = groundTruth.snapshots[i]!.workRam;
  function _rl(off: number): number {
    const idx = off * 2;
    return parseInt(wr.substr(idx, 8), 16);
  }
  function _rb(off: number): number {
    const idx = off * 2;
    return parseInt(wr.substr(idx, 2), 16);
  }
  console.log(`MAME f${12000 + i}: active=0x${_rb(0x006).toString(16)} lvlPtr=0x${_rl(0x474).toString(16)} srtgt=0x${_rl(0x97c).toString(16)} decNext=0x${_rl(0x978).toString(16)} dir=0x${_rb(0x004).toString(16)} slot=0x${_rl(0x974).toString(16)}`);
}
