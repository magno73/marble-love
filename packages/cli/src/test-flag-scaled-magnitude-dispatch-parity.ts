#!/usr/bin/env node
/**
 * test-flag-scaled-magnitude-dispatch-parity.ts —
 * differential FUN_26196 vs `flagScaledMagnitudeDispatch`.
 *
 * **Strategia**:
 *
 * Per testare in isolamento la logica of selezione, **patch-iamo
 *
 *     20 2F 00 08    ; move.l (8,SP), D0   ; D0 = magnitude
 *     4E 75          ; rts
 *
 * compare it with `magnitude` computed by TS via callback.
 *
 * preserved** by the shim (no clobber/no truncation between `jsr` and `rts`).
 *
 * `pokeMem` a 0x261BC, poi resettiamo the stack pointer ed eseguiamo).
 *
 * Uso: npx tsx packages/cli/src/test-flag-scaled-magnitude-dispatch-parity.ts [N]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import {
  state as stateNs,
  flagScaledMagnitudeDispatch as fsmdNs,
} from "@marble-love/engine";
import {
  createCpu,
  callFunction,
  pokeMem,
  disposeCpu,
} from "./binary-oracle-lib.js";

const FUN_26196 = 0x00026196;
const FUN_261BC = 0x000261bc;

/** Stub bytes per `FUN_261BC`: `move.l (8,SP),D0` ; `rts`. */
const STUB_BYTES = [0x20, 0x2f, 0x00, 0x08, 0x4e, 0x75] as const;

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

  // created by binary-oracle-lib ("rom" region 0x000000-0x07FFFF), but the
  for (let i = 0; i < STUB_BYTES.length; i++) {
    pokeMem(cpu, FUN_261BC + i, 1, STUB_BYTES[i]!);
  }

  console.log(
    `\n=== flagScaledMagnitudeDispatch (FUN_26196) — ${n} cases ===`,
  );
  console.log(
    `  (FUN_261BC patched in-memory con stub move.l (8,SP),D0;rts)`,
  );

  const rng = makeRng(0xb16fa6);
  let ok = 0;
  let firstFail: {
    i: number;
    structPtr: number;
    flagByte: number;
    binD0: number;
    tsD0: number;
    tsMagnitudeCaptured: number;
  } | null = null;

  // Pointer choices: representative addresses in work RAM (0x400000..0x401FFF),
  // mixing the canonical object slot with other locations.
  const ptrChoices = [
    0x00400018, 0x004000fa, 0x00401e00, 0x00401e80, 0x00401f08,
    0x00401f44, 0x00401f80, 0x00400100, 0x004001a0, 0x00400500,
  ];

  for (let i = 0; i < n; i++) {
    cpu.system.setRegister("sp", 0x401f00);

    // Ri-applica patch on each iter — Musashi NOT should modificarla
    // (ROM zone), but alcuni test paranoid riapplicano per safety.
    if (i % 100 === 0) {
      for (let k = 0; k < STUB_BYTES.length; k++) {
        pokeMem(cpu, FUN_261BC + k, 1, STUB_BYTES[k]!);
      }
    }

    // Choose pointer and flag byte. Pattern mix:
    //   pattern 0 : flag = 0 (path "magnitude piccola")
    //   pattern 1 : flag = 0xFF (path "magnitude grande", saturato)
    //   pattern >=4: random
    let flagByte: number;
    const pattern = i < 4 ? i : Math.floor(rng() * 5) + 4;
    switch (pattern) {
      case 0: flagByte = 0x00; break;
      case 1: flagByte = 0xff; break;
      case 2: flagByte = 0x80; break;
      case 3: flagByte = 0x01; break;
      default: flagByte = Math.floor(rng() * 256) & 0xff; break;
    }

    const ptrIdx = Math.floor(rng() * ptrChoices.length);
    const structPtr = ptrChoices[ptrIdx]!;

    const offBase = structPtr - 0x400000;
    pokeMem(cpu, structPtr + 0x1a, 1, flagByte);
    state.workRam[offBase + 0x1a] = flagByte;

    // FUN_26196 takes one long arg (structPtr) on the stack at (4,SP).
    const r = callFunction(cpu, FUN_26196, [structPtr >>> 0]);
    const binD0 = r.d0 >>> 0;

    // ── Run TS ──────────────────────────────────────────────────────────
    let tsMagnitudeCaptured = -1;
    const tsD0 = fsmdNs.flagScaledMagnitudeDispatch(
      state,
      structPtr,
      (_p, m) => {
        tsMagnitudeCaptured = m >>> 0;
        return m >>> 0;
      },
    );

    const expectedMag =
      flagByte !== 0 ? 0x50000 : 0x40000;

    const match =
      binD0 === tsD0 &&
      binD0 === expectedMag &&
      tsMagnitudeCaptured === expectedMag;

    if (match) {
      ok++;
    } else if (firstFail === null) {
      firstFail = {
        i,
        structPtr,
        flagByte,
        binD0,
        tsD0,
        tsMagnitudeCaptured,
      };
    }
  }

  console.log(`  Match: ${ok}/${n} = ${((ok / n) * 100).toFixed(1)}%`);
  if (firstFail) {
    console.log(`  First fail @ case ${firstFail.i}:`);
    console.log(
      `    inputs: structPtr=0x${firstFail.structPtr.toString(16)} flagByte=0x${firstFail.flagByte.toString(16)}`,
    );
    console.log(
      `    bin: D0=0x${firstFail.binD0.toString(16)}`,
    );
    console.log(
      `    ts : D0=0x${firstFail.tsD0.toString(16)} magnitudeCaptured=0x${firstFail.tsMagnitudeCaptured.toString(16)}`,
    );
  }

  disposeCpu(cpu);
  exit(ok === n ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  exit(1);
});
