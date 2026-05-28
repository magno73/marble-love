#!/usr/bin/env node
/**
 * test-script-slot-bbox-test-14e92-parity.ts — differential FUN_00014E92 vs
 * `scriptSlotBboxTest14E92`.
 *
 * (4 slot stride 0x60). Gated da `*0x400394 ∈ {1,2,5}`.
 *
 * **Strategia parity**:
 *   - `FUN_00015460` (514 bytes, direction dispatcher) **stubbed with RTS**
 *     (default). Side effects su slot[0x5C/0x58/0x24..0x27] non avvengono in
 *   - `FUN_000158AC` (sound command) **stubbed with RTS**. TS no-op. Match.
 *
 * **Suite** (4 × 125 = 500):
 *        post-selector e early exit per non-armed).
 *        random + miss random).
 *   - C: 1 armed slot with custom bbox and random positions.
 *   - D: edge cases (selector boundary {0,1,2,3,5,6}, marble@(0,0,0),
 *        state in {0,1,2,5,7}).
 *
 * **Compare** (snapshot completo):
 *   - 4 slot × {byte+0x18, byte+0x1A, long+0, long+0x4, long+0x1C, long+0x20,
 *               word+0x56, long+0x58}
 *   - entity × {long+0, long+0x4, long+0xC, long+0x10, byte+0x19, byte+0x1A,
 *               byte+0x56, long+0x5A, byte+0x5F, byte+0x60}
 *
 * Uso: npx tsx packages/cli/src/test-script-slot-bbox-test-14e92-parity.ts [N]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import {
  state as stateNs,
  scriptSlotBboxTest14E92 as fnNs,
} from "@marble-love/engine";
import {
  createCpu,
  pokeMem,
  peekMem,
  disposeCpu,
} from "./binary-oracle-lib.js";
import type { CpuSession } from "./binary-oracle-lib.js";

/** Sentinel return address per detection di RTS. */
const SENTINEL = 0xcafebabe >>> 0;

/**
 */
function callFn(
  cpu: CpuSession,
  addr: number,
  argsLong: readonly number[],
  maxInstr = 200_000,
): void {
  const sys = cpu.system;
  let sp = sys.getRegisters().sp;
  for (let i = argsLong.length - 1; i >= 0; i--) {
    sp = (sp - 4) >>> 0;
    sys.write(sp, 4, argsLong[i]! >>> 0);
  }
  sp = (sp - 4) >>> 0;
  sys.write(sp, 4, SENTINEL);
  sys.setRegister("sp", sp);
  sys.setRegister("pc", addr);
  for (let i = 0; i < maxInstr; i++) {
    if (sys.getRegisters().pc === SENTINEL) break;
    sys.step();
  }
  sys.setRegister(
    "sp",
    (sys.getRegisters().sp + 4 + 4 * argsLong.length) >>> 0,
  );
}

const FUN_14E92 = 0x00014e92;
const FUN_15460 = 0x00015460;
const FUN_158AC = 0x000158ac;

const SELECTOR_ADDR = 0x00400394; // word
const WORLD_X_ADDR = 0x00400690;
const WORLD_Y_ADDR = 0x00400692;
const WORLD_Z_ADDR = 0x00400694;
const GLOBAL_684 = 0x00400684;
const GLOBAL_688 = 0x00400688;

const SLOT_BASE = 0x00401302;
const SLOT_STRIDE = 0x60;
const SLOT_COUNT = 4;

/** Aree di workRam libere per i record bbox-pointer (P1, P2). */
const REC_AREA_BASE = 0x00401e00;
const ENTITY_BASE = 0x00401f00;

