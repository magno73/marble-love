#!/usr/bin/env node
/**
 * test-state-sub-18a88-parity.ts — differential FUN_00018A88 vs
 * `stateSub18A88`.
 *
 * FUN_00018A88 (586 byte): "end-of-game per-player score-summary HUD".
 * `entity[0x18] == 3` renders a summary screen through 8 sub-calls.
 * renderStringHelper ×N, addToObjectAccum + formatAndRender + waitVblank
 *
 * **Strategia parity**:
 *   - All 8 external sub-jsrs are **patched with RTS** (`0x4E75`) to
 *     neutralize i side effects:
 *       * FUN_00018CD2 (particleInit) — RTS
 *       * FUN_00028C7E (clearAlphaTiles) — RTS
 *       * FUN_00000142 trampoline — RTS in place
 *       * FUN_00000200 trampoline — RTS in place
 *       * FUN_000286B0 (renderTag) — RTS
 *       * FUN_00028E3C (renderStringHelper) — RTS
 *       * FUN_00028608 (addToObjectAccum) — RTS
 *       * FUN_00028EB2 (formatAndRender) — RTS
 *       * FUN_00028DB8 (waitVblankStateGated) — RTS
 *
 *       * `*0x004003F0` (vblank tick): incremented 1 time + 3 times per
 *         entity matchata (= summary screens shown).
 *       * `*0x00400658` (summary counter): incremented 1 time per entity
 *         matchata.
 *
 *     The only "side-effect-free" observation left is these 2 bytes +
 *     the count-down loop termination itself (gated by D4 > 0). Because
 *
 *     Il **TS** corrispondente fornisce 8 sub no-op (default) per matchare.
 *
 *   - Compare:
 *       * `workRam[0x3F0]` (vblank counter)
 *       * `workRam[0x658]` (summary counter)
 *         directly by FUN_18A88 with stubbed subs; it should remain
 *         unchanged).
 *
 * **Suite** (4 × 125 = 500):
 *   - B: forced count == 1, entity[0x18] == 3 (path 1-player)
 *   - C: forced count == 2, entity[0x18] == 3 per both (2-player)
 *   - D: edge cases (count = 0, all entities with entity[0x18] != 3, count
 *        boundary)
 *
 * Uso: npx tsx packages/cli/src/test-state-sub-18a88-parity.ts [N]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import {
  state as stateNs,
  stateSub18A88 as sub18A88Ns,
} from "@marble-love/engine";
import {
  createCpu,
  callFunction,
  pokeMem,
  peekMem,
  disposeCpu,
} from "./binary-oracle-lib.js";
import type { CpuSession } from "./binary-oracle-lib.js";

const FUN_18A88 = 0x00018a88;

// Sub-call entry points to patch with RTS.
const FUN_18CD2 = 0x00018cd2; // particleInit
const FUN_28C7E = 0x00028c7e; // clearAlphaTiles
const TRAMP_142 = 0x00000142; // renderStringChain via 0x142
const TRAMP_200 = 0x00000200; // renderString via 0x200
const FUN_286B0 = 0x000286b0; // renderTag
const FUN_28E3C = 0x00028e3c; // renderStringHelper
const FUN_28608 = 0x00028608; // addToObjectAccum
const FUN_28EB2 = 0x00028eb2; // formatAndRender
const FUN_28DB8 = 0x00028db8; // waitVblankStateGated

const WORK_RAM_BASE = 0x00400000;
const OBJ_BASE = 0x00400018;
const OBJ_STRIDE = 0xe2;
const OBJ_COUNT_ADDR = 0x00400396; // word

const VBLANK_TICK_ADDR = 0x004003f0; // byte
const SUMMARY_COUNT_ADDR = 0x00400658; // byte

const VBLANK_TICK_OFF = VBLANK_TICK_ADDR - WORK_RAM_BASE;
const SUMMARY_COUNT_OFF = SUMMARY_COUNT_ADDR - WORK_RAM_BASE;
const OBJ_BASE_OFF = OBJ_BASE - WORK_RAM_BASE;
const OBJ_COUNT_OFF = OBJ_COUNT_ADDR - WORK_RAM_BASE;

/**
 * Patch JSR-stub: all le 8 sub-jsr → RTS (0x4E75).
 *
 * Note: TRAMP_142 and TRAMP_200 are trampolines (jmp.l), patching the first 2
 * bytes with 0x4E75 (= rts), turning them into functions that return
 */
