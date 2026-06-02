#!/usr/bin/env node
/**
 * test-eeprom-commit-parity.ts — differential FUN_3F78 vs eepromCommit (TS).
 *
 * `FUN_00003F78` (78 bytes) is called through thunk 0x160 from mainTick. Despite
 * the name "EEPROM commit", it touches no MMIO and no EEPROM: it reads `*0x401FFC`
 * (player struct ptr), valida lo status byte @ ptr+0xA contro il complement
 * @ ptr+0xB, e droppa/scala i contatori sound dispatch a `0x401FF5` / `0x401FF7`.
 *
 * Confronto:
 *   - return D0 (long)
 *   - byte @ 0x401FF5 (acc accumulator, clampato a 0x19 in the path "work")
 *   - byte @ 0x401FF7 (drain counter)
 *
 * Setup for each random case:
 *   - *0x401FFC = a2Addr (ptr struct), workRam-safe (0x401D00, not used by detail tests)
 *   - bytes @ a2Addr+0xA, +0xB = status + complement (with pattern mix)
 *   - *0x401FF5, *0x401FF7 = contatori random
 *
 * Pattern coverage:
 *   - 30% status >= 0xE0       -> early exit 0x18, no workRam delta
 *   - 25% complement mismatch  -> status forced to 0, D1=1, drain
 *   - 35% status < 0xE0 valid  -> D1 in [1..4], drain + scale
 *   - 10% full random          -> stress
 *
 * Uso: npx tsx packages/cli/src/test-eeprom-commit-parity.ts [N=500]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import { state as stateNs, eepromCommit as ecNs } from "@marble-love/engine";
import {
  createCpu,
  callFunction,
  pokeMem,
  peekMem,
  disposeCpu,
} from "./binary-oracle-lib.js";

const FUN_3F78 = 0x00003f78;
const PTR_FFC = 0x00401ffc;
const ACC_FF5 = 0x00401ff5;
const COUNTER_FF7 = 0x00401ff7;

// Address of the A2 struct in the workRam-safe range (0x401D00, away from the
// counters 0x401FF5..F7 and pointer 0x401FFC, avoiding collisions).
const A2_ADDR = 0x00401d00;

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
  status: number;
  compl: number;
  acc0: number;
  ctr0: number;
  binD0: number;
  tsD0: number;
  binAcc: number;
  tsAcc: number;
  binCtr: number;
  tsCtr: number;
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

  console.log(`\n=== eepromCommit (FUN_3F78) — ${n} cases ===`);

  const rng = makeRng(0x3f78);
  let ok = 0;
  let firstFail: FailRecord | null = null;

  for (let i = 0; i < n; i++) {
    // Reset SP per la callFunction (push sentinel return).
    cpu.system.setRegister("sp", 0x401f00);

    // Pattern selection
    const pick = rng();
    let pattern: "early" | "mismatch" | "valid" | "random";
    let status: number;
    let compl: number;
    if (pick < 0.3) {
      pattern = "early";
      status = 0xe0 + Math.floor(rng() * 0x20); // [0xE0..0xFF]
      compl = ~status & 0xff;
    } else if (pick < 0.55) {
      pattern = "mismatch";
      status = Math.floor(rng() * 256);
      // Guarantee mismatch: choose compl different from ~status.
      do {
        compl = Math.floor(rng() * 256);
      } while (compl === ((~status) & 0xff));
    } else if (pick < 0.9) {
      pattern = "valid";
      status = Math.floor(rng() * 0xe0); // [0..0xDF]
      compl = ~status & 0xff;
    } else {
      pattern = "random";
      status = Math.floor(rng() * 256);
      compl = Math.floor(rng() * 256);
    }

    // Counter values: use full range for stress; clamp at 0x19 is tested.
    const acc0 = Math.floor(rng() * 256);
    const ctr0 = Math.floor(rng() * 256);

    // ── Setup binary side (Musashi) ─────────────────────────────────────
    // Pulizia precedente: 0x401D00..0x401D20 (struct), e contatori.
    for (let k = 0; k < 0x20; k++) {
      pokeMem(cpu, A2_ADDR + k, 1, 0);
    }
    pokeMem(cpu, A2_ADDR + 0x0a, 1, status);
    pokeMem(cpu, A2_ADDR + 0x0b, 1, compl);
    pokeMem(cpu, PTR_FFC, 4, A2_ADDR);
    pokeMem(cpu, ACC_FF5, 1, acc0);
    pokeMem(cpu, COUNTER_FF7, 1, ctr0);

    // ── Setup TS side (mirror su state.workRam) ─────────────────────────
    // Consistent cleanup.
    for (let k = 0; k < 0x20; k++) {
      state.workRam[(A2_ADDR - 0x400000) + k] = 0;
    }
    state.workRam[(A2_ADDR - 0x400000) + 0x0a] = status;
    state.workRam[(A2_ADDR - 0x400000) + 0x0b] = compl;
    // *0x401FFC = A2_ADDR (long big-endian)
    state.workRam[0x1ffc] = (A2_ADDR >>> 24) & 0xff;
    state.workRam[0x1ffd] = (A2_ADDR >>> 16) & 0xff;
    state.workRam[0x1ffe] = (A2_ADDR >>> 8) & 0xff;
    state.workRam[0x1fff] = A2_ADDR & 0xff;
    state.workRam[0x1ff5] = acc0;
    state.workRam[0x1ff7] = ctr0;

    // ── Run binary ──────────────────────────────────────────────────────
    const r = callFunction(cpu, FUN_3F78, []);
    const binD0 = r.d0 >>> 0;
    const binAcc = peekMem(cpu, ACC_FF5, 1) & 0xff;
    const binCtr = peekMem(cpu, COUNTER_FF7, 1) & 0xff;

    // ── Run TS ──────────────────────────────────────────────────────────
    const tsD0 = ecNs.eepromCommit(state) >>> 0;
    const tsAcc = (state.workRam[0x1ff5] ?? 0) & 0xff;
    const tsCtr = (state.workRam[0x1ff7] ?? 0) & 0xff;

    const match = binD0 === tsD0 && binAcc === tsAcc && binCtr === tsCtr;
    if (match) {
      ok++;
    } else if (firstFail === null) {
      firstFail = {
        i,
        pattern,
        status,
        compl,
        acc0,
        ctr0,
        binD0,
        tsD0,
        binAcc,
        tsAcc,
        binCtr,
        tsCtr,
      };
    }
  }

  console.log(`  Match: ${ok}/${n} = ${((ok / n) * 100).toFixed(1)}%`);
  if (firstFail) {
    const f = firstFail;
    console.log(`  First fail @ case ${f.i} (pattern=${f.pattern}):`);
    console.log(
      `    inputs: status=0x${f.status.toString(16)} compl=0x${f.compl.toString(16)} acc0=0x${f.acc0.toString(16)} ctr0=0x${f.ctr0.toString(16)}`,
    );
    console.log(
      `    bin: D0=0x${f.binD0.toString(16)} acc=0x${f.binAcc.toString(16)} ctr=0x${f.binCtr.toString(16)}`,
    );
    console.log(
      `    ts : D0=0x${f.tsD0.toString(16)} acc=0x${f.tsAcc.toString(16)} ctr=0x${f.tsCtr.toString(16)}`,
    );
  }

  disposeCpu(cpu);
  exit(ok === n ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  exit(1);
});
