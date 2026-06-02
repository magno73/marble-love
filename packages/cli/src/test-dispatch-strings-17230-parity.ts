#!/usr/bin/env node
/**
 * test-dispatch-strings-17230-parity.ts —
 * differential FUN_17230 vs `dispatchStrings17230`.
 *
 * times `FUN_0001725a(slotPtr)` with `slotPtr = 0x401482 + i*0x42` for
 * `i ∈ 0..6`. To test the dispatch logic *alone* in isolation.
 *
 * **Stub layout** (20 byte) injected @ `0x0001725a`:
 *
 *   2079 0040 1BF8     ; movea.l (0x401BF8).l, A0   ; A0 = head pointer
 *   202F 0004          ; move.l  (4,SP), D0          ; D0 = slotPtr arg
 *   20C0               ; move.l  D0, (A0)+           ; *A0++ = slotPtr
 *   23C8 0040 1BF8     ; move.l  A0, (0x401BF8).l    ; save head back
 *   4E75               ; rts
 *
 * `0x401C00..0x401C1B`.)
 *
 *   1. Pre-fill workRam with a deterministic pattern.
 *   2. **Binary side**: set head=0x401C00, run callFunction(0x17230). The
 *   3. Snapshot workRam_post_bin, then restore pre-call workRam.
 *   4. **TS side**: set head=0x401C00 (in pokeMem), run TS dispatcher with
 *      callback that invokes `callFunction(0x1725a, [slot])` (same stub).
 *   5. Snapshot workRam_post_ts.
 *   6. Compare byte-by-byte 0x400000..0x402000.
 *
 *
 *   - pre-fill workRam (pattern + random tail) so the
 *     dispatcher clobbers nothing.
 *
 * Usage: npx tsx packages/cli/src/test-dispatch-strings-17230-parity.ts [N]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import {
  state as stateNs,
  dispatchStrings17230 as dsNs,
} from "@marble-love/engine";
import {
  createCpu,
  callFunction,
  pokeMem,
  peekMem,
  disposeCpu,
} from "./binary-oracle-lib.js";

const FUN_DISPATCH = 0x00017230;
const FUN_CALLEE = 0x0001725a;
const WORK_RAM_BASE = 0x00400000;
const WORK_RAM_SIZE = 0x2000;
const QUEUE_HEAD_PTR = 0x00401bf8;
const QUEUE_BASE = 0x00401c00; // FIFO base

/** Stub bytes: see disasm in header. */
const STUB_BYTES = [
  0x20, 0x79, 0x00, 0x40, 0x1b, 0xf8, // movea.l (0x401BF8).l, A0
  0x20, 0x2f, 0x00, 0x04, // move.l (4,SP), D0
  0x20, 0xc0, // move.l D0, (A0)+    (was 0x2080 — wrong: that's move.l D0,(A0))
  0x23, 0xc8, 0x00, 0x40, 0x1b, 0xf8, // move.l A0, (0x401BF8).l (was 0x21C8 — wrong)
  0x4e, 0x75, // rts
] as const;

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) >>> 0;
    return ((s >>> 16) & 0xffff) / 0x10000;
  };
}

/** Capture workRam from the CPU into a Uint8Array. */
function captureWorkRam(cpu: ReturnType<typeof createCpuSync>): Uint8Array {
  const out = new Uint8Array(WORK_RAM_SIZE);
  for (let i = 0; i < WORK_RAM_SIZE; i++) {
    out[i] = peekMem(cpu, WORK_RAM_BASE + i, 1) & 0xff;
  }
  return out;
}

function loadWorkRam(cpu: ReturnType<typeof createCpuSync>, src: Uint8Array): void {
  for (let i = 0; i < WORK_RAM_SIZE; i++) {
    pokeMem(cpu, WORK_RAM_BASE + i, 1, src[i] ?? 0);
  }
}

