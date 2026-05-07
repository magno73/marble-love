#!/usr/bin/env node
/**
 * test-state-sub-2766-parity.ts — differential FUN_2766 vs stateSub2766.
 *
 * FUN_2766 is the state-machine state 5 alpha-string forward shifter.
 * It has no JSRs. The test drives a single-entry chain and compares the full
 * alpha RAM region after binary and TS execution.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import { bus as busNs, state as stateNs, stateSub2766 as sub2766Ns } from "@marble-love/engine";
import { callFunction, createCpu, disposeCpu, peekMem, pokeMem } from "./binary-oracle-lib.js";

const FUN_2766 = 0x00002766;
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
  state: ReturnType<typeof stateNs.emptyGameState>,
  addr: number,
  value: number,
): void {
  const v = value & 0xff;
  pokeMem(cpu, addr, 1, v);
  if (addr >= 0x00400000 && addr < 0x00402000) state.workRam[addr - 0x00400000] = v;
  else if (addr >= 0x00a03000 && addr < 0x00a04000) state.alphaRam[addr - 0x00a03000] = v;
}

async function main(): Promise<void> {
  const n = Number(process.argv[2] ?? "500");
  const rom = readFileSync(findRomBlobPath());
  const tsRom = busNs.emptyRomImage();
  tsRom.program.set(rom.subarray(0, tsRom.program.length));

  const stateInst = stateNs.emptyGameState();
  const cpu = await createCpu({ rom, state: stateInst });
  const rng = makeRng(0x2766);

  let ok = 0;
  let firstFail: { caseNo: number; offset: number; bin: number; ts: number; rot: number; tickOff: number } | null = null;

  for (let i = 0; i < n; i++) {
    cpu.system.setRegister("sp", 0x401f00);
    const rot = Math.floor(rng() * 8);
    const tickOff = Math.floor(rng() * 16);
    const col = Math.floor(rng() * 32);

    pokeMem(cpu, 0x00401f00, 2, 0);
    pokeMem(cpu, 0x00401f42, 2, rot);
    stateInst.workRam[0x1f00] = 0;
    stateInst.workRam[0x1f01] = 0;
    stateInst.workRam[0x1f42] = 0;
    stateInst.workRam[0x1f43] = rot;

    writeBothByte(cpu, stateInst, STRUCT + 0, col);
    writeBothByte(cpu, stateInst, STRUCT + 1, tickOff);
    pokeMem(cpu, STRUCT + 2, 4, STRING_ADDR);
    stateInst.workRam[0x1d02] = 0;
    stateInst.workRam[0x1d03] = 0x40;
    stateInst.workRam[0x1d04] = 0x1d;
    stateInst.workRam[0x1d05] = 0x40;
    writeBothByte(cpu, stateInst, STRUCT + 6, 0);
    pokeMem(cpu, STRUCT + 8, 4, 0);
    stateInst.workRam[0x1d08] = 0;
    stateInst.workRam[0x1d09] = 0;
    stateInst.workRam[0x1d0a] = 0;
    stateInst.workRam[0x1d0b] = 0;
    writeBothByte(cpu, stateInst, STRING_ADDR, 0);

    for (let j = 0; j < 0x1000; j++) {
      const v = Math.floor(rng() * 256) & 0xff;
      writeBothByte(cpu, stateInst, 0x00a03000 + j, v);
    }

    callFunction(cpu, FUN_2766, [STRUCT]);
    sub2766Ns.stateSub2766(stateInst, tsRom, STRUCT);

    let match = true;
    for (let j = 0; j < 0x1000; j++) {
      const bin = peekMem(cpu, 0x00a03000 + j, 1);
      const ts = stateInst.alphaRam[j] ?? 0;
      if (bin !== ts) {
        firstFail ??= { caseNo: i, offset: j, bin, ts, rot, tickOff };
        match = false;
        break;
      }
    }
    if (match) ok++;
  }

  console.log(`\n=== stateSub2766 (FUN_2766) — ${n} casi ===`);
  console.log(`  Match: ${ok}/${n} = ${((ok / n) * 100).toFixed(1)}%`);
  if (firstFail) console.log(`  First fail: ${JSON.stringify(firstFail)}`);
  disposeCpu(cpu);
  exit(ok === n ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  exit(1);
});
