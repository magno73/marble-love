#!/usr/bin/env node
/**
 * test-waypoint-list-step-1815a-parity.ts — differential FUN_0001815A vs
 * `waypointListStep1815A`.
 *
 * FUN_0001815A (352 byte): "entity homing-via-waypoint-list step". Walka la
 *
 * **Strategia parity**:
 *   - `FUN_0000012a` (sound dispatch) **stubbed with RTS** (0x4E75) for
 *     neutralize side effects. TS uses `subs.fun_012a = noop`.
 *   - `FUN_00026196` (flag-scaled magnitude dispatch) **stubbed with RTS**.
 *     TS uses `subs.fun_26196 = noop`.
 *   - Compare:
 *       * `entity[0x00..0x6F]` (0x70 byte = full entity stride, covers 0x6e)
 *       * waypoint list bytes (0x40 byte a partire from the LIST_BASE)
 *       * `*0x00400446` (long pointer)
 *       * `*0x0040075a` (word flag)
 *
 * **Suite** (4 × 125 = 500):
 *   - A: random — entity + lista random
 *
 * Uso: npx tsx packages/cli/src/test-waypoint-list-step-1815a-parity.ts [N]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import {
  state as stateNs,
  waypointListStep1815A as waypointNs,
} from "@marble-love/engine";
import {
  createCpu,
  callFunction,
  pokeMem,
  peekMem,
  disposeCpu,
} from "./binary-oracle-lib.js";
import type { CpuSession } from "./binary-oracle-lib.js";

const FUN_1815A = 0x0001815a;
const FUN_012A = 0x0000012a;
const FUN_26196 = 0x00026196;

const ENTITY_BASE = 0x00401e00;
const ENTITY_SIZE = 0x70; // covers 0x6e + slack
const LIST_BASE = 0x00401f80;
const LIST_SIZE = 0x40;
const GLOBAL_PTR = 0x00400446;
const GLOBAL_FLAG = 0x0040075a;

/**
 * Patch JSR-stub: `FUN_012a` e `FUN_26196` → RTS (0x4E75).
 */
function patchSubs(cpu: CpuSession): void {
  pokeMem(cpu, FUN_012A + 0, 1, 0x4e);
  pokeMem(cpu, FUN_012A + 1, 1, 0x75);
  pokeMem(cpu, FUN_26196 + 0, 1, 0x4e);
  pokeMem(cpu, FUN_26196 + 1, 1, 0x75);
}

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) >>> 0;
    return ((s >>> 16) & 0xffff) / 0x10000;
  };
}

interface Snapshot {
  entity: number[];
  list: number[];
  ptr: number;
  flag: number;
}

function snapshotBinary(cpu: CpuSession): Snapshot {
  const entity: number[] = [];
  for (let i = 0; i < ENTITY_SIZE; i++) {
    entity.push(peekMem(cpu, ENTITY_BASE + i, 1) & 0xff);
  }
  const list: number[] = [];
  for (let i = 0; i < LIST_SIZE; i++) {
    list.push(peekMem(cpu, LIST_BASE + i, 1) & 0xff);
  }
  return {
    entity,
    list,
    ptr: peekMem(cpu, GLOBAL_PTR, 4) >>> 0,
    flag: peekMem(cpu, GLOBAL_FLAG, 2) & 0xffff,
  };
}

function snapshotTs(state: ReturnType<typeof stateNs.emptyGameState>): Snapshot {
  const entity: number[] = [];
  const offE = ENTITY_BASE - 0x400000;
  for (let i = 0; i < ENTITY_SIZE; i++) {
    entity.push(state.workRam[offE + i] ?? 0);
  }
  const list: number[] = [];
  const offL = LIST_BASE - 0x400000;
  for (let i = 0; i < LIST_SIZE; i++) {
    list.push(state.workRam[offL + i] ?? 0);
  }
  const offP = GLOBAL_PTR - 0x400000;
  const ptr =
    (((state.workRam[offP] ?? 0) << 24) |
      ((state.workRam[offP + 1] ?? 0) << 16) |
      ((state.workRam[offP + 2] ?? 0) << 8) |
      (state.workRam[offP + 3] ?? 0)) >>>
    0;
  const offF = GLOBAL_FLAG - 0x400000;
  const flag = (((state.workRam[offF] ?? 0) << 8) | (state.workRam[offF + 1] ?? 0)) & 0xffff;
  return { entity, list, ptr, flag };
}

