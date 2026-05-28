#!/usr/bin/env node
/**
 * test-state-sub-198bc-parity.ts — differential FUN_000198BC vs
 * `stateSub198BC`.
 *
 * FUN_000198BC (186 byte): "entity move-and-validate retry loop". Tenta di
 * move the entity through `FUN_19976` (applyMoveVelocity) + `FUN_1937C`
 * (validatePosition); if invalid on first attempt -> restore. If valid, loop
 * for up to 9 iterations by rotating `entity[0x26]` by step (1 if state==7,
 * otherwise 4) and re-validating. Exit with stuck marker (`entity[0x26]=0x10`,
 * `entity[0..7]=0`) if the loop is exhausted.
 *
 * **Strategia parity**:
 *   - `FUN_00019976` (move-velocity) **lasciato live**: replicato bit-perfect
 *     in `move-velocity.ts:applyMoveVelocity`, already 100% validated (cf.
 *     test-move-velocity-parity).
 *   - `FUN_0001937C` (validate-position) **lasciato live**: replicato in
 *     `proximity-check.ts:validatePosition`, already 100% validated (cf.
 *     test-proximity-check-parity).
 *   - Compare:
 *       * `entity[0x00..0x27]` (0x28 byte = 1 entity stride)
 *       * proximity array bytes @ 0x401890..0x401a00 (9 × 0x28 = 0x168)
 *
 * **Suite** (4 × 125 = 500):
 *   - A: random — entity + 9 proximity entries random
 *   - B: forced state==7 (step=1, apply every iteration)
 *   - C: position near the ROM grid (testGridBitmap likely true)
 *   - D: edge cases — counter saturation, state boundaries, marker 0x10
 *
 * Uso: npx tsx packages/cli/src/test-state-sub-198bc-parity.ts [N]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import {
  state as stateNs,
  stateSub198BC as sub198bcNs,
  moveVelocity as moveVelNs,
  proximityCheck as proxNs,
  gridBitmapTest as gridNs,
  bus as busNs,
} from "@marble-love/engine";
import type { RomImage } from "@marble-love/engine";
import {
  createCpu,
  callFunction,
  pokeMem,
  peekMem,
  disposeCpu,
} from "./binary-oracle-lib.js";
import type { CpuSession } from "./binary-oracle-lib.js";

const FUN_198BC = 0x000198bc;

const ENTITY_BASE = 0x00401e00;
const ENTITY_SIZE = 0x28;

// Proximity check array (FUN_193D8) — 9 × 0x28 byte.
const PROX_ARRAY_BASE = 0x00401890;
const PROX_ARRAY_COUNT = 9;
const PROX_ENTRY_SIZE = 0x28;
const PROX_ARRAY_END = PROX_ARRAY_BASE + PROX_ARRAY_COUNT * PROX_ENTRY_SIZE;

/**
 * Patch JSR-stub: none. Both `FUN_19976` and `FUN_1937C` are left
 * **live** e replicati 1:1 in TS.
 */
function patchSubs(_cpu: CpuSession): void {
  // No-op: live mode.
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
  proxArray: number[]; // 9 × 0x28 = 0x168 byte
}

function snapshotBinary(cpu: CpuSession): Snapshot {
  const entity: number[] = [];
  for (let i = 0; i < ENTITY_SIZE; i++) {
    entity.push(peekMem(cpu, ENTITY_BASE + i, 1) & 0xff);
  }
  const proxArray: number[] = [];
  for (let i = 0; i < PROX_ARRAY_END - PROX_ARRAY_BASE; i++) {
    proxArray.push(peekMem(cpu, PROX_ARRAY_BASE + i, 1) & 0xff);
  }
  return { entity, proxArray };
}

function snapshotTs(state: ReturnType<typeof stateNs.emptyGameState>): Snapshot {
  const entity: number[] = [];
  const offE = ENTITY_BASE - 0x400000;
  for (let i = 0; i < ENTITY_SIZE; i++) {
    entity.push(state.workRam[offE + i] ?? 0);
  }
  const proxArray: number[] = [];
  const offP = PROX_ARRAY_BASE - 0x400000;
  for (let i = 0; i < PROX_ARRAY_END - PROX_ARRAY_BASE; i++) {
    proxArray.push(state.workRam[offP + i] ?? 0);
  }
  return { entity, proxArray };
}

