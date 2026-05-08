#!/usr/bin/env node
/**
 * test-helper-3784-parity.ts — differential FUN_3784 vs `helper3784`.
 *
 * `FUN_00003784` (38 istr): calcola un indirizzo nell'alpha tilemap
 * (0xA03000) a partire da (y, x, rotation) e scrive `attr | orMask` come
 * word big-endian. Funzione primitiva "draw cell" usata da FUN_5D2A,
 * FUN_5688, FUN_22A4.
 *
 * **Strategia parity**:
 *   - Binario: chiamo `FUN_3784(y, x, attr, orMask)` via `callFunction`
 *     con 4 long args. Prima della call azzero alpha RAM. Dopo la call
 *     leggo D0 e confronto alpha RAM byte-by-byte (il binario scrive al
 *     massimo 2 byte).
 *   - TS: chiamo `helper3784(state, rom, y, x, attr, orMask)`. Confronto
 *     D0 restituito e lo stesso sottoinsieme di alpha RAM.
 *
 * **Copertura** (500 casi, 4 suite × 125):
 *   - A: rotation = 0, x/y random, attr random, orMask=0
 *   - B: rotation in [1..3], x/y random, attr/orMask random
 *   - C: x/y negativi (sign-ext, byte range 0x80..0xFF), rotation=0
 *   - D: rotation=0, test shift count edge: x=±1 al boundary, orMask != 0
 *
 * **Setup**:
 *   - `0x401F42` (rotation word): impostato prima di ogni call.
 *   - Alpha RAM: azzerata prima di ogni call (binario e TS).
 *   - ROM: caricata da ghidra_project/marble_program.bin.
 *
 * Uso: npx tsx packages/cli/src/test-helper-3784-parity.ts [N=500]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import {
  state as stateNs,
  bus as busNs,
  helper3784 as h3784Ns,
} from "@marble-love/engine";
import type { RomImage } from "@marble-love/engine";
import {
  createCpu,
  callFunction,
  pokeMem,
  peekMem,
  disposeCpu,
} from "./binary-oracle-lib.js";
import type { CpuSession } from "./binary-oracle-lib.js";

const FUN_3784 = 0x00003784;
const WORK_RAM_BASE = 0x00400000;
const ALPHA_RAM_BASE = 0x00a03000;
const ALPHA_RAM_END = 0x00a04000;
const ROTATION_ADDR = 0x00401f42;

// Alpha RAM size in bytes
const ALPHA_SIZE = ALPHA_RAM_END - ALPHA_RAM_BASE; // 0x1000 = 4096 bytes

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) >>> 0;
    return ((s >>> 16) & 0xffff) / 0x10000;
  };
}

/** Azzera alpha RAM nel binario e nel TS state. */
function clearAlphaRam(
  state: ReturnType<typeof stateNs.emptyGameState>,
  cpu: CpuSession,
): void {
  for (let i = 0; i < ALPHA_SIZE; i++) {
    pokeMem(cpu, ALPHA_RAM_BASE + i, 1, 0);
    state.alphaRam[i] = 0;
  }
}

/** Imposta rotation word (2 byte BE) nel binario e nel TS state. */
function setRotation(
  state: ReturnType<typeof stateNs.emptyGameState>,
  cpu: CpuSession,
  rotation: number,
): void {
  const w = rotation & 0xffff;
  pokeMem(cpu, ROTATION_ADDR, 2, w);
  state.workRam[ROTATION_ADDR - WORK_RAM_BASE + 0] = (w >>> 8) & 0xff;
  state.workRam[ROTATION_ADDR - WORK_RAM_BASE + 1] = w & 0xff;
}

interface Diff {
  field: string;
  bin: number;
  ts: number;
}

/**
 * Confronta alpha RAM (binario vs TS state) e D0.
 * Ritorna il primo mismatch trovato, o null se tutto ok.
 */
