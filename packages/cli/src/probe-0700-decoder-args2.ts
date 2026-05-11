// Manually reproduce refreshHelper logic to see what args TS computes for the
// decoder at tick 2 (body f12002).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { state as stateNs, bus as busNs, bootInit, tick } from "@marble-love/engine";

const rom = busNs.emptyRomImage();
rom.program.set(readFileSync(resolve("ghidra_project/marble_program.bin")).subarray(0, rom.program.length));

const groundTruth = JSON.parse(readFileSync("/tmp/mame_100f.json", "utf-8")) as {
  snapshots: { workRam: string; playfieldRam: string; spriteRam: string; alphaRam: string; colorRam: string }[];
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

function readByteAt(abs: number): number {
  if (abs < 0x88000) return rom.program[abs] ?? 0;
  if (abs >= 0x400000 && abs < 0x402000) return s.workRam[abs - 0x400000] ?? 0;
  return 0;
}
function readW(abs: number): number {
  return ((readByteAt(abs) << 8) | readByteAt(abs + 1)) & 0xffff;
}
function readL(abs: number): number {
  return ((readByteAt(abs) << 24) | (readByteAt(abs+1) << 16) | (readByteAt(abs+2) << 8) | readByteAt(abs+3)) >>> 0;
}
function sx16(v: number): number { v &= 0xffff; return v >= 0x8000 ? v - 0x10000 : v; }
function sx32(v: number): number { v = v >>> 0; return v >= 0x80000000 ? v - 0x100000000 : v; }

function simulateRefreshHelperArgs(): { srtgt: number; lvlPtr: number; xbase: number; scrollIdxRaw: number; scrollIdxAfterAdd: number; tileTablePtr: number; tileWordAddr: number; tileWord: number; ctrlStream: number; extTablePtr: number; extByteOff: number; extByte: number; extStream: number; outBufAbs: number; active: number; dir: number } {
  const srtgt = readL(0x40097c);
  const lvlPtr = readL(0x400474);
  const xbase = sx16(readW(lvlPtr + 0x10));
  let scrollIdx = ((sx32(srtgt) - xbase) >> 3) & 0x7fff;
  scrollIdx = (scrollIdx - 1) & 0xffff;
  const scrollIdxRaw = scrollIdx;
  const dir = readByteAt(0x400004);
  if (dir === 1) scrollIdx = (scrollIdx + 0x20) & 0xffff;
  const scrollIdxAfterAdd = scrollIdx;
  const tileTablePtr = readL(lvlPtr + 0x04);
  const tileWordAddr = (tileTablePtr + sx16(scrollIdx) * 2) >>> 0;
  const tileWord = readW(tileWordAddr);
  const ctrlStream = ((sx16(tileWord) + 0x800e4) >>> 0);
  const extTablePtr = readL(lvlPtr + 0x2a);
  const extByteOff = (extTablePtr + sx16(scrollIdx)) >>> 0;
  const extByte = readByteAt(extByteOff);
  const extStream = (extByte + 0x2be18) >>> 0;
  const outBufAbs = 0x400706;
  const active = readByteAt(0x400006);
  return { srtgt, lvlPtr, xbase, scrollIdxRaw, scrollIdxAfterAdd, tileTablePtr, tileWordAddr, tileWord, ctrlStream, extTablePtr, extByteOff, extByte, extStream, outBufAbs, active, dir };
}

console.log("=== Pre-tick (= warm f12000) ===");
console.log(simulateRefreshHelperArgs());

for (let i = 1; i <= 3; i++) {
  tick(s, { rom, runMainLoopBody: true, p1X: 0xff, p1Y: 0xff, p2X: 0xff, p2Y: 0xff });
  console.log(`\n=== After tick ${i} (= post-body f${12000 + i}) ===`);
  const args = simulateRefreshHelperArgs();
  console.log(args);
  // Show ctrl stream first 16 bytes
  const bytes: string[] = [];
  for (let k = 0; k < 16; k++) bytes.push(readByteAt((args.ctrlStream + k) >>> 0).toString(16).padStart(2, "0"));
  console.log("  ctrl[0:16] =", bytes.join(""));
}
