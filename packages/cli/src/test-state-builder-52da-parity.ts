#!/usr/bin/env node
/**
 * test-state-builder-52da-parity.ts — differential FUN_52DA vs stateBuilder52DA.
 *
 * Strategy:
 *   - Patch `FUN_2572` to RTS, matching the TS default/injected no-op.
 *   - Place a 256-byte signed-index table in work RAM.
 *   - Call `FUN_52DA(b1Long, b2Long, tableBase)` and compare D0 plus the two
 *     observed global bytes at `0x401F98/99`.
 *
 * Usage: npx tsx packages/cli/src/test-state-builder-52da-parity.ts [N]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import { state as stateNs, stateBuilder52DA as subNs } from "@marble-love/engine";
import { createCpu, disposeCpu, peekMem, pokeMem } from "./binary-oracle-lib.js";

const FUN_52DA = 0x000052da;
const FUN_2572 = 0x00002572;

const WORK_RAM_BASE = 0x00400000;
const TABLE_BASE = 0x00400800;
const INDEX_ADDR = 0x00401f98;
const SECOND_ADDR = 0x00401f99;
const SENTINEL_RET = 0xcafebabe >>> 0;

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) >>> 0;
    return ((s >>> 16) & 0xffff) / 0x10000;
  };
}

function signExtByteToI32(b: number): number {
  return ((b & 0xff) << 24) >> 24;
}

function patchFun2572ToRts(cpu: Awaited<ReturnType<typeof createCpu>>): void {
  pokeMem(cpu, FUN_2572, 1, 0x4e);
  pokeMem(cpu, FUN_2572 + 1, 1, 0x75);
}

function clearTable(
  cpu: Awaited<ReturnType<typeof createCpu>>,
  state: stateNs.GameState,
): void {
  for (let raw = 0; raw < 256; raw++) {
    const addr = (TABLE_BASE + signExtByteToI32(raw)) >>> 0;
    pokeMem(cpu, addr, 1, 1);
    state.workRam[addr - WORK_RAM_BASE] = 1;
  }
}

function setTableByte(
  cpu: Awaited<ReturnType<typeof createCpu>>,
  state: stateNs.GameState,
  rawIndex: number,
  value: number,
): void {
  const addr = (TABLE_BASE + signExtByteToI32(rawIndex)) >>> 0;
  pokeMem(cpu, addr, 1, value & 0xff);
  state.workRam[addr - WORK_RAM_BASE] = value & 0xff;
}

function readTsByte(state: stateNs.GameState, addr: number): number {
  const a = addr >>> 0;
  if (a >= WORK_RAM_BASE && a < WORK_RAM_BASE + state.workRam.length) {
    return state.workRam[a - WORK_RAM_BASE] ?? 0;
  }
  return 0;
}

function call52DAStep(
  cpu: Awaited<ReturnType<typeof createCpu>>,
  b1: number,
  b2: number,
  longArg: number,
): { d0: number; reached: boolean } {
  const sys = cpu.system;
  let sp = 0x00401f00;
  for (const arg of [longArg, b2, b1]) {
    sp = (sp - 4) >>> 0;
    sys.write(sp, 4, arg >>> 0);
  }
  sp = (sp - 4) >>> 0;
  sys.write(sp, 4, SENTINEL_RET);
  sys.setRegister("sp", sp);
  sys.setRegister("pc", FUN_52DA);

  for (let i = 0; i < 10_000; i++) {
    const pc = sys.getRegisters().pc >>> 0;
    if (pc === SENTINEL_RET) {
      return { d0: sys.getRegisters().d0 >>> 0, reached: true };
    }
    sys.step();
  }
  return { d0: sys.getRegisters().d0 >>> 0, reached: false };
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
  patchFun2572ToRts(cpu);

  console.log(`\n=== stateBuilder52DA (FUN_52DA) — ${n} cases ===`);

  const rng = makeRng(0x52da52da);
  let ok = 0;
  let firstFail: {
    i: number;
    b1: number;
    b2: number;
    found: number;
    binD0: number;
    tsD0: number;
    binIndex: number;
    tsIndex: number;
    binSecond: number;
    tsSecond: number;
  } | null = null;

  for (let i = 0; i < n; i++) {
    const b1 =
      i === 0
        ? 0
        : i === 1
          ? 1
          : i === 2
            ? 0x7f
            : i === 3
              ? 0x80
              : i === 4
                ? 0xff
                : Math.floor(rng() * 0x100);
    const b2 =
      i === 0
        ? 0
        : i === 1
          ? 0x1b
          : i === 2
            ? 0x1c
            : i === 3
              ? 0x80
              : i === 4
                ? 0xff
                : Math.floor(rng() * 0x100);
    const found =
      i === 0
        ? 0
        : i === 1
          ? 1
          : i === 2
            ? 0x7f
            : i === 3
              ? 0x80
              : i === 4
                ? 0xff
                : Math.floor(rng() * 0x100);

    clearTable(cpu, state);
    setTableByte(cpu, state, found, 0);
    pokeMem(cpu, INDEX_ADDR, 1, 0xa5);
    pokeMem(cpu, SECOND_ADDR, 1, 0x5a);
    state.workRam[INDEX_ADDR - WORK_RAM_BASE] = 0xa5;
    state.workRam[SECOND_ADDR - WORK_RAM_BASE] = 0x5a;

    const bin = call52DAStep(cpu, b1 >>> 0, b2 >>> 0, TABLE_BASE);
    const binIndex = peekMem(cpu, INDEX_ADDR, 1) & 0xff;
    const binSecond = peekMem(cpu, SECOND_ADDR, 1) & 0xff;

    const tsD0 = subNs.stateBuilder52DA(state, b1, b2, TABLE_BASE, {
      readByte: (addr) => readTsByte(state, addr),
    });
    const tsIndex = state.workRam[INDEX_ADDR - WORK_RAM_BASE] ?? 0;
    const tsSecond = state.workRam[SECOND_ADDR - WORK_RAM_BASE] ?? 0;

    const match =
      bin.d0 >>> 0 === tsD0 >>> 0 &&
      bin.reached &&
      binIndex === tsIndex &&
      binSecond === tsSecond;

    if (match) {
      ok++;
    } else if (firstFail === null) {
      firstFail = {
        i,
        b1,
        b2,
        found,
        binD0: bin.d0 >>> 0,
        tsD0: tsD0 >>> 0,
        binIndex,
        tsIndex,
        binSecond,
        tsSecond,
      };
    }
  }

  console.log(`  Match: ${ok}/${n} = ${((ok / n) * 100).toFixed(1)}%`);
  if (firstFail) {
    console.log(
      `  First fail @ case ${firstFail.i}: b1=0x${firstFail.b1.toString(16)} b2=0x${firstFail.b2.toString(16)} found=0x${firstFail.found.toString(16)}`,
    );
    console.log(
      `    bin: d0=0x${firstFail.binD0.toString(16)} index=0x${firstFail.binIndex.toString(16)} second=0x${firstFail.binSecond.toString(16)}`,
    );
    console.log(
      `    ts : d0=0x${firstFail.tsD0.toString(16)} index=0x${firstFail.tsIndex.toString(16)} second=0x${firstFail.tsSecond.toString(16)}`,
    );
  }

  disposeCpu(cpu);
  exit(ok === n ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  exit(1);
});
