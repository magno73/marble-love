#!/usr/bin/env node
/**
 * test-trackball-clamp-flags-28468-parity.ts — differential FUN_28468 vs trackballClampFlags28468.
 *
 * Per N test cases:
 *   1. Setup random:
 *      - workRam[0x6A4..0x6A7] (accumulator X/Y, signed word, range ±0x100)
 *      - workRam[0x3A8] (prev sample), 0x3AA (oldDeb), 0x3AC (falling)
 *      - obj0/obj1 trackball+delta bytes (0xC6/C7/C8/C9)
 *      - MMIO 0xF60001 (input byte) e MMIO 0xF20001/3/5/7 (trackball)
 *
 * Uso: npx tsx packages/cli/src/test-trackball-clamp-flags-28468-parity.ts [N]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import {
  state as stateNs,
  trackballClampFlags28468 as ns,
} from "@marble-love/engine";
import {
  createCpu,
  callFunction,
  pokeMem,
  peekMem,
  disposeCpu,
} from "./binary-oracle-lib.js";
import type { CpuSession } from "./binary-oracle-lib.js";

const FUN_ADDR = 0x00028468;

interface Inputs {
  // Pre-state workRam
  accumX: number; // signed word @ 0x4006A4
  accumY: number; // signed word @ 0x4006A6
  prevInput: number; // byte @ 0x4003A8
  oldDeb: number; // byte @ 0x4003AA
  oldFalling: number; // byte @ 0x4003AC
  // Object state per FUN_180BE / FUN_1AC18
  obj0_C6: number;
  obj0_C7: number;
  obj0_C8: number;
  obj0_C9: number;
  obj1_C6: number;
  obj1_C7: number;
  obj1_C8: number;
  obj1_C9: number;
  // MMIO inputs
  mmioInput: number; // byte @ 0xF60001
  p1X: number; // byte @ 0xF20001
  p1Y: number; // byte @ 0xF20003
  p2X: number; // byte @ 0xF20005
  p2Y: number; // byte @ 0xF20007
}

interface Snapshot {
  retLong: number; // sext_l(D0w)
  accumX: number;
  accumY: number;
  pickedX: number; // byte @ 0x4006A8
  pickedY: number; // byte @ 0x4006AA
  prevInput: number;
  debounced: number;
  falling: number;
  obj0_C6: number;
  obj0_C7: number;
  obj0_C8: number;
  obj0_C9: number;
  obj1_C6: number;
  obj1_C7: number;
  obj1_C8: number;
  obj1_C9: number;
}

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) >>> 0;
    return ((s >>> 16) & 0xffff) / 0x10000;
  };
}
function randByte(rng: () => number): number {
  return Math.floor(rng() * 256) & 0xff;
}
function randWord(rng: () => number): number {
  return Math.floor(rng() * 0x10000) & 0xffff;
}

function generate(rng: () => number): Inputs {
  return {
    // accumulator: random word, but biased toward extremes to
    // esercitare clamp e wrap
    accumX: randWord(rng),
    accumY: randWord(rng),
    prevInput: randByte(rng),
    oldDeb: randByte(rng),
    oldFalling: randByte(rng),
    obj0_C6: randByte(rng),
    obj0_C7: randByte(rng),
    obj0_C8: randByte(rng),
    obj0_C9: randByte(rng),
    obj1_C6: randByte(rng),
    obj1_C7: randByte(rng),
    obj1_C8: randByte(rng),
    obj1_C9: randByte(rng),
    mmioInput: randByte(rng),
    p1X: randByte(rng),
    p1Y: randByte(rng),
    p2X: randByte(rng),
    p2Y: randByte(rng),
  };
}

function applyToBinary(cpu: CpuSession, inp: Inputs): void {
  // Accumulator words (big-endian)
  pokeMem(cpu, 0x4006a4, 2, inp.accumX);
  pokeMem(cpu, 0x4006a6, 2, inp.accumY);
  // Debounce state
  pokeMem(cpu, 0x4003a8, 1, inp.prevInput);
  pokeMem(cpu, 0x4003aa, 1, inp.oldDeb);
  pokeMem(cpu, 0x4003ac, 1, inp.oldFalling);
  // Obj0 @ 0x400018
  pokeMem(cpu, 0x400018 + 0xc6, 1, inp.obj0_C6);
  pokeMem(cpu, 0x400018 + 0xc7, 1, inp.obj0_C7);
  pokeMem(cpu, 0x400018 + 0xc8, 1, inp.obj0_C8);
  pokeMem(cpu, 0x400018 + 0xc9, 1, inp.obj0_C9);
  // Obj1 @ 0x4000FA
  pokeMem(cpu, 0x4000fa + 0xc6, 1, inp.obj1_C6);
  pokeMem(cpu, 0x4000fa + 0xc7, 1, inp.obj1_C7);
  pokeMem(cpu, 0x4000fa + 0xc8, 1, inp.obj1_C8);
  pokeMem(cpu, 0x4000fa + 0xc9, 1, inp.obj1_C9);
  // MMIO input + trackball ports
  pokeMem(cpu, 0xf60001, 1, inp.mmioInput);
  pokeMem(cpu, 0xf20001, 1, inp.p1X);
  pokeMem(cpu, 0xf20003, 1, inp.p1Y);
  pokeMem(cpu, 0xf20005, 1, inp.p2X);
  pokeMem(cpu, 0xf20007, 1, inp.p2Y);
}

function applyToTs(state: stateNs.GameState, inp: Inputs): void {
  const r = state.workRam;
  // accumulator words BE
  r[0x6a4] = (inp.accumX >>> 8) & 0xff;
  r[0x6a4 + 1] = inp.accumX & 0xff;
  r[0x6a6] = (inp.accumY >>> 8) & 0xff;
  r[0x6a6 + 1] = inp.accumY & 0xff;
  r[0x3a8] = inp.prevInput;
  r[0x3aa] = inp.oldDeb;
  r[0x3ac] = inp.oldFalling;
  // obj0 @ workRam offset 0x18
  r[0x18 + 0xc6] = inp.obj0_C6;
  r[0x18 + 0xc7] = inp.obj0_C7;
  r[0x18 + 0xc8] = inp.obj0_C8;
  r[0x18 + 0xc9] = inp.obj0_C9;
  // obj1 @ workRam offset 0xFA
  r[0xfa + 0xc6] = inp.obj1_C6;
  r[0xfa + 0xc7] = inp.obj1_C7;
  r[0xfa + 0xc8] = inp.obj1_C8;
  r[0xfa + 0xc9] = inp.obj1_C9;
}

function snapshotBinary(cpu: CpuSession, retD0: number): Snapshot {
  const accumX_raw = peekMem(cpu, 0x4006a4, 2);
  const accumY_raw = peekMem(cpu, 0x4006a6, 2);
  return {
    retLong: retD0 | 0, // signed long
    accumX: accumX_raw,
    accumY: accumY_raw,
    pickedX: peekMem(cpu, 0x4006a8, 1),
    pickedY: peekMem(cpu, 0x4006aa, 1),
    prevInput: peekMem(cpu, 0x4003a8, 1),
    debounced: peekMem(cpu, 0x4003aa, 1),
    falling: peekMem(cpu, 0x4003ac, 1),
    obj0_C6: peekMem(cpu, 0x400018 + 0xc6, 1),
    obj0_C7: peekMem(cpu, 0x400018 + 0xc7, 1),
    obj0_C8: peekMem(cpu, 0x400018 + 0xc8, 1),
    obj0_C9: peekMem(cpu, 0x400018 + 0xc9, 1),
    obj1_C6: peekMem(cpu, 0x4000fa + 0xc6, 1),
    obj1_C7: peekMem(cpu, 0x4000fa + 0xc7, 1),
    obj1_C8: peekMem(cpu, 0x4000fa + 0xc8, 1),
    obj1_C9: peekMem(cpu, 0x4000fa + 0xc9, 1),
  };
}

function snapshotTs(state: stateNs.GameState, ret: number): Snapshot {
  const r = state.workRam;
  const w = (off: number) => (((r[off] ?? 0) << 8) | (r[off + 1] ?? 0)) & 0xffff;
  return {
    retLong: ret | 0,
    accumX: w(0x6a4),
    accumY: w(0x6a6),
    pickedX: r[0x6a8] ?? 0,
    pickedY: r[0x6aa] ?? 0,
    prevInput: r[0x3a8] ?? 0,
    debounced: r[0x3aa] ?? 0,
    falling: r[0x3ac] ?? 0,
    obj0_C6: r[0x18 + 0xc6] ?? 0,
    obj0_C7: r[0x18 + 0xc7] ?? 0,
    obj0_C8: r[0x18 + 0xc8] ?? 0,
    obj0_C9: r[0x18 + 0xc9] ?? 0,
    obj1_C6: r[0xfa + 0xc6] ?? 0,
    obj1_C7: r[0xfa + 0xc7] ?? 0,
    obj1_C8: r[0xfa + 0xc8] ?? 0,
    obj1_C9: r[0xfa + 0xc9] ?? 0,
  };
}

function diff(a: Snapshot, b: Snapshot): string[] {
  const out: string[] = [];
  const fields: Array<keyof Snapshot> = [
    "retLong", "accumX", "accumY", "pickedX", "pickedY",
    "prevInput", "debounced", "falling",
    "obj0_C6", "obj0_C7", "obj0_C8", "obj0_C9",
    "obj1_C6", "obj1_C7", "obj1_C8", "obj1_C9",
  ];
  for (const f of fields) {
    if (a[f] !== b[f]) out.push(`${f}: bin=0x${(a[f] >>> 0).toString(16)} ts=0x${(b[f] >>> 0).toString(16)}`);
  }
  return out;
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

  console.log(`\n=== trackballClampFlags28468 (FUN_00028468) — ${n} casi ===`);

  const rng = makeRng(0x28468);
  let ok = 0;
  let firstFail: { i: number; tc: Inputs; bin: Snapshot; ts: Snapshot } | null = null;

  for (let i = 0; i < n; i++) {
    cpu.system.setRegister("sp", 0x401f00);

    const tc = generate(rng);
    applyToBinary(cpu, tc);
    applyToTs(state, tc);

    const r = callFunction(cpu, FUN_ADDR, []);
    const retSigned = r.d0 | 0;
    const bin = snapshotBinary(cpu, retSigned);

    const tsRet = ns.trackballClampFlags28468(state, {
      mmioInputByte: tc.mmioInput,
      p1X: tc.p1X,
      p1Y: tc.p1Y,
      p2X: tc.p2X,
      p2Y: tc.p2Y,
    });
    const ts = snapshotTs(state, tsRet);

    const d = diff(bin, ts);
    if (d.length === 0) ok++;
    else if (firstFail === null) firstFail = { i, tc, bin, ts };
  }

  console.log(`  Match: ${ok}/${n} = ${((ok / n) * 100).toFixed(1)}%`);
  if (firstFail) {
    const { i, tc, bin, ts } = firstFail;
    console.log(`  First fail @ iter ${i}:`);
    console.log(`    inputs: ${JSON.stringify(tc)}`);
    for (const line of diff(bin, ts)) console.log(`    ${line}`);
  }

  disposeCpu(cpu);
  exit(ok === n ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  exit(1);
});
