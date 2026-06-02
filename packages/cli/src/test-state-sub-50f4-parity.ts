#!/usr/bin/env node
/**
 * test-state-sub-50f4-parity.ts — differential FUN_50F4 vs stateSub50F4.
 *
 * of output to A2+D3w*10 and optionally applies single-bit correction.
 *
 * Caller convention (registers inherited from `bsr.w` in FUN_4F38):
 *   - A2 (long ptr) = output buffer
 *   - A3 (long ptr) = input codeword base
 *   - D2w (word) = row index input (× 30)
 *   - D3w (word) = row index output (× 10)
 *   - D0 = D1 at return; D2/D3 += 1 at return (epilogue)
 *
 * Parity strategy:
 *   - Generate a random input codeword in ROM (Musashi unified mem) or workRam
 *   - Set A2 (workRam ptr), A3 (ROM or workRam ptr), D2w, D3w
 *   - Push sentinel ret addr, then setRegister(pc, 0x50F4)
 *   - run loop up to PC == sentinel, capture D0/D2/D3 + workRam delta
 *
 * Usage: npx tsx packages/cli/src/test-state-sub-50f4-parity.ts [N]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import {
  state as stateNs,
  bus as busNs,
  stateSub50F4 as ssNs,
} from "@marble-love/engine";
import type { RomImage } from "@marble-love/engine";
import {
  createCpu,
  disposeCpu,
  pokeMem,
  peekMem,
  type CpuSession,
} from "./binary-oracle-lib.js";

const FUN_50F4 = 0x000050f4;
const SENTINEL_RET = 0xcafebabe >>> 0;
const WORK_RAM_BASE = 0x00400000;
const WORK_RAM_SIZE = 0x2000;

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) >>> 0;
    return ((s >>> 16) & 0xffff) / 0x10000;
  };
}

interface CaptureResult {
  d0: number;
  d2: number;
  d3: number;
  reachedRts: boolean;
  /** Snapshot of workRam at end of call (region under test). */
  outputBytes: Uint8Array;
  /** Counter long-BE @ A2+0x11..0x12 at end of call. */
  counterAfter: number;
}

/**
 * Run FUN_50F4 step-by-step and capture D0/D2/D3 + workRam region.
 *
 *   - pc = FUN_50F4
 *   - a2 = a2Ptr, a3 = a3Ptr
 *   - d2 = d2Word (zero-ext from word), d3 = d3Word
 *
 * Note: FUN_50F4 has NO movem prologue at entry — it uses immediate lea ops that use
 */
function runAndCaptureBin(
  cpu: CpuSession,
  a2: number,
  a3: number,
  d2Word: number,
  d3Word: number,
  outputBufferSize: number,
): CaptureResult {
  const sys = cpu.system;

  // Push sentinel ret addr.
  let sp = 0x401f00 >>> 0;
  sp = (sp - 4) >>> 0;
  sys.write(sp, 4, SENTINEL_RET);
  sys.setRegister("sp", sp);
  sys.setRegister("pc", FUN_50F4);

  // Set context registers. D2/D3 zero-ext from word (high word = 0).
  sys.setRegister("a2", a2 >>> 0);
  sys.setRegister("a3", a3 >>> 0);
  sys.setRegister("d2", (d2Word & 0xffff) >>> 0);
  sys.setRegister("d3", (d3Word & 0xffff) >>> 0);

  sys.setRegister("d0", 0xdeadbeef);
  sys.setRegister("d1", 0xcafedab0);
  sys.setRegister("d4", 0xcafe0004);
  sys.setRegister("d5", 0xcafe0005);
  sys.setRegister("d6", 0xcafe0006);
  sys.setRegister("a0", 0xcafea000);
  sys.setRegister("a1", 0xcafea100);
  sys.setRegister("a4", 0xcafea400);

  let safety = 5000;
  let reachedRts = false;
  while (safety-- > 0) {
    const pc = sys.getRegisters().pc >>> 0;
    if (pc === SENTINEL_RET) {
      reachedRts = true;
      break;
    }
    sys.step();
  }

  const regs = sys.getRegisters();
  const d0 = regs.d0 >>> 0;
  const d2 = regs.d2 >>> 0;
  const d3 = regs.d3 >>> 0;

  // Capture output region.
  const a1Initial = (a2 + ((d3Word & 0xffff) * 10)) >>> 0;
  const outputBytes = new Uint8Array(outputBufferSize);
  for (let i = 0; i < outputBufferSize; i++) {
    outputBytes[i] = peekMem(cpu, (a1Initial + i) >>> 0, 1) & 0xff;
  }

  // Counter @ A2[0x11..0x12].
  const counterHi = peekMem(cpu, (a2 + 0x11) >>> 0, 1) & 0xff;
  const counterLo = peekMem(cpu, (a2 + 0x12) >>> 0, 1) & 0xff;
  const counterAfter = ((counterHi << 8) | counterLo) & 0xffff;

  return { d0, d2, d3, reachedRts, outputBytes, counterAfter };
}

