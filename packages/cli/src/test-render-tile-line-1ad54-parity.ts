#!/usr/bin/env node
/**
 * test-render-tile-line-1ad54-parity.ts — differential FUN_0001AD54 vs
 * `renderTileLine1AD54`.
 *
 * `FUN_0001AD54` (982 byte, 0x01AD54-0x01B12A): tile-line renderer.
 * a direction table in the ROM @0x1ECEA, and a data stream via pointer-table
 * anchored at *(0x400474).
 *
 * Parity strategy:
 *   - Set up workRam with:
 *       * Struct 8-byte @ 0x401000 (arg0).
 *       * PTR_TABLE_ROOT (0x400474) → root-struct @ 0x401080.
 *       * *(0x401080+0x20) → pointer-table @ 0x401100.
 *       * pointer-table[subIdx] → data-stream @ 0x401200 (64 byte, no 0x80).
 *       * Cell buffer zeroed @ 0x400A9C (0x400 byte).
 *       [ptrAbs, d5, d4, limit, flag]).
 *   - Run TS via renderTileLine1AD54(...).
 *   - Compare workRam[0xA9C..0xEA0) (1024 byte) byte-by-byte.
 *   - Compare also return D0 (low word).
 *
 *   A: flag=0 (early exit, returns only A4)
 *   B: dirIdx 0..3 (row-major), small coordinates, random subMode
 *   C: dirIdx 4..7 (column-major), random params
 *
 *
 * Usage: npx tsx packages/cli/src/test-render-tile-line-1ad54-parity.ts [N]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import {
  state as stateNs,
  bus as busNs,
  renderTileLine1AD54 as renderNs,
} from "@marble-love/engine";
import {
  createCpu,
  callFunction,
  pokeMem,
  peekMem,
  disposeCpu,
} from "./binary-oracle-lib.js";

const FUN_1AD54   = 0x0001ad54;
const FUN_2BC5C   = 0x0002bc5c; // callee at end — stub with RTS

const WORK_RAM_BASE = 0x00400000;

// Layout in workRam
const STRUCT_ABS   = 0x00401000; // struct 8-byte
const ROOT_ABS     = 0x00401080; // root struct (needs +0x20 field)
const PTRTBL_ABS   = 0x00401100;
const DATA_ABS     = 0x00401200; // data stream (64 byte)

const CELL_BUF_OFF = 0x0a9c;
const CELL_BUF_LEN = 0x400; // compare 1024 byte of cell buffer

const PTR_TABLE_ROOT = 0x00400474;

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) >>> 0;
    return ((s >>> 16) & 0xffff) / 0x10000;
  };
}

function randByte(rng: () => number): number {
  return Math.floor(rng() * 256) & 0xff;
}

function randWord(rng: () => number): number {
  return Math.floor(rng() * 0x10000) & 0xffff;
}

interface FailRecord {
  suite: string;
  tc: number;
  firstDiffOff: number;
  binSnap: number[];
  tsSnap: number[];
  retBin: number;
  retTs: number;
}

async function main(): Promise<void> {
  const total = Number(process.argv[2] ?? "500");
  const perSuite = Math.floor(total / 3);
  const remainder = total - perSuite * 3;

  const romPath = resolve("ghidra_project/marble_program.bin");
  if (!existsSync(romPath)) {
    console.error(`error: ROM blob not found at ${romPath}`);
    exit(3);
  }
  const romBuf = Buffer.from(readFileSync(romPath));

  const romView = busNs.emptyRomImage();
  romView.program.set(romBuf.subarray(0, Math.min(romView.program.length, romBuf.length)));

  const stateInst = stateNs.emptyGameState();
  const cpu = await createCpu({ rom: romBuf, state: stateInst });

  // Stub FUN_2BC5C (callee at end of FUN_1AD54) with RTS (opcode 0x4E75).
  pokeMem(cpu, FUN_2BC5C,     1, 0x4e);
  pokeMem(cpu, FUN_2BC5C + 1, 1, 0x75);

  console.log(`\n=== renderTileLine1AD54 (FUN_0001AD54) — ${total} cases ===`);

  const failHolder: { value: FailRecord | null } = { value: null };

  /**
   */
  function pokeLong(abs: number, v: number): void {
    pokeMem(cpu, abs,     1, (v >>> 24) & 0xff);
    pokeMem(cpu, abs + 1, 1, (v >>> 16) & 0xff);
    pokeMem(cpu, abs + 2, 1, (v >>>  8) & 0xff);
    pokeMem(cpu, abs + 3, 1,  v         & 0xff);
    const off = abs - WORK_RAM_BASE;
    stateInst.workRam[off]     = (v >>> 24) & 0xff;
    stateInst.workRam[off + 1] = (v >>> 16) & 0xff;
    stateInst.workRam[off + 2] = (v >>>  8) & 0xff;
    stateInst.workRam[off + 3] =  v         & 0xff;
  }

  function pokeByte(abs: number, v: number): void {
    pokeMem(cpu, abs, 1, v & 0xff);
    stateInst.workRam[abs - WORK_RAM_BASE] = v & 0xff;
  }

  function clearRange(abs: number, len: number): void {
    for (let i = 0; i < len; i++) {
      pokeMem(cpu, abs + i, 1, 0);
      stateInst.workRam[abs - WORK_RAM_BASE + i] = 0;
    }
  }

  /**
   * Generate a Uint8Array for the test parameters and synchronize it
   * onto Musashi + stateInst.
   */
  function setupCase(
    dirIdx: number,
    subIdx: number,
    xBase: number,
    xCount: number,
    yBase: number,
    yCount: number,
    flagsWord: number,
    extraByte: number,
    lookupByte: number,
    dataBytes: Uint8Array,
    d5: number,
    d4: number,
    limit: number,
    flag: number,
  ): void {
    // Zero cell buffer
    clearRange(WORK_RAM_BASE + CELL_BUF_OFF, CELL_BUF_LEN);

    // PTR_TABLE_ROOT → ROOT_ABS
    pokeLong(PTR_TABLE_ROOT, ROOT_ABS);
    // *(ROOT_ABS+0x20) → PTRTBL_ABS
    pokeLong(ROOT_ABS + 0x20, PTRTBL_ABS);
    // PTRTBL_ABS + subIdx*4 → DATA_ABS
    pokeLong(PTRTBL_ABS + subIdx * 4, DATA_ABS);

    // Data stream
    for (let i = 0; i < dataBytes.length; i++) {
      pokeByte(DATA_ABS + i, dataBytes[i]!);
    }

    // Struct 8-byte @ STRUCT_ABS
    pokeByte(STRUCT_ABS + 0, xBase  & 0xff);
    pokeByte(STRUCT_ABS + 1, xCount & 0xff);
    pokeByte(STRUCT_ABS + 2, yBase  & 0xff);
    pokeByte(STRUCT_ABS + 3, yCount & 0xff);
    pokeMem(cpu, STRUCT_ABS + 4, 1, (flagsWord >>> 8) & 0xff);
    pokeMem(cpu, STRUCT_ABS + 5, 1,  flagsWord & 0xff);
    stateInst.workRam[STRUCT_ABS - WORK_RAM_BASE + 4] = (flagsWord >>> 8) & 0xff;
    stateInst.workRam[STRUCT_ABS - WORK_RAM_BASE + 5] = flagsWord & 0xff;
    pokeByte(STRUCT_ABS + 6, extraByte  & 0xff);
    pokeByte(STRUCT_ABS + 7, lookupByte & 0xff);

    // Note: direction table comes from the real ROM @ 0x1ECEA — no patching needed.
    // dirIdx, d5, d4, limit, flag: consumed by callFunction/renderTileLine callers.
    void dirIdx; void d5; void d4; void limit; void flag;
  }

  function runOneCase(
    suite: string,
    tc: number,
    dirIdx: number,
    subIdx: number,
    xBase: number,
    xCount: number,
    yBase: number,
    yCount: number,
    flagsWord: number,
    extraByte: number,
    lookupByte: number,
    dataBytes: Uint8Array,
    d5: number,
    d4: number,
    limit: number,
    flag: number,
  ): boolean {
    cpu.system.setRegister("sp", 0x401f00);

    setupCase(dirIdx, subIdx, xBase, xCount, yBase, yCount,
              flagsWord, extraByte, lookupByte, dataBytes,
              d5, d4, limit, flag);

    const { d0: d0Bin } = callFunction(cpu, FUN_1AD54, [
      STRUCT_ABS >>> 0,
      d5 & 0xffff,
      d4 & 0xffff,
      limit & 0xffff,
      flag & 0xffff,
    ]);
    const retBin = d0Bin & 0xffff;

    const binSnap: number[] = [];
    for (let k = 0; k < CELL_BUF_LEN; k++) {
      binSnap.push(peekMem(cpu, WORK_RAM_BASE + CELL_BUF_OFF + k, 1) & 0xff);
    }

    for (let k = 0; k < CELL_BUF_LEN; k++) {
      stateInst.workRam[CELL_BUF_OFF + k] = 0;
    }

    // Run TS
    const retTs = renderNs.renderTileLine1AD54(
      stateInst, romView,
      STRUCT_ABS, d5, d4, limit, flag,
    ) & 0xffff;

    // Snapshot cell buffer TS
    const tsSnap: number[] = [];
    for (let k = 0; k < CELL_BUF_LEN; k++) {
      tsSnap.push(stateInst.workRam[CELL_BUF_OFF + k]! & 0xff);
    }

    // Compare cell buffer
    let firstDiff = -1;
    for (let k = 0; k < CELL_BUF_LEN; k++) {
      if (binSnap[k] !== tsSnap[k]) {
        firstDiff = k;
        break;
      }
    }
    // Compare return D0 low word
    const retMatch = retBin === retTs;

    if (firstDiff < 0 && retMatch) return true;

    if (failHolder.value === null) {
      failHolder.value = {
        suite, tc,
        firstDiffOff: firstDiff,
        binSnap: binSnap.slice(0, 64),
        tsSnap:  tsSnap.slice(0, 64),
        retBin, retTs,
      };
    }
    return false;
  }


  function genDataStream(rng: () => number, noSentinel = false): Uint8Array {
    const buf = new Uint8Array(64);
    for (let i = 0; i < buf.length; i++) {
      let b = randByte(rng);
      if (noSentinel && b === 0x80) b = 0x7f;
      buf[i] = b;
    }
    return buf;
  }

  // ─── Suite A: flag=0 (early exit) ────────────────────────────────────────
  console.log(`\n=== Suite A: flag=0 (early exit) — ${perSuite} cases ===`);
  const rngA = makeRng(0x1ad54);
  let okA = 0;
  for (let i = 0; i < perSuite; i++) {
    const xBase     = randByte(rngA);
    const xCount    = (randByte(rngA) % 4) + 1;
    const yBase     = randByte(rngA);
    const yCount    = (randByte(rngA) % 4) + 1;
    const flagsWord = randWord(rngA);
    const extraByte = randByte(rngA);
    const lookupByte= randByte(rngA);
    const data      = genDataStream(rngA, true);

    if (runOneCase("A", i,
      (lookupByte & 7), (extraByte & 0x1f),
      xBase, xCount, yBase, yCount,
      flagsWord, extraByte, lookupByte, data,
      randWord(rngA), randWord(rngA), 0x100, /* flag= */ 0)) okA++;
  }
  console.log(`  Match: ${okA}/${perSuite} = ${((okA/perSuite)*100).toFixed(1)}%`);

  // ─── Suite B: dirIdx 0..3, row-major, small coordinates ─────────────────
  console.log(`\n=== Suite B: row-major (dirIdx 0..3) — ${perSuite} cases ===`);
  const rngB = makeRng(0x2ad54);
  let okB = 0;
  for (let i = 0; i < perSuite; i++) {
    const dirIdx  = Math.floor(rngB() * 4); // 0..3
    const subIdx  = Math.floor(rngB() * 8);
    // Use small values to keep cells in range
    const xBase   = Math.floor(rngB() * 10); // 0..9
    const xCount  = Math.floor(rngB() * 3) + 1; // 1..3
    const yBase   = Math.floor(rngB() * 8); // 0..7
    const yCount  = Math.floor(rngB() * 3) + 1; // 1..3
    const flagsWord = randWord(rngB);
    const extraByte = (subIdx & 0x1f) | (randByte(rngB) & 0xe0); // preserve subIdx in low 5 bits
    const lookupByte= (dirIdx & 7) | ((randByte(rngB) & 0x8)); // preserve dirIdx, random subMode
    const data      = genDataStream(rngB, true);
    const d5        = Math.floor(rngB() * 5); // small d5
    const d4        = Math.floor(rngB() * 20); // 0..19 (must be >= xBase for reasonable rows)
    const limit     = 0x2c; // 44 = 2 * 22 (max A1 value we expect)

    if (runOneCase("B", i,
      dirIdx, subIdx,
      xBase, xCount, yBase, yCount,
      flagsWord, extraByte, lookupByte, data,
      d5, d4, limit, /* flag= */ 1)) okB++;
  }
  console.log(`  Match: ${okB}/${perSuite} = ${((okB/perSuite)*100).toFixed(1)}%`);

  // ─── Suite C: dirIdx 4..7, column-major ──────────────────────────────────
  const sizeC = perSuite + remainder;
  console.log(`\n=== Suite C: column-major (dirIdx 4..7) — ${sizeC} cases ===`);
  const rngC = makeRng(0x3ad54);
  let okC = 0;
  for (let i = 0; i < sizeC; i++) {
    const dirIdx  = 4 + Math.floor(rngC() * 4); // 4..7
    const subIdx  = Math.floor(rngC() * 8);
    const xBase   = Math.floor(rngC() * 10);
    const xCount  = Math.floor(rngC() * 3) + 1;
    const yBase   = Math.floor(rngC() * 8);
    const yCount  = Math.floor(rngC() * 3) + 1;
    const flagsWord = randWord(rngC);
    const extraByte = (subIdx & 0x1f) | (randByte(rngC) & 0xe0);
    const lookupByte= (dirIdx & 7) | ((randByte(rngC) & 0x8));
    const data      = genDataStream(rngC, true);
    const d5        = Math.floor(rngC() * 5);
    const d4        = Math.floor(rngC() * 20);
    const limit     = 0x2c;

    if (runOneCase("C", i,
      dirIdx, subIdx,
      xBase, xCount, yBase, yCount,
      flagsWord, extraByte, lookupByte, data,
      d5, d4, limit, /* flag= */ 1)) okC++;
  }
  console.log(`  Match: ${okC}/${sizeC} = ${((okC/sizeC)*100).toFixed(1)}%`);

  const totalOk = okA + okB + okC;
  console.log(`\n=== TOTAL: ${totalOk}/${total} = ${((totalOk/total)*100).toFixed(1)}% ===`);

  if (failHolder.value !== null) {
    const f = failHolder.value;
    console.log(`  First fail (suite ${f.suite} tc=${f.tc}):`);
    console.log(`    return: bin=0x${f.retBin.toString(16)} ts=0x${f.retTs.toString(16)}`);
    if (f.firstDiffOff >= 0) {
      console.log(`    firstDiffOff=0x${f.firstDiffOff.toString(16)}`);
      console.log(`    bin[0..15]: ${f.binSnap.slice(0,16).map(b=>b.toString(16).padStart(2,"0")).join(" ")}`);
      console.log(`    ts [0..15]: ${f.tsSnap.slice(0,16).map(b=>b.toString(16).padStart(2,"0")).join(" ")}`);
    }
  }

  disposeCpu(cpu);
  exit(totalOk === total ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  exit(1);
});
