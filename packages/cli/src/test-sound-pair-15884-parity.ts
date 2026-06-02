#!/usr/bin/env node
/**
 * test-sound-pair-15884-parity.ts — differential FUN_15884 vs soundPair15884.
 *
 * `FUN_00015884` sends sound id `0x3A` through `FUN_00158AC` (sound command
 * sender), then — if the word @ `0x400394` is not `2` — also sends `0x3B`.
 *
 * Parity-test strategy, matching `test-special-attract-parity.ts`:
 * patch `FUN_158AC` with a payload that appends the byte arg to a buffer
 * growing work RAM buffer through an indirect cursor.
 *
 *   move.b   (0x7,SP), D0          ; 102F 0007                (4 byte)  arg byte
 *   movea.l  (0x00401FFC).l, A1    ; 2279 0040 1FFC           (6 byte)  cur
 *   move.b   D0, (A1)+             ; 12C0                     (2 byte)  *cur++ = arg
 *   move.l   A1, (0x00401FFC).l    ; 23C9 0040 1FFC           (6 byte)  store cur
 *   rts                            ; 4E75                     (2 byte)
 *
 * Total 20 bytes (original FUN_158AC is 0x20 bytes: enough space).
 *
 * Capture buffer:
 *   - 0x401FF0..0x401FF3 : 4 slot byte (init sentinel 0xFF, max 4 writes)
 *
 *
 *
 * Uso: npx tsx packages/cli/src/test-sound-pair-15884-parity.ts [N]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import {
  state as stateNs,
  soundPair15884 as spNs,
} from "@marble-love/engine";
import {
  createCpu,
  callFunction,
  pokeMem,
  peekMem,
  disposeCpu,
} from "./binary-oracle-lib.js";

const FUN_15884 = 0x00015884;
const FUN_158AC = 0x000158ac;
const MODE_ADDR = 0x00400394; // word, work RAM 0x394
const BUF_BASE = 0x00401ff0; // 4-byte capture buffer
const CUR_PTR = 0x00401ffc; // long pointer to next slot

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) >>> 0;
    return ((s >>> 16) & 0xffff) / 0x10000;
  };
}

async function main(): Promise<void> {
  const n = Number(process.argv[2] ?? "500");

  const romPath = resolve("ghidra_project/marble_program.bin");
  if (!existsSync(romPath)) {
    console.error(`error: ROM blob not found at ${romPath}`);
    exit(3);
  }
  const rom = Buffer.from(readFileSync(romPath));

  // Patch ROM @ FUN_158AC: append byte arg to (*0x401FFC)++ buffer.
  // move.b   (0x7,SP), D0           : 10 2F 00 07
  // movea.l  ($00401FFC).l, A1      : 22 79 00 40 1F FC
  // move.b   D0, (A1)+              : 12 C0
  // move.l   A1, ($00401FFC).l      : 23 C9 00 40 1F FC
  // rts                             : 4E 75
  rom[FUN_158AC + 0x0] = 0x10; rom[FUN_158AC + 0x1] = 0x2f;
  rom[FUN_158AC + 0x2] = 0x00; rom[FUN_158AC + 0x3] = 0x07;
  rom[FUN_158AC + 0x4] = 0x22; rom[FUN_158AC + 0x5] = 0x79;
  rom[FUN_158AC + 0x6] = 0x00; rom[FUN_158AC + 0x7] = 0x40;
  rom[FUN_158AC + 0x8] = 0x1f; rom[FUN_158AC + 0x9] = 0xfc;
  rom[FUN_158AC + 0xa] = 0x12; rom[FUN_158AC + 0xb] = 0xc0;
  rom[FUN_158AC + 0xc] = 0x23; rom[FUN_158AC + 0xd] = 0xc9;
  rom[FUN_158AC + 0xe] = 0x00; rom[FUN_158AC + 0xf] = 0x40;
  rom[FUN_158AC + 0x10] = 0x1f; rom[FUN_158AC + 0x11] = 0xfc;
  rom[FUN_158AC + 0x12] = 0x4e; rom[FUN_158AC + 0x13] = 0x75;

  const state = stateNs.emptyGameState();
  const cpu = await createCpu({ rom, state });

  console.log(`\n=== soundPair15884 (FUN_15884) — ${n} cases ===`);

  const rng = makeRng(0x158841);
  let ok = 0;
  let firstFail: {
    i: number;
    mode: number;
    binSeq: number[];
    tsSeq: number[];
  } | null = null;

  for (let i = 0; i < n; i++) {
    cpu.system.setRegister("sp", 0x401f00);

    // Pattern of coverage:
    //   0  : mode = 0x0000 (default, full pair)
    //   1  : mode = 0x0001 (full pair)
    //   2  : mode = 0x0002 (gate: only 0x3A)
    //   3  : mode = 0x0003 (full pair, just above gate)
    //   6  : mode = 0x0102 (high byte non-zero)
    //   7  : mode = 0x8002 (high byte set + low == 2 → low non basta!)
    //   8  : mode = 0x0200 (low == 0 but high == 2: cmp.w == 0x0200 ≠ 2 → pair)
    //   pattern 9..32: cluster plus/minus 5 around 0x0002
    //   pattern >= 32: random uint16
    let mode: number;
    if (i === 0) mode = 0x0000;
    else if (i === 1) mode = 0x0001;
    else if (i === 2) mode = 0x0002;
    else if (i === 3) mode = 0x0003;
    else if (i === 4) mode = 0x0004;
    else if (i === 5) mode = 0xffff;
    else if (i === 6) mode = 0x0102;
    else if (i === 7) mode = 0x8002;
    else if (i === 8) mode = 0x0200;
    else if (i < 32) {
      // boundary: ±5 around 0x0002
      const delta = Math.floor(rng() * 11) - 5;
      mode = (0x0002 + delta) & 0xffff;
    } else {
      mode = Math.floor(rng() * 0x10000) & 0xffff;
    }

    pokeMem(cpu, MODE_ADDR, 2, mode);
    state.workRam[0x394] = (mode >>> 8) & 0xff;
    state.workRam[0x395] = mode & 0xff;

    // Reset capture buffer (4 byte sentinel) + cursor pointer
    pokeMem(cpu, BUF_BASE + 0, 1, 0xff);
    pokeMem(cpu, BUF_BASE + 1, 1, 0xff);
    pokeMem(cpu, BUF_BASE + 2, 1, 0xff);
    pokeMem(cpu, BUF_BASE + 3, 1, 0xff);
    pokeMem(cpu, CUR_PTR, 4, BUF_BASE);

    // Run binary
    callFunction(cpu, FUN_15884, []);
    const curEnd = peekMem(cpu, CUR_PTR, 4) >>> 0;
    const nWrites = (curEnd - BUF_BASE) | 0;
    const binSeq: number[] = [];
    for (let k = 0; k < nWrites && k < 4; k++) {
      binSeq.push(peekMem(cpu, BUF_BASE + k, 1) & 0xff);
    }

    // Run TS
    const tsSeq: number[] = [];
    spNs.soundPair15884(state, {
      soundCommand: (cmd: number) => {
        tsSeq.push(cmd & 0xff);
      },
    });

    const match =
      binSeq.length === tsSeq.length &&
      binSeq.every((v, k) => v === tsSeq[k]);
    if (match) {
      ok++;
    } else if (firstFail === null) {
      firstFail = { i, mode, binSeq, tsSeq };
    }
  }

  console.log(`  Match: ${ok}/${n} = ${((ok / n) * 100).toFixed(1)}%`);
  if (firstFail) {
    console.log(`  First fail @ case ${firstFail.i}:`);
    console.log(
      `    mode = 0x${firstFail.mode.toString(16).padStart(4, "0")}`,
    );
    const fmt = (a: number[]) =>
      "[" + a.map((v) => "0x" + v.toString(16).padStart(2, "0")).join(", ") + "]";
    console.log(`    bin: ${fmt(firstFail.binSeq)}`);
    console.log(`    ts : ${fmt(firstFail.tsSeq)}`);
  }

  disposeCpu(cpu);
  exit(ok === n ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  exit(1);
});
