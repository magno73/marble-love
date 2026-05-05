#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import { state as stateNs, spriteDerive } from "@marble-love/engine";
import { createCpu, callFunction, pokeMem, peekMem, disposeCpu } from "./binary-oracle-lib.js";

const FUN = 0x0001bb50;

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (s * 1103515245 + 12345) >>> 0; return ((s >>> 16) & 0xffff) / 0x10000; };
}

async function main(): Promise<void> {
  const n = Number(process.argv[2] ?? "500");
  const rom = readFileSync(resolve("ghidra_project/marble_program.bin"));
  const stateInst = stateNs.emptyGameState();
  const cpu = await createCpu({ rom, state: stateInst });
  const r = rng(0xa11);

  console.log(`\n=== deriveSpriteFields (FUN_1BB50) — ${n} casi ===`);
  let ok = 0;
  for (let i = 0; i < n; i++) {
    cpu.system.setRegister("sp", 0x401f00);
    const x = Math.floor(r() * 0x10000);
    const y = Math.floor(r() * 0x10000);
    pokeMem(cpu, 0x00400690, 2, x);
    pokeMem(cpu, 0x00400692, 2, y);
    stateInst.workRam[0x690] = (x >>> 8) & 0xff; stateInst.workRam[0x691] = x & 0xff;
    stateInst.workRam[0x692] = (y >>> 8) & 0xff; stateInst.workRam[0x693] = y & 0xff;
    callFunction(cpu, FUN, []);
    spriteDerive.deriveSpriteFields(stateInst);
    let m = true;
    for (let j = 0x690; j <= 0x6a3; j++) {
      if (peekMem(cpu, 0x400000 + j, 1) !== (stateInst.workRam[j] ?? 0)) { m = false; break; }
    }
    if (m) ok++;
  }
  console.log(`  Match: ${ok}/${n} = ${((ok/n)*100).toFixed(1)}%`);

  // V1
  console.log(`\n=== deriveSpriteFromArg_v1 (FUN_1BB08) — ${n} casi ===`);
  let ok2 = 0;
  for (let i = 0; i < n; i++) {
    cpu.system.setRegister("sp", 0x401f00);
    const ARG = 0x00401D00;
    for (let j = 0; j < 0x20; j++) {
      const v = Math.floor(r() * 256);
      pokeMem(cpu, ARG + j, 1, v);
      stateInst.workRam[(ARG - 0x400000) + j] = v;
    }
    callFunction(cpu, 0x1bb08, [ARG]);
    spriteDerive.deriveSpriteFromArg_v1(stateInst, ARG);
    let m = true;
    for (let j = 0x690; j <= 0x6a3; j++) {
      if (peekMem(cpu, 0x400000 + j, 1) !== (stateInst.workRam[j] ?? 0)) { m = false; break; }
    }
    if (m) ok2++;
  }
  console.log(`  Match: ${ok2}/${n} = ${((ok2/n)*100).toFixed(1)}%`);

  // V2
  console.log(`\n=== deriveSpriteFromArg_v2 (FUN_1BB28) — ${n} casi ===`);
  let ok3 = 0;
  for (let i = 0; i < n; i++) {
    cpu.system.setRegister("sp", 0x401f00);
    const ARG = 0x00401D00;
    for (let j = 0; j < 0x10; j++) {
      const v = Math.floor(r() * 256);
      pokeMem(cpu, ARG + j, 1, v);
      stateInst.workRam[(ARG - 0x400000) + j] = v;
    }
    callFunction(cpu, 0x1bb28, [ARG]);
    spriteDerive.deriveSpriteFromArg_v2(stateInst, ARG);
    let m = true;
    for (let j = 0x690; j <= 0x6a3; j++) {
      if (peekMem(cpu, 0x400000 + j, 1) !== (stateInst.workRam[j] ?? 0)) { m = false; break; }
    }
    if (m) ok3++;
  }
  console.log(`  Match: ${ok3}/${n} = ${((ok3/n)*100).toFixed(1)}%`);

  disposeCpu(cpu);
  exit((ok === n && ok2 === n && ok3 === n) ? 0 : 1);
}

main().catch(e => { console.error(e); exit(1); });
