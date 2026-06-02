#!/usr/bin/env node
/**
 * test-object-enter-1281c-parity.ts —
 * differential FUN_1281C vs `objectEnter1281C`.
 *
 * **Strategy**:
 * `(0x1C,A0)`, (2) gate range -16 < D1w < 256 on the word a `(0x20,A0)`, (3)
 *
 * To test the shim logic in isolation, we **patch
 * on the stack (= `mode` chosen by the shim):
 *
 *     20 2F 00 08    ; move.l (8,SP), D0   ; D0 = mode
 *     4E 75          ; rts
 *
 * `D0 = 0xFFFFFFF0` (path out-of-range — `moveq #-0x10,D0` survives).
 *
 *   - D0 (long, mode 0/1 or 0xFFFFFFF0)
 *   - absence of spurious writes to other standard record offsets.
 *
 * Pattern coverage (500 iter):
 *   - Pattern 6 : structPtr = 0x400018 (singleton A, in-range)
 *   - Pattern 7 : structPtr = 0x4000FA (singleton B, in-range)
 *   - Pattern >=8 : random mix (range word random, ptr random)
 *
 *
 * Usage: npx tsx packages/cli/src/test-object-enter-1281c-parity.ts [N]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import {
  state as stateNs,
  objectEnter1281C as oe1281cNs,
} from "@marble-love/engine";
import {
  createCpu,
  callFunction,
  pokeMem,
  peekMem,
  disposeCpu,
} from "./binary-oracle-lib.js";

const FUN_1281C = 0x0001281c;
const FUN_264AA = 0x000264aa;

/** Stub bytes per `FUN_264AA`: `move.l (8,SP),D0` ; `rts`. */
const STUB_BYTES = [0x20, 0x2f, 0x00, 0x08, 0x4e, 0x75] as const;

