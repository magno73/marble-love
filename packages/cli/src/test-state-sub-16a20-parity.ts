#!/usr/bin/env node
/**
 * test-state-sub-16a20-parity.ts — differential FUN_0001016A20 vs
 * `stateSub16A20`.
 *
 * FUN_016A20 (1134 byte): "score-transition / player-summary dispatcher".
 * Quattro fasi:
 *   1. Scan entity array → D4 (state==3 count), A0 (last state==1/3 entity).
 *      → FUN_1BA(slotArg), sound dispatch (gated D4==0).
 *   2. Display loop: aggiorna entity[0x6D/0x6E], conta mode4/5, chiama sound
 *      pair, render string x 5 (or 7 if count==2) per entity state==2.
 *      → waitVblankStateGated(0xB4), clearDisplayRows(0x14).
 *   3. Secondary loop: render 5+3 strings + wait × 3 per entity state==1
 *      (gated D4==1). entity[0x6E] restore, *0x400390=0, clearDisplayRows.
 *   4. State-transition loop (gated count==2 && D4==1): dispatch
 *      objectStateEntry25BAE o FUN_18F46 per entity state==2.
 *
 * **Strategia parity**:
 *   All external JSRs are patched with RTS (0x4E75):
 *     - FUN_000001BA (trampoline, obj-slot alloc)
 *     - FUN_0000158AC (soundCmd)
 *     - FUN_00015884 (soundPair15884)
 *     - FUN_000286B0 (renderStringEntry286B0)
 *     - FUN_00028DB8 (waitVblankStateGated)
 *     - FUN_00016E8E (clearDisplayRows)
 *     - FUN_00025BAE (objectStateEntry25BAE)
 *     - FUN_00018F46 (fun_18f46)
 *
 *   With everything stubbed, the binary's only side effects are direct writes
 *   in workRam:
 *     - entity[0x6D], entity[0x6E] (fasi 2, 3)
 *     - entity[0x18] = 0 (fase 4 else-branch)
 *     - *0x400654 (byte, mode==4 fase 2)
 *     - *0x400656 (byte, mode==5 fase 2)
 *     - *0x400390 (word, cleared in phase 3)
 *
 *   Compare: entity array completo + i 5 globali sopra.
 *
 * **Suite** (4 × 125 = 500):
 *   A: random entities (state mix), random mode
 *   B: forced count==1, entity state==2 (fase 2 path)
 *   C: forced count==2, entity state∈{1,2} (tutte le fasi)
 *   D: edge cases (count==0, D4==1 gating, state==3 trigger)
 *
 * Uso: npx tsx packages/cli/src/test-state-sub-16a20-parity.ts [N]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import type { RomImage } from "@marble-love/engine";
import {
  state as stateNs,
  bus as busNs,
  stateSub16A20 as sub16A20Ns,
} from "@marble-love/engine";
import {
  createCpu,
  callFunction,
  pokeMem,
  peekMem,
  disposeCpu,
} from "./binary-oracle-lib.js";
import type { CpuSession } from "./binary-oracle-lib.js";

const FUN_16A20 = 0x00016a20;

// Sub-call entry points to patch with RTS.
const FUN_1BA    = 0x000001ba;  // trampoline → FUN_43D6
const FUN_158AC  = 0x000158ac;  // soundCmd
const FUN_15884  = 0x00015884;  // soundPair15884
const FUN_286B0  = 0x000286b0;  // renderStringEntry286B0
const FUN_28DB8  = 0x00028db8;  // waitVblankStateGated
const FUN_16E8E  = 0x00016e8e;  // clearDisplayRows
const FUN_25BAE  = 0x00025bae;  // objectStateEntry25BAE
const FUN_18F46  = 0x00018f46;  // fun_18f46

const WORK_RAM_BASE = 0x00400000;
const OBJ_BASE      = 0x00400018;
const OBJ_BASE_OFF  = OBJ_BASE - WORK_RAM_BASE;
const OBJ_STRIDE    = 0xe2;
const OBJ_COUNT_ADDR = 0x00400396;
const OBJ_COUNT_OFF  = OBJ_COUNT_ADDR - WORK_RAM_BASE;
const GAME_MODE_ADDR = 0x00400394;
const GAME_MODE_OFF  = GAME_MODE_ADDR - WORK_RAM_BASE;

const DISPLAY_CTRL_ADDR = 0x00400390;
const DISPLAY_CTRL_OFF  = DISPLAY_CTRL_ADDR - WORK_RAM_BASE;
const COUNTER_MODE4_ADDR = 0x00400654;
const COUNTER_MODE4_OFF  = COUNTER_MODE4_ADDR - WORK_RAM_BASE;
const COUNTER_MODE5_ADDR = 0x00400656;
const COUNTER_MODE5_OFF  = COUNTER_MODE5_ADDR - WORK_RAM_BASE;

/** Max entities we write / compare (keep small to avoid blowing workRam). */
const MAX_COUNT = 3;

