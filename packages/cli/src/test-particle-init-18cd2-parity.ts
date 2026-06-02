#!/usr/bin/env node
/**
 * test-particle-init-18cd2-parity.ts — differential FUN_00018CD2 vs
 * `particleInit18CD2`.
 *
 * `count` slots @ 0x400A9C (stride 0xA) with xpos/ypos/xvel/yvel via RNG and
 * `*0x4003E2 = count`.
 *
 * **Strategia parity**:
 *   - `FUN_00013A98` (RNG @ 0x4003A6) **lasciato live**.
 *   - `FUN_00026CFA` (palette + 8 RNG) **stubbed with RTS** (0x4E75); TS
 *   - `FUN_00018E6C` (insert-sorted in draw-list) **stubbed with RTS**;
 *     TS uses `subs.fun_18e6c = noop`. TS must not touch 0x4003BC,
 *
 * **Suite** (4 × 125 = 500):
 *   - A: random count + random mode
 *   - C: mode == 0xFF (palette refresh path)
 *   - D: edge cases (count=0, count=255, mode boundaries)
 *
 * Compare: 32 byte particle-area + count byte + RNG seed.
 *
 * Uso: npx tsx packages/cli/src/test-particle-init-18cd2-parity.ts [N]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import {
  state as stateNs,
  particleInit18CD2 as p18cd2Ns,
  wrap,
} from "@marble-love/engine";
import {
  createCpu,
  callFunction,
  pokeMem,
  peekMem,
  disposeCpu,
} from "./binary-oracle-lib.js";
import type { CpuSession } from "./binary-oracle-lib.js";

const FUN_18CD2 = 0x00018cd2;
const FUN_26CFA = 0x00026cfa;
const FUN_18E6C = 0x00018e6c;
const RNG_SEED_ADDR = 0x004003a6;

const PARTICLE_BASE = 0x00400a9c;
const PARTICLE_STRIDE = 0x0a;
const PARTICLE_AREA_LEN = 32 * PARTICLE_STRIDE; // 320 byte (max 32 slot)
const COUNT_BYTE_ADDR = 0x004003e2;

/**
 * Patch JSR-stub:
 *   - FUN_26CFA → RTS (0x4E75) — neutralizza palette+8 RNG.
 *   - FUN_18E6C → RTS (0x4E75) — neutralizza insert-sorted draw-list.
 */
function patchSubs(cpu: CpuSession): void {
  pokeMem(cpu, FUN_26CFA + 0, 1, 0x4e);
  pokeMem(cpu, FUN_26CFA + 1, 1, 0x75);
  pokeMem(cpu, FUN_18E6C + 0, 1, 0x4e);
  pokeMem(cpu, FUN_18E6C + 1, 1, 0x75);
}

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) >>> 0;
    return ((s >>> 16) & 0xffff) / 0x10000;
  };
}

interface Snapshot {
  area: number[];
  countByte: number;
  rngSeed: number;
}

function snapshotBinary(cpu: CpuSession): Snapshot {
  const area: number[] = [];
  for (let i = 0; i < PARTICLE_AREA_LEN; i++) {
    area.push(peekMem(cpu, PARTICLE_BASE + i, 1) & 0xff);
  }
  return {
    area,
    countByte: peekMem(cpu, COUNT_BYTE_ADDR, 1) & 0xff,
    rngSeed: peekMem(cpu, RNG_SEED_ADDR, 2) & 0xffff,
  };
}

function snapshotTs(state: ReturnType<typeof stateNs.emptyGameState>): Snapshot {
  const area: number[] = [];
  const off = PARTICLE_BASE - 0x400000;
  for (let i = 0; i < PARTICLE_AREA_LEN; i++) {
    area.push(state.workRam[off + i] ?? 0);
  }
  return {
    area,
    countByte: state.workRam[COUNT_BYTE_ADDR - 0x400000] ?? 0,
    rngSeed: (state.rng.seed as unknown as number) & 0xffff,
  };
}

