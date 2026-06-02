#!/usr/bin/env node
/**
 * test-helper-18f46-parity.ts — differential FUN_18F46 vs `helper18F46`.
 *
 *
 * **Parity strategy**:
 *   1. Setup ROM lookup-table @ 0x1F0E2 pointing to the 16 slots @ 0x4001DC
 *      (14-byte stride) - identical to `test-slot-insert-sorted-18e6c-parity.ts`.
 *
 *   2. Setup workRam:
 *      - Rect-slot (16 × 14 byte) @ 0x4001DC: first byte per slot = 0 (free)
 *        the corresponding slot has struct[0]=slot_typeCode,
 *        struct[1]=slot_subIdx.
 *
 *      → argsLong = [typeCode, subIdx].
 *
 *   4. Run TS via `helper18F46(state, rom, typeCode, subIdx)`.
 *
 *
 * Usage: npx tsx packages/cli/src/test-helper-18f46-parity.ts [N]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import {
  state as stateNs,
  bus as busNs,
  helper18F46 as helper18F46Ns,
} from "@marble-love/engine";
import {
  createCpu,
  callFunction,
  pokeMem,
  peekMem,
  disposeCpu,
} from "./binary-oracle-lib.js";
import type { CpuSession } from "./binary-oracle-lib.js";

const FUN_18F46 = 0x00018f46;

const WORK_RAM_BASE = 0x00400000;
const WORK_RAM_SIZE = 0x2000;

const BYTE_ARRAY_ABS = 0x004003bc;
const BYTE_ARRAY_LEN = 0x20;
const RECT_SLOT_ABS = 0x004001dc;
const RECT_SLOT_STRIDE = 0x0e; // 14 byte/slot
const RECT_SLOT_COUNT = 16;
const RECT_AREA_LEN = 0x1b2; // 0x4001DC + 0x1B2 = 0x40038E

// ROM lookup table base.
const ROM_LOOKUP_OFF = 0x1f0e2;

/** Setup ROM lookup table @ 0x1F0E2 → 16 slot @ 0x4001DC stride 14 byte. */
function setupRomLookup(romView: Uint8Array): void {
  for (let i = 0; i < RECT_SLOT_COUNT; i++) {
    const ptr = (RECT_SLOT_ABS + i * RECT_SLOT_STRIDE) >>> 0;
    const off = ROM_LOOKUP_OFF + i * 4;
    romView[off] = (ptr >>> 24) & 0xff;
    romView[off + 1] = (ptr >>> 16) & 0xff;
    romView[off + 2] = (ptr >>> 8) & 0xff;
    romView[off + 3] = ptr & 0xff;
  }
}

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) >>> 0;
    return ((s >>> 16) & 0xffff) / 0x10000;
  };
}

/** Generate a small signed word in range [-32..+31]. */
function randWordSmall(rng: () => number): number {
  return (Math.floor(rng() * 64) - 32) & 0xffff;
}

/**
 * Setup workRam baseline:
 *     typeCode_table[idx], struct[1] = subIdx_table[idx].
 *   - rect-slot[i].fields[2..C]: random small words.
 *
 */
function setupBaseline(
  workRam: Uint8Array,
  numActive: number,
  typeTable: Uint8Array, // typeTable[i] = typeCode of slot i
  subTable: Uint8Array,  // subTable[i]  = subIdx  of slot i
  rng: () => number,
): void {
  // Rect-slot fields (offsets 2,4,6,8,A,C — 6 word per slot).
  for (let i = 0; i < RECT_SLOT_COUNT; i++) {
    const base = (RECT_SLOT_ABS + i * RECT_SLOT_STRIDE) - WORK_RAM_BASE;
    workRam[base] = 0;     // struct[0] = 0 (free by default)
    workRam[base + 1] = 0; // struct[1] = 0
    for (const off of [2, 4, 6, 8, 0xa, 0xc]) {
      const w = randWordSmall(rng);
      workRam[base + off] = (w >>> 8) & 0xff;
      workRam[base + off + 1] = w & 0xff;
    }
  }

  const baOff = BYTE_ARRAY_ABS - WORK_RAM_BASE;
  for (let i = 0; i < BYTE_ARRAY_LEN; i++) {
    if (i < numActive) {
      // Slot index: random 0..15.
      const idx = Math.floor(rng() * RECT_SLOT_COUNT) & 0xff;
      workRam[baOff + i] = idx;
      // Assign typeCode and subIdx to this slot (overwrite previous if duplicate).
      const slotBase = (RECT_SLOT_ABS + idx * RECT_SLOT_STRIDE) - WORK_RAM_BASE;
      workRam[slotBase] = typeTable[idx]!;
      workRam[slotBase + 1] = subTable[idx]!;
    } else {
      workRam[baOff + i] = 0xff;
    }
  }
}

