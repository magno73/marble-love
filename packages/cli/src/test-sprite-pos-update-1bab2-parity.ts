#!/usr/bin/env node
/**
 * test-sprite-pos-update-1bab2-parity.ts — differential FUN_0001BAB2 vs
 * `spritePosUpdate1BAB2`.
 *
 * FUN_0001BAB2 (86 bytes): "sprite position-update with redraw-on-tile-change".
 * 0x400690..0x400695, derives the 5 tile fields via FUN_0001BB50, and — if the
 *
 * **Parity strategy**:
 *   - JSR to FUN_0001BB50 (deriveSpriteFields) **left live**: small,
 *   - JSR to FUN_0001CABA (heavy renderer) **stubbed with RTS**: too
 *   - Compare workRam @ 0x400690..0x4006A3 (range written by BAB2 + derive).
 *
 * **Suites**:
 *   - A: random struct + random state → mix tile-change/no-change.
 *   - D: edge cases: sign-bit, 0xFFFF, 0x0000.
 *
 * Usage: npx tsx packages/cli/src/test-sprite-pos-update-1bab2-parity.ts [N]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import {
  state as stateNs,
  spritePosUpdate1BAB2 as posUpdateNs,
} from "@marble-love/engine";
import {
  createCpu,
  callFunction,
  pokeMem,
  peekMem,
  disposeCpu,
} from "./binary-oracle-lib.js";
import type { CpuSession } from "./binary-oracle-lib.js";

const FUN_1BAB2 = 0x0001bab2;
const FUN_1CABA = 0x0001caba;

/**
 * Patch JSR-stubs:
 *   - FUN_0001CABA → RTS (0x4E75) to neutralize the heavy renderer.
 */
function patchSubs(cpu: CpuSession): void {
  pokeMem(cpu, FUN_1CABA + 0, 1, 0x4e);
  pokeMem(cpu, FUN_1CABA + 1, 1, 0x75);
}

const ARG_BASE = 0x00401d00;
const ARG_SIZE = 0x18;
const COMPARE_BASE = 0x00400690; // x/y/z + tile fields
const COMPARE_SIZE = 0x14; // 0x400690..0x4006A3

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) >>> 0;
    return ((s >>> 16) & 0xffff) / 0x10000;
  };
}

function setupArg(
  state: ReturnType<typeof stateNs.emptyGameState>,
  cpu: CpuSession,
  bytes: number[],
): void {
  for (let i = 0; i < ARG_SIZE; i++) {
    const v = bytes[i] ?? 0;
    pokeMem(cpu, ARG_BASE + i, 1, v);
    state.workRam[ARG_BASE - 0x400000 + i] = v;
  }
}