function patchSubs(cpu: CpuSession): void {
  // FUN_15460 → RTS.
  pokeMem(cpu, FUN_15460, 1, 0x4e);
  pokeMem(cpu, FUN_15460 + 1, 1, 0x75);
  // FUN_158AC → RTS.
  pokeMem(cpu, FUN_158AC, 1, 0x4e);
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
  slotArmed: number[];
  slotState: number[];
  slotF0: number[];
  slotF4: number[];
  slotF1C: number[];
  slotF20: number[];
  slotKey: number[]; // word
  slotBboxPtr: number[];
  entityF0: number;
  entityF4: number;
  entityFC: number;
  entityF10: number;
  entityKey: number; // byte
  entityState: number; // byte
  entityF56: number; // byte
  entityScriptPtr: number;
  entityF5F: number; // byte
  entityF60: number; // byte
}

function snapshotBinary(cpu: CpuSession): Snapshot {
  const slotArmed: number[] = [];
  const slotState: number[] = [];
  const slotF0: number[] = [];
  const slotF4: number[] = [];
  const slotF1C: number[] = [];
  const slotF20: number[] = [];
  const slotKey: number[] = [];
  const slotBboxPtr: number[] = [];
  for (let i = 0; i < SLOT_COUNT; i++) {
    const slot = SLOT_BASE + i * SLOT_STRIDE;
    slotArmed.push(peekMem(cpu, slot + 0x18, 1) & 0xff);
    slotState.push(peekMem(cpu, slot + 0x1a, 1) & 0xff);
    slotF0.push(peekMem(cpu, slot + 0x00, 4) >>> 0);
    slotF4.push(peekMem(cpu, slot + 0x04, 4) >>> 0);
    slotF1C.push(peekMem(cpu, slot + 0x1c, 4) >>> 0);
    slotF20.push(peekMem(cpu, slot + 0x20, 4) >>> 0);
    slotKey.push(peekMem(cpu, slot + 0x56, 2) & 0xffff);
    slotBboxPtr.push(peekMem(cpu, slot + 0x58, 4) >>> 0);
  }
  return {
    slotArmed,
    slotState,
    slotF0,
    slotF4,
    slotF1C,
    slotF20,
    slotKey,
    slotBboxPtr,
    entityF0: peekMem(cpu, ENTITY_BASE + 0x00, 4) >>> 0,
    entityF4: peekMem(cpu, ENTITY_BASE + 0x04, 4) >>> 0,
    entityFC: peekMem(cpu, ENTITY_BASE + 0x0c, 4) >>> 0,
    entityF10: peekMem(cpu, ENTITY_BASE + 0x10, 4) >>> 0,
    entityKey: peekMem(cpu, ENTITY_BASE + 0x19, 1) & 0xff,
    entityState: peekMem(cpu, ENTITY_BASE + 0x1a, 1) & 0xff,
    entityF56: peekMem(cpu, ENTITY_BASE + 0x56, 1) & 0xff,
    entityScriptPtr: peekMem(cpu, ENTITY_BASE + 0x5a, 4) >>> 0,
    entityF5F: peekMem(cpu, ENTITY_BASE + 0x5f, 1) & 0xff,
    entityF60: peekMem(cpu, ENTITY_BASE + 0x60, 1) & 0xff,
  };
}

