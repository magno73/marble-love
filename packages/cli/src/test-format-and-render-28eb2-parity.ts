#!/usr/bin/env node
/**
 * test-format-and-render-28eb2-parity.ts — differential FUN_00028EB2 vs
 * `formatAndRender28EB2` TS replica.
 *
 * `FUN_00028EB2` (118 byte): "format-and-render" orchestrator with 6 long args
 * with 3 sub-JSRs:
 *   2. FUN_28F28 (trimTrailingSpace) - only when arg2.w == 2.
 *
 *   Patch the 3 binary entries with `addq.b #1, sentinel.l ; rts` (8 bytes).
 *   sentinel[k] += N (mod 256).
 *
 *   Sentinel mapping:
 *     - FUN_3874   → workRam[0x3E0]  (sentinelFmt)
 *     - FUN_28F28  → workRam[0x3E1]  (sentinelTrim)
 *     - FUN_28FA0  → workRam[0x3E2]  (sentinelRender)
 *
 *   In TS, the 3 callbacks inject the same increment.
 *
 *   2. sentinelTrim  == (arg2.w == 2 ? 1 : 0) in both.
 *   3. sentinelRender == 1 in both.
 *   4. workRam scratch around (0x418..0x428, 16 bytes) unchanged (the subs
 *      are no-op → no side effects).
 *
 *   - A: arg2.w random — natural distribution (rarely == 2)
 *
 * Usage: npx tsx packages/cli/src/test-format-and-render-28eb2-parity.ts [N]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import {
  state as stateNs,
  formatAndRender28EB2 as fa2Ns,
} from "@marble-love/engine";
import {
  createCpu,
  callFunction,
  pokeMem,
  peekMem,
  disposeCpu,
} from "./binary-oracle-lib.js";
import type { CpuSession } from "./binary-oracle-lib.js";

const FUN_28EB2 = 0x00028eb2;
const FUN_3874 = 0x00003874;
const FUN_28F28 = 0x00028f28;
const FUN_28FA0 = 0x00028fa0;

const BUFEND_PTR_ADDR = 0x0040041e;
// Sentinel byte slot in work RAM (counter for the 3 subs).
const SENTINEL_FMT = 0x004003e0;
const SENTINEL_TRIM = 0x004003e1;
const SENTINEL_RENDER = 0x004003e2;

// Compared workRam range used to guarantee no spillage (entry @ 0x40041C):
const COMPARE_BASE = 0x00400418;
const COMPARE_SIZE = 0x10; // 0x418..0x427

/**
 * Encode `addq.b #1, (abs).l ; rts` (8 byte) in `rom` at `entry`.
 *   addq.b #1, (xxxx).l → 0x52 0x39 + abs long
 *   rts                 → 0x4E 0x75
 */
function patchStubAddq(rom: Buffer, entry: number, sentinelAddr: number): void {
  rom[entry + 0] = 0x52;
  rom[entry + 1] = 0x39;
  rom[entry + 2] = (sentinelAddr >>> 24) & 0xff;
  rom[entry + 3] = (sentinelAddr >>> 16) & 0xff;
  rom[entry + 4] = (sentinelAddr >>> 8) & 0xff;
  rom[entry + 5] = sentinelAddr & 0xff;
  rom[entry + 6] = 0x4e;
  rom[entry + 7] = 0x75;
}

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) >>> 0;
    return ((s >>> 16) & 0xffff) / 0x10000;
  };
}

interface CaseSetup {
  arg1: number;
  arg2: number;
  arg3: number;
  arg4: number;
  arg5: number;
  arg6: number;
  bufEnd: number; // *(0x40041E)
  sentInitFmt: number;
  sentInitTrim: number;
  sentInitRender: number;
  region: number[]; // 16 byte @ 0x418..0x427
}

interface FailRecord {
  i: number;
  suite: string;
  field: string;
  bin: number;
  ts: number;
  setup: CaseSetup;
}

