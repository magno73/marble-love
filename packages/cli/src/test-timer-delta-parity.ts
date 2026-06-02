#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import { state as stateNs, timerDelta } from "@marble-love/engine";
import { createCpu, callFunction, pokeMem, peekMem, disposeCpu } from "./binary-oracle-lib.js";

const FUN = 0x000043d6;

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (s * 1103515245 + 12345) >>> 0; return ((s >>> 16) & 0xffff) / 0x10000; };
}

async function main(): Promise<void> {
  const n = Number(process.argv[2] ?? "500");
  const rom = readFileSync(resolve("ghidra_project/marble_program.bin"));
  const stateInst = stateNs.emptyGameState();
  const cpu = await createCpu({ rom, state: stateInst });
  const r = rng(0xab1f);

  console.log(`\n=== timerDeltaAccumulate (FUN_43D6) — ${n} cases ===`);
  let ok = 0;
  for (let i = 0; i < n; i++) {
    cpu.system.setRegister("sp", 0x401f00);
    // Setup random timer + prev + accumulators
    for (let j = 0x1F80; j < 0x1FA0; j++) {
      const v = Math.floor(r() * 256);
      pokeMem(cpu, 0x400000 + j, 1, v);
      stateInst.workRam[j] = v;
    }
    // Random current timer
    const tm = Math.floor(r() * 0x100000000) >>> 0;
    pokeMem(cpu, 0x00401FF8, 4, tm);
    stateInst.workRam[0x1FF8] = (tm >>> 24) & 0xff;
    stateInst.workRam[0x1FF9] = (tm >>> 16) & 0xff;
    stateInst.workRam[0x1FFA] = (tm >>> 8) & 0xff;
    stateInst.workRam[0x1FFB] = tm & 0xff;
    const ctl = Math.floor(r() * 256);
    const binR = callFunction(cpu, FUN, [ctl]);
    const tsR = timerDelta.timerDeltaAccumulate(stateInst, ctl);
    let m = (binR.d0 >>> 0) === (tsR >>> 0);
    if (m) {
      for (let j = 0x1F80; j < 0x1FA0; j++) {
        if (peekMem(cpu, 0x400000 + j, 1) !== (stateInst.workRam[j] ?? 0)) { m = false; break; }
      }
    }
    if (m) ok++;
  }
  console.log(`  Match: ${ok}/${n} = ${((ok/n)*100).toFixed(1)}%`);
  disposeCpu(cpu);
  exit(ok === n ? 0 : 1);
}

main().catch(e => { console.error(e); exit(1); });
