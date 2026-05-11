// Probe: dump STRUCT @ 0x401C28 from MAME snapshots f12000..12099.
// Output: 32-byte struct + tileX/tileY + obj0.x/y/z per ogni frame.
import { readFileSync } from "node:fs";

const groundTruth = JSON.parse(readFileSync("/tmp/mame_100f.json", "utf-8")) as {
  frames: number[];
  snapshots: { frame: number; workRam: string }[];
};

function hex2bytes(hex: string, len: number): Uint8Array {
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

function r16(wr: Uint8Array, off: number): number {
  return ((wr[off]! << 8) | wr[off + 1]!) & 0xffff;
}
function r32(wr: Uint8Array, off: number): number {
  return ((wr[off]! << 24) | (wr[off + 1]! << 16) | (wr[off + 2]! << 8) | wr[off + 3]!) >>> 0;
}

console.log("Frame | tileX  tileY  | STRUCT@0x1C28 (16 word) | obj0.z");
console.log("------+---------------+-------------------------+---------");
for (let i = 0; i < Math.min(20, groundTruth.snapshots.length); i++) {
  const snap = groundTruth.snapshots[i]!;
  const wr = hex2bytes(snap.workRam, 0x2000);
  const tileX = r16(wr, 0x696);
  const tileY = r16(wr, 0x698);
  const z = r32(wr, 0x2c);
  const words: string[] = [];
  for (let j = 0; j < 16; j++) {
    words.push(r16(wr, 0x1c28 + j * 2).toString(16).padStart(4, "0"));
  }
  console.log(`f=${snap.frame} | tx=${tileX.toString(16).padStart(4,"0")} ty=${tileY.toString(16).padStart(4,"0")} | ${words.join(" ")} | z=${z.toString(16).padStart(8,"0")}`);
}