function setupCase(
  state: ReturnType<typeof stateNs.emptyGameState>,
  cpu: CpuSession,
  setup: CaseSetup,
): void {
  // Scratch region 0x418..0x427 (entry compare).
  for (let i = 0; i < COMPARE_SIZE; i++) {
    const v = setup.region[i] ?? 0;
    pokeMem(cpu, COMPARE_BASE + i, 1, v);
    state.workRam[COMPARE_BASE - 0x400000 + i] = v;
  }
  // bufEnd long @ 0x40041E (BE).
  pokeMem(cpu, BUFEND_PTR_ADDR, 4, setup.bufEnd >>> 0);
  state.workRam[BUFEND_PTR_ADDR - 0x400000 + 0] = (setup.bufEnd >>> 24) & 0xff;
  state.workRam[BUFEND_PTR_ADDR - 0x400000 + 1] = (setup.bufEnd >>> 16) & 0xff;
  state.workRam[BUFEND_PTR_ADDR - 0x400000 + 2] = (setup.bufEnd >>> 8) & 0xff;
  state.workRam[BUFEND_PTR_ADDR - 0x400000 + 3] = setup.bufEnd & 0xff;

  // Sentinel bytes.
  pokeMem(cpu, SENTINEL_FMT, 1, setup.sentInitFmt);
  state.workRam[SENTINEL_FMT - 0x400000] = setup.sentInitFmt;
  pokeMem(cpu, SENTINEL_TRIM, 1, setup.sentInitTrim);
  state.workRam[SENTINEL_TRIM - 0x400000] = setup.sentInitTrim;
  pokeMem(cpu, SENTINEL_RENDER, 1, setup.sentInitRender);
  state.workRam[SENTINEL_RENDER - 0x400000] = setup.sentInitRender;
}

