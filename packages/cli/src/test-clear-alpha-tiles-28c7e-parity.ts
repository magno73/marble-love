#!/usr/bin/env node
/**
 * Differential parity for the no-argument main-loop wrapper of FUN_28C7E.
 *
 * The binary function receives one long argument; main-loop-init callsites push
 * zero, so every case calls the oracle with arg 0 and compares alpha RAM after
 * `clearAlphaTiles28C7E(state)`.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import { clearAlphaTiles28C7E as clearNs, state as stateNs } from "@marble-love/engine";
import { callFunction, createCpu, disposeCpu, peekMem, pokeMem } from "./binary-oracle-lib.js";

const FUN_28C7E = 0x00028c7e;
const ALPHA_BASE = 0x00a03000;
const ALPHA_LEN = 0x1000;

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
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  throw new Error("ROM blob not found; set MARBLE_ROM_BLOB or keep ghidra_project/marble_program.bin in the repo.");
}

async function main(): Promise<void> {
  const n = Number(process.argv[2] ?? "500");
  const rom = readFileSync(findRomBlobPath());
  const binState = stateNs.emptyGameState();
  const tsState = stateNs.emptyGameState();
  const cpu = await createCpu({ rom, state: binState });
  const rng = makeRng(0x28c7e);

  let ok = 0;
  let firstFail: { caseNo: number; offset: number; bin: number; ts: number } | null = null;

  for (let i = 0; i < n; i++) {
    cpu.system.setRegister("sp", 0x00401f00);

    for (let j = 0; j < ALPHA_LEN; j++) {
      const v = Math.floor(rng() * 256) & 0xff;
      pokeMem(cpu, ALPHA_BASE + j, 1, v);
      tsState.alphaRam[j] = v;
    }

    callFunction(cpu, FUN_28C7E, [0], 500_000);
    clearNs.clearAlphaTiles28C7E(tsState);

    let match = true;
    for (let j = 0; j < ALPHA_LEN; j++) {
      const bin = peekMem(cpu, ALPHA_BASE + j, 1) & 0xff;
      const ts = tsState.alphaRam[j] ?? 0;
      if (bin !== ts) {
        firstFail ??= { caseNo: i, offset: j, bin, ts };
        match = false;
        break;
      }
    }
    if (match) ok++;
  }

  console.log(`\n=== clearAlphaTiles28C7E (FUN_28C7E) — ${n} casi ===`);
  console.log(`  Match: ${ok}/${n} = ${((ok / n) * 100).toFixed(1)}%`);
  if (firstFail) console.log(`  First fail: ${JSON.stringify(firstFail)}`);
  disposeCpu(cpu);
  exit(ok === n ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  exit(1);
});
