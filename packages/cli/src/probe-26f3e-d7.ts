// Probe: confronta entity list @ 0x4003BC..0x4003DC e D7 (CNT_ADDR @ 0x406)
// TS vs MAME per indagine lateGameLogic26F3E.
// Output: for each key frame, dump entity bytes + D7 + cursor pointers.
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

const FRAMES = [0, 1, 2, 50, 99];
const ENTITY_BASE = 0x3bc;
const ENTITY_END = 0x3dc;
const CUR_A3 = 0x3f6;
const CUR_A1 = 0x3fa;
const CUR_A2 = 0x3fe;
const CUR_A4 = 0x402;
const CNT = 0x406;

function rl(b: Uint8Array, off: number): number {
  return (((b[off]! << 24) | (b[off + 1]! << 16) | (b[off + 2]! << 8) | b[off + 3]!) >>> 0);
}
function rw(b: Uint8Array, off: number): number {
  return ((b[off]! << 8) | b[off + 1]!) & 0xffff;
}
function ebytes(b: Uint8Array, base: number, end: number): string {
  const out: string[] = [];
  for (let i = base; i < end; i++) out.push(b[i]!.toString(16).padStart(2, "0"));
  return out.join(" ");
}

console.log("frame | entity-list                                                        | D7  cA3      cA1      cA2      cA4");

// Run TS frame by frame.
for (let stopAt = 0; stopAt <= 99; stopAt++) {
  if (stopAt > 0) {
    tick(s, { rom, runMainLoopBody: true, p1X: 0xff, p1Y: 0xff, p2X: 0xff, p2Y: 0xff });
  }
  if (!FRAMES.includes(stopAt)) continue;
  const tsW = s.workRam;
  const mameW = hex2bytes(groundTruth.snapshots[stopAt]!.workRam, 0x2000);
  console.log(`\n=== f=${stopAt} ===`);
  console.log(`TS  entities: ${ebytes(tsW, ENTITY_BASE, ENTITY_END)} | D7=${rw(tsW, CNT).toString(16).padStart(4, "0")} cA3=${rl(tsW, CUR_A3).toString(16).padStart(8, "0")} cA1=${rl(tsW, CUR_A1).toString(16).padStart(8, "0")} cA2=${rl(tsW, CUR_A2).toString(16).padStart(8, "0")} cA4=${rl(tsW, CUR_A4).toString(16).padStart(8, "0")}`);
  console.log(`MAME entit:  ${ebytes(mameW, ENTITY_BASE, ENTITY_END)} | D7=${rw(mameW, CNT).toString(16).padStart(4, "0")} cA3=${rl(mameW, CUR_A3).toString(16).padStart(8, "0")} cA1=${rl(mameW, CUR_A1).toString(16).padStart(8, "0")} cA2=${rl(mameW, CUR_A2).toString(16).padStart(8, "0")} cA4=${rl(mameW, CUR_A4).toString(16).padStart(8, "0")}`);
}
