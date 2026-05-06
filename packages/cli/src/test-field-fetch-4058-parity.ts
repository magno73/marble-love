#!/usr/bin/env node
/**
 * test-field-fetch-4058-parity.ts — differential FUN_4058 vs fieldFetch4058.
 *
 * `FUN_00004058` (128 byte): record-field lookup.
 *   - struct base = `*0x401FFC + 0x50`
 *   - record size = 20 byte
 *   - max records = `(int8)ROM[0x1006F] sign-ext-long & 7` (per marble = 3)
 *   - ritorna -1 se arg2 > 0x12, -2 se arg1 >= max, byte/word del record
 *
 * Convenzione caller (cdecl push-RTL):
 *   - arg1 = SP+0x14 = record index (long, sign-ext'd da word dal caller)
 *   - arg2 = SP+0x18 = byte offset (long, sign-ext'd da word dal caller)
 *
 * Strategia parity:
 *   - Setup: workRam[0x1FFC..] = ptr (long BE, dentro range workRam-safe);
 *     popola alcuni byte random ai vari record_base+offset; scrivi byte ROM
 *     reale in Musashi (da `ghidra_project/marble_program.bin`); per il TS
 *     usa la stessa ROM letta dallo stesso file (passata come byte param).
 *   - Per ogni caso random: setup arg1, arg2; chiama il binario; chiama TS;
 *     confronta D0.
 *
 * Pattern coverage:
 *   - 30% arg1 in [0..7], arg2 in [0..0x12]   -> path #3 (byte) o #4 (word)
 *   - 25% arg2 > 0x12                          -> path #1 (-1)
 *   - 25% arg1 in [0..0xFF]                    -> mix di #2 e #3/#4
 *   - 10% arg1 sign-ext negativo               -> stress #2
 *   - 10% full random long                     -> stress generale
 *
 * Uso: npx tsx packages/cli/src/test-field-fetch-4058-parity.ts [N=500]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import {
  state as stateNs,
  fieldFetch4058 as ffNs,
} from "@marble-love/engine";
import {
  createCpu,
  callFunction,
  pokeMem,
  disposeCpu,
} from "./binary-oracle-lib.js";

const FUN_4058 = 0x00004058;
const PTR_FFC = 0x00401ffc;

/** Indirizzo fissato della struct base nel test (workRam-safe). */
const PTR_VAL = 0x00401a00;
const STRUCT_BASE = PTR_VAL + 0x50; // 0x401A50

