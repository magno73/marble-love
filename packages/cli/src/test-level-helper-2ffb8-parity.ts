#!/usr/bin/env node
/**
 * test-level-helper-2ffb8-parity.ts — differential FUN_2FFB8 vs TS wrapper.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import { bus as busNs, levelHelper2FFB8 as helperNs, state as stateNs } from "@marble-love/engine";
import { callFunction, createCpu, disposeCpu } from "./binary-oracle-lib.js";

const FUN_2FFB8 = 0x0002ffb8;

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
  throw new Error("ROM blob not found");
}

async function main(): Promise<void> {
  const n = Number(process.argv[2] ?? "500");
  const romBytes = readFileSync(findRomBlobPath());
  const rom = busNs.emptyRomImage();
  rom.program.set(romBytes.subarray(0, rom.program.length));
  const state = stateNs.emptyGameState();
  const cpu = await createCpu({ rom: romBytes, state });
  const rng = makeRng(0x2ffb8);

  let ok = 0;
  let firstFail: { caseNo: number; argLong: number; bin: number; ts: number } | null = null;

  for (let i = 0; i < n; i++) {
    cpu.system.setRegister("sp", 0x401f00);
    let argWord: number;
    if (i < 16) argWord = i;
    else if (i === 16) argWord = 0x0400;
    else if (i === 17) argWord = 0x0800;
    else argWord = Math.floor(rng() * 0x10000) & 0xffff;
    const argLong = (((argWord & 0xffff) << 16) >> 16) >>> 0;

    cpu.system.setRegister("d0", 0);
    const bin = callFunction(cpu, FUN_2FFB8, [argLong]).d0 & 0xffff;
    const ts = helperNs.levelHelper2FFB8(rom, argLong) & 0xffff;
    if (bin === ts) ok++;
    else firstFail ??= { caseNo: i, argLong, bin, ts };
  }

  console.log(`\n=== levelHelper2FFB8 (FUN_2FFB8) — ${n} casi ===`);
  console.log(`  Match: ${ok}/${n} = ${((ok / n) * 100).toFixed(1)}%`);
  if (firstFail) console.log(`  First fail: ${JSON.stringify(firstFail)}`);
  disposeCpu(cpu);
  exit(ok === n ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  exit(1);
});