interface FailRecord {
  suite: string;
  tc: number;
  reason: string;
  binEntity: number[];
  tsEntity: number[];
  inputEntity: number[];
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

  // ROM image for TS subs: move-velocity reads ROM dx/dy tables, and grid-bitmap
  // reads the ROM grid table.
  const tsRom: RomImage = busNs.emptyRomImage();
  tsRom.program.set(rom.subarray(0, tsRom.program.length));

  let totalOk = 0;
  const failHolder: { value: FailRecord | null } = { value: null };

  function setupCase(
    entityBytes: number[],
    proxBytes: number[],
  ): void {
    // BINARY: write entity bytes.
    for (let i = 0; i < ENTITY_SIZE; i++) {
      pokeMem(cpu, ENTITY_BASE + i, 1, entityBytes[i] ?? 0);
    }
    // BINARY: write 9 proximity entries.
    for (let i = 0; i < proxBytes.length; i++) {
      pokeMem(cpu, PROX_ARRAY_BASE + i, 1, proxBytes[i] ?? 0);
    }
    cpu.system.setRegister("sp", 0x401f00);

    // TS: same setup.
    const offE = ENTITY_BASE - 0x400000;
    for (let i = 0; i < ENTITY_SIZE; i++) {
      stateInst.workRam[offE + i] = entityBytes[i] ?? 0;
    }
    const offP = PROX_ARRAY_BASE - 0x400000;
    for (let i = 0; i < proxBytes.length; i++) {
      stateInst.workRam[offP + i] = proxBytes[i] ?? 0;
    }
  }

