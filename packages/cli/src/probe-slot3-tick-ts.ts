// Dump TS slot3.+0x24 (ticker) frame-by-frame to compare with MAME oracle.
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

const SLOT3 = 0x1422;
const F = [0, 1, 2, 3, 4, 5, 6, 8, 10, 20];
console.log("f | TS slot1.tick slot2.tick slot3.tick | TS pc58 1/2/3 | MAME slot1/2/3 tick");
for (const stopAt of F) {
  // re-init for each stop point
  const s2 = stateNs.emptyGameState();
  bootInit(s2, rom, { warmState: warm });
  for (let i = 1; i <= stopAt; i++) {
    tick(s2, { rom, runMainLoopBody: true, p1X: 0xff, p1Y: 0xff, p2X: 0xff, p2Y: 0xff });
  }
  const t1 = s2.workRam[0x1362 + 0x24]!;
  const t2 = s2.workRam[0x13c2 + 0x24]!;
  const t3 = s2.workRam[SLOT3 + 0x24]!;
  const pc1 = ((s2.workRam[0x1362 + 0x58]! << 24) | (s2.workRam[0x1362 + 0x59]! << 16) | (s2.workRam[0x1362 + 0x5a]! << 8) | s2.workRam[0x1362 + 0x5b]!) >>> 0;
  const pc3 = ((s2.workRam[SLOT3 + 0x58]! << 24) | (s2.workRam[SLOT3 + 0x59]! << 16) | (s2.workRam[SLOT3 + 0x5a]! << 8) | s2.workRam[SLOT3 + 0x5b]!) >>> 0;
  const m = hex2bytes(groundTruth.snapshots[stopAt]!.workRam, 0x2000);
  const mt1 = m[0x1362 + 0x24]!;
  const mt2 = m[0x13c2 + 0x24]!;
  const mt3 = m[SLOT3 + 0x24]!;
  console.log(`f=${stopAt.toString().padStart(2)} | TS=${t1.toString(16)}/${t2.toString(16)}/${t3.toString(16)} | pc1=${pc1.toString(16)} pc3=${pc3.toString(16)} | MAME=${mt1.toString(16)}/${mt2.toString(16)}/${mt3.toString(16)}`);
}
