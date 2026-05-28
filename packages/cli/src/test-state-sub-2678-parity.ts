#!/usr/bin/env node
/**
 * test-state-sub-2678-parity.ts — differential FUN_2678 vs stateSub2678.
 *
 * scheduler. Args: 1 long on the stack (`argLong`).
 *
 * Logica:
 *   - Per ogni slot D2 in [0..3]:
 *       if DATA_PTR[D2] == argLong: STATE[D2]=0; DATA_PTR[D2]=0;
 *   - jsr FUN_2ABC(argLong)  ← STUB injection
 *
 * Strategia:
 *   - In TS, callback `fun_2abc` no-op
 *
 * Suite testate:
 *   - A: random argLong + random table (most slot non-match)
 *   - B: argLong = DATA_PTR[D2] di un slot random (sicuro match)
 *   - C: argLong = DATA_PTR for multiple slots (multiple matches)
 *   - D: argLong = 0 with mixed DATA_PTR values at 0 (match for slot 0)
 *
 * Uso: npx tsx packages/cli/src/test-state-sub-2678-parity.ts [N]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import { state as stateNs, stateSub2678 as sub2678Ns } from "@marble-love/engine";
import {
  createCpu,
  callFunction,
  pokeMem,
  peekMem,
  disposeCpu,
} from "./binary-oracle-lib.js";
import type { CpuSession } from "./binary-oracle-lib.js";

const FUN_2678 = 0x00002678;
const FUN_2ABC = 0x00002abc;

/** Patch FUN_2ABC a `rts` (4E 75) per stub no-op. */
function patchSubs(cpu: CpuSession): void {
  pokeMem(cpu, FUN_2ABC + 0, 1, 0x4e);
  pokeMem(cpu, FUN_2ABC + 1, 1, 0x75);
}

const STRUCT_BASE = 0x00401f00;
const STRUCT_SIZE = 0x40; // 0x401F00..0x401F3F

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) >>> 0;
    return ((s >>> 16) & 0xffff) / 0x10000;
  };
}

function setupStruct(
  state: ReturnType<typeof stateNs.emptyGameState>,
  cpu: CpuSession,
  bytes: number[],
): void {
  for (let i = 0; i < STRUCT_SIZE; i++) {
    const v = bytes[i] ?? 0;
    pokeMem(cpu, STRUCT_BASE + i, 1, v);
    state.workRam[(STRUCT_BASE - 0x400000) + i] = v;
  }
}

/** Compare struct after run. Returns first diff or null. */
function compareStruct(
  state: ReturnType<typeof stateNs.emptyGameState>,
  cpu: CpuSession,
): { offset: number; bin: number; ts: number } | null {
  for (let i = 0; i < STRUCT_SIZE; i++) {
    const b = peekMem(cpu, STRUCT_BASE + i, 1);
    const t = state.workRam[(STRUCT_BASE - 0x400000) + i] ?? 0;
    if (b !== t) return { offset: i, bin: b, ts: t };
  }
  return null;
}

