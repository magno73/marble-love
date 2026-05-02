#!/usr/bin/env node
/**
 * test-array-helpers-parity.ts — differential FUN_1E3E vs fillIncrementingU16.
 *
 * Per N (dest, start, count) random:
 *   1. Reset 256 byte di scratch in workRam @ 0x401E00
 *   2. callFunction(0x1E3E, [dest, start, count])  // 3 args: long, word, long
 *   3. fillIncrementingU16(state, dest, start, count)
 *   4. Confronta byte 0x401E00..0x401EFF tra binary e TS.
 *
 * Note sul calling convention: il binario fa
 *   move.l (0xC,SP), A0   ; arg1 long  (dest)
 *   move.w (0x12,SP), D0w ; arg2 word  (start)
 *   move.l (0x14,SP), D2  ; arg3 long  (count)
 * Stack offsets: 12, 18, 20 (= 0xC, 0x12, 0x14). Considerando il movem.l
 * push iniziale di 8 byte + return addr 4 byte = 12 byte fissi, gli args
 * iniziano a SP+12. Quindi:
 *   arg1 (long) @ SP+12..15
 *   arg2 (word) @ SP+16..17 (NB: padding)
 *   arg3 (long) @ SP+18..21
 *
 * Wait — 0x12 = 18, 0x14 = 20. SP+12=arg1.l, SP+18=arg2.w, SP+20=arg3.l.
 * Quindi arg1 è 4 byte, arg2 è 2 byte (no padding), arg3 è 4 byte.
 * Total: 10 byte di args. Push order RTL: count(4), start(2), dest(4).
 *
 * Uso: npx tsx packages/cli/src/test-array-helpers-parity.ts [N]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import { state as stateNs, arrayHelpers } from "@marble-love/engine";
import {
  createCpu,
  callFunction,
  pokeMem,
  peekMem,
  disposeCpu,
} from "./binary-oracle-lib.js";
import type { CpuSession } from "./binary-oracle-lib.js";

const FUN_FILL = 0x00001e3e;
const FUN_INIT_HEADER = 0x0000255a;
const FUN_CLEAR_PAL = 0x000121A6;
const FUN_SWAP_LONG_PAIR = 0x00012886;
const SENTINEL = 0xCAFEBABE >>> 0;

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) >>> 0;
    return ((s >>> 16) & 0xffff) / 0x10000;
  };
}

/**
 * Calling FUN_1E3E. Convention 68k C-like: tutti gli args sono LONG (4 byte
 * ognuno), anche se la funzione li legge come word.
 *   `move.w (0x12, SP), D0w` legge il LOW word del long a SP+16..19.
 *
 * Push ordine RTL: count (long), start (long, low word = valore), dest (long).
 */
function callFill(cpu: CpuSession, dest: number, start: number, count: number): number {
  const sys = cpu.system;
  let sp = sys.getRegisters().sp;

  // Push count (long, RTL first)
  sp = (sp - 4) >>> 0;
  sys.write(sp, 4, count >>> 0);
  // Push start as long (high word zero, low word = start)
  sp = (sp - 4) >>> 0;
  sys.write(sp, 4, start & 0xffff);
  // Push dest (long)
  sp = (sp - 4) >>> 0;
  sys.write(sp, 4, dest >>> 0);
  // Push sentinel return addr
  sp = (sp - 4) >>> 0;
  sys.write(sp, 4, SENTINEL);

  sys.setRegister("sp", sp);
  sys.setRegister("pc", FUN_FILL);

  for (let i = 0; i < 20_000; i++) {
    if (sys.getRegisters().pc === SENTINEL) break;
    sys.step();
  }

  // Pop sentinel + 12 bytes args (3 longs)
  sys.setRegister("sp", (sys.getRegisters().sp + 4 + 12) >>> 0);

  return sys.getRegisters().d0;
}

