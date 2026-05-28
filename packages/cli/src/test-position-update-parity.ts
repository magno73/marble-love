#!/usr/bin/env node
/**
 * test-position-update-parity.ts — differential FUN_1706C vs positionUpdate.
 *
 * 452 byte pure leaf, 0 jsr. Differential test su 8 byte di output (x, y long).
 *
 * Randomized setup per case:
 *   - Struct 8 byte (x, y) random
 *   - workRam state (4 byte flag, 4 word gate, 2 byte rotation, 1 byte bitmap)
 *
 * Uso: npx tsx packages/cli/src/test-position-update-parity.ts [N]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import { state as stateNs, positionUpdate, bus as busNs } from "@marble-love/engine";
import type { RomImage } from "@marble-love/engine";
import {
  createCpu,
  callFunction,
  pokeMem,
  peekMem,
  disposeCpu,
} from "./binary-oracle-lib.js";

const FUN_POSITION_UPDATE = 0x0001706c;

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

  // Build TS RomImage
  const tsRom: RomImage = busNs.emptyRomImage();
  tsRom.program.set(rom.subarray(0, tsRom.program.length));

  console.log(`\n=== positionUpdate (FUN_1706C) — ${n} casi ===`);

  const rng = makeRng(0xface);
  const STRUCT_ADDR = 0x00401d00;

  let ok = 0;
  let firstFail: { case: number; offset: number; bin: number; ts: number } | null = null;

  for (let i = 0; i < n; i++) {
    cpu.system.setRegister("sp", 0x401f00);

    // Random struct (8 byte)
    const x = Math.floor(rng() * 0x100000000) >>> 0;
    const y = Math.floor(rng() * 0x100000000) >>> 0;
    pokeMem(cpu, STRUCT_ADDR + 0, 4, x);
    pokeMem(cpu, STRUCT_ADDR + 4, 4, y);
    stateInst.workRam[(STRUCT_ADDR - 0x400000) + 0] = (x >>> 24) & 0xff;
    stateInst.workRam[(STRUCT_ADDR - 0x400000) + 1] = (x >>> 16) & 0xff;
    stateInst.workRam[(STRUCT_ADDR - 0x400000) + 2] = (x >>> 8) & 0xff;
    stateInst.workRam[(STRUCT_ADDR - 0x400000) + 3] = x & 0xff;
    stateInst.workRam[(STRUCT_ADDR - 0x400000) + 4] = (y >>> 24) & 0xff;
    stateInst.workRam[(STRUCT_ADDR - 0x400000) + 5] = (y >>> 16) & 0xff;
    stateInst.workRam[(STRUCT_ADDR - 0x400000) + 6] = (y >>> 8) & 0xff;
    stateInst.workRam[(STRUCT_ADDR - 0x400000) + 7] = y & 0xff;

    // Random workRam state
    // All byte/word values @ 0x40066A..0x4006A1 are used.
    const stateBytes: { addr: number; size: number; value: number }[] = [
      { addr: 0x40066A, size: 1, value: Math.floor(rng() * 256) & 0xff },         // bitmap
      { addr: 0x40066C, size: 1, value: Math.floor(rng() * 4) & 0xff },           // flag PX (0..3)
      { addr: 0x40066E, size: 1, value: Math.floor(rng() * 4) & 0xff },           // flag PY
      { addr: 0x400670, size: 1, value: Math.floor(rng() * 4) & 0xff },           // flag NX
      { addr: 0x400672, size: 1, value: Math.floor(rng() * 4) & 0xff },           // flag NY
      { addr: 0x400674, size: 2, value: Math.floor(rng() * 0x10000) & 0xffff },   // gate PX
      { addr: 0x400676, size: 2, value: Math.floor(rng() * 0x10000) & 0xffff },   // gate PY
      { addr: 0x400678, size: 2, value: Math.floor(rng() * 0x10000) & 0xffff },   // gate NX
      { addr: 0x40067A, size: 2, value: Math.floor(rng() * 0x10000) & 0xffff },   // gate NY
      { addr: 0x40069F, size: 1, value: Math.floor(rng() * 8) & 0xff },           // rotation idx 0..7
      { addr: 0x4006A1, size: 1, value: Math.floor(rng() * 8) & 0xff },           // rotation spec
    ];
    for (const { addr, size, value } of stateBytes) {
      pokeMem(cpu, addr, size as 1 | 2 | 4, value);
      const off = addr - 0x400000;
      if (size === 1) {
        stateInst.workRam[off] = value & 0xff;
      } else {
        stateInst.workRam[off] = (value >>> 8) & 0xff;
        stateInst.workRam[off + 1] = value & 0xff;
      }
    }

    // RUN BINARY (1 long arg = struct addr)
    callFunction(cpu, FUN_POSITION_UPDATE, [STRUCT_ADDR]);

    // RUN TS
    positionUpdate.positionUpdate(stateInst, tsRom, STRUCT_ADDR);

    // COMPARE: 8 byte struct
    let matched = true;
    for (let k = 0; k < 8; k++) {
      const b = peekMem(cpu, STRUCT_ADDR + k, 1);
      const t = stateInst.workRam[(STRUCT_ADDR - 0x400000) + k] ?? 0;
      if (b !== t) {
        matched = false;
        if (firstFail === null) firstFail = { case: i, offset: k, bin: b, ts: t };
        break;
      }
    }

    if (matched) ok++;
  }

  console.log(`  Match: ${ok}/${n} = ${((ok / n) * 100).toFixed(1)}%`);
  if (firstFail) {
    const { case: c, offset, bin, ts } = firstFail;
    console.log(`  First fail: case ${c} @ struct+${offset}: bin=0x${bin.toString(16)} ts=0x${ts.toString(16)}`);
  }

  disposeCpu(cpu);
  exit(ok === n ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  exit(1);
});
