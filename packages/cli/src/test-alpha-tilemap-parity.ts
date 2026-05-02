#!/usr/bin/env node
/**
 * test-alpha-tilemap-parity.ts — differential FUN_383A vs setAlphaWord +
 * FUN_28C7E vs clearAlphaTilesFromIndex.
 *
 * - FUN_383A: 2 long args (index, value). Scrive un word @ alpha[index*2].
 * - FUN_28C7E: 1 long arg (startRow). Cancella tutti i tile da
 *   `startRow*64` a `0x780`. Internamente chiama FUN_021E (= FUN_383A jmp).
 *
 * Per ogni caso:
 *   1. Reset alpha RAM (4 KB) a un sentinel pattern
 *   2. Run binario via callFunction
 *   3. Run TS sullo stesso state
 *   4. Confronta alpha RAM byte-by-byte
 *
 * Uso: npx tsx packages/cli/src/test-alpha-tilemap-parity.ts [N]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import { state as stateNs, alphaTilemap } from "@marble-love/engine";
import {
  createCpu,
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
  console.log(`\n=== setAlphaWord (FUN_383A) — ${n} casi ===`);

  const rng = makeRng(0xa1f4);
  let ok1 = 0;
  let firstFail1: { index: number; value: number; addr: number; bin: number; ts: number } | null = null;

  for (let i = 0; i < n; i++) {
    cpu.system.setRegister("sp", 0x401f00);

    // index in [0, 0x780); value random word
    const index = Math.floor(rng() * 0x780);
    const value = Math.floor(rng() * 0x10000) & 0xffff;

    // Init alpha RAM con sentinel pattern (0xAA byte)
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
  // Ogni iterazione del binario chiama FUN_021E che è ~10 istruzioni e
  // itera fino a 0x780 volte. Worst case startRow=0: 1920 chiamate × ~10
  // istruzioni = ~20k step. Manteniamo un budget largo.
  console.log(`\n=== clearAlphaTilesFromIndex (FUN_28C7E) — ${n} casi ===`);

  let ok2 = 0;
  let firstFail2: { startRow: number; addr: number; bin: number; ts: number } | null = null;

  for (let i = 0; i < n; i++) {
    cpu.system.setRegister("sp", 0x401f00);

    // startRow in [0, 31] — copre tutti i casi pratici incluso il no-op (30)
    const startRow = Math.floor(rng() * 31);

    // Init alpha RAM con sentinel pattern (0xCC)
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

  disposeCpu(cpu);
  exit((ok1 === n && ok2 === n) ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  exit(1);
});