function compareState(
  state: ReturnType<typeof stateNs.emptyGameState>,
  cpu: CpuSession,
  binD0: number,
  tsD0: number,
): Diff | null {
  // Confronta D0
  if ((binD0 >>> 0) !== (tsD0 >>> 0)) {
    return { field: "D0", bin: binD0 >>> 0, ts: tsD0 >>> 0 };
  }
  // Confronta alpha RAM (solo i bytes effettivamente diversi da 0 in uno dei due)
  for (let i = 0; i < ALPHA_SIZE; i++) {
    const b = peekMem(cpu, ALPHA_RAM_BASE + i, 1);
    const t = state.alphaRam[i] ?? 0;
    if (b !== t) {
      return { field: `alphaRam[0x${i.toString(16)}]`, bin: b, ts: t };
    }
  }
  return null;
}

interface TestCase {
  rotation: number;
  y: number; // full long (low byte used by callee)
  x: number; // full long (low byte used by callee)
  attr: number; // full long (low word used by callee)
  orMask: number; // full long (low word used by callee)
}

function runOneCase(
  state: ReturnType<typeof stateNs.emptyGameState>,
  cpu: CpuSession,
  tsRom: RomImage,
  tc: TestCase,
): Diff | null {
  cpu.system.setRegister("sp", 0x401f00);
  setRotation(state, cpu, tc.rotation);
  clearAlphaRam(state, cpu);

  // Run binary: callFunction pushes args RTL (arg4 last = top of stack)
  // FUN_3784 reads: D1b=(0xf,SP)=arg1_low_byte, D0b=(0x13,SP)=arg2_low_byte,
  //   D2w=(0x16,SP)=arg3_low_word, D0w=(0x1a,SP)=arg4_low_word
  const binResult = callFunction(cpu, FUN_3784, [
    tc.y >>> 0,
    tc.x >>> 0,
    tc.attr >>> 0,
    tc.orMask >>> 0,
  ]);

  // Run TS
  const tsD0 = h3784Ns.helper3784(
    state,
    tsRom,
    tc.y,
    tc.x,
    tc.attr,
    tc.orMask,
  );

  return compareState(state, cpu, binResult.d0, tsD0);
}

