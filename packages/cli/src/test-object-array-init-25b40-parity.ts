#!/usr/bin/env node
/**
 * test-object-array-init-25b40-parity.ts — differential FUN_00025B40 vs
 * objectArrayInit25B40.
 *
 * `FUN_00025B40` (110 bytes): populates 3 arrays (A1+0x74, +0x84, +0x94, each
 * 8 words) by reading 2 ROM tables @ 0x1D3F4 and 0x1D3FC, then clears A1+0xCA.
 *
 * Parity strategy (no sub-jsr, pure module):
 *   1. For each random case, randomize:
 *        - objPtr in {0x401000, ..., 0x401C00} (12 candidates)
 *        - "scratch" bytes on all the target fields of A1 (for the write check)
 *        - bytes near the target fields (for the no-spill check)
 *   2. Run the real binary @ FUN_00025B40.
 *   3. Run TS objectArrayInit25B40 on the workRam mirror, with the same ROM.
 *   4. Compare the 24 words + 1 byte target on A1 and the neighbors.
 *
 * Usage: npx tsx packages/cli/src/test-object-array-init-25b40-parity.ts [N]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import {
  state as stateNs,
  bus as busNs,
} from "@marble-love/engine";
import type { RomImage } from "@marble-love/engine";
// Direct import from engine src (new module not yet re-exported in
// node_modules @marble-love/engine until a subsequent build/install).
import * as oaiNsRaw from "../../engine/src/object-array-init-25b40.js";
const oaiNs = oaiNsRaw as unknown as {
  objectArrayInit25B40: (
    state: ReturnType<typeof stateNs.emptyGameState>,
    rom: RomImage,
    objPtr: number,
  ) => void;
};
import {
  createCpu,
  callFunction,
  pokeMem,
  peekMem,
  disposeCpu,
} from "./binary-oracle-lib.js";

const FUN_25B40 = 0x00025b40;

const WORK_RAM_BASE = 0x00400000;
const WORK_RAM_SIZE = 0x2000;

// Pointer candidates (well within workRam, leaves margin for the stack at 0x401F00).
const PTR_CANDIDATES = [
  0x00401000, 0x00401100, 0x00401200, 0x00401300,
  0x00401400, 0x00401500, 0x00401600, 0x00401700,
  0x00401800, 0x00401900, 0x00401a00, 0x00401b00,
  0x00401c00,
] as const;

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) >>> 0;
    return ((s >>> 16) & 0xffff) / 0x10000;
  };
}

interface FailRecord {
  i: number;
  ptr: number;
  field: string;
  bin: number;
  ts: number;
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

  // ROM mirror for the TS module; only program 0x1D3F4..0x1D403 is read.
  const tsRom: RomImage = busNs.emptyRomImage();
  tsRom.program.set(romBuf.subarray(0, tsRom.program.length));

  console.log(`\n=== objectArrayInit25B40 (FUN_00025B40) — ${n} cases ===`);

  const rng = makeRng(0x25b40);
  const rb = (): number => Math.floor(rng() * 256) & 0xff;
  const pickPtr = (): number =>
    PTR_CANDIDATES[Math.floor(rng() * PTR_CANDIDATES.length)]!;

  let ok = 0;
  let firstFail: FailRecord | null = null;

  // Written ranges: word @ +0x74..+0xA3 (24 contiguous words) + byte @ +0xCA.
  // Neighbors (untouched offsets): +0x70..+0x73, +0xA4, +0xA5, +0xB0, +0xC0,
  //   +0xC8, +0xC9, +0xCB, +0xCC, +0xCD.
  const NEIGHBORS = [
    0x70, 0x71, 0x72, 0x73,
    0xa4, 0xa5, 0xb0, 0xc0, 0xc8, 0xc9,
    0xcb, 0xcc, 0xcd,
  ] as const;

  // ROM tables read (for the check).
  const TABLE_A_ROM = 0x0001d3f4;
  const TABLE_B_ROM = 0x0001d3fc;

  for (let i = 0; i < n; i++) {
    cpu.system.setRegister("sp", 0x401f00);

    const ptr = pickPtr();
    const off = ptr - WORK_RAM_BASE;

    // Random scratch on A1; every target offset receives a non-zero value.
    const scratchObj = new Uint8Array(0x100);
    for (let k = 0; k < 0x100; k++) scratchObj[k] = rb();

    // Neighbor sentinels, forcing distinctive values.
    const neighborSentinels: Record<number, number> = {};
    for (let idx = 0; idx < NEIGHBORS.length; idx++) {
      const nOff = NEIGHBORS[idx]!;
      const v = (0xc0 + idx) & 0xff;
      neighborSentinels[nOff] = v;
      scratchObj[nOff] = v;
    }

    // ── Setup binary side ──────────────────────────────────────────────
    // Object scratch
    for (let k = 0; k < 0x100; k++) {
      pokeMem(cpu, ptr + k, 1, scratchObj[k]!);
    }

    // ── Mirror to state.workRam ────────────────────────────────────────
    // Reset workRam to avoid cross-contamination from the previous case.
    for (let k = 0; k < WORK_RAM_SIZE; k++) stateInst.workRam[k] = 0;
    // Object scratch in the mirror
    for (let k = 0; k < 0x100; k++) {
      stateInst.workRam[off + k] = scratchObj[k]!;
    }

    // ── Run binary ─────────────────────────────────────────────────────
    callFunction(cpu, FUN_25B40, [ptr]);

    // ── Run TS ─────────────────────────────────────────────────────────
    oaiNs.objectArrayInit25B40(stateInst, tsRom, ptr);

    // ── Comparison ──────────────────────────────────────────────────────
    let fail: FailRecord | null = null;

    // Helper: read BE word from workRam mirror
    const tsReadW = (boff: number): number =>
      (((stateInst.workRam[boff] ?? 0) << 8) |
        (stateInst.workRam[boff + 1] ?? 0)) &
      0xffff;

    const sextByte = (b: number): number =>
      (b >= 0x80 ? b - 0x100 : b) & 0xffff;

    // Array A @ +0x74 .. +0x82 (8 word)
    for (let k = 0; k < 8; k++) {
      const fOff = 0x74 + k * 2;
      const bin = peekMem(cpu, ptr + fOff, 2) & 0xffff;
      const ts = tsReadW(off + fOff);
      const romByte = romBuf[TABLE_A_ROM + k] ?? 0;
      const expected = (sextByte(romByte) << 11) & 0xffff;
      if (bin !== ts || bin !== expected) {
        fail = { i, ptr, field: `arrayA[${k}]@+0x${fOff.toString(16)}`, bin, ts };
        break;
      }
    }
    if (fail) {
      if (firstFail === null) firstFail = fail;
      continue;
    }

    // Array B @ +0x84 .. +0x92 (8 word)
    for (let k = 0; k < 8; k++) {
      const fOff = 0x84 + k * 2;
      const bin = peekMem(cpu, ptr + fOff, 2) & 0xffff;
      const ts = tsReadW(off + fOff);
      const romByte = romBuf[TABLE_B_ROM + k] ?? 0;
      const expected = (sextByte(romByte) << 11) & 0xffff;
      if (bin !== ts || bin !== expected) {
        fail = { i, ptr, field: `arrayB[${k}]@+0x${fOff.toString(16)}`, bin, ts };
        break;
      }
    }
    if (fail) {
      if (firstFail === null) firstFail = fail;
      continue;
    }

    // Array Z @ +0x94 .. +0xA2 (8 word) ← 0
    for (let k = 0; k < 8; k++) {
      const fOff = 0x94 + k * 2;
      const bin = peekMem(cpu, ptr + fOff, 2) & 0xffff;
      const ts = tsReadW(off + fOff);
      if (bin !== ts || bin !== 0) {
        fail = { i, ptr, field: `arrayZ[${k}]@+0x${fOff.toString(16)}`, bin, ts };
        break;
      }
    }
    if (fail) {
      if (firstFail === null) firstFail = fail;
      continue;
    }

    // Byte @ +0xCA ← 0
    {
      const bin = peekMem(cpu, ptr + 0xca, 1) & 0xff;
      const ts = stateInst.workRam[off + 0xca] ?? 0;
      if (bin !== ts || bin !== 0) {
        fail = { i, ptr, field: "byteAtCA@+0xCA", bin, ts };
      }
    }
    if (fail) {
      if (firstFail === null) firstFail = fail;
      continue;
    }

    // Neighbor sentinels must not change.
    let neighborFail: FailRecord | null = null;
    for (const nOff of NEIGHBORS) {
      const expected = neighborSentinels[nOff]!;
      const bin = peekMem(cpu, ptr + nOff, 1) & 0xff;
      const ts = stateInst.workRam[off + nOff] ?? 0;
      if (bin !== ts || bin !== expected) {
        neighborFail = {
          i,
          ptr,
          field: `neighbor@+0x${nOff.toString(16)}`,
          bin,
          ts,
        };
        break;
      }
    }
    if (neighborFail) {
      if (firstFail === null) firstFail = neighborFail;
      continue;
    }

    ok++;
  }

  console.log(`  Match: ${ok}/${n} = ${((ok / n) * 100).toFixed(1)}%`);
  if (firstFail) {
    const f = firstFail;
    console.log(`  First fail @ case ${f.i} ptr=0x${f.ptr.toString(16)}:`);
    console.log(
      `    ${f.field}: bin=0x${f.bin.toString(16)} ts=0x${f.ts.toString(16)}`,
    );
  }

  disposeCpu(cpu);
  exit(ok === n ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  exit(1);
});
