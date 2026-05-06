#!/usr/bin/env node
/**
 * test-object-update-pair-158cc-parity.ts — differential FUN_158CC vs
 * objectUpdatePair158CC.
 *
 * `FUN_000158CC` (42 byte) itera 2 slot @ `0x4009A4` stride `0x7C` e chiama
 * `FUN_000158F6` su ciascuna. FUN_158F6 è una sub di update oggetto
 * complessa (timer, transizioni di stato, sub-call a FUN_160D4 / FUN_25FC2 /
 * FUN_1B9CC / FUN_1281C); per isolare il path di FUN_158CC patchamo
 * FUN_158F6 con un payload "capture":
 *
 *   move.l   (0x4,SP), D0          ; 20 2F 00 04        (4 byte)  arg long
 *   movea.l  (0x00401FF8).l, A1    ; 22 79 00 40 1F F8  (6 byte)  cur
 *   move.l   D0, (A1)+             ; 22 C0              (2 byte)  *cur++ = arg
 *   move.l   A1, (0x00401FF8).l    ; 23 C9 00 40 1F F8  (6 byte)  store cur
 *   rts                            ; 4E 75              (2 byte)
 *
 * Totale 20 byte. FUN_158F6 originale è ben oltre 20 byte (la disasm si
 * estende sino a 0x15974+), patch sicura.
 *
 * Buffer cattura:
 *   - 0x401FE0..0x401FF7 : 6 slot long (init sentinel 0xDEADBEEF, max 6
 *                          writes — ne aspettiamo 2)
 *   - 0x401FF8..0x401FFB : long puntatore "cur" (init 0x00401FE0)
 *
 * Nota: usiamo l'offset `0x401FE0` (non `0x401FF0` come gli altri parity
 * test) perché `0x401FFC` è già usato da `test-sound-pair-15884-parity` e
 * scrivere 4×4=16 byte rischia di sovrapporsi se SP scendesse troppo. Lo
 * stack di Musashi viene reset a `0x401F00` prima di ogni iterazione.
 *
 * Atteso (sempre, indipendentemente da workRam):
 *   - exactly 2 longs scritti
 *   - long[0] = 0x004009A4
 *   - long[1] = 0x00400A20
 *
 * Per la TS replication: cattureremo le chiamate `objectUpdate` callback.
 *
 * Pattern coverage (500 iter): la funzione è deterministica (no input,
 * non legge work RAM); le 500 iter servono come stress-test contro
 * memory side-effect accumulati e patterns di workRam diversi (verifichiamo
 * che la sequenza catturata sia identica a prescindere dallo stato della
 * work RAM).
 *
 * Uso: npx tsx packages/cli/src/test-object-update-pair-158cc-parity.ts [N]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import {
  state as stateNs,
  objectUpdatePair158CC as oupNs,
} from "@marble-love/engine";
import {
  createCpu,
  callFunction,
  pokeMem,
  peekMem,
  disposeCpu,
} from "./binary-oracle-lib.js";

const FUN_158CC = 0x000158cc;
const FUN_158F6 = 0x000158f6;
const BUF_BASE = 0x00401fe0; // 6×4 byte capture buffer (24 byte)
const CUR_PTR = 0x00401ff8; // long pointer to next slot

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
  const rom = Buffer.from(readFileSync(romPath));

  // Patch ROM @ FUN_158F6: append arg long to (*0x401FF8)++ buffer.
  // 20 byte di codice; FUN_158F6 originale è >>20 byte (sicuro).
  // move.l   (0x4,SP), D0          : 20 2F 00 04
  // movea.l  ($00401FF8).l, A1     : 22 79 00 40 1F F8
  // move.l   D0, (A1)+             : 22 C0
  // move.l   A1, ($00401FF8).l     : 23 C9 00 40 1F F8
  // rts                            : 4E 75
  rom[FUN_158F6 + 0x0] = 0x20; rom[FUN_158F6 + 0x1] = 0x2f;
  rom[FUN_158F6 + 0x2] = 0x00; rom[FUN_158F6 + 0x3] = 0x04;
  rom[FUN_158F6 + 0x4] = 0x22; rom[FUN_158F6 + 0x5] = 0x79;
  rom[FUN_158F6 + 0x6] = 0x00; rom[FUN_158F6 + 0x7] = 0x40;
  rom[FUN_158F6 + 0x8] = 0x1f; rom[FUN_158F6 + 0x9] = 0xf8;
  rom[FUN_158F6 + 0xa] = 0x22; rom[FUN_158F6 + 0xb] = 0xc0;
  rom[FUN_158F6 + 0xc] = 0x23; rom[FUN_158F6 + 0xd] = 0xc9;
  rom[FUN_158F6 + 0xe] = 0x00; rom[FUN_158F6 + 0xf] = 0x40;
  rom[FUN_158F6 + 0x10] = 0x1f; rom[FUN_158F6 + 0x11] = 0xf8;
  rom[FUN_158F6 + 0x12] = 0x4e; rom[FUN_158F6 + 0x13] = 0x75;

  const state = stateNs.emptyGameState();
  const cpu = await createCpu({ rom, state });

  console.log(`\n=== objectUpdatePair158CC (FUN_158CC) — ${n} casi ===`);

  const rng = makeRng(0x158cc1);
  let ok = 0;
  let firstFail: {
    i: number;
    binSeq: number[];
    tsSeq: number[];
  } | null = null;

  for (let i = 0; i < n; i++) {
    cpu.system.setRegister("sp", 0x401f00);

    // Variazione del workRam: pattern diversi per ogni iter, per stressare
    // l'invariante "FUN_158CC non legge la work RAM". Riempiamo le 2 slot
    // (0x9A4, 0xA20) con pattern variabili: la sequenza di puntatori
    // catturati DEVE restare invariata.
    //
    // Pattern:
    //   i=0..3: pattern statici (zero / 0xFF / mix)
    //   i>=4 : random
    if (i === 0) {
      // tutto zero (default)
    } else if (i === 1) {
      pokeMem(cpu, 0x004009a4, 4, 0xdeadbeef);
      pokeMem(cpu, 0x00400a20, 4, 0xcafebabe);
      state.workRam[0x9a4] = 0xde;
      state.workRam[0x9a5] = 0xad;
      state.workRam[0x9a6] = 0xbe;
      state.workRam[0x9a7] = 0xef;
      state.workRam[0xa20] = 0xca;
      state.workRam[0xa21] = 0xfe;
      state.workRam[0xa22] = 0xba;
      state.workRam[0xa23] = 0xbe;
    } else if (i === 2) {
      // 0xFF in tutta la work RAM lato TS; lato bin patchiamo bytes mirati
      state.workRam.fill(0xff);
      // Spari pattern in posizioni "interessanti" del binario
      pokeMem(cpu, 0x00400000, 4, 0xffffffff);
      pokeMem(cpu, 0x004003b8, 2, 0xffff); // skip flag
      pokeMem(cpu, 0x004003ea, 2, 0xffff); // stage
    } else if (i === 3) {
      // Reset: zero tutto
      state.workRam.fill(0x00);
      // Anche su Musashi azzeriamo le slot
      pokeMem(cpu, 0x004009a4, 4, 0x00000000);
      pokeMem(cpu, 0x00400a20, 4, 0x00000000);
    } else {
      // Random pattern
      const r1 = Math.floor(rng() * 0x100000000) >>> 0;
      const r2 = Math.floor(rng() * 0x100000000) >>> 0;
      pokeMem(cpu, 0x004009a4, 4, r1);
      pokeMem(cpu, 0x00400a20, 4, r2);
      state.workRam[0x9a4] = (r1 >>> 24) & 0xff;
      state.workRam[0x9a5] = (r1 >>> 16) & 0xff;
      state.workRam[0x9a6] = (r1 >>> 8) & 0xff;
      state.workRam[0x9a7] = r1 & 0xff;
      state.workRam[0xa20] = (r2 >>> 24) & 0xff;
      state.workRam[0xa21] = (r2 >>> 16) & 0xff;
      state.workRam[0xa22] = (r2 >>> 8) & 0xff;
      state.workRam[0xa23] = r2 & 0xff;
    }

    // Reset capture buffer (6 longs = 24 byte) + cursor pointer.
    // Sentinel 0xDEADBEEF distinto dai due valori attesi.
    for (let k = 0; k < 6; k++) {
      pokeMem(cpu, BUF_BASE + k * 4, 4, 0xdeadbeef);
    }
    pokeMem(cpu, CUR_PTR, 4, BUF_BASE);

    // Run binary
    callFunction(cpu, FUN_158CC, []);
    const curEnd = peekMem(cpu, CUR_PTR, 4) >>> 0;
    const nWrites = ((curEnd - BUF_BASE) >>> 0) / 4;
    const binSeq: number[] = [];
    for (let k = 0; k < nWrites && k < 6; k++) {
      binSeq.push(peekMem(cpu, BUF_BASE + k * 4, 4) >>> 0);
    }

    // Run TS
    const tsSeq: number[] = [];
    oupNs.objectUpdatePair158CC(state, {
      objectUpdate: (slotPtr: number) => {
        tsSeq.push(slotPtr >>> 0);
      },
    });

    const match =
      binSeq.length === tsSeq.length &&
      binSeq.every((v, k) => v === tsSeq[k]);
    if (match) {
      ok++;
    } else if (firstFail === null) {
      firstFail = { i, binSeq, tsSeq };
    }
  }

  console.log(`  Match: ${ok}/${n} = ${((ok / n) * 100).toFixed(1)}%`);
  if (firstFail) {
    console.log(`  First fail @ case ${firstFail.i}:`);
    const fmt = (a: number[]) =>
      "[" +
      a.map((v) => "0x" + v.toString(16).padStart(8, "0")).join(", ") +
      "]";
    console.log(`    bin: ${fmt(firstFail.binSeq)}`);
    console.log(`    ts : ${fmt(firstFail.tsSeq)}`);
  }

  disposeCpu(cpu);
  exit(ok === n ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  exit(1);
});
