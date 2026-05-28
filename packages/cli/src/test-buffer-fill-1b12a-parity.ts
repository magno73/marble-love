#!/usr/bin/env node
/**
 * test-buffer-fill-1b12a-parity.ts — differential FUN_0001B12A vs `bufferFill1B12A`.
 *
 * **Strategia**:
 *   For each test case:
 *   1. Scelgo typeCode e subIdx.
 *   2. Read pointer tables from ROM to find the A1 object address
 *      (o A2 per tipi 4/0xe).
 *   3. Write random values into relevant fields of the base object
 *      (A1[0xc], A1[0x10], A1[0x14], A1[0x1a], A1[0x1c]/[0x3a]/[0x3e]/[0x58]).
 *   4. For types with sub-obj pointer, write NULL_PTR (0xffffffff) or
 *      a valid pointer to a work RAM sub-object at a random offset.
 *   5. Run binary and TS with the same configuration and compare the
 *      12 byte di output.
 *
 * This approach ensures that all memory reads stay in valid regions.
 * ben definite (ROM o work-RAM), eliminando le discrepanze da pointer garbage.
 *
 * Uso: npx tsx packages/cli/src/test-buffer-fill-1b12a-parity.ts [N]
 *      default N=500
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import {
  state as stateNs,
  bus as busNs,
  bufferFill1B12A as bfNs,
} from "@marble-love/engine";
import {
  createCpu,
  callFunction,
  pokeMem,
  peekMem,
  disposeCpu,
} from "./binary-oracle-lib.js";
import type { CpuSession } from "./binary-oracle-lib.js";

const FUN_1B12A = 0x0001b12a;

// Where we'll put the localRect buffer in binary work-RAM
const RECT_BUF_ADDR = 0x00401e00;
// Where we'll put the sub-object struct in work-RAM (for pointer-chain tests)
const SUB_OBJ_ADDR = 0x00401d00;
// Where we'll put the sub-object pointer LIST in work-RAM
const SUB_PTR_LIST_ADDR = 0x00401d80;

const WORK_RAM_BASE = 0x00400000;
const WORK_RAM_SIZE = 0x2000;

const NULL_PTR = 0xffffffff;

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) >>> 0;
    return ((s >>> 16) & 0xffff) / 0x10000;
  };
}

function findRomBlobPath(): string {
  const candidates = [
    process.env.MARBLE_ROM_BLOB,
    resolve("ghidra_project/marble_program.bin"),
    resolve("../marble-love/ghidra_project/marble_program.bin"),
  ].filter((p): p is string => p !== undefined && p.length > 0);
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  throw new Error("ROM blob not found");
}

/** Read ROM 32-bit BE at byte offset. */
function romR32(romBuf: Buffer, off: number): number {
  return (
    (((romBuf[off] ?? 0) & 0xff) << 24) |
    (((romBuf[off + 1] ?? 0) & 0xff) << 16) |
    (((romBuf[off + 2] ?? 0) & 0xff) << 8) |
    ((romBuf[off + 3] ?? 0) & 0xff)
  ) >>> 0;
}

/** Poke single byte to binary oracle. */
function poke8(cpu: CpuSession, abs: number, v: number): void {
  pokeMem(cpu, abs, 1, v & 0xff);
}

/** Poke 16-bit BE to binary oracle. */
function poke16(cpu: CpuSession, abs: number, v: number): void {
  pokeMem(cpu, abs, 2, v & 0xffff);
}

/** Poke 32-bit BE to binary oracle. */
function poke32(cpu: CpuSession, abs: number, v: number): void {
  pokeMem(cpu, abs, 4, v >>> 0);
}

/** Poke 16-bit BE to TS state.workRam. */
function stateW16(state: ReturnType<typeof stateNs.emptyGameState>, abs: number, v: number): void {
  const off = abs - WORK_RAM_BASE;
  state.workRam[off]     = (v >>> 8) & 0xff;
  state.workRam[off + 1] = v & 0xff;
}