function snapshotTs(state: ReturnType<typeof stateNs.emptyGameState>): Snapshot {
  const ram = state.workRam;
  const r1 = (off: number): number => (ram[off] ?? 0) & 0xff;
  const r2 = (off: number): number => ((r1(off) << 8) | r1(off + 1)) & 0xffff;
  const r4 = (off: number): number =>
    ((r1(off) << 24) | (r1(off + 1) << 16) | (r1(off + 2) << 8) | r1(off + 3)) >>> 0;

  const WB = 0x400000;
  const slotArmed: number[] = [];
  const slotState: number[] = [];
  const slotF0: number[] = [];
  const slotF4: number[] = [];
  const slotF1C: number[] = [];
  const slotF20: number[] = [];
  const slotKey: number[] = [];
  const slotBboxPtr: number[] = [];
  for (let i = 0; i < SLOT_COUNT; i++) {
    const off = SLOT_BASE + i * SLOT_STRIDE - WB;
    slotArmed.push(r1(off + 0x18));
    slotState.push(r1(off + 0x1a));
    slotF0.push(r4(off + 0x00));
    slotF4.push(r4(off + 0x04));
    slotF1C.push(r4(off + 0x1c));
    slotF20.push(r4(off + 0x20));
    slotKey.push(r2(off + 0x56));
    slotBboxPtr.push(r4(off + 0x58));
  }
  const eOff = ENTITY_BASE - WB;
  return {
    slotArmed,
    slotState,
    slotF0,
    slotF4,
    slotF1C,
    slotF20,
    slotKey,
    slotBboxPtr,
    entityF0: r4(eOff + 0x00),
    entityF4: r4(eOff + 0x04),
    entityFC: r4(eOff + 0x0c),
    entityF10: r4(eOff + 0x10),
    entityKey: r1(eOff + 0x19),
    entityState: r1(eOff + 0x1a),
    entityF56: r1(eOff + 0x56),
    entityScriptPtr: r4(eOff + 0x5a),
    entityF5F: r1(eOff + 0x5f),
    entityF60: r1(eOff + 0x60),
  };
}

interface SlotInit {
  armed: number;
  state: number;
  x: number;
  y: number;
  z: number;
  key: number; // word
  /** Pointer P1 (= slot[0x58]). */
  bboxP1: number;
  /** *(P1) — long. If 0xFFFFFFFF -> default bbox. Else: P2 (record ptr). */
  bboxL1: number;
  /** Bbox bytes @ P2+4..+7 (if bboxL1 != -1). */
  bboxBytes: [number, number, number, number];
}

interface CaseSetup {
  selector: number;
  worldX: number;
  worldY: number;
  worldZ: number;
  global684: number;
  global688: number;
  slots: SlotInit[];
  entityF0: number;
  entityF4: number;
  entityKey: number;
  entityState: number;
  entityF56: number;
  entityScriptPtr: number;
  entityF5F: number;
  entityF60: number;
}

function applyCaseBinary(cpu: CpuSession, c: CaseSetup): void {
  // Reset workRam (zone interessate).
  for (let off = 0; off < 0x2000; off++) {
    pokeMem(cpu, 0x400000 + off, 1, 0);
  }
  pokeMem(cpu, SELECTOR_ADDR, 2, c.selector & 0xffff);
  pokeMem(cpu, WORLD_X_ADDR, 2, c.worldX & 0xffff);
  pokeMem(cpu, WORLD_Y_ADDR, 2, c.worldY & 0xffff);
  pokeMem(cpu, WORLD_Z_ADDR, 2, c.worldZ & 0xffff);
  pokeMem(cpu, GLOBAL_684, 4, c.global684 >>> 0);
  pokeMem(cpu, GLOBAL_688, 4, c.global688 >>> 0);

  for (let i = 0; i < SLOT_COUNT; i++) {
    const slot = SLOT_BASE + i * SLOT_STRIDE;
    const init = c.slots[i]!;
    pokeMem(cpu, slot + 0x18, 1, init.armed & 0xff);
    pokeMem(cpu, slot + 0x1a, 1, init.state & 0xff);
    pokeMem(cpu, slot + 0x0c, 2, init.x & 0xffff);
    pokeMem(cpu, slot + 0x10, 2, init.y & 0xffff);
    pokeMem(cpu, slot + 0x14, 2, init.z & 0xffff);
    pokeMem(cpu, slot + 0x56, 2, init.key & 0xffff);
    pokeMem(cpu, slot + 0x58, 4, init.bboxP1 >>> 0);
    pokeMem(cpu, init.bboxP1, 4, init.bboxL1 >>> 0);
    if ((init.bboxL1 >>> 0) !== 0xffffffff) {
      const recAddr = init.bboxL1 >>> 0;
      pokeMem(cpu, recAddr + 4, 1, init.bboxBytes[0] & 0xff);
      pokeMem(cpu, recAddr + 5, 1, init.bboxBytes[1] & 0xff);
      pokeMem(cpu, recAddr + 6, 1, init.bboxBytes[2] & 0xff);
      pokeMem(cpu, recAddr + 7, 1, init.bboxBytes[3] & 0xff);
    }
  }

  pokeMem(cpu, ENTITY_BASE + 0x00, 4, c.entityF0 >>> 0);
  pokeMem(cpu, ENTITY_BASE + 0x04, 4, c.entityF4 >>> 0);
  pokeMem(cpu, ENTITY_BASE + 0x19, 1, c.entityKey & 0xff);
  pokeMem(cpu, ENTITY_BASE + 0x1a, 1, c.entityState & 0xff);
  pokeMem(cpu, ENTITY_BASE + 0x56, 1, c.entityF56 & 0xff);
  pokeMem(cpu, ENTITY_BASE + 0x5a, 4, c.entityScriptPtr >>> 0);
  pokeMem(cpu, ENTITY_BASE + 0x5f, 1, c.entityF5F & 0xff);
  pokeMem(cpu, ENTITY_BASE + 0x60, 1, c.entityF60 & 0xff);

  // l'entity).
  cpu.system.setRegister("sp", 0x401fe0);
}

