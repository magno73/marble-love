#!/usr/bin/env node
/**
 * test-helper-1bc88-parity.ts — differential FUN_0001BC88 vs `helper1BC88`.
 *
 * FUN_0001BC88 (0x38A byte): "obj-pair physics interaction".
 * Iterates over 4 (or 2) object slots, checks AABB overlap with the passed
 * entity, swaps velocities, applies repulsion via ROM lookup table @ 0x24ad6,
 * updates sound and object state.
 *
 * **Stubbed calls** (neutralise side-effects and avoid infinite loops):
 *   - FUN_000158AC (soundCmdSend158AC) → RTS
 *   - FUN_00015884 (soundPair15884)    → RTS
 *   - FUN_00015BD0 (stateSub15BD0)     → RTS
 *   - FUN_00025BAE (objectStateEntry25BAE) → RTS
 *   - FUN_000160D4 (spritePosUpdate1BAB2 called for hit objs) → RTS
 *
 * **Compared regions** (4 objects × 0xe2 bytes + globals):
 *   - Each of the 4 object slots: [0x400018, 0x400018+0xe2),
 *     [0x4000fa, 0x4000fa+0xe2), [0x4009a4, 0x4009a4+0xe2),
 *     [0x400a20, 0x400a20+0xe2)
 *   - Game mode word @ 0x400394 (must be unchanged)
 *   - Global coords @ 0x400690..0x400695 (6 bytes, world X/Y/Z)
 *   - Return value D0 (0 or 1)
 *
 * **Suites** (4 × 25 + remainder = ≥100):
 *   A: random everything
 *   B: game-mode 1/3/5 (loopCount=4), slot obj0 at position a2, guaranteed collision
 *   C: game-mode 2/4/6 (loopCount=2), edge bounding box cases
 *   D: state-1A filtering (states 2/4/b → skip)
 *
 * Usage: npx tsx packages/cli/src/test-helper-1bc88-parity.ts [N]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import {
  state as stateNs,
  helper1BC88 as helper1BC88Ns,
  bus as busNs,
} from "@marble-love/engine";
import {
  createCpu,
  callFunction,
  pokeMem,
  peekMem,
  disposeCpu,
} from "./binary-oracle-lib.js";
import type { CpuSession } from "./binary-oracle-lib.js";

// ─── Constants ────────────────────────────────────────────────────────────────

const FUN_1BC88   = 0x0001bc88 as const;
const FUN_158AC   = 0x000158ac as const;
const FUN_15884   = 0x00015884 as const;
const FUN_15BD0   = 0x00015bd0 as const;
const FUN_25BAE   = 0x00025bae as const;
const FUN_160D4   = 0x000160d4 as const;

const WR_BASE     = 0x00400000 as const;

/** Object pointer table (ROM @ 0x24ac6): 4 absolute M68k object addresses. */
const OBJ_ADDRS: readonly number[] = [
  0x00400018,
  0x004000fa,
  0x004009a4,
  0x00400a20,
] as const;

const OBJ_STRIDE = 0xe2 as const;

/** Globals region to capture: 0x400390..0x4006a0 (enough for game-mode + X/Y/Z snapshots). */
const GLOBALS_BASE = 0x00400390 as const;
const GLOBALS_LEN  = 0x310 as const; // 0x4006a0 - 0x400390

// ─── Patching ─────────────────────────────────────────────────────────────────

function patchSubs(cpu: CpuSession): void {
  const RTS = 0x4e75;
  for (const addr of [FUN_158AC, FUN_15884, FUN_15BD0, FUN_25BAE, FUN_160D4]) {
    pokeMem(cpu, addr,     1, (RTS >>> 8) & 0xff);
    pokeMem(cpu, addr + 1, 1,  RTS        & 0xff);
  }
}

// ─── RNG ──────────────────────────────────────────────────────────────────────

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) >>> 0;
    return ((s >>> 16) & 0xffff) / 0x10000;
  };
}

// ─── Snapshot types ───────────────────────────────────────────────────────────

interface Snapshot {
  /** 4 arrays of OBJ_STRIDE bytes, one per object slot. */
  objs: number[][];
  /** Slice of workRam from GLOBALS_BASE (GLOBALS_LEN bytes). */
  globals: number[];
  /** Return value D0. */
  d0: number;
}

