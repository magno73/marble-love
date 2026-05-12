// Reproduce first iter of sub-1CABA with attract call #0 inputs to identify divergence
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { state as stateNs, bus as busNs } from "@marble-love/engine";
import { applySlapsticBank, loadRomBlob } from "../../engine/src/m68k/apply-slapstic-bank.js";

const trace = JSON.parse(readFileSync("/tmp/mame_1caba_attract_count.json", "utf-8")) as {
  entries_full: { tileX: string; tileY: string; lvlPtr: string; bsearchPtr: string; struct_pre: string; colBase: string; bsearchAlt: string }[];
};
const idx = process.env.CALL_IDX !== undefined ? parseInt(process.env.CALL_IDX, 10) : 0;
const c = trace.entries_full[idx]!;
console.log("=== CALL idx=" + idx + " (frame " + (c as any).frame + ") ===");

function hex2bytes(hex: string, len: number): Uint8Array {
  const out = new Uint8Array(len);
  for (let i = 0; i < len && i * 2 + 1 < hex.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

const gt = JSON.parse(readFileSync("/tmp/mame_100f.json", "utf-8")) as { snapshots: { workRam: string; playfieldRam: string; spriteRam: string }[] };
const frame0 = gt.snapshots[0]!;
const stateInst = stateNs.emptyGameState();
stateInst.workRam.set(hex2bytes(frame0.workRam, 0x2000));
stateInst.playfieldRam.set(hex2bytes(frame0.playfieldRam, 0x2000));
stateInst.spriteRam.set(hex2bytes(frame0.spriteRam, 0x1000));

const rom = busNs.emptyRomImage();
loadRomBlob(rom, readFileSync(resolve("ghidra_project/marble_program.bin")));
const bank = process.env.SLAPSTIC_BANK !== undefined ? parseInt(process.env.SLAPSTIC_BANK, 10) : 3;
applySlapsticBank(rom, bank);
console.log("Using slapstic bank:", bank);

const tileX = parseInt(c.tileX, 16) & 0xffff;
const tileY = parseInt(c.tileY, 16) & 0xffff;
const lvlPtr = parseInt(c.lvlPtr, 16) >>> 0;
const bsearchPtr = parseInt(c.bsearchPtr, 16) >>> 0;

function w32(buf: Uint8Array, off: number, v: number): void { buf[off]=(v>>>24)&0xff; buf[off+1]=(v>>>16)&0xff; buf[off+2]=(v>>>8)&0xff; buf[off+3]=v&0xff; }
function w16(buf: Uint8Array, off: number, v: number): void { buf[off]=(v>>>8)&0xff; buf[off+1]=v&0xff; }

w16(stateInst.workRam, 0x696, tileX);
w16(stateInst.workRam, 0x698, tileY);
w32(stateInst.workRam, 0x474, lvlPtr);
w32(stateInst.workRam, 0x65a, bsearchPtr);
stateInst.workRam.set(hex2bytes(c.struct_pre, 32), 0x1c28);
stateInst.workRam.set(hex2bytes(c.colBase, 0x200), 0x478);
stateInst.workRam.set(hex2bytes(c.bsearchAlt, 0x200), 0x76e);

// Now manually replicate prologue + iter0 to find divergence point
function r16(off: number): number { return (((stateInst.workRam[off] ?? 0) << 8) | (stateInst.workRam[off + 1] ?? 0)) & 0xffff; }
function r32(off: number): number { return (((stateInst.workRam[off]??0)<<24)|((stateInst.workRam[off+1]??0)<<16)|((stateInst.workRam[off+2]??0)<<8)|(stateInst.workRam[off+3]??0))>>>0; }
function romW(addr: number): number { return (((rom.program[addr]??0)<<8) | (rom.program[addr+1]??0)) & 0xffff; }
function romB(addr: number): number { return (rom.program[addr]??0) & 0xff; }
function s16(v: number): number { const u = v&0xffff; return u&0x8000 ? u-0x10000 : u; }
function asrW(v:number, n:number): number { return (s16(v) >> n) & 0xffff; }

const PF = 0xa00000;
function readWordAbs(a: number): number {
  const u = a >>> 0;
  if (u < 0x88000) return romW(u);
  if (u >= 0x400000 && u < 0x402000) return r16(u - 0x400000);
  if (u >= PF && u < PF + 0x2000) { const o = u - PF; return (((stateInst.playfieldRam[o]??0)<<8)|(stateInst.playfieldRam[o+1]??0)) & 0xffff; }
  return 0;
}
function readLongAbs(a: number): number {
  const u = a >>> 0;
  if (u < 0x88000) return ((romB(u)<<24)|(romB(u+1)<<16)|(romB(u+2)<<8)|romB(u+3))>>>0;
  if (u >= 0x400000 && u < 0x402000) return r32(u - 0x400000);
  if (u >= PF && u < PF + 0x2000) { const o = u - PF; return (((stateInst.playfieldRam[o]??0)<<24)|((stateInst.playfieldRam[o+1]??0)<<16)|((stateInst.playfieldRam[o+2]??0)<<8)|(stateInst.playfieldRam[o+3]??0))>>>0; }
  return 0;
}

console.log("=== PROLOGUE ===");
console.log("tileX = 0x" + tileX.toString(16), "tileY = 0x" + tileY.toString(16));
console.log("lvlPtr = 0x" + lvlPtr.toString(16), "bsearchPtr = 0x" + bsearchPtr.toString(16));

let d4 = (tileY + 1 + tileX - 0x15) & 0xffff;
const d4Long_init = s16(d4);
console.log("d4 (initial) = 0x" + d4.toString(16), "d4Long=", d4Long_init);
let d6 = (0x15 - tileX + asrW(d4, 1)) & 0xffff;
console.log("d6 = 0x" + d6.toString(16));
let a6 = 0x24b3a + ((d4Long_init & 1) !== 0 ? 0x12 : 0);
console.log("a6 = 0x" + a6.toString(16));
let a4Off = (0x478 + d4Long_init * 4) >>> 0;
console.log("a4Off = 0x" + a4Off.toString(16));
const d2Max = readWordAbs((lvlPtr + 0x18) >>> 0);
console.log("d2Max = 0x" + d2Max.toString(16));

console.log("\n=== ITER 0 ===");
let d4Signed = s16(d4);
let abort = d4Signed < 0 || s16(d2Max) <= d4Signed;
console.log("abortBody =", abort);
if (!abort) {
  let d0 = d6;
  const d4b = d4 & 0xff;
  let d1L = d4b & ~1;
  console.log("d4b=", d4b.toString(16), "d1Long=", d1L.toString(16));
  if ((d4b & 1) !== 0) d0 = (d0 + 0x16) & 0xffff;
  console.log("d0 after odd-adjust = 0x" + d0.toString(16));
  let a3 = PF;
  const pfWordOff = romW(0x1eb3a + d1L);
  a3 = (a3 + s16(pfWordOff)) >>> 0;
  console.log("pfWordOff (signed) =", s16(pfWordOff), "a3=0x" + a3.toString(16));
  const off1ed0aB = 0x1ed0a + d0;
  const d1B = romB(off1ed0aB);
  d1L = (d1B - 2) | 0;
  a3 = (a3 + d1L) >>> 0;
  console.log("d1B=" + d1B.toString(16) + ", d1L (signed)=" + d1L + ", a3=0x" + a3.toString(16));
  let d1 = readLongAbs(a3) >>> 0;
  console.log("d1 (long from playfield) = 0x" + d1.toString(16));
  const off1ed0aShift = 0x1ed0a + 0x2c + d0;
  const shiftAmt = romB(off1ed0aShift);
  console.log("shiftAmt =", shiftAmt);
  d1 = (d1 >>> (shiftAmt & 0x1f)) >>> 0;
  console.log("d1 after shift = 0x" + d1.toString(16));
  const idx = (d1 & 0x7fe) & 0xffff;
  console.log("idx (after & 0x7fe) = 0x" + idx.toString(16));
  const bsearchBase = r32(0x65a) >>> 0;
  console.log("bsearchBase = 0x" + bsearchBase.toString(16));
  const terrainCode = readWordAbs((bsearchBase + idx) >>> 0);
  console.log("terrainCode = 0x" + terrainCode.toString(16));

  // Expected MAME path = PATH_TERRAIN_TOP (>= 0xf000), v = (tc&0x7f - 0x40 + colVal) → 0x3f98
  console.log("colVal @ a4Off=0x" + a4Off.toString(16), "=", "0x" + r16(a4Off).toString(16));
  console.log("expected: v = (terrainCode&0x7f - 0x40 + colVal) = ", ((terrainCode&0x7f) - 0x40 + r16(a4Off)) & 0xffff, "→ MAME wants 0x3f98");
}