function applyCaseTs(
  state: ReturnType<typeof stateNs.emptyGameState>,
  c: CaseSetup,
): void {
  state.workRam.fill(0);
  const WB = 0x400000;
  const wb = (off: number, v: number): void => {
    state.workRam[off] = v & 0xff;
  };
  const ww = (off: number, v: number): void => {
    state.workRam[off] = (v >>> 8) & 0xff;
    state.workRam[off + 1] = v & 0xff;
  };
  const wl = (off: number, v: number): void => {
    state.workRam[off] = (v >>> 24) & 0xff;
    state.workRam[off + 1] = (v >>> 16) & 0xff;
    state.workRam[off + 2] = (v >>> 8) & 0xff;
    state.workRam[off + 3] = v & 0xff;
  };

  ww(SELECTOR_ADDR - WB, c.selector & 0xffff);
  ww(WORLD_X_ADDR - WB, c.worldX & 0xffff);
  ww(WORLD_Y_ADDR - WB, c.worldY & 0xffff);
  ww(WORLD_Z_ADDR - WB, c.worldZ & 0xffff);
  wl(GLOBAL_684 - WB, c.global684 >>> 0);
  wl(GLOBAL_688 - WB, c.global688 >>> 0);

  for (let i = 0; i < SLOT_COUNT; i++) {
    const off = SLOT_BASE + i * SLOT_STRIDE - WB;
    const init = c.slots[i]!;
    wb(off + 0x18, init.armed);
    wb(off + 0x1a, init.state);
    ww(off + 0x0c, init.x);
    ww(off + 0x10, init.y);
    ww(off + 0x14, init.z);
    ww(off + 0x56, init.key);
    wl(off + 0x58, init.bboxP1);
    wl(init.bboxP1 - WB, init.bboxL1);
    if ((init.bboxL1 >>> 0) !== 0xffffffff) {
      const recOff = (init.bboxL1 >>> 0) - WB;
      state.workRam[recOff + 4] = init.bboxBytes[0] & 0xff;
      state.workRam[recOff + 5] = init.bboxBytes[1] & 0xff;
      state.workRam[recOff + 6] = init.bboxBytes[2] & 0xff;
      state.workRam[recOff + 7] = init.bboxBytes[3] & 0xff;
    }
  }

  const eOff = ENTITY_BASE - WB;
  wl(eOff + 0x00, c.entityF0);
  wl(eOff + 0x04, c.entityF4);
  wb(eOff + 0x19, c.entityKey);
  wb(eOff + 0x1a, c.entityState);
  wb(eOff + 0x56, c.entityF56);
  wl(eOff + 0x5a, c.entityScriptPtr);
  wb(eOff + 0x5f, c.entityF5F);
  wb(eOff + 0x60, c.entityF60);
}

