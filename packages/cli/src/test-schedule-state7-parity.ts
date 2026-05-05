#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import { state as stateNs, stateMachineSchedule, stringRender, bus as busNs } from "@marble-love/engine";
import type { RomImage } from "@marble-love/engine";
import { createCpu, callFunction, pokeMem, peekMem, disposeCpu } from "./binary-oracle-lib.js";

const FUN = 0x000028ea;

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
  const r = rng(0xdada);

  console.log(`\n=== scheduleStateMachine7 (FUN_28EA) — ${n} casi ===`);
  let ok = 0;
  for (let i = 0; i < n; i++) {
    cpu.system.setRegister("sp", 0x401f00);
    // Setup chain entry @ 0x401D00 with marker=0 + valF00=0 → exit immediate render
    pokeMem(cpu, 0x00401F00, 2, 0);
    pokeMem(cpu, 0x00401F42, 2, Math.floor(r() * 8));
    stateInst.workRam[0x1F00] = 0; stateInst.workRam[0x1F01] = 0;
    const rot = Math.floor(r() * 8);
    stateInst.workRam[0x1F42] = 0; stateInst.workRam[0x1F43] = rot;
    pokeMem(cpu, 0x00401F42, 2, rot);

    pokeMem(cpu, 0x00401D00, 1, Math.floor(r() * 32));
    pokeMem(cpu, 0x00401D01, 1, Math.floor(r() * 16));
    pokeMem(cpu, 0x00401D02, 4, 0x00401D40);
    pokeMem(cpu, 0x00401D06, 1, 0); // marker=0
    pokeMem(cpu, 0x00401D08, 4, 0); // next=0
    stateInst.workRam[0x1D00] = peekMem(cpu, 0x00401D00, 1);
    stateInst.workRam[0x1D01] = peekMem(cpu, 0x00401D01, 1);
    stateInst.workRam[0x1D02] = 0; stateInst.workRam[0x1D03] = 0x40;
    stateInst.workRam[0x1D04] = 0x1D; stateInst.workRam[0x1D05] = 0x40;
    stateInst.workRam[0x1D06] = 0; stateInst.workRam[0x1D07] = 0;
    stateInst.workRam[0x1D08] = 0; stateInst.workRam[0x1D09] = 0;
    stateInst.workRam[0x1D0A] = 0; stateInst.workRam[0x1D0B] = 0;
    // Empty string at 0x401D40
    pokeMem(cpu, 0x00401D40, 1, 0);
    stateInst.workRam[0x1D40] = 0;

    // Random slot states (some 0 some not)
    for (let s = 0; s < 4; s++) {
      const sb = (r() < 0.5) ? 0 : Math.floor(r() * 7) + 1;
      pokeMem(cpu, 0x401F1C + s, 1, sb);
      stateInst.workRam[0x1F1C + s] = sb;
    }
    // Also reset slot data + word16 + counter+flag arrays
    for (let s = 0; s < 4; s++) {
      pokeMem(cpu, 0x401F04 + s*4, 4, 0);
      pokeMem(cpu, 0x401F14 + s*2, 2, 0);
      pokeMem(cpu, 0x401F28 + s*2, 2, 0);
      pokeMem(cpu, 0x401F34 + s, 1, 0);
      stateInst.workRam[0x1F04 + s*4] = 0; stateInst.workRam[0x1F04 + s*4 + 1] = 0;
      stateInst.workRam[0x1F04 + s*4 + 2] = 0; stateInst.workRam[0x1F04 + s*4 + 3] = 0;
      stateInst.workRam[0x1F14 + s*2] = 0; stateInst.workRam[0x1F14 + s*2 + 1] = 0;
      stateInst.workRam[0x1F28 + s*2] = 0; stateInst.workRam[0x1F28 + s*2 + 1] = 0;
      stateInst.workRam[0x1F34 + s] = 0;
    }

    const word16 = Math.floor(r() * 0x10000);
    const target = Math.floor(r() * 0x10000);

    callFunction(cpu, FUN, [0x00401D00, word16, target]);
    stateMachineSchedule.scheduleStateMachine7(
      stateInst, tsRom, stringRender.renderStringChain, 0x00401D00, word16, target,
    );

    // Compare struct @ 0x401F00..0x401F3F + alpha (if rendered)
    let m = true;
    for (let off = 0x1F00; off <= 0x1F3F; off++) {
      if (peekMem(cpu, 0x400000 + off, 1) !== (stateInst.workRam[off] ?? 0)) { m = false; break; }
    }
    if (m) ok++;
  }
  console.log(`  Match: ${ok}/${n} = ${((ok/n)*100).toFixed(1)}%`);
  disposeCpu(cpu);
  exit(ok === n ? 0 : 1);
}

main().catch(e => { console.error(e); exit(1); });
