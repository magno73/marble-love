#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import { state as stateNs, trackballApply } from "@marble-love/engine";
import { createCpu, callFunction, pokeMem, peekMem, disposeCpu } from "./binary-oracle-lib.js";

const FUN = 0x00025df6;

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (s * 1103515245 + 12345) >>> 0; return ((s >>> 16) & 0xffff) / 0x10000; };
}

async function main(): Promise<void> {
  const n = Number(process.argv[2] ?? "500");
  const rom = readFileSync(resolve("ghidra_project/marble_program.bin"));
  const stateInst = stateNs.emptyGameState();
  const cpu = await createCpu({ rom, state: stateInst });
  const r = rng(0xa11b);

  console.log(`\n=== trackballApplyDelta (FUN_25DF6) — ${n} cases ===`);
  let ok = 0;
  for (let i = 0; i < n; i++) {
    cpu.system.setRegister("sp", 0x401f00);
    const POS = 0x00401D00;
    // Random delta in restricted range to avoid overflow
    const xDel = Math.floor(r() * 0x40) - 0x20;
    const yDel = Math.floor(r() * 0x40) - 0x20;
    pokeMem(cpu, 0x004006A4, 2, xDel & 0xffff);
    pokeMem(cpu, 0x004006A6, 2, yDel & 0xffff);
    stateInst.workRam[0x6A4] = (xDel >>> 8) & 0xff; stateInst.workRam[0x6A5] = xDel & 0xff;
    stateInst.workRam[0x6A6] = (yDel >>> 8) & 0xff; stateInst.workRam[0x6A7] = yDel & 0xff;
    // game state word
    const gs = (r() < 0.3) ? 4 : Math.floor(r() * 8);
    pokeMem(cpu, 0x00400394, 2, gs);
    stateInst.workRam[0x394] = (gs >>> 8) & 0xff; stateInst.workRam[0x395] = gs & 0xff;
    // pos x, y
    const x = Math.floor(r() * 0x10000);
    const y = Math.floor(r() * 0x10000);
    pokeMem(cpu, POS + 0, 4, x);
    pokeMem(cpu, POS + 4, 4, y);
    stateInst.workRam[0x1D00] = (x >>> 24) & 0xff; stateInst.workRam[0x1D01] = (x >>> 16) & 0xff;
    stateInst.workRam[0x1D02] = (x >>> 8) & 0xff; stateInst.workRam[0x1D03] = x & 0xff;
    stateInst.workRam[0x1D04] = (y >>> 24) & 0xff; stateInst.workRam[0x1D05] = (y >>> 16) & 0xff;
    stateInst.workRam[0x1D06] = (y >>> 8) & 0xff; stateInst.workRam[0x1D07] = y & 0xff;
    callFunction(cpu, FUN, [POS]);
    trackballApply.trackballApplyDelta(stateInst, POS);
    let m = true;
    for (let j = 0; j < 8; j++) {
      if (peekMem(cpu, POS + j, 1) !== (stateInst.workRam[0x1D00 + j] ?? 0)) { m = false; break; }
    }
    if (m) {
      // Compare 0x6A4, 0x6A6 (deltas may have been boosted)
      for (const off of [0x6A4, 0x6A5, 0x6A6, 0x6A7]) {
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
