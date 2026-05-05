#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import { state as stateNs, spriteCoords } from "@marble-love/engine";
import { createCpu, callFunction, pokeMem, peekMem, disposeCpu } from "./binary-oracle-lib.js";

const FUN_V1 = 0x00018a1e;
const FUN_V2 = 0x000199d6;

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (s * 1103515245 + 12345) >>> 0; return ((s >>> 16) & 0xffff) / 0x10000; };
}

async function main(): Promise<void> {
  const n = Number(process.argv[2] ?? "300");
  const rom = readFileSync(resolve("ghidra_project/marble_program.bin"));
  const stateInst = stateNs.emptyGameState();
  const cpu = await createCpu({ rom, state: stateInst });
  const r = rng(0xab19);

  function setHud(): void {
    const v = Math.floor(r() * 0x10000);
    pokeMem(cpu, 0x0040097e, 2, v);
    stateInst.workRam[0x97e] = (v >>> 8) & 0xff;
    stateInst.workRam[0x97f] = v & 0xff;
  }

  // V1
  console.log(`\n=== computeSpriteCoords_v1 (FUN_18A1E) — ${n} casi ===`);
  let ok1 = 0;
  for (let i = 0; i < n; i++) {
    cpu.system.setRegister("sp", 0x401f00);
    setHud();
    const ARG = 0x00401D00;
    for (let j = 0; j < 0x20; j++) {
      const v = Math.floor(r() * 256);
      pokeMem(cpu, ARG + j, 1, v);
      stateInst.workRam[(ARG - 0x400000) + j] = v;
    }
    callFunction(cpu, FUN_V1, [ARG]);
    spriteCoords.computeSpriteCoords_v1(stateInst, ARG);
    let m = true;
    for (let j = 0; j < 0x20; j++) {
      if (peekMem(cpu, ARG + j, 1) !== (stateInst.workRam[(ARG - 0x400000) + j] ?? 0)) { m = false; break; }
    }
    // Also compare globals 0x400690-693
    if (m) {
      for (let j = 0x690; j <= 0x693; j++) {
        if (peekMem(cpu, 0x400000 + j, 1) !== (stateInst.workRam[j] ?? 0)) { m = false; break; }
      }
    }
    if (m) ok1++;
  }
  console.log(`  Match: ${ok1}/${n} = ${((ok1/n)*100).toFixed(1)}%`);

  // V2
  console.log(`\n=== computeSpriteCoords_v2 (FUN_199D6) — ${n} casi ===`);
  let ok2 = 0;
  for (let i = 0; i < n; i++) {
    cpu.system.setRegister("sp", 0x401f00);
    setHud();
    const ARG = 0x00401D00;
    for (let j = 0; j < 0x40; j++) {
      const v = Math.floor(r() * 256);
      pokeMem(cpu, ARG + j, 1, v);
      stateInst.workRam[(ARG - 0x400000) + j] = v;
    }
    callFunction(cpu, FUN_V2, [ARG]);
    spriteCoords.computeSpriteCoords_v2(stateInst, ARG);
    let m = true;
    for (let j = 0; j < 0x40; j++) {
      if (peekMem(cpu, ARG + j, 1) !== (stateInst.workRam[(ARG - 0x400000) + j] ?? 0)) { m = false; break; }
    }
    if (m) {
      for (let j = 0x690; j <= 0x693; j++) {
        if (peekMem(cpu, 0x400000 + j, 1) !== (stateInst.workRam[j] ?? 0)) { m = false; break; }
      }
    }
    if (m) ok2++;
  }
  console.log(`  Match: ${ok2}/${n} = ${((ok2/n)*100).toFixed(1)}%`);

  // V3
  console.log(`\n=== computeSpriteCoords_v3 (FUN_1778E) — ${n} casi ===`);
  let ok3 = 0;
  for (let i = 0; i < n; i++) {
    cpu.system.setRegister("sp", 0x401f00);
    setHud();
    const ARG = 0x00401D00;
    for (let j = 0; j < 0x40; j++) {
      const v = Math.floor(r() * 256);
      pokeMem(cpu, ARG + j, 1, v);
      stateInst.workRam[(ARG - 0x400000) + j] = v;
    }
    callFunction(cpu, 0x1778e, [ARG]);
    spriteCoords.computeSpriteCoords_v3(stateInst, ARG);
    let m = true;
    for (let j = 0; j < 0x40; j++) {
      if (peekMem(cpu, ARG + j, 1) !== (stateInst.workRam[(ARG - 0x400000) + j] ?? 0)) { m = false; break; }
    }
    if (m) {
      for (let j = 0x690; j <= 0x693; j++) {
        if (peekMem(cpu, 0x400000 + j, 1) !== (stateInst.workRam[j] ?? 0)) { m = false; break; }
      }
    }
    if (m) ok3++;
  }
  console.log(`  Match: ${ok3}/${n} = ${((ok3/n)*100).toFixed(1)}%`);

  disposeCpu(cpu);
  exit((ok1 === n && ok2 === n && ok3 === n) ? 0 : 1);
}

main().catch(e => { console.error(e); exit(1); });
