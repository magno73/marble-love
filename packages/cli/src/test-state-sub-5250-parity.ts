#!/usr/bin/env node
/**
 * test-state-sub-5250-parity.ts — differential FUN_5250 vs stateSub5250.
 *
 * `FUN_00005250` (12 byte, 0x5250–0x525B):
 *   or.l D1,(0x00401F5E).l   ; primary flags long-BE
 *   or.l D1,(0x00401F76).l   ; secondary flags long-BE
 *   (rts @ 0x525C shared with FUN_525C)
 *
 * Strategia parity:
 *   - For each case: set primary (0x401F5E) and secondary (0x401F76) to
 *     controlled values; set D1 to the bitmask to OR.
 *   - Launch binary via `callFunction(cpu, 0x5250, [])` with D1 pre-set
 *     via `cpu.system.setRegister("d1", d1)`.
 *   - Lancia `stateSub5250(state, d1)`.
 *   - Compare primary e secondary long-BE post-esecuzione.
 *
 * Casi boundary:
 *   0: d1=0, primary=0, secondary=0            → no-op
 *   1: d1=0xFFFFFFFF, primary=0, secondary=0   → all bits set
 *   2: d1=0x00000001, primary=0, secondary=0   → single bit
 *   3: d1=0x80000000, primary=0, secondary=0   → MSB
 *   4: d1=0xAAAAAAAA, primary=0x55555555        → interleaved bits OR
 *   5: d1=0x12345678, primary=0x12345678, sec=0x87654321 → already set bits idempotent
 *   >= 6: random d1, random primary, random secondary
 *
 * Uso: npx tsx packages/cli/src/test-state-sub-5250-parity.ts [N]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import {
  state as stateNs,
  stateSub5250 as ssNs,
} from "@marble-love/engine";
import {
  createCpu,
  callFunction,
  pokeMem,
  peekMem,
  disposeCpu,
} from "./binary-oracle-lib.js";

const FUN_5250 = 0x00005250;
const PRIMARY_ADDR = 0x00401f5e;
const SECONDARY_ADDR = 0x00401f76;

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
  const rom = new Uint8Array(readFileSync(romPath));

  const state = stateNs.emptyGameState();
  const cpu = await createCpu({ rom, state });

  console.log(`\n=== stateSub5250 (FUN_5250) — ${n} cases ===`);

  const rng = makeRng(0x5250_5250);
  let ok = 0;
  let firstFail: {
    i: number;
    d1: number;
    initPrimary: number;
    initSecondary: number;
    binPrimary: number;
    tsPrimary: number;
    binSecondary: number;
    tsSecondary: number;
  } | null = null;

  const BOUNDARY: Array<{ d1: number; primary: number; secondary: number }> = [
    { d1: 0x00000000, primary: 0x00000000, secondary: 0x00000000 },
    { d1: 0xffffffff, primary: 0x00000000, secondary: 0x00000000 },
    { d1: 0x00000001, primary: 0x00000000, secondary: 0x00000000 },
    { d1: 0x80000000, primary: 0x00000000, secondary: 0x00000000 },
    { d1: 0xaaaaaaaa, primary: 0x55555555, secondary: 0x55555555 },
    { d1: 0x12345678, primary: 0x12345678, secondary: 0x87654321 },
  ];

  for (let i = 0; i < n; i++) {
    cpu.system.setRegister("sp", 0x401f00);

    let d1: number;
    let initPrimary: number;
    let initSecondary: number;

    if (i < BOUNDARY.length) {
      const b = BOUNDARY[i]!;
      d1 = b.d1 >>> 0;
      initPrimary = b.primary >>> 0;
      initSecondary = b.secondary >>> 0;
    } else {
      d1 = Math.floor(rng() * 0x100000000) >>> 0;
      initPrimary = Math.floor(rng() * 0x100000000) >>> 0;
      initSecondary = Math.floor(rng() * 0x100000000) >>> 0;
    }

    // Sync state in binary oracle.
    pokeMem(cpu, PRIMARY_ADDR, 4, initPrimary);
    pokeMem(cpu, SECONDARY_ADDR, 4, initSecondary);

    // Sync state in TS.
    state.workRam[0x1f5e] = (initPrimary >>> 24) & 0xff;
    state.workRam[0x1f5f] = (initPrimary >>> 16) & 0xff;
    state.workRam[0x1f60] = (initPrimary >>> 8)  & 0xff;
    state.workRam[0x1f61] =  initPrimary         & 0xff;
    state.workRam[0x1f76] = (initSecondary >>> 24) & 0xff;
    state.workRam[0x1f77] = (initSecondary >>> 16) & 0xff;
    state.workRam[0x1f78] = (initSecondary >>> 8)  & 0xff;
    state.workRam[0x1f79] =  initSecondary         & 0xff;

    // Set D1 for binary.
    cpu.system.setRegister("d1", d1);

    // Run binary.
    callFunction(cpu, FUN_5250, []);
    const binPrimary   = peekMem(cpu, PRIMARY_ADDR, 4) >>> 0;
    const binSecondary = peekMem(cpu, SECONDARY_ADDR, 4) >>> 0;

    // Sync primary/secondary back to state before TS run (callFunction may mutate
    // shared workRam via pokeMem; reset to initPrimary/initSecondary for TS).
    state.workRam[0x1f5e] = (initPrimary >>> 24) & 0xff;
    state.workRam[0x1f5f] = (initPrimary >>> 16) & 0xff;
    state.workRam[0x1f60] = (initPrimary >>> 8)  & 0xff;
    state.workRam[0x1f61] =  initPrimary         & 0xff;
    state.workRam[0x1f76] = (initSecondary >>> 24) & 0xff;
    state.workRam[0x1f77] = (initSecondary >>> 16) & 0xff;
    state.workRam[0x1f78] = (initSecondary >>> 8)  & 0xff;
    state.workRam[0x1f79] =  initSecondary         & 0xff;

    // Run TS.
    ssNs.stateSub5250(state, d1);
    const tsPrimary =
      (((state.workRam[0x1f5e] ?? 0) << 24) |
        ((state.workRam[0x1f5f] ?? 0) << 16) |
        ((state.workRam[0x1f60] ?? 0) << 8)  |
        (state.workRam[0x1f61] ?? 0)) >>>
      0;
    const tsSecondary =
      (((state.workRam[0x1f76] ?? 0) << 24) |
        ((state.workRam[0x1f77] ?? 0) << 16) |
        ((state.workRam[0x1f78] ?? 0) << 8)  |
        (state.workRam[0x1f79] ?? 0)) >>>
      0;

    const match = binPrimary === tsPrimary && binSecondary === tsSecondary;
    if (match) {
      ok++;
    } else if (firstFail === null) {
      firstFail = {
        i,
        d1,
        initPrimary,
        initSecondary,
        binPrimary,
        tsPrimary,
        binSecondary,
        tsSecondary,
      };
    }
  }

  console.log(`  Match: ${ok}/${n} = ${((ok / n) * 100).toFixed(1)}%`);
  if (firstFail) {
    const ff = firstFail;
    console.log(`  First fail @ case ${ff.i}:`);
    console.log(`    d1=0x${ff.d1.toString(16).padStart(8, "0")}`);
    console.log(
      `    initPrimary=0x${ff.initPrimary.toString(16).padStart(8, "0")}  initSecondary=0x${ff.initSecondary.toString(16).padStart(8, "0")}`,
    );
    console.log(
      `    bin: primary=0x${ff.binPrimary.toString(16).padStart(8, "0")} secondary=0x${ff.binSecondary.toString(16).padStart(8, "0")}`,
    );
    console.log(
      `    ts : primary=0x${ff.tsPrimary.toString(16).padStart(8, "0")} secondary=0x${ff.tsSecondary.toString(16).padStart(8, "0")}`,
    );
  }

  disposeCpu(cpu);
  exit(ok === n ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  exit(1);
});
