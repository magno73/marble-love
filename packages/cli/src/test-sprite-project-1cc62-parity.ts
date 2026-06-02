#!/usr/bin/env node
/**
 * test-sprite-project-1cc62-parity.ts — differential FUN_0001CC62 vs
 * `spriteProject1CC62`.
 *
 *
 * **Parity strategy**:
 *     deterministic.
 *   - Compare:
 *
 * **Suite**:
 *   - A: random struct + random globals (mix bge-flag) + argByte random.
 *   - D: edge cases: 0x0000 / 0xFFFF / 0x7FFF / 0x8000 / sign-bit boundary.
 *
 * Uso: npx tsx packages/cli/src/test-sprite-project-1cc62-parity.ts [N]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import {
  state as stateNs,
  spriteProject1CC62 as projectNs,
} from "@marble-love/engine";
import {
  createCpu,
  callFunction,
  pokeMem,
  peekMem,
  disposeCpu,
} from "./binary-oracle-lib.js";
import type { CpuSession } from "./binary-oracle-lib.js";

const FUN_1CC62 = 0x0001cc62;
const FUN_1CABA = 0x0001caba;

/**
 * Patch JSR-stubs: FUN_0001CABA → RTS (0x4E75) per neutralize il heavy
 */
function patchSubs(cpu: CpuSession): void {
  pokeMem(cpu, FUN_1CABA + 0, 1, 0x4e);
  pokeMem(cpu, FUN_1CABA + 1, 1, 0x75);
}

const STRUCT_BASE = 0x00401c28;
const STRUCT_SIZE = 0x1c; // 0x401C28..0x401C43

const GLOBALS_BASE = 0x00400690; // include 0x69E/0x6A0/0x6A2/0x6A4/0x6A6
const GLOBALS_SIZE = 0x18; // 0x690..0x6A7 (24 byte)

// Compare range: only writes produced by CC62 + return value.
// 0x6A4..0x6A7 (= 4 byte) and il return.
const COMPARE_BASE = 0x004006a4;
const COMPARE_SIZE = 4;

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
    state.workRam[STRUCT_BASE - 0x400000 + i] = v;
  }
}

