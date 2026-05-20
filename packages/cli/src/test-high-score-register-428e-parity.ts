#!/usr/bin/env node
/**
 * Differential test for `FUN_0000428E` vs `highScoreRegister428E`.
 *
 * Scope: caller-valid high-score ranks 0..9 plus out-of-range positive ranks.
 * The binary also has odd signed-negative behavior, but `FUN_11B18` rank lookup
 * only supplies 0..10 for the runtime high-score path this helper now supports.
 *
 * Usage: npx tsx packages/cli/src/test-high-score-register-428e-parity.ts [N=500]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import {
  highScoreRegister428E as hsrNs,
  state as stateNs,
} from "@marble-love/engine";
import {
  createCpu,
  disposeCpu,
  peekMem,
  pokeMem,
} from "./binary-oracle-lib.js";
import type { CpuSession } from "./binary-oracle-lib.js";

const FUN_428E = 0x0000428e;
const FUN_5236 = 0x00005236;
const PTR_FFC = 0x00401ffc;
const PTR_VAL = 0x00401a00;
const TABLE_BASE = PTR_VAL + 0x1e;
const TABLE_LEN = 50;
const RECORD_ADDR = 0x00401b00;
const RECORD_LEN = 7;
const SENTINEL_RET = 0x00c0ffee;

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) >>> 0;
    return ((s >>> 16) & 0xffff) / 0x10000;
  };
}

let globalCpu: CpuSession | undefined;

function cpu(): CpuSession {
  if (globalCpu === undefined) throw new Error("CPU session is not initialized");
  return globalCpu;
}

function putBytePair(state: ReturnType<typeof stateNs.emptyGameState>, abs: number, value: number): void {
  pokeMem(cpu(), abs, 1, value & 0xff);
  state.workRam[abs - 0x400000] = value & 0xff;
}

function writeLongBE(state: ReturnType<typeof stateNs.emptyGameState>, abs: number, value: number): void {
  const v = value >>> 0;
  putBytePair(state, abs, (v >>> 24) & 0xff);
  putBytePair(state, abs + 1, (v >>> 16) & 0xff);
  putBytePair(state, abs + 2, (v >>> 8) & 0xff);
  putBytePair(state, abs + 3, v & 0xff);
}

function readTableBin(): Uint8Array {
  const out = new Uint8Array(TABLE_LEN);
  for (let i = 0; i < TABLE_LEN; i++) out[i] = peekMem(cpu(), TABLE_BASE + i, 1) & 0xff;
  return out;
}

function readTableTs(state: ReturnType<typeof stateNs.emptyGameState>): Uint8Array {
  return state.workRam.slice(TABLE_BASE - 0x400000, TABLE_BASE - 0x400000 + TABLE_LEN);
}

function firstDiff(a: Uint8Array, b: Uint8Array): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return i;
  return -1;
}

function hex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("hex");
}

function callFunctionExact(session: CpuSession, addr: number, argsLong: readonly number[]): number {
  const sys = session.system;
  let sp = sys.getRegisters().sp;
  for (let i = argsLong.length - 1; i >= 0; i--) {
    sp = (sp - 4) >>> 0;
    sys.write(sp, 4, argsLong[i]! >>> 0);
  }
  sp = (sp - 4) >>> 0;
  sys.write(sp, 4, SENTINEL_RET);
  sys.setRegister("sp", sp);
  sys.setRegister("pc", addr);

  for (let step = 0; step < 2_000; step++) {
    if (sys.getRegisters().pc === SENTINEL_RET) break;
    sys.step();
  }
  if (sys.getRegisters().pc !== SENTINEL_RET) {
    throw new Error(`FUN_428E did not return before step limit; pc=0x${sys.getRegisters().pc.toString(16)}`);
  }

  const d0 = sys.getRegisters().d0 >>> 0;
  sys.setRegister("sp", (sys.getRegisters().sp + 4 + 4 * argsLong.length) >>> 0);
  return d0;
}

async function main(): Promise<void> {
  const total = Number(process.argv[2] ?? "500");
  const romPath = resolve("ghidra_project/marble_program.bin");
  if (!existsSync(romPath)) {
    console.error(`error: ROM blob not found at ${romPath}`);
    exit(3);
  }

  const rom = Buffer.from(readFileSync(romPath));
  rom[FUN_5236] = 0x4e;
  rom[FUN_5236 + 1] = 0x75;

  const state = stateNs.emptyGameState();
  globalCpu = await createCpu({ rom, state });
  const rng = makeRng(0x428e);

  let ok = 0;
  let firstFail: unknown = null;

  for (let i = 0; i < total; i++) {
    cpu().system.setRegister("sp", 0x00401f00);
    writeLongBE(state, PTR_FFC, PTR_VAL);

    for (let j = 0; j < TABLE_LEN; j++) {
      putBytePair(state, TABLE_BASE + j, Math.floor(rng() * 256));
    }

    let rank: number;
    if (i % 12 === 10) rank = 10;
    else if (i % 12 === 11) rank = 11 + Math.floor(rng() * 100);
    else rank = i % 10;

    let score: number;
    if (i % 17 === 0) score = 0;
    else if (i % 17 === 1) score = 0x01000000 + Math.floor(rng() * 0x100000);
    else score = Math.floor(rng() * 0x01000000);
    writeLongBE(state, RECORD_ADDR, score);

    for (let j = 4; j < RECORD_LEN; j++) {
      const choices = [0x20, 0x41 + Math.floor(rng() * 26), 0x61 + Math.floor(rng() * 26), 0x30 + Math.floor(rng() * 10), 0x7f];
      putBytePair(state, RECORD_ADDR + j, choices[Math.floor(rng() * choices.length)] ?? 0x20);
    }

    const bin = callFunctionExact(cpu(), FUN_428E, [rank >>> 0, RECORD_ADDR]) >>> 0;
    const ts = hsrNs.highScoreRegister428E(state, rank, RECORD_ADDR) >>> 0;
    const binTable = readTableBin();
    const tsTable = readTableTs(state);
    const diff = firstDiff(binTable, tsTable);

    if (bin === ts && diff < 0) {
      ok++;
      continue;
    }

    firstFail ??= {
      case: i,
      rank,
      score: `0x${score.toString(16)}`,
      bin: `0x${bin.toString(16)}`,
      ts: `0x${ts.toString(16)}`,
      diff,
      binTable: hex(binTable),
      tsTable: hex(tsTable),
    };
  }

  console.log(`\n=== highScoreRegister428E (FUN_428E) — ${total} cases ===`);
  console.log(`  Match: ${ok}/${total} = ${((ok / total) * 100).toFixed(1)}%`);
  if (firstFail !== null) console.log(`  First fail: ${JSON.stringify(firstFail)}`);

  disposeCpu(cpu());
  exit(ok === total ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  if (globalCpu !== undefined) disposeCpu(globalCpu);
  exit(1);
});
