#!/usr/bin/env node
/**
 * test-key-rank-lookup-4686-parity.ts — differential FUN_4686 vs
 * `keyRankLookup4686`.
 *
 * `FUN_00004686` (164 byte) e' un lookup table-driven self-contained:
 * no JSR, no MMIO, and no writes to workRam. Extracts a 24-bit key from the
 * long arg and returns the index of the first row in the table
 * (10 lines × 5 byte) puntata da `*0x401FFC + 0x1E` la which chiave-prefix
 * (3 byte) is strictly greater than the key.
 *
 * Confronto:
 *   - return D0 (long signed): -1, 0..9, or 10
 *
 * Setup for each random case:
 *   - *0x401FFC = a2Addr (struct base, range workRam-safe @ 0x401D00)
 *   - 50 byte @ a2Addr+0x1E .. a2Addr+0x4F (10 lines da 5 byte)
 *     organized as a strictly sorted table for the first 3 bytes
 *   - arg = long random
 *
 * Pattern coverage (5 suites x 100 = 500 cases). Strict DESC-sorted table.
 *   A. high byte != 0                -> expected D0 = -1
 *   B. key > every prefix            -> expected D0 = 0 (first row already < key)
 *   C. key between row r-1 and r     -> expected D0 = r (DESC: r > 0)
 *   D. key < every prefix            -> expected D0 = 10
 *   E. fully random                  -> stress, expected match at any rank
 *
 * Stub-injection strategy: NONE. FUN_4686 does not call JSR.
 *
 * Uso: npx tsx packages/cli/src/test-key-rank-lookup-4686-parity.ts [N=500]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import {
  state as stateNs,
  keyRankLookup4686 as krNs,
} from "@marble-love/engine";
import {
  createCpu,
  callFunction,
  pokeMem,
  disposeCpu,
} from "./binary-oracle-lib.js";
import type { CpuSession } from "./binary-oracle-lib.js";

const FUN_4686 = 0x00004686;
const PTR_FFC = 0x00401ffc;
const A2_ADDR = 0x00401d00;
const TABLE_ABS = A2_ADDR + 0x1e;
const TABLE_OFF = (A2_ADDR - 0x400000) + 0x1e;

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) >>> 0;
    return ((s >>> 16) & 0xffff) / 0x10000;
  };
}

/** Write a long-BE to both binary and TS. */
function pokeLong(
  state: ReturnType<typeof stateNs.emptyGameState>,
  cpu: CpuSession,
  abs: number,
  v: number,
): void {
  const off = abs - 0x400000;
  const u = v >>> 0;
  const bytes = [
    (u >>> 24) & 0xff,
    (u >>> 16) & 0xff,
    (u >>> 8) & 0xff,
    u & 0xff,
  ];
  for (let i = 0; i < 4; i++) {
    pokeMem(cpu, abs + i, 1, bytes[i]!);
    state.workRam[off + i] = bytes[i]!;
  }
}

/** Write a single byte to both binary and TS. */
function pokeByte(
  state: ReturnType<typeof stateNs.emptyGameState>,
  cpu: CpuSession,
  abs: number,
  v: number,
): void {
  const b = v & 0xff;
  pokeMem(cpu, abs, 1, b);
  state.workRam[abs - 0x400000] = b;
}

/**
 * Set up a 10x5 table from an array of 10 24-bit keys. The keys are
 * written as provided; the caller supplies DESCENDING order
 * for the convention expected by FUN_4686. The 2 payload columns (with the 3,4)
 * are random.
 */
function setupTable(
  state: ReturnType<typeof stateNs.emptyGameState>,
  cpu: CpuSession,
  keys24: ReadonlyArray<number>,
  rng: () => number,
): void {
  // Pulisce 50 byte
  for (let i = 0; i < 50; i++) {
    pokeByte(state, cpu, TABLE_ABS + i, 0);
  }
  for (let r = 0; r < keys24.length && r < 10; r++) {
    const k = keys24[r]! & 0xffffff;
    pokeByte(state, cpu, TABLE_ABS + r * 5 + 0, (k >>> 16) & 0xff);
    pokeByte(state, cpu, TABLE_ABS + r * 5 + 1, (k >>> 8) & 0xff);
    pokeByte(state, cpu, TABLE_ABS + r * 5 + 2, k & 0xff);
    pokeByte(state, cpu, TABLE_ABS + r * 5 + 3, Math.floor(rng() * 256));
    pokeByte(state, cpu, TABLE_ABS + r * 5 + 4, Math.floor(rng() * 256));
  }
}

