#!/usr/bin/env node
/**
 * test-trackball-input-parity.ts — differential FUN_1AC18 vs trackballInputTick.
 *
 * Per N test cases:
 *   1. Setup obj fields (0xC6/C7/C8/C9 per obj 0 e 1)
 *   2. Setup MMIO trackball ports (0xF20001, 0xF20003, 0xF20005, 0xF20007)
 *   3. callFunction(0x1AC18) — no args
 *   4. trackballInputTick(state, p1X, p1Y, p2X, p2Y)
 *   5. Confronta delta + saved per entrambi obj
 *
 * Uso: npx tsx packages/cli/src/test-trackball-input-parity.ts [N]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import { state as stateNs, trackballInput } from "@marble-love/engine";
import {
  createCpu,
  callFunction,
  pokeMem,
  peekMem,
  disposeCpu,
} from "./binary-oracle-lib.js";
import type { CpuSession } from "./binary-oracle-lib.js";

const FUN_TRACKBALL = 0x00001ac18;

interface ObjectInputState {
  trackballX: number;  // +0xC9
  deltaX: number;      // +0xC7
  trackballY: number;  // +0xC8
  deltaY: number;      // +0xC6
}

interface TestCase {
  obj0Initial: ObjectInputState;
  obj1Initial: ObjectInputState;
  mmioP1X: number;
  mmioP1Y: number;
  mmioP2X: number;
  mmioP2Y: number;
}

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) >>> 0;
    return ((s >>> 16) & 0xffff) / 0x10000;
  };
}

function randomByte(rng: () => number): number {
  return Math.floor(rng() * 256) & 0xff;
}

function generate(rng: () => number): TestCase {
  return {
    obj0Initial: {
      trackballX: randomByte(rng),
      deltaX: randomByte(rng),
      trackballY: randomByte(rng),
      deltaY: randomByte(rng),
    },
    obj1Initial: {
      trackballX: randomByte(rng),
      deltaX: randomByte(rng),
      trackballY: randomByte(rng),
      deltaY: randomByte(rng),
    },
    mmioP1X: randomByte(rng),
    mmioP1Y: randomByte(rng),
    mmioP2X: randomByte(rng),
    mmioP2Y: randomByte(rng),
  };
}

function applyTestCase(cpu: CpuSession, state: stateNs.GameState, tc: TestCase): void {
  const objBase = 0x400018;
  const stride = 0xe2;

  for (let p = 0; p < 2; p++) {
    const init = p === 0 ? tc.obj0Initial : tc.obj1Initial;
    const objAddr = objBase + p * stride;
    const objOff = objAddr - 0x400000;
    pokeMem(cpu, objAddr + 0xc6, 1, init.deltaY);
    pokeMem(cpu, objAddr + 0xc7, 1, init.deltaX);
    pokeMem(cpu, objAddr + 0xc8, 1, init.trackballY);
    pokeMem(cpu, objAddr + 0xc9, 1, init.trackballX);
    state.workRam[objOff + 0xc6] = init.deltaY;
    state.workRam[objOff + 0xc7] = init.deltaX;
    state.workRam[objOff + 0xc8] = init.trackballY;
    state.workRam[objOff + 0xc9] = init.trackballX;
  }

  // MMIO trackball values (low byte at 0xF20001, 0xF20003, 0xF20005, 0xF20007)
  pokeMem(cpu, 0xf20001, 1, tc.mmioP1X);
  pokeMem(cpu, 0xf20003, 1, tc.mmioP1Y);
  pokeMem(cpu, 0xf20005, 1, tc.mmioP2X);
  pokeMem(cpu, 0xf20007, 1, tc.mmioP2Y);
}

interface Snapshot {
  obj0: ObjectInputState;
  obj1: ObjectInputState;
}

function snapshotBinary(cpu: CpuSession): Snapshot {
  const objBase = 0x400018;
  const stride = 0xe2;
  const read = (p: number): ObjectInputState => ({
    deltaY: peekMem(cpu, objBase + p * stride + 0xc6, 1),
    deltaX: peekMem(cpu, objBase + p * stride + 0xc7, 1),
    trackballY: peekMem(cpu, objBase + p * stride + 0xc8, 1),
    trackballX: peekMem(cpu, objBase + p * stride + 0xc9, 1),
  });
  return { obj0: read(0), obj1: read(1) };
}

function snapshotTs(state: stateNs.GameState): Snapshot {
  const stride = 0xe2;
  const baseOff = 0x18;
  const read = (p: number): ObjectInputState => ({
    deltaY: state.workRam[baseOff + p * stride + 0xc6] ?? 0,
    deltaX: state.workRam[baseOff + p * stride + 0xc7] ?? 0,
    trackballY: state.workRam[baseOff + p * stride + 0xc8] ?? 0,
    trackballX: state.workRam[baseOff + p * stride + 0xc9] ?? 0,
  });
  return { obj0: read(0), obj1: read(1) };
}

function snapshotsEqual(a: Snapshot, b: Snapshot): boolean {
  const eq = (x: ObjectInputState, y: ObjectInputState) =>
    x.trackballX === y.trackballX &&
    x.trackballY === y.trackballY &&
    x.deltaX === y.deltaX &&
    x.deltaY === y.deltaY;
  return eq(a.obj0, b.obj0) && eq(a.obj1, b.obj1);
}

async function main(): Promise<void> {
  const n = Number(process.argv[2] ?? "300");

  const romPath = resolve("ghidra_project/marble_program.bin");
  if (!existsSync(romPath)) {
    console.error(`error: ROM blob not found at ${romPath}`);
    exit(3);
  }
  const rom = readFileSync(romPath);

  const state = stateNs.emptyGameState();
  const cpu = await createCpu({ rom, state });

  console.log(`\n=== trackballInputTick (FUN_1AC18) — ${n} casi ===`);

  const rng = makeRng(0xb0a);
  let ok = 0;
  let firstFail: { tc: TestCase; bin: Snapshot; ts: Snapshot } | null = null;

  for (let i = 0; i < n; i++) {
    cpu.system.setRegister("sp", 0x401f00);

    const tc = generate(rng);
    applyTestCase(cpu, state, tc);

    callFunction(cpu, FUN_TRACKBALL, []);
    const bin = snapshotBinary(cpu);

    trackballInput.trackballInputTick(state, tc.mmioP1X, tc.mmioP1Y, tc.mmioP2X, tc.mmioP2Y);
    const ts = snapshotTs(state);

    if (snapshotsEqual(bin, ts)) ok++;
    else if (firstFail === null) firstFail = { tc, bin, ts };
  }

  console.log(`  Match: ${ok}/${n} = ${((ok / n) * 100).toFixed(1)}%`);
  if (firstFail) {
    const { tc, bin, ts } = firstFail;
    console.log(`  First fail:`);
    console.log(`    obj0 init: ${JSON.stringify(tc.obj0Initial)}`);
    console.log(`    obj1 init: ${JSON.stringify(tc.obj1Initial)}`);
    console.log(`    MMIO: p1X=${tc.mmioP1X} p1Y=${tc.mmioP1Y} p2X=${tc.mmioP2X} p2Y=${tc.mmioP2Y}`);
    console.log(`    bin obj0: ${JSON.stringify(bin.obj0)}`);
    console.log(`    ts  obj0: ${JSON.stringify(ts.obj0)}`);
    console.log(`    bin obj1: ${JSON.stringify(bin.obj1)}`);
    console.log(`    ts  obj1: ${JSON.stringify(ts.obj1)}`);
  }

  disposeCpu(cpu);
  exit(ok === n ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  exit(1);
});
