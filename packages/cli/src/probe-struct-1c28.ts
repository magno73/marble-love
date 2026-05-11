// Probe: compare TS STRUCT @ 0x1c28..0x1c47 vs MAME ground truth at each frame.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { state as stateNs, bus as busNs, bootInit, tick } from "@marble-love/engine";

const rom = busNs.emptyRomImage();
rom.program.set(readFileSync(resolve("ghidra_project/marble_program.bin")).subarray(0, rom.program.length));

const groundTruth = JSON.parse(readFileSync("/tmp/mame_100f.json", "utf-8")) as {
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

function hexBytes(buf: Uint8Array, off: number, len: number): string {
  const parts: string[] = [];
  for (let i = 0; i < len; i++) parts.push(buf[off + i]!.toString(16).padStart(2, "0"));
  return parts.join("");
}

console.log("frame  TS_struct@0x1c28                                                 MAME_struct@0x1c28                                                match");
for (let i = 1; i < groundTruth.snapshots.length; i++) {
  tick(s, { rom, runMainLoopBody: true, p1X: 0xff, p1Y: 0xff, p2X: 0xff, p2Y: 0xff });
  if (i <= 5 || i % 25 === 0 || i === 99) {
    const tsHex = hexBytes(s.workRam, 0x1c28, 32);
    const mameHex = hexBytes(hex2bytes(groundTruth.snapshots[i]!.workRam, 0x2000), 0x1c28, 32);
    console.log(`f+${i.toString().padStart(3)}  ${tsHex}  ${mameHex}  ${tsHex === mameHex ? "OK" : "DIFF"}`);
  }
}
