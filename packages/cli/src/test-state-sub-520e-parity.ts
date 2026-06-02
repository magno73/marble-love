#!/usr/bin/env node
/**
 * test-state-sub-520e-parity.ts — differential FUN_520E vs stateSub520E.
 *
 * `packages/engine/src/state-sub-520e.ts`):
 *   1. workRam[A2..A2+8]      = 0
 *   2. workRam[A2+0xE..A2+0x12] = 0
 *   3. workRam[0x1F5E..0x1F61] (long-BE) |= 0x3
 *   4. workRam[A2+0x14..A2+0x1D] = 0
 *   5. *0x401F5E |= bit derived from byte @ A2+9 (preexisting)
 *   6. *0x401F5E |= bit derived from long-BE @ SP+4 (saved A3 in production)
 *
 * Parity strategy:
 *     `state.workRam` TS.
 *   - Set A2 = random pointer 4-aligned in `[0x400000..0x401C00]` (range
 *     chosen to avoid overlap with the status-flags long @ 0x1F5E and the
 *     of the run and pass it as `stackD0` to the TS replica.
 *   - Pre-populate `*0x401F5E` with a random long to verify cumulative OR path.
 *   - Run `callFunction(cpu, 0x520E)` and `stateSub520E(state, a2, stackD0)`.
 *
 * Usage: npx tsx packages/cli/src/test-state-sub-520e-parity.ts [N]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import {
  state as stateNs,
  stateSub520E as ssNs,
} from "@marble-love/engine";
import {
  createCpu,
  callFunction,
  pokeMem,
  peekMem,
  disposeCpu,
} from "./binary-oracle-lib.js";

const FUN_520E = 0x0000520e;
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

  console.log(`\n=== stateSub520E (FUN_520E) — ${n} cases ===`);

  const rng = makeRng(0x520e520e);
  let ok = 0;
  let firstFail: {
    i: number;
    a2: number;
    stackD0: number;
    byteAtA2_9: number;
    initialFlags: number;
    diffOffsets: number[];
  } | null = null;

  for (let i = 0; i < n; i++) {
    cpu.system.setRegister("sp", SP_INITIAL);

    // A2: random pointer 4-aligned in workRam.
    // Safe range: the clears touch A2+0..A2+0x1D (30 byte). To avoid
    // overlapping the status-flags long @ 0x1F5E (4 byte) and the stack area
    // [0x1EE0..0x1F00] (32 byte), limit to A2_off ≤ 0x1C00.
    // Also A2_off ≥ 0 obviously.
    let a2: number;
    if (i === 0) {
      a2 = 0x00400000;
    } else if (i === 1) {
      a2 = 0x00401000; // mid range
    } else if (i === 2) {
      a2 = 0x00401C00;
    } else if (i === 3) {
      a2 = 0x00400500; // misc offset
    } else {
      const a2OffRaw = Math.floor(rng() * (0x1c00 / 4)) * 4;
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

    // Sync seed in Musashi memory + state.workRam
    for (let k = 0; k < WORK_RAM_SIZE; k++) {
      pokeMem(cpu, WORK_RAM_BASE + k, 1, seedBuf[k]!);
      state.workRam[k] = seedBuf[k]!;
    }

    const byteAtA2_9 = state.workRam[(a2 - WORK_RAM_BASE + 9) >>> 0]! & 0xff;

    // Capture long-BE @ SP+4 (= 0x401F00 → workRam[0x1F00..0x1F03])
    // The three clear phases do NOT touch [0x1F00..0x1F03] (clear = A2+0..0x1D
    // where A2 <= 0x1C00 -> max cleared addr = 0x1C1D < 0x1F00). The bsr to
    // 0x5224 + 0x5234 touch only SP region [0x1EF8..0x1EFB] (ret addrs).
    const stackD0 =
      (((seedBuf[0x1f00] ?? 0) << 24) |
        ((seedBuf[0x1f01] ?? 0) << 16) |
        ((seedBuf[0x1f02] ?? 0) << 8) |
        (seedBuf[0x1f03] ?? 0)) >>>
      0;

    cpu.system.setRegister("a2", a2 >>> 0);

    // Run binary
    callFunction(cpu, FUN_520E, []);

    // Run TS
    ssNs.stateSub520E(state, a2, stackD0);

    // touched = [0x1EF8..0x1EFF] (8 bytes). TS does NOT model the stack.
    // Exclude [0x1EE0..0x1F00) for safety (extra margin).
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
      firstFail = {
        i,
        a2,
        stackD0,
        byteAtA2_9,
        initialFlags,
        diffOffsets,
      };
    }
  }

  console.log(`  Match: ${ok}/${n} = ${((ok / n) * 100).toFixed(1)}%`);
  if (firstFail) {
    console.log(`  First fail @ case ${firstFail.i}:`);
    console.log(
      `    inputs: a2=0x${firstFail.a2.toString(16)} stackD0=0x${firstFail.stackD0.toString(16)} byte@A2+9=0x${firstFail.byteAtA2_9.toString(16)} initialFlags=0x${firstFail.initialFlags.toString(16)}`,
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
