#!/usr/bin/env node
/**
 * test-slot-insert-sorted-18e6c-parity.ts — differential FUN_18E6C vs
 * `slotInsertSorted18E6C`.
 *
 * `FUN_00018E6C` (218 bytes): insert-sort a new rect entry into the
 *
 * **Strategia parity**:
 *   1. Patch `FUN_0001B12A` (rect-builder, ~1244 bytes) with a thunk
 *      derivati da local[0]=D2, local[1]=D3:
 *        - local[2] = local[6] = local[A] = sign-ext word(D2)
 *        - local[4] = local[8] = local[C] = sign-ext word(D3)
 *
 *   2. Setup ROM lookup-table @ 0x1F0E2 puntando ai 16 slot @ 0x4001DC..
 *      (stride 14 byte). Same layout of `test-sort-adjacent-objects-1a7a8`.
 *
 *   3. Setup workRam:
 *      - Slot rect (16 × 14 byte) @ 0x4001DC: random word in offset 2..C.
 *
 *
 *   5. Run TS via `slotInsertSorted18E6C(state, rom, typeCode, subIdx, subs)`.
 *
 *
 * Uso: npx tsx packages/cli/src/test-slot-insert-sorted-18e6c-parity.ts [N]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import {
  state as stateNs,
  bus as busNs,
  slotInsertSorted18E6C as slotNs,
} from "@marble-love/engine";
import {
  createCpu,
  callFunction,
  pokeMem,
  peekMem,
  disposeCpu,
} from "./binary-oracle-lib.js";
import type { CpuSession } from "./binary-oracle-lib.js";

const FUN_18E6C = 0x00018e6c;
const FUN_1B12A = 0x0001b12a;

const WORK_RAM_BASE = 0x00400000;
const WORK_RAM_SIZE = 0x2000;

const BYTE_ARRAY_ABS = 0x004003bc;
const BYTE_ARRAY_LEN = 0x20;
const RECT_SLOT_ABS = 0x004001dc;
const RECT_SLOT_STRIDE = 0x0e; // 14 byte/slot
const RECT_SLOT_COUNT = 16;
const RECT_AREA_LEN = 0x1b2;

/**
 * Patch FUN_1B12A with the thunk deterministico.
 *
 * Thunk (40 byte):
 *
 *   206F 0004     ; move.l (4,SP),A0    A0 = ptr to local
 *   1010          ; move.b (A0),D0      D0.b = local[0] = D2
 *   4880          ; ext.w  D0           D0.w = sign-ext D2
 *   1228 0001     ; move.b (1,A0),D1    D1.b = local[1] = D3
 *   4881          ; ext.w  D1           D1.w = sign-ext D3
 *   3140 0002     ; move.w D0,(2,A0)    local[2..3] = D2_word_BE
 *   3141 0004     ; move.w D1,(4,A0)    local[4..5] = D3_word_BE
 *   3140 0006     ; move.w D0,(6,A0)    local[6..7] = D2_word_BE
 *   3141 0008     ; move.w D1,(8,A0)    local[8..9] = D3_word_BE
 *   3140 000A     ; move.w D0,(0xA,A0)  local[A..B] = D2_word_BE
 *   3141 000C     ; move.w D1,(0xC,A0)  local[C..D] = D3_word_BE
 *   4E75          ; rts
 *
 */
function patchFun1B12A(cpu: CpuSession): void {
  const bytes: number[] = [
    0x20, 0x6f, 0x00, 0x04, // move.l (4,SP),A0
    0x10, 0x10,             // move.b (A0),D0
    0x48, 0x80,             // ext.w  D0
    0x12, 0x28, 0x00, 0x01, // move.b (1,A0),D1
    0x48, 0x81,             // ext.w  D1
    0x31, 0x40, 0x00, 0x02, // move.w D0,(2,A0)
    0x31, 0x41, 0x00, 0x04, // move.w D1,(4,A0)
    0x31, 0x40, 0x00, 0x06, // move.w D0,(6,A0)
    0x31, 0x41, 0x00, 0x08, // move.w D1,(8,A0)
    0x31, 0x40, 0x00, 0x0a, // move.w D0,(0xA,A0)
    0x31, 0x41, 0x00, 0x0c, // move.w D1,(0xC,A0)
    0x4e, 0x75,             // rts
  ];
  for (let i = 0; i < bytes.length; i++) {
    pokeMem(cpu, FUN_1B12A + i, 1, bytes[i]!);
  }
}

