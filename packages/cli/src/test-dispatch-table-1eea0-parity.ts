#!/usr/bin/env node
/**
 * test-dispatch-table-1eea0-parity.ts — differential FUN_11AD8 vs
 * `dispatchTable1EEA0`.
 *
 * `FUN_00011AD8` (64 byte) itera `D2.b` da `argIdx` fino a `0x0A` (cmp byte) e
 * Starts at `0x1EEA0 + signExt(argIdx)*8` and increments by 8 each iteration.
 *
 * pattern `array9ClearAndDispatch` — ring buffer + thunk patch).
 *
 * Strategia:
 *   1. Patch `FUN_0000428E` to a mini-thunk that logs `(arg1Long, arg2Long)`
 *      in una ring-buffer in **cartridge RAM** (0x900000+, 1 MB libera —
 *
 *      from Musashi; reset TS-side ring; run TS with stub-logger.
 *
 *   3. Compara byte-by-byte ring binary vs ring TS (entrambi serializzati
 *      come Uint8Array) + counter.
 *
 *   - tc ≥16    : argIdx random in [0..0xFF]
 *
 * Uso: npx tsx packages/cli/src/test-dispatch-table-1eea0-parity.ts [N]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import {
  state as stateNs,
  dispatchTable1EEA0 as dt1eea0Ns,
} from "@marble-love/engine";
import {
  createCpu,
  callFunction,
  pokeMem,
  peekMem,
  disposeCpu,
} from "./binary-oracle-lib.js";
import type { CpuSession } from "./binary-oracle-lib.js";

const FUN_11AD8 = 0x00011ad8;
const FUN_428E = 0x0000428e;

/**
 * Ring buffer in cartridge RAM (0x900000..0x9FFFFF, 1 MB nel layout di Musashi).
 *
 *
 * Note: these addresses are not mapped into TS `state.workRam`; the TS
 */
const RING_BASE = 0x00900000;
const RING_CAPACITY_BYTES = 2048;
const RING_COUNTER = RING_BASE + RING_CAPACITY_BYTES; // 0x00900800

/**
 * Patch FUN_428E col thunk-logger (30 byte).
 *
 * Layout (RING_BASE = 0x00900000, RING_COUNTER = 0x00900800):
 *   movea.l #RING_BASE, A0           ; 207C 0090 0000              (6 byte)
 *   move.l  RING_COUNTER.l, D1       ; 2239 0090 0800              (6 byte)
 *   adda.l  D1, A0                   ; D1C1                        (2 byte)
 *   move.l  (4,SP), (A0)+            ; 20EF 0004                   (4 byte)
 *   move.l  (8,SP), (A0)             ; 20AF 0008                   (4 byte)
 *   addq.l  #8, RING_COUNTER.l       ; 50B9 0090 0800              (6 byte)
 *   rts                              ; 4E75                        (2 byte)
 *
 */
function patchFun428E(cpu: CpuSession): void {
  const bytes = [
    // movea.l #RING_BASE, A0           (207C 0090 0000)
    0x20, 0x7c, 0x00, 0x90, 0x00, 0x00,
    // move.l RING_COUNTER.l, D1        (2239 0090 0800)
    0x22, 0x39, 0x00, 0x90, 0x08, 0x00,
    // adda.l D1, A0                    (D1C1)
    0xd1, 0xc1,
    // move.l (4,SP), (A0)+             (20EF 0004)
    0x20, 0xef, 0x00, 0x04,
    // move.l (8,SP), (A0)              (20AF 0008)
    0x20, 0xaf, 0x00, 0x08,
    // addq.l #8, RING_COUNTER.l        (50B9 0090 0800)
    0x50, 0xb9, 0x00, 0x90, 0x08, 0x00,
    // rts                              (4E75)
    0x4e, 0x75,
  ];
  for (let i = 0; i < bytes.length; i++) {
    pokeMem(cpu, FUN_428E + i, 1, bytes[i]!);
  }
}

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) >>> 0;
    return ((s >>> 16) & 0xffff) / 0x10000;
  };
}

/** Reset binary ring (Musashi) a 0. */
function resetRingBin(cpu: CpuSession): void {
  for (let i = 0; i < RING_CAPACITY_BYTES; i++) {
    pokeMem(cpu, RING_BASE + i, 1, 0);
  }
  for (let i = 0; i < 4; i++) {
    pokeMem(cpu, RING_COUNTER + i, 1, 0);
  }
}

function readRingBin(cpu: CpuSession): { ring: Uint8Array; counter: number } {
  const ring = new Uint8Array(RING_CAPACITY_BYTES);
  for (let i = 0; i < ring.length; i++) {
    ring[i] = peekMem(cpu, RING_BASE + i, 1) & 0xff;
  }
  const counter = peekMem(cpu, RING_COUNTER, 4) >>> 0;
  return { ring, counter };
}

