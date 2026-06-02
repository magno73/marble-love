#!/usr/bin/env node
/**
 * test-random-mod-13a98-parity.ts — differential testing of FUN_00013A98
 * (randomMod13A98) vs the original binary via Musashi WASM.
 *
 * For each test case:
 *   1. Set RNG seed in Work RAM (0x004003A6) through pokeMem
 *   2. Call FUN_13A98 in the binary with maxExclusive as argument
 *   3. Call randomMod13A98(state, maxExclusive) in the TS implementation
 *   4. Compare: return value (D0.w) and updated seed (0x004003A6)
 *
 * Usage:
 *   npx tsx packages/cli/src/test-random-mod-13a98-parity.ts [N]
 *
 * (N = number of test cases, default 500)
 *
 * Acceptance: 500/500 = 100%
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import {
  state as stateNs,
  rng as rngNs,
  randomMod13A98 as randomMod13A98Ns,
  wrap,
} from "@marble-love/engine";

import { createCpu, callFunction, pokeMem, peekMem, disposeCpu } from "./binary-oracle-lib.js";

const FUN_RNG = 0x00013a98;
const RNG_SEED_ADDR = 0x004003a6;

const { as_u16 } = wrap;

function findRomBlobPath(): string {
  const candidates = [
    process.env.MARBLE_ROM_BLOB,
    resolve("ghidra_project/marble_program.bin"),
    resolve("../marble-love/ghidra_project/marble_program.bin"),
  ].filter((p): p is string => p !== undefined && p.length > 0);
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  throw new Error(
    "ROM blob not found; set MARBLE_ROM_BLOB or keep ghidra_project/marble_program.bin in the repo."
  );
}

/** Small deterministic LCG for reproducible test cases. */
function makeDetRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1103515245) + 12345) >>> 0;
    return ((s >>> 16) & 0xffff) / 0x10000;
  };
}

interface Mismatch {
  caseNo: number;
  seed: number;
  limit: number;
  binRet: number;
  binSeedAfter: number;
  tsRet: number;
  tsSeedAfter: number;
}

async function main(): Promise<void> {
  const n = Number(process.argv[2] ?? "500");

  const romPath = findRomBlobPath();
  const rom = readFileSync(romPath);

  console.log(`[random-mod-13a98-parity] testing ${n} cases`);
  console.log(`[random-mod-13a98-parity] FUN_13A98 binary vs randomMod13A98 TS\n`);

  const gameState = stateNs.emptyGameState();
  const cpu = await createCpu({ rom, state: gameState });

  const detRng = makeDetRng(0x13a98);
  let ok = 0;
  const mismatches: Mismatch[] = [];

  for (let i = 0; i < n; i++) {
    const seed = Math.floor(detRng() * 0x10000) & 0xffff;
    // maxExclusive in [1, 256] matching typical game usage
    const limit = Math.max(1, Math.floor(detRng() * 256)) & 0xffff;

    // BINARY: poke seed, call FUN_13A98, read back seed and D0
    pokeMem(cpu, RNG_SEED_ADDR, 2, seed);
    const callResult = callFunction(cpu, FUN_RNG, [limit]);
    const binRet = callResult.d0 & 0xffff;
    const binSeedAfter = peekMem(cpu, RNG_SEED_ADDR, 2);

    // TS: set state.rng seed, call randomMod13A98
    gameState.rng = rngNs.rngInit(as_u16(seed));
    const tsRet = randomMod13A98Ns.randomMod13A98(gameState, limit);
    const tsSeedAfter = (gameState.rng.seed as unknown as number) & 0xffff;

    const match = binRet === tsRet && binSeedAfter === tsSeedAfter;

    if (match) {
      ok++;
    } else {
      mismatches.push({ caseNo: i, seed, limit, binRet, binSeedAfter, tsRet, tsSeedAfter });
    }
  }

  // Summary
  const pct = ((ok / n) * 100).toFixed(1);
  console.log(`Match rate: ${ok}/${n} = ${pct}%\n`);

  if (mismatches.length > 0) {
    console.log(`First ${Math.min(10, mismatches.length)} mismatches:`);
    console.log("  #    seed   limit | bin_ret bin_seed | ts_ret  ts_seed | ret? seed?");
    for (const m of mismatches.slice(0, 10)) {
      const retOk = m.binRet === m.tsRet ? "OK" : "FAIL";
      const seedOk = m.binSeedAfter === m.tsSeedAfter ? "OK" : "FAIL";
      console.log(
        `  ${String(m.caseNo).padStart(4)} ` +
        `0x${m.seed.toString(16).padStart(4, "0").toUpperCase()} ` +
        `0x${m.limit.toString(16).padStart(4, "0").toUpperCase()} | ` +
        `0x${m.binRet.toString(16).padStart(4, "0")} ` +
        `0x${m.binSeedAfter.toString(16).padStart(4, "0")} | ` +
        `0x${m.tsRet.toString(16).padStart(4, "0")} ` +
        `0x${m.tsSeedAfter.toString(16).padStart(4, "0")} | ` +
        `${retOk.padEnd(4)} ${seedOk}`
      );
    }
  } else {
    console.log("All cases match. randomMod13A98 is bit-perfect vs binary.");
  }

  disposeCpu(cpu);
  exit(ok === n ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  exit(1);
});