function patchSubs(cpu: CpuSession): void {
  const writeRts = (addr: number): void => {
    pokeMem(cpu, addr + 0, 1, 0x4e);
    pokeMem(cpu, addr + 1, 1, 0x75);
  };
  writeRts(FUN_18CD2);
  writeRts(FUN_28C7E);
  writeRts(TRAMP_142);
  writeRts(TRAMP_200);
  writeRts(FUN_286B0);
  writeRts(FUN_28E3C);
  writeRts(FUN_28608);
  writeRts(FUN_28EB2);
  writeRts(FUN_28DB8);
}

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) >>> 0;
    return ((s >>> 16) & 0xffff) / 0x10000;
  };
}

interface Snapshot {
  vblankTick: number; // byte @ 0x4003F0
  summaryCount: number; // byte @ 0x400658
  objArray: number[];
}

function snapshotBinary(cpu: CpuSession, count: number): Snapshot {
  const objArray: number[] = [];
  const totalBytes = count * OBJ_STRIDE;
  for (let i = 0; i < totalBytes; i++) {
    objArray.push(peekMem(cpu, OBJ_BASE + i, 1) & 0xff);
  }
  return {
    vblankTick: peekMem(cpu, VBLANK_TICK_ADDR, 1) & 0xff,
    summaryCount: peekMem(cpu, SUMMARY_COUNT_ADDR, 1) & 0xff,
    objArray,
  };
}

function snapshotTs(
  state: ReturnType<typeof stateNs.emptyGameState>,
  count: number,
): Snapshot {
  const objArray: number[] = [];
  const totalBytes = count * OBJ_STRIDE;
  for (let i = 0; i < totalBytes; i++) {
    objArray.push(state.workRam[OBJ_BASE_OFF + i] ?? 0);
  }
  return {
    vblankTick: (state.workRam[VBLANK_TICK_OFF] ?? 0) & 0xff,
    summaryCount: (state.workRam[SUMMARY_COUNT_OFF] ?? 0) & 0xff,
    objArray,
  };
}

interface CaseInput {
  count: number; // word @ 0x400396
  /** Per-entity bytes (count × OBJ_STRIDE = 0xE2 byte ciascuna). */
  entityBytes: number[][];
  vblankTickInit: number;
  summaryCountInit: number;
}

interface FailRecord {
  suite: string;
  tc: number;
  reason: string;
  binSnap: Snapshot;
  tsSnap: Snapshot;
  inputCount: number;
  inputVblankInit: number;
  inputSummaryInit: number;
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

  function setupCase(input: CaseInput): void {
    // ── BINARY setup ──────────────────────────────────────────────────
    for (let i = 0; i < input.count; i++) {
      const objAddr = OBJ_BASE + i * OBJ_STRIDE;
      const bytes = input.entityBytes[i] ?? [];
      for (let b = 0; b < OBJ_STRIDE; b++) {
        pokeMem(cpu, objAddr + b, 1, bytes[b] ?? 0);
      }
    }
    pokeMem(cpu, OBJ_COUNT_ADDR, 2, input.count & 0xffff);
    pokeMem(cpu, VBLANK_TICK_ADDR, 1, input.vblankTickInit & 0xff);
    pokeMem(cpu, SUMMARY_COUNT_ADDR, 1, input.summaryCountInit & 0xff);
    cpu.system.setRegister("sp", 0x401f00);

    const wr = stateInst.workRam;
    for (let i = 0; i < input.count; i++) {
      const objOff = OBJ_BASE_OFF + i * OBJ_STRIDE;
      const bytes = input.entityBytes[i] ?? [];
      for (let b = 0; b < OBJ_STRIDE; b++) {
        wr[objOff + b] = (bytes[b] ?? 0) & 0xff;
      }
    }
    wr[OBJ_COUNT_OFF] = (input.count >>> 8) & 0xff;
    wr[OBJ_COUNT_OFF + 1] = input.count & 0xff;
    wr[VBLANK_TICK_OFF] = input.vblankTickInit & 0xff;
    wr[SUMMARY_COUNT_OFF] = input.summaryCountInit & 0xff;
  }

