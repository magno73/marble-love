#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import { state as stateNs, particleBounce } from "@marble-love/engine";
import { createCpu, callFunction, pokeMem, peekMem, disposeCpu } from "./binary-oracle-lib.js";

const FUN = 0x00018dca;

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (s * 1103515245 + 12345) >>> 0; return ((s >>> 16) & 0xffff) / 0x10000; };
}

async function main(): Promise<void> {
  const n = Number(process.argv[2] ?? "300");
  const rom = readFileSync(resolve("ghidra_project/marble_program.bin"));
  const stateInst = stateNs.emptyGameState();
  const cpu = await createCpu({ rom, state: stateInst });
  const r = rng(0xb44);

  console.log(`\n=== particleBounce (FUN_18DCA) — ${n} cases ===`);
  let ok = 0;
  for (let i = 0; i < n; i++) {
    cpu.system.setRegister("sp", 0x401f00);
    const count = Math.floor(r() * 8); // 0..7 entries
    pokeMem(cpu, 0x004003E2, 1, count);
    stateInst.workRam[0x3E2] = count;
    // Random entries
    for (let s = 0; s < count; s++) {
      const eAddr = 0x400A9C + s * 0xA;
      for (let b = 0; b < 0xA; b++) {
        const v = Math.floor(r() * 256);
        pokeMem(cpu, eAddr + b, 1, v);
        stateInst.workRam[(eAddr - 0x400000) + b] = v;
      }
    }
    callFunction(cpu, FUN, []);
    particleBounce.particleBounce(stateInst);
    let m = true;
    for (let s = 0; s < count; s++) {
      const eAddr = 0x400A9C + s * 0xA;
      for (let b = 0; b < 0xA; b++) {
        if (peekMem(cpu, eAddr + b, 1) !== (stateInst.workRam[(eAddr - 0x400000) + b] ?? 0)) {
          m = false; break;
        }
      }
      if (!m) break;
    }
    if (m) ok++;
  }
  console.log(`  Match: ${ok}/${n} = ${((ok/n)*100).toFixed(1)}%`);
  disposeCpu(cpu);
  exit(ok === n ? 0 : 1);
}

main().catch(e => { console.error(e); exit(1); });
