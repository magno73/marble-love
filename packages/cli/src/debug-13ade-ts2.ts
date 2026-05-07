#!/usr/bin/env node
import { exit } from "node:process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { bus as busNs } from "@marble-love/engine";
import type { RomImage } from "@marble-love/engine";

const WORK_RAM_BASE = 0x400000;
const SINCOS_TABLE_ROM = 0x1eda2;
const DELTA_STREAM_ROM = 0x1ef32;

function sextWord(v: number): number { return ((v & 0xffff) << 16) >> 16; }
function sextByte(v: number): number { const b = v & 0xff; return b < 0x80 ? b : b - 0x100; }
function readS16Rom(rom: RomImage, addr: number): number {
  const u = (((rom.program[addr] ?? 0) << 8) | (rom.program[addr + 1] ?? 0)) & 0xffff;
  return ((u << 16) >> 16) | 0;
}

async function main() {
  const romPath = resolve("ghidra_project/marble_program.bin");
  const romBuf = readFileSync(romPath);
  const tsRom: RomImage = busNs.emptyRomImage();
  tsRom.program.set(romBuf.subarray(0, tsRom.program.length));

  const d6w = 0x37;
  const frameMinusA = 0x006e;
  const frameMinusEight = 0xfeea;
  const frameMinusFour = 0x0000;
  let a4 = DELTA_STREAM_ROM;
  let d3w = 0x91; // start angle

  console.log("Full loop trace:");
  for (let iter=0; iter<=8; iter++) {
    const d3=d3w&0xffff;
    let d2w: number, d4w: number;
    if (d3<=0x64) { d2w=readS16Rom(tsRom,SINCOS_TABLE_ROM+d3*2); d4w=readS16Rom(tsRom,SINCOS_TABLE_ROM+(0x64-d3)*2); }
    else if (d3<=0xc8) { d2w=(-readS16Rom(tsRom,SINCOS_TABLE_ROM+(0xc8-d3)*2))&0xffff; d4w=readS16Rom(tsRom,SINCOS_TABLE_ROM+(d3-0x64)*2); }
    else if (d3<=0x12d) { d2w=(-readS16Rom(tsRom,SINCOS_TABLE_ROM+(d3-0xc9)*2))&0xffff; d4w=(-readS16Rom(tsRom,SINCOS_TABLE_ROM+(0x12d-d3)*2))&0xffff; }
    else { d2w=readS16Rom(tsRom,SINCOS_TABLE_ROM+(0x191-d3)*2); d4w=(-readS16Rom(tsRom,SINCOS_TABLE_ROM+(d3-0x12d)*2))&0xffff; }
    
    const cosL = (sextWord(d6w) * sextWord(d2w)) | 0;
    const cosScaled = cosL >> 12;
    const a1w = cosScaled & 0xffff;
    const sinL = (sextWord(d6w) * sextWord(d4w)) | 0;
    const sinScaled = sinL >> 12;
    const d0w = sinScaled & 0xffff;
    
    const tileDx = sextByte(tsRom.program[a4] ?? 0); a4++;
    const tileDy = sextByte(tsRom.program[a4] ?? 0); a4++;
    
    const d2wX = (sextWord(d0w) + sextWord(frameMinusEight) - sextWord(a1w)) & 0xffff;
    const xOut = (sextWord(tileDx & 0xffff) + sextWord(d2wX)) & 0xffff;
    const sumL = (sinScaled + cosScaled) | 0;
    const avgW = (sumL >> 1) & 0xffff;
    const d2wY = (sextWord(frameMinusA) + sextWord(frameMinusFour) - sextWord(avgW)) & 0xffff;
    const yOut = (tileDy + sextWord(d2wY)) & 0xffff;
    const xS = sextWord(xOut); const yS = sextWord(yOut);
    const inRange = xS > -8 && xS < 0x120 && yS > -8 && yS < 0xf0;
    console.log(`iter=${iter} d3w=0x${d3w.toString(16)} x=${xS} y=${yS} emit=${inRange} tileDx=${tileDx} tileDy=${tileDy}`);
    
    d3w = (d3w + 0x32) & 0xffff;
    if (d3w >= 0x192) d3w = (d3w - 0x192) & 0xffff;
  }
}
main().catch(console.error);