async function main(): Promise<void> {
  const n = Number(process.argv[2] ?? "300");

  const romPath = resolve("ghidra_project/marble_program.bin");
  if (!existsSync(romPath)) {
    console.error(`error: ROM blob not found at ${romPath}`);
    exit(3);
  }
  const rom = readFileSync(romPath);

  const state = stateNs.emptyGameState();
  const cpu = await createCpu({ rom, state });

  console.log(`\n=== fillIncrementingU16 (FUN_1E3E) — ${n} casi ===`);

  const rng = makeRng(0xbeef);
  let ok = 0;
  let firstFail: { dest: number; start: number; count: number; binByte: number; tsByte: number; offset: number } | null = null;

  // Scratch area in workRam, lontano da stack (SP=0x401F00 scende a ~0x401EE0)
  // Usiamo 0x401D00..0x401DFF — 256 byte, distanti da stack/obj array
  const SCRATCH_ADDR = 0x401d00;
  const SCRATCH_SIZE = 0x100;

  /** Generic call helper per funzioni a 3 long args (cdecl 68k). */
  function call3LongArgs(addr: number, a1: number, a2: number, a3: number): void {
    const sys = cpu.system;
    let sp = sys.getRegisters().sp;
    sp = (sp - 4) >>> 0; sys.write(sp, 4, a3 >>> 0);
    sp = (sp - 4) >>> 0; sys.write(sp, 4, a2 >>> 0);
    sp = (sp - 4) >>> 0; sys.write(sp, 4, a1 >>> 0);
    sp = (sp - 4) >>> 0; sys.write(sp, 4, SENTINEL);
    sys.setRegister("sp", sp);
    sys.setRegister("pc", addr);
    for (let i = 0; i < 20_000; i++) {
      if (sys.getRegisters().pc === SENTINEL) break;
      sys.step();
    }
    sys.setRegister("sp", (sys.getRegisters().sp + 4 + 12) >>> 0);
  }

  for (let i = 0; i < n; i++) {
    cpu.system.setRegister("sp", 0x401f00);

    const count = Math.floor(rng() * 50);
    const start = Math.floor(rng() * 0x10000) & 0xffff;
    const maxOffset = SCRATCH_SIZE - count * 2;
    const offset = Math.floor(rng() * Math.max(1, maxOffset));
    const dest = SCRATCH_ADDR + offset;

    // Fill scratch with sentinel value 0x55 in BOTH (then compare)
    for (let j = 0; j < SCRATCH_SIZE; j++) {
      pokeMem(cpu, SCRATCH_ADDR + j, 1, 0x55);
      state.workRam[(SCRATCH_ADDR - 0x400000) + j] = 0x55;
    }

    // Run binary
    callFill(cpu, dest, start, count);

    // Run TS
    arrayHelpers.fillIncrementingU16(state, dest, start, count);

    // Compare scratch
    let match = true;
    for (let j = 0; j < SCRATCH_SIZE; j++) {
      const binByte = peekMem(cpu, SCRATCH_ADDR + j, 1);
      const tsByte = state.workRam[(SCRATCH_ADDR - 0x400000) + j] ?? 0;
      if (binByte !== tsByte) {
        match = false;
        if (firstFail === null) {
          firstFail = { dest, start, count, binByte, tsByte, offset: j };
        }
        break;
      }
    }
    if (match) ok++;
  }
  console.log(`  Match: ${ok}/${n} = ${((ok / n) * 100).toFixed(1)}%`);
  if (firstFail) {
    console.log(`  First fail: dest=0x${firstFail.dest.toString(16)} start=0x${firstFail.start.toString(16)} count=${firstFail.count}`);
    console.log(`    diff at scratch offset 0x${firstFail.offset.toString(16)}: bin=0x${firstFail.binByte.toString(16)} ts=0x${firstFail.tsByte.toString(16)}`);
  }

  // ─── initStructHeader (FUN_255A) ─────────────────────────────────────
  console.log(`\n=== initStructHeader (FUN_255A) — ${n} casi ===`);
  let ok2 = 0;
  for (let i = 0; i < n; i++) {
    cpu.system.setRegister("sp", 0x401f00);
    const offset = Math.floor(rng() * (SCRATCH_SIZE - 8));
    const ptr = SCRATCH_ADDR + offset;
    const byteB = Math.floor(rng() * 256) & 0xff;
    const byteC = Math.floor(rng() * 256) & 0xff;

    // Fill scratch with sentinel 0x55
    for (let j = 0; j < SCRATCH_SIZE; j++) {
      pokeMem(cpu, SCRATCH_ADDR + j, 1, 0x55);
      state.workRam[(SCRATCH_ADDR - 0x400000) + j] = 0x55;
    }

    call3LongArgs(FUN_INIT_HEADER, ptr, byteB, byteC);
    arrayHelpers.initStructHeader(state, ptr, byteB, byteC);

    let m = true;
    for (let j = 0; j < SCRATCH_SIZE; j++) {
      if (peekMem(cpu, SCRATCH_ADDR + j, 1) !== (state.workRam[(SCRATCH_ADDR - 0x400000) + j] ?? 0)) {
        m = false;
        break;
      }
    }
    if (m) ok2++;
  }
  console.log(`  Match: ${ok2}/${n} = ${((ok2 / n) * 100).toFixed(1)}%`);

  // ─── clearPaletteRam (FUN_121A6) ─────────────────────────────────────
  // Una sola call: pre-fill palette RAM con sentinel, run, verifica.
  console.log(`\n=== clearPaletteRam (FUN_121A6) — 1 caso ===`);
  cpu.system.setRegister("sp", 0x401f00);
  // Pre-fill palette RAM con sentinel pattern
  for (let j = 0; j < 0x800; j++) {
    pokeMem(cpu, 0xB00000 + j, 1, 0xCC);
    state.colorRam[j] = 0xCC;
  }
  callFunction(cpu, FUN_CLEAR_PAL, []);
  arrayHelpers.clearPaletteRam(state);
  let okClear = true;
  for (let j = 0; j < 0x800; j++) {
    const b = peekMem(cpu, 0xB00000 + j, 1);
    const t = state.colorRam[j] ?? 0;
    if (b !== 0 || t !== 0) {
      okClear = false;
      console.log(`  diff at 0x${(0xB00000 + j).toString(16)}: bin=${b} ts=${t}`);
      break;
    }
  }
  console.log(`  Match: ${okClear ? 1 : 0}/1 = ${okClear ? "100.0" : "0.0"}%`);

  // ─── swapLongPair (FUN_12886) ────────────────────────────────────────
  console.log(`\n=== swapLongPair (FUN_12886) — ${n} casi ===`);
  let okSwap = 0;
  let firstFailSwap: { ptr: number; offset: number; bin: number; ts: number } | null = null;
  for (let i = 0; i < n; i++) {
    cpu.system.setRegister("sp", 0x401f00);
    const offset = Math.floor(rng() * (SCRATCH_SIZE - 16));
    const ptr = SCRATCH_ADDR + offset;
    // Random 8 bytes
    const bytes = new Array(8).fill(0).map(() => Math.floor(rng() * 256) & 0xff);
    for (let j = 0; j < SCRATCH_SIZE; j++) {
      pokeMem(cpu, SCRATCH_ADDR + j, 1, 0x55);
      state.workRam[(SCRATCH_ADDR - 0x400000) + j] = 0x55;
    }
    for (let j = 0; j < 8; j++) {
      pokeMem(cpu, ptr + j, 1, bytes[j] ?? 0);
      state.workRam[(ptr - 0x400000) + j] = bytes[j] ?? 0;
    }
    callFunction(cpu, FUN_SWAP_LONG_PAIR, [ptr]);
    arrayHelpers.swapLongPair(state, ptr);
    let ok = true;
    for (let j = 0; j < SCRATCH_SIZE; j++) {
      const b = peekMem(cpu, SCRATCH_ADDR + j, 1);
      const t = state.workRam[(SCRATCH_ADDR - 0x400000) + j] ?? 0;
      if (b !== t) {
        ok = false;
        if (firstFailSwap === null) firstFailSwap = { ptr, offset: j, bin: b, ts: t };
        break;
      }
    }
    if (ok) okSwap++;
  }
  console.log(`  Match: ${okSwap}/${n} = ${((okSwap / n) * 100).toFixed(1)}%`);
  if (firstFailSwap) {
    const { ptr, offset, bin, ts } = firstFailSwap;
    console.log(`  First fail: ptr=0x${ptr.toString(16)} @ offset 0x${offset.toString(16)}: bin=0x${bin.toString(16)} ts=0x${ts.toString(16)}`);
  }

  disposeCpu(cpu);
  exit((ok === n && ok2 === n && okClear && okSwap === n) ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  exit(1);
});
