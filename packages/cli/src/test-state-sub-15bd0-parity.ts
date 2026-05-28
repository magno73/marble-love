#!/usr/bin/env node
/**
 * test-state-sub-15bd0-parity.ts — differential FUN_15BD0 vs `stateSub15BD0`.
 *
 *     FUN_18F46(2, sext_l(byte @ structPtr+0x19)).
 *   - Block B (gate `arg2.b != 0`): per i in [0..*0x400396) itera
 *     FUN_285B0(obj, 3).
 *
 * **Strategia stub**:
 *
 *      ~132 byte → spazio sufficiente).
 *
 *      88 byte → spazio sufficiente).
 *
 *     movea.l #RING_BASE, A0           ; 207C addr32          (6 byte)
 *     move.l  RING_COUNTER.l, D1       ; 2239 addr32          (6 byte)
 *     adda.l  D1, A0                   ; D1C1                 (2 byte)
 *     move.l  (4,SP), (A0)+            ; 20EF 0004            (4 byte)
 *     move.l  (8,SP), (A0)             ; 20AF 0008            (4 byte)
 *     addq.l  #8, RING_COUNTER.l       ; 50B9 addr32          (6 byte)
 *     rts                              ; 4E75                 (2 byte)
 *
 *   - A: random everything (count, struct bytes, obj states, args)
 *   - B: `arg3.b != 0, arg2.b == 0` -> Block A only
 *   - C: `arg3.b == 0, arg2.b != 0` -> Block B only (wide count variation
 *        e obj states per coprire skip/no-skip)
 *   - D: entrambi i block attivi + edge cases (count=0, count=20, byte19
 *
 *
 * Uso: npx tsx packages/cli/src/test-state-sub-15bd0-parity.ts [N]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import {
  state as stateNs,
  stateSub15BD0 as ns,
} from "@marble-love/engine";
import {
  createCpu,
  callFunction,
  pokeMem,
  peekMem,
  disposeCpu,
} from "./binary-oracle-lib.js";
import type { CpuSession } from "./binary-oracle-lib.js";

const FUN_15BD0 = 0x00015bd0;
const FUN_18F46 = 0x00018f46;
const FUN_285B0 = 0x000285b0;

// **Layout workRam scelto** (8 KB totali da 0x400000 a 0x402000):
//   0x401200..0x401240  : STRUCT_BASE (struct arg1 di test, 0x40 byte)
//   0x401240..0x401400  : RING_285B0 (192 byte) + counter
//   0x401400..0x401440  : RING_18F46 (64 byte) + counter
//
// 0x401440 — ampio).
const RING_285B0 = 0x00401240;
const RING_285B0_SIZE = 192;
const RING_285B0_COUNTER = 0x00401300;

const RING_18F46 = 0x00401320;
const RING_18F46_SIZE = 64;
const RING_18F46_COUNTER = 0x00401360;

// Struct passed as arg1 (structPtr).
const STRUCT_BASE = 0x00401200;
const STRUCT_SIZE = 0x40;

const OBJ_BASE = 0x00400018;
const OBJ_STRIDE = 0xe2;
const OBJ_COUNT_ADDR = 0x00400396;
const MAX_COUNT = 20;
// obj_array end = 0x400018 + 20*0xE2 = 0x4011B8 → strict less than STRUCT_BASE

function makeThunk(ringBase: number, counterAddr: number): number[] {
  const r = ringBase >>> 0;
  const c = counterAddr >>> 0;
  return [
    // movea.l #ring, A0  (207C imm32)
    0x20, 0x7c, (r >>> 24) & 0xff, (r >>> 16) & 0xff, (r >>> 8) & 0xff, r & 0xff,
    // move.l counter.l, D1  (2239 addr32)
    0x22, 0x39, (c >>> 24) & 0xff, (c >>> 16) & 0xff, (c >>> 8) & 0xff, c & 0xff,
    // adda.l D1, A0  (D1C1)
    0xd1, 0xc1,
    // move.l (4,SP), (A0)+  (20EF 0004)
    0x20, 0xef, 0x00, 0x04,
    // move.l (8,SP), (A0)   (20AF 0008)
    0x20, 0xaf, 0x00, 0x08,
    // addq.l #8, counter.l  (50B9 addr32)
    0x50, 0xb9, (c >>> 24) & 0xff, (c >>> 16) & 0xff, (c >>> 8) & 0xff, c & 0xff,
    // rts
    0x4e, 0x75,
  ];
}

function patchStub(cpu: CpuSession, addr: number, bytes: number[]): void {
  for (let i = 0; i < bytes.length; i++) {
    pokeMem(cpu, addr + i, 1, bytes[i]!);
  }
}

function patchSubs(cpu: CpuSession): void {
  patchStub(cpu, FUN_18F46, makeThunk(RING_18F46, RING_18F46_COUNTER));
  patchStub(cpu, FUN_285B0, makeThunk(RING_285B0, RING_285B0_COUNTER));
}

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) >>> 0;
    return ((s >>> 16) & 0xffff) / 0x10000;
  };
}

const WORK_RAM_BASE = 0x00400000;

function resetZones(
  state: ReturnType<typeof stateNs.emptyGameState>,
  cpu: CpuSession,
): void {
  // Ring 18f46 + counter
  for (let i = 0; i < RING_18F46_SIZE; i++) {
    pokeMem(cpu, RING_18F46 + i, 1, 0);
    state.workRam[(RING_18F46 - WORK_RAM_BASE) + i] = 0;
  }
  for (let i = 0; i < 4; i++) {
    pokeMem(cpu, RING_18F46_COUNTER + i, 1, 0);
    state.workRam[(RING_18F46_COUNTER - WORK_RAM_BASE) + i] = 0;
  }
  // Ring 285b0 + counter
  for (let i = 0; i < RING_285B0_SIZE; i++) {
    pokeMem(cpu, RING_285B0 + i, 1, 0);
    state.workRam[(RING_285B0 - WORK_RAM_BASE) + i] = 0;
  }
  for (let i = 0; i < 4; i++) {
    pokeMem(cpu, RING_285B0_COUNTER + i, 1, 0);
    state.workRam[(RING_285B0_COUNTER - WORK_RAM_BASE) + i] = 0;
  }
  // Struct base + size
  for (let i = 0; i < STRUCT_SIZE; i++) {
    pokeMem(cpu, STRUCT_BASE + i, 1, 0);
    state.workRam[(STRUCT_BASE - WORK_RAM_BASE) + i] = 0;
  }
  for (let i = 0; i < MAX_COUNT * OBJ_STRIDE; i++) {
    pokeMem(cpu, OBJ_BASE + i, 1, 0);
    state.workRam[(OBJ_BASE - WORK_RAM_BASE) + i] = 0;
  }
  // Count word
  pokeMem(cpu, OBJ_COUNT_ADDR, 1, 0);
  pokeMem(cpu, OBJ_COUNT_ADDR + 1, 1, 0);
  state.workRam[(OBJ_COUNT_ADDR - WORK_RAM_BASE)] = 0;
  state.workRam[(OBJ_COUNT_ADDR - WORK_RAM_BASE) + 1] = 0;
}

function pokeByteBoth(
  state: ReturnType<typeof stateNs.emptyGameState>,
  cpu: CpuSession,
  abs: number,
  v: number,
): void {
  pokeMem(cpu, abs, 1, v & 0xff);
  state.workRam[abs - WORK_RAM_BASE] = v & 0xff;
}

function pokeWordBoth(
  state: ReturnType<typeof stateNs.emptyGameState>,
  cpu: CpuSession,
  abs: number,
  v: number,
): void {
  pokeByteBoth(state, cpu, abs, (v >>> 8) & 0xff);
  pokeByteBoth(state, cpu, abs + 1, v & 0xff);
}

function compareZone(
  state: ReturnType<typeof stateNs.emptyGameState>,
  cpu: CpuSession,
  base: number,
  size: number,
  label: string,
): { offset: number; bin: number; ts: number; label: string } | null {
  for (let i = 0; i < size; i++) {
    const b = peekMem(cpu, base + i, 1) & 0xff;
    const t = state.workRam[(base - WORK_RAM_BASE) + i] ?? 0;
    if (b !== t) return { offset: base + i, bin: b, ts: t, label };
  }
  return null;
}

interface CaseSetup {
  count: number;
  structBytes: number[];
  objStateBytes: number[];
  arg2Long: number;
  arg3Long: number;
  structPtrLong: number;
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

  const state = stateNs.emptyGameState();
  const cpu = await createCpu({ rom, state });
  patchSubs(cpu);

  // TS subs replicano gli stub binari sul state.workRam.
  const subs: ns.StateSub15BD0Subs = {
    fun_18f46: (arg1Long, arg2Long) => {
      const r = state.workRam;
      const cOff = RING_18F46_COUNTER - WORK_RAM_BASE;
      const counter =
        (((r[cOff] ?? 0) << 24) |
          ((r[cOff + 1] ?? 0) << 16) |
          ((r[cOff + 2] ?? 0) << 8) |
          (r[cOff + 3] ?? 0)) >>>
        0;
      const off = (RING_18F46 - WORK_RAM_BASE) + counter;
      const wL = (base: number, val: number): void => {
        const u = val >>> 0;
        r[base] = (u >>> 24) & 0xff;
        r[base + 1] = (u >>> 16) & 0xff;
        r[base + 2] = (u >>> 8) & 0xff;
        r[base + 3] = u & 0xff;
      };
      wL(off, arg1Long);
      wL(off + 4, arg2Long);
      const next = (counter + 8) >>> 0;
      r[cOff] = (next >>> 24) & 0xff;
      r[cOff + 1] = (next >>> 16) & 0xff;
      r[cOff + 2] = (next >>> 8) & 0xff;
      r[cOff + 3] = next & 0xff;
    },
    fun_285b0: (objAddr, eventByte) => {
      const r = state.workRam;
      const cOff = RING_285B0_COUNTER - WORK_RAM_BASE;
      const counter =
        (((r[cOff] ?? 0) << 24) |
          ((r[cOff + 1] ?? 0) << 16) |
          ((r[cOff + 2] ?? 0) << 8) |
          (r[cOff + 3] ?? 0)) >>>
        0;
      const off = (RING_285B0 - WORK_RAM_BASE) + counter;
      const wL = (base: number, val: number): void => {
        const u = val >>> 0;
        r[base] = (u >>> 24) & 0xff;
        r[base + 1] = (u >>> 16) & 0xff;
        r[base + 2] = (u >>> 8) & 0xff;
        r[base + 3] = u & 0xff;
      };
      wL(off, objAddr);
      wL(off + 4, eventByte);
      const next = (counter + 8) >>> 0;
      r[cOff] = (next >>> 24) & 0xff;
      r[cOff + 1] = (next >>> 16) & 0xff;
      r[cOff + 2] = (next >>> 8) & 0xff;
      r[cOff + 3] = next & 0xff;
    },
  };

  let totalOk = 0;
  interface FailRecord {
    suite: string;
    tc: number;
    setup: CaseSetup;
    diff: { offset: number; bin: number; ts: number; label: string };
  }
  const failHolder: { value: FailRecord | null } = { value: null };

  function runOneCase(suite: string, tc: number, setup: CaseSetup): boolean {
    cpu.system.setRegister("sp", 0x401f00);
    resetZones(state, cpu);

    // Setup struct bytes
    for (let i = 0; i < STRUCT_SIZE; i++) {
      pokeByteBoth(state, cpu, STRUCT_BASE + i, setup.structBytes[i] ?? 0);
    }
    // Setup count word
    pokeWordBoth(state, cpu, OBJ_COUNT_ADDR, setup.count);
    // Setup obj state bytes (only first `count` slots needed by func, ma
    // set only `count` to avoid dirtying the rest).
    for (let i = 0; i < setup.count; i++) {
      const objAddr = OBJ_BASE + i * OBJ_STRIDE;
      pokeByteBoth(state, cpu, objAddr + 0x18, setup.objStateBytes[i] ?? 0);
    }

    callFunction(cpu, FUN_15BD0, [
      setup.structPtrLong >>> 0,
      setup.arg2Long >>> 0,
      setup.arg3Long >>> 0,
    ]);

    // Run TS
    ns.stateSub15BD0(
      state,
      setup.structPtrLong >>> 0,
      setup.arg2Long >>> 0,
      setup.arg3Long >>> 0,
      subs,
    );

    // Compara: ring18f46 + counter18f46 + ring285b0 + counter285b0 +
    //          struct bytes + obj state bytes (first count) + count word.
    const checks: { base: number; size: number; label: string }[] = [
      { base: RING_18F46, size: RING_18F46_SIZE, label: "ring18f46" },
      { base: RING_18F46_COUNTER, size: 4, label: "counter18f46" },
      { base: RING_285B0, size: RING_285B0_SIZE, label: "ring285b0" },
      { base: RING_285B0_COUNTER, size: 4, label: "counter285b0" },
      { base: STRUCT_BASE, size: STRUCT_SIZE, label: "struct" },
      { base: OBJ_COUNT_ADDR, size: 2, label: "objCount" },
    ];
    for (let i = 0; i < setup.count; i++) {
      checks.push({
        base: OBJ_BASE + i * OBJ_STRIDE + 0x18,
        size: 1,
        label: `obj${i}+0x18`,
      });
    }

    for (const ck of checks) {
      const d = compareZone(state, cpu, ck.base, ck.size, ck.label);
      if (d !== null) {
        if (failHolder.value === null) {
          failHolder.value = { suite, tc, setup, diff: d };
        }
        return false;
      }
    }
    return true;
  }

  const rng = makeRng(0x15bd0);
  const rb = (): number => Math.floor(rng() * 256) & 0xff;
  const rl = (): number =>
    ((Math.floor(rng() * 0x10000) << 16) | Math.floor(rng() * 0x10000)) >>> 0;

  function makeRandomCase(args: {
    arg2Long: number;
    arg3Long: number;
    count: number;
    structPtrLong: number;
    forceStateAll?: number;
  }): CaseSetup {
    return {
      count: args.count,
      structBytes: new Array(STRUCT_SIZE).fill(0).map(() => rb()),
      objStateBytes: new Array(args.count)
        .fill(0)
        .map(() => (args.forceStateAll !== undefined ? args.forceStateAll : rb())),
      arg2Long: args.arg2Long,
      arg3Long: args.arg3Long,
      structPtrLong: args.structPtrLong,
    };
  }

  // ── Suite A: random everything ────────────────────────────────────────
  console.log(
    `\n=== stateSub15BD0 (FUN_15BD0) — Suite A: random everything — ${perSuite} casi ===`,
  );
  let okA = 0;
  for (let i = 0; i < perSuite; i++) {
    const count = Math.floor(rng() * (MAX_COUNT + 1)); // 0..MAX_COUNT
    const setup = makeRandomCase({
      arg2Long: rl(),
      arg3Long: rl(),
      count,
      structPtrLong: STRUCT_BASE >>> 0,
    });
    if (runOneCase("A", i, setup)) okA++;
  }
  console.log(`  Match: ${okA}/${perSuite} = ${((okA / perSuite) * 100).toFixed(1)}%`);
  totalOk += okA;

  // Suite B: Block A only (arg3.b != 0, arg2.b == 0).
  console.log(
    `\n=== Suite B: solo Block A (arg3.b≠0, arg2.b==0) — ${perSuite} casi ===`,
  );
  let okB = 0;
  for (let i = 0; i < perSuite; i++) {
    let arg3 = rl();
    if ((arg3 & 0xff) === 0) arg3 = (arg3 & 0xffffff00) | 1;
    const arg2 = rl() & 0xffffff00; // low byte = 0
    const count = Math.floor(rng() * (MAX_COUNT + 1));
    const setup = makeRandomCase({
      arg2Long: arg2,
      arg3Long: arg3,
      count,
      structPtrLong: STRUCT_BASE >>> 0,
    });
    if (runOneCase("B", i, setup)) okB++;
  }
  console.log(`  Match: ${okB}/${perSuite} = ${((okB / perSuite) * 100).toFixed(1)}%`);
  totalOk += okB;

  // Suite C: Block B only (arg3.b == 0, arg2.b != 0).
  console.log(
    `\n=== Suite C: solo Block B (arg3.b==0, arg2.b≠0) — ${perSuite} casi ===`,
  );
  let okC = 0;
  for (let i = 0; i < perSuite; i++) {
    const arg3 = rl() & 0xffffff00; // low byte = 0
    let arg2 = rl();
    if ((arg2 & 0xff) === 0) arg2 = (arg2 & 0xffffff00) | 1;
    // count varia tra 0 e MAX_COUNT.
    const count = Math.floor(rng() * (MAX_COUNT + 1));
    const setup = makeRandomCase({
      arg2Long: arg2,
      arg3Long: arg3,
      count,
      structPtrLong: STRUCT_BASE >>> 0,
    });
    if (runOneCase("C", i, setup)) okC++;
  }
  console.log(`  Match: ${okC}/${perSuite} = ${((okC / perSuite) * 100).toFixed(1)}%`);
  totalOk += okC;

  // ── Suite D: entrambi i block + edge cases ────────────────────────────
  const sizeD = perSuite + remainder;
  console.log(`\n=== Suite D: entrambi block + edge cases — ${sizeD} casi ===`);
  let okD = 0;
  for (let i = 0; i < sizeD; i++) {
    let arg2 = rl();
    if ((arg2 & 0xff) === 0) arg2 = (arg2 & 0xffffff00) | 1;
    let arg3 = rl();
    if ((arg3 & 0xff) === 0) arg3 = (arg3 & 0xffffff00) | 1;
    let count: number;
    let forceStateAll: number | undefined;
    // Edge case mix:
    const edge = i % 5;
    if (edge === 0) count = 0;             // count == 0 → Block B body skip
    else if (edge === 1) count = MAX_COUNT; // max count
    else if (edge === 2) {
      count = Math.floor(rng() * (MAX_COUNT + 1));
      forceStateAll = 0;
    } else if (edge === 3) {
      count = Math.floor(rng() * (MAX_COUNT + 1));
      forceStateAll = 2;
    } else {
      count = Math.floor(rng() * (MAX_COUNT + 1));
    }
    const setup: CaseSetup = {
      count,
      structBytes: new Array(STRUCT_SIZE).fill(0).map(() => rb()),
      objStateBytes: new Array(count)
        .fill(0)
        .map(() => (forceStateAll !== undefined ? forceStateAll : rb())),
      arg2Long: arg2,
      arg3Long: arg3,
      structPtrLong: STRUCT_BASE >>> 0,
    };
    // Edge: byte19 with bit 7 set (sext_l = 0xFFFFFFxx).
    if (i % 7 === 0) setup.structBytes[0x19] = 0xff;
    if (i % 11 === 0) setup.structBytes[0x19] = 0x80;

    if (runOneCase("D", i, setup)) okD++;
  }
  console.log(`  Match: ${okD}/${sizeD} = ${((okD / sizeD) * 100).toFixed(1)}%`);
  totalOk += okD;

  console.log(
    `\n=== TOTALE: ${totalOk}/${total} = ${((totalOk / total) * 100).toFixed(1)}% ===`,
  );
  if (failHolder.value !== null) {
    const f = failHolder.value;
    console.log(
      `  First fail (suite ${f.suite} tc=${f.tc}): ${f.diff.label} @ 0x${f.diff.offset.toString(16)} ` +
      `bin=0x${f.diff.bin.toString(16)} ts=0x${f.diff.ts.toString(16)} ` +
      `count=${f.setup.count} arg2=0x${f.setup.arg2Long.toString(16)} arg3=0x${f.setup.arg3Long.toString(16)}`,
    );
  }

  disposeCpu(cpu);
  exit(totalOk === total ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  exit(1);
});
