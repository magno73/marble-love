#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import { state as stateNs, initHelpers, bus as busNs } from "@marble-love/engine";
import type { RomImage } from "@marble-love/engine";
import { createCpu, callFunction, pokeMem, peekMem, disposeCpu } from "./binary-oracle-lib.js";

const FUN_COPY1 = 0x00011ac2;
const FUN_COPY2 = 0x00026b10;
const FUN_NEG = 0x0001286e;

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (s * 1103515245 + 12345) >>> 0; return ((s >>> 16) & 0xffff) / 0x10000; };
}

async function main(): Promise<void> {
  const n = Number(process.argv[2] ?? "200");
  const rom = readFileSync(resolve("ghidra_project/marble_program.bin"));
  const stateInst = stateNs.emptyGameState();
  const cpu = await createCpu({ rom, state: stateInst });
  const tsRom: RomImage = busNs.emptyRomImage();
  tsRom.program.set(rom.subarray(0, tsRom.program.length));
  const r = rng(0xface);

  // FUN_11AC2: 1 caso (deterministic)
  console.log(`\n=== copyRomToWorkram66Words (FUN_11AC2) — 1 caso ===`);
  cpu.system.setRegister("sp", 0x401f00);
  for (let j = 0; j < 200; j++) {
    pokeMem(cpu, 0x40076E + j, 1, 0xCC);
    stateInst.workRam[0x76E + j] = 0xCC;
  }
  callFunction(cpu, FUN_COPY1, []);
  initHelpers.copyRomToWorkram66Words(stateInst, tsRom);
  let ok1 = true;
  for (let j = 0; j < 132; j++) {
    if (peekMem(cpu, 0x40076E + j, 1) !== (stateInst.workRam[0x76E + j] ?? 0)) { ok1 = false; break; }
  }
  console.log(`  Match: ${ok1 ? 1 : 0}/1`);

  // FUN_26B10: 1 caso (deterministic)
  console.log(`\n=== copyRomToPalette32Words (FUN_26B10) — 1 caso ===`);
  cpu.system.setRegister("sp", 0x401f00);
  for (let j = 0; j < 100; j++) {
    pokeMem(cpu, 0xB00000 + j, 1, 0xAA);
    stateInst.colorRam[j] = 0xAA;
  }
  callFunction(cpu, FUN_COPY2, []);
  initHelpers.copyRomToPalette32Words(stateInst, tsRom);
  let ok2 = true;
  for (let j = 0; j < 64; j++) {
    if (peekMem(cpu, 0xB00000 + j, 1) !== (stateInst.colorRam[j] ?? 0)) { ok2 = false; break; }
  }
  console.log(`  Match: ${ok2 ? 1 : 0}/1`);

  // FUN_1CEA: palette init full
  console.log(`\n=== paletteRamInitFull (FUN_1CEA) — 1 caso ===`);
  cpu.system.setRegister("sp", 0x401f00);
  for (let j = 0; j < 0x800; j++) {
    pokeMem(cpu, 0xB00000 + j, 1, 0xCC);
    stateInst.colorRam[j] = 0xCC;
  }
  callFunction(cpu, 0x1cea, []);
  initHelpers.paletteRamInitFull(stateInst, tsRom);
  let okPF = true;
  for (let j = 0; j < 0x800; j++) {
    if (peekMem(cpu, 0xB00000 + j, 1) !== (stateInst.colorRam[j] ?? 0)) { okPF = false; break; }
  }
  console.log(`  Match: ${okPF ? 1 : 0}/1`);

  // FUN_1A41E: palette init level
  console.log(`\n=== paletteInitLevel (FUN_1A41E) — 1 caso ===`);
  cpu.system.setRegister("sp", 0x401f00);
  for (let j = 0; j < 0x800; j++) {
    pokeMem(cpu, 0xB00000 + j, 1, 0xCC);
    stateInst.colorRam[j] = 0xCC;
  }
  callFunction(cpu, 0x1a41e, []);
  initHelpers.paletteInitLevel(stateInst, tsRom);
  let okPL = true;
  for (let j = 0; j < 0x800; j++) {
    if (peekMem(cpu, 0xB00000 + j, 1) !== (stateInst.colorRam[j] ?? 0)) { okPL = false; break; }
  }
  console.log(`  Match: ${okPL ? 1 : 0}/1`);

  // FUN_E24: palette bootstrap
  console.log(`\n=== paletteBootstrapInit (FUN_E24) — 1 caso ===`);
  cpu.system.setRegister("sp", 0x401f00);
  for (let j = 0; j < 0x80; j++) {
    pokeMem(cpu, 0xB00000 + j, 1, 0xCC);
    stateInst.colorRam[j] = 0xCC;
  }
  callFunction(cpu, 0xe24, []);
  initHelpers.paletteBootstrapInit(stateInst);
  let okBS = true;
  for (let j = 0; j < 0x80; j++) {
    if (peekMem(cpu, 0xB00000 + j, 1) !== (stateInst.colorRam[j] ?? 0)) { okBS = false; break; }
  }
  console.log(`  Match: ${okBS ? 1 : 0}/1`);

  // FUN_26B2A: palette init enemy
  console.log(`\n=== paletteInitEnemy (FUN_26B2A) — 5 casi ===`);
  let okPE = 0;
  for (let i = 0; i < 5; i++) {
    cpu.system.setRegister("sp", 0x401f00);
    for (let j = 0; j < 0x800; j++) {
      pokeMem(cpu, 0xB00000 + j, 1, 0xCC);
      stateInst.colorRam[j] = 0xCC;
    }
    callFunction(cpu, 0x26b2a, [i]);
    initHelpers.paletteInitEnemy(stateInst, tsRom, i);
    let m = true;
    for (let j = 0; j < 0x800; j++) {
      if (peekMem(cpu, 0xB00000 + j, 1) !== (stateInst.colorRam[j] ?? 0)) { m = false; break; }
    }
    if (m) okPE++;
  }
  console.log(`  Match: ${okPE}/5`);

  // FUN_31D0: game state machine init
  console.log(`\n=== gameStateMachineInit (FUN_31D0) — 1 caso ===`);
  cpu.system.setRegister("sp", 0x401f00);
  // Pre-fill: workRam globals and alpha
  for (const off of [0x1f00, 0x1f02, 0x1f3a, 0x1f3c, 0x1f3e, 0x1f42]) {
    pokeMem(cpu, 0x400000 + off, 2, 0xCCCC);
    stateInst.workRam[off] = 0xCC; stateInst.workRam[off + 1] = 0xCC;
  }
  for (let i = 0; i < 4; i++) {
    pokeMem(cpu, 0x401F1C + i, 1, 0xAA);
    stateInst.workRam[0x1F1C + i] = 0xAA;
    pokeMem(cpu, 0x401F04 + i * 4, 4, 0xBBBBBBBB);
    for (let bb = 0; bb < 4; bb++) stateInst.workRam[0x1F04 + i * 4 + bb] = 0xBB;
  }
  for (let j = 0; j < 0x1000; j++) {
    pokeMem(cpu, 0xa03000 + j, 1, 0xDD);
    stateInst.alphaRam[j] = 0xDD;
  }
  callFunction(cpu, 0x31d0, []);
  initHelpers.gameStateMachineInit(stateInst, tsRom);
  let okGI = true;
  // Check globals
  for (const off of [0x1f00, 0x1f02, 0x1f3a, 0x1f3c, 0x1f3e, 0x1f42]) {
    const bin = peekMem(cpu, 0x400000 + off, 2);
    const ts = ((stateInst.workRam[off] ?? 0) << 8) | (stateInst.workRam[off + 1] ?? 0);
    if (bin !== ts) { console.log(`  diff @ 0x${off.toString(16)}: bin=0x${bin.toString(16)} ts=0x${ts.toString(16)}`); okGI = false; }
  }
  for (let i = 0; i < 4; i++) {
    if (peekMem(cpu, 0x401F1C + i, 1) !== (stateInst.workRam[0x1F1C + i] ?? 0)) okGI = false;
  }
  for (let j = 0; j < 0xF00; j++) {
    if (peekMem(cpu, 0xa03000 + j, 1) !== (stateInst.alphaRam[j] ?? 0)) { okGI = false; break; }
  }
  console.log(`  Match: ${okGI ? 1 : 0}/1`);

  // FUN_1286E
  console.log(`\n=== negateXYSwap (FUN_1286E) — ${n} casi ===`);
  let ok3 = 0;
  for (let i = 0; i < n; i++) {
    cpu.system.setRegister("sp", 0x401f00);
    const PTR = 0x00401D00;
    const x = Math.floor(r() * 0x100000000) >>> 0;
    const y = Math.floor(r() * 0x100000000) >>> 0;
    pokeMem(cpu, PTR + 0, 4, x);
    pokeMem(cpu, PTR + 4, 4, y);
    stateInst.workRam[0x1D00] = (x >>> 24) & 0xff; stateInst.workRam[0x1D01] = (x >>> 16) & 0xff;
    stateInst.workRam[0x1D02] = (x >>> 8) & 0xff;  stateInst.workRam[0x1D03] = x & 0xff;
    stateInst.workRam[0x1D04] = (y >>> 24) & 0xff; stateInst.workRam[0x1D05] = (y >>> 16) & 0xff;
    stateInst.workRam[0x1D06] = (y >>> 8) & 0xff;  stateInst.workRam[0x1D07] = y & 0xff;
    callFunction(cpu, FUN_NEG, [PTR]);
    initHelpers.negateXYSwap(stateInst, PTR);
    let m = true;
    for (let j = 0; j < 8; j++) {
      if (peekMem(cpu, PTR + j, 1) !== (stateInst.workRam[0x1D00 + j] ?? 0)) { m = false; break; }
    }
    if (m) ok3++;
  }
  console.log(`  Match: ${ok3}/${n} = ${((ok3/n)*100).toFixed(1)}%`);

  disposeCpu(cpu);
  exit((ok1 && ok2 && ok3 === n && okPF && okGI && okPL && okPE === 5 && okBS) ? 0 : 1);
}

main().catch(e => { console.error(e); exit(1); });