interface FailRecord {
  suite: string;
  tc: number;
  count: number;
  mode: number;
  rngSeedIn: number;
  reason: string;
  binArea: number[];
  tsArea: number[];
  binCount: number;
  tsCount: number;
  binSeed: number;
  tsSeed: number;
}

async function main(): Promise<void> {
  const total = Number(process.argv[2] ?? "500");
  const perSuite = Math.floor(total / 4);
  const remainder = total - perSuite * 4;

  const romPath = resolve("ghidra_project/marble_program.bin");
  if (!existsSync(romPath)) {
    console.error(`error: ROM blob not found at ${romPath}`);
    exit(3);
  }
  const rom = readFileSync(romPath);

  const stateInst = stateNs.emptyGameState();
  const cpu = await createCpu({ rom, state: stateInst });
  patchSubs(cpu);

  let totalOk = 0;
  const failHolder: { value: FailRecord | null } = { value: null };

  function setupCase(rngSeed: number): void {
    for (let i = 0; i < PARTICLE_AREA_LEN; i++) {
      pokeMem(cpu, PARTICLE_BASE + i, 1, 0);
      stateInst.workRam[PARTICLE_BASE - 0x400000 + i] = 0;
    }
    pokeMem(cpu, COUNT_BYTE_ADDR, 1, 0);
    stateInst.workRam[COUNT_BYTE_ADDR - 0x400000] = 0;

    pokeMem(cpu, RNG_SEED_ADDR, 2, rngSeed & 0xffff);
    cpu.system.setRegister("sp", 0x401f00);

    stateInst.rng.seed = wrap.as_u32(rngSeed & 0xffff);
    stateInst.rng.callsThisFrame = wrap.as_u32(0);
  }

  function runOneCase(
    suite: string,
    tc: number,
    count: number,
    mode: number,
    rngSeed: number,
  ): boolean {
    setupCase(rngSeed);

    // BINARY: callFunction pusha argsLong RTL.
    // argsLong[0] = closer to SP after push.
    // FUN_18CD2: D3 = LSB(arg1) (count), D2 = LSB(arg2) (mode).
    // ⇒ argsLong = [count, mode].
    callFunction(cpu, FUN_18CD2, [count >>> 0, mode >>> 0], 5_000_000);
    const binSnap = snapshotBinary(cpu);

    // TS
    p18cd2Ns.particleInit18CD2(stateInst, count, mode, {
      fun_26cfa: () => { /* no-op */ },
      fun_18e6c: () => { /* no-op */ },
    });
    const tsSnap = snapshotTs(stateInst);

    let reason = "";
    if (binSnap.rngSeed !== tsSnap.rngSeed) {
      reason = `rngSeed bin=0x${binSnap.rngSeed.toString(16)} ts=0x${tsSnap.rngSeed.toString(16)}`;
    } else if (binSnap.countByte !== tsSnap.countByte) {
      reason = `countByte bin=0x${binSnap.countByte.toString(16)} ts=0x${tsSnap.countByte.toString(16)}`;
    } else {
      for (let i = 0; i < PARTICLE_AREA_LEN; i++) {
        if (binSnap.area[i] !== tsSnap.area[i]) {
          reason = `area[0x${i.toString(16)}] bin=0x${binSnap.area[i]!.toString(16)} ts=0x${tsSnap.area[i]!.toString(16)}`;
          break;
        }
      }
    }
    if (reason === "") return true;
    if (failHolder.value === null) {
      failHolder.value = {
        suite,
        tc,
        count,
        mode,
        rngSeedIn: rngSeed,
        reason,
        binArea: binSnap.area.slice(),
        tsArea: tsSnap.area.slice(),
        binCount: binSnap.countByte,
        tsCount: tsSnap.countByte,
        binSeed: binSnap.rngSeed,
        tsSeed: tsSnap.rngSeed,
      };
    }
    return false;
  }

  const rng = makeRng(0x18cd2);
  const rs = (): number => Math.floor(rng() * 0x10000) & 0xffff;

  // ─── Suite A: random count + random mode ─────────────────────────────
  console.log(
    `\n=== particleInit18CD2 (FUN_00018CD2) — Suite A: random — ${perSuite} cases ===`,
  );
  let okA = 0;
  for (let i = 0; i < perSuite; i++) {
    // count limitato a 0..32 per restare in the area of compare (32 slot * 0xA)
    const count = Math.floor(rng() * 33) & 0xff;
    const mode = Math.floor(rng() * 256) & 0xff;
    if (runOneCase("A", i, count, mode, rs())) okA++;
  }
  console.log(`  Match: ${okA}/${perSuite} = ${((okA / perSuite) * 100).toFixed(1)}%`);
  totalOk += okA;

  // ─── Suite B: count piccoli (0..3), mode positivo ────────────────────
  console.log(
    `\n=== Suite B: small count + mode ∈ [0..0x7F] — ${perSuite} cases ===`,
  );
  let okB = 0;
  for (let i = 0; i < perSuite; i++) {
    const count = Math.floor(rng() * 4) & 0xff;
    const mode = Math.floor(rng() * 0x80) & 0xff;
    if (runOneCase("B", i, count, mode, rs())) okB++;
  }
  console.log(`  Match: ${okB}/${perSuite} = ${((okB / perSuite) * 100).toFixed(1)}%`);
  totalOk += okB;

  // ─── Suite C: mode == 0xFF ──────────────────────────────────────────
  console.log(
    `\n=== Suite C: mode == 0xFF (palette refresh path) — ${perSuite} cases ===`,
  );
  let okC = 0;
  for (let i = 0; i < perSuite; i++) {
    const count = Math.floor(rng() * 33) & 0xff;
    if (runOneCase("C", i, count, 0xff, rs())) okC++;
  }
  console.log(`  Match: ${okC}/${perSuite} = ${((okC / perSuite) * 100).toFixed(1)}%`);
  totalOk += okC;

  // ─── Suite D: edge cases ─────────────────────────────────────────────
  const sizeD = perSuite + remainder;
  console.log(
    `\n=== Suite D: edge cases (count={0,1,32}, mode boundaries) — ${sizeD} cases ===`,
  );
  let okD = 0;
  const counts = [0, 1, 2, 32];
  const modes = [0x00, 0x01, 0x7f, 0x80, 0x81, 0xfe, 0xff];
  for (let i = 0; i < sizeD; i++) {
    const count = counts[Math.floor(rng() * counts.length)]!;
    const mode = modes[Math.floor(rng() * modes.length)]!;
    if (runOneCase("D", i, count, mode, rs())) okD++;
  }
  console.log(`  Match: ${okD}/${sizeD} = ${((okD / sizeD) * 100).toFixed(1)}%`);
  totalOk += okD;

  console.log(
    `\n=== TOTALE: ${totalOk}/${total} = ${((totalOk / total) * 100).toFixed(1)}% ===`,
  );
  if (failHolder.value !== null) {
    const f = failHolder.value;
    console.log(`  First fail (suite ${f.suite} tc=${f.tc}): ${f.reason}`);
    console.log(`    count=${f.count} mode=0x${f.mode.toString(16)} rngSeedIn=0x${f.rngSeedIn.toString(16)}`);
    console.log(`    binSeedAfter=0x${f.binSeed.toString(16)} tsSeedAfter=0x${f.tsSeed.toString(16)}`);
    console.log(`    binCountByte=0x${f.binCount.toString(16)} tsCountByte=0x${f.tsCount.toString(16)}`);
    // Dump the first 10-byte slot for debugging.
    const bin0 = f.binArea.slice(0, 10).map(b => b.toString(16).padStart(2, "0")).join(" ");
    const ts0 = f.tsArea.slice(0, 10).map(b => b.toString(16).padStart(2, "0")).join(" ");
    console.log(`    bin slot0: ${bin0}`);
    console.log(`    ts  slot0: ${ts0}`);
  }

  disposeCpu(cpu);
  exit(totalOk === total ? 0 : 1);
}

main().catch(e => {
  console.error(e);
  exit(1);
});
