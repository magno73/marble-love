#!/usr/bin/env node
/**
 * test-helper-3a54-parity.ts — differential FUN_3A54 vs helper3A54.
 *
 * `FUN_00003A54` (27 istr): formatta un valore 32-bit come stringa decimale
 * ASCII in memoria. Converte binary → BCD packed via FUN_3A6A (double-dabble
 * con ABCD/ROXL), poi tail-call FUN_3A08 per scrivere il BCD come hex ASCII
 * (che produce la stringa decimale).
 *
 * **Strategia parity**:
 *   1. Per ogni caso: riempi un buffer scratch con 0x55 in binario e TS.
 *   2. Chiama il binario via `callFunction(cpu, FUN_3A54, [value, bufEnd, numDigits, showSpaces])`.
 *   3. Esegui `helper3A54(state, value, bufEnd, numDigits, showSpaces)` su TS.
 *   4. Confronta tutti i byte dello scratch buffer tra binario e TS.
 *
 * **Copertura** (500 casi):
 *   - Casi deterministici edge: 0, 1, 9, 10, 99, 100, 999, 1234, 9999,
 *     12345678, 99999999, valori con leading zeros, showSpaces=0/1.
 *   - Casi random: value in [0..99999999] (range tipico punteggi Marble),
 *     numDigits in [1..8], showSpaces in {0, 1}.
 *   - bufEnd variabile in area sicura scratch.
 *
 * Uso: npx tsx packages/cli/src/test-helper-3a54-parity.ts [N=500]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import {
  state as stateNs,
  helper3A54 as h3A54Ns,
} from "@marble-love/engine";
import {
  createCpu,
  callFunction,
  pokeMem,
  peekMem,
  disposeCpu,
} from "./binary-oracle-lib.js";

const FUN_3A54 = 0x00003a54;
const WORK_RAM_BASE = 0x00400000;
const SCRATCH_ADDR = 0x00401d00;
const SCRATCH_SIZE = 0x80; // 128 byte di buffer scratch

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

  console.log(`\n=== helper3A54 (FUN_3A54) — ${n} casi ===`);

  const rng = makeRng(0x3a543a54);
  let ok = 0;
  let firstFail: {
    i: number;
    value: number;
    bufEnd: number;
    numDigits: number;
    showSpaces: number;
    scratchOffset: number;
    bin: number;
    ts: number;
  } | null = null;

  // Casi edge deterministici
  const specialCases: Array<{
    value: number;
    numDigits: number;
    showSpaces: number;
  }> = [
    { value: 0, numDigits: 1, showSpaces: 0 },
    { value: 0, numDigits: 4, showSpaces: 0 },
    { value: 0, numDigits: 4, showSpaces: 1 },
    { value: 1, numDigits: 4, showSpaces: 1 },
    { value: 9, numDigits: 1, showSpaces: 0 },
    { value: 10, numDigits: 2, showSpaces: 0 },
    { value: 99, numDigits: 2, showSpaces: 0 },
    { value: 100, numDigits: 3, showSpaces: 0 },
    { value: 999, numDigits: 4, showSpaces: 0 },
    { value: 1234, numDigits: 4, showSpaces: 0 },
    { value: 9999, numDigits: 4, showSpaces: 0 },
    { value: 12345, numDigits: 6, showSpaces: 0 },
    { value: 99999, numDigits: 6, showSpaces: 0 },
    { value: 123456, numDigits: 6, showSpaces: 0 },
    { value: 1234567, numDigits: 8, showSpaces: 0 },
    { value: 12345678, numDigits: 8, showSpaces: 0 },
    { value: 99999999, numDigits: 8, showSpaces: 0 },
    { value: 42, numDigits: 4, showSpaces: 1 },
    { value: 1000, numDigits: 6, showSpaces: 1 },
    { value: 0, numDigits: 8, showSpaces: 1 },
  ];

  for (let i = 0; i < n; i++) {
    // Reset SP
    cpu.system.setRegister("sp", 0x401f00);

    let value: number;
    let numDigits: number;
    let showSpaces: number;

    if (i < specialCases.length) {
      const sc = specialCases[i]!;
      value = sc.value;
      numDigits = sc.numDigits;
      showSpaces = sc.showSpaces;
    } else {
      // Random: valori tipici di punteggi marble (0..99999999)
      // ma anche fuori range per stress-test
      const roll = rng();
      if (roll < 0.7) {
        // Range tipico punteggi
        value = Math.floor(rng() * 100000000) >>> 0;
      } else {
        // Full 32-bit range
        value = Math.floor(rng() * 0x100000000) >>> 0;
      }
      numDigits = 1 + Math.floor(rng() * 8); // 1..8
      showSpaces = rng() < 0.5 ? 0 : 1;
    }

    // bufEnd: offset variabile nello scratch
    const maxOffset = SCRATCH_SIZE - numDigits - 2;
    const offset = maxOffset > 0 ? Math.floor(rng() * (maxOffset + 1)) : 0;
    const bufEnd = SCRATCH_ADDR + offset;

    // Riempi scratch con sentinella 0x55
    for (let j = 0; j < SCRATCH_SIZE; j++) {
      pokeMem(cpu, SCRATCH_ADDR + j, 1, 0x55);
      state.workRam[(SCRATCH_ADDR - WORK_RAM_BASE) + j] = 0x55;
    }

    // Chiama binario: 4 long args (cdecl, push RTL)
    callFunction(cpu, FUN_3A54, [value, bufEnd, numDigits, showSpaces]);

    // Esegui TS
    h3A54Ns.helper3A54(state, value, bufEnd, numDigits, showSpaces);

    // Confronta scratch byte-by-byte
    let matched = true;
    let diffOffset = -1;
    let binByte = 0;
    let tsByte = 0;

    for (let j = 0; j < SCRATCH_SIZE; j++) {
      const b = peekMem(cpu, SCRATCH_ADDR + j, 1);
      const t = state.workRam[(SCRATCH_ADDR - WORK_RAM_BASE) + j] ?? 0;
      if (b !== t) {
        matched = false;
        diffOffset = j;
        binByte = b;
        tsByte = t;
        break;
      }
    }

    if (matched) {
      ok++;
    } else if (firstFail === null) {
      firstFail = {
        i,
        value,
        bufEnd,
        numDigits,
        showSpaces,
        scratchOffset: diffOffset,
        bin: binByte,
        ts: tsByte,
      };
    }
  }

  console.log(`  Match: ${ok}/${n} = ${((ok / n) * 100).toFixed(1)}%`);
  if (firstFail) {
    const { i, value, bufEnd, numDigits, showSpaces, scratchOffset, bin, ts } =
      firstFail;
    console.log(`  First fail @ caso ${i}:`);
    console.log(
      `    value=${value}  bufEnd=0x${bufEnd.toString(16)}  digits=${numDigits}  showSpaces=${showSpaces}`,
    );
    console.log(
      `    diff @ scratch+0x${scratchOffset.toString(16)}: bin=0x${bin.toString(16).padStart(2, "0")} ts=0x${ts.toString(16).padStart(2, "0")}`,
    );
  }

  disposeCpu(cpu);
  exit(ok === n ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  exit(1);
});
