#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import { state as stateNs, stateMachineSchedule, stringRender, bus as busNs } from "@marble-love/engine";
import type { RomImage } from "@marble-love/engine";
import { createCpu, callFunction, pokeMem, peekMem, disposeCpu } from "./binary-oracle-lib.js";

const FUN = 0x000026c2;

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
  const r = rng(0xfa2c);

  console.log(`\n=== scheduleStateMachine5or6 (FUN_26C2) — ${n} casi ===`);
  let ok = 0;
  for (let i = 0; i < n; i++) {
    cpu.system.setRegister("sp", 0x401f00);
    // Setup chain entry
    pokeMem(cpu, 0x00401F00, 2, 0); pokeMem(cpu, 0x00401F42, 2, 0);
    stateInst.workRam[0x1F00] = 0; stateInst.workRam[0x1F01] = 0;
    stateInst.workRam[0x1F42] = 0; stateInst.workRam[0x1F43] = 0;
    pokeMem(cpu, 0x00401D00, 1, 0); pokeMem(cpu, 0x00401D01, 1, 0);
    pokeMem(cpu, 0x00401D02, 4, 0x00401D40);
    pokeMem(cpu, 0x00401D06, 1, 0);
    stateInst.workRam[0x1D00] = 0; stateInst.workRam[0x1D01] = 0;
    stateInst.workRam[0x1D02] = 0; stateInst.workRam[0x1D03] = 0x40;
    stateInst.workRam[0x1D04] = 0x1D; stateInst.workRam[0x1D05] = 0x40;
    stateInst.workRam[0x1D06] = 0;
    pokeMem(cpu, 0x00401D40, 1, 0);
    stateInst.workRam[0x1D40] = 0;

    // Random slot states
    for (let s = 0; s < 4; s++) {
      const sb = (r() < 0.5) ? 0 : Math.floor(r() * 7) + 1;
      pokeMem(cpu, 0x401F1C + s, 1, sb);
      stateInst.workRam[0x1F1C + s] = sb;
      // Reset slot fields
      for (let off of [0x1F04 + s * 4, 0x1F14 + s * 2, 0x1F20 + s * 2, 0x1F28 + s * 2]) {
        pokeMem(cpu, 0x400000 + off, off === 0x1F04 + s * 4 ? 4 : 2, 0);
        for (let bb = 0; bb < (off === 0x1F04 + s * 4 ? 4 : 2); bb++) stateInst.workRam[off + bb] = 0;
      }
    }
    const w16 = Math.floor(r() * 0x10000);
    const th = Math.floor(r() * 0x10000); // mix positive and negative

    const binR = callFunction(cpu, FUN, [0x00401D00, w16, th]);
    const tsR = stateMachineSchedule.scheduleStateMachine5or6(
      stateInst, tsRom, stringRender.renderStringChain, 0x00401D00, w16, th,
    );

    let m = (binR.d0 & 0xff) === tsR;
    if (m) {
      for (let off = 0x1F00; off <= 0x1F3F; off++) {
        if (peekMem(cpu, 0x400000 + off, 1) !== (stateInst.workRam[off] ?? 0)) { m = false; break; }
      }
    }
    if (m) ok++;
  }
  console.log(`  Match: ${ok}/${n} = ${((ok/n)*100).toFixed(1)}%`);
  disposeCpu(cpu);
  exit(ok === n ? 0 : 1);
}

main().catch(e => { console.error(e); exit(1); });
