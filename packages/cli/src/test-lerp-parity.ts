#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import { state as stateNs, lerp, bus as busNs } from "@marble-love/engine";
import type { RomImage } from "@marble-love/engine";
import { createCpu, callFunction, disposeCpu } from "./binary-oracle-lib.js";

const FUN = 0x0001c61e;

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
  const r = rng(0xff7);

  console.log(`\n=== lerpFromRom (FUN_1C61E) — ${n} cases ===`);
  let ok = 0;
  for (let i = 0; i < n; i++) {
    cpu.system.setRegister("sp", 0x401f00);
    // Bias arg: D2 = (arg>>10) - 0xC should be in valid table range
    // Make arg in [0xC*0x400, 0xC*0x400 + 0x10*0x400) = [0x3000, 0x7000)
    const arg = 0x3000 + Math.floor(r() * 0x4000);
    const binR = callFunction(cpu, FUN, [arg & 0xffff]);
    const tsR = lerp.lerpFromRom(tsRom, arg);
    if ((binR.d0 >>> 0) === (tsR >>> 0)) ok++;
  }
  console.log(`  Match: ${ok}/${n} = ${((ok/n)*100).toFixed(1)}%`);
  disposeCpu(cpu);
  exit(ok === n ? 0 : 1);
}

main().catch(e => { console.error(e); exit(1); });
