#!/usr/bin/env node
/**
 * test-entity-waypoint-step-1d1ec-parity.ts — differential FUN_1D1EC
 * vs entityWaypointStep1D1EC.
 *
 * of the entity subsystem. Args: one long on the stack (entityPtr).
 *
 * Logica:
 *   - cellX = signed_asr(*(long*)(ptr+0x0c), 19) & 0xffff
 *   - cellY = signed_asr(*(long*)(ptr+0x10), 19) & 0xffff
 *   - cursor = *(long*)(ptr+0x2c)
 *   - if ext.w(cursor[0]) == cellX and ext.w(cursor[1]) == cellY:
 *       *(long*)(ptr+0x2c) = *(long*)(ptr+0x30) + ext.l(signed cursor[2]) * 4
 *   - jsr FUN_1D242(entityPtr) ← STUB injection (rts no-op)
 *
 * Strategia:
 *   - In TS, callback `fun_1d242` no-op
 *
 * Layout test:
 *   - Entity struct @ 0x401E00 (offset 0x1E00 in workRam)
 *   - Cursor table @ 0x401E80 (offset 0x1E80 in workRam) — 8 byte slot
 *
 * Suite testate:
 *   - B: forced match (cursor[0..1] == cellX/Y derivati da pos)
 *   - C: forced mismatch X (no-op write)
 *   - D: cursor[2] = signed byte random (including negative e edges)
 *
 * Uso: npx tsx packages/cli/src/test-entity-waypoint-step-1d1ec-parity.ts [N]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import {
  state as stateNs,
  entityWaypointStep1D1EC as entStepNs,
} from "@marble-love/engine";
import {
  createCpu,
  callFunction,
  pokeMem,
  peekMem,
  disposeCpu,
} from "./binary-oracle-lib.js";
import type { CpuSession } from "./binary-oracle-lib.js";

const FUN_1D1EC = 0x0001d1ec;
const FUN_1D242 = 0x0001d242;

/** Patch FUN_1D242 a `rts` (4E 75) per stub no-op. */
function patchSubs(cpu: CpuSession): void {
  pokeMem(cpu, FUN_1D242 + 0, 1, 0x4e);
  pokeMem(cpu, FUN_1D242 + 1, 1, 0x75);
}

const ENTITY_ABS = 0x00401e00;
const ENTITY_OFF = ENTITY_ABS - 0x400000;
const ENTITY_SIZE = 0x40; // 0x401E00..0x401E3F

const CURSOR_ABS = 0x00401e80;
const CURSOR_OFF = CURSOR_ABS - 0x400000;
const CURSOR_SIZE = 0x10; // include cursor + alcuni byte trailing

const ARRAY_BASE_ABS = 0x00401e90;

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) >>> 0;
    return ((s >>> 16) & 0xffff) / 0x10000;
  };
}

function writeLongBytes(arr: number[], off: number, v: number): void {
  const u = v >>> 0;
  arr[off] = (u >>> 24) & 0xff;
  arr[off + 1] = (u >>> 16) & 0xff;
  arr[off + 2] = (u >>> 8) & 0xff;
  arr[off + 3] = u & 0xff;
}

interface CaseSetup {
  /** Struct entity bytes (size ENTITY_SIZE). */
  entity: number[];
  /** Cursor area bytes (size CURSOR_SIZE). */
  cursor: number[];
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
}

function compareBoth(
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
  return null;
}

/** Build a "pure" random setup: random struct but with cursor/base
  */
