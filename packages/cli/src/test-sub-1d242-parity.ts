#!/usr/bin/env node
/**
 * test-sub-1d242-parity.ts — differential FUN_0001D242 vs `sub1D242`.
 *
 * FUN_0001D242 (286 byte): decide-direction + anim-set + table-scan.
 *   cursor[0]/[1] along two paths (Y-first if entity[0..3].l != 0, else X-first).
 * - Set entity[0x25] = 2, clear entity[0x24].
 * - Scan loop @ 0x400018 stride 0xE2, limit *0x400396 (word): if A1[0x18]==1
 *   AND entity[0x1B] == A1[0x1B] == 6 → set entity[0x25]=1 (early exit).
 *
 * **Strategia parity**:
 *     byte (to verify there are NO spurious writes).
 *   - Setup: entity @ 0x401D00, cursor @ 0x401E00.
 *
 * Uso: npx tsx packages/cli/src/test-sub-1d242-parity.ts [N]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import {
  state as stateNs,
  sub1D242 as subNs,
} from "@marble-love/engine";
import {
  createCpu,
  callFunction,
  pokeMem,
  peekMem,
  disposeCpu,
} from "./binary-oracle-lib.js";
import type { CpuSession } from "./binary-oracle-lib.js";

const FUN_1D242 = 0x0001d242;

const ENTITY_ABS = 0x00401d00;
const ENTITY_OFF = ENTITY_ABS - 0x400000;
const ENTITY_SIZE = 0x60;

const CURSOR_ABS = 0x00401e00;
const CURSOR_OFF = CURSOR_ABS - 0x400000;
const CURSOR_SIZE = 0x10;

const SCAN_BASE = 0x00400018;
const SCAN_OFF = SCAN_BASE - 0x400000;
const SCAN_REGION_SIZE = 0xe2 * 3;

const LOOP_LIMIT_ADDR = 0x00400396;

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) >>> 0;
    return ((s >>> 16) & 0xffff) / 0x10000;
  };
}

function writeLongBytes(arr: number[], off: number, v: number): void {
  const u = v >>> 0;
  arr[off]     = (u >>> 24) & 0xff;
  arr[off + 1] = (u >>> 16) & 0xff;
  arr[off + 2] = (u >>> 8)  & 0xff;
  arr[off + 3] =  u         & 0xff;
}

interface CaseSetup {
  entity: number[];
  cursor: number[];
  scan: number[]; // SCAN_REGION_SIZE bytes
  limitWord: number; // *0x400396.w (0..3 in test)
}

function setupBoth(
  state: ReturnType<typeof stateNs.emptyGameState>,
  cpu: CpuSession,
  c: CaseSetup,
): void {
  for (let i = 0; i < ENTITY_SIZE; i++) {
    const v = c.entity[i] ?? 0;
    pokeMem(cpu, ENTITY_ABS + i, 1, v);
    state.workRam[ENTITY_OFF + i] = v;
  }
  for (let i = 0; i < CURSOR_SIZE; i++) {
    const v = c.cursor[i] ?? 0;
    pokeMem(cpu, CURSOR_ABS + i, 1, v);
    state.workRam[CURSOR_OFF + i] = v;
  }
  for (let i = 0; i < SCAN_REGION_SIZE; i++) {
    const v = c.scan[i] ?? 0;
    pokeMem(cpu, SCAN_BASE + i, 1, v);
    state.workRam[SCAN_OFF + i] = v;
  }
  // Write limit word @ 0x400396 (big-endian).
  pokeMem(cpu, LOOP_LIMIT_ADDR + 0, 1, (c.limitWord >>> 8) & 0xff);
  pokeMem(cpu, LOOP_LIMIT_ADDR + 1, 1,  c.limitWord       & 0xff);
  state.workRam[LOOP_LIMIT_ADDR - 0x400000]     = (c.limitWord >>> 8) & 0xff;
  state.workRam[LOOP_LIMIT_ADDR - 0x400000 + 1] =  c.limitWord       & 0xff;
}

function compareRegions(
  state: ReturnType<typeof stateNs.emptyGameState>,
  cpu: CpuSession,
): { region: string; offset: number; bin: number; ts: number } | null {
  for (let i = 0; i < ENTITY_SIZE; i++) {
    const b = peekMem(cpu, ENTITY_ABS + i, 1);
    const t = state.workRam[ENTITY_OFF + i] ?? 0;
    if (b !== t) return { region: "entity", offset: i, bin: b, ts: t };
  }
  for (let i = 0; i < CURSOR_SIZE; i++) {
    const b = peekMem(cpu, CURSOR_ABS + i, 1);
    const t = state.workRam[CURSOR_OFF + i] ?? 0;
    if (b !== t) return { region: "cursor", offset: i, bin: b, ts: t };
  }
  for (let i = 0; i < SCAN_REGION_SIZE; i++) {
    const b = peekMem(cpu, SCAN_BASE + i, 1);
    const t = state.workRam[SCAN_OFF + i] ?? 0;
    if (b !== t) return { region: "scan", offset: i, bin: b, ts: t };
  }
  return null;
}

function buildRandomCase(rng: () => number): CaseSetup {
  const rb = (): number => Math.floor(rng() * 256) & 0xff;
  const rl = (): number =>
    ((Math.floor(rng() * 0x10000) << 16) | Math.floor(rng() * 0x10000)) >>> 0;

  const entity: number[] = new Array(ENTITY_SIZE).fill(0).map(() => rb());

  // pos.X, pos.Y → random long
  writeLongBytes(entity, 0x0c, rl());
  writeLongBytes(entity, 0x10, rl());

  // cursor ptr → CURSOR_ABS
  writeLongBytes(entity, 0x2c, CURSOR_ABS);

  if (Math.floor(rng() * 2) === 0) {
    writeLongBytes(entity, 0x00, 0);
  } else {
    writeLongBytes(entity, 0x00, rl());
  }

  const cursor: number[] = new Array(CURSOR_SIZE).fill(0).map(() => rb());
  const scan: number[] = new Array(SCAN_REGION_SIZE).fill(0).map(() => rb());

  const limitWord = Math.floor(rng() * 4);

  return { entity, cursor, scan, limitWord };
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
    region: string;
    offset: number;
    bin: number;
    ts: number;
  }
  const failHolder: { value: FailRecord | null } = { value: null };

  function runOneCase(tc: number, c: CaseSetup): boolean {
    cpu.system.setRegister("sp", 0x401f00);
    setupBoth(stateInst, cpu, c);
    callFunction(cpu, FUN_1D242, [ENTITY_ABS]);
    subNs.sub1D242(stateInst, ENTITY_ABS);
    const fail = compareRegions(stateInst, cpu);
    if (fail === null) return true;
    if (failHolder.value === null) {
      failHolder.value = { tc, ...fail };
    }
    return false;
  }

  const rng = makeRng(0x1d242);

  console.log(`\n=== sub1D242 (FUN_0001D242) — 100 random scenarios — ${total} casi ===`);

  for (let i = 0; i < total; i++) {
    const c = buildRandomCase(rng);
    if (runOneCase(i, c)) totalOk++;
  }

  console.log(`  Match: ${totalOk}/${total} = ${((totalOk / total) * 100).toFixed(1)}%`);
  if (failHolder.value !== null) {
    const f = failHolder.value;
    console.log(
      `  First fail tc=${f.tc}: @ ${f.region}+0x${f.offset.toString(16)} ` +
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