/**
 *   local[2..3]  = sign-ext word(D2) BE
 *   local[4..5]  = sign-ext word(D3) BE
 *   local[6..7]  = sign-ext word(D2) BE
 *   local[8..9]  = sign-ext word(D3) BE
 *   local[A..B]  = sign-ext word(D2) BE
 *   local[C..D]  = sign-ext word(D3) BE
 */
function tsFun1B12A(
  _state: ReturnType<typeof stateNs.emptyGameState>,
  d2: number,
  d3: number,
  local: Uint8Array,
): void {
  // Sign-ext byte -> word (16-bit signed, but written BE as 2 unsigned bytes).
  const w2 = d2 & 0x80 ? (0xff00 | d2) & 0xffff : d2 & 0xff;
  const w3 = d3 & 0x80 ? (0xff00 | d3) & 0xffff : d3 & 0xff;
  const writeWordBE = (off: number, w: number): void => {
    local[off] = (w >>> 8) & 0xff;
    local[off + 1] = w & 0xff;
  };
  writeWordBE(2, w2);
  writeWordBE(4, w3);
  writeWordBE(6, w2);
  writeWordBE(8, w3);
  writeWordBE(0xa, w2);
  writeWordBE(0xc, w3);
}

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) >>> 0;
    return ((s >>> 16) & 0xffff) / 0x10000;
  };
}

/** Generate a signed word in range [-128..+127] (small to avoid overflow). */
function randWordSmall(rng: () => number): number {
  return (Math.floor(rng() * 256) - 128) & 0xffff;
}

/** Setup ROM lookup table @ 0x1F0E2 → 16 slot @ 0x4001DC stride 14 byte. */
function setupRomLookup(romView: Uint8Array): void {
  for (let i = 0; i < RECT_SLOT_COUNT; i++) {
    const ptr = (RECT_SLOT_ABS + i * RECT_SLOT_STRIDE) >>> 0;
    const off = 0x1f0e2 + i * 4;
    romView[off] = (ptr >>> 24) & 0xff;
    romView[off + 1] = (ptr >>> 16) & 0xff;
    romView[off + 2] = (ptr >>> 8) & 0xff;
    romView[off + 3] = ptr & 0xff;
  }
}

/**
 *
 * - byteArray[0..0x1F]: i primi `numActive` byte sono indici random 0..15;
 *   compare also for occupied slots.
 */
