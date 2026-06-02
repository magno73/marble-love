#!/usr/bin/env node
/**
 * test-palette-anim-parity.ts — differential testing for the N palette anims.
 *
 * Usage: npx tsx packages/cli/src/test-palette-anim-parity.ts [N]
 * Test each animation against the corresponding TS implementation, N cases each.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import {
  state as stateNs,
  paletteAnim,
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

interface AnimSpec {
  name: string;
  funcAddr: number;
  ctrOffset: number;
  palDestA: number; // type==0
  palDestB: number; // type!=0
  tickFn: (s: GameState, r: RomImage) => void;
}

const ANIMS: AnimSpec[] = [
  {
    name: "anim1 FUN_26BEE",
    funcAddr: 0x00026bee,
    ctrOffset: 0x70,
    palDestA: 0xb00006,
    palDestB: 0xb0000e,
    tickFn: paletteAnim.paletteAnim1Tick,
  },
  {
    name: "anim2 FUN_26C78",
    funcAddr: 0x00026c78,
    ctrOffset: 0x71,
    palDestA: 0xb00016,
    palDestB: 0xb0001e,
    tickFn: paletteAnim.paletteAnim2Tick,
  },
];

interface ObjectFields {
  type: number;
  animCtr: number;
  skipFlag: number;
}

interface TestCase {
  count: number;
  objects: ObjectFields[];
}

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) >>> 0;
    return ((s >>> 16) & 0xffff) / 0x10000;
  };
}

function generateTestCase(rng: () => number, simple: boolean): TestCase {
  const count = simple ? 1 : 1 + Math.floor(rng() * 32);
  const objects: ObjectFields[] = [];
  for (let i = 0; i < count; i++) {
    objects.push({
      type: Math.floor(rng() * 256) & 0xff,
      animCtr: Math.floor(rng() * 0x100) & 0xff,
      skipFlag: rng() < 0.7 ? 0 : 1,
    });
  }
  return { count, objects };
}

function applyTestCase(cpu: CpuSession, state: GameState, tc: TestCase, anim: AnimSpec): void {
  const baseAddr = 0x400018;
  const baseOffset = baseAddr - 0x400000;
  const stride = 0xe2;

  for (let i = 0; i < 32; i++) {
    for (let f = 0; f < stride; f++) {
      const addr = baseAddr + i * stride + f;
      pokeMem(cpu, addr, 1, 0);
      state.workRam[baseOffset + i * stride + f] = 0;
    }
  }

  for (let i = 0; i < tc.count; i++) {
    const obj = tc.objects[i]!;
    const objAddr = baseAddr + i * stride;
    const objOff = baseOffset + i * stride;
    pokeMem(cpu, objAddr + 0x19, 1, obj.type);
    pokeMem(cpu, objAddr + anim.ctrOffset, 1, obj.animCtr);
    pokeMem(cpu, objAddr + 0xd8, 1, obj.skipFlag);
    state.workRam[objOff + 0x19] = obj.type;
    state.workRam[objOff + anim.ctrOffset] = obj.animCtr;
    state.workRam[objOff + 0xd8] = obj.skipFlag;
  }

  // Count u16 BE — AFTER the fields (collision obj[3].field_0xD8 at 0x400396).
  pokeMem(cpu, 0x400396, 2, tc.count & 0xffff);
  state.workRam[0x396] = (tc.count >>> 8) & 0xff;
  state.workRam[0x397] = tc.count & 0xff;

  // Reset palette destinations
  pokeMem(cpu, anim.palDestA, 2, 0);
  pokeMem(cpu, anim.palDestB, 2, 0);
  const palOffA = anim.palDestA - 0xb00000;
  const palOffB = anim.palDestB - 0xb00000;
  state.colorRam[palOffA] = 0; state.colorRam[palOffA + 1] = 0;
  state.colorRam[palOffB] = 0; state.colorRam[palOffB + 1] = 0;
}

interface StateSnapshot {
  animCounters: number[];
  palWordA: number;
  palWordB: number;
}

function snapshotBinary(cpu: CpuSession, count: number, anim: AnimSpec): StateSnapshot {
  const animCounters: number[] = [];
  for (let i = 0; i < count; i++) {
    animCounters.push(peekMem(cpu, 0x400018 + i * 0xe2 + anim.ctrOffset, 1));
  }
  return {
    animCounters,
    palWordA: peekMem(cpu, anim.palDestA, 2),
    palWordB: peekMem(cpu, anim.palDestB, 2),
  };
}

function snapshotTs(state: GameState, count: number, anim: AnimSpec): StateSnapshot {
  const animCounters: number[] = [];
  for (let i = 0; i < count; i++) {
    const off = (0x400018 - 0x400000) + i * 0xe2;
    animCounters.push(state.workRam[off + anim.ctrOffset] ?? 0);
  }
  const palOffA = anim.palDestA - 0xb00000;
  const palOffB = anim.palDestB - 0xb00000;
  return {
    animCounters,
    palWordA: ((state.colorRam[palOffA] ?? 0) << 8) | (state.colorRam[palOffA + 1] ?? 0),
    palWordB: ((state.colorRam[palOffB] ?? 0) << 8) | (state.colorRam[palOffB + 1] ?? 0),
  };
}

function snapshotsEqual(a: StateSnapshot, b: StateSnapshot): boolean {
  if (a.palWordA !== b.palWordA) return false;
  if (a.palWordB !== b.palWordB) return false;
  if (a.animCounters.length !== b.animCounters.length) return false;
  for (let i = 0; i < a.animCounters.length; i++) {
    if (a.animCounters[i] !== b.animCounters[i]) return false;
  }
  return true;
}

async function runAnimTest(
  cpu: CpuSession,
  state: GameState,
  rom: RomImage,
  anim: AnimSpec,
  n: number,
): Promise<{ passed: number; total: number }> {
  console.log(`\n=== ${anim.name} ===`);
  const rng = makeRng(0xcafe1234 ^ anim.funcAddr);
  let mismatches = 0;
  const samples: { tc: TestCase; binary: StateSnapshot; ts: StateSnapshot }[] = [];

  for (let i = 0; i < n; i++) {
    const tc = generateTestCase(rng, i < n / 2);
    applyTestCase(cpu, state, tc, anim);
    callFunction(cpu, anim.funcAddr, []);
    const binary = snapshotBinary(cpu, tc.count, anim);
    anim.tickFn(state, rom);
    const ts = snapshotTs(state, tc.count, anim);
    if (!snapshotsEqual(binary, ts)) {
      mismatches++;
      if (samples.length < 3) samples.push({ tc, binary, ts });
    }
  }

  console.log(`  Match: ${n - mismatches}/${n} = ${(((n - mismatches) / n) * 100).toFixed(1)}%`);
  if (mismatches > 0) {
    for (const s of samples) {
      console.log(`  count=${s.tc.count} obj0={type=${s.tc.objects[0]!.type} ctr=${s.tc.objects[0]!.animCtr} skip=${s.tc.objects[0]!.skipFlag}}`);
      console.log(`    bin: palA=0x${s.binary.palWordA.toString(16).padStart(4, "0")} palB=0x${s.binary.palWordB.toString(16).padStart(4, "0")} ctrs=[${s.binary.animCounters.slice(0, 6).join(",")}]`);
      console.log(`    ts:  palA=0x${s.ts.palWordA.toString(16).padStart(4, "0")} palB=0x${s.ts.palWordB.toString(16).padStart(4, "0")} ctrs=[${s.ts.animCounters.slice(0, 6).join(",")}]`);
    }
  }

  return { passed: n - mismatches, total: n };
}

async function main(): Promise<void> {
  const n = Number(process.argv[2] ?? "500");

  const romPath = resolve("ghidra_project/marble_program.bin");
  if (!existsSync(romPath)) {
    console.error(`error: ROM blob not found at ${romPath}`);
    exit(3);
  }
  const romBytes = readFileSync(romPath);
  const rom: RomImage = busNs.emptyRomImage();
  rom.program.set(romBytes.subarray(0, rom.program.length));

  console.log(`[palette-anim-parity] testing ${n} cases per anim`);

  const state = stateNs.emptyGameState();
  const cpu = await createCpu({ rom: romBytes, state });

  let totalPass = 0;
  let totalCount = 0;

  for (const anim of ANIMS) {
    const r = await runAnimTest(cpu, state, rom, anim, n);
    totalPass += r.passed;
    totalCount += r.total;
  }

  console.log(`\n=== TOTAL: ${totalPass}/${totalCount} = ${((totalPass / totalCount) * 100).toFixed(1)}% ===`);

  disposeCpu(cpu);
  exit(totalPass === totalCount ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  exit(1);
});
