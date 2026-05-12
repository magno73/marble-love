// Dump entity types for entries 0..5 in workRam (via 0x1F0E2 ROM lookup).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { state as stateNs, bus as busNs, bootInit, tick, applySlapsticBank } from "@marble-love/engine";

const rom = busNs.emptyRomImage();
applySlapsticBank.loadRomBlob(rom, readFileSync(resolve("ghidra_project/marble_program.bin")));

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
  slapsticBank: 1,
};

const s = stateNs.emptyGameState();
bootInit(s, rom, { warmState: warm });

// Run 99 frames to f=99 state.
for (let i = 1; i <= 99; i++) {
  tick(s, { rom, runMainLoopBody: true, p1X: 0xff, p1Y: 0xff, p2X: 0xff, p2Y: 0xff });
}

const ROM_LOOKUP = 0x1f0e2;
const WRAM = 0x00400000;
function rl(addr: number): number {
  return (((rom.program[addr]! << 24) | (rom.program[addr + 1]! << 16) | (rom.program[addr + 2]! << 8) | rom.program[addr + 3]!) >>> 0);
}
function wb(addr: number): number {
  const off = (addr - WRAM) >>> 0;
  return (s.workRam[off] ?? 0) & 0xff;
}

console.log("ent | a1Ptr (workRam) | TS type@+0 | TS sub@+1 | inferred obj");
const entities = [0, 1, 2, 3, 4, 5];
for (const e of entities) {
  const a1Ptr = rl(ROM_LOOKUP + e * 4);
  const type = wb(a1Ptr);
  const subIdx = wb(a1Ptr + 1);
  // obj0..4 start at: 0x400018 + N*0xE2
  let inferred = "?";
  for (let n = 0; n <= 5; n++) {
    const objBase = 0x400018 + n * 0xe2;
    if (a1Ptr >= objBase && a1Ptr < objBase + 0xe2) {
      inferred = `obj${n}+0x${(a1Ptr - objBase).toString(16)}`;
      break;
    }
  }
  console.log(`  ${e} | ${a1Ptr.toString(16).padStart(8, "0")} | ${type.toString(16).padStart(2, "0")} (${type >= 0x80 ? type - 256 : type}) | ${subIdx.toString(16).padStart(2, "0")} | ${inferred}`);
}