/** Compare sentinel + scratch region. Returns first diff or null. */
function compareCase(
  state: ReturnType<typeof stateNs.emptyGameState>,
  cpu: CpuSession,
): { field: string; bin: number; ts: number } | null {
  // Sentinel fmt
  const fBin = peekMem(cpu, SENTINEL_FMT, 1) & 0xff;
  const fTs = state.workRam[SENTINEL_FMT - 0x400000] ?? 0;
  if (fBin !== fTs) return { field: "sentinelFmt", bin: fBin, ts: fTs };
  // Sentinel trim
  const tBin = peekMem(cpu, SENTINEL_TRIM, 1) & 0xff;
  const tTs = state.workRam[SENTINEL_TRIM - 0x400000] ?? 0;
  if (tBin !== tTs) return { field: "sentinelTrim", bin: tBin, ts: tTs };
  // Sentinel render
  const rBin = peekMem(cpu, SENTINEL_RENDER, 1) & 0xff;
  const rTs = state.workRam[SENTINEL_RENDER - 0x400000] ?? 0;
  if (rBin !== rTs) return { field: "sentinelRender", bin: rBin, ts: rTs };
  // Scratch region; entry @ 0x40041C must not be touched because subs are no-op stubs.
  for (let i = 0; i < COMPARE_SIZE; i++) {
    const b = peekMem(cpu, COMPARE_BASE + i, 1) & 0xff;
    const t = state.workRam[COMPARE_BASE - 0x400000 + i] ?? 0;
    if (b !== t) {
      return { field: `region+0x${i.toString(16)}`, bin: b, ts: t };
    }
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
  const romBuf = Buffer.from(readFileSync(romPath));

  // Patch the 3 subs to `addq.b #1, sentinel ; rts`.
  patchStubAddq(romBuf, FUN_3874, SENTINEL_FMT);
  patchStubAddq(romBuf, FUN_28F28, SENTINEL_TRIM);
  patchStubAddq(romBuf, FUN_28FA0, SENTINEL_RENDER);

  const stateInst = stateNs.emptyGameState();
  const cpu = await createCpu({ rom: romBuf, state: stateInst });

  const subs: fa2Ns.FormatAndRender28EB2Subs = {
    numberFormatter: (s) => {
      const off = SENTINEL_FMT - 0x400000;
      s.workRam[off] = ((s.workRam[off] ?? 0) + 1) & 0xff;
    },
    trimTrailingSpace: (s) => {
      const off = SENTINEL_TRIM - 0x400000;
      s.workRam[off] = ((s.workRam[off] ?? 0) + 1) & 0xff;
    },
    renderStringEntry: (s) => {
      const off = SENTINEL_RENDER - 0x400000;
      s.workRam[off] = ((s.workRam[off] ?? 0) + 1) & 0xff;
    },
  };

  const rng = makeRng(0x28eb2);
  const rb = (): number => Math.floor(rng() * 256) & 0xff;
  const rl = (): number =>
    ((Math.floor(rng() * 0x10000) << 16) | Math.floor(rng() * 0x10000)) >>> 0;

  let totalOk = 0;
  let firstFail: FailRecord | null = null;

  function runOneCase(suite: string, i: number, setup: CaseSetup): boolean {
    cpu.system.setRegister("sp", 0x401f00);
    setupCase(stateInst, cpu, setup);

    callFunction(cpu, FUN_28EB2, [
      setup.arg1 >>> 0,
      setup.arg2 >>> 0,
      setup.arg3 >>> 0,
      setup.arg4 >>> 0,
      setup.arg5 >>> 0,
      setup.arg6 >>> 0,
    ]);
    fa2Ns.formatAndRender28EB2(
      stateInst,
      setup.arg1 >>> 0,
      setup.arg2 >>> 0,
      setup.arg3 >>> 0,
      setup.arg4 >>> 0,
      setup.arg5 >>> 0,
      setup.arg6 >>> 0,
      subs,
    );

    const fail = compareCase(stateInst, cpu);
    if (fail === null) return true;
    if (firstFail === null) {
      firstFail = { i, suite, ...fail, setup };
    }
    return false;
  }

  function makeSetup(arg2Override?: number): CaseSetup {
    const region = new Array(COMPARE_SIZE).fill(0).map(() => rb());
    return {
      arg1: rl(),
      arg2: arg2Override !== undefined ? arg2Override : rl(),
      arg3: rl(),
      arg4: rl(),
      arg5: rl(),
      arg6: rl(),
      bufEnd: rl(),
      sentInitFmt: rb(),
      sentInitTrim: rb(),
      sentInitRender: rb(),
      region,
    };
  }

  // ─── Suite A: random everything (arg2.w natural distribution) ────
  console.log(
    `\n=== formatAndRender28EB2 (FUN_28EB2) — Suite A: random — ${perSuite} cases ===`,
  );
  let okA = 0;
  for (let i = 0; i < perSuite; i++) {
    if (runOneCase("A", i, makeSetup())) okA++;
  }
  console.log(`  Match: ${okA}/${perSuite} = ${((okA / perSuite) * 100).toFixed(1)}%`);
  totalOk += okA;

  console.log(`\n=== Suite B: arg2.w == 2 (trim ON) — ${perSuite} cases ===`);
  let okB = 0;
  for (let i = 0; i < perSuite; i++) {
    // arg2 = (high random) | 0x0002
    const setup = makeSetup(((rl() & 0xffff0000) | 0x0002) >>> 0);
    if (runOneCase("B", i, setup)) okB++;
  }
  console.log(`  Match: ${okB}/${perSuite} = ${((okB / perSuite) * 100).toFixed(1)}%`);
  totalOk += okB;

  // Suite C: arg2.w forced to non-2 (skip trim).
  console.log(`\n=== Suite C: arg2.w != 2 (trim OFF) — ${perSuite} cases ===`);
  let okC = 0;
  for (let i = 0; i < perSuite; i++) {
    // arg2.w random but != 2.
    let lo = Math.floor(rng() * 0x10000) & 0xffff;
    if (lo === 0x0002) lo = 0x0003;
    const setup = makeSetup(((rl() & 0xffff0000) | lo) >>> 0);
    if (runOneCase("C", i, setup)) okC++;
  }
  console.log(`  Match: ${okC}/${perSuite} = ${((okC / perSuite) * 100).toFixed(1)}%`);
  totalOk += okC;

  // ─── Suite D: random again, bufEnd random LSB-aligned ──────────────
  const sizeD = perSuite + remainder;
  console.log(`\n=== Suite D: random alt seed — ${sizeD} cases ===`);
  let okD = 0;
  for (let i = 0; i < sizeD; i++) {
    if (runOneCase("D", i, makeSetup())) okD++;
  }
  console.log(`  Match: ${okD}/${sizeD} = ${((okD / sizeD) * 100).toFixed(1)}%`);
  totalOk += okD;

  console.log(
    `\n=== TOTAL: ${totalOk}/${total} = ${((totalOk / total) * 100).toFixed(1)}% ===`,
  );
  if (firstFail !== null) {
    const f: FailRecord = firstFail;
    console.log(
      `  First fail (suite ${f.suite} tc=${f.i}): ${f.field} bin=0x${f.bin.toString(16)} ts=0x${f.ts.toString(16)}`,
    );
    console.log(
      `    args=[0x${f.setup.arg1.toString(16)}, 0x${f.setup.arg2.toString(16)}, 0x${f.setup.arg3.toString(16)}, 0x${f.setup.arg4.toString(16)}, 0x${f.setup.arg5.toString(16)}, 0x${f.setup.arg6.toString(16)}] bufEnd=0x${f.setup.bufEnd.toString(16)}`,
    );
  }

  disposeCpu(cpu);
  exit(totalOk === total ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  exit(1);
});