interface FailRecord {
  suite: string;
  tc: number;
  arg: number;
  binD0: number;
  tsD0: number;
  tableSnap: number[];
}

function snapTable(state: ReturnType<typeof stateNs.emptyGameState>): number[] {
  const out: number[] = [];
  for (let i = 0; i < 50; i++) out.push(state.workRam[TABLE_OFF + i] ?? 0);
  return out;
}

async function main(): Promise<void> {
  const total = Number(process.argv[2] ?? "500");
  const perSuite = Math.floor(total / 5);
  const remainder = total - perSuite * 5;

  const romPath = resolve("ghidra_project/marble_program.bin");
  if (!existsSync(romPath)) {
    console.error(`error: ROM blob not found at ${romPath}`);
    exit(3);
  }
  const rom = readFileSync(romPath);

  const state = stateNs.emptyGameState();
  const cpu = await createCpu({ rom, state });

  const rng = makeRng(0x4686);
  const ri = (max: number): number => Math.floor(rng() * max);

  const failHolder: { value: FailRecord | null } = { value: null };
  let totalOk = 0;

  function runOne(suite: string, tc: number, arg: number): boolean {
    cpu.system.setRegister("sp", 0x401f00);
    // *0x401FFC = A2_ADDR (already set at startup; reconfirm it here).
    pokeLong(state, cpu, PTR_FFC, A2_ADDR);

    const r = callFunction(cpu, FUN_4686, [arg >>> 0]);
    const binD0 = r.d0 | 0; // signed long
    const tsD0 = krNs.keyRankLookup4686(state, arg >>> 0) | 0;

    if (binD0 === tsD0) return true;

    if (failHolder.value === null) {
      failHolder.value = {
        suite,
        tc,
        arg: arg >>> 0,
        binD0: binD0 >>> 0,
        tsD0: tsD0 >>> 0,
        tableSnap: snapTable(state),
      };
    }
    return false;
  }

  /**
   * Generate 10 strict DESC-sorted 24-bit keys with enough gap for expressive
   * "in-between" cases.
   * keys[0] = piu' grande, keys[9] = piu' piccolo.
   */
  function genSortedKeysDesc(): number[] {
    const asc: number[] = [];
    let cur = 0x10000 + ri(0x10000); // start above zero
    for (let i = 0; i < 10; i++) {
      asc.push(cur);
      const gap = 0x1000 + ri(0xff00);
      cur = Math.min(cur + gap, 0xfffffe);
    }
    // Sort ASC, then reverse to guarantee strict DESC order.
    asc.sort((a, b) => a - b);
    // Forza unicita' (piccolo aggiustamento)
    for (let i = 1; i < asc.length; i++) {
      if (asc[i]! <= asc[i - 1]!) {
        asc[i] = Math.min(asc[i - 1]! + 1, 0xffffff);
      }
    }
    return asc.slice().reverse();
  }

  // ─── Suite A: high byte != 0 → -1 ─────────────────────────────────
  console.log(`\n=== keyRankLookup4686 (FUN_4686) — Suite A: high byte != 0 — ${perSuite} cases ===`);
  let okA = 0;
  for (let i = 0; i < perSuite; i++) {
    const keys = genSortedKeysDesc();
    setupTable(state, cpu, keys, rng);
    // Force non-zero high byte.
    const hi = 1 + ri(0xff); // 1..0xFF
    const lo24 = ri(0x1000000);
    const arg = ((hi << 24) | lo24) >>> 0;
    if (runOne("A", i, arg)) okA++;
  }
  console.log(`  Match: ${okA}/${perSuite} = ${((okA / perSuite) * 100).toFixed(1)}%`);
  totalOk += okA;

  // ─── Suite B: key > all i prefix → 0 ────────────────────────────
  console.log(`\n=== Suite B: key > all prefixes → 0 — ${perSuite} cases ===`);
  let okB = 0;
  for (let i = 0; i < perSuite; i++) {
    // DESC table with keys[0] greater than the table, while leaving
    // spazio above. arg key strictly > keys[0].
    const keys = genSortedKeysDesc();
    setupTable(state, cpu, keys, rng);
    // Genera key in (keys[0], 0xFFFFFF]
    const top = keys[0]!;
    if (top >= 0xfffffe) {
      // fallback: provoca high-byte fail (non possibile in the pattern B,
      // skipping this iteration counts as OK only if TS == bin).
      if (runOne("B", i, 0)) okB++;
      continue;
    }
    const argKey = top + 1 + ri(0xffffff - top);
    if (runOne("B", i, argKey >>> 0)) okB++;
  }
  console.log(`  Match: ${okB}/${perSuite} = ${((okB / perSuite) * 100).toFixed(1)}%`);
  totalOk += okB;

  // ─── Suite C: key between row r and r-1 (DESC) → r ──────────────────────
  console.log(`\n=== Suite C: key between row r and r-1 (DESC) → r — ${perSuite} cases ===`);
  let okC = 0;
  for (let i = 0; i < perSuite; i++) {
    const keys = genSortedKeysDesc();
    setupTable(state, cpu, keys, rng);
    // Pick target row r in [1..9]: keys[r-1] > keys[r], generate key in
    // (keys[r], keys[r-1]).
    const r = 1 + ri(9);
    const hi = keys[r - 1]!;
    const lo = keys[r]!;
    if (hi <= lo + 1) {
      if (runOne("C", i, lo + 1)) okC++;
      continue;
    }
    const argKey = lo + 1 + ri(hi - lo - 1);
    if (runOne("C", i, argKey >>> 0)) okC++;
  }
  console.log(`  Match: ${okC}/${perSuite} = ${((okC / perSuite) * 100).toFixed(1)}%`);
  totalOk += okC;

  // ─── Suite D: key < all i prefix → 10 ───────────────────────────
  console.log(`\n=== Suite D: key < all prefixes → 10 — ${perSuite} cases ===`);
  let okD = 0;
  for (let i = 0; i < perSuite; i++) {
    // DESC table with keys[9] large enough to leave room below.
    const keys = genSortedKeysDesc();
    // Force keys[9] >= 2 so 0..keys[9]-1 is a valid range.
    if (keys[9]! < 2) {
      // Shift the table toward larger values.
      for (let k = 0; k < 10; k++) keys[k] = (keys[k]! + 0x10000) & 0xffffff;
    }
    setupTable(state, cpu, keys, rng);
    const argKey = ri(keys[9]!);
    if (runOne("D", i, argKey >>> 0)) okD++;
  }
  console.log(`  Match: ${okD}/${perSuite} = ${((okD / perSuite) * 100).toFixed(1)}%`);
  totalOk += okD;

  // ─── Suite E: fully random ────────────────────────────────────────
  const sizeE = perSuite + remainder;
  console.log(`\n=== Suite E: fully random arg + DESC table — ${sizeE} cases ===`);
  let okE = 0;
  for (let i = 0; i < sizeE; i++) {
    const keys = genSortedKeysDesc();
    setupTable(state, cpu, keys, rng);
    // arg random long full
    const argHi = ri(0x10000);
    const argLo = ri(0x10000);
    const arg = ((argHi << 16) | argLo) >>> 0;
    if (runOne("E", i, arg)) okE++;
  }
  console.log(`  Match: ${okE}/${sizeE} = ${((okE / sizeE) * 100).toFixed(1)}%`);
  totalOk += okE;

  console.log(`\n=== TOTALE: ${totalOk}/${total} = ${((totalOk / total) * 100).toFixed(1)}% ===`);

  if (failHolder.value) {
    const f = failHolder.value;
    console.log(`  First fail (suite ${f.suite} tc=${f.tc}):`);
    console.log(`    arg=0x${f.arg.toString(16).padStart(8, "0")}`);
    console.log(`    binD0=0x${f.binD0.toString(16)} (signed: ${f.binD0 | 0})`);
    console.log(`    tsD0 =0x${f.tsD0.toString(16)} (signed: ${f.tsD0 | 0})`);
    console.log(`    table (10 rows × 5 bytes):`);
    for (let r = 0; r < 10; r++) {
      const row = f.tableSnap.slice(r * 5, r * 5 + 5)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join(" ");
      console.log(`      [${r}] ${row}`);
    }
  }

  disposeCpu(cpu);
  exit(totalOk === total ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  exit(1);
});