async function main(): Promise<void> {
  const total = Number(process.argv[2] ?? "500");
  // 4 suite, dividiamo equamente
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
  patchSubs(cpu);

  const subs: sub2678Ns.StateSub2678Subs = {
    fun_2abc: (_a: number): void => {},
  };

  let totalOk = 0;
  interface FailRecord {
    suite: string;
    tc: number;
    offset: number;
    bin: number;
    ts: number;
    arg: number;
  }
  const failHolder: { value: FailRecord | null } = { value: null };

  function runOneCase(
    suite: string,
    tc: number,
    bytesSetup: () => number[],
    arg: number,
  ): boolean {
    cpu.system.setRegister("sp", 0x401f00);
    const bytes = bytesSetup();
    setupStruct(stateInst, cpu, bytes);
    const r = callFunction(cpu, FUN_2678, [arg]);
    sub2678Ns.stateSub2678(stateInst, arg, subs);
    const fail = compareStruct(stateInst, cpu);
    const d0Ok = (r.d0 & 0xff) === 1;
    if (fail === null && d0Ok) return true;
    if (failHolder.value === null) {
      if (fail !== null) {
        failHolder.value = { suite, tc, offset: fail.offset, bin: fail.bin, ts: fail.ts, arg };
      } else {
        failHolder.value = { suite, tc, offset: -1, bin: r.d0 & 0xff, ts: 1, arg };
      }
    }
    return false;
  }

  const rng = makeRng(0x2678);
  const rb = (): number => Math.floor(rng() * 256) & 0xff;
  const rl = (): number =>
    ((Math.floor(rng() * 0x10000) << 16) | Math.floor(rng() * 0x10000)) >>> 0;

  // ─── Suite A: random everything ──────────────────────────────────────
  console.log(`\n=== stateSub2678 (FUN_2678) — Suite A: random arg & table — ${perSuite} casi ===`);
  let okA = 0;
  for (let i = 0; i < perSuite; i++) {
    const bytes = new Array(STRUCT_SIZE).fill(0).map(() => rb());
    const arg = rl();
    if (runOneCase("A", i, () => bytes, arg)) okA++;
  }
  console.log(`  Match: ${okA}/${perSuite} = ${((okA / perSuite) * 100).toFixed(1)}%`);
  totalOk += okA;

  // ─── Suite B: arg = DATA_PTR[slot] di slot random ─────────────────────
  console.log(`\n=== Suite B: arg == DATA_PTR[random_slot] — ${perSuite} casi ===`);
  let okB = 0;
  for (let i = 0; i < perSuite; i++) {
    const bytes = new Array(STRUCT_SIZE).fill(0).map(() => rb());
    const ptrs: number[] = [rl(), rl(), rl(), rl()];
    for (let j = 0; j < 4; j++) {
      const off = 0x04 + j * 4;
      bytes[off] = (ptrs[j]! >>> 24) & 0xff;
      bytes[off + 1] = (ptrs[j]! >>> 16) & 0xff;
      bytes[off + 2] = (ptrs[j]! >>> 8) & 0xff;
      bytes[off + 3] = ptrs[j]! & 0xff;
    }
    const targetSlot = Math.floor(rng() * 4);
    const arg = ptrs[targetSlot]!;
    if (runOneCase("B", i, () => bytes, arg)) okB++;
  }
  console.log(`  Match: ${okB}/${perSuite} = ${((okB / perSuite) * 100).toFixed(1)}%`);
  totalOk += okB;

  // ─── Suite C: arg matches multiple slots ──────────────────────────────
  console.log(`\n=== Suite C: arg matches multiple slots — ${perSuite} casi ===`);
  let okC = 0;
  for (let i = 0; i < perSuite; i++) {
    const bytes = new Array(STRUCT_SIZE).fill(0).map(() => rb());
    const arg = rl();
    // Pick 2-4 slots and assign them the same ptr.
    const numMatch = 2 + Math.floor(rng() * 3); // 2,3,4
    const slotIdx = [0, 1, 2, 3];
    // Shuffle (Fisher-Yates corto)
    for (let j = 3; j > 0; j--) {
      const k = Math.floor(rng() * (j + 1));
      [slotIdx[j], slotIdx[k]] = [slotIdx[k]!, slotIdx[j]!];
    }
    for (let j = 0; j < numMatch; j++) {
      const slot = slotIdx[j]!;
      const off = 0x04 + slot * 4;
      bytes[off] = (arg >>> 24) & 0xff;
      bytes[off + 1] = (arg >>> 16) & 0xff;
      bytes[off + 2] = (arg >>> 8) & 0xff;
      bytes[off + 3] = arg & 0xff;
    }
    if (runOneCase("C", i, () => bytes, arg)) okC++;
  }
  console.log(`  Match: ${okC}/${perSuite} = ${((okC / perSuite) * 100).toFixed(1)}%`);
  totalOk += okC;

  // ─── Suite D: arg=0 + DATA_PTR misti zero ─────────────────────────────
  const sizeD = perSuite + remainder;
  console.log(`\n=== Suite D: arg=0 + table bordering zero — ${sizeD} casi ===`);
  let okD = 0;
  for (let i = 0; i < sizeD; i++) {
    const bytes = new Array(STRUCT_SIZE).fill(0).map(() => rb());
    // Force some slot (random) a 0
    for (let j = 0; j < 4; j++) {
      if (rng() < 0.5) {
        const off = 0x04 + j * 4;
        bytes[off] = 0;
        bytes[off + 1] = 0;
        bytes[off + 2] = 0;
        bytes[off + 3] = 0;
      }
    }
    if (runOneCase("D", i, () => bytes, 0)) okD++;
  }
  console.log(`  Match: ${okD}/${sizeD} = ${((okD / sizeD) * 100).toFixed(1)}%`);
  totalOk += okD;

  console.log(`\n=== TOTALE: ${totalOk}/${total} = ${((totalOk / total) * 100).toFixed(1)}% ===`);
  if (failHolder.value !== null) {
    const { suite, tc, offset, bin, ts, arg } = failHolder.value;
    if (offset === -1) {
      console.log(`  First fail (suite ${suite} tc=${tc}): D0 mismatch arg=0x${arg.toString(16)} bin=${bin} ts=${ts}`);
    } else {
      console.log(
        `  First fail (suite ${suite} tc=${tc}): @ struct+0x${offset.toString(16)} ` +
        `bin=0x${bin.toString(16)} ts=0x${ts.toString(16)} (arg=0x${arg.toString(16)})`,
      );
    }
  }

  disposeCpu(cpu);
  exit(totalOk === total ? 0 : 1);
}

main().catch(e => {
  console.error(e);
  exit(1);
});
