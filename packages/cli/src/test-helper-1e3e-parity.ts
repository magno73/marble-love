#!/usr/bin/env node
/**
 * test-helper-1e3e-parity.ts — differential FUN_00001E3E vs `fillSeqWords1E3E`.
 *
 * **Strategia** (500 casi):
 *   Per ogni caso:
 *   1. Genera `count` (0..64), `startValue` (0..0xFFFF), `destOffset` random.
 *   2. Imposta scratch area (256 byte in workRam) a 0x55 in entrambi (binary + TS).
 *   3. Chiama il binario (FUN_1E3E) con (dest, startValue, count).
 *   4. Chiama `fillSeqWords1E3E(state, dest, startValue, count)`.
 *   5. Confronta byte per byte la scratch area.
 *
 * **Calling convention FUN_1E3E** (stack layout dopo prologue movem di 8 byte):
 *   SP+0x0C  arg1 = dest (long)
 *   SP+0x12  arg2 = startValue (low word di un long — high word ignorato)
 *   SP+0x14  arg3 = count (long, signed)
 *
 * Uso: npx tsx packages/cli/src/test-helper-1e3e-parity.ts [N]
 *      default N=500
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import { state as stateNs, helper1E3E as helperNs } from "@marble-love/engine";
import {
  createCpu,
  pokeMem,
  peekMem,
  disposeCpu,
} from "./binary-oracle-lib.js";
import type { CpuSession } from "./binary-oracle-lib.js";

const FUN_1E3E_ADDR = 0x00001e3e;
const WORK_RAM_BASE = 0x00400000;
const SCRATCH_ADDR  = 0x00401d00;
const SCRATCH_SIZE  = 0x100;
const SENTINEL      = 0xdeadbeef >>> 0;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) >>> 0;
    return ((s >>> 16) & 0xffff) / 0x10000;
  };
}

/**
 * Chiama FUN_1E3E con calling convention M68k:
 *   push count   (long)
 *   push start   (long — low word = startValue)
 *   push dest    (long)
 *   push sentinel (ret addr)
 *   set PC = FUN_1E3E; step finché PC == sentinel
 *   pop 4 + 12 bytes
 */
function callFun1E3E(
  cpu: CpuSession,
  dest: number,
  startValue: number,
  count: number,
): void {
  const sys = cpu.system;
  let sp = sys.getRegisters().sp;

  // Push RTL: count → start → dest
  sp = (sp - 4) >>> 0;
  sys.write(sp, 4, count >>> 0);
  sp = (sp - 4) >>> 0;
  sys.write(sp, 4, startValue & 0xffff); // low word = startValue, high = 0
  sp = (sp - 4) >>> 0;
  sys.write(sp, 4, dest >>> 0);

  // Sentinel return addr
  sp = (sp - 4) >>> 0;
  sys.write(sp, 4, SENTINEL);

  sys.setRegister("sp", sp);
  sys.setRegister("pc", FUN_1E3E_ADDR);

  for (let i = 0; i < 50_000; i++) {
    if (sys.getRegisters().pc === SENTINEL) break;
    sys.step();
  }

  // Pop sentinel + 12 byte di argomenti (3 × long)
  sys.setRegister("sp", (sys.getRegisters().sp + 4 + 12) >>> 0);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const n = Number(process.argv[2] ?? "500");

  const romPath = resolve("ghidra_project/marble_program.bin");
  if (!existsSync(romPath)) {
    console.error(`error: ROM blob not found at ${romPath}`);
    exit(3);
  }
  const rom = readFileSync(romPath);

  const tsState = stateNs.emptyGameState();
  const cpu = await createCpu({ rom, state: tsState });

  const rng = makeRng(0x1e3e);

  console.log(`\n=== fillSeqWords1E3E (FUN_0001E3E) — ${n} casi ===`);

  let ok = 0;
  type FailRec = {
    caseNo: number;
    dest: number;
    startValue: number;
    count: number;
    scratchOffset: number;
    binByte: number;
    tsByte: number;
  };
  let firstFail: FailRec | null = null;

  for (let i = 0; i < n; i++) {
    cpu.system.setRegister("sp", 0x401f00);

    const count      = Math.floor(rng() * 65);             // 0..64
    const startValue = Math.floor(rng() * 0x10000) & 0xffff;
    const maxOffset  = SCRATCH_SIZE - count * 2;
    const destOff    = maxOffset > 0 ? Math.floor(rng() * maxOffset) & ~1 : 0; // word-aligned
    const dest       = SCRATCH_ADDR + destOff;

    // Imposta scratch a 0x55 in entrambi (binary + TS)
    for (let j = 0; j < SCRATCH_SIZE; j++) {
      pokeMem(cpu, SCRATCH_ADDR + j, 1, 0x55);
      tsState.workRam[(SCRATCH_ADDR - WORK_RAM_BASE) + j] = 0x55;
    }

    // Run binary
    callFun1E3E(cpu, dest, startValue, count);

    // Run TS
    helperNs.fillSeqWords1E3E(tsState, dest, startValue, count);

    // Confronta scratch byte per byte
    let match = true;
    for (let j = 0; j < SCRATCH_SIZE; j++) {
      const binByte = peekMem(cpu, SCRATCH_ADDR + j, 1);
      const tsByte  = tsState.workRam[(SCRATCH_ADDR - WORK_RAM_BASE) + j] ?? 0;
      if (binByte !== tsByte) {
        firstFail ??= {
          caseNo: i,
          dest,
          startValue,
          count,
          scratchOffset: j,
          binByte,
          tsByte,
        };
        match = false;
        break;
      }
    }
    if (match) ok++;
  }

  console.log(`  Match: ${ok}/${n} = ${((ok / n) * 100).toFixed(1)}%`);
  if (firstFail) {
    const f = firstFail;
    console.log(`  First fail: case ${f.caseNo} dest=0x${f.dest.toString(16)} start=0x${f.startValue.toString(16)} count=${f.count}`);
    console.log(`    diff at scratch offset 0x${f.scratchOffset.toString(16)}: bin=0x${f.binByte.toString(16)} ts=0x${f.tsByte.toString(16)}`);
  }

  disposeCpu(cpu);
  exit(ok === n ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  exit(1);
});
