#!/usr/bin/env node
/**
 * Differential parity for FUN_26B66 vs bannerHelper26B66.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import { bannerHelper26B66 as bannerNs, state as stateNs } from "@marble-love/engine";
import { callFunction, createCpu, disposeCpu, peekMem, pokeMem } from "./binary-oracle-lib.js";

const FUN_26B66 = 0x00026b66;
const WORK_BASE = 0x00400000;

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

function writeU32Both(
  cpu: Awaited<ReturnType<typeof createCpu>>,
  state: ReturnType<typeof stateNs.emptyGameState>,
  off: number,
  value: number,
): void {
  pokeMem(cpu, WORK_BASE + off, 4, value >>> 0);
  state.workRam[off] = (value >>> 24) & 0xff;
  state.workRam[off + 1] = (value >>> 16) & 0xff;
  state.workRam[off + 2] = (value >>> 8) & 0xff;
  state.workRam[off + 3] = value & 0xff;
}

async function main(): Promise<void> {
  const n = Number(process.argv[2] ?? "500");
  const rom = readFileSync(findRomBlobPath());
  const binState = stateNs.emptyGameState();
  const tsState = stateNs.emptyGameState();
  const cpu = await createCpu({ rom, state: binState });
  const rng = makeRng(0x26b66);

  let ok = 0;
  let firstFail: { caseNo: number; off: number; bin: number; ts: number } | null = null;

  for (let i = 0; i < n; i++) {
    cpu.system.setRegister("sp", 0x00401f00);
    const ptr = 0x0040040c + Math.floor(rng() * 5);
    const arg = Math.floor(rng() * 0x1_0000_0000) >>> 0;
    writeU32Both(cpu, tsState, 0x408, ptr);
    for (let j = 0x40c; j <= 0x40f; j++) {
      const v = Math.floor(rng() * 256) & 0xff;
      pokeMem(cpu, WORK_BASE + j, 1, v);
      tsState.workRam[j] = v;
    }

    callFunction(cpu, FUN_26B66, [arg]);
    bannerNs.bannerHelper26B66(tsState, arg);

    let match = true;
    for (const off of [0x408, 0x409, 0x40a, 0x40b, 0x40c, 0x40d, 0x40e, 0x40f]) {
      const bin = peekMem(cpu, WORK_BASE + off, 1) & 0xff;
      const ts = tsState.workRam[off] ?? 0;
      if (bin !== ts) {
        firstFail ??= { caseNo: i, off, bin, ts };
        match = false;
        break;
      }
    }
    if (match) ok++;
  }

  console.log(`\n=== bannerHelper26B66 (FUN_26B66) — ${n} casi ===`);
  console.log(`  Match: ${ok}/${n} = ${((ok / n) * 100).toFixed(1)}%`);
  if (firstFail) console.log(`  First fail: ${JSON.stringify(firstFail)}`);
  disposeCpu(cpu);
  exit(ok === n ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  exit(1);
});