/** Read byte range from Musashi memory. */
function readBin(cpu: CpuSession, abs: number, len: number): Uint8Array {
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i++) out[i] = peekMem(cpu, abs + i, 1) & 0xff;
  return out;
}

/** Read byte range from TS workRam. */
function readTs(
  state: ReturnType<typeof stateNs.emptyGameState>,
  abs: number,
  len: number,
): Uint8Array {
  const out = new Uint8Array(len);
  const off = abs - WORK_RAM_BASE;
  for (let i = 0; i < len; i++) out[i] = state.workRam[off + i] ?? 0;
  return out;
}

/** Diff byte-by-byte; returns first mismatch or null. */
function diffBytes(
  a: Uint8Array,
  b: Uint8Array,
): { offset: number; aV: number; bV: number } | null {
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    if (a[i] !== b[i]) return { offset: i, aV: a[i]!, bV: b[i]! };
  }
  return null;
}

async function main(): Promise<void> {
  const total = Number(process.argv[2] ?? "500");

  const romPath = resolve("ghidra_project/marble_program.bin");
  if (!existsSync(romPath)) {
    console.error(`error: ROM blob not found at ${romPath}`);
    exit(3);
  }
  const romBuf = Buffer.from(readFileSync(romPath));

  const romView = busNs.emptyRomImage();
  const programLen = Math.min(romView.program.length, romBuf.length);
  romView.program.set(romBuf.subarray(0, programLen));
  // Override ROM lookup table with workRam-pointing entries.
  setupRomLookup(romView.program);

  const stateInst = stateNs.emptyGameState();
  const cpu = await createCpu({ rom: romBuf, state: stateInst });

  // Sync ROM lookup-table into Musashi memory (romBuf was NOT modified by
  // setupRomLookup; we need to poke the patched bytes into Musashi).
  for (let off = ROM_LOOKUP_OFF; off < ROM_LOOKUP_OFF + RECT_SLOT_COUNT * 4; off++) {
    pokeMem(cpu, off, 1, romView.program[off]!);
  }

  console.log(`\n=== helper18F46 (FUN_18F46) — ${total} cases ===`);

  const rng = makeRng(0x18f46);
  let ok = 0;
  interface FailRec {
    tc: number;
    typeCode: number;
    subIdx: number;
    numActive: number;
    where: "byteArray" | "slotArea";
    offset: number;
    bin: number;
    ts: number;
    inputBytes: string;
  }
  let firstFail: FailRec | null = null;

  for (let tc = 0; tc < total; tc++) {
    cpu.system.setRegister("sp", 0x401f00);

    // For each test case, generate typeTable and subTable (one type/sub per slot).
    const typeTable = new Uint8Array(RECT_SLOT_COUNT);
    const subTable = new Uint8Array(RECT_SLOT_COUNT);
    for (let i = 0; i < RECT_SLOT_COUNT; i++) {
      typeTable[i] = Math.floor(rng() * 256) & 0xff;
      subTable[i] = Math.floor(rng() * 256) & 0xff;
    }

    let typeCode: number;
    let subIdx: number;
    let numActive: number;

    if (tc === 0) {
      typeCode = 0x01; subIdx = 0x00; numActive = 0;
    } else if (tc === 1) {
      // One-entry list, search match.
      numActive = 1;
      typeCode = typeTable[0]!; subIdx = subTable[0]!;
    } else if (tc === 2) {
      // One-entry list, no match.
      numActive = 1;
      typeCode = 0xff; subIdx = 0xff;
    } else if (tc === 3) {
      // Full list (16 entries), center match.
      numActive = 8;
      typeCode = typeTable[Math.floor(rng() * RECT_SLOT_COUNT)]!;
      subIdx = typeCode;
    } else if (tc === 4) {
      numActive = 31;
      typeCode = 0x00; subIdx = 0x00;
    } else {
      // Random.
      numActive = Math.floor(rng() * (BYTE_ARRAY_LEN + 1));
      typeCode = Math.floor(rng() * 256) & 0xff;
      subIdx = Math.floor(rng() * 256) & 0xff;
    }

    // Setup workRam baseline.
    const seedBuf = new Uint8Array(WORK_RAM_SIZE);
    setupBaseline(seedBuf, numActive, typeTable, subTable, rng);

    for (let k = 0; k < WORK_RAM_SIZE; k++) {
      pokeMem(cpu, WORK_RAM_BASE + k, 1, seedBuf[k]!);
      stateInst.workRam[k] = seedBuf[k]!;
    }

    const baOff = BYTE_ARRAY_ABS - WORK_RAM_BASE;
    const inputBytes: number[] = [];
    for (let k = 0; k < BYTE_ARRAY_LEN; k++) inputBytes.push(seedBuf[baOff + k]!);

    callFunction(cpu, FUN_18F46, [typeCode >>> 0, subIdx >>> 0]);

    // Run TS.
    helper18F46Ns.helper18F46(stateInst, romView, typeCode, subIdx);

    const binByteArray = readBin(cpu, BYTE_ARRAY_ABS, BYTE_ARRAY_LEN);
    const tsByteArray = readTs(stateInst, BYTE_ARRAY_ABS, BYTE_ARRAY_LEN);
    const diffBA = diffBytes(binByteArray, tsByteArray);

    // Compare slot-area (0x1B2 byte = rectangle area @ 0x4001DC..0x40038E).
    const binSlots = readBin(cpu, RECT_SLOT_ABS, RECT_AREA_LEN);
    const tsSlots = readTs(stateInst, RECT_SLOT_ABS, RECT_AREA_LEN);
    const diffSL = diffBytes(binSlots, tsSlots);

    if (diffBA === null && diffSL === null) {
      ok++;
    } else if (firstFail === null) {
      const inputStr = inputBytes
        .map((b) => b.toString(16).padStart(2, "0"))
        .join(" ");
      if (diffBA !== null) {
        firstFail = {
          tc,
          typeCode,
          subIdx,
          numActive,
          where: "byteArray",
          offset: diffBA.offset,
          bin: diffBA.aV,
          ts: diffBA.bV,
          inputBytes: inputStr,
        };
      } else if (diffSL !== null) {
        firstFail = {
          tc,
          typeCode,
          subIdx,
          numActive,
          where: "slotArea",
          offset: diffSL.offset,
          bin: diffSL.aV,
          ts: diffSL.bV,
          inputBytes: inputStr,
        };
      }
    }
  }

  console.log(`  Match: ${ok}/${total} = ${((ok / total) * 100).toFixed(1)}%`);
  if (firstFail) {
    console.log(
      `  First fail tc=${firstFail.tc}` +
        ` typeCode=0x${firstFail.typeCode.toString(16)}` +
        ` subIdx=0x${firstFail.subIdx.toString(16)}` +
        ` numActive=${firstFail.numActive}`,
    );
    console.log(
      `    where=${firstFail.where}` +
        ` offset=0x${firstFail.offset.toString(16)}` +
        ` bin=0x${firstFail.bin.toString(16)}` +
        ` ts=0x${firstFail.ts.toString(16)}`,
    );
    console.log(`    input byteArr: ${firstFail.inputBytes}`);
  }

  disposeCpu(cpu);
  exit(ok === total ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  exit(1);
});
