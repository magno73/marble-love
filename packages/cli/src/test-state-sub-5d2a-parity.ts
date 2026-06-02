#!/usr/bin/env node
/**
 * test-state-sub-5d2a-parity.ts — differential FUN_5D2A vs stateSub5D2A.
 *
 * `FUN_00005D2A` (194 bytes): row-render with bit-mask scan. Iterates 16 times
 *
 * Parity-test strategy:
 *   - Patch RTS (0x4E75) at the entry of FUN_3784 to intercept each call.
 *   - Inject ROM byte @ 0x10072 via pokeMem (Musashi unified memory).
 *   - Pushes 2 long args + sentinel return address on the stack.
 *     TS callback (inner3784).
 *
 * Usage: npx tsx packages/cli/src/test-state-sub-5d2a-parity.ts [N]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import {
  state as stateNs,
  bus as busNs,
  stateSub5D2A as subNs,
} from "@marble-love/engine";
import type { RomImage } from "@marble-love/engine";
import {
  createCpu,
  disposeCpu,
  pokeMem,
  peekMem,
  type CpuSession,
} from "./binary-oracle-lib.js";

const FUN_5D2A = 0x00005d2a;
const FUN_3784 = 0x00003784;
const SENTINEL_RET = 0xcafebabe >>> 0;

const ROM_GATE_BYTE_ADDR = 0x00010072;

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) >>> 0;
    return ((s >>> 16) & 0xffff) / 0x10000;
  };
}

/** Patch RTS (0x4E75) at the entry of FUN_3784. */
function patchCallees(cpu: CpuSession): void {
  pokeMem(cpu, FUN_3784 + 0, 1, 0x4e);
  pokeMem(cpu, FUN_3784 + 1, 1, 0x75);
}

interface Call3784 {
  y: number;
  x: number;
  attr: number;
  extra: number;
}

interface CapturedSeq {
  calls: Call3784[];
  reachedRts: boolean;
  finalD0: number;
}

/**
 * Run FUN_5D2A step-by-step and capture args at FUN_3784 entries.
 *
 *
 * FUN_3784 args on the stack (RTL push order = arg4, attr, x, y):
 *   (0,SP)  = ret addr (toward 0x5DB4 or 0x5DD4)
 *   (4,SP)  = y (long, sign-ext from D6w)
 *   (8,SP)  = x (long, sign-extended sum A3+A4 or (15-A4)+A3)
 */
function runAndCapture(
  cpu: CpuSession,
  arg0Long: number,
  arg1Long: number,
): CapturedSeq {
  const sys = cpu.system;

  const sp0 = 0x401f00;
  let sp = sp0;
  // Push arg1 (RTL: arg1 first, arg0 second so arg0 ends on top below ret).
  sp = (sp - 4) >>> 0;
  sys.write(sp, 4, arg1Long >>> 0);
  sp = (sp - 4) >>> 0;
  sys.write(sp, 4, arg0Long >>> 0);
  sp = (sp - 4) >>> 0;
  sys.write(sp, 4, SENTINEL_RET);
  sys.setRegister("sp", sp);
  sys.setRegister("pc", FUN_5D2A);

  const calls: Call3784[] = [];

  // Steps needed: ~16 iter × ~30 instr = ~500. Plus overhead.
  // We use 2000 as safety.
  let safety = 2000;
  let reachedRts = false;
  let lastD0 = 0;
  while (safety-- > 0) {
    const pc = sys.getRegisters().pc >>> 0;
    if (pc === SENTINEL_RET) {
      reachedRts = true;
      lastD0 = sys.getRegisters().d0 >>> 0;
      break;
    }
    if (pc === FUN_3784) {
      const spNow = sys.getRegisters().sp >>> 0;
      const y = peekMem(cpu, (spNow + 4) >>> 0, 4) >>> 0;
      const x = peekMem(cpu, (spNow + 8) >>> 0, 4) >>> 0;
      const attr = peekMem(cpu, (spNow + 12) >>> 0, 4) >>> 0;
      const extra = peekMem(cpu, (spNow + 16) >>> 0, 4) >>> 0;
      calls.push({ y, x, attr, extra });
    }
    sys.step();
  }

  return { calls, reachedRts, finalD0: lastD0 };
}

interface TsCapture {
  calls: Call3784[];
  finalD0: number;
}

function runTsAndCapture(
  state: stateNs.GameState,
  rom: RomImage,
  arg0Long: number,
  arg1Long: number,
): TsCapture {
  const calls: Call3784[] = [];
  const finalD0 = subNs.stateSub5D2A(
    state,
    rom,
    arg0Long,
    arg1Long,
    (_st, y, x, attr, extra) => {
      calls.push({ y, x, attr, extra });
      return 0;
                 // we do not compare it (the loop overwrites D0 on each iter).
    },
  );
  return { calls, finalD0: finalD0 >>> 0 };
}

