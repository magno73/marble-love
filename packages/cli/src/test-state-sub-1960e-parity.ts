#!/usr/bin/env node
/**
 * test-state-sub-1960e-parity.ts — differential FUN_0001960E vs
 * `stateSub1960E`.
 *
 * FUN_0001960E (132 byte): "entity RNG-driven state-byte resampler". Resampla
 * `entity[0x26]` via PRNG `FUN_13A98` in 3 branch (state==7 jitter ±2,
 * long0==0 → {0,8}, long0!=0 → {4,12}). In coda chiama `FUN_19692`.
 *
 * **Strategia parity**:
 *   - `FUN_00013A98` (RNG @ 0x4003A6) **lasciato live**: piccolo, replicato
 *     bit-perfect in `rng.ts`.
 *   - `FUN_00019692` (heavy entity update) **stubbed with RTS** (0x4E75) for
 *     neutralizzare side effects. Il TS usa `subs.fun_19692 = noop`.
 *   - Compare:
 *       * `entity[0x00..0x27]` (0x28 byte = 1 entity stride completa)
 *       * `*0x004003A6` (RNG seed) post-call
 *
 * **Suite** (4 × 125 = 500):
 *   - A: random state + random entity
 *   - B: forced state==7 (branch jitter +/-2)
 *   - C: state==9 + entity[0..3]==0 (long0_zero + chance clear-block)
 *   - D: edge cases (state byte boundaries, counter sat 0xF, long0=0/!=0 mix)
 *
 * Uso: npx tsx packages/cli/src/test-state-sub-1960e-parity.ts [N]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import {
  state as stateNs,
  stateSub1960E as sub1960ENs,
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

const FUN_1960E = 0x0001960e;
const FUN_19692 = 0x00019692;
const RNG_SEED_ADDR = 0x004003a6;

const ENTITY_BASE = 0x00401e00;
const ENTITY_SIZE = 0x28;

/**
 * Patch JSR-stub:
 *   - FUN_19692 → RTS (0x4E75) per neutralizzare il heavy entity-update.
 *     FUN_13A98 (RNG) is left live.
 */
function patchSubs(cpu: CpuSession): void {
  pokeMem(cpu, FUN_19692 + 0, 1, 0x4e);
  pokeMem(cpu, FUN_19692 + 1, 1, 0x75);
}

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) >>> 0;
    return ((s >>> 16) & 0xffff) / 0x10000;
  };
}

interface Snapshot {
  entity: number[]; // 0x28 byte
  rngSeed: number;  // u16 @ 0x4003A6
}

function snapshotBinary(cpu: CpuSession): Snapshot {
  const entity: number[] = [];
  for (let i = 0; i < ENTITY_SIZE; i++) {
    entity.push(peekMem(cpu, ENTITY_BASE + i, 1) & 0xff);
  }
  return { entity, rngSeed: peekMem(cpu, RNG_SEED_ADDR, 2) & 0xffff };
}

function snapshotTs(state: ReturnType<typeof stateNs.emptyGameState>): Snapshot {
  const entity: number[] = [];
  const off = ENTITY_BASE - 0x400000;
  for (let i = 0; i < ENTITY_SIZE; i++) {
    entity.push(state.workRam[off + i] ?? 0);
  }
  return { entity, rngSeed: (state.rng.seed as unknown as number) & 0xffff };
}

interface FailRecord {
  suite: string;
  tc: number;
  reason: string;
  binEntity: number[];
  tsEntity: number[];
  binSeed: number;
  tsSeed: number;
  inputEntity: number[];
  inputSeed: number;
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

  function setupCase(entityBytes: number[], rngSeed: number): void {
    // BINARY: write entity bytes + RNG seed
    for (let i = 0; i < ENTITY_SIZE; i++) {
      pokeMem(cpu, ENTITY_BASE + i, 1, entityBytes[i] ?? 0);
    }
    pokeMem(cpu, RNG_SEED_ADDR, 2, rngSeed & 0xffff);
    cpu.system.setRegister("sp", 0x401f00);

    // TS: same setup
    const off = ENTITY_BASE - 0x400000;
    for (let i = 0; i < ENTITY_SIZE; i++) {
      stateInst.workRam[off + i] = entityBytes[i] ?? 0;
    }
    stateInst.rng.seed = wrap.as_u32(rngSeed & 0xffff);
    stateInst.rng.callsThisFrame = wrap.as_u32(0);
  }

  function runOneCase(
    suite: string,
    tc: number,
    entityBytes: number[],
    rngSeed: number,
  ): boolean {
    setupCase(entityBytes, rngSeed);

    callFunction(cpu, FUN_1960E, [ENTITY_BASE]);
    const binSnap = snapshotBinary(cpu);

    sub1960ENs.stateSub1960E(stateInst, ENTITY_BASE, {
      fun_19692: () => {
        // no-op matching the binary stubbed with RTS.
      },
    });
    const tsSnap = snapshotTs(stateInst);

    let reason = "";
    if (binSnap.rngSeed !== tsSnap.rngSeed) {
      reason = `rngSeed bin=0x${binSnap.rngSeed.toString(16)} ts=0x${tsSnap.rngSeed.toString(16)}`;
    } else {
      for (let i = 0; i < ENTITY_SIZE; i++) {
        if (binSnap.entity[i] !== tsSnap.entity[i]) {
          reason = `entity[0x${i.toString(16)}] bin=0x${binSnap.entity[i]!.toString(16)} ts=0x${tsSnap.entity[i]!.toString(16)}`;
          break;
        }
      }
    }
    if (reason === "") return true;
    if (failHolder.value === null) {
      failHolder.value = {
        suite,
        tc,
        reason,
        binEntity: binSnap.entity.slice(),
        tsEntity: tsSnap.entity.slice(),
        binSeed: binSnap.rngSeed,
        tsSeed: tsSnap.rngSeed,
        inputEntity: entityBytes.slice(),
        inputSeed: rngSeed,
      };
    }
    return false;
  }

