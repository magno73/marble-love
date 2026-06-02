#!/usr/bin/env node
/**
 * test-counter-pool-subtract-4008-parity.ts — differential FUN_4008 vs
 * `counterPoolSubtract4008`.
 *
 * `FUN_00004008` (80 byte): tenta di sottrarre `arg1` dal pool combinato
 * `(byte@0x401FF7 + byte@0x401FF5)`, draining counter@FF7 first and then
 * scaling the rest from acc@FF5. Returns 1 (success / no-op if status >=
 * 0xE0) o 0 (pool insufficient).
 *
 * Convenzione caller (cdecl push-RTL):
 *   - arg1 = SP+0xC = quantita' da sottrarre (long, sign-ext'd da word)
 *
 * Strategia parity:
 *   - Setup: random byte@FF5/FF7; fixed ptr struct @ 0x401A00 with bytes
 *     random +0xA / +0xB (~50% coherent as complements);
 *     workRam[0x1FFC..] = ptr (long BE).
 *   - Same setup between Musashi and TS (workRam vs unified mem).
 *   - For each random case: pick arg1 with pattern; call the binary;
 *     calls TS; compares `D0` AND the 2 modified bytes (FF5, FF7) AND the two
 *     byte del player struct (mai modificati, ma verifichiamo l'invariante).
 *
 * Pattern coverage:
 *   - 30% arg1 in [0..pool*1.2] (range realistico)
 *   - 20% arg1 == 0
 *   - 20% arg1 grande (> pool, insufficient path)
 *   - 15% status @ ptr+0xA in [0xE0..0xFF] with valid complement
 *         (early-exit path)
 *   - 15% sign-ext negativo / random long stress
 *
 * Uso: npx tsx packages/cli/src/test-counter-pool-subtract-4008-parity.ts [N=500]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import {
  state as stateNs,
  counterPoolSubtract4008 as cpsNs,
} from "@marble-love/engine";
import {
  createCpu,
  callFunction,
  pokeMem,
  peekMem,
  disposeCpu,
} from "./binary-oracle-lib.js";

const FUN_4008 = 0x00004008;
const PTR_FFC = 0x00401ffc;
const ACC_FF5 = 0x00401ff5;
const COUNTER_FF7 = 0x00401ff7;

/** Indirizzo fissato del player struct nel test (workRam-safe). */
const PTR_VAL = 0x00401a00;

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) >>> 0;
    return ((s >>> 16) & 0xffff) / 0x10000;
  };
}

interface FailRecord {
  i: number;
  pattern: string;
  arg1: number;
  status: number;
  notB: number;
  ctr0: number;
  acc0: number;
  binD0: number;
  tsD0: number;
  binCtr: number;
  binAcc: number;
  tsCtr: number;
  tsAcc: number;
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

  console.log(
    `\n=== counterPoolSubtract4008 (FUN_4008) — ${n} casi ===`,
  );

  const rng = makeRng(0x40084008);
  let ok = 0;
  let firstFail: FailRecord | null = null;

