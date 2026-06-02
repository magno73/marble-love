#!/usr/bin/env node
/**
 * test-state-sub-5608-parity.ts — differential FUN_5608 vs stateSub5608.
 *
 * `FUN_00005608` (82 bytes): wrapper around 3 back-to-back callees with constant args
 * derivati da:
 *   - byte ROM @ 0x10072 (gate: D2 ∈ {4, 8})
 *   - long BE ROM @ 0x10074 (argLong → FUN_5334)
 *   - 4 immediate (0x7978, 0x7980, 0x1B, 0x1C)
 *
 *   1. FUN_52DA(D2+3, 0x1B,   0x7978)
 *   2. FUN_5334(*ROM[0x10074])
 *   3. FUN_52DA(D2+4, 0x1C,   0x7980)
 *
 * Strategia parity test:
 *   - Patch RTS sui due callee `FUN_52DA` (0x52DA) e `FUN_5334` (0x5334) per
 *     prevent their bodies from executing; their side effects are not relevant:
 *     for fault injection). Synchronize `tsRom.program` with the same bytes.
 *   - Run FUN_5608 step-by-step: each time PC == 0x52DA or PC == 0x5334
 *     dagli stub TS (inner52DA / inner5334).
 *
 * Uso: npx tsx packages/cli/src/test-state-sub-5608-parity.ts [N]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import {
  state as stateNs,
  bus as busNs,
  stateSub5608 as subNs,
} from "@marble-love/engine";
import type { RomImage } from "@marble-love/engine";
import {
  createCpu,
  disposeCpu,
  pokeMem,
  peekMem,
  type CpuSession,
} from "./binary-oracle-lib.js";

const FUN_5608 = 0x00005608;
const FUN_52DA = 0x000052da;
const FUN_5334 = 0x00005334;
const SENTINEL_RET = 0xcafebabe >>> 0;

const ROM_GATE_BYTE_ADDR = 0x00010072;
const ROM_HANDLE_LONG_ADDR = 0x00010074;

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) >>> 0;
    return ((s >>> 16) & 0xffff) / 0x10000;
  };
}

/** Patch RTS (0x4E75) at the entry of the two callees. */
function patchCallees(cpu: CpuSession): void {
  // FUN_52DA: original word `link.w A6,-0xC` (0x4E56). Patch to 0x4E75 (rts).
  pokeMem(cpu, FUN_52DA + 0, 1, 0x4e);
  pokeMem(cpu, FUN_52DA + 1, 1, 0x75);
  // FUN_5334: original word `move.l (0x4,SP),D0`. Patch to 0x4E75 (rts).
  pokeMem(cpu, FUN_5334 + 0, 1, 0x4e);
  pokeMem(cpu, FUN_5334 + 1, 1, 0x75);
}

interface Call52DA {
  arg1: number;
  arg2: number;
  arg3: number;
}
interface CapturedSeq {
  order: ("52DA" | "5334")[];
  calls52DA: Call52DA[];
  calls5334: number[];
  reachedRts: boolean;
}

/**
 * Run FUN_5608 step-by-step and capture args at the 0x52DA/0x5334 entries.
 *
 * stack), poi proseguiamo.
 */
function runAndCapture(cpu: CpuSession): CapturedSeq {
  const sys = cpu.system;
  const sp0 = 0x401f00;
  let sp = sp0;
  // FUN_5608 receives no args (void void). Push only sentinel ret.
  sp = (sp - 4) >>> 0;
  sys.write(sp, 4, SENTINEL_RET);
  sys.setRegister("sp", sp);
  sys.setRegister("pc", FUN_5608);

  const order: ("52DA" | "5334")[] = [];
  const calls52DA: Call52DA[] = [];
  const calls5334: number[] = [];

  // Required steps: about 30 instructions in 5608 plus 3 callee RTS = about 40.
  // ENTRY` captures once per call. Capture, then step.
  let safety = 500;
  let reachedRts = false;
  while (safety-- > 0) {
    const pc = sys.getRegisters().pc >>> 0;
    if (pc === SENTINEL_RET) {
      reachedRts = true;
      break;
    }
    if (pc === FUN_52DA) {
      //   (0,SP)  = ret addr (toward 0x5630 or 0x5652)
      //   (4,SP)  = arg1 (D2+3 or D2+4)
      //   (8,SP)  = arg2 (0x1B or 0x1C)
      //   (0xC,SP)= arg3 (0x7978 or 0x7980)
      const spNow = sys.getRegisters().sp >>> 0;
      const a1 = peekMem(cpu, spNow + 4, 4) >>> 0;
      const a2 = peekMem(cpu, spNow + 8, 4) >>> 0;
      const a3 = peekMem(cpu, spNow + 12, 4) >>> 0;
      calls52DA.push({ arg1: a1, arg2: a2, arg3: a3 });
      order.push("52DA");
    } else if (pc === FUN_5334) {
      //   (0,SP) = ret addr (toward 0x563C)
      const spNow = sys.getRegisters().sp >>> 0;
      const argLong = peekMem(cpu, spNow + 4, 4) >>> 0;
      calls5334.push(argLong);
      order.push("5334");
    }
    sys.step();
  }

  return { order, calls52DA, calls5334, reachedRts };
}

interface TsCapture {
  order: ("52DA" | "5334")[];
  calls52DA: Call52DA[];
  calls5334: number[];
}

function runTsAndCapture(state: stateNs.GameState, rom: RomImage): TsCapture {
  const order: ("52DA" | "5334")[] = [];
  const calls52DA: Call52DA[] = [];
  const calls5334: number[] = [];
  subNs.stateSub5608(
    state,
    rom,
    (a1, a2, a3) => {
      calls52DA.push({ arg1: a1, arg2: a2, arg3: a3 });
      order.push("52DA");
      return 0;
    },
    (argLong) => {
      calls5334.push(argLong);
      order.push("5334");
      return 0;
    },
  );
  return { order, calls52DA, calls5334 };
}

