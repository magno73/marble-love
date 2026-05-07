#!/usr/bin/env node
/**
 * test-tilemap-row-build-1a444-parity.ts — differential FUN_1A444 vs TS.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import { bus as busNs, state as stateNs, tilemapRowBuild1A444 as rowNs } from "@marble-love/engine";
import { callFunction, createCpu, disposeCpu, peekMem, pokeMem } from "./binary-oracle-lib.js";

const FUN_1A444 = 0x0001a444;
const PATCHED_JSRS = [0x0002ffb8, 0x0001ad54, 0x0001aa38] as const;
const STRUCT = 0x00400800;
const LIST = 0x00400900;
const PF_BASE = 0x00a00000;
const ROM_STRUCT = 0x0002c54c;
const ROM_LIST = 0x00030000;

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
  if (addr >= 0x00400000 && addr < 0x00402000) {
    binState.workRam[addr - 0x00400000] = v;
    tsState.workRam[addr - 0x00400000] = v;
  } else if (addr >= 0x00a00000 && addr < 0x00a02000) {
    binState.playfieldRam[addr - 0x00a00000] = v;
    tsState.playfieldRam[addr - 0x00a00000] = v;
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

function writeBothRomByte(
  cpu: Awaited<ReturnType<typeof createCpu>>,
  tsRom: ReturnType<typeof busNs.emptyRomImage>,
  addr: number,
  value: number,
): void {
  const v = value & 0xff;
  pokeMem(cpu, addr, 1, v);
  tsRom.program[addr] = v;
}

function writeBothRomWord(
  cpu: Awaited<ReturnType<typeof createCpu>>,
  tsRom: ReturnType<typeof busNs.emptyRomImage>,
  addr: number,
  value: number,
): void {
  writeBothRomByte(cpu, tsRom, addr, value >>> 8);
  writeBothRomByte(cpu, tsRom, addr + 1, value);
}

function writeBothRomLong(
  cpu: Awaited<ReturnType<typeof createCpu>>,
  tsRom: ReturnType<typeof busNs.emptyRomImage>,
  addr: number,
  value: number,
): void {
  writeBothRomByte(cpu, tsRom, addr, value >>> 24);
  writeBothRomByte(cpu, tsRom, addr + 1, value >>> 16);
  writeBothRomByte(cpu, tsRom, addr + 2, value >>> 8);
  writeBothRomByte(cpu, tsRom, addr + 3, value);
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
  const rng = makeRng(0x1a444);

  let ok = 0;
  let firstFail: { caseNo: number; kind: string; bin: number; ts: number } | null = null;
  const compareOffsets = [0x03f0, 0x065e, 0x065f, 0x0660, 0x0661];

  for (let i = 0; i < n; i++) {
    cpu.system.setRegister("sp", 0x401f00);
    for (let j = 0; j < 0x2000; j++) writeBothByte(cpu, binState, tsState, 0x00400000 + j, 0);
    for (let j = 0; j < 0x2000; j++) writeBothByte(cpu, binState, tsState, PF_BASE + j, 0xcc);

    const useRomDescriptor = (i % 5) === 0;
    const levelIndex = useRomDescriptor ? Math.floor(rng() * 6) : Math.floor(rng() * 4);

    writeBothWord(cpu, binState, tsState, 0x00400394, levelIndex);
    writeBothWord(cpu, binState, tsState, 0x00400662, Math.floor(rng() * 0x10000));

    if (useRomDescriptor) {
      writeBothLong(cpu, binState, tsState, 0x00400474, ROM_STRUCT);
      writeBothLong(cpu, binState, tsState, 0x0040065a, 0x00401200);
      writeBothRomLong(cpu, tsRom, ROM_STRUCT + 0x08, ROM_LIST);
      writeBothRomWord(cpu, tsRom, ROM_STRUCT + 0x18, 0x0018);
      writeBothRomWord(cpu, tsRom, ROM_STRUCT + 0x1a, 0x0000);
      writeBothRomLong(cpu, tsRom, ROM_STRUCT + 0x1c, 0x00401400);
      writeBothRomWord(cpu, tsRom, ROM_STRUCT + 0x24, Math.floor(rng() * 16));
      writeBothRomWord(cpu, tsRom, ROM_LIST, 0xffff);
    } else {
      writeBothLong(cpu, binState, tsState, 0x00400474, STRUCT);
      writeBothLong(cpu, binState, tsState, 0x0040065a, 0x00401200);
      writeBothLong(cpu, binState, tsState, STRUCT + 0x08, LIST);
      writeBothWord(cpu, binState, tsState, STRUCT + 0x18, 0x0018);
      writeBothWord(cpu, binState, tsState, STRUCT + 0x1a, 0x0000);
      writeBothLong(cpu, binState, tsState, STRUCT + 0x1c, 0x00401400);
      writeBothWord(cpu, binState, tsState, STRUCT + 0x24, Math.floor(rng() * 16));
      writeBothWord(cpu, binState, tsState, LIST, 0xffff);
    }
    for (let j = 0; j < 0x30; j += 2) writeBothWord(cpu, binState, tsState, 0x00400478 + j, Math.floor(rng() * 0x10000));

    callFunction(cpu, FUN_1A444, [], 2_000_000);
    rowNs.buildTilemapRows1A444(tsState, tsRom);

    let match = true;
    for (const off of compareOffsets) {
      const bin = peekMem(cpu, 0x00400000 + off, 1);
      const ts = tsState.workRam[off] ?? 0;
      if (bin !== ts) {
        firstFail ??= { caseNo: i, kind: `work@${off.toString(16)}`, bin, ts };
        match = false;
        break;
      }
    }
    for (let j = 0; match && j < 0x2000; j++) {
      const bin = peekMem(cpu, PF_BASE + j, 1);
      const ts = tsState.playfieldRam[j] ?? 0;
      if (bin !== ts) {
        firstFail ??= { caseNo: i, kind: `pf@${j.toString(16)}`, bin, ts };
        match = false;
      }
    }
    if (match) ok++;
  }

  console.log(`\n=== buildTilemapRows1A444 (FUN_1A444) — ${n} casi ===`);
  console.log(`  Match: ${ok}/${n} = ${((ok / n) * 100).toFixed(1)}%`);
  if (firstFail) console.log(`  First fail: ${JSON.stringify(firstFail)}`);
  disposeCpu(cpu);
  exit(ok === n ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  exit(1);
});