interface CaseSetup {
  a2: number; // workRam ptr (0x400000+)
  a3: number; // ROM ptr (0x000000..0x80000) or workRam
  d2Word: number;
  d3Word: number;
  /** Bytes in input row at A3+D2w*30..A3+D2w*30+29 (30 byte). */
  inputRowBytes: Uint8Array;
  /** Initial counter A2[0x11..0x12] (16-bit BE). */
  initialCounter: number;
  /** Initial bytes at output region A2+D3w*10..A2+D3w*10+9 (10 byte). */
  initialOutputBytes: Uint8Array;
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

  // Mirror ROM in TS.
  const tsRom: RomImage = busNs.emptyRomImage();
  tsRom.program.set(rom.subarray(0, tsRom.program.length));

  console.log(`\n=== stateSub50F4 (FUN_50F4) — ${n} cases ===`);

  const rng = makeRng(0x50f450f4);
  let ok = 0;
  let firstFail: {
    i: number;
    setup: CaseSetup;
    bin: CaptureResult;
    ts: ReturnType<typeof ssNs.stateSub50F4>;
    diffField: string;
  } | null = null;

  for (let i = 0; i < n; i++) {
    // ─── Pattern of coverage ─────────────────────────────────────────
    let setup: CaseSetup;

    if (i === 0) {
      const inputRow = new Uint8Array(30);
      inputRow[0] = 0xff;
      setup = {
        a2: WORK_RAM_BASE + 0x100,
        a3: 0x00400800,
        d2Word: 0,
        d3Word: 0,
        inputRowBytes: inputRow,
        initialCounter: 0,
        initialOutputBytes: new Uint8Array(10),
      };
    } else if (i === 1) {
      // Correctable single-bit error: input has A0[2]=0x01, others 0.
      // Init D6b = ~0 ^ 0 ^ 0 ^ 0 ^ 1 = 0xFE. D2b=1.
      // Iter loop bytes = 0 → no XOR change. Syndromes: D6b=0xFE, D2b=1, others=0.
      // Bit-iter 1: D0w = (0<<4)|0|0|0|1 = 1 (bit 4 NOT set) → uncorrectable!
      // And table[D0w-0x10] != 0xFF. D0w = 0x13 → table[3] = 0x00 → corrects pos 0.
      // For D0w = 0x13: bit pattern (lsbD6=1, lsbD5=0, lsbD4=0, lsbD3=1, lsbD2=1)
      // = (1<<4) | (1<<1) | 1 = 0x10 | 2 | 1 = 0x13. ✓
      //
      // Setup: input zero EXCEPT A0[0]=0xFE (→ D6b init = 0x01 with LSB=1),
      // and other sets to get D3b LSB=1 and D2b LSB=1.
      // A0[2]=0x01 → D2b=0x01 (LSB=1), D6b ^= 1 → 0x00. Hmm conflicts.
      //
      // Empirical approach: use an arbitrary byte pattern and validate only
      // bin/ts consistency.
      const inputRow = new Uint8Array(30);
      inputRow[0] = 0xff;
      inputRow[2] = 0x01;
      setup = {
        a2: WORK_RAM_BASE + 0x100,
        a3: 0x00400800,
        d2Word: 0,
        d3Word: 0,
        inputRowBytes: inputRow,
        initialCounter: 0,
        initialOutputBytes: new Uint8Array(10),
      };
    } else if (i === 2) {
      // D2w=1, D3w=1 → row stride.
      const inputRow = new Uint8Array(30);
      for (let k = 0; k < 30; k++) inputRow[k] = (k * 7) & 0xff;
      setup = {
        a2: WORK_RAM_BASE + 0x200,
        a3: 0x00400800,
        d2Word: 1,
        d3Word: 1,
        inputRowBytes: inputRow,
        initialCounter: 0,
        initialOutputBytes: new Uint8Array(10),
      };
    } else if (i === 3) {
      const inputRow = new Uint8Array(30);
      inputRow[0] = 0xff;
      inputRow[8] = 0xab; // perturbs syndromes
      setup = {
        a2: WORK_RAM_BASE + 0x100,
        a3: 0x00400800,
        d2Word: 0,
        d3Word: 0,
        inputRowBytes: inputRow,
        initialCounter: 0x1234,
        initialOutputBytes: new Uint8Array(10),
      };
    } else if (i === 4) {
      // Counter near overflow: 0xFFFE → +1 → 0xFFFF. Multiple increments.
      const inputRow = new Uint8Array(30);
      inputRow[2] = 0x01; // produces uncorrectable
      setup = {
        a2: WORK_RAM_BASE + 0x100,
        a3: 0x00400800,
        d2Word: 0,
        d3Word: 0,
        inputRowBytes: inputRow,
        initialCounter: 0xfffe,
        initialOutputBytes: new Uint8Array(10),
      };
    } else if (i === 5) {
      // Counter overflow: 0xFFFF → rollback (saturating).
      const inputRow = new Uint8Array(30);
      inputRow[2] = 0x01;
      setup = {
        a2: WORK_RAM_BASE + 0x100,
        a3: 0x00400800,
        d2Word: 0,
        d3Word: 0,
        inputRowBytes: inputRow,
        initialCounter: 0xffff,
        initialOutputBytes: new Uint8Array(10),
      };
    } else if (i === 6) {
      const inputRow = new Uint8Array(30);
      // Fill input with existing ROM bytes (0x10000..0x1001D).
      for (let k = 0; k < 30; k++) inputRow[k] = rom[0x10000 + k]!;
      setup = {
        a2: WORK_RAM_BASE + 0x100,
        a3: 0x00010000, // ROM ptr
        d2Word: 0,
        d3Word: 0,
        inputRowBytes: inputRow,
        initialCounter: 0,
        initialOutputBytes: new Uint8Array(10),
      };
    } else if (i < 50) {
      // Deterministic sweep over (a3, d2, d3).
      const inputRow = new Uint8Array(30);
      for (let k = 0; k < 30; k++) {
        inputRow[k] = ((i * 0x37 + k * 0x11) ^ 0x55) & 0xff;
      }
      setup = {
        a2: WORK_RAM_BASE + 0x100 + ((i * 0x10) & 0x3f0),
        a3: 0x00400800,
        d2Word: i & 7,
        d3Word: (i >> 3) & 7,
        inputRowBytes: inputRow,
        initialCounter: i & 0xffff,
        initialOutputBytes: new Uint8Array(10),
      };
    } else {
      // Random.
      const inputRow = new Uint8Array(30);
      for (let k = 0; k < 30; k++) {
        inputRow[k] = Math.floor(rng() * 256) & 0xff;
      }
      const initialOutput = new Uint8Array(10);
      for (let k = 0; k < 10; k++) {
        initialOutput[k] = Math.floor(rng() * 256) & 0xff;
      }
      // a2: 4-byte-aligned workRam, avoid overlap with A3 and counter range.
      // A2[0x11..0x12]. Limit A2 to 0x400000..0x401C00 stride 4.
      const a2OffRaw = (Math.floor(rng() * 0x700) * 4) & 0x1ffc;
      // Small d2/d3 (0..15) to avoid wraparound.
      const d2Word = Math.floor(rng() * 16);
      const d3Word = Math.floor(rng() * 16);
      const initialCounter = Math.floor(rng() * 0x10000) & 0xffff;
      setup = {
        a2: (WORK_RAM_BASE + a2OffRaw) >>> 0,
        a3: 0x00400800,
        d2Word,
        d3Word,
        inputRowBytes: inputRow,
        initialCounter,
        initialOutputBytes: initialOutput,
      };
    }

    // ─── Reset workRam (bin + TS) ─────────────────────────────────────
    // Zero-out workRam region in both.
    for (let k = 0; k < WORK_RAM_SIZE; k++) {
      pokeMem(cpu, WORK_RAM_BASE + k, 1, 0);
      state.workRam[k] = 0;
    }

    if (setup.a3 >= WORK_RAM_BASE && setup.a3 < WORK_RAM_BASE + WORK_RAM_SIZE) {
      const inputAbsAddr = setup.a3 + setup.d2Word * 30;
      for (let k = 0; k < 30; k++) {
        pokeMem(cpu, inputAbsAddr + k, 1, setup.inputRowBytes[k]!);
        const off = (inputAbsAddr - WORK_RAM_BASE) + k;
        if (off < WORK_RAM_SIZE) {
          state.workRam[off] = setup.inputRowBytes[k]!;
        }
      }
    } else {
      // A3 in ROM: setup.inputRowBytes must match the existing ROM.
      // unified memory, writable in test).
      const inputAbsAddr = setup.a3 + setup.d2Word * 30;
      for (let k = 0; k < 30; k++) {
        pokeMem(cpu, inputAbsAddr + k, 1, setup.inputRowBytes[k]!);
        const romOff = inputAbsAddr + k;
        if (romOff < tsRom.program.length) {
          tsRom.program[romOff] = setup.inputRowBytes[k]!;
        }
      }
    }

    const counterHi = (setup.initialCounter >>> 8) & 0xff;
    const counterLo = setup.initialCounter & 0xff;
    pokeMem(cpu, setup.a2 + 0x11, 1, counterHi);
    pokeMem(cpu, setup.a2 + 0x12, 1, counterLo);
    state.workRam[(setup.a2 - WORK_RAM_BASE) + 0x11] = counterHi;
    state.workRam[(setup.a2 - WORK_RAM_BASE) + 0x12] = counterLo;

    const outAbsAddr = setup.a2 + setup.d3Word * 10;
    for (let k = 0; k < 10; k++) {
      pokeMem(cpu, outAbsAddr + k, 1, setup.initialOutputBytes[k]!);
      const off = (outAbsAddr - WORK_RAM_BASE) + k;
      if (off < WORK_RAM_SIZE) {
        state.workRam[off] = setup.initialOutputBytes[k]!;
      }
    }

    // ─── Run binary ────────────────────────────────────────────────────
    const bin = runAndCaptureBin(
      cpu,
      setup.a2,
      setup.a3,
      setup.d2Word,
      setup.d3Word,
      10,
    );

    // ─── Run TS ────────────────────────────────────────────────────────
    const ts = ssNs.stateSub50F4(
      state,
      tsRom,
      setup.a2,
      setup.a3,
      setup.d2Word,
      setup.d3Word,
    );

    let diffField: string | null = null;
    if (!bin.reachedRts) {
      diffField = "reachedRts (bin timeout)";
    } else if (bin.d0 !== ts.d0) {
      diffField = `d0: bin=0x${bin.d0.toString(16)} ts=0x${ts.d0.toString(16)}`;
    } else if (bin.d2 !== ts.d2Out) {
      diffField = `d2: bin=0x${bin.d2.toString(16)} ts=0x${ts.d2Out.toString(16)}`;
    } else if (bin.d3 !== ts.d3Out) {
      diffField = `d3: bin=0x${bin.d3.toString(16)} ts=0x${ts.d3Out.toString(16)}`;
    } else if (bin.counterAfter !== ts.counterAfter) {
      diffField = `counter: bin=0x${bin.counterAfter.toString(16)} ts=0x${ts.counterAfter.toString(16)}`;
    } else {
      // Compare output region.
      for (let k = 0; k < 10; k++) {
        if (bin.outputBytes[k] !== ts.outputBytes[k]) {
          diffField = `output[${k}]: bin=0x${bin.outputBytes[k]!.toString(16)} ts=0x${ts.outputBytes[k]!.toString(16)}`;
          break;
        }
      }
    }

    if (diffField === null) {
      ok++;
    } else if (firstFail === null) {
      firstFail = { i, setup, bin, ts, diffField };
    }
  }

