#!/usr/bin/env node
/**
 * test-object-type-dispatch-194ba-parity.ts — differential FUN_000194BA vs
 * `objectTypeDispatch194BA`.
 *
 * `FUN_000194BA` (132 byte): "object type-dispatch by entry[0x1A]". Branch
 * su `obj[0x1A]` signed:
 *   - kind == 0: jsr FUN_1960E(obj) ; jsr FUN_1953E(obj)
 *   - kind == 1: jsr FUN_1973C(obj) ; jsr FUN_1953E(obj)
 *   - kind == 2: dispatch su obj[0x25] → write long a obj+0x1C
 *       0x07 → 0x21F8A,  0x08 → 0x21A62,  otherwise → 0x21EFE
 *   - everything else (negative e >= 3): no-op.
 *
 * **Strategia parity**:
 *   - Tutte e 3 le JSR (`FUN_0001960E`, `FUN_0001973C`, `FUN_0001953E`) sono
 *     **stubbed with RTS** (0x4E75): the only observable side-effect on the
 *     binary side effect left is the write to `obj+0x1C` (case 2 only).
 *   - TS: `subs.{fun_1960e, fun_1973c, fun_1953e} = no-op` → matching of the
 *     stub.
 *   - Compare workRam @ obj+0..0x2F (48 byte) — covers all the offset
 *     read/written by the dispatcher.
 *
 * **Suite** (500 totali):
 *   - A: kind ∈ [-2, -1, 0, 1, 2, 3, 4, 0x7F] random — covers all i branch.
 *   - B: forced kind == 2, sub-type in {7, 8, default random} — covers the 3
 *     branches of case 2.
 *   - C: kind random byte, sub-type random byte, struct random — fuzz puro.
 *   - D: edge cases (kind = 0x80/0xFF/0x7F/0x00/0x01/0x02; sub-type 0x00/
 *     0x07/0x08/0x09/0xFF).
 *
 * Uso: npx tsx packages/cli/src/test-object-type-dispatch-194ba-parity.ts [N]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import {
  state as stateNs,
  objectTypeDispatch194BA as dispNs,
} from "@marble-love/engine";
import {
  createCpu,
  callFunction,
  pokeMem,
  peekMem,
  disposeCpu,
} from "./binary-oracle-lib.js";
import type { CpuSession } from "./binary-oracle-lib.js";

const FUN_194BA = 0x000194ba;
const FUN_1960E = 0x0001960e;
const FUN_1973C = 0x0001973c;
const FUN_1953E = 0x0001953e;

const OBJ_BASE = 0x00401d00;
/** Compare range: covers KIND_OFFSET=0x1A, FN_PTR_OFFSET=0x1C..0x1F,
 *  SUBTYPE_OFFSET=0x25 and surrounding padding to catch unexpected writes. */
const COMPARE_SIZE = 0x30;

/** Patch all callees with RTS (0x4E75). */
function patchSubs(cpu: CpuSession): void {
  for (const addr of [FUN_1960E, FUN_1973C, FUN_1953E]) {
    pokeMem(cpu, addr + 0, 1, 0x4e);
    pokeMem(cpu, addr + 1, 1, 0x75);
  }
}

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) >>> 0;
    return ((s >>> 16) & 0xffff) / 0x10000;
  };
}

function setupObj(
  state: ReturnType<typeof stateNs.emptyGameState>,
  cpu: CpuSession,
  bytes: number[],
): void {
  for (let i = 0; i < COMPARE_SIZE; i++) {
    const v = bytes[i] ?? 0;
    pokeMem(cpu, OBJ_BASE + i, 1, v);
    state.workRam[OBJ_BASE - 0x400000 + i] = v;
  }
}

