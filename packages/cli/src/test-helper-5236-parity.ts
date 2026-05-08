#!/usr/bin/env node
/**
 * test-helper-5236-parity.ts — differential FUN_5236 vs helper5236.
 *
 * `FUN_00005236` (25 byte, 0x5236–0x524E): funzione che legge un argomento
 * long-BE dallo stack (SP+4), calcola un bit-shift e ORs il risultato nel
 * long-BE @ 0x401F5E.
 *
 * **Effetti collaterali**:
 *   - long-BE @ workRam[0x1F5E..0x1F61] |= mask, dove mask = (arg < 2) ?
 *     (1 << arg) : (arg - 2 < 32 ? (1 << (arg - 2)) : 0).
 *
 * **Strategia parity**:
 *   - Il binario legge `(4,SP)` al momento della chiamata, cioè il long-BE
 *     a SP+4. `callFunction` (con SP=0x401F00) pusha sentinel a 0x401EFC, quindi
 *     SP effettivo all'ingresso di FUN_5236 è 0x401EFC (dopo il push del
 *     return address sentinel). `(4,SP)` = 0x401F00 = workRam[0x1F00..0x1F03].
 *   - Mettiamo l'argomento test a workRam[0x1F00..0x1F03] prima di ogni run.
 *   - Pre-popola workRam con random byte; sync sia in Musashi che in TS.
 *   - Pre-popola *0x401F5E con random long per verificare path OR cumulativo.
 *   - Lancia `callFunction(cpu, 0x5236)` e `helper5236(state, arg)`.
 *   - Confronta l'intera workRam (8KB) escludendo zona stack.
 *
 * **Stack layout** alla chiamata di FUN_5236 (SP = 0x401EFC dopo sentinel push):
 *   - 0x401EFC: sentinel return address (4 byte, spinto da callFunction)
 *   - 0x401F00: workRam[0x1F00..0x1F03] → questo è `(4,SP)` letto a 0x5236
 *
 * Uso: npx tsx packages/cli/src/test-helper-5236-parity.ts [N]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import {
  state as stateNs,
  helper5236 as h5236Ns,
} from "@marble-love/engine";
import {
  createCpu,
  callFunction,
  pokeMem,
  peekMem,
  disposeCpu,
} from "./binary-oracle-lib.js";

const FUN_5236 = 0x00005236;
const WORK_RAM_BASE = 0x00400000;
const WORK_RAM_SIZE = 0x2000;
// SP usato da callFunction: pusha sentinel a SP-4 → SP effettivo all'ingresso
// = SP_INITIAL - 4 = 0x401EFC.  (4,SP) = 0x401F00 = workRam[0x1F00].
const SP_INITIAL = 0x00401f00;
// Offset in workRam dove mettiamo l'argomento da leggere via (4,SP):
const ARG_OFF = 0x1f00; // = SP_INITIAL - WORK_RAM_BASE

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

  console.log(`\n=== helper5236 (FUN_5236) — ${n} casi ===`);

  const rng = makeRng(0x52365236);
  let ok = 0;
  let firstFail: {
    i: number;
    arg: number;
    initialFlags: number;
    diffOffsets: number[];
  } | null = null;

  // Argomenti di test deterministici che coprono tutti i percorsi:
  const specialArgs: number[] = [
    0x00000000, // shift=0 → mask=1
    0x00000001, // shift=1 → mask=2
    0x00000002, // D0>=2 → shift=0 → mask=1
    0x00000003, // D0>=2 → shift=1 → mask=2
    0x0000001f, // D0>=2 → shift=29 → mask=0x20000000
    0x00000021, // D0>=2 → shift=31 → mask=0x80000000
    0x00000022, // D0>=2 → shift=32 → no-op
    0x000000ff, // D0>=2 → shift=0xFD & 0x3F = 0x3D = 61 >= 32 → no-op
    0x00f00001, // Valore produzione (saved A3 in FUN_4F38): shift=0xEFFFFF & 0x3F >= 32 → no-op
    0xffffffff, // D0>=2 → shift=0xFFFFFFFD & 0x3F = 61 → no-op
  ];

  for (let i = 0; i < n; i++) {
    // Reset SP per ogni caso.
    cpu.system.setRegister("sp", SP_INITIAL);

    // Determina argomento: primi specialArgs.length casi coprono edge cases.
    let arg: number;
    if (i < specialArgs.length) {
      arg = specialArgs[i]!;
    } else {
      // Random 32-bit arg per copertura ampia
      arg = Math.floor(rng() * 0x100000000) >>> 0;
    }

    // Pre-popola tutta la workRam con random byte.
    const seedBuf = new Uint8Array(WORK_RAM_SIZE);
    for (let k = 0; k < WORK_RAM_SIZE; k++) {
      seedBuf[k] = Math.floor(rng() * 0x100) & 0xff;
    }

    // Metti l'argomento long-BE @ workRam[ARG_OFF..ARG_OFF+3] (= SP+4).
    seedBuf[ARG_OFF]     = (arg >>> 24) & 0xff;
    seedBuf[ARG_OFF + 1] = (arg >>> 16) & 0xff;
    seedBuf[ARG_OFF + 2] = (arg >>> 8)  & 0xff;
    seedBuf[ARG_OFF + 3] =  arg         & 0xff;

    // Pre-popola initial status flags long (test OR cumulativo).
    const initialFlags = Math.floor(rng() * 0x100000000) >>> 0;
    seedBuf[0x1f5e] = (initialFlags >>> 24) & 0xff;
    seedBuf[0x1f5f] = (initialFlags >>> 16) & 0xff;
    seedBuf[0x1f60] = (initialFlags >>> 8) & 0xff;
    seedBuf[0x1f61] = initialFlags & 0xff;

    // Sync seed in Musashi memory + state.workRam.
    for (let k = 0; k < WORK_RAM_SIZE; k++) {
      pokeMem(cpu, WORK_RAM_BASE + k, 1, seedBuf[k]!);
      state.workRam[k] = seedBuf[k]!;
    }

    // Nessun registro da settare: FUN_5236 legge tutto dallo stack.

    // Run binary.
    callFunction(cpu, FUN_5236, []);

    // Run TS.
    h5236Ns.helper5236(state, arg);

    // Confronta workRam, esclude zona stack:
    // callFunction (SP=0x401F00) pusha sentinel ret addr a 0x401EFC (4 byte).
    // FUN_5236 non fa bsr, quindi tocca solo SP-region del sentinel.
    // Escludiamo conservativamente [0x1EE0..0x1F00).
    // NOTA: ARG_OFF = 0x1F00 è fuori da questa esclusione, viene confrontato.
    const STACK_LOW = 0x1ee0;
    const STACK_HIGH = 0x1f00;
    const diffOffsets: number[] = [];
    for (let k = 0; k < WORK_RAM_SIZE; k++) {
      if (k >= STACK_LOW && k < STACK_HIGH) continue;
      const binByte = peekMem(cpu, WORK_RAM_BASE + k, 1) & 0xff;
      const tsByte = state.workRam[k]! & 0xff;
      if (binByte !== tsByte) {
        diffOffsets.push(k);
        if (diffOffsets.length > 16) break;
      }
    }

    if (diffOffsets.length === 0) {
      ok++;
    } else if (firstFail === null) {
      firstFail = { i, arg, initialFlags, diffOffsets };
    }
  }

  console.log(`  Match: ${ok}/${n} = ${((ok / n) * 100).toFixed(1)}%`);
  if (firstFail) {
    console.log(`  First fail @ case ${firstFail.i}:`);
    console.log(
      `    inputs: arg=0x${firstFail.arg.toString(16)} initialFlags=0x${firstFail.initialFlags.toString(16)}`,
    );
    console.log(
      `    diff offsets (workRam): ${firstFail.diffOffsets
        .map((o) => `0x${o.toString(16)}`)
        .join(", ")}`,
    );
  }

  disposeCpu(cpu);
  exit(ok === n ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  exit(1);
});
