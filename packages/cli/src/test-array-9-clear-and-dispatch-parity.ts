#!/usr/bin/env node
/**
 * `array9ClearAndDispatch`.
 *
 * of arg1) e `entry[0x19]` (low byte of arg2).
 *
 *
 *   1. Patch FUN_18F46 to a custom thunk that logs `(arg1Long, arg2Long)`
 *      in una ring-buffer in work-RAM.
 *      Layout ring-buffer:
 *        - 0x401E00: 9 × 8 byte (arg1 long + arg2 long) = 72 byte slot
 *   3. Run TS with callback that does the same log + clear -> compare workRam
 *
 *     0x80, 0x7F, 0xFF, 0x00).
 *
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import { state as stateNs, array9ClearAndDispatch as a9ns } from "@marble-love/engine";
import {
  createCpu,
  callFunction,
  pokeMem,
  peekMem,
  disposeCpu,
} from "./binary-oracle-lib.js";
import type { CpuSession } from "./binary-oracle-lib.js";

const FUN_190EE = 0x000190ee;
const FUN_18F46 = 0x00018f46;

/** Base ring-buffer (9 × 8 byte = 72 byte). */
const RING_BASE = 0x00401e00;
const RING_COUNTER = 0x00401e48;

/** Patch FUN_18F46 with the thunk-logger (32 byte).
 *
 * Layout (RING_BASE = 0x00401E00, RING_COUNTER = 0x00401E48):
 *   movea.l #RING_BASE, A0           ; 207C 0040 1E00              (6 byte)
 *   move.l  RING_COUNTER.l, D1       ; 2239 0040 1E48              (6 byte)
 *   adda.l  D1, A0                   ; D1C1                        (2 byte)
 *   move.l  (4,SP), (A0)+            ; 20EF 0004                   (4 byte)
 *   move.l  (8,SP), (A0)             ; 20AF 0008                   (4 byte)
 *   addq.l  #8, RING_COUNTER.l       ; 50B9 0040 1E48              (6 byte)
 *   rts                              ; 4E75                        (2 byte)
 *
 */
function patchFun18F46(cpu: CpuSession): void {
  const bytes = [
    // movea.l #0x00401E00, A0           (207C 0040 1E00)
    0x20, 0x7c, 0x00, 0x40, 0x1e, 0x00,
    // move.l 0x00401E48.l, D1           (2239 0040 1E48)
    0x22, 0x39, 0x00, 0x40, 0x1e, 0x48,
    // adda.l D1, A0                     (D1C1)
    0xd1, 0xc1,
    // move.l (4,SP), (A0)+              (20EF 0004)
    0x20, 0xef, 0x00, 0x04,
    // move.l (8,SP), (A0)               (20AF 0008)
    0x20, 0xaf, 0x00, 0x08,
    // addq.l #8, 0x00401E48.l           (50B9 0040 1E48)
    0x50, 0xb9, 0x00, 0x40, 0x1e, 0x48,
    // rts                               (4E75)
    0x4e, 0x75,
  ];
  for (let i = 0; i < bytes.length; i++) {
    pokeMem(cpu, FUN_18F46 + i, 1, bytes[i]!);
  }
}

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) >>> 0;
    return ((s >>> 16) & 0xffff) / 0x10000;
  };
}

function resetWatchedZones(
  state: ReturnType<typeof stateNs.emptyGameState>,
  cpu: CpuSession,
): void {
  for (let a = 0x00401890; a < 0x004019f8; a++) {
    pokeMem(cpu, a, 1, 0);
    state.workRam[a - 0x400000] = 0;
  }
  // Ring buffer (72 byte) + counter (4 byte) @ 0x401E00..0x401E4C.
  for (let a = RING_BASE; a < RING_BASE + 72 + 4; a++) {
    pokeMem(cpu, a, 1, 0);
    state.workRam[a - 0x400000] = 0;
  }
}

/** Read ring buffer (72 byte) e counter long. */
function readRingBin(
  cpu: CpuSession,
): { ring: Uint8Array; counter: number } {
  const ring = new Uint8Array(72);
  for (let i = 0; i < ring.length; i++) {
    ring[i] = peekMem(cpu, RING_BASE + i, 1) & 0xff;
  }
  const counter = peekMem(cpu, RING_COUNTER, 4) >>> 0;
  return { ring, counter };
}

function readRingTs(
  state: ReturnType<typeof stateNs.emptyGameState>,
): { ring: Uint8Array; counter: number } {
  const ring = new Uint8Array(72);
  const baseOff = RING_BASE - 0x400000;
  for (let i = 0; i < ring.length; i++) {
    ring[i] = state.workRam[baseOff + i] ?? 0;
  }
  const cOff = RING_COUNTER - 0x400000;
  const counter =
    (((state.workRam[cOff] ?? 0) << 24) |
      ((state.workRam[cOff + 1] ?? 0) << 16) |
      ((state.workRam[cOff + 2] ?? 0) << 8) |
      (state.workRam[cOff + 3] ?? 0)) >>>
    0;
  return { ring, counter };
}

function readArrayBin(cpu: CpuSession): Uint8Array {
  const arr = new Uint8Array(0x168);
  for (let i = 0; i < arr.length; i++) {
    arr[i] = peekMem(cpu, 0x00401890 + i, 1) & 0xff;
  }
  return arr;
}

function readArrayTs(
  state: ReturnType<typeof stateNs.emptyGameState>,
): Uint8Array {
  const arr = new Uint8Array(0x168);
  for (let i = 0; i < arr.length; i++) {
    arr[i] = state.workRam[0x1890 + i] ?? 0;
  }
  return arr;
}

