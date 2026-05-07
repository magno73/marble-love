#!/usr/bin/env node
/**
 * test-decode-bitstream-1a668-parity.ts — differential FUN_0001A668 vs
 * `decodeBitstream1A668`.
 *
 * `FUN_0001A668` (304 byte) e' un decoder bitstream + byte-stream RLE-style
 * che produce 36 word (= 0x48 byte = piu' eventuale overshoot fino a 7 word
 * extra) in un buffer di output. Il bitstream e' letto a granularita' di
 * 7/9/14 bit con sliding-window di 2 byte; consulta 2 lookup table ROM
 * (@0x2499A 32 word, @0x249DA 8 word). Vedi header del file engine module
 * per il disasm completo.
 *
 * Strategia parity:
 *   - Setup workRam con un buffer di output zeroed @ 0x401000, un control
 *     bitstream random @ 0x401200 (~256 byte → margine), e un byte stream
 *     random @ 0x401400 (~512 byte di copertura cache).
 *   - ROM lookup tables sono il contenuto effettivo del binario originale
 *     (lette via romBuf) — non patchate.
 *   - Run binario via callFunction(0x1A668, [outAbs, ctrlAbs, extAbs]).
 *   - Run TS via decodeBitstream1A668(state, rom, outAbs, ctrlAbs, extAbs).
 *   - Compara tutta la zona output (0x48 byte + overshoot 14 byte = 0x56 byte)
 *     byte-per-byte tra binario e TS.
 *
 * Suite testate (3 × 167 + 1 = 500 casi):
 *   - A: ctrl bitstream uniformemente random (mix di tutti 5 path)
 *   - B: ctrl bitstream con bias verso path B (token piccoli, < 0x400)
 *   - C: ctrl bitstream con bias verso path A (bit 13 set)
 *
 * Confronto: workRam[outOff..outOff + 0x56) byte-per-byte.
 *
 * Uso: npx tsx packages/cli/src/test-decode-bitstream-1a668-parity.ts [N]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import {
  state as stateNs,
  bus as busNs,
  decodeBitstream1A668 as decNs,
} from "@marble-love/engine";
import {
  createCpu,
  callFunction,
  pokeMem,
  peekMem,
  disposeCpu,
} from "./binary-oracle-lib.js";

const FUN_1A668 = 0x0001a668;
const WORK_RAM_BASE = 0x00400000;

const OUT_OFF = 0x1000;
const CTRL_OFF = 0x1200;
const EXT_OFF = 0x1400;

const OUT_BYTES = 0x48;
const OUT_OVERSHOOT_MAX = 14; // 7 word
const COMPARE_BYTES = OUT_BYTES + OUT_OVERSHOOT_MAX;

const CTRL_BYTES = 0x100; // 256 byte di ctrl-stream (ample for ~36 iter)
const EXT_BYTES = 0x200; // 512 byte di byte-stream

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) >>> 0;
    return ((s >>> 16) & 0xffff) / 0x10000;
  };
}

interface FailRecord {
  suite: string;
  tc: number;
  outOff: number;
  binOut: number[];
  tsOut: number[];
  firstDiffByte: number;
}

async function main(): Promise<void> {
  const total = Number(process.argv[2] ?? "500");
  const perSuite = Math.floor(total / 3);
  const remainder = total - perSuite * 3;

  const romPath = resolve("ghidra_project/marble_program.bin");
  if (!existsSync(romPath)) {
    console.error(`error: ROM blob not found at ${romPath}`);
    exit(3);
  }
  const romBuf = Buffer.from(readFileSync(romPath));

  const romView = busNs.emptyRomImage();
  const programLen = Math.min(romView.program.length, romBuf.length);
  romView.program.set(romBuf.subarray(0, programLen));

  const stateInst = stateNs.emptyGameState();
  const cpu = await createCpu({ rom: romBuf, state: stateInst });

  console.log(
    `\n=== decodeBitstream1A668 (FUN_0001A668) — ${total} casi ===`,
  );

  const failHolder: { value: FailRecord | null } = { value: null };

  /**
   * Sync una zona di workRam @ off..off+len in entrambi binario e TS.
   */
  function syncWorkRam(off: number, len: number, src: Uint8Array): void {
    for (let k = 0; k < len; k++) {
      pokeMem(cpu, WORK_RAM_BASE + off + k, 1, src[k]!);
      stateInst.workRam[off + k] = src[k]!;
    }
  }

  /**
   * Reset dell'output zone in entrambi (zero-fill).
   */
  function clearOutZone(): void {
    for (let k = 0; k < COMPARE_BYTES; k++) {
      pokeMem(cpu, WORK_RAM_BASE + OUT_OFF + k, 1, 0);
      stateInst.workRam[OUT_OFF + k] = 0;
    }
  }

  function runOneCase(
    suite: string,
    tc: number,
    ctrlBytes: Uint8Array,
    extBytes: Uint8Array,
  ): boolean {
    cpu.system.setRegister("sp", 0x401f00);

    // Reset output zone
    clearOutZone();

    // Sync ctrl + ext streams
    syncWorkRam(CTRL_OFF, CTRL_BYTES, ctrlBytes);
    syncWorkRam(EXT_OFF, EXT_BYTES, extBytes);

    const outAbs = WORK_RAM_BASE + OUT_OFF;
    const ctrlAbs = WORK_RAM_BASE + CTRL_OFF;
    const extAbs = WORK_RAM_BASE + EXT_OFF;

    // Run binario
    callFunction(cpu, FUN_1A668, [outAbs >>> 0, ctrlAbs >>> 0, extAbs >>> 0]);

    // Snapshot output binario
    const binOut: number[] = [];
    for (let k = 0; k < COMPARE_BYTES; k++) {
      binOut.push(peekMem(cpu, WORK_RAM_BASE + OUT_OFF + k, 1) & 0xff);
    }

    // Reset solo lo state TS output (gia' zero ma la TS scrivera' dentro).
    // Run TS
    decNs.decodeBitstream1A668(stateInst, romView, outAbs, ctrlAbs, extAbs);

    const tsOut: number[] = [];
    for (let k = 0; k < COMPARE_BYTES; k++) {
      tsOut.push(stateInst.workRam[OUT_OFF + k]! & 0xff);
    }

    let firstDiff = -1;
    for (let k = 0; k < COMPARE_BYTES; k++) {
      if (binOut[k] !== tsOut[k]) {
        firstDiff = k;
        break;
      }
    }

    if (firstDiff < 0) return true;

    if (failHolder.value === null) {
      failHolder.value = {
        suite,
        tc,
        outOff: OUT_OFF,
        binOut,
        tsOut,
        firstDiffByte: firstDiff,
      };
    }
    return false;
  }

  /**
   * Genera un ctrl byte stream con bias verso un path specifico.
   *
   * @param mode  "uniform" | "pathB" (token piccoli) | "pathA" (bit 13 set)
   */
  function genCtrlStream(mode: string, rng: () => number): Uint8Array {
    const buf = new Uint8Array(CTRL_BYTES);
    if (mode === "pathB") {
      // Path B: 14-bit token con bit 13 = 0 e bits 12..10 = 0. So token < 0x400.
      // Bias: ogni byte e' "small" (< 0x40 nel high nibble).
      for (let i = 0; i < CTRL_BYTES; i++) {
        // Per assicurare path B serve il top 14 bit del long < 0x400.
        // I top 14 bit sono i top 14 bit del primo byte + 6 bit del secondo.
        // Top 14 bit < 0x400 ⇔ top byte e' 0..0xF (high 4 bit di byte0 = 0..0x0F)
        // e basso byte ha bit 7..2 small. Approssimazione: scriviamo byte
        // random ma con 50% MSB 0 → mix path A/B.
        buf[i] = Math.floor(rng() * 0x40); // small bytes for mix of B/C/D
      }
    } else if (mode === "pathA") {
      // Path A: bit 13 set ⇒ top 14 bit ∈ [0x2000, 0x3FFF]. Top byte high nibble
      // ha bit 5 set. Bias: byte alto ha bit 5 set (0x20 / 0x80 / 0xA0).
      for (let i = 0; i < CTRL_BYTES; i++) {
        // Top byte: bit 7 (= bit 31 dello stream) random, ma bit 5 (= bit 29)
        // alto. Setting top byte = 0x80..0xBF assicura bit 13 di token spesso set.
        buf[i] = 0x80 + Math.floor(rng() * 0x40);
      }
    } else {
      // Uniform random
      for (let i = 0; i < CTRL_BYTES; i++) {
        buf[i] = Math.floor(rng() * 0x100);
      }
    }
    return buf;
  }

  /**
   * Genera un byte stream "extra" random con count diversi (no zero per
   * evitare underflow weird).
   */
  function genExtStream(rng: () => number): Uint8Array {
    const buf = new Uint8Array(EXT_BYTES);
    // Coppie (count, value): count in [1..255], value in [0..255].
    for (let i = 0; i < EXT_BYTES; i += 2) {
      buf[i] = 1 + Math.floor(rng() * 255); // count 1..255
      buf[i + 1] = Math.floor(rng() * 0x100);
    }
    return buf;
  }

  // ─── Suite A: uniform random ───────────────────────────────────────────
  console.log(
    `\n=== Suite A: ctrl uniform random — ${perSuite} casi ===`,
  );
  const rngA = makeRng(0x1a668);
  let okA = 0;
  for (let i = 0; i < perSuite; i++) {
    const ctrl = genCtrlStream("uniform", rngA);
    const ext = genExtStream(rngA);
    if (runOneCase("A", i, ctrl, ext)) okA++;
  }
  console.log(`  Match: ${okA}/${perSuite} = ${((okA / perSuite) * 100).toFixed(1)}%`);

  // ─── Suite B: bias path B (token small) ─────────────────────────────────
  console.log(
    `\n=== Suite B: ctrl bias path B — ${perSuite} casi ===`,
  );
  const rngB = makeRng(0x2a668);
  let okB = 0;
  for (let i = 0; i < perSuite; i++) {
    const ctrl = genCtrlStream("pathB", rngB);
    const ext = genExtStream(rngB);
    if (runOneCase("B", i, ctrl, ext)) okB++;
  }
  console.log(`  Match: ${okB}/${perSuite} = ${((okB / perSuite) * 100).toFixed(1)}%`);

  // ─── Suite C: bias path A (bit 13 set) ─────────────────────────────────
  const sizeC = perSuite + remainder;
  console.log(
    `\n=== Suite C: ctrl bias path A — ${sizeC} casi ===`,
  );
  const rngC = makeRng(0x3a668);
  let okC = 0;
  for (let i = 0; i < sizeC; i++) {
    const ctrl = genCtrlStream("pathA", rngC);
    const ext = genExtStream(rngC);
    if (runOneCase("C", i, ctrl, ext)) okC++;
  }
  console.log(`  Match: ${okC}/${sizeC} = ${((okC / sizeC) * 100).toFixed(1)}%`);

  const totalOk = okA + okB + okC;
  console.log(
    `\n=== TOTALE: ${totalOk}/${total} = ${((totalOk / total) * 100).toFixed(1)}% ===`,
  );

  if (failHolder.value !== null) {
    const f = failHolder.value;
    console.log(`  First fail (suite ${f.suite} tc=${f.tc}):`);
    console.log(`    firstDiffByte=${f.firstDiffByte}`);
    console.log(
      `    binOut[0..15]: ${f.binOut.slice(0, 16).map((b) => b.toString(16).padStart(2, "0")).join(" ")}`,
    );
    console.log(
      `    tsOut[0..15]:  ${f.tsOut.slice(0, 16).map((b) => b.toString(16).padStart(2, "0")).join(" ")}`,
    );
    console.log(
      `    binOut[firstDiff..firstDiff+15]: ${f.binOut.slice(f.firstDiffByte, f.firstDiffByte + 16).map((b) => b.toString(16).padStart(2, "0")).join(" ")}`,
    );
    console.log(
      `    tsOut [firstDiff..firstDiff+15]: ${f.tsOut.slice(f.firstDiffByte, f.firstDiffByte + 16).map((b) => b.toString(16).padStart(2, "0")).join(" ")}`,
    );
  }

  disposeCpu(cpu);
  exit(totalOk === total ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  exit(1);
});
