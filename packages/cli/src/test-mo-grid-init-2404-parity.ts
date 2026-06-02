#!/usr/bin/env node
/**
 * test-mo-grid-init-2404-parity.ts — differential FUN_2404 vs moGridInit2404.
 *
 *
 * Caller convention (cdecl push-RTL):
 *   - return D0 not meaningful (caller does not use it)
 *
 * Parity strategy:
 *
 *
 * from the 4 KB of SPRITE_RAM. On Musashi, the unified memory has SPRITE_RAM_BASE..
 * SPRITE_RAM_END + ALPHA_RAM_BASE..ALPHA_RAM_END contiguous (0xA02000..0xA03FFF).
 * does: increment *0x40000C from 0).
 *
 * Usage: npx tsx packages/cli/src/test-mo-grid-init-2404-parity.ts [N]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import {
  state as stateNs,
  bus as busNs,
  moGridInit2404 as modNs,
} from "@marble-love/engine";
import type { RomImage } from "@marble-love/engine";
import {
  createCpu,
  callFunction,
  pokeMem,
  peekMem,
  disposeCpu,
} from "./binary-oracle-lib.js";

const FUN_2404 = 0x00002404;
const SPRITE_RAM_BASE = 0x00a02000;
const SPRITE_RAM_SIZE = 0x1000; // 4 KB

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

  const state = stateNs.emptyGameState();
  const cpu = await createCpu({ rom, state });

  const tsRom: RomImage = busNs.emptyRomImage();
  tsRom.program.set(rom.subarray(0, tsRom.program.length));

  console.log(`\n=== moGridInit2404 (FUN_2404) — ${n} cases ===`);

  const rng = makeRng(0x24042404);
  let ok = 0;
  let firstFail: {
    i: number;
    arg1: number;
    diffOff: number;
    binByte: number;
    tsByte: number;
    diffCount: number;
  } | null = null;

  for (let i = 0; i < n; i++) {
    cpu.system.setRegister("sp", 0x401f00);

    // Pattern of coverage su arg1.
    let arg1: number;
    if (i === 0) {
      arg1 = 0; // bank 0, MMIO=0
    } else if (i === 1) {
      arg1 = 1;
    } else if (i === 2) {
      arg1 = 7; // bank 7 (last bank valido in 4KB)
    } else if (i === 3) {
      arg1 = 3;
    } else if (i === 4) {
      arg1 = 5;
    } else if (i < 16) {
      // Repeated deterministic sweep 0..7.
      arg1 = (i - 5) % 8;
    } else {
      arg1 = Math.floor(rng() * 8);
    }

    // Zero Musashi spriteRam (SPRITE_RAM_BASE..SPRITE_RAM_END region).
    for (let k = 0; k < SPRITE_RAM_SIZE; k++) {
      pokeMem(cpu, SPRITE_RAM_BASE + k, 1, 0);
    }

    // Zero spriteRam TS.
    state.spriteRam.fill(0);

    callFunction(cpu, FUN_2404, [arg1]);

    // Run the TS replica.
    modNs.moGridInit2404(state, tsRom, arg1);

    let diffCount = 0;
    let firstDiffOff = -1;
    let firstBinByte = 0;
    let firstTsByte = 0;
    for (let k = 0; k < SPRITE_RAM_SIZE; k++) {
      const binByte = peekMem(cpu, SPRITE_RAM_BASE + k, 1) & 0xff;
      const tsByte = state.spriteRam[k]! & 0xff;
      if (binByte !== tsByte) {
        if (firstDiffOff === -1) {
          firstDiffOff = k;
          firstBinByte = binByte;
          firstTsByte = tsByte;
        }
        diffCount++;
      }
    }

    if (diffCount === 0) {
      ok++;
    } else if (firstFail === null) {
      firstFail = {
        i,
        arg1,
        diffOff: firstDiffOff,
        binByte: firstBinByte,
        tsByte: firstTsByte,
        diffCount,
      };
    }
  }

  console.log(`  Match: ${ok}/${n} = ${((ok / n) * 100).toFixed(1)}%`);
  if (firstFail) {
    console.log(`  First fail @ case ${firstFail.i}:`);
    console.log(`    arg1=0x${firstFail.arg1.toString(16)}`);
    console.log(
      `    spriteRam diff: ${firstFail.diffCount} byte; first @ off=0x${firstFail.diffOff.toString(16)}` +
        ` bin=0x${firstFail.binByte.toString(16).padStart(2, "0")}` +
        ` ts=0x${firstFail.tsByte.toString(16).padStart(2, "0")}`,
    );
  }

  disposeCpu(cpu);
  exit(ok === n ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  exit(1);
});
