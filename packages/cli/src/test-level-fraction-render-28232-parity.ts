#!/usr/bin/env node
/**
 * test-level-fraction-render-28232-parity.ts — differential FUN_00028232 vs
 * `levelFractionRender28232` TS replica.
 *
 * `FUN_00028232` (400 bytes): "level/fraction render" orchestrator with 7
 * sub-jsr (5 renderStringChain via 0x142 + 1 initStructHeader via 0x13C +
 * 1 renderStringHelper FUN_28E3C). Side effects diretti del modulo:
 *   - 3 byte writes a workRam[0x428/0x429/0x42E] (da initStructHeader).
 *   - 4+1 byte writes a `*(0x40042A)` (fraction string + null).
 *
 *   Patch the 3 binary entries with `addq.b #1, sentinel.l ; rts` (8 bytes).
 *   Tre sentinel byte distinti in workRam:
 *     - FUN_2572  (renderStringChain, jsr 0x142)  → sentinel 0x4003E0 ("chain")
 *     - FUN_255A  (initStructHeader,   jsr 0x13C) → sentinel 0x4003E1 ("init")
 *     - FUN_28E3C (renderStringHelper, jsr 0x28E3C) → sentinel 0x4003E2 ("helper")
 *
 *   In TS, the 3 callbacks inject the same increment.
 *
 * **Note on trampoline patching** (0x142, 0x13C):
 *   I trampolini sono `jmp 0x2572` / `jmp 0x255A`. Patchamo l'entry destinazione
 *
 *      For cases with `idx=-1` early-out: == (D2==0 ? 2 : 1).
 *      or == 0 on early-out.
 *   3. sentinelHelper == 1 in both (same rule) or == 0 on early-out.
 *   4. workRam[0x428..0x42E] e i 5 byte @ *(0x40042A) byte-by-byte.
 *
 *   - A: idx random ∈ [0..7], levelNum random, mode != 2, no early-out.
 *   - B: idx random, levelNum random, mode == 2 (D2!=0 path, skip cond jsr).
 *   - C: idx == -1 (early-out path), mode random.
 *
 * Uso: npx tsx packages/cli/src/test-level-fraction-render-28232-parity.ts [N]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import {
  state as stateNs,
  levelFractionRender28232 as lfrNs,
} from "@marble-love/engine";
import {
  createCpu,
  callFunction,
  pokeMem,
  peekMem,
  disposeCpu,
} from "./binary-oracle-lib.js";
import type { CpuSession } from "./binary-oracle-lib.js";

const FUN_28232 = 0x00028232;

// Sub-function entry points (targets of trampolines 0x142/0x13C, and direct 28E3C).
const FUN_2572 = 0x00002572; // renderStringChain (target di jmp 0x142)
const FUN_255A = 0x0000255a; // initStructHeader  (target di jmp 0x13C)
const FUN_28E3C = 0x00028e3c; // renderStringHelper

// Sentinel byte slot in work RAM (counter for the 3 subs).
const SENTINEL_CHAIN = 0x004003e0;
const SENTINEL_INIT = 0x004003e1;
const SENTINEL_HELPER = 0x004003e2;

// Address mappings for module constants (workRam offsets).
const MODE_SELECTOR_ADDR = 0x00400392;
const LEVEL_IDX_ADDR = 0x004003de;
const LEVEL_NUM_ADDR = 0x004003ea;
const FRACTION_PTR_ADDR = 0x0040042a;

// Fraction-string buffer written by both sides (workRam offset).
// Place it at 0x500..0x504 (5 bytes) to avoid colliding with other offsets.
const FRAC_BUFFER_ADDR = 0x00400500;

// 0x428..0x42E = 7 byte (struct), 0x500..0x504 = 5 byte (fraction).
const STRUCT_COMPARE_BASE = 0x00400428;
const STRUCT_COMPARE_SIZE = 8; // 0x428..0x42F (7 byte usati + 1 di margine)

const FRAC_COMPARE_BASE = FRAC_BUFFER_ADDR;
const FRAC_COMPARE_SIZE = 5;

/**
 * Encode `addq.b #1, (abs).l ; rts` (8 byte) in `rom` a `entry`.
 *   addq.b #1, (xxxx).l → 0x52 0x39 + abs long
 *   rts                 → 0x4E 0x75
 */
