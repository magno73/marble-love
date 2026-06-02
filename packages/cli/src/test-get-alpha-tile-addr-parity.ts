#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import { state as stateNs, alphaTilemap, bus as busNs } from "@marble-love/engine";
import type { RomImage } from "@marble-love/engine";
import { createCpu, callFunction, pokeMem, disposeCpu } from "./binary-oracle-lib.js";

const FUN = 0x000037e4;

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
  const r = rng(0xfeed);

  console.log(`\n=== getAlphaTileAddr (FUN_37E4) — ${n} cases ===`);
  let ok = 0;
  for (let i = 0; i < n; i++) {
    cpu.system.setRegister("sp", 0x401f00);
    const rot = Math.floor(r() * 8);
    pokeMem(cpu, 0x00401F42, 2, rot);
    stateInst.workRam[0x1F42] = 0; stateInst.workRam[0x1F43] = rot;
    const col = Math.floor(r() * 256) & 0xff;
    const row = Math.floor(r() * 64) & 0xff; // small to keep in alpha range
    const binR = callFunction(cpu, FUN, [col, row]);
    const tsR = alphaTilemap.getAlphaTileAddr(stateInst, tsRom, col, row);
    if ((binR.d0 >>> 0) === (tsR >>> 0)) ok++;
  }
  console.log(`  Match: ${ok}/${n} = ${((ok/n)*100).toFixed(1)}%`);

  disposeCpu(cpu);
  exit(ok === n ? 0 : 1);
}

main().catch(e => { console.error(e); exit(1); });
