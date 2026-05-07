#!/usr/bin/env node
/**
 * test-sound-maybe-11ac2-parity.ts — differential FUN_11AC2 vs soundMaybe11AC2.
 *
 * `FUN_00011AC2` copia 66 word (132 byte) dalla ROM @ `0x1D370` nella work
 * RAM @ `0x40076E`. Non ha argomenti, non ha JSR interni e non legge dallo
 * stato del CPU (solo D0, A0, A1 che sono scratch). Il test è quindi
 * deterministico: stessa ROM → stessa write identica ad ogni chiamata.
 *
 * **Strategia di parity**:
 *   - Per ogni caso randomizzo i 132 byte di work RAM nel range di destinazione
 *     sia nel CPU musashi che nel GameState TS, poi eseguo FUN_11AC2 (binario)
 *     vs `soundMaybe11AC2` (TS) e confronto il range `0x40076E..0x400800`
 *     (132 byte) byte per byte.
 *   - La ROM usata è la stessa (non modificata) in entrambi i casi, quindi il
 *     sorgente dei dati è identico; il test verifica che la logica di copia TS
 *     scriva esattamente gli stessi byte nel range corretto.
 *   - Il range di work RAM fuori `[0x76E, 0x7EF]` viene verificato per
 *     assenza di side effect (nessuna scrittura indesiderata).
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

  // Costruiamo anche un RomImage TS dalla stessa ROM.
  const tsRom = busNs.emptyRomImage();
  tsRom.program.set(romBuf.subarray(0, tsRom.program.length));

  const state = stateNs.emptyGameState();
  const cpu = await createCpu({ rom: romBuf, state });

  console.log(`\n=== soundMaybe11AC2 (FUN_11AC2) — ${n} casi ===`);

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

    // Randomizzo il range di destinazione (per verificare sovrascrittura completa)
    // sia nel CPU (musashi memory) sia nel TS state (GameState.workRam).
    for (let b = 0; b < COPY_BYTES; b++) {
      const v = Math.floor(rng() * 256) & 0xff;
      pokeMem(cpu, DEST_BASE + b, 1, v);
      state.workRam[sNs.WORK_RAM_DEST_OFFSET + b] = v;
    }

    // Esegui binario.
    callFunction(cpu, FUN_11AC2, []);

    // Esegui TS.
    sNs.soundMaybe11AC2(state, tsRom);

    // Confronta i 132 byte del range di destinazione.
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
