#!/usr/bin/env node
/**
 * test-state-sub-5284-parity.ts — differential FUN_5284 vs stateSub5284.
 *
 *   1. jsr FUN_4DCC (sound chip writer; 1ª istr = `addq.l #1,(0x401FF8).l`)
 *   2. delay loop M68k 6666 iter (no RAM effect)
 *   3. write watchdog (0x880000) — MMIO no-op
 *   4. bsr FUN_52A2 (status check: read 0x401F76 long | 0x401F5E long)
 *   5. bne 0x5284 (loop) | bra.w 0x4F38 (tail-call)
 *
 * Strategia parity:
 *   - Patch ROM: FUN_4DCC ridotta a `addq.l #1,(0x401FF8).l; rts` (8 byte)
 *     to match default TS `defaultFun4DCC` behavior.
 *   - Patch ROM: FUN_4F38 ridotta a `rts` (2 byte) — neutralizza il
 *     tail-call e fa rts pulito al sentinel via stack.
 *   - Pattern test:
 *     * pattern 0..3: zero flags entry -> 1 iter, loop exits, counter +1.
 *       0xFFFFFFFF, etc) per testare wrap of the counter.
 *     * pattern 8..N: random flags = 0, random counter init.
 *
 * sui flag).
 *
 * Uso: npx tsx packages/cli/src/test-state-sub-5284-parity.ts [N]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import {
  state as stateNs,
  stateSub5284 as ssNs,
} from "@marble-love/engine";
import {
  createCpu,
  callFunction,
  pokeMem,
  peekMem,
  disposeCpu,
} from "./binary-oracle-lib.js";

const FUN_5284 = 0x00005284;
const FUN_4DCC = 0x00004dcc;
const FUN_4F38 = 0x00004f38;

const COUNTER_ADDR = 0x00401ff8;
const PRIMARY_ADDR = 0x00401f5e;
const SECONDARY_ADDR = 0x00401f76;

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
  const rom = new Uint8Array(readFileSync(romPath));

  // ── Patch ROM ─────────────────────────────────────────────────────────
  // FUN_4DCC ridotta a `addq.l #1,(0x00401FF8).l; rts`.
  //   addq.l #1,abs.l : opcode 0x52B9, then 4-byte abs addr (0x00401FF8) → 6 byte
  //   rts             : 0x4E75 → 2 byte
  rom[FUN_4DCC + 0] = 0x52;
  rom[FUN_4DCC + 1] = 0xb9;
  rom[FUN_4DCC + 2] = 0x00;
  rom[FUN_4DCC + 3] = 0x40;
  rom[FUN_4DCC + 4] = 0x1f;
  rom[FUN_4DCC + 5] = 0xf8;
  rom[FUN_4DCC + 6] = 0x4e;
  rom[FUN_4DCC + 7] = 0x75;

  // FUN_4F38 ridotta a `rts` (0x4E75). Il tail-call `bra.w 0x4F38` of FUN_5284
  // atterra qui, fa rts immediato → pop sentinel → callFunction completa.
  rom[FUN_4F38 + 0] = 0x4e;
  rom[FUN_4F38 + 1] = 0x75;

  const state = stateNs.emptyGameState();
  const cpu = await createCpu({ rom, state });

  console.log(`\n=== stateSub5284 (FUN_5284) — ${n} cases ===`);

  const rng = makeRng(0xbabe_face);
  let ok = 0;
  let firstFail: {
    i: number;
    initCounter: number;
    binCounter: number;
    tsCounter: number;
    binPrimary: number;
    tsPrimary: number;
    binSecondary: number;
    tsSecondary: number;
  } | null = null;

  for (let i = 0; i < n; i++) {
    cpu.system.setRegister("sp", 0x401f00);

    // Boundary + random:
    //   0: counter=0
    //   3: counter=0x80000000 (sign bit boundary)
    //   4: counter=0x12345678 (random fixed)
    //   >=5: random
    let initCounter: number;
    if (i === 0) initCounter = 0;
    else if (i === 1) initCounter = 0xfffffffe >>> 0;
    else if (i === 2) initCounter = 0xffffffff >>> 0;
    else if (i === 3) initCounter = 0x80000000 >>> 0;
    else if (i === 4) initCounter = 0x12345678 >>> 0;
    else initCounter = Math.floor(rng() * 0x100000000) >>> 0;

    pokeMem(cpu, PRIMARY_ADDR, 4, 0);
    pokeMem(cpu, SECONDARY_ADDR, 4, 0);
    state.workRam[0x1f5e] = 0;
    state.workRam[0x1f5f] = 0;
    state.workRam[0x1f60] = 0;
    state.workRam[0x1f61] = 0;
    state.workRam[0x1f76] = 0;
    state.workRam[0x1f77] = 0;
    state.workRam[0x1f78] = 0;
    state.workRam[0x1f79] = 0;

    // Counter init.
    pokeMem(cpu, COUNTER_ADDR, 4, initCounter);
    state.workRam[0x1ff8] = (initCounter >>> 24) & 0xff;
    state.workRam[0x1ff9] = (initCounter >>> 16) & 0xff;
    state.workRam[0x1ffa] = (initCounter >>> 8) & 0xff;
    state.workRam[0x1ffb] = initCounter & 0xff;

    // Run binary.
    callFunction(cpu, FUN_5284, []);
    const binCounter = peekMem(cpu, COUNTER_ADDR, 4) >>> 0;
    const binPrimary = peekMem(cpu, PRIMARY_ADDR, 4) >>> 0;
    const binSecondary = peekMem(cpu, SECONDARY_ADDR, 4) >>> 0;

    // Run TS.
    ssNs.stateSub5284(state);
    const tsCounter =
      (((state.workRam[0x1ff8] ?? 0) << 24) |
        ((state.workRam[0x1ff9] ?? 0) << 16) |
        ((state.workRam[0x1ffa] ?? 0) << 8) |
        (state.workRam[0x1ffb] ?? 0)) >>>
      0;
    const tsPrimary =
      (((state.workRam[0x1f5e] ?? 0) << 24) |
        ((state.workRam[0x1f5f] ?? 0) << 16) |
        ((state.workRam[0x1f60] ?? 0) << 8) |
        (state.workRam[0x1f61] ?? 0)) >>>
      0;
    const tsSecondary =
      (((state.workRam[0x1f76] ?? 0) << 24) |
        ((state.workRam[0x1f77] ?? 0) << 16) |
        ((state.workRam[0x1f78] ?? 0) << 8) |
        (state.workRam[0x1f79] ?? 0)) >>>
      0;

    const match =
      binCounter === tsCounter &&
      binPrimary === tsPrimary &&
      binSecondary === tsSecondary;
    if (match) {
      ok++;
    } else if (firstFail === null) {
      firstFail = {
        i,
        initCounter,
        binCounter,
        tsCounter,
        binPrimary,
        tsPrimary,
        binSecondary,
        tsSecondary,
      };
    }
  }

  console.log(`  Match: ${ok}/${n} = ${((ok / n) * 100).toFixed(1)}%`);
  if (firstFail) {
    const ff = firstFail;
    console.log(`  First fail @ case ${ff.i}:`);
    console.log(`    initCounter=0x${ff.initCounter.toString(16).padStart(8, "0")}`);
    console.log(
      `    bin: counter=0x${ff.binCounter.toString(16).padStart(8, "0")} primary=0x${ff.binPrimary.toString(16).padStart(8, "0")} secondary=0x${ff.binSecondary.toString(16).padStart(8, "0")}`,
    );
    console.log(
      `    ts : counter=0x${ff.tsCounter.toString(16).padStart(8, "0")} primary=0x${ff.tsPrimary.toString(16).padStart(8, "0")} secondary=0x${ff.tsSecondary.toString(16).padStart(8, "0")}`,
    );
  }

  disposeCpu(cpu);
  exit(ok === n ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  exit(1);
});
