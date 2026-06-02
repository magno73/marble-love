#!/usr/bin/env node
/**
 * test-refresh-helper-1912c-parity.ts — differential FUN_0001912C vs
 * `refreshHelper1912C`.
 *
 * `FUN_0001912C` (130 byte): "refresh-frame entity ticker with slot-scan flag".
 * Gate on `*0x400394.w == 4`, slot scan @ 0x400018 (stride 0xE2, count
 * `*0x400396`) for the flag D3, then iterates 9 entity @ 0x401890 (stride 0x28)
 * by D3, threshold check, and branch on `entity[0x25]` (state==7 / state!=7) with
 *
 * **Parity strategy**:
 *   - `FUN_000194BA` (`objectTypeDispatch194BA`) **stubbed with RTS** (0x4E75).
 *   - `FUN_000199D6` (`computeSpriteCoords_v2`) **stubbed with RTS** (0x4E75).
 *   - Both callees have no active sub injection in the TS (no-op).
 *   - Compare:
 *       * Entity table @ 0x401890 (9 × 0x28 = 0x168 byte)
 *       * Globals: workRam slice @ 0x400394..0x400399 (game-mode word + slot-count word)
 *   - No RNG consumption (FUN_0001912C does not use the RNG).
 *
 * **Suite** (4 × 125 = 500):
 *   - A: random entity table, random globals, no slot scan (count=0)
 *   - C: forced state==7 on entity, varied kind byte and sub-counter
 *   - D: edge cases (entity[0x25]=7/non-7, kind=0/1/2, counter thresholds)
 *
 * Usage: npx tsx packages/cli/src/test-refresh-helper-1912c-parity.ts [N]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import {
  state as stateNs,
  refreshHelper1912C as helperNs,
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

const FUN_1912C = 0x0001912c;
const FUN_194BA = 0x000194ba;
const FUN_199D6 = 0x000199d6;

/** m68k addr of entity table. */
const ENTITY_TABLE_BASE = helperNs.ENTITY_TABLE_BASE;
const ENTITY_STRIDE = helperNs.ENTITY_STRIDE;
const ENTITY_COUNT = helperNs.ENTITY_COUNT;
const TABLE_SIZE = ENTITY_STRIDE * ENTITY_COUNT; // 9 × 0x28 = 0x168

const SLOT_ARRAY_BASE = helperNs.SLOT_ARRAY_BASE;
const SLOT_STRIDE = helperNs.SLOT_STRIDE;

const GAME_MODE_ADDR = 0x00400394;
const SLOT_COUNT_ADDR = 0x00400396;

/**
 * Stub FUN_194BA and FUN_199D6 with plain RTS so binary side-effects from
 * these callees are neutralised. TS uses default no-op subs.
 */
function patchSubs(cpu: CpuSession): void {
  for (const addr of [FUN_194BA, FUN_199D6]) {
    pokeMem(cpu, addr + 0, 1, 0x4e);
    pokeMem(cpu, addr + 1, 1, 0x75);
  }
}

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) >>> 0;
    return ((s >>> 16) & 0xffff) / 0x10000;
  };
}

interface Snapshot {
  /** Entity table: 9 × 0x28 = 0x168 byte. */
  entityTable: number[];
  slotArea: number[];
  /** Game-mode word @ 0x400394. */
  gameMode: number;
  /** Slot-count word @ 0x400396. */
  slotCount: number;
}

const SLOT_AREA_SIZE = 2 * SLOT_STRIDE; // snapshot 2 slots always

function snapshotBinary(cpu: CpuSession): Snapshot {
  const entityTable: number[] = [];
  for (let i = 0; i < TABLE_SIZE; i++) {
    entityTable.push(peekMem(cpu, ENTITY_TABLE_BASE + i, 1) & 0xff);
  }
  const slotArea: number[] = [];
  for (let i = 0; i < SLOT_AREA_SIZE; i++) {
    slotArea.push(peekMem(cpu, SLOT_ARRAY_BASE + i, 1) & 0xff);
  }
  return {
    entityTable,
    slotArea,
    gameMode: peekMem(cpu, GAME_MODE_ADDR, 2) & 0xffff,
    slotCount: peekMem(cpu, SLOT_COUNT_ADDR, 2) & 0xffff,
  };
}

