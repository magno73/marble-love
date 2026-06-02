#!/usr/bin/env node
/**
 * test-eeprom-commit-request-parity.ts — differential FUN_3FC6 vs
 * eepromCommitRequest (TS).
 *
 * `FUN_00003FC6` (66 bytes) is called once by `FUN_472A` (call site
 * @ 0x4748). It is a "consume / pace-check" wrapper around `FUN_3F78`:
 *   - takes one long arg from the caller but reads only the low word
 *   - calls `FUN_3F78` twice (both mutate workRam @ 0x401FF5/F7)
 *   - if checks pass, decrement byte @ 0x401FF5 by `(arg.w * result1.w).b`
 *
 * Comparison:
 *   - return D0 (long): 0 or 1
 *   - byte @ 0x401FF5 (acc, modified by internal eepromCommit + decrement)
 *   - byte @ 0x401FF7 (drain counter, modified by internal eepromCommit)
 *
 * Setup for each random case:
 *   - *0x401FFC = a2Addr (ptr struct, in workRam-safe range 0x401D00)
 *   - bytes @ a2Addr+0xA, +0xB = status + complement
 *   - *0x401FF5, *0x401FF7 = random counters
 *   - arg = random long (high word ignored by the function, low word used)
 *
 * Pattern coverage:
 *   - 25% status >= 0xE0       -> both internal calls early-exit (0x18)
 *   - 20% complement mismatch  -> D1=1, drain
 *   - 35% status valid (<0xE0) -> D1 in [1..4], drain + scale
 *   - 10% arg.w == 0           -> stress early-exit of the wrapper
 *   - 10% full random          -> stress
 *
 * Usage: npx tsx packages/cli/src/test-eeprom-commit-request-parity.ts [N=500]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import {
  state as stateNs,
  eepromCommitRequest as ecrNs,
} from "@marble-love/engine";
import {
  createCpu,
  callFunction,
  pokeMem,
  peekMem,
  disposeCpu,
} from "./binary-oracle-lib.js";

const FUN_3FC6 = 0x00003fc6;
const PTR_FFC = 0x00401ffc;
const ACC_FF5 = 0x00401ff5;
const COUNTER_FF7 = 0x00401ff7;

const A2_ADDR = 0x00401d00;

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) >>> 0;
    return ((s >>> 16) & 0xffff) / 0x10000;
  };
}

interface FailRecord {
  i: number;
  pattern: string;
  status: number;
  compl: number;
  acc0: number;
  ctr0: number;
  arg: number;
  binD0: number;
  tsD0: number;
  binAcc: number;
  tsAcc: number;
  binCtr: number;
  tsCtr: number;
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

  console.log(`\n=== eepromCommitRequest (FUN_3FC6) — ${n} cases ===`);

  const rng = makeRng(0x3fc6);
  let ok = 0;
  let firstFail: FailRecord | null = null;

  for (let i = 0; i < n; i++) {
    cpu.system.setRegister("sp", 0x401f00);

    // Pattern selection
    const pick = rng();
    let pattern: "early" | "mismatch" | "valid" | "argzero" | "random";
    let status: number;
    let compl: number;
    if (pick < 0.25) {
      pattern = "early";
      status = 0xe0 + Math.floor(rng() * 0x20);
      compl = ~status & 0xff;
    } else if (pick < 0.45) {
      pattern = "mismatch";
      status = Math.floor(rng() * 256);
      do {
        compl = Math.floor(rng() * 256);
      } while (compl === ((~status) & 0xff));
    } else if (pick < 0.8) {
      pattern = "valid";
      status = Math.floor(rng() * 0xe0);
      compl = ~status & 0xff;
    } else if (pick < 0.9) {
      pattern = "argzero";
      status = Math.floor(rng() * 256);
      compl = Math.floor(rng() * 256);
    } else {
      pattern = "random";
      status = Math.floor(rng() * 256);
      compl = Math.floor(rng() * 256);
    }

    const acc0 = Math.floor(rng() * 256);
    const ctr0 = Math.floor(rng() * 256);

    // arg: long with random high word, random low word; pattern "argzero" forces low word = 0.
    let argLow: number;
    if (pattern === "argzero") {
      argLow = 0x0000;
    } else {
      argLow = Math.floor(rng() * 0x10000);
    }
    const argHigh = Math.floor(rng() * 0x10000);
    const arg = ((argHigh << 16) | argLow) >>> 0;

    // ── Setup binary side (Musashi) ─────────────────────────────────────
    for (let k = 0; k < 0x20; k++) {
      pokeMem(cpu, A2_ADDR + k, 1, 0);
    }
    pokeMem(cpu, A2_ADDR + 0x0a, 1, status);
    pokeMem(cpu, A2_ADDR + 0x0b, 1, compl);
    pokeMem(cpu, PTR_FFC, 4, A2_ADDR);
    pokeMem(cpu, ACC_FF5, 1, acc0);
    pokeMem(cpu, COUNTER_FF7, 1, ctr0);

    // ── Setup TS side (mirror onto state.workRam) ───────────────────────
    for (let k = 0; k < 0x20; k++) {
      state.workRam[(A2_ADDR - 0x400000) + k] = 0;
    }
    state.workRam[(A2_ADDR - 0x400000) + 0x0a] = status;
    state.workRam[(A2_ADDR - 0x400000) + 0x0b] = compl;
    state.workRam[0x1ffc] = (A2_ADDR >>> 24) & 0xff;
    state.workRam[0x1ffd] = (A2_ADDR >>> 16) & 0xff;
    state.workRam[0x1ffe] = (A2_ADDR >>> 8) & 0xff;
    state.workRam[0x1fff] = A2_ADDR & 0xff;
    state.workRam[0x1ff5] = acc0;
    state.workRam[0x1ff7] = ctr0;

    // ── Run binary (1 long arg) ─────────────────────────────────────────
    const r = callFunction(cpu, FUN_3FC6, [arg]);
    const binD0 = r.d0 >>> 0;
    const binAcc = peekMem(cpu, ACC_FF5, 1) & 0xff;
    const binCtr = peekMem(cpu, COUNTER_FF7, 1) & 0xff;

    // ── Run TS ──────────────────────────────────────────────────────────
    const tsD0 = ecrNs.eepromCommitRequest(state, arg) >>> 0;
    const tsAcc = (state.workRam[0x1ff5] ?? 0) & 0xff;
    const tsCtr = (state.workRam[0x1ff7] ?? 0) & 0xff;

    const match = binD0 === tsD0 && binAcc === tsAcc && binCtr === tsCtr;
    if (match) {
      ok++;
    } else if (firstFail === null) {
      firstFail = {
        i,
        pattern,
        status,
        compl,
        acc0,
        ctr0,
        arg,
        binD0,
        tsD0,
        binAcc,
        tsAcc,
        binCtr,
        tsCtr,
      };
    }
  }

  console.log(`  Match: ${ok}/${n} = ${((ok / n) * 100).toFixed(1)}%`);
  if (firstFail) {
    const f = firstFail;
    console.log(`  First fail @ case ${f.i} (pattern=${f.pattern}):`);
    console.log(
      `    inputs: arg=0x${f.arg.toString(16)} status=0x${f.status.toString(16)} compl=0x${f.compl.toString(16)} acc0=0x${f.acc0.toString(16)} ctr0=0x${f.ctr0.toString(16)}`,
    );
    console.log(
      `    bin: D0=0x${f.binD0.toString(16)} acc=0x${f.binAcc.toString(16)} ctr=0x${f.binCtr.toString(16)}`,
    );
    console.log(
      `    ts : D0=0x${f.tsD0.toString(16)} acc=0x${f.tsAcc.toString(16)} ctr=0x${f.tsCtr.toString(16)}`,
    );
  }

  disposeCpu(cpu);
  exit(ok === n ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  exit(1);
});
