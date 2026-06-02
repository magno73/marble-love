#!/usr/bin/env node
/**
 * Sentinel-call parity for FUN_16F6C vs levelInit16F6C.
 *
 * The internal JSRs are patched to `addq.b #1,sentinel ; rts`; the TS side
 * increments the same sentinels through sub-injection. This validates the body
 * branching and row dispatch count without pretending FUN_1A668 playfield
 * writes are already modeled end-to-end.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import { bus as busNs, levelInit16F6C as levelNs, state as stateNs } from "@marble-love/engine";
import { callFunction, createCpu, disposeCpu, peekMem, pokeMem } from "./binary-oracle-lib.js";

const FUN_16F6C = 0x00016f6c;
const FUN_2FFB8 = 0x0002ffb8;
const FUN_2FF40 = 0x0002ff40;
const FUN_1A668 = 0x0001a668;
const SENT_BASE = 0x004003e0;
const WORK_BASE = 0x00400000;

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
  throw new Error("ROM blob not found; set MARBLE_ROM_BLOB or keep ghidra_project/marble_program.bin in the repo.");
}

function patchStubAddq(rom: Buffer, entry: number, sentinelAddr: number): void {
  rom[entry + 0] = 0x52;
  rom[entry + 1] = 0x39;
  rom[entry + 2] = (sentinelAddr >>> 24) & 0xff;
  rom[entry + 3] = (sentinelAddr >>> 16) & 0xff;
  rom[entry + 4] = (sentinelAddr >>> 8) & 0xff;
  rom[entry + 5] = sentinelAddr & 0xff;
  rom[entry + 6] = 0x4e;
  rom[entry + 7] = 0x75;
}

function writeU16Both(
  cpu: Awaited<ReturnType<typeof createCpu>>,
  state: ReturnType<typeof stateNs.emptyGameState>,
  abs: number,
  value: number,
): void {
  pokeMem(cpu, abs, 2, value & 0xffff);
  state.workRam[abs - WORK_BASE] = (value >>> 8) & 0xff;
  state.workRam[abs - WORK_BASE + 1] = value & 0xff;
}

function incSent(state: ReturnType<typeof stateNs.emptyGameState>, addr: number): void {
  const off = addr - WORK_BASE;
  state.workRam[off] = ((state.workRam[off] ?? 0) + 1) & 0xff;
}

async function main(): Promise<void> {
  const n = Number(process.argv[2] ?? "500");
  const rom = Buffer.from(readFileSync(findRomBlobPath()));
  patchStubAddq(rom, FUN_2FFB8, SENT_BASE + 0);
  patchStubAddq(rom, FUN_2FF40, SENT_BASE + 1);
  patchStubAddq(rom, FUN_1A668, SENT_BASE + 2);

  const tsRom = busNs.emptyRomImage();
  tsRom.program.set(rom.subarray(0, tsRom.program.length));
  const binState = stateNs.emptyGameState();
  const tsState = stateNs.emptyGameState();
  const cpu = await createCpu({ rom, state: binState });
  const rng = makeRng(0x16f6c);

  let ok = 0;
  let firstFail: { caseNo: number; sent: number; bin: number; ts: number; mode: number } | null = null;

  for (let i = 0; i < n; i++) {
    cpu.system.setRegister("sp", 0x00401f00);
    const mode = rng() < 0.5 ? 4 : Math.floor(rng() * 4);
    writeU16Both(cpu, tsState, 0x00400394, mode);
    writeU16Both(cpu, tsState, 0x00400662, Math.floor(rng() * 8));
    writeU16Both(cpu, tsState, 0x00400664, Math.floor(rng() * 8));
    pokeMem(cpu, 0x00400474, 4, 0x0002c54c);
    tsState.workRam[0x474] = 0;
    tsState.workRam[0x475] = 0x02;
    tsState.workRam[0x476] = 0xc5;
    tsState.workRam[0x477] = 0x4c;
    for (let k = 0; k < 3; k++) {
      pokeMem(cpu, SENT_BASE + k, 1, 0);
      tsState.workRam[SENT_BASE - WORK_BASE + k] = 0;
    }

    callFunction(cpu, FUN_16F6C, [], 1_000_000);
    levelNs.levelInit16F6C(tsState, tsRom, {
      fun_2ffb8: () => incSent(tsState, SENT_BASE + 0),
      fun_2ff40: () => incSent(tsState, SENT_BASE + 1),
      fun_1a668: () => incSent(tsState, SENT_BASE + 2),
    });

    let match = true;
    for (let k = 0; k < 3; k++) {
      const bin = peekMem(cpu, SENT_BASE + k, 1) & 0xff;
      const ts = tsState.workRam[SENT_BASE - WORK_BASE + k] ?? 0;
      if (bin !== ts) {
        firstFail ??= { caseNo: i, sent: k, bin, ts, mode };
        match = false;
        break;
      }
    }
    if (match) ok++;
  }

  console.log(`\n=== levelInit16F6C (FUN_16F6C) — ${n} cases ===`);
  console.log(`  Match: ${ok}/${n} = ${((ok / n) * 100).toFixed(1)}%`);
  if (firstFail) console.log(`  First fail: ${JSON.stringify(firstFail)}`);
  disposeCpu(cpu);
  exit(ok === n ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  exit(1);
});
