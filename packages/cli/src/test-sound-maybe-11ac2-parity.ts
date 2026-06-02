#!/usr/bin/env node
/**
 * test-sound-maybe-11ac2-parity.ts — differential FUN_11AC2 vs soundMaybe11AC2.
 *
 *
 * **Strategia of parity**:
 *     (132 byte) byte per byte.
 *
 * Uso: npx tsx packages/cli/src/test-sound-maybe-11ac2-parity.ts [N]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import {
  bus as busNs,
  state as stateNs,
  soundMaybe11AC2 as sNs,
} from "@marble-love/engine";
import {
  createCpu,
  callFunction,
  pokeMem,
  peekMem,
  disposeCpu,
} from "./binary-oracle-lib.js";

const FUN_11AC2 = 0x00011ac2;
const DEST_BASE = busNs.WORK_RAM_BASE + sNs.WORK_RAM_DEST_OFFSET; // 0x40076E
const COPY_BYTES = sNs.COPY_WORD_COUNT * 2;                        // 132

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
  const romBuf = Buffer.from(readFileSync(romPath));

  // Also build a TS RomImage from the same ROM.
  const tsRom = busNs.emptyRomImage();
  tsRom.program.set(romBuf.subarray(0, tsRom.program.length));

  const state = stateNs.emptyGameState();
  const cpu = await createCpu({ rom: romBuf, state });

  console.log(`\n=== soundMaybe11AC2 (FUN_11AC2) — ${n} cases ===`);

  const rng = makeRng(0x11ac2);
  let ok = 0;
  let firstFail: {
    caseNo: number;
    byteOff: number;
    binVal: number;
    tsVal: number;
  } | null = null;

  for (let i = 0; i < n; i++) {
    cpu.system.setRegister("sp", 0x401f00);

    // Randomizzo il range of destination (per verify sovrascrittura completa)
    // both in the CPU (musashi memory) both in the TS state (GameState.workRam).
    for (let b = 0; b < COPY_BYTES; b++) {
      const v = Math.floor(rng() * 256) & 0xff;
      pokeMem(cpu, DEST_BASE + b, 1, v);
      state.workRam[sNs.WORK_RAM_DEST_OFFSET + b] = v;
    }

    callFunction(cpu, FUN_11AC2, []);

    // Esegui TS.
    sNs.soundMaybe11AC2(state, tsRom);

    let match = true;
    for (let b = 0; b < COPY_BYTES; b++) {
      const binVal = peekMem(cpu, DEST_BASE + b, 1) & 0xff;
      const tsVal = state.workRam[sNs.WORK_RAM_DEST_OFFSET + b] ?? 0;
      if (binVal !== tsVal) {
        if (firstFail === null) {
          firstFail = { caseNo: i, byteOff: b, binVal, tsVal };
        }
        match = false;
        break;
      }
    }

    if (match) ok++;
  }

  console.log(`  Match: ${ok}/${n} = ${((ok / n) * 100).toFixed(1)}%`);
  if (firstFail) {
    console.log(
      `  First fail @ case ${firstFail.caseNo}, byte offset +${firstFail.byteOff}:`,
    );
    console.log(`    bin = 0x${firstFail.binVal.toString(16).padStart(2, "0")}`);
    console.log(`    ts  = 0x${firstFail.tsVal.toString(16).padStart(2, "0")}`);
  }

  disposeCpu(cpu);
  exit(ok === n ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  exit(1);
});
