#!/usr/bin/env node
/**
 * probe-fun1d06a-rom.ts - observe original FUN_1D06A side effects.
 *
 * Diagnostic only. The TS runtime currently stubs this callback from
 * objectRenderUpdate13334 for kind 6 slots. This probe executes the ROM
 * routine and reports compact write ranges to classify whether it is only
 * palette animation or affects gameplay/terrain RAM.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import { state as stateNs } from "@marble-love/engine";

import { createCpu, disposeCpu, peekMem, pokeMem } from "./binary-oracle-lib.js";

const FUN_1D06A = 0x0001d06a;
const WR = 0x00400000;
const COLOR = 0x00b00000;
const SENTINEL = 0x00c0ffee;

function hx(value: number, width = 6): string {
  return `0x${(value >>> 0).toString(16).padStart(width, "0")}`;
}

function callFunction(
  cpu: Awaited<ReturnType<typeof createCpu>>,
  addr: number,
  args: readonly number[],
  maxInstructions = 20_000,
): void {
  const sys = cpu.system;
  let sp = 0x00401f00;
  for (let i = args.length - 1; i >= 0; i--) {
    sp = (sp - 4) >>> 0;
    sys.write(sp, 4, args[i]! >>> 0);
  }
  sp = (sp - 4) >>> 0;
  sys.write(sp, 4, SENTINEL);
  sys.setRegister("sp", sp);
  sys.setRegister("pc", addr);
  for (let i = 0; i < maxInstructions; i++) {
    if (sys.getRegisters().pc === SENTINEL) return;
    sys.step();
  }
  throw new Error(`FUN_1D06A did not return; pc=${hx(sys.getRegisters().pc)}`);
}

function fillRange(
  cpu: Awaited<ReturnType<typeof createCpu>>,
  addr: number,
  length: number,
  seed: number,
): Uint8Array {
  const before = new Uint8Array(length);
  for (let i = 0; i < length; i++) {
    const v = (seed + i * 37) & 0xff;
    pokeMem(cpu, addr + i, 1, v);
    before[i] = v;
  }
  return before;
}

function diffRanges(
  cpu: Awaited<ReturnType<typeof createCpu>>,
  base: number,
  before: Uint8Array,
): string[] {
  const ranges: string[] = [];
  let start = -1;
  let last = -1;
  for (let i = 0; i < before.length; i++) {
    const after = peekMem(cpu, base + i, 1) & 0xff;
    if (after !== before[i]) {
      if (start < 0) start = i;
      last = i;
    } else if (start >= 0) {
      ranges.push(`${hx(base + start)}..${hx(base + last)}(${last - start + 1})`);
      start = -1;
      last = -1;
    }
  }
  if (start >= 0) ranges.push(`${hx(base + start)}..${hx(base + last)}(${last - start + 1})`);
  return ranges;
}

function changedWords(
  cpu: Awaited<ReturnType<typeof createCpu>>,
  base: number,
  before: Uint8Array,
): string[] {
  const words: string[] = [];
  for (let i = 0; i + 1 < before.length; i += 2) {
    const hi = peekMem(cpu, base + i, 1) & 0xff;
    const lo = peekMem(cpu, base + i + 1, 1) & 0xff;
    if (hi !== before[i] || lo !== before[i + 1]) {
      words.push(`${hx(base + i)}:${((hi << 8) | lo).toString(16).padStart(4, "0")}`);
    }
  }
  return words;
}

async function runArg(rom: Uint8Array, arg: number): Promise<void> {
  const state = stateNs.emptyGameState();
  const cpu = await createCpu({ rom, state });
  const wrBefore = fillRange(cpu, WR, 0x2000, 0x40 + arg);
  const colorBefore = fillRange(cpu, COLOR, 0x800, 0x80 + arg);
  callFunction(cpu, FUN_1D06A, [arg]);
  console.log(JSON.stringify({
    arg,
    workRamRanges: diffRanges(cpu, WR, wrBefore),
    altTerrainWords: changedWords(cpu, WR + 0x76e, wrBefore.subarray(0x76e, 0x7b0)),
    colorRamRanges: diffRanges(cpu, COLOR, colorBefore),
    sounds: cpu.soundCommandLog,
  }));
  disposeCpu(cpu);
}

async function main(): Promise<void> {
  const romPath = resolve("ghidra_project/marble_program.bin");
  if (!existsSync(romPath)) throw new Error(`missing ROM blob: ${romPath}`);
  const rom = readFileSync(romPath);
  for (const arg of [0, 1, 2, 8, 15, 16, 29, 30]) {
    await runArg(rom, arg);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  exit(1);
});
