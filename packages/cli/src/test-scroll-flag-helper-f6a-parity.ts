#!/usr/bin/env node
/**
 * Parity for FUN_00000F6A vs scrollFlagHelperF6A.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import { scrollFlagHelperF6A as helperNs, state as stateNs } from "@marble-love/engine";
import { callFunction, createCpu, disposeCpu, peekMem, pokeMem } from "./binary-oracle-lib.js";

const FUN_F6A = 0x00000f6a;
const FLAG_ABS = 0x00400000;
const PREV_ABS = 0x0040017c;

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) >>> 0;
    return ((s >>> 16) & 0xffff) / 0x10000;
  };
}

function findRomBlobPath(): string {
  const candidates = [
    process.env.MARBLE_ROM_BLOB,
    resolve("ghidra_project/marble_program.bin"),
    resolve("../marble-love/ghidra_project/marble_program.bin"),
  ].filter((p): p is string => p !== undefined && p.length > 0);
  for (const p of candidates) if (existsSync(p)) return p;
  throw new Error("ROM blob not found; set MARBLE_ROM_BLOB or keep ghidra_project/marble_program.bin in the repo.");
}

async function main(): Promise<void> {
  const n = Number(process.argv[2] ?? "500");
  const rom = readFileSync(findRomBlobPath());
  const binState = stateNs.emptyGameState();
  const tsState = stateNs.emptyGameState();
  const cpu = await createCpu({ rom, state: binState });
  const rng = makeRng(0xf6a);

  let ok = 0;
  let firstFail: { caseNo: number; flag: number; prev: number; binD0: number; tsD0: number; binPrev: number; tsPrev: number } | null = null;

  for (let i = 0; i < n; i++) {
    cpu.system.setRegister("sp", 0x00401f00);
    const flag = Math.floor(rng() * 0x10000) & 0xffff;
    const prev = Math.floor(rng() * 0x10000) & 0xffff;

    pokeMem(cpu, FLAG_ABS, 2, flag);
    pokeMem(cpu, PREV_ABS, 2, prev);
    tsState.workRam[0] = (flag >>> 8) & 0xff;
    tsState.workRam[1] = flag & 0xff;
    tsState.workRam[0x17c] = (prev >>> 8) & 0xff;
    tsState.workRam[0x17d] = prev & 0xff;

    const binD0 = callFunction(cpu, FUN_F6A, []).d0 >>> 0;
    const binPrev = peekMem(cpu, PREV_ABS, 2) & 0xffff;
    const tsD0 = helperNs.scrollFlagHelperF6A(tsState) >>> 0;
    const tsPrev = (((tsState.workRam[0x17c] ?? 0) << 8) | (tsState.workRam[0x17d] ?? 0)) & 0xffff;

    if (binD0 === tsD0 && binPrev === tsPrev) ok++;
    else firstFail ??= { caseNo: i, flag, prev, binD0, tsD0, binPrev, tsPrev };
  }

  console.log(`\n=== scrollFlagHelperF6A (FUN_F6A) — ${n} cases ===`);
  console.log(`  Match: ${ok}/${n} = ${((ok / n) * 100).toFixed(1)}%`);
  if (firstFail) console.log(`  First fail: ${JSON.stringify(firstFail)}`);
  disposeCpu(cpu);
  exit(ok === n ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  exit(1);
});
