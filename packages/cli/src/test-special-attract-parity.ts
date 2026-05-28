#!/usr/bin/env node
/**
 * test-special-attract-parity.ts — differential FUN_288F8 vs specialAttract.
 *
 * not mirrored; to isolate the FUN_288F8 path, patch FUN_158AC with
 * un payload "capture":
 *
 *   move.b   (0x7,SP), D0      ; 102F 0007        (4 byte)
 *   move.b   D0, ($00401FFE)   ; 13C0 0040 1FFE   (6 byte)
 *   rts                        ; 4E75             (2 byte)
 *
 *
 * Per la TS replication: cattureremo l'arg di `soundCommand` callback
 * iniettato in `specialAttract`.
 *
 * Uso: npx tsx packages/cli/src/test-special-attract-parity.ts [N]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import { state as stateNs, specialAttract as saNs } from "@marble-love/engine";
import {
  createCpu,
  callFunction,
  pokeMem,
  peekMem,
  disposeCpu,
} from "./binary-oracle-lib.js";

const FUN_288F8 = 0x000288f8;
const FUN_158AC = 0x000158ac;
const STAGE_ADDR = 0x004003ea; // word signed, work RAM 0x3EA
const CAPTURE_ADDR = 0x00401ffe; // sentinel where patched FUN_158AC writes byte arg
const SENTINEL_NOT_CALLED = 0xff;

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
  const rom = Buffer.from(readFileSync(romPath));

  // Patch ROM @ FUN_158AC: capture il byte arg (0x7,SP) → ($00401FFE), rts.
  // move.b (0x7,SP), D0    : 10 2F 00 07
  // move.b D0, $00401FFE.l : 13 C0 00 40 1F FE
  // rts                    : 4E 75
  rom[FUN_158AC + 0x0] = 0x10; rom[FUN_158AC + 0x1] = 0x2f;
  rom[FUN_158AC + 0x2] = 0x00; rom[FUN_158AC + 0x3] = 0x07;
  rom[FUN_158AC + 0x4] = 0x13; rom[FUN_158AC + 0x5] = 0xc0;
  rom[FUN_158AC + 0x6] = 0x00; rom[FUN_158AC + 0x7] = 0x40;
  rom[FUN_158AC + 0x8] = 0x1f; rom[FUN_158AC + 0x9] = 0xfe;
  rom[FUN_158AC + 0xa] = 0x4e; rom[FUN_158AC + 0xb] = 0x75;

  const state = stateNs.emptyGameState();
  const cpu = await createCpu({ rom, state });

  console.log(`\n=== specialAttract (FUN_288F8) — ${n} casi ===`);

  const rng = makeRng(0xa11fac7);
  let ok = 0;
  let firstFail: {
    i: number;
    stage: number;
    binCmd: number;
    tsCmd: number;
  } | null = null;

  for (let i = 0; i < n; i++) {
    cpu.system.setRegister("sp", 0x401f00);

    // Mix di pattern per coprire tutte le 3 branch + boundary condition:
    //   pattern 0 : stage = 0x0000 (low, S=0)
    //   pattern 1 : stage = 0x000B (low, S=11, just below mid)
    //   pattern 2 : stage = 0x000C (mid, S=12, exact mid threshold)
    //   pattern 3 : stage = 0x0017 (mid, S=23, just below high)
    //   pattern 4 : stage = 0x0018 (high, S=24, exact high threshold)
    //   pattern 5 : stage = 0x7FFF (high, S=max int16)
    //   pattern 6 : stage = 0xFFFF (low, S=-1, signed)
    //   pattern 7 : stage = 0x8000 (low, S=-32768, signed)
    //   pattern >= 8: random uint16
    let stage: number;
    if (i === 0) stage = 0x0000;
    else if (i === 1) stage = 0x000b;
    else if (i === 2) stage = 0x000c;
    else if (i === 3) stage = 0x0017;
    else if (i === 4) stage = 0x0018;
    else if (i === 5) stage = 0x7fff;
    else if (i === 6) stage = 0xffff;
    else if (i === 7) stage = 0x8000;
    else if (i < 32) {
      // boundary clustering: ±5 around 0x0C and 0x18
      const center = rng() < 0.5 ? 0x0c : 0x18;
      const delta = Math.floor(rng() * 11) - 5;
      stage = (center + delta) & 0xffff;
    } else {
      stage = Math.floor(rng() * 0x10000) & 0xffff;
    }

    pokeMem(cpu, STAGE_ADDR, 2, stage);
    state.workRam[0x3ea] = (stage >>> 8) & 0xff;
    state.workRam[0x3eb] = stage & 0xff;

    // Reset capture sentinel
    pokeMem(cpu, CAPTURE_ADDR, 1, SENTINEL_NOT_CALLED);

    // Run binary
    callFunction(cpu, FUN_288F8, []);
    const binCmd = peekMem(cpu, CAPTURE_ADDR, 1) & 0xff;

    // Run TS
    let tsCmd: number = SENTINEL_NOT_CALLED;
    saNs.specialAttract(state, {
      soundCommand: (cmd: number) => {
        tsCmd = cmd & 0xff;
      },
    });

    const match = binCmd === tsCmd;
    if (match) {
      ok++;
    } else if (firstFail === null) {
      firstFail = { i, stage, binCmd, tsCmd };
    }
  }

  console.log(`  Match: ${ok}/${n} = ${((ok / n) * 100).toFixed(1)}%`);
  if (firstFail) {
    console.log(`  First fail @ case ${firstFail.i}:`);
    const sStr = firstFail.stage >= 0x8000
      ? `0x${firstFail.stage.toString(16).padStart(4, "0")} (signed=${firstFail.stage - 0x10000})`
      : `0x${firstFail.stage.toString(16).padStart(4, "0")} (signed=${firstFail.stage})`;
    console.log(`    stage = ${sStr}`);
    console.log(
      `    bin: cmd=0x${firstFail.binCmd.toString(16).padStart(2, "0")}`,
    );
    console.log(
      `    ts : cmd=0x${firstFail.tsCmd.toString(16).padStart(2, "0")}`,
    );
  }

  disposeCpu(cpu);
  exit(ok === n ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  exit(1);
});