interface FailRecord {
  suite: string;
  tc: number;
  reason: string;
  setup: CaseSetup;
}

function compareSnapshots(bin: Snapshot, ts: Snapshot): string | null {
  for (let i = 0; i < SLOT_COUNT; i++) {
    if (bin.slotArmed[i] !== ts.slotArmed[i])
      return `slot[${i}].armed bin=${bin.slotArmed[i]} ts=${ts.slotArmed[i]}`;
    if (bin.slotState[i] !== ts.slotState[i])
      return `slot[${i}].state bin=${bin.slotState[i]} ts=${ts.slotState[i]}`;
    if (bin.slotF0[i] !== ts.slotF0[i])
      return `slot[${i}].F0 bin=0x${bin.slotF0[i]!.toString(16)} ts=0x${ts.slotF0[i]!.toString(16)}`;
    if (bin.slotF4[i] !== ts.slotF4[i])
      return `slot[${i}].F4 bin=0x${bin.slotF4[i]!.toString(16)} ts=0x${ts.slotF4[i]!.toString(16)}`;
    if (bin.slotF1C[i] !== ts.slotF1C[i])
      return `slot[${i}].F1C bin=0x${bin.slotF1C[i]!.toString(16)} ts=0x${ts.slotF1C[i]!.toString(16)}`;
    if (bin.slotF20[i] !== ts.slotF20[i])
      return `slot[${i}].F20 bin=0x${bin.slotF20[i]!.toString(16)} ts=0x${ts.slotF20[i]!.toString(16)}`;
    if (bin.slotKey[i] !== ts.slotKey[i])
      return `slot[${i}].key bin=0x${bin.slotKey[i]!.toString(16)} ts=0x${ts.slotKey[i]!.toString(16)}`;
    if (bin.slotBboxPtr[i] !== ts.slotBboxPtr[i])
      return `slot[${i}].bboxPtr bin=0x${bin.slotBboxPtr[i]!.toString(16)} ts=0x${ts.slotBboxPtr[i]!.toString(16)}`;
  }
  if (bin.entityF0 !== ts.entityF0)
    return `entityF0 bin=0x${bin.entityF0.toString(16)} ts=0x${ts.entityF0.toString(16)}`;
  if (bin.entityF4 !== ts.entityF4)
    return `entityF4 bin=0x${bin.entityF4.toString(16)} ts=0x${ts.entityF4.toString(16)}`;
  if (bin.entityFC !== ts.entityFC)
    return `entityFC bin=0x${bin.entityFC.toString(16)} ts=0x${ts.entityFC.toString(16)}`;
  if (bin.entityF10 !== ts.entityF10)
    return `entityF10 bin=0x${bin.entityF10.toString(16)} ts=0x${ts.entityF10.toString(16)}`;
  if (bin.entityKey !== ts.entityKey)
    return `entityKey bin=0x${bin.entityKey.toString(16)} ts=0x${ts.entityKey.toString(16)}`;
  if (bin.entityState !== ts.entityState)
    return `entityState bin=0x${bin.entityState.toString(16)} ts=0x${ts.entityState.toString(16)}`;
  if (bin.entityF56 !== ts.entityF56)
    return `entityF56 bin=0x${bin.entityF56.toString(16)} ts=0x${ts.entityF56.toString(16)}`;
  if (bin.entityScriptPtr !== ts.entityScriptPtr)
    return `entityScriptPtr bin=0x${bin.entityScriptPtr.toString(16)} ts=0x${ts.entityScriptPtr.toString(16)}`;
  if (bin.entityF5F !== ts.entityF5F)
    return `entityF5F bin=0x${bin.entityF5F.toString(16)} ts=0x${ts.entityF5F.toString(16)}`;
  if (bin.entityF60 !== ts.entityF60)
    return `entityF60 bin=0x${bin.entityF60.toString(16)} ts=0x${ts.entityF60.toString(16)}`;
  return null;
}

