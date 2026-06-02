#!/usr/bin/env node
/**
 * test-event-flags-parity.ts — differential FUN_2548 vs consumeEventFlag.
 *
 * For N random flag words: set *0x400006, callFunction(0x2548), compare:
 *   - D0 (return value, 0 or 1)
 *   - *0x400006 after the call, shifted right by 1
 *
 * Usage: npx tsx packages/cli/src/test-event-flags-parity.ts [N]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import { state as stateNs, eventFlags } from "@marble-love/engine";
import {
  createCpu,
  callFunction,
  pokeMem,
  peekMem,
  disposeCpu,
} from "./binary-oracle-lib.js";

const FUN_CONSUME = 0x00002548;
const FUN_SET_FLAG = 0x00005236;
const FUN_ADD_ACCUM = 0x00028608;
const FUN_EDGE_DETECT = 0x00000f6a;
const FUN_ANY_STATUS_FLAGS = 0x000052a2;

async function main(): Promise<void> {
  const n = Number(process.argv[2] ?? "500");

  const romPath = resolve("ghidra_project/marble_program.bin");
  if (!existsSync(romPath)) {
    console.error(`error: ROM blob not found at ${romPath}`);
    exit(3);
  }
  const rom = readFileSync(romPath);

  const state = stateNs.emptyGameState();
  const cpu = await createCpu({ rom, state });

  console.log(`\n=== consumeEventFlag (FUN_2548) — ${n} cases ===`);

  let s = 0xc0ffee;
  const rng = (): number => {
    s = (s * 1103515245 + 12345) >>> 0;
    return ((s >>> 16) & 0xffff) / 0x10000;
  };

  let ok = 0;
  for (let i = 0; i < n; i++) {
    // Reset SP
    cpu.system.setRegister("sp", 0x401f00);

    const word = Math.floor(rng() * 0x10000) & 0xffff;
    pokeMem(cpu, 0x400006, 2, word);
    state.workRam[0x06] = (word >>> 8) & 0xff;
    state.workRam[0x07] = word & 0xff;

    // Binary
    const r = callFunction(cpu, FUN_CONSUME, []);
    const binaryD0 = r.d0 & 0xffff;
    const binaryWord = peekMem(cpu, 0x400006, 2);

    // TS
    const tsD0 = eventFlags.consumeEventFlag(state);
    const tsWord = ((state.workRam[0x06] ?? 0) << 8) | (state.workRam[0x07] ?? 0);

    const match = binaryD0 === tsD0 && binaryWord === tsWord;
    if (match) ok++;
    else if (ok + 3 > i) {
      console.log(`  case ${i}: input=0x${word.toString(16)}`);
      console.log(`    bin: D0=${binaryD0} word_after=0x${binaryWord.toString(16)}`);
      console.log(`    ts:  D0=${tsD0} word_after=0x${tsWord.toString(16)}`);
    }
  }
  console.log(`  Match: ${ok}/${n} = ${((ok / n) * 100).toFixed(1)}%`);

  // ─── setFlagBit (FUN_5236) ───────────────────────────────────────────
  console.log(`\n=== setFlagBit (FUN_5236) — ${n} cases ===`);
  let ok2 = 0;
  for (let i = 0; i < n; i++) {
    cpu.system.setRegister("sp", 0x401f00);

    const initial = (Math.floor(rng() * 0x100000000) >>> 0);
    const bitNum = Math.floor(rng() * 35); // 0..34, covers the shift >=32 case

    pokeMem(cpu, 0x401f5e, 4, initial);
    state.workRam[0x1f5e] = (initial >>> 24) & 0xff;
    state.workRam[0x1f5f] = (initial >>> 16) & 0xff;
    state.workRam[0x1f60] = (initial >>> 8) & 0xff;
    state.workRam[0x1f61] = initial & 0xff;

    callFunction(cpu, FUN_SET_FLAG, [bitNum]);
    const binaryFlags = peekMem(cpu, 0x401f5e, 4) >>> 0;

    eventFlags.setFlagBit(state, bitNum);
    const tsFlags =
      (((state.workRam[0x1f5e] ?? 0) << 24) |
       ((state.workRam[0x1f5f] ?? 0) << 16) |
       ((state.workRam[0x1f60] ?? 0) << 8) |
       (state.workRam[0x1f61] ?? 0)) >>> 0;

    if (binaryFlags === tsFlags) ok2++;
    else if (ok2 + 3 > i) {
      console.log(`  case ${i}: initial=0x${initial.toString(16)} bitNum=${bitNum}`);
      console.log(`    bin=0x${binaryFlags.toString(16)} ts=0x${tsFlags.toString(16)}`);
    }
  }
  console.log(`  Match: ${ok2}/${n} = ${((ok2 / n) * 100).toFixed(1)}%`);

  // ─── addToObjectAccumAndFlag (FUN_28608) ─────────────────────────────
  console.log(`\n=== addToObjectAccumAndFlag (FUN_28608) — ${n} cases ===`);
  let ok3 = 0;
  for (let i = 0; i < n; i++) {
    cpu.system.setRegister("sp", 0x401f00);

    // Random obj at random offset within scratch
    const objAddr = 0x401d00 + Math.floor(rng() * 0x40);
    const initialAccum = Math.floor(rng() * 0x100000000) >>> 0;
    const value = Math.floor(rng() * 0x100000000) >>> 0;
    const type = Math.floor(rng() * 35); // 0..34, covers shift>=32
    const initialFlag = Math.floor(rng() * 256) & 0xff;

    // Setup: obj.+0xBC = initialAccum, obj.+0x19 = type, *0x40039C = initialFlag
    pokeMem(cpu, objAddr + 0xBC, 4, initialAccum);
    pokeMem(cpu, objAddr + 0x19, 1, type);
    pokeMem(cpu, 0x40039C, 1, initialFlag);
    state.workRam[(objAddr - 0x400000) + 0xBC] = (initialAccum >>> 24) & 0xff;
    state.workRam[(objAddr - 0x400000) + 0xBD] = (initialAccum >>> 16) & 0xff;
    state.workRam[(objAddr - 0x400000) + 0xBE] = (initialAccum >>> 8) & 0xff;
    state.workRam[(objAddr - 0x400000) + 0xBF] = initialAccum & 0xff;
    state.workRam[(objAddr - 0x400000) + 0x19] = type;
    state.workRam[0x39c] = initialFlag;

    // Binary
    callFunction(cpu, FUN_ADD_ACCUM, [objAddr, value]);
    const binAccum = peekMem(cpu, objAddr + 0xBC, 4) >>> 0;
    const binFlag = peekMem(cpu, 0x40039C, 1);

    // TS
    eventFlags.addToObjectAccumAndFlag(state, objAddr, value);
    const tsAccumOff = (objAddr - 0x400000) + 0xBC;
    const tsAccum = (
      ((state.workRam[tsAccumOff] ?? 0) << 24) |
      ((state.workRam[tsAccumOff + 1] ?? 0) << 16) |
      ((state.workRam[tsAccumOff + 2] ?? 0) << 8) |
      (state.workRam[tsAccumOff + 3] ?? 0)
    ) >>> 0;
    const tsFlag = state.workRam[0x39c] ?? 0;

    if (binAccum === tsAccum && binFlag === tsFlag) ok3++;
    else if (ok3 + 3 > i) {
      console.log(`  case ${i}: type=${type} initAccum=0x${initialAccum.toString(16)} value=0x${value.toString(16)} initFlag=0x${initialFlag.toString(16)}`);
      console.log(`    bin: accum=0x${binAccum.toString(16)} flag=0x${binFlag.toString(16)}`);
      console.log(`    ts:  accum=0x${tsAccum.toString(16)} flag=0x${tsFlag.toString(16)}`);
    }
  }
  console.log(`  Match: ${ok3}/${n} = ${((ok3 / n) * 100).toFixed(1)}%`);

  // ─── detectRisingEdgesAndPass (FUN_F6A) ──────────────────────────────
  console.log(`\n=== detectRisingEdgesAndPass (FUN_F6A) — ${n} cases ===`);
  let ok4 = 0;
  for (let i = 0; i < n; i++) {
    cpu.system.setRegister("sp", 0x401f00);

    const flagWord = Math.floor(rng() * 0x10000) & 0xffff;
    const prevState = Math.floor(rng() * 0x10000) & 0xffff;

    pokeMem(cpu, 0x400000, 2, flagWord);
    pokeMem(cpu, 0x40017c, 2, prevState);
    state.workRam[0x00] = (flagWord >>> 8) & 0xff;
    state.workRam[0x01] = flagWord & 0xff;
    state.workRam[0x17c] = (prevState >>> 8) & 0xff;
    state.workRam[0x17d] = prevState & 0xff;

    const r = callFunction(cpu, FUN_EDGE_DETECT, []);
    const binD0 = r.d0 >>> 0;
    const binPrev = peekMem(cpu, 0x40017c, 2);

    const tsD0 = eventFlags.detectRisingEdgesAndPass(state);
    const tsPrev = ((state.workRam[0x17c] ?? 0) << 8) | (state.workRam[0x17d] ?? 0);

    if (binD0 === tsD0 && binPrev === tsPrev) ok4++;
    else if (ok4 + 3 > i) {
      console.log(`  case ${i}: flag=0x${flagWord.toString(16)} prev=0x${prevState.toString(16)}`);
      console.log(`    bin D0=0x${binD0.toString(16)} prev=0x${binPrev.toString(16)}`);
      console.log(`    ts  D0=0x${tsD0.toString(16)} prev=0x${tsPrev.toString(16)}`);
    }
  }
  console.log(`  Match: ${ok4}/${n} = ${((ok4 / n) * 100).toFixed(1)}%`);

  // ─── anyStatusFlagsSet (FUN_52A2) ────────────────────────────────────
  console.log(`\n=== anyStatusFlagsSet (FUN_52A2) — ${n} cases ===`);
  let ok5 = 0;
  let firstFail5: { primary: number; secondary: number; bin: number; ts: number } | null = null;
  for (let i = 0; i < n; i++) {
    cpu.system.setRegister("sp", 0x401f00);

    // Mix of zero-zero, single-bit, and full random patterns to hit every branch
    const pattern = i % 4;
    let primary: number;
    let secondary: number;
    if (pattern === 0) { primary = 0; secondary = 0; }
    else if (pattern === 1) { primary = Math.floor(rng() * 0x100000000) >>> 0; secondary = 0; }
    else if (pattern === 2) { primary = 0; secondary = Math.floor(rng() * 0x100000000) >>> 0; }
    else { primary = Math.floor(rng() * 0x100000000) >>> 0; secondary = Math.floor(rng() * 0x100000000) >>> 0; }

    pokeMem(cpu, 0x401f5e, 4, primary);
    pokeMem(cpu, 0x401f76, 4, secondary);
    state.workRam[0x1f5e] = (primary >>> 24) & 0xff;
    state.workRam[0x1f5f] = (primary >>> 16) & 0xff;
    state.workRam[0x1f60] = (primary >>> 8) & 0xff;
    state.workRam[0x1f61] = primary & 0xff;
    state.workRam[0x1f76] = (secondary >>> 24) & 0xff;
    state.workRam[0x1f77] = (secondary >>> 16) & 0xff;
    state.workRam[0x1f78] = (secondary >>> 8) & 0xff;
    state.workRam[0x1f79] = secondary & 0xff;

    const r = callFunction(cpu, FUN_ANY_STATUS_FLAGS, []);
    const binD0 = r.d0 & 0xff; // returns 0 or 1

    const tsD0 = eventFlags.anyStatusFlagsSet(state);

    if (binD0 === tsD0) ok5++;
    else if (firstFail5 === null) {
      firstFail5 = { primary, secondary, bin: binD0, ts: tsD0 };
    }
  }
  console.log(`  Match: ${ok5}/${n} = ${((ok5 / n) * 100).toFixed(1)}%`);
  if (firstFail5) {
    const { primary, secondary, bin, ts } = firstFail5;
    console.log(`  First fail: primary=0x${primary.toString(16)} secondary=0x${secondary.toString(16)} bin=${bin} ts=${ts}`);
  }

  disposeCpu(cpu);
  exit((ok === n && ok2 === n && ok3 === n && ok4 === n && ok5 === n) ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  exit(1);
});