  console.log(`  Match: ${ok}/${n} = ${((ok / n) * 100).toFixed(1)}%`);
  if (firstFail) {
    console.log(`  First fail @ case ${firstFail.i}: ${firstFail.diffField}`);
    console.log(
      `    inputs: a2=0x${firstFail.setup.a2.toString(16)} a3=0x${firstFail.setup.a3.toString(16)} d2w=${firstFail.setup.d2Word} d3w=${firstFail.setup.d3Word} initialCounter=0x${firstFail.setup.initialCounter.toString(16)}`,
    );
    console.log(
      `    inputRow[0..15]: ${Array.from(firstFail.setup.inputRowBytes.slice(0, 16))
        .map((b) => `0x${b.toString(16).padStart(2, "0")}`)
        .join(" ")}`,
    );
    console.log(
      `    bin: d0=0x${firstFail.bin.d0.toString(16)} d2=0x${firstFail.bin.d2.toString(16)} d3=0x${firstFail.bin.d3.toString(16)} counter=0x${firstFail.bin.counterAfter.toString(16)}`,
    );
    console.log(
      `    ts:  d0=0x${firstFail.ts.d0.toString(16)} d2=0x${firstFail.ts.d2Out.toString(16)} d3=0x${firstFail.ts.d3Out.toString(16)} counter=0x${firstFail.ts.counterAfter.toString(16)}`,
    );
    console.log(
      `    bin out: ${Array.from(firstFail.bin.outputBytes)
        .map((b) => `0x${b.toString(16).padStart(2, "0")}`)
        .join(" ")}`,
    );
    console.log(
      `    ts  out: ${Array.from(firstFail.ts.outputBytes)
        .map((b) => `0x${b.toString(16).padStart(2, "0")}`)
        .join(" ")}`,
    );
  }

  disposeCpu(cpu);
  exit(ok === n ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  exit(1);
});
