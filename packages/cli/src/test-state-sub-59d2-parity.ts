#!/usr/bin/env node
/**
 * test-state-sub-59d2-parity.ts — differential FUN_59D2 vs stateSub59D2.
 *
 * `FUN_000059D2` (140 byte): scaled-rate via 3 fetch + halve-loop + divu.w.
 *   denom = 2*F(4) + F(3); if 0 → ret 0.
 *   num = F(5).
 *   ret ((num & 0xFFFF) * 60) / (denom & 0xFFFF) quotient word (with divu.w
 *   overflow semantics: V flag -> D1 unchanged).
 *
 * `F(n)` = `FUN_000040D8(n)` (config-field fetch). The three ids used: 3, 4, 5.
 *
 * Strategia parity:
 *   - Patch RTS sull'entry di FUN_40D8 (0x40D8) per impedire l'esecuzione.
 *     iniettati in D0 a ciascuna entry callee.
 *   - Capture args on the stack at callee entry, also checking
 *
 * Uso: npx tsx packages/cli/src/test-state-sub-59d2-parity.ts [N]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import {
  state as stateNs,
  stateSub59D2 as subNs,
} from "@marble-love/engine";
import {
  createCpu,
  disposeCpu,
  pokeMem,
  peekMem,
  type CpuSession,
} from "./binary-oracle-lib.js";

const FUN_59D2 = 0x000059d2;
const FUN_40D8 = 0x000040d8;
const SENTINEL_RET = 0xcafebabe >>> 0;

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) >>> 0;
    return ((s >>> 16) & 0xffff) / 0x10000;
  };
}

/** Patcha RTS (0x4E75) all'entry di FUN_40D8. */
function patchCallees(cpu: CpuSession): void {
  // FUN_40D8: original word `movem.l {A2 D6 D5 D4 D3 D2},-(SP)` (0x48E7).
  // Patcha a 0x4E75 (rts).
  pokeMem(cpu, FUN_40D8 + 0, 1, 0x4e);
  pokeMem(cpu, FUN_40D8 + 1, 1, 0x75);
}

interface Call40D8 {
  fieldId: number;
  ret: number;
}

interface CapturedSeq {
  calls: Call40D8[];
  /** D0 al momento del rts di FUN_59D2. */
  finalD0: number;
  reachedRts: boolean;
}

/**
 * Esegue FUN_59D2 step-by-step.
 * For each FUN_40D8 entry, capture fieldId (on the stack at (4,SP)) and
 *
 * @param cpu       CPU session.
 */
function runAndCapture(
  cpu: CpuSession,
  ret40D8: readonly [number, number, number],
): CapturedSeq {
  const sys = cpu.system;

  const sp0 = 0x401f00;
  let sp = sp0;
  sp = (sp - 4) >>> 0;
  sys.write(sp, 4, SENTINEL_RET);
  sys.setRegister("sp", sp);
  sys.setRegister("pc", FUN_59D2);

  const calls: Call40D8[] = [];
  let idx = 0;
  let safety = 500;
  let reachedRts = false;
  let lastD0 = 0;

  while (safety-- > 0) {
    const pc = sys.getRegisters().pc >>> 0;
    if (pc === SENTINEL_RET) {
      reachedRts = true;
      lastD0 = sys.getRegisters().d0 >>> 0;
      break;
    }
    if (pc === FUN_40D8) {
      //   (0, SP)  = ret addr
      //   (4, SP)  = fieldId (long)
      const spNow = sys.getRegisters().sp >>> 0;
      const fid = peekMem(cpu, (spNow + 4) >>> 0, 4) >>> 0;
      const r = (ret40D8[idx] ?? 0) >>> 0;
      idx++;
      calls.push({ fieldId: fid, ret: r });
      sys.setRegister("d0", r);
    }
    sys.step();
  }

  return { calls, finalD0: lastD0, reachedRts };
}

interface TsCapture {
  calls: Call40D8[];
  finalD0: number;
}

function runTsAndCapture(
  state: stateNs.GameState,
  ret40D8: readonly [number, number, number],
): TsCapture {
  const calls: Call40D8[] = [];
  let idx = 0;

  const finalD0 = subNs.stateSub59D2(state, (_st, fieldId) => {
    const r = (ret40D8[idx] ?? 0) >>> 0;
    idx++;
    calls.push({ fieldId: fieldId >>> 0, ret: r });
    return r;
  });

  return { calls, finalD0: finalD0 >>> 0 };
}