function makeSlotInit(
  i: number,
  rng: () => number,
  ri: (n: number) => number,
  cfg: { armedRate: number; useDefault: number; states: number[] },
): SlotInit {
  // Allocazione record area: P1 e P2 per slot i.
  const p1 = REC_AREA_BASE + i * 0x20; // 32 byte per slot.
  const p2 = REC_AREA_BASE + i * 0x20 + 0x10;
  const useDefault = rng() < cfg.useDefault;
  const armed = rng() < cfg.armedRate ? 1 : 0;
  return {
    armed,
    state: cfg.states[ri(cfg.states.length)]!,
    x: ri(0x10000),
    y: ri(0x10000),
    z: ri(0x10000),
    key: ri(0x10000),
    bboxP1: p1,
    bboxL1: useDefault ? 0xffffffff : p2,
    bboxBytes: [
      ri(256) - 128 + 128, // sext byte
      ri(256) - 128 + 128,
      ri(256) - 128 + 128,
      ri(256) - 128 + 128,
    ],
  };
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
  const romBuf = readFileSync(romPath);

  const stateInst = stateNs.emptyGameState();
  const cpu = await createCpu({ rom: romBuf, state: stateInst });
  patchSubs(cpu);

  const rng = makeRng(0x14e92);
  const ri = (max: number): number => Math.floor(rng() * max);

  const failHolder: { value: FailRecord | null } = { value: null };
  let totalOk = 0;

  function runOneCase(suite: string, tc: number, c: CaseSetup): boolean {
    applyCaseBinary(cpu, c);
    applyCaseTs(stateInst, c);

    callFn(cpu, FUN_14E92, [ENTITY_BASE >>> 0]);
    const binSnap = snapshotBinary(cpu);

    fnNs.scriptSlotBboxTest14E92(stateInst, ENTITY_BASE);
    const tsSnap = snapshotTs(stateInst);

    const reason = compareSnapshots(binSnap, tsSnap);
    if (reason === null) return true;
    if (failHolder.value === null) {
      failHolder.value = { suite, tc, reason, setup: c };
    }
    return false;
  }

  console.log(
    `\n=== scriptSlotBboxTest14E92 (FUN_00014E92) — Suite A: slot spenti — ${perSuite} casi ===`,
  );
  let okA = 0;
  for (let i = 0; i < perSuite; i++) {
    const validSels = [1, 2, 5];
    const c: CaseSetup = {
      selector: validSels[ri(validSels.length)]!,
      worldX: ri(0x10000),
      worldY: ri(0x10000),
      worldZ: ri(0x10000),
      global684: ri(0x100000000) >>> 0,
      global688: ri(0x100000000) >>> 0,
      slots: [0, 1, 2, 3].map((idx) =>
        makeSlotInit(idx, rng, ri, {
          armedRate: 0,
          useDefault: 0.5,
          states: [0, 1, 2, 3, 4, 5, 6, 7],
        }),
      ),
      entityF0: ri(0x100000000) >>> 0,
      entityF4: ri(0x100000000) >>> 0,
      entityKey: ri(256),
      entityState: ri(8),
      entityF56: ri(256),
      entityScriptPtr: ri(0x100000000) >>> 0,
      entityF5F: ri(256),
      entityF60: ri(256),
    };
    if (runOneCase("A", i, c)) okA++;
  }
  console.log(`  Match: ${okA}/${perSuite} = ${((okA / perSuite) * 100).toFixed(1)}%`);
  totalOk += okA;

  console.log(
    `\n=== Suite B: 1 slot bbox-default — ${perSuite} casi ===`,
  );
  let okB = 0;
  for (let i = 0; i < perSuite; i++) {
    const slotIdx = ri(SLOT_COUNT);
    const slotX = ri(0x100) - 0x80; // small signed
    const slotY = ri(0x100) - 0x80;
    const slotZ = ri(0x100);
    const worldX = slotX + (ri(40) - 20);
    const worldY = slotY + (ri(40) - 20);
    const worldZ = slotZ + (ri(40) - 20);
    const slots = [0, 1, 2, 3].map((idx) => {
      if (idx === slotIdx) {
        const init = makeSlotInit(idx, rng, ri, {
          armedRate: 1,
          useDefault: 1, // bbox-default
          states: [0, 1, 2, 3, 4, 5, 6, 7],
        });
        init.x = slotX & 0xffff;
        init.y = slotY & 0xffff;
        init.z = slotZ & 0xffff;
        return init;
      }
      return makeSlotInit(idx, rng, ri, {
        armedRate: 0,
        useDefault: 0.5,
        states: [0, 1, 2, 3, 4, 5, 6, 7],
      });
    });
    const c: CaseSetup = {
      selector: [1, 2, 5][ri(3)]!,
      worldX: worldX & 0xffff,
      worldY: worldY & 0xffff,
      worldZ: worldZ & 0xffff,
      global684: ri(0x100000000) >>> 0,
      global688: ri(0x100000000) >>> 0,
      slots,
      entityF0: ri(0x100000000) >>> 0,
      entityF4: ri(0x100000000) >>> 0,
      entityKey: ri(256),
      entityState: [0, 1, 2, 5, 7][ri(5)]!,
      entityF56: ri(256),
      entityScriptPtr: ri(0x100000000) >>> 0,
      entityF5F: ri(256),
      entityF60: ri(256),
    };
    if (runOneCase("B", i, c)) okB++;
  }
  console.log(`  Match: ${okB}/${perSuite} = ${((okB / perSuite) * 100).toFixed(1)}%`);
  totalOk += okB;

  // ─── Suite C: 1 slot armato bbox custom ──────────────────────────────
  console.log(
    `\n=== Suite C: 1 slot bbox-custom — ${perSuite} casi ===`,
  );
  let okC = 0;
  for (let i = 0; i < perSuite; i++) {
    const slotIdx = ri(SLOT_COUNT);
    const slotX = ri(0x100) - 0x80;
    const slotY = ri(0x100) - 0x80;
    const slotZ = ri(0x100);
    const worldX = slotX + (ri(60) - 30);
    const worldY = slotY + (ri(60) - 30);
    const worldZ = slotZ + (ri(40) - 20);
    const slots = [0, 1, 2, 3].map((idx) => {
      if (idx === slotIdx) {
        const init = makeSlotInit(idx, rng, ri, {
          armedRate: 1,
          useDefault: 0,
          states: [0, 1, 2, 3, 4, 5, 6, 7],
        });
        init.x = slotX & 0xffff;
        init.y = slotY & 0xffff;
        init.z = slotZ & 0xffff;
        // bbox bytes: deltas piccoli signed.
        init.bboxBytes = [
          ((ri(20) - 10) & 0xff),
          ((ri(20) - 10) & 0xff),
          ((ri(30) + 1) & 0xff), // positivi (extent)
          ((ri(30) + 1) & 0xff),
        ];
        return init;
      }
      return makeSlotInit(idx, rng, ri, {
        armedRate: 0,
        useDefault: 0.5,
        states: [0, 1, 2, 3, 4, 5, 6, 7],
      });
    });
    const c: CaseSetup = {
      selector: [1, 2, 5][ri(3)]!,
      worldX: worldX & 0xffff,
      worldY: worldY & 0xffff,
      worldZ: worldZ & 0xffff,
      global684: ri(0x100000000) >>> 0,
      global688: ri(0x100000000) >>> 0,
      slots,
      entityF0: ri(0x100000000) >>> 0,
      entityF4: ri(0x100000000) >>> 0,
      entityKey: ri(256),
      entityState: [0, 1, 2, 5, 7][ri(5)]!,
      entityF56: ri(256),
      entityScriptPtr: ri(0x100000000) >>> 0,
      entityF5F: ri(256),
      entityF60: ri(256),
    };
    if (runOneCase("C", i, c)) okC++;
  }
  console.log(`  Match: ${okC}/${perSuite} = ${((okC / perSuite) * 100).toFixed(1)}%`);
  totalOk += okC;

  // ─── Suite D: edge cases ─────────────────────────────────────────────
  const sizeD = perSuite + remainder;
  console.log(
    `\n=== Suite D: edge cases — ${sizeD} casi ===`,
  );
  let okD = 0;
  const allSelectors = [0, 1, 2, 3, 4, 5, 6, 7];
  const allStates = [0, 1, 2, 3, 4, 5, 6, 7];
  const entityStates = [0, 1, 2, 3, 5, 7, 8];
  for (let i = 0; i < sizeD; i++) {
    const slots = [0, 1, 2, 3].map((idx) =>
      makeSlotInit(idx, rng, ri, {
        armedRate: 0.7,
        useDefault: 0.4,
        states: allStates,
      }),
    );
    const c: CaseSetup = {
      selector: allSelectors[ri(allSelectors.length)]!,
      worldX: (ri(40) - 20) & 0xffff,
      worldY: (ri(40) - 20) & 0xffff,
      worldZ: (ri(40) - 20) & 0xffff,
      global684: ri(0x100000000) >>> 0,
      global688: ri(0x100000000) >>> 0,
      slots: slots.map((s) => {
        s.x = (ri(40) - 20) & 0xffff;
        s.y = (ri(40) - 20) & 0xffff;
        s.z = (ri(40) - 20) & 0xffff;
        // Small key as well, to stress key-match.
        s.key = ri(256) & 0xffff;
        return s;
      }),
      entityF0: ri(0x100000000) >>> 0,
      entityF4: ri(0x100000000) >>> 0,
      // Small entity key for matching slot.key.
      entityKey: ri(256),
      entityState: entityStates[ri(entityStates.length)]!,
      entityF56: ri(256),
      entityScriptPtr: ri(0x100000000) >>> 0,
      entityF5F: ri(256),
      entityF60: ri(256),
    };
    if (runOneCase("D", i, c)) okD++;
  }
  console.log(`  Match: ${okD}/${sizeD} = ${((okD / sizeD) * 100).toFixed(1)}%`);
  totalOk += okD;

  console.log(
    `\n=== TOTAL: ${totalOk}/${total} = ${((totalOk / total) * 100).toFixed(1)}% ===`,
  );
  if (failHolder.value) {
    const f = failHolder.value;
    console.log(`\nFirst fail @ suite ${f.suite} tc ${f.tc}:`);
    console.log(`  reason: ${f.reason}`);
    console.log(
      `  selector=0x${f.setup.selector.toString(16)} world=(${f.setup.worldX.toString(16)},${f.setup.worldY.toString(16)},${f.setup.worldZ.toString(16)})`,
    );
    console.log(`  entityState=0x${f.setup.entityState.toString(16)} entityKey=0x${f.setup.entityKey.toString(16)}`);
    for (let i = 0; i < SLOT_COUNT; i++) {
      const sl = f.setup.slots[i]!;
      console.log(
        `  slot[${i}]: armed=${sl.armed} state=0x${sl.state.toString(16)} pos=(${sl.x.toString(16)},${sl.y.toString(16)},${sl.z.toString(16)}) key=0x${sl.key.toString(16)} bboxL1=0x${sl.bboxL1.toString(16)} bytes=[${sl.bboxBytes.map((b) => b.toString(16)).join(",")}]`,
      );
    }
  }

  disposeCpu(cpu);
  exit(totalOk === total ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  exit(1);
});
