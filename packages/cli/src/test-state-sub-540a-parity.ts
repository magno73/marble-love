#!/usr/bin/env node
/**
 * test-state-sub-540a-parity.ts — differential FUN_540A vs stateSub540A.
 *
 *
 * Convenzione caller (cdecl push-RTL):
 *   - arg2 long  = D3 (sign-extended from the original word)
 *   - return D0 long = 0 or A2 post-walk
 *
 * Strategia parity:
 *   - Setta SP, poi callFunction(0x540A, [a2, d3]).
 *     pure-read).
 *
 * Uso: npx tsx packages/cli/src/test-state-sub-540a-parity.ts [N]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import {
  state as stateNs,
  stateSub540A as ssNs,
} from "@marble-love/engine";
import {
  createCpu,
  callFunction,
  pokeMem,
  peekMem,
  disposeCpu,
} from "./binary-oracle-lib.js";

const FUN_540A = 0x0000540a;
const WORK_RAM_BASE = 0x00400000;
const WORK_RAM_SIZE = 0x2000;

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) >>> 0;
    return ((s >>> 16) & 0xffff) / 0x10000;
  };
}

/** Compute number of body iterations per the M68k semantics. */
function numStringsForHeader(hdr: number): number {
  const hi = (hdr >>> 4) & 0xf;
  const lo = hdr & 0xf;
  const shiftByte = (hi + 1 - lo) & 0xff;
  const shiftCount = shiftByte & 0x3f;
  let countWord: number;
  if (shiftCount >= 32) {
    countWord = 0;
  } else {
    countWord = (1 << shiftCount) & 0xffff;
  }
  // signed-word interpretation
  const signed = countWord >= 0x8000 ? countWord - 0x10000 : countWord;
  // body executes (signed + 1) times if signed >= 0, else 0 times
  return signed >= 0 ? signed + 1 : 0;
}

/** Pick a header that produces a small number of strings (1..5). */
function pickSafeHeader(rng: () => number): number {
  //   shift=0 → count=1 → 2 strings (e.g. hdr=0x12, hi=1 lo=2 → (2)-2=0)
  //              wait: (1+1)-2=0. Yes shift_byte=0.
  //   shift=1 → count=2 → 3 strings (hdr=0x00 → (1)-0=1)
  //   shift=2 → count=4 → 5 strings (hdr=0x10 → (2)-0=2)
  //   shift_byte large (negative) → count=0 → 1 string (e.g. hdr=0x05 → (1)-5=-4)
  //   shift_byte=16 → count=0 → 1 string (hdr=0xF0 → (16)-0=16)
  //
  // Lista of header safe:
  const safe = [
    0x12, // shift_byte=0, count=1, 2 strings
    0x00, // shift_byte=1, count=2, 3 strings
    0x10, // shift_byte=2, count=4, 5 strings
    0x05, // shift_byte=-4 → 0xFC, asl >= 32 → count=0, 1 string
    0xf0, // shift_byte=16, count=0, 1 string
    0x21, // (3-1)=2, count=4, 5 strings
    0x33, // (4-3)=1, count=2, 3 strings
    0x44, // (5-4)=1, count=2, 3 strings
    0x06, // (1-6)=-5 → 0xFB, count=0, 1 string
  ];
  return safe[Math.floor(rng() * safe.length)]!;
}

/** Generate a random null-terminated ASCII string of length 0..7. */
function randomString(rng: () => number): string {
  const len = Math.floor(rng() * 8); // 0..7
  let s = "";
  for (let i = 0; i < len; i++) {
    // ASCII printable, non-zero
    s += String.fromCharCode(0x20 + Math.floor(rng() * 0x40));
  }
  return s;
}

/** Write a record at workRam offset, return offset of next record. */
function writeRecord(
  workRam: Uint8Array,
  off: number,
  hdr: number,
  strings: readonly string[],
): number {
  workRam[off] = hdr & 0xff;
  let cur = off + 1;
  for (const s of strings) {
    for (let i = 0; i < s.length; i++) {
      workRam[cur + i] = s.charCodeAt(i) & 0xff;
    }
    workRam[cur + s.length] = 0;
    cur += s.length + 1;
  }
  return cur;
}

/**
 * Build a table of records starting at off. Returns { lastOff, table }
 * where lastOff is where the post-walk A2 will be after consuming `numRecords`
 * records (provided no early-exit fires).
 *
 * `terminate` controls whether the table ends with a 00 00 sentinel pair
 * after numRecords (to test early-exit return 0) or with non-zero bytes
 * (to test return A2).
 */
function buildTable(
  workRam: Uint8Array,
  startOff: number,
  numRecords: number,
  rng: () => number,
  terminate: boolean,
): { startOff: number; lastOff: number } {
  let cur = startOff;
  for (let i = 0; i < numRecords; i++) {
    let hdr = pickSafeHeader(rng);
    // Ensure hdr != 0 OR first string is non-empty, to avoid accidental early-exit.
    // If hdr==0 and first string is empty, byte[A2]|byte[A2+1] = 0|0 = 0 → exit.
    let strings: string[] = [];
    const numStrings = numStringsForHeader(hdr);
    if (numStrings === 0) {
      // shift=15 case: D0w signed neg, body never runs, no strings written.
      // OK to use, but rare.
    } else {
      for (let j = 0; j < numStrings; j++) {
        strings.push(randomString(rng));
      }
      if (hdr === 0 && strings[0] === "") {
        // Force first string non-empty (or change hdr) to avoid pair 00 00.
        strings[0] = "a";
      }
    }
    cur = writeRecord(workRam, cur, hdr, strings);
  }
  if (terminate) {
    // Place 00 00 sentinel at current pos.
    workRam[cur] = 0;
    workRam[cur + 1] = 0;
  } else {
    // Place non-zero sentinel.
    workRam[cur] = 0x42;
    workRam[cur + 1] = 0x00; // pair = 0x42 != 0
  }
  return { startOff, lastOff: cur };
}

