#!/usr/bin/env node
/**
 * test-object-accum-flag-28608-parity.ts — differential FUN_00028608 vs
 * `objectAccumFlag28608` TS replica.
 *
 * FUN_00028608 (7 instr, 0x1C byte):
 *   - Adds arg2 (long) to *(objPtr + 0xBC) in workRam.
 *   - Reads flagIdx byte from *(objPtr + 0x19).
 *   - Sets bit `(1 << flagIdx) & 0xFF` in workRam[0x39C] (dirty bitmap).
 *
 * **Strategy**:
 *   No sub-JSRs — pure workRam mutation. We compare:
 *     1. The long accumulator at objOff + 0xBC (4 bytes).
 *     2. The dirty-bitmap byte at workRam[0x39C].
 *   Both sides are set up with identical random state and run independently.
 *
 * Random inputs per case:
 *   - objIdx ∈ {0, 1}  (so objPtr ∈ {0x400018, 0x400018 + 0xE2})
 *   - initialAccum: random 32-bit unsigned
 *   - value: random 32-bit (treated as signed long)
 *   - flagIdx: random 0..7
 *   - initialBitmap: random 0..255
 *
 * Usage: npx tsx packages/cli/src/test-object-accum-flag-28608-parity.ts [N]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import {
  state as stateNs,
  objectAccumFlag28608 as fn28608Ns,
} from "@marble-love/engine";
import {
  createCpu,
  callFunction,
  pokeMem,
  peekMem,
  disposeCpu,
} from "./binary-oracle-lib.js";

const FUN_28608 = 0x00028608;

const WORK_RAM_BASE = 0x00400000;
const OBJECTS_BASE_ADDR = WORK_RAM_BASE + 0x18; // 0x400018
const OBJECT_STRIDE = 0xe2;
const DIRTY_BITMAP_ADDR = WORK_RAM_BASE + 0x39c; // 0x40039C

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) >>> 0;
    return ((s >>> 16) & 0xffff) / 0x10000;
  };
}

interface CaseSetup {
  objIdx: number;
  objPtr: number;
  initialAccum: number;
  value: number;
  flagIdx: number;
  initialBitmap: number;
}

interface FailRecord {
  i: number;
  field: string;
  bin: number;
  ts: number;
  setup: CaseSetup;
}

async function main(): Promise<void> {
  const n = Number(process.argv[2] ?? "500");

  const romPath = resolve("ghidra_project/marble_program.bin");
  if (!existsSync(romPath)) {
    console.error(`error: ROM blob not found at ${romPath}`);
    exit(3);
  }
  const romBuf = Buffer.from(readFileSync(romPath));

  const stateInst = stateNs.emptyGameState();
  const cpu = await createCpu({ rom: romBuf, state: stateInst });

  console.log(`\n=== objectAccumFlag28608 (FUN_00028608) — ${n} cases ===`);
  const rng = makeRng(0x28608);

  let ok = 0;
  let firstFail: FailRecord | null = null;

  for (let i = 0; i < n; i++) {
    cpu.system.setRegister("sp", 0x401f00);

    // ── Random setup ──────────────────────────────────────────────────────
    const objIdx = Math.floor(rng() * 2); // 0 or 1
    const objPtr = OBJECTS_BASE_ADDR + objIdx * OBJECT_STRIDE;
    const objAddrBin = objPtr;
    const objOff = objPtr - WORK_RAM_BASE;

    // initialAccum: random 32-bit
    const hi = Math.floor(rng() * 0x10000) & 0xffff;
    const lo = Math.floor(rng() * 0x10000) & 0xffff;
    const initialAccum = ((hi << 16) | lo) >>> 0;

    // value: random signed 32-bit (some negative, some positive)
    const vhi = Math.floor(rng() * 0x10000) & 0xffff;
    const vlo = Math.floor(rng() * 0x10000) & 0xffff;
    const value = ((vhi << 16) | vlo) | 0; // signed int32

    // flagIdx: 0..7
    const flagIdx = Math.floor(rng() * 8);

    // initialBitmap: 0..255
    const initialBitmap = Math.floor(rng() * 256) & 0xff;

    const setup: CaseSetup = {
      objIdx,
      objPtr,
      initialAccum,
      value,
      flagIdx,
      initialBitmap,
    };

    // ── Initialize memory on both sides ──────────────────────────────────
    // Long accumulator at objPtr + 0xBC
    pokeMem(cpu, objAddrBin + 0xbc, 4, initialAccum >>> 0);
    const accumOff = objOff + 0xbc;
    stateInst.workRam[accumOff] = (initialAccum >>> 24) & 0xff;
    stateInst.workRam[accumOff + 1] = (initialAccum >>> 16) & 0xff;
    stateInst.workRam[accumOff + 2] = (initialAccum >>> 8) & 0xff;
    stateInst.workRam[accumOff + 3] = initialAccum & 0xff;

    // Flag index byte at objPtr + 0x19
    pokeMem(cpu, objAddrBin + 0x19, 1, flagIdx);
    stateInst.workRam[objOff + 0x19] = flagIdx;

    // Dirty bitmap byte at 0x40039C
    pokeMem(cpu, DIRTY_BITMAP_ADDR, 1, initialBitmap);
    stateInst.workRam[0x39c] = initialBitmap;

    // ── Execute binary ────────────────────────────────────────────────────
    callFunction(cpu, FUN_28608, [objAddrBin >>> 0, value >>> 0]);

    // ── Execute TS ───────────────────────────────────────────────────────
    fn28608Ns.objectAccumFlag28608(stateInst, objPtr, value);

    // ── Compare ──────────────────────────────────────────────────────────
    let fail: FailRecord | null = null;

    // 1) Accumulator long at objOff + 0xBC
    if (fail === null) {
      const binAccum = peekMem(cpu, objAddrBin + 0xbc, 4) >>> 0;
      const tsAccum =
        (((stateInst.workRam[accumOff] ?? 0) << 24) |
          ((stateInst.workRam[accumOff + 1] ?? 0) << 16) |
          ((stateInst.workRam[accumOff + 2] ?? 0) << 8) |
          (stateInst.workRam[accumOff + 3] ?? 0)) >>>
        0;
      if (binAccum !== tsAccum) {
        fail = { i, field: "accum", bin: binAccum, ts: tsAccum, setup };
      }
    }

    // 2) Dirty bitmap byte at 0x40039C
    if (fail === null) {
      const binBitmap = peekMem(cpu, DIRTY_BITMAP_ADDR, 1) & 0xff;
      const tsBitmap = stateInst.workRam[0x39c] ?? 0;
      if (binBitmap !== tsBitmap) {
        fail = { i, field: "bitmap", bin: binBitmap, ts: tsBitmap, setup };
      }
    }

    if (fail === null) {
      ok++;
    } else if (firstFail === null) {
      firstFail = fail;
    }
  }

  console.log(`  Match: ${ok}/${n} = ${((ok / n) * 100).toFixed(1)}%`);
  if (firstFail) {
    const f = firstFail;
    console.log(`  First fail @ case ${f.i}`);
    console.log(
      `    ${f.field}: bin=0x${f.bin.toString(16)} ts=0x${f.ts.toString(16)}`,
    );
    console.log(
      `    setup: objIdx=${f.setup.objIdx} objPtr=0x${f.setup.objPtr.toString(16)} ` +
        `initialAccum=0x${f.setup.initialAccum.toString(16)} ` +
        `value=0x${(f.setup.value >>> 0).toString(16)} ` +
        `flagIdx=${f.setup.flagIdx} bitmap=0x${f.setup.initialBitmap.toString(16)}`,
    );
  }

  disposeCpu(cpu);
  exit(ok === n ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  exit(1);
});