  function runOneCase(
    suite: string,
    tc: number,
    entityBytes: number[],
    proxBytes: number[],
  ): boolean {
    setupCase(entityBytes, proxBytes);

    callFunction(cpu, FUN_198BC, [ENTITY_BASE]);
    const binSnap = snapshotBinary(cpu);

    sub198bcNs.stateSub198BC(stateInst, ENTITY_BASE, {
      fun_19976: (st, addr) => {
        moveVelNs.applyMoveVelocity(st, tsRom, addr);
      },
      fun_1937c: (st, addr) =>
        proxNs.validatePosition(st, tsRom, gridNs.testGridBitmap, addr),
    });
    const tsSnap = snapshotTs(stateInst);

    let reason = "";
    for (let i = 0; i < ENTITY_SIZE; i++) {
      if (binSnap.entity[i] !== tsSnap.entity[i]) {
        reason = `entity[0x${i.toString(16)}] bin=0x${binSnap.entity[i]!.toString(16)} ts=0x${tsSnap.entity[i]!.toString(16)}`;
        break;
      }
    }
    if (reason === "") {
      for (let i = 0; i < binSnap.proxArray.length; i++) {
        if (binSnap.proxArray[i] !== tsSnap.proxArray[i]) {
          reason = `proxArray[0x${i.toString(16)}] bin=0x${binSnap.proxArray[i]!.toString(16)} ts=0x${tsSnap.proxArray[i]!.toString(16)}`;
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
        inputEntity: entityBytes.slice(),
      };
    }
    return false;
  }

  const rng = makeRng(0x198bc);
  const rb = (): number => Math.floor(rng() * 256) & 0xff;

  function genProx(): number[] {
    return new Array(PROX_ARRAY_COUNT * PROX_ENTRY_SIZE)
      .fill(0)
      .map(() => rb());
  }

  function genEntity(): number[] {
    return new Array(ENTITY_SIZE).fill(0).map(() => rb());
  }

  // ─── Suite A: random ─────────────────────────────────────────────────
  console.log(
    `\n=== stateSub198BC (FUN_000198BC) — Suite A: random — ${perSuite} casi ===`,
  );
  let okA = 0;
  for (let i = 0; i < perSuite; i++) {
    const entity = genEntity();
    if (runOneCase("A", i, entity, genProx())) okA++;
  }
  console.log(`  Match: ${okA}/${perSuite} = ${((okA / perSuite) * 100).toFixed(1)}%`);
  totalOk += okA;

  // ─── Suite B: state==7 (step=1, apply ogni iter) ───────────────────────
  console.log(
    `\n=== Suite B: forced state==7 (fine-step branch) — ${perSuite} casi ===`,
  );
  let okB = 0;
  for (let i = 0; i < perSuite; i++) {
    const entity = genEntity();
    entity[0x25] = 0x07;
    // counter in [0..0x0F] to avoid early-out marker and provide valid range.
    entity[0x26] = Math.floor(rng() * 0x10);
    if (runOneCase("B", i, entity, genProx())) okB++;
  }
  console.log(`  Match: ${okB}/${perSuite} = ${((okB / perSuite) * 100).toFixed(1)}%`);
  totalOk += okB;

  // ─── Suite C: pos near grid origin (validate often returns 0) ─────────
  console.log(
    `\n=== Suite C: pos vicina alla grid (validate path varied) — ${perSuite} casi ===`,
  );
  let okC = 0;
  for (let i = 0; i < perSuite; i++) {
    const entity = genEntity();
    // Pos x,y in zona grid-mappata: x ∈ [0x100..0x300], y ∈ [0x100..0x300]
    // proximityCheck reads byte+0xC..+0xD as word x.
    const x = 0x100 + Math.floor(rng() * 0x200);
    const y = 0x100 + Math.floor(rng() * 0x200);
    entity[0x0c] = (x >>> 8) & 0xff;
    entity[0x0d] = x & 0xff;
    entity[0x0e] = 0;
    entity[0x0f] = 0;
    entity[0x10] = (y >>> 8) & 0xff;
    entity[0x11] = y & 0xff;
    entity[0x12] = 0;
    entity[0x13] = 0;
    entity[0x26] = Math.floor(rng() * 0x10);
    if (runOneCase("C", i, entity, genProx())) okC++;
  }
  console.log(`  Match: ${okC}/${perSuite} = ${((okC / perSuite) * 100).toFixed(1)}%`);
  totalOk += okC;

  // ─── Suite D: edge cases ─────────────────────────────────────────────
  const sizeD = perSuite + remainder;
  console.log(
    `\n=== Suite D: edge cases (state/counter boundaries, marker 0x10) — ${sizeD} casi ===`,
  );
  let okD = 0;
  const stateBytes = [0x00, 0x01, 0x06, 0x07, 0x08, 0x09, 0xff];
  const counterBytes = [0x00, 0x01, 0x07, 0x08, 0x0f, 0x10, 0x11, 0xff];
  for (let i = 0; i < sizeD; i++) {
    const entity = genEntity();
    entity[0x25] = stateBytes[Math.floor(rng() * stateBytes.length)]!;
    entity[0x26] = counterBytes[Math.floor(rng() * counterBytes.length)]!;
    if (runOneCase("D", i, entity, genProx())) okD++;
  }
  console.log(`  Match: ${okD}/${sizeD} = ${((okD / sizeD) * 100).toFixed(1)}%`);
  totalOk += okD;

  console.log(
    `\n=== TOTALE: ${totalOk}/${total} = ${((totalOk / total) * 100).toFixed(1)}% ===`,
  );
  if (failHolder.value !== null) {
    const f = failHolder.value;
    console.log(`  First fail (suite ${f.suite} tc=${f.tc}): ${f.reason}`);
    console.log(`    inputEntity[0x25]=0x${f.inputEntity[0x25]!.toString(16)} [0x26]=0x${f.inputEntity[0x26]!.toString(16)}`);
    console.log(`    inputPos x=0x${(((f.inputEntity[0x0c]! << 8) | f.inputEntity[0x0d]!) >>> 0).toString(16)} y=0x${(((f.inputEntity[0x10]! << 8) | f.inputEntity[0x11]!) >>> 0).toString(16)}`);
    console.log(`    binEntity[0x26]=0x${f.binEntity[0x26]!.toString(16)} tsEntity[0x26]=0x${f.tsEntity[0x26]!.toString(16)}`);
    console.log(`    binPos.x=0x${(((f.binEntity[0x0c]! << 24) | (f.binEntity[0x0d]! << 16) | (f.binEntity[0x0e]! << 8) | f.binEntity[0x0f]!) >>> 0).toString(16)} tsPos.x=0x${(((f.tsEntity[0x0c]! << 24) | (f.tsEntity[0x0d]! << 16) | (f.tsEntity[0x0e]! << 8) | f.tsEntity[0x0f]!) >>> 0).toString(16)}`);
  }

  disposeCpu(cpu);
  exit(totalOk === total ? 0 : 1);
}

main().catch(e => {
  console.error(e);
  exit(1);
});
