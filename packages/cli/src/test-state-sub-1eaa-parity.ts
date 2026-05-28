#!/usr/bin/env node
/**
 * test-state-sub-1eaa-parity.ts — differential FUN_1EAA vs stateSub1EAA.
 *
 *   for i in [0..count-1]:
 *     FUN_33F4(ptr + i*4, sext_w_l((tileId + i) & 0xFFFF), 0)
 *
 * **Strategia parity**:
 *   - Patch `FUN_33F4` with a **stub-probe** that records each call:
 *
 *   Stub bytes (22 byte):
 *     20 79 00 40 1C 00   movea.l (0x401C00).l, A0   ; A0 = current ptr
 *     20 EF 00 04         move.l  (4,SP), (A0)+      ; arg1 long → probe
 *     30 EF 00 0A         move.w  (10,SP), (A0)+     ; arg2 low word → probe
 *     23 C8 00 40 1C 00   move.l  A0, (0x401C00).l   ; update ptr
 *     4E 75               rts
 *
 *
 * **Test counts cap**: max 50 call per case → max 300 byte per test in probe.
 *
 * Suite testate:
 *   - A: count random in [1..20], ptr/tileId random
 *   - B: count = 1 (single call), corner edge
 *   - C: tileId base near 0xFFFF (wrap a 16 bit attraverso il loop)
 *   - D: count = 0 / count negative (no call expected)
 *
 * Uso: npx tsx packages/cli/src/test-state-sub-1eaa-parity.ts [N]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import {
  state as stateNs,
  stateSub1EAA as ssNs,
} from "@marble-love/engine";
import {
  createCpu,
  callFunction,
  pokeMem,
  peekMem,
  disposeCpu,
} from "./binary-oracle-lib.js";
import type { CpuSession } from "./binary-oracle-lib.js";

const FUN_1EAA = 0x00001eaa;
const FUN_33F4 = 0x000033f4;

// can descend to ~0x401EE0). Choose a low region in workRam.
const PROBE_PTR_ADDR = 0x00401000; // long: current write pointer
const PROBE_DATA_BASE = 0x00401010; // probe data starts here
const PROBE_DATA_END = 0x00401400; // exclusive (1008 byte → 168 call max)

/** Stub bytes per `FUN_33F4`: probe-recorder. 22 byte totali. */
const STUB_BYTES: readonly number[] = [
  0x20, 0x79, 0x00, 0x40, 0x10, 0x00, // movea.l (0x401000).l, A0
  0x20, 0xef, 0x00, 0x04, // move.l (4,SP), (A0)+
  0x30, 0xef, 0x00, 0x0a, // move.w (10,SP), (A0)+
  0x23, 0xc8, 0x00, 0x40, 0x10, 0x00, // move.l A0, (0x401000).l
  0x4e, 0x75, // rts
];

function patchStub(cpu: CpuSession): void {
  for (let i = 0; i < STUB_BYTES.length; i++) {
    pokeMem(cpu, FUN_33F4 + i, 1, STUB_BYTES[i]!);
  }
}

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) >>> 0;
    return ((s >>> 16) & 0xffff) / 0x10000;
  };
}

interface TestCase {
  arg1: number; // ptr (long)
  arg2: number; // tileId base (long; only low word used)
  arg3: number; // count (signed long)
}

function resetProbe(
  state: ReturnType<typeof stateNs.emptyGameState>,
  cpu: CpuSession,
): void {
  // PROBE_PTR_ADDR = PROBE_DATA_BASE (long, big-endian)
  pokeMem(cpu, PROBE_PTR_ADDR, 4, PROBE_DATA_BASE);
  state.workRam[PROBE_PTR_ADDR - 0x400000 + 0] = (PROBE_DATA_BASE >>> 24) & 0xff;
  state.workRam[PROBE_PTR_ADDR - 0x400000 + 1] = (PROBE_DATA_BASE >>> 16) & 0xff;
  state.workRam[PROBE_PTR_ADDR - 0x400000 + 2] = (PROBE_DATA_BASE >>> 8) & 0xff;
  state.workRam[PROBE_PTR_ADDR - 0x400000 + 3] = PROBE_DATA_BASE & 0xff;

  // Clear data area (entrambi)
  for (let a = PROBE_DATA_BASE; a < PROBE_DATA_END; a++) {
    pokeMem(cpu, a, 1, 0);
    state.workRam[a - 0x400000] = 0;
  }
}