function setupGlobals(
  state: ReturnType<typeof stateNs.emptyGameState>,
  cpu: CpuSession,
  bytes: number[],
): void {
  for (let i = 0; i < COMPARE_SIZE; i++) {
    const v = bytes[i] ?? 0;
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
    offset: number;
    bin: number;
    ts: number;
    arg: number[];
    glob: number[];
  }
  const failHolder: { value: FailRecord | null } = { value: null };

  function runOneCase(
    suite: string,
    tc: number,
    argBytes: number[],
    globBytes: number[],
  ): boolean {
    cpu.system.setRegister("sp", 0x401f00);
    setupArg(stateInst, cpu, argBytes);
    setupGlobals(stateInst, cpu, globBytes);
    callFunction(cpu, FUN_1BAB2, [ARG_BASE]);
    posUpdateNs.spritePosUpdate1BAB2(stateInst, ARG_BASE, {
      fun_1CABA: () => {
      },
    });
    const fail = compareGlobals(stateInst, cpu);
    if (fail === null) return true;
    if (failHolder.value === null) {
      failHolder.value = {
        suite,
        tc,
        offset: fail.offset,
        bin: fail.bin,
        ts: fail.ts,
        arg: argBytes.slice(),
        glob: globBytes.slice(),
      };
    }
    return false;
  }

  const rng = makeRng(0x1bab2);
  const rb = (): number => Math.floor(rng() * 256) & 0xff;

  // ─── Suite A: random struct + random globals ────────────────────────
  console.log(
    `\n=== spritePosUpdate1BAB2 (FUN_0001BAB2) — Suite A: random — ${perSuite} cases ===`,
  );
  let okA = 0;
  for (let i = 0; i < perSuite; i++) {
    const argBytes = new Array(ARG_SIZE).fill(0).map(() => rb());
    const globBytes = new Array(COMPARE_SIZE).fill(0).map(() => rb());
    if (runOneCase("A", i, argBytes, globBytes)) okA++;
  }
  console.log(`  Match: ${okA}/${perSuite} = ${((okA / perSuite) * 100).toFixed(1)}%`);
  totalOk += okA;

  // ─── Suite B: no-change (struct.x == globals_x, jitter sub-tile) ─────
  console.log(
    `\n=== Suite B: forced no-change (sub-tile jitter) — ${perSuite} cases ===`,
  );
  let okB = 0;
  for (let i = 0; i < perSuite; i++) {
    const argBytes = new Array(ARG_SIZE).fill(0).map(() => rb());
    const globBytes = new Array(COMPARE_SIZE).fill(0).map(() => rb());
    argBytes[0xc] = globBytes[0]!;
    argBytes[0xd] = (globBytes[1]! & 0xf8) | (rb() & 0x07);
    argBytes[0x10] = globBytes[2]!;
    argBytes[0x11] = (globBytes[3]! & 0xf8) | (rb() & 0x07);
    if (runOneCase("B", i, argBytes, globBytes)) okB++;
  }
  console.log(`  Match: ${okB}/${perSuite} = ${((okB / perSuite) * 100).toFixed(1)}%`);
  totalOk += okB;

  // ─── Suite C: forced change (struct very different from globals) ────
  console.log(
    `\n=== Suite C: forced tile-change — ${perSuite} cases ===`,
  );
  let okC = 0;
  for (let i = 0; i < perSuite; i++) {
    const argBytes = new Array(ARG_SIZE).fill(0).map(() => rb());
    const globBytes = new Array(COMPARE_SIZE).fill(0).map(() => rb());
    // struct.x != globals.x (different high nibble) to guarantee tile-change.
    argBytes[0xc] = (globBytes[0]! ^ 0x80) & 0xff;
    argBytes[0xd] = rb();
    argBytes[0x10] = (globBytes[2]! ^ 0x80) & 0xff;
    argBytes[0x11] = rb();
    if (runOneCase("C", i, argBytes, globBytes)) okC++;
  }
  console.log(`  Match: ${okC}/${perSuite} = ${((okC / perSuite) * 100).toFixed(1)}%`);
  totalOk += okC;

  // ─── Suite D: edge cases (0x0000 / 0xFFFF / sign-bit boundary) ──────
  const sizeD = perSuite + remainder;
  console.log(
    `\n=== Suite D: edge cases (0x0000/0xFFFF/sign-bit) — ${sizeD} cases ===`,
  );
  let okD = 0;
  const edgeWords = [0x0000, 0x0001, 0x0007, 0x0008, 0x7fff, 0x8000, 0xfff8, 0xffff];
  for (let i = 0; i < sizeD; i++) {
    const argBytes = new Array(ARG_SIZE).fill(0).map(() => rb());
    const globBytes = new Array(COMPARE_SIZE).fill(0).map(() => rb());
    const wx = edgeWords[Math.floor(rng() * edgeWords.length)]!;
    const wy = edgeWords[Math.floor(rng() * edgeWords.length)]!;
    const wz = edgeWords[Math.floor(rng() * edgeWords.length)]!;
    argBytes[0xc] = (wx >>> 8) & 0xff; argBytes[0xd] = wx & 0xff;
    argBytes[0x10] = (wy >>> 8) & 0xff; argBytes[0x11] = wy & 0xff;
    argBytes[0x14] = (wz >>> 8) & 0xff; argBytes[0x15] = wz & 0xff;
    // Edge-case also for the current globals
    const gx = edgeWords[Math.floor(rng() * edgeWords.length)]!;
    const gy = edgeWords[Math.floor(rng() * edgeWords.length)]!;
    globBytes[6] = (gx >>> 8) & 0xff; globBytes[7] = gx & 0xff; // 0x400696 (TILE_X)
    globBytes[8] = (gy >>> 8) & 0xff; globBytes[9] = gy & 0xff; // 0x400698 (TILE_Y)
    if (runOneCase("D", i, argBytes, globBytes)) okD++;
  }
  console.log(`  Match: ${okD}/${sizeD} = ${((okD / sizeD) * 100).toFixed(1)}%`);
  totalOk += okD;

  console.log(
    `\n=== TOTAL: ${totalOk}/${total} = ${((totalOk / total) * 100).toFixed(1)}% ===`,
  );
  if (failHolder.value !== null) {
    const f = failHolder.value;
    console.log(
      `  First fail (suite ${f.suite} tc=${f.tc}): @ 0x${(0x690 + f.offset).toString(16)} ` +
      `bin=0x${f.bin.toString(16)} ts=0x${f.ts.toString(16)}`,
    );
    console.log(`    arg+0xC..+0x15: ${f.arg.slice(0xc, 0x16).map(b => b.toString(16).padStart(2, "0")).join(" ")}`);
    console.log(`    glob 0x690..0x6A3: ${f.glob.map(b => b.toString(16).padStart(2, "0")).join(" ")}`);
  }

  disposeCpu(cpu);
  exit(totalOk === total ? 0 : 1);
}

main().catch(e => {
  console.error(e);
  exit(1);
});
