// probe-0700-divergence-f58.ts — compare state TS vs MAME at f+57 (pre) and f+58 (explosion)
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { state as stateNs, bus as busNs, bootInit, tick, applySlapsticBank } from "@marble-love/engine";

const rom = busNs.emptyRomImage();
applySlapsticBank.loadRomBlob(rom, readFileSync(resolve("ghidra_project/marble_program.bin")));

const gt = JSON.parse(readFileSync("/tmp/mame_100f.json", "utf-8")) as any;
function hex2bytes(hex: string, len: number): Uint8Array {
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}
const f0 = gt.snapshots[0];
const warm = {
  workRam: hex2bytes(f0.workRam, 0x2000),
  playfieldRam: hex2bytes(f0.playfieldRam, 0x2000),
  spriteRam: hex2bytes(f0.spriteRam, 0x1000),
  alphaRam: hex2bytes(f0.alphaRam, 0x1000),
  colorRam: hex2bytes(f0.colorRam, 0x800),
  videoScrollX: 0,
  videoScrollY: 0,
  slapsticBank: 1,
};
const s = stateNs.emptyGameState();
bootInit(s, rom, { warmState: warm });

function getU16(arr: Uint8Array, off: number) {
  return ((arr[off]! << 8) | arr[off + 1]!) & 0xffff;
}
function getU32(arr: Uint8Array, off: number) {
  return (((arr[off]! << 24) >>> 0) + ((arr[off + 1]! << 16) >>> 0) + ((arr[off + 2]! << 8) >>> 0) + arr[off + 3]!) >>> 0;
}

// Track these state fields that affect decoder:
//  *0x400006 (byte) — active flag
//  *0x400474 (long) — lvl ptr
//  *0x400664 (word) — lvl ctr
//  *0x400662 (word) — slap idx
//  *0x40097c (long) — srtgt
//  *0x400706..0x40074F (decoder output buffer)
//  *0x400978 (long) — decNext

console.log("frame | active | lvlCtr | slapIdx | lvlPtr     | srtgt      | decNext    | diff_0x0700 | hash");
for (let i = 1; i <= 70; i++) {
  tick(s, { rom, runMainLoopBody: true, p1X: 0xff, p1Y: 0xff, p2X: 0xff, p2Y: 0xff });
  const mame = hex2bytes(gt.snapshots[i].workRam, 0x2000);
  let diffCount = 0;
  for (let o = 0x700; o < 0x780; o++) if (s.workRam[o] !== mame[o]) diffCount++;
  if (i >= 55 && i <= 65 || i === 1 || i === 2) {
    const ts = s.workRam;
    console.log(`TS f+${i.toString().padStart(2)} | ${ts[6]}      | 0x${getU16(ts, 0x664).toString(16).padStart(4, "0")} | 0x${getU16(ts, 0x662).toString(16).padStart(4, "0")}  | 0x${getU32(ts, 0x474).toString(16).padStart(8, "0")} | 0x${getU32(ts, 0x97c).toString(16).padStart(8, "0")} | 0x${getU32(ts, 0x978).toString(16).padStart(8, "0")} | ${diffCount}`);
    console.log(`MA f+${i.toString().padStart(2)} | ${mame[6]}      | 0x${getU16(mame, 0x664).toString(16).padStart(4, "0")} | 0x${getU16(mame, 0x662).toString(16).padStart(4, "0")}  | 0x${getU32(mame, 0x474).toString(16).padStart(8, "0")} | 0x${getU32(mame, 0x97c).toString(16).padStart(8, "0")} | 0x${getU32(mame, 0x978).toString(16).padStart(8, "0")} |`);
  }
}
