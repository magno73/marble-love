#!/usr/bin/env node
/**
 * test-state-sub-535e-parity.ts — differential FUN_535E vs stateSub535E.
 *
 * `FUN_0000535E` è una trampoline a 3 argomenti che legge i due byte globali
 * `0x401F98` e `0x401F99`, li sign-extende a long M68k, e li passa con
 * l'argomento del caller a `FUN_00005388`.
 *
 * Strategia del parity test:
 *   - Per ogni caso settiamo `arg` (long) sullo stack come unico parametro
 *     del caller, prima della jsr a 0x535E.
 *   - Settiamo `(0x401F98).b` e `(0x401F99).b` con valori variabili (boundary
 *     0x00/0x7F/0x80/0xFF + random).
 *   - Cattura: settiamo PC = 0x535E, eseguiamo finché PC == 0x5388 (entry
 *     point del callee), poi leggiamo i 3 long sullo stack `(0x4..0xC,SP)`
 *     visti dal callee.
 *   - Confrontiamo `(byte98_seen, byte99_seen, arg_seen)` col valore TS via
 *     stub `inner` che cattura gli stessi 3 parametri.
 *
 * Uso: npx tsx packages/cli/src/test-state-sub-535e-parity.ts [N]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import {
  state as stateNs,
  stateSub535E as subNs,
} from "@marble-love/engine";
import {
  createCpu,
  disposeCpu,
  pokeMem,
  peekMem,
} from "./binary-oracle-lib.js";

const FUN_535E = 0x0000535e;
const FUN_5388 = 0x00005388;
const SENTINEL_RET = 0xcafebabe >>> 0;

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) >>> 0;
    return ((s >>> 16) & 0xffff) / 0x10000;
  };
}

interface Captured {
  byte98: number;
  byte99: number;
  arg: number;
}

function captureEnter5388Args(
  cpu: Awaited<ReturnType<typeof createCpu>>,
  arg: number,
  byte98: number,
  byte99: number,
): Captured {
  const sys = cpu.system;

  // Setup globals.
  pokeMem(cpu, 0x00401f98, 1, byte98 & 0xff);
  pokeMem(cpu, 0x00401f99, 1, byte99 & 0xff);

  // Stack: SP iniziale → push arg long → push sentinel ret addr.
  const sp0 = 0x401f00;
  let sp = sp0;
  sp = (sp - 4) >>> 0;
  sys.write(sp, 4, arg >>> 0); // arg @ (0x4, SP) per FUN_535E
  sp = (sp - 4) >>> 0;
  sys.write(sp, 4, SENTINEL_RET);

  sys.setRegister("sp", sp);
  sys.setRegister("pc", FUN_535E);

  // Step finché PC == 0x5388 (entrato nel callee). Limite generoso (la
  // trampoline è ~12 istruzioni → < 50 step).
  let reached = false;
  for (let i = 0; i < 200; i++) {
    if (sys.getRegisters().pc === FUN_5388) {
      reached = true;
      break;
    }
    if (sys.getRegisters().pc === SENTINEL_RET) break;
    sys.step();
  }

  if (!reached) {
    return { byte98: -1, byte99: -1, arg: -1 };
  }

  // FUN_5388 entry: stack = [ret_to_535E_post_jsr, byte98_long, byte99_long, arg_long, ...].
  const spNow = sys.getRegisters().sp;
  const seenByte98 = peekMem(cpu, spNow + 4, 4) >>> 0;
  const seenByte99 = peekMem(cpu, spNow + 8, 4) >>> 0;
  const seenArg = peekMem(cpu, spNow + 12, 4) >>> 0;
  return { byte98: seenByte98, byte99: seenByte99, arg: seenArg };
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

  console.log(`\n=== stateSub535E (FUN_535E) — ${n} casi ===`);

  const rng = makeRng(0xfeedface);
  let ok = 0;
  let firstFail: {
    i: number;
    arg: number;
    b98: number;
    b99: number;
    binB98: number;
    binB99: number;
    binArg: number;
    tsB98: number;
    tsB99: number;
    tsArg: number;
  } | null = null;

  for (let i = 0; i < n; i++) {
    // Boundary cases prima del random fuzz:
    //   0: tutti zero
    //   1: byte 0x7F (positivo max)
    //   2: byte 0x80 (negativo min, sign-extend critico)
    //   3: byte 0xFF (sign-extend → 0xFFFFFFFF)
    //   4: arg = 0
    //   5: arg = 0xFFFFFFFF (max unsigned)
    //   6: byte98=0x80, byte99=0x7F (sign mix)
    //   7: byte98=0x01, byte99=0xFE
    //   >=8: random
    let arg: number;
    let b98: number;
    let b99: number;
    if (i === 0) {
      arg = 0; b98 = 0x00; b99 = 0x00;
    } else if (i === 1) {
      arg = 0x12345678; b98 = 0x7f; b99 = 0x7f;
    } else if (i === 2) {
      arg = 0x12345678; b98 = 0x80; b99 = 0x80;
    } else if (i === 3) {
      arg = 0xdeadbeef; b98 = 0xff; b99 = 0xff;
    } else if (i === 4) {
      arg = 0; b98 = 0xab; b99 = 0xcd;
    } else if (i === 5) {
      arg = 0xffffffff; b98 = 0x42; b99 = 0x55;
    } else if (i === 6) {
      arg = 0xcafebabe; b98 = 0x80; b99 = 0x7f;
    } else if (i === 7) {
      arg = 0x10203040; b98 = 0x01; b99 = 0xfe;
    } else {
      arg = Math.floor(rng() * 0x100000000) >>> 0;
      b98 = Math.floor(rng() * 0x100) & 0xff;
      b99 = Math.floor(rng() * 0x100) & 0xff;
    }

    // Sync TS state con i byte globali in workRam.
    state.workRam[0x1f98] = b98 & 0xff;
    state.workRam[0x1f99] = b99 & 0xff;

    // Cattura args che FUN_5388 riceve.
    const bin = captureEnter5388Args(cpu, arg, b98, b99);

    // Cattura args che l'inner TS riceve.
    let tsB98 = -1;
    let tsB99 = -1;
    let tsArg = -1;
    subNs.stateSub535E(state, arg, (a, b, c) => {
      tsB98 = a;
      tsB99 = b;
      tsArg = c;
      return 0;
    });

    const match =
      bin.byte98 === tsB98 &&
      bin.byte99 === tsB99 &&
      bin.arg === tsArg &&
      bin.byte98 !== -1; // -1 = capture failure
    if (match) {
      ok++;
    } else if (firstFail === null) {
      firstFail = {
        i,
        arg,
        b98,
        b99,
        binB98: bin.byte98,
        binB99: bin.byte99,
        binArg: bin.arg,
        tsB98,
        tsB99,
        tsArg,
      };
    }
  }

  console.log(`  Match: ${ok}/${n} = ${((ok / n) * 100).toFixed(1)}%`);
  if (firstFail) {
    console.log(`  First fail @ case ${firstFail.i}:`);
    console.log(
      `    inputs: arg=0x${firstFail.arg.toString(16)} b98=0x${firstFail.b98.toString(16)} b99=0x${firstFail.b99.toString(16)}`,
    );
    console.log(
      `    bin: b98=0x${firstFail.binB98.toString(16)} b99=0x${firstFail.binB99.toString(16)} arg=0x${firstFail.binArg.toString(16)}`,
    );
    console.log(
      `    ts : b98=0x${firstFail.tsB98.toString(16)} b99=0x${firstFail.tsB99.toString(16)} arg=0x${firstFail.tsArg.toString(16)}`,
    );
  }

  disposeCpu(cpu);
  exit(ok === n ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  exit(1);
});
