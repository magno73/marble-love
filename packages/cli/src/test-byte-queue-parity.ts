#!/usr/bin/env node
/**
 * test-byte-queue-parity.ts — differential FUN_4D68 vs dequeueByte +
 * FUN_53EA vs orPairBytes.
 *
 * - FUN_4D68: 0 args. Legge struct @ 0x401F44 (head, tail, buffer 16 byte),
 *   dequeue il byte corrente. Side effect: head++ (wrap a 16).
 * - FUN_53EA: 1 long arg (ptr). Ritorna ptr[0] | ptr[1] come long.
 *
 * Uso: npx tsx packages/cli/src/test-byte-queue-parity.ts [N]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import { state as stateNs, byteQueue } from "@marble-love/engine";
import {
  createCpu,
  callFunction,
  pokeMem,
  peekMem,
  disposeCpu,
} from "./binary-oracle-lib.js";

const FUN_DEQUEUE = 0x00004D68;
const FUN_OR_PAIR = 0x000053EA;

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) >>> 0;
    return ((s >>> 16) & 0xffff) / 0x10000;
  };
}

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

  // ─── dequeueByte (FUN_4D68) ───────────────────────────────────────────
  console.log(`\n=== dequeueByte (FUN_4D68) — ${n} casi ===`);

  const rng = makeRng(0xb1ff);
  let ok1 = 0;
  let firstFail1: { head: number; tail: number; binD0: number; tsD0: number; binHead: number; tsHead: number } | null = null;

  for (let i = 0; i < n; i++) {
    cpu.system.setRegister("sp", 0x401f00);

    // Random head, tail (each in 0..15). Sometimes equal (empty).
    const head = Math.floor(rng() * 16);
    let tail = Math.floor(rng() * 16);
    // 30% chance to force empty
    if (rng() < 0.3) tail = head;

    // Random buffer
    const buffer = new Array(16).fill(0).map(() => Math.floor(rng() * 256) & 0xff);

    // Setup struct in both
    pokeMem(cpu, 0x401F44 + 0x12, 1, head);
    pokeMem(cpu, 0x401F44 + 0x13, 1, tail);
    for (let j = 0; j < 16; j++) {
      pokeMem(cpu, 0x401F44 + 0x02 + j, 1, buffer[j] ?? 0);
      state.workRam[0x1F44 + 0x02 + j] = buffer[j] ?? 0;
    }
    state.workRam[0x1F44 + 0x12] = head;
    state.workRam[0x1F44 + 0x13] = tail;

    // Run binary
    const r = callFunction(cpu, FUN_DEQUEUE, []);
    const binD0 = r.d0 >>> 0;
    const binHead = peekMem(cpu, 0x401F44 + 0x12, 1);

    // Run TS
    const tsD0 = byteQueue.dequeueByte(state);
    const tsHead = state.workRam[0x1F44 + 0x12] ?? 0;

    if (binD0 === tsD0 && binHead === tsHead) ok1++;
    else if (firstFail1 === null) {
      firstFail1 = { head, tail, binD0, tsD0, binHead, tsHead };
    }
  }
  console.log(`  Match: ${ok1}/${n} = ${((ok1 / n) * 100).toFixed(1)}%`);
  if (firstFail1) {
    console.log(`  First fail: head=${firstFail1.head} tail=${firstFail1.tail}`);
    console.log(`    bin D0=0x${firstFail1.binD0.toString(16)} head=${firstFail1.binHead}`);
    console.log(`    ts  D0=0x${firstFail1.tsD0.toString(16)} head=${firstFail1.tsHead}`);
  }

  // ─── orPairBytes (FUN_53EA) ───────────────────────────────────────────
  console.log(`\n=== orPairBytes (FUN_53EA) — ${n} casi ===`);

  let ok2 = 0;
  let firstFail2: { ptr: number; b0: number; b1: number; bin: number; ts: number } | null = null;

  for (let i = 0; i < n; i++) {
    cpu.system.setRegister("sp", 0x401f00);

    const ptr = 0x401D00 + Math.floor(rng() * 0x40);
    const b0 = Math.floor(rng() * 256) & 0xff;
    const b1 = Math.floor(rng() * 256) & 0xff;

    pokeMem(cpu, ptr, 1, b0);
    pokeMem(cpu, ptr + 1, 1, b1);
    state.workRam[(ptr - 0x400000)] = b0;
    state.workRam[(ptr - 0x400000) + 1] = b1;

    const r = callFunction(cpu, FUN_OR_PAIR, [ptr]);
    const binD0 = r.d0 >>> 0;
    const tsD0 = byteQueue.orPairBytes(state, ptr);

    if (binD0 === tsD0) ok2++;
    else if (firstFail2 === null) {
      firstFail2 = { ptr, b0, b1, bin: binD0, ts: tsD0 };
    }
  }
  console.log(`  Match: ${ok2}/${n} = ${((ok2 / n) * 100).toFixed(1)}%`);
  if (firstFail2) {
    console.log(`  First fail: ptr=0x${firstFail2.ptr.toString(16)} b0=0x${firstFail2.b0.toString(16)} b1=0x${firstFail2.b1.toString(16)}`);
    console.log(`    bin=0x${firstFail2.bin.toString(16)} ts=0x${firstFail2.ts.toString(16)}`);
  }

  disposeCpu(cpu);
  exit((ok1 === n && ok2 === n) ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  exit(1);
});
