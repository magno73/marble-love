#!/usr/bin/env node
/**
 * test-process-all-sprites-189e2-parity.ts — differential FUN_000189E2.
 *
 * Loop dispatcher gated da `*0x400394`, conta `*0x400396` entry sulla tabella
 * `0x40098C` (stride 0xC) e per ogni entry chiama `FUN_18A1E`.
 *
 * Setup random:
 *   - `*0x400394` (word) = 0 (run loop, ~70%) | random non-zero (~30%)
 *   - `*0x400396` (word) = 0..7
 *   - tabella `0x40098C` (max 7 entry × 0xC byte) = byte random
 *   - `*0x40097E` (HUD offset, letto da computeSpriteCoords_v1) = random word
 *
 * Verifica byte-by-byte:
 *   - tabella `0x40098C..0x40098C + 7*0xC`
 *   - globali `0x400690..0x400693` (POS_X/POS_Y aggiornati dalla callback)
 *
 * Uso: npx tsx packages/cli/src/test-process-all-sprites-189e2-parity.ts [N]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import {
  state as stateNs,
  processAllSprites189E2 as paNs,
} from "@marble-love/engine";
import {
  createCpu,
  callFunction,
  pokeMem,
  peekMem,
  disposeCpu,
} from "./binary-oracle-lib.js";

const FUN_189E2 = 0x000189e2;

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

  console.log(`\n=== processAllSprites (FUN_189E2) — ${n} casi ===`);

  const rng = makeRng(0x189e2);
  let ok = 0;
  let firstFail: {
    i: number;
    gate: number;
    count: number;
    hudOff: number;
    diffField: string;
    diffJ: number;
    binByte: number;
    tsByte: number;
  } | null = null;

  // Tabella reale max ~7 entry usata dal gioco; usiamo 7 entry per slot di test.
  const MAX_ENTRIES = 7;
  const TABLE_BYTES = MAX_ENTRIES * 0xc;

  for (let i = 0; i < n; i++) {
    cpu.system.setRegister("sp", 0x401f00);

    // Pattern coverage:
    //   i=0 → gate=0, count=0 (loop vuoto)
    //   i=1 → gate=0, count=MAX (loop pieno)
    //   i=2 → gate!=0, count=MAX (skip)
    //   i=3 → gate=0, count=1 (single entry)
    //   i=4 → gate=0, count=MAX, ogni entry con +0xA = 0xFF (skip body)
    //   i>=5 → random
    let gate: number;
    let count: number;
    let forceSkipAllEntries = false;
    if (i === 0) {
      gate = 0;
      count = 0;
    } else if (i === 1) {
      gate = 0;
      count = MAX_ENTRIES;
    } else if (i === 2) {
      gate = (Math.floor(rng() * 0xffff) + 1) & 0xffff;
      count = MAX_ENTRIES;
    } else if (i === 3) {
      gate = 0;
      count = 1;
    } else if (i === 4) {
      gate = 0;
      count = MAX_ENTRIES;
      forceSkipAllEntries = true;
    } else {
      gate = rng() < 0.7 ? 0 : Math.floor(rng() * 0xffff);
      count = Math.floor(rng() * (MAX_ENTRIES + 1));
    }

    // Setup gate word @ 0x400394 (BE in workRam, mirror in CPU mem)
    pokeMem(cpu, 0x00400394, 2, gate & 0xffff);
    state.workRam[0x394] = (gate >>> 8) & 0xff;
    state.workRam[0x395] = gate & 0xff;

    // Setup count word @ 0x400396
    pokeMem(cpu, 0x00400396, 2, count & 0xffff);
    state.workRam[0x396] = (count >>> 8) & 0xff;
    state.workRam[0x397] = count & 0xff;

    // Setup HUD offset @ 0x40097E (usato da computeSpriteCoords_v1)
    const hudOff = Math.floor(rng() * 0x10000);
    pokeMem(cpu, 0x0040097e, 2, hudOff);
    state.workRam[0x97e] = (hudOff >>> 8) & 0xff;
    state.workRam[0x97f] = hudOff & 0xff;

    // Reset POS_X/POS_Y globals @ 0x400690-693 (li scrive la callback)
    for (let k = 0; k < 4; k++) {
      pokeMem(cpu, 0x00400690 + k, 1, 0);
      state.workRam[0x690 + k] = 0;
    }

    // Setup tabella 0x40098C..0x40098C + TABLE_BYTES con byte random
    for (let j = 0; j < TABLE_BYTES; j++) {
      let v = Math.floor(rng() * 256);
      if (forceSkipAllEntries && j % 0xc === 0xa) {
        v = 0xff; // entry+0xA = 0xFF → computeSpriteCoords_v1 skip
      }
      pokeMem(cpu, 0x0040098c + j, 1, v);
      state.workRam[0x98c + j] = v;
    }

    // Run binary
    callFunction(cpu, FUN_189E2, []);

    // Run TS
    paNs.processAllSprites(state);

    // Compare tabella
    let match = true;
    let diffField = "";
    let diffJ = -1;
    let binByte = 0;
    let tsByte = 0;
    for (let j = 0; j < TABLE_BYTES; j++) {
      const b = peekMem(cpu, 0x40098c + j, 1) & 0xff;
      const t = state.workRam[0x98c + j] ?? 0;
      if (b !== t) {
        match = false;
        diffField = "table";
        diffJ = j;
        binByte = b;
        tsByte = t;
        break;
      }
    }
    // Compare globali POS_X/POS_Y
    if (match) {
      for (let j = 0x690; j <= 0x693; j++) {
        const b = peekMem(cpu, 0x400000 + j, 1) & 0xff;
        const t = state.workRam[j] ?? 0;
        if (b !== t) {
          match = false;
          diffField = "global";
          diffJ = j;
          binByte = b;
          tsByte = t;
          break;
        }
      }
    }

    if (match) {
      ok++;
    } else if (firstFail === null) {
      firstFail = {
        i,
        gate,
        count,
        hudOff,
        diffField,
        diffJ,
        binByte,
        tsByte,
      };
    }
  }

  console.log(`  Match: ${ok}/${n} = ${((ok / n) * 100).toFixed(1)}%`);
  if (firstFail) {
    console.log(`  First fail @ case ${firstFail.i}:`);
    console.log(
      `    gate=0x${firstFail.gate.toString(16)} count=${firstFail.count} hudOff=0x${firstFail.hudOff.toString(16)}`,
    );
    console.log(
      `    diff in ${firstFail.diffField}[+0x${firstFail.diffJ.toString(16)}]: bin=0x${firstFail.binByte.toString(16)} ts=0x${firstFail.tsByte.toString(16)}`,
    );
  }

  disposeCpu(cpu);
  exit(ok === n ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  exit(1);
});
