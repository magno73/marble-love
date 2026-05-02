#!/usr/bin/env node
/**
 * test-palette-anim-parity.ts — differential testing del palette anim 1.
 *
 * Per N test cases (combinazioni di count, type, anim_ctr, skip_flag):
 *   1. Setup: setMem dei game object array fields nello state TS + nel binary
 *   2. callFunction(0x26BEE) sul binary
 *   3. paletteAnim1Tick(state, rom) sul TS
 *   4. Confronto delta su workRam (anim counter) + colorRam (palette word)
 *
 * Uso: npx tsx packages/cli/src/test-palette-anim-parity.ts [N]
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

const FUN_PALETTE_ANIM_1 = 0x00026bee;

// ─── Test case generation ────────────────────────────────────────────────

interface ObjectFields {
  type: number;     // u8 (offset 0x19)
  animCtr: number;  // u8 (offset 0x70)
  skipFlag: number; // u8 (offset 0xD8)
}

interface TestCase {
  count: number;             // u16 number of objects
  objects: ObjectFields[];   // length == count
}

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) >>> 0;
    return ((s >>> 16) & 0xffff) / 0x10000;
  };
}

function generateTestCase(rng: () => number, maxObjects = 32): TestCase {
  const count = 1 + Math.floor(rng() * maxObjects);
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

/** Generates simpler tests: count=1, only first obj. */
function generateSingleObjTestCase(rng: () => number): TestCase {
  return {
    count: 1,
    objects: [{
      type: Math.floor(rng() * 256) & 0xff,
      animCtr: Math.floor(rng() * 0x100) & 0xff,
      skipFlag: rng() < 0.7 ? 0 : 1,
    }],
  };
}

// ─── Setup state in CPU + TS ──────────────────────────────────────────────

function applyTestCase(cpu: CpuSession, state: GameState, tc: TestCase): void {
  // Reset Work RAM region of interest (objs + count + palette)
  const baseAddr = 0x400018;
  const baseOffset = baseAddr - 0x400000;
  const stride = 0xe2;

  // Clear obj array region in both
  for (let i = 0; i < 32; i++) {
    for (let f = 0; f < stride; f++) {
      const addr = baseAddr + i * stride + f;
      pokeMem(cpu, addr, 1, 0);
      state.workRam[baseOffset + i * stride + f] = 0;
    }
  }

  // Per object: set fields
  // NB: obj[3].field_0xD8 collide con count u16 @ 0x400396 (= 0x400018 + 3*0xE2 + 0xD8).
  // Quindi il count va scritto DOPO i fields, altrimenti viene corrotto.
  for (let i = 0; i < tc.count; i++) {
    const obj = tc.objects[i]!;
    const objAddr = baseAddr + i * stride;
    const objOff = baseOffset + i * stride;
    pokeMem(cpu, objAddr + 0x19, 1, obj.type);
    pokeMem(cpu, objAddr + 0x70, 1, obj.animCtr);
    pokeMem(cpu, objAddr + 0xd8, 1, obj.skipFlag);
    state.workRam[objOff + 0x19] = obj.type;
    state.workRam[objOff + 0x70] = obj.animCtr;
    state.workRam[objOff + 0xd8] = obj.skipFlag;
  }

  // Set count u16 BE — DOPO i fields per evitare la corruzione descritta sopra.
  pokeMem(cpu, 0x400396, 2, tc.count & 0xffff);
  state.workRam[0x396] = (tc.count >>> 8) & 0xff;
  state.workRam[0x397] = tc.count & 0xff;

  // Reset color RAM target entries
  pokeMem(cpu, 0xb00006, 2, 0);
  pokeMem(cpu, 0xb0000e, 2, 0);
  state.colorRam[0x06] = 0; state.colorRam[0x07] = 0;
  state.colorRam[0x0e] = 0; state.colorRam[0x0f] = 0;
}

// ─── Read state after ─────────────────────────────────────────────────────

interface StateSnapshot {
  animCounters: number[];        // post-call animCtr per object
  palWordA: number;              // palette @ 0xB00006 (entry 3)
  palWordB: number;              // palette @ 0xB0000E (entry 7)
}

