// Differential test: TS tick 0..99 starting from MAME warmstate f12000,
// vs MAME ground truth f12001..f12099. Reports per-frame byte diff stats.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { state as stateNs, bus as busNs, bootInit, tick, applySlapsticBank as apply } from "@marble-love/engine";

const rom = busNs.emptyRomImage();
apply.loadRomBlob(rom, readFileSync(resolve("ghidra_project/marble_program.bin")));

const groundTruth = JSON.parse(readFileSync("/tmp/mame_100f.json", "utf-8")) as {
  frames: number[];
  snapshots: { frame: number; workRam: string; spriteRam: string }[];
};

function hex2bytes(hex: string, len: number): Uint8Array {
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

const frame0 = groundTruth.snapshots[0]!;
const warm = {
  workRam: hex2bytes(frame0.workRam, 0x2000),
  playfieldRam: hex2bytes((groundTruth.snapshots[0]! as unknown as { playfieldRam: string }).playfieldRam, 0x2000),
  spriteRam: hex2bytes(frame0.spriteRam, 0x1000),
  alphaRam: hex2bytes((groundTruth.snapshots[0]! as unknown as { alphaRam: string }).alphaRam, 0x1000),
  colorRam: hex2bytes((groundTruth.snapshots[0]! as unknown as { colorRam: string }).colorRam, 0x800),
  videoScrollX: 0,
  videoScrollY: 0,
  // Slapstic chip 103: at MAME f=12000 attract, active bank is 1 (verified
  // through `oracle/mame_slapstic_tap.lua` plus data-match analysis).
  slapsticBank: 1,
};

const s = stateNs.emptyGameState();
bootInit(s, rom, { warmState: warm });
console.log("Post-bootInit obj0.vx:", (((s.workRam[0x18]!<<24)|(s.workRam[0x19]!<<16)|(s.workRam[0x1a]!<<8)|s.workRam[0x1b]!)>>>0).toString(16));
console.log("Post-bootInit obj0.x:", (((s.workRam[0x24]!<<24)|(s.workRam[0x25]!<<16)|(s.workRam[0x26]!<<8)|s.workRam[0x27]!)>>>0).toString(16));
console.log("Post-bootInit obj0.s18:", s.workRam[0x30]);
console.log("Post-bootInit count:", ((s.workRam[0x396]!<<8)|s.workRam[0x397]!).toString(16));

function diffBytes(a: Uint8Array, b: Uint8Array): number {
  let d = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) d++;
  return d;
}

console.log("Frame | workRam diff | spriteRam diff | obj0.x        | obj0.x MAME");
console.log("------+--------------+----------------+---------------+-------------");
for (let i = 1; i < groundTruth.snapshots.length; i++) {
  tick(s, { rom, runMainLoopBody: true, p1X: 0xff, p1Y: 0xff, p2X: 0xff, p2Y: 0xff });

  const mame = groundTruth.snapshots[i]!;
  const mameW = hex2bytes(mame.workRam, 0x2000);
  const mameS = hex2bytes(mame.spriteRam, 0x1000);

  const wDiff = diffBytes(s.workRam, mameW);
  const sDiff = diffBytes(s.spriteRam, mameS);

  const tsX = ((s.workRam[0x24]! << 24) | (s.workRam[0x25]! << 16) | (s.workRam[0x26]! << 8) | s.workRam[0x27]!) >>> 0;
  const tsVx = ((s.workRam[0x18]! << 24) | (s.workRam[0x19]! << 16) | (s.workRam[0x1a]! << 8) | s.workRam[0x1b]!) >>> 0;
  const tsS18 = s.workRam[0x30] ?? 0;
  const tsCount = ((s.workRam[0x396]! << 8) | s.workRam[0x397]!) & 0xffff;
  const mameX = ((mameW[0x24]! << 24) | (mameW[0x25]! << 16) | (mameW[0x26]! << 8) | mameW[0x27]!) >>> 0;

  if (i <= 5 || i % 10 === 0 || i === groundTruth.snapshots.length - 1) {
    console.log(
      `f+${i.toString().padStart(3)} | wDiff=${wDiff.toString().padStart(4)} sDiff=${sDiff.toString().padStart(4)} | obj0.x TS=${tsX.toString(16).padStart(8, "0")} MAME=${mameX.toString(16).padStart(8, "0")} ${tsX === mameX ? "✓" : "✗"} | vx=${tsVx.toString(16).padStart(8, "0")} s18=${tsS18} count=${tsCount}`
    );
  }
}