/** Numero di record che popoliamo con dati. Copre arg1 0..7. */
const NUM_RECORDS = 8;
/** Byte per record che popoliamo. Copre arg2 0..0x13 (0x14 byte = 20 byte). */
const RECORD_BYTES = 20;

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
  arg2: number;
  romByte: number;
  binD0: number;
  tsD0: number;
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

  // Costante ROM @ 0x1006F. Per marble = 0xE3 -> D4 = 3.
  // La passiamo al TS come byte raw (il modulo applica & 7 internamente).
  const romByteReal = rom[0x1006f] ?? 0;

  console.log(
    `\n=== fieldFetch4058 (FUN_4058) — ${n} casi (ROM[0x1006F]=0x${romByteReal.toString(16)}) ===`,
  );

  const rng = makeRng(0x40584058);
  let ok = 0;
  let firstFail: FailRecord | null = null;

  for (let i = 0; i < n; i++) {
    cpu.system.setRegister("sp", 0x401f00);

    // ── Setup struct: scrivi NUM_RECORDS record × RECORD_BYTES byte random.
    // Stesso contenuto su Musashi e su state.workRam.
    for (let r = 0; r < NUM_RECORDS; r++) {
      for (let b = 0; b < RECORD_BYTES; b++) {
        const byte = Math.floor(rng() * 256);
        const addr = STRUCT_BASE + r * RECORD_BYTES + b;
        pokeMem(cpu, addr, 1, byte);
        state.workRam[addr - 0x400000] = byte;
      }
    }

    // ── Setup ptr @ 0x401FFC (long BE).
    pokeMem(cpu, PTR_FFC, 4, PTR_VAL);
    state.workRam[0x1ffc] = (PTR_VAL >>> 24) & 0xff;
    state.workRam[0x1ffd] = (PTR_VAL >>> 16) & 0xff;
    state.workRam[0x1ffe] = (PTR_VAL >>> 8) & 0xff;
    state.workRam[0x1fff] = PTR_VAL & 0xff;

    // ── Pattern selection per arg1, arg2.
    const pick = rng();
    let pattern: "valid" | "offset_oor" | "mixed" | "neg_arg1" | "random";
    let arg1: number;
    let arg2: number;
    if (pick < 0.3) {
      pattern = "valid";
      arg1 = Math.floor(rng() * 8); // 0..7
      arg2 = Math.floor(rng() * 0x13); // 0..0x12
    } else if (pick < 0.55) {
      pattern = "offset_oor";
      arg1 = Math.floor(rng() * 0x100);
      // arg2 > 0x12 (sign-ext da word -> nel range word valido).
      arg2 = (0x13 + Math.floor(rng() * 0xeed)) & 0xffff;
    } else if (pick < 0.8) {
      pattern = "mixed";
      arg1 = Math.floor(rng() * 0x100);
      arg2 = Math.floor(rng() * 0x14);
    } else if (pick < 0.9) {
      pattern = "neg_arg1";
      // sign-ext di word negativo: 0xFFFFxxxx con xxxx in [0x8000..0xFFFF].
      const w = 0x8000 + Math.floor(rng() * 0x8000);
      arg1 = ((w & 0x8000 ? 0xffff0000 : 0) | w) >>> 0;
      arg2 = Math.floor(rng() * 0x14);
    } else {
      pattern = "random";
      // arg1, arg2 long full random (caller binario passa sempre sign-ext da
      // word, quindi alto = 0 oppure 0xFFFF; qui stress-test allargato a long).
      const a1w = Math.floor(rng() * 0x10000);
      const a1h = rng() < 0.5 ? 0 : a1w & 0x8000 ? 0xffff : 0;
      arg1 = (((a1h << 16) >>> 0) | a1w) >>> 0;
      const a2w = Math.floor(rng() * 0x10000);
      const a2h = rng() < 0.5 ? 0 : a2w & 0x8000 ? 0xffff : 0;
      arg2 = (((a2h << 16) >>> 0) | a2w) >>> 0;
    }

    // ── Run binary (2 long args, push-RTL: arg2 first, arg1 second/top).
    // callFunction prende args in ordine logico (arg1, arg2): l'helper li
    // pusha right-to-left come da convenzione cdecl.
    const r = callFunction(cpu, FUN_4058, [arg1, arg2]);
    const binD0 = r.d0 >>> 0;

    // ── Run TS.
    const tsD0 = ffNs.fieldFetch4058(state, arg1, arg2, romByteReal) >>> 0;

    if (binD0 === tsD0) {
      ok++;
    } else if (firstFail === null) {
      firstFail = {
        i,
        pattern,
        arg1,
        arg2,
        romByte: romByteReal,
        binD0,
        tsD0,
      };
    }
  }

  console.log(`  Match: ${ok}/${n} = ${((ok / n) * 100).toFixed(1)}%`);
  if (firstFail) {
    const f = firstFail;
    console.log(`  First fail @ case ${f.i} (pattern=${f.pattern}):`);
    console.log(
      `    arg1=0x${f.arg1.toString(16)} arg2=0x${f.arg2.toString(16)} romByte=0x${f.romByte.toString(16)}`,
    );
    console.log(
      `    bin: D0=0x${f.binD0.toString(16).padStart(8, "0")}`,
    );
    console.log(
      `    ts : D0=0x${f.tsD0.toString(16).padStart(8, "0")}`,
    );
  }

  disposeCpu(cpu);
  exit(ok === n ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  exit(1);
});
