#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import { state as stateNs, animationStep } from "@marble-love/engine";
import { createCpu, callFunction, pokeMem, peekMem, disposeCpu } from "./binary-oracle-lib.js";

const FUN = 0x000132e0;

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (s * 1103515245 + 12345) >>> 0; return ((s >>> 16) & 0xffff) / 0x10000; };
}

async function main(): Promise<void> {
  const n = Number(process.argv[2] ?? "500");
  const rom = readFileSync(resolve("ghidra_project/marble_program.bin"));
  const stateInst = stateNs.emptyGameState();
  const cpu = await createCpu({ rom, state: stateInst });
  const r = rng(0xab);

  console.log(`\n=== animationStep (FUN_132E0) — ${n} casi ===`);
  let ok = 0;
  for (let i = 0; i < n; i++) {
    cpu.system.setRegister("sp", 0x401f00);
    const OBJ = 0x00401D00;
    const SEQ = 0x00401D80;
    // Random fields, but ptr+0x3E points within SEQ
    for (let j = 0; j < 0x60; j++) {
      const v = Math.floor(r() * 256);
      pokeMem(cpu, OBJ + j, 1, v);
      stateInst.workRam[(OBJ - 0x400000) + j] = v;
    }
    // Set ptr+0x3E = SEQ + small offset
    const seqOffset = Math.floor(r() * 8) * 4;
    const ptrVal = SEQ + seqOffset;
    pokeMem(cpu, OBJ + 0x3E, 4, ptrVal);
    stateInst.workRam[(OBJ - 0x400000) + 0x3E] = (ptrVal >>> 24) & 0xff;
    stateInst.workRam[(OBJ - 0x400000) + 0x3F] = (ptrVal >>> 16) & 0xff;
    stateInst.workRam[(OBJ - 0x400000) + 0x40] = (ptrVal >>> 8) & 0xff;
    stateInst.workRam[(OBJ - 0x400000) + 0x41] = ptrVal & 0xff;
    // Set +0x46 and +0x4A (loop ptrs) within SEQ
    const lp1 = SEQ + Math.floor(r() * 4) * 4;
    const lp2 = SEQ + Math.floor(r() * 4) * 4;
    pokeMem(cpu, OBJ + 0x46, 4, lp1);
    pokeMem(cpu, OBJ + 0x4A, 4, lp2);
    stateInst.workRam[(OBJ - 0x400000) + 0x46] = (lp1 >>> 24) & 0xff;
    stateInst.workRam[(OBJ - 0x400000) + 0x47] = (lp1 >>> 16) & 0xff;
    stateInst.workRam[(OBJ - 0x400000) + 0x48] = (lp1 >>> 8) & 0xff;
    stateInst.workRam[(OBJ - 0x400000) + 0x49] = lp1 & 0xff;
    stateInst.workRam[(OBJ - 0x400000) + 0x4A] = (lp2 >>> 24) & 0xff;
    stateInst.workRam[(OBJ - 0x400000) + 0x4B] = (lp2 >>> 16) & 0xff;
    stateInst.workRam[(OBJ - 0x400000) + 0x4C] = (lp2 >>> 8) & 0xff;
    stateInst.workRam[(OBJ - 0x400000) + 0x4D] = lp2 & 0xff;

    // Setup SEQ with random longs, with chance of -1 terminator
    for (let j = 0; j < 16; j++) {
      const isTerm = r() < 0.3;
      const v = isTerm ? 0xFFFFFFFF : Math.floor(r() * 0x10000);
      pokeMem(cpu, SEQ + j * 4, 4, v);
      const off = (SEQ - 0x400000) + j * 4;
      stateInst.workRam[off] = (v >>> 24) & 0xff;
      stateInst.workRam[off + 1] = (v >>> 16) & 0xff;
      stateInst.workRam[off + 2] = (v >>> 8) & 0xff;
      stateInst.workRam[off + 3] = v & 0xff;
    }

    const binR = callFunction(cpu, FUN, [OBJ]);
    const tsR = animationStep.animationStep(stateInst, OBJ);
    let m = (binR.d0 & 0xff) === tsR;
    if (m) {
      // Compare obj field
      for (let j = 0; j < 0x60; j++) {
        if (peekMem(cpu, OBJ + j, 1) !== (stateInst.workRam[(OBJ - 0x400000) + j] ?? 0)) { m = false; break; }
      }
    }
    if (m) ok++;
  }
  console.log(`  Match: ${ok}/${n} = ${((ok/n)*100).toFixed(1)}%`);

  disposeCpu(cpu);
  exit(ok === n ? 0 : 1);
}

main().catch(e => { console.error(e); exit(1); });
