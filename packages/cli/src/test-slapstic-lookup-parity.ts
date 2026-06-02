#!/usr/bin/env node
/**
 * test-slapstic-lookup-parity.ts — differential FUN_2FFB8 vs slapsticLookup.
 *
 * the word at `0x80080 + signExt16((arg<<5)&0xFFFF)`.
 *
 *
 * Fixed patterns to cover the key branches:
 *   0..3: arg=0..3 (caller FUN_1ACE0)
 *   4..7: arg=0xE4, 0xC9, 0x4D, 0xFF (caller FUN_16F6C-style word)
 *   8: arg=0x400 (signExt → negative, address < 0x80080)
 *   9: arg=0x800 (wrap → idx=0)
 *   ≥10: random
 *
 * Usage: npx tsx packages/cli/src/test-slapstic-lookup-parity.ts [N]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import { slapsticLookup as slNs, bus as busNs } from "@marble-love/engine";
import {
  createCpu,
  callFunction,
  disposeCpu,
} from "./binary-oracle-lib.js";
import { state as stateNs } from "@marble-love/engine";

const FUN_SLAPSTIC_LOOKUP = 0x0002ffb8;

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
  const romBytes = readFileSync(romPath);

  // TS-side RomImage: program slot populated with the 0x88000-byte blob.
  const rom = busNs.emptyRomImage();
  rom.program.set(romBytes.subarray(0, Math.min(romBytes.length, rom.program.length)));

  const state = stateNs.emptyGameState();
  const cpu = await createCpu({ rom: romBytes, state });

  console.log(`\n=== slapsticLookup (FUN_2FFB8) — ${n} cases ===`);

  const rng = makeRng(0x5ac57c1c);
  let ok = 0;
  let firstFail: {
    i: number;
    argW: number;
    binD0w: number;
    tsRet: number;
  } | null = null;

  for (let i = 0; i < n; i++) {
    cpu.system.setRegister("sp", 0x401f00);

    let argW: number;

    if (i === 0) argW = 0;
    else if (i === 1) argW = 1;
    else if (i === 2) argW = 2;
    else if (i === 3) argW = 3;
    else if (i === 4) argW = 0xe4;
    else if (i === 5) argW = 0xc9;
    else if (i === 6) argW = 0x4d;
    else if (i === 7) argW = 0xff;
    else if (i === 8) argW = 0x400; // shift → 0x8000, signExt16 → -0x8000
    else if (i === 9) argW = 0x800; // shift → wrap to 0
    else {
      // Bias of the random:
      //   - 30% small (0..0x7F)
      //   - 30% in the range that produces idx 0..0x7FE (arg 0..0x3F)
      //   - 10% full random
      const r = rng();
      if (r < 0.3) argW = Math.floor(rng() * 0x80);
      else if (r < 0.6) argW = Math.floor(rng() * 0x40);
      else if (r < 0.9) argW = 0x400 + Math.floor(rng() * 0x400);
      else argW = Math.floor(rng() * 0x10000) & 0xffff;
    }

    // ─── Setup binary side ───────────────────────────────────────────────
    // The standard caller does `move.l D0,-(SP) ; jsr` with D0 = ext.l(arg word).
    // long sign-extended -> make sure callFunction pushes a long.
    // Coherent with callers: long = signExt32(argW).
    const argLong = (((argW & 0xffff) << 16) >> 16) >>> 0; // ext.l(argW)

    // Reset D0 to 0 so binary and TS start from the same baseline.
    cpu.system.setRegister("d0", 0);

    // Run binary
    const r = callFunction(cpu, FUN_SLAPSTIC_LOOKUP, [argLong]);
    const binD0w = r.d0 & 0xffff;

    // Run TS
    const tsRet = slNs.slapsticLookup(rom, argW) & 0xffff;

    const match = binD0w === tsRet;
    if (match) {
      ok++;
    } else if (firstFail === null) {
      firstFail = { i, argW, binD0w, tsRet };
    }
  }

  console.log(`  Match: ${ok}/${n} = ${((ok / n) * 100).toFixed(1)}%`);
  if (firstFail) {
    console.log(`  First fail @ case ${firstFail.i}:`);
    console.log(`    argW=0x${firstFail.argW.toString(16)}`);
    console.log(`    bin D0w=0x${firstFail.binD0w.toString(16)}`);
    console.log(`    ts  ret=0x${firstFail.tsRet.toString(16)}`);
  }

  disposeCpu(cpu);
  exit(ok === n ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  exit(1);
});
