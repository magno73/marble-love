#!/usr/bin/env node
/**
 * test-level-dispatcher-16ec6-parity.ts — differential FUN_16EC6 vs TS.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import { bus as busNs, levelDispatcher16EC6 as levelNs, state as stateNs } from "@marble-love/engine";
import { callFunction, createCpu, disposeCpu, peekMem, pokeMem } from "./binary-oracle-lib.js";

const FUN_16EC6 = 0x00016ec6;
const PATCHED_JSRS = [0x0002ffb8, 0x0002ff28, 0x00018fd0, 0x0001a444] as const;

const WORK_RAM_BASE = 0x00400000;
const COMPARE_OFFSETS = [
  0x0474, 0x0475, 0x0476, 0x0477,
  0x065a, 0x065b, 0x065c, 0x065d,
  0x0662, 0x0663, 0x0664, 0x0665,
  0x097c, 0x097d, 0x097e, 0x097f,
] as const;

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

function writeBothByte(
  cpu: Awaited<ReturnType<typeof createCpu>>,
  binState: ReturnType<typeof stateNs.emptyGameState>,
  tsState: ReturnType<typeof stateNs.emptyGameState>,
  addr: number,
  value: number,
): void {
  const v = value & 0xff;
  pokeMem(cpu, addr, 1, v);
  if (addr >= WORK_RAM_BASE && addr < WORK_RAM_BASE + 0x2000) {
    binState.workRam[addr - WORK_RAM_BASE] = v;
    tsState.workRam[addr - WORK_RAM_BASE] = v;
  }
}

function writeBothWord(
  cpu: Awaited<ReturnType<typeof createCpu>>,
  binState: ReturnType<typeof stateNs.emptyGameState>,
  tsState: ReturnType<typeof stateNs.emptyGameState>,
  addr: number,
  value: number,
): void {
  writeBothByte(cpu, binState, tsState, addr, value >>> 8);
  writeBothByte(cpu, binState, tsState, addr + 1, value);
}

async function main(): Promise<void> {
  const n = Number(process.argv[2] ?? "500");
  const rom = readFileSync(findRomBlobPath());
  const tsRom = busNs.emptyRomImage();
  tsRom.program.set(rom.subarray(0, tsRom.program.length));
  const binState = stateNs.emptyGameState();
  const tsState = stateNs.emptyGameState();
  const cpu = await createCpu({ rom, state: binState });
  for (const addr of PATCHED_JSRS) {
    pokeMem(cpu, addr, 1, 0x4e);
    pokeMem(cpu, addr + 1, 1, 0x75);
  }
  const rng = makeRng(0x16ec6);

  let ok = 0;
  let firstFail: { caseNo: number; kind: string; bin: number; ts: number } | null = null;

  for (let i = 0; i < n; i++) {
    cpu.system.setRegister("sp", 0x401f00);
    for (let j = 0; j < 0x2000; j++) writeBothByte(cpu, binState, tsState, WORK_RAM_BASE + j, 0);

    writeBothWord(cpu, binState, tsState, WORK_RAM_BASE + 0x0394, Math.floor(rng() * 6));
    writeBothWord(cpu, binState, tsState, WORK_RAM_BASE + 0x0664, Math.floor(rng() * 0x10000));

    callFunction(cpu, FUN_16EC6, [], 500_000);
    levelNs.levelDispatcher16EC6(tsState, tsRom, { fun_18fd0: () => undefined });

    let match = true;
    for (const off of COMPARE_OFFSETS) {
      const bin = peekMem(cpu, WORK_RAM_BASE + off, 1);
      const ts = tsState.workRam[off] ?? 0;
      if (bin !== ts) {
        firstFail ??= { caseNo: i, kind: `work@${off.toString(16)}`, bin, ts };
        match = false;
        break;
      }
    }
    if (match) ok++;
  }

  console.log(`\n=== levelDispatcher16EC6 (FUN_16EC6) — ${n} casi ===`);
  console.log(`  Match: ${ok}/${n} = ${((ok / n) * 100).toFixed(1)}%`);
  if (firstFail) console.log(`  First fail: ${JSON.stringify(firstFail)}`);
  disposeCpu(cpu);
  exit(ok === n ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  exit(1);
});
