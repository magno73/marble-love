#!/usr/bin/env node
/**
 * Direct-effect parity for FUN_1344C vs slapsticDispatcher1344C.
 *
 * The randomized cases cover: no pending record, patch-only records, and the
 * direct tile-row renderer path. The special type-0x19 path is kept behind the
 * FUN_1A668 sub-injection and is not exercised here.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import { bus as busNs, slapsticDispatcher1344C as dispNs, state as stateNs } from "@marble-love/engine";
import { createCpu, disposeCpu, peekMem, pokeMem, type CpuSession } from "./binary-oracle-lib.js";

const FUN_1344C = 0x0001344c;
const WRAM = 0x00400000;
const PF = 0x00a00000;
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

function callExact(session: CpuSession, addr: number): void {
  const sys = session.system;
  let sp = 0x00401f00;
  sp = (sp - 4) >>> 0;
  sys.write(sp, 4, SENTINEL_RET);
  sys.setRegister("sp", sp);
  sys.setRegister("pc", addr);
  for (let i = 0; i < 10_000; i++) {
    if (sys.getRegisters().pc === SENTINEL_RET) break;
    sys.step();
  }
  if (sys.getRegisters().pc !== SENTINEL_RET) {
    throw new Error(`FUN_1344C did not return; pc=0x${sys.getRegisters().pc.toString(16)}`);
  }
}

function clearBoth(cpu: CpuSession, state: ReturnType<typeof stateNs.emptyGameState>): void {
  state.workRam.fill(0);
  state.playfieldRam.fill(0);
  for (let i = 0; i < 0x2000; i++) {
    pokeMem(cpu, WRAM + i, 1, 0);
    pokeMem(cpu, PF + i, 1, 0);
  }
}

function wb(cpu: CpuSession, state: ReturnType<typeof stateNs.emptyGameState>, abs: number, value: number): void {
  const v = value & 0xff;
  pokeMem(cpu, abs, 1, v);
  state.workRam[abs - WRAM] = v;
}

function ww(cpu: CpuSession, state: ReturnType<typeof stateNs.emptyGameState>, abs: number, value: number): void {
  const v = value & 0xffff;
  pokeMem(cpu, abs, 2, v);
  state.workRam[abs - WRAM] = (v >>> 8) & 0xff;
  state.workRam[abs - WRAM + 1] = v & 0xff;
}

function wl(cpu: CpuSession, state: ReturnType<typeof stateNs.emptyGameState>, abs: number, value: number): void {
  const v = value >>> 0;
  pokeMem(cpu, abs, 4, v);
  state.workRam[abs - WRAM] = (v >>> 24) & 0xff;
  state.workRam[abs - WRAM + 1] = (v >>> 16) & 0xff;
  state.workRam[abs - WRAM + 2] = (v >>> 8) & 0xff;
  state.workRam[abs - WRAM + 3] = v & 0xff;
}

function setupPatchCase(
  cpu: CpuSession,
  state: ReturnType<typeof stateNs.emptyGameState>,
  rng: () => number,
): void {
  const rec = 0x00400a00;
  const obj = 0x00400b00;
  const patch = 0x00400c00;
  wl(cpu, state, 0x00400970, rec);
  wl(cpu, state, 0x00400974, obj);
  ww(cpu, state, 0x00400664, Math.floor(rng() * 8));
  ww(cpu, state, 0x00400662, Math.floor(rng() * 8));
  wb(cpu, state, obj + 0x1e, 0);
  wl(cpu, state, rec + 4, patch);
  const start = Math.floor(rng() * 8);
  const count = 1 + Math.floor(rng() * 6);
  ww(cpu, state, patch, start);
  ww(cpu, state, patch + 2, count);
  for (let i = 0; i < count; i++) ww(cpu, state, patch + 4 + i * 2, Math.floor(rng() * 0x10000));
}

function setupRenderCase(
  cpu: CpuSession,
  state: ReturnType<typeof stateNs.emptyGameState>,
  rng: () => number,
): void {
  const rec = 0x00400a00;
  const obj = 0x00400b00;
  const tiles = 0x00400c00;
  const level = 0x00400d00;
  const width = 1 + Math.floor(rng() * 5);
  const height = 1 + Math.floor(rng() * 5);
  wl(cpu, state, 0x00400970, rec);
  wl(cpu, state, 0x00400974, obj);
  wl(cpu, state, 0x00400474, level);
  wl(cpu, state, rec, tiles);
  wl(cpu, state, rec + 4, 0);
  ww(cpu, state, 0x00400664, Math.floor(rng() * 8));
  ww(cpu, state, 0x00400662, Math.floor(rng() * 8));
  wb(cpu, state, obj + 0x1e, 1);
  wb(cpu, state, obj + 0x1f, 0);
  ww(cpu, state, obj + 0x26, Math.floor(rng() * 4) * 2);
  ww(cpu, state, obj + 0x28, 0xffff);
  ww(cpu, state, 0x00400000, 8 + Math.floor(rng() * 8));
  wb(cpu, state, tiles, width);
  wb(cpu, state, tiles + 1, height);
  for (let i = 0; i < width * height; i++) ww(cpu, state, tiles + 2 + i * 2, Math.floor(rng() * 0x10000));
}

async function main(): Promise<void> {
  const n = Number(process.argv[2] ?? "500");
  const romBlob = Buffer.from(readFileSync(findRomBlobPath()));
  const tsRom = busNs.emptyRomImage();
  tsRom.program.set(romBlob.subarray(0, tsRom.program.length));
  const binState = stateNs.emptyGameState();
  const tsState = stateNs.emptyGameState();
  const cpu = await createCpu({ rom: romBlob, state: binState });
  const rng = makeRng(0x1344c);

  let ok = 0;
  let firstFail: { caseNo: number; region: string; off: number; bin: number; ts: number; mode: number } | null = null;

  for (let i = 0; i < n; i++) {
    clearBoth(cpu, tsState);
    const mode = Math.floor(rng() * 3);
    if (mode === 1) setupPatchCase(cpu, tsState, rng);
    if (mode === 2) setupRenderCase(cpu, tsState, rng);

    callExact(cpu, FUN_1344C);
    dispNs.slapsticDispatcher1344C(tsState, tsRom);

    let match = true;
    // Ignore the high workRam stack area used by the oracle call wrapper.
    for (let off = 0; off < 0x1800; off++) {
      const bin = peekMem(cpu, WRAM + off, 1) & 0xff;
      const ts = tsState.workRam[off] ?? 0;
      if (bin !== ts) {
        firstFail ??= { caseNo: i, region: "workRam", off, bin, ts, mode };
        match = false;
        break;
      }
    }
    for (let off = 0; match && off < 0x2000; off++) {
      const bin = peekMem(cpu, PF + off, 1) & 0xff;
      const ts = tsState.playfieldRam[off] ?? 0;
      if (bin !== ts) {
        firstFail ??= { caseNo: i, region: "playfieldRam", off, bin, ts, mode };
        match = false;
      }
    }
    if (match) ok++;
  }

  console.log(`\n=== slapsticDispatcher1344C (FUN_1344C) — ${n} cases ===`);
  console.log(`  Match: ${ok}/${n} = ${((ok / n) * 100).toFixed(1)}%`);
  if (firstFail) console.log(`  First fail: ${JSON.stringify(firstFail)}`);
  disposeCpu(cpu);
  exit(ok === n ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  exit(1);
});
