// Probe: check TS slapstic bank state during body execution
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { state as stateNs, bus as busNs, bootInit, tick } from "@marble-love/engine";
import { loadRomBlob } from "../../engine/src/m68k/apply-slapstic-bank.js";

const rom = busNs.emptyRomImage();
loadRomBlob(rom, readFileSync(resolve("ghidra_project/marble_program.bin")));

const gt = JSON.parse(readFileSync("/tmp/mame_100f.json", "utf-8")) as { snapshots: any[] };

function hex2bytes(hex: string, len: number): Uint8Array {
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

const frame0 = gt.snapshots[0]!;
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

console.log("After bootInit:");
console.log("  slapstic FSM bank:", rom.slapsticFsm.bank);
console.log("  rom.program[0x81008] = 0x" + ((rom.program[0x81008]! << 8) | rom.program[0x81009]!).toString(16));

// Run 5 ticks
for (let i = 1; i <= 5; i++) {
  tick(s, { rom, runMainLoopBody: true, p1X: 0xff, p1Y: 0xff, p2X: 0xff, p2Y: 0xff });
  console.log(`After tick ${i}: bank=${rom.slapsticFsm.bank} program[0x81008]=0x${((rom.program[0x81008]! << 8) | rom.program[0x81009]!).toString(16)}`);
}
