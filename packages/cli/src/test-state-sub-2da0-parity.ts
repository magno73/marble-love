#!/usr/bin/env node
/**
 * test-state-sub-2da0-parity.ts — differential FUN_2DA0 vs stateSub2DA0.
 *
 * corresponding word in the alpha tilemap (rotation/shift/stride formula).
 *
 *   - Args:
 *     - long arg1 @ SP+0x10  (struct: col@+0, tickOff@+1, stringPtr_long@+2)
 *   - Reads:
 *     - byte @ A0+0 (col, signed)
 *     - byte @ A0+1 (tickOff, signed)
 *     - long @ A0+2 (stringPtr)
 *     - byte @ stringPtr + arg2_byte
 *     - word @ 0x401F42 (rotation)
 *     - byte @ 0x72a5 + rotation*2 (ROM shift table)
 *   - Writes:
 *
 * We compare:
 *   - D0 byte returned (0 vs 4)
 *   - alpha RAM @ 0xa03000..0xa03FFF (4 KB)
 *
 * Suites tested:
 *   - A: rotation=0, struct random + string random, alphaRam pre-fill 0
 *   - B: rotation in [1..7], struct random + string random
 *   - C: force string_byte=0 (terminator path) to verify return 0
 *   - D: tickOff/col negative (sext stress), arg2_byte high values
 *
 * Usage: npx tsx packages/cli/src/test-state-sub-2da0-parity.ts [N]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import {
  state as stateNs,
  bus as busNs,
  stateSub2DA0 as sub2da0Ns,
} from "@marble-love/engine";
import type { RomImage } from "@marble-love/engine";
import {
  createCpu,
  callFunction,
  pokeMem,
  peekMem,
  disposeCpu,
} from "./binary-oracle-lib.js";
import type { CpuSession } from "./binary-oracle-lib.js";

const FUN_2DA0 = 0x00002da0;
const ALPHA_BASE = 0xa03000;
const ALPHA_SIZE = 0x1000;
const STRUCT_ADDR = 0x00401d00; // arbitrary work-RAM offset for struct
const STRING_ADDR = 0x00401d40; // arbitrary work-RAM offset for string

const STRUCT_BASE_BIN = 0x00401f00;
const STRUCT_SIZE_WR = 0x80;

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) >>> 0;
    return ((s >>> 16) & 0xffff) / 0x10000;
  };
}

interface TestCase {
  rotation: number;
  col: number;
  tickOff: number;
  argByte: number;
  stringBytes: number[];
}

function setupCase(
  state: ReturnType<typeof stateNs.emptyGameState>,
  cpu: CpuSession,
  tc: TestCase,
): void {
  // Reset alphaRam in both (pre-fill non-zero to detect clear)
  for (let i = 0; i < ALPHA_SIZE; i++) {
    pokeMem(cpu, ALPHA_BASE + i, 1, 0xcc);
    state.alphaRam[i] = 0xcc;
  }

  for (let i = 0; i < STRUCT_SIZE_WR; i++) {
    pokeMem(cpu, STRUCT_BASE_BIN + i, 1, 0);
    state.workRam[(STRUCT_BASE_BIN - 0x400000) + i] = 0;
  }

  // Rotation @ 0x401F42 (word, big-endian)
  pokeMem(cpu, 0x00401f42, 2, tc.rotation & 0xffff);
  state.workRam[0x1f42] = (tc.rotation >>> 8) & 0xff;
  state.workRam[0x1f43] = tc.rotation & 0xff;

  // Struct @ STRUCT_ADDR: col@+0, tickOff@+1, stringPtr@+2
  pokeMem(cpu, STRUCT_ADDR + 0, 1, tc.col & 0xff);
  pokeMem(cpu, STRUCT_ADDR + 1, 1, tc.tickOff & 0xff);
  pokeMem(cpu, STRUCT_ADDR + 2, 4, STRING_ADDR);
  state.workRam[STRUCT_ADDR - 0x400000 + 0] = tc.col & 0xff;
  state.workRam[STRUCT_ADDR - 0x400000 + 1] = tc.tickOff & 0xff;
  state.workRam[STRUCT_ADDR - 0x400000 + 2] = (STRING_ADDR >>> 24) & 0xff;
  state.workRam[STRUCT_ADDR - 0x400000 + 3] = (STRING_ADDR >>> 16) & 0xff;
  state.workRam[STRUCT_ADDR - 0x400000 + 4] = (STRING_ADDR >>> 8) & 0xff;
  state.workRam[STRUCT_ADDR - 0x400000 + 5] = STRING_ADDR & 0xff;

  // String bytes
  for (let i = 0; i < tc.stringBytes.length; i++) {
    pokeMem(cpu, STRING_ADDR + i, 1, tc.stringBytes[i] ?? 0);
    state.workRam[STRING_ADDR - 0x400000 + i] = tc.stringBytes[i] ?? 0;
  }
}

interface CompareResult {
  alphaDiff: { offset: number; bin: number; ts: number } | null;
  workDiff: { offset: number; bin: number; ts: number } | null;
  d0Bin: number;
  d0Ts: number;
}

function compareAfter(
  state: ReturnType<typeof stateNs.emptyGameState>,
  cpu: CpuSession,
  d0Bin: number,
  d0Ts: number,
): CompareResult {
  // Alpha RAM compare (full 4 KB)
  let alphaDiff: { offset: number; bin: number; ts: number } | null = null;
  for (let i = 0; i < ALPHA_SIZE; i++) {
    const b = peekMem(cpu, ALPHA_BASE + i, 1);
    const t = state.alphaRam[i] ?? 0;
    if (b !== t) {
      alphaDiff = { offset: i, bin: b, ts: t };
      break;
    }
  }

  // Work RAM compare @ struct base (safety: there should be no mods)
  let workDiff: { offset: number; bin: number; ts: number } | null = null;
  for (let i = 0; i < STRUCT_SIZE_WR; i++) {
    const b = peekMem(cpu, STRUCT_BASE_BIN + i, 1);
    const t = state.workRam[(STRUCT_BASE_BIN - 0x400000) + i] ?? 0;
    if (b !== t) {
      workDiff = { offset: i, bin: b, ts: t };
      break;
    }
  }

  return { alphaDiff, workDiff, d0Bin: d0Bin & 0xff, d0Ts: d0Ts & 0xff };
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

  const tsRom: RomImage = busNs.emptyRomImage();
  tsRom.program.set(rom.subarray(0, tsRom.program.length));

  let totalOk = 0;
  interface FailRecord {
    suite: string;
    tc: number;
    kind: string;
    detail: string;
  }
  const failHolder: { value: FailRecord | null } = { value: null };

  function runOneCase(suite: string, tcIdx: number, tc: TestCase): boolean {
    cpu.system.setRegister("sp", 0x401f00);
    setupCase(stateInst, cpu, tc);

    const r = callFunction(cpu, FUN_2DA0, [STRUCT_ADDR, tc.argByte & 0xff]);
    const d0Bin = r.d0 & 0xff;

    const d0Ts = sub2da0Ns.stateSub2DA0(
      stateInst,
      tsRom,
      STRUCT_ADDR,
      tc.argByte & 0xff,
    );

    const cmp = compareAfter(stateInst, cpu, d0Bin, d0Ts);

    if (
      cmp.alphaDiff === null &&
      cmp.workDiff === null &&
      cmp.d0Bin === cmp.d0Ts
    ) {
      return true;
    }

    if (failHolder.value === null) {
      if (cmp.d0Bin !== cmp.d0Ts) {
        failHolder.value = {
          suite,
          tc: tcIdx,
          kind: "D0",
          detail: `bin=${cmp.d0Bin} ts=${cmp.d0Ts} (rot=${tc.rotation} col=${tc.col} tickOff=${tc.tickOff} arg2=${tc.argByte})`,
        };
      } else if (cmp.alphaDiff !== null) {
        failHolder.value = {
          suite,
          tc: tcIdx,
          kind: "alphaRam",
          detail: `@ alpha+0x${cmp.alphaDiff.offset.toString(16)} bin=0x${cmp.alphaDiff.bin.toString(16)} ts=0x${cmp.alphaDiff.ts.toString(16)} (rot=${tc.rotation} col=${tc.col} tickOff=${tc.tickOff} arg2=${tc.argByte})`,
        };
      } else if (cmp.workDiff !== null) {
        failHolder.value = {
          suite,
          tc: tcIdx,
          kind: "workRam",
          detail: `@ workRam+0x${cmp.workDiff.offset.toString(16)} bin=0x${cmp.workDiff.bin.toString(16)} ts=0x${cmp.workDiff.ts.toString(16)}`,
        };
      }
    }
    return false;
  }

  const rng = makeRng(0x2da0);
  const rb = (): number => Math.floor(rng() * 256) & 0xff;

  function makeRandomString(rngFn: () => number, lenIfNoTerm: number): number[] {
    const arr: number[] = [];
    for (let i = 0; i < lenIfNoTerm; i++) {
      arr.push(1 + Math.floor(rngFn() * 255));
    }
    return arr;
  }

  // ─── Suite A: rotation=0, randomized struct & string ────────────────
  console.log(
    `\n=== stateSub2DA0 (FUN_2DA0) — Suite A: rotation=0, random — ${perSuite} cases ===`,
  );
  let okA = 0;
  for (let i = 0; i < perSuite; i++) {
    const argByte = rb() & 0x1f;
    const tc: TestCase = {
      rotation: 0,
      col: rb(),
      tickOff: rb() & 0x3f, // tickOff << 6 must stay manageable
      argByte,
      stringBytes: [...makeRandomString(rng, argByte + 4), 0],
    };
    if (runOneCase("A", i, tc)) okA++;
  }
  console.log(`  Match: ${okA}/${perSuite} = ${((okA / perSuite) * 100).toFixed(1)}%`);
  totalOk += okA;

  // ─── Suite B: rotation in [1..3], stress shift table ─────────────────
  console.log(
    `\n=== Suite B: rotation in [1..3], random struct — ${perSuite} cases ===`,
  );
  let okB = 0;
  for (let i = 0; i < perSuite; i++) {
    const argByte = rb() & 0x1f;
    const tc: TestCase = {
      rotation: 1 + Math.floor(rng() * 3),
      col: rb() & 0x3f,
      tickOff: rb() & 0x3f,
      argByte,
      stringBytes: [...makeRandomString(rng, argByte + 4), 0],
    };
    if (runOneCase("B", i, tc)) okB++;
  }
  console.log(`  Match: ${okB}/${perSuite} = ${((okB / perSuite) * 100).toFixed(1)}%`);
  totalOk += okB;

  // ─── Suite C: forced string_byte = 0 (terminator path) ──────────────
  console.log(
    `\n=== Suite C: forced terminator (string_byte=0) — ${perSuite} cases ===`,
  );
  let okC = 0;
  for (let i = 0; i < perSuite; i++) {
    const argByte = rb() & 0x1f;
    const arr: number[] = [];
    for (let j = 0; j < argByte + 8; j++) {
      arr.push(j === argByte ? 0 : 1 + Math.floor(rng() * 255));
    }
    const tc: TestCase = {
      rotation: Math.floor(rng() * 4),
      col: rb(),
      tickOff: rb() & 0x3f,
      argByte,
      stringBytes: arr,
    };
    if (runOneCase("C", i, tc)) okC++;
  }
  console.log(`  Match: ${okC}/${perSuite} = ${((okC / perSuite) * 100).toFixed(1)}%`);
  totalOk += okC;

  // ─── Suite D: edge sext (col/tickOff negative) ──────────────────────
  const sizeD = perSuite + remainder;
  console.log(
    `\n=== Suite D: signed edge cases (col/tickOff/arg2) — ${sizeD} cases ===`,
  );
  let okD = 0;
  for (let i = 0; i < sizeD; i++) {
    const argByte = rb() & 0x3f;
    const tc: TestCase = {
      rotation: Math.floor(rng() * 4),
      col: 0x80 | (rb() & 0x7f), // negative (-128..-1)
      tickOff: 0x80 | (rb() & 0x3f), // partial negatives (-128..-65)
      argByte,
      stringBytes: [...makeRandomString(rng, argByte + 4), 0],
    };
    if (runOneCase("D", i, tc)) okD++;
  }
  console.log(`  Match: ${okD}/${sizeD} = ${((okD / sizeD) * 100).toFixed(1)}%`);
  totalOk += okD;

  console.log(
    `\n=== TOTAL: ${totalOk}/${total} = ${((totalOk / total) * 100).toFixed(1)}% ===`,
  );
  if (failHolder.value !== null) {
    console.log(
      `  First fail (suite ${failHolder.value.suite} tc=${failHolder.value.tc}, ${failHolder.value.kind}): ${failHolder.value.detail}`,
    );
  }

  disposeCpu(cpu);
  exit(totalOk === total ? 0 : 1);
}

main().catch(e => {
  console.error(e);
  exit(1);
});