async function main(): Promise<void> {
  const n = Number(process.argv[2] ?? "500");

  const romPath = resolve("ghidra_project/marble_program.bin");
  if (!existsSync(romPath)) {
    console.error(`error: ROM blob not found at ${romPath}`);
    exit(3);
  }
  const rom = readFileSync(romPath);

  const state = stateNs.emptyGameState();
  const cpu = await createCpu({ rom, state });

  console.log(`\n=== stateSub540A (FUN_540A) — ${n} cases ===`);

  const rng = makeRng(0x540a540a);
  let ok = 0;
  let firstFail: {
    i: number;
    a2: number;
    d3: number;
    binD0: number;
    tsRet: number;
    walkBytes: number;
  } | null = null;

  for (let i = 0; i < n; i++) {
    // Reset SP
    cpu.system.setRegister("sp", 0x401f00);

    // Pattern: coverage controllata.
    let d3: number;
    let numRecordsToWrite: number;
    let terminate: boolean;

    if (i === 0) {
      d3 = 0;
      numRecordsToWrite = 0;
      terminate = false;
    } else if (i === 1) {
      d3 = 0;
      numRecordsToWrite = 0;
      terminate = true;
    } else if (i === 2) {
      d3 = 1;
      numRecordsToWrite = 1;
      terminate = true;
    } else if (i === 3) {
      d3 = 1;
      numRecordsToWrite = 1;
      terminate = false;
    } else if (i === 4) {
      d3 = 5;
      numRecordsToWrite = 0;
      terminate = true; // 00 00 in testa
    } else {
      // Random
      d3 = Math.floor(rng() * 5) + 1; // 1..5
      numRecordsToWrite = Math.min(d3, Math.floor(rng() * 5) + 1);
      terminate = rng() < 0.5;
    }

    const seedBuf = new Uint8Array(WORK_RAM_SIZE);
    for (let k = 0; k < WORK_RAM_SIZE; k++) {
      seedBuf[k] = Math.floor(rng() * 0x100) & 0xff;
    }

    // Place table at a known offset, riservando spazio per ~50 byte.
    const tableStartOff = 0x100;
    const TABLE_REGION = 0x300; // 768 byte
    for (let k = tableStartOff; k < tableStartOff + TABLE_REGION; k++) {
      seedBuf[k] = 0;
    }

    const { lastOff } = buildTable(
      seedBuf,
      tableStartOff,
      numRecordsToWrite,
      rng,
      terminate,
    );
    const walkBytes = lastOff - tableStartOff;

    // Sync seed in Musashi memory + state.workRam.
    for (let k = 0; k < WORK_RAM_SIZE; k++) {
      pokeMem(cpu, WORK_RAM_BASE + k, 1, seedBuf[k]!);
      state.workRam[k] = seedBuf[k]!;
    }

    const a2 = (WORK_RAM_BASE + tableStartOff) >>> 0;

    // Run binary: callFunction passes args through stack RTL.
    // Args: [a2, d3].
    const result = callFunction(cpu, FUN_540A, [a2, d3]);
    const binD0 = result.d0 >>> 0;

    // Run TS
    const tsRet = ssNs.stateSub540A(state, a2, d3) >>> 0;

    if (binD0 === tsRet) {
      ok++;
    } else if (firstFail === null) {
      firstFail = {
        i,
        a2,
        d3,
        binD0,
        tsRet,
        walkBytes,
      };
    }
  }

  console.log(`  Match: ${ok}/${n} = ${((ok / n) * 100).toFixed(1)}%`);
  if (firstFail) {
    console.log(`  First fail @ case ${firstFail.i}:`);
    console.log(
      `    inputs: a2=0x${firstFail.a2.toString(16)} d3=${firstFail.d3} walkBytes=${firstFail.walkBytes}`,
    );
    console.log(
      `    binD0=0x${firstFail.binD0.toString(16)} tsRet=0x${firstFail.tsRet.toString(16)}`,
    );
  }

  cpu.system.setRegister("sp", 0x401f00);
  const buf = new Uint8Array(WORK_RAM_SIZE);
  for (let k = 0; k < WORK_RAM_SIZE; k++) {
    buf[k] = (k * 7 + 13) & 0xff;
  }
  for (let k = 0x100; k < 0x200; k++) buf[k] = 0;
  buildTable(buf, 0x100, 2, makeRng(0xdeadbeef), false);
  for (let k = 0; k < WORK_RAM_SIZE; k++) {
    pokeMem(cpu, WORK_RAM_BASE + k, 1, buf[k]!);
  }
  callFunction(cpu, FUN_540A, [WORK_RAM_BASE + 0x100, 2]);
  // Reconfirm distant bytes outside the stack zone stayed unchanged.
  let modified = 0;
  for (let k = 0; k < 0x1e00; k++) {
    const got = peekMem(cpu, WORK_RAM_BASE + k, 1) & 0xff;
    if (got !== buf[k]) modified++;
  }
  if (modified > 0) {
    console.log(
      `  WARN: binary modified ${modified} bytes of workRam (expected 0 — pure-read)`,
    );
  } else {
    console.log(`  OK: workRam unmodified by the binary (pure-read).`);
  }

  disposeCpu(cpu);
  exit(ok === n ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  exit(1);
});
