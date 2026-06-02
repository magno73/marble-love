#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import { state as stateNs, paletteInit, bus as busNs } from "@marble-love/engine";
import type { RomImage } from "@marble-love/engine";
import { createCpu, callFunction, pokeMem, peekMem, disposeCpu } from "./binary-oracle-lib.js";

const FUN = 0x0000565a;

async function main(): Promise<void> {
  const rom = readFileSync(resolve("ghidra_project/marble_program.bin"));
  const stateInst = stateNs.emptyGameState();
  const cpu = await createCpu({ rom, state: stateInst });
  const tsRom: RomImage = busNs.emptyRomImage();
  tsRom.program.set(rom.subarray(0, tsRom.program.length));

  console.log(`\n=== paletteInit (FUN_565A) — 1 case ===`);
  cpu.system.setRegister("sp", 0x401f00);
  // Pre-fill palette RAM with sentinel
  for (let j = 0; j < 0x800; j++) {
    pokeMem(cpu, 0xB00000 + j, 1, 0xCC);
    stateInst.colorRam[j] = 0xCC;
  }
  callFunction(cpu, FUN, []);
  paletteInit.paletteInit(stateInst, tsRom);
  let ok = true;
  for (let j = 0; j < 0x800; j++) {
    if (peekMem(cpu, 0xB00000 + j, 1) !== (stateInst.colorRam[j] ?? 0)) {
      console.log(`  Diff @ palette+0x${j.toString(16)}`);
      ok = false; break;
    }
  }
  console.log(`  Match: ${ok ? 1 : 0}/1 = ${ok ? "100.0" : "0.0"}%`);
  disposeCpu(cpu);
  exit(ok ? 0 : 1);
}

main().catch(e => { console.error(e); exit(1); });
