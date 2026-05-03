#!/usr/bin/env node
/**
 * test-vector-scale-parity.ts — differential FUN_25E7C vs vectorScale.
 *
 * 326 byte pure leaf, 0 jsr, 0 globali. Solo arg pointer + 1 byte mode.
 * Differential test su 8 byte di output (x, y long).
 *
 * Uso: npx tsx packages/cli/src/test-vector-scale-parity.ts [N]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import { state as stateNs, vectorScale, bus as busNs } from "@marble-love/engine";
import type { RomImage } from "@marble-love/engine";
import {
  createCpu,
  callFunction,
  pokeMem,
  peekMem,
  disposeCpu,
} from "./binary-oracle-lib.js";

const FUN_VECTOR_SCALE = 0x00025e7c;

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
  const rom = readFileSync(romPath);

  const stateInst = stateNs.emptyGameState();
  const cpu = await createCpu({ rom, state: stateInst });

  const tsRom: RomImage = busNs.emptyRomImage();
  tsRom.program.set(rom.subarray(0, tsRom.program.length));

  console.log(`\n=== vectorScale (FUN_25E7C) — ${n} casi ===`);

  const rng = makeRng(0xbaba);
  const VEC_ADDR = 0x00401d00;

  let ok = 0;
  let firstFail: { case: number; mode: number; xIn: number; yIn: number; xBin: number; yBin: number; xTs: number; yTs: number } | null = null;

  for (let i = 0; i < n; i++) {
    cpu.system.setRegister("sp", 0x401f00);

    // Constrain x, y to small range to evitare divu.w overflow:
    // D2/D4 ≤ ~256 → D3 ≤ ~352 + clamp → D3 = 0x100. D3 >> 8 = 1 (divisor).
    // D4 << 6 ≤ 0x4000. Quotient ≤ 0x4000 — fits in word, no overflow.
    // Range [-256, 255] (signed byte sext to long).
    const xRaw = Math.floor(rng() * 512) - 256;
    const yRaw = Math.floor(rng() * 512) - 256;
    const x = xRaw >>> 0; // unsigned representation
    const y = yRaw >>> 0;
    const mode = 2 + Math.floor(rng() * 4); // mode 2..5

    pokeMem(cpu, VEC_ADDR + 0, 4, x);
    pokeMem(cpu, VEC_ADDR + 4, 4, y);
    stateInst.workRam[(VEC_ADDR - 0x400000) + 0] = (x >>> 24) & 0xff;
    stateInst.workRam[(VEC_ADDR - 0x400000) + 1] = (x >>> 16) & 0xff;
    stateInst.workRam[(VEC_ADDR - 0x400000) + 2] = (x >>> 8) & 0xff;
    stateInst.workRam[(VEC_ADDR - 0x400000) + 3] = x & 0xff;
    stateInst.workRam[(VEC_ADDR - 0x400000) + 4] = (y >>> 24) & 0xff;
    stateInst.workRam[(VEC_ADDR - 0x400000) + 5] = (y >>> 16) & 0xff;
    stateInst.workRam[(VEC_ADDR - 0x400000) + 6] = (y >>> 8) & 0xff;
    stateInst.workRam[(VEC_ADDR - 0x400000) + 7] = y & 0xff;

    // RUN BINARY (cdecl: 2 long args = ptr, mode-as-long)
    callFunction(cpu, FUN_VECTOR_SCALE, [VEC_ADDR, mode]);

    // RUN TS
    vectorScale.vectorScale(stateInst, tsRom, VEC_ADDR, mode);

    // COMPARE: 8 byte
    const xBin = (peekMem(cpu, VEC_ADDR + 0, 4) >>> 0);
    const yBin = (peekMem(cpu, VEC_ADDR + 4, 4) >>> 0);
    const xTs = (
      ((stateInst.workRam[(VEC_ADDR - 0x400000) + 0] ?? 0) << 24) |
      ((stateInst.workRam[(VEC_ADDR - 0x400000) + 1] ?? 0) << 16) |
      ((stateInst.workRam[(VEC_ADDR - 0x400000) + 2] ?? 0) << 8) |
      (stateInst.workRam[(VEC_ADDR - 0x400000) + 3] ?? 0)
    ) >>> 0;
    const yTs = (
      ((stateInst.workRam[(VEC_ADDR - 0x400000) + 4] ?? 0) << 24) |
      ((stateInst.workRam[(VEC_ADDR - 0x400000) + 5] ?? 0) << 16) |
      ((stateInst.workRam[(VEC_ADDR - 0x400000) + 6] ?? 0) << 8) |
      (stateInst.workRam[(VEC_ADDR - 0x400000) + 7] ?? 0)
    ) >>> 0;

    if (xBin === xTs && yBin === yTs) ok++;
    else if (firstFail === null) {
      firstFail = { case: i, mode, xIn: x, yIn: y, xBin, yBin, xTs, yTs };
    }
  }

  console.log(`  Match: ${ok}/${n} = ${((ok / n) * 100).toFixed(1)}%`);
  if (firstFail) {
    const { case: c, mode, xIn, yIn, xBin, yBin, xTs, yTs } = firstFail;
    console.log(`  First fail: case ${c} mode=${mode} xIn=0x${xIn.toString(16)} yIn=0x${yIn.toString(16)}`);
    console.log(`    bin: x=0x${xBin.toString(16)} y=0x${yBin.toString(16)}`);
    console.log(`    ts:  x=0x${xTs.toString(16)} y=0x${yTs.toString(16)}`);
  }

  disposeCpu(cpu);
  exit(ok === n ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  exit(1);
});