/** Poke 32-bit BE to TS state.workRam. */
function stateW32(state: ReturnType<typeof stateNs.emptyGameState>, abs: number, v: number): void {
  const off = abs - WORK_RAM_BASE;
  state.workRam[off]     = (v >>> 24) & 0xff;
  state.workRam[off + 1] = (v >>> 16) & 0xff;
  state.workRam[off + 2] = (v >>> 8)  & 0xff;
  state.workRam[off + 3] = v & 0xff;
}

/** Poke single byte to both binary oracle and TS state. */
function writeBoth8(cpu: CpuSession, state: ReturnType<typeof stateNs.emptyGameState>, abs: number, v: number): void {
  poke8(cpu, abs, v);
  if (abs >= WORK_RAM_BASE && abs < WORK_RAM_BASE + WORK_RAM_SIZE) {
    state.workRam[abs - WORK_RAM_BASE] = v & 0xff;
  }
}

/** Poke 16-bit BE to both binary oracle and TS state. */
function writeBoth16(cpu: CpuSession, state: ReturnType<typeof stateNs.emptyGameState>, abs: number, v: number): void {
  poke16(cpu, abs, v);
  stateW16(state, abs, v);
}

/** Poke 32-bit BE to both binary oracle and TS state. */
function writeBoth32(cpu: CpuSession, state: ReturnType<typeof stateNs.emptyGameState>, abs: number, v: number): void {
  poke32(cpu, abs, v);
  stateW32(state, abs, v);
}

/** Read 12 output bytes from binary oracle at RECT_BUF_ADDR+2. */
function peekOut(cpu: CpuSession): Uint8Array {
  const out = new Uint8Array(12);
  for (let j = 0; j < 12; j++) out[j] = peekMem(cpu, RECT_BUF_ADDR + 2 + j, 1);
  return out;
}

/** Rand signed byte (-128..127). */
function randS8(rng: () => number): number {
  return (Math.floor(rng() * 256) - 128) | 0;
}

/** Rand word (0..0xffff). */
function randW16(rng: () => number): number {
  return Math.floor(rng() * 0x10000) & 0xffff;
}

// ROM pointer table bases
const PT_TYPE1   = 0x1eff6;
const PT_TYPE2   = 0x1effe;
const PT_TYPE4   = 0x1f006;
const PT_DFLT    = 0x1f016;
const PT_TYPE_E  = 0x1f07a;
const PT_TYPE_79 = 0x1f096;
const PT_TYPE_F  = 0x1f0ba;

// Work-RAM array bases for special types
const WR_TYPE29_BASE = 0x401650;
const WR_TYPE2A_BASE = 0x40098c;

/**
 * Set up object base struct at `absBase` (in work-RAM).
 * Writes: word at +0x0c, +0x10, +0x14, byte at +0x1a.
 */
function setupObjBase(
  cpu: CpuSession, state: ReturnType<typeof stateNs.emptyGameState>,
  absBase: number, baseX: number, baseY: number, baseZ: number, flip: number,
): void {
  writeBoth16(cpu, state, absBase + 0x0c, baseX);
  writeBoth16(cpu, state, absBase + 0x10, baseY);
  writeBoth16(cpu, state, absBase + 0x14, baseZ);
  writeBoth8(cpu,  state, absBase + 0x1a, flip);
}

/**
 * Set up sub-object offsets at SUB_OBJ_ADDR.
 * Writes bytes: b4, b5, b6, b7.
 */
function setupSubObj(
  cpu: CpuSession, state: ReturnType<typeof stateNs.emptyGameState>,
  b4: number, b5: number, b6: number, b7: number,
): void {
  writeBoth8(cpu, state, SUB_OBJ_ADDR + 4, b4 & 0xff);
  writeBoth8(cpu, state, SUB_OBJ_ADDR + 5, b5 & 0xff);
  writeBoth8(cpu, state, SUB_OBJ_ADDR + 6, b6 & 0xff);
  writeBoth8(cpu, state, SUB_OBJ_ADDR + 7, b7 & 0xff);
}

/**
 * Write a pointer chain: ptrListAddr → SUB_OBJ_ADDR (valid sub-obj).
 * Also writes the ptrListField → ptrListAddr chain in the object struct.
 */
