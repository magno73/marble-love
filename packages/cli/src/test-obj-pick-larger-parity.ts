#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import { state as stateNs, objPickLarger } from "@marble-love/engine";
import { createCpu, callFunction, pokeMem, peekMem, disposeCpu } from "./binary-oracle-lib.js";

const FUN = 0x000180be;

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (s * 1103515245 + 12345) >>> 0; return ((s >>> 16) & 0xffff) / 0x10000; };
}

async function main(): Promise<void> {
  const n = Number(process.argv[2] ?? "500");
  const rom = readFileSync(resolve("ghidra_project/marble_program.bin"));
  const stateInst = stateNs.emptyGameState();
  const cpu = await createCpu({ rom, state: stateInst });
  const r = rng(0xab2);

  console.log(`\n=== pickObjLarger (FUN_180BE) — ${n} casi ===`);
  let ok = 0;
  for (let i = 0; i < n; i++) {
    cpu.system.setRegister("sp", 0x401f00);
    // obj1 + obj2 random bytes at +0xC6, +0xC7
    for (const off of [0x18, 0xfa]) {
      const c6 = Math.floor(r() * 256);
      const c7 = Math.floor(r() * 256);
      pokeMem(cpu, 0x400000 + off + 0xC6, 1, c6);
      pokeMem(cpu, 0x400000 + off + 0xC7, 1, c7);
      stateInst.workRam[off + 0xC6] = c6;
      stateInst.workRam[off + 0xC7] = c7;
    }
    callFunction(cpu, FUN, []);
    objPickLarger.pickObjLarger(stateInst);
    let m = true;
    for (const off of [0x6aa, 0x6a8]) {
      if (peekMem(cpu, 0x400000 + off, 1) !== (stateInst.workRam[off] ?? 0)) { m = false; break; }
    }
    if (m) ok++;
  }
  console.log(`  Match: ${ok}/${n} = ${((ok/n)*100).toFixed(1)}%`);
  disposeCpu(cpu);
  exit(ok === n ? 0 : 1);
}

main().catch(e => { console.error(e); exit(1); });
