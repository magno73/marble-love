#!/usr/bin/env node
/**
 * test-state-sub-19a40-parity.ts — differential FUN_00019A40 vs
 * `stateSub19A40`.
 *
 * FUN_00019A40 (362 byte, 0x19A40-0x19BAA): "entity-table spawn dispatcher".
 * pair counts matches `entity[0x0C..0x0D].w >> 3 == X` with `entity[0x18]==1`,
 * does proximity-check Y if 1 match, and spawns in the first free slot. Exits if
 *
 * **Strategia parity**:
 *   - `FUN_00019E42` (marble-cell-dispatch) **stubbed with RTS**.
 *   - `FUN_00018E6C` (slot-insert-sorted) **stubbed with RTS**.
 *   - `FUN_000158AC` (sound/event dispatch) **stubbed with RTS**.
 *
 * **Suite** (4 × 125 = 500):
 *   - D: edge case with 9/10 occupied slots and exact X values from the ROM table
 *
 * Uso: npx tsx packages/cli/src/test-state-sub-19a40-parity.ts [N]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import {
  state as stateNs,
  stateSub19A40 as sub19A40Ns,
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

const FUN_19A40 = 0x00019a40;
const FUN_19E42 = 0x00019e42;
const FUN_18E6C = 0x00018e6c;
const FUN_158AC = 0x000158ac;

const ENTITY_TABLE_BASE = 0x004019f8;
const ENTITY_STRIDE = 0x38;
const ENTITY_COUNT = 10;
const TABLE_SIZE = ENTITY_STRIDE * ENTITY_COUNT; // 0x230

/**
 * regardless of what the subs do. The TS uses `subs.fun_* = noop`.
 */
function patchSubs(cpu: CpuSession): void {
  pokeMem(cpu, FUN_19E42 + 0, 1, 0x4e);
  pokeMem(cpu, FUN_19E42 + 1, 1, 0x75);
  pokeMem(cpu, FUN_18E6C + 0, 1, 0x4e);
  pokeMem(cpu, FUN_18E6C + 1, 1, 0x75);
  pokeMem(cpu, FUN_158AC + 0, 1, 0x4e);
  pokeMem(cpu, FUN_158AC + 1, 1, 0x75);
}

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) >>> 0;
    return ((s >>> 16) & 0xffff) / 0x10000;
  };
}

interface Snapshot {
  table: number[]; // 0x230 byte
}

function snapshotBinary(cpu: CpuSession): Snapshot {
  const table: number[] = [];
  for (let i = 0; i < TABLE_SIZE; i++) {
    table.push(peekMem(cpu, ENTITY_TABLE_BASE + i, 1) & 0xff);
  }
  return { table };
}

function snapshotTs(state: ReturnType<typeof stateNs.emptyGameState>): Snapshot {
  const table: number[] = [];
  const off = ENTITY_TABLE_BASE - 0x400000;
  for (let i = 0; i < TABLE_SIZE; i++) {
    table.push(state.workRam[off + i] ?? 0);
  }
  return { table };
}

interface FailRecord {
  suite: string;
  tc: number;
  reason: string;
  binTable: number[];
  tsTable: number[];
  inputTable: number[];
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

  const tsRom: RomImage = busNs.emptyRomImage();
  tsRom.program.set(rom.subarray(0, tsRom.program.length));

  let totalOk = 0;
  const failHolder: { value: FailRecord | null } = { value: null };

  function setupCase(tableBytes: number[]): void {
    // BINARY: write entity table.
    for (let i = 0; i < TABLE_SIZE; i++) {
      pokeMem(cpu, ENTITY_TABLE_BASE + i, 1, tableBytes[i] ?? 0);
    }
    cpu.system.setRegister("sp", 0x401f00);

    // TS: same setup.
    const off = ENTITY_TABLE_BASE - 0x400000;
    for (let i = 0; i < TABLE_SIZE; i++) {
      stateInst.workRam[off + i] = tableBytes[i] ?? 0;
    }
  }

