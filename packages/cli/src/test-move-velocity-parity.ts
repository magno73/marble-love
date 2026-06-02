#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import { state as stateNs, moveVelocity, bus as busNs } from "@marble-love/engine";
import type { RomImage } from "@marble-love/engine";
import { createCpu, callFunction, pokeMem, peekMem, disposeCpu } from "./binary-oracle-lib.js";

const FUN = 0x00019976;

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (s * 1103515245 + 12345) >>> 0; return ((s >>> 16) & 0xffff) / 0x10000; };
}

async function main(): Promise<void> {
  const n = Number(process.argv[2] ?? "500");
  const rom = readFileSync(resolve("ghidra_project/marble_program.bin"));
  const stateInst = stateNs.emptyGameState();
  const cpu = await createCpu({ rom, state: stateInst });
  const tsRom: RomImage = busNs.emptyRomImage();
  tsRom.program.set(rom.subarray(0, tsRom.program.length));
  const r = rng(0xfa2e);

  console.log(`\n=== applyMoveVelocity (FUN_19976) — ${n} cases ===`);
  let ok = 0;
  for (let i = 0; i < n; i++) {
    cpu.system.setRegister("sp", 0x401f00);
    const OBJ = 0x00401D00;
    for (let j = 0; j < 0x40; j++) {
      const v = Math.floor(r() * 256);
      pokeMem(cpu, OBJ + j, 1, v);
      stateInst.workRam[(OBJ - 0x400000) + j] = v;
    }
    // Random dir 0..15 (small to keep ROM reads valid)
    const dir = Math.floor(r() * 16);
    pokeMem(cpu, OBJ + 0x26, 1, dir);
    stateInst.workRam[(OBJ - 0x400000) + 0x26] = dir;
    callFunction(cpu, FUN, [OBJ]);
    moveVelocity.applyMoveVelocity(stateInst, tsRom, OBJ);
    let m = true;
    for (let j = 0; j < 0x40; j++) {
      if (peekMem(cpu, OBJ + j, 1) !== (stateInst.workRam[(OBJ - 0x400000) + j] ?? 0)) { m = false; break; }
    }
    if (m) ok++;
  }
  console.log(`  Match: ${ok}/${n} = ${((ok/n)*100).toFixed(1)}%`);
  disposeCpu(cpu);
  exit(ok === n ? 0 : 1);
}

main().catch(e => { console.error(e); exit(1); });
