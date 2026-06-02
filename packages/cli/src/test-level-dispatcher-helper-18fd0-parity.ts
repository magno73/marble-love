#!/usr/bin/env node
/**
 * test-level-dispatcher-helper-18fd0-parity.ts — differential FUN_18FD0 vs TS.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import { bus as busNs, levelDispatcherHelper18FD0 as helperNs, state as stateNs } from "@marble-love/engine";
import { callFunction, createCpu, disposeCpu, peekMem, pokeMem } from "./binary-oracle-lib.js";

const FUN_18FD0 = 0x00018fd0;
const WORK_RAM_BASE = 0x00400000;
const WR_HEADER = 0x00401d00;
const WR_SOURCE = 0x00401d80;
const ROM_HEADER = 0x00030000;
const ROM_SOURCE = 0x00030100;

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
  abs: number,
  value: number,
): void {
  const v = value & 0xff;
  pokeMem(cpu, abs, 1, v);
  if (abs >= WORK_RAM_BASE && abs < WORK_RAM_BASE + 0x2000) {
    binState.workRam[abs - WORK_RAM_BASE] = v;
    tsState.workRam[abs - WORK_RAM_BASE] = v;
  }
}

function writeBothWord(
  cpu: Awaited<ReturnType<typeof createCpu>>,
  binState: ReturnType<typeof stateNs.emptyGameState>,
  tsState: ReturnType<typeof stateNs.emptyGameState>,
  abs: number,
  value: number,
): void {
  writeBothByte(cpu, binState, tsState, abs, value >>> 8);
  writeBothByte(cpu, binState, tsState, abs + 1, value);
}

function writeBothLong(
  cpu: Awaited<ReturnType<typeof createCpu>>,
  binState: ReturnType<typeof stateNs.emptyGameState>,
  tsState: ReturnType<typeof stateNs.emptyGameState>,
  abs: number,
  value: number,
): void {
  writeBothByte(cpu, binState, tsState, abs, value >>> 24);
  writeBothByte(cpu, binState, tsState, abs + 1, value >>> 16);
  writeBothByte(cpu, binState, tsState, abs + 2, value >>> 8);
  writeBothByte(cpu, binState, tsState, abs + 3, value);
}

function writeBothRomByte(
  cpu: Awaited<ReturnType<typeof createCpu>>,
  tsRom: ReturnType<typeof busNs.emptyRomImage>,
  abs: number,
  value: number,
): void {
  const v = value & 0xff;
  pokeMem(cpu, abs, 1, v);
  tsRom.program[abs] = v;
}

function writeBothRomWord(
  cpu: Awaited<ReturnType<typeof createCpu>>,
  tsRom: ReturnType<typeof busNs.emptyRomImage>,
  abs: number,
  value: number,
): void {
  writeBothRomByte(cpu, tsRom, abs, value >>> 8);
  writeBothRomByte(cpu, tsRom, abs + 1, value);
}

function writeBothRomLong(
  cpu: Awaited<ReturnType<typeof createCpu>>,
  tsRom: ReturnType<typeof busNs.emptyRomImage>,
  abs: number,
  value: number,
): void {
  writeBothRomByte(cpu, tsRom, abs, value >>> 24);
  writeBothRomByte(cpu, tsRom, abs + 1, value >>> 16);
  writeBothRomByte(cpu, tsRom, abs + 2, value >>> 8);
  writeBothRomByte(cpu, tsRom, abs + 3, value);
}

async function main(): Promise<void> {
  const n = Number(process.argv[2] ?? "500");
  const romBytes = readFileSync(findRomBlobPath());
  const tsRom = busNs.emptyRomImage();
  tsRom.program.set(romBytes.subarray(0, tsRom.program.length));
  const binState = stateNs.emptyGameState();
  const tsState = stateNs.emptyGameState();
  const cpu = await createCpu({ rom: romBytes, state: binState });
  const rng = makeRng(0x18fd0);

  let ok = 0;
  let firstFail: { caseNo: number; off: number; bin: number; ts: number } | null = null;

  for (let i = 0; i < n; i++) {
    cpu.system.setRegister("sp", 0x401f00);
    for (let j = 0; j < 0x2000; j++) writeBothByte(cpu, binState, tsState, WORK_RAM_BASE + j, 0x55);
    const useRom = (i % 5) === 0;
    const header = useRom ? ROM_HEADER : WR_HEADER;
    const source = useRom ? ROM_SOURCE : WR_SOURCE;
    writeBothLong(cpu, binState, tsState, 0x00400474, header);
    if (useRom) writeBothRomLong(cpu, tsRom, header + 0x0c, source);
    else writeBothLong(cpu, binState, tsState, header + 0x0c, source);

    let totalWords = 0;
    let src = source;
    const pairs = 1 + Math.floor(rng() * 4);
    for (let p = 0; p < pairs; p++) {
      const count = 1 + Math.floor(rng() * 5);
      const value = Math.floor(rng() * 0x10000) & 0xffff;
      totalWords += count;
      if (useRom) {
        writeBothRomWord(cpu, tsRom, src, count);
        writeBothRomWord(cpu, tsRom, src + 2, value);
      } else {
        writeBothWord(cpu, binState, tsState, src, count);
        writeBothWord(cpu, binState, tsState, src + 2, value);
      }
      src += 4;
    }
    if (useRom) writeBothRomWord(cpu, tsRom, src, 0);
    else writeBothWord(cpu, binState, tsState, src, 0);

    callFunction(cpu, FUN_18FD0, [], 500_000);
    helperNs.levelDispatcherHelper18FD0(tsState, tsRom);

    let match = true;
    const compareBytes = Math.max(0x40, totalWords * 2 + 8);
    for (let off = 0; off < compareBytes; off++) {
      const bin = peekMem(cpu, 0x00400478 + off, 1);
      const ts = tsState.workRam[0x0478 + off] ?? 0;
      if (bin !== ts) {
        firstFail ??= { caseNo: i, off, bin, ts };
        match = false;
        break;
      }
    }
    if (match) ok++;
  }

  console.log(`\n=== levelDispatcherHelper18FD0 (FUN_18FD0) — ${n} cases ===`);
  console.log(`  Match: ${ok}/${n} = ${((ok / n) * 100).toFixed(1)}%`);
  if (firstFail) console.log(`  First fail: ${JSON.stringify(firstFail)}`);
  disposeCpu(cpu);
  exit(ok === n ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  exit(1);
});
