#!/usr/bin/env node
/**
 * test-dispatch-strings-17230-parity.ts —
 * differential FUN_17230 vs `dispatchStrings17230`.
 *
 * **Strategia**: `FUN_00017230` (42 byte) è un dispatcher puro che chiama 7
 * volte `FUN_0001725a(slotPtr)` con `slotPtr = 0x401482 + i*0x42` per
 * `i ∈ 0..6`. Per testare in isolamento la *sola* logica di dispatch
 * (ordine, addressing, count) **patchiamo `FUN_1725a` con uno stub** che
 * scrive il pointer ricevuto in una coda FIFO in workRam, così l'effetto
 * del dispatcher è interamente osservabile via memoria.
 *
 * **Stub layout** (20 byte) iniettato @ `0x0001725a`:
 *
 *   2079 0040 1BF8     ; movea.l (0x401BF8).l, A0   ; A0 = head pointer
 *   202F 0004          ; move.l  (4,SP), D0          ; D0 = slotPtr arg
 *   20C0               ; move.l  D0, (A0)+           ; *A0++ = slotPtr
 *   23C8 0040 1BF8     ; move.l  A0, (0x401BF8).l    ; save head back
 *   4E75               ; rts
 *
 * (la zona `0x401BF8..0x401BFB` è il "head pointer" della coda; la coda
 * stessa parte a `0x401C00` e ha 7×4=28 byte di scritture utili, quindi
 * `0x401C00..0x401C1B`.)
 *
 * Per ogni caso:
 *   1. Pre-fill workRam con un pattern deterministico.
 *   2. **Side binary**: setta head=0x401C00, run callFunction(0x17230). Il
 *      binario chiama lo stub 7× → workRam finale_bin.
 *   3. Snapshot workRam_post_bin, ripristina workRam pre-call.
 *   4. **Side TS**: setta head=0x401C00 (in pokeMem), run TS dispatcher con
 *      callback che invoca `callFunction(0x1725a, [slot])` (stesso stub).
 *   5. Snapshot workRam_post_ts.
 *   6. Compara byte-per-byte 0x400000..0x402000.
 *
 * Se il dispatcher TS è bit-perfect (stessa sequenza di 7 chiamate, stessi
 * argomenti, stesso ordine), workRam_post_ts == workRam_post_bin.
 *
 * Variabili randomizzate per 500 casi:
 *   - pre-fill workRam (pattern + random tail)
 *   - head iniziale (0x401C00 ± piccoli offset multipli di 4)
 *   - byte sentinel sparsi al di fuori della coda per assicurarsi che il
 *     dispatcher non clobberi nulla.
 *
 * Uso: npx tsx packages/cli/src/test-dispatch-strings-17230-parity.ts [N]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import {
  state as stateNs,
  dispatchStrings17230 as dsNs,
} from "@marble-love/engine";
import {
  createCpu,
  callFunction,
  pokeMem,
  peekMem,
  disposeCpu,
} from "./binary-oracle-lib.js";

const FUN_DISPATCH = 0x00017230;
const FUN_CALLEE = 0x0001725a;
const WORK_RAM_BASE = 0x00400000;
const WORK_RAM_SIZE = 0x2000;
const QUEUE_HEAD_PTR = 0x00401bf8; // long: pointer corrente di scrittura
const QUEUE_BASE = 0x00401c00; // base FIFO

/** Stub bytes: vedi disasm in header. */
const STUB_BYTES = [
  0x20, 0x79, 0x00, 0x40, 0x1b, 0xf8, // movea.l (0x401BF8).l, A0
  0x20, 0x2f, 0x00, 0x04, // move.l (4,SP), D0
  0x20, 0xc0, // move.l D0, (A0)+    (was 0x2080 — wrong: that's move.l D0,(A0))
  0x23, 0xc8, 0x00, 0x40, 0x1b, 0xf8, // move.l A0, (0x401BF8).l (was 0x21C8 — wrong)
  0x4e, 0x75, // rts
] as const;

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) >>> 0;
    return ((s >>> 16) & 0xffff) / 0x10000;
  };
}

/** Cattura workRam dal CPU in un Uint8Array. */
function captureWorkRam(cpu: ReturnType<typeof createCpuSync>): Uint8Array {
  const out = new Uint8Array(WORK_RAM_SIZE);
  for (let i = 0; i < WORK_RAM_SIZE; i++) {
    out[i] = peekMem(cpu, WORK_RAM_BASE + i, 1) & 0xff;
  }
  return out;
}

/** Carica un buffer in workRam dal CPU. */
function loadWorkRam(cpu: ReturnType<typeof createCpuSync>, src: Uint8Array): void {
  for (let i = 0; i < WORK_RAM_SIZE; i++) {
    pokeMem(cpu, WORK_RAM_BASE + i, 1, src[i] ?? 0);
  }
}