function patchSubs(cpu: CpuSession): void {
  const writeRts = (addr: number): void => {
    pokeMem(cpu, addr + 0, 1, 0x4e);
    pokeMem(cpu, addr + 1, 1, 0x75);
  };
  writeRts(FUN_1BA);
  writeRts(FUN_158AC);
  writeRts(FUN_15884);
  writeRts(FUN_286B0);
  writeRts(FUN_28DB8);
  writeRts(FUN_16E8E);
  writeRts(FUN_25BAE);
  writeRts(FUN_18F46);
}

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) >>> 0;
    return ((s >>> 16) & 0xffff) / 0x10000;
  };
}

interface Snapshot {
  /** entity array: count × OBJ_STRIDE bytes. */
  entities: number[];
  displayCtrl: number;  // word @ 0x400390
  mode4Counter: number; // byte @ 0x400654
  mode5Counter: number; // byte @ 0x400656
}

function snapshotBinary(cpu: CpuSession, count: number): Snapshot {
  const entities: number[] = [];
  for (let i = 0; i < count * OBJ_STRIDE; i++) {
    entities.push(peekMem(cpu, OBJ_BASE + i, 1) & 0xff);
  }
  return {
    entities,
    displayCtrl: peekMem(cpu, DISPLAY_CTRL_ADDR, 2) & 0xffff,
    mode4Counter: peekMem(cpu, COUNTER_MODE4_ADDR, 1) & 0xff,
    mode5Counter: peekMem(cpu, COUNTER_MODE5_ADDR, 1) & 0xff,
  };
}

function snapshotTs(st: ReturnType<typeof stateNs.emptyGameState>, count: number): Snapshot {
  const entities: number[] = [];
  for (let i = 0; i < count * OBJ_STRIDE; i++) {
    entities.push((st.workRam[OBJ_BASE_OFF + i] ?? 0) & 0xff);
  }
  return {
    entities,
    displayCtrl: (((st.workRam[DISPLAY_CTRL_OFF] ?? 0) << 8) | (st.workRam[DISPLAY_CTRL_OFF + 1] ?? 0)) & 0xffff,
    mode4Counter: (st.workRam[COUNTER_MODE4_OFF] ?? 0) & 0xff,
    mode5Counter: (st.workRam[COUNTER_MODE5_OFF] ?? 0) & 0xff,
  };
}

interface CaseInput {
  count: number;
  gameMode: number;
  entityBytes: number[][];
  displayCtrlInit: number;
  mode4Init: number;
  mode5Init: number;
}

interface FailRecord {
  suite: string;
  tc: number;
  reason: string;
  binSnap: Snapshot;
  tsSnap: Snapshot;
  inputCount: number;
  inputMode: number;
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
  const rom: RomImage = busNs.emptyRomImage();
  rom.program.set(romBytes.subarray(0, rom.program.length));

  const stateInst = stateNs.emptyGameState();
  const cpu = await createCpu({ rom: romBytes, state: stateInst });
  patchSubs(cpu);

  let totalOk = 0;
  const failHolder: { value: FailRecord | null } = { value: null };

  function setupCase(input: CaseInput): void {
    // Zero out the entity area first (avoid stale bytes from previous case)
    const totalBytes = MAX_COUNT * OBJ_STRIDE;
    for (let i = 0; i < totalBytes; i++) {
      pokeMem(cpu, OBJ_BASE + i, 1, 0);
    }
    // Write entities
    for (let i = 0; i < input.count; i++) {
      const objAddr = OBJ_BASE + i * OBJ_STRIDE;
      const bytes = input.entityBytes[i] ?? [];
      for (let b = 0; b < OBJ_STRIDE; b++) {
        pokeMem(cpu, objAddr + b, 1, (bytes[b] ?? 0) & 0xff);
      }
    }
    pokeMem(cpu, OBJ_COUNT_ADDR, 2, input.count & 0xffff);
    pokeMem(cpu, GAME_MODE_ADDR, 2, input.gameMode & 0xffff);
    pokeMem(cpu, DISPLAY_CTRL_ADDR, 2, input.displayCtrlInit & 0xffff);
    pokeMem(cpu, COUNTER_MODE4_ADDR, 1, input.mode4Init & 0xff);
    pokeMem(cpu, COUNTER_MODE5_ADDR, 1, input.mode5Init & 0xff);
    cpu.system.setRegister("sp", 0x401f00);

    // TS side
    const wr = stateInst.workRam;
    for (let i = 0; i < totalBytes; i++) {
      wr[OBJ_BASE_OFF + i] = 0;
    }
    for (let i = 0; i < input.count; i++) {
      const off = OBJ_BASE_OFF + i * OBJ_STRIDE;
      const bytes = input.entityBytes[i] ?? [];
      for (let b = 0; b < OBJ_STRIDE; b++) {
        wr[off + b] = (bytes[b] ?? 0) & 0xff;
      }
    }
    wr[OBJ_COUNT_OFF]     = (input.count >>> 8) & 0xff;
    wr[OBJ_COUNT_OFF + 1] = input.count & 0xff;
    wr[GAME_MODE_OFF]     = (input.gameMode >>> 8) & 0xff;
    wr[GAME_MODE_OFF + 1] = input.gameMode & 0xff;
    wr[DISPLAY_CTRL_OFF]     = (input.displayCtrlInit >>> 8) & 0xff;
    wr[DISPLAY_CTRL_OFF + 1] = input.displayCtrlInit & 0xff;
    wr[COUNTER_MODE4_OFF] = input.mode4Init & 0xff;
    wr[COUNTER_MODE5_OFF] = input.mode5Init & 0xff;
  }