function snapshotTs(state: ReturnType<typeof stateNs.emptyGameState>): Snapshot {
  const entityTable: number[] = [];
  const tableOff = ENTITY_TABLE_BASE - 0x400000;
  for (let i = 0; i < TABLE_SIZE; i++) {
    entityTable.push(state.workRam[tableOff + i] ?? 0);
  }
  const slotArea: number[] = [];
  const slotOff = SLOT_ARRAY_BASE - 0x400000;
  for (let i = 0; i < SLOT_AREA_SIZE; i++) {
    slotArea.push(state.workRam[slotOff + i] ?? 0);
  }
  const rd16 = (o: number): number =>
    (((state.workRam[o] ?? 0) << 8) | (state.workRam[o + 1] ?? 0)) & 0xffff;
  return {
    entityTable,
    slotArea,
    gameMode: rd16(0x394),
    slotCount: rd16(0x396),
  };
}

interface FailRecord {
  suite: string;
  tc: number;
  reason: string;
  binTable: number[];
  tsTable: number[];
  inputTable: number[];
  inputGameMode: number;
  inputSlotCount: number;
  inputSlotArea: number[];
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

  /**
   * Write entity table, globals, and slot area to both binary CPU and TS state.
   */
  function setupCase(
    tableBytes: number[],
    gameMode: number,
    slotCount: number,
    slotAreaBytes: number[],
  ): void {
    // ── Binary ──────────────────────────────────────────────────────────────
    for (let i = 0; i < TABLE_SIZE; i++) {
      pokeMem(cpu, ENTITY_TABLE_BASE + i, 1, tableBytes[i] ?? 0);
    }
    pokeMem(cpu, GAME_MODE_ADDR, 2, gameMode & 0xffff);
    pokeMem(cpu, SLOT_COUNT_ADDR, 2, slotCount & 0xffff);
    for (let i = 0; i < SLOT_AREA_SIZE; i++) {
      pokeMem(cpu, SLOT_ARRAY_BASE + i, 1, slotAreaBytes[i] ?? 0);
    }
    cpu.system.setRegister("sp", 0x401f00);

    // ── TS ───────────────────────────────────────────────────────────────────
    const tableOff = ENTITY_TABLE_BASE - 0x400000;
    for (let i = 0; i < TABLE_SIZE; i++) {
      stateInst.workRam[tableOff + i] = tableBytes[i] ?? 0;
    }
    stateInst.workRam[0x394] = (gameMode >>> 8) & 0xff;
    stateInst.workRam[0x395] = gameMode & 0xff;
    stateInst.workRam[0x396] = (slotCount >>> 8) & 0xff;
    stateInst.workRam[0x397] = slotCount & 0xff;
    const slotOff = SLOT_ARRAY_BASE - 0x400000;
    for (let i = 0; i < SLOT_AREA_SIZE; i++) {
      stateInst.workRam[slotOff + i] = slotAreaBytes[i] ?? 0;
    }
  }