// type alias for the inferred CPU session (avoid importing internal type)
type CpuSync = Awaited<ReturnType<typeof createCpu>>;
const createCpuSync = createCpu as unknown as (cfg: Parameters<typeof createCpu>[0]) => CpuSync;

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

  // Patch FUN_1725a con lo stub (zona ROM-mapped 0x000000-0x07FFFF;
  // pokeMem va in write diretta, vedi pattern in test-flag-scaled-magnitude).
  for (let i = 0; i < STUB_BYTES.length; i++) {
    pokeMem(cpu, FUN_CALLEE + i, 1, STUB_BYTES[i]!);
  }

  console.log(`\n=== dispatchStrings17230 (FUN_17230) — ${n} casi ===`);
  console.log(
    `  (FUN_1725A patched in-memory con stub di queue-write @ 0x401C00)`,
  );

  const rng = makeRng(0x17230a17);
  let ok = 0;
  let firstFail: {
    i: number;
    offset: number;
    bin: number;
    ts: number;
  } | null = null;

  for (let i = 0; i < n; i++) {
    // Riapplica la patch ogni 100 iter per safety (Musashi non scrive su ROM
    // ma alcuni harness paranoid riapplicano).
    if (i % 100 === 0) {
      for (let k = 0; k < STUB_BYTES.length; k++) {
        pokeMem(cpu, FUN_CALLEE + k, 1, STUB_BYTES[k]!);
      }
    }

    // ── Genera pre-fill workRam deterministico ──────────────────────────
    const pre = new Uint8Array(WORK_RAM_SIZE);
    if (i === 0) pre.fill(0x00);
    else if (i === 1) pre.fill(0xff);
    else if (i === 2) pre.fill(0x55);
    else if (i === 3) pre.fill(0xaa);
    else if (i === 4) {
      for (let j = 0; j < WORK_RAM_SIZE; j++) pre[j] = j & 0xff;
    } else if (i === 5) {
      for (let j = 0; j < WORK_RAM_SIZE; j++) pre[j] = (j * 7) & 0xff;
    } else if (i === 6) {
      for (let j = 0; j < WORK_RAM_SIZE; j++) pre[j] = (j ^ 0x5a) & 0xff;
    } else if (i === 7) pre.fill(0xcc);
    else {
      for (let j = 0; j < WORK_RAM_SIZE; j++) {
        pre[j] = Math.floor(rng() * 256) & 0xff;
      }
    }

    // Setta un head pointer iniziale ben-allineato (multiplo di 4). Per
    // i primi 8 casi usa esattamente 0x401C00; poi varia leggermente in
    // multipli di 4 ben dentro al range workRam (per dare pattern-coverage
    // alle scritture FIFO).
    let headInit: number;
    if (i < 8) {
      headInit = QUEUE_BASE;
    } else {
      // multipli di 4 in [0x401C00 .. 0x401D80) — abbondantemente prima di SP
      const slot = Math.floor(rng() * 0x60); // 0..95
      headInit = (QUEUE_BASE + slot * 4) >>> 0;
    }
    // Scrive head pointer (long BE) nel pre-fill, così binary e TS partono
    // dallo stesso stato esatto.
    pre[QUEUE_HEAD_PTR + 0 - WORK_RAM_BASE] = (headInit >>> 24) & 0xff;
    pre[QUEUE_HEAD_PTR + 1 - WORK_RAM_BASE] = (headInit >>> 16) & 0xff;
    pre[QUEUE_HEAD_PTR + 2 - WORK_RAM_BASE] = (headInit >>> 8) & 0xff;
    pre[QUEUE_HEAD_PTR + 3 - WORK_RAM_BASE] = headInit & 0xff;

    // ── Side binary ─────────────────────────────────────────────────────
    cpu.system.setRegister("sp", 0x401f00);
    loadWorkRam(cpu, pre);
    callFunction(cpu, FUN_DISPATCH, []);
    const postBin = captureWorkRam(cpu);

    // ── Side TS ─────────────────────────────────────────────────────────
    // Reset cpu workRam allo stesso pre-state.
    cpu.system.setRegister("sp", 0x401f00);
    loadWorkRam(cpu, pre);
    // TS dispatcher: per ogni slot pushed dal nostro modulo, invoca lo
    // stesso stub via callFunction. SP è gestito da callFunction stesso.
    dsNs.dispatchStrings17230((slotAddr: number) => {
      callFunction(cpu, FUN_CALLEE, [slotAddr >>> 0]);
    });
    const postTs = captureWorkRam(cpu);

    // ── Compare ─────────────────────────────────────────────────────────
    // Compariamo TUTTO il workRam tranne la **stack scratch zone**
    // [0x401E80..0x402000). Sia il binario che la TS-orchestrazione
    // lasciano bytes residui sotto SP (push/pop di sentinel/args/movem),
    // ma con pattern di scrittura diversi (binario: movem.l + jsr 7×;
    // TS: 7× callFunction sentinel/arg). Questi byte sono "tombstone"
    // di esecuzione, non parte dell'effetto del dispatcher, quindi li
    // escludiamo dalla parità.
    //
    // Bytes confrontati: [0x000..0x1E80) = 0x1E80 byte = tutto workRam
    // eccetto i 0x180 byte di scratch stack (più che ampio: SP=0x401F00
    // scende al massimo a ~0x401EE0 nelle nostre call).
    const STACK_SCRATCH_START = 0x1e80;
    let match = true;
    for (let j = 0; j < STACK_SCRATCH_START; j++) {
      if (postBin[j] !== postTs[j]) {
        match = false;
        if (firstFail === null) {
          firstFail = {
            i,
            offset: j,
            bin: postBin[j] ?? 0,
            ts: postTs[j] ?? 0,
          };
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
      `    diff at WR offset 0x${firstFail.offset.toString(16)} (addr 0x${(WORK_RAM_BASE + firstFail.offset).toString(16)}): bin=0x${firstFail.bin.toString(16)} ts=0x${firstFail.ts.toString(16)}`,
    );
  }

  disposeCpu(cpu);
  exit(ok === n ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  exit(1);
});