  const rng = makeRng(0x1960e);
  const rb = (): number => Math.floor(rng() * 256) & 0xff;
  const rs = (): number => Math.floor(rng() * 0x10000) & 0xffff;

  // ─── Suite A: random ─────────────────────────────────────────────────
  console.log(
    `\n=== stateSub1960E (FUN_0001960E) — Suite A: random — ${perSuite} casi ===`,
  );
  let okA = 0;
  for (let i = 0; i < perSuite; i++) {
    const entity = new Array(ENTITY_SIZE).fill(0).map(() => rb());
    if (runOneCase("A", i, entity, rs())) okA++;
  }
  console.log(`  Match: ${okA}/${perSuite} = ${((okA / perSuite) * 100).toFixed(1)}%`);
  totalOk += okA;

  // ─── Suite B: state==7 (jitter ±2) ───────────────────────────────────
  console.log(
    `\n=== Suite B: forced state==7 (jitter branch) — ${perSuite} casi ===`,
  );
  let okB = 0;
  for (let i = 0; i < perSuite; i++) {
    const entity = new Array(ENTITY_SIZE).fill(0).map(() => rb());
    entity[0x25] = 0x07; // forza branch state==7
    if (runOneCase("B", i, entity, rs())) okB++;
  }
  console.log(`  Match: ${okB}/${perSuite} = ${((okB / perSuite) * 100).toFixed(1)}%`);
  totalOk += okB;

  // ─── Suite C: state==9, long0==0 (clear-block possible) ──────────────
  console.log(
    `\n=== Suite C: state==9 + long0==0 (clear-block path) — ${perSuite} casi ===`,
  );
  let okC = 0;
  for (let i = 0; i < perSuite; i++) {
    const entity = new Array(ENTITY_SIZE).fill(0).map(() => rb());
    entity[0x25] = 0x09;
    // long0 == 0 in some cases and != 0 in others (50/50) to cover both.
    if ((i & 1) === 0) {
      entity[0] = entity[1] = entity[2] = entity[3] = 0;
    } else {
      // Forza long0 != 0 (almeno un byte)
      entity[0] = ((entity[0] ?? 0) | 0x80) & 0xff;
    }
    if (runOneCase("C", i, entity, rs())) okC++;
  }
  console.log(`  Match: ${okC}/${perSuite} = ${((okC / perSuite) * 100).toFixed(1)}%`);
  totalOk += okC;

  // ─── Suite D: edge cases ─────────────────────────────────────────────
  const sizeD = perSuite + remainder;
  console.log(
    `\n=== Suite D: edge cases (state boundaries, counter saturation) — ${sizeD} casi ===`,
  );
  let okD = 0;
  const stateBytes = [0x00, 0x01, 0x06, 0x07, 0x08, 0x09, 0x0a, 0xff];
  const counterBytes = [0x00, 0x01, 0x07, 0x08, 0x0f, 0x10, 0xfe, 0xff];
  for (let i = 0; i < sizeD; i++) {
    const entity = new Array(ENTITY_SIZE).fill(0).map(() => rb());
    entity[0x25] = stateBytes[Math.floor(rng() * stateBytes.length)]!;
    entity[0x26] = counterBytes[Math.floor(rng() * counterBytes.length)]!;
    // Toggle long0 zero/nonzero
    if ((i & 1) === 0) {
      entity[0] = entity[1] = entity[2] = entity[3] = 0;
    }
    if (runOneCase("D", i, entity, rs())) okD++;
  }
  console.log(`  Match: ${okD}/${sizeD} = ${((okD / sizeD) * 100).toFixed(1)}%`);
  totalOk += okD;

  console.log(
    `\n=== TOTALE: ${totalOk}/${total} = ${((totalOk / total) * 100).toFixed(1)}% ===`,
  );
  if (failHolder.value !== null) {
    const f = failHolder.value;
    console.log(`  First fail (suite ${f.suite} tc=${f.tc}): ${f.reason}`);
    console.log(`    inputSeed=0x${f.inputSeed.toString(16)}`);
    console.log(`    inputEntity[0x25]=0x${f.inputEntity[0x25]!.toString(16)} [0x26]=0x${f.inputEntity[0x26]!.toString(16)}`);
    console.log(`    long0=0x${(((f.inputEntity[0]! << 24) | (f.inputEntity[1]! << 16) | (f.inputEntity[2]! << 8) | f.inputEntity[3]!) >>> 0).toString(16)}`);
    console.log(`    binSeedAfter=0x${f.binSeed.toString(16)} tsSeedAfter=0x${f.tsSeed.toString(16)}`);
    console.log(`    binEntity[0x26]=0x${f.binEntity[0x26]!.toString(16)} tsEntity[0x26]=0x${f.tsEntity[0x26]!.toString(16)}`);
  }

  disposeCpu(cpu);
  exit(totalOk === total ? 0 : 1);
}

main().catch(e => {
  console.error(e);
  exit(1);
});
