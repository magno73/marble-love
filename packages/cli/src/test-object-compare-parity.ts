#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import { state as stateNs, objectCompare } from "@marble-love/engine";
import { createCpu, callFunction, pokeMem, disposeCpu } from "./binary-oracle-lib.js";

const FUN = 0x00015fe6;

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (s * 1103515245 + 12345) >>> 0; return ((s >>> 16) & 0xffff) / 0x10000; };
}

async function main(): Promise<void> {
  const n = Number(process.argv[2] ?? "500");
  const rom = readFileSync(resolve("ghidra_project/marble_program.bin"));
  const stateInst = stateNs.emptyGameState();
  const cpu = await createCpu({ rom, state: stateInst });
  const r = rng(0x5ee);

  console.log(`\n=== compareObjDepth (FUN_15FE6) — ${n} casi ===`);
  let ok = 0;
  for (let i = 0; i < n; i++) {
    cpu.system.setRegister("sp", 0x401f00);
    const O1 = 0x00401D00;
    const O2 = 0x00401D40;
    for (let j = 0; j < 0x20; j++) {
      const v1 = Math.floor(r() * 256);
      const v2 = Math.floor(r() * 256);
      pokeMem(cpu, O1 + j, 1, v1);
      pokeMem(cpu, O2 + j, 1, v2);
      stateInst.workRam[(O1 - 0x400000) + j] = v1;
      stateInst.workRam[(O2 - 0x400000) + j] = v2;
    }
    // Bias byte+0x18 to often be 1
    for (const O of [O1, O2]) {
      const v = (r() < 0.7) ? 1 : Math.floor(r() * 256);
      pokeMem(cpu, O + 0x18, 1, v);
      stateInst.workRam[(O - 0x400000) + 0x18] = v;
    }
    // Sometimes equal byte+0x1B for "z equal" path
    if (r() < 0.5) {
      const z = Math.floor(r() * 256);
      pokeMem(cpu, O1 + 0x1B, 1, z);
      pokeMem(cpu, O2 + 0x1B, 1, z);
      stateInst.workRam[(O1 - 0x400000) + 0x1B] = z;
      stateInst.workRam[(O2 - 0x400000) + 0x1B] = z;
    }
    const binR = callFunction(cpu, FUN, [O1, O2]);
    const tsR = objectCompare.compareObjDepth(stateInst, O1, O2);
    if ((binR.d0 & 0xff) === tsR) ok++;
  }
  console.log(`  Match: ${ok}/${n} = ${((ok/n)*100).toFixed(1)}%`);
  disposeCpu(cpu);
  exit(ok === n ? 0 : 1);
}

main().catch(e => { console.error(e); exit(1); });