function snapshotBinary(cpu: CpuSession, d0: number): Snapshot {
  const objs: number[][] = OBJ_ADDRS.map((base) => {
    const arr: number[] = [];
    for (let i = 0; i < OBJ_STRIDE; i++) {
      arr.push(peekMem(cpu, base + i, 1) & 0xff);
    }
    return arr;
  });
  const globals: number[] = [];
  for (let i = 0; i < GLOBALS_LEN; i++) {
    globals.push(peekMem(cpu, GLOBALS_BASE + i, 1) & 0xff);
  }
  return { objs, globals, d0 };
}

function snapshotTs(
  state: ReturnType<typeof stateNs.emptyGameState>,
  d0: number,
): Snapshot {
  const wr = state.workRam;
  const objs: number[][] = OBJ_ADDRS.map((base) => {
    const off = base - WR_BASE;
    const arr: number[] = [];
    for (let i = 0; i < OBJ_STRIDE; i++) {
      arr.push(wr[off + i] ?? 0);
    }
    return arr;
  });
  const globals: number[] = [];
  const gOff = GLOBALS_BASE - WR_BASE;
  for (let i = 0; i < GLOBALS_LEN; i++) {
    globals.push(wr[gOff + i] ?? 0);
  }
  return { objs, globals, d0 };
}

// ─── Case setup ───────────────────────────────────────────────────────────────

interface CaseInput {
  /** 4 × OBJ_STRIDE bytes, one per slot. */
  objBytes: number[][];
  /** GLOBALS_LEN bytes starting at GLOBALS_BASE. */
  globalsBytes: number[];
  /** Which OBJ_ADDRS index is a2 (the "self" entity). */
  a2Idx: number;
}

function setupCase(
  cpu: CpuSession,
  state: ReturnType<typeof stateNs.emptyGameState>,
  input: CaseInput,
): void {
  const wr = state.workRam;

  // Write object slots
  for (let s = 0; s < OBJ_ADDRS.length; s++) {
    const base = OBJ_ADDRS[s]!;
    const off = base - WR_BASE;
    for (let i = 0; i < OBJ_STRIDE; i++) {
      const v = input.objBytes[s]![i] ?? 0;
      pokeMem(cpu, base + i, 1, v);
      wr[off + i] = v;
    }
  }

  // Write globals
  const gOff = GLOBALS_BASE - WR_BASE;
  for (let i = 0; i < GLOBALS_LEN; i++) {
    const v = input.globalsBytes[i] ?? 0;
    pokeMem(cpu, GLOBALS_BASE + i, 1, v);
    wr[gOff + i] = v;
  }

  // Reset SP for binary
  cpu.system.setRegister("sp", 0x401f00);
}

// ─── Comparison ───────────────────────────────────────────────────────────────

interface FailRecord {
  suite: string;
  tc: number;
  reason: string;
  binSnap: Snapshot;
  tsSnap: Snapshot;
  input: CaseInput;
}

