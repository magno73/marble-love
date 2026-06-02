#!/usr/bin/env node
/**
 * test-object-update-pair-158cc-parity.ts — differential FUN_158CC vs
 * objectUpdatePair158CC.
 *
 * FUN_1B9CC / FUN_1281C); to isolate the FUN_158CC path we patch
 * FUN_158F6 with a "capture" payload:
 *
 *   move.l   (0x4,SP), D0          ; 20 2F 00 04        (4 byte)  arg long
 *   movea.l  (0x00401FF8).l, A1    ; 22 79 00 40 1F F8  (6 byte)  cur
 *   move.l   D0, (A1)+             ; 22 C0              (2 byte)  *cur++ = arg
 *   move.l   A1, (0x00401FF8).l    ; 23 C9 00 40 1F F8  (6 byte)  store cur
 *   rts                            ; 4E 75              (2 byte)
 *
 * extends up to 0x15974+), safe patch.
 *
 * Capture buffer:
 *   - 0x401FE0..0x401FF7 : 6 long slots (init sentinel 0xDEADBEEF, max 6
 *                          writes — we expect 2)
 *
 * Note: use offset `0x401FE0`, not `0x401FF0` like the other parity tests
 * writing 4x4=16 bytes can overlap if SP drops too far. The
 *
 *   - long[0] = 0x004009A4
 *   - long[1] = 0x00400A20
 *
 *
 * accumulated memory side effects and different workRam patterns (we verify
 * work RAM).
 *
 * Usage: npx tsx packages/cli/src/test-object-update-pair-158cc-parity.ts [N]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import {
  state as stateNs,
  objectUpdatePair158CC as oupNs,
} from "@marble-love/engine";
import {
  createCpu,
  callFunction,
  pokeMem,
  peekMem,
  disposeCpu,
} from "./binary-oracle-lib.js";

const FUN_158CC = 0x000158cc;
const FUN_158F6 = 0x000158f6;
const BUF_BASE = 0x00401fe0; // 6×4 byte capture buffer (24 byte)
const CUR_PTR = 0x00401ff8; // long pointer to next slot

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

  // Patch ROM @ FUN_158F6: append arg long to (*0x401FF8)++ buffer.
  // move.l   (0x4,SP), D0          : 20 2F 00 04
  // movea.l  ($00401FF8).l, A1     : 22 79 00 40 1F F8
  // move.l   D0, (A1)+             : 22 C0
  // move.l   A1, ($00401FF8).l     : 23 C9 00 40 1F F8
  // rts                            : 4E 75
  rom[FUN_158F6 + 0x0] = 0x20; rom[FUN_158F6 + 0x1] = 0x2f;
  rom[FUN_158F6 + 0x2] = 0x00; rom[FUN_158F6 + 0x3] = 0x04;
  rom[FUN_158F6 + 0x4] = 0x22; rom[FUN_158F6 + 0x5] = 0x79;
  rom[FUN_158F6 + 0x6] = 0x00; rom[FUN_158F6 + 0x7] = 0x40;
  rom[FUN_158F6 + 0x8] = 0x1f; rom[FUN_158F6 + 0x9] = 0xf8;
  rom[FUN_158F6 + 0xa] = 0x22; rom[FUN_158F6 + 0xb] = 0xc0;
  rom[FUN_158F6 + 0xc] = 0x23; rom[FUN_158F6 + 0xd] = 0xc9;
  rom[FUN_158F6 + 0xe] = 0x00; rom[FUN_158F6 + 0xf] = 0x40;
  rom[FUN_158F6 + 0x10] = 0x1f; rom[FUN_158F6 + 0x11] = 0xf8;
  rom[FUN_158F6 + 0x12] = 0x4e; rom[FUN_158F6 + 0x13] = 0x75;

  const state = stateNs.emptyGameState();
  const cpu = await createCpu({ rom, state });

  console.log(`\n=== objectUpdatePair158CC (FUN_158CC) — ${n} cases ===`);

  const rng = makeRng(0x158cc1);
  let ok = 0;
  let firstFail: {
    i: number;
    binSeq: number[];
    tsSeq: number[];
  } | null = null;

  for (let i = 0; i < n; i++) {
    cpu.system.setRegister("sp", 0x401f00);

    // workRam variation: different patterns for each iter to stress
    // captured bytes MUST remain unchanged.
    //
    // Pattern:
    //   i=0..3: static patterns (zero / 0xFF / mix)
    //   i>=4 : random
    if (i === 0) {
    } else if (i === 1) {
      pokeMem(cpu, 0x004009a4, 4, 0xdeadbeef);
      pokeMem(cpu, 0x00400a20, 4, 0xcafebabe);
      state.workRam[0x9a4] = 0xde;
      state.workRam[0x9a5] = 0xad;
      state.workRam[0x9a6] = 0xbe;
      state.workRam[0x9a7] = 0xef;
      state.workRam[0xa20] = 0xca;
      state.workRam[0xa21] = 0xfe;
      state.workRam[0xa22] = 0xba;
      state.workRam[0xa23] = 0xbe;
    } else if (i === 2) {
      state.workRam.fill(0xff);
      pokeMem(cpu, 0x00400000, 4, 0xffffffff);
      pokeMem(cpu, 0x004003b8, 2, 0xffff); // skip flag
      pokeMem(cpu, 0x004003ea, 2, 0xffff); // stage
    } else if (i === 3) {
      state.workRam.fill(0x00);
      // On Musashi too, zero out the slots
      pokeMem(cpu, 0x004009a4, 4, 0x00000000);
      pokeMem(cpu, 0x00400a20, 4, 0x00000000);
    } else {
      // Random pattern
      const r1 = Math.floor(rng() * 0x100000000) >>> 0;
      const r2 = Math.floor(rng() * 0x100000000) >>> 0;
      pokeMem(cpu, 0x004009a4, 4, r1);
      pokeMem(cpu, 0x00400a20, 4, r2);
      state.workRam[0x9a4] = (r1 >>> 24) & 0xff;
      state.workRam[0x9a5] = (r1 >>> 16) & 0xff;
      state.workRam[0x9a6] = (r1 >>> 8) & 0xff;
      state.workRam[0x9a7] = r1 & 0xff;
      state.workRam[0xa20] = (r2 >>> 24) & 0xff;
      state.workRam[0xa21] = (r2 >>> 16) & 0xff;
      state.workRam[0xa22] = (r2 >>> 8) & 0xff;
      state.workRam[0xa23] = r2 & 0xff;
    }

    // Reset capture buffer (6 longs = 24 byte) + cursor pointer.
    for (let k = 0; k < 6; k++) {
      pokeMem(cpu, BUF_BASE + k * 4, 4, 0xdeadbeef);
    }
    pokeMem(cpu, CUR_PTR, 4, BUF_BASE);

    // Run binary
    callFunction(cpu, FUN_158CC, []);
    const curEnd = peekMem(cpu, CUR_PTR, 4) >>> 0;
    const nWrites = ((curEnd - BUF_BASE) >>> 0) / 4;
    const binSeq: number[] = [];
    for (let k = 0; k < nWrites && k < 6; k++) {
      binSeq.push(peekMem(cpu, BUF_BASE + k * 4, 4) >>> 0);
    }

    // Run TS
    const tsSeq: number[] = [];
    oupNs.objectUpdatePair158CC(state, {
      objectUpdate: (slotPtr: number) => {
        tsSeq.push(slotPtr >>> 0);
      },
    });

    const match =
      binSeq.length === tsSeq.length &&
      binSeq.every((v, k) => v === tsSeq[k]);
    if (match) {
      ok++;
    } else if (firstFail === null) {
      firstFail = { i, binSeq, tsSeq };
    }
  }

  console.log(`  Match: ${ok}/${n} = ${((ok / n) * 100).toFixed(1)}%`);
  if (firstFail) {
    console.log(`  First fail @ case ${firstFail.i}:`);
    const fmt = (a: number[]) =>
      "[" +
      a.map((v) => "0x" + v.toString(16).padStart(8, "0")).join(", ") +
      "]";
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
