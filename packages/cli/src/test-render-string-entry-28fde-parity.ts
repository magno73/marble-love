#!/usr/bin/env node
/**
 * test-render-string-entry-28fde-parity.ts — differential FUN_28FDE.
 *
 * with (0x400434, 0x3400).
 *
 * Stub injection strategy:
 *     that renderStringEntry28FDE must replicate.
 *
 *   - A: arg1/arg2 random long, entry pre-fill random
 *
 *
 * Usage: npx tsx packages/cli/src/test-render-string-entry-28fde-parity.ts [N]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import {
  state as stateNs,
  renderStringEntry28FDE as fdeNs,
} from "@marble-love/engine";
import {
  createCpu,
  callFunction,
  pokeMem,
  peekMem,
  disposeCpu,
} from "./binary-oracle-lib.js";
import type { CpuSession } from "./binary-oracle-lib.js";

const FUN_28FDE = 0x00028fde;
const FUN_2572 = 0x00002572;

/** Patch FUN_2572 (renderStringChain) to `rts` (0x4E75) for a no-op stub. */
function patchSubs(cpu: CpuSession): void {
  pokeMem(cpu, FUN_2572 + 0, 1, 0x4e);
  pokeMem(cpu, FUN_2572 + 1, 1, 0x75);
}

/** Compared workRam range (entry @ 0x400434, 16 bytes around it for safety). */
const COMPARE_BASE = 0x00400430;
const COMPARE_SIZE = 0x10; // 0x400430..0x40043F
const COMPARE_BASE_OFF = COMPARE_BASE - 0x00400000; // 0x430

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) >>> 0;
    return ((s >>> 16) & 0xffff) / 0x10000;
  };
}

function setupRegion(
  state: ReturnType<typeof stateNs.emptyGameState>,
  cpu: CpuSession,
  bytes: number[],
): void {
  for (let i = 0; i < COMPARE_SIZE; i++) {
    const v = bytes[i] ?? 0;
    pokeMem(cpu, COMPARE_BASE + i, 1, v);
    state.workRam[COMPARE_BASE_OFF + i] = v;
  }
}

/** Compare region after run. Returns first diff or null. */
function compareRegion(
  state: ReturnType<typeof stateNs.emptyGameState>,
  cpu: CpuSession,
): { offset: number; bin: number; ts: number } | null {
  for (let i = 0; i < COMPARE_SIZE; i++) {
    const b = peekMem(cpu, COMPARE_BASE + i, 1);
    const t = state.workRam[COMPARE_BASE_OFF + i] ?? 0;
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
  patchSubs(cpu);

  const subs: fdeNs.RenderStringEntry28FDESubs = {
    renderStringChain: (_addr: number, _attr: number): void => {},
  };

  let totalOk = 0;
  interface FailRecord {
    suite: string;
    tc: number;
    offset: number;
    bin: number;
    ts: number;
    arg1: number;
    arg2: number;
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
    setupRegion(stateInst, cpu, bytes);

    callFunction(cpu, FUN_28FDE, [arg1 >>> 0, arg2 >>> 0]);
    fdeNs.renderStringEntry28FDE(stateInst, arg1 >>> 0, arg2 >>> 0, subs);

    const fail = compareRegion(stateInst, cpu);
    if (fail === null) return true;
    if (failHolder.value === null) {
      failHolder.value = {
        suite,
        tc,
        offset: fail.offset,
        bin: fail.bin,
        ts: fail.ts,
        arg1,
        arg2,
      };
    }
    return false;
  }

  const rng = makeRng(0x28fde);
  const rb = (): number => Math.floor(rng() * 256) & 0xff;
  const rl = (): number =>
    ((Math.floor(rng() * 0x10000) << 16) | Math.floor(rng() * 0x10000)) >>> 0;

  // ─── Suite A: random everything ──────────────────────────────────────
  console.log(
    `\n=== renderStringEntry28FDE (FUN_28FDE) — Suite A: random region & args — ${perSuite} cases ===`,
  );
  let okA = 0;
  for (let i = 0; i < perSuite; i++) {
    const bytes = new Array(COMPARE_SIZE).fill(0).map(() => rb());
    const arg1 = rl();
    const arg2 = rl();
    if (runOneCase("A", i, () => bytes, arg1, arg2)) okA++;
  }
  console.log(`  Match: ${okA}/${perSuite} = ${((okA / perSuite) * 100).toFixed(1)}%`);
  totalOk += okA;

  console.log(
    `\n=== Suite B: arg LSB = 0x00 — ${perSuite} cases ===`,
  );
  let okB = 0;
  for (let i = 0; i < perSuite; i++) {
    const bytes = new Array(COMPARE_SIZE).fill(0).map(() => rb());
    // Pre-fill entry+0/+1 with non-zero sentinels to detect overwrites.
    bytes[0x4 + 0] = 0xaa;
    bytes[0x4 + 1] = 0xbb;
    // arg long with LSB = 0 and random upper bytes.
    const arg1 = (rl() & 0xffffff00) >>> 0;
    const arg2 = (rl() & 0xffffff00) >>> 0;
    if (runOneCase("B", i, () => bytes, arg1, arg2)) okB++;
  }
  console.log(`  Match: ${okB}/${perSuite} = ${((okB / perSuite) * 100).toFixed(1)}%`);
  totalOk += okB;

  // ─── Suite C: arg LSB = 0xFF (saturation) ────────────────────────────
  console.log(
    `\n=== Suite C: arg LSB = 0xFF — ${perSuite} cases ===`,
  );
  let okC = 0;
  for (let i = 0; i < perSuite; i++) {
    const bytes = new Array(COMPARE_SIZE).fill(0).map(() => rb());
    // arg long with LSB = 0xFF and random upper bytes.
    const arg1 = ((rl() & 0xffffff00) | 0xff) >>> 0;
    const arg2 = ((rl() & 0xffffff00) | 0xff) >>> 0;
    if (runOneCase("C", i, () => bytes, arg1, arg2)) okC++;
  }
  console.log(`  Match: ${okC}/${perSuite} = ${((okC / perSuite) * 100).toFixed(1)}%`);
  totalOk += okC;

  // ─── Suite D: marker pre-set cycled 0..255 ───────────────────────────
  const sizeD = perSuite + remainder;
  console.log(
    `\n=== Suite D: marker @ +6 cycled 0..255 — ${sizeD} cases ===`,
  );
  let okD = 0;
  for (let i = 0; i < sizeD; i++) {
    const bytes = new Array(COMPARE_SIZE).fill(0).map(() => rb());
    bytes[0x4 + 6] = i & 0xff;
    const arg1 = rl();
    const arg2 = rl();
    if (runOneCase("D", i, () => bytes, arg1, arg2)) okD++;
  }
  console.log(`  Match: ${okD}/${sizeD} = ${((okD / sizeD) * 100).toFixed(1)}%`);
  totalOk += okD;

  console.log(
    `\n=== TOTAL: ${totalOk}/${total} = ${((totalOk / total) * 100).toFixed(1)}% ===`,
  );
  if (failHolder.value !== null) {
    const f = failHolder.value;
    console.log(
      `  First fail (suite ${f.suite} tc=${f.tc}): @ region+0x${f.offset.toString(16)} ` +
      `bin=0x${f.bin.toString(16)} ts=0x${f.ts.toString(16)} ` +
      `args=[0x${f.arg1.toString(16)}, 0x${f.arg2.toString(16)}]`,
    );
  }

  disposeCpu(cpu);
  exit(totalOk === total ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  exit(1);
});
