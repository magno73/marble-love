#!/usr/bin/env node
/**
 * test-or-flags-5248-parity.ts — differential FUN_005248 vs orFlags5248.
 *
 * `FUN_00005248` (8 byte, 0x005248-0x005250):
 *   or.l D1,(0x00401f5e).l
 *   rts
 *
 * Strategia:
 *   - Inizializza workRam con byte random; sync in Musashi e in state.workRam TS.
 *   - D1 = random long a 32 bit.
 *   - Lancia `callFunction(cpu, 0x5248, [ignored], {d1: d1val})` e
 *     `orFlags5248(state, d1val)`.
 *   - Confronta workRam[0x1F5E..0x1F61] (long-BE @ 0x401F5E) dopo l'esecuzione.
 *   - Ripete N (default 500) volte con workRam random e D1 random, inclusi
 *     edge cases: D1=0, D1=0xFFFFFFFF, D1=3 (caso tipico callers).
 *
 * Uso: npx tsx packages/cli/src/test-or-flags-5248-parity.ts [N]
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import { state as stateNs, orFlags5248 as ns } from "@marble-love/engine";
import {
  createCpu,
  callFunction,
  pokeMem,
  peekMem,
  disposeCpu,
} from "./binary-oracle-lib.js";

const FUN_5248 = 0x00005248;
const WORK_RAM_BASE = 0x00400000;
const WORK_RAM_SIZE = 0x2000;
const FLAGS_ABS = 0x00401f5e;
const FLAGS_OFF = 0x1f5e;

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) >>> 0;
    return ((s >>> 16) & 0xffff) / 0x10000;
  };
}

async function main(): Promise<void> {
  const n = Number(process.argv[2] ?? "500");
  const rom = readFileSync(resolve("ghidra_project/marble_program.bin"));
  const stateInst = stateNs.emptyGameState();
  const cpu = await createCpu({ rom, state: stateInst });

  const r = makeRng(0xcafe5248);

  // Edge cases: D1=0, D1=0xFFFFFFFF, D1=3 (callers tipici), D1=1, D1=0x80000001
  const edges = [0, 0xffffffff, 3, 1, 0x80000001];

  console.log(`\n=== orFlags5248 (FUN_5248) — ${n} casi ===`);
  let ok = 0;
  let fail: { d1: number; flags0: number; binResult: number; tsResult: number } | null = null;

  for (let i = 0; i < n; i++) {
    // Randomizza workRam
    for (let b = 0; b < WORK_RAM_SIZE; b++) {
      stateInst.workRam[b] = Math.floor(r() * 256) & 0xff;
    }
    // Sync verso Musashi
    for (let b = 0; b < WORK_RAM_SIZE; b++) {
      pokeMem(cpu, WORK_RAM_BASE + b, 1, stateInst.workRam[b]!);
    }

    // D1 = edge case nei primi, poi random
    const d1 = i < edges.length
      ? edges[i]!
      : (Math.floor(r() * 0x10000) | (Math.floor(r() * 0x10000) << 16)) >>> 0;

    // Valore iniziale flags (per debug)
    const flags0 =
      (((stateInst.workRam[FLAGS_OFF] ?? 0) << 24) |
        ((stateInst.workRam[FLAGS_OFF + 1] ?? 0) << 16) |
        ((stateInst.workRam[FLAGS_OFF + 2] ?? 0) << 8) |
        (stateInst.workRam[FLAGS_OFF + 3] ?? 0)) >>>
      0;

    // ── Binary oracle ──────────────────────────────────────────────────────
    cpu.system.setRegister("sp", 0x401f00);
    cpu.system.setRegister("d1", d1);
    callFunction(cpu, FUN_5248);
    const binResult =
      (peekMem(cpu, FLAGS_ABS, 1) << 24 |
        peekMem(cpu, FLAGS_ABS + 1, 1) << 16 |
        peekMem(cpu, FLAGS_ABS + 2, 1) << 8 |
        peekMem(cpu, FLAGS_ABS + 3, 1)) >>>
      0;

    // ── TS replica ─────────────────────────────────────────────────────────
    ns.orFlags5248(stateInst, d1);
    const tsResult =
      (((stateInst.workRam[FLAGS_OFF] ?? 0) << 24) |
        ((stateInst.workRam[FLAGS_OFF + 1] ?? 0) << 16) |
        ((stateInst.workRam[FLAGS_OFF + 2] ?? 0) << 8) |
        (stateInst.workRam[FLAGS_OFF + 3] ?? 0)) >>>
      0;

    if (binResult === tsResult) {
      ok++;
    } else if (fail === null) {
      fail = { d1, flags0, binResult, tsResult };
    }

    // Sync stato TS dalla workRam Musashi per prossima iterazione
    for (let b = 0; b < WORK_RAM_SIZE; b++) {
      stateInst.workRam[b] = peekMem(cpu, WORK_RAM_BASE + b, 1);
    }
  }

  console.log(`  Match: ${ok}/${n} = ${((ok / n) * 100).toFixed(1)}%`);
  if (fail) {
    console.error(
      `  First fail: d1=0x${fail.d1.toString(16)} flags0=0x${fail.flags0.toString(16)}` +
        ` bin=0x${fail.binResult.toString(16)} ts=0x${fail.tsResult.toString(16)}`,
    );
  }

  disposeCpu(cpu);
  exit(ok === n ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  exit(1);
});
