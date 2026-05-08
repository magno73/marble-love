#!/usr/bin/env node
/**
 * test-helper-285b0-parity.ts — differential FUN_000285B0 vs `helper285B0` TS replica.
 *
 * FUN_000285B0 (30 istr, 0x58 byte):
 *   1. Looks up score in ROM_SCORE_TABLE[modeByte*2] (signed word at 0x23CD4).
 *   2. Calls objectAccumFlag28608(objPtr, score).
 *   3. Looks up ROM pointer in ROM_PTR_TABLE[modeByte*4] (long at 0x23CF6).
 *   4. Writes 7 fields in the object struct.
 *
 * **Strategy**: set up identical workRam on both sides, call binary (via
 * callFunction) and TS function, then compare the 8 affected memory regions:
 *   - workRam[objOff+0xBC..0xBF]  (long accumulator, from objectAccumFlag28608)
 *   - workRam[0x39C]              (dirty bitmap byte, from objectAccumFlag28608)
 *   - workRam[objOff+0xD4..0xD7]  (ROM pointer long)
 *   - workRam[objOff+0x70]        (byte = 0)
 *   - workRam[objOff+0x68]        (byte = 0)
 *   - workRam[objOff+0x69]        (byte = 0xFF)
 *   - workRam[objOff+0xD8]        (byte = 0x01)
 *
 * Random inputs per case:
 *   - objIdx ∈ {0, 1}
 *   - modeByte ∈ 0..16  (valid range) + occasional out-of-range
 *   - initialAccum: random 32-bit
 *   - flagIdx: 0..7
 *   - initialBitmap: 0..255
 *
 * Usage: npx tsx packages/cli/src/test-helper-285b0-parity.ts [N]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import {
  state as stateNs,
  bus as busNs,
  helper285B0 as helperNs,
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

const FUN_ADDR = 0x000285b0;

const WORK_RAM_BASE = 0x00400000;
const OBJ_BASE_ADDR = WORK_RAM_BASE + 0x18; // 0x400018
const OBJ_STRIDE = 0xe2;
const DIRTY_BITMAP_ADDR = WORK_RAM_BASE + 0x39c;

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
  modeByte: number;
  initialAccum: number;
  flagIdx: number;
  initialBitmap: number;
}

interface Snapshot {
  accum: number;    // long at objPtr+0xBC
  bitmap: number;   // byte at 0x40039C
  ptr: number;      // long at objPtr+0xD4
  b70: number;      // byte at objPtr+0x70
  b68: number;      // byte at objPtr+0x68
  b69: number;      // byte at objPtr+0x69
  bd8: number;      // byte at objPtr+0xD8
}

interface FailRecord {
  i: number;
  field: string;
  bin: number;
  ts: number;
  setup: CaseSetup;
}

function snapshotBinary(cpu: CpuSession, objPtr: number): Snapshot {
  return {
    accum: peekMem(cpu, objPtr + 0xbc, 4) >>> 0,
    bitmap: peekMem(cpu, DIRTY_BITMAP_ADDR, 1) & 0xff,
    ptr: peekMem(cpu, objPtr + 0xd4, 4) >>> 0,
    b70: peekMem(cpu, objPtr + 0x70, 1) & 0xff,
    b68: peekMem(cpu, objPtr + 0x68, 1) & 0xff,
    b69: peekMem(cpu, objPtr + 0x69, 1) & 0xff,
    bd8: peekMem(cpu, objPtr + 0xd8, 1) & 0xff,
  };
}

function snapshotTs(state: stateNs.GameState, objPtr: number): Snapshot {
  const r = state.workRam;
  const objOff = objPtr - WORK_RAM_BASE;
  const readLong = (off: number) =>
    (((r[off] ?? 0) << 24) |
      ((r[off + 1] ?? 0) << 16) |
      ((r[off + 2] ?? 0) << 8) |
      (r[off + 3] ?? 0)) >>>
    0;
  return {
    accum: readLong(objOff + 0xbc),
    bitmap: r[0x39c] ?? 0,
    ptr: readLong(objOff + 0xd4),
    b70: r[objOff + 0x70] ?? 0,
    b68: r[objOff + 0x68] ?? 0,
    b69: r[objOff + 0x69] ?? 0,
    bd8: r[objOff + 0xd8] ?? 0,
  };
}

function compareSnapshots(
  bin: Snapshot,
  ts: Snapshot,
): Array<{ field: string; bin: number; ts: number }> {
  const diffs: Array<{ field: string; bin: number; ts: number }> = [];
  const fields: Array<keyof Snapshot> = [
    "accum", "bitmap", "ptr", "b70", "b68", "b69", "bd8",
  ];
  for (const f of fields) {
    if (bin[f] !== ts[f]) {
      diffs.push({ field: f, bin: bin[f], ts: ts[f] });
    }
  }
  return diffs;
}

async function main(): Promise<void> {
  const n = Number(process.argv[2] ?? "500");

  const romPath = resolve("ghidra_project/marble_program.bin");
  if (!existsSync(romPath)) {
    console.error(`error: ROM blob not found at ${romPath}`);
    exit(3);
  }
  const romBuf = Buffer.from(readFileSync(romPath));

  // Build a RomImage for the TS function (needed for bit-perfect signed-byte indexing)
  const tsRom: RomImage = busNs.emptyRomImage();
  tsRom.program.set(romBuf.subarray(0, tsRom.program.length));

  const stateInst = stateNs.emptyGameState();
  const cpu = await createCpu({ rom: romBuf, state: stateInst });

  console.log(`\n=== helper285B0 (FUN_000285B0) — ${n} casi ===`);
  const rng = makeRng(0x285b0);

  let ok = 0;
  let firstFail: FailRecord | null = null;

  for (let i = 0; i < n; i++) {
    cpu.system.setRegister("sp", 0x401f00);

    // ── Random setup ────────────────────────────────────────────────────────
    const objIdx = Math.floor(rng() * 2) & 1; // 0 or 1
    const objPtr = OBJ_BASE_ADDR + objIdx * OBJ_STRIDE;
    const objOff = objPtr - WORK_RAM_BASE;

    // modeByte: full byte range 0..255 to stress-test signed-byte indexing.
    // The binary uses ext.w on D2b giving signed range -128..127.
    const modeByte = Math.floor(rng() * 256) & 0xff;

    // initialAccum: random 32-bit
    const hi = Math.floor(rng() * 0x10000) & 0xffff;
    const lo = Math.floor(rng() * 0x10000) & 0xffff;
    const initialAccum = ((hi << 16) | lo) >>> 0;

    // flagIdx: 0..7
    const flagIdx = Math.floor(rng() * 8);

    // initialBitmap: 0..255
    const initialBitmap = Math.floor(rng() * 256) & 0xff;

    const setup: CaseSetup = {
      objIdx,
      objPtr,
      modeByte,
      initialAccum,
      flagIdx,
      initialBitmap,
    };

    // ── Initialize memory on both sides ──────────────────────────────────────
    // Long accumulator at objPtr+0xBC
    pokeMem(cpu, objPtr + 0xbc, 4, initialAccum >>> 0);
    const accumOff = objOff + 0xbc;
    stateInst.workRam[accumOff] = (initialAccum >>> 24) & 0xff;
    stateInst.workRam[accumOff + 1] = (initialAccum >>> 16) & 0xff;
    stateInst.workRam[accumOff + 2] = (initialAccum >>> 8) & 0xff;
    stateInst.workRam[accumOff + 3] = initialAccum & 0xff;

    // flagIdx byte at objPtr+0x19
    pokeMem(cpu, objPtr + 0x19, 1, flagIdx);
    stateInst.workRam[objOff + 0x19] = flagIdx;

    // Dirty bitmap at 0x40039C
    pokeMem(cpu, DIRTY_BITMAP_ADDR, 1, initialBitmap);
    stateInst.workRam[0x39c] = initialBitmap;

    // ── Execute binary ────────────────────────────────────────────────────────
    callFunction(cpu, FUN_ADDR, [objPtr >>> 0, modeByte >>> 0]);

    // ── Execute TS ────────────────────────────────────────────────────────────
    helperNs.helper285B0(stateInst, objPtr, modeByte, tsRom);

    // ── Compare ───────────────────────────────────────────────────────────────
    const binSnap = snapshotBinary(cpu, objPtr);
    const tsSnap = snapshotTs(stateInst, objPtr);
    const diffs = compareSnapshots(binSnap, tsSnap);

    if (diffs.length === 0) {
      ok++;
    } else if (firstFail === null) {
      firstFail = { i, field: diffs[0]?.field ?? "?", bin: diffs[0]?.bin ?? 0, ts: diffs[0]?.ts ?? 0, setup };
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
        `modeByte=${f.setup.modeByte} ` +
        `initialAccum=0x${f.setup.initialAccum.toString(16)} ` +
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