function patchStubAddq(rom: Buffer, entry: number, sentinelAddr: number): void {
  rom[entry + 0] = 0x52;
  rom[entry + 1] = 0x39;
  rom[entry + 2] = (sentinelAddr >>> 24) & 0xff;
  rom[entry + 3] = (sentinelAddr >>> 16) & 0xff;
  rom[entry + 4] = (sentinelAddr >>> 8) & 0xff;
  rom[entry + 5] = sentinelAddr & 0xff;
  rom[entry + 6] = 0x4e;
  rom[entry + 7] = 0x75;
}

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) >>> 0;
    return ((s >>> 16) & 0xffff) / 0x10000;
  };
}

interface CaseSetup {
  modeSel: number;
  levelIdx: number;
  levelNum: number;
  fracPtr: number;
  sentInitChain: number;
  sentInitInit: number;
  sentInitHelper: number;
  romTable1: number[]; // 8 long
  romTable2: number[]; // 8 long
}

interface FailRecord {
  i: number;
  suite: string;
  field: string;
  bin: number;
  ts: number;
  setup: CaseSetup;
}

function setupCase(
  state: ReturnType<typeof stateNs.emptyGameState>,
  cpu: CpuSession,
  romBuf: Buffer,
  setup: CaseSetup,
): void {
  // 1. mode selector word @ 0x400392
  pokeMem(cpu, MODE_SELECTOR_ADDR, 2, setup.modeSel & 0xffff);
  state.workRam[MODE_SELECTOR_ADDR - 0x400000] = (setup.modeSel >>> 8) & 0xff;
  state.workRam[MODE_SELECTOR_ADDR - 0x400000 + 1] = setup.modeSel & 0xff;

  // 2. level idx word @ 0x4003DE
  pokeMem(cpu, LEVEL_IDX_ADDR, 2, setup.levelIdx & 0xffff);
  state.workRam[LEVEL_IDX_ADDR - 0x400000] = (setup.levelIdx >>> 8) & 0xff;
  state.workRam[LEVEL_IDX_ADDR - 0x400000 + 1] = setup.levelIdx & 0xff;

  // 3. level num word @ 0x4003EA
  pokeMem(cpu, LEVEL_NUM_ADDR, 2, setup.levelNum & 0xffff);
  state.workRam[LEVEL_NUM_ADDR - 0x400000] = (setup.levelNum >>> 8) & 0xff;
  state.workRam[LEVEL_NUM_ADDR - 0x400000 + 1] = setup.levelNum & 0xff;

  // 4. fraction ptr long @ 0x40042A
  pokeMem(cpu, FRACTION_PTR_ADDR, 4, setup.fracPtr >>> 0);
  state.workRam[FRACTION_PTR_ADDR - 0x400000 + 0] = (setup.fracPtr >>> 24) & 0xff;
  state.workRam[FRACTION_PTR_ADDR - 0x400000 + 1] = (setup.fracPtr >>> 16) & 0xff;
  state.workRam[FRACTION_PTR_ADDR - 0x400000 + 2] = (setup.fracPtr >>> 8) & 0xff;
  state.workRam[FRACTION_PTR_ADDR - 0x400000 + 3] = setup.fracPtr & 0xff;

  for (let i = 0; i < STRUCT_COMPARE_SIZE; i++) {
    pokeMem(cpu, STRUCT_COMPARE_BASE + i, 1, 0);
    state.workRam[STRUCT_COMPARE_BASE - 0x400000 + i] = 0;
  }

  for (let i = 0; i < FRAC_COMPARE_SIZE; i++) {
    pokeMem(cpu, FRAC_COMPARE_BASE + i, 1, 0);
    state.workRam[FRAC_COMPARE_BASE - 0x400000 + i] = 0;
  }

  // 7. sentinel byte (3).
  pokeMem(cpu, SENTINEL_CHAIN, 1, setup.sentInitChain);
  state.workRam[SENTINEL_CHAIN - 0x400000] = setup.sentInitChain;
  pokeMem(cpu, SENTINEL_INIT, 1, setup.sentInitInit);
  state.workRam[SENTINEL_INIT - 0x400000] = setup.sentInitInit;
  pokeMem(cpu, SENTINEL_HELPER, 1, setup.sentInitHelper);
  state.workRam[SENTINEL_HELPER - 0x400000] = setup.sentInitHelper;

  // 8. ROM table 1 @ 0x23C04 e table 2 @ 0x23C18: scriviamo 8 long (32 byte ciascuna).
  // come read-only normalmente). Per essere sicuri, NON ri-scriviamo le ROM
  void romBuf;
}

