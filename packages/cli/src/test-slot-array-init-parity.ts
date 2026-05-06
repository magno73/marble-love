#!/usr/bin/env node
/**
 * test-slot-array-init-parity.ts — differential FUN_10392 vs slotArrayBulkInit.
 *
 * FUN_10392 inizializza 6 slot array a indirizzi fissi. Verifichiamo che
 * tutti i byte modificati combacino byte-byte.
 *
 * Uso: npx tsx packages/cli/src/test-slot-array-init-parity.ts
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import { state as stateNs, slotArrayInit } from "@marble-love/engine";
import {
  createCpu,
  callFunction,
  pokeMem,
  peekMem,
  disposeCpu,
} from "./binary-oracle-lib.js";

const FUN = 0x00010392;

async function main(): Promise<void> {
  const rom = readFileSync(resolve("ghidra_project/marble_program.bin"));
  const stateInst = stateNs.emptyGameState();
  const cpu = await createCpu({ rom, state: stateInst });

  console.log(`\n=== slotArrayBulkInit (FUN_10392) — 1 caso ===`);

  cpu.system.setRegister("sp", 0x401f00);

  // Pre-fill workRam with sentinel pattern, escludendo zona stack
  // (la chiamata callFunction usa stack 68k che lascia residui).
  for (let j = 0; j < 0x1e00; j++) {
    pokeMem(cpu, 0x400000 + j, 1, 0xCC);
    stateInst.workRam[j] = 0xCC;
  }

  callFunction(cpu, FUN, []);
  slotArrayInit.slotArrayBulkInit(stateInst);

  let match = true;
  let firstDiff = -1;
  for (let j = 0; j < 0x1e00; j++) {
    const b = peekMem(cpu, 0x400000 + j, 1);
    const t = stateInst.workRam[j] ?? 0;
    if (b !== t) {
      match = false; firstDiff = j;
      console.log(`  diff @ 0x${(0x400000 + j).toString(16)}: bin=0x${b.toString(16)} ts=0x${t.toString(16)}`);
      break;
    }
  }

  console.log(`  Match: ${match ? 1 : 0}/1`);
  if (!match) console.log(`  First diff offset: 0x${firstDiff.toString(16)}`);

  disposeCpu(cpu);
  exit(match ? 0 : 1);
}

main().catch(e => { console.error(e); exit(1); });
