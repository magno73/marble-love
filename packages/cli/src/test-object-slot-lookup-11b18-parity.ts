#!/usr/bin/env node
/**
 * Early-return parity for FUN_11B18 vs objectSlotLookup11B18.
 *
 * The complete qualifying path is an interactive high-score initials flow.
 * This harness patches the rank helper (`FUN_001C6`) to return rank 10 and
 * verifies the bit-perfect non-qualifying return path over 500 randomized
 * object states.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import { objectSlotLookup11B18 as lookupNs, state as stateNs } from "@marble-love/engine";
import { createCpu, disposeCpu, peekMem, pokeMem, type CpuSession } from "./binary-oracle-lib.js";

const FUN_11B18 = 0x00011b18;
const FUN_001C6 = 0x000001c6;
const FUN_4686 = 0x00004686;
const WORK_BASE = 0x00400000;
const OBJ = 0x00400018;
const OBJ_LEN = 0x00e2;
const SENTINEL_RET = 0x00c0ffee;

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

function patchMoveq10Rts(rom: Buffer, addr: number): void {
  rom[addr + 0] = 0x70;
  rom[addr + 1] = 0x0a;
  rom[addr + 2] = 0x4e;
  rom[addr + 3] = 0x75;
}

function callFunctionExact(session: CpuSession, addr: number, argsLong: readonly number[]): number {
  const sys = session.system;
  const spInitial = sys.getRegisters().sp;
  let sp = spInitial;

  for (let i = argsLong.length - 1; i >= 0; i--) {
    sp = (sp - 4) >>> 0;
    sys.write(sp, 4, argsLong[i]! >>> 0);
  }
  sp = (sp - 4) >>> 0;
  sys.write(sp, 4, SENTINEL_RET);

  sys.setRegister("sp", sp);
  sys.setRegister("pc", addr);

  for (let step = 0; step < 5000; step++) {
    if (sys.getRegisters().pc === SENTINEL_RET) break;
    sys.step();
  }

  if (sys.getRegisters().pc !== SENTINEL_RET) {
    throw new Error(`FUN_11B18 did not return before step limit; pc=0x${sys.getRegisters().pc.toString(16)}`);
  }

  sys.setRegister("sp", (sys.getRegisters().sp + 4 + 4 * argsLong.length) >>> 0);
  return sys.getRegisters().d0 >>> 0;
}

async function main(): Promise<void> {
  const n = Number(process.argv[2] ?? "500");
  const rom = Buffer.from(readFileSync(findRomBlobPath()));
  patchMoveq10Rts(rom, FUN_001C6);
  patchMoveq10Rts(rom, FUN_4686);

  const binState = stateNs.emptyGameState();
  const tsState = stateNs.emptyGameState();
  const cpu = await createCpu({ rom, state: binState });
  const rng = makeRng(0x11b18);

  let ok = 0;
  let firstFail: { caseNo: number; reason: string; bin: number; ts: number } | null = null;

  for (let i = 0; i < n; i++) {
    cpu.system.setRegister("sp", 0x00401f00);
    for (let j = 0; j < OBJ_LEN; j++) {
      const v = Math.floor(rng() * 256) & 0xff;
      pokeMem(cpu, OBJ + j, 1, v);
      tsState.workRam[OBJ - WORK_BASE + j] = v;
    }

    const before = tsState.workRam.slice(OBJ - WORK_BASE, OBJ - WORK_BASE + OBJ_LEN);
    const binRet = callFunctionExact(cpu, FUN_11B18, [OBJ]);
    const tsRet = lookupNs.objectSlotLookup11B18(tsState, OBJ, { rankLookup: () => 10 }) >>> 0;

    let match = binRet === tsRet;
    if (!match) firstFail ??= { caseNo: i, reason: "return", bin: binRet, ts: tsRet };
    for (let j = 0; match && j < OBJ_LEN; j++) {
      const bin = peekMem(cpu, OBJ + j, 1) & 0xff;
      const ts = tsState.workRam[OBJ - WORK_BASE + j] ?? 0;
      if (bin !== ts || ts !== before[j]) {
        firstFail ??= { caseNo: i, reason: `obj+0x${j.toString(16)}`, bin, ts };
        match = false;
      }
    }
    if (match) ok++;
  }

  console.log(`\n=== objectSlotLookup11B18 (FUN_11B18 early return) — ${n} casi ===`);
  console.log(`  Match: ${ok}/${n} = ${((ok / n) * 100).toFixed(1)}%`);
  if (firstFail) console.log(`  First fail: ${JSON.stringify(firstFail)}`);
  disposeCpu(cpu);
  exit(ok === n ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  exit(1);
});
