#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import { state as stateNs, stateMachineSchedule } from "@marble-love/engine";
import { createCpu, callFunction, pokeMem, peekMem, disposeCpu } from "./binary-oracle-lib.js";

const FUN_3 = 0x00002bda;
const FUN_4 = 0x00002c60;

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (s * 1103515245 + 12345) >>> 0; return ((s >>> 16) & 0xffff) / 0x10000; };
}

async function main(): Promise<void> {
  const n = Number(process.argv[2] ?? "500");
  const rom = readFileSync(resolve("ghidra_project/marble_program.bin"));
  const stateInst = stateNs.emptyGameState();
  const cpu = await createCpu({ rom, state: stateInst });
  const r = rng(0x123);

  function setupSlots(): void {
    // Random states (some 0, some non-0)
    for (let j = 0; j < 4; j++) {
      const sb = (Math.floor(r() * 3) === 0) ? 0 : Math.floor(r() * 7) + 1; // 33% chance free
      pokeMem(cpu, 0x401F1C + j, 1, sb);
      stateInst.workRam[0x1F1C + j] = sb;
      // Random other fields
      const dat = Math.floor(r() * 0x10000);
      pokeMem(cpu, 0x401F04 + j*4, 4, dat);
      const off = 0x1F04 + j*4;
      stateInst.workRam[off] = (dat >>> 24) & 0xff;
      stateInst.workRam[off + 1] = (dat >>> 16) & 0xff;
      stateInst.workRam[off + 2] = (dat >>> 8) & 0xff;
      stateInst.workRam[off + 3] = dat & 0xff;
      const w16 = Math.floor(r() * 0x10000);
      pokeMem(cpu, 0x401F14 + j*2, 2, w16);
      stateInst.workRam[0x1F14 + j*2] = (w16 >>> 8) & 0xff;
      stateInst.workRam[0x1F14 + j*2 + 1] = w16 & 0xff;
      const th = Math.floor(r() * 0x10000);
      pokeMem(cpu, 0x401F20 + j*2, 2, th);
      stateInst.workRam[0x1F20 + j*2] = (th >>> 8) & 0xff;
      stateInst.workRam[0x1F20 + j*2 + 1] = th & 0xff;
      const c = Math.floor(r() * 0x10000);
      pokeMem(cpu, 0x401F28 + j*2, 2, c);
      stateInst.workRam[0x1F28 + j*2] = (c >>> 8) & 0xff;
      stateInst.workRam[0x1F28 + j*2 + 1] = c & 0xff;
      const f34 = Math.floor(r() * 256);
      pokeMem(cpu, 0x401F34 + j, 1, f34);
      stateInst.workRam[0x1F34 + j] = f34;
    }
  }

  function compareStruct(): boolean {
    for (let j = 0x1F04; j <= 0x1F37; j++) {
      if (peekMem(cpu, 0x400000 + j, 1) !== (stateInst.workRam[j] ?? 0)) return false;
    }
    return true;
  }

  // Test FUN_2BDA
  console.log(`\n=== scheduleStateMachine3 (FUN_2BDA) — ${n} casi ===`);
  let ok3 = 0;
  for (let i = 0; i < n; i++) {
    cpu.system.setRegister("sp", 0x401f00);
    setupSlots();
    const dat = Math.floor(r() * 0x10000);
    const w = Math.floor(r() * 0x10000);
    const th = Math.floor(r() * 0x10000);
    const binR = callFunction(cpu, FUN_3, [dat, w, th]);
    const tsR = stateMachineSchedule.scheduleStateMachine3(stateInst, dat, w, th);
    if ((binR.d0 & 0xff) === tsR && compareStruct()) ok3++;
  }
  console.log(`  Match: ${ok3}/${n} = ${((ok3/n)*100).toFixed(1)}%`);

  // Test FUN_2C60
  console.log(`\n=== scheduleStateMachine4 (FUN_2C60) — ${n} casi ===`);
  let ok4 = 0;
  for (let i = 0; i < n; i++) {
    cpu.system.setRegister("sp", 0x401f00);
    setupSlots();
    const dat = Math.floor(r() * 0x10000);
    const th = Math.floor(r() * 0x10000);
    const binR = callFunction(cpu, FUN_4, [dat, th]);
    const tsR = stateMachineSchedule.scheduleStateMachine4(stateInst, dat, th);
    if ((binR.d0 & 0xff) === tsR && compareStruct()) ok4++;
  }
  console.log(`  Match: ${ok4}/${n} = ${((ok4/n)*100).toFixed(1)}%`);

  disposeCpu(cpu);
  exit((ok3 === n && ok4 === n) ? 0 : 1);
}

main().catch(e => { console.error(e); exit(1); });
