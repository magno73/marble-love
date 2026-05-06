#!/usr/bin/env node
/**
 * test-state-sub-520e-parity.ts — differential FUN_520E vs stateSub520E.
 *
 * `FUN_0000520E` (64 byte fino al rts @ 0x524E): chiamato con `A2` =
 * pointer a slot record in workRam. Effetti collaterali (vedi
 * `packages/engine/src/state-sub-520e.ts`):
 *   1. workRam[A2..A2+8]      = 0
 *   2. workRam[A2+0xE..A2+0x12] = 0
 *   3. workRam[0x1F5E..0x1F61] (long-BE) |= 0x3
 *   4. workRam[A2+0x14..A2+0x1D] = 0
 *   5. *0x401F5E |= bit derivato da byte @ A2+9 (preexisting)
 *   6. *0x401F5E |= bit derivato da long-BE @ SP+4 (saved A3 in produzione)
 *
 * Strategia parity:
 *   - Inizializza workRam con random byte; sync sia in Musashi che in
 *     `state.workRam` TS.
 *   - Setta A2 = pointer random allineato 4 in `[0x400000..0x401C00]` (range
 *     scelto per evitare overlap con la status-flags long @ 0x1F5E e con la
 *     zona stack [0x1EE0..0x1F00] che il binario tocca con sentinel + bsr).
 *   - SP = 0x401F00. callFunction pusha sentinel a 0x401EFC. SP+4 @ ingresso
 *     520E = 0x401F00 → workRam[0x1F00..0x1F03] (BE long). Lo leggiamo PRIMA
 *     dell'esecuzione e lo passiamo come `stackD0` al TS replica.
 *   - Pre-popola `*0x401F5E` con random long per verificare path OR cumulativo.
 *   - Lancia `callFunction(cpu, 0x520E)` e `stateSub520E(state, a2, stackD0)`.
 *   - Confronta l'intera workRam (8KB) escludendo zona stack.
 *
 * Uso: npx tsx packages/cli/src/test-state-sub-520e-parity.ts [N]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import {
  state as stateNs,
  stateSub520E as ssNs,
} from "@marble-love/engine";
import {
  createCpu,
  callFunction,
  pokeMem,
  peekMem,
  disposeCpu,
} from "./binary-oracle-lib.js";

const FUN_520E = 0x0000520e;
const WORK_RAM_BASE = 0x00400000;
const WORK_RAM_SIZE = 0x2000;
const SP_INITIAL = 0x00401f00;

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

  console.log(`\n=== stateSub520E (FUN_520E) — ${n} casi ===`);

  const rng = makeRng(0x520e520e);
  let ok = 0;
  let firstFail: {
    i: number;
    a2: number;
    stackD0: number;
    byteAtA2_9: number;
    initialFlags: number;
    diffOffsets: number[];
  } | null = null;

  for (let i = 0; i < n; i++) {
    // Reset SP per ogni caso
    cpu.system.setRegister("sp", SP_INITIAL);

    // A2: pointer random allineato 4 in workRam.
    // Range sicuro: i clear toccano A2+0..A2+0x1D (30 byte). Per non
    // sovrapporre la status-flags long @ 0x1F5E (4 byte) e la zona stack
    // [0x1EE0..0x1F00] (32 byte), limitiamo a A2_off ≤ 0x1C00.
    // Inoltre A2_off ≥ 0 ovviamente.
    let a2: number;
    if (i === 0) {
      a2 = 0x00400000; // boundary basso (offset 0)
    } else if (i === 1) {
      a2 = 0x00401000; // mid range
    } else if (i === 2) {
      a2 = 0x00401C00; // boundary alto sicuro (A2+0x1D = 0x1C1D < 0x1EE0)
    } else if (i === 3) {
      a2 = 0x00400500; // misc offset
    } else {
      const a2OffRaw = Math.floor(rng() * (0x1c00 / 4)) * 4;
      a2 = (WORK_RAM_BASE + a2OffRaw) >>> 0;
    }

    // Pre-popola tutta la workRam con random byte
    const seedBuf = new Uint8Array(WORK_RAM_SIZE);
    for (let k = 0; k < WORK_RAM_SIZE; k++) {
      seedBuf[k] = Math.floor(rng() * 0x100) & 0xff;
    }
    // Pre-popola initial status flags long (cumulative OR test)
    const initialFlags = Math.floor(rng() * 0x100000000) >>> 0;
    seedBuf[0x1f5e] = (initialFlags >>> 24) & 0xff;
    seedBuf[0x1f5f] = (initialFlags >>> 16) & 0xff;
    seedBuf[0x1f60] = (initialFlags >>> 8) & 0xff;
    seedBuf[0x1f61] = initialFlags & 0xff;

    // Sync seed in Musashi memory + state.workRam
    for (let k = 0; k < WORK_RAM_SIZE; k++) {
      pokeMem(cpu, WORK_RAM_BASE + k, 1, seedBuf[k]!);
      state.workRam[k] = seedBuf[k]!;
    }

    // Capture byte @ A2+9 (NON clearato dalla funzione, useful for debug)
    const byteAtA2_9 = state.workRam[(a2 - WORK_RAM_BASE + 9) >>> 0]! & 0xff;

    // Capture long-BE @ SP+4 (= 0x401F00 → workRam[0x1F00..0x1F03])
    // Questo è il valore che il binario leggerà a 0x5236 con `move.l (4,SP),D0`.
    // Le tre fasi di clear NON toccano [0x1F00..0x1F03] (clear = A2+0..0x1D
    // dove A2 ≤ 0x1C00 → max addr clearato = 0x1C1D < 0x1F00). E il bsr a
    // 0x5224 + 0x5234 toccano solo SP region [0x1EF8..0x1EFB] (ret addrs)
    // PIU' SP+4 NON viene scritto. Quindi letto = pre-fill seedBuf.
    const stackD0 =
      (((seedBuf[0x1f00] ?? 0) << 24) |
        ((seedBuf[0x1f01] ?? 0) << 16) |
        ((seedBuf[0x1f02] ?? 0) << 8) |
        (seedBuf[0x1f03] ?? 0)) >>>
      0;

    // Setup register: A2 (D0/D1 sono caller-clobbered, no setup necessario)
    cpu.system.setRegister("a2", a2 >>> 0);

    // Run binary
    callFunction(cpu, FUN_520E, []);

    // Run TS
    ssNs.stateSub520E(state, a2, stackD0);

    // Confronta workRam, esclude zona stack:
    // `callFunction` (SP=0x401F00) pusha sentinel a 0x401EFC. Il binario poi
    // fa bsr (push 4 byte ret addr) a 0x401EF8 due volte. Quindi range
    // toccato = [0x1EF8..0x1EFF] (8 byte). Il TS NON modella lo stack.
    // Escludiamo [0x1EE0..0x1F00) per safety (margine extra).
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
      firstFail = {
        i,
        a2,
        stackD0,
        byteAtA2_9,
        initialFlags,
        diffOffsets,
      };
    }
  }

  console.log(`  Match: ${ok}/${n} = ${((ok / n) * 100).toFixed(1)}%`);
  if (firstFail) {
    console.log(`  First fail @ case ${firstFail.i}:`);
    console.log(
      `    inputs: a2=0x${firstFail.a2.toString(16)} stackD0=0x${firstFail.stackD0.toString(16)} byte@A2+9=0x${firstFail.byteAtA2_9.toString(16)} initialFlags=0x${firstFail.initialFlags.toString(16)}`,
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
