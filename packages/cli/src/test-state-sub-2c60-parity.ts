#!/usr/bin/env node
/**
 * test-state-sub-2c60-parity.ts — differential FUN_2C60 vs stateSub2C60.
 *
 * scheduler. Args: 2 longs on the stack (`arg1Long` = data ptr, `arg2Long` =
 *
 * Logic:
 *   - Scan slot D3 in [0..3]:
 *       if STATE[D3] == 0 → claim slot:
 *           DATA_PTR[D3]  = arg1Long          (long)
 *           STATE[D3]     = 4                  (byte)
 *           THRESHOLD[D3] = arg2Long & 0xFFFF (word)
 *           COUNTER[D3]   = 0                  (word)
 *           FLAG34[D3]    = 0                  (byte)
 *           return D0=1
 *
 *
 * Suites tested:
 *   - A: random everything (mix slot busy/free)
 *   - C: only slot N free (random N in [0..3])
 *
 * Usage: npx tsx packages/cli/src/test-state-sub-2c60-parity.ts [N]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import { state as stateNs, stateSub2C60 as sub2C60Ns } from "@marble-love/engine";
import {
  createCpu,
  callFunction,
  pokeMem,
  peekMem,
  disposeCpu,
} from "./binary-oracle-lib.js";
import type { CpuSession } from "./binary-oracle-lib.js";

const FUN_2C60 = 0x00002c60;

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

  let totalOk = 0;
  interface FailRecord {
    suite: string;
    tc: number;
    offset: number;
    bin: number;
    ts: number;
    arg1: number;
    arg2: number;
    detail: string;
  }
  const failHolder: { value: FailRecord | null } = { value: null };

  function runOneCase(
    suite: string,
    tc: number,
    bytesSetup: () => number[],
    arg1: number,
    arg2: number,
  ): boolean {
    cpu.system.setRegister("sp", 0x401f00);
    const bytes = bytesSetup();
    setupStruct(stateInst, cpu, bytes);

    const r = callFunction(cpu, FUN_2C60, [arg1, arg2]);
    const tsResult = sub2C60Ns.stateSub2C60(stateInst, arg1, arg2);

    const fail = compareStruct(stateInst, cpu);
    // tsResult.claimed must match the low byte of r.d0.
    const binD0 = r.d0 & 0xff;
    const tsD0 = tsResult.claimed & 0xff;
    const d0Ok = binD0 === tsD0;

    if (fail === null && d0Ok) return true;

    if (failHolder.value === null) {
      if (fail !== null) {
        failHolder.value = {
          suite,
          tc,
          offset: fail.offset,
          bin: fail.bin,
          ts: fail.ts,
          arg1,
          arg2,
          detail: "struct",
        };
      } else {
        failHolder.value = {
          suite,
          tc,
          offset: -1,
          bin: binD0,
          ts: tsD0,
          arg1,
          arg2,
          detail: "D0",
        };
      }
    }
    return false;
  }

  const rng = makeRng(0x2c60);
  const rb = (): number => Math.floor(rng() * 256) & 0xff;
  const rl = (): number =>
    ((Math.floor(rng() * 0x10000) << 16) | Math.floor(rng() * 0x10000)) >>> 0;

  // ─── Suite A: random everything ─────────────────────────────────────
  console.log(`\n=== stateSub2C60 (FUN_2C60) — Suite A: random table & args — ${perSuite} cases ===`);
  let okA = 0;
  for (let i = 0; i < perSuite; i++) {
    const bytes = new Array(STRUCT_SIZE).fill(0).map(() => rb());
    const arg1 = rl();
    const arg2 = rl();
    if (runOneCase("A", i, () => bytes, arg1, arg2)) okA++;
  }
  console.log(`  Match: ${okA}/${perSuite} = ${((okA / perSuite) * 100).toFixed(1)}%`);
  totalOk += okA;

  console.log(`\n=== Suite B: all slots free → claim slot 0 — ${perSuite} cases ===`);
  let okB = 0;
  for (let i = 0; i < perSuite; i++) {
    const bytes = new Array(STRUCT_SIZE).fill(0).map(() => rb());
    // Force STATE[0..3] = 0
    for (let j = 0; j < 4; j++) bytes[0x1c + j] = 0;
    const arg1 = rl();
    const arg2 = rl();
    if (runOneCase("B", i, () => bytes, arg1, arg2)) okB++;
  }
  console.log(`  Match: ${okB}/${perSuite} = ${((okB / perSuite) * 100).toFixed(1)}%`);
  totalOk += okB;

  // Suite C: only slot N free (random N).
  console.log(`\n=== Suite C: only one specific slot free — ${perSuite} cases ===`);
  let okC = 0;
  for (let i = 0; i < perSuite; i++) {
    const bytes = new Array(STRUCT_SIZE).fill(0).map(() => rb());
    const freeSlot = Math.floor(rng() * 4);
    for (let j = 0; j < 4; j++) {
      if (j === freeSlot) {
        bytes[0x1c + j] = 0;
      } else {
        // Ensure state != 0
        let v = rb();
        if (v === 0) v = 1;
        bytes[0x1c + j] = v;
      }
    }
    const arg1 = rl();
    const arg2 = rl();
    if (runOneCase("C", i, () => bytes, arg1, arg2)) okC++;
  }
  console.log(`  Match: ${okC}/${perSuite} = ${((okC / perSuite) * 100).toFixed(1)}%`);
  totalOk += okC;

  const sizeD = perSuite + remainder;
  console.log(`\n=== Suite D: all slots busy → claimed=0 — ${sizeD} cases ===`);
  let okD = 0;
  for (let i = 0; i < sizeD; i++) {
    const bytes = new Array(STRUCT_SIZE).fill(0).map(() => rb());
    // Ensure STATE[0..3] != 0
    for (let j = 0; j < 4; j++) {
      let v = rb();
      if (v === 0) v = 1;
      bytes[0x1c + j] = v;
    }
    const arg1 = rl();
    const arg2 = rl();
    if (runOneCase("D", i, () => bytes, arg1, arg2)) okD++;
  }
  console.log(`  Match: ${okD}/${sizeD} = ${((okD / sizeD) * 100).toFixed(1)}%`);
  totalOk += okD;

  console.log(`\n=== TOTAL: ${totalOk}/${total} = ${((totalOk / total) * 100).toFixed(1)}% ===`);
  if (failHolder.value !== null) {
    const { suite, tc, offset, bin, ts, arg1, arg2, detail } = failHolder.value;
    if (detail === "D0") {
      console.log(
        `  First fail (suite ${suite} tc=${tc}): D0 mismatch ` +
        `arg1=0x${arg1.toString(16)} arg2=0x${arg2.toString(16)} ` +
        `bin=${bin} ts=${ts}`,
      );
    } else {
      console.log(
        `  First fail (suite ${suite} tc=${tc}): @ struct+0x${offset.toString(16)} ` +
        `bin=0x${bin.toString(16)} ts=0x${ts.toString(16)} ` +
        `(arg1=0x${arg1.toString(16)}, arg2=0x${arg2.toString(16)})`,
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
