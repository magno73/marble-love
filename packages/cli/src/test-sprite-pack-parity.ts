#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import { state as stateNs, spritePack } from "@marble-love/engine";
import { createCpu, callFunction, pokeMem, peekMem, disposeCpu } from "./binary-oracle-lib.js";

const FUN = 0x0001a9cc;

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (s * 1103515245 + 12345) >>> 0; return ((s >>> 16) & 0xffff) / 0x10000; };
}

async function main(): Promise<void> {
  const n = Number(process.argv[2] ?? "200");
  const rom = readFileSync(resolve("ghidra_project/marble_program.bin"));
  const stateInst = stateNs.emptyGameState();
  const cpu = await createCpu({ rom, state: stateInst });
  const r = rng(0xab19);

  console.log(`\n=== packSpriteRecords (FUN_1A9CC) — ${n} casi ===`);
  let ok = 0;
  for (let i = 0; i < n; i++) {
    cpu.system.setRegister("sp", 0x401f00);
    const DST = 0x00401D00; // output 6 records (5 longs+5 words+1 long = 30 byte = 0x1E)
    const SRC = 0x00401D80; // input 6 records × 0x40 = 0x180
    // Random src
    for (let j = 0; j < 0x180; j++) {
      const v = Math.floor(r() * 256);
      pokeMem(cpu, SRC + j, 1, v);
      stateInst.workRam[(SRC - 0x400000) + j] = v;
    }
    // Pre-fill dst
    for (let j = 0; j < 0x40; j++) {
      pokeMem(cpu, DST + j, 1, 0xCC);
      stateInst.workRam[(DST - 0x400000) + j] = 0xCC;
    }
    callFunction(cpu, FUN, [DST, SRC]);
    spritePack.packSpriteRecords(stateInst, DST, SRC);
    let m = true;
    for (let j = 0; j < 0x40; j++) {
      if (peekMem(cpu, DST + j, 1) !== (stateInst.workRam[(DST - 0x400000) + j] ?? 0)) { m = false; break; }
    }
    if (m) ok++;
  }
  console.log(`  Match: ${ok}/${n} = ${((ok/n)*100).toFixed(1)}%`);
  disposeCpu(cpu);
  exit(ok === n ? 0 : 1);
}

main().catch(e => { console.error(e); exit(1); });
