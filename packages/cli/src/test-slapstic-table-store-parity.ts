#!/usr/bin/env node
/**
 * test-slapstic-table-store-parity.ts — differential FUN_2FF40 vs slapsticTableStore.
 *
 * `FUN_0002FF40` (30 byte) copia un word dalla slapstic ROM `0x87A28` verso
 * la tabella `0x87A48 + 2*sext16(D0w)`, dove `D0w` è il low word di un long
 * passato sullo stack dal caller (`move.l D0,-(SP); jsr; addq.l #4,SP`).
 *
 * **Strategia di setup**:
 *   - Prima di ogni call, randomizziamo i byte del buffer slapstic
 *     (binario via `pokeMem`, TS via `Uint8Array`) in modo identico per src
 *     e dst. Il buffer in TS rappresenta `0x80000..0x87FFF` (8 KB).
 *   - Scegliamo `arg` (long pushato): mix di valori in [0..3] (caso comune
 *     dei caller), valori signed nel range [-32..32] (sign-ext con dst dentro
 *     la slapstic), e valori arbitrari 16-bit. Filtriamo i valori che
 *     porterebbero il dst fuori dalla regione 0x80000..0x87FFF (overflow del
 *     buffer): in quel caso il binario scrive in un'altra region (es. main
 *     ROM o area nullable nella mappa Musashi) e la TS no-op,
 *     causando mismatch atteso. Questi casi non sono mai esercitati dai
 *     caller noti del binario (D2 & 0xC) >> 2 ∈ [0..3]).
 *
 * **Verifica**:
 *   - peekMem 8 byte da 0x87A48 vs slice del buffer TS.
 *   - peekMem 2 byte da 0x87A28 (src dovrebbe essere invariato sempre).
 *
 * Uso: npx tsx packages/cli/src/test-slapstic-table-store-parity.ts [N]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import { state as stateNs, slapsticTableStore as stsNs } from "@marble-love/engine";
import {
  createCpu,
  callFunction,
  pokeMem,
  peekMem,
  disposeCpu,
} from "./binary-oracle-lib.js";

const FUN_2FF40 = 0x0002ff40;

const SLAPSTIC_BASE = 0x80000;
const SLAPSTIC_SIZE = 0x8000;

const SRC_ADDR = 0x87a28;
const DST_BASE_ADDR = 0x87a48;

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) >>> 0;
    return ((s >>> 16) & 0xffff) / 0x10000;
  };
}

/**
 * Sceglie un `indexWord` in modo che `dst = 0x87A48 + 2*sext16(d0w)` cada
 * dentro la regione slapstic [0x80000..0x87FFF). Range valido per indexWord:
 *   - doubled = (idx*2) & 0xFFFF
 *   - signExt = (doubled << 16) >> 16
 *   - dst = 0x87A48 + signExt
 *   - dst in [0x80000..0x87FFE)  →  signExt in [-0x7A48..-0x4A]
 * Restituisce un indexWord in [-0x3D24..-0x25] equivalentemente: idx in
 * [0x8000-0x3D24..0x10000-0x25] tradotto: idx*2 in [-0x7A48..-0x4A]
 *   (16-bit). Per semplicità campioniamo idx ∈ [0..3] | small valori
 *   (caso comune) | random in [0..0x3D00].
 */
function pickIndexWord(rng: () => number): number {
  const r = rng();
  if (r < 0.4) {
    // Caller comune: 0..3 (FUN_2BC5C).
    return Math.floor(rng() * 4);
  } else if (r < 0.7) {
    // Range piccolo positivo: idx*2 in [0..0xFC] → dst in [0x87A48..0x87B44).
    // Ma 0x87B44 esce dal slapstic (limite 0x88000). idx*2 max safe = 0x4B6
    // cioè idx max = 0x25B. Limitiamo a [0..0x100].
    return Math.floor(rng() * 0x100);
  } else if (r < 0.85) {
    // Range con high-bits set in idx (verificare che mask a low word sia ok).
    // idx_low in [0..0x3D] → effettivo idx in [0..0x3D].
    return (Math.floor(rng() * 0x10000) << 16) | Math.floor(rng() * 0x3d);
  } else {
    // Caso edge: doubled in [0..0x4A6] → dst safe.
    // idx in [0..0x253].
    return Math.floor(rng() * 0x253);
  }
}

