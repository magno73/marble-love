#!/usr/bin/env node
/**
 * test-format-and-render-28e00-parity.ts — differential FUN_28E00 vs
 * `formatAndRender28E00` TS replica.
 *
 * FUN_28E00 (60 byte) = wrapper "format hex value + render struct" composed
 * of:
 *   1. `formatHex(arg1Long, *0x400436, sext_l(arg2Word), showSpaces)` via
 *      `jsr 0x10C` (=`jmp 0x3A08`).
 *      callFunction.
 *   2. `FUN_00028FDE(arg3Word, arg4Word)` =
 *      `initStructHeader(0x400434, arg3.lowByte, arg4.lowByte)` (FUN_255A)
 *      followed by `renderStringChain(rom, 0x400434, 0x3400)` (FUN_2572).
 *
 * Suites tested:
 *   - A: full random (value, numDigits 1..8, field, tickOff, callerD2, attr
 *        globals random)
 *   - B: rotation 0 (lookup7294[0] small, tickOff in range → render OK)
 *   - C: rotation random 0..7
 *   - D: numDigits small (1..3) — typical HUD score
 *
 * pattern of the parity test of FUN_2572).
 *
 * 4 KB alpha RAM (0xA03000..0xA03FFF) + formatHex buffer (16 bytes around
 * the bufEnd ptr).
 *
 * Usage: npx tsx packages/cli/src/test-format-and-render-28e00-parity.ts [N]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import {
  state as stateNs,
  formatAndRender28E00 as fr28e00Ns,
  bus as busNs,
} from "@marble-love/engine";
import type { RomImage } from "@marble-love/engine";
import {
  createCpu,
  callFunction,
  pokeMem,
  peekMem,
  disposeCpu,
} from "./binary-oracle-lib.js";

const FUN_28E00 = 0x00028e00;

const STRUCT_ADDR = 0x00400434;
const STRUCT_BUFEND_PTR = 0x00400436; // = STRUCT_ADDR + 2 (struct's string-ptr field)

// from the struct and scratch areas used by renderStringChain. workRam range
// bufEnd in 0x401D00..0x401D40 (safe).
const BUFEND_BASE = 0x00401d00; // bufEnd random in [BUFEND_BASE..BUFEND_BASE+0x10]

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) >>> 0;
    return ((s >>> 16) & 0xffff) / 0x10000;
  };
}

interface CaseSetup {
  arg1Long: number;
  arg2Word: number;
  arg3Word: number;
  arg4Word: number;
  callerD2: number;
  bufEnd: number;
  attrGlobals: { valF00: number; tick: number; rotation: number };
}

interface FailRecord {
  suite: string;
  tc: number;
  region: string;
  offset: number;
  bin: number;
  ts: number;
  setup: CaseSetup;
}

async function main(): Promise<void> {
  const total = Number(process.argv[2] ?? "500");
  const perSuite = Math.floor(total / 4);
  const remainder = total - perSuite * 4;

  const romPath = resolve("ghidra_project/marble_program.bin");
  if (!existsSync(romPath)) {
    console.error(`error: ROM blob not found at ${romPath}`);
    exit(3);
  }
  const rom = readFileSync(romPath);

  const stateInst = stateNs.emptyGameState();
  const cpu = await createCpu({ rom, state: stateInst });

  const tsRom: RomImage = busNs.emptyRomImage();
  tsRom.program.set(rom.subarray(0, tsRom.program.length));

  let totalOk = 0;
  const failHolder: { value: FailRecord | null } = { value: null };

  function setupCase(setup: CaseSetup): void {
    const { bufEnd, attrGlobals } = setup;

    // 1) Struct area 0x400434..0x400440 (12 byte)
    // 2) bufEnd buffer area 0x401D00..0x401D40 (64 byte)
    // 3) Globals 0x401F00, 0x401F3A, 0x401F42
    // 4) Alpha RAM 4 KB
    for (let j = 0; j < 12; j++) {
      pokeMem(cpu, STRUCT_ADDR + j, 1, 0);
      stateInst.workRam[(STRUCT_ADDR - 0x400000) + j] = 0;
    }
    for (let j = 0; j < 64; j++) {
      pokeMem(cpu, BUFEND_BASE + j, 1, 0xee);
      stateInst.workRam[(BUFEND_BASE - 0x400000) + j] = 0xee;
    }
    // Set bufEnd ptr @ STRUCT_BUFEND_PTR = STRUCT_ADDR+2 (struct's stringPtr).
    pokeMem(cpu, STRUCT_BUFEND_PTR, 4, bufEnd >>> 0);
    {
      const off = STRUCT_BUFEND_PTR - 0x400000;
      stateInst.workRam[off] = (bufEnd >>> 24) & 0xff;
      stateInst.workRam[off + 1] = (bufEnd >>> 16) & 0xff;
      stateInst.workRam[off + 2] = (bufEnd >>> 8) & 0xff;
      stateInst.workRam[off + 3] = bufEnd & 0xff;
    }

    // Globals
    pokeMem(cpu, 0x00401f00, 2, attrGlobals.valF00 & 0xffff);
    pokeMem(cpu, 0x00401f3a, 2, attrGlobals.tick & 0xffff);
    pokeMem(cpu, 0x00401f42, 2, attrGlobals.rotation & 0xffff);
    stateInst.workRam[0x1f00] = (attrGlobals.valF00 >>> 8) & 0xff;
    stateInst.workRam[0x1f01] = attrGlobals.valF00 & 0xff;
    stateInst.workRam[0x1f3a] = (attrGlobals.tick >>> 8) & 0xff;
    stateInst.workRam[0x1f3b] = attrGlobals.tick & 0xff;
    stateInst.workRam[0x1f42] = (attrGlobals.rotation >>> 8) & 0xff;
    stateInst.workRam[0x1f43] = attrGlobals.rotation & 0xff;

    // Alpha RAM 4 KB reset
    for (let j = 0; j < 0x1000; j++) {
      pokeMem(cpu, 0xa03000 + j, 1, 0);
      stateInst.alphaRam[j] = 0;
    }
  }

  function compareRegion(addr: number, size: number, region: string): { offset: number; bin: number; ts: number } | null {
    for (let j = 0; j < size; j++) {
      const b = peekMem(cpu, addr + j, 1);
      let t: number;
      if (addr >= 0x400000 && addr < 0x402000) {
        t = stateInst.workRam[(addr - 0x400000) + j] ?? 0;
      } else if (addr >= 0xa03000 && addr < 0xa04000) {
        t = stateInst.alphaRam[(addr - 0xa03000) + j] ?? 0;
      } else {
        t = 0;
      }
      if (b !== t) {
        return { offset: j, bin: b, ts: t };
      }
    }
    void region;
    return null;
  }

  function runOneCase(suite: string, tc: number, setup: CaseSetup): boolean {
    cpu.system.setRegister("sp", 0x401f00);
    setupCase(setup);

    // showSpaces in formatHex (via stack-garbage `(0x16,SP)`).
    cpu.system.setRegister("d2", setup.callerD2 >>> 0);

    // different "garbage".
    cpu.system.setRegister("d0", 0xdeadbeef);
    cpu.system.setRegister("d1", 0xcafedab0);

    // BIN: callFunction with 4 long args
    callFunction(cpu, FUN_28E00, [
      setup.arg1Long >>> 0,
      setup.arg2Word & 0xffff,
      setup.arg3Word & 0xffff,
      setup.arg4Word & 0xffff,
    ]);

    // TS: replica
    fr28e00Ns.formatAndRender28E00(
      stateInst,
      tsRom,
      setup.arg1Long >>> 0,
      setup.arg2Word & 0xffff,
      setup.arg3Word & 0xffff,
      setup.arg4Word & 0xffff,
      setup.callerD2 & 0xffff,
    );

    // Compare struct region 0x400434..0x40043F (12 byte: covers +0/+1/+6 +
    let fail = compareRegion(STRUCT_ADDR, 12, "struct");
    if (fail !== null) {
      if (failHolder.value === null) {
        failHolder.value = { suite, tc, region: "struct", ...fail, setup };
      }
      return false;
    }

    // Compare bufEnd buffer area (64 bytes around bufEnd).
    fail = compareRegion(BUFEND_BASE, 64, "bufEnd");
    if (fail !== null) {
      if (failHolder.value === null) {
        failHolder.value = { suite, tc, region: "bufEnd", ...fail, setup };
      }
      return false;
    }

    // Compare alpha RAM (4 KB)
    fail = compareRegion(0xa03000, 0x1000, "alpha");
    if (fail !== null) {
      if (failHolder.value === null) {
        failHolder.value = { suite, tc, region: "alpha", ...fail, setup };
      }
      return false;
    }

    return true;
  }

  // ─── Suite A: random everything ─────────────────────────────────────
  console.log(`\n=== formatAndRender28E00 (FUN_28E00) — Suite A: random — ${perSuite} cases ===`);
  let okA = 0;
  {
    const rng = makeRng(0x28e00a);
    for (let i = 0; i < perSuite; i++) {
      const setup: CaseSetup = {
        arg1Long: Math.floor(rng() * 0x100000000) >>> 0,
        arg2Word: 1 + Math.floor(rng() * 8),
        arg3Word: Math.floor(rng() * 32),
        arg4Word: Math.floor(rng() * 256),
        callerD2: Math.floor(rng() * 0x10000),
        bufEnd: BUFEND_BASE + Math.floor(rng() * 16),
        attrGlobals: {
          valF00: 0,
          tick: Math.floor(rng() * 0x10000),
          rotation: Math.floor(rng() * 8),
        },
      };
      if (runOneCase("A", i, setup)) okA++;
    }
    console.log(`  Match: ${okA}/${perSuite} = ${((okA / perSuite) * 100).toFixed(1)}%`);
    totalOk += okA;
  }

  // ─── Suite B: rotation = 0 (path "linear") ──────────────────────────
  console.log(`\n=== Suite B: rotation=0 — ${perSuite} cases ===`);
  let okB = 0;
  {
    const rng = makeRng(0x28e00b);
    for (let i = 0; i < perSuite; i++) {
      const tick = Math.floor(rng() * 0x100); // small tick
      const setup: CaseSetup = {
        arg1Long: Math.floor(rng() * 0x100000000) >>> 0,
        arg2Word: 1 + Math.floor(rng() * 8),
        arg3Word: Math.floor(rng() * 32), // field 0..31
        arg4Word: tick & 0xff,            // tickOff likely "two"
        callerD2: rng() < 0.5 ? 0 : 1,    // showSpaces 0 or 1
        bufEnd: BUFEND_BASE + Math.floor(rng() * 16),
        attrGlobals: { valF00: 0, tick, rotation: 0 },
      };
      if (runOneCase("B", i, setup)) okB++;
    }
    console.log(`  Match: ${okB}/${perSuite} = ${((okB / perSuite) * 100).toFixed(1)}%`);
    totalOk += okB;
  }

  // ─── Suite C: rotation random 0..7 ──────────────────────────────────
  console.log(`\n=== Suite C: rotation 0..7 — ${perSuite} cases ===`);
  let okC = 0;
  {
    const rng = makeRng(0x28e00c);
    for (let i = 0; i < perSuite; i++) {
      const tick = Math.floor(rng() * 0x100);
      const setup: CaseSetup = {
        arg1Long: Math.floor(rng() * 0x100000000) >>> 0,
        arg2Word: 1 + Math.floor(rng() * 6),
        arg3Word: Math.floor(rng() * 16),
        arg4Word: tick & 0xff,
        callerD2: Math.floor(rng() * 0x10000),
        bufEnd: BUFEND_BASE + Math.floor(rng() * 8),
        attrGlobals: { valF00: 0, tick, rotation: Math.floor(rng() * 8) },
      };
      if (runOneCase("C", i, setup)) okC++;
    }
    console.log(`  Match: ${okC}/${perSuite} = ${((okC / perSuite) * 100).toFixed(1)}%`);
    totalOk += okC;
  }

  // ─── Suite D: numDigits small (1..3) — HUD score-like ─────────────
  const sizeD = perSuite + remainder;
  console.log(`\n=== Suite D: numDigits 1..3 (HUD-like) — ${sizeD} cases ===`);
  let okD = 0;
  {
    const rng = makeRng(0x28e00d);
    for (let i = 0; i < sizeD; i++) {
      const tick = Math.floor(rng() * 0x100);
      const setup: CaseSetup = {
        arg1Long: Math.floor(rng() * 0x10000), // value <= 0xFFFF (typical score)
        arg2Word: 1 + Math.floor(rng() * 3),   // 1..3 digits
        arg3Word: Math.floor(rng() * 8),
        arg4Word: tick & 0xff,
        callerD2: rng() < 0.5 ? 0 : 1,
        bufEnd: BUFEND_BASE + Math.floor(rng() * 8),
        attrGlobals: { valF00: 0, tick, rotation: 0 },
      };
      if (runOneCase("D", i, setup)) okD++;
    }
    console.log(`  Match: ${okD}/${sizeD} = ${((okD / sizeD) * 100).toFixed(1)}%`);
    totalOk += okD;
  }

  console.log(`\n=== TOTAL: ${totalOk}/${total} = ${((totalOk / total) * 100).toFixed(1)}% ===`);
  if (failHolder.value !== null) {
    const f = failHolder.value;
    console.log(
      `  First fail (suite ${f.suite} tc=${f.tc}): @ ${f.region}+0x${f.offset.toString(16)} ` +
      `bin=0x${f.bin.toString(16)} ts=0x${f.ts.toString(16)}`,
    );
    console.log(
      `    setup: arg1=0x${f.setup.arg1Long.toString(16)} arg2=0x${f.setup.arg2Word.toString(16)} ` +
      `arg3=0x${f.setup.arg3Word.toString(16)} arg4=0x${f.setup.arg4Word.toString(16)} ` +
      `D2=0x${f.setup.callerD2.toString(16)} bufEnd=0x${f.setup.bufEnd.toString(16)} ` +
      `rot=0x${f.setup.attrGlobals.rotation.toString(16)} tick=0x${f.setup.attrGlobals.tick.toString(16)}`,
    );
  }

  disposeCpu(cpu);
  exit(totalOk === total ? 0 : 1);
}

main().catch((e: unknown) => {
  console.error(e);
  exit(1);
});
