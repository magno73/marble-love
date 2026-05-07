#!/usr/bin/env node
/**
 * test-state-sub-295a-parity.ts — differential FUN_295A vs stateSub295A.
 *
 * FUN_295A is a leaf Branch-A alpha-RAM copy helper. It has no JSRs. The test
 * randomizes alpha RAM and rotation, then compares the full alpha RAM region.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import { bus as busNs, state as stateNs, stateSub295A as sub295ANs } from "@marble-love/engine";
import { callFunction, createCpu, disposeCpu, peekMem, pokeMem } from "./binary-oracle-lib.js";

const FUN_295A = 0x0000295a;

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

  const binState = stateNs.emptyGameState();
  const tsState = stateNs.emptyGameState();
  const cpu = await createCpu({ rom, state: binState });
  const rng = makeRng(0x295a);

  let ok = 0;
  let firstFail: { caseNo: number; offset: number; bin: number; ts: number; rot: number } | null = null;

  for (let i = 0; i < n; i++) {
    cpu.system.setRegister("sp", 0x401f00);
    // FUN_295A's ROM tables are compact/overlapping. Rotation values 2 and
    // >=4 produce the same non-terminating stride-zero path in the original
    // binary, so parity covers the terminating hardware states.
    const rotations = [0, 1, 3] as const;
    const rot = rotations[Math.floor(rng() * rotations.length)] ?? 0;

    pokeMem(cpu, 0x00401f42, 2, rot);
    binState.workRam[0x1f42] = 0;
    binState.workRam[0x1f43] = rot;
    tsState.workRam[0x1f42] = 0;
    tsState.workRam[0x1f43] = rot;

    for (let j = 0; j < 0x1000; j++) {
      const v = Math.floor(rng() * 256) & 0xff;
      writeBothByte(cpu, binState, 0x00a03000 + j, v);
      tsState.alphaRam[j] = v;
    }

    callFunction(cpu, FUN_295A, [], 2_000_000);
    sub295ANs.stateSub295A(tsState, tsRom);

    let match = true;
    for (let j = 0; j < 0x1000; j++) {
      const bin = peekMem(cpu, 0x00a03000 + j, 1);
      const ts = tsState.alphaRam[j] ?? 0;
      if (bin !== ts) {
        firstFail ??= { caseNo: i, offset: j, bin, ts, rot };
        match = false;
        break;
      }
    }
    if (match) ok++;
  }

  console.log(`\n=== stateSub295A (FUN_295A) — ${n} casi ===`);
  console.log(`  Match: ${ok}/${n} = ${((ok / n) * 100).toFixed(1)}%`);
  if (firstFail) console.log(`  First fail: ${JSON.stringify(firstFail)}`);
  disposeCpu(cpu);
  exit(ok === n ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  exit(1);
});
