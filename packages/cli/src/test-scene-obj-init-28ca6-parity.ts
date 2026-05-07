#!/usr/bin/env node
/**
 * Differential parity for `FUN_00028CA6` vs `sceneObjInit28CA6`.
 *
 * Internal JSRs `FUN_1B12A`, `FUN_26F3E`, and `FUN_28DEA` are patched to RTS,
 * matching the TS default no-op sub-injections. Observable side effects are
 * compared across the workRam region touched directly by the function.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import { bus as busNs, state as stateNs, sceneObjInit28CA6 as sceneObjNs } from "@marble-love/engine";
import { callFunction, createCpu, disposeCpu, peekMem, pokeMem } from "./binary-oracle-lib.js";

const FUN_28CA6 = 0x00028ca6;
const FUN_1B12A = 0x0001b12a;
const FUN_26F3E = 0x00026f3e;
const FUN_28DEA = 0x00028dea;

const WORK_RAM_BASE = 0x00400000;
const COMPARE_START = 0x004001dc;
const COMPARE_END = 0x004003f1;

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

function patchRts(rom: Buffer, entry: number): void {
  rom[entry] = 0x4e;
  rom[entry + 1] = 0x75;
}

function writeBothByte(
  cpu: Awaited<ReturnType<typeof createCpu>>,
  state: ReturnType<typeof stateNs.emptyGameState>,
  abs: number,
  value: number,
): void {
  const v = value & 0xff;
  pokeMem(cpu, abs, 1, v);
  if (abs >= WORK_RAM_BASE && abs < 0x00402000) state.workRam[abs - WORK_RAM_BASE] = v;
}

async function main(): Promise<void> {
  const n = Number(process.argv[2] ?? "500");
  const rom = Buffer.from(readFileSync(findRomBlobPath()));
  patchRts(rom, FUN_1B12A);
  patchRts(rom, FUN_26F3E);
  patchRts(rom, FUN_28DEA);

  const tsRom = busNs.emptyRomImage();
  tsRom.program.set(rom.subarray(0, tsRom.program.length));
  const binState = stateNs.emptyGameState();
  const tsState = stateNs.emptyGameState();
  const cpu = await createCpu({ rom, state: binState });
  const rng = makeRng(0x28ca6);

  let ok = 0;
  let firstFail: { caseNo: number; abs: number; bin: number; ts: number } | null = null;

  for (let i = 0; i < n; i++) {
    cpu.system.setRegister("sp", 0x00401f00);
    for (let abs = COMPARE_START; abs < COMPARE_END; abs++) {
      const v = Math.floor(rng() * 256) & 0xff;
      writeBothByte(cpu, tsState, abs, v);
    }

    callFunction(cpu, FUN_28CA6, [], 500_000);
    sceneObjNs.sceneObjInit28CA6(tsState, tsRom);

    let match = true;
    for (let abs = COMPARE_START; abs < COMPARE_END; abs++) {
      const bin = peekMem(cpu, abs, 1) & 0xff;
      const ts = tsState.workRam[abs - WORK_RAM_BASE] ?? 0;
      if (bin !== ts) {
        firstFail ??= { caseNo: i, abs, bin, ts };
        match = false;
        break;
      }
    }
    if (match) ok++;
  }

  console.log(`\n=== sceneObjInit28CA6 (FUN_28CA6) — ${n} casi ===`);
  console.log(`  Match: ${ok}/${n} = ${((ok / n) * 100).toFixed(1)}%`);
  if (firstFail) console.log(`  First fail: ${JSON.stringify(firstFail)}`);
  disposeCpu(cpu);
  exit(ok === n ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  exit(1);
});