  function runOneCase(suite: string, tc: number, input: CaseInput): boolean {
    setupCase(input);

    // maxCycles bumped to 1M: FUN_18A88 count-down loop with D4=99000
    // runs ~396 iter/entity × 30 cycles ≈ 12000 cycles/entity. With count=2
    // ≈ 24000 cycles; 1M lascia margin.
    callFunction(cpu, FUN_18A88, [], 1_000_000);
    const binSnap = snapshotBinary(cpu, input.count);

    sub18A88Ns.stateSub18A88(stateInst);
    const tsSnap = snapshotTs(stateInst, input.count);

    let reason = "";
    if (binSnap.vblankTick !== tsSnap.vblankTick) {
      reason = `vblankTick bin=0x${binSnap.vblankTick.toString(16)} ts=0x${tsSnap.vblankTick.toString(16)}`;
    } else if (binSnap.summaryCount !== tsSnap.summaryCount) {
      reason = `summaryCount bin=0x${binSnap.summaryCount.toString(16)} ts=0x${tsSnap.summaryCount.toString(16)}`;
    } else {
      for (let i = 0; i < binSnap.objArray.length; i++) {
        if (binSnap.objArray[i] !== tsSnap.objArray[i]) {
          const entityIdx = Math.floor(i / OBJ_STRIDE);
          const fieldIdx = i % OBJ_STRIDE;
          reason =
            `obj[${entityIdx}].byte[0x${fieldIdx.toString(16)}] ` +
            `bin=0x${binSnap.objArray[i]!.toString(16)} ` +
            `ts=0x${tsSnap.objArray[i]!.toString(16)}`;
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
        inputCount: input.count,
        inputVblankInit: input.vblankTickInit,
        inputSummaryInit: input.summaryCountInit,
      };
    }
    return false;
  }

  const rng = makeRng(0x18a88);
  const rb = (): number => Math.floor(rng() * 256) & 0xff;

  function makeRandomEntity(forceState?: number): number[] {
    const bytes = new Array(OBJ_STRIDE).fill(0).map(() => rb());
    if (forceState !== undefined) {
      bytes[0x18] = forceState & 0xff;
    }
    // Vincoliamo counterA (entity[0x6A].w) and counterB (entity[0xD2].w) a
    // the binary would not finish in time. The TS version mirrors the steps
    const cA = Math.floor(rng() * 200); // 0..199
    bytes[0x6a] = (cA >>> 8) & 0xff;
    bytes[0x6b] = cA & 0xff;
    const cB = Math.floor(rng() * 100); // 0..99
    bytes[0xd2] = (cB >>> 8) & 0xff;
    bytes[0xd3] = cB & 0xff;
    return bytes;
  }

  function makeRandomInput(forceCount?: number, forceState?: number): CaseInput {
    // count limited to 0..3 to avoid overlap with globals @ 0x400394/96
    // (obj4 starts at 0x4003A0 and covers vblank tick @ 0x4003F0 and summary
    //  covers vblank tick @ 0x4003F0 but NOT il summary counter @ 0x400658).
    // Per safety teniamo count = 0..2 (obj2 covers up to 0x4001DB).
    const count = forceCount ?? Math.floor(rng() * 3); // 0..2
    const entityBytes: number[][] = [];
    for (let i = 0; i < count; i++) {
      entityBytes.push(makeRandomEntity(forceState));
    }
    return {
      count,
      entityBytes,
      vblankTickInit: rb(),
      summaryCountInit: rb(),
    };
  }

  // ─── Suite A: random count + random entity ───────────────────────────
  console.log(
    `\n=== stateSub18A88 (FUN_00018A88) — Suite A: random — ${perSuite} cases ===`,
  );
  let okA = 0;
  for (let i = 0; i < perSuite; i++) {
    const input = makeRandomInput();
    if (runOneCase("A", i, input)) okA++;
  }
  console.log(`  Match: ${okA}/${perSuite} = ${((okA / perSuite) * 100).toFixed(1)}%`);
  totalOk += okA;

  // ─── Suite B: count == 1, entity[0x18] == 3 ─────────────────────────
  console.log(
    `\n=== Suite B: forced count=1 + entity[0x18]=3 — ${perSuite} cases ===`,
  );
  let okB = 0;
  for (let i = 0; i < perSuite; i++) {
    const input = makeRandomInput(1, 0x03);
    if (runOneCase("B", i, input)) okB++;
  }
  console.log(`  Match: ${okB}/${perSuite} = ${((okB / perSuite) * 100).toFixed(1)}%`);
  totalOk += okB;

  // ─── Suite C: count == 2, entity[0x18] == 3 per both ─────────────
  console.log(
    `\n=== Suite C: forced count=2 + entity[0x18]=3 for both — ${perSuite} cases ===`,
  );
  let okC = 0;
  for (let i = 0; i < perSuite; i++) {
    const input = makeRandomInput(2, 0x03);
    if (runOneCase("C", i, input)) okC++;
  }
  console.log(`  Match: ${okC}/${perSuite} = ${((okC / perSuite) * 100).toFixed(1)}%`);
  totalOk += okC;

  // ─── Suite D: edge cases ─────────────────────────────────────────────
  const sizeD = perSuite + remainder;
  console.log(
    `\n=== Suite D: edge cases (count=0 / all-skip / mix) — ${sizeD} cases ===`,
  );
  let okD = 0;
  for (let i = 0; i < sizeD; i++) {
    const variant = i % 4;
    let input: CaseInput;
    if (variant === 0) {
      // count == 0
      input = makeRandomInput(0);
    } else if (variant === 1) {
      // all entities with entity[0x18] != 3
      input = makeRandomInput(2);
      for (const e of input.entityBytes) {
        e[0x18] = ((rb() & 0xfe) | 1) ^ ((rb() & 1) === 0 ? 2 : 0);
        if (e[0x18] === 3) e[0x18] = 0; // safety
      }
    } else if (variant === 2) {
      // count==1, mix of state byte
      input = makeRandomInput(1);
      input.entityBytes[0]![0x18] = i % 256;
    } else {
      // count==2 mix: one with state==3, one without.
      input = makeRandomInput(2);
      input.entityBytes[0]![0x18] = 3;
      input.entityBytes[1]![0x18] = (rb() === 3) ? 0 : rb();
      if (input.entityBytes[1]![0x18] === 3) input.entityBytes[1]![0x18] = 0;
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
      `    inputCount=${f.inputCount} ` +
        `vblankInit=0x${f.inputVblankInit.toString(16)} ` +
        `summaryInit=0x${f.inputSummaryInit.toString(16)}`,
    );
    console.log(
      `    binVblank=0x${f.binSnap.vblankTick.toString(16)} ` +
        `tsVblank=0x${f.tsSnap.vblankTick.toString(16)}`,
    );
    console.log(
      `    binSummary=0x${f.binSnap.summaryCount.toString(16)} ` +
        `tsSummary=0x${f.tsSnap.summaryCount.toString(16)}`,
    );
  }

  disposeCpu(cpu);
  exit(totalOk === total ? 0 : 1);
}

main().catch(e => {
  console.error(e);
  exit(1);
});
