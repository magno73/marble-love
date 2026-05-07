#!/usr/bin/env node
/**
 * test-mo-block-emit-1a8d2-parity.ts — differential FUN_1A8D2 vs
 * `moBlockEmit1A8D2`.
 *
 * `FUN_0001A8D2` (250 byte): sprite/MO "block emit". Legge un header struct
 * (6 byte usati: byte+0, byte+1, long+8) puntato da arg0, deferenzia il
 * body via `header[+8] & ~1`, e itera un body word-stream (long branch) o
 * triple-stream (short branch, attivato da body[0]==0xFF) emettendo 4
 * word per iter su 4 buffer separati i cui cursor pointer-long vivono in
 * workRam @ 0x4003F6/3FA/3FE/402, più un counter D7 @ 0x400406.
 *
 * Strategia parity:
 *   - Setup workRam con 4 cursor pointer puntanti a sprite-RAM regions
 *     (4×0x80 byte buffer @ 0xA02000/2080/2100/2180), counter D7 random.
 *   - Setup header @ random workRam offset (con byte fields random e
 *     body_ptr → workRam offset random).
 *   - Setup body con count + delta bytes (long-branch) o 0xFF + count +
 *     deltas + N triples (short-branch).
 *   - Run binario via `callFunction(0x1A8D2, [arg0, arg1, arg2, arg3])`.
 *   - Run TS via `moBlockEmit1A8D2(state, arg0, arg1, arg2, arg3, {romRead})`.
 *   - Compara: spriteRam[0xA02000..0xA02200] (i 4 buffer da 0x80 byte
 *     ognuno), workRam[0x3F6..0x408] (cursor + counter), tutto byte-by-byte.
 *
 * Casi:
 *   - i=0: arg0 == -1 (early exit, solo writeback).
 *   - i=1: long-branch, count=1.
 *   - i=2: long-branch, count=8.
 *   - i=3: short-branch (body[0]=0xFF), count=2.
 *   - i=4: short-branch, count=1.
 *   - i=5: long-branch con bit0=1 in body_ptr (D5=0xFF00 decrement).
 *   - i=6: short-branch con bit0=1.
 *   - i=7: header byte negativo (sign-ext test).
 *   - i>=8: random.
 *
 * Uso: npx tsx packages/cli/src/test-mo-block-emit-1a8d2-parity.ts [N]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import {
  state as stateNs,
  bus as busNs,
  moBlockEmit1A8D2 as emitNs,
} from "@marble-love/engine";
import {
  createCpu,
  callFunction,
  pokeMem,
  peekMem,
  disposeCpu,
} from "./binary-oracle-lib.js";

const FUN_1A8D2 = 0x0001a8d2;

const WORK_RAM_BASE = 0x00400000;
const WORK_RAM_SIZE = 0x2000;
const SPRITE_RAM_BASE = 0x00a02000;
const SPRITE_RAM_SIZE = 0x1000;

const CURSOR_A1_ADDR = 0x004003fa;
const CURSOR_A2_ADDR = 0x004003fe;
const CURSOR_A3_ADDR = 0x004003f6;
const CURSOR_A4_ADDR = 0x00400402;
const COUNTER_D7_ADDR = 0x00400406;

/** Cursor iniziali (4 buffer paralleli in sprite-RAM). */
const A1_INIT = 0x00a02000;
const A2_INIT = 0x00a02080;
const A3_INIT = 0x00a02100;
const A4_INIT = 0x00a02180;

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) >>> 0;
    return ((s >>> 16) & 0xffff) / 0x10000;
  };
}

/** Random byte 0..0xFF. */
function randByte(rng: () => number): number {
  return Math.floor(rng() * 256) & 0xff;
}

/** Random word 0..0xFFFF. */
function randWord(rng: () => number): number {
  return Math.floor(rng() * 0x10000) & 0xffff;
}

interface TestCase {
  arg0: number;
  arg1: number;
  arg2: number;
  arg3: number;
  /** Byte da scrivere a workRam offset, e la stessa cosa va su Musashi. */
  workRamSeed: Uint8Array;
}

/**
 * Costruisce un test case. `kind`:
 *   "earlyExit" | "long" | "short" | "long_hi" | "short_hi" | "random"
 */
