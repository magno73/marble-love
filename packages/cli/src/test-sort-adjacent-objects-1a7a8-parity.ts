#!/usr/bin/env node
/**
 * test-sort-adjacent-objects-1a7a8-parity.ts — differential FUN_1A7A8 vs
 * `sortAdjacentObjects1A7A8`.
 *
 * `FUN_0001A7A8` (98 byte): single-pass adjacent-pair sweep con stride
 * variabile sopra `workRam[0x3BC..0x3DC]`. Per ogni coppia (A2, A3) con
 * `A3 = A2 + stride`, lookup ROM @ 0x1F0E2 → due pointer a rect-struct in
 * workRam, chiama `FUN_1A80A` (rect compare → 0/1), se != 0 swap dei due
 * byte-index.
 *
 * Strategia parity:
 *   - Setup workRam con un layout valido di rect-struct @ 0x4001DC.. e
 *     ROM lookup pointer corretti (ma random, generati una sola volta come
 *     "configurazione baseline" coerente tra binario e TS).
 *   - Setup workRam[0x3BC..0x3DC] con byte-index random 0..15 (più qualche
 *     0xFF per stoppare il walk a metà) e qualche caso boundary.
 *   - Run binario via `callFunction(0x1A7A8, [strideLong])`.
 *   - Run TS via `sortAdjacentObjects1A7A8(state, rom, stride)`.
 *   - Compara workRam[0x3BC..0x3DC] byte-by-byte tra binario e TS.
 *   - Il restante workRam deve restare INVARIATO (mutation isolata).
 *
 * Uso: npx tsx packages/cli/src/test-sort-adjacent-objects-1a7a8-parity.ts [N]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import {
  state as stateNs,
  bus as busNs,
  sortAdjacentObjects1A7A8 as sortNs,
} from "@marble-love/engine";
import {
  createCpu,
  callFunction,
  pokeMem,
  peekMem,
  disposeCpu,
} from "./binary-oracle-lib.js";

const FUN_1A7A8 = 0x0001a7a8;
const WORK_RAM_BASE = 0x00400000;
const WORK_RAM_SIZE = 0x2000;
const BYTE_ARRAY_ABS = 0x004003bc;
const BYTE_ARRAY_LEN = 0x20;
const RECT_BASE_ABS = 0x004001dc;
const RECT_STRIDE = 0x10; // facciamo struct 16-byte allineata (FUN_1A80A legge solo +0..+0xC)
const RECT_COUNT = 16;

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) >>> 0;
    return ((s >>> 16) & 0xffff) / 0x10000;
  };
}

/** Genera una word signed in range [-128..+127] (small per evitare overflow). */
function randWordSmall(rng: () => number): number {
  return (Math.floor(rng() * 256) - 128) & 0xffff;
}

/**
 * Genera una "configurazione baseline" coerente: scrive 16 rect-struct in
 * workRam @ 0x4001DC..0x4002DC con campi random small + scrive ROM lookup
 * @ 0x1F0E2 per puntare a quei 16 slot. Restituisce il buffer workRam-base.
 */
function setupBaseline(
  workRam: Uint8Array,
  romView: Uint8Array,
  rng: () => number,
): void {
  // Setup ROM lookup table: 16 entry × 4 byte (long BE).
  for (let i = 0; i < RECT_COUNT; i++) {
    const ptr = (RECT_BASE_ABS + i * RECT_STRIDE) >>> 0;
    const off = 0x1f0e2 + i * 4;
    romView[off] = (ptr >>> 24) & 0xff;
    romView[off + 1] = (ptr >>> 16) & 0xff;
    romView[off + 2] = (ptr >>> 8) & 0xff;
    romView[off + 3] = ptr & 0xff;
  }
  // Setup rect struct fields (offsets 2,4,6,8,A,C — 6 word per struct).
  for (let i = 0; i < RECT_COUNT; i++) {
    const base = (RECT_BASE_ABS + i * RECT_STRIDE) - WORK_RAM_BASE;
    for (const fieldOff of [2, 4, 6, 8, 0xa, 0xc]) {
      const w = randWordSmall(rng);
      workRam[base + fieldOff] = (w >>> 8) & 0xff;
      workRam[base + fieldOff + 1] = w & 0xff;
    }
  }
}