  function runOneCase(suite: string, tc: number, input: CaseInput): boolean {
    setupCase(input);

    callFunction(cpu, FUN_16A20, [], 2_000_000);
    const binSnap = snapshotBinary(cpu, input.count);

    sub16A20Ns.stateSub16A20(stateInst, rom);
    const tsSnap = snapshotTs(stateInst, input.count);

    let reason = "";
    if (binSnap.displayCtrl !== tsSnap.displayCtrl) {
      reason = `displayCtrl bin=0x${binSnap.displayCtrl.toString(16)} ts=0x${tsSnap.displayCtrl.toString(16)}`;
    } else if (binSnap.mode4Counter !== tsSnap.mode4Counter) {
      reason = `mode4Counter bin=0x${binSnap.mode4Counter.toString(16)} ts=0x${tsSnap.mode4Counter.toString(16)}`;
    } else if (binSnap.mode5Counter !== tsSnap.mode5Counter) {
      reason = `mode5Counter bin=0x${binSnap.mode5Counter.toString(16)} ts=0x${tsSnap.mode5Counter.toString(16)}`;
    } else {
      for (let i = 0; i < binSnap.entities.length; i++) {
        if (binSnap.entities[i] !== tsSnap.entities[i]) {
          const entityIdx = Math.floor(i / OBJ_STRIDE);
          const fieldIdx = i % OBJ_STRIDE;
          reason =
            `entities[${entityIdx}][0x${fieldIdx.toString(16)}] ` +
            `bin=0x${binSnap.entities[i]!.toString(16)} ` +
            `ts=0x${tsSnap.entities[i]!.toString(16)}`;
          break;
        }
      }
    }

    if (reason === "") return true;
    if (failHolder.value === null) {
      failHolder.value = { suite, tc, reason, binSnap, tsSnap,
                           inputCount: input.count, inputMode: input.gameMode };
    }
    return false;
  }

  const rng = makeRng(0x16a20);
  const rb = (): number => Math.floor(rng() * 256) & 0xff;
  const rw = (): number => Math.floor(rng() * 0x10000) & 0xffff;
  const rmode = (): number => [0, 1, 2, 3, 4, 5][Math.floor(rng() * 6)]!;

  function makeEntity(overrides: Partial<Record<number, number>> = {}): number[] {
    const b = new Array(OBJ_STRIDE).fill(0).map(() => rb());
    for (const [k, v] of Object.entries(overrides)) {
      b[Number(k)] = v! & 0xff;
    }
    return b;
  }

  // ─── Suite A: random ──────────────────────────────────────────────────────
  console.log(`\n=== stateSub16A20 — Suite A: random — ${perSuite} casi ===`);
  let okA = 0;
  for (let i = 0; i < perSuite; i++) {
    const count = 1 + (Math.floor(rng() * MAX_COUNT));
    const entityBytes = Array.from({ length: count }, () =>
      makeEntity({ [0x18]: [0, 1, 2, 3][Math.floor(rng() * 4)]! }),
    );
    const input: CaseInput = {
      count, gameMode: rmode(),
      entityBytes,
      displayCtrlInit: rw(), mode4Init: rb(), mode5Init: rb(),
    };
    if (runOneCase("A", i, input)) okA++;
  }
  console.log(`  Match: ${okA}/${perSuite} = ${((okA / perSuite) * 100).toFixed(1)}%`);
  totalOk += okA;

