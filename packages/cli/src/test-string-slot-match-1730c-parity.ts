#!/usr/bin/env node
/**
 * test-string-slot-match-1730c-parity.ts — differential FUN_1730C vs
 * stringSlotMatch1730C.
 *
 * `*(argPtr+0x2)` long. Else 0.
 *
 * Suite testate:
 *
 * Strategia:
 *
 * Uso: npx tsx packages/cli/src/test-string-slot-match-1730c-parity.ts [N]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import {
  state as stateNs,
  stringSlotMatch1730C as ssmNs,
} from "@marble-love/engine";
import {
  createCpu,
  callFunction,
  pokeMem,
  peekMem,
  disposeCpu,
} from "./binary-oracle-lib.js";
import type { CpuSession } from "./binary-oracle-lib.js";

const FUN_1730C = 0x0001730c;

const SLOT_BASE_ADDR = 0x401482;
const SLOT_STRIDE = 0x42;
const SLOT_COUNT = 7;
const SLOT_ACTIVE_OFF = 0x18;
const SLOT_ID_OFF = 0x30;
const ARG_ID_OFF = 0x2;

function patchSubs(_cpu: CpuSession): void {
}

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) >>> 0;
    return ((s >>> 16) & 0xffff) / 0x10000;
  };
}

/** Full region of the string-slot table: 7 * 0x42 = 0x1CE bytes. */
const TABLE_SIZE = SLOT_COUNT * SLOT_STRIDE;

/** Region argPtr buffer: ARG_ID_OFF + 4 = almeno 6 byte. We use 0x10. */
const ARG_BUF_SIZE = 0x10;
const ARG_PTR = 0x401e00;

function setupTable(
  state: ReturnType<typeof stateNs.emptyGameState>,
  cpu: CpuSession,
  tableBytes: number[],
  argBytes: number[],
): void {
  for (let i = 0; i < TABLE_SIZE; i++) {
    const v = tableBytes[i] ?? 0;
    pokeMem(cpu, SLOT_BASE_ADDR + i, 1, v);
    state.workRam[(SLOT_BASE_ADDR - 0x400000) + i] = v;
  }
  for (let i = 0; i < ARG_BUF_SIZE; i++) {
    const v = argBytes[i] ?? 0;
    pokeMem(cpu, ARG_PTR + i, 1, v);
    state.workRam[(ARG_PTR - 0x400000) + i] = v;
  }
}