function snapshotBinary(cpu: CpuSession, count: number): StateSnapshot {
  const animCounters: number[] = [];
  for (let i = 0; i < count; i++) {
    animCounters.push(peekMem(cpu, 0x400018 + i * 0xe2 + 0x70, 1));
  }
  return {
    animCounters,
    palWordA: peekMem(cpu, 0xb00006, 2),
    palWordB: peekMem(cpu, 0xb0000e, 2),
  };
}

function snapshotTs(state: GameState, count: number): StateSnapshot {
  const animCounters: number[] = [];
  for (let i = 0; i < count; i++) {
    const off = (0x400018 - 0x400000) + i * 0xe2;
    animCounters.push(state.workRam[off + 0x70] ?? 0);
  }
  return {
    animCounters,
    palWordA: ((state.colorRam[0x06] ?? 0) << 8) | (state.colorRam[0x07] ?? 0),
    palWordB: ((state.colorRam[0x0e] ?? 0) << 8) | (state.colorRam[0x0f] ?? 0),
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

// ─── Main ─────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const n = Number(process.argv[2] ?? "100");

  const romPath = resolve("ghidra_project/marble_program.bin");
  if (!existsSync(romPath)) {
    console.error(`error: ROM blob not found at ${romPath}`);
    exit(3);
  }
  const romBytes = readFileSync(romPath);

  // Build a RomImage with at least the program region populated
  const rom: RomImage = busNs.emptyRomImage();
  rom.program.set(romBytes.subarray(0, rom.program.length));

  console.log(`[palette-anim-parity] testing ${n} cases`);
  console.log(`[palette-anim-parity] FUN_${FUN_PALETTE_ANIM_1.toString(16)} binary vs paletteAnim1Tick TS\n`);

  const state = stateNs.emptyGameState();
  const cpu = await createCpu({ rom: romBytes, state });

  const rng = makeRng(0xcafe1234);
  let mismatches = 0;
  const samples: { tc: TestCase; binary: StateSnapshot; ts: StateSnapshot }[] = [];

  // First half: simple count=1 cases. Second half: full random.
  for (let i = 0; i < n; i++) {
    const tc = i < n / 2 ? generateSingleObjTestCase(rng) : generateTestCase(rng);

    applyTestCase(cpu, state, tc);

    // Run binary
    callFunction(cpu, FUN_PALETTE_ANIM_1, []);
    const binary = snapshotBinary(cpu, tc.count);

    // Run TS
    paletteAnim.paletteAnim1Tick(state, rom);
    const ts = snapshotTs(state, tc.count);

    if (!snapshotsEqual(binary, ts)) {
      mismatches++;
      if (samples.length < 5) samples.push({ tc, binary, ts });
    }
  }

  console.log(`Match rate: ${n - mismatches}/${n} = ${(((n - mismatches) / n) * 100).toFixed(1)}%`);

  if (mismatches > 0) {
    console.log("\nFirst mismatches:");
    for (const s of samples) {
      console.log(`\n  count=${s.tc.count}`);
      console.log(`  first obj: type=${s.tc.objects[0]!.type} ctr=${s.tc.objects[0]!.animCtr} skip=${s.tc.objects[0]!.skipFlag}`);
      console.log(`  binary: palA=0x${s.binary.palWordA.toString(16).padStart(4, "0")} palB=0x${s.binary.palWordB.toString(16).padStart(4, "0")} ctrs=[${s.binary.animCounters.slice(0, 6).join(",")}...]`);
      console.log(`  ts:     palA=0x${s.ts.palWordA.toString(16).padStart(4, "0")} palB=0x${s.ts.palWordB.toString(16).padStart(4, "0")} ctrs=[${s.ts.animCounters.slice(0, 6).join(",")}...]`);
    }
  } else {
    console.log("\n✅ Tutti i casi matchano. paletteAnim1Tick TS bit-perfect col binary.");
  }

  disposeCpu(cpu);
  exit(mismatches > 0 ? 1 : 0);
}

main().catch((err: unknown) => {
  console.error(err);
  exit(1);
});
