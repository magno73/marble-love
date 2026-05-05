#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import { state as stateNs, gridBitmapTest, bus as busNs } from "@marble-love/engine";
import type { RomImage } from "@marble-love/engine";
import { createCpu, callFunction, disposeCpu } from "./binary-oracle-lib.js";

const FUN = 0x00019460;

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
  const r = rng(0x6e1d);

  console.log(`\n=== testGridBitmap (FUN_19460) — ${n} casi ===`);
  let ok = 0;
  for (let i = 0; i < n; i++) {
    cpu.system.setRegister("sp", 0x401f00);
    // Bias args to be in valid range often
    const arg1 = (0x59 << 3) + Math.floor(r() * 0x80) - 0x40;
    const arg2 = (0x5a << 3) + Math.floor(r() * 0x80) - 0x40;
    const binR = callFunction(cpu, FUN, [arg1 & 0xffff, arg2 & 0xffff]);
    const tsR = gridBitmapTest.testGridBitmap(tsRom, arg1, arg2);
    if ((binR.d0 & 0xff) === tsR) ok++;
  }
  console.log(`  Match: ${ok}/${n} = ${((ok/n)*100).toFixed(1)}%`);
  disposeCpu(cpu);
  exit(ok === n ? 0 : 1);
}

main().catch(e => { console.error(e); exit(1); });
