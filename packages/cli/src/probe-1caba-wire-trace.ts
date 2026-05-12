// Probe: trace sub1CABA invocations during 99-frame run with wire enabled
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

// Save original struct
function hex(buf: Uint8Array, off: number, len: number): string {
  const parts: string[] = [];
  for (let i = 0; i < len; i++) parts.push(buf[off + i]!.toString(16).padStart(2, "0"));
  return parts.join("");
}

// Run 5 frames and inspect STRUCT after each
for (let i = 1; i <= 5; i++) {
  const preStruct = hex(s.workRam, 0x1c28, 32);
  const preBank = rom.slapsticFsm.bank;
  const preSlapsticByte0 = rom.program[0x81008]!;
  const preSlapsticByte1 = rom.program[0x81009]!;

  tick(s, { rom, runMainLoopBody: true, p1X: 0xff, p1Y: 0xff, p2X: 0xff, p2Y: 0xff });

  const postStruct = hex(s.workRam, 0x1c28, 32);
  const postBank = rom.slapsticFsm.bank;

  // Compare with MAME
  const mameStruct = hex(hex2bytes(gt.snapshots[i].workRam, 0x2000), 0x1c28, 32);

  console.log(`f+${i}: bank ${preBank}→${postBank} | preSlap[0x81008]=0x${(preSlapsticByte0<<8|preSlapsticByte1).toString(16)}`);
  console.log(`     TS struct pre  = ${preStruct}`);
  console.log(`     TS struct post = ${postStruct}`);
  console.log(`     MAME struct    = ${mameStruct}`);
  console.log(`     match: ${postStruct === mameStruct ? "OK" : "DIFF"}`);
}