  function runOneCase(
    suite: string,
    tc: number,
    tableBytes: number[],
  ): boolean {
    setupCase(tableBytes);

    callFunction(cpu, FUN_19A40, []);
    const binSnap = snapshotBinary(cpu);

    sub19A40Ns.stateSub19A40(stateInst, tsRom, {
      fun_19e42: () => {
        // no-op (stubbed RTS).
      },
      fun_18e6c: () => {
        // no-op.
      },
      fun_158ac: () => {
        // no-op.
      },
    });
    const tsSnap = snapshotTs(stateInst);

    let reason = "";
    for (let i = 0; i < TABLE_SIZE; i++) {
      if (binSnap.table[i] !== tsSnap.table[i]) {
        const slot = Math.floor(i / ENTITY_STRIDE);
        const fld = i % ENTITY_STRIDE;
        reason = `entity[${slot}][0x${fld.toString(16)}] bin=0x${binSnap.table[i]!.toString(16)} ts=0x${tsSnap.table[i]!.toString(16)}`;
        break;
      }
    }
    if (reason === "") return true;
    if (failHolder.value === null) {
      failHolder.value = {
        suite,
        tc,
        reason,
        binTable: binSnap.table.slice(),
        tsTable: tsSnap.table.slice(),
        inputTable: tableBytes.slice(),
      };
    }
    return false;
  }

  const rng = makeRng(0x19a40);
  const rb = (): number => Math.floor(rng() * 256) & 0xff;

  function genTableRandom(): number[] {
    return new Array(TABLE_SIZE).fill(0).map(() => rb());
  }

  function genTableEmpty(): number[] {
    const t = new Array(TABLE_SIZE).fill(0).map(() => rb());
    for (let i = 0; i < ENTITY_COUNT; i++) {
      t[i * ENTITY_STRIDE + 0x18] = 0;
    }
    return t;
  }

  // ROM pair table values @ 0x244F6: (0x39,0x3F),(0x37,0x3F),(0x31,0x3A),
  // (0x2F,0x3A),(0x29,0x3A). X values: 0x39, 0x37, 0x31, 0x2F, 0x29.
  const PAIR_X_VALUES = [0x39, 0x37, 0x31, 0x2f, 0x29];

  function genTableForcedMatch(seedSlots: number[]): number[] {
    // Set some occupied slots with X = pair-X to trigger D3 == 1 in scan.
    const t = new Array(TABLE_SIZE).fill(0).map(() => rb());
    for (let i = 0; i < ENTITY_COUNT; i++) {
      t[i * ENTITY_STRIDE + 0x18] = 0; // start all free
    }
    for (const slot of seedSlots) {
      const off = slot * ENTITY_STRIDE;
      t[off + 0x18] = 1; // occupied
      // X word at 0x0C..0x0D such that (xWord >> 3) == pair-X.
      // Pick a random pair-X and set xWord = pairX << 3 (8 * pairX).
      const pairX = PAIR_X_VALUES[Math.floor(rng() * PAIR_X_VALUES.length)]!;
      const xWord = (pairX << 3) & 0xffff;
      t[off + 0x0c] = (xWord >>> 8) & 0xff;
      t[off + 0x0d] = xWord & 0xff;
      // Y word at 0x10..0x11 random (to test prox-check both paths).
      // For some cases, set Y >> 3 such that (D7 - (Y>>3)) >= 4 (allow spawn);
      // for others, < 4 (skip). Random gives a mix.
      t[off + 0x10] = rb();
      t[off + 0x11] = rb();
    }
    return t;
  }

  // ─── Suite A: random ─────────────────────────────────────────────────
  console.log(
    `\n=== stateSub19A40 (FUN_00019A40) — Suite A: random — ${perSuite} cases ===`,
  );
  let okA = 0;
  for (let i = 0; i < perSuite; i++) {
    if (runOneCase("A", i, genTableRandom())) okA++;
  }
  console.log(`  Match: ${okA}/${perSuite} = ${((okA / perSuite) * 100).toFixed(1)}%`);
  totalOk += okA;

