#!/usr/bin/env node
/**
 * test-hi-score-decode-41c8-parity.ts — differential FUN_41C8 vs hiScoreDecode41c8.
 *
 * `FUN_000041C8` (198 byte): high-score entry decoder.
 *   - source table = `*0x401FFC + 0x1E` (10 entries x 5 bytes)
 *   - buffer destinazione = 0x401F7A (4 byte score + 3 byte initials)
 *   - arg1 in [0..9] -> ret = 0x401F7A; otherwise ret = 0
 *
 * Convenzione caller (cdecl push-RTL):
 *   - arg1 = SP+0x14 = record index (long, sign-ext'd da word dal caller)
 *
 * Strategia parity:
 *   - Setup: workRam[0x1FFC..] = ptr (long BE, dentro range workRam-safe);
 *     populate 10 records x 5 random bytes; replicate setup on Musashi and on
 *     state.workRam.
 *   - For each random case: set up arg1; call the binary; call TS;
 *     confronta D0 e i 7 byte del buffer @ 0x401F7A..0x401F80.
 *
 * Pattern coverage:
 *   - 50% arg1 in [0..9]                      -> valid path, writes buffer
 *   - 20% arg1 in [10..0xFF]                  -> path OOR, no write
 *   - 15% arg1 sign-ext negativo (0xFFFFxxxx) -> stress OOR
 *   - 15% full random long                    -> stress generale
 *
 * Uso: npx tsx packages/cli/src/test-hi-score-decode-41c8-parity.ts [N=500]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import {
  state as stateNs,
  hiScoreDecode41c8 as hsdNs,
} from "@marble-love/engine";
import {
  createCpu,
  callFunction,
  pokeMem,
  peekMem,
  disposeCpu,
} from "./binary-oracle-lib.js";

const FUN_41C8 = 0x000041c8;
const PTR_FFC = 0x00401ffc;
const TABLE_OFF = 0x1e;

/** Fixed address of the base struct in the test (workRam-safe). */
const PTR_VAL = 0x00401a00;
const TABLE_BASE = PTR_VAL + TABLE_OFF; // 0x401A1E

/** Buffer di output @ 0x401F7A (workRam, 7 byte). */
const OUT_BUF = 0x00401f7a;
const OUT_BUF_LEN = 7;

/** High-score table size: 10 records x 5 bytes. */
const NUM_RECORDS = 10;
const RECORD_SIZE = 5;

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) >>> 0;
    return ((s >>> 16) & 0xffff) / 0x10000;
  };
}

interface FailRecord {
  i: number;
  pattern: string;
  arg1: number;
  binD0: number;
  tsD0: number;
  binBuf: number[];
  tsBuf: number[];
}

function bufHex(b: readonly number[]): string {
  return b.map((x) => x.toString(16).padStart(2, "0")).join(" ");
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

  console.log(
    `\n=== hiScoreDecode41c8 (FUN_41C8) — ${n} casi ===`,
  );

  const rng = makeRng(0x41c841c8);
  let ok = 0;
  let firstFail: FailRecord | null = null;

  for (let i = 0; i < n; i++) {
    cpu.system.setRegister("sp", 0x401f00);

    // Table setup: 10 x 5 random bytes. Same content on binary and TS.
    for (let r = 0; r < NUM_RECORDS; r++) {
      for (let b = 0; b < RECORD_SIZE; b++) {
        const byte = Math.floor(rng() * 256);
        const addr = TABLE_BASE + r * RECORD_SIZE + b;
        pokeMem(cpu, addr, 1, byte);
        state.workRam[addr - 0x400000] = byte;
      }
    }

    // ── Pre-fill output buffer with sentinel bytes to detect overflow. ──
    for (let b = 0; b < OUT_BUF_LEN + 4; b++) {
      // 4 extra bytes before and after for checking.
      const addr = OUT_BUF - 2 + b;
      pokeMem(cpu, addr, 1, 0xa5);
      state.workRam[addr - 0x400000] = 0xa5;
    }

    // ── Setup ptr @ 0x401FFC (long BE). ──
    pokeMem(cpu, PTR_FFC, 4, PTR_VAL);
    state.workRam[0x1ffc] = (PTR_VAL >>> 24) & 0xff;
    state.workRam[0x1ffd] = (PTR_VAL >>> 16) & 0xff;
    state.workRam[0x1ffe] = (PTR_VAL >>> 8) & 0xff;
    state.workRam[0x1fff] = PTR_VAL & 0xff;

    // ── Pattern selection per arg1. ──
    const pick = rng();
    let pattern: "valid" | "oor_byte" | "neg" | "random";
    let arg1: number;
    if (pick < 0.5) {
      pattern = "valid";
      arg1 = Math.floor(rng() * 10); // 0..9
    } else if (pick < 0.7) {
      pattern = "oor_byte";
      arg1 = 10 + Math.floor(rng() * (0x100 - 10)); // 10..0xFF
    } else if (pick < 0.85) {
      pattern = "neg";
      // Sign-extension of a negative word: 0xFFFFxxxx with xxxx in [0x8000..0xFFFF].
      const w = 0x8000 + Math.floor(rng() * 0x8000);
      arg1 = (0xffff0000 | w) >>> 0;
    } else {
      pattern = "random";
      const lo = Math.floor(rng() * 0x10000);
      const hi = rng() < 0.5 ? 0 : lo & 0x8000 ? 0xffff : 0;
      arg1 = (((hi << 16) >>> 0) | lo) >>> 0;
    }

    // ── Run binary. ──
    const r = callFunction(cpu, FUN_41C8, [arg1]);
    const binD0 = r.d0 >>> 0;

    // ── Run TS. ──
    const tsD0 = hsdNs.hiScoreDecode41c8(state, arg1) >>> 0;

    // ── Confronta D0 + buffer @ 0x401F7A. ──
    const binBuf: number[] = [];
    const tsBuf: number[] = [];
    for (let b = 0; b < OUT_BUF_LEN; b++) {
      binBuf.push(peekMem(cpu, OUT_BUF + b, 1) & 0xff);
      tsBuf.push(state.workRam[OUT_BUF - 0x400000 + b] ?? 0);
    }

    let bufMatch = true;
    for (let b = 0; b < OUT_BUF_LEN; b++) {
      if (binBuf[b] !== tsBuf[b]) {
        bufMatch = false;
        break;
      }
    }

    if (binD0 === tsD0 && bufMatch) {
      ok++;
    } else if (firstFail === null) {
      firstFail = {
        i,
        pattern,
        arg1,
        binD0,
        tsD0,
        binBuf,
        tsBuf,
      };
    }
  }

  console.log(`  Match: ${ok}/${n} = ${((ok / n) * 100).toFixed(1)}%`);
  if (firstFail) {
    const f = firstFail;
    console.log(`  First fail @ case ${f.i} (pattern=${f.pattern}):`);
    console.log(`    arg1=0x${f.arg1.toString(16).padStart(8, "0")}`);
    console.log(
      `    bin: D0=0x${f.binD0.toString(16).padStart(8, "0")}  buf=[${bufHex(f.binBuf)}]`,
    );
    console.log(
      `    ts : D0=0x${f.tsD0.toString(16).padStart(8, "0")}  buf=[${bufHex(f.tsBuf)}]`,
    );
  }

  disposeCpu(cpu);
  exit(ok === n ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  exit(1);
});
