// Quick probe: compare obj0.z TS vs MAME across 99 frames.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { state as stateNs, bus as busNs, bootInit, tick } from "@marble-love/engine";

const rom = busNs.emptyRomImage();
rom.program.set(readFileSync(resolve("ghidra_project/marble_program.bin")).subarray(0, rom.program.length));

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
};

const s = stateNs.emptyGameState();
bootInit(s, rom, { warmState: warm });

// obj0 is at workRam offset 0x18; obj.z = struct+0x14 → workRam offset 0x2c.
function readZ(wr: Uint8Array): number {
  return ((wr[0x2c]! << 24) | (wr[0x2d]! << 16) | (wr[0x2e]! << 8) | wr[0x2f]!) >>> 0;
}

console.log("Frame | obj0.z TS    | obj0.z MAME  | diff?");
for (let i = 1; i < groundTruth.snapshots.length; i++) {
  tick(s, { rom, runMainLoopBody: true, p1X: 0xff, p1Y: 0xff, p2X: 0xff, p2Y: 0xff });
  const mame = hex2bytes(groundTruth.snapshots[i]!.workRam, 0x2000);
  const tsZ = readZ(s.workRam);
  const mameZ = readZ(mame);
  if (i <= 5 || i % 10 === 0 || i === groundTruth.snapshots.length - 1) {
    console.log(`f+${i.toString().padStart(3)} | TS=${tsZ.toString(16).padStart(8,"0")} | MAME=${mameZ.toString(16).padStart(8,"0")} | ${tsZ===mameZ?"✓":"✗ "}`);
  }
}