function makeCase(kind: string, rng: () => number): TestCase {
  const wr = new Uint8Array(WORK_RAM_SIZE);

  // Setup cursor pointers + counter D7 (in workRam).
  const writeLong = (off: number, val: number): void => {
    wr[off] = (val >>> 24) & 0xff;
    wr[off + 1] = (val >>> 16) & 0xff;
    wr[off + 2] = (val >>> 8) & 0xff;
    wr[off + 3] = val & 0xff;
  };
  const writeWord = (off: number, val: number): void => {
    wr[off] = (val >>> 8) & 0xff;
    wr[off + 1] = val & 0xff;
  };

  writeLong(CURSOR_A1_ADDR - WORK_RAM_BASE, A1_INIT);
  writeLong(CURSOR_A2_ADDR - WORK_RAM_BASE, A2_INIT);
  writeLong(CURSOR_A3_ADDR - WORK_RAM_BASE, A3_INIT);
  writeLong(CURSOR_A4_ADDR - WORK_RAM_BASE, A4_INIT);
  writeWord(COUNTER_D7_ADDR - WORK_RAM_BASE, randWord(rng) & 0x7fff);

  if (kind === "earlyExit") {
    return {
      arg0: 0xffffffff,
      arg1: randWord(rng),
      arg2: randWord(rng),
      arg3: randWord(rng),
      workRamSeed: wr,
    };
  }

  // Setup header @ workRam offset 0x1000.
  const headerOff = 0x1000;
  const headerAbs = WORK_RAM_BASE + headerOff;
  wr[headerOff] = randByte(rng); // x_bias_byte
  wr[headerOff + 1] = randByte(rng); // y_bias_byte

  // body_ptr @ workRam offset 0x1100 (with optional bit0).
  const bodyOff = 0x1100;
  const bodyAbs = WORK_RAM_BASE + bodyOff;
  const bit0 = (kind === "long_hi" || kind === "short_hi") ? 1 : 0;
  const bodyPtr = (bodyAbs | bit0) >>> 0;
  writeLong(headerOff + 8, bodyPtr);

  // Random arg words (sign-ext gestita dalla replica).
  const arg1 = randWord(rng);
  const arg2 = randWord(rng);
  const arg3 = randWord(rng);

  // Build body.
  if (kind === "long" || kind === "long_hi") {
    // Long branch: body[0..3] = (count, dx, d4, dy), then N words.
    // Count clamp: 1..16 (per limitare buffer overflow nei buffer 0x80).
    const count = (Math.floor(rng() * 16) + 1) & 0xff;
    wr[bodyOff] = count;
    wr[bodyOff + 1] = randByte(rng);
    wr[bodyOff + 2] = randByte(rng);
    wr[bodyOff + 3] = randByte(rng);
    for (let k = 0; k < count; k++) {
      const w = randWord(rng);
      wr[bodyOff + 4 + k * 2] = (w >>> 8) & 0xff;
      wr[bodyOff + 4 + k * 2 + 1] = w & 0xff;
    }
  } else if (kind === "short" || kind === "short_hi") {
    // Short branch: body[0] = 0xFF, body[1] skip, body[2..3] = (count, dx),
    // then N triples (byte_d4, byte_d2_delta, word).
    const count = (Math.floor(rng() * 16) + 1) & 0xff;
    wr[bodyOff] = 0xff;
    wr[bodyOff + 1] = randByte(rng);
    wr[bodyOff + 2] = count;
    wr[bodyOff + 3] = randByte(rng);
    for (let k = 0; k < count; k++) {
      wr[bodyOff + 4 + k * 4 + 0] = randByte(rng); // byte_d4
      wr[bodyOff + 4 + k * 4 + 1] = randByte(rng); // byte_d2_delta
      const w = randWord(rng);
      wr[bodyOff + 4 + k * 4 + 2] = (w >>> 8) & 0xff;
      wr[bodyOff + 4 + k * 4 + 3] = w & 0xff;
    }
  }

  return {
    arg0: headerAbs,
    arg1,
    arg2,
    arg3,
    workRamSeed: wr,
  };
}

