#!/usr/bin/env node
/**
 * test-state-dispatch-15460-parity.ts — differential FUN_15460 vs
 * `stateDispatch15460`.
 *
 * 7-way dispatcher on `kind = byte @ structPtr+0x1A` with bounds check
 * only the common epilogue.
 *
 *     (vel_y), `(0x5C,A0)` (anim ptr), `(0x26,A0)=1`.
 *     `(0x26,A0) = 1`.
 *     `(0x26,A0) ∈ {-1, +1}` in delta path.
 *     magnitude of fields +0x1C/+0x20; `(0x26,A0) = 1`.
 *   - epilog: `(0x58,A0) ← (0x5C,A0)`, `(0x24,A0) = 0`,
 *     `(0x25,A0) = 0x02 if kind in {0,4} else 0x01`.
 *
 *   - B: random kind in [7..0x7F] (positive out-of-range) -> epilogue only.
 *   - C: kind random ∈ [0x80..0xFF] (out-of-range negativo signed) →
 *        epilogue only (blt branch).
 *
 *
 * Uso: npx tsx packages/cli/src/test-state-dispatch-15460-parity.ts [N]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import {
  state as stateNs,
  stateDispatch15460 as ns,
} from "@marble-love/engine";
import {
  createCpu,
  callFunction,
  pokeMem,
  peekMem,
  disposeCpu,
} from "./binary-oracle-lib.js";
import type { CpuSession } from "./binary-oracle-lib.js";

const FUN_15460 = 0x00015460;

const WORK_RAM_BASE = 0x00400000;

const STRUCT_BASE = 0x00400500;
const STRUCT_SIZE = 0x80;

// Target cell ptr (for cases 0/3): 16-byte area containing 2 bytes
const TARGET_BASE = 0x00401000;
const TARGET_SIZE = 0x10;

const KIND_OFF = 0x1a;
const TARGET_PTR_OFF = 0x4a;

/**
 * Reset zone osservate (struct + target cell area).
 */
function resetZones(
  state: ReturnType<typeof stateNs.emptyGameState>,
  cpu: CpuSession,
): void {
  for (let i = 0; i < STRUCT_SIZE; i++) {
    pokeMem(cpu, STRUCT_BASE + i, 1, 0);
    state.workRam[STRUCT_BASE + i - WORK_RAM_BASE] = 0;
  }
  for (let i = 0; i < TARGET_SIZE; i++) {
    pokeMem(cpu, TARGET_BASE + i, 1, 0);
    state.workRam[TARGET_BASE + i - WORK_RAM_BASE] = 0;
  }
}

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) >>> 0;
    return ((s >>> 16) & 0xffff) / 0x10000;
  };
}

function pokeByteBoth(
  state: ReturnType<typeof stateNs.emptyGameState>,
  cpu: CpuSession,
  abs: number,
  v: number,
): void {
  pokeMem(cpu, abs, 1, v & 0xff);
  state.workRam[abs - WORK_RAM_BASE] = v & 0xff;
}