function buildRandomCase(rng: () => number, opts?: {
  forcePosToCursorMatch?: boolean;
  forceCursorMismatchX?: boolean;
  signedStep?: boolean;
}): CaseSetup {
  const rb = (): number => Math.floor(rng() * 256) & 0xff;
  const rl = (): number =>
    ((Math.floor(rng() * 0x10000) << 16) | Math.floor(rng() * 0x10000)) >>> 0;

  const entity: number[] = new Array(ENTITY_SIZE).fill(0).map(() => rb());
  const cursor: number[] = new Array(CURSOR_SIZE).fill(0).map(() => rb());

  // Sets pos.X (off 0x0c) e pos.Y (off 0x10) random long
  const posX = rl();
  const posY = rl();
  writeLongBytes(entity, 0x0c, posX);
  writeLongBytes(entity, 0x10, posY);

  // Cursor pointer (off 0x2c) → CURSOR_ABS
  writeLongBytes(entity, 0x2c, CURSOR_ABS);
  // Base pointer (off 0x30) → ARRAY_BASE_ABS
  writeLongBytes(entity, 0x30, ARRAY_BASE_ABS);

  const cellX = ((posX | 0) >> 0x13) & 0xff;
  const cellY = ((posY | 0) >> 0x13) & 0xff;

  if (opts?.forcePosToCursorMatch === true) {
    cursor[0] = cellX;
    cursor[1] = cellY;
  } else if (opts?.forceCursorMismatchX === true) {
    // Sets cursor[0] != cellX (semplice + 1)
    cursor[0] = (cellX + 1) & 0xff;
  }

  if (opts?.signedStep === true) {
    cursor[2] = rb();
  }

  return { entity, cursor };
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

  const subs: entStepNs.EntityWaypointStep1D1ECSubs = {
    fun_1d242: (_p: number): void => {},
  };

  let totalOk = 0;
  interface FailRecord {
    suite: string;
    tc: number;
    region: string;
    offset: number;
    bin: number;
    ts: number;
  }
  const failHolder: { value: FailRecord | null } = { value: null };

  function runOneCase(suite: string, tc: number, c: CaseSetup): boolean {
    cpu.system.setRegister("sp", 0x401f00);
    setupBoth(stateInst, cpu, c);
    callFunction(cpu, FUN_1D1EC, [ENTITY_ABS]);
    entStepNs.entityWaypointStep1D1EC(stateInst, ENTITY_ABS, subs);
    const fail = compareBoth(stateInst, cpu);
    if (fail === null) return true;
    if (failHolder.value === null) {
      failHolder.value = { suite, tc, ...fail };
    }
    return false;
  }

  const rng = makeRng(0x1d1ec);

  // ─── Suite A: random everything ──────────────────────────────────────
  console.log(
    `\n=== entityWaypointStep1D1EC (FUN_1D1EC) — Suite A: random struct & cursor — ${perSuite} cases ===`,
  );
  let okA = 0;
  for (let i = 0; i < perSuite; i++) {
    const c = buildRandomCase(rng);
    if (runOneCase("A", i, c)) okA++;
  }
  console.log(`  Match: ${okA}/${perSuite} = ${((okA / perSuite) * 100).toFixed(1)}%`);
  totalOk += okA;

  // ─── Suite B: forced cursor X+Y match → step si applica ────────────
  console.log(`\n=== Suite B: forced cursor match → step apply — ${perSuite} cases ===`);
  let okB = 0;
  for (let i = 0; i < perSuite; i++) {
    const c = buildRandomCase(rng, { forcePosToCursorMatch: true, signedStep: true });
    if (runOneCase("B", i, c)) okB++;
  }
  console.log(`  Match: ${okB}/${perSuite} = ${((okB / perSuite) * 100).toFixed(1)}%`);
  totalOk += okB;

  // ─── Suite C: forced cursor[0] mismatch → no apply ─────────────────
  console.log(`\n=== Suite C: forced cursor X mismatch → no-op write — ${perSuite} cases ===`);
  let okC = 0;
  for (let i = 0; i < perSuite; i++) {
    const c = buildRandomCase(rng, { forceCursorMismatchX: true });
    if (runOneCase("C", i, c)) okC++;
  }
  console.log(`  Match: ${okC}/${perSuite} = ${((okC / perSuite) * 100).toFixed(1)}%`);
  totalOk += okC;

  // ─── Suite D: signed step (negative/positive edges) ─────────────────
  const sizeD = perSuite + remainder;
  console.log(`\n=== Suite D: random signed step (incl. negative) — ${sizeD} cases ===`);
  let okD = 0;
  for (let i = 0; i < sizeD; i++) {
    const c = buildRandomCase(rng, { forcePosToCursorMatch: true, signedStep: true });
    if (i < 4) {
      const edges = [0, 0x7f, 0x80, 0xff];
      c.cursor[2] = edges[i] ?? 0;
    }
    if (runOneCase("D", i, c)) okD++;
  }
  console.log(`  Match: ${okD}/${sizeD} = ${((okD / sizeD) * 100).toFixed(1)}%`);
  totalOk += okD;

  console.log(`\n=== TOTALE: ${totalOk}/${total} = ${((totalOk / total) * 100).toFixed(1)}% ===`);
  if (failHolder.value !== null) {
    const f = failHolder.value;
    console.log(
      `  First fail (suite ${f.suite} tc=${f.tc}): @ ${f.region}+0x${f.offset.toString(16)} ` +
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
