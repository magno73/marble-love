#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import { state as stateNs, hudFormat, bus as busNs } from "@marble-love/engine";
import type { RomImage } from "@marble-love/engine";
import { createCpu, callFunction, pokeMem, peekMem, disposeCpu } from "./binary-oracle-lib.js";

const FUN = 0x00003d62;

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
  const r = rng(0xdada);

  console.log(`\n=== hudFormat3Values (FUN_3D62) — ${n} casi ===`);
  let ok = 0;
  for (let i = 0; i < n; i++) {
    cpu.system.setRegister("sp", 0x401f00);
    pokeMem(cpu, 0x00401F00, 2, 0);
    pokeMem(cpu, 0x00401F42, 2, 0);
    pokeMem(cpu, 0x00401F3A, 2, 0);
    stateInst.workRam[0x1F00] = 0; stateInst.workRam[0x1F01] = 0;
    stateInst.workRam[0x1F42] = 0; stateInst.workRam[0x1F43] = 0;
    stateInst.workRam[0x1F3A] = 0; stateInst.workRam[0x1F3B] = 0;
    // Pre-fill buf scratch
    for (let j = 0; j < 16; j++) {
      pokeMem(cpu, 0x40017E + j, 1, 0);
      stateInst.workRam[0x17E + j] = 0;
    }
    // Reset alpha RAM
    for (let j = 0; j < 0x1000; j++) {
      pokeMem(cpu, 0xa03000 + j, 1, 0);
      stateInst.alphaRam[j] = 0;
    }
    const v1 = Math.floor(r() * 0x100000000) >>> 0;
    const v2 = Math.floor(r() * 0x10000);
    const v3 = Math.floor(r() * 0x10000);
    callFunction(cpu, FUN, [v1, v2, v3]);
    hudFormat.hudFormat3Values(stateInst, tsRom, v1, v2, v3);
    let m = true;
    // Compare buf (workRam @ 0x40017E + 0x10)
    for (let j = 0; j < 16; j++) {
      if (peekMem(cpu, 0x40017E + j, 1) !== (stateInst.workRam[0x17E + j] ?? 0)) { m = false; break; }
    }
    // Compare alpha RAM
    if (m) {
      for (let j = 0; j < 0x1000; j++) {
        if (peekMem(cpu, 0xa03000 + j, 1) !== (stateInst.alphaRam[j] ?? 0)) { m = false; break; }
      }
    }
    if (m) ok++;
  }
  console.log(`  Match: ${ok}/${n} = ${((ok/n)*100).toFixed(1)}%`);
  disposeCpu(cpu);
  exit(ok === n ? 0 : 1);
}

main().catch(e => { console.error(e); exit(1); });
