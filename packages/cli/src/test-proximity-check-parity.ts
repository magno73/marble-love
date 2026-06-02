#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import { state as stateNs, proximityCheck, gridBitmapTest, bus as busNs } from "@marble-love/engine";
import type { RomImage } from "@marble-love/engine";
import { createCpu, callFunction, pokeMem, disposeCpu } from "./binary-oracle-lib.js";

const FUN = 0x000193d8;
const FUN_VAL = 0x0001937c;

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (s * 1103515245 + 12345) >>> 0; return ((s >>> 16) & 0xffff) / 0x10000; };
}

async function main(): Promise<void> {
  const n = Number(process.argv[2] ?? "500");
  const rom = readFileSync(resolve("ghidra_project/marble_program.bin"));
  const stateInst = stateNs.emptyGameState();
  const cpu = await createCpu({ rom, state: stateInst });
  const r = rng(0xdada);

  console.log(`\n=== proximityCheckArray (FUN_193D8) — ${n} cases ===`);
  let ok = 0;
  for (let i = 0; i < n; i++) {
    cpu.system.setRegister("sp", 0x401f00);
    // Setup 9 entries random
    for (let s = 0; s < 9; s++) {
      const eAddr = 0x401890 + s * 0x28;
      for (let b = 0; b < 0x28; b++) {
        const v = Math.floor(r() * 256);
        pokeMem(cpu, eAddr + b, 1, v);
        stateInst.workRam[(eAddr - 0x400000) + b] = v;
      }
    }
    // Bias x,y to sometimes be close to entry positions
    const x = Math.floor(r() * 0x10000);
    const y = Math.floor(r() * 0x10000);
    // 30% probability: exclude one of the entries
    const excl = r() < 0.3 ? (0x401890 + Math.floor(r() * 9) * 0x28) : 0;
    const binR = callFunction(cpu, FUN, [excl, x, y]);
    const tsR = proximityCheck.proximityCheckArray(stateInst, excl, x, y);
    if ((binR.d0 & 0xff) === tsR) ok++;
  }
  console.log(`  Match: ${ok}/${n} = ${((ok/n)*100).toFixed(1)}%`);

  // Validate position
  console.log(`\n=== validatePosition (FUN_1937C) — ${n} cases ===`);
  const tsRom: RomImage = busNs.emptyRomImage();
  tsRom.program.set(rom.subarray(0, tsRom.program.length));
  let okV = 0;
  for (let i = 0; i < n; i++) {
    cpu.system.setRegister("sp", 0x401f00);
    const OBJ = 0x00401D00;
    // Set obj+0xC, +0x10 with grid coords (around 0x59*8, 0x5A*8 = 0x2C8, 0x2D0)
    const x = (0x59 << 3) + Math.floor(r() * 0x80) - 0x40;
    const y = (0x5A << 3) + Math.floor(r() * 0x80) - 0x40;
    pokeMem(cpu, OBJ + 0xC, 2, x & 0xffff);
    pokeMem(cpu, OBJ + 0x10, 2, y & 0xffff);
    stateInst.workRam[(OBJ - 0x400000) + 0xC] = (x >>> 8) & 0xff;
    stateInst.workRam[(OBJ - 0x400000) + 0xD] = x & 0xff;
    stateInst.workRam[(OBJ - 0x400000) + 0x10] = (y >>> 8) & 0xff;
    stateInst.workRam[(OBJ - 0x400000) + 0x11] = y & 0xff;
    // Setup 9 entries (proximity sub uses)
    for (let s = 0; s < 9; s++) {
      const eAddr = 0x401890 + s * 0x28;
      for (let b = 0; b < 0x28; b++) {
        const v = Math.floor(r() * 256);
        pokeMem(cpu, eAddr + b, 1, v);
        stateInst.workRam[(eAddr - 0x400000) + b] = v;
      }
    }
    const binR = callFunction(cpu, FUN_VAL, [OBJ]);
    const tsR = proximityCheck.validatePosition(stateInst, tsRom, gridBitmapTest.testGridBitmap, OBJ);
    if ((binR.d0 & 0xff) === tsR) okV++;
  }
  console.log(`  Match: ${okV}/${n} = ${((okV/n)*100).toFixed(1)}%`);

  disposeCpu(cpu);
  exit((ok === n && okV === n) ? 0 : 1);
}

main().catch(e => { console.error(e); exit(1); });
