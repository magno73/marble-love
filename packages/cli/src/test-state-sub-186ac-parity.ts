#!/usr/bin/env node
/**
 * test-state-sub-186ac-parity.ts — differential FUN_000186AC vs
 * `stateSub186AC`.
 *
 * FUN_000186AC (368 byte): "mode-3 entity-scan + slot-table init/teardown".
 * 0xE2; based on the sentinel `*0x400760` and the `hasArmed` flag, runs init
 * (rng-driven popolamento of 0x24 entry × 0x10 byte @ 0x401650), teardown
 * (clear 0x24 entries + call FUN_18F46 for entries with entry[2..3]==0xFFFF),
 * o no-op.
 *
 * **Strategia parity**:
 *   - `FUN_00013A98` (RNG @ 0x4003A6) **lasciato live**: replicato
 *   - `FUN_0001BB28` (entry-init callback) **stubbed with RTS** (0x4E75) for
 *     neutralize side effects. The TS uses `subs.fun_1bb28 = noop`.
 *   - `FUN_00018F46` (teardown callback) **stubbed with RTS**.
 *   - Compare:
 *       * `workRam[0x760]` (sentinel byte)
 *       * `workRam[0x764..0x767]` (selector ptr long)
 *       * `workRam[0x1650..0x188F]` (slot-table 0x24 × 0x10 byte = 576 byte)
 *       * `workRam[0x394..0x395]` (game_mode, not written)
 *       * `workRam[0x396..0x397]` (count, not written)
 *       * `*0x4003A6` (RNG seed) post-call
 *
 * **Suite** (4 × 125 = 500):
 *   - A: random everything (mix of mode, sentinel, hasArmed)
 *   - B: forced mode==3 + sentinel==0 + hasArmed (init path)
 *   - C: forced mode==3 + sentinel==1 + !hasArmed (teardown path; mix of
 *        entry[2..3] = 0xFFFF / non-FFFF)
 *   - D: edge cases (mode != 3, count = 0, sentinel saturation)
 *
 * Uso: npx tsx packages/cli/src/test-state-sub-186ac-parity.ts [N]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import {
  state as stateNs,
  bus as busNs,
  stateSub186AC as sub186ACNs,
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
import type { CpuSession } from "./binary-oracle-lib.js";

const FUN_186AC = 0x000186ac;
const FUN_1BB28 = 0x0001bb28;
const FUN_18F46 = 0x00018f46;
const RNG_SEED_ADDR = 0x004003a6;

const WORK_RAM_BASE = 0x00400000;
const GAME_MODE_ADDR = 0x00400394;
const OBJ_COUNT_ADDR = 0x00400396;
const OBJ_BASE_ADDR = 0x00400018;
const OBJ_STRIDE = 0xe2;
const SENTINEL_ADDR = 0x00400760;
const SELECTOR_PTR_ADDR = 0x00400764;
const SLOT_TABLE_ADDR = 0x00401650;
const SLOT_ENTRY_STRIDE = 0x10;
const SLOT_ENTRY_COUNT = 0x24;
const SLOT_TABLE_BYTES = SLOT_ENTRY_COUNT * SLOT_ENTRY_STRIDE; // 576

/**
 * Patch JSR-stub:
 *   - FUN_1BB28 → RTS per neutralize entry-init callback.
 *   - FUN_18F46 → RTS per neutralize teardown callback.
 *   FUN_13A98 (RNG) lasciato live.
 */
function patchSubs(cpu: CpuSession): void {
  pokeMem(cpu, FUN_1BB28 + 0, 1, 0x4e);
  pokeMem(cpu, FUN_1BB28 + 1, 1, 0x75);
  pokeMem(cpu, FUN_18F46 + 0, 1, 0x4e);
  pokeMem(cpu, FUN_18F46 + 1, 1, 0x75);
}

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) >>> 0;
    return ((s >>> 16) & 0xffff) / 0x10000;
  };
}

interface Snapshot {
  sentinel: number;
  selectorPtr: number;
  slotTable: number[];
  rngSeed: number;
}

function snapshotBinary(cpu: CpuSession): Snapshot {
  const slotTable: number[] = [];
  for (let i = 0; i < SLOT_TABLE_BYTES; i++) {
    slotTable.push(peekMem(cpu, SLOT_TABLE_ADDR + i, 1) & 0xff);
  }
  return {
    sentinel: peekMem(cpu, SENTINEL_ADDR, 1) & 0xff,
    selectorPtr: peekMem(cpu, SELECTOR_PTR_ADDR, 4) >>> 0,
    slotTable,
    rngSeed: peekMem(cpu, RNG_SEED_ADDR, 2) & 0xffff,
  };
}