/** Slot pointers candidates (work RAM): mix between singletons and generic ones. */
const PTR_CHOICES = [
  0x00400018, // SINGLETON_SLOT_A
  0x004000fa, // SINGLETON_SLOT_B
  0x00400500,
  0x004007a0,
  0x00400a9c,
  0x00401000,
  0x00401500,
  0x00401e00,
] as const;

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

  for (let i = 0; i < STUB_BYTES.length; i++) {
    pokeMem(cpu, FUN_264AA + i, 1, STUB_BYTES[i]!);
  }

  console.log(`\n=== objectEnter1281C (FUN_0001281C) — ${n} cases ===`);
  console.log(`  (FUN_264AA patched in-memory with stub move.l (8,SP),D0;rts)`);

  const rng = makeRng(0x1281c);
  let ok = 0;
  let firstFail: {
    i: number;
    structPtr: number;
    rangeWord: number;
    binD0: number;
    tsD0: number;
    binStatus: number;
    tsStatus: number;
  } | null = null;

  for (let i = 0; i < n; i++) {
    cpu.system.setRegister("sp", 0x401f00);

    // Re-apply patch every 100 iterations for safety.
    if (i % 100 === 0) {
      for (let k = 0; k < STUB_BYTES.length; k++) {
        pokeMem(cpu, FUN_264AA + k, 1, STUB_BYTES[k]!);
      }
    }

    // Pattern selection.
    let rangeSigned: number;
    let structPtr: number;
    const pattern = i < 8 ? i : Math.floor(rng() * 9) + 8;
    switch (pattern) {
      case 0:
        rangeSigned = -100;
        structPtr = PTR_CHOICES[Math.floor(rng() * PTR_CHOICES.length)]!;
        break;
      case 1:
        rangeSigned = -16;
        structPtr = PTR_CHOICES[Math.floor(rng() * PTR_CHOICES.length)]!;
        break;
      case 2:
        rangeSigned = -15;
        structPtr = PTR_CHOICES[Math.floor(rng() * PTR_CHOICES.length)]!;
        break;
      case 3:
        rangeSigned = 255;
        structPtr = PTR_CHOICES[Math.floor(rng() * PTR_CHOICES.length)]!;
        break;
      case 4:
        rangeSigned = 256;
        structPtr = PTR_CHOICES[Math.floor(rng() * PTR_CHOICES.length)]!;
        break;
      case 5:
        rangeSigned = 1000;
        structPtr = PTR_CHOICES[Math.floor(rng() * PTR_CHOICES.length)]!;
        break;
      case 6:
        rangeSigned = Math.floor(rng() * 270) - 15; // [-15, 255], in-range
        structPtr = 0x00400018;
        break;
      case 7:
        rangeSigned = Math.floor(rng() * 270) - 15;
        structPtr = 0x004000fa;
        break;
      default: {
        // Random mix: 16-bit signed full range.
        rangeSigned = Math.floor(rng() * 0x10000) - 0x8000;
        structPtr = PTR_CHOICES[Math.floor(rng() * PTR_CHOICES.length)]!;
        break;
      }
    }

    const rangeWord = rangeSigned & 0xffff;

    // Pre-populate status byte with a non-zero sentinel to demonstrate clr.b.
    const sentinel = 0xa5;
    pokeMem(cpu, structPtr + 0x1c, 1, sentinel);
    state.workRam[(structPtr - 0x400000) + 0x1c] = sentinel;

    // Setup range word @ struct+0x20 (big-endian m68k).
    pokeMem(cpu, structPtr + 0x20, 1, (rangeWord >>> 8) & 0xff);
    pokeMem(cpu, structPtr + 0x21, 1, rangeWord & 0xff);
    state.workRam[(structPtr - 0x400000) + 0x20] = (rangeWord >>> 8) & 0xff;
    state.workRam[(structPtr - 0x400000) + 0x21] = rangeWord & 0xff;

    const r = callFunction(cpu, FUN_1281C, [structPtr >>> 0]);
    const binD0 = r.d0 >>> 0;
    const binStatus = peekMem(cpu, structPtr + 0x1c, 1) & 0xff;

    // ── Run TS ──────────────────────────────────────────────────────────
    let tsCapturedMode = -1;
    let tsCapturedPtr = -1;
    let innerCalls = 0;
    const tsD0 =
      oe1281cNs.objectEnter1281C(state, structPtr, (p, m) => {
        innerCalls++;
        tsCapturedPtr = p >>> 0;
        tsCapturedMode = m >>> 0;
        return m >>> 0;
      }) >>> 0;
    const tsStatus = state.workRam[(structPtr - 0x400000) + 0x1c] ?? 0;

    const inRange = rangeSigned > -16 && rangeSigned < 256;
    const expectedMode =
      structPtr === 0x00400018 || structPtr === 0x004000fa ? 0 : 1;
    const expectedD0 = inRange
      ? (expectedMode >>> 0)
      : (oe1281cNs.OUT_OF_RANGE_D0 >>> 0);
    const expectedStatus = inRange ? 1 : 0;

    let match = binD0 === tsD0 && binD0 === expectedD0;
    match = match && binStatus === tsStatus && binStatus === expectedStatus;
    if (inRange) {
      match =
        match &&
        innerCalls === 1 &&
        tsCapturedPtr === structPtr &&
        tsCapturedMode === expectedMode;
    } else {
      match = match && innerCalls === 0;
    }

    if (match) {
      ok++;
    } else if (firstFail === null) {
      firstFail = {
        i,
        structPtr,
        rangeWord,
        binD0,
        tsD0,
        binStatus,
        tsStatus,
      };
    }
  }

  console.log(`  Match: ${ok}/${n} = ${((ok / n) * 100).toFixed(1)}%`);
  if (firstFail) {
    console.log(`  First fail @ case ${firstFail.i}:`);
    console.log(
      `    inputs: structPtr=0x${firstFail.structPtr.toString(16)} rangeWord=0x${firstFail.rangeWord.toString(16)}`,
    );
    console.log(
      `    bin: D0=0x${firstFail.binD0.toString(16)} status=0x${firstFail.binStatus.toString(16)}`,
    );
    console.log(
      `    ts : D0=0x${firstFail.tsD0.toString(16)} status=0x${firstFail.tsStatus.toString(16)}`,
    );
  }

  disposeCpu(cpu);
  exit(ok === n ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  exit(1);
});
