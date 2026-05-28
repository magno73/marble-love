#!/usr/bin/env node
/**
 * test-rng-parity.ts — differential testing del RNG: chiama FUN_13A98 nel
 * binary via Musashi, compares the seed delta and return value with the
 * our TS implementation in `@marble-love/engine/rng`.
 *
 * PRD §6 Phase 4 acceptance: "the first 10000 calls produce the same
 * oracle sequence".
 *
 * Uso:
 *   npx tsx packages/cli/src/test-rng-parity.ts [N]
 *
 * (N = numero di test cases, default 100)
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import {
  state as stateNs,
  rng as rngNs,
  wrap,
} from "@marble-love/engine";

import { createCpu, callFunction, pokeMem, peekMem, disposeCpu } from "./binary-oracle-lib.js";

const FUN_RNG = 0x00013A98;
const RNG_SEED_ADDR = 0x004003A6;

interface TestCase {
  seed: number;     // u16
  limit: number;    // u16
}

function generateTestCases(n: number, rngForGen: () => number): TestCase[] {
  const cases: TestCase[] = [];
  for (let i = 0; i < n; i++) {
    cases.push({
      seed: Math.floor(rngForGen() * 0x10000) & 0xffff,
      limit: Math.max(1, Math.floor(rngForGen() * 0x8000)) & 0xffff,
    });
  }
  return cases;
}

interface ComparisonResult {
  seed: number;
  limit: number;
  binaryReturn: number;
  binarySeedAfter: number;
  tsReturn: number;
  tsSeedAfter: number;
  match: boolean;
}

async function main(): Promise<void> {
  const n = Number(process.argv[2] ?? "100");

  const romPath = resolve("ghidra_project/marble_program.bin");
  if (!existsSync(romPath)) {
    console.error(`error: ROM blob not found at ${romPath}`);
    exit(3);
  }
  const rom = readFileSync(romPath);

  console.log(`[rng-parity] testing ${n} seed/limit pairs`);
  console.log(`[rng-parity] FUN_13A98 binary vs rngNext TS\n`);

  const state = stateNs.emptyGameState();
  const cpu = await createCpu({ rom, state });

  // Seed deterministica per test cases riproducibili
  let prng_state = 0xABCD1234;
  const detRng = (): number => {
    prng_state = (prng_state * 1103515245 + 12345) >>> 0;
    return ((prng_state >>> 16) & 0xffff) / 0x10000;
  };

  const cases = generateTestCases(n, detRng);
  const results: ComparisonResult[] = [];
  let mismatches = 0;

  for (const c of cases) {
    // BINARY: set seed, call, read seed + D0
    pokeMem(cpu, RNG_SEED_ADDR, 2, c.seed);
    const callResult = callFunction(cpu, FUN_RNG, [c.limit]);
    const binarySeedAfter = peekMem(cpu, RNG_SEED_ADDR, 2);

    // TS: set seed, call rngNext
    const rstate = rngNs.rngInit(wrap.as_u16(c.seed));
    const tsReturn = rngNs.rngNext(rstate, wrap.as_u16(c.limit));
    const tsSeedAfter = (rstate.seed as unknown as number) & 0xffff;

    const match = (
      ((callResult.d0 & 0xffff) === (tsReturn as unknown as number)) &&
      (binarySeedAfter === tsSeedAfter)
    );

    if (!match) mismatches++;

    results.push({
      seed: c.seed,
      limit: c.limit,
      binaryReturn: callResult.d0 & 0xffff,
      binarySeedAfter,
      tsReturn: tsReturn as unknown as number,
      tsSeedAfter,
      match,
    });
  }

  // Print summary
  console.log(`Match rate: ${results.length - mismatches}/${results.length} = ${(((results.length - mismatches) / results.length) * 100).toFixed(1)}%\n`);

  if (mismatches > 0) {
    console.log("First 10 mismatches:");
    console.log(
      "  seed   limit  | bin_ret bin_seed | ts_ret  ts_seed | seed Δ | ret Δ"
    );
    let printed = 0;
    for (const r of results) {
      if (r.match) continue;
      console.log(
        `  0x${r.seed.toString(16).padStart(4, "0").toUpperCase()} ` +
        `0x${r.limit.toString(16).padStart(4, "0").toUpperCase()} | ` +
        `0x${r.binaryReturn.toString(16).padStart(4, "0")} ` +
        `0x${r.binarySeedAfter.toString(16).padStart(4, "0")} | ` +
        `0x${r.tsReturn.toString(16).padStart(4, "0")} ` +
        `0x${r.tsSeedAfter.toString(16).padStart(4, "0")} | ` +
        `${r.tsSeedAfter !== r.binarySeedAfter ? "✗" : "·"}     | ` +
        `${r.tsReturn !== r.binaryReturn ? "✗" : "·"}`
      );
      printed++;
      if (printed >= 10) break;
    }
  } else {
    console.log("✅ Tutti i casi matchano. RNG TS bit-perfect col binary.");
  }

  disposeCpu(cpu);
  exit(mismatches > 0 ? 1 : 0);
}

main().catch((err: unknown) => {
  console.error(err);
  exit(1);
});