function snapshotTs(state: ReturnType<typeof stateNs.emptyGameState>): Snapshot {
  const wr = state.workRam;
  const slotTable: number[] = [];
  const tableOff = SLOT_TABLE_ADDR - WORK_RAM_BASE;
  for (let i = 0; i < SLOT_TABLE_BYTES; i++) {
    slotTable.push(wr[tableOff + i] ?? 0);
  }
  const sentinelOff = SENTINEL_ADDR - WORK_RAM_BASE;
  const ptrOff = SELECTOR_PTR_ADDR - WORK_RAM_BASE;
  return {
    sentinel: (wr[sentinelOff] ?? 0) & 0xff,
    selectorPtr:
      (((wr[ptrOff] ?? 0) << 24) |
        ((wr[ptrOff + 1] ?? 0) << 16) |
        ((wr[ptrOff + 2] ?? 0) << 8) |
        (wr[ptrOff + 3] ?? 0)) >>> 0,
    slotTable,
    rngSeed: (state.rng.seed as unknown as number) & 0xffff,
  };
}

interface FailRecord {
  suite: string;
  tc: number;
  reason: string;
  binSnap: Snapshot;
  tsSnap: Snapshot;
  inputMode: number;
  inputCount: number;
  inputSentinel: number;
  inputSelector: number;
  inputSeed: number;
}

interface CaseInput {
  mode: number; // u16
  count: number; // u16
  sentinel: number; // u8
  selectorPtr: number; // u32
  objStateBytes: number[]; // length count, byte at obj[0x18]
  objSubBytes: number[]; // length count, byte at obj[0x1B]
  /** pre-fill of the slot-table (576 bytes). */
  slotTablePre: number[];
  rngSeed: number;
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
  const romBytes = readFileSync(romPath);
  const romImage: RomImage = busNs.emptyRomImage();
  romImage.program.set(romBytes.subarray(0, romImage.program.length));

  const stateInst = stateNs.emptyGameState();
  const cpu = await createCpu({ rom: romBytes, state: stateInst });
  patchSubs(cpu);

  let totalOk = 0;
  const failHolder: { value: FailRecord | null } = { value: null };

  function setupCase(input: CaseInput): void {
    // word @ 0x400394 (game_mode) and 0x400396 (count) per count >= 4 (obj4
    // covers 0x400018+4*0xE2 = 0x4003A0..0x400481 → include count word e
    // RNG seed @ 0x4003A6). To avoid setup collisions, write

    // ── BINARY setup ──────────────────────────────────────────────────
    for (let i = 0; i < input.count; i++) {
      const objAddr = OBJ_BASE_ADDR + i * OBJ_STRIDE;
      for (let b = 0; b < OBJ_STRIDE; b++) {
        pokeMem(cpu, objAddr + b, 1, 0);
      }
      pokeMem(cpu, objAddr + 0x18, 1, input.objStateBytes[i] ?? 0);
      pokeMem(cpu, objAddr + 0x1b, 1, input.objSubBytes[i] ?? 0);
    }
    pokeMem(cpu, GAME_MODE_ADDR, 2, input.mode & 0xffff);
    pokeMem(cpu, OBJ_COUNT_ADDR, 2, input.count & 0xffff);
    pokeMem(cpu, SENTINEL_ADDR, 1, input.sentinel & 0xff);
    pokeMem(cpu, SELECTOR_PTR_ADDR, 4, input.selectorPtr >>> 0);
    pokeMem(cpu, RNG_SEED_ADDR, 2, input.rngSeed & 0xffff);
    for (let i = 0; i < SLOT_TABLE_BYTES; i++) {
      pokeMem(cpu, SLOT_TABLE_ADDR + i, 1, input.slotTablePre[i] ?? 0);
    }
    // SP setup
    cpu.system.setRegister("sp", 0x401f00);

    const wr = stateInst.workRam;
    for (let i = 0; i < input.count; i++) {
      const objOff = (OBJ_BASE_ADDR - WORK_RAM_BASE) + i * OBJ_STRIDE;
      for (let b = 0; b < OBJ_STRIDE; b++) {
        wr[objOff + b] = 0;
      }
      wr[objOff + 0x18] = (input.objStateBytes[i] ?? 0) & 0xff;
      wr[objOff + 0x1b] = (input.objSubBytes[i] ?? 0) & 0xff;
    }
    wr[GAME_MODE_ADDR - WORK_RAM_BASE] = (input.mode >>> 8) & 0xff;
    wr[GAME_MODE_ADDR - WORK_RAM_BASE + 1] = input.mode & 0xff;
    wr[OBJ_COUNT_ADDR - WORK_RAM_BASE] = (input.count >>> 8) & 0xff;
    wr[OBJ_COUNT_ADDR - WORK_RAM_BASE + 1] = input.count & 0xff;
    wr[SENTINEL_ADDR - WORK_RAM_BASE] = input.sentinel & 0xff;
    const ptrOff = SELECTOR_PTR_ADDR - WORK_RAM_BASE;
    wr[ptrOff] = (input.selectorPtr >>> 24) & 0xff;
    wr[ptrOff + 1] = (input.selectorPtr >>> 16) & 0xff;
    wr[ptrOff + 2] = (input.selectorPtr >>> 8) & 0xff;
    wr[ptrOff + 3] = input.selectorPtr & 0xff;
    const tableOff = SLOT_TABLE_ADDR - WORK_RAM_BASE;
    for (let i = 0; i < SLOT_TABLE_BYTES; i++) {
      wr[tableOff + i] = (input.slotTablePre[i] ?? 0) & 0xff;
    }
    stateInst.rng.seed = wrap.as_u32(input.rngSeed & 0xffff);
    stateInst.rng.callsThisFrame = wrap.as_u32(0);
  }

