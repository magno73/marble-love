#!/usr/bin/env node
/**
 * test-sound-status-check-parity.ts — differential FUN_4C3E vs soundStatusCheck.
 *
 * `FUN_00004C3E` è il sound command sender chiamato da FUN_4CA0 con
 * D0 (long), A0 (ptr), A1 (== A0). Ritorna 0 (retry) o 1 (ok). Side effects
 * sulla work RAM `(0x14, A1)` byte e `(0x16, A1)` long quando ok.
 *
 * Setup per ogni caso random:
 *   - A0 = A1 = puntatore in work RAM (default 0x00401F44, ma variamo offset
 *     per coprire diversi slot)
 *   - 0xF60001 = 0x00 oppure 0x80 (modella bit 7 sound pending)
 *   - workRam[A0+0x16..0x19] = random long (slot già occupato o 0)
 *   - D0 = random long
 *
 * Uso: npx tsx packages/cli/src/test-sound-status-check-parity.ts [N]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import { state as stateNs, soundStatusCheck as scNs } from "@marble-love/engine";
import {
  createCpu,
  callFunction,
  pokeMem,
  peekMem,
  disposeCpu,
} from "./binary-oracle-lib.js";

const FUN_4C3E = 0x00004c3e;

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

  console.log(`\n=== soundStatusCheck (FUN_4C3E) — ${n} casi ===`);

  const rng = makeRng(0xc0ffee);
  let ok = 0;
  let firstFail: {
    i: number;
    d0: number;
    a0: number;
    pending: number;
    initialOwner: number;
    binD0: number;
    tsD0: number;
    binTypeByte: number;
    tsTypeByte: number;
    binOwner: number;
    tsOwner: number;
  } | null = null;

  for (let i = 0; i < n; i++) {
    // SP reset (callFunction usa lo stack per pushare il sentinel return).
    cpu.system.setRegister("sp", 0x401f00);

    // Mix dei pattern per coprire ogni branch:
    //   pattern 0 : pending=0, slot vuoto → ok path
    //   pattern 1 : pending=1, slot vuoto → fail (pending)
    //   pattern 2 : pending=0, slot occupato → fail (slot)
    //   pattern 3 : pending=1, slot occupato → fail (entrambi)
    //   pattern >=4: full random
    const pattern = i < 4 ? i : Math.floor(rng() * 4) + 4;
    const pending = pattern === 0 || pattern === 2 ? 0 : pattern === 1 || pattern === 3 ? 0x80 : (rng() < 0.5 ? 0x80 : 0);
    const slotOccupied = pattern === 2 || pattern === 3 ? true : pattern === 0 || pattern === 1 ? false : rng() < 0.5;
    const initialOwner = slotOccupied ? (Math.floor(rng() * 0xfffffffe) + 1) >>> 0 : 0;

    // Pointer A0/A1: usiamo 0x401F44 per la maggior parte, altrove offset
    // alternativi (multipli di 4 in [0x401E00..0x401F80]) per testare invarianza.
    const ptrChoices = [0x00401f44, 0x00401e00, 0x00401f80, 0x00401e80, 0x00401f08];
    const ptrChoiceIdx = Math.floor(rng() * ptrChoices.length);
    const a0 = ptrChoices[ptrChoiceIdx]!;

    const d0 = Math.floor(rng() * 0x100000000) >>> 0;

    // Setup MMIO: 0xF60001 byte (bit 7 = sound pending). pokeMem nella unified
    // memory di Musashi, e nessuna copia su state (TS riceve `pending` come arg).
    pokeMem(cpu, 0xf60001, 1, pending & 0xff);

    // Setup work RAM: pulisce tutti i campi rilevanti per il pointer scelto +
    // imposta lo slot iniziale.
    const offBase = a0 - 0x400000;
    // Reset tutta la zona di interesse per non contaminare il caso precedente
    for (let k = 0; k < 8; k++) {
      pokeMem(cpu, a0 + 0x14 + k, 1, 0);
      state.workRam[offBase + 0x14 + k] = 0;
    }
    // Pre-fill type byte con un sentinel (0xAA) per verificare che il path
    // "fail" NON lo modifichi
    const sentinelType = 0xaa;
    pokeMem(cpu, a0 + 0x14, 1, sentinelType);
    state.workRam[offBase + 0x14] = sentinelType;
    // Long owner @ +0x16
    pokeMem(cpu, a0 + 0x16, 4, initialOwner);
    state.workRam[offBase + 0x16] = (initialOwner >>> 24) & 0xff;
    state.workRam[offBase + 0x17] = (initialOwner >>> 16) & 0xff;
    state.workRam[offBase + 0x18] = (initialOwner >>> 8) & 0xff;
    state.workRam[offBase + 0x19] = initialOwner & 0xff;

    // Setup registers: D0=long, A0=ptr, A1=ptr (caller setta A1=A0)
    cpu.system.setRegister("d0", d0);
    cpu.system.setRegister("a0", a0 >>> 0);
    cpu.system.setRegister("a1", a0 >>> 0);

    // Run binary
    const r = callFunction(cpu, FUN_4C3E, []);
    const binD0 = r.d0 >>> 0;
    const binTypeByte = peekMem(cpu, a0 + 0x14, 1) & 0xff;
    const binOwner = peekMem(cpu, a0 + 0x16, 4) >>> 0;

    // Run TS
    const tsD0 = scNs.soundStatusCheck(state, d0, a0, pending !== 0);
    const tsTypeByte = state.workRam[offBase + 0x14] ?? 0;
    const tsOwner =
      (((state.workRam[offBase + 0x16] ?? 0) << 24) |
        ((state.workRam[offBase + 0x17] ?? 0) << 16) |
        ((state.workRam[offBase + 0x18] ?? 0) << 8) |
        (state.workRam[offBase + 0x19] ?? 0)) >>>
      0;

    const match = binD0 === tsD0 && binTypeByte === tsTypeByte && binOwner === tsOwner;
    if (match) {
      ok++;
    } else if (firstFail === null) {
      firstFail = {
        i,
        d0,
        a0,
        pending,
        initialOwner,
        binD0,
        tsD0,
        binTypeByte,
        tsTypeByte,
        binOwner,
        tsOwner,
      };
    }
  }

  console.log(`  Match: ${ok}/${n} = ${((ok / n) * 100).toFixed(1)}%`);
  if (firstFail) {
    console.log(`  First fail @ case ${firstFail.i}:`);
    console.log(
      `    inputs: d0=0x${firstFail.d0.toString(16)} a0=0x${firstFail.a0.toString(16)} pending=0x${firstFail.pending.toString(16)} initOwner=0x${firstFail.initialOwner.toString(16)}`,
    );
    console.log(
      `    bin: D0=${firstFail.binD0} typeByte=0x${firstFail.binTypeByte.toString(16)} owner=0x${firstFail.binOwner.toString(16)}`,
    );
    console.log(
      `    ts : D0=${firstFail.tsD0} typeByte=0x${firstFail.tsTypeByte.toString(16)} owner=0x${firstFail.tsOwner.toString(16)}`,
    );
  }

  disposeCpu(cpu);
  exit(ok === n ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  exit(1);
});