/**
 * Setup byte-index array @ workRam[0x3BC..0x3DC] con byte 0..15 + qualche
 * 0xFF random. `numActive` indica quanti byte non-sentinel scrivere (0..32).
 */
function setupByteArray(
  workRam: Uint8Array,
  numActive: number,
  rng: () => number,
): void {
  const baseOff = BYTE_ARRAY_ABS - WORK_RAM_BASE;
  for (let i = 0; i < BYTE_ARRAY_LEN; i++) {
    if (i < numActive) {
      workRam[baseOff + i] = Math.floor(rng() * RECT_COUNT) & 0xff;
    } else {
      workRam[baseOff + i] = 0xff; // sentinel
    }
  }
}

async function main(): Promise<void> {
  const n = Number(process.argv[2] ?? "500");

  const romPath = resolve("ghidra_project/marble_program.bin");
  if (!existsSync(romPath)) {
    console.error(`error: ROM blob not found at ${romPath}`);
    exit(3);
  }
  const romBuf = Buffer.from(readFileSync(romPath));

  // Build romView TS con program "as-is" (no patching: la ROM è readonly per
  // FUN_1A7A8 e FUN_1A80A — non scrivono).
  // Nota: per il test inseriamo nostre 16 lookup pointer SCRIVENDOLE in romBuf.
  // Il binario poi le legge da quella zona modificata. Stesso buffer condiviso
  // con la TS view (rom.program).

  const romView = busNs.emptyRomImage();
  // romView.program ha 0x88000 byte; lo riempiamo con romBuf (può essere più
  // grande, ma 0x88000 è la taglia attesa per program).
  const programLen = Math.min(romView.program.length, romBuf.length);
  romView.program.set(romBuf.subarray(0, programLen));

  const stateInst = stateNs.emptyGameState();
  const cpu = await createCpu({ rom: romBuf, state: stateInst });

  console.log(`\n=== sortAdjacentObjects1A7A8 (FUN_1A7A8) — ${n} casi ===`);

  const rng = makeRng(0x1a7a8);
  let ok = 0;
  let firstFail: {
    i: number;
    stride: number;
    numActive: number;
    binArr: number[];
    tsArr: number[];
    inputArr: number[];
  } | null = null;

  for (let i = 0; i < n; i++) {
    // Reset SP
    cpu.system.setRegister("sp", 0x401f00);

    // Pattern: copertura controllata.
    let stride: number;
    let numActive: number;

    if (i === 0) {
      stride = 1;
      numActive = 0; // tutti FF → exit immediato
    } else if (i === 1) {
      stride = 2;
      numActive = 1; // 1 byte attivo, byte[A3] è FF subito
    } else if (i === 2) {
      stride = 3;
      numActive = 32; // tutti attivi
    } else if (i === 3) {
      // stride=0 caso edge
      stride = 0;
      numActive = 5;
    } else if (i === 4) {
      stride = 1;
      numActive = 16;
    } else {
      // Random
      stride = (Math.floor(rng() * 5) + 1) & 0xff; // stride 1..5
      numActive = Math.floor(rng() * (BYTE_ARRAY_LEN + 1));
    }

    // Genera buffer workRam baseline + byte array.
    const seedBuf = new Uint8Array(WORK_RAM_SIZE);
    setupBaseline(seedBuf, romView.program, rng);
    setupByteArray(seedBuf, numActive, rng);

    // ROM è già stata modificata in-place (romView.program); aggiorniamo
    // il buffer Musashi anche per le entry lookup table (romBuf è il blob
    // letto dal disco e passato al sistema; le scritture in `setupBaseline`
    // hanno toccato romView.program ma NON romBuf, quindi sync esplicita).
    for (let off = 0x1f0e2; off < 0x1f0e2 + RECT_COUNT * 4; off++) {
      pokeMem(cpu, off, 1, romView.program[off]!);
    }

    // Sync seed in Musashi memory + state.workRam.
    for (let k = 0; k < WORK_RAM_SIZE; k++) {
      pokeMem(cpu, WORK_RAM_BASE + k, 1, seedBuf[k]!);
      stateInst.workRam[k] = seedBuf[k]!;
    }

    // Snapshot input array per debug.
    const inputArr: number[] = [];
    const baOff = BYTE_ARRAY_ABS - WORK_RAM_BASE;
    for (let k = 0; k < BYTE_ARRAY_LEN; k++) inputArr.push(seedBuf[baOff + k]!);

    // Run binary: callFunction passa stride come long arg.
    callFunction(cpu, FUN_1A7A8, [stride >>> 0]);

    // Run TS
    sortNs.sortAdjacentObjects1A7A8(stateInst, romView, stride);

    // Read both arrays
    const binArr: number[] = [];
    const tsArr: number[] = [];
    for (let k = 0; k < BYTE_ARRAY_LEN; k++) {
      binArr.push(peekMem(cpu, BYTE_ARRAY_ABS + k, 1) & 0xff);
      tsArr.push(stateInst.workRam[baOff + k]!);
    }

    let match = true;
    for (let k = 0; k < BYTE_ARRAY_LEN; k++) {
      if (binArr[k] !== tsArr[k]) {
        match = false;
        break;
      }
    }

    if (match) {
      ok++;
    } else if (firstFail === null) {
      firstFail = {
        i,
        stride,
        numActive,
        binArr,
        tsArr,
        inputArr,
      };
    }
  }

  console.log(`  Match: ${ok}/${n} = ${((ok / n) * 100).toFixed(1)}%`);
  if (firstFail) {
    console.log(`  First fail @ case ${firstFail.i}:`);
    console.log(
      `    stride=${firstFail.stride} numActive=${firstFail.numActive}`,
    );
    console.log(`    input  : ${firstFail.inputArr.map((b) => b.toString(16).padStart(2, "0")).join(" ")}`);
    console.log(`    binArr : ${firstFail.binArr.map((b) => b.toString(16).padStart(2, "0")).join(" ")}`);
    console.log(`    tsArr  : ${firstFail.tsArr.map((b) => b.toString(16).padStart(2, "0")).join(" ")}`);
  }

  // Verifica accessoria: workRam fuori 0x3BC..0x3DC non viene modificata.
  cpu.system.setRegister("sp", 0x401f00);
  const buf = new Uint8Array(WORK_RAM_SIZE);
  const verifyRng = makeRng(0xdeadbeef);
  setupBaseline(buf, romView.program, verifyRng);
  setupByteArray(buf, 16, verifyRng);
  for (let k = 0; k < WORK_RAM_SIZE; k++) {
    pokeMem(cpu, WORK_RAM_BASE + k, 1, buf[k]!);
  }
  callFunction(cpu, FUN_1A7A8, [1]);
  let modifiedOutside = 0;
  for (let k = 0; k < 0x1e00; k++) {
    if (k >= (BYTE_ARRAY_ABS - WORK_RAM_BASE) && k < (BYTE_ARRAY_ABS - WORK_RAM_BASE + BYTE_ARRAY_LEN)) {
      // Inside the byte array → swap legitimate.
      continue;
    }
    const got = peekMem(cpu, WORK_RAM_BASE + k, 1) & 0xff;
    if (got !== buf[k]) modifiedOutside++;
  }
  if (modifiedOutside > 0) {
    console.log(
      `  WARN: binario ha modificato ${modifiedOutside} byte di workRam fuori dall'array (atteso 0)`,
    );
  } else {
    console.log(`  OK: workRam fuori dal byte array non modificata.`);
  }

  disposeCpu(cpu);
  exit(ok === n ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  exit(1);
});
