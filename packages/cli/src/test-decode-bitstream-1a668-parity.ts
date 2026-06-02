#!/usr/bin/env node
/**
 * test-decode-bitstream-1a668-parity.ts — differential FUN_0001A668 vs
 * `decodeBitstream1A668`.
 *
 * `FUN_0001A668` (304 byte) is a bitstream + byte-stream RLE-style decoder
 * that produces 36 words (= 0x48 bytes plus possible overshoot up to 7 extra
 * words) in an output buffer. The bitstream is read at 7/9/14-bit granularity
 * with a 2-byte sliding window; it consults 2 ROM lookup tables
 * (@0x2499A 32 word, @0x249DA 8 word). See the header of the engine module
 * file for the full disasm.
 *
 * Parity strategy:
 *   - Set up workRam with a zeroed output buffer @ 0x401000, a random control
 *     bitstream @ 0x401200 (~256 byte → margin), and a random byte stream
 *     @ 0x401400 (~512 byte of coverage cache).
 *   - ROM lookup tables are the actual original binary contents
 *     (read via romBuf), not patched.
 *   - Run binary via callFunction(0x1A668, [outAbs, ctrlAbs, extAbs]).
 *   - Run TS via decodeBitstream1A668(state, rom, outAbs, ctrlAbs, extAbs).
 *   - Compare the whole output area (0x48 byte + overshoot 14 byte = 0x56 byte)
 *     byte-for-byte between binary and TS.
 *
 * Tested suites (3 x 167 + 1 = 500 cases):
 *   - A: ctrl bitstream uniformly random (mix of all 5 paths)
 *   - B: ctrl bitstream with bias toward path B (small tokens, < 0x400)
 *   - C: ctrl bitstream with bias toward path A (bit 13 set)
 *
 * Comparison: workRam[outOff..outOff + 0x56) byte-by-byte.
 *
 * Usage: npx tsx packages/cli/src/test-decode-bitstream-1a668-parity.ts [N]
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

const CTRL_BYTES = 0x100; // 256 byte of ctrl-stream (ample for ~36 iter)
const EXT_BYTES = 0x200; // 512 byte of byte-stream

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
    `\n=== decodeBitstream1A668 (FUN_0001A668) — ${total} cases ===`,
  );

  const failHolder: { value: FailRecord | null } = { value: null };

  /**
   * Sync a workRam zone @ off..off+len in both binary and TS.
   */
  function syncWorkRam(off: number, len: number, src: Uint8Array): void {
    for (let k = 0; k < len; k++) {
      pokeMem(cpu, WORK_RAM_BASE + off + k, 1, src[k]!);
      stateInst.workRam[off + k] = src[k]!;
    }
  }

  /**
   * Reset of the output zone in both (zero-fill).
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

    // Run binary.
    callFunction(cpu, FUN_1A668, [outAbs >>> 0, ctrlAbs >>> 0, extAbs >>> 0]);

    // Snapshot binary output.
    const binOut: number[] = [];
    for (let k = 0; k < COMPARE_BYTES; k++) {
      binOut.push(peekMem(cpu, WORK_RAM_BASE + OUT_OFF + k, 1) & 0xff);
    }

    // Reset only TS output state; already zero, but TS will write into it.
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
   * Generate a ctrl byte stream biased toward a specific path.
   *
   * @param mode  "uniform" | "pathB" (token piccoli) | "pathA" (bit 13 set)
   */
  function genCtrlStream(mode: string, rng: () => number): Uint8Array {
    const buf = new Uint8Array(CTRL_BYTES);
    if (mode === "pathB") {
      // Path B: 14-bit token with bit 13 = 0 and bits 12..10 = 0. So token < 0x400.
      // Bias: each byte is "small" (< 0x40 in the high nibble).
      for (let i = 0; i < CTRL_BYTES; i++) {
        // To ensure path B, the top 14 bits of the long must be < 0x400.
        // The top 14 bits are the top 14 bits of the first byte + 6 bits of the second.
        // Top 14 bits < 0x400 ⇔ top byte is 0..0xF (high 4 bits of byte0 = 0..0x0F)
        // and the low byte has bits 7..2 small. Approximation: we write a random
        // byte but with 50% MSB 0 -> mix path A/B.
        buf[i] = Math.floor(rng() * 0x40); // small bytes for mix of B/C/D
      }
    } else if (mode === "pathA") {
      // Path A: bit 13 set ⇒ top 14 bits ∈ [0x2000, 0x3FFF]. Top byte high nibble
      // has bit 5 set. Bias: high byte has bit 5 set (0x20 / 0x80 / 0xA0).
      for (let i = 0; i < CTRL_BYTES; i++) {
        // Top byte: bit 7 (= bit 31 of the stream) random, but bit 5 (= bit 29)
        // high. Setting top byte = 0x80..0xBF ensures bit 13 of the token is often set.
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
   * Generate a random "extra" byte stream with different counts (no zero to
   * avoid weird underflow).
   */
  function genExtStream(rng: () => number): Uint8Array {
    const buf = new Uint8Array(EXT_BYTES);
    // Pairs (count, value): count in [1..255], value in [0..255].
    for (let i = 0; i < EXT_BYTES; i += 2) {
      buf[i] = 1 + Math.floor(rng() * 255); // count 1..255
      buf[i + 1] = Math.floor(rng() * 0x100);
    }
    return buf;
  }

  // ─── Suite A: uniform random ───────────────────────────────────────────
  console.log(
    `\n=== Suite A: ctrl uniform random — ${perSuite} cases ===`,
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
    `\n=== Suite B: ctrl bias path B — ${perSuite} cases ===`,
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
    `\n=== Suite C: ctrl bias path A — ${sizeC} cases ===`,
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
    `\n=== TOTAL: ${totalOk}/${total} = ${((totalOk / total) * 100).toFixed(1)}% ===`,
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