  // ─── Suite B: count==1, entity state==2 ──────────────────────────────────
  console.log(`\n=== Suite B: count==1 state==2 (fase 2 path) — ${perSuite} casi ===`);
  let okB = 0;
  for (let i = 0; i < perSuite; i++) {
    const entityBytes = [makeEntity({ [0x18]: 0x02 })];
    const input: CaseInput = {
      count: 1, gameMode: rmode(),
      entityBytes,
      displayCtrlInit: rw(), mode4Init: rb(), mode5Init: rb(),
    };
    if (runOneCase("B", i, input)) okB++;
  }
  console.log(`  Match: ${okB}/${perSuite} = ${((okB / perSuite) * 100).toFixed(1)}%`);
  totalOk += okB;

  // ─── Suite C: count==2, mixed state==1/2 ─────────────────────────────────
  console.log(`\n=== Suite C: count==2, state∈{1,2} (all phases) — ${perSuite} casi ===`);
  let okC = 0;
  const statesC = [0x01, 0x02, 0x03];
  for (let i = 0; i < perSuite; i++) {
    const s0 = statesC[Math.floor(rng() * statesC.length)]!;
    const s1 = statesC[Math.floor(rng() * statesC.length)]!;
    const entityBytes = [
      makeEntity({ [0x18]: s0, [0x19]: 0x00, [0x1a]: rb() & 0x01, [0x36]: rb() & 0x03, [0x58]: [0, 0x10, 0x20][Math.floor(rng() * 3)]! }),
      makeEntity({ [0x18]: s1, [0x19]: 0x01, [0x1a]: rb() & 0x01, [0x36]: rb() & 0x03, [0x58]: [0, 0x10, 0x20][Math.floor(rng() * 3)]! }),
    ];
    const input: CaseInput = {
      count: 2, gameMode: rmode(),
      entityBytes,
      displayCtrlInit: rw(), mode4Init: rb(), mode5Init: rb(),
    };
    if (runOneCase("C", i, input)) okC++;
  }
  console.log(`  Match: ${okC}/${perSuite} = ${((okC / perSuite) * 100).toFixed(1)}%`);
  totalOk += okC;

  // ─── Suite D: edge cases ──────────────────────────────────────────────────
  const sizeD = perSuite + remainder;
  console.log(`\n=== Suite D: edge cases (count==0, D4 gating, state==3) — ${sizeD} casi ===`);
  let okD = 0;
  for (let i = 0; i < sizeD; i++) {
    let count: number;
    let entityBytes: number[][];
    let gameMode = rmode();

    switch (i % 5) {
      case 0: // count==0
        count = 0; entityBytes = []; break;
      case 1: // count==1, state==3 (D4==1 triggers phase 3/4 partially)
        count = 1;
        entityBytes = [makeEntity({ [0x18]: 0x03 })];
        break;
      case 2: // count==2, entity 0 state==1, entity 1 state==3
        count = 2;
        entityBytes = [
          makeEntity({ [0x18]: 0x01, [0x19]: 0x00 }),
          makeEntity({ [0x18]: 0x03, [0x19]: 0x01 }),
        ];
        break;
      case 3: // count==2, both state==2, mode==4
        count = 2;
        gameMode = 4;
        entityBytes = [
          makeEntity({ [0x18]: 0x02, [0x1a]: 0x00, [0x36]: 0x00, [0x58]: 0x00 }),
          makeEntity({ [0x18]: 0x02, [0x1a]: 0x01 }),
        ];
        break;
      default: // count==2, entity state==1 + state==2, D4==1
        count = 2;
        entityBytes = [
          makeEntity({ [0x18]: 0x03, [0x19]: 0x00 }),
          makeEntity({ [0x18]: 0x01, [0x19]: 0x01, [0x1a]: 0x00, [0x36]: 0x00, [0x58]: 0x10 }),
        ];
        break;
    }

    const input: CaseInput = {
      count, gameMode, entityBytes,
      displayCtrlInit: rw(), mode4Init: rb(), mode5Init: rb(),
    };
    if (runOneCase("D", i, input)) okD++;
  }
  console.log(`  Match: ${okD}/${sizeD} = ${((okD / sizeD) * 100).toFixed(1)}%`);
  totalOk += okD;

  console.log(`\n=== TOTALE: ${totalOk}/${total} = ${((totalOk / total) * 100).toFixed(1)}% ===`);
  if (failHolder.value !== null) {
    const f = failHolder.value;
    console.log(`  First fail (suite ${f.suite} tc=${f.tc}): ${f.reason}`);
    console.log(`    count=${f.inputCount} mode=${f.inputMode}`);
  }

  disposeCpu(cpu);
  exit(totalOk === total ? 0 : 1);
}

main().catch(e => { console.error(e); exit(1); });
