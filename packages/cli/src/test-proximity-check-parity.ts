#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import { state as stateNs, proximityCheck } from "@marble-love/engine";
import { createCpu, callFunction, pokeMem, disposeCpu } from "./binary-oracle-lib.js";

const FUN = 0x000193d8;

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (s * 1103515245 + 12345) >>> 0; return ((s >>> 16) & 0xffff) / 0x10000; };
}

async function main(): Promise<void> {
  const n = Number(process.argv[2] ?? "500");
  const rom = readFileSync(resolve("ghidra_project/marble_program.bin"));
  const stateInst = stateNs.emptyGameState();
  const cpu = await createCpu({ rom, state: stateInst });
  const r = rng(0xdada);

  console.log(`\n=== proximityCheckArray (FUN_193D8) — ${n} casi ===`);
  let ok = 0;
  for (let i = 0; i < n; i++) {
    cpu.system.setRegister("sp", 0x401f00);
    // Setup 9 entries random
    for (let s = 0; s < 9; s++) {
      const eAddr = 0x401890 + s * 0x28;
      for (let b = 0; b < 0x28; b++) {
        const v = Math.floor(r() * 256);
        pokeMem(cpu, eAddr + b, 1, v);
        stateInst.workRam[(eAddr - 0x400000) + b] = v;
      }
    }
    // Bias x,y to sometimes be close to entry positions
    const x = Math.floor(r() * 0x10000);
    const y = Math.floor(r() * 0x10000);
    // 30% probability: exclude one of the entries
    const excl = r() < 0.3 ? (0x401890 + Math.floor(r() * 9) * 0x28) : 0;
    const binR = callFunction(cpu, FUN, [excl, x, y]);
    const tsR = proximityCheck.proximityCheckArray(stateInst, excl, x, y);
    if ((binR.d0 & 0xff) === tsR) ok++;
  }
  console.log(`  Match: ${ok}/${n} = ${((ok/n)*100).toFixed(1)}%`);
  disposeCpu(cpu);
  exit(ok === n ? 0 : 1);
}

main().catch(e => { console.error(e); exit(1); });