interface FailRecord {
  suite: string;
  tc: number;
  reason: string;
  binSnap: Snapshot;
  tsSnap: Snapshot;
  inputEntity: number[];
  inputList: number[];
  inputPtr: number;
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

  function setupCase(
    entityBytes: number[],
    listBytes: number[],
    ptrAddr: number,
    flagInit: number,
  ): void {
    // BINARY: write entity, list, global ptr, flag.
    for (let i = 0; i < ENTITY_SIZE; i++) {
      pokeMem(cpu, ENTITY_BASE + i, 1, entityBytes[i] ?? 0);
    }
    for (let i = 0; i < LIST_SIZE; i++) {
      pokeMem(cpu, LIST_BASE + i, 1, listBytes[i] ?? 0);
    }
    pokeMem(cpu, GLOBAL_PTR, 4, ptrAddr >>> 0);
    pokeMem(cpu, GLOBAL_FLAG, 2, flagInit & 0xffff);
    cpu.system.setRegister("sp", 0x401f00);

    // TS: same setup.
    const offE = ENTITY_BASE - 0x400000;
    for (let i = 0; i < ENTITY_SIZE; i++) {
      stateInst.workRam[offE + i] = entityBytes[i] ?? 0;
    }
    const offL = LIST_BASE - 0x400000;
    for (let i = 0; i < LIST_SIZE; i++) {
      stateInst.workRam[offL + i] = listBytes[i] ?? 0;
    }
    const offP = GLOBAL_PTR - 0x400000;
    const u = ptrAddr >>> 0;
    stateInst.workRam[offP] = (u >>> 24) & 0xff;
    stateInst.workRam[offP + 1] = (u >>> 16) & 0xff;
    stateInst.workRam[offP + 2] = (u >>> 8) & 0xff;
    stateInst.workRam[offP + 3] = u & 0xff;
    const offF = GLOBAL_FLAG - 0x400000;
    stateInst.workRam[offF] = (flagInit >>> 8) & 0xff;
    stateInst.workRam[offF + 1] = flagInit & 0xff;
  }

