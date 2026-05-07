#!/usr/bin/env node
/**
 * test-tilemap-entry-pack-1a9cc-parity.ts — differential FUN_1A9CC vs TS.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import { state as stateNs, tilemapEntryPack1A9CC as packNs } from "@marble-love/engine";
import { callFunction, createCpu, disposeCpu, peekMem, pokeMem } from "./binary-oracle-lib.js";

const FUN_1A9CC = 0x0001a9cc;
const SOURCE = 0x00401000;
const PF_BASE = 0x00a00000;
const SOURCE_BYTES = 0x180;
const WINDOW_BYTES = 60;

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

async function main(): Promise<void> {
  const n = Number(process.argv[2] ?? "500");
  const rom = readFileSync(findRomBlobPath());
  const binState = stateNs.emptyGameState();
  const tsState = stateNs.emptyGameState();
  const cpu = await createCpu({ rom, state: binState });
  const rng = makeRng(0x1a9cc);

  let ok = 0;
  let firstFail: { caseNo: number; offset: number; bin: number; ts: number; destOff: number } | null = null;

  for (let i = 0; i < n; i++) {
    cpu.system.setRegister("sp", 0x401f00);
    const destOff = Math.floor(rng() * (0x2000 - WINDOW_BYTES));
    const dest = PF_BASE + destOff;

    for (let j = 0; j < SOURCE_BYTES; j++) {
      const v = Math.floor(rng() * 256) & 0xff;
      pokeMem(cpu, SOURCE + j, 1, v);
      binState.workRam[(SOURCE - 0x00400000) + j] = v;
      tsState.workRam[(SOURCE - 0x00400000) + j] = v;
    }
    for (let j = 0; j < WINDOW_BYTES; j++) {
      pokeMem(cpu, dest + j, 1, 0xcc);
      binState.playfieldRam[destOff + j] = 0xcc;
      tsState.playfieldRam[destOff + j] = 0xcc;
    }

    callFunction(cpu, FUN_1A9CC, [dest, SOURCE]);
    packNs.packTilemapEntries1A9CC(tsState, destOff, SOURCE);

    let match = true;
    for (let j = 0; j < WINDOW_BYTES; j++) {
      const bin = peekMem(cpu, dest + j, 1);
      const ts = tsState.playfieldRam[destOff + j] ?? 0;
      if (bin !== ts) {
        firstFail ??= { caseNo: i, offset: j, bin, ts, destOff };
        match = false;
        break;
      }
    }
    if (match) ok++;
  }

  console.log(`\n=== packTilemapEntries1A9CC (FUN_1A9CC) — ${n} casi ===`);
  console.log(`  Match: ${ok}/${n} = ${((ok / n) * 100).toFixed(1)}%`);
  if (firstFail) console.log(`  First fail: ${JSON.stringify(firstFail)}`);
  disposeCpu(cpu);
  exit(ok === n ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  exit(1);
});
