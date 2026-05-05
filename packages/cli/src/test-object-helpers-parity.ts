#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import { state as stateNs, objectHelpers } from "@marble-love/engine";
import { createCpu, callFunction, pokeMem, peekMem, disposeCpu } from "./binary-oracle-lib.js";

const FUN_COPY = 0x0002648c;
const FUN_ADV = 0x000160ae;

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (s * 1103515245 + 12345) >>> 0; return ((s >>> 16) & 0xffff) / 0x10000; };
}

async function main(): Promise<void> {
  const n = Number(process.argv[2] ?? "300");
  const rom = readFileSync(resolve("ghidra_project/marble_program.bin"));
  const stateInst = stateNs.emptyGameState();
  const cpu = await createCpu({ rom, state: stateInst });
  const r = rng(0xfeed);
  const OBJ = 0x00401D00;

  // FUN_2648C
  console.log(`\n=== copyGlobalsToObj (FUN_2648C) — ${n} casi ===`);
  let ok1 = 0;
  for (let i = 0; i < n; i++) {
    cpu.system.setRegister("sp", 0x401f00);
    for (const off of [0x684, 0x688, 0x68c]) {
      const v = Math.floor(r() * 0x100000000) >>> 0;
      pokeMem(cpu, 0x400000 + off, 4, v);
      stateInst.workRam[off] = (v >>> 24) & 0xff;
      stateInst.workRam[off+1] = (v >>> 16) & 0xff;
      stateInst.workRam[off+2] = (v >>> 8) & 0xff;
      stateInst.workRam[off+3] = v & 0xff;
    }
    // Pre-fill obj area
    for (let j = 0; j < 0x20; j++) {
      pokeMem(cpu, OBJ + j, 1, 0x55);
      stateInst.workRam[(OBJ - 0x400000) + j] = 0x55;
    }
    callFunction(cpu, FUN_COPY, [OBJ]);
    objectHelpers.copyGlobalsToObj(stateInst, OBJ);
    let m = true;
    for (let j = 0; j < 0x20; j++) {
      if (peekMem(cpu, OBJ + j, 1) !== (stateInst.workRam[(OBJ - 0x400000) + j] ?? 0)) { m = false; break; }
    }
    if (m) ok1++;
  }
  console.log(`  Match: ${ok1}/${n} = ${((ok1/n)*100).toFixed(1)}%`);

  // FUN_160AE
  console.log(`\n=== objIndexedByteAdvance (FUN_160AE) — ${n} casi ===`);
  let ok2 = 0;
  for (let i = 0; i < n; i++) {
    cpu.system.setRegister("sp", 0x401f00);
    // Setup obj with safe pointer (in workRam scratch)
    const ptrTarget = 0x00401D80;
    pokeMem(cpu, OBJ + 0x6e, 4, ptrTarget);
    stateInst.workRam[(OBJ - 0x400000) + 0x6e] = (ptrTarget >>> 24) & 0xff;
    stateInst.workRam[(OBJ - 0x400000) + 0x6f] = (ptrTarget >>> 16) & 0xff;
    stateInst.workRam[(OBJ - 0x400000) + 0x70] = (ptrTarget >>> 8) & 0xff;
    stateInst.workRam[(OBJ - 0x400000) + 0x71] = ptrTarget & 0xff;
    const addend = Math.floor(r() * 0x10000); // small to avoid overflow
    pokeMem(cpu, OBJ + 0x72, 4, addend);
    stateInst.workRam[(OBJ - 0x400000) + 0x72] = (addend >>> 24) & 0xff;
    stateInst.workRam[(OBJ - 0x400000) + 0x73] = (addend >>> 16) & 0xff;
    stateInst.workRam[(OBJ - 0x400000) + 0x74] = (addend >>> 8) & 0xff;
    stateInst.workRam[(OBJ - 0x400000) + 0x75] = addend & 0xff;
    // Setup ptrTarget+2+idx area with random bytes
    for (let j = 0; j < 0x40; j++) {
      const v = Math.floor(r() * 256) & 0xff;
      pokeMem(cpu, ptrTarget + j, 1, v);
      stateInst.workRam[(ptrTarget - 0x400000) + j] = v;
    }
    const idx = Math.floor(r() * 32); // small positive idx
    callFunction(cpu, FUN_ADV, [OBJ, idx]);
    objectHelpers.objIndexedByteAdvance(stateInst, OBJ, idx);
    const binVal = peekMem(cpu, OBJ + 0x6e, 4) >>> 0;
    const tsVal = (
      (((stateInst.workRam[(OBJ - 0x400000) + 0x6e] ?? 0) << 24) |
       ((stateInst.workRam[(OBJ - 0x400000) + 0x6f] ?? 0) << 16) |
       ((stateInst.workRam[(OBJ - 0x400000) + 0x70] ?? 0) << 8) |
        (stateInst.workRam[(OBJ - 0x400000) + 0x71] ?? 0)) >>> 0
    );
    if (binVal === tsVal) ok2++;
  }
  console.log(`  Match: ${ok2}/${n} = ${((ok2/n)*100).toFixed(1)}%`);

  console.log(`\n=== objDeriveShorts (FUN_253BC) — ${n} casi ===`);
  let okDS = 0;
  for (let i = 0; i < n; i++) {
    cpu.system.setRegister("sp", 0x401f00);
    const OBJ2 = 0x00401D00;
    // Random fields
    for (let j = 0; j < 0x40; j++) {
      const v = Math.floor(r() * 256);
      pokeMem(cpu, OBJ2 + j, 1, v);
      stateInst.workRam[(OBJ2 - 0x400000) + j] = v;
    }
    // Sometimes set byte+0x36 to skip
    const skip = r() < 0.5 ? 1 : 0;
    pokeMem(cpu, OBJ2 + 0x36, 1, skip);
    stateInst.workRam[(OBJ2 - 0x400000) + 0x36] = skip;
    callFunction(cpu, 0x253bc, [OBJ2]);
    objectHelpers.objDeriveShorts(stateInst, OBJ2);
    let m = true;
    for (let j = 0; j < 0x40; j++) {
      if (peekMem(cpu, OBJ2 + j, 1) !== (stateInst.workRam[(OBJ2 - 0x400000) + j] ?? 0)) { m = false; break; }
    }
    if (m) okDS++;
  }
  console.log(`  Match: ${okDS}/${n} = ${((okDS/n)*100).toFixed(1)}%`);

  console.log(`\n=== eepromCommitDelta (FUN_4008) — ${n} casi ===`);
  let okCD = 0;
  for (let i = 0; i < n; i++) {
    cpu.system.setRegister("sp", 0x401f00);
    // Setup eeprom struct ptr @ 0x401FFC
    const PTR = 0x00401D80;
    pokeMem(cpu, 0x00401FFC, 4, PTR);
    stateInst.workRam[0x1FFC] = 0; stateInst.workRam[0x1FFD] = 0x40;
    stateInst.workRam[0x1FFE] = 0x1D; stateInst.workRam[0x1FFF] = 0x80;
    // Validate bytes (50% complementary)
    const a = Math.floor(r() * 256);
    const b = (r() < 0.6) ? ((~a) & 0xff) : Math.floor(r() * 256);
    pokeMem(cpu, PTR + 0xA, 1, a);
    pokeMem(cpu, PTR + 0xB, 1, b);
    stateInst.workRam[(PTR - 0x400000) + 0xA] = a;
    stateInst.workRam[(PTR - 0x400000) + 0xB] = b;
    // *0x401FF5 + 0x401FF7 random
    const v5 = Math.floor(r() * 256);
    const v7 = Math.floor(r() * 256);
    pokeMem(cpu, 0x00401FF5, 1, v5);
    pokeMem(cpu, 0x00401FF7, 1, v7);
    stateInst.workRam[0x1FF5] = v5;
    stateInst.workRam[0x1FF7] = v7;
    // delta in [0, 256)
    const delta = Math.floor(r() * 256);
    const binR = callFunction(cpu, 0x4008, [delta]);
    const tsR = objectHelpers.eepromCommitDelta(stateInst, delta);
    let m = (binR.d0 & 0xff) === tsR;
    if (m) {
      // Compare *0x401FF5 + *0x401FF7
      if (peekMem(cpu, 0x401FF5, 1) !== (stateInst.workRam[0x1FF5] ?? 0)) m = false;
      else if (peekMem(cpu, 0x401FF7, 1) !== (stateInst.workRam[0x1FF7] ?? 0)) m = false;
    }
    if (m) okCD++;
  }
  console.log(`  Match: ${okCD}/${n} = ${((okCD/n)*100).toFixed(1)}%`);

  console.log(`\n=== triggerObjectEvent (FUN_285B0) — ${n} casi ===`);
  let okT = 0;
  // Need ROM
  const tsRom2 = (await import("@marble-love/engine")).bus.emptyRomImage();
  tsRom2.program.set(rom.subarray(0, tsRom2.program.length));
  for (let i = 0; i < n; i++) {
    cpu.system.setRegister("sp", 0x401f00);
    const OBJT = 0x00401D00;
    for (let j = 0; j < 0x100; j++) {
      const v = Math.floor(r() * 256);
      pokeMem(cpu, OBJT + j, 1, v);
      stateInst.workRam[(OBJT - 0x400000) + j] = v;
    }
    pokeMem(cpu, 0x0040039c, 1, Math.floor(r() * 256));
    stateInst.workRam[0x39c] = peekMem(cpu, 0x40039c, 1);
    const eb = Math.floor(r() * 16);
    const tp = Math.floor(r() * 35);
    pokeMem(cpu, OBJT + 0x19, 1, tp);
    stateInst.workRam[(OBJT - 0x400000) + 0x19] = tp;
    callFunction(cpu, 0x285b0, [OBJT, eb]);
    objectHelpers.triggerObjectEvent(stateInst, tsRom2, OBJT, eb);
    let m = true;
    for (let j = 0; j < 0x100; j++) {
      if (peekMem(cpu, OBJT + j, 1) !== (stateInst.workRam[(OBJT - 0x400000) + j] ?? 0)) { m = false; break; }
    }
    if (m && peekMem(cpu, 0x40039c, 1) !== (stateInst.workRam[0x39c] ?? 0)) m = false;
    if (m) okT++;
  }
  console.log(`  Match: ${okT}/${n} = ${((okT/n)*100).toFixed(1)}%`);

  console.log(`\n=== eepromValidateAndClassify (FUN_3F3E) — ${n} casi ===`);
  let ok3 = 0;
  for (let i = 0; i < n; i++) {
    cpu.system.setRegister("sp", 0x401f00);
    const PTR = 0x00401D80;
    pokeMem(cpu, 0x00401FFC, 4, PTR);
    stateInst.workRam[0x1FFC] = 0; stateInst.workRam[0x1FFD] = 0x40;
    stateInst.workRam[0x1FFE] = 0x1D; stateInst.workRam[0x1FFF] = 0x80;
    const a = Math.floor(r() * 256);
    const b = (r() < 0.4) ? ((~a) & 0xff) : Math.floor(r() * 256);
    pokeMem(cpu, PTR + 0xA, 1, a);
    pokeMem(cpu, PTR + 0xB, 1, b);
    stateInst.workRam[(PTR - 0x400000) + 0xA] = a;
    stateInst.workRam[(PTR - 0x400000) + 0xB] = b;
    const binR = callFunction(cpu, 0x3f3e, []);
    const tsR = objectHelpers.eepromValidateAndClassify(stateInst);
    if ((binR.d0 >>> 0) === (tsR >>> 0)) ok3++;
  }
  console.log(`  Match: ${ok3}/${n} = ${((ok3/n)*100).toFixed(1)}%`);

  disposeCpu(cpu);
  exit((ok1 === n && ok2 === n && ok3 === n && okDS === n && okT === n && okCD === n) ? 0 : 1);
}

main().catch(e => { console.error(e); exit(1); });
