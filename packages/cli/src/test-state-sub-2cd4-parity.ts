#!/usr/bin/env node
/**
 * test-state-sub-2cd4-parity.ts — differential FUN_2CD4 vs stateSub2CD4.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import { bus as busNs, state as stateNs, stateSub2CD4 as sub2CD4Ns } from "@marble-love/engine";
import { callFunction, createCpu, disposeCpu, peekMem, pokeMem } from "./binary-oracle-lib.js";

const FUN_2CD4 = 0x00002cd4;
const STRUCT = 0x00401d00;
const STRING_ADDR = 0x00401d40;

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
  } else if (addr >= 0x00a03000 && addr < 0x00a04000) {
    binState.alphaRam[addr - 0x00a03000] = v;
    tsState.alphaRam[addr - 0x00a03000] = v;
  }
}

async function main(): Promise<void> {
  const n = Number(process.argv[2] ?? "500");
  const rom = readFileSync(findRomBlobPath());
  const tsRom = busNs.emptyRomImage();
  tsRom.program.set(rom.subarray(0, tsRom.program.length));

  const binState = stateNs.emptyGameState();
  const tsState = stateNs.emptyGameState();
  const cpu = await createCpu({ rom, state: binState });
  const rng = makeRng(0x2cd4);

  let ok = 0;
  let firstFail: { caseNo: number; kind: string; bin: number; ts: number; rot: number; charIdx: number } | null = null;

  for (let i = 0; i < n; i++) {
    cpu.system.setRegister("sp", 0x401f00);
    const rot = Math.floor(rng() * 8);
    const col = Math.floor(rng() * 32);
    const tickOff = Math.floor(rng() * 16);
    const slen = 5 + Math.floor(rng() * 8);
    const charIdx = Math.floor(rng() * (slen + 2));
    const attr = Math.floor(rng() * 0x10000);

    pokeMem(cpu, 0x00401f42, 2, rot);
    binState.workRam[0x1f42] = 0;
    binState.workRam[0x1f43] = rot;
    tsState.workRam[0x1f42] = 0;
    tsState.workRam[0x1f43] = rot;

    writeBothByte(cpu, binState, tsState, STRUCT + 0, col);
    writeBothByte(cpu, binState, tsState, STRUCT + 1, tickOff);
    pokeMem(cpu, STRUCT + 2, 4, STRING_ADDR);
    binState.workRam[0x1d02] = 0;
    binState.workRam[0x1d03] = 0x40;
    binState.workRam[0x1d04] = 0x1d;
    binState.workRam[0x1d05] = 0x40;
    tsState.workRam[0x1d02] = 0;
    tsState.workRam[0x1d03] = 0x40;
    tsState.workRam[0x1d04] = 0x1d;
    tsState.workRam[0x1d05] = 0x40;

    for (let j = 0; j < slen; j++) {
      writeBothByte(cpu, binState, tsState, STRING_ADDR + j, 0x40 + Math.floor(rng() * 60));
    }
    writeBothByte(cpu, binState, tsState, STRING_ADDR + slen, 0);

    for (let j = 0; j < 0x1000; j++) {
      writeBothByte(cpu, binState, tsState, 0x00a03000 + j, 0xcc);
    }

    const binR = callFunction(cpu, FUN_2CD4, [STRUCT, attr, charIdx]);
    const tsR = sub2CD4Ns.stateSub2CD4(tsState, tsRom, STRUCT, attr, charIdx);

    let match = (binR.d0 & 0xff) === (tsR & 0xff);
    if (!match) firstFail ??= { caseNo: i, kind: "d0", bin: binR.d0 & 0xff, ts: tsR & 0xff, rot, charIdx };

    for (let j = 0; match && j < 0x1000; j++) {
      const bin = peekMem(cpu, 0x00a03000 + j, 1);
      const ts = tsState.alphaRam[j] ?? 0;
      if (bin !== ts) {
        firstFail ??= { caseNo: i, kind: `alpha@${j}`, bin, ts, rot, charIdx };
        match = false;
      }
    }
    if (match) ok++;
  }

  console.log(`\n=== stateSub2CD4 (FUN_2CD4) — ${n} cases ===`);
  console.log(`  Match: ${ok}/${n} = ${((ok / n) * 100).toFixed(1)}%`);
  if (firstFail) console.log(`  First fail: ${JSON.stringify(firstFail)}`);
  disposeCpu(cpu);
  exit(ok === n ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  exit(1);
});
