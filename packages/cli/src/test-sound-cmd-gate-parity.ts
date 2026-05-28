#!/usr/bin/env node
/**
 * test-sound-cmd-gate-parity.ts — differential FUN_4420 vs soundCmdGate.
 *
 * `FUN_00004442`.
 *
 * Strategia di parity test:
 *     point), then read the 2 longs on the stack `(0x4,SP)` and
 *     `(0x8,SP)` (stack as seen by the callee with ret addr at (0,SP)).
 *     that captures the same parameters.
 *
 * Uso: npx tsx packages/cli/src/test-sound-cmd-gate-parity.ts [N]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import { soundCmdGate as gateNs, state as stateNs } from "@marble-love/engine";
import {
  createCpu,
  disposeCpu,
  peekMem,
} from "./binary-oracle-lib.js";

const FUN_4420 = 0x00004420;
const FUN_4442 = 0x00004442;
const SENTINEL_RET = 0xcafebabe >>> 0;

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) >>> 0;
    return ((s >>> 16) & 0xffff) / 0x10000;
  };
}

interface Captured {
  cmdIdx: number;
  data: number;
}

function captureEnter4442Args(
  cpu: Awaited<ReturnType<typeof createCpu>>,
  cmdIdx: number,
  data: number,
): Captured {
  const sys = cpu.system;

  const sp0 = 0x401f00;
  let sp = sp0;
  sp = (sp - 4) >>> 0;
  sys.write(sp, 4, data >>> 0);
  sp = (sp - 4) >>> 0;
  sys.write(sp, 4, cmdIdx >>> 0);
  // Push sentinel return address
  sp = (sp - 4) >>> 0;
  sys.write(sp, 4, SENTINEL_RET);

  sys.setRegister("sp", sp);
  sys.setRegister("pc", FUN_4420);

  let reached = false;
  for (let i = 0; i < 200; i++) {
    if (sys.getRegisters().pc === FUN_4442) {
      reached = true;
      break;
    }
    if (sys.getRegisters().pc === SENTINEL_RET) break;
    sys.step();
  }

  if (!reached) {
    return { cmdIdx: -1, data: -1 };
  }

  // (4,SP)=arg1, (8,SP)=arg2.
  const spNow = sys.getRegisters().sp;
  const seenCmdIdx = peekMem(cpu, spNow + 4, 4) >>> 0;
  const seenData = peekMem(cpu, spNow + 8, 4) >>> 0;
  return { cmdIdx: seenCmdIdx, data: seenData };
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

  console.log(`\n=== soundCmdGate (FUN_4420) — ${n} casi ===`);

  const rng = makeRng(0xdeadbeef);
  let ok = 0;
  let firstFail: {
    i: number;
    cmdIdx: number;
    data: number;
    binCmd: number;
    binData: number;
    tsCmd: number;
    tsData: number;
  } | null = null;

  for (let i = 0; i < n; i++) {
    // Pattern: cover boundary cases + random
    let cmdIdx: number;
    let data: number;
    if (i === 0) {
      cmdIdx = 0x00; data = 0x12345678;        // clear path
    } else if (i === 1) {
      cmdIdx = 0x0a; data = 0xffffffff;        // boundary clear (max)
    } else if (i === 2) {
      cmdIdx = 0x0b; data = 0xcafebabe;        // boundary no-clear
    } else if (i === 3) {
      cmdIdx = 0x0c; data = 0xdeadbeef;        // typical caller value
    } else if (i === 4) {
      cmdIdx = 0xffffffff >>> 0; data = 0x42;  // huge unsigned, no clear
    } else if (i < 30) {
      // Sweep cmdIdx in [0, 0x14] (covers the 0x0B edge with margin).
      cmdIdx = (i - 5) & 0x1f;
      data = Math.floor(rng() * 0x100000000) >>> 0;
    } else {
      // Bias: 30% nel range [0,0x14] per stressare il bordo, 70% full random
      const inBoundary = rng() < 0.3;
      cmdIdx = inBoundary
        ? Math.floor(rng() * 0x15)
        : Math.floor(rng() * 0x100000000) >>> 0;
      data = Math.floor(rng() * 0x100000000) >>> 0;
    }

    // Run binary: capture args received by 4442.
    const bin = captureEnter4442Args(cpu, cmdIdx, data);

    // Run TS: capture args received by inner.
    let tsCmd = -1;
    let tsData = -1;
    gateNs.soundCmdGate(cmdIdx, data, (cidx: number, d: number) => {
      tsCmd = cidx;
      tsData = d;
      return 0;
    });

    const match =
      bin.cmdIdx === tsCmd &&
      bin.data === tsData &&
      bin.cmdIdx !== -1; // -1 = capture failure
    if (match) {
      ok++;
    } else if (firstFail === null) {
      firstFail = {
        i,
        cmdIdx,
        data,
        binCmd: bin.cmdIdx,
        binData: bin.data,
        tsCmd,
        tsData,
      };
    }
  }

  console.log(`  Match: ${ok}/${n} = ${((ok / n) * 100).toFixed(1)}%`);
  if (firstFail) {
    console.log(`  First fail @ case ${firstFail.i}:`);
    console.log(
      `    inputs: cmdIdx=0x${firstFail.cmdIdx.toString(16)} data=0x${firstFail.data.toString(16)}`,
    );
    console.log(
      `    bin: cmdIdx=0x${firstFail.binCmd.toString(16)} data=0x${firstFail.binData.toString(16)}`,
    );
    console.log(
      `    ts : cmdIdx=0x${firstFail.tsCmd.toString(16)} data=0x${firstFail.tsData.toString(16)}`,
    );
  }

  disposeCpu(cpu);
  exit(ok === n ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  exit(1);
});