/** Compare probe area byte-by-byte. Returns first diff or null. */
function compareProbe(
  state: ReturnType<typeof stateNs.emptyGameState>,
  cpu: CpuSession,
): { offset: number; bin: number; ts: number } | null {
  for (let i = 0; i < 4; i++) {
    const off = PROBE_PTR_ADDR - 0x400000 + i;
    const b = peekMem(cpu, PROBE_PTR_ADDR + i, 1);
    const t = state.workRam[off] ?? 0;
    if (b !== t) return { offset: PROBE_PTR_ADDR + i, bin: b, ts: t };
  }
  // Then the contents.
  for (let a = PROBE_DATA_BASE; a < PROBE_DATA_END; a++) {
    const b = peekMem(cpu, a, 1);
    const t = state.workRam[a - 0x400000] ?? 0;
    if (b !== t) return { offset: a, bin: b, ts: t };
  }
  return null;
}

function makeTsSubs(
  state: ReturnType<typeof stateNs.emptyGameState>,
): ssNs.StateSub1EAASubs {
  return {
    fun_33f4: (ptr: number, sextWord: number, _zero: number): void => {
      const wOff = PROBE_PTR_ADDR - 0x400000;
      const cur =
        (((state.workRam[wOff] ?? 0) << 24) |
          ((state.workRam[wOff + 1] ?? 0) << 16) |
          ((state.workRam[wOff + 2] ?? 0) << 8) |
          (state.workRam[wOff + 3] ?? 0)) >>>
        0;
      const dst = cur - 0x400000;
      state.workRam[dst + 0] = (ptr >>> 24) & 0xff;
      state.workRam[dst + 1] = (ptr >>> 16) & 0xff;
      state.workRam[dst + 2] = (ptr >>> 8) & 0xff;
      state.workRam[dst + 3] = ptr & 0xff;
      // low word identical to the original d3w -> matches).
      const w = sextWord & 0xffff;
      state.workRam[dst + 4] = (w >>> 8) & 0xff;
      state.workRam[dst + 5] = w & 0xff;
      const next = (cur + 6) >>> 0;
      state.workRam[wOff + 0] = (next >>> 24) & 0xff;
      state.workRam[wOff + 1] = (next >>> 16) & 0xff;
      state.workRam[wOff + 2] = (next >>> 8) & 0xff;
      state.workRam[wOff + 3] = next & 0xff;
    },
  };
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
  patchStub(cpu);

  const tsSubs = makeTsSubs(stateInst);

  let totalOk = 0;
  interface FailRecord {
    suite: string;
    tc: number;
    detail: string;
  }
  const failHolder: { value: FailRecord | null } = { value: null };

  function runOneCase(suite: string, tcIdx: number, tc: TestCase): boolean {
    cpu.system.setRegister("sp", 0x401f00);
    resetProbe(stateInst, cpu);

    // Run binary
    callFunction(cpu, FUN_1EAA, [tc.arg1, tc.arg2, tc.arg3]);

    // Run TS
    ssNs.stateSub1EAA(stateInst, tc.arg1, tc.arg2, tc.arg3, tsSubs);

    const diff = compareProbe(stateInst, cpu);
    if (diff === null) return true;

    if (failHolder.value === null) {
      failHolder.value = {
        suite,
        tc: tcIdx,
        detail:
          `@ workRam+0x${(diff.offset - 0x400000).toString(16)} ` +
          `bin=0x${diff.bin.toString(16)} ts=0x${diff.ts.toString(16)} ` +
          `(arg1=0x${tc.arg1.toString(16)} arg2=0x${tc.arg2.toString(16)} arg3=${tc.arg3 | 0})`,
      };
    }
    return false;
  }

  const rng = makeRng(0x1eaa);
  const ru32 = (): number =>
    ((Math.floor(rng() * 0x10000) << 16) | Math.floor(rng() * 0x10000)) >>> 0;

  // ─── Suite A: random ────────────────────────────────────────────────
  console.log(
    `\n=== stateSub1EAA (FUN_1EAA) — Suite A: random count [1..20] — ${perSuite} casi ===`,
  );
  let okA = 0;
  for (let i = 0; i < perSuite; i++) {
    const tc: TestCase = {
      arg1: ru32(),
      arg2: ru32(),
      arg3: 1 + Math.floor(rng() * 20),
    };
    if (runOneCase("A", i, tc)) okA++;
  }
  console.log(`  Match: ${okA}/${perSuite} = ${((okA / perSuite) * 100).toFixed(1)}%`);
  totalOk += okA;

  // ─── Suite B: count = 1 (single call) ───────────────────────────────
  console.log(
    `\n=== Suite B: count = 1 (single call) — ${perSuite} casi ===`,
  );
  let okB = 0;
  for (let i = 0; i < perSuite; i++) {
    const tc: TestCase = {
      arg1: ru32(),
      arg2: ru32(),
      arg3: 1,
    };
    if (runOneCase("B", i, tc)) okB++;
  }
  console.log(`  Match: ${okB}/${perSuite} = ${((okB / perSuite) * 100).toFixed(1)}%`);
  totalOk += okB;

  // ─── Suite C: tileId base near 0xFFFF (wrap a 16 bit) ────────────────
  console.log(
    `\n=== Suite C: tileId near wrap, count [3..15] — ${perSuite} casi ===`,
  );
  let okC = 0;
  for (let i = 0; i < perSuite; i++) {
    // Low word di arg2 in [0xFFF0, 0xFFFF] → durante il loop wrappa a 0
    const lo = (0xfff0 + Math.floor(rng() * 16)) & 0xffff;
    const arg2 = ((Math.floor(rng() * 0x10000) << 16) | lo) >>> 0;
    const tc: TestCase = {
      arg1: ru32(),
      arg2,
      arg3: 3 + Math.floor(rng() * 13),
    };
    if (runOneCase("C", i, tc)) okC++;
  }
  console.log(`  Match: ${okC}/${perSuite} = ${((okC / perSuite) * 100).toFixed(1)}%`);
  totalOk += okC;

  // ─── Suite D: count = 0 / negative (no call) ─────────────────────────
  const sizeD = perSuite + remainder;
  console.log(
    `\n=== Suite D: count <= 0 (no calls expected) — ${sizeD} casi ===`,
  );
  let okD = 0;
  for (let i = 0; i < sizeD; i++) {
    let arg3: number;
    if (i % 3 === 0) arg3 = 0;
    else if (i % 3 === 1) arg3 = -(1 + Math.floor(rng() * 100)); // small negative
    else arg3 = 0x80000000 | (Math.floor(rng() * 0x80000000) >>> 0); // large negative
    const tc: TestCase = {
      arg1: ru32(),
      arg2: ru32(),
      arg3,
    };
    if (runOneCase("D", i, tc)) okD++;
  }
  console.log(`  Match: ${okD}/${sizeD} = ${((okD / sizeD) * 100).toFixed(1)}%`);
  totalOk += okD;

  console.log(
    `\n=== TOTALE: ${totalOk}/${total} = ${((totalOk / total) * 100).toFixed(1)}% ===`,
  );
  if (failHolder.value !== null) {
    console.log(
      `  First fail (suite ${failHolder.value.suite} tc=${failHolder.value.tc}): ${failHolder.value.detail}`,
    );
  }

  disposeCpu(cpu);
  exit(totalOk === total ? 0 : 1);
}

main().catch(e => {
  console.error(e);
  exit(1);
});