function setupBaseline(
  workRam: Uint8Array,
  numActive: number,
  slotOccupied: boolean[],
  rng: () => number,
): void {
  // Slot rect fields (offsets 2,4,6,8,A,C — 6 word per slot).
  for (let i = 0; i < RECT_SLOT_COUNT; i++) {
    const base = (RECT_SLOT_ABS + i * RECT_SLOT_STRIDE) - WORK_RAM_BASE;
    // Slot[0] = "occupied" flag.
    workRam[base] = slotOccupied[i] ? 0x80 + i : 0;
    workRam[base + 1] = 0;
    // Slot[2..0xD]: 6 word random small.
    for (const fieldOff of [2, 4, 6, 8, 0xa, 0xc]) {
      const w = randWordSmall(rng);
      workRam[base + fieldOff] = (w >>> 8) & 0xff;
      workRam[base + fieldOff + 1] = w & 0xff;
    }
  }

  const baOff = BYTE_ARRAY_ABS - WORK_RAM_BASE;
  for (let i = 0; i < BYTE_ARRAY_LEN; i++) {
    if (i < numActive) {
      workRam[baOff + i] = Math.floor(rng() * RECT_SLOT_COUNT) & 0xff;
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
  setupRomLookup(romView.program);

  const stateInst = stateNs.emptyGameState();
  const cpu = await createCpu({ rom: romBuf, state: stateInst });
  patchFun1B12A(cpu);

  // Sync ROM lookup-table from romView.program → Musashi memory (because
  // setupRomLookup modified `romView.program` but NOT `romBuf`; the
  for (let off = 0x1f0e2; off < 0x1f0e2 + RECT_SLOT_COUNT * 4; off++) {
    pokeMem(cpu, off, 1, romView.program[off]!);
  }

  const subs: slotNs.SlotInsertSorted18E6CSubs = {
    fun_1b12a: tsFun1B12A,
  };

  console.log(`\n=== slotInsertSorted18E6C (FUN_18E6C) — ${total} cases ===`);

  const rng = makeRng(0x18e6c);
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

    // Pattern: coverage controllata + random.
    let typeCode: number;
    let subIdx: number;
    let numActive: number;
    let slotOccupied: boolean[];

    if (tc === 0) {
      typeCode = 0x2c; subIdx = 0; numActive = 0;
      slotOccupied = new Array<boolean>(RECT_SLOT_COUNT).fill(false);
    } else if (tc === 1) {
      // List with a single element.
      typeCode = 0x04; subIdx = 1; numActive = 1;
      slotOccupied = new Array<boolean>(RECT_SLOT_COUNT).fill(false);
      slotOccupied[0] = true; // slot 0 occupied (corresponds to the only byte)
    } else if (tc === 2) {
      typeCode = 0x29; subIdx = 0; numActive = 0;
      slotOccupied = new Array<boolean>(RECT_SLOT_COUNT).fill(true);
    } else if (tc === 3) {
      typeCode = 0x2a; subIdx = 5; numActive = 16;
      slotOccupied = new Array<boolean>(RECT_SLOT_COUNT).fill(true);
    } else if (tc === 4) {
      typeCode = 0x4; subIdx = 8; numActive = 31;
      slotOccupied = new Array<boolean>(RECT_SLOT_COUNT).fill(false);
    } else {
      // Random.
      typeCode = Math.floor(rng() * 256) & 0xff;
      subIdx = Math.floor(rng() * 256) & 0xff;
      numActive = Math.floor(rng() * (BYTE_ARRAY_LEN + 1));
      slotOccupied = new Array<boolean>(RECT_SLOT_COUNT)
        .fill(false)
        .map(() => rng() < 0.4);
    }

    // Setup workRam baseline.
    const seedBuf = new Uint8Array(WORK_RAM_SIZE);
    setupBaseline(seedBuf, numActive, slotOccupied, rng);

    for (let k = 0; k < WORK_RAM_SIZE; k++) {
      pokeMem(cpu, WORK_RAM_BASE + k, 1, seedBuf[k]!);
      stateInst.workRam[k] = seedBuf[k]!;
    }

    const baOff = BYTE_ARRAY_ABS - WORK_RAM_BASE;
    const inputBytes: number[] = [];
    for (let k = 0; k < BYTE_ARRAY_LEN; k++) inputBytes.push(seedBuf[baOff + k]!);

    callFunction(cpu, FUN_18E6C, [typeCode >>> 0, subIdx >>> 0]);

    // Run TS
    slotNs.slotInsertSorted18E6C(stateInst, romView, typeCode, subIdx, subs);

    const binByteArray = readBin(cpu, BYTE_ARRAY_ABS, BYTE_ARRAY_LEN);
    const tsByteArray = readTs(stateInst, BYTE_ARRAY_ABS, BYTE_ARRAY_LEN);
    const diffBA = diffBytes(binByteArray, tsByteArray);

    // Compare slot-area (224 byte = 16 × 14, but also beyond up to A4+0x1B2 per
    // safety; FUN_18E6C scans up to A4+0x1B2 = 0x4001DC + 0x1B2 = 0x40038E.
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
    console.log(`  First fail tc=${firstFail.tc} typeCode=0x${firstFail.typeCode.toString(16)} subIdx=0x${firstFail.subIdx.toString(16)} numActive=${firstFail.numActive}`);
    console.log(`    where=${firstFail.where} offset=0x${firstFail.offset.toString(16)} bin=0x${firstFail.bin.toString(16)} ts=0x${firstFail.ts.toString(16)}`);
    console.log(`    input byteArr: ${firstFail.inputBytes}`);
  }

  disposeCpu(cpu);
  exit(ok === total ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  exit(1);
});
