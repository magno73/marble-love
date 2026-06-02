#!/usr/bin/env node
/**
 * test-state-sub-5200-parity.ts — differential FUN_5200 vs stateSub5200.
 *
 *   1. `workRam[A2-0x400000+0x1e .. +0x31]` = 0  (20 byte)
 *   2. long-BE @ `0x401F5E` |= 0x0000000c  (bits 2,3)
 *
 * Parity strategy:
 *     `state.workRam` TS.
 *   - Set A2 = pointer in workRam (multiple of 4) so the range
 *     the status flags @ 0x1F5E: A2 ≤ 0x401F5E - 0x31 = 0x401F2D →
 *     conservatively A2 ≤ 0x401E00.
 *   - Pre-populate `*0x401F5E` with a random long to verify cumulative OR path.
 *   - Run `callFunction(cpu, 0x5200)` and `stateSub5200(state, a2)`.
 *
 * Smoke cases (first 3):
 *   1: a2 = 0x400800 (mid range)
 *
 * Usage: npx tsx packages/cli/src/test-state-sub-5200-parity.ts [N]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import {
  state as stateNs,
  stateSub5200 as ssNs,
} from "@marble-love/engine";
import {
  createCpu,
  callFunction,
  pokeMem,
  peekMem,
  disposeCpu,
} from "./binary-oracle-lib.js";

const FUN_5200 = 0x00005200;
const WORK_RAM_BASE = 0x00400000;
const WORK_RAM_SIZE = 0x2000;
const SP_INITIAL = 0x00401f00;

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) >>> 0;
    return ((s >>> 16) & 0xffff) / 0x10000;
  };
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

  console.log(`\n=== stateSub5200 (FUN_5200) — ${n} cases ===`);

  const rng = makeRng(0x52005200);
  let ok = 0;
  let firstFail: {
    i: number;
    a2: number;
    initialFlags: number;
    diffOffsets: number[];
  } | null = null;

  for (let i = 0; i < n; i++) {
    cpu.system.setRegister("sp", SP_INITIAL);

    // A2: pointer in workRam, 4-aligned.
    // Cleared range: A2+0x1e..A2+0x31. To avoid touching 0x401F5E (status flags)
    let a2: number;
    if (i === 0) {
      a2 = 0x00400000;
    } else if (i === 1) {
      a2 = 0x00400800; // mid range
    } else if (i === 2) {
      a2 = 0x00401e00;
    } else {
      const maxOff = 0x1e00; // 0x401E00 - 0x400000
      const a2OffRaw = Math.floor(rng() * (maxOff / 4)) * 4;
      a2 = (WORK_RAM_BASE + a2OffRaw) >>> 0;
    }

    const seedBuf = new Uint8Array(WORK_RAM_SIZE);
    for (let k = 0; k < WORK_RAM_SIZE; k++) {
      seedBuf[k] = Math.floor(rng() * 0x100) & 0xff;
    }
    // Pre-populate initial status flags long for cumulative OR test.
    const initialFlags = Math.floor(rng() * 0x100000000) >>> 0;
    seedBuf[0x1f5e] = (initialFlags >>> 24) & 0xff;
    seedBuf[0x1f5f] = (initialFlags >>> 16) & 0xff;
    seedBuf[0x1f60] = (initialFlags >>> 8) & 0xff;
    seedBuf[0x1f61] = initialFlags & 0xff;

    // Sync seed in Musashi memory + state.workRam.
    for (let k = 0; k < WORK_RAM_SIZE; k++) {
      pokeMem(cpu, WORK_RAM_BASE + k, 1, seedBuf[k]!);
      state.workRam[k] = seedBuf[k]!;
    }

    // Setup register: A2.
    cpu.system.setRegister("a2", a2 >>> 0);

    // Run binary.
    callFunction(cpu, FUN_5200, []);

    // Run TS.
    ssNs.stateSub5200(state, a2);

    // callFunction (SP=0x401F00) pushes sentinel ret addr at 0x401EFC.
    // Touched zone: [0x1EFC..0x1EFF] (4 sentinel bytes). Exclude
    // conservatively [0x1EE0..0x1F00).
    const STACK_LOW = 0x1ee0;
    const STACK_HIGH = 0x1f00;
    const diffOffsets: number[] = [];
    for (let k = 0; k < WORK_RAM_SIZE; k++) {
      if (k >= STACK_LOW && k < STACK_HIGH) continue;
      const binByte = peekMem(cpu, WORK_RAM_BASE + k, 1) & 0xff;
      const tsByte = state.workRam[k]! & 0xff;
      if (binByte !== tsByte) {
        diffOffsets.push(k);
        if (diffOffsets.length > 16) break;
      }
    }

    if (diffOffsets.length === 0) {
      ok++;
    } else if (firstFail === null) {
      firstFail = { i, a2, initialFlags, diffOffsets };
    }
  }

  console.log(`  Match: ${ok}/${n} = ${((ok / n) * 100).toFixed(1)}%`);
  if (firstFail) {
    console.log(`  First fail @ case ${firstFail.i}:`);
    console.log(
      `    inputs: a2=0x${firstFail.a2.toString(16)} initialFlags=0x${firstFail.initialFlags.toString(16)}`,
    );
    console.log(
      `    diff offsets (workRam): ${firstFail.diffOffsets
        .map((o) => `0x${o.toString(16)}`)
        .join(", ")}`,
    );
  }

  disposeCpu(cpu);
  exit(ok === n ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  exit(1);
});