function setupGlobals(
  state: ReturnType<typeof stateNs.emptyGameState>,
  cpu: CpuSession,
  bytes: number[],
): void {
  for (let i = 0; i < GLOBALS_SIZE; i++) {
    const v = bytes[i] ?? 0;
    pokeMem(cpu, GLOBALS_BASE + i, 1, v);
    state.workRam[GLOBALS_BASE - 0x400000 + i] = v;
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

  let totalOk = 0;
  interface FailRecord {
    suite: string;
    tc: number;
    kind: "mem" | "ret";
    offset: number;
    bin: number;
    ts: number;
    arg: number;
    structBytes: number[];
    globBytes: number[];
  }
  const failHolder: { value: FailRecord | null } = { value: null };

  function runOneCase(
    suite: string,
    tc: number,
    argLong: number,
    structBytes: number[],
    globBytes: number[],
  ): boolean {
    cpu.system.setRegister("sp", 0x401f00);
    setupStruct(stateInst, cpu, structBytes);
    setupGlobals(stateInst, cpu, globBytes);

    const binResult = callFunction(cpu, FUN_1CC62, [argLong >>> 0]);
    const tsResult = projectNs.spriteProject1CC62(stateInst, argLong, {
      fun_1CABA: () => {
      },
    });

    const memFail = compareGlobals(stateInst, cpu);
    if (memFail !== null) {
      if (failHolder.value === null) {
        failHolder.value = {
          suite,
          tc,
          kind: "mem",
          offset: memFail.offset,
          bin: memFail.bin,
          ts: memFail.ts,
          arg: argLong,
          structBytes: structBytes.slice(),
          globBytes: globBytes.slice(),
        };
      }
      return false;
    }

    const binRet = binResult.d0 | 0; // i32
    const tsRet = tsResult | 0;
    if (binRet !== tsRet) {
      if (failHolder.value === null) {
        failHolder.value = {
          suite,
          tc,
          kind: "ret",
          offset: -1,
          bin: binRet >>> 0,
          ts: tsRet >>> 0,
          arg: argLong,
          structBytes: structBytes.slice(),
          globBytes: globBytes.slice(),
        };
      }
      return false;
    }

    return true;
  }

  const rng = makeRng(0x1cc62);
  const rb = (): number => Math.floor(rng() * 256) & 0xff;

  // ─── Suite A: random ─────────────────────────────────────────────────
  console.log(
    `\n=== spriteProject1CC62 (FUN_0001CC62) — Suite A: random — ${perSuite} cases ===`,
  );
  let okA = 0;
  for (let i = 0; i < perSuite; i++) {
    const argLong = Math.floor(rng() * 0x10000) & 0xffff;
    const structBytes = new Array(STRUCT_SIZE).fill(0).map(() => rb());
    const globBytes = new Array(GLOBALS_SIZE).fill(0).map(() => rb());
    if (runOneCase("A", i, argLong, structBytes, globBytes)) okA++;
  }
  console.log(`  Match: ${okA}/${perSuite} = ${((okA / perSuite) * 100).toFixed(1)}%`);
  totalOk += okA;

  // ─── Suite B: forced bge-flag != 0 (if-branch) ───────────────────────
  console.log(
    `\n=== Suite B: forced if-branch (bge-flag != 0) — ${perSuite} cases ===`,
  );
  let okB = 0;
  for (let i = 0; i < perSuite; i++) {
    const argLong = rb(); // byte → low byte
    const structBytes = new Array(STRUCT_SIZE).fill(0).map(() => rb());
    const globBytes = new Array(GLOBALS_SIZE).fill(0).map(() => rb());
    // bge-flag = *0x4006A2 → offset 0x12..0x13 in globBytes (relative to 0x690).
    // 0x6A2 - 0x690 = 0x12.
    globBytes[0x12] = 0; globBytes[0x13] = 1; // word 0x0001 → != 0
    if (runOneCase("B", i, argLong, structBytes, globBytes)) okB++;
  }
  console.log(`  Match: ${okB}/${perSuite} = ${((okB / perSuite) * 100).toFixed(1)}%`);
  totalOk += okB;

  // ─── Suite C: forced bge-flag == 0 (else-branch) ─────────────────────
  console.log(
    `\n=== Suite C: forced else-branch (bge-flag == 0) — ${perSuite} cases ===`,
  );
  let okC = 0;
  for (let i = 0; i < perSuite; i++) {
    const argLong = rb();
    const structBytes = new Array(STRUCT_SIZE).fill(0).map(() => rb());
    const globBytes = new Array(GLOBALS_SIZE).fill(0).map(() => rb());
    globBytes[0x12] = 0; globBytes[0x13] = 0; // word 0x0000 → else-branch
    if (runOneCase("C", i, argLong, structBytes, globBytes)) okC++;
  }
  console.log(`  Match: ${okC}/${perSuite} = ${((okC / perSuite) * 100).toFixed(1)}%`);
  totalOk += okC;

  // ─── Suite D: edge cases ─────────────────────────────────────────────
  const sizeD = perSuite + remainder;
  console.log(
    `\n=== Suite D: edge cases (0x0000/0x7FFF/0x8000/0xFFFF) — ${sizeD} cases ===`,
  );
  let okD = 0;
  const edgeWords = [0x0000, 0x0001, 0x0007, 0x7fff, 0x8000, 0xfff8, 0xffff];
  for (let i = 0; i < sizeD; i++) {
    const argLong = rb();
    const structBytes = new Array(STRUCT_SIZE).fill(0).map(() => rb());
    const globBytes = new Array(GLOBALS_SIZE).fill(0).map(() => rb());
    const wcx0 = edgeWords[Math.floor(rng() * edgeWords.length)]!;
    const wcx1 = edgeWords[Math.floor(rng() * edgeWords.length)]!;
    const wcy0 = edgeWords[Math.floor(rng() * edgeWords.length)]!;
    const wcz = edgeWords[Math.floor(rng() * edgeWords.length)]!;
    structBytes[0x04] = (wcx0 >>> 8) & 0xff; structBytes[0x05] = wcx0 & 0xff;
    structBytes[0x0e] = (wcx1 >>> 8) & 0xff; structBytes[0x0f] = wcx1 & 0xff;
    structBytes[0x10] = (wcy0 >>> 8) & 0xff; structBytes[0x11] = wcy0 & 0xff;
    structBytes[0x1a] = (wcz >>> 8) & 0xff; structBytes[0x1b] = wcz & 0xff;
    // a edge per stress su muls.
    const wfx = edgeWords[Math.floor(rng() * edgeWords.length)]!;
    const wfy = edgeWords[Math.floor(rng() * edgeWords.length)]!;
    globBytes[0x0e] = (wfx >>> 8) & 0xff; globBytes[0x0f] = wfx & 0xff;
    globBytes[0x10] = (wfy >>> 8) & 0xff; globBytes[0x11] = wfy & 0xff;
    if (runOneCase("D", i, argLong, structBytes, globBytes)) okD++;
  }
  console.log(`  Match: ${okD}/${sizeD} = ${((okD / sizeD) * 100).toFixed(1)}%`);
  totalOk += okD;

  console.log(
    `\n=== TOTALE: ${totalOk}/${total} = ${((totalOk / total) * 100).toFixed(1)}% ===`,
  );
  if (failHolder.value !== null) {
    const f = failHolder.value;
    if (f.kind === "mem") {
      console.log(
        `  First fail (suite ${f.suite} tc=${f.tc}) MEM: @ 0x${(0x6a4 + f.offset).toString(16)} ` +
        `bin=0x${f.bin.toString(16)} ts=0x${f.ts.toString(16)}`,
      );
    } else {
      console.log(
        `  First fail (suite ${f.suite} tc=${f.tc}) RET: ` +
        `bin=0x${(f.bin >>> 0).toString(16).padStart(8, "0")} ` +
        `ts=0x${(f.ts >>> 0).toString(16).padStart(8, "0")}`,
      );
    }
    console.log(`    arg=0x${f.arg.toString(16)}`);
    console.log(`    struct +0x04=${f.structBytes[0x04]?.toString(16)}${f.structBytes[0x05]?.toString(16)} ` +
      `+0x0E=${f.structBytes[0x0e]?.toString(16)}${f.structBytes[0x0f]?.toString(16)} ` +
      `+0x10=${f.structBytes[0x10]?.toString(16)}${f.structBytes[0x11]?.toString(16)} ` +
      `+0x1A=${f.structBytes[0x1a]?.toString(16)}${f.structBytes[0x1b]?.toString(16)}`);
    console.log(`    glob 0x69E=${f.globBytes[0x0e]?.toString(16)}${f.globBytes[0x0f]?.toString(16)} ` +
      `0x6A0=${f.globBytes[0x10]?.toString(16)}${f.globBytes[0x11]?.toString(16)} ` +
      `0x6A2=${f.globBytes[0x12]?.toString(16)}${f.globBytes[0x13]?.toString(16)}`);
  }

  disposeCpu(cpu);
  exit(totalOk === total ? 0 : 1);
}

main().catch(e => {
  console.error(e);
  exit(1);
});