function setupPtrChain(
  cpu: CpuSession, state: ReturnType<typeof stateNs.emptyGameState>,
  objBase: number, ptrFieldOff: number, useNull: boolean,
): void {
  if (useNull) {
    // Write NULL_PTR at the ptr list slot
    writeBoth32(cpu, state, SUB_PTR_LIST_ADDR, NULL_PTR);
  } else {
    writeBoth32(cpu, state, SUB_PTR_LIST_ADDR, SUB_OBJ_ADDR);
  }
  // Point obj's ptrField → SUB_PTR_LIST_ADDR
  writeBoth32(cpu, state, objBase + ptrFieldOff, SUB_PTR_LIST_ADDR);
}

/**
 * All type codes that have fully deterministic output (no D1/D2/D3 ambiguity).
 * typeCode 3..0xd in the default path all explicitly set D1/D2/D3 in the jump table.
 */
const TYPE_CODES: readonly number[] = [
  0x00, 0x01, 0x02,
  0x04, 0x07, 0x08, 0x09,
  0x0e, 0x0f,
  0x29, 0x2a, 0x2c,
  0x03, 0x05, 0x06, 0x0a, 0x0b, 0x0c, 0x0d,
];

async function main(): Promise<void> {
  const n = Number(process.argv[2] ?? "500");
  const romBlob = readFileSync(findRomBlobPath());

  const tsRom = busNs.emptyRomImage();
  tsRom.program.set(romBlob.subarray(0, tsRom.program.length));

  const tsState = stateNs.emptyGameState();
  const cpu = await createCpu({ rom: romBlob, state: tsState });

  const rng = makeRng(0x1b12a);

  let ok = 0;
  type FailRec = {
    caseNo: number;
    typeCode: number;
    subIdx: number;
    offset: number;
    bin: number;
    ts: number;
  };
  let firstFail: FailRec | null = null;

  for (let i = 0; i < n; i++) {
    const typeCode = TYPE_CODES[i % TYPE_CODES.length]!;
    const subIdx   = Math.floor(rng() * 8) & 0xff;

    // Random values for struct fields
    const baseX = randW16(rng);
    const baseY = randW16(rng);
    const baseZ = randW16(rng);
    const flip  = rng() < 0.5 ? 0x02 : 0x00;
    const b4 = randS8(rng);
    const b5 = randS8(rng);
    const b6 = randS8(rng);
    const b7 = randS8(rng);
    const useNull = rng() < 0.3; // 30% chance of null sub-obj

    // Clear work-RAM
    tsState.workRam.fill(0);
    for (let j = 0; j < WORK_RAM_SIZE; j++) pokeMem(cpu, WORK_RAM_BASE + j, 1, 0);

    // Write localRect with typeCode+subIdx to binary and TS
    poke8(cpu, RECT_BUF_ADDR,     typeCode);
    poke8(cpu, RECT_BUF_ADDR + 1, subIdx);
    for (let j = 2; j < 14; j++) poke8(cpu, RECT_BUF_ADDR + j, 0);

    const tsLocalRect = new Uint8Array(14);
    tsLocalRect[0] = typeCode & 0xff;
    tsLocalRect[1] = subIdx & 0xff;

    // Set up struct data based on typeCode
    if (typeCode === 0 || typeCode === 0x2c) {
      // No struct setup needed
    } else if (typeCode === 1 || typeCode === 2) {
      const tableOff = typeCode === 1 ? PT_TYPE1 : PT_TYPE2;
      const a1 = romR32(romBlob, tableOff + subIdx * 4);
      if (a1 >= WORK_RAM_BASE && a1 < WORK_RAM_BASE + WORK_RAM_SIZE) {
        setupObjBase(cpu, tsState, a1, baseX, baseY, baseZ, flip);
      }
    } else if (typeCode === 4 || typeCode === 0xe) {
      const tableOff = typeCode === 4 ? PT_TYPE4 : PT_TYPE_E;
      const ptrFieldOff = typeCode === 4 ? 0x58 : 0x3a;
      const a2 = romR32(romBlob, tableOff + subIdx * 4);
      if (a2 >= WORK_RAM_BASE && a2 < WORK_RAM_BASE + WORK_RAM_SIZE) {
        setupObjBase(cpu, tsState, a2, baseX, baseY, baseZ, flip);
        setupPtrChain(cpu, tsState, a2, ptrFieldOff, useNull);
        if (!useNull) setupSubObj(cpu, tsState, b4, b5, b6, b7);
      }
    } else if (typeCode === 7 || typeCode === 8 || typeCode === 9) {
      const a1 = romR32(romBlob, PT_TYPE_79 + subIdx * 4);
      if (a1 >= WORK_RAM_BASE && a1 < WORK_RAM_BASE + WORK_RAM_SIZE) {
        setupObjBase(cpu, tsState, a1, baseX, baseY, baseZ, flip);
        setupPtrChain(cpu, tsState, a1, 0x1c, false); // no null for type 7/8/9
        setupSubObj(cpu, tsState, b4, b5, b6, b7);
      }
    } else if (typeCode === 0xf) {
      const a1 = romR32(romBlob, PT_TYPE_F + subIdx * 4);
      if (a1 >= WORK_RAM_BASE && a1 < WORK_RAM_BASE + WORK_RAM_SIZE) {
        setupObjBase(cpu, tsState, a1, baseX, baseY, baseZ, flip);
      }
    } else if (typeCode === 0x29) {
      const base = WR_TYPE29_BASE + (subIdx << 4);
      if (base >= WORK_RAM_BASE && base + 8 < WORK_RAM_BASE + WORK_RAM_SIZE) {
        writeBoth8(cpu, tsState, base + 4, b4 & 0xff);
        writeBoth8(cpu, tsState, base + 5, b5 & 0xff);
        writeBoth16(cpu, tsState, base + 6, baseZ);
      }
    } else if (typeCode === 0x2a) {
      const a1 = WR_TYPE2A_BASE + subIdx * 12;
      if (a1 >= WORK_RAM_BASE && a1 + 6 < WORK_RAM_BASE + WORK_RAM_SIZE) {
        writeBoth16(cpu, tsState, a1 + 0, baseX);
        writeBoth16(cpu, tsState, a1 + 2, baseY);
        writeBoth16(cpu, tsState, a1 + 4, baseZ);
      }
    } else {
      // Default path (3..0xd): use PT_DFLT table
      const a1 = romR32(romBlob, PT_DFLT + subIdx * 4);
      if (a1 >= WORK_RAM_BASE && a1 < WORK_RAM_BASE + WORK_RAM_SIZE) {
        setupObjBase(cpu, tsState, a1, baseX, baseY, baseZ, flip);
        // All default types 3,5,6,10,11,12,13 use sub-obj via A1[0x3e]
        setupPtrChain(cpu, tsState, a1, 0x3e, useNull);
        if (!useNull) setupSubObj(cpu, tsState, b4, b5, b6, b7);
      }
    }

    // Run binary
    cpu.system.setRegister("sp", 0x00401f80);
    callFunction(cpu, FUN_1B12A, [RECT_BUF_ADDR], 200_000);
    const binOut = peekOut(cpu);

    // Run TS
    bfNs.bufferFill1B12A(tsState, tsRom, tsLocalRect);

    // Compare output bytes
    let match = true;
    for (let j = 0; j < 12; j++) {
      const b = binOut[j] ?? 0;
      const t = tsLocalRect[j + 2] ?? 0;
      if (b !== t) {
        firstFail ??= { caseNo: i, typeCode, subIdx, offset: j + 2, bin: b, ts: t };
        match = false;
        break;
      }
    }
    if (match) ok++;
  }

  console.log(`\n=== bufferFill1B12A (FUN_0001B12A) — ${n} cases ===`);
  console.log(`  Match: ${ok}/${n} = ${((ok / n) * 100).toFixed(1)}%`);
  if (firstFail) console.log(`  First fail: ${JSON.stringify(firstFail)}`);

  disposeCpu(cpu);
  exit(ok === n ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  exit(1);
});
