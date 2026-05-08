#!/usr/bin/env node
/**
 * test-helper-2548-parity.ts — differential FUN_00002548 vs helper2548.
 *
 * `FUN_00002548` (10 byte, 0x002548-0x002558):
 *   lsr    (0x00400006).l   ; LSR.W su word @ 0x400006; carry = old bit 0
 *   bcc.w  0x00002556       ; se carry clear → ritorna 0
 *   moveq  0x1,D0           ; carry set → D0 = 1
 *   rts
 *   clr.l  D0               ; carry clear → D0 = 0
 *   rts
 *
 * Strategia:
 *   - Randomizza workRam[0x0006..0x0007] (word @ 0x400006).
 *   - Lancia `callFunction(cpu, 0x2548)` e `helper2548(state)`.
 *   - Confronta:
 *     1. D0 dopo la call (return value: 0 o 1)
 *     2. word @ 0x400006 dopo la call (side-effect su memoria)
 *   - Ripete N (default 500) volte, inclusi edge cases:
 *     word=0, word=1, word=0xFFFF, word=0x8000, word=0x0001, word=0xFFFE.
 *
 * Uso: npx tsx packages/cli/src/test-helper-2548-parity.ts [N]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import { helper2548 as ns, state as stateNs } from "@marble-love/engine";
import {
  createCpu,
  callFunction,
  pokeMem,
  peekMem,
  disposeCpu,
} from "./binary-oracle-lib.js";

const FUN_2548 = 0x00002548;
const LSR_FLAG_ABS = 0x00400006;
const LSR_FLAG_OFF = 0x0006;

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) >>> 0;
    return ((s >>> 16) & 0xffff) / 0x10000;
  };
}

function findRomBlobPath(): string {
  const candidates = [
    process.env.MARBLE_ROM_BLOB,
    resolve("ghidra_project/marble_program.bin"),
    resolve("../marble-love/ghidra_project/marble_program.bin"),
  ].filter((p): p is string => p !== undefined && p.length > 0);
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  throw new Error(
    "ROM blob not found; set MARBLE_ROM_BLOB or keep ghidra_project/marble_program.bin in the repo.",
  );
}

interface FailCase {
  caseNo: number;
  word0: number;
  binD0: number;
  tsD0: number;
  binWord: number;
  tsWord: number;
}

async function main(): Promise<void> {
  const n = Number(process.argv[2] ?? "500");
  const rom = readFileSync(findRomBlobPath());
  const tsState = stateNs.emptyGameState();
  const cpu = await createCpu({ rom, state: tsState });

  const r = makeRng(0xcafe2548);

  // Edge cases: word=0, word=1, word=0xFFFF, word=0x8000, word=0xFFFE, word=0x5555
  const edges = [0, 1, 0xffff, 0x8000, 0xfffe, 0x5555];

  console.log(`\n=== helper2548 (FUN_2548) — ${n} casi ===`);
  let ok = 0;
  let firstFail: FailCase | null = null;

  for (let i = 0; i < n; i++) {
    // Genera il word da testare
    const word0: number =
      i < edges.length
        ? edges[i]!
        : Math.floor(r() * 0x10000) & 0xffff;

    // Scrivi il word in Musashi @ 0x400006
    pokeMem(cpu, LSR_FLAG_ABS, 2, word0);

    // Scrivi il word in tsState.workRam[0x0006..0x0007]
    tsState.workRam[LSR_FLAG_OFF] = (word0 >>> 8) & 0xff;
    tsState.workRam[LSR_FLAG_OFF + 1] = word0 & 0xff;

    // Setup SP per callFunction + maschera interrupt (SR=0x2700: supervisor +
    // IPL=7) per impedire all'ISR VBLANK @ 0x0B5E di sovrascrivere 0x400006
    // con `move.w #0x1,(0x00400006).l` durante l'esecuzione della funzione.
    cpu.system.setRegister("sp", 0x00401f00);
    cpu.system.setRegister("sr", 0x2700);

    // ── Binary oracle ──────────────────────────────────────────────────────
    const binResult = callFunction(cpu, FUN_2548);
    const binD0 = binResult.d0 >>> 0;
    // Leggi word a 0x400006 come due byte separati (size=1 per byte)
    const binWordHi = peekMem(cpu, LSR_FLAG_ABS, 1);
    const binWordLo = peekMem(cpu, LSR_FLAG_ABS + 1, 1);
    const binWord = ((binWordHi << 8) | binWordLo) & 0xffff;

    // ── TS replica ─────────────────────────────────────────────────────────
    const tsD0 = ns.helper2548(tsState) >>> 0;
    const tsWordHi = tsState.workRam[LSR_FLAG_OFF] ?? 0;
    const tsWordLo = tsState.workRam[LSR_FLAG_OFF + 1] ?? 0;
    const tsWord = ((tsWordHi << 8) | tsWordLo) & 0xffff;

    if (binD0 === tsD0 && binWord === tsWord) {
      ok++;
    } else if (firstFail === null) {
      firstFail = { caseNo: i, word0, binD0, tsD0, binWord, tsWord };
    }

    // Sync tsState.workRam[0x0006..0x0007] dalla memoria Musashi per la
    // prossima iterazione (le altre iterazioni usano word random, non c'è
    // dipendenza da questa singola cella; ma per rigore sincronizziamo)
    tsState.workRam[LSR_FLAG_OFF] = peekMem(cpu, LSR_FLAG_ABS, 1);
    tsState.workRam[LSR_FLAG_OFF + 1] = peekMem(cpu, LSR_FLAG_ABS + 1, 1);
  }

  console.log(`  Match: ${ok}/${n} = ${((ok / n) * 100).toFixed(1)}%`);
  if (firstFail !== null) {
    const f = firstFail;
    console.error(
      `  First fail (case ${f.caseNo}):` +
        ` word0=0x${f.word0.toString(16).padStart(4, "0")}` +
        ` binD0=${f.binD0} tsD0=${f.tsD0}` +
        ` binWord=0x${f.binWord.toString(16).padStart(4, "0")}` +
        ` tsWord=0x${f.tsWord.toString(16).padStart(4, "0")}`,
    );
  }

  disposeCpu(cpu);
  exit(ok === n ? 0 : 1);
}

main().catch((e: unknown) => {
  console.error(e);
  exit(1);
});