  function runOneCase(
    suite: string,
    tc: number,
    entityBytes: number[],
    listBytes: number[],
    ptrAddr: number,
    flagInit: number,
  ): boolean {
    setupCase(entityBytes, listBytes, ptrAddr, flagInit);

    callFunction(cpu, FUN_1815A, [ENTITY_BASE]);
    const binSnap = snapshotBinary(cpu);

    waypointNs.waypointListStep1815A(stateInst, ENTITY_BASE, {
      // Stub no-op (matching JSR stubbed RTS).
      fun_012a: () => {
        /* RTS = no-op */
      },
      fun_26196: () => {
        /* RTS = no-op */
      },
      lookupSoundTable: () => 0,
    });
    const tsSnap = snapshotTs(stateInst);

    let reason = "";
    if (binSnap.ptr !== tsSnap.ptr) {
      reason = `globalPtr bin=0x${binSnap.ptr.toString(16)} ts=0x${tsSnap.ptr.toString(16)}`;
    } else if (binSnap.flag !== tsSnap.flag) {
      reason = `globalFlag bin=0x${binSnap.flag.toString(16)} ts=0x${tsSnap.flag.toString(16)}`;
    } else {
      for (let i = 0; i < ENTITY_SIZE; i++) {
        if (binSnap.entity[i] !== tsSnap.entity[i]) {
          reason = `entity[0x${i.toString(16)}] bin=0x${binSnap.entity[i]!.toString(16)} ts=0x${tsSnap.entity[i]!.toString(16)}`;
          break;
        }
      }
      if (reason === "") {
        for (let i = 0; i < LIST_SIZE; i++) {
          if (binSnap.list[i] !== tsSnap.list[i]) {
            reason = `list[0x${i.toString(16)}] bin=0x${binSnap.list[i]!.toString(16)} ts=0x${tsSnap.list[i]!.toString(16)}`;
            break;
          }
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
        inputEntity: entityBytes.slice(),
        inputList: listBytes.slice(),
        inputPtr: ptrAddr,
      };
    }
    return false;
  }

  const rng = makeRng(0x1815a);
  const rb = (): number => Math.floor(rng() * 256) & 0xff;

  function genEntity(): number[] {
    return new Array(ENTITY_SIZE).fill(0).map(() => rb());
  }

  // Genera lista valida: N record (sx != 0 per non-terminator) + terminator.
  // sx in [-128, -1] U [1, 127] to avoid 0.
  function genList(nRecords: number): number[] {
    const list = new Array(LIST_SIZE).fill(0);
    for (let i = 0; i < nRecords && i * 4 < LIST_SIZE - 4; i++) {
      // sx non-zero: pick from [1..127] or [128..255] (negative); avoids 0.
      let sx;
      do {
        sx = rb();
      } while (sx === 0);
      list[i * 4 + 0] = sx;
      list[i * 4 + 1] = rb();
      list[i * 4 + 2] = rb();
      list[i * 4 + 3] = rb();
    }
    return list;
  }

  // ─── Suite A: random ─────────────────────────────────────────────────
  console.log(
    `\n=== waypointListStep1815A (FUN_0001815A) — Suite A: random — ${perSuite} cases ===`,
  );
  let okA = 0;
  for (let i = 0; i < perSuite; i++) {
    const entity = genEntity();
    const nRec = 1 + Math.floor(rng() * 5); // 1..5 record
    const list = genList(nRec);
    if (runOneCase("A", i, entity, list, LIST_BASE, 0)) okA++;
  }
  console.log(`  Match: ${okA}/${perSuite} = ${((okA / perSuite) * 100).toFixed(1)}%`);
  totalOk += okA;

  // ─── Suite B: forced in-range ─────────────────────────────────────────
  console.log(
    `\n=== Suite B: in-range forzato (target ≈ sx<<19) — ${perSuite} cases ===`,
  );
  let okB = 0;
  for (let i = 0; i < perSuite; i++) {
    const entity = genEntity();
    // sx=1, target_x = 0xC0000 (= (1<<19) + 0x40000) → delta=0 (in range).
    // Setta target_x e target_y a 0xC0000.
    entity[0x0c] = 0x00;
    entity[0x0d] = 0x0c;
    entity[0x0e] = 0x00;
    entity[0x0f] = 0x00;
    entity[0x10] = 0x00;
    entity[0x11] = 0x0c;
    entity[0x12] = 0x00;
    entity[0x13] = 0x00;
    // Build list with sx=sy=1 (in range).
    const list = new Array(LIST_SIZE).fill(0);
    const nRec = 1 + (i % 4);
    for (let j = 0; j < nRec; j++) {
      list[j * 4 + 0] = 1;
      list[j * 4 + 1] = 1;
      list[j * 4 + 2] = rb();
      // sound_idx ∈ [-1, 0..3] (mix)
      list[j * 4 + 3] = (j % 2 === 0) ? 0xff : (j % 4);
    }
    if (runOneCase("B", i, entity, list, LIST_BASE, 0)) okB++;
  }
  console.log(`  Match: ${okB}/${perSuite} = ${((okB / perSuite) * 100).toFixed(1)}%`);
  totalOk += okB;

  // ─── Suite C: forced out-of-range ────────────────────────────────────
  console.log(
    `\n=== Suite C: out-of-range forzato (target=0, sx grande) — ${perSuite} cases ===`,
  );
  let okC = 0;
  for (let i = 0; i < perSuite; i++) {
    const entity = genEntity();
    // target_x = 0, target_y = 0
    entity[0x0c] = entity[0x0d] = entity[0x0e] = entity[0x0f] = 0;
    entity[0x10] = entity[0x11] = entity[0x12] = entity[0x13] = 0;
    // entity.x = 0, entity.y = 0
    entity[0x00] = entity[0x01] = entity[0x02] = entity[0x03] = 0;
    entity[0x04] = entity[0x05] = entity[0x06] = entity[0x07] = 0;
    // entity.z partendo da 0
    entity[0x08] = entity[0x09] = entity[0x0a] = entity[0x0b] = 0;
    // gravity flag toggle 50/50
    entity[0x36] = (i & 1) === 0 ? 0 : 1;

    // Lista: 1 record, sx grande (out of range)
    const list = new Array(LIST_SIZE).fill(0);
    list[0] = 0x10 + (i & 0x7e); // sx in [0x10..0x8f] non zero
    if (list[0] === 0) list[0] = 0x10;
    list[1] = 0x10 + (i & 0x7e);
    list[2] = rb();
    list[3] = (i & 1) === 0 ? 0x7f : 0xff;
    if (runOneCase("C", i, entity, list, LIST_BASE, 0)) okC++;
  }
  console.log(`  Match: ${okC}/${perSuite} = ${((okC / perSuite) * 100).toFixed(1)}%`);
  totalOk += okC;

  // ─── Suite D: edge cases ──────────────────────────────────────────────
  const sizeD = perSuite + remainder;
  console.log(
    `\n=== Suite D: edge cases — ${sizeD} cases ===`,
  );
  let okD = 0;
  for (let i = 0; i < sizeD; i++) {
    const entity = genEntity();
    const list = new Array(LIST_SIZE).fill(0);
    // Sub-cases:
    if (i % 5 === 0) {
      // empty list (terminator immediate) — test "list_empty" path
      list[0] = 0;
    } else if (i % 5 === 1) {
      // long list (8 records all in-range)
      entity[0x0c] = 0x00; entity[0x0d] = 0x0c; entity[0x0e] = 0x00; entity[0x0f] = 0x00;
      entity[0x10] = 0x00; entity[0x11] = 0x0c; entity[0x12] = 0x00; entity[0x13] = 0x00;
      for (let j = 0; j < 8; j++) {
        list[j * 4 + 0] = 1; list[j * 4 + 1] = 1;
        list[j * 4 + 2] = rb(); list[j * 4 + 3] = (j % 4);
      }
    } else if (i % 5 === 2) {
      // gravity flag, z near floor
      entity[0x0c] = entity[0x0d] = entity[0x0e] = entity[0x0f] = 0;
      entity[0x10] = entity[0x11] = entity[0x12] = entity[0x13] = 0;
      // z = -0x4F000 (close to floor)
      const z = (-0x4f000) >>> 0;
      entity[0x08] = (z >>> 24) & 0xff;
      entity[0x09] = (z >>> 16) & 0xff;
      entity[0x0a] = (z >>> 8) & 0xff;
      entity[0x0b] = z & 0xff;
      entity[0x36] = 1;
      list[0] = 0x40; list[1] = 0x40; list[2] = rb(); list[3] = 0x7f;
    } else if (i % 5 === 3) {
      // sm at boundaries (positive/negative max)
      entity[0x0c] = entity[0x0d] = entity[0x0e] = entity[0x0f] = 0;
      entity[0x10] = entity[0x11] = entity[0x12] = entity[0x13] = 0;
      list[0] = 0x40; list[1] = 0x40;
      list[2] = (i & 1) === 0 ? 0x7f : 0x80;
      list[3] = 0xff; // no sound
    } else {
      // normal random with sx,sy small (likely in range)
      entity[0x0c] = 0x00; entity[0x0d] = 0x0c; entity[0x0e] = 0x00; entity[0x0f] = 0x00;
      entity[0x10] = 0x00; entity[0x11] = 0x0c; entity[0x12] = 0x00; entity[0x13] = 0x00;
      list[0] = 1 + (i & 0x1f); list[1] = 1 + (i & 0x1f);
      list[2] = rb(); list[3] = rb();
    }
    if (runOneCase("D", i, entity, list, LIST_BASE, 0)) okD++;
  }
  console.log(`  Match: ${okD}/${sizeD} = ${((okD / sizeD) * 100).toFixed(1)}%`);
  totalOk += okD;

  console.log(
    `\n=== TOTALE: ${totalOk}/${total} = ${((totalOk / total) * 100).toFixed(1)}% ===`,
  );
  if (failHolder.value !== null) {
    const f = failHolder.value;
    console.log(`  First fail (suite ${f.suite} tc=${f.tc}): ${f.reason}`);
    console.log(`    inputPtr=0x${f.inputPtr.toString(16)}`);
    console.log(`    inputList[0..7]=${f.inputList.slice(0, 8).map(b => b.toString(16).padStart(2, "0")).join(" ")}`);
    console.log(`    inputEntity[0x0c..0x13]=${f.inputEntity.slice(0xc, 0x14).map(b => b.toString(16).padStart(2, "0")).join(" ")}`);
    console.log(`    inputEntity[0x36]=0x${f.inputEntity[0x36]!.toString(16)}`);
    console.log(`    binPtr=0x${f.binSnap.ptr.toString(16)} tsPtr=0x${f.tsSnap.ptr.toString(16)}`);
    console.log(`    binFlag=0x${f.binSnap.flag.toString(16)} tsFlag=0x${f.tsSnap.flag.toString(16)}`);
  }

  disposeCpu(cpu);
  exit(totalOk === total ? 0 : 1);
}

main().catch(e => {
  console.error(e);
  exit(1);
});
