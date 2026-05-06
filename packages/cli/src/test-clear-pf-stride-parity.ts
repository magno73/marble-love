#!/usr/bin/env node
/**
 * test-clear-pf-stride-parity.ts — differential FUN_12186 vs clearPlayfieldStride.
 *
 * `FUN_00012186` (32 byte) azzera 64 finestre da 72 byte (con stride 0x80)
 * nella playfield RAM @ 0xA00000-0xA01FFF, partendo da 0xA00006. La funzione
 * non legge nulla dalla PF RAM: il risultato dipende solo dal contenuto
 * **iniziale** del range. Per coprire bene il ramo "preserve":
 *
 *   Per ogni caso N:
 *     1. Pre-fill PF RAM [0xA00000..0xA02000) con un pattern random
 *        (ROM mirror della stessa sequenza nel buffer TS).
 *     2. callFunction(0x12186, [])  ; binario azzera in-place
 *     3. clearPlayfieldStride(buf)  ; TS azzera in-place sul buffer parallelo
 *     4. Compara byte-by-byte tutti i 0x2000 byte.
 *
 * Se la funzione TS è bit-perfect, ogni byte deve combaciare.
 *
 * Uso: npx tsx packages/cli/src/test-clear-pf-stride-parity.ts [N]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import { state as stateNs, clearPfStride as cpsNs } from "@marble-love/engine";
import {
  createCpu,
  callFunction,
  pokeMem,
  peekMem,
  disposeCpu,
} from "./binary-oracle-lib.js";

const FUN_CLEAR_STRIDE = 0x00012186;
const PF_RAM_BASE = 0xa00000;
const PF_RAM_SIZE = 0x2000;

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

  console.log(`\n=== clearPlayfieldStride (FUN_12186) — ${n} casi ===`);

  const rng = makeRng(0xb1deca57);
  let ok = 0;
  let firstFail: { i: number; offset: number; bin: number; ts: number } | null = null;

  for (let i = 0; i < n; i++) {
    cpu.system.setRegister("sp", 0x401f00);

    // Genera pattern di pre-fill, deterministico per ogni caso.
    // Pattern-driven primi casi per coprire bordi:
    //   0: tutti 0xFF
    //   1: tutti 0x55 (alternato bit)
    //   2: tutti 0xAA
    //   3: tutti 0x01
    //   4: tutti 0x00 (no-op atteso)
    //   5: incrementing pattern (i & 0xFF)
    //   6: pattern 0xFE per beccare endian sui long
    //   7: pattern di "marker" 0xCC
    //   8..N: random uniforme
    const pf = new Uint8Array(PF_RAM_SIZE);

    if (i === 0) pf.fill(0xff);
    else if (i === 1) pf.fill(0x55);
    else if (i === 2) pf.fill(0xaa);
    else if (i === 3) pf.fill(0x01);
    else if (i === 4) pf.fill(0x00);
    else if (i === 5) {
      for (let j = 0; j < PF_RAM_SIZE; j++) pf[j] = j & 0xff;
    } else if (i === 6) pf.fill(0xfe);
    else if (i === 7) pf.fill(0xcc);
    else {
      for (let j = 0; j < PF_RAM_SIZE; j++) pf[j] = Math.floor(rng() * 256) & 0xff;
    }

    // ─── Setup binary side ───────────────────────────────────────────────
    // Pre-fill PF RAM con il pattern via pokeMem (a byte).
    for (let j = 0; j < PF_RAM_SIZE; j++) {
      pokeMem(cpu, PF_RAM_BASE + j, 1, pf[j] ?? 0);
    }

    // ─── Run binary ──────────────────────────────────────────────────────
    callFunction(cpu, FUN_CLEAR_STRIDE, []);

    // ─── Run TS ──────────────────────────────────────────────────────────
    cpsNs.clearPlayfieldStride(pf);

    // ─── Compare ─────────────────────────────────────────────────────────
    let match = true;
    for (let j = 0; j < PF_RAM_SIZE; j++) {
      const binByte = peekMem(cpu, PF_RAM_BASE + j, 1) & 0xff;
      const tsByte = pf[j] ?? 0;
      if (binByte !== tsByte) {
        match = false;
        if (firstFail === null) {
          firstFail = { i, offset: j, bin: binByte, ts: tsByte };
        }
        break;
      }
    }
    if (match) ok++;
  }

  console.log(`  Match: ${ok}/${n} = ${((ok / n) * 100).toFixed(1)}%`);
  if (firstFail) {
    console.log(`  First fail @ case ${firstFail.i}:`);
    console.log(
      `    diff at PF offset 0x${firstFail.offset.toString(16)} (addr 0x${(PF_RAM_BASE + firstFail.offset).toString(16)}): bin=0x${firstFail.bin.toString(16)} ts=0x${firstFail.ts.toString(16)}`,
    );
  }

  disposeCpu(cpu);
  exit(ok === n ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  exit(1);
});
