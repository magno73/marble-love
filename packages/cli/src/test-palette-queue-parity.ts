#!/usr/bin/env node
/**
 * test-palette-queue-parity.ts — differential testing of the palette command queue.
 *
 * Tests 3 functions:
 *   1. paletteQueuePush vs FUN_26B66 (push byte to queue)
 *   3. paletteQueueDrain vs FUN_26B88 (drain + lookup tables → palette write)
 *
 * Usage: npx tsx packages/cli/src/test-palette-queue-parity.ts [N]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import {
  state as stateNs,
  paletteQueue,
  bus as busNs,
} from "@marble-love/engine";
import type { GameState, RomImage } from "@marble-love/engine";

import {
  createCpu,
  callFunction,
  pokeMem,
  peekMem,
  disposeCpu,
} from "./binary-oracle-lib.js";
import type { CpuSession } from "./binary-oracle-lib.js";

const FUN_PUSH = 0x00026b66;
const FUN_DRAIN = 0x00026b88;
const FUN_SCHED3 = 0x00026d4e;

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) >>> 0;
    return ((s >>> 16) & 0xffff) / 0x10000;
  };
}

// Reset queue state in both binary and TS
function resetQueueState(cpu: CpuSession, state: GameState, ptrInitial: number): void {
  // Pointer
  pokeMem(cpu, 0x400408, 4, ptrInitial);
  state.workRam[0x408] = (ptrInitial >>> 24) & 0xff;
  state.workRam[0x409] = (ptrInitial >>> 16) & 0xff;
  state.workRam[0x40a] = (ptrInitial >>> 8) & 0xff;
  state.workRam[0x40b] = ptrInitial & 0xff;
  // Queue slots
  for (let i = 0; i < 4; i++) {
    pokeMem(cpu, 0x40040c + i, 1, 0);
    state.workRam[0x40c + i] = 0;
  }
}

// ─── Push parity ──────────────────────────────────────────────────────────

async function testPush(cpu: CpuSession, state: GameState, n: number): Promise<{ ok: number; tot: number }> {
  console.log("\n=== FUN_26B66 push vs paletteQueuePush ===");
  const rng = makeRng(0x1234);
  let ok = 0;

  for (let i = 0; i < n; i++) {
    // Random initial pointer between head and tail
    const ptrInitial = 0x40040c + Math.floor(rng() * 5);  // 0x40040C..0x400410
    const value = Math.floor(rng() * 256) & 0xff;

    resetQueueState(cpu, state, ptrInitial);

    // Run binary: push value via callFunction(FUN_PUSH, [value]) — value passed as long arg
    callFunction(cpu, FUN_PUSH, [value]);
    const binaryPtr = peekMem(cpu, 0x400408, 4);
    const binarySlots = [
      peekMem(cpu, 0x40040c, 1),
      peekMem(cpu, 0x40040d, 1),
      peekMem(cpu, 0x40040e, 1),
      peekMem(cpu, 0x40040f, 1),
    ];

    // Run TS
    paletteQueue.paletteQueuePush(state, value);
    const tsPtr =
      ((state.workRam[0x408] ?? 0) << 24) |
      ((state.workRam[0x409] ?? 0) << 16) |
      ((state.workRam[0x40a] ?? 0) << 8) |
      (state.workRam[0x40b] ?? 0);
    const tsSlots = [
      state.workRam[0x40c] ?? 0,
      state.workRam[0x40d] ?? 0,
      state.workRam[0x40e] ?? 0,
      state.workRam[0x40f] ?? 0,
    ];

    const match = (binaryPtr >>> 0) === (tsPtr >>> 0) &&
      binarySlots.every((b, j) => b === tsSlots[j]);

    if (match) ok++;
    else if (ok + 3 > i) {
      console.log(`  case ${i}: ptr_in=0x${ptrInitial.toString(16)} val=0x${value.toString(16)}`);
      console.log(`    bin: ptr=0x${(binaryPtr >>> 0).toString(16)} slots=[${binarySlots.map(x => x.toString(16)).join(",")}]`);
      console.log(`    ts:  ptr=0x${(tsPtr >>> 0).toString(16)} slots=[${tsSlots.map(x => x.toString(16)).join(",")}]`);
    }
  }
  console.log(`  Match: ${ok}/${n} = ${((ok / n) * 100).toFixed(1)}%`);
  return { ok, tot: n };
}

// ─── Scheduler 3 parity ───────────────────────────────────────────────────

async function testSched3(cpu: CpuSession, state: GameState, n: number): Promise<{ ok: number; tot: number }> {
  console.log("\n=== FUN_26D4E sched3 vs paletteAnim3Tick ===");
  const rng = makeRng(0x5678);
  let ok = 0;

  for (let i = 0; i < n; i++) {
    const lowVal = Math.floor(rng() * 256) & 0xff;
    const highVal = Math.floor(rng() * 256) & 0xff;
    const ptrInitial = 0x40040c;  // empty queue

    // Reset queue + counters
    resetQueueState(cpu, state, ptrInitial);
    pokeMem(cpu, 0x400460, 1, lowVal);
    pokeMem(cpu, 0x40045e, 1, highVal);
    state.workRam[0x460] = lowVal;
    state.workRam[0x45e] = highVal;

    // Binary
    callFunction(cpu, FUN_SCHED3, []);
    const binaryLow = peekMem(cpu, 0x400460, 1);
    const binaryHigh = peekMem(cpu, 0x40045e, 1);
    const binaryPtr = peekMem(cpu, 0x400408, 4);
    const binarySlot = peekMem(cpu, 0x40040c, 1);

    // TS
    paletteQueue.paletteAnim3Tick(state);
    const tsLow = state.workRam[0x460] ?? 0;
    const tsHigh = state.workRam[0x45e] ?? 0;
    const tsPtr =
      ((state.workRam[0x408] ?? 0) << 24) |
      ((state.workRam[0x409] ?? 0) << 16) |
      ((state.workRam[0x40a] ?? 0) << 8) |
      (state.workRam[0x40b] ?? 0);
    const tsSlot = state.workRam[0x40c] ?? 0;

    const match = binaryLow === tsLow && binaryHigh === tsHigh &&
      (binaryPtr >>> 0) === (tsPtr >>> 0) && binarySlot === tsSlot;

    if (match) ok++;
    else if (ok + 3 > i) {
      console.log(`  case ${i}: low=0x${lowVal.toString(16)} high=0x${highVal.toString(16)}`);
      console.log(`    bin: low=0x${binaryLow.toString(16)} high=0x${binaryHigh.toString(16)} ptr=0x${(binaryPtr >>> 0).toString(16)} slot=0x${binarySlot.toString(16)}`);
      console.log(`    ts:  low=0x${tsLow.toString(16)} high=0x${tsHigh.toString(16)} ptr=0x${(tsPtr >>> 0).toString(16)} slot=0x${tsSlot.toString(16)}`);
    }
  }
  console.log(`  Match: ${ok}/${n} = ${((ok / n) * 100).toFixed(1)}%`);
  return { ok, tot: n };
}

// ─── Drain parity ─────────────────────────────────────────────────────────

async function testDrain(cpu: CpuSession, state: GameState, rom: RomImage, n: number): Promise<{ ok: number; tot: number }> {
  console.log("\n=== FUN_26B88 drain vs paletteQueueDrain ===");
  const rng = makeRng(0x9abc);
  let ok = 0;

  for (let i = 0; i < n; i++) {
    // Random queue depth 1..4, random commands (0..23 typical scheduler outputs)
    const depth = 1 + Math.floor(rng() * 4);
    const ptrInitial = 0x40040c + depth;
    const cmds: number[] = [];
    for (let j = 0; j < depth; j++) cmds.push(Math.floor(rng() * 24));

    resetQueueState(cpu, state, ptrInitial);
    for (let j = 0; j < depth; j++) {
      pokeMem(cpu, 0x40040c + j, 1, cmds[j]!);
      state.workRam[0x40c + j] = cmds[j]!;
    }

    // Snapshot palette RAM before (to compute diff)
    const palBefore = new Uint8Array(0x800);
    for (let j = 0; j < 0x800; j += 2) {
      const v = peekMem(cpu, 0xb00000 + j, 2);
      palBefore[j] = (v >>> 8) & 0xff;
      palBefore[j + 1] = v & 0xff;
      state.colorRam[j] = palBefore[j]!;
      state.colorRam[j + 1] = palBefore[j + 1]!;
    }

    // Binary
    callFunction(cpu, FUN_DRAIN, [], 200_000);

    // Read binary palette after
    const binaryPal = new Uint8Array(0x800);
    for (let j = 0; j < 0x800; j += 2) {
      const v = peekMem(cpu, 0xb00000 + j, 2);
      binaryPal[j] = (v >>> 8) & 0xff;
      binaryPal[j + 1] = v & 0xff;
    }
    const binaryPtr = peekMem(cpu, 0x400408, 4);

    // TS
    paletteQueue.paletteQueueDrain(state, rom);
    const tsPal = state.colorRam;
    const tsPtr =
      ((state.workRam[0x408] ?? 0) << 24) |
      ((state.workRam[0x409] ?? 0) << 16) |
      ((state.workRam[0x40a] ?? 0) << 8) |
      (state.workRam[0x40b] ?? 0);

    // Compare palette + ptr
    let palMatch = true;
    for (let j = 0; j < 0x800; j++) {
      if (binaryPal[j] !== tsPal[j]) { palMatch = false; break; }
    }
    const match = palMatch && (binaryPtr >>> 0) === (tsPtr >>> 0);

    if (match) ok++;
    else if (ok + 3 > i) {
      console.log(`  case ${i}: depth=${depth} cmds=[${cmds.join(",")}]`);
      console.log(`    binPtr=0x${(binaryPtr >>> 0).toString(16)} tsPtr=0x${(tsPtr >>> 0).toString(16)}`);
      // Find first palette diff
      for (let j = 0; j < 0x800; j++) {
        if (binaryPal[j] !== tsPal[j]) {
          console.log(`    palette diff at 0x${j.toString(16)}: bin=0x${binaryPal[j]!.toString(16)} ts=0x${(tsPal[j] ?? 0).toString(16)}`);
          break;
        }
      }
    }
  }
  console.log(`  Match: ${ok}/${n} = ${((ok / n) * 100).toFixed(1)}%`);
  return { ok, tot: n };
}

// ─── Main ─────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const n = Number(process.argv[2] ?? "200");

  const romPath = resolve("ghidra_project/marble_program.bin");
  if (!existsSync(romPath)) {
    console.error(`error: ROM blob not found at ${romPath}`);
    exit(3);
  }
  const romBytes = readFileSync(romPath);
  const rom: RomImage = busNs.emptyRomImage();
  rom.program.set(romBytes.subarray(0, rom.program.length));

  const state = stateNs.emptyGameState();
  const cpu = await createCpu({ rom: romBytes, state });

  const r1 = await testPush(cpu, state, n);
  const r2 = await testSched3(cpu, state, n);
  const r3 = await testDrain(cpu, state, rom, n);

  const totalOk = r1.ok + r2.ok + r3.ok;
  const totalTot = r1.tot + r2.tot + r3.tot;
  console.log(`\n=== TOTAL: ${totalOk}/${totalTot} = ${((totalOk / totalTot) * 100).toFixed(1)}% ===`);

  disposeCpu(cpu);
  exit(totalOk === totalTot ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  exit(1);
});