function eqCall(a: Call3784, b: Call3784): boolean {
  return a.y === b.y && a.x === b.x && a.attr === b.attr && a.extra === b.extra;
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

  // Patch RTS over the callees (just once).
  patchCallees(cpu);

  const tsRom: RomImage = busNs.emptyRomImage();
  tsRom.program.set(rom.subarray(0, tsRom.program.length));

  console.log(`\n=== stateSub5D2A (FUN_5D2A) — ${n} cases ===`);

  const rng = makeRng(0x5d2a5d2a);
  let ok = 0;
  let firstFail: {
    i: number;
    arg0: number;
    arg1: number;
    gateByte: number;
    binCalls: Call3784[];
    tsCalls: Call3784[];
  } | null = null;

  for (let i = 0; i < n; i++) {
    cpu.system.setRegister("sp", 0x401f00);

    // Coverage pattern over (arg0, arg1, gate byte).
    let arg0: number;
    let arg1: number;
    let gateByte: number;
    if (i === 0) {
      arg0 = 0xa5a5;
      arg1 = 0x0007;
      gateByte = 0x00;
    } else if (i === 1) {
      // gate=1: override A3=4, D5w=0xFFF5.
      arg0 = 0xffff;
      arg1 = 0x000f;
      gateByte = 0x01;
    } else if (i === 2) {
      arg0 = 0x00000000;
      arg1 = 0x0000;
      gateByte = 0x00;
    } else if (i === 3) {
      arg0 = 0x0000ffff;
      arg1 = 0x0010; // > 15 → no highlight
      gateByte = 0x00;
    } else if (i === 4) {
      // gate=0xFF (max byte non-zero).
      arg0 = 0x55aa;
      arg1 = 0x0008;
      gateByte = 0xff;
    } else if (i === 5) {
      arg0 = 0xdeadbeef;
      arg1 = 0xcafe000a; // arg1 low = 0x000a
      gateByte = 0x00;
    } else if (i === 6) {
      // arg1 in range 0..15 but non match D4: arg1 = 0x42 → no highlight.
      arg0 = 0x1234;
      arg1 = 0x0042;
      gateByte = 0x00;
    } else if (i === 7) {
      // Sweep arg1 = 0..15 sequentially via i mod.
      arg0 = 0x8421;
      arg1 = 0x0000;
      gateByte = 0x00;
    } else if (i < 24) {
      // Deterministic sweep arg1 = 0..15.
      arg0 = (i * 0x1111) & 0xffff;
      arg1 = (i - 8) & 0xf;
      gateByte = 0x00;
    } else if (i < 40) {
      // Sweep gate byte values with random arg0/arg1.
      arg0 = Math.floor(rng() * 0x10000) & 0xffff;
      arg1 = Math.floor(rng() * 0x20) & 0x1f;
      gateByte = (i - 24) & 0xff;
    } else {
      // Random.
      arg0 = Math.floor(rng() * 0x100000000) >>> 0;
      arg1 = Math.floor(rng() * 0x100000000) >>> 0;
      gateByte = Math.floor(rng() * 0x100) & 0xff;
    }

    // Inject gate byte in ROM (Musashi unified memory) and TS mirror.
    pokeMem(cpu, ROM_GATE_BYTE_ADDR, 1, gateByte);
    tsRom.program[ROM_GATE_BYTE_ADDR] = gateByte & 0xff;

    const bin = runAndCapture(cpu, arg0, arg1);

    // Run TS and capture.
    const ts = runTsAndCapture(state, tsRom, arg0, arg1);

    const sameLen = bin.calls.length === ts.calls.length;
    const sameCalls = sameLen && bin.calls.every((c, k) => eqCall(c, ts.calls[k]!));
    const match = bin.reachedRts && sameCalls;

    if (match) {
      ok++;
    } else if (firstFail === null) {
      firstFail = {
        i,
        arg0,
        arg1,
        gateByte,
        binCalls: bin.calls,
        tsCalls: ts.calls,
      };
    }
  }

  console.log(`  Match: ${ok}/${n} = ${((ok / n) * 100).toFixed(1)}%`);
  if (firstFail) {
    console.log(`  First fail @ case ${firstFail.i}:`);
    console.log(
      `    inputs: arg0=0x${firstFail.arg0.toString(16)} arg1=0x${firstFail.arg1.toString(16)} gateByte=0x${firstFail.gateByte.toString(16)}`,
    );
    console.log(`    bin calls len: ${firstFail.binCalls.length}`);
    console.log(`    ts  calls len: ${firstFail.tsCalls.length}`);
    const lim = Math.min(8, Math.max(firstFail.binCalls.length, firstFail.tsCalls.length));
    for (let k = 0; k < lim; k++) {
      const b = firstFail.binCalls[k];
      const t = firstFail.tsCalls[k];
      const bs = b
        ? `(y=${b.y.toString(16)} x=${b.x.toString(16)} attr=${b.attr.toString(16)} ex=${b.extra.toString(16)})`
        : "—";
      const ts2 = t
        ? `(y=${t.y.toString(16)} x=${t.x.toString(16)} attr=${t.attr.toString(16)} ex=${t.extra.toString(16)})`
        : "—";
      console.log(`    call[${k}]: bin=${bs}  ts=${ts2}`);
    }
  }

  disposeCpu(cpu);
  exit(ok === n ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  exit(1);
});
