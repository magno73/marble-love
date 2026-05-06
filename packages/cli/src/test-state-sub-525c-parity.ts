#!/usr/bin/env node
/**
 * test-state-sub-525c-parity.ts — differential FUN_525C vs stateSub525C.
 *
 * `FUN_0000525C` (40 byte): chiamato con `D0` = count e `A2` = base struct
 * in workRam. Effetti collaterali:
 *   1. `workRam[A2-0x400000+0x50 .. +0x50+D0*20-1]` = 0
 *   2. long-BE @ `0x401F5E` |= bitmask `bit 4..3+D0*2`
 *
 * Strategia parity:
 *   - Inizializza workRam con random byte; sync sia in Musashi che in
 *     `state.workRam` TS.
 *   - Setta D0 = random count in `[1..14]` (range che produce side-effect
 *     osservabile e termina rapidamente; copre anche bit 31 boundary).
 *   - Setta A2 = pointer random in `[0x400600..0x401E00]` (multiplo di 4)
 *     per stressare offset diversi e non sovrascrivere status flags
 *     @ 0x401F5E.
 *   - Pre-popola `*0x401F5E` con random long per verificare che il path
 *     OR sia cumulativo (e non un assignment).
 *   - Lancia `callFunction(cpu, 0x525C)` e `stateSub525C(state, d0, a2)`.
 *   - Confronta: l'intera workRam (8KB) deve essere bit-perfect identica.
 *
 * Uso: npx tsx packages/cli/src/test-state-sub-525c-parity.ts [N]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import {
  state as stateNs,
  stateSub525C as ssNs,
} from "@marble-love/engine";
import {
  createCpu,
  callFunction,
  pokeMem,
  peekMem,
  disposeCpu,
} from "./binary-oracle-lib.js";

const FUN_525C = 0x0000525c;
const WORK_RAM_BASE = 0x00400000;
const WORK_RAM_SIZE = 0x2000;

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

  console.log(`\n=== stateSub525C (FUN_525C) — ${n} casi ===`);

  const rng = makeRng(0x525c5a5c);
  let ok = 0;
  let firstFail: {
    i: number;
    d0: number;
    a2: number;
    initialFlags: number;
    diffOffsets: number[];
  } | null = null;

  for (let i = 0; i < n; i++) {
    // Reset SP per ogni caso (callFunction usa lo stack).
    cpu.system.setRegister("sp", 0x401f00);

    // Pattern: cover boundary cases + random.
    let d0: number;
    if (i === 0) {
      d0 = 1; // minimum sane: clear 20 byte, set bit 4|5
    } else if (i === 1) {
      d0 = 2; // 4 bit settati
    } else if (i === 2) {
      d0 = 14; // boundary alto: bits 4..31 (top bit incluso)
    } else if (i === 3) {
      d0 = 15; // 30 bit, ma bits 32..33 sono no-op (asl.l ≥32 → 0)
    } else if (i === 4) {
      d0 = 7; // metà range
    } else {
      // Random in [1..14] per termine rapido del loop fase 2 (max 28 bsr).
      d0 = (Math.floor(rng() * 14) + 1) >>> 0;
    }

    // A2: pointer random in workRam, offset allineato 4, scelto in modo che
    // il range clearato `[A2+0x50, A2+0x50+D0*20)` non sconfini sopra la
    // fine workRam (0x402000) né tocchi la status-flags long @ 0x1F5E.
    // Range sicuro: A2 ∈ [0x400000..0x401E00], stride 4. La regione clearata
    // potrebbe sovrapporsi a 0x1F5E per A2 alti; lo evitiamo limitando.
    // d0 max = 15 → 300 byte clearati. Limit sup = 0x401F5E - 0x50 - 300 = 0x401D6E.
    const maxA2Off = 0x1d00; // safe per d0 fino a ~22
    const a2OffRaw = Math.floor(rng() * (maxA2Off / 4)) * 4;
    const a2 = (WORK_RAM_BASE + a2OffRaw) >>> 0;

    // Pre-popola tutta la workRam con random byte (cosi vediamo se
    // qualcosa di non previsto cambia).
    const seedBuf = new Uint8Array(WORK_RAM_SIZE);
    for (let k = 0; k < WORK_RAM_SIZE; k++) {
      seedBuf[k] = Math.floor(rng() * 0x100) & 0xff;
    }
    // Pre-popola initial status flags long (cumulative OR test).
    const initialFlags = Math.floor(rng() * 0x100000000) >>> 0;
    seedBuf[0x1f5e] = (initialFlags >>> 24) & 0xff;
    seedBuf[0x1f5f] = (initialFlags >>> 16) & 0xff;
    seedBuf[0x1f60] = (initialFlags >>> 8) & 0xff;
    seedBuf[0x1f61] = initialFlags & 0xff;

    // Sync seed in Musashi memory + state.workRam (devono partire identici).
    for (let k = 0; k < WORK_RAM_SIZE; k++) {
      pokeMem(cpu, WORK_RAM_BASE + k, 1, seedBuf[k]!);
      state.workRam[k] = seedBuf[k]!;
    }

    // Setup registers: D0 = count, A2 = pointer.
    cpu.system.setRegister("d0", d0 >>> 0);
    cpu.system.setRegister("a2", a2 >>> 0);

    // Run binary
    callFunction(cpu, FUN_525C, []);

    // Run TS
    ssNs.stateSub525C(state, d0, a2);

    // Confronta workRam, MA esclude la zona stack del binario:
    // `callFunction` pusha sentinel ret + lavora con SP=0x401F00, quindi
    // gli indirizzi `[SP-12..SP-1] = [0x1EF4..0x1EFF]` vengono scritti dal
    // CPU (saved D2, ret addr, push D0). Il TS NON modella lo stack, quindi
    // quei byte restano col seed random originale. Escludiamo `[0x1EE0..
    // 0x1EFF]` per safety (margine extra). Anche `0x1F00` (stack pointer
    // initial) e oltre dovrebbero essere intatti, ma escludiamo conservativi
    // fino a 0x1F00.
    const STACK_LOW = 0x1ee0;
    const STACK_HIGH = 0x1f00;
    const diffOffsets: number[] = [];
    for (let k = 0; k < WORK_RAM_SIZE; k++) {
      if (k >= STACK_LOW && k < STACK_HIGH) continue;
      const binByte = peekMem(cpu, WORK_RAM_BASE + k, 1) & 0xff;
      const tsByte = state.workRam[k]! & 0xff;
      if (binByte !== tsByte) {
        diffOffsets.push(k);
        if (diffOffsets.length > 16) break; // limita output
      }
    }

    if (diffOffsets.length === 0) {
      ok++;
    } else if (firstFail === null) {
      firstFail = { i, d0, a2, initialFlags, diffOffsets };
    }
  }

  console.log(`  Match: ${ok}/${n} = ${((ok / n) * 100).toFixed(1)}%`);
  if (firstFail) {
    console.log(`  First fail @ case ${firstFail.i}:`);
    console.log(
      `    inputs: d0=${firstFail.d0} a2=0x${firstFail.a2.toString(16)} initialFlags=0x${firstFail.initialFlags.toString(16)}`,
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