async function main(): Promise<void> {
  const n = Number(process.argv[2] ?? "500");

  const romPath = resolve("ghidra_project/marble_program.bin");
  if (!existsSync(romPath)) {
    console.error(`error: ROM blob not found at ${romPath}`);
    exit(3);
  }
  const romBuf = Buffer.from(readFileSync(romPath));

  const romView = busNs.emptyRomImage();
  const programLen = Math.min(romView.program.length, romBuf.length);
  romView.program.set(romBuf.subarray(0, programLen));

  const stateInst = stateNs.emptyGameState();
  const cpu = await createCpu({ rom: romBuf, state: stateInst });

  console.log(`\n=== moBlockEmit1A8D2 (FUN_1A8D2) — ${n} casi ===`);

  const rng = makeRng(0x1a8d2);
  let ok = 0;
  let firstFail: {
    i: number;
    kind: string;
    arg0: number;
    arg1: number;
    arg2: number;
    arg3: number;
    binSprite: number[];
    tsSprite: number[];
    binCursors: number[];
    tsCursors: number[];
  } | null = null;

  // ROM read function for TS replica (rom is read-only, never modified).
  const romRead = (off: number): number => romView.program[off] ?? 0;

  for (let i = 0; i < n; i++) {
    // Reset SP
    cpu.system.setRegister("sp", 0x401f00);

    // Pick kind.
    let kind: string;
    if (i === 0) kind = "earlyExit";
    else if (i === 1 || i === 2) kind = "long";
    else if (i === 3 || i === 4) kind = "short";
    else if (i === 5) kind = "long_hi";
    else if (i === 6) kind = "short_hi";
    else if (i === 7) kind = "long";  // verifica robustezza
    else {
      const r = rng();
      kind = r < 0.05 ? "earlyExit"
           : r < 0.45 ? "long"
           : r < 0.85 ? "short"
           : r < 0.93 ? "long_hi"
           : "short_hi";
    }

    const tc = makeCase(kind, rng);

    // Sync seed in Musashi memory + state.workRam.
    for (let k = 0; k < WORK_RAM_SIZE; k++) {
      pokeMem(cpu, WORK_RAM_BASE + k, 1, tc.workRamSeed[k]!);
      stateInst.workRam[k] = tc.workRamSeed[k]!;
    }
    // Clear sprite-RAM (entrambi).
    for (let k = 0; k < SPRITE_RAM_SIZE; k++) {
      pokeMem(cpu, SPRITE_RAM_BASE + k, 1, 0);
      stateInst.spriteRam[k] = 0;
    }

    // Call binario: arg0 (long), arg1 (long, only word read), arg2, arg3.
    callFunction(cpu, FUN_1A8D2, [
      tc.arg0 >>> 0,
      tc.arg1 >>> 0,
      tc.arg2 >>> 0,
      tc.arg3 >>> 0,
    ]);

    // Run TS
    emitNs.moBlockEmit1A8D2(
      stateInst,
      tc.arg0,
      tc.arg1,
      tc.arg2,
      tc.arg3,
      { romRead },
    );

    // Compare sprite-RAM byte-by-byte (interi 0x1000 byte).
    const binSprite: number[] = [];
    const tsSprite: number[] = [];
    let match = true;
    for (let k = 0; k < SPRITE_RAM_SIZE; k++) {
      const b = peekMem(cpu, SPRITE_RAM_BASE + k, 1) & 0xff;
      const t = stateInst.spriteRam[k]! & 0xff;
      if (b !== t) {
        match = false;
        if (binSprite.length < 64) {
          binSprite.push(b);
          tsSprite.push(t);
        }
      }
    }

    // Compare workRam[0x3F6..0x408] (cursor + counter).
    const binCursors: number[] = [];
    const tsCursors: number[] = [];
    for (let k = 0x3f6; k < 0x408; k++) {
      const b = peekMem(cpu, WORK_RAM_BASE + k, 1) & 0xff;
      const t = stateInst.workRam[k]! & 0xff;
      binCursors.push(b);
      tsCursors.push(t);
      if (b !== t) match = false;
    }

    if (match) {
      ok++;
    } else if (firstFail === null) {
      firstFail = {
        i,
        kind,
        arg0: tc.arg0,
        arg1: tc.arg1,
        arg2: tc.arg2,
        arg3: tc.arg3,
        binSprite,
        tsSprite,
        binCursors,
        tsCursors,
      };
    }
  }

  console.log(`  Match: ${ok}/${n} = ${((ok / n) * 100).toFixed(1)}%`);
  if (firstFail) {
    console.log(`  First fail @ case ${firstFail.i} (kind=${firstFail.kind}):`);
    console.log(
      `    arg0=0x${firstFail.arg0.toString(16)} arg1=0x${firstFail.arg1.toString(16).padStart(4, "0")}`
      + ` arg2=0x${firstFail.arg2.toString(16).padStart(4, "0")} arg3=0x${firstFail.arg3.toString(16).padStart(4, "0")}`,
    );
    console.log(
      `    sprite diff (first up to 64 bytes that differ):`,
    );
    console.log(`      bin: ${firstFail.binSprite.map((b) => b.toString(16).padStart(2, "0")).join(" ")}`);
    console.log(`      ts : ${firstFail.tsSprite.map((b) => b.toString(16).padStart(2, "0")).join(" ")}`);
    console.log(
      `    cursors+counter (workRam[0x3F6..0x408]):`,
    );
    console.log(`      bin: ${firstFail.binCursors.map((b) => b.toString(16).padStart(2, "0")).join(" ")}`);
    console.log(`      ts : ${firstFail.tsCursors.map((b) => b.toString(16).padStart(2, "0")).join(" ")}`);
  }

  disposeCpu(cpu);
  exit(ok === n ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  exit(1);
});
