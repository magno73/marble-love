#!/usr/bin/env node
/**
 * test-sound-cmd-send-parity.ts — differential FUN_158AC vs soundCmdSend.
 *
 *      sign-extended to long; FUN_4C6E retries up to 256 times if the sound
 *
 * For the differential test we force convergence:
 *   - We vary the word @ 0x004003B8 (skip flag) and the byte arg.
 *
 * Pattern coverage:
 *   pattern 0: skipFlag=0, byte random → expected D0=1
 *   pattern 1: skipFlag!=0, byte random → expected D0=0
 *   pattern 2: skipFlag=0, byte=0x80 (negative sign-ext) → D0=1
 *   pattern 3: asymmetric skipFlag bytes (low only) → D0=0
 *   pattern >=4: full random
 *
 * change in both paths).
 *
 * Usage: npx tsx packages/cli/src/test-sound-cmd-send-parity.ts [N]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import { state as stateNs, soundCmdSend as csNs } from "@marble-love/engine";
import {
  createCpu,
  callFunction,
  pokeMem,
  disposeCpu,
} from "./binary-oracle-lib.js";

const FUN_158AC = 0x000158ac;

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

  console.log(`\n=== soundCmdSend (FUN_158AC) — ${n} cases ===`);

  const rng = makeRng(0x158ac);
  let ok = 0;
  let firstFail: {
    i: number;
    byteArg: number;
    skipFlag: number;
    binD0: number;
    tsD0: number;
  } | null = null;

  pokeMem(cpu, 0xf60001, 1, 0x00);

  for (let i = 0; i < n; i++) {
    // SP reset (callFunction uses the stack to push the sentinel return + arg).
    cpu.system.setRegister("sp", 0x401f00);

    const pattern = i < 4 ? i : Math.floor(rng() * 4) + 4;
    let skipFlag: number;
    let byteArg: number;

    switch (pattern) {
      case 0:
        skipFlag = 0;
        byteArg = Math.floor(rng() * 256);
        break;
      case 1:
        skipFlag = (Math.floor(rng() * 0xfffe) + 1) & 0xffff;
        byteArg = Math.floor(rng() * 256);
        break;
      case 2:
        skipFlag = 0;
        byteArg = 0x80; // negative sign-ext
        break;
      case 3:
        skipFlag = 0x0001;
        byteArg = Math.floor(rng() * 256);
        break;
      default:
        // Full random; balanced 50/50 skip vs send
        skipFlag = rng() < 0.5 ? 0 : Math.floor(rng() * 0x10000);
        byteArg = Math.floor(rng() * 256);
        break;
    }

    // Setup workRam[0x3B8..9] = skipFlag (big-endian word) both in unified
    // memory (for Musashi) and in state.workRam (for TS).
    pokeMem(cpu, 0x004003b8, 2, skipFlag);
    state.workRam[0x3b8] = (skipFlag >>> 8) & 0xff;
    state.workRam[0x3b9] = skipFlag & 0xff;

    // touched, but FUN_4C6E mailbox write-back could modify
    pokeMem(cpu, 0xf60001, 1, 0x00);

    // Clear 0xFE0000 (sound CPU mailbox); irrelevant for the return value
    pokeMem(cpu, 0x00fe0000, 2, 0x0000);

    const r = callFunction(cpu, FUN_158AC, [byteArg & 0xff]);
    const binD0 = r.d0 & 0xff;

    // Run TS
    const tsD0 = csNs.soundCmdSend(state, byteArg);

    const match = binD0 === tsD0;
    if (match) {
      ok++;
    } else if (firstFail === null) {
      firstFail = {
        i,
        byteArg,
        skipFlag,
        binD0,
        tsD0,
      };
    }
  }

  console.log(`  Match: ${ok}/${n} = ${((ok / n) * 100).toFixed(1)}%`);
  if (firstFail) {
    console.log(`  First fail @ case ${firstFail.i}:`);
    console.log(
      `    inputs: byteArg=0x${firstFail.byteArg.toString(16)} skipFlag=0x${firstFail.skipFlag.toString(16)}`,
    );
    console.log(`    bin D0=${firstFail.binD0}  ts D0=${firstFail.tsD0}`);
  }

  disposeCpu(cpu);
  exit(ok === n ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  exit(1);
});