function compareNoMutation(
  state: ReturnType<typeof stateNs.emptyGameState>,
  cpu: CpuSession,
): { offset: number; bin: number; ts: number } | null {
  // Table
  for (let i = 0; i < TABLE_SIZE; i++) {
    const b = peekMem(cpu, SLOT_BASE_ADDR + i, 1) & 0xff;
    const t = state.workRam[(SLOT_BASE_ADDR - 0x400000) + i] ?? 0;
    if (b !== t) return { offset: SLOT_BASE_ADDR + i, bin: b, ts: t };
  }
  // Arg buffer
  for (let i = 0; i < ARG_BUF_SIZE; i++) {
    const b = peekMem(cpu, ARG_PTR + i, 1) & 0xff;
    const t = state.workRam[(ARG_PTR - 0x400000) + i] ?? 0;
    if (b !== t) return { offset: ARG_PTR + i, bin: b, ts: t };
  }
  return null;
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
  interface FailRecord {
    suite: string;
    tc: number;
    binD0: number;
    tsD0: number;
    mutOff: number;
    mutBin: number;
    mutTs: number;
  }
  const failHolder: { value: FailRecord | null } = { value: null };

  function runOneCase(
    suite: string,
    tc: number,
    tableBytes: number[],
    argBytes: number[],
  ): boolean {
    cpu.system.setRegister("sp", 0x401f00);
    setupTable(stateInst, cpu, tableBytes, argBytes);

    const r = callFunction(cpu, FUN_1730C, [ARG_PTR]);
    const tsRet = ssmNs.stringSlotMatch1730C(stateInst, ARG_PTR);

    const binD0 = r.d0 >>> 0;
    const d0Ok = binD0 === (tsRet >>> 0);
    const mut = compareNoMutation(stateInst, cpu);

    if (d0Ok && mut === null) return true;
    if (failHolder.value === null) {
      failHolder.value = {
        suite,
        tc,
        binD0,
        tsD0: tsRet >>> 0,
        mutOff: mut !== null ? mut.offset : -1,
        mutBin: mut !== null ? mut.bin : -1,
        mutTs: mut !== null ? mut.ts : -1,
      };
    }
    return false;
  }

  const rng = makeRng(0x1730c);
  const rb = (): number => Math.floor(rng() * 256) & 0xff;

  function randTable(): number[] {
    return new Array(TABLE_SIZE).fill(0).map(() => rb());
  }
  /** Setta il long ID @ slot[slotIdx] + SLOT_ID_OFF (big-endian). */
  function setTableId(table: number[], slotIdx: number, id: number): void {
    const base = slotIdx * SLOT_STRIDE + SLOT_ID_OFF;
    table[base] = (id >>> 24) & 0xff;
    table[base + 1] = (id >>> 16) & 0xff;
    table[base + 2] = (id >>> 8) & 0xff;
    table[base + 3] = id & 0xff;
  }
  /** Setta il flag active @ slot[slotIdx] + SLOT_ACTIVE_OFF. */
  function setTableActive(table: number[], slotIdx: number, active: number): void {
    table[slotIdx * SLOT_STRIDE + SLOT_ACTIVE_OFF] = active & 0xff;
  }
  /** Build an argBuf with the ID at offset 0x2 (big-endian). */
  function randArg(id: number): number[] {
    const arr = new Array(ARG_BUF_SIZE).fill(0).map(() => rb());
    arr[ARG_ID_OFF] = (id >>> 24) & 0xff;
    arr[ARG_ID_OFF + 1] = (id >>> 16) & 0xff;
    arr[ARG_ID_OFF + 2] = (id >>> 8) & 0xff;
    arr[ARG_ID_OFF + 3] = id & 0xff;
    return arr;
  }
  const rl = (): number =>
    ((Math.floor(rng() * 0x10000) << 16) | Math.floor(rng() * 0x10000)) >>> 0;

  // ─── Suite A: random everything ──────────────────────────────────────
  console.log(
    `\n=== stringSlotMatch1730C (FUN_1730C) — Suite A: random table & arg — ${perSuite} cases ===`,
  );
  let okA = 0;
  for (let i = 0; i < perSuite; i++) {
    if (runOneCase("A", i, randTable(), randArg(rl()))) okA++;
  }
  console.log(`  Match: ${okA}/${perSuite} = ${((okA / perSuite) * 100).toFixed(1)}%`);
  totalOk += okA;

  console.log(
    `\n=== Suite B: all slots inactive (active=0) → return 0 — ${perSuite} cases ===`,
  );
  let okB = 0;
  for (let i = 0; i < perSuite; i++) {
    const table = randTable();
    for (let j = 0; j < SLOT_COUNT; j++) setTableActive(table, j, 0);
    // Even if the ID matches, it must return 0.
    const argId = rl();
    for (let j = 0; j < SLOT_COUNT; j++) setTableId(table, j, argId);
    if (runOneCase("B", i, table, randArg(argId))) okB++;
  }
  console.log(`  Match: ${okB}/${perSuite} = ${((okB / perSuite) * 100).toFixed(1)}%`);
  totalOk += okB;

  console.log(
    `\n=== Suite C: all active, match at random slot — ${perSuite} cases ===`,
  );
  let okC = 0;
  for (let i = 0; i < perSuite; i++) {
    const table = randTable();
    for (let j = 0; j < SLOT_COUNT; j++) {
      // Active byte != 0 (forziamo 1..0xFF)
      let active = rb();
      if (active === 0) active = 1;
      setTableActive(table, j, active);
    }
    const matchSlot = Math.floor(rng() * SLOT_COUNT);
    const argId = rl();
    for (let j = 0; j < SLOT_COUNT; j++) {
      if (j === matchSlot) {
        setTableId(table, j, argId);
      } else {
        let id = rl();
        if (id === argId) id = (id ^ 0xffffffff) >>> 0;
        setTableId(table, j, id);
      }
    }
    if (runOneCase("C", i, table, randArg(argId))) okC++;
  }
  console.log(`  Match: ${okC}/${perSuite} = ${((okC / perSuite) * 100).toFixed(1)}%`);
  totalOk += okC;

  const sizeD = perSuite + remainder;
  console.log(
    `\n=== Suite D: only one active slot at random position — ${sizeD} cases ===`,
  );
  let okD = 0;
  for (let i = 0; i < sizeD; i++) {
    const table = randTable();
    const activeSlot = Math.floor(rng() * SLOT_COUNT);
    for (let j = 0; j < SLOT_COUNT; j++) {
      setTableActive(table, j, j === activeSlot ? 1 : 0);
    }
    const argId = rl();
    const shouldMatch = rng() < 0.5;
    for (let j = 0; j < SLOT_COUNT; j++) {
      if (j === activeSlot) {
        setTableId(table, j, shouldMatch ? argId : (argId ^ 0xa5a5a5a5) >>> 0);
      } else {
        // Even inactive slots keep random ID; it must be ignored.
        setTableId(table, j, rl());
      }
    }
    if (runOneCase("D", i, table, randArg(argId))) okD++;
  }
  console.log(`  Match: ${okD}/${sizeD} = ${((okD / sizeD) * 100).toFixed(1)}%`);
  totalOk += okD;

  console.log(
    `\n=== TOTALE: ${totalOk}/${total} = ${((totalOk / total) * 100).toFixed(1)}% ===`,
  );
  if (failHolder.value !== null) {
    const f = failHolder.value;
    if (f.mutOff === -1) {
      console.log(
        `  First fail (suite ${f.suite} tc=${f.tc}): D0 mismatch ` +
          `bin=${f.binD0} ts=${f.tsD0}`,
      );
    } else {
      console.log(
        `  First fail (suite ${f.suite} tc=${f.tc}): mutation @ 0x${f.mutOff.toString(16)} ` +
          `bin=0x${f.mutBin.toString(16)} ts=0x${f.mutTs.toString(16)} (D0 bin=${f.binD0} ts=${f.tsD0})`,
      );
    }
  }

  disposeCpu(cpu);
  exit(totalOk === total ? 0 : 1);
}

main().catch((e: unknown) => {
  console.error(e);
  exit(1);
});
