#!/usr/bin/env node
/**
 * test-sprite-pair-coord-add-1d82-parity.ts — differential FUN_1D82 vs
 * `spritePairCoordAdd1D82` TS replica.
 *
 * `FUN_00001D82` (134 bytes) extracts the signed 9-bit coord from TWO words of
 * sprite-RAM (banks 0xA02000 and 0xA02100, separated by 0x100), adds two
 * deltas, repacks, and writes back with bits 14 and 15 cleared.
 *
 * **Parity strategy**:
 *     (also with bits 14,15 and bit 4 set to test masks).
 *     a known pattern to detect spurious writes.
 *
 * Tested suites (4 × 125 = 500):
 *   - A: bank=0, col random ∈ [0..0x7F] — base case, low addr.
 *   - B: bank random ∈ [0..7], col random ∈ [0..0x7F] — full sweep.
 *   - C: bank=7, col=0..0x7F — high addr (max range).
 *   - D: random delta + target word with bits 14,15 and low nibble set —
 *
 * Usage: npx tsx packages/cli/src/test-sprite-pair-coord-add-1d82-parity.ts [N=500]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import { state as stateNs } from "@marble-love/engine";
import type { GameState } from "@marble-love/engine";
// (`@marble-love/engine` links via npm workspace to the main repo, NOT the worktree).
// Import via relative path from the worktree src to test the version
import * as sub1D82WorktreeNs from "../../engine/src/sprite-pair-coord-add-1d82.js";

// from the main package. They are structurally identical (same layout of
// Uint8Array/u8/u32), but TypeScript treats them as distinct types because of
// nominal tag `__u32`. Explicit cast for the typechecker.
const sub1D82Ns = sub1D82WorktreeNs as unknown as {
  spritePairCoordAdd1D82: (
    state: GameState,
    col: number,
    bank: number,
    deltaA: number,
    deltaB: number,
  ) => void;
};
import {
  createCpu,
  callFunction,
  pokeMem,
  peekMem,
  disposeCpu,
} from "./binary-oracle-lib.js";

const FUN_1D82 = 0x00001d82;

const SPRITE_BANK_A_ADDR = 0x00a02000;
const SPRITE_BANK_B_ADDR = 0x00a02100;

interface FailRecord {
  suite: string;
  tc: number;
  field: string;
  bin: number;
  ts: number;
  setup: {
    col: number;
    bank: number;
    deltaA: number;
    deltaB: number;
    oldA: number;
    oldB: number;
  };
}

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) >>> 0;
    return ((s >>> 16) & 0xffff) / 0x10000;
  };
}

function randWord(rng: () => number): number {
  return Math.floor(rng() * 0x10000) & 0xffff;
}

function readWord(buf: Uint8Array, off: number): number {
  return (((buf[off] ?? 0) << 8) | (buf[off + 1] ?? 0)) & 0xffff;
}

async function main(): Promise<void> {
  const total = Number(process.argv[2] ?? "500");
  const perSuite = Math.floor(total / 4);
  const remainder = total - perSuite * 4;

  const romPath = resolve("ghidra_project/marble_program.bin");
  if (!existsSync(romPath)) {
    console.error(`error: ROM blob not found at ${romPath}`);
    exit(3);
  }
  const rom = readFileSync(romPath);

  const stateInst = stateNs.emptyGameState();
  const cpu = await createCpu({ rom, state: stateInst });

  const rng = makeRng(0x1d82);
  const failHolder: { value: FailRecord | null } = { value: null };

  function setupCaseInBoth(
    col: number,
    bank: number,
    oldA: number,
    oldB: number,
  ): { offA: number; offB: number } {
    const baseOff = ((bank & 0xffff) << 9) + ((col & 0xffff) << 1);
    const offA = baseOff;
    const offB = baseOff + 0x100;

    // Set in TS state
    stateInst.spriteRam[offA] = (oldA >>> 8) & 0xff;
    stateInst.spriteRam[offA + 1] = oldA & 0xff;
    stateInst.spriteRam[offB] = (oldB >>> 8) & 0xff;
    stateInst.spriteRam[offB + 1] = oldB & 0xff;

    // Set in binary CPU memory (sprite RAM @ 0xA02000 absolute).
    pokeMem(cpu, SPRITE_BANK_A_ADDR + baseOff, 2, oldA & 0xffff);
    pokeMem(cpu, SPRITE_BANK_B_ADDR + baseOff, 2, oldB & 0xffff);

    return { offA, offB };
  }

  function clearSpriteRamGuards(
    offA: number,
    offB: number,
  ): void {
    const guards: Array<[number, number]> = [
      [offA - 4, 0xdead],
      [offA - 2, 0xbeef],
      [offA + 2, 0xcafe],
      [offA + 4, 0xbabe],
      [offB - 4, 0xfeed],
      [offB - 2, 0xface],
      [offB + 2, 0x1337],
      [offB + 4, 0xc0de],
    ];
    for (const [g, val] of guards) {
      if (g < 0 || g + 1 >= 0x1000) continue;
      stateInst.spriteRam[g] = (val >>> 8) & 0xff;
      stateInst.spriteRam[g + 1] = val & 0xff;
      pokeMem(cpu, SPRITE_BANK_A_ADDR + g, 2, val);
    }
  }

  function runOneCase(
    suite: string,
    tc: number,
    col: number,
    bank: number,
    deltaA: number,
    deltaB: number,
    oldA: number,
    oldB: number,
  ): boolean {
    cpu.system.setRegister("sp", 0x401efc);

    const { offA, offB } = setupCaseInBoth(col, bank, oldA, oldB);
    clearSpriteRamGuards(offA, offB);

    callFunction(
      cpu,
      FUN_1D82,
      [col >>> 0, bank >>> 0, deltaA >>> 0, deltaB >>> 0],
      50_000,
    );

    // Run TS replica
    sub1D82Ns.spritePairCoordAdd1D82(
      stateInst,
      col,
      bank,
      deltaA,
      deltaB,
    );

    // Compare the 2 target words.
    const binA = peekMem(cpu, SPRITE_BANK_A_ADDR + offA, 2);
    const tsA = readWord(stateInst.spriteRam, offA);
    if (binA !== tsA) {
      if (failHolder.value === null) {
        failHolder.value = {
          suite,
          tc,
          field: `bankA@offA=0x${offA.toString(16)}`,
          bin: binA,
          ts: tsA,
          setup: { col, bank, deltaA, deltaB, oldA, oldB },
        };
      }
      return false;
    }

    const binB = peekMem(cpu, SPRITE_BANK_A_ADDR + offB, 2);
    const tsB = readWord(stateInst.spriteRam, offB);
    if (binB !== tsB) {
      if (failHolder.value === null) {
        failHolder.value = {
          suite,
          tc,
          field: `bankB@offB=0x${offB.toString(16)}`,
          bin: binB,
          ts: tsB,
          setup: { col, bank, deltaA, deltaB, oldA, oldB },
        };
      }
      return false;
    }

    const guardOffsets = [-4, -2, 2, 4];
    for (const targetOff of [offA, offB]) {
      for (const dg of guardOffsets) {
        const g = targetOff + dg;
        if (g < 0 || g + 1 >= 0x1000) continue;
        const binG = peekMem(cpu, SPRITE_BANK_A_ADDR + g, 2);
        const tsG = readWord(stateInst.spriteRam, g);
        if (binG !== tsG) {
          if (failHolder.value === null) {
            failHolder.value = {
              suite,
              tc,
              field: `guard@0x${g.toString(16)}`,
              bin: binG,
              ts: tsG,
              setup: { col, bank, deltaA, deltaB, oldA, oldB },
            };
          }
          return false;
        }
      }
    }

    return true;
  }

  let totalOk = 0;

  // ─── Suite A: bank=0, col random ─────────────────────────────────────
  console.log(
    `\n=== spritePairCoordAdd1D82 (FUN_1D82) — Suite A: bank=0, col random — ${perSuite} cases ===`,
  );
  let okA = 0;
  for (let i = 0; i < perSuite; i++) {
    const col = Math.floor(rng() * 0x80);
    const bank = 0;
    const deltaA = randWord(rng);
    const deltaB = randWord(rng);
    const oldA = randWord(rng);
    const oldB = randWord(rng);
    if (runOneCase("A", i, col, bank, deltaA, deltaB, oldA, oldB)) okA++;
  }
  console.log(
    `  Match: ${okA}/${perSuite} = ${((okA / perSuite) * 100).toFixed(1)}%`,
  );
  totalOk += okA;

  // ─── Suite B: bank random ∈ [0..7] ───────────────────────────────────
  console.log(
    `\n=== Suite B: bank random ∈ [0..7], col random — ${perSuite} cases ===`,
  );
  let okB = 0;
  for (let i = 0; i < perSuite; i++) {
    const col = Math.floor(rng() * 0x80);
    const bank = Math.floor(rng() * 8);
    const deltaA = randWord(rng);
    const deltaB = randWord(rng);
    const oldA = randWord(rng);
    const oldB = randWord(rng);
    if (runOneCase("B", i, col, bank, deltaA, deltaB, oldA, oldB)) okB++;
  }
  console.log(
    `  Match: ${okB}/${perSuite} = ${((okB / perSuite) * 100).toFixed(1)}%`,
  );
  totalOk += okB;

  // ─── Suite C: bank=7 (max), col 0..0x7F ──────────────────────────────
  console.log(
    `\n=== Suite C: bank=7 (max addr), col 0..0x7F — ${perSuite} cases ===`,
  );
  let okC = 0;
  for (let i = 0; i < perSuite; i++) {
    const col = i % 0x80;
    const bank = 7;
    const deltaA = randWord(rng);
    const deltaB = randWord(rng);
    const oldA = randWord(rng);
    const oldB = randWord(rng);
    if (runOneCase("C", i, col, bank, deltaA, deltaB, oldA, oldB)) okC++;
  }
  console.log(
    `  Match: ${okC}/${perSuite} = ${((okC / perSuite) * 100).toFixed(1)}%`,
  );
  totalOk += okC;

  // ─── Suite D: stress on bit-mask edge cases ──────────────────────────
  const sizeD = perSuite + remainder;
  console.log(
    `\n=== Suite D: bit 14,15 set + low nibble set + extreme delta — ${sizeD} cases ===`,
  );
  let okD = 0;
  for (let i = 0; i < sizeD; i++) {
    const col = Math.floor(rng() * 0x80);
    const bank = Math.floor(rng() * 8);
    // delta in [0x8000..0xFFFF] (negative-ish) to test wrapping.
    const deltaA = 0x8000 | randWord(rng);
    const deltaB = 0x8000 | randWord(rng);
    const oldA = randWord(rng) | 0xc00f;
    const oldB = randWord(rng) | 0xc00f;
    if (runOneCase("D", i, col, bank, deltaA, deltaB, oldA, oldB)) okD++;
  }
  console.log(
    `  Match: ${okD}/${sizeD} = ${((okD / sizeD) * 100).toFixed(1)}%`,
  );
  totalOk += okD;

  console.log(
    `\n=== TOTAL: ${totalOk}/${total} = ${((totalOk / total) * 100).toFixed(1)}% ===`,
  );
  if (failHolder.value !== null) {
    const f = failHolder.value;
    console.log(
      `  First fail (suite ${f.suite} tc=${f.tc}): ${f.field} ` +
        `bin=0x${f.bin.toString(16)} ts=0x${f.ts.toString(16)} ` +
        `setup col=0x${f.setup.col.toString(16)} ` +
        `bank=0x${f.setup.bank.toString(16)} ` +
        `dA=0x${f.setup.deltaA.toString(16)} ` +
        `dB=0x${f.setup.deltaB.toString(16)} ` +
        `oldA=0x${f.setup.oldA.toString(16)} ` +
        `oldB=0x${f.setup.oldB.toString(16)}`,
    );
  }

  disposeCpu(cpu);
  exit(totalOk === total ? 0 : 1);
}

main().catch((e: unknown) => {
  console.error(e);
  exit(1);
});
