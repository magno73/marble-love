#!/usr/bin/env node
/**
 * test-sprite-bracket-lerp-1c676-parity.ts — differential FUN_0001C676 vs
 * `spriteBracketLerp1C676`.
 *
 * FUN_0001C676 (1092 byte): "sprite bracket-lerp". Legge 4 struct globali
 * @ 0x401C28/30/38/40 (8 byte ciascuna), 2 muls factor @ 0x40069E/0x4006A0,
 * e il base-word @ 0x400694. Scrive:
 *   - byte flags @ 0x40066A
 *   - 4 byte dircode @ 0x40066C/6E/70/72
 *   - 8 word output @ 0x400674..0x400683
 *
 * No external JSR to stub; this is a pure function.
 *
 * **Suite**:
 *   - A: random all (struct + globals).
 *   - B: force equality skip bracket-1 (key==hi, tiebreak=eq).
 *   - C: force dir=1 bracket-1 (key<hi), lerp with factorA stress.
 *   - D: edge cases (0x0000/0x7FFF/0x8000/0xFFFF in the fields critical).
 *
 * Uso: npx tsx packages/cli/src/test-sprite-bracket-lerp-1c676-parity.ts [N]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import {
  state as stateNs,
  spriteBracketLerp1C676 as bracketNs,
} from "@marble-love/engine";
import {
  createCpu,
  callFunction,
  pokeMem,
  peekMem,
  disposeCpu,
} from "./binary-oracle-lib.js";
import type { CpuSession } from "./binary-oracle-lib.js";

const FUN_1C676 = 0x0001c676;

// ─── Memory layout ────────────────────────────────────────────────────────────

// Inputs: structs + globals in one contiguous setup range.
// 4 structs: 0x401C28..0x401C47 (32 byte)
const STRUCT_BASE = 0x00401c28;
const STRUCT_SIZE = 0x20; // 4 × 8 byte

// Globals: 0x40066A..0x400682 + 0x400694..0x4006A0
// We cover the full range 0x40066A..0x4006A1 (56 byte)
const GLOB_BASE = 0x0040066a;
const GLOB_SIZE = 0x38; // 0x40066A..0x4006A1

// Compare range: all writes:
//   - 0x40066A (flags) + 0x40066C..0x400672 (4 dircodes) + 0x400674..0x400683 (8 words)
// Full range: 0x40066A..0x400683 (26 byte)
const COMPARE_BASE = 0x0040066a;
const COMPARE_SIZE = 0x1a; // 26 byte (0x40066A..0x400683)

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) >>> 0;
    return ((s >>> 16) & 0xffff) / 0x10000;
  };
}

function setupStructs(
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
  for (let i = 0; i < GLOB_SIZE; i++) {
    const v = bytes[i] ?? 0;
    pokeMem(cpu, GLOB_BASE + i, 1, v);
    state.workRam[GLOB_BASE - 0x400000 + i] = v;
  }
}

function compareOutputs(
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

// ─── Main ─────────────────────────────────────────────────────────────────────

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
  // No JSR stubs needed — FUN_0001C676 has no external calls.

  let totalOk = 0;
  interface FailRecord {
    suite: string;
    tc: number;
    offset: number;
    bin: number;
    ts: number;
    structBytes: number[];
    globBytes: number[];
  }
  const failHolder: { value: FailRecord | null } = { value: null };

  function runOneCase(
    suite: string,
    tc: number,
    structBytes: number[],
    globBytes: number[],
  ): boolean {
    cpu.system.setRegister("sp", 0x401f00);
    setupStructs(stateInst, cpu, structBytes);
    setupGlobals(stateInst, cpu, globBytes);

    callFunction(cpu, FUN_1C676, []);
    bracketNs.spriteBracketLerp1C676(stateInst);

    const fail = compareOutputs(stateInst, cpu);
    if (fail === null) return true;
    if (failHolder.value === null) {
      failHolder.value = {
        suite, tc,
        offset: fail.offset,
        bin: fail.bin,
        ts: fail.ts,
        structBytes: structBytes.slice(),
        globBytes: globBytes.slice(),
      };
    }
    return false;
  }

  const rng = makeRng(0x1c676);
  const rb = (): number => Math.floor(rng() * 256) & 0xff;
  const wordBytes = (w: number): [number, number] => [(w >>> 8) & 0xff, w & 0xff];

  // ─── Suite A: random ─────────────────────────────────────────────────────
  console.log(
    `\n=== spriteBracketLerp1C676 (FUN_0001C676) — Suite A: random — ${perSuite} cases ===`,
  );
  let okA = 0;
  for (let i = 0; i < perSuite; i++) {
    const structBytes = new Array(STRUCT_SIZE).fill(0).map(() => rb());
    const globBytes   = new Array(GLOB_SIZE).fill(0).map(() => rb());
    if (runOneCase("A", i, structBytes, globBytes)) okA++;
  }
  console.log(`  Match: ${okA}/${perSuite} = ${((okA / perSuite) * 100).toFixed(1)}%`);
  totalOk += okA;

  // ─── Suite B: forced equality-skip bracket-1 ─────────────────────────────
  // s1[4]==s1[6] AND s4[2]==s4[0] → bracket-1 skipped
  console.log(
    `\n=== Suite B: forced equality-skip bracket-1 — ${perSuite} cases ===`,
  );
  let okB = 0;
  for (let i = 0; i < perSuite; i++) {
    const structBytes = new Array(STRUCT_SIZE).fill(0).map(() => rb());
    const globBytes   = new Array(GLOB_SIZE).fill(0).map(() => rb());
    // s1 @ 0x00..0x07 in structBytes: +4=idx4, +6=idx6
    structBytes[6] = structBytes[4]!; structBytes[7] = structBytes[5]!; // s1[4]=s1[6]
    // s4 @ 0x18..0x1F in structBytes: +2=idx2, +0=idx0
    structBytes[0x18 + 2] = structBytes[0x18]!; structBytes[0x18 + 3] = structBytes[0x18 + 1]!; // s4[2]=s4[0]
    if (runOneCase("B", i, structBytes, globBytes)) okB++;
  }
  console.log(`  Match: ${okB}/${perSuite} = ${((okB / perSuite) * 100).toFixed(1)}%`);
  totalOk += okB;

  // ─── Suite C: forced dir=1 bracket-1 with lerp stress ────────────────────
  // s1[4] << s1[6] (ensure s1[4] < s1[6] signed), random factorA
  console.log(
    `\n=== Suite C: forced dir=1 bracket-1 + lerp stress — ${perSuite} cases ===`,
  );
  let okC = 0;
  for (let i = 0; i < perSuite; i++) {
    const structBytes = new Array(STRUCT_SIZE).fill(0).map(() => rb());
    const globBytes   = new Array(GLOB_SIZE).fill(0).map(() => rb());
    // s1[4] = 0x0010, s1[6] = 0x1000 → s1[4] < s1[6] (both positive)
    structBytes[4] = 0x00; structBytes[5] = 0x10; // s1[4] = 16
    structBytes[6] = 0x10; structBytes[7] = 0x00; // s1[6] = 0x1000 = 4096
    // factorA @ GLOB_BASE offset: 0x4006A0 - 0x40066A = 0x36
    const fa = [rb(), rb()];
    globBytes[0x36] = fa[0]!; globBytes[0x37] = fa[1]!;
    if (runOneCase("C", i, structBytes, globBytes)) okC++;
  }
  console.log(`  Match: ${okC}/${perSuite} = ${((okC / perSuite) * 100).toFixed(1)}%`);
  totalOk += okC;

  // ─── Suite D: edge words in struct fields ────────────────────────────────
  const sizeD = perSuite + remainder;
  console.log(
    `\n=== Suite D: edge cases (0x0000/0x7FFF/0x8000/0xFFFF) — ${sizeD} cases ===`,
  );
  let okD = 0;
  const edgeWords = [0x0000, 0x0001, 0x0007, 0x7fff, 0x8000, 0xfff8, 0xffff];
  for (let i = 0; i < sizeD; i++) {
    const structBytes = new Array(STRUCT_SIZE).fill(0).map(() => rb());
    const globBytes   = new Array(GLOB_SIZE).fill(0).map(() => rb());
    // Force all struct word fields to edge values
    for (let si = 0; si < 4; si++) {
      const base = si * 8;
      for (let wi = 0; wi < 4; wi++) {
        const w = edgeWords[Math.floor(rng() * edgeWords.length)]!;
        const [hi, lo] = wordBytes(w);
        structBytes[base + wi * 2]     = hi;
        structBytes[base + wi * 2 + 1] = lo;
      }
    }
    // Force factorA and factorB to edge words too
    const faW = edgeWords[Math.floor(rng() * edgeWords.length)]!;
    const fbW = edgeWords[Math.floor(rng() * edgeWords.length)]!;
    const [faH, faL] = wordBytes(faW);
    const [fbH, fbL] = wordBytes(fbW);
    globBytes[0x36] = faH; globBytes[0x37] = faL; // factorA @ 0x4006A0-0x40066A=0x36
    globBytes[0x34] = fbH; globBytes[0x35] = fbL; // factorB @ 0x40069E-0x40066A=0x34
    if (runOneCase("D", i, structBytes, globBytes)) okD++;
  }
  console.log(`  Match: ${okD}/${sizeD} = ${((okD / sizeD) * 100).toFixed(1)}%`);
  totalOk += okD;

  console.log(
    `\n=== TOTALE: ${totalOk}/${total} = ${((totalOk / total) * 100).toFixed(1)}% ===`,
  );
  if (failHolder.value !== null) {
    const f = failHolder.value;
    console.log(
      `  First fail (suite ${f.suite} tc=${f.tc}): @ 0x${(0x40066a + f.offset).toString(16)} ` +
      `bin=0x${f.bin.toString(16).padStart(2, "0")} ts=0x${f.ts.toString(16).padStart(2, "0")}`,
    );
    console.log(
      `  structs: ${f.structBytes.map(b => b.toString(16).padStart(2, "0")).join(" ")}`,
    );
    const gChunk = f.globBytes.map(b => b.toString(16).padStart(2, "0")).join(" ");
    console.log(`  globals: ${gChunk}`);
  }

  disposeCpu(cpu);
  exit(totalOk === total ? 0 : 1);
}

main().catch(e => {
  console.error(e);
  exit(1);
});
