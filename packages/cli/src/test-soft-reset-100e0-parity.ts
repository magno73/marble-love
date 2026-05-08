#!/usr/bin/env node
/**
 * Differential parity for FUN_100E0 vs softReset100E0.
 *
 * Internal FUN_0254 is patched to RTS and mirrored by the TS default no-op.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import { softReset100E0 as softNs, state as stateNs } from "@marble-love/engine";
import { callFunction, createCpu, disposeCpu, peekMem, pokeMem } from "./binary-oracle-lib.js";

const FUN_100E0 = 0x000100e0;
const FUN_0254 = 0x00000254;
const WORK_BASE = 0x00400000;
const CHECK_OFFS = [0x3ae, 0x3b2, 0x3b6, 0x3b8] as const;

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

async function main(): Promise<void> {
  const n = Number(process.argv[2] ?? "500");
  const rom = Buffer.from(readFileSync(findRomBlobPath()));
  patchRts(rom, FUN_0254);

  const binState = stateNs.emptyGameState();
  const tsState = stateNs.emptyGameState();
  const cpu = await createCpu({ rom, state: binState });
  const rng = makeRng(0x100e0);

  let ok = 0;
  let firstFail: { caseNo: number; abs: number; bin: number; ts: number } | null = null;

  for (let i = 0; i < n; i++) {
    cpu.system.setRegister("sp", 0x00401f00);
    for (let off = 0x3a0; off < 0x3c0; off++) {
      const v = Math.floor(rng() * 256) & 0xff;
      pokeMem(cpu, WORK_BASE + off, 1, v);
      tsState.workRam[off] = v;
    }

    callFunction(cpu, FUN_100E0, []);
    softNs.softReset100E0(tsState);

    let match = true;
    for (const off of CHECK_OFFS) {
      const width = off === 0x3b2 ? 1 : 2;
      for (let j = 0; j < width; j++) {
        const abs = WORK_BASE + off + j;
        const bin = peekMem(cpu, abs, 1) & 0xff;
        const ts = tsState.workRam[off + j] ?? 0;
        if (bin !== ts) {
          firstFail ??= { caseNo: i, abs, bin, ts };
          match = false;
          break;
        }
      }
      if (!match) break;
    }
    if (match) ok++;
  }

  console.log(`\n=== softReset100E0 (FUN_100E0) — ${n} casi ===`);
  console.log(`  Match: ${ok}/${n} = ${((ok / n) * 100).toFixed(1)}%`);
  if (firstFail) console.log(`  First fail: ${JSON.stringify(firstFail)}`);
  disposeCpu(cpu);
  exit(ok === n ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  exit(1);
});
