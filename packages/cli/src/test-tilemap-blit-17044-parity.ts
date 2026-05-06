#!/usr/bin/env node
/**
 * test-tilemap-blit-17044-parity.ts — differential FUN_17044 vs tilemapBlit17044.
 *
 * `FUN_00017044` (40 byte) copia 6 finestre da 20 word ciascuna (240 byte
 * totali) dalla ROM @ 0x19F04 alla PF RAM @ 0xA00116, con stride 0x80 byte
 * tra finestre consecutive (88 byte di skip non scritti). Nessun input dai
 * registri: la sorgente è una tabella ROM fissa.
 *
 * Il risultato dipende solo da:
 *   - il contenuto **iniziale** della PF RAM (per i 88 byte preservati per
 *     riga + i byte fuori dalle 6 finestre)
 *   - i 240 byte di ROM @ 0x19F04..0x19FF3 (uguali in binary e TS — la ROM
 *     è la stessa per costruzione)
 *
 * Per ogni caso N (con pre-fill PF RAM diverso):
 *   1. Pre-fill PF RAM [0xA00000..0xA02000) con un pattern deterministico.
 *   2. callFunction(0x17044, [])  ; binario copia in-place
 *   3. tilemapBlit17044(rom, buf) ; TS copia in-place sul buffer parallelo
 *   4. Compara byte-by-byte tutti i 0x2000 byte.
 *
 * Uso: npx tsx packages/cli/src/test-tilemap-blit-17044-parity.ts [N]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import {
  state as stateNs,
  bus as busNs,
  tilemapBlit17044 as tbNs,
} from "@marble-love/engine";
import type { RomImage } from "@marble-love/engine";
import {
  createCpu,
  callFunction,
  pokeMem,
  peekMem,
  disposeCpu,
} from "./binary-oracle-lib.js";

const FUN_TILEMAP_BLIT = 0x00017044;
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

  // RomImage parallelo per la chiamata TS.
  const tsRom: RomImage = busNs.emptyRomImage();
  tsRom.program.set(rom.subarray(0, tsRom.program.length));

  console.log(`\n=== tilemapBlit17044 (FUN_17044) — ${n} casi ===`);

  const rng = makeRng(0x1704417a);
  let ok = 0;
  let firstFail: { i: number; offset: number; bin: number; ts: number } | null = null;

  for (let i = 0; i < n; i++) {
    cpu.system.setRegister("sp", 0x401f00);

    // Genera pattern di pre-fill, deterministico per ogni caso.
    // Pattern-driven primi casi per coprire bordi:
    //   0: tutti 0xFF
    //   1: tutti 0x00 (no-op effective per i 88 byte skip — mostra solo la copia)
    //   2: tutti 0x55
    //   3: tutti 0xAA
    //   4: incrementing pattern (j & 0xFF)
    //   5: pattern 0xFE
    //   6: pattern 0xCC marker
    //   7: pattern (j*7) & 0xFF (sentinel verifica per "preservato")
    //   8..N: random uniforme
    const pf = new Uint8Array(PF_RAM_SIZE);
    if (i === 0) pf.fill(0xff);
    else if (i === 1) pf.fill(0x00);
    else if (i === 2) pf.fill(0x55);
    else if (i === 3) pf.fill(0xaa);
    else if (i === 4) {
      for (let j = 0; j < PF_RAM_SIZE; j++) pf[j] = j & 0xff;
    } else if (i === 5) pf.fill(0xfe);
    else if (i === 6) pf.fill(0xcc);
    else if (i === 7) {
      for (let j = 0; j < PF_RAM_SIZE; j++) pf[j] = (j * 7) & 0xff;
    } else {
      for (let j = 0; j < PF_RAM_SIZE; j++) pf[j] = Math.floor(rng() * 256) & 0xff;
    }

    // ─── Setup binary side ───────────────────────────────────────────────
    for (let j = 0; j < PF_RAM_SIZE; j++) {
      pokeMem(cpu, PF_RAM_BASE + j, 1, pf[j] ?? 0);
    }

    // ─── Run binary ──────────────────────────────────────────────────────
    callFunction(cpu, FUN_TILEMAP_BLIT, []);

    // ─── Run TS ──────────────────────────────────────────────────────────
    tbNs.tilemapBlit17044(tsRom, pf);

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
