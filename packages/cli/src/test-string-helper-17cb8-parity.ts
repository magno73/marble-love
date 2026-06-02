#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import { state as stateNs, stringHelper17CB8 as helperNs } from "@marble-love/engine";
import { createCpu, disposeCpu, peekMem, pokeMem, type CpuSession } from "./binary-oracle-lib.js";

const FUN_17CB8 = 0x00017cb8;
const WRAM = 0x00400000;
const OBJ = 0x00400018;
const OBJ_STRIDE = 0x00e2;
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

function wb(cpu: Awaited<ReturnType<typeof createCpu>>, state: ReturnType<typeof stateNs.emptyGameState>, abs: number, value: number): void {
  pokeMem(cpu, abs, 1, value & 0xff);
  state.workRam[abs - WRAM] = value & 0xff;
}

function ww(cpu: Awaited<ReturnType<typeof createCpu>>, state: ReturnType<typeof stateNs.emptyGameState>, abs: number, value: number): void {
  const v = value & 0xffff;
  pokeMem(cpu, abs, 2, v);
  state.workRam[abs - WRAM] = (v >>> 8) & 0xff;
  state.workRam[abs - WRAM + 1] = v & 0xff;
}

function wl(cpu: Awaited<ReturnType<typeof createCpu>>, state: ReturnType<typeof stateNs.emptyGameState>, abs: number, value: number): void {
  const v = value >>> 0;
  pokeMem(cpu, abs, 4, v);
  state.workRam[abs - WRAM] = (v >>> 24) & 0xff;
  state.workRam[abs - WRAM + 1] = (v >>> 16) & 0xff;
  state.workRam[abs - WRAM + 2] = (v >>> 8) & 0xff;
  state.workRam[abs - WRAM + 3] = v & 0xff;
}

function callExact(session: CpuSession, addr: number, argsLong: readonly number[]): number {
  const sys = session.system;
  let sp = 0x00401f00;
  for (let i = argsLong.length - 1; i >= 0; i--) {
    sp = (sp - 4) >>> 0;
    sys.write(sp, 4, argsLong[i]! >>> 0);
  }
  sp = (sp - 4) >>> 0;
  sys.write(sp, 4, SENTINEL_RET);
  sys.setRegister("sp", sp);
  sys.setRegister("pc", addr);
  for (let step = 0; step < 20_000; step++) {
    if (sys.getRegisters().pc === SENTINEL_RET) break;
    sys.step();
  }
  if (sys.getRegisters().pc !== SENTINEL_RET) {
    throw new Error(`FUN_17CB8 did not return; pc=0x${sys.getRegisters().pc.toString(16)}`);
  }
  return sys.getRegisters().d0 >>> 0;
}

async function main(): Promise<void> {
  const n = Number(process.argv[2] ?? "500");
  const rom = readFileSync(findRomBlobPath());
  const binState = stateNs.emptyGameState();
  const tsState = stateNs.emptyGameState();
  const cpu = await createCpu({ rom, state: binState });
  const rng = makeRng(0x17cb8);

  let ok = 0;
  let firstFail: { caseNo: number; binD0: number; tsD0: number; binSlot: number; tsSlot: number } | null = null;
  for (let i = 0; i < n; i++) {
    cpu.system.setRegister("sp", 0x00401f00);
    tsState.workRam.fill(0);
    for (let j = 0; j < 0x2000; j++) pokeMem(cpu, WRAM + j, 1, 0);

    const count = 1 + Math.floor(rng() * 4);
    const targetX = Math.floor(rng() * 0x200);
    const targetY = Math.floor(rng() * 0x200);
    const range = 1 + Math.floor(rng() * 0x400);
    ww(cpu, tsState, 0x00400396, count);
    wl(cpu, tsState, 0x0040046a, Math.floor(rng() * 0x100000000) >>> 0);

    for (let slot = 0; slot < count; slot++) {
      const obj = OBJ + slot * OBJ_STRIDE;
      wb(cpu, tsState, obj + 0x18, rng() < 0.8 ? 1 : 0);
      ww(cpu, tsState, obj + 0x0c, (targetX + Math.floor(rng() * 0x80) - 0x40) & 0xffff);
      ww(cpu, tsState, obj + 0x10, (targetY + Math.floor(rng() * 0x80) - 0x40) & 0xffff);
    }
    for (const [base, stride, c] of [[0x004009a4, 0x7c, 2], [0x00401302, 0x60, 4]] as const) {
      for (let slot = 0; slot < c; slot++) {
        const obj = base + slot * stride;
        wb(cpu, tsState, obj + 0x18, rng() < 0.4 ? 1 : 0);
        ww(cpu, tsState, obj + 0x0c, (targetX + Math.floor(rng() * 0x80) - 0x40) & 0xffff);
        ww(cpu, tsState, obj + 0x10, (targetY + Math.floor(rng() * 0x80) - 0x40) & 0xffff);
      }
    }

    const skipObj = rng() < 0.5 ? OBJ : 0x00401000;
    const binD0 = callExact(cpu, FUN_17CB8, [skipObj, targetX, targetY, range]);
    const tsD0 = helperNs.stringHelper17CB8(tsState, skipObj, targetX, targetY, range) >>> 0;
    const binSlot = peekMem(cpu, 0x0040046a, 4) >>> 0;
    const tsSlot = (((tsState.workRam[0x46a] ?? 0) << 24) | ((tsState.workRam[0x46b] ?? 0) << 16) | ((tsState.workRam[0x46c] ?? 0) << 8) | (tsState.workRam[0x46d] ?? 0)) >>> 0;
    if (binD0 === tsD0 && binSlot === tsSlot) ok++;
    else firstFail ??= { caseNo: i, binD0, tsD0, binSlot, tsSlot };
  }

  console.log(`\n=== stringHelper17CB8 (FUN_17CB8) — ${n} cases ===`);
  console.log(`  Match: ${ok}/${n} = ${((ok / n) * 100).toFixed(1)}%`);
  if (firstFail) console.log(`  First fail: ${JSON.stringify(firstFail)}`);
  disposeCpu(cpu);
  exit(ok === n ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  exit(1);
});
