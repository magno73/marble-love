#!/usr/bin/env node
/**
 * test-tilemap-blit-17044-parity.ts — differential FUN_17044 vs tilemapBlit17044.
 *
 * total) from ROM @ 0x19F04 to PF RAM @ 0xA00116, with 0x80-byte stride
 *
 *   - the 240 byte of ROM @ 0x19F04..0x19FF3 (identical in binary and TS — the ROM
 *
 *   1. Pre-fill PF RAM [0xA00000..0xA02000) with a deterministic pattern.
 *
 * Usage: npx tsx packages/cli/src/test-tilemap-blit-17044-parity.ts [N]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import {
  state as stateNs,
  bus as busNs,
  tilemapBlit17044 as tbNs,
} from "@marble-love/engine";
import type { RomImage } from "@marble-love/engine";
import {
  createCpu,
  callFunction,
  pokeMem,
  peekMem,
  disposeCpu,
} from "./binary-oracle-lib.js";

const FUN_TILEMAP_BLIT = 0x00017044;
const PF_RAM_BASE = 0xa00000;
const PF_RAM_SIZE = 0x2000;

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

  console.log(`\n=== tilemapBlit17044 (FUN_17044) — ${n} cases ===`);

  const rng = makeRng(0x1704417a);
  let ok = 0;
  let firstFail: { i: number; offset: number; bin: number; ts: number } | null = null;

  for (let i = 0; i < n; i++) {
    cpu.system.setRegister("sp", 0x401f00);

    //   4: incrementing pattern (j & 0xFF)
    //   5: pattern 0xFE
    //   6: pattern 0xCC marker
    //   8..N: uniform random
    const pf = new Uint8Array(PF_RAM_SIZE);
    if (i === 0) pf.fill(0xff);
    else if (i === 1) pf.fill(0x00);
    else if (i === 2) pf.fill(0x55);
    else if (i === 3) pf.fill(0xaa);
    else if (i === 4) {
      for (let j = 0; j < PF_RAM_SIZE; j++) pf[j] = j & 0xff;
    } else if (i === 5) pf.fill(0xfe);
    else if (i === 6) pf.fill(0xcc);
    else if (i === 7) {
      for (let j = 0; j < PF_RAM_SIZE; j++) pf[j] = (j * 7) & 0xff;
    } else {
      for (let j = 0; j < PF_RAM_SIZE; j++) pf[j] = Math.floor(rng() * 256) & 0xff;
    }

    // ─── Setup binary side ───────────────────────────────────────────────
    for (let j = 0; j < PF_RAM_SIZE; j++) {
      pokeMem(cpu, PF_RAM_BASE + j, 1, pf[j] ?? 0);
    }

    // ─── Run binary ──────────────────────────────────────────────────────
    callFunction(cpu, FUN_TILEMAP_BLIT, []);

    // ─── Run TS ──────────────────────────────────────────────────────────
    tbNs.tilemapBlit17044(tsRom, pf);

    // ─── Compare ─────────────────────────────────────────────────────────
    let match = true;
    for (let j = 0; j < PF_RAM_SIZE; j++) {
      const binByte = peekMem(cpu, PF_RAM_BASE + j, 1) & 0xff;
      const tsByte = pf[j] ?? 0;
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
      `    diff at PF offset 0x${firstFail.offset.toString(16)} (addr 0x${(PF_RAM_BASE + firstFail.offset).toString(16)}): bin=0x${firstFail.bin.toString(16)} ts=0x${firstFail.ts.toString(16)}`,
    );
  }

  disposeCpu(cpu);
  exit(ok === n ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  exit(1);
});