// type alias for the inferred CPU session (avoid importing internal type)
type CpuSync = Awaited<ReturnType<typeof createCpu>>;
const createCpuSync = createCpu as unknown as (cfg: Parameters<typeof createCpu>[0]) => CpuSync;

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

  // Patch FUN_1725a with the stub (ROM-mapped zone 0x000000-0x07FFFF;
  // pokeMem uses a direct write; see the pattern in test-flag-scaled-magnitude.
  for (let i = 0; i < STUB_BYTES.length; i++) {
    pokeMem(cpu, FUN_CALLEE + i, 1, STUB_BYTES[i]!);
  }

  console.log(`\n=== dispatchStrings17230 (FUN_17230) — ${n} cases ===`);
  console.log(
    `  (FUN_1725A patched in-memory with a queue-write stub @ 0x401C00)`,
  );

  const rng = makeRng(0x17230a17);
  let ok = 0;
  let firstFail: {
    i: number;
    offset: number;
    bin: number;
    ts: number;
  } | null = null;

  for (let i = 0; i < n; i++) {
    // but some paranoid harnesses re-apply it).
    if (i % 100 === 0) {
      for (let k = 0; k < STUB_BYTES.length; k++) {
        pokeMem(cpu, FUN_CALLEE + k, 1, STUB_BYTES[k]!);
      }
    }

    // ── Generate deterministic workRam pre-fill ─────────────────────────
    const pre = new Uint8Array(WORK_RAM_SIZE);
    if (i === 0) pre.fill(0x00);
    else if (i === 1) pre.fill(0xff);
    else if (i === 2) pre.fill(0x55);
    else if (i === 3) pre.fill(0xaa);
    else if (i === 4) {
      for (let j = 0; j < WORK_RAM_SIZE; j++) pre[j] = j & 0xff;
    } else if (i === 5) {
      for (let j = 0; j < WORK_RAM_SIZE; j++) pre[j] = (j * 7) & 0xff;
    } else if (i === 6) {
      for (let j = 0; j < WORK_RAM_SIZE; j++) pre[j] = (j ^ 0x5a) & 0xff;
    } else if (i === 7) pre.fill(0xcc);
    else {
      for (let j = 0; j < WORK_RAM_SIZE; j++) {
        pre[j] = Math.floor(rng() * 256) & 0xff;
      }
    }

    // the FIFO writes).
    let headInit: number;
    if (i < 8) {
      headInit = QUEUE_BASE;
    } else {
      const slot = Math.floor(rng() * 0x60); // 0..95
      headInit = (QUEUE_BASE + slot * 4) >>> 0;
    }
    pre[QUEUE_HEAD_PTR + 0 - WORK_RAM_BASE] = (headInit >>> 24) & 0xff;
    pre[QUEUE_HEAD_PTR + 1 - WORK_RAM_BASE] = (headInit >>> 16) & 0xff;
    pre[QUEUE_HEAD_PTR + 2 - WORK_RAM_BASE] = (headInit >>> 8) & 0xff;
    pre[QUEUE_HEAD_PTR + 3 - WORK_RAM_BASE] = headInit & 0xff;

    // ── Side binary ─────────────────────────────────────────────────────
    cpu.system.setRegister("sp", 0x401f00);
    loadWorkRam(cpu, pre);
    callFunction(cpu, FUN_DISPATCH, []);
    const postBin = captureWorkRam(cpu);

    // ── Side TS ─────────────────────────────────────────────────────────
    // Reset CPU workRam to the same pre-state.
    cpu.system.setRegister("sp", 0x401f00);
    loadWorkRam(cpu, pre);
    // TS dispatcher: for each slot pushed by this module, invoke the
    dsNs.dispatchStrings17230((slotAddr: number) => {
      callFunction(cpu, FUN_CALLEE, [slotAddr >>> 0]);
    });
    const postTs = captureWorkRam(cpu);

    // ── Compare ─────────────────────────────────────────────────────────
    // TS: 7× callFunction sentinel/arg). These bytes are "tombstone"
    //
    const STACK_SCRATCH_START = 0x1e80;
    let match = true;
    for (let j = 0; j < STACK_SCRATCH_START; j++) {
      if (postBin[j] !== postTs[j]) {
        match = false;
        if (firstFail === null) {
          firstFail = {
            i,
            offset: j,
            bin: postBin[j] ?? 0,
            ts: postTs[j] ?? 0,
          };
        }
        break;
      }
    }
    if (match) ok++;
  }

  console.log(`  Match: ${ok}/${n} = ${((ok / n) * 100).toFixed(1)}%`);
  if (firstFail) {
    console.log(`  First fail @ case ${firstFail.i}:`);
    console.log(
      `    diff at WR offset 0x${firstFail.offset.toString(16)} (addr 0x${(WORK_RAM_BASE + firstFail.offset).toString(16)}): bin=0x${firstFail.bin.toString(16)} ts=0x${firstFail.ts.toString(16)}`,
    );
  }

  disposeCpu(cpu);
  exit(ok === n ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  exit(1);
});