function eqCall(a: Call40D8, b: Call40D8): boolean {
  return a.fieldId === b.fieldId && a.ret === b.ret;
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

  // Patch RTS sul callee (una sola volta — la patch persiste).
  patchCallees(cpu);

  console.log(`\n=== stateSub59D2 (FUN_59D2) — ${n} casi ===`);

  const rng = makeRng(0x59d259d2);
  let ok = 0;
  let firstFail: {
    i: number;
    rets: readonly [number, number, number];
    binFinal: number;
    tsFinal: number;
    binCalls: Call40D8[];
    tsCalls: Call40D8[];
  } | null = null;

  for (let i = 0; i < n; i++) {
    cpu.system.setRegister("sp", 0x401f00);

    // Pattern di copertura sui return di F(4), F(3), F(5).
    let rets: [number, number, number];
    if (i === 0) {
      // Early-exit: 2*F(4)+F(3) = 0 → ret 0
      rets = [0, 0, 0];
    } else if (i === 1) {
      // F(4)=20, F(3)=10 → denom=50. F(5)=30 → 30*60/50 = 36.
      rets = [20, 10, 30];
    } else if (i === 2) {
      // denom = 1, num = 100 → 6000 (no overflow, bypass halve).
      rets = [0, 1, 100];
    } else if (i === 3) {
      // divu overflow: denom=1, num=1100 → quoziente teorico 66000 > 0xFFFF.
      // D1 pre-divu = 1100*60 = 66000 = 0x101D0. Low word = 0x01D0.
      rets = [0, 1, 1100];
    } else if (i === 4) {
      // halve-loop ROUND-half: denom = 0x10000, num = 0x10000.
      // F(4)=0x8000, F(3)=0 → denom=0x10000. F(5)=0x10000.
      rets = [0x8000, 0, 0x10000];
    } else if (i === 5) {
      // halve-loop with LSR step: denom=0x30000, num=0x100.
      // F(4)=0x18000, F(3)=0 → 0x30000. F(5)=0x100.
      rets = [0x18000, 0, 0x100];
    } else if (i === 6) {
      // F(4) = -1 (= 0xFFFFFFFF) → asl wrap to 0xFFFFFFFE. F(3)=2 → denom=0 long.
      // → early-exit.
      rets = [0xffffffff >>> 0, 2, 100];
    } else if (i === 7) {
      // num overflow ma denom OK: F(4)=10, F(3)=0 → denom=20. F(5)=0x20000.
      // 0x20000 > 0xFFFF → halve. @5A1A: 0x20000 > 0x1FFFE → LSR.
      // d2 = 10, d1 = 0x10000. bra. @5A1A: 10 <= 0x1FFFE; d1 = 0x10000 <= 0x1FFFE → ROUND.
      // d2 = (10+1)>>1 = 5; d1 = 0x10001>>1 = 0x8000.
      // mulu: 0x8000*60 = 0x1E0000. divu: 0x1E0000/5 = 0x6000 (24576). > 0xFFFF? No, 0x6000 = 24576 ✓
      rets = [10, 0, 0x20000];
    } else if (i === 8) {
      // denom word-overflow only: F(4)=0x8001, F(3)=0 -> denom=0x10002. F(5)=10.
      // 0x10002 > 0xFFFF → halve. @5A1A: 0x10002 <= 0x1FFFE; 10 <= 0x1FFFE → ROUND.
      // d2 = (0x10002+1)>>1 = 0x8001; d1 = (10+1)>>1 = 5.
      // mulu: 5*60 = 300. divu: 300/0x8001 = 0.
      rets = [0x8001, 0, 10];
    } else if (i === 9) {
      // denom = 60 esatto, num = 1 → 60/60 = 1.
      rets = [30, 0, 1];
    } else if (i < 30) {
      // Sweep deterministico
      const seed = i - 10;
      rets = [
        (seed * 7) & 0xffff,
        (seed * 13) & 0xff,
        (seed * 17) & 0xffff,
      ];
    } else if (i < 100) {
      // Range-coverage: small denom, varied num
      const seed = i - 30;
      const f4 = (seed * 3 + 1) & 0x3ff;
      const f3 = (seed * 5) & 0x1ff;
      const f5 = (seed * 11) & 0xffff;
      rets = [f4, f3, f5];
    } else {
      // Random ampio
      const f4 = Math.floor(rng() * 0x100000) >>> 0;
      const f3 = Math.floor(rng() * 0x100000) >>> 0;
      const f5 = Math.floor(rng() * 0x100000) >>> 0;
      rets = [f4, f3, f5];
    }

    const bin = runAndCapture(cpu, rets);

    // Esegue TS.
    const ts = runTsAndCapture(state, rets);

    const sameCalls =
      bin.calls.length === ts.calls.length &&
      bin.calls.every((c, k) => eqCall(c, ts.calls[k]!));
    const sameFinal = bin.finalD0 === ts.finalD0;
    const match = bin.reachedRts && sameCalls && sameFinal;

    if (match) {
      ok++;
    } else if (firstFail === null) {
      firstFail = {
        i,
        rets,
        binFinal: bin.finalD0,
        tsFinal: ts.finalD0,
        binCalls: bin.calls,
        tsCalls: ts.calls,
      };
    }
  }

  console.log(`  Match: ${ok}/${n} = ${((ok / n) * 100).toFixed(1)}%`);
  if (firstFail) {
    console.log(`  First fail @ case ${firstFail.i}:`);
    console.log(
      `    rets: F(4)=0x${firstFail.rets[0].toString(16)} F(3)=0x${firstFail.rets[1].toString(16)} F(5)=0x${firstFail.rets[2].toString(16)}`,
    );
    console.log(
      `    bin calls: ${firstFail.binCalls
        .map((c) => `id=${c.fieldId}→0x${c.ret.toString(16)}`)
        .join(" | ")}`,
    );
    console.log(
      `    ts  calls: ${firstFail.tsCalls
        .map((c) => `id=${c.fieldId}→0x${c.ret.toString(16)}`)
        .join(" | ")}`,
    );
    console.log(`    bin final D0: 0x${firstFail.binFinal.toString(16)}`);
    console.log(`    ts  final D0: 0x${firstFail.tsFinal.toString(16)}`);
  }

  disposeCpu(cpu);
  exit(ok === n ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  exit(1);
});
