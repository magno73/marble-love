#!/usr/bin/env node
/**
 * test-slapstic-word-copy-2ff28-parity.ts — differential FUN_02FF28
 * vs slapsticWordCopy2FF28.
 *
 * `FUN_0002FF28` (24 byte) copia il word a `0x87A28` verso `0x87A48`
 * incondizionatamente (nessun indice). L'argomento word passato sullo
 * stack viene caricato in D0w ma non è mai usato.
 *
 * **Strategia**:
 *   - Randomizziamo il word sorgente a `0x87A28` e i 2 byte destinazione
 *     a `0x87A48` prima di ogni call.
 *   - Verifichiamo che dopo la call i 2 byte a `0x87A48` nel binario
 *     coincidano con quelli nel buffer TS.
 *   - Passiamo anche un argomento `indexWord` random per accertare che
 *     la funzione lo ignori (come il disasm conferma).
 *
 * Uso: npx tsx packages/cli/src/test-slapstic-word-copy-2ff28-parity.ts [N]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import { slapsticWordCopy2FF28 as swcNs } from "@marble-love/engine";
import {
  createCpu,
  callFunction,
  pokeMem,
  peekMem,
  disposeCpu,
} from "./binary-oracle-lib.js";

const FUN_02FF28 = 0x0002ff28;

const SLAPSTIC_BASE = 0x80000;
const SLAPSTIC_SIZE = 0x8000;

const SRC_ADDR = 0x87a28;
const DST_ADDR = 0x87a48;

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) >>> 0;
    return ((s >>> 16) & 0xffff) / 0x10000;
  };
}

async function main(): Promise<void> {
  const total = Number(process.argv[2] ?? "500");

  const romPath = resolve("ghidra_project/marble_program.bin");
  if (!existsSync(romPath)) {
    console.error(`error: ROM blob not found at ${romPath}`);
    exit(3);
  }
  const rom = readFileSync(romPath);

  // state non necessario per questa funzione: usiamo solo il bus
  const { state: stateNs } = await import("@marble-love/engine");
  const stateInst = stateNs.emptyGameState();
  const cpu = await createCpu({ rom, state: stateInst });

  console.log(`\n=== slapsticWordCopy2FF28 (FUN_02FF28) — ${total} casi ===`);

  const rng = makeRng(0x2ff28);
  let ok = 0;
  interface FailRecord {
    i: number;
    srcWord: number;
    dstBefore: number;
    indexWord: number;
    binDst: number[];
    tsDst: number[];
  }
  let firstFail: FailRecord | null = null;

  const tsBuf = new Uint8Array(SLAPSTIC_SIZE);

  for (let i = 0; i < total; i++) {
    cpu.system.setRegister("sp", 0x401f00);

    const srcWord = Math.floor(rng() * 0x10000) & 0xffff;
    const dstBefore = Math.floor(rng() * 0x10000) & 0xffff;
    // indexWord random — deve essere ignorato dalla funzione
    const indexWord = Math.floor(rng() * 0x10000) & 0xffff;

    // Setup binario
    pokeMem(cpu, SRC_ADDR, 1, (srcWord >>> 8) & 0xff);
    pokeMem(cpu, SRC_ADDR + 1, 1, srcWord & 0xff);
    pokeMem(cpu, DST_ADDR, 1, (dstBefore >>> 8) & 0xff);
    pokeMem(cpu, DST_ADDR + 1, 1, dstBefore & 0xff);

    // Setup TS
    tsBuf.fill(0);
    tsBuf[SRC_ADDR - SLAPSTIC_BASE] = (srcWord >>> 8) & 0xff;
    tsBuf[SRC_ADDR - SLAPSTIC_BASE + 1] = srcWord & 0xff;
    tsBuf[DST_ADDR - SLAPSTIC_BASE] = (dstBefore >>> 8) & 0xff;
    tsBuf[DST_ADDR - SLAPSTIC_BASE + 1] = dstBefore & 0xff;

    // ─── Run binary ──────────────────────────────────────────────────────
    callFunction(cpu, FUN_02FF28, [indexWord]);

    const binDst: number[] = [
      peekMem(cpu, DST_ADDR, 1) & 0xff,
      peekMem(cpu, DST_ADDR + 1, 1) & 0xff,
    ];
    const binSrc: number[] = [
      peekMem(cpu, SRC_ADDR, 1) & 0xff,
      peekMem(cpu, SRC_ADDR + 1, 1) & 0xff,
    ];

    // ─── Run TS ──────────────────────────────────────────────────────────
    swcNs.slapsticWordCopy2FF28(tsBuf, SLAPSTIC_BASE);

    const tsDst: number[] = [
      tsBuf[DST_ADDR - SLAPSTIC_BASE] ?? 0,
      tsBuf[DST_ADDR - SLAPSTIC_BASE + 1] ?? 0,
    ];
    const tsSrc: number[] = [
      tsBuf[SRC_ADDR - SLAPSTIC_BASE] ?? 0,
      tsBuf[SRC_ADDR - SLAPSTIC_BASE + 1] ?? 0,
    ];

    const match =
      binDst[0] === tsDst[0] &&
      binDst[1] === tsDst[1] &&
      binSrc[0] === tsSrc[0] &&
      binSrc[1] === tsSrc[1];

    if (match) {
      ok++;
    } else if (firstFail === null) {
      firstFail = { i, srcWord, dstBefore, indexWord, binDst, tsDst };
    }
  }

  console.log(`  Match: ${ok}/${total} = ${((ok / total) * 100).toFixed(1)}%`);
  if (firstFail) {
    const fmt = (a: number[]): string =>
      a.map((b) => b.toString(16).padStart(2, "0")).join(" ");
    console.log(`  First fail @ case ${firstFail.i}:`);
    console.log(
      `    inputs: srcWord=0x${firstFail.srcWord.toString(16)} ` +
        `dstBefore=0x${firstFail.dstBefore.toString(16)} ` +
        `indexWord=0x${firstFail.indexWord.toString(16)}`,
    );
    console.log(`    bin dst[0..1]: ${fmt(firstFail.binDst)}`);
    console.log(`    ts  dst[0..1]: ${fmt(firstFail.tsDst)}`);
  }

  disposeCpu(cpu);
  exit(ok === total ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  exit(1);
});
