#!/usr/bin/env node
/**
 * test-palette-rng-fill-26cfa-parity.ts — parity differential testing per
 * `FUN_00026CFA` (palette RNG fill).
 *
 * Per ogni caso:
 *   1. Setta seed RNG sia in workRam (binary) che in `state.rng.seed` (TS)
 *   2. Pre-fill palette RAM con sentinel
 *   3. Chiama FUN_00026CFA nel binario via Musashi
 *   4. Chiama paletteRngFill26CFATick in TS
 *   5. Confronta:
 *      - palette RAM in [0xB00202, 0xB00302) (8 entry × 32 byte)
 *      - seed RNG dopo 8 chiamate
 *
 * Uso: npx tsx packages/cli/src/test-palette-rng-fill-26cfa-parity.ts [N]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import {
  state as stateNs,
  bus as busNs,
  paletteRngFill26CFA,
  wrap,
} from "@marble-love/engine";
import type { RomImage } from "@marble-love/engine";

import {
  createCpu,
  callFunction,
  pokeMem,
  peekMem,
  disposeCpu,
} from "./binary-oracle-lib.js";

const FUN_ADDR = 0x00026cfa;
const RNG_SEED_ADDR = 0x004003a6;
const PAL_BASE = 0xb00202;
const PAL_BYTES = 8 * 0x20; // 256 bytes spanned (last entry written 10 bytes, gap 22)
const RNG_LIMIT_ARG = 2;
const ENTRY_COUNT = 8;

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) >>> 0;
    return ((s >>> 16) & 0xffff) / 0x10000;
  };
}

interface Snapshot {
  palette: Uint8Array; // 256 bytes
  seedAfter: number;
}

function snapshotBinary(cpu: ReturnType<typeof createCpu> extends Promise<infer T> ? T : never): Snapshot {
  const palette = new Uint8Array(PAL_BYTES);
  for (let i = 0; i < PAL_BYTES; i++) {
    palette[i] = peekMem(cpu, PAL_BASE + i, 1) & 0xff;
  }
  return {
    palette,
    seedAfter: peekMem(cpu, RNG_SEED_ADDR, 2) & 0xffff,
  };
}

function snapshotTs(state: ReturnType<typeof stateNs.emptyGameState>): Snapshot {
  const palette = new Uint8Array(PAL_BYTES);
  const palOff = PAL_BASE - 0xb00000;
  for (let i = 0; i < PAL_BYTES; i++) {
    palette[i] = state.colorRam[palOff + i] ?? 0;
  }
  return {
    palette,
    seedAfter: (state.rng.seed as unknown as number) & 0xffff,
  };
}

function snapshotsEqual(a: Snapshot, b: Snapshot): { ok: boolean; firstDiff: number } {
  if (a.seedAfter !== b.seedAfter) return { ok: false, firstDiff: -1 };
  for (let i = 0; i < PAL_BYTES; i++) {
    if (a.palette[i] !== b.palette[i]) return { ok: false, firstDiff: i };
  }
  return { ok: true, firstDiff: -1 };
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

  const state = stateNs.emptyGameState();
  const cpu = await createCpu({ rom: romBytes, state });

  console.log(`[palette-rng-fill-26cfa-parity] ${n} casi vs FUN_00026CFA`);

  const rng = makeRng(0xcafe26cf);
  let pass = 0;
  const samples: { seed: number; firstDiff: number; binSeed: number; tsSeed: number }[] = [];

  for (let iter = 0; iter < n; iter++) {
    // Random seed
    const seed = Math.floor(rng() * 0x10000) & 0xffff;

    // BINARY: setup
    pokeMem(cpu, RNG_SEED_ADDR, 2, seed);
    // Reset palette region (sentinel 0)
    for (let b = 0; b < PAL_BYTES; b++) {
      pokeMem(cpu, PAL_BASE + b, 1, 0);
    }
    callFunction(cpu, FUN_ADDR, []);
    const binSnap = snapshotBinary(cpu);

    // TS: setup
    state.rng.seed = wrap.as_u32(seed);
    state.rng.callsThisFrame = wrap.as_u32(0);
    const palOff = PAL_BASE - 0xb00000;
    for (let b = 0; b < PAL_BYTES; b++) {
      state.colorRam[palOff + b] = 0;
    }
    paletteRngFill26CFA.paletteRngFill26CFATick(state, rom);
    const tsSnap = snapshotTs(state);

    const r = snapshotsEqual(binSnap, tsSnap);
    if (r.ok) {
      pass++;
    } else if (samples.length < 3) {
      samples.push({
        seed,
        firstDiff: r.firstDiff,
        binSeed: binSnap.seedAfter,
        tsSeed: tsSnap.seedAfter,
      });
    }
  }

  console.log(`  Match: ${pass}/${n} = ${((pass / n) * 100).toFixed(1)}%`);
  void RNG_LIMIT_ARG;
  void ENTRY_COUNT;
  if (pass !== n) {
    for (const s of samples) {
      console.log(
        `  seed=0x${s.seed.toString(16).padStart(4, "0")} firstDiff@byte=${s.firstDiff} binSeedAfter=0x${s.binSeed.toString(16)} tsSeedAfter=0x${s.tsSeed.toString(16)}`,
      );
    }
  }

  disposeCpu(cpu);
  exit(pass === n ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  exit(1);
});
