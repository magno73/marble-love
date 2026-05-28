#!/usr/bin/env node
/**
 * test-helper-28c38-parity.ts — differential FUN_00028C38 vs helper28C38.
 *
 * Per N test cases:
 *   1. Setup 5 byte struct in workRam scratch area
 *   2. callFunction(0x28C38, [structPtr])  — MAME/musashi-wasm binary.
 *   3. helper28C38(state, structPtr)       — replica TS
 *   4. Confronta D0.b (return low byte) + 5 byte struct post-call
 *
 * Uso: npx tsx packages/cli/src/test-helper-28c38-parity.ts [N]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import { state as stateNs, helper28C38 as h28C38Ns } from "@marble-love/engine";
import {
  createCpu,
  callFunction,
  pokeMem,
  peekMem,
  disposeCpu,
} from "./binary-oracle-lib.js";

const FUN_ADDR = 0x00028c38;
const STRUCT_ADDR = 0x401d00;

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

  console.log(`\n=== helper28C38 (FUN_00028C38) — ${n} casi ===`);

  const rng = makeRng(0x28c38);
  let ok = 0;
  let firstFail: {
    initial: number[];
    binStruct: number[];
    binD0: number;
    tsStruct: number[];
    tsD0: number;
  } | null = null;

  for (let i = 0; i < n; i++) {
    cpu.system.setRegister("sp", 0x401f00);

    // Random 5 bytes
    const bytes = [
      Math.floor(rng() * 256) & 0xff, // outer high
      Math.floor(rng() * 256) & 0xff, // outer low
      Math.floor(rng() * 256) & 0xff, // medium
      Math.floor(rng() * 256) & 0xff, // padding (not touched)
      Math.floor(rng() * 256) & 0xff, // inner
    ];
    // 1/8 of cases: force inner = 0xFF (disabled path).
    if (i % 8 === 0) bytes[4] = 0xff;

    for (let j = 0; j < 5; j++) {
      pokeMem(cpu, STRUCT_ADDR + j, 1, bytes[j]!);
      state.workRam[STRUCT_ADDR - 0x400000 + j] = bytes[j]!;
    }

    // Binary oracle
    const r = callFunction(cpu, FUN_ADDR, [STRUCT_ADDR]);
    const binD0 = r.d0 & 0xff;
    const binStruct: number[] = [];
    for (let j = 0; j < 5; j++) binStruct.push(peekMem(cpu, STRUCT_ADDR + j, 1));

    // TS replica
    const tsD0 = h28C38Ns.helper28C38(state, STRUCT_ADDR) & 0xff;
    const tsStruct: number[] = [];
    for (let j = 0; j < 5; j++)
      tsStruct.push(state.workRam[STRUCT_ADDR - 0x400000 + j] ?? 0);

    const match =
      binD0 === tsD0 && binStruct.every((b, j) => b === tsStruct[j]);
    if (match) ok++;
    else if (firstFail === null) {
      firstFail = {
        initial: [...bytes],
        binStruct,
        binD0,
        tsStruct,
        tsD0,
      };
    }
  }

  console.log(`  Match: ${ok}/${n} = ${((ok / n) * 100).toFixed(1)}%`);
  if (firstFail) {
    const { initial, binStruct, binD0, tsStruct, tsD0 } = firstFail;
    console.log(`  First fail:`);
    console.log(
      `    initial: [${initial.map((x) => x.toString(16)).join(",")}]`,
    );
    console.log(
      `    bin: D0=${binD0} struct=[${binStruct.map((x) => x.toString(16)).join(",")}]`,
    );
    console.log(
      `    ts:  D0=${tsD0} struct=[${tsStruct.map((x) => x.toString(16)).join(",")}]`,
    );
  }

  disposeCpu(cpu);
  exit(ok === n ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  exit(1);
});