  function runOneCase(
    suite: string,
    tc: number,
    tableBytes: number[],
    gameMode: number,
    slotCount: number,
    slotAreaBytes: number[],
  ): boolean {
    setupCase(tableBytes, gameMode, slotCount, slotAreaBytes);
    const inputTable = tableBytes.slice();

    callFunction(cpu, FUN_1912C, []);
    const binSnap = snapshotBinary(cpu);

    // TS: no-op subs (matching RTS stubs in binary).
    helperNs.refreshHelper1912C(stateInst, tsRom);
    const tsSnap = snapshotTs(stateInst);

    // ── Compare ──────────────────────────────────────────────────────────────
    let reason = "";
    for (let i = 0; i < TABLE_SIZE; i++) {
      if (binSnap.entityTable[i] !== tsSnap.entityTable[i]) {
        const slot = Math.floor(i / ENTITY_STRIDE);
        const fld = i % ENTITY_STRIDE;
        reason = `entity[${slot}][0x${fld.toString(16)}] bin=0x${(binSnap.entityTable[i] ?? 0).toString(16)} ts=0x${(tsSnap.entityTable[i] ?? 0).toString(16)}`;
        break;
      }
    }
    if (reason === "") {
      for (let i = 0; i < SLOT_AREA_SIZE; i++) {
        if (binSnap.slotArea[i] !== tsSnap.slotArea[i]) {
          reason = `slotArea[${i}] bin=0x${(binSnap.slotArea[i] ?? 0).toString(16)} ts=0x${(tsSnap.slotArea[i] ?? 0).toString(16)}`;
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
        binTable: binSnap.entityTable.slice(),
        tsTable: tsSnap.entityTable.slice(),
        inputTable,
        inputGameMode: gameMode,
        inputSlotCount: slotCount,
        inputSlotArea: slotAreaBytes.slice(),
      };
    }
    return false;
  }

  const rng = makeRng(0x1912c);
  const rb = (): number => Math.floor(rng() * 256) & 0xff;
  const rs = (): number => Math.floor(rng() * 0x10000) & 0xffff;

  /**
   * Generate a random entity table. `activeProb` is the probability [0..1]
   * that entity[0x18] != 0. If `safeScriptPtrs` is true, script ptrs are
   * set to ROM addresses (0x00000000) rather than random (avoids reading
   * garbage ROM).
   */
  function genTable(activeProb: number, safeScriptPtrs: boolean): number[] {
    const t = new Array(TABLE_SIZE).fill(0).map(() => rb());
    for (let s = 0; s < ENTITY_COUNT; s++) {
      const base = s * ENTITY_STRIDE;
      // entity[0x18]: active flag
      t[base + 0x18] = rng() < activeProb ? 1 : 0;
      if (safeScriptPtrs) {
        // script ptr at entity[0x1c..0x1f] = 0 (ROM offset 0, safe to read)
        t[base + 0x1c] = 0;
        t[base + 0x1d] = 0;
        t[base + 0x1e] = 0;
        t[base + 0x1f] = 0;
      }
    }
    return t;
  }

  /** Generate a random slot area (up to 2 slots × 0xE2 bytes). */
  function genSlotArea(): number[] {
    return new Array(SLOT_AREA_SIZE).fill(0).map(() => rb());
  }

  /** Slot area with matching slot 0 (all 3 conditions true). */
  function genSlotAreaWithMatch(slotIdx: number): number[] {
    const a = genSlotArea();
    const base = slotIdx * SLOT_STRIDE;
    a[base + 0x18] = 1;               // active
    a[base + 0x14] = 0x3f;            // type hi
    a[base + 0x15] = 0x6e;            // type lo (= 0x3F6E)
    a[base + 0x1b] = 1;               // sub-flag
    return a;
  }

  // ─── Suite A: random entities, game-mode=4, slot count=0 ─────────────────
  console.log(
    `\n=== refreshHelper1912C (FUN_0001912C) — Suite A: random (no slot scan) — ${perSuite} cases ===`,
  );
  let okA = 0;
  for (let i = 0; i < perSuite; i++) {
    const table = genTable(0.5, true);
    const slotArea = genSlotArea();
    if (runOneCase("A", i, table, 4, 0, slotArea)) okA++;
  }
  console.log(`  Match: ${okA}/${perSuite} = ${((okA / perSuite) * 100).toFixed(1)}%`);
  totalOk += okA;

  // ─── Suite B: slot scan active (count 1..2), various D3 flag states ───────
  console.log(
    `\n=== Suite B: slot scan active — ${perSuite} cases ===`,
  );
  let okB = 0;
  for (let i = 0; i < perSuite; i++) {
    const table = genTable(0.5, true);
    const slotCount = (i % 2) + 1; // 1 or 2 slots
    let slotArea: number[];
    if (i % 3 === 0) {
      // Slot 0 matches → D3=1
      slotArea = genSlotAreaWithMatch(0);
    } else if (i % 3 === 1 && slotCount === 2) {
      // Slot 1 matches → D3=1 (second slot)
      slotArea = genSlotArea();
      slotArea[0x18] = 0; // slot 0 inactive
      const s1base = SLOT_STRIDE;
      slotArea[s1base + 0x18] = 1;
      slotArea[s1base + 0x14] = 0x3f;
      slotArea[s1base + 0x15] = 0x6e;
      slotArea[s1base + 0x1b] = 1;
    } else {
      // No match → D3=0
      slotArea = genSlotArea();
      // Ensure slot[0x18] != 1 so no false positives
      slotArea[0x18] = 0;
      if (slotCount === 2) slotArea[SLOT_STRIDE + 0x18] = 0;
    }
    if (runOneCase("B", i, table, 4, slotCount, slotArea)) okB++;
  }
  console.log(`  Match: ${okB}/${perSuite} = ${((okB / perSuite) * 100).toFixed(1)}%`);
  totalOk += okB;

  // ─── Suite C: forced state==7 across varied entities ──────────────────────
  console.log(
    `\n=== Suite C: state==7 forced — ${perSuite} cases ===`,
  );
  let okC = 0;
  for (let i = 0; i < perSuite; i++) {
    const table = genTable(0.7, true);
    // Force one or two entities to state==7 with various kind values.
    const eIdx = i % ENTITY_COUNT;
    const base = eIdx * ENTITY_STRIDE;
    table[base + 0x18] = 1;   // active
    table[base + 0x25] = 7;   // state == 7
    // Rotate kind byte: 0, 1, 2 (KIND_CLAMPED)
    table[base + 0x1a] = i % 3;
    // Script ptr = 0 (safe ROM read)
    table[base + 0x1c] = 0;
    table[base + 0x1d] = 0;
    table[base + 0x1e] = 0;
    table[base + 0x1f] = 0;
    // sub_counter (0x1b): vary so both lt4 and ge4 branches are covered
    table[base + 0x1b] = i % 5;
    // anim_counter (0x24): vary so both threshold_only and clear paths hit
    table[base + 0x24] = i % 4;
    const slotArea = genSlotArea();
    slotArea[0x18] = 0; // no slot scan interference
    if (runOneCase("C", i, table, 4, 0, slotArea)) okC++;
  }
  console.log(`  Match: ${okC}/${perSuite} = ${((okC / perSuite) * 100).toFixed(1)}%`);
  totalOk += okC;

  // ─── Suite D: edge cases ──────────────────────────────────────────────────
  const sizeD = perSuite + remainder;
  console.log(
    `\n=== Suite D: edge cases (game-mode != 4, counter boundaries, all kind/state combos) — ${sizeD} cases ===`,
  );
  let okD = 0;
  const stateBytesD = [0x00, 0x01, 0x06, 0x07, 0x08, 0x09, 0x0a, 0xff];
  const kindBytesD = [0x00, 0x01, 0x02, 0x03, 0x80];
  const counterBytesD = [0x00, 0x01, 0x02, 0x03, 0xfe, 0xff];
  const subCounterBytesD = [0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0xfe, 0xff];

  for (let i = 0; i < sizeD; i++) {
    const table = genTable(0.5, true);
    // Some cases with game-mode != 4 (gate-out).
    const gameMode = (i % 10 === 0) ? rs() & 0xffff : 4;

    // Apply structured values to entity 0.
    const base = 0;
    table[base + 0x18] = 1; // active
    table[base + 0x25] = stateBytesD[Math.floor(rng() * stateBytesD.length)]!;
    table[base + 0x1a] = kindBytesD[Math.floor(rng() * kindBytesD.length)]!;
    table[base + 0x24] = counterBytesD[Math.floor(rng() * counterBytesD.length)]!;
    table[base + 0x1b] = subCounterBytesD[Math.floor(rng() * subCounterBytesD.length)]!;
    table[base + 0x1c] = 0;
    table[base + 0x1d] = 0;
    table[base + 0x1e] = 0;
    table[base + 0x1f] = 0;

    const slotArea = genSlotArea();
    slotArea[0x18] = 0;

    if (runOneCase("D", i, table, gameMode, 0, slotArea)) okD++;
  }
  console.log(`  Match: ${okD}/${sizeD} = ${((okD / sizeD) * 100).toFixed(1)}%`);
  totalOk += okD;

  console.log(
    `\n=== TOTAL: ${totalOk}/${total} = ${((totalOk / total) * 100).toFixed(1)}% ===`,
  );
  if (failHolder.value !== null) {
    const f = failHolder.value;
    console.log(`  First fail (suite ${f.suite} tc=${f.tc}): ${f.reason}`);
    console.log(`  inputGameMode=0x${f.inputGameMode.toString(16)} inputSlotCount=${f.inputSlotCount}`);
    console.log(`  inputSlotArea[0x18]=0x${f.inputSlotArea[0x18]!.toString(16)}`);
    console.log(`  entity[0]: active=0x${(f.inputTable[0x18] ?? 0).toString(16)} state=0x${(f.inputTable[0x25] ?? 0).toString(16)} kind=0x${(f.inputTable[0x1a] ?? 0).toString(16)} counter=0x${(f.inputTable[0x24] ?? 0).toString(16)} subCtr=0x${(f.inputTable[0x1b] ?? 0).toString(16)}`);
    // Find first differing offset for debugging.
    for (let i = 0; i < TABLE_SIZE; i++) {
      if (f.binTable[i] !== f.tsTable[i]) {
        const slot = Math.floor(i / ENTITY_STRIDE);
        const fld = i % ENTITY_STRIDE;
        console.log(`  Diff at entity[${slot}][0x${fld.toString(16)}]: bin=0x${(f.binTable[i] ?? 0).toString(16)} ts=0x${(f.tsTable[i] ?? 0).toString(16)}`);
        break;
      }
    }
  }

  disposeCpu(cpu);
  exit(totalOk === total ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  exit(1);
});