function pokeLongBoth(
  state: ReturnType<typeof stateNs.emptyGameState>,
  cpu: CpuSession,
  abs: number,
  v: number,
): void {
  const off = abs - WORK_RAM_BASE;
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

function compareZone(
  state: ReturnType<typeof stateNs.emptyGameState>,
  cpu: CpuSession,
  base: number,
  size: number,
  label: string,
): { offset: number; bin: number; ts: number; label: string } | null {
  for (let i = 0; i < size; i++) {
    const b = peekMem(cpu, base + i, 1) & 0xff;
    const t = state.workRam[base + i - WORK_RAM_BASE] ?? 0;
    if (b !== t) return { offset: i, bin: b, ts: t, label };
  }
  return null;
}

interface CaseSetup {
  /** Bytes dello struct (size STRUCT_SIZE). */
  structBytes: number[];
  /** Bytes della target cell area (size TARGET_SIZE). */
  targetBytes: number[];
}

/**
 */
function buildCase(
  rng: () => number,
  opts: { kindOverride?: number; case4FieldsOverride?: { v1c: number; v20: number } } = {},
): CaseSetup {
  const rb = (): number => Math.floor(rng() * 256) & 0xff;
  const rl = (): number =>
    ((Math.floor(rng() * 0x10000) << 16) | Math.floor(rng() * 0x10000)) >>> 0;

  const structBytes: number[] = new Array(STRUCT_SIZE).fill(0).map(() => rb());
  const targetBytes: number[] = new Array(TARGET_SIZE).fill(0).map(() => rb());

  // target ptr (long @ +0x4A) → TARGET_BASE
  const writeLong = (arr: number[], off: number, v: number): void => {
    const u = v >>> 0;
    arr[off] = (u >>> 24) & 0xff;
    arr[off + 1] = (u >>> 16) & 0xff;
    arr[off + 2] = (u >>> 8) & 0xff;
    arr[off + 3] = u & 0xff;
  };
  writeLong(structBytes, TARGET_PTR_OFF, TARGET_BASE);

  if (opts.kindOverride !== undefined) {
    structBytes[KIND_OFF] = opts.kindOverride & 0xff;
  }

  if (opts.case4FieldsOverride !== undefined) {
    writeLong(structBytes, 0x1c, opts.case4FieldsOverride.v1c);
    writeLong(structBytes, 0x20, opts.case4FieldsOverride.v20);
  }

  // touch unused: rl() per consumare RNG e mantenere determinismo
  void rl;

  return { structBytes, targetBytes };
}

function applyCase(
  state: ReturnType<typeof stateNs.emptyGameState>,
  cpu: CpuSession,
  c: CaseSetup,
): void {
  for (let i = 0; i < STRUCT_SIZE; i++) {
    pokeByteBoth(state, cpu, STRUCT_BASE + i, c.structBytes[i] ?? 0);
  }
  for (let i = 0; i < TARGET_SIZE; i++) {
    pokeByteBoth(state, cpu, TARGET_BASE + i, c.targetBytes[i] ?? 0);
  }
  void pokeLongBoth; // dummy reference per evitare unused-warning
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

  const state = stateNs.emptyGameState();
  const cpu = await createCpu({ rom, state });

  let totalOk = 0;
  interface FailRecord {
    suite: string;
    tc: number;
    kind: number;
    diff: { offset: number; bin: number; ts: number; label: string };
  }
  const failHolder: { value: FailRecord | null } = { value: null };

  function runOneCase(
    suite: string,
    tc: number,
    c: CaseSetup,
  ): boolean {
    cpu.system.setRegister("sp", 0x401f80);
    resetZones(state, cpu);
    applyCase(state, cpu, c);

    callFunction(cpu, FUN_15460, [STRUCT_BASE >>> 0]);
    ns.stateDispatch15460(state, STRUCT_BASE >>> 0);

    const structDiff = compareZone(
      state,
      cpu,
      STRUCT_BASE,
      STRUCT_SIZE,
      "struct",
    );
    if (structDiff !== null) {
      if (failHolder.value === null) {
        failHolder.value = {
          suite,
          tc,
          kind: c.structBytes[KIND_OFF] ?? 0,
          diff: structDiff,
        };
      }
      return false;
    }
    const tDiff = compareZone(state, cpu, TARGET_BASE, TARGET_SIZE, "target");
    if (tDiff !== null) {
      if (failHolder.value === null) {
        failHolder.value = {
          suite,
          tc,
          kind: c.structBytes[KIND_OFF] ?? 0,
          diff: tDiff,
        };
      }
      return false;
    }
    return true;
  }

  const rng = makeRng(0x15460);

  // ─── Suite A: kind ∈ [0..6] random ─────────────────────────────────────
  console.log(
    `\n=== stateDispatch15460 (FUN_15460) — Suite A: kind ∈ [0..6] — ${perSuite} casi ===`,
  );
  let okA = 0;
  for (let i = 0; i < perSuite; i++) {
    const kind = Math.floor(rng() * 7) & 0xff;
    const c = buildCase(rng, { kindOverride: kind });
    if (runOneCase("A", i, c)) okA++;
  }
  console.log(
    `  Match: ${okA}/${perSuite} = ${((okA / perSuite) * 100).toFixed(1)}%`,
  );
  totalOk += okA;

  // ─── Suite B: kind ∈ [7..0x7F] (out-of-range positivo) ──────────────────
  console.log(
    `\n=== Suite B: kind ∈ [7..0x7F] (OOR signed≥0) — ${perSuite} casi ===`,
  );
  let okB = 0;
  for (let i = 0; i < perSuite; i++) {
    let kind: number;
    do {
      kind = Math.floor(rng() * 0x80) & 0x7f;
    } while (kind <= 6);
    const c = buildCase(rng, { kindOverride: kind });
    if (runOneCase("B", i, c)) okB++;
  }
  console.log(
    `  Match: ${okB}/${perSuite} = ${((okB / perSuite) * 100).toFixed(1)}%`,
  );
  totalOk += okB;

  // ─── Suite C: kind ∈ [0x80..0xFF] (out-of-range negativo signed) ───────
  console.log(
    `\n=== Suite C: kind ∈ [0x80..0xFF] (OOR signed<0 → blt) — ${perSuite} casi ===`,
  );
  let okC = 0;
  for (let i = 0; i < perSuite; i++) {
    const kind = 0x80 | Math.floor(rng() * 0x80);
    const c = buildCase(rng, { kindOverride: kind });
    if (runOneCase("C", i, c)) okC++;
  }
  console.log(
    `  Match: ${okC}/${perSuite} = ${((okC / perSuite) * 100).toFixed(1)}%`,
  );
  totalOk += okC;

  // ─── Suite D: focus case 4 (velocity magnitude) ────────────────────────
  const sizeD = perSuite + remainder;
  console.log(
    `\n=== Suite D: kind=4 + (v1C, v20) pathologici — ${sizeD} casi ===`,
  );
  const pathologicalPairs = [
    [0x00000064, 0xffffffce], // |100| > |50|, D1 > 0  → X_POS
    [0xffffff9c, 0x00000032], // |100| > |50|, D1 < 0  → X_NEG
    [0x00000005, 0x000000c8], // |5| < |200|, D0 > 0   → Y_POS
    [0x00000005, 0xffffff38], // |5| < |200|, D0 < 0   → Y_NEG
    [0x00000000, 0x00000000], // entrambi 0 → Y axis (D3<=D2), D0=0 (≤0) → Y_NEG
    [0x80000000, 0x80000000],
    [0x7fffffff, 0x80000001], // |D1|=max, |D0|=max-1 → X_POS
    [0x00000001, 0x00000001], // |D1|=|D0|, both pos  → Y axis (≤), D0>0 → Y_POS
    [0xffffffff, 0xffffffff], // |D1|=|D0|=1, both neg→ Y axis, D0<0 → Y_NEG
    [0x80000000, 0x00000001], // |D1| huge, D1<0 → X_NEG
  ];
  let okD = 0;
  for (let i = 0; i < sizeD; i++) {
    const pair =
      i < pathologicalPairs.length
        ? pathologicalPairs[i]!
        : [
            ((Math.floor(rng() * 0x10000) << 16) |
              Math.floor(rng() * 0x10000)) >>> 0,
            ((Math.floor(rng() * 0x10000) << 16) |
              Math.floor(rng() * 0x10000)) >>> 0,
          ];
    const c = buildCase(rng, {
      kindOverride: 0x04,
      case4FieldsOverride: { v1c: pair[0]! >>> 0, v20: pair[1]! >>> 0 },
    });
    if (runOneCase("D", i, c)) okD++;
  }
  console.log(`  Match: ${okD}/${sizeD} = ${((okD / sizeD) * 100).toFixed(1)}%`);
  totalOk += okD;

  console.log(
    `\n=== TOTALE: ${totalOk}/${total} = ${((totalOk / total) * 100).toFixed(1)}% ===`,
  );
  if (failHolder.value !== null) {
    const f = failHolder.value;
    console.log(
      `  First fail (suite ${f.suite} tc=${f.tc}): ${f.diff.label}+0x${f.diff.offset.toString(16)} ` +
        `bin=0x${f.diff.bin.toString(16)} ts=0x${f.diff.ts.toString(16)} kind=0x${f.kind.toString(16)}`,
    );
  }

  disposeCpu(cpu);
  exit(totalOk === total ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  exit(1);
});