function eqCall(a: Call52DA, b: Call52DA): boolean {
  return a.arg1 === b.arg1 && a.arg2 === b.arg2 && a.arg3 === b.arg3;
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

  // Patch RTS sui callee (una sola time — la patch persiste in unified memory).
  patchCallees(cpu);

  const tsRom: RomImage = busNs.emptyRomImage();
  tsRom.program.set(rom.subarray(0, tsRom.program.length));

  console.log(`\n=== stateSub5608 (FUN_5608) — ${n} cases ===`);

  const rng = makeRng(0x56085608);
  let ok = 0;
  let firstFail: {
    i: number;
    gateByte: number;
    handleLong: number;
    binOrder: ("52DA" | "5334")[];
    binCalls52DA: Call52DA[];
    binCalls5334: number[];
    tsOrder: ("52DA" | "5334")[];
    tsCalls52DA: Call52DA[];
    tsCalls5334: number[];
  } | null = null;

  for (let i = 0; i < n; i++) {
    cpu.system.setRegister("sp", 0x401f00);

    // Pattern of coverage on the gate byte e on the handle long.
    let gateByte: number;
    let handleLong: number;
    if (i === 0) {
      gateByte = 0x00;
      handleLong = 0x00000000;
    } else if (i === 1) {
      gateByte = 0x01; // → D2 = 4
      handleLong = 0xffffffff >>> 0;
    } else if (i === 2) {
      gateByte = 0x80; // → D2 = 4 (sign-bit set, non-zero)
      handleLong = 0x12345678;
    } else if (i === 3) {
      gateByte = 0xff; // → D2 = 4
      handleLong = 0xdeadbeef;
    } else if (i === 4) {
      gateByte = 0x42;
      handleLong = 0xcafebabe;
    } else if (i < 20) {
      // Sweep deterministico
      gateByte = (i - 5) & 0xff;
      handleLong = Math.floor(rng() * 0x100000000) >>> 0;
    } else {
      // Random
      gateByte = Math.floor(rng() * 0x100) & 0xff;
      handleLong = Math.floor(rng() * 0x100000000) >>> 0;
    }

    // Inietta byte e long in ROM (Musashi unified memory) e in the mirror TS.
    pokeMem(cpu, ROM_GATE_BYTE_ADDR, 1, gateByte);
    tsRom.program[ROM_GATE_BYTE_ADDR] = gateByte & 0xff;
    pokeMem(cpu, ROM_HANDLE_LONG_ADDR, 4, handleLong >>> 0);
    tsRom.program[ROM_HANDLE_LONG_ADDR + 0] = (handleLong >>> 24) & 0xff;
    tsRom.program[ROM_HANDLE_LONG_ADDR + 1] = (handleLong >>> 16) & 0xff;
    tsRom.program[ROM_HANDLE_LONG_ADDR + 2] = (handleLong >>> 8) & 0xff;
    tsRom.program[ROM_HANDLE_LONG_ADDR + 3] = handleLong & 0xff;

    const bin = runAndCapture(cpu);

    // Run TS and capture.
    const ts = runTsAndCapture(state, tsRom);

    const sameOrder =
      bin.order.length === ts.order.length &&
      bin.order.every((v, k) => v === ts.order[k]);
    const sameCalls52DA =
      bin.calls52DA.length === ts.calls52DA.length &&
      bin.calls52DA.every((c, k) => eqCall(c, ts.calls52DA[k]!));
    const sameCalls5334 =
      bin.calls5334.length === ts.calls5334.length &&
      bin.calls5334.every((v, k) => v === ts.calls5334[k]);
    const match =
      bin.reachedRts && sameOrder && sameCalls52DA && sameCalls5334;

    if (match) {
      ok++;
    } else if (firstFail === null) {
      firstFail = {
        i,
        gateByte,
        handleLong,
        binOrder: bin.order,
        binCalls52DA: bin.calls52DA,
        binCalls5334: bin.calls5334,
        tsOrder: ts.order,
        tsCalls52DA: ts.calls52DA,
        tsCalls5334: ts.calls5334,
      };
    }
  }

  console.log(`  Match: ${ok}/${n} = ${((ok / n) * 100).toFixed(1)}%`);
  if (firstFail) {
    console.log(`  First fail @ case ${firstFail.i}:`);
    console.log(
      `    inputs: gateByte=0x${firstFail.gateByte.toString(16)} handleLong=0x${firstFail.handleLong.toString(16)}`,
    );
    console.log(`    bin order: ${firstFail.binOrder.join(",")}`);
    console.log(`    ts  order: ${firstFail.tsOrder.join(",")}`);
    console.log(
      `    bin 52DA calls: ${firstFail.binCalls52DA
        .map((c) => `(${c.arg1.toString(16)},${c.arg2.toString(16)},${c.arg3.toString(16)})`)
        .join(" ")}`,
    );
    console.log(
      `    ts  52DA calls: ${firstFail.tsCalls52DA
        .map((c) => `(${c.arg1.toString(16)},${c.arg2.toString(16)},${c.arg3.toString(16)})`)
        .join(" ")}`,
    );
    console.log(
      `    bin 5334 args : ${firstFail.binCalls5334.map((v) => `0x${v.toString(16)}`).join(" ")}`,
    );
    console.log(
      `    ts  5334 args : ${firstFail.tsCalls5334.map((v) => `0x${v.toString(16)}`).join(" ")}`,
    );
  }

  disposeCpu(cpu);
  exit(ok === n ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  exit(1);
});