async function main(): Promise<void> {
  const total = Number(process.argv[2] ?? "500");

  const romPath = resolve("ghidra_project/marble_program.bin");
  if (!existsSync(romPath)) {
    console.error(`error: ROM blob not found at ${romPath}`);
    exit(3);
  }
  const rom = readFileSync(romPath);

  const stateInst = stateNs.emptyGameState();
  const cpu = await createCpu({ rom, state: stateInst });

  console.log(`\n=== slapsticTableStore (FUN_2FF40) — ${total} casi ===`);

  const rng = makeRng(0x2ff40);
  let ok = 0;
  interface FailRecord {
    i: number;
    indexWord: number;
    srcWord: number;
    dstAddr: number;
    binBytes: number[];
    tsBytes: number[];
  }
  let firstFail: FailRecord | null = null;

  // Buffer TS che rispecchia la regione slapstic (0x80000..0x87FFF).
  const tsBuf = new Uint8Array(SLAPSTIC_SIZE);

  for (let i = 0; i < total; i++) {
    cpu.system.setRegister("sp", 0x401f00);

    // Randomizziamo i byte rilevanti: src word + dst table 8 byte.
    // Per evitare di sovrascrivere ROM critica, modifichiamo solo i byte
    // letti/scritti dalla funzione.
    const srcWord = Math.floor(rng() * 0x10000) & 0xffff;
    const dstSeed = new Array(8).fill(0).map(() => Math.floor(rng() * 256) & 0xff);

    // Setup binario:
    pokeMem(cpu, SRC_ADDR, 1, (srcWord >>> 8) & 0xff);
    pokeMem(cpu, SRC_ADDR + 1, 1, srcWord & 0xff);
    for (let j = 0; j < 8; j++) {
      pokeMem(cpu, DST_BASE_ADDR + j, 1, dstSeed[j] ?? 0);
    }

    // Setup TS (buf zeroed each iter per evitare side effects accumulate).
    tsBuf.fill(0);
    tsBuf[SRC_ADDR - SLAPSTIC_BASE] = (srcWord >>> 8) & 0xff;
    tsBuf[SRC_ADDR - SLAPSTIC_BASE + 1] = srcWord & 0xff;
    for (let j = 0; j < 8; j++) {
      tsBuf[DST_BASE_ADDR - SLAPSTIC_BASE + j] = dstSeed[j] ?? 0;
    }

    const indexWord = pickIndexWord(rng);

    // Calcoliamo dst per logging:
    const idxLow = indexWord & 0xffff;
    const doubled = (idxLow + idxLow) & 0xffff;
    const signExt = (doubled << 16) >> 16;
    const dstAddr = (DST_BASE_ADDR + signExt) >>> 0;

    // Skip casi out-of-range del buffer slapstic (la TS no-op'erebbe ma il
    // binario in Musashi scrive da qualche altra parte → mismatch atteso).
    // I caller noti non producono mai questi casi.
    if (dstAddr < SLAPSTIC_BASE || dstAddr + 1 >= SLAPSTIC_BASE + SLAPSTIC_SIZE) {
      // riprova con un nuovo idx
      i--;
      continue;
    }

    // ─── Run binary ──────────────────────────────────────────────────────
    callFunction(cpu, FUN_2FF40, [indexWord]);

    const binBytes: number[] = [];
    for (let j = 0; j < 8; j++) {
      binBytes.push(peekMem(cpu, DST_BASE_ADDR + j, 1) & 0xff);
    }
    // Verifica anche che il src sia invariato.
    const binSrcHi = peekMem(cpu, SRC_ADDR, 1) & 0xff;
    const binSrcLo = peekMem(cpu, SRC_ADDR + 1, 1) & 0xff;

    // ─── Run TS ──────────────────────────────────────────────────────────
    stsNs.slapsticTableStore(tsBuf, SLAPSTIC_BASE, indexWord);

    const tsBytes: number[] = [];
    for (let j = 0; j < 8; j++) {
      tsBytes.push(tsBuf[DST_BASE_ADDR - SLAPSTIC_BASE + j] ?? 0);
    }
    const tsSrcHi = tsBuf[SRC_ADDR - SLAPSTIC_BASE] ?? 0;
    const tsSrcLo = tsBuf[SRC_ADDR - SLAPSTIC_BASE + 1] ?? 0;

    // Confronto:
    let match = binSrcHi === tsSrcHi && binSrcLo === tsSrcLo;
    if (match) {
      for (let j = 0; j < 8; j++) {
        if (binBytes[j] !== tsBytes[j]) {
          match = false;
          break;
        }
      }
    }

    if (match) {
      ok++;
    } else if (firstFail === null) {
      firstFail = {
        i,
        indexWord,
        srcWord,
        dstAddr,
        binBytes,
        tsBytes,
      };
    }
  }

  console.log(`  Match: ${ok}/${total} = ${((ok / total) * 100).toFixed(1)}%`);
  if (firstFail) {
    const fmt = (a: number[]): string =>
      a.map((b) => b.toString(16).padStart(2, "0")).join(" ");
    console.log(`  First fail @ case ${firstFail.i}:`);
    console.log(
      `    inputs: indexWord=0x${(firstFail.indexWord >>> 0).toString(16)} ` +
        `srcWord=0x${firstFail.srcWord.toString(16)} ` +
        `dstAddr=0x${firstFail.dstAddr.toString(16)}`,
    );
    console.log(`    bin dst[0..7]: ${fmt(firstFail.binBytes)}`);
    console.log(`    ts  dst[0..7]: ${fmt(firstFail.tsBytes)}`);
  }

  disposeCpu(cpu);
  exit(ok === total ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  exit(1);
});
