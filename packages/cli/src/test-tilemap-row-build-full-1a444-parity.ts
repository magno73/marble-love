#!/usr/bin/env node
/**
 * test-tilemap-row-build-full-1a444-parity.ts — differential FUN_1A444 vs TS
 * with the full playfield chain enabled (1AD54 → 1AA38 → 1A9CC).
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import { bus as busNs, state as stateNs, tilemapRowBuild1A444 as rowNs } from "@marble-love/engine";
import { callFunction, createCpu, disposeCpu, peekMem, pokeMem } from "./binary-oracle-lib.js";

const FUN_1A444 = 0x0001a444;
const FUN_2FFB8 = 0x0002ffb8;
const FUN_2BC5C = 0x0002bc5c;
const WORK_RAM_BASE = 0x00400000;
const PF_BASE = 0x00a00000;
const STRUCT = 0x00400800;
const LIST = 0x00400900;
const SCRATCH = 0x00400a9c;
const BSEARCH = 0x00401200;
const DESC_TABLE = 0x00401400;
const PTR_TABLE = 0x00401500;
const DATA_STREAM = 0x00401600;
const PACK_TABLE = 0x00401800;

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

function writeBothLong(
  cpu: Awaited<ReturnType<typeof createCpu>>,
  binState: ReturnType<typeof stateNs.emptyGameState>,
  tsState: ReturnType<typeof stateNs.emptyGameState>,
  addr: number,
  value: number,
): void {
  writeBothByte(cpu, binState, tsState, addr, value >>> 24);
  writeBothByte(cpu, binState, tsState, addr + 1, value >>> 16);
  writeBothByte(cpu, binState, tsState, addr + 2, value >>> 8);
  writeBothByte(cpu, binState, tsState, addr + 3, value);
}

function setupCase(
  cpu: Awaited<ReturnType<typeof createCpu>>,
  binState: ReturnType<typeof stateNs.emptyGameState>,
  tsState: ReturnType<typeof stateNs.emptyGameState>,
  caseNo: number,
): void {
  for (let i = 0; i < 0x2000; i++) writeBothByte(cpu, binState, tsState, WORK_RAM_BASE + i, 0);
  for (let i = 0; i < 0x2000; i++) writeBothByte(cpu, binState, tsState, PF_BASE + i, 0xcc);

  const levelIndex = caseNo % 6;
  const descriptorCount = 1 + (caseNo % 2);
  const bitWord = descriptorCount === 1 ? 0x0001 : 0x0003;

  writeBothWord(cpu, binState, tsState, 0x00400394, levelIndex);
  writeBothWord(cpu, binState, tsState, 0x00400662, 0x0001);
  writeBothLong(cpu, binState, tsState, 0x00400474, STRUCT);
  writeBothLong(cpu, binState, tsState, 0x0040065a, BSEARCH);

  writeBothLong(cpu, binState, tsState, STRUCT + 0x00, PACK_TABLE);
  writeBothLong(cpu, binState, tsState, STRUCT + 0x08, LIST);
  writeBothWord(cpu, binState, tsState, STRUCT + 0x18, 0x0018);
  writeBothWord(cpu, binState, tsState, STRUCT + 0x1a, descriptorCount);
  writeBothLong(cpu, binState, tsState, STRUCT + 0x1c, DESC_TABLE);
  writeBothLong(cpu, binState, tsState, STRUCT + 0x20, PTR_TABLE);
  writeBothWord(cpu, binState, tsState, STRUCT + 0x24, 0x0001);

  writeBothWord(cpu, binState, tsState, LIST, bitWord);
  writeBothWord(cpu, binState, tsState, LIST + 2, 0xffff);

  writeBothWord(cpu, binState, tsState, BSEARCH, 0x0001);
  writeBothWord(cpu, binState, tsState, BSEARCH + 2, 0x0001);

  for (let i = 0; i < descriptorCount; i++) {
    const desc = DESC_TABLE + i * 8;
    writeBothByte(cpu, binState, tsState, desc + 0, caseNo % 3);
    writeBothByte(cpu, binState, tsState, desc + 1, 2 + (caseNo % 2));
    writeBothByte(cpu, binState, tsState, desc + 2, (caseNo + i) % 3);
    writeBothByte(cpu, binState, tsState, desc + 3, 2);
    writeBothWord(cpu, binState, tsState, desc + 4, 0x0000);
    writeBothByte(cpu, binState, tsState, desc + 6, i);
    writeBothByte(cpu, binState, tsState, desc + 7, caseNo % 8);
    writeBothLong(cpu, binState, tsState, PTR_TABLE + i * 4, DATA_STREAM + i * 0x20);
    for (let j = 0; j < 0x20; j++) {
      writeBothByte(cpu, binState, tsState, DATA_STREAM + i * 0x20 + j, 1);
    }
  }

  writeBothLong(cpu, binState, tsState, PACK_TABLE, 0xffffffff);

  for (let i = 0; i < 0x30; i += 2) {
    writeBothWord(cpu, binState, tsState, 0x00400478 + i, 0x0080 + i);
  }
  for (let i = 0; i < 0x420 * 4; i++) {
    writeBothByte(cpu, binState, tsState, SCRATCH + i, 0);
  }
}

async function main(): Promise<void> {
  const n = Number(process.argv[2] ?? "50");
  const rom = readFileSync(findRomBlobPath());
  const tsRom = busNs.emptyRomImage();
  tsRom.program.set(rom.subarray(0, tsRom.program.length));
  const binState = stateNs.emptyGameState();
  const tsState = stateNs.emptyGameState();
  const cpu = await createCpu({ rom, state: binState });
  for (const addr of [FUN_2FFB8, FUN_2BC5C]) {
    pokeMem(cpu, addr, 1, 0x4e);
    pokeMem(cpu, addr + 1, 1, 0x75);
  }

  let ok = 0;
  let firstFail: { caseNo: number; kind: string; off: number; bin: number; ts: number } | null = null;
  for (let i = 0; i < n; i++) {
    cpu.system.setRegister("sp", 0x401f00);
    setupCase(cpu, binState, tsState, i);

    callFunction(cpu, FUN_1A444, [], 5_000_000);
    rowNs.buildTilemapRows1A444(tsState, tsRom, { fun_2ffb8: () => undefined });

    let match = true;
    for (let off = 0; off < 0x2000; off++) {
      const bin = peekMem(cpu, PF_BASE + off, 1);
      const ts = tsState.playfieldRam[off] ?? 0;
      if (bin !== ts) {
        firstFail ??= { caseNo: i, kind: "pf", off, bin, ts };
        match = false;
        break;
      }
    }
    for (let off = 0; match && off < 0x1200; off++) {
      const bin = peekMem(cpu, WORK_RAM_BASE + off, 1);
      const ts = tsState.workRam[off] ?? 0;
      if (bin !== ts) {
        firstFail ??= { caseNo: i, kind: "work", off, bin, ts };
        match = false;
      }
    }
    if (match) ok++;
  }

  console.log(`\n=== buildTilemapRows1A444 full chain — ${n} casi ===`);
  console.log(`  Match: ${ok}/${n} = ${((ok / n) * 100).toFixed(1)}%`);
  if (firstFail) console.log(`  First fail: ${JSON.stringify(firstFail)}`);
  disposeCpu(cpu);
  exit(ok === n ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  exit(1);
});
