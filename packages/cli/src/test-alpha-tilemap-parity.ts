#!/usr/bin/env node
/**
 * test-alpha-tilemap-parity.ts — differential FUN_383A vs setAlphaWord +
 * FUN_28C7E vs clearAlphaTilesFromIndex.
 *
 *
 *   1. Reset alpha RAM (4 KB) a un sentinel pattern
 *   3. Run TS on the same state
 *
 * Uso: npx tsx packages/cli/src/test-alpha-tilemap-parity.ts [N]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import { state as stateNs, alphaTilemap } from "@marble-love/engine";
import {
  createCpu,
  callFunction,
  pokeMem,
  peekMem,
  disposeCpu,
} from "./binary-oracle-lib.js";
import type { CpuSession } from "./binary-oracle-lib.js";

const FUN_SET_ALPHA_WORD = 0x0000383a;
const FUN_CLEAR_TILES = 0x00028c7e;
const SENTINEL = 0xCAFEBABE >>> 0;

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) >>> 0;
    return ((s >>> 16) & 0xffff) / 0x10000;
  };
}

function call2LongArgs(cpu: CpuSession, addr: number, a1: number, a2: number): void {
  const sys = cpu.system;
  let sp = sys.getRegisters().sp;
  sp = (sp - 4) >>> 0; sys.write(sp, 4, a2 >>> 0);
  sp = (sp - 4) >>> 0; sys.write(sp, 4, a1 >>> 0);
  sp = (sp - 4) >>> 0; sys.write(sp, 4, SENTINEL);
  sys.setRegister("sp", sp);
  sys.setRegister("pc", addr);
  for (let i = 0; i < 20_000; i++) {
    if (sys.getRegisters().pc === SENTINEL) break;
    sys.step();
  }
  sys.setRegister("sp", (sys.getRegisters().sp + 4 + 8) >>> 0);
}

function call1LongArg(cpu: CpuSession, addr: number, a1: number, maxSteps = 5_000_000): void {
  const sys = cpu.system;
  let sp = sys.getRegisters().sp;
  sp = (sp - 4) >>> 0; sys.write(sp, 4, a1 >>> 0);
  sp = (sp - 4) >>> 0; sys.write(sp, 4, SENTINEL);
  sys.setRegister("sp", sp);
  sys.setRegister("pc", addr);
  for (let i = 0; i < maxSteps; i++) {
    if (sys.getRegisters().pc === SENTINEL) break;
    sys.step();
  }
  sys.setRegister("sp", (sys.getRegisters().sp + 4 + 4) >>> 0);
}

async function main(): Promise<void> {
  const n = Number(process.argv[2] ?? "300");

  const romPath = resolve("ghidra_project/marble_program.bin");
  if (!existsSync(romPath)) {
    console.error(`error: ROM blob not found at ${romPath}`);
    exit(3);
  }
  const rom = readFileSync(romPath);

  const state = stateNs.emptyGameState();
  const cpu = await createCpu({ rom, state });

  // ─── setAlphaWord (FUN_383A) ──────────────────────────────────────────
  console.log(`\n=== setAlphaWord (FUN_383A) — ${n} cases ===`);

  const rng = makeRng(0xa1f4);
  let ok1 = 0;
  let firstFail1: { index: number; value: number; addr: number; bin: number; ts: number } | null = null;

  for (let i = 0; i < n; i++) {
    cpu.system.setRegister("sp", 0x401f00);

    // index in [0, 0x780); value random word
    const index = Math.floor(rng() * 0x780);
    const value = Math.floor(rng() * 0x10000) & 0xffff;

    // Init alpha RAM with sentinel pattern (0xAA byte).
    for (let j = 0; j < 0x1000; j++) {
      pokeMem(cpu, 0xa03000 + j, 1, 0xAA);
      state.alphaRam[j] = 0xAA;
    }

    call2LongArgs(cpu, FUN_SET_ALPHA_WORD, index, value);
    alphaTilemap.setAlphaWord(state, index, value);

    let match = true;
    let firstDiff = -1;
    for (let j = 0; j < 0x1000; j++) {
      const b = peekMem(cpu, 0xa03000 + j, 1);
      const t = state.alphaRam[j] ?? 0;
      if (b !== t) {
        match = false;
        firstDiff = j;
        break;
      }
    }
    if (match) ok1++;
    else if (firstFail1 === null) {
      firstFail1 = {
        index, value,
        addr: 0xa03000 + firstDiff,
        bin: peekMem(cpu, 0xa03000 + firstDiff, 1),
        ts: state.alphaRam[firstDiff] ?? 0,
      };
    }
  }
  console.log(`  Match: ${ok1}/${n} = ${((ok1 / n) * 100).toFixed(1)}%`);
  if (firstFail1) {
    const { index, value, addr, bin, ts } = firstFail1;
    console.log(`  First fail: index=0x${index.toString(16)} value=0x${value.toString(16)}`);
    console.log(`    @ 0x${addr.toString(16)}: bin=0x${bin.toString(16)} ts=0x${ts.toString(16)}`);
  }

  // ─── clearAlphaTilesFromIndex (FUN_28C7E) ─────────────────────────────
  // The routine is roughly 20k instruction steps; keep a wide budget.
  console.log(`\n=== clearAlphaTilesFromIndex (FUN_28C7E) — ${n} cases ===`);

  let ok2 = 0;
  let firstFail2: { startRow: number; addr: number; bin: number; ts: number } | null = null;

  for (let i = 0; i < n; i++) {
    cpu.system.setRegister("sp", 0x401f00);

    const startRow = Math.floor(rng() * 31);

    // Init alpha RAM with sentinel pattern (0xCC).
    for (let j = 0; j < 0x1000; j++) {
      pokeMem(cpu, 0xa03000 + j, 1, 0xCC);
      state.alphaRam[j] = 0xCC;
    }

    call1LongArg(cpu, FUN_CLEAR_TILES, startRow, 100_000);
    alphaTilemap.clearAlphaTilesFromIndex(state, startRow);

    let match = true;
    let firstDiff = -1;
    for (let j = 0; j < 0x1000; j++) {
      const b = peekMem(cpu, 0xa03000 + j, 1);
      const t = state.alphaRam[j] ?? 0;
      if (b !== t) {
        match = false;
        firstDiff = j;
        break;
      }
    }
    if (match) ok2++;
    else if (firstFail2 === null) {
      firstFail2 = {
        startRow,
        addr: 0xa03000 + firstDiff,
        bin: peekMem(cpu, 0xa03000 + firstDiff, 1),
        ts: state.alphaRam[firstDiff] ?? 0,
      };
    }
  }
  console.log(`  Match: ${ok2}/${n} = ${((ok2 / n) * 100).toFixed(1)}%`);
  if (firstFail2) {
    const { startRow, addr, bin, ts } = firstFail2;
    console.log(`  First fail: startRow=${startRow}`);
    console.log(`    @ 0x${addr.toString(16)}: bin=0x${bin.toString(16)} ts=0x${ts.toString(16)}`);
  }

  // FUN_16E8E: clearAlphaRows
  console.log(`\n=== clearAlphaRows (FUN_16E8E) — 30 cases ===`);
  const tsRomCAR = (await import("@marble-love/engine")).bus.emptyRomImage();
  tsRomCAR.program.set(rom.subarray(0, tsRomCAR.program.length));
  let okCAR = 0;
  for (let i = 0; i < 30; i++) {
    cpu.system.setRegister("sp", 0x401f00);
    // rotation flag random 0..7
    const rot = Math.floor(Math.random() * 8);
    pokeMem(cpu, 0x00401F42, 2, rot);
    state.workRam[0x1F42] = 0; state.workRam[0x1F43] = rot;
    // Pre-fill alpha
    for (let j = 0; j < 0x1000; j++) {
      pokeMem(cpu, 0xa03000 + j, 1, 0xCC);
      state.alphaRam[j] = 0xCC;
    }
    const startRow = i & 0x1F; // 0..29 (avoid 30+ for valid range)
    callFunction(cpu, 0x16e8e, [startRow]);
    (await import("@marble-love/engine")).alphaTilemap.clearAlphaRows(state, tsRomCAR, startRow);
    let m = true;
    for (let j = 0; j < 0x1000; j++) {
      if (peekMem(cpu, 0xa03000 + j, 1) !== (state.alphaRam[j] ?? 0)) { m = false; break; }
    }
    if (m) okCAR++;
  }
  console.log(`  Match: ${okCAR}/30`);

  disposeCpu(cpu);
  exit((ok1 === n && ok2 === n && okCAR === 30) ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  exit(1);
});
