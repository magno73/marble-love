#!/usr/bin/env node
/**
 * test-event-flags-parity.ts — differential FUN_2548 vs consumeEventFlag.
 *
 * Per N flag word casuali: setto *0x400006, callFunction(0x2548), confronto:
 *   - D0 (return value, 0 o 1)
 *   - *0x400006 dopo (shifted right by 1)
 *
 * Uso: npx tsx packages/cli/src/test-event-flags-parity.ts [N]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import { state as stateNs, eventFlags } from "@marble-love/engine";
import {
  createCpu,
  callFunction,
  pokeMem,
  peekMem,
  disposeCpu,
} from "./binary-oracle-lib.js";

const FUN_CONSUME = 0x00002548;

async function main(): Promise<void> {
  const n = Number(process.argv[2] ?? "500");

  const romPath = resolve("ghidra_project/marble_program.bin");
  if (!existsSync(romPath)) {
    console.error(`error: ROM blob not found at ${romPath}`);
    exit(3);
  }
  const rom = readFileSync(romPath);

  const state = stateNs.emptyGameState();
  const cpu = await createCpu({ rom, state });

  console.log(`\n=== consumeEventFlag (FUN_2548) — ${n} casi ===`);

  let s = 0xc0ffee;
  const rng = (): number => {
    s = (s * 1103515245 + 12345) >>> 0;
    return ((s >>> 16) & 0xffff) / 0x10000;
  };

  let ok = 0;
  for (let i = 0; i < n; i++) {
    // Reset SP
    cpu.system.setRegister("sp", 0x401f00);

    const word = Math.floor(rng() * 0x10000) & 0xffff;
    pokeMem(cpu, 0x400006, 2, word);
    state.workRam[0x06] = (word >>> 8) & 0xff;
    state.workRam[0x07] = word & 0xff;

    // Binary
    const r = callFunction(cpu, FUN_CONSUME, []);
    const binaryD0 = r.d0 & 0xffff;
    const binaryWord = peekMem(cpu, 0x400006, 2);

    // TS
    const tsD0 = eventFlags.consumeEventFlag(state);
    const tsWord = ((state.workRam[0x06] ?? 0) << 8) | (state.workRam[0x07] ?? 0);

    const match = binaryD0 === tsD0 && binaryWord === tsWord;
    if (match) ok++;
    else if (ok + 3 > i) {
      console.log(`  case ${i}: input=0x${word.toString(16)}`);
      console.log(`    bin: D0=${binaryD0} word_after=0x${binaryWord.toString(16)}`);
      console.log(`    ts:  D0=${tsD0} word_after=0x${tsWord.toString(16)}`);
    }
  }
  console.log(`  Match: ${ok}/${n} = ${((ok / n) * 100).toFixed(1)}%`);

  disposeCpu(cpu);
  exit(ok === n ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  exit(1);
});