function diffBytes(
  a: Uint8Array,
  b: Uint8Array,
  offBase: number,
): { offset: number; bin: number; ts: number } | null {
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    if (a[i] !== b[i]) return { offset: offBase + i, bin: a[i]!, ts: b[i]! };
  }
  return null;
}

/**
 *   - counter += 8
 */
function makeLogger() {
  return (arg1Long: number, arg2Long: number, state: ReturnType<typeof stateNs.emptyGameState>): void => {
    const cOff = RING_COUNTER - 0x400000;
    const counter =
      (((state.workRam[cOff] ?? 0) << 24) |
        ((state.workRam[cOff + 1] ?? 0) << 16) |
        ((state.workRam[cOff + 2] ?? 0) << 8) |
        (state.workRam[cOff + 3] ?? 0)) >>>
      0;
    const ringOff = (RING_BASE - 0x400000) + counter;
    // arg1 long (BE)
    state.workRam[ringOff] = (arg1Long >>> 24) & 0xff;
    state.workRam[ringOff + 1] = (arg1Long >>> 16) & 0xff;
    state.workRam[ringOff + 2] = (arg1Long >>> 8) & 0xff;
    state.workRam[ringOff + 3] = arg1Long & 0xff;
    // arg2 long (BE)
    state.workRam[ringOff + 4] = (arg2Long >>> 24) & 0xff;
    state.workRam[ringOff + 5] = (arg2Long >>> 16) & 0xff;
    state.workRam[ringOff + 6] = (arg2Long >>> 8) & 0xff;
    state.workRam[ringOff + 7] = arg2Long & 0xff;
    // counter += 8
    const newCounter = (counter + 8) >>> 0;
    state.workRam[cOff] = (newCounter >>> 24) & 0xff;
    state.workRam[cOff + 1] = (newCounter >>> 16) & 0xff;
    state.workRam[cOff + 2] = (newCounter >>> 8) & 0xff;
    state.workRam[cOff + 3] = newCounter & 0xff;
  };
}

async function main(): Promise<void> {
  const total = Number(process.argv[2] ?? "500");

  const romPath = resolve("ghidra_project/marble_program.bin");
  if (!existsSync(romPath)) {
    console.error(`error: ROM blob not found at ${romPath}`);
    exit(3);
  }
  const rom = readFileSync(romPath);

  const stateInst = stateNs.emptyGameState();
  const cpu = await createCpu({ rom, state: stateInst });
  patchFun18F46(cpu);

  const subs: a9ns.Array9ClearAndDispatchSubs = {
    fun_18f46: makeLogger(),
  };

  console.log(`\n=== array9ClearAndDispatch (FUN_190EE) — ${total} cases ===`);

  const rng = makeRng(0x190ee);
  const rb = (): number => Math.floor(rng() * 256) & 0xff;

  let ok = 0;
  interface FailRecord {
    tc: number;
    where: "array" | "ring" | "counter";
    offset: number;
    bin: number;
    ts: number;
  }
  let firstFail: FailRecord | null = null;

  for (let tc = 0; tc < total; tc++) {
    cpu.system.setRegister("sp", 0x401f00);

    resetWatchedZones(stateInst, cpu);
    for (let a = 0x00401890; a < 0x004019f8; a++) {
      const v = rb();
      pokeMem(cpu, a, 1, v);
      stateInst.workRam[a - 0x400000] = v;
    }
    // Ring + counter restano a 0 (richiesto from the thunk: parte da 0).

    callFunction(cpu, FUN_190EE, []);
    const binArray = readArrayBin(cpu);
    const binRing = readRingBin(cpu);

    // Run TS
    a9ns.array9ClearAndDispatch(stateInst, subs);
    const tsArray = readArrayTs(stateInst);
    const tsRing = readRingTs(stateInst);

    // Compare
    const diffArr = diffBytes(binArray, tsArray, 0x00401890);
    const diffRing = diffBytes(binRing.ring, tsRing.ring, RING_BASE);
    const counterMatch = binRing.counter === tsRing.counter;

    if (diffArr === null && diffRing === null && counterMatch) {
      ok++;
      if (tc === 0 && binRing.counter !== 72) {
        console.log(`  ERROR (tc=0): counter expected 72, got ${binRing.counter}`);
        ok--;
      }
    } else if (firstFail === null) {
      if (diffArr !== null) {
        firstFail = { tc, where: "array", offset: diffArr.offset, bin: diffArr.bin, ts: diffArr.ts };
      } else if (diffRing !== null) {
        firstFail = { tc, where: "ring", offset: diffRing.offset, bin: diffRing.bin, ts: diffRing.ts };
      } else {
        firstFail = { tc, where: "counter", offset: -1, bin: binRing.counter, ts: tsRing.counter };
      }
    }
  }

  console.log(`  Match: ${ok}/${total} = ${((ok / total) * 100).toFixed(1)}%`);
  if (firstFail) {
    console.log(`  First fail tc=${firstFail.tc} where=${firstFail.where}`);
    if (firstFail.offset >= 0) {
      console.log(`    @ 0x${firstFail.offset.toString(16)}: bin=0x${firstFail.bin.toString(16)} ts=0x${firstFail.ts.toString(16)}`);
    } else {
      console.log(`    bin=0x${firstFail.bin.toString(16)} ts=0x${firstFail.ts.toString(16)}`);
    }
  }

  disposeCpu(cpu);
  exit(ok === total ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  exit(1);
});
