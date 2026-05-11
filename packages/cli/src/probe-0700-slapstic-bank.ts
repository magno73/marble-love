// probe-0700-slapstic-bank.ts — verifica stato slapstic bank durante TS body f12002

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { state as stateNs, bus as busNs, bootInit, tick, applySlapsticBank as applyNs } from "@marble-love/engine";

const rom = busNs.emptyRomImage();
const rawRom = readFileSync(resolve("ghidra_project/marble_program.bin"));
rom.program.set(rawRom.subarray(0, rom.program.length));

// FIX: popola slapsticBanks dal raw blob (probe-only path).
rom.slapsticBanks.set(rawRom.subarray(0x80000, 0x88000));

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

console.log(`Post bootInit: bank=${rom.slapsticFsm.bank} state=${rom.slapsticFsm.state}`);
console.log(`rom.program[0x80650..]: ${Array.from(rom.program.subarray(0x80650, 0x8065c)).map(b => b.toString(16).padStart(2,"0")).join("")}`);

// Force apply bank to refresh program[] from slapsticBanks (since we populated raw).
applyNs.applySlapsticBank(rom, rom.slapsticFsm.bank);
console.log(`After applySlapsticBank(${rom.slapsticFsm.bank}): rom.program[0x80650..]: ${Array.from(rom.program.subarray(0x80650, 0x8065c)).map(b => b.toString(16).padStart(2,"0")).join("")}`);

console.log("\nMAME bank @ first body = 2  (byte expected: 57 47 88 25 93 8d 04 92 e9 ca e4 8d)");

// Run 5 tick monitoring bank
for (let i = 1; i <= 5; i++) {
  tick(s, { rom, runMainLoopBody: true, p1X: 0xff, p1Y: 0xff, p2X: 0xff, p2Y: 0xff });
  const slice = Array.from(rom.program.subarray(0x80650, 0x8065c)).map(b => b.toString(16).padStart(2,"0")).join("");
  console.log(`After tick ${i}: bank=${rom.slapsticFsm.bank} state=${rom.slapsticFsm.state} rom[0x80650..]=${slice}`);
}
