#!/usr/bin/env node
/**
 * Direct-effect parity for FUN_259B4 vs objectInit259B4.
 *
 * Heavy internal JSRs are patched to RTS, except FUN_1CC62 which returns a
 * deterministic long. The TS side mirrors this through sub-injection and the
 * comparison covers object slots plus globals touched directly by FUN_259B4.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import { bus as busNs, objectInit259B4 as objNs, state as stateNs } from "@marble-love/engine";
import { callFunction, createCpu, disposeCpu, peekMem, pokeMem } from "./binary-oracle-lib.js";

const FUN_259B4 = 0x000259b4;
const FUN_1BAB2 = 0x0001bab2;
const FUN_1CC62 = 0x0001cc62;
const FUN_25B40 = 0x00025b40;
const FUN_1B9CC = 0x0001b9cc;
const FUN_1C014 = 0x0001c014;
const FUN_1281C = 0x0001281c;
const FUN_18E6C = 0x00018e6c;
const WORK_BASE = 0x00400000;
const OBJ_BASE = 0x00400018;
const OBJ_STRIDE = 0x00e2;
const RETURN_1CC62 = 0x13572468;

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

function patchRts(rom: Buffer, addr: number): void {
  rom[addr] = 0x4e;
  rom[addr + 1] = 0x75;
}

function patchReturnD0(rom: Buffer, addr: number, value: number): void {
  rom[addr + 0] = 0x20;
  rom[addr + 1] = 0x3c;
  rom[addr + 2] = (value >>> 24) & 0xff;
  rom[addr + 3] = (value >>> 16) & 0xff;
  rom[addr + 4] = (value >>> 8) & 0xff;
  rom[addr + 5] = value & 0xff;
  rom[addr + 6] = 0x4e;
  rom[addr + 7] = 0x75;
}

function writeBothByte(
  cpu: Awaited<ReturnType<typeof createCpu>>,
  state: ReturnType<typeof stateNs.emptyGameState>,
  abs: number,
  value: number,
): void {
  const v = value & 0xff;
  pokeMem(cpu, abs, 1, v);
  state.workRam[abs - WORK_BASE] = v;
}

function writeBothWord(
  cpu: Awaited<ReturnType<typeof createCpu>>,
  state: ReturnType<typeof stateNs.emptyGameState>,
  abs: number,
  value: number,
): void {
  const v = value & 0xffff;
  pokeMem(cpu, abs, 2, v);
  state.workRam[abs - WORK_BASE] = (v >>> 8) & 0xff;
  state.workRam[abs - WORK_BASE + 1] = v & 0xff;
}

function writeBothLong(
  cpu: Awaited<ReturnType<typeof createCpu>>,
  state: ReturnType<typeof stateNs.emptyGameState>,
  abs: number,
  value: number,
): void {
  const v = value >>> 0;
  pokeMem(cpu, abs, 4, v);
  state.workRam[abs - WORK_BASE] = (v >>> 24) & 0xff;
  state.workRam[abs - WORK_BASE + 1] = (v >>> 16) & 0xff;
  state.workRam[abs - WORK_BASE + 2] = (v >>> 8) & 0xff;
  state.workRam[abs - WORK_BASE + 3] = v & 0xff;
}

async function main(): Promise<void> {
  const n = Number(process.argv[2] ?? "500");
  const rom = Buffer.from(readFileSync(findRomBlobPath()));
  for (const addr of [FUN_1BAB2, FUN_25B40, FUN_1B9CC, FUN_1C014, FUN_1281C, FUN_18E6C]) patchRts(rom, addr);
  patchReturnD0(rom, FUN_1CC62, RETURN_1CC62);

  const tsRom = busNs.emptyRomImage();
  tsRom.program.set(rom.subarray(0, tsRom.program.length));
  const binState = stateNs.emptyGameState();
  const tsState = stateNs.emptyGameState();
  const cpu = await createCpu({ rom, state: binState });
  const rng = makeRng(0x259b4);

  let ok = 0;
  let firstFail: { caseNo: number; abs: number; bin: number; ts: number; count: number; mode: number } | null = null;

  for (let i = 0; i < n; i++) {
    cpu.system.setRegister("sp", 0x00401f00);
    const count = Math.floor(rng() * 3);
    const mode = Math.floor(rng() * 5);
    writeBothWord(cpu, tsState, 0x00400396, count);
    writeBothWord(cpu, tsState, 0x00400394, mode);
    writeBothLong(cpu, tsState, 0x00400474, 0x00400800);
    for (let j = 0; j < 6; j++) writeBothWord(cpu, tsState, 0x00400814 + j * 2, Math.floor(rng() * 0x10000));
    for (let off = 0x690; off < 0x69a; off++) writeBothByte(cpu, tsState, WORK_BASE + off, Math.floor(rng() * 256));

    for (let slot = 0; slot < 3; slot++) {
      const base = OBJ_BASE + slot * OBJ_STRIDE;
      for (let j = 0; j < OBJ_STRIDE; j++) writeBothByte(cpu, tsState, base + j, Math.floor(rng() * 256));
      writeBothByte(cpu, tsState, base + 0x18, rng() < 0.55 ? 3 : Math.floor(rng() * 256));
    }

    callFunction(cpu, FUN_259B4, [], 1_000_000);
    objNs.objectInit259B4(tsState, tsRom, {
      fun_1bab2: () => undefined,
      fun_1cc62: () => RETURN_1CC62,
      fun_25b40: () => undefined,
      fun_1b9cc: () => undefined,
      fun_1c014: () => undefined,
      fun_1281c: () => undefined,
      fun_18e6c: () => undefined,
    });

    let match = true;
    const compareEnd = OBJ_BASE + Math.max(1, count) * OBJ_STRIDE;
    for (let abs = OBJ_BASE; abs < compareEnd; abs++) {
      const bin = peekMem(cpu, abs, 1) & 0xff;
      const ts = tsState.workRam[abs - WORK_BASE] ?? 0;
      if (bin !== ts) {
        firstFail ??= { caseNo: i, abs, bin, ts, count, mode };
        match = false;
        break;
      }
    }
    for (let abs = 0x00400690; match && abs < 0x0040069a; abs++) {
      const bin = peekMem(cpu, abs, 1) & 0xff;
      const ts = tsState.workRam[abs - WORK_BASE] ?? 0;
      if (bin !== ts) {
        firstFail ??= { caseNo: i, abs, bin, ts, count, mode };
        match = false;
      }
    }
    if (match) ok++;
  }

  console.log(`\n=== objectInit259B4 (FUN_259B4) — ${n} casi ===`);
  console.log(`  Match: ${ok}/${n} = ${((ok / n) * 100).toFixed(1)}%`);
  if (firstFail) console.log(`  First fail: ${JSON.stringify(firstFail)}`);
  disposeCpu(cpu);
  exit(ok === n ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  exit(1);
});
