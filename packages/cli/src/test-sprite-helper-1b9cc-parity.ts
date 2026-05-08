#!/usr/bin/env node
/**
 * Parity for FUN_0001B9CC vs spriteHelper1B9CC.
 *
 * FUN_1CABA (called conditionally inside FUN_1BAB2) is patched to RTS; the TS
 * default spritePosUpdate1BAB2 also leaves that renderer as a no-op.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import { spriteHelper1B9CC as helperNs, state as stateNs } from "@marble-love/engine";
import { callFunction, createCpu, disposeCpu, peekMem, pokeMem } from "./binary-oracle-lib.js";

const FUN_1B9CC = 0x0001b9cc;
const FUN_1CABA = 0x0001caba;
const WRAM = 0x00400000;
const OBJ = 0x00400018;
const OBJ_LEN = 0x00e2;

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

function writeBothByte(
  cpu: Awaited<ReturnType<typeof createCpu>>,
  state: ReturnType<typeof stateNs.emptyGameState>,
  abs: number,
  value: number,
): void {
  const v = value & 0xff;
  pokeMem(cpu, abs, 1, v);
  state.workRam[abs - WRAM] = v;
}

function writeBothWord(
  cpu: Awaited<ReturnType<typeof createCpu>>,
  state: ReturnType<typeof stateNs.emptyGameState>,
  abs: number,
  value: number,
): void {
  const v = value & 0xffff;
  pokeMem(cpu, abs, 2, v);
  state.workRam[abs - WRAM] = (v >>> 8) & 0xff;
  state.workRam[abs - WRAM + 1] = v & 0xff;
}

function writeBothLong(
  cpu: Awaited<ReturnType<typeof createCpu>>,
  state: ReturnType<typeof stateNs.emptyGameState>,
  abs: number,
  value: number,
): void {
  const v = value >>> 0;
  pokeMem(cpu, abs, 4, v);
  state.workRam[abs - WRAM] = (v >>> 24) & 0xff;
  state.workRam[abs - WRAM + 1] = (v >>> 16) & 0xff;
  state.workRam[abs - WRAM + 2] = (v >>> 8) & 0xff;
  state.workRam[abs - WRAM + 3] = v & 0xff;
}

async function main(): Promise<void> {
  const n = Number(process.argv[2] ?? "500");
  const rom = Buffer.from(readFileSync(findRomBlobPath()));
  patchRts(rom, FUN_1CABA);
  const binState = stateNs.emptyGameState();
  const tsState = stateNs.emptyGameState();
  const cpu = await createCpu({ rom, state: binState });
  const rng = makeRng(0x1b9cc);

  let ok = 0;
  let firstFail: { caseNo: number; abs: number; bin: number; ts: number; flag: number } | null = null;

  for (let i = 0; i < n; i++) {
    cpu.system.setRegister("sp", 0x00401f00);
    tsState.workRam.fill(0);
    for (let abs = WRAM; abs < WRAM + 0x2000; abs++) pokeMem(cpu, abs, 1, 0);

    const flag = rng() < 0.5 ? 0 : 1 + Math.floor(rng() * 255);
    for (let j = 0; j < OBJ_LEN; j++) writeBothByte(cpu, tsState, OBJ + j, Math.floor(rng() * 256));
    writeBothLong(cpu, tsState, OBJ + 0x0, Math.floor(rng() * 0x100000000) >>> 0);
    writeBothWord(cpu, tsState, OBJ + 0x0c, Math.floor(rng() * 0x10000));
    writeBothWord(cpu, tsState, OBJ + 0x10, Math.floor(rng() * 0x10000));
    writeBothWord(cpu, tsState, OBJ + 0x14, Math.floor(rng() * 0x10000));
    writeBothByte(cpu, tsState, OBJ + 0x58, Math.floor(rng() * 0x40));
    for (const abs of [0x00400690, 0x00400692, 0x00400694, 0x00400696, 0x00400698, 0x0040097e]) {
      writeBothWord(cpu, tsState, abs, Math.floor(rng() * 0x10000));
    }

    callFunction(cpu, FUN_1B9CC, [OBJ, flag], 1_000_000);
    helperNs.spriteHelper1B9CC(tsState, OBJ, flag);

    let match = true;
    for (const [start, len] of [[OBJ, OBJ_LEN], [0x00400690, 0x10]] as const) {
      for (let j = 0; j < len; j++) {
        const abs = start + j;
        const bin = peekMem(cpu, abs, 1) & 0xff;
        const ts = tsState.workRam[abs - WRAM] ?? 0;
        if (bin !== ts) {
          firstFail ??= { caseNo: i, abs, bin, ts, flag };
          match = false;
          break;
        }
      }
      if (!match) break;
    }
    if (match) ok++;
  }

  console.log(`\n=== spriteHelper1B9CC (FUN_1B9CC) — ${n} casi ===`);
  console.log(`  Match: ${ok}/${n} = ${((ok / n) * 100).toFixed(1)}%`);
  if (firstFail) console.log(`  First fail: ${JSON.stringify(firstFail)}`);
  disposeCpu(cpu);
  exit(ok === n ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  exit(1);
});