  function runOneCase(suite: string, tc: number, input: CaseInput): boolean {
    setupCase(input);

    callFunction(cpu, FUN_186AC, []);
    const binSnap = snapshotBinary(cpu);

    sub186ACNs.stateSub186AC(stateInst, romImage, {
      fun_1bb28: () => {},
      fun_18f46: () => {},
    });
    const tsSnap = snapshotTs(stateInst);

    let reason = "";
    if (binSnap.sentinel !== tsSnap.sentinel) {
      reason = `sentinel bin=0x${binSnap.sentinel.toString(16)} ts=0x${tsSnap.sentinel.toString(16)}`;
    } else if (binSnap.selectorPtr !== tsSnap.selectorPtr) {
      reason = `selectorPtr bin=0x${binSnap.selectorPtr.toString(16)} ts=0x${tsSnap.selectorPtr.toString(16)}`;
    } else if (binSnap.rngSeed !== tsSnap.rngSeed) {
      reason = `rngSeed bin=0x${binSnap.rngSeed.toString(16)} ts=0x${tsSnap.rngSeed.toString(16)}`;
    } else {
      for (let i = 0; i < SLOT_TABLE_BYTES; i++) {
        if (binSnap.slotTable[i] !== tsSnap.slotTable[i]) {
          const entryIdx = Math.floor(i / SLOT_ENTRY_STRIDE);
          const fieldIdx = i % SLOT_ENTRY_STRIDE;
          reason =
            `slot[${entryIdx}].byte[0x${fieldIdx.toString(16)}] ` +
            `bin=0x${binSnap.slotTable[i]!.toString(16)} ` +
            `ts=0x${tsSnap.slotTable[i]!.toString(16)}`;
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
        binSnap,
        tsSnap,
        inputMode: input.mode,
        inputCount: input.count,
        inputSentinel: input.sentinel,
        inputSelector: input.selectorPtr,
        inputSeed: input.rngSeed,
      };
    }
    return false;
  }

  const rng = makeRng(0x186ac);
  const rb = (): number => Math.floor(rng() * 256) & 0xff;
  const rs = (): number => Math.floor(rng() * 0x10000) & 0xffff;

  function makeRandomInput(forceMode?: number, forceSentinel?: number, forceCount?: number): CaseInput {
    // count limited to 0..3 to avoid overlap with globals @ 0x400394/96
    // (obj4 starts at 0x4003A0 and covers selector ptr 0x400764 at count=8).
    const count = forceCount ?? Math.floor(rng() * 4);
    const objStateBytes: number[] = [];
    const objSubBytes: number[] = [];
    for (let i = 0; i < count; i++) {
      objStateBytes.push(rb());
      objSubBytes.push(rb());
    }
    const slotTablePre: number[] = [];
    for (let i = 0; i < SLOT_TABLE_BYTES; i++) {
      slotTablePre.push(rb());
    }
    return {
      mode: forceMode ?? (Math.floor(rng() * 6) & 0xffff), // 0..5
      count,
      sentinel: forceSentinel ?? rb(),
      selectorPtr: 0x00012000 + Math.floor(rng() * 0x1000), // ROM-ish range
      objStateBytes,
      objSubBytes,
      slotTablePre,
      rngSeed: rs(),
    };
  }

  // ─── Suite A: random ─────────────────────────────────────────────────
  console.log(
    `\n=== stateSub186AC (FUN_000186AC) — Suite A: random — ${perSuite} cases ===`,
  );
  let okA = 0;
  for (let i = 0; i < perSuite; i++) {
    const input = makeRandomInput();
    if (runOneCase("A", i, input)) okA++;
  }
  console.log(`  Match: ${okA}/${perSuite} = ${((okA / perSuite) * 100).toFixed(1)}%`);
  totalOk += okA;

  // ─── Suite B: mode==3 + sentinel==0 + hasArmed (init path) ───────────
  console.log(
    `\n=== Suite B: forced init path — ${perSuite} cases ===`,
  );
  let okB = 0;
  for (let i = 0; i < perSuite; i++) {
    const input = makeRandomInput(3, 0);
    if (input.count === 0) {
      input.count = 1;
      input.objStateBytes = [1];
      input.objSubBytes = [(rng() < 0.5) ? 4 : 5];
    } else {
      input.objStateBytes[0] = 1;
      input.objSubBytes[0] = (rng() < 0.5) ? 4 : 5;
    }
    if (runOneCase("B", i, input)) okB++;
  }
  console.log(`  Match: ${okB}/${perSuite} = ${((okB / perSuite) * 100).toFixed(1)}%`);
  totalOk += okB;

  // ─── Suite C: mode==3 + sentinel!=0 + !hasArmed (teardown path) ──────
  console.log(
    `\n=== Suite C: forced teardown path — ${perSuite} cases ===`,
  );
  let okC = 0;
  for (let i = 0; i < perSuite; i++) {
    const input = makeRandomInput(3, 1 + Math.floor(rng() * 255));
    for (let j = 0; j < input.count; j++) {
      input.objStateBytes[j] = 2 + Math.floor(rng() * 254);
    }
    for (let e = 0; e < SLOT_ENTRY_COUNT; e++) {
      const eOff = e * SLOT_ENTRY_STRIDE;
      if (rng() < 0.3) {
        input.slotTablePre[eOff + 2] = 0xff;
        input.slotTablePre[eOff + 3] = 0xff;
      }
    }
    if (runOneCase("C", i, input)) okC++;
  }
  console.log(`  Match: ${okC}/${perSuite} = ${((okC / perSuite) * 100).toFixed(1)}%`);
  totalOk += okC;

  // ─── Suite D: edge cases ─────────────────────────────────────────────
  const sizeD = perSuite + remainder;
  console.log(
    `\n=== Suite D: edge cases (mode != 3 / count=0 / sentinel saturation) — ${sizeD} cases ===`,
  );
  let okD = 0;
  for (let i = 0; i < sizeD; i++) {
    const variant = i % 5;
    let input: CaseInput;
    if (variant === 0) {
      // mode != 3 → early exit
      input = makeRandomInput(0);
    } else if (variant === 1) {
      // mode != 3 (4)
      input = makeRandomInput(4);
    } else if (variant === 2) {
      // count = 0, mode = 3
      input = makeRandomInput(3, undefined, 0);
    } else if (variant === 3) {
      // mode==3, sentinel==0xFF, hasArmed forced
      input = makeRandomInput(3, 0xff);
      if (input.count === 0) {
        input.count = 1;
        input.objStateBytes = [1];
        input.objSubBytes = [4];
      } else {
        input.objStateBytes[0] = 1;
        input.objSubBytes[0] = 4;
      }
    } else {
      // sentinel==0, hasArmed=false (both trigger no-op)
      input = makeRandomInput(3, 0, 0);
    }
    if (runOneCase("D", i, input)) okD++;
  }
  console.log(`  Match: ${okD}/${sizeD} = ${((okD / sizeD) * 100).toFixed(1)}%`);
  totalOk += okD;

  console.log(
    `\n=== TOTALE: ${totalOk}/${total} = ${((totalOk / total) * 100).toFixed(1)}% ===`,
  );
  if (failHolder.value !== null) {
    const f = failHolder.value;
    console.log(`  First fail (suite ${f.suite} tc=${f.tc}): ${f.reason}`);
    console.log(
      `    inputMode=0x${f.inputMode.toString(16)} count=${f.inputCount} ` +
        `sentinel=0x${f.inputSentinel.toString(16)} ` +
        `selector=0x${f.inputSelector.toString(16)} seed=0x${f.inputSeed.toString(16)}`,
    );
    console.log(
      `    binSentinel=0x${f.binSnap.sentinel.toString(16)} ` +
        `tsSentinel=0x${f.tsSnap.sentinel.toString(16)}`,
    );
    console.log(
      `    binSelector=0x${f.binSnap.selectorPtr.toString(16)} ` +
        `tsSelector=0x${f.tsSnap.selectorPtr.toString(16)}`,
    );
    console.log(
      `    binSeedAfter=0x${f.binSnap.rngSeed.toString(16)} ` +
        `tsSeedAfter=0x${f.tsSnap.rngSeed.toString(16)}`,
    );
  }

  disposeCpu(cpu);
  exit(totalOk === total ? 0 : 1);
}

main().catch(e => {
  console.error(e);
  exit(1);
});