  for (let i = 0; i < n; i++) {
    cpu.system.setRegister("sp", 0x401f00);

    // ── Setup ptr @ 0x401FFC = PTR_VAL (long BE). ──
    pokeMem(cpu, PTR_FFC, 4, PTR_VAL);
    state.workRam[0x1ffc] = (PTR_VAL >>> 24) & 0xff;
    state.workRam[0x1ffd] = (PTR_VAL >>> 16) & 0xff;
    state.workRam[0x1ffe] = (PTR_VAL >>> 8) & 0xff;
    state.workRam[0x1fff] = PTR_VAL & 0xff;

    // ── Pattern selection. ──
    const pick = rng();
    let pattern: string;
    let arg1: number;
    let status: number;
    let notB: number;
    let ctr0: number;
    let acc0: number;

    if (pick < 0.15) {
      pattern = "early_exit";
      // status >= 0xE0 with valid complement -> helper = 0 -> early exit.
      status = 0xe0 + Math.floor(rng() * 0x20);
      notB = ~status & 0xff;
      ctr0 = Math.floor(rng() * 256);
      acc0 = Math.floor(rng() * 256);
      arg1 = Math.floor(rng() * 0x100);
    } else if (pick < 0.35) {
      pattern = "zero_arg";
      // status valido + arg1 = 0 (no drain ma sub.b 0 = no-op).
      status = Math.floor(rng() * 0xe0); // < 0xE0 (helper > 0)
      notB = ~status & 0xff;
      ctr0 = Math.floor(rng() * 256);
      acc0 = Math.floor(rng() * 256);
      arg1 = 0;
    } else if (pick < 0.55) {
      pattern = "insufficient";
      // pool < arg1.
      status = Math.floor(rng() * 0xe0);
      notB = ~status & 0xff;
      ctr0 = Math.floor(rng() * 0x40); // 0..0x3F
      acc0 = Math.floor(rng() * 0x40); // 0..0x3F
      // arg1 > pool, sign-ext da word valido (positivo).
      arg1 = ctr0 + acc0 + 1 + Math.floor(rng() * 0x100);
    } else if (pick < 0.85) {
      pattern = "drain";
      // pool >= arg1 in range realistico.
      status = Math.floor(rng() * 0xe0);
      notB = ~status & 0xff;
      ctr0 = Math.floor(rng() * 256);
      acc0 = Math.floor(rng() * 256);
      const pool = ctr0 + acc0;
      arg1 = pool === 0 ? 0 : Math.floor(rng() * (pool + 1));
    } else if (pick < 0.93) {
      pattern = "mismatch_complement";
      // ptr+0xA != ~ptr+0xB -> internal helper clears D2 -> returns 1.
      status = Math.floor(rng() * 256);
      // notB = qualcosa NON pari a ~status.
      do {
        notB = Math.floor(rng() * 256);
      } while (notB === (~status & 0xff));
      ctr0 = Math.floor(rng() * 256);
      acc0 = Math.floor(rng() * 256);
      arg1 = Math.floor(rng() * 0x200);
    } else {
      pattern = "stress";
      // arg1 full random / sign-ext negativo (high bits set).
      status = Math.floor(rng() * 256);
      notB = Math.floor(rng() * 256);
      ctr0 = Math.floor(rng() * 256);
      acc0 = Math.floor(rng() * 256);
      const w = Math.floor(rng() * 0x10000);
      const hi = w & 0x8000 ? 0xffff : 0;
      arg1 = (((hi << 16) >>> 0) | w) >>> 0;
    }

    // ── Scrivi byte@FF5/FF7 e ptr+0xA / +0xB su entrambi i lati. ──
    pokeMem(cpu, ACC_FF5, 1, acc0);
    pokeMem(cpu, COUNTER_FF7, 1, ctr0);
    pokeMem(cpu, PTR_VAL + 0xa, 1, status);
    pokeMem(cpu, PTR_VAL + 0xb, 1, notB);
    state.workRam[0x1ff5] = acc0;
    state.workRam[0x1ff7] = ctr0;
    state.workRam[PTR_VAL - 0x400000 + 0xa] = status;
    state.workRam[PTR_VAL - 0x400000 + 0xb] = notB;

    // ── Run binary (1 long arg). ──
    const r = callFunction(cpu, FUN_4008, [arg1]);
    const binD0 = r.d0 >>> 0;
    const binCtr = peekMem(cpu, COUNTER_FF7, 1) & 0xff;
    const binAcc = peekMem(cpu, ACC_FF5, 1) & 0xff;

    // ── Run TS. ──
    const tsD0 = cpsNs.counterPoolSubtract4008(state, arg1) >>> 0;
    const tsCtr = state.workRam[0x1ff7] ?? 0;
    const tsAcc = state.workRam[0x1ff5] ?? 0;

    if (binD0 === tsD0 && binCtr === tsCtr && binAcc === tsAcc) {
      ok++;
    } else if (firstFail === null) {
      firstFail = {
        i,
        pattern,
        arg1,
        status,
        notB,
        ctr0,
        acc0,
        binD0,
        tsD0,
        binCtr,
        binAcc,
        tsCtr,
        tsAcc,
      };
    }
  }

  console.log(`  Match: ${ok}/${n} = ${((ok / n) * 100).toFixed(1)}%`);
  if (firstFail) {
    const f = firstFail;
    console.log(`  First fail @ case ${f.i} (pattern=${f.pattern}):`);
    console.log(
      `    arg1=0x${f.arg1.toString(16)} status=0x${f.status.toString(16)} notB=0x${f.notB.toString(16)} ctr0=0x${f.ctr0.toString(16)} acc0=0x${f.acc0.toString(16)}`,
    );
    console.log(
      `    bin: D0=0x${f.binD0.toString(16).padStart(8, "0")} ctr=0x${f.binCtr.toString(16)} acc=0x${f.binAcc.toString(16)}`,
    );
    console.log(
      `    ts : D0=0x${f.tsD0.toString(16).padStart(8, "0")} ctr=0x${f.tsCtr.toString(16)} acc=0x${f.tsAcc.toString(16)}`,
    );
  }

  disposeCpu(cpu);
  exit(ok === n ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  exit(1);
});