/** Compare sentinel + scratch region. Returns first diff or null. */
function compareCase(
  state: ReturnType<typeof stateNs.emptyGameState>,
  cpu: CpuSession,
): { field: string; bin: number; ts: number } | null {
  // 1. sentinel chain
  const cBin = peekMem(cpu, SENTINEL_CHAIN, 1) & 0xff;
  const cTs = state.workRam[SENTINEL_CHAIN - 0x400000] ?? 0;
  if (cBin !== cTs) return { field: "sentinelChain", bin: cBin, ts: cTs };

  // 2. sentinel init
  const iBin = peekMem(cpu, SENTINEL_INIT, 1) & 0xff;
  const iTs = state.workRam[SENTINEL_INIT - 0x400000] ?? 0;
  if (iBin !== iTs) return { field: "sentinelInit", bin: iBin, ts: iTs };

  // 3. sentinel helper
  const hBin = peekMem(cpu, SENTINEL_HELPER, 1) & 0xff;
  const hTs = state.workRam[SENTINEL_HELPER - 0x400000] ?? 0;
  if (hBin !== hTs) return { field: "sentinelHelper", bin: hBin, ts: hTs };

  // 4. struct region 0x428..0x42F
  for (let i = 0; i < STRUCT_COMPARE_SIZE; i++) {
    const b = peekMem(cpu, STRUCT_COMPARE_BASE + i, 1) & 0xff;
    const t = state.workRam[STRUCT_COMPARE_BASE - 0x400000 + i] ?? 0;
    if (b !== t) {
      return { field: `struct+0x${i.toString(16)}`, bin: b, ts: t };
    }
  }

  // 5. fraction buffer 0x500..0x504
  for (let i = 0; i < FRAC_COMPARE_SIZE; i++) {
    const b = peekMem(cpu, FRAC_COMPARE_BASE + i, 1) & 0xff;
    const t = state.workRam[FRAC_COMPARE_BASE - 0x400000 + i] ?? 0;
    if (b !== t) {
      return { field: `frac+0x${i.toString(16)}`, bin: b, ts: t };
    }
  }

  return null;
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
  const romBuf = Buffer.from(readFileSync(romPath));

  // Patch le 3 sub-call a `addq.b #1, sentinel ; rts`.
  // FUN_2572  (target di jmp 0x142) → sentinelChain
  // FUN_255A  (target di jmp 0x13C) → sentinelInit
  // FUN_28E3C                       → sentinelHelper
  patchStubAddq(romBuf, FUN_2572, SENTINEL_CHAIN);
  patchStubAddq(romBuf, FUN_255A, SENTINEL_INIT);
  patchStubAddq(romBuf, FUN_28E3C, SENTINEL_HELPER);

  const stateInst = stateNs.emptyGameState();
  const cpu = await createCpu({ rom: romBuf, state: stateInst });

  const subs: lfrNs.LevelFractionRender28232Subs = {
    renderStringChain: (s) => {
      const off = SENTINEL_CHAIN - 0x400000;
      s.workRam[off] = ((s.workRam[off] ?? 0) + 1) & 0xff;
    },
    initStructHeader: (s) => {
      const off = SENTINEL_INIT - 0x400000;
      s.workRam[off] = ((s.workRam[off] ?? 0) + 1) & 0xff;
    },
    renderStringHelper: (s) => {
      const off = SENTINEL_HELPER - 0x400000;
      s.workRam[off] = ((s.workRam[off] ?? 0) + 1) & 0xff;
    },
  };

  const rng = makeRng(0x28232);
  const rb = (): number => Math.floor(rng() * 256) & 0xff;
  const rw = (): number => Math.floor(rng() * 0x10000) & 0xffff;

  let totalOk = 0;
  let firstFail: FailRecord | null = null;

  function runOneCase(suite: string, i: number, setup: CaseSetup): boolean {
    cpu.system.setRegister("sp", 0x401f00);
    setupCase(stateInst, cpu, romBuf, setup);

    callFunction(cpu, FUN_28232, []);
    lfrNs.levelFractionRender28232(stateInst, { program: romBuf } as never, subs);

    const fail = compareCase(stateInst, cpu);
    if (fail === null) return true;
    if (firstFail === null) {
      firstFail = { i, suite, ...fail, setup };
    }
    return false;
  }

  function makeSetup(opts: {
    modeOverride?: number;
    idxOverride?: number;
  } = {}): CaseSetup {
    return {
      modeSel: opts.modeOverride !== undefined ? opts.modeOverride : rw(),
      levelIdx: opts.idxOverride !== undefined ? opts.idxOverride : rw(),
      levelNum: rw(),
      // direct. For the TS replica, use the same mask.
      fracPtr: FRAC_BUFFER_ADDR,
      sentInitChain: rb(),
      sentInitInit: rb(),
      sentInitHelper: rb(),
      romTable1: [],
      romTable2: [],
    };
  }

  // ─── Suite A: mode != 2, idx ∈ [0..7] (no early-out, D2=0 path) ─────
  console.log(
    `\n=== levelFractionRender28232 (FUN_28232) — Suite A: mode!=2, idx∈[0..7] — ${perSuite} casi ===`,
  );
  let okA = 0;
  for (let i = 0; i < perSuite; i++) {
    // mode selector qualsiasi != 2.
    let mode = rw();
    if (mode === 2) mode = 3;
    const idx = Math.floor(rng() * 8); // 0..7
    if (runOneCase("A", i, makeSetup({ modeOverride: mode, idxOverride: idx })))
      okA++;
  }
  console.log(`  Match: ${okA}/${perSuite} = ${((okA / perSuite) * 100).toFixed(1)}%`);
  totalOk += okA;

  // ─── Suite B: mode == 2 (D2!=0 path, skip 2 jsr cond) ───────────────
  console.log(`\n=== Suite B: mode==2 (D2!=0) — ${perSuite} casi ===`);
  let okB = 0;
  for (let i = 0; i < perSuite; i++) {
    const idx = Math.floor(rng() * 8);
    if (runOneCase("B", i, makeSetup({ modeOverride: 2, idxOverride: idx })))
      okB++;
  }
  console.log(`  Match: ${okB}/${perSuite} = ${((okB / perSuite) * 100).toFixed(1)}%`);
  totalOk += okB;

  // ─── Suite C: idx == 0xFFFF (early-out path) ────────────────────────
  console.log(`\n=== Suite C: idx==0xFFFF (early-out) — ${perSuite} casi ===`);
  let okC = 0;
  for (let i = 0; i < perSuite; i++) {
    if (runOneCase("C", i, makeSetup({ idxOverride: 0xffff }))) okC++;
  }
  console.log(`  Match: ${okC}/${perSuite} = ${((okC / perSuite) * 100).toFixed(1)}%`);
  totalOk += okC;

  // ─── Suite D: random everything ─────────────────────────────────────
  const sizeD = perSuite + remainder;
  console.log(`\n=== Suite D: random everything — ${sizeD} casi ===`);
  let okD = 0;
  for (let i = 0; i < sizeD; i++) {
    // Mix: ~25% mode==2, ~12% idx==0xFFFF, resto random.
    const r = rng();
    let setup: CaseSetup;
    if (r < 0.25) {
      setup = makeSetup({ modeOverride: 2, idxOverride: Math.floor(rng() * 8) });
    } else if (r < 0.37) {
      setup = makeSetup({ idxOverride: 0xffff });
    } else {
      setup = makeSetup({ idxOverride: Math.floor(rng() * 8) });
    }
    if (runOneCase("D", i, setup)) okD++;
  }
  console.log(`  Match: ${okD}/${sizeD} = ${((okD / sizeD) * 100).toFixed(1)}%`);
  totalOk += okD;

  console.log(
    `\n=== TOTALE: ${totalOk}/${total} = ${((totalOk / total) * 100).toFixed(1)}% ===`,
  );
  if (firstFail !== null) {
    const f: FailRecord = firstFail;
    console.log(
      `  First fail (suite ${f.suite} tc=${f.i}): ${f.field} bin=0x${f.bin.toString(16)} ts=0x${f.ts.toString(16)}`,
    );
    console.log(
      `    mode=0x${f.setup.modeSel.toString(16)} idx=0x${f.setup.levelIdx.toString(16)} num=0x${f.setup.levelNum.toString(16)} fracPtr=0x${f.setup.fracPtr.toString(16)}`,
    );
    console.log(
      `    sentInit chain=0x${f.setup.sentInitChain.toString(16)} init=0x${f.setup.sentInitInit.toString(16)} helper=0x${f.setup.sentInitHelper.toString(16)}`,
    );
  }

  disposeCpu(cpu);
  exit(totalOk === total ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  exit(1);
});
