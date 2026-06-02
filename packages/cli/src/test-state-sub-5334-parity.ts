#!/usr/bin/env node
/**
 * test-state-sub-5334-parity.ts — differential FUN_5334 vs stateSub5334.
 *
 * `FUN_000052DA` with `(byte98_signExt32, byte99_signExt32, argLong)`.
 *
 * Parity test strategy:
 *     we write the two bytes in work RAM (both in unified memory of Musashi
 *     stack `(0x4,SP)`, `(0x8,SP)`, `(0xC,SP)` (callee view with ret
 *     addr in `(0,SP)`).
 *   - We compare `(arg1, arg2, arg3)` observed vs. those passed to the
 *     `inner` stub of TS.
 *
 * Usage: npx tsx packages/cli/src/test-state-sub-5334-parity.ts [N]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import {
  state as stateNs,
  stateSub5334 as subNs,
} from "@marble-love/engine";
import {
  createCpu,
  disposeCpu,
  peekMem,
  pokeMem,
} from "./binary-oracle-lib.js";

const FUN_5334 = 0x00005334;
const FUN_52DA = 0x000052da;
const SENTINEL_RET = 0xcafebabe >>> 0;

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) >>> 0;
    return ((s >>> 16) & 0xffff) / 0x10000;
  };
}

interface Captured {
  arg1: number;
  arg2: number;
  arg3: number;
  reached: boolean;
}

function captureEnter52DAArgs(
  cpu: Awaited<ReturnType<typeof createCpu>>,
  argLong: number,
  byte98: number,
  byte99: number,
): Captured {
  const sys = cpu.system;

  // memory of Musashi at 0x00401F98 / 0x00401F99 (MMIO not involved here:
  // they are in work RAM 0x400000+).
  pokeMem(cpu, 0x00401f98, 1, byte98 & 0xff);
  pokeMem(cpu, 0x00401f99, 1, byte99 & 0xff);

  // We use 0x401F00 (pattern of sound-cmd-gate parity).
  const sp0 = 0x401f00;
  let sp = sp0;
  sp = (sp - 4) >>> 0;
  sys.write(sp, 4, argLong >>> 0);
  // Push sentinel return address
  sp = (sp - 4) >>> 0;
  sys.write(sp, 4, SENTINEL_RET);

  sys.setRegister("sp", sp);
  sys.setRegister("pc", FUN_5334);

  // has 11 instructions, requiring fewer than about 30 steps.
  let reached = false;
  for (let i = 0; i < 200; i++) {
    const pc = sys.getRegisters().pc;
    if (pc === FUN_52DA) {
      reached = true;
      break;
    }
    if (pc === SENTINEL_RET) break;
    sys.step();
  }

  if (!reached) {
    return { arg1: 0, arg2: 0, arg3: 0, reached: false };
  }

  //   [ret_addr_to_5334_post_jsr (4,SP=0)]
  //   [arg1 long                 (4,SP)]
  //   [arg2 long                 (8,SP)]
  //   [arg3 long                 (0xC,SP)]
  const spNow = sys.getRegisters().sp;
  const seenArg1 = peekMem(cpu, spNow + 4, 4) >>> 0;
  const seenArg2 = peekMem(cpu, spNow + 8, 4) >>> 0;
  const seenArg3 = peekMem(cpu, spNow + 12, 4) >>> 0;
  return { arg1: seenArg1, arg2: seenArg2, arg3: seenArg3, reached: true };
}

async function main(): Promise<void> {
  const n = Number(process.argv[2] ?? "500");

  const romPath = resolve("ghidra_project/marble_program.bin");
  if (!existsSync(romPath)) {
    console.error(`error: ROM blob not found at ${romPath}`);
    exit(3);
  }
  const rom = readFileSync(romPath);

  const state = stateNs.emptyGameState();
  const cpu = await createCpu({ rom, state });

  console.log(`\n=== stateSub5334 (FUN_5334) — ${n} cases ===`);

  const rng = makeRng(0xfeedface);
  let ok = 0;
  let firstFail: {
    i: number;
    argLong: number;
    byte98: number;
    byte99: number;
    binArg1: number;
    binArg2: number;
    binArg3: number;
    tsArg1: number;
    tsArg2: number;
    tsArg3: number;
    reached: boolean;
  } | null = null;

  for (let i = 0; i < n; i++) {
    // Pattern: coverage boundary sign-extension + random
    let byte98: number;
    let byte99: number;
    let argLong: number;
    if (i === 0) {
      byte98 = 0x00; byte99 = 0x00; argLong = 0x00000000;
    } else if (i === 1) {
      byte98 = 0x7f; byte99 = 0x7f; argLong = 0x12345678; // max positive signed
    } else if (i === 2) {
      byte98 = 0x80; byte99 = 0x80; argLong = 0xffffffff >>> 0; // min negative signed
    } else if (i === 3) {
      byte98 = 0xff; byte99 = 0xff; argLong = 0xdeadbeef; // -1 sign-extended
    } else if (i === 4) {
      byte98 = 0x01; byte99 = 0xfe; argLong = 0xcafebabe;
    } else if (i === 5) {
      byte98 = 0x80; byte99 = 0x7f; argLong = 0; // mix
    } else if (i < 20) {
      byte98 = ((i - 6) * 0x11) & 0xff;
      byte99 = (~byte98) & 0xff;
      argLong = Math.floor(rng() * 0x100000000) >>> 0;
    } else {
      // Bias: 40% boundary (0x00, 0x7F, 0x80, 0xFF), 60% random
      const useBoundary = rng() < 0.4;
      if (useBoundary) {
        const cards = [0x00, 0x01, 0x7f, 0x80, 0xff];
        byte98 = cards[Math.floor(rng() * cards.length)]!;
        byte99 = cards[Math.floor(rng() * cards.length)]!;
      } else {
        byte98 = Math.floor(rng() * 0x100) & 0xff;
        byte99 = Math.floor(rng() * 0x100) & 0xff;
      }
      argLong = Math.floor(rng() * 0x100000000) >>> 0;
    }

    // Run binary: capture args received by FUN_52DA.
    const bin = captureEnter52DAArgs(cpu, argLong, byte98, byte99);

    // Run TS: inner stub captures (arg1, arg2, arg3). Sync TS state workRam
    // with the two configured bytes.
    state.workRam[0x1f98] = byte98 & 0xff;
    state.workRam[0x1f99] = byte99 & 0xff;
    let tsArg1 = -1;
    let tsArg2 = -1;
    let tsArg3 = -1;
    subNs.stateSub5334(state, argLong, (a1: number, a2: number, a3: number) => {
      tsArg1 = a1;
      tsArg2 = a2;
      tsArg3 = a3;
      return 0;
    });

    const match =
      bin.reached &&
      bin.arg1 === tsArg1 &&
      bin.arg2 === tsArg2 &&
      bin.arg3 === tsArg3;
    if (match) {
      ok++;
    } else if (firstFail === null) {
      firstFail = {
        i,
        argLong,
        byte98,
        byte99,
        binArg1: bin.arg1,
        binArg2: bin.arg2,
        binArg3: bin.arg3,
        tsArg1,
        tsArg2,
        tsArg3,
        reached: bin.reached,
      };
    }
  }

  console.log(`  Match: ${ok}/${n} = ${((ok / n) * 100).toFixed(1)}%`);
  if (firstFail) {
    console.log(`  First fail @ case ${firstFail.i}:`);
    console.log(
      `    inputs: argLong=0x${firstFail.argLong.toString(16)} byte98=0x${firstFail.byte98.toString(16)} byte99=0x${firstFail.byte99.toString(16)} reached=${firstFail.reached}`,
    );
    console.log(
      `    bin: arg1=0x${firstFail.binArg1.toString(16)} arg2=0x${firstFail.binArg2.toString(16)} arg3=0x${firstFail.binArg3.toString(16)}`,
    );
    console.log(
      `    ts : arg1=0x${firstFail.tsArg1.toString(16)} arg2=0x${firstFail.tsArg2.toString(16)} arg3=0x${firstFail.tsArg3.toString(16)}`,
    );
  }

  disposeCpu(cpu);
  exit(ok === n ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  exit(1);
});