/**
 */
class TsRing {
  ring = new Uint8Array(RING_CAPACITY_BYTES);
  counter = 0;
  reset(): void {
    this.ring.fill(0);
    this.counter = 0;
  }
  log(arg1Long: number, arg2Long: number): void {
    if (this.counter + 8 > this.ring.length) {
      throw new Error(`TsRing overflow @ counter=${this.counter}`);
    }
    const i = this.counter;
    this.ring[i] = (arg1Long >>> 24) & 0xff;
    this.ring[i + 1] = (arg1Long >>> 16) & 0xff;
    this.ring[i + 2] = (arg1Long >>> 8) & 0xff;
    this.ring[i + 3] = arg1Long & 0xff;
    this.ring[i + 4] = (arg2Long >>> 24) & 0xff;
    this.ring[i + 5] = (arg2Long >>> 16) & 0xff;
    this.ring[i + 6] = (arg2Long >>> 8) & 0xff;
    this.ring[i + 7] = arg2Long & 0xff;
    this.counter += 8;
  }
}

function diffBytes(
  a: Uint8Array,
  b: Uint8Array,
): { offset: number; bin: number; ts: number } | null {
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    if (a[i] !== b[i]) return { offset: i, bin: a[i]!, ts: b[i]! };
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
  const rom = readFileSync(romPath);

  const stateInst = stateNs.emptyGameState();
  const cpu = await createCpu({ rom, state: stateInst });
  patchFun428E(cpu);

  const tsRing = new TsRing();
  const subs: dt1eea0Ns.DispatchTable1EEA0Subs = {
    fun_428e: (a1, a2) => tsRing.log(a1, a2),
  };

  console.log(`\n=== dispatchTable1EEA0 (FUN_11AD8) — ${total} casi ===`);

  const rng = makeRng(0x11ad8);
  let ok = 0;
  interface FailRecord {
    tc: number;
    argIdx: number;
    where: "ring" | "counter";
    offset: number;
    bin: number;
    ts: number;
  }
  let firstFail: FailRecord | null = null;

  // Cycle cap must be large enough: 256 iters x about 30 cycles per iter.
  // (push args + jsr + 30-byte thunk + pop). Bound prudente: 200_000 cicli.
  const MAX_CYCLES = 200_000;

  for (let tc = 0; tc < total; tc++) {
    cpu.system.setRegister("sp", 0x401f00);

    let argIdx: number;
    if (tc <= 9) argIdx = tc;
    else if (tc === 10) argIdx = 0x0a;
    else if (tc === 11) argIdx = 0x0b;
    else if (tc === 12) argIdx = 0xff;
    else if (tc === 13) argIdx = 0x80;
    else if (tc === 14) argIdx = 0x7f;
    else if (tc === 15) argIdx = 0x00;
    else argIdx = Math.floor(rng() * 256) & 0xff;

    // Reset ring (binary side + TS side).
    resetRingBin(cpu);
    tsRing.reset();

    // Run binary
    callFunction(cpu, FUN_11AD8, [argIdx >>> 0], MAX_CYCLES);
    const binRing = readRingBin(cpu);

    // Run TS
    dt1eea0Ns.dispatchTable1EEA0(stateInst, argIdx, subs);

    // Compara
    const diffR = diffBytes(binRing.ring, tsRing.ring);
    const counterMatch = binRing.counter === tsRing.counter;

    if (diffR === null && counterMatch) {
      ok++;
    } else if (firstFail === null) {
      if (diffR !== null) {
        firstFail = {
          tc,
          argIdx,
          where: "ring",
          offset: diffR.offset,
          bin: diffR.bin,
          ts: diffR.ts,
        };
      } else {
        firstFail = {
          tc,
          argIdx,
          where: "counter",
          offset: -1,
          bin: binRing.counter,
          ts: tsRing.counter,
        };
      }
    }
  }

  console.log(`  Match: ${ok}/${total} = ${((ok / total) * 100).toFixed(1)}%`);
  if (firstFail) {
    console.log(
      `  First fail tc=${firstFail.tc} argIdx=0x${firstFail.argIdx.toString(16)} where=${firstFail.where}`,
    );
    if (firstFail.offset >= 0) {
      console.log(
        `    @ ring+0x${firstFail.offset.toString(16)}: bin=0x${firstFail.bin.toString(16)} ts=0x${firstFail.ts.toString(16)}`,
      );
    } else {
      console.log(
        `    counter: bin=0x${firstFail.bin.toString(16)} ts=0x${firstFail.ts.toString(16)}`,
      );
    }
  }

  disposeCpu(cpu);
  exit(ok === total ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  exit(1);
});
