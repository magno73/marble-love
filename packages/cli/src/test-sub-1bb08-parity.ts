#!/usr/bin/env node
/**
 * test-sub-1bb08-parity.ts — differential FUN_0001BB08 vs `sub1BB08`.
 *
 *
 * **Strategia parity**:
 *     replicata da `updateScrollCoords1BB50`. La replica TS include la
 *     callee inline (cfr. scroll-coord-helpers.ts).
 *     sub-cell, cell, dirty flag).
 *
 * Uso: npx tsx packages/cli/src/test-sub-1bb08-parity.ts [N]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import {
  state as stateNs,
  sub1BB08 as subNs,
} from "@marble-love/engine";
import {
  createCpu,
  callFunction,
  pokeMem,
  peekMem,
  disposeCpu,
} from "./binary-oracle-lib.js";
import type { CpuSession } from "./binary-oracle-lib.js";

const FUN_1BB08 = 0x0001bb08;

const ENTITY_ABS = 0x00401d00;
const ENTITY_OFF = ENTITY_ABS - 0x400000;
const ENTITY_SIZE = 0x18; // copre 0xC..0x10 + un po' di trailing

const COMPARE_BASE = 0x00400690;
const COMPARE_SIZE = 0x14; // 0x400690..0x4006A3

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) >>> 0;
    return ((s >>> 16) & 0xffff) / 0x10000;
  };
}

function setupBoth(
  state: ReturnType<typeof stateNs.emptyGameState>,
  cpu: CpuSession,
  entityBytes: number[],
  globBytes: number[],
): void {
  for (let i = 0; i < ENTITY_SIZE; i++) {
    const v = entityBytes[i] ?? 0;
    pokeMem(cpu, ENTITY_ABS + i, 1, v);
    state.workRam[ENTITY_OFF + i] = v;
  }
  for (let i = 0; i < COMPARE_SIZE; i++) {
    const v = globBytes[i] ?? 0;
    pokeMem(cpu, COMPARE_BASE + i, 1, v);
    state.workRam[COMPARE_BASE - 0x400000 + i] = v;
  }
}

function compareGlobals(
  state: ReturnType<typeof stateNs.emptyGameState>,
  cpu: CpuSession,
): { offset: number; bin: number; ts: number } | null {
  for (let i = 0; i < COMPARE_SIZE; i++) {
    const b = peekMem(cpu, COMPARE_BASE + i, 1);
    const t = state.workRam[COMPARE_BASE - 0x400000 + i] ?? 0;
    if (b !== t) return { offset: i, bin: b, ts: t };
  }
  return null;
}

async function main(): Promise<void> {
  const total = Number(process.argv[2] ?? "100");

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
    tc: number;
    offset: number;
    bin: number;
    ts: number;
  }
  const failHolder: { value: FailRecord | null } = { value: null };

  function runOneCase(tc: number, entityBytes: number[], globBytes: number[]): boolean {
    cpu.system.setRegister("sp", 0x401f00);
    setupBoth(stateInst, cpu, entityBytes, globBytes);
    callFunction(cpu, FUN_1BB08, [ENTITY_ABS]);
    subNs.sub1BB08(stateInst, ENTITY_ABS);
    const fail = compareGlobals(stateInst, cpu);
    if (fail === null) return true;
    if (failHolder.value === null) {
      failHolder.value = { tc, offset: fail.offset, bin: fail.bin, ts: fail.ts };
    }
    return false;
  }

  const rng = makeRng(0x1bb08);
  const rb = (): number => Math.floor(rng() * 256) & 0xff;

  console.log(`\n=== sub1BB08 (FUN_0001BB08) — 100 random scenarios — ${total} casi ===`);

  for (let i = 0; i < total; i++) {
    const entityBytes = new Array(ENTITY_SIZE).fill(0).map(() => rb());
    const globBytes = new Array(COMPARE_SIZE).fill(0).map(() => rb());
    if (runOneCase(i, entityBytes, globBytes)) totalOk++;
  }

  console.log(`  Match: ${totalOk}/${total} = ${((totalOk / total) * 100).toFixed(1)}%`);
  if (failHolder.value !== null) {
    const f = failHolder.value;
    console.log(
      `  First fail tc=${f.tc}: @ 0x${(0x690 + f.offset).toString(16)} ` +
        `bin=0x${f.bin.toString(16)} ts=0x${f.ts.toString(16)}`,
    );
  }

  disposeCpu(cpu);
  exit(totalOk === total ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  exit(1);
});
