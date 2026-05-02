#!/usr/bin/env node
/**
 * test-math-helpers-parity.ts — differential FUN_1216A/FUN_1B5A6 (abs) +
 * FUN_1B5B4 (negateIfPositive).
 *
 * Tutte le funzioni: 1 long arg, ritornano long in D0.
 *
 * Uso: npx tsx packages/cli/src/test-math-helpers-parity.ts [N]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import { state as stateNs, mathHelpers } from "@marble-love/engine";
import {
  createCpu,
  callFunction,
  disposeCpu,
} from "./binary-oracle-lib.js";

const FUN_ABS_A = 0x0001216A;
const FUN_ABS_B = 0x0001B5A6;
const FUN_NEG_IF_POS = 0x0001B5B4;

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) >>> 0;
    return ((s >>> 16) & 0xffff) / 0x10000;
  };
}

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

  const rng = makeRng(0xfade);

  function diffFn(label: string, addr: number, tsFn: (v: number) => number): boolean {
    console.log(`\n=== ${label} — ${n} casi ===`);
    let ok = 0;
    let firstFail: { input: number; bin: number; ts: number } | null = null;

    // Edge cases: 0, INT_MAX, INT_MIN, -1, 1
    const edgeCases = [0, 1, -1 >>> 0, 0x7FFFFFFF, 0x80000000, 0x80000001, 0xFFFFFFFE];

    for (let i = 0; i < n; i++) {
      cpu.system.setRegister("sp", 0x401f00);
      const input = i < edgeCases.length ? edgeCases[i]! : (Math.floor(rng() * 0x100000000) >>> 0);

      const r = callFunction(cpu, addr, [input]);
      const binD0 = r.d0 >>> 0;
      const tsD0 = tsFn(input);

      if (binD0 === tsD0) ok++;
      else if (firstFail === null) firstFail = { input, bin: binD0, ts: tsD0 };
    }
    console.log(`  Match: ${ok}/${n} = ${((ok / n) * 100).toFixed(1)}%`);
    if (firstFail) {
      const { input, bin, ts } = firstFail;
      console.log(`  First fail: input=0x${input.toString(16)} bin=0x${bin.toString(16)} ts=0x${ts.toString(16)}`);
    }
    return ok === n;
  }

  const a = diffFn("absLong (FUN_1216A)", FUN_ABS_A, mathHelpers.absLong);
  const b = diffFn("absLong (FUN_1B5A6)", FUN_ABS_B, mathHelpers.absLong);
  const c = diffFn("negateIfPositive (FUN_1B5B4)", FUN_NEG_IF_POS, mathHelpers.negateIfPositive);

  disposeCpu(cpu);
  exit(a && b && c ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  exit(1);
});
