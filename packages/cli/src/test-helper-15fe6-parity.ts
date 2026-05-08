#!/usr/bin/env node
/**
 * test-helper-15fe6-parity.ts — differential `FUN_00015FE6` vs `helper15FE6`.
 *
 * `FUN_00015FE6` (44 istr, 118 byte): confronta la profondità di due oggetti
 * (obj1=A1, obj2=A0) e ritorna 1 se obj1 è "davanti", 0 altrimenti.
 *
 * **Strategia parity**:
 *   - Due struct oggetto @ O1=0x401D00 e O2=0x401D40 (64 byte ciascuno).
 *   - Per ogni test case:
 *       1. Riempie casualmente 0x20 byte @ O1 e @ O2 (Musashi RAM + workRam).
 *       2. Forza `state` @ +0x18 a 1 con probabilità 70% (per coprire il
 *          path normale; il resto copre i path di early-return).
 *       3. Con probabilità 50% imposta byte +0x1B uguale (path z-equal).
 *       4. Chiama `callFunction(FUN, [O1, O2])` su Musashi.
 *       5. Chiama `helper15FE6(state, O1, O2)` in TypeScript.
 *       6. Confronta `binR.d0 & 0xff` vs `tsR`.
 *
 * Uso: npx tsx packages/cli/src/test-helper-15fe6-parity.ts [N]
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import { state as stateNs, helper15FE6 as helper15FE6Ns } from "@marble-love/engine";
import { createCpu, callFunction, pokeMem, disposeCpu } from "./binary-oracle-lib.js";

const FUN = 0x00015fe6;

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return (): number => {
    s = (s * 1103515245 + 12345) >>> 0;
    return ((s >>> 16) & 0xffff) / 0x10000;
  };
}

async function main(): Promise<void> {
  const n = Number(process.argv[2] ?? "500");
  const rom = readFileSync(resolve("ghidra_project/marble_program.bin"));
  const stateInst = stateNs.emptyGameState();
  const cpu = await createCpu({ rom, state: stateInst });
  const r = rng(0x5ee);

  console.log(`\n=== helper15FE6 (FUN_15FE6) — ${n} casi ===`);
  let ok = 0;

  for (let i = 0; i < n; i++) {
    cpu.system.setRegister("sp", 0x401f00);

    const O1 = 0x00401d00;
    const O2 = 0x00401d40;

    // Riempi casualmente 0x20 byte in entrambi gli oggetti
    for (let j = 0; j < 0x20; j++) {
      const v1 = Math.floor(r() * 256);
      const v2 = Math.floor(r() * 256);
      pokeMem(cpu, O1 + j, 1, v1);
      pokeMem(cpu, O2 + j, 1, v2);
      stateInst.workRam[(O1 - 0x400000) + j] = v1;
      stateInst.workRam[(O2 - 0x400000) + j] = v2;
    }

    // Forza state +0x18 a 1 con probabilità 70% (esercita il path normale)
    for (const O of [O1, O2]) {
      const v = r() < 0.7 ? 1 : Math.floor(r() * 256);
      pokeMem(cpu, O + 0x18, 1, v);
      stateInst.workRam[(O - 0x400000) + 0x18] = v;
    }

    // Con probabilità 50% imposta byte +0x1B uguale (esercita il path z-equal)
    if (r() < 0.5) {
      const z = Math.floor(r() * 256);
      pokeMem(cpu, O1 + 0x1b, 1, z);
      pokeMem(cpu, O2 + 0x1b, 1, z);
      stateInst.workRam[(O1 - 0x400000) + 0x1b] = z;
      stateInst.workRam[(O2 - 0x400000) + 0x1b] = z;
    }

    const binR = callFunction(cpu, FUN, [O1, O2]);
    const tsR = helper15FE6Ns.helper15FE6(stateInst, O1, O2);

    if ((binR.d0 & 0xff) === (tsR & 0xff)) {
      ok++;
    } else {
      console.error(
        `  [${i}] MISMATCH: bin=0x${(binR.d0 & 0xff).toString(16)} ts=0x${(tsR & 0xff).toString(16)}`,
      );
    }
  }

  console.log(`  Match: ${ok}/${n} = ${((ok / n) * 100).toFixed(1)}%`);
  disposeCpu(cpu);
  exit(ok === n ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  exit(1);
});