function compare(
  suite: string,
  tc: number,
  input: CaseInput,
  binSnap: Snapshot,
  tsSnap: Snapshot,
  failHolder: { value: FailRecord | null },
): boolean {
  let reason = "";

  // Compare D0
  if (binSnap.d0 !== tsSnap.d0) {
    reason = `D0 bin=0x${binSnap.d0.toString(16)} ts=0x${tsSnap.d0.toString(16)}`;
  }

  // Compare object slots
  if (reason === "") {
    outer: for (let s = 0; s < OBJ_ADDRS.length; s++) {
      for (let i = 0; i < OBJ_STRIDE; i++) {
        if (binSnap.objs[s]![i] !== tsSnap.objs[s]![i]) {
          reason = `obj[${s}][0x${i.toString(16)}] bin=0x${binSnap.objs[s]![i]!.toString(16)} ts=0x${tsSnap.objs[s]![i]!.toString(16)} (abs=0x${(OBJ_ADDRS[s]! + i).toString(16)})`;
          break outer;
        }
      }
    }
  }

  // Compare globals (only check a subset that 1BC88 touches: game-mode word + X/Y/Z coords)
  // 0x400394: game mode word (offset from GLOBALS_BASE = 4)
  // 0x400690..0x400695: X/Y/Z words (offset = 0x300..0x305)
  if (reason === "") {
    const checkOffsets = [4, 5, 0x300, 0x301, 0x302, 0x303, 0x304, 0x305];
    for (const i of checkOffsets) {
      if (binSnap.globals[i] !== tsSnap.globals[i]) {
        reason = `globals[0x${i.toString(16)}] (abs=0x${(GLOBALS_BASE + i).toString(16)}) bin=0x${binSnap.globals[i]!.toString(16)} ts=0x${tsSnap.globals[i]!.toString(16)}`;
        break;
      }
    }
  }

  if (reason === "") return true;
  if (failHolder.value === null) {
    failHolder.value = { suite, tc, reason, binSnap, tsSnap, input };
  }
  return false;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const total = Number(process.argv[2] ?? "100");
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

  // Build a RomImage for the TS side (only program is needed for helper1BC88)
  const romImg = busNs.emptyRomImage();
  romImg.program.set(romBuf.subarray(0, Math.min(romBuf.length, romImg.program.length)));

  const rng = makeRng(0x1bc88);
  const rb = (): number => Math.floor(rng() * 256) & 0xff;
  const rw = (): number => Math.floor(rng() * 0x10000) & 0xffff;
  // Helper: random object slot bytes
  function randomObj(): number[] {
    return new Array(OBJ_STRIDE).fill(0).map(() => rb());
  }

  // Helper: random globals region
  function randomGlobals(): number[] {
    return new Array(GLOBALS_LEN).fill(0).map(() => rb());
  }

  // Helper: write a long value BE into a byte array at an offset
  function setL(arr: number[], off: number, v: number): void {
    const u = v >>> 0;
    arr[off]     = (u >>> 24) & 0xff;
    arr[off + 1] = (u >>> 16) & 0xff;
    arr[off + 2] = (u >>> 8) & 0xff;
    arr[off + 3] =  u        & 0xff;
  }
  function setW(arr: number[], off: number, v: number): void {
    arr[off]     = (v >>> 8) & 0xff;
    arr[off + 1] =  v        & 0xff;
  }
  let totalOk = 0;
  const failHolder: { value: FailRecord | null } = { value: null };

  function runOneCase(suite: string, tc: number, input: CaseInput): boolean {
    setupCase(cpu, stateInst, input);

    const a2Abs = OBJ_ADDRS[input.a2Idx]!;

    // Binary call: push a2Abs as single long argument
    const { d0: binD0 } = callFunction(cpu, FUN_1BC88, [a2Abs], 200_000);
    const binSnap = snapshotBinary(cpu, binD0 & 0xffffffff);

    // TS call: re-setup (binary may have changed workRam; TS has its own copy)
    setupCase(cpu, stateInst, input);
    const tsD0 = helper1BC88Ns.helper1BC88(stateInst, a2Abs, romImg) >>> 0;
    const tsSnap = snapshotTs(stateInst, tsD0);

    return compare(suite, tc, input, binSnap, tsSnap, failHolder);
  }

  // ─── Suite A: fully random ─────────────────────────────────────────────────
  console.log(`\n=== helper1BC88 (FUN_0001BC88) — Suite A: random — ${perSuite} cases ===`);
  let okA = 0;
  for (let i = 0; i < perSuite; i++) {
    const input: CaseInput = {
      objBytes: [randomObj(), randomObj(), randomObj(), randomObj()],
      globalsBytes: randomGlobals(),
      a2Idx: i % 4,
    };
    if (runOneCase("A", i, input)) okA++;
  }
  console.log(`  Match: ${okA}/${perSuite} = ${((okA / perSuite) * 100).toFixed(1)}%`);
  totalOk += okA;

  // ─── Suite B: guaranteed collision (gameMode 1/3/5, loopCount=4) ───────────
  console.log(`\n=== Suite B: guaranteed collision (gameMode 1/3/5) — ${perSuite} cases ===`);
  let okB = 0;
  for (let i = 0; i < perSuite; i++) {
    const gameModes = [1, 3, 5];
    const gm = gameModes[i % 3]!;

    // Build globals with gm at offset 4 (= 0x400394 - 0x400390)
    // and X/Y/Z snapshot at 0x300/0x302/0x304 (= 0x400690..0x400695)
    const globals = randomGlobals();
    setW(globals, 4, gm);                     // game mode word @ 0x400394

    // Set up a2 as slot 0 (0x400018)
    const a2Idx = 0;
    const a2Obj = randomObj();
    a2Obj[0x18] = 1; // state18 = 1 (active)
    a2Obj[0x58] = 0; // NOT 0xa

    // Collision position: set globalX/Y/Z to exactly match slot1's position
    // a2Idx=0, loop will check idx=0,1,2,3; idx=0 == a2 → skip
    // Use idx=1 (0x4000fa) for guaranteed collision
    const colObj = randomObj();
    colObj[0x18] = 1; // active
    colObj[0x1a] = 0; // state1A NOT in {2,4,b}

    // Set colObj position (at 0xc/$10/$14) to exact global coords (word match → delta=0)
    // Use simple values so delta = 0 ≤ 7
    const posX = (rw() & 0x7ffe);
    const posY = (rw() & 0x7ffe);
    const posZ = (rw() & 0x7ffe);

    // Set word at $c (low word of long) for the obj
    // Long at $c: high word arbitrary, low word = posX
    setL(colObj, 0x0c, posX & 0xffff);
    setL(colObj, 0x10, posY & 0xffff);
    setL(colObj, 0x14, posZ & 0xffff);

    // Set global X/Y/Z snapshots to same value (delta = 0)
    setW(globals, 0x300, posX & 0xffff);  // 0x400690
    setW(globals, 0x302, posY & 0xffff);  // 0x400692
    setW(globals, 0x304, posZ & 0xffff);  // 0x400694

    // Also set saved position snapshot @ 0x684..0x68f (offset from GLOBALS_BASE=0x390: 0x2f4)
    setL(globals, 0x2f4, posX);  // 0x400684
    setL(globals, 0x2f8, posY);  // 0x400688
    setL(globals, 0x2fc, posZ);  // 0x40068c

    const objs = [a2Obj, colObj, randomObj(), randomObj()];
    // Set remaining random objs as inactive so no spurious collisions
    objs[2]![0x18] = 0;
    objs[3]![0x18] = 0;

    const input: CaseInput = { objBytes: objs, globalsBytes: globals, a2Idx };
    if (runOneCase("B", i, input)) okB++;
  }
  console.log(`  Match: ${okB}/${perSuite} = ${((okB / perSuite) * 100).toFixed(1)}%`);
  totalOk += okB;

  // ─── Suite C: loopCount=2 (gameMode 2/4/6), edge bbox cases ───────────────
  console.log(`\n=== Suite C: loopCount=2 edge bbox (gameMode 2/4/6) — ${perSuite} cases ===`);
  let okC = 0;
  for (let i = 0; i < perSuite; i++) {
    const gameModes2 = [2, 4, 6, 0, 7, 8, 0xff];
    const gm = gameModes2[i % gameModes2.length]!;
    const globals = randomGlobals();
    setW(globals, 4, gm);

    // Pick an a2Idx
    const a2Idx = i % 2;  // only first 2 slots available in loopCount=2

    // Set up various edge bounding-box deltas
    const globalX = rw() & 0x7fff;
    const globalY = rw() & 0x7fff;
    const globalZ = rw() & 0x7fff;
    setW(globals, 0x300, globalX);
    setW(globals, 0x302, globalY);
    setW(globals, 0x304, globalZ);

    const a2Obj = randomObj();
    a2Obj[0x18] = 1;
    a2Obj[0x58] = 0;

    const edgeDeltas = [-7, -6, 0, 6, 7, 8, -8, 14, -14, 15, -15];
    const dX = edgeDeltas[i % edgeDeltas.length]!;
    const dY = edgeDeltas[(i + 1) % edgeDeltas.length]!;
    const dZ = edgeDeltas[(i + 2) % edgeDeltas.length]!;

    const colObj = randomObj();
    colObj[0x18] = 1;
    colObj[0x1a] = 0;
    setL(colObj, 0x0c, ((globalX - dX) & 0xffff) >>> 0);
    setL(colObj, 0x10, ((globalY - dY) & 0xffff) >>> 0);
    setL(colObj, 0x14, ((globalZ - dZ) & 0xffff) >>> 0);

    setL(globals, 0x2f4, globalX);
    setL(globals, 0x2f8, globalY);
    setL(globals, 0x2fc, globalZ);

    const objs = [a2Obj, colObj, randomObj(), randomObj()];
    objs[2]![0x18] = 0;
    objs[3]![0x18] = 0;

    const input: CaseInput = { objBytes: objs, globalsBytes: globals, a2Idx };
    if (runOneCase("C", i, input)) okC++;
  }
  console.log(`  Match: ${okC}/${perSuite} = ${((okC / perSuite) * 100).toFixed(1)}%`);
  totalOk += okC;

  // ─── Suite D: state-1A filtering + mixed cases ────────────────────────────
  const sizeD = perSuite + remainder;
  console.log(`\n=== Suite D: state-1A filter (2/4/b) + mixed — ${sizeD} cases ===`);
  let okD = 0;
  for (let i = 0; i < sizeD; i++) {
    const globals = randomGlobals();
    // Game modes mix: some trigger loopCount=4, some loopCount=2
    const gmChoices = [1, 2, 3, 4, 5, 6, 0xff, 0x0001, 0x0003, 0x0005];
    setW(globals, 4, gmChoices[i % gmChoices.length]!);

    const a2Idx = i % 4;
    const a2Obj = randomObj();
    a2Obj[0x18] = 1;
    a2Obj[0x58] = i % 20 === 0 ? 0xa : 0;  // occasionally trigger $58==0xa skip

    // Set collision position
    const gX = rw() & 0x7ffe;
    const gY = rw() & 0x7ffe;
    const gZ = rw() & 0x7ffe;
    setW(globals, 0x300, gX);
    setW(globals, 0x302, gY);
    setW(globals, 0x304, gZ);
    setL(globals, 0x2f4, gX);
    setL(globals, 0x2f8, gY);
    setL(globals, 0x2fc, gZ);

    const objs: number[][] = [a2Obj, randomObj(), randomObj(), randomObj()];
    for (let s = 0; s < 4; s++) {
      if (s === a2Idx) continue;
      const obj = objs[s]!;
      obj[0x18] = 1;
      // Rotate through state-1A: 0, 1, 2, 4, 0xb, 0x24 (some valid, some filtered)
      const state1As = [0, 1, 2, 4, 0xb, 0x24, 3, 5];
      obj[0x1a] = state1As[(i + s) % state1As.length]!;
      // Position close to global (delta in range or out)
      const closeX = i % 3 === 0;
      const closeY = i % 5 === 0;
      const closeZ = i % 7 === 0;
      setL(obj, 0x0c, ((gX - (closeX ? 0 : 10)) & 0xffff) >>> 0);
      setL(obj, 0x10, ((gY - (closeY ? 0 : 10)) & 0xffff) >>> 0);
      setL(obj, 0x14, ((gZ - (closeZ ? 0 : 20)) & 0xffff) >>> 0);
    }

    const input: CaseInput = { objBytes: objs, globalsBytes: globals, a2Idx };
    if (runOneCase("D", i, input)) okD++;
  }
  console.log(`  Match: ${okD}/${sizeD} = ${((okD / sizeD) * 100).toFixed(1)}%`);
  totalOk += okD;

  console.log(
    `\n=== TOTAL: ${totalOk}/${total} = ${((totalOk / total) * 100).toFixed(1)}% ===`,
  );

  if (failHolder.value !== null) {
    const f = failHolder.value;
    console.log(`  First fail (suite ${f.suite} tc=${f.tc}): ${f.reason}`);
    console.log(`  a2Idx=${f.input.a2Idx} (abs=0x${OBJ_ADDRS[f.input.a2Idx]!.toString(16)})`);
    const gOff4 = 4;
    const gm = (((f.input.globalsBytes[gOff4]! << 8) | f.input.globalsBytes[gOff4 + 1]!) & 0xffff);
    console.log(`  gameMode=0x${gm.toString(16)}`);
    for (let s = 0; s < OBJ_ADDRS.length; s++) {
      const obj = f.input.objBytes[s]!;
      const state18 = obj[0x18];
      const state1A = obj[0x1a];
      const xW = ((obj[0x0e]! << 8) | obj[0x0f]!) & 0xffff;
      const yW = ((obj[0x12]! << 8) | obj[0x13]!) & 0xffff;
      console.log(`  obj[${s}] addr=0x${OBJ_ADDRS[s]!.toString(16)} state18=${state18} state1A=0x${state1A!.toString(16)} x.lo=0x${xW.toString(16)} y.lo=0x${yW.toString(16)}`);
    }
  }

  disposeCpu(cpu);
  exit(totalOk === total ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  exit(1);
});
