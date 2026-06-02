#!/usr/bin/env node
/**
 * test-eeprom-helper-40d8-parity.ts — differential FUN_40D8 vs TS.
 *
 * `FUN_000040D8` is a leaf config-field accessor:
 *   - arg = key long at SP+0x1C after the callee's movem
 *   - reads `*0x401FFC` as struct pointer
 *   - keys 0..12 use ROM table `0x795A`
 *   - key 13 returns sign-extended ROM byte `0x1006F`
 *   - keys > 13 return -1
 *
 * JSR patching: none needed; the function has no internal calls.
 *
 * Usage:
 *   npx tsx packages/cli/src/test-eeprom-helper-40d8-parity.ts [N=500]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import {
  eepromHelper40D8 as helperNs,
  state as stateNs,
} from "@marble-love/engine";
import {
  callFunction,
  createCpu,
  disposeCpu,
  pokeMem,
} from "./binary-oracle-lib.js";

const FUN_40D8 = 0x000040d8;
const PTR_FFC = 0x00401ffc;
const PTR_VAL = 0x00401000;
const STRUCT_BYTES = 0x80;

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

function findRomPath(): string | null {
  const candidates = [
    process.env["MARBLE_ROM_BLOB"],
    resolve("ghidra_project/marble_program.bin"),
    resolve("../marble-love/ghidra_project/marble_program.bin"),
    resolve("../../marble-love/ghidra_project/marble_program.bin"),
  ].filter((p): p is string => p !== undefined && p.length > 0);
  return candidates.find((p) => existsSync(p)) ?? null;
}

function writeLongBEToState(ram: Uint8Array, off: number, value: number): void {
  const v = value >>> 0;
  ram[off] = (v >>> 24) & 0xff;
  ram[off + 1] = (v >>> 16) & 0xff;
  ram[off + 2] = (v >>> 8) & 0xff;
  ram[off + 3] = v & 0xff;
}

interface FailRecord {
  i: number;
  pattern: string;
  key: number;
  binD0: number;
  tsD0: number;
}

async function main(): Promise<void> {
  const n = Number(process.argv[2] ?? "500");
  const romPath = findRomPath();
  if (romPath === null) {
    console.error(
      "error: ROM blob not found. Set MARBLE_ROM_BLOB or keep ghidra_project/marble_program.bin in the repo.",
    );
    exit(3);
  }

  const rom = readFileSync(romPath);
  const romMaxRecordsByte = rom[helperNs.ROM_MAX_RECORDS_ADDR] ?? 0;
  const state = stateNs.emptyGameState();
  const cpu = await createCpu({ rom, state });
  const rng = makeRng(0x40d840d8);

  console.log(
    `\n=== eepromHelper40D8 (FUN_40D8) — ${n} cases (ROM[0x1006F]=0x${romMaxRecordsByte.toString(16)}) ===`,
  );

  let ok = 0;
  let firstFail: FailRecord | null = null;

  for (let i = 0; i < n; i++) {
    cpu.system.setRegister("sp", 0x401f00);

    pokeMem(cpu, PTR_FFC, 4, PTR_VAL);
    writeLongBEToState(state.workRam, 0x1ffc, PTR_VAL);

    for (let j = 0; j < STRUCT_BYTES; j++) {
      const byte = Math.floor(rng() * 256);
      const addr = PTR_VAL + j;
      pokeMem(cpu, addr, 1, byte);
      state.workRam[addr - 0x400000] = byte;
    }

    const pick = rng();
    let pattern: "valid" | "special13" | "oorSmall" | "oorLarge";
    let key: number;
    if (pick < 0.7) {
      pattern = "valid";
      key = Math.floor(rng() * 13);
    } else if (pick < 0.82) {
      pattern = "special13";
      key = 13;
    } else if (pick < 0.92) {
      pattern = "oorSmall";
      key = 14 + Math.floor(rng() * 0x100);
    } else {
      pattern = "oorLarge";
      key = Math.floor(rng() * 0x100000000) >>> 0;
      if (key <= 13) key = 0xffffffff;
    }

    const bin = callFunction(cpu, FUN_40D8, [key]);
    const binD0 = bin.d0 >>> 0;
    const tsD0 = helperNs.eepromHelper40D8(state, key, romMaxRecordsByte) >>> 0;

    if (binD0 === tsD0) {
      ok++;
    } else if (firstFail === null) {
      firstFail = { i, pattern, key, binD0, tsD0 };
    }
  }

  console.log(`  Match: ${ok}/${n} = ${((ok / n) * 100).toFixed(1)}%`);
  if (firstFail !== null) {
    const f = firstFail;
    console.log(`  First fail @ case ${f.i} (pattern=${f.pattern}):`);
    console.log(`    key=0x${f.key.toString(16)}`);
    console.log(`    bin: D0=0x${f.binD0.toString(16).padStart(8, "0")}`);
    console.log(`    ts : D0=0x${f.tsD0.toString(16).padStart(8, "0")}`);
  }

  disposeCpu(cpu);
  exit(ok === n ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  exit(1);
});
