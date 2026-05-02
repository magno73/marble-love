#!/usr/bin/env node
/**
 * test-string-format-parity.ts — differential FUN_3A08 vs formatHex.
 *
 * Per N (value, bufEnd, numDigits, showSpaces) random:
 *   1. Reset 64 byte di scratch
 *   2. callFunction(0x3A08, [value, bufEnd, numDigits, showSpaces])
 *   3. formatHex TS sullo stesso state
 *   4. Confronta scratch byte-by-byte
 *
 * Uso: npx tsx packages/cli/src/test-string-format-parity.ts [N]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import { state as stateNs, stringFormat } from "@marble-love/engine";
import {
  createCpu,
  pokeMem,
  peekMem,
  disposeCpu,
} from "./binary-oracle-lib.js";
import type { CpuSession } from "./binary-oracle-lib.js";

const FUN_FORMAT_HEX = 0x00003a08;
const SENTINEL = 0xCAFEBABE >>> 0;

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) >>> 0;
    return ((s >>> 16) & 0xffff) / 0x10000;
  };
}

/** Call FUN_3A08 con 4 long args (cdecl 68k). */
function callFormatHex(
  cpu: CpuSession,
  value: number,
  bufEnd: number,
  numDigits: number,
  showSpaces: number,
): void {
  const sys = cpu.system;
  let sp = sys.getRegisters().sp;
  // Push RTL: showSpaces, numDigits, bufEnd, value
  sp = (sp - 4) >>> 0; sys.write(sp, 4, showSpaces >>> 0);
  sp = (sp - 4) >>> 0; sys.write(sp, 4, numDigits >>> 0);
  sp = (sp - 4) >>> 0; sys.write(sp, 4, bufEnd >>> 0);
  sp = (sp - 4) >>> 0; sys.write(sp, 4, value >>> 0);
  sp = (sp - 4) >>> 0; sys.write(sp, 4, SENTINEL);
  sys.setRegister("sp", sp);
  sys.setRegister("pc", FUN_FORMAT_HEX);
  for (let i = 0; i < 20_000; i++) {
    if (sys.getRegisters().pc === SENTINEL) break;
    sys.step();
  }
  // Pop sentinel + 16 byte (4 long args)
  sys.setRegister("sp", (sys.getRegisters().sp + 4 + 16) >>> 0);
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

  console.log(`\n=== formatHex (FUN_3A08) — ${n} casi ===`);

  const rng = makeRng(0xface);
  const SCRATCH_ADDR = 0x401d00;
  const SCRATCH_SIZE = 0x40; // 64 byte
  let ok = 0;
  let firstFail: { value: number; bufEnd: number; numDigits: number; showSpaces: number; offset: number; bin: number; ts: number } | null = null;

  for (let i = 0; i < n; i++) {
    cpu.system.setRegister("sp", 0x401f00);

    // Random params
    const value = Math.floor(rng() * 0x100000000) >>> 0;
    const numDigits = 1 + Math.floor(rng() * 8); // 1..8
    const showSpaces = rng() < 0.5 ? 0 : 1;
    const offset = Math.floor(rng() * (SCRATCH_SIZE - numDigits - 2));
    const bufEnd = SCRATCH_ADDR + offset;

    // Fill scratch with sentinel 0x55
    for (let j = 0; j < SCRATCH_SIZE; j++) {
      pokeMem(cpu, SCRATCH_ADDR + j, 1, 0x55);
      state.workRam[(SCRATCH_ADDR - 0x400000) + j] = 0x55;
    }

    callFormatHex(cpu, value, bufEnd, numDigits, showSpaces);
    stringFormat.formatHex(state, value, bufEnd, numDigits, showSpaces);

    let m = true;
    for (let j = 0; j < SCRATCH_SIZE; j++) {
      const b = peekMem(cpu, SCRATCH_ADDR + j, 1);
      const t = state.workRam[(SCRATCH_ADDR - 0x400000) + j] ?? 0;
      if (b !== t) {
        m = false;
        if (firstFail === null) firstFail = {
          value, bufEnd, numDigits, showSpaces, offset: j, bin: b, ts: t,
        };
        break;
      }
    }
    if (m) ok++;
  }
  console.log(`  Match: ${ok}/${n} = ${((ok / n) * 100).toFixed(1)}%`);
  if (firstFail) {
    const { value, bufEnd, numDigits, showSpaces, offset, bin, ts } = firstFail;
    console.log(`  First fail: value=0x${value.toString(16)} bufEnd=0x${bufEnd.toString(16)} digits=${numDigits} showSp=${showSpaces}`);
    console.log(`    diff at scratch offset 0x${offset.toString(16)}: bin=0x${bin.toString(16)} ts=0x${ts.toString(16)}`);
    // Print expected string
    const expected: string[] = [];
    for (let j = 0; j < numDigits + 1; j++) {
      const b = peekMem(cpu, bufEnd + j, 1);
      expected.push(`0x${b.toString(16).padStart(2, "0")}`);
    }
    console.log(`    bin string @ bufEnd: [${expected.join(", ")}]`);
  }

  disposeCpu(cpu);
  exit(ok === n ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  exit(1);
});
