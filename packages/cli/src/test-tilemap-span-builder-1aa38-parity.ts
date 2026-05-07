#!/usr/bin/env node
/**
 * test-tilemap-span-builder-1aa38-parity.ts — differential FUN_1AA38 vs TS.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import { bus as busNs, state as stateNs, tilemapSpanBuilder1AA38 as spanNs } from "@marble-love/engine";
import { callFunction, createCpu, disposeCpu, peekMem, pokeMem } from "./binary-oracle-lib.js";

const FUN_1AA38 = 0x0001aa38;
const WORK_RAM_BASE = 0x00400000;
const SCRATCH = 0x00400a9c;
const STATE_STRUCT = 0x00400800;
const BSEARCH_TABLE = 0x00401000;
const PACK_TABLE = 0x00401800;
const SNAP_LEN = 0x0b0;

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

function setupCase(
  cpu: Awaited<ReturnType<typeof createCpu>>,
  binState: ReturnType<typeof stateNs.emptyGameState>,
  tsState: ReturnType<typeof stateNs.emptyGameState>,
  targetWord: number,
  bitLong: number,
): void {
  for (let i = 0; i < 0x2000; i++) writeBothByte(cpu, binState, tsState, WORK_RAM_BASE + i, 0);
  writeBothLong(cpu, binState, tsState, 0x00400474, STATE_STRUCT);
  writeBothLong(cpu, binState, tsState, STATE_STRUCT, PACK_TABLE);
  writeBothLong(cpu, binState, tsState, 0x0040065a, BSEARCH_TABLE);
  writeBothLong(cpu, binState, tsState, 0x0040065e, BSEARCH_TABLE);
  writeBothWord(cpu, binState, tsState, BSEARCH_TABLE, targetWord);
  writeBothLong(cpu, binState, tsState, PACK_TABLE, 0xffffffff);

  for (let cell = 0; cell < 22; cell++) {
    const base = SCRATCH + cell * 8;
    writeBothWord(cpu, binState, tsState, base, targetWord);
    writeBothWord(cpu, binState, tsState, base + 2, 0);
    writeBothWord(cpu, binState, tsState, base + 4, 0);
    writeBothWord(cpu, binState, tsState, base + 6, 0);
  }
  if (bitLong !== 0) writeBothWord(cpu, binState, tsState, SCRATCH + 21 * 8, 0xbeef);
}

async function main(): Promise<void> {
  const n = Number(process.argv[2] ?? "500");
  const romBytes = readFileSync(findRomBlobPath());
  const rom = busNs.emptyRomImage();
  rom.program.set(romBytes.subarray(0, rom.program.length));
  const binState = stateNs.emptyGameState();
  const tsState = stateNs.emptyGameState();
  const cpu = await createCpu({ rom: romBytes, state: binState });
  const rng = makeRng(0x1aa38);

  let ok = 0;
  let firstFail: { caseNo: number; off: number; bin: number; ts: number } | null = null;

  for (let i = 0; i < n; i++) {
    cpu.system.setRegister("sp", 0x401f00);
    const bitLong = i % 7 === 0 ? 1 : 0;
    const targetWord = i % 11 === 0 ? 0 : 1 + Math.floor(rng() * 0x01ff);
    const rowWord = Math.floor(rng() * 0x10000) & 0xffff;
    setupCase(cpu, binState, tsState, targetWord, bitLong);

    callFunction(cpu, FUN_1AA38, [bitLong, rowWord, SCRATCH], 500_000);
    spanNs.buildTilemapSpan1AA38(tsState, rom, bitLong, rowWord, SCRATCH);

    let match = true;
    for (let off = 0; off < SNAP_LEN; off++) {
      const bin = peekMem(cpu, SCRATCH + off, 1);
      const ts = tsState.workRam[SCRATCH - WORK_RAM_BASE + off] ?? 0;
      if (bin !== ts) {
        firstFail ??= { caseNo: i, off, bin, ts };
        match = false;
        break;
      }
    }
    if (match) ok++;
  }

  console.log(`\n=== buildTilemapSpan1AA38 (FUN_1AA38) — ${n} casi ===`);
  console.log(`  Match: ${ok}/${n} = ${((ok / n) * 100).toFixed(1)}%`);
  if (firstFail) console.log(`  First fail: ${JSON.stringify(firstFail)}`);
  disposeCpu(cpu);
  exit(ok === n ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  exit(1);
});
