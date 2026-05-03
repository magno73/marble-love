#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import { state as stateNs, slotSearch, bus as busNs } from "@marble-love/engine";
import type { RomImage } from "@marble-love/engine";
import { createCpu, callFunction, pokeMem, peekMem, disposeCpu } from "./binary-oracle-lib.js";

const FUN_FIND = 0x00014bce;
const FUN_MATCH = 0x00014c0c;

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (s * 1103515245 + 12345) >>> 0; return ((s >>> 16) & 0xffff) / 0x10000; };
}

async function main(): Promise<void> {
  const n = Number(process.argv[2] ?? "300");
  const rom = readFileSync(resolve("ghidra_project/marble_program.bin"));
  const stateInst = stateNs.emptyGameState();
  const cpu = await createCpu({ rom, state: stateInst });
  const tsRom: RomImage = busNs.emptyRomImage();
  tsRom.program.set(rom.subarray(0, tsRom.program.length));
  const r = rng(0xface);

  console.log(`\n=== findFreeSlotInTable (FUN_14BCE) — ${n} casi ===`);
  let ok1 = 0;
  for (let i = 0; i < n; i++) {
    cpu.system.setRegister("sp", 0x401f00);
    for (const slot of [0x401302, 0x401362, 0x4013C2, 0x401422]) {
      const v = (r() < 0.5) ? 0 : Math.floor(r() * 256);
      pokeMem(cpu, slot + 0x18, 1, v);
      stateInst.workRam[(slot - 0x400000) + 0x18] = v;
    }
    const binR = callFunction(cpu, FUN_FIND, []);
    const tsR = slotSearch.findFreeSlotInTable(stateInst, tsRom);
    if ((binR.d0 >>> 0) === (tsR >>> 0)) ok1++;
  }
  console.log(`  Match: ${ok1}/${n} = ${((ok1/n)*100).toFixed(1)}%`);

  console.log(`\n=== slotMatchesPtr (FUN_14C0C) — ${n} casi ===`);
  let ok2 = 0;
  for (let i = 0; i < n; i++) {
    cpu.system.setRegister("sp", 0x401f00);
    const ARG = 0x00401D00;
    const target = Math.floor(r() * 0x10000);
    pokeMem(cpu, ARG + 2, 4, target);
    stateInst.workRam[(ARG - 0x400000) + 2] = (target >>> 24) & 0xff;
    stateInst.workRam[(ARG - 0x400000) + 3] = (target >>> 16) & 0xff;
    stateInst.workRam[(ARG - 0x400000) + 4] = (target >>> 8) & 0xff;
    stateInst.workRam[(ARG - 0x400000) + 5] = target & 0xff;
    // Setup 4 slots
    for (let s = 0; s < 4; s++) {
      const slot = 0x401302 + s * 0x60;
      const v = (r() < 0.3) ? 0 : Math.floor(r() * 256);
      pokeMem(cpu, slot + 0x18, 1, v);
      stateInst.workRam[(slot - 0x400000) + 0x18] = v;
      // Set slot+0x4E: 30% chance == target, else random
      const fld = (r() < 0.3) ? target : Math.floor(r() * 0x10000);
      pokeMem(cpu, slot + 0x4E, 4, fld);
      stateInst.workRam[(slot - 0x400000) + 0x4E] = (fld >>> 24) & 0xff;
      stateInst.workRam[(slot - 0x400000) + 0x4F] = (fld >>> 16) & 0xff;
      stateInst.workRam[(slot - 0x400000) + 0x50] = (fld >>> 8) & 0xff;
      stateInst.workRam[(slot - 0x400000) + 0x51] = fld & 0xff;
    }
    const binR = callFunction(cpu, FUN_MATCH, [ARG]);
    const tsR = slotSearch.slotMatchesPtr(stateInst, ARG);
    if ((binR.d0 & 0xff) === tsR) ok2++;
  }
  console.log(`  Match: ${ok2}/${n} = ${((ok2/n)*100).toFixed(1)}%`);

  disposeCpu(cpu);
  exit((ok1 === n && ok2 === n) ? 0 : 1);
}

main().catch(e => { console.error(e); exit(1); });
