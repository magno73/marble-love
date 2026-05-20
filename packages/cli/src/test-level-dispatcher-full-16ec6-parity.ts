#!/usr/bin/env node
/**
 * test-level-dispatcher-full-16ec6-parity.ts — differential FUN_16EC6 vs TS
 * with helper 18FD0 and the full playfield builder enabled.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import { bus as busNs, levelDispatcher16EC6 as levelNs, state as stateNs } from "@marble-love/engine";
import { callFunction, createCpu, disposeCpu, peekMem, pokeMem } from "./binary-oracle-lib.js";

const FUN_16EC6 = 0x00016ec6;
const WORK_RAM_BASE = 0x00400000;
const PF_BASE = 0x00a00000;
const PATCHED_JSRS = [0x0002ffb8, 0x0002ff28, 0x0002bc5c] as const;

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
  } else if (addr >= PF_BASE && addr < PF_BASE + 0x2000) {
    binState.playfieldRam[addr - PF_BASE] = v;
    tsState.playfieldRam[addr - PF_BASE] = v;
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
  const n = Number(process.argv[2] ?? "6");
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

  let ok = 0;
  let firstFail: { caseNo: number; level: number; kind: string; off: number; bin: number; ts: number } | null = null;
  for (let i = 0; i < n; i++) {
    const level = i % 6;
    cpu.system.setRegister("sp", 0x401f00);
    for (let j = 0; j < 0x2000; j++) writeBothByte(cpu, binState, tsState, WORK_RAM_BASE + j, 0);
    for (let j = 0; j < 0x2000; j++) writeBothByte(cpu, binState, tsState, PF_BASE + j, 0);
    writeBothWord(cpu, binState, tsState, WORK_RAM_BASE + 0x0394, level);

    callFunction(cpu, FUN_16EC6, [], 20_000_000);
    levelNs.levelDispatcher16EC6(tsState, tsRom, {
      fun_2ffb8: () => undefined,
      fun_2ff28: () => undefined,
    });

    let match = true;
    for (let off = 0; off < 0x2000; off++) {
      const bin = peekMem(cpu, PF_BASE + off, 1);
      const ts = tsState.playfieldRam[off] ?? 0;
      if (bin !== ts) {
        firstFail ??= { caseNo: i, level, kind: "pf", off, bin, ts };
        match = false;
        break;
      }
    }
    for (let off = 0; match && off < 0x1200; off++) {
      const bin = peekMem(cpu, WORK_RAM_BASE + off, 1);
      const ts = tsState.workRam[off] ?? 0;
      if (bin !== ts) {
        firstFail ??= { caseNo: i, level, kind: "work", off, bin, ts };
        match = false;
      }
    }
    if (match) ok++;
  }

  console.log(`\n=== levelDispatcher16EC6 full chain — ${n} casi ===`);
  console.log(`  Match: ${ok}/${n} = ${((ok / n) * 100).toFixed(1)}%`);
  if (firstFail) console.log(`  First fail: ${JSON.stringify(firstFail)}`);
  disposeCpu(cpu);
  exit(ok === n ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  exit(1);
});