async function main(): Promise<void> {
  const total = Number(process.argv[2] ?? "500");
  const perSuite = Math.floor(total / 4);
  const remainder = total - perSuite * 4;

  const romPath = resolve("ghidra_project/marble_program.bin");
  if (!existsSync(romPath)) {
    console.error(`error: ROM blob not found at ${romPath}`);
    exit(3);
  }
  const romBuf = readFileSync(romPath);

  const stateInst = stateNs.emptyGameState();
  const cpu = await createCpu({ rom: romBuf, state: stateInst });

  const tsRom: RomImage = busNs.emptyRomImage();
  tsRom.program.set(romBuf.subarray(0, tsRom.program.length));

  const rng = makeRng(0x37840000);

  interface FailRecord {
    suite: string;
    tc: number;
    diff: Diff;
    testCase: TestCase;
  }
  const failHolder: { value: FailRecord | null } = { value: null };

  let totalOk = 0;

  function runSuite(
    name: string,
    count: number,
    gen: (i: number) => TestCase,
  ): number {
    let ok = 0;
    for (let i = 0; i < count; i++) {
      const tc = gen(i);
      const diff = runOneCase(stateInst, cpu, tsRom, tc);
      if (diff === null) {
        ok++;
      } else if (failHolder.value === null) {
        failHolder.value = { suite: name, tc: i, diff, testCase: tc };
      }
    }
    return ok;
  }

  // ─── Suite A: rotation = 0, x/y random byte, attr random word, orMask=0 ──
  console.log(
    `\n=== helper3784 (FUN_3784) — Suite A: rot=0, random x/y/attr — ${perSuite} casi ===`,
  );
  const okA = runSuite("A", perSuite, () => ({
    rotation: 0,
    y: Math.floor(rng() * 0x100), // byte 0..255
    x: Math.floor(rng() * 0x100),
    attr: Math.floor(rng() * 0x10000),
    orMask: 0,
  }));
  console.log(
    `  Match: ${okA}/${perSuite} = ${((okA / perSuite) * 100).toFixed(1)}%`,
  );
  totalOk += okA;

  // ─── Suite B: rotation in [1..3], x/y/attr/orMask random ─────────────────
  console.log(
    `\n=== Suite B: rotation in [1..3], random all — ${perSuite} casi ===`,
  );
  const okB = runSuite("B", perSuite, () => ({
    rotation: 1 + Math.floor(rng() * 3), // 1..3
    y: Math.floor(rng() * 0x100),
    x: Math.floor(rng() * 0x100),
    attr: Math.floor(rng() * 0x10000),
    orMask: Math.floor(rng() * 0x10000),
  }));
  console.log(
    `  Match: ${okB}/${perSuite} = ${((okB / perSuite) * 100).toFixed(1)}%`,
  );
  totalOk += okB;

  // ─── Suite C: x/y negativi (sign-ext), rotation=0 ────────────────────────
  // In produzione y = sign-ext di word (D6w), x = sign-ext di long sum.
  // I byte negativi (0x80..0xFF → sext → -128..−1) sono comuni.
  console.log(
    `\n=== Suite C: x/y negativi (byte 0x80..0xFF), rotation=0 — ${perSuite} casi ===`,
  );
  const okC = runSuite("C", perSuite, () => ({
    rotation: 0,
    // y: biased toward negative range (0x80..0xFF) passed as low byte of long
    y: 0x80 + Math.floor(rng() * 0x80), // 0x80..0xFF
    x: 0x80 + Math.floor(rng() * 0x80),
    attr: Math.floor(rng() * 0x1000), // low attr values
    orMask: 0,
  }));
  console.log(
    `  Match: ${okC}/${perSuite} = ${((okC / perSuite) * 100).toFixed(1)}%`,
  );
  totalOk += okC;

  // ─── Suite D: misto — orMask != 0, vari rotation, edge x/y ───────────────
  const sizeD = perSuite + remainder;
  console.log(
    `\n=== Suite D: orMask != 0, rotation misto, edge x/y — ${sizeD} casi ===`,
  );
  const okD = runSuite("D", sizeD, () => {
    const rotation = Math.floor(rng() * 4); // 0..3
    // x/y: mix of positive small (0..30, typical D6w range) and negative
    const yIsNeg = rng() > 0.5;
    const xIsNeg = rng() > 0.5;
    const y = yIsNeg
      ? 0x80 + Math.floor(rng() * 0x80)
      : Math.floor(rng() * 0x20);
    const x = xIsNeg
      ? 0x80 + Math.floor(rng() * 0x80)
      : Math.floor(rng() * 0x20);
    return {
      rotation,
      y,
      x,
      attr: Math.floor(rng() * 0x10000),
      orMask: Math.floor(rng() * 0x10000),
    };
  });
  console.log(
    `  Match: ${okD}/${sizeD} = ${((okD / sizeD) * 100).toFixed(1)}%`,
  );
  totalOk += okD;

  console.log(
    `\n=== TOTALE: ${totalOk}/${total} = ${((totalOk / total) * 100).toFixed(1)}% ===`,
  );
  if (failHolder.value !== null) {
    const { suite, tc, diff, testCase } = failHolder.value;
    console.log(
      `  First fail (suite ${suite} tc=${tc}): ${diff.field}` +
        ` bin=0x${diff.bin.toString(16)} ts=0x${diff.ts.toString(16)}` +
        ` rot=${testCase.rotation} y=0x${testCase.y.toString(16)}` +
        ` x=0x${testCase.x.toString(16)} attr=0x${testCase.attr.toString(16)}` +
        ` orMask=0x${testCase.orMask.toString(16)}`,
    );
  }

  disposeCpu(cpu);
  exit(totalOk === total ? 0 : 1);
}

main().catch((e: unknown) => {
  console.error(e);
  exit(1);
});
