#!/usr/bin/env node
/**
 * test-alpha-ram-boot-init-ed6-parity.ts — differential FUN_ED6 vs
 * `alphaRamBootInitED6`.
 *
 *   - 30 row × 84 byte (loop 1, ROM-driven)
 *   - 34 word a offset 0x008..0x04B (loop 2, costante 0x2000)
 *   - 34 word a offset 0xE88..0xECB (loop 3, costante 0x2000)
 * The rest of the alpha RAM (44 "skip" bytes per row + 0xF00..0xFFF)
 * stays com'era.
 *
 * Strategia of test:
 *     1. Pre-fill alpha RAM [0xA03000..0xA04000) with a random pattern
 *        (sincronizzato between binary and TS).
 *
 *
 * Uso: npx tsx packages/cli/src/test-alpha-ram-boot-init-ed6-parity.ts [N]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import {
  state as stateNs,
  bus as busNs,
  alphaRamBootInitED6 as modNs,
} from "@marble-love/engine";
import type { RomImage } from "@marble-love/engine";
import {
  createCpu,
  callFunction,
  pokeMem,
  peekMem,
  disposeCpu,
} from "./binary-oracle-lib.js";

const FUN_ED6 = 0x00000ed6;
const ALPHA_RAM_BASE = 0xa03000;
const ALPHA_RAM_SIZE = 0x1000;

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

  console.log(`\n=== alphaRamBootInitED6 (FUN_ED6) — ${n} cases ===`);

  const rng = makeRng(0xed6deadc);
  let ok = 0;
  let firstFail: { i: number; offset: number; bin: number; ts: number } | null = null;

  for (let i = 0; i < n; i++) {
    cpu.system.setRegister("sp", 0x401f00);

    //   5: incrementing pattern (j & 0xFF)
    //   8..N: random uniforme
    const pattern = new Uint8Array(ALPHA_RAM_SIZE);
    if (i === 0) pattern.fill(0xff);
    else if (i === 1) pattern.fill(0x55);
    else if (i === 2) pattern.fill(0xaa);
    else if (i === 3) pattern.fill(0x01);
    else if (i === 4) pattern.fill(0x00);
    else if (i === 5) {
      for (let j = 0; j < ALPHA_RAM_SIZE; j++) pattern[j] = j & 0xff;
    } else if (i === 6) pattern.fill(0xfe);
    else if (i === 7) pattern.fill(0xcc);
    else {
      for (let j = 0; j < ALPHA_RAM_SIZE; j++) {
        pattern[j] = Math.floor(rng() * 256) & 0xff;
      }
    }

    // ─── Setup: pre-fill alpha RAM su both i sides ─────────────────────
    for (let j = 0; j < ALPHA_RAM_SIZE; j++) {
      pokeMem(cpu, ALPHA_RAM_BASE + j, 1, pattern[j] ?? 0);
      stateInst.alphaRam[j] = pattern[j] ?? 0;
    }

    // ─── Run binary ──────────────────────────────────────────────────────
    // FUN_ED6 ha 30×42 + 34 + 34 = ~1330 word writes ⇒ ~50-60k cycles.
    // Default callFunction maxCycles = 100k. Bump for safety.
    callFunction(cpu, FUN_ED6, [], 5_000_000);

    // ─── Run TS ──────────────────────────────────────────────────────────
    modNs.alphaRamBootInitED6(stateInst, tsRom);

    // ─── Compare ─────────────────────────────────────────────────────────
    let match = true;
    for (let j = 0; j < ALPHA_RAM_SIZE; j++) {
      const binByte = peekMem(cpu, ALPHA_RAM_BASE + j, 1) & 0xff;
      const tsByte = stateInst.alphaRam[j] ?? 0;
      if (binByte !== tsByte) {
        match = false;
        if (firstFail === null) {
          firstFail = { i, offset: j, bin: binByte, ts: tsByte };
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
      `    diff at alpha offset 0x${firstFail.offset.toString(16)} (addr 0x${(ALPHA_RAM_BASE + firstFail.offset).toString(16)}): bin=0x${firstFail.bin.toString(16)} ts=0x${firstFail.ts.toString(16)}`,
    );
  }

  disposeCpu(cpu);
  exit(ok === n ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  exit(1);
});
