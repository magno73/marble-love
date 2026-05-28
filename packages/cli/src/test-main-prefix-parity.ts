#!/usr/bin/env node
/**
 * test-main-prefix-parity.ts — differential del prefix di MainUpdate.
 *
 * Runs 0x28788..0x287D8 before the jsr calls to sub-updates. Compares work RAM
 * deltas between the binary and TS `mainUpdateScrollSync`.
 *
 * Uso: npx tsx packages/cli/src/test-main-prefix-parity.ts [N]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import { state as stateNs, mainLoop, bus as busNs } from "@marble-love/engine";
import type { GameState } from "@marble-love/engine";

import {
  createCpu,
  runUntil,
  pokeMem,
  peekMem,
  disposeCpu,
} from "./binary-oracle-lib.js";
import type { CpuSession } from "./binary-oracle-lib.js";

const MAIN_PREFIX_START = 0x00028788;
const MAIN_PREFIX_END = 0x000287d8; // subito dopo le scritture MMIO, prima del demo check

interface TestCase {
  scrollDirtyFlag: number;     // u8 @ 0x40039A
  frameLongCtr: number;        // u32 @ 0x400010
  scrollYTarget: number;       // u16 @ 0x400000
  avControlNew: number;        // u16 @ 0x4003B0
  scrollYLatched: number;      // u16 @ 0x400002 (initial)
  avControlCache: number;      // u16 @ 0x4003AE (initial)
}

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) >>> 0;
    return ((s >>> 16) & 0xffff) / 0x10000;
  };
}

function generate(rng: () => number): TestCase {
  return {
    scrollDirtyFlag: rng() < 0.5 ? 0 : 1,
    frameLongCtr: Math.floor(rng() * 0xfffffff) >>> 0,
    scrollYTarget: Math.floor(rng() * 0x10000) & 0xffff,
    avControlNew: Math.floor(rng() * 0x10000) & 0xffff,
    scrollYLatched: Math.floor(rng() * 0x10000) & 0xffff,
    avControlCache: Math.floor(rng() * 0x10000) & 0xffff,
  };
}

function applyTestCase(cpu: CpuSession, state: GameState, tc: TestCase): void {
  // Reset SP to initial SSP (top of Work RAM) to avoid stack leaks between tests.
  // runUntil does not restore SP after the MainUpdate prefix movem.l.
  cpu.system.setRegister("sp", 0x00401f00);

  // Set workRam fields in both
  pokeMem(cpu, 0x40039a, 1, tc.scrollDirtyFlag);
  state.workRam[0x39a] = tc.scrollDirtyFlag;

  pokeMem(cpu, 0x400010, 4, tc.frameLongCtr);
  state.workRam[0x10] = (tc.frameLongCtr >>> 24) & 0xff;
  state.workRam[0x11] = (tc.frameLongCtr >>> 16) & 0xff;
  state.workRam[0x12] = (tc.frameLongCtr >>> 8) & 0xff;
  state.workRam[0x13] = tc.frameLongCtr & 0xff;

  pokeMem(cpu, 0x400000, 2, tc.scrollYTarget);
  state.workRam[0x00] = (tc.scrollYTarget >>> 8) & 0xff;
  state.workRam[0x01] = tc.scrollYTarget & 0xff;

  pokeMem(cpu, 0x400002, 2, tc.scrollYLatched);
  state.workRam[0x02] = (tc.scrollYLatched >>> 8) & 0xff;
  state.workRam[0x03] = tc.scrollYLatched & 0xff;

  pokeMem(cpu, 0x4003ae, 2, tc.avControlCache);
  state.workRam[0x3ae] = (tc.avControlCache >>> 8) & 0xff;
  state.workRam[0x3af] = tc.avControlCache & 0xff;

  pokeMem(cpu, 0x4003b0, 2, tc.avControlNew);
  state.workRam[0x3b0] = (tc.avControlNew >>> 8) & 0xff;
  state.workRam[0x3b1] = tc.avControlNew & 0xff;
}

interface Snapshot {
  scrollDirtyFlag: number;
  frameLongCtr: number;
  scrollYLatched: number;
  avControlCache: number;
}

function snapshotBinary(cpu: CpuSession): Snapshot {
  return {
    scrollDirtyFlag: peekMem(cpu, 0x40039a, 1),
    frameLongCtr: peekMem(cpu, 0x400010, 4) >>> 0,
    scrollYLatched: peekMem(cpu, 0x400002, 2),
    avControlCache: peekMem(cpu, 0x4003ae, 2),
  };
}

function snapshotTs(state: GameState): Snapshot {
  const ctr = (
    ((state.workRam[0x10] ?? 0) << 24) |
    ((state.workRam[0x11] ?? 0) << 16) |
    ((state.workRam[0x12] ?? 0) << 8) |
    (state.workRam[0x13] ?? 0)
  ) >>> 0;
  return {
    scrollDirtyFlag: state.workRam[0x39a] ?? 0,
    frameLongCtr: ctr,
    scrollYLatched: ((state.workRam[0x02] ?? 0) << 8) | (state.workRam[0x03] ?? 0),
    avControlCache: ((state.workRam[0x3ae] ?? 0) << 8) | (state.workRam[0x3af] ?? 0),
  };
}

async function main(): Promise<void> {
  const n = Number(process.argv[2] ?? "200");

  const romPath = resolve("ghidra_project/marble_program.bin");
  if (!existsSync(romPath)) {
    console.error(`error: ROM blob not found at ${romPath}`);
    exit(3);
  }
  const romBytes = readFileSync(romPath);
  void busNs;

  const state = stateNs.emptyGameState();
  const cpu = await createCpu({ rom: romBytes, state });

  console.log(`\n=== mainUpdateScrollSync vs FUN_28788 prefix (${n} casi) ===`);
  const rng = makeRng(0xdead);
  let ok = 0;
  let firstMismatch: { tc: TestCase; bin: Snapshot; ts: Snapshot } | null = null;

  for (let i = 0; i < n; i++) {
    const tc = generate(rng);
    applyTestCase(cpu, state, tc);

    // Run binary from prefix start to prefix end (step-by-step)
    const r = runUntil(cpu, MAIN_PREFIX_START, MAIN_PREFIX_END, 1_000);
    if (!r.reachedTarget) {
      console.log(`  case ${i}: binary NON ha raggiunto 0x287D8 dopo ${r.instructions} istruzioni`);
      continue;
    }
    const bin = snapshotBinary(cpu);

    // Run TS
    mainLoop.mainUpdateScrollSync(state);
    const ts = snapshotTs(state);

    const match = bin.scrollDirtyFlag === ts.scrollDirtyFlag &&
      bin.frameLongCtr === ts.frameLongCtr &&
      bin.scrollYLatched === ts.scrollYLatched &&
      bin.avControlCache === ts.avControlCache;

    if (match) ok++;
    else if (firstMismatch === null) firstMismatch = { tc, bin, ts };
  }

  console.log(`  Match: ${ok}/${n} = ${((ok / n) * 100).toFixed(1)}%`);
  if (firstMismatch) {
    const { tc, bin, ts } = firstMismatch;
    console.log(`\nFirst mismatch:`);
    console.log(`  input: dirty=${tc.scrollDirtyFlag} frameCtr=0x${tc.frameLongCtr.toString(16)} yT=0x${tc.scrollYTarget.toString(16)} yL_init=0x${tc.scrollYLatched.toString(16)} avNew=0x${tc.avControlNew.toString(16)} avC_init=0x${tc.avControlCache.toString(16)}`);
    console.log(`  bin: dirty=${bin.scrollDirtyFlag} frameCtr=0x${bin.frameLongCtr.toString(16)} yL=0x${bin.scrollYLatched.toString(16)} avC=0x${bin.avControlCache.toString(16)}`);
    console.log(`  ts:  dirty=${ts.scrollDirtyFlag} frameCtr=0x${ts.frameLongCtr.toString(16)} yL=0x${ts.scrollYLatched.toString(16)} avC=0x${ts.avControlCache.toString(16)}`);
  }

  disposeCpu(cpu);
  exit(ok === n ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  exit(1);
});
