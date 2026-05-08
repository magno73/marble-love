#!/usr/bin/env node
/**
 * test-helper-172c2-parity.ts — differential FUN_000172C2 vs helper172C2.
 *
 * `FUN_000172C2` scansiona 7 slot a `0x401482` con stride `0x42`. Per ogni
 * slot testa il byte a `+0x18`: se è ZERO aggiorna il risultato all'indirizzo
 * dell'entry. Restituisce l'indirizzo dell'ultima entry zero-slot, o −1.
 *
 * Per ogni caso:
 *   1. Riempie casualmente i byte +0x18 dei 7 slot (0 o valore casuale)
 *   2. Sincronizza lo stesso dato in binary memory e TS workRam
 *   3. Esegue il binario via callFunction(0x172C2, []) → D0
 *   4. Esegue la TS helper172C2(state) → result
 *   5. Confronta i due valori uint32
 *
 * Uso: npx tsx packages/cli/src/test-helper-172c2-parity.ts [N]
 * (default N=500)
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import { state as stateNs, helper172C2 as helper172C2Ns } from "@marble-love/engine";
import {
  createCpu,
  callFunction,
  pokeMem,
  disposeCpu,
} from "./binary-oracle-lib.js";

const FUN_172C2 = 0x000172c2;
const SLOT_ARRAY_BASE = 0x401482;
const SLOT_STRIDE = 0x42;
const SLOT_COUNT = 7;
const SLOT_ACTIVE_OFFSET = 0x18;

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) >>> 0;
    return ((s >>> 16) & 0xffff) / 0x10000;
  };
}

async function main(): Promise<void> {
  const n = Number(process.argv[2] ?? "500");
  const romBuf = readFileSync(resolve("ghidra_project/marble_program.bin"));
  const stateInst = stateNs.emptyGameState();
  const cpu = await createCpu({ rom: romBuf, state: stateInst });

  const rng = makeRng(0x172c2);

  let ok = 0;
  type FailInfo = {
    caseNo: number;
    slots: number[];
    binResult: number;
    tsResult: number;
  };
  let firstFail: FailInfo | null = null;

  console.log(`\n=== helper172C2 (FUN_000172C2) — ${n} casi ===`);

  for (let i = 0; i < n; i++) {
    cpu.system.setRegister("sp", 0x401f00);

    // Genera valori casuali per i 7 slot (0 o un valore non-zero)
    const slotVals: number[] = [];
    for (let s = 0; s < SLOT_COUNT; s++) {
      // ~50% probabilità di zero, ~50% di non-zero
      const v = rng() < 0.5 ? 0 : Math.floor(rng() * 255) + 1;
      slotVals.push(v);
      const addr = SLOT_ARRAY_BASE + s * SLOT_STRIDE + SLOT_ACTIVE_OFFSET;
      // Sync: binary memory
      pokeMem(cpu, addr, 1, v);
      // Sync: TS workRam
      stateInst.workRam[(addr - 0x400000) >>> 0] = v;
    }

    // Esegui binario
    const binResult = callFunction(cpu, FUN_172C2, []);
    // Esegui TS
    const tsResult = helper172C2Ns.helper172C2(stateInst);

    if ((binResult.d0 >>> 0) === (tsResult >>> 0)) {
      ok++;
    } else {
      firstFail ??= {
        caseNo: i,
        slots: slotVals,
        binResult: binResult.d0 >>> 0,
        tsResult: tsResult >>> 0,
      };
    }
  }

  console.log(`  Match: ${ok}/${n} = ${((ok / n) * 100).toFixed(1)}%`);
  if (firstFail !== null) {
    const { caseNo, slots, binResult, tsResult } = firstFail;
    console.log(`  First fail: case=${caseNo}`);
    console.log(`    slots[+0x18]: [${slots.join(", ")}]`);
    console.log(
      `    bin=0x${binResult.toString(16).padStart(8, "0")}  ts=0x${tsResult.toString(16).padStart(8, "0")}`,
    );
  }

  disposeCpu(cpu);
  exit(ok === n ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  exit(1);
});