  console.log(
    `\n=== Suite B: all slots free (D3==0 always) — ${perSuite} cases ===`,
  );
  let okB = 0;
  for (let i = 0; i < perSuite; i++) {
    if (runOneCase("B", i, genTableEmpty())) okB++;
  }
  console.log(`  Match: ${okB}/${perSuite} = ${((okB / perSuite) * 100).toFixed(1)}%`);
  totalOk += okB;

  console.log(
    `\n=== Suite C: forced match (1-3 slot con X = ROM pair) — ${perSuite} cases ===`,
  );
  let okC = 0;
  for (let i = 0; i < perSuite; i++) {
    const numSeed = 1 + Math.floor(rng() * 3); // 1..3 slot
    const slots: number[] = [];
    while (slots.length < numSeed) {
      const s = Math.floor(rng() * ENTITY_COUNT);
      if (!slots.includes(s)) slots.push(s);
    }
    if (runOneCase("C", i, genTableForcedMatch(slots))) okC++;
  }
  console.log(`  Match: ${okC}/${perSuite} = ${((okC / perSuite) * 100).toFixed(1)}%`);
  totalOk += okC;

  // ─── Suite D: edge — 9/10 occupied, various config ─────────────────────
  const sizeD = perSuite + remainder;
  console.log(
    `\n=== Suite D: edge cases (9/10 slots occupied + early-exit) — ${sizeD} cases ===`,
  );
  let okD = 0;
  for (let i = 0; i < sizeD; i++) {
    const t = new Array(TABLE_SIZE).fill(0).map(() => rb());
    // Decide occupied slot count: skew toward 8-10 for early-exit testing.
    const numOccupied = 7 + Math.floor(rng() * 4); // 7..10
    const occupied: number[] = [];
    while (occupied.length < numOccupied) {
      const s = Math.floor(rng() * ENTITY_COUNT);
      if (!occupied.includes(s)) occupied.push(s);
    }
    for (let j = 0; j < ENTITY_COUNT; j++) {
      const off = j * ENTITY_STRIDE;
      t[off + 0x18] = occupied.includes(j) ? 1 : 0;
      // Mix some X with pair-X to trigger match scan.
      if ((rng() & 1) === 0) {
        const pairX = PAIR_X_VALUES[Math.floor(rng() * PAIR_X_VALUES.length)]!;
        const xWord = (pairX << 3) & 0xffff;
        t[off + 0x0c] = (xWord >>> 8) & 0xff;
        t[off + 0x0d] = xWord & 0xff;
      }
    }
    if (runOneCase("D", i, t)) okD++;
  }
  console.log(`  Match: ${okD}/${sizeD} = ${((okD / sizeD) * 100).toFixed(1)}%`);
  totalOk += okD;

  console.log(
    `\n=== TOTALE: ${totalOk}/${total} = ${((totalOk / total) * 100).toFixed(1)}% ===`,
  );
  if (failHolder.value !== null) {
    const f = failHolder.value;
    console.log(`  First fail (suite ${f.suite} tc=${f.tc}): ${f.reason}`);
    // Diff-dump first slot divergente.
    for (let i = 0; i < TABLE_SIZE; i++) {
      if (f.binTable[i] !== f.tsTable[i]) {
        const slot = Math.floor(i / ENTITY_STRIDE);
        console.log(`    slot ${slot} diff @ 0x${(i % ENTITY_STRIDE).toString(16)}: bin=0x${f.binTable[i]!.toString(16)} ts=0x${f.tsTable[i]!.toString(16)}`);
        if (i > 8 && i + 8 < TABLE_SIZE) {
          // print surrounding bytes for context (3 before, 3 after)
        }
        break;
      }
    }
    // Print initial occupancy.
    const occMask: number[] = [];
    for (let j = 0; j < ENTITY_COUNT; j++) {
      occMask.push(f.inputTable[j * ENTITY_STRIDE + 0x18] ?? 0);
    }
    console.log(`    inputOccMask=[${occMask.map(x => x === 1 ? "X" : ".").join(",")}]`);
  }

  disposeCpu(cpu);
  exit(totalOk === total ? 0 : 1);
}

main().catch(e => {
  console.error(e);
  exit(1);
});
