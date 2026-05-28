#!/usr/bin/env node
/**
 * test-helper-5236-parity.ts — differential FUN_5236 vs helper5236.
 *
 * long-BE @ 0x401F5E.
 *
 *   - long-BE @ workRam[0x1F5E..0x1F61] |= mask, where mask = (arg < 2) ?
 *     (1 << arg) : (arg - 2 < 32 ? (1 << (arg - 2)) : 0).
 *
 * **Strategia parity**:
 *     return address sentinel). `(4,SP)` = 0x401F00 = workRam[0x1F00..0x1F03].
 *   - Pre-populate workRam with random bytes; sync both Musashi and TS.
 *   - Pre-populate *0x401F5E with a random long to verify cumulative OR path.
 *   - Lancia `callFunction(cpu, 0x5236)` e `helper5236(state, arg)`.
 *
 *   - 0x401EFC: sentinel return address (4 byte, spinto da callFunction)
 *
 * Uso: npx tsx packages/cli/src/test-helper-5236-parity.ts [N]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import {
  state as stateNs,
  helper5236 as h5236Ns,
} from "@marble-love/engine";
import {
  createCpu,
  callFunction,
  pokeMem,
  peekMem,
  disposeCpu,
} from "./binary-oracle-lib.js";

const FUN_5236 = 0x00005236;
const WORK_RAM_BASE = 0x00400000;
const WORK_RAM_SIZE = 0x2000;
// = SP_INITIAL - 4 = 0x401EFC.  (4,SP) = 0x401F00 = workRam[0x1F00].
const SP_INITIAL = 0x00401f00;
const ARG_OFF = 0x1f00; // = SP_INITIAL - WORK_RAM_BASE

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

  console.log(`\n=== helper5236 (FUN_5236) — ${n} casi ===`);

  const rng = makeRng(0x52365236);
  let ok = 0;
  let firstFail: {
    i: number;
    arg: number;
    initialFlags: number;
    diffOffsets: number[];
  } | null = null;

  const specialArgs: number[] = [
    0x00000000, // shift=0 → mask=1
    0x00000001, // shift=1 → mask=2
    0x00000002, // D0>=2 → shift=0 → mask=1
    0x00000003, // D0>=2 → shift=1 → mask=2
    0x0000001f, // D0>=2 → shift=29 → mask=0x20000000
    0x00000021, // D0>=2 → shift=31 → mask=0x80000000
    0x00000022, // D0>=2 → shift=32 → no-op
    0x000000ff, // D0>=2 → shift=0xFD & 0x3F = 0x3D = 61 >= 32 → no-op
    0x00f00001,
    0xffffffff, // D0>=2 → shift=0xFFFFFFFD & 0x3F = 61 → no-op
  ];

  for (let i = 0; i < n; i++) {
    cpu.system.setRegister("sp", SP_INITIAL);

    let arg: number;
    if (i < specialArgs.length) {
      arg = specialArgs[i]!;
    } else {
      // Random 32-bit arg per copertura ampia
      arg = Math.floor(rng() * 0x100000000) >>> 0;
    }

    const seedBuf = new Uint8Array(WORK_RAM_SIZE);
    for (let k = 0; k < WORK_RAM_SIZE; k++) {
      seedBuf[k] = Math.floor(rng() * 0x100) & 0xff;
    }

    seedBuf[ARG_OFF]     = (arg >>> 24) & 0xff;
    seedBuf[ARG_OFF + 1] = (arg >>> 16) & 0xff;
    seedBuf[ARG_OFF + 2] = (arg >>> 8)  & 0xff;
    seedBuf[ARG_OFF + 3] =  arg         & 0xff;

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


    // Run binary.
    callFunction(cpu, FUN_5236, []);

    // Run TS.
    h5236Ns.helper5236(state, arg);

    // callFunction (SP=0x401F00) pusha sentinel ret addr a 0x401EFC (4 byte).
    // Escludiamo conservativamente [0x1EE0..0x1F00).
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
      firstFail = { i, arg, initialFlags, diffOffsets };
    }
  }

  console.log(`  Match: ${ok}/${n} = ${((ok / n) * 100).toFixed(1)}%`);
  if (firstFail) {
    console.log(`  First fail @ case ${firstFail.i}:`);
    console.log(
      `    inputs: arg=0x${firstFail.arg.toString(16)} initialFlags=0x${firstFail.initialFlags.toString(16)}`,
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