function compareObj(
  state: ReturnType<typeof stateNs.emptyGameState>,
  cpu: CpuSession,
): { offset: number; bin: number; ts: number } | null {
  for (let i = 0; i < COMPARE_SIZE; i++) {
    const b = peekMem(cpu, OBJ_BASE + i, 1);
    const t = state.workRam[OBJ_BASE - 0x400000 + i] ?? 0;
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

  const subs: dispNs.ObjectTypeDispatch194BASubs = {
    fun_1960e: () => {
      // matching RTS (no-op)
    },
    fun_1973c: () => {
      // matching RTS (no-op)
    },
    fun_1953e: () => {
      // matching RTS (no-op)
    },
  };

  let totalOk = 0;
  interface FailRecord {
    suite: string;
    tc: number;
    offset: number;
    bin: number;
    ts: number;
    obj: number[];
  }
  const failHolder: { value: FailRecord | null } = { value: null };

  function runOneCase(suite: string, tc: number, objBytes: number[]): boolean {
    cpu.system.setRegister("sp", 0x401f00);
    setupObj(stateInst, cpu, objBytes);
    callFunction(cpu, FUN_194BA, [OBJ_BASE]);
    dispNs.objectTypeDispatch194BA(stateInst, OBJ_BASE, subs);
    const fail = compareObj(stateInst, cpu);
    if (fail === null) return true;
    if (failHolder.value === null) {
      failHolder.value = {
        suite,
        tc,
        offset: fail.offset,
        bin: fail.bin,
        ts: fail.ts,
        obj: objBytes.slice(),
      };
    }
    return false;
  }

  const rng = makeRng(0x194ba);
  const rb = (): number => Math.floor(rng() * 256) & 0xff;

  // Suite A: kind in a sample of 8 values, random struct.
  console.log(
    `\n=== objectTypeDispatch194BA (FUN_194BA) — Suite A: kind sampled — ${perSuite} cases ===`,
  );
  let okA = 0;
  const kindSamples = [0xfe, 0xff, 0x00, 0x01, 0x02, 0x03, 0x04, 0x7f];
  for (let i = 0; i < perSuite; i++) {
    const objBytes = new Array(COMPARE_SIZE).fill(0).map(() => rb());
    objBytes[0x1a] = kindSamples[i % kindSamples.length]!;
    if (runOneCase("A", i, objBytes)) okA++;
  }
  console.log(`  Match: ${okA}/${perSuite} = ${((okA / perSuite) * 100).toFixed(1)}%`);
  totalOk += okA;

  // ─── Suite B: forced kind == 2, sub-type in {7, 8, default} ────────
  console.log(
    `\n=== Suite B: kind=2 sub-type 7/8/default — ${perSuite} cases ===`,
  );
  let okB = 0;
  const subSamples = [0x07, 0x08, 0x00, 0x09, 0x0a, 0xff, 0x42];
  for (let i = 0; i < perSuite; i++) {
    const objBytes = new Array(COMPARE_SIZE).fill(0).map(() => rb());
    objBytes[0x1a] = 0x02;
    objBytes[0x25] = subSamples[i % subSamples.length]!;
    if (runOneCase("B", i, objBytes)) okB++;
  }
  console.log(`  Match: ${okB}/${perSuite} = ${((okB / perSuite) * 100).toFixed(1)}%`);
  totalOk += okB;

  // ─── Suite C: full random fuzz ─────────────────────────────────────
  console.log(`\n=== Suite C: full random — ${perSuite} cases ===`);
  let okC = 0;
  for (let i = 0; i < perSuite; i++) {
    const objBytes = new Array(COMPARE_SIZE).fill(0).map(() => rb());
    if (runOneCase("C", i, objBytes)) okC++;
  }
  console.log(`  Match: ${okC}/${perSuite} = ${((okC / perSuite) * 100).toFixed(1)}%`);
  totalOk += okC;

  // ─── Suite D: edge cases (kind 0x80/0x7F, sub 0x00/0x07/0x08/0x09/0xFF)
  const sizeD = perSuite + remainder;
  console.log(
    `\n=== Suite D: edge cases (kind/sub-type extremes) — ${sizeD} cases ===`,
  );
  let okD = 0;
  const edgeKinds = [0x00, 0x01, 0x02, 0x03, 0x7f, 0x80, 0xff, 0xfe];
  const edgeSubs = [0x00, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x7f, 0x80, 0xff];
  for (let i = 0; i < sizeD; i++) {
    const objBytes = new Array(COMPARE_SIZE).fill(0).map(() => rb());
    objBytes[0x1a] = edgeKinds[Math.floor(rng() * edgeKinds.length)]!;
    objBytes[0x25] = edgeSubs[Math.floor(rng() * edgeSubs.length)]!;
    if (runOneCase("D", i, objBytes)) okD++;
  }
  console.log(`  Match: ${okD}/${sizeD} = ${((okD / sizeD) * 100).toFixed(1)}%`);
  totalOk += okD;

  console.log(
    `\n=== TOTALE: ${totalOk}/${total} = ${((totalOk / total) * 100).toFixed(1)}% ===`,
  );
  if (failHolder.value !== null) {
    const f = failHolder.value;
    console.log(
      `  First fail (suite ${f.suite} tc=${f.tc}): @ obj+0x${f.offset.toString(16)} ` +
      `bin=0x${f.bin.toString(16)} ts=0x${f.ts.toString(16)}`,
    );
    console.log(`    obj[0x1A]=0x${f.obj[0x1a]!.toString(16)} obj[0x25]=0x${f.obj[0x25]!.toString(16)}`);
    console.log(`    obj[0x1C..0x1F]=${f.obj.slice(0x1c, 0x20).map(b => b.toString(16).padStart(2, "0")).join(" ")}`);
  }

  disposeCpu(cpu);
  exit(totalOk === total ? 0 : 1);
}

main().catch(e => {
  console.error(e);
  exit(1);
});
