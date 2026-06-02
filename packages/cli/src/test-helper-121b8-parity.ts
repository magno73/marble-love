#!/usr/bin/env node
/**
 * test-helper-121b8-parity.ts — differential `FUN_000121B8` vs `helper121B8`.
 *
 * `FUN_000121B8` (1634 byte): "object physics-update + collision + state-
 *
 * **Parity strategy — full stubbing**:
 *   - velocity integration (add.l)
 *   - bounds checking (swapLongPair via jsr $12886)
 *   - state byte dispatch (conditional vectorScale, also stubbed)
 *   - write-back to globals (0x400684/688/68C, 0x40069A/9C, 0x400696/698)
 *
 *     FUN_1BAB2  FUN_1CC62  FUN_1C676  FUN_12886  FUN_1B5C2
 *     FUN_29CCE  FUN_1BC88  FUN_14E92  FUN_175C8  FUN_1881C
 *     FUN_1924E  FUN_19D94  FUN_1365C  FUN_160F6  FUN_1B9CC
 *     FUN_1C014  FUN_1281C  FUN_1706C  FUN_25C74  FUN_18A1E
 *     FUN_18E6C  FUN_25BAE  FUN_15884  FUN_158AC  FUN_15BD0
 *     FUN_25DF6  FUN_25E7C  FUN_285B0  FUN_264AA
 *
 *     D0 = 0xFF during global writes).
 *
 * **Alternative parity strategy for the non-stubbable sub-callees**:
 *
 * **Compare**:
 *   * game-mode word `[0x400394]` (2 byte)
 *
 * **Suite** (4 × 125 = 500):
 *   - B: forced "in-range" - small z, vz=0, bounce not active
 *   - C: "out-of-range" non-player — obj.z grande
 *   - D: player edge cases — A2 = 0x400018
 *
 * Usage: npx tsx packages/cli/src/test-helper-121b8-parity.ts [N]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import {
  state as stateNs,
  helper121B8 as helperNs,
} from "@marble-love/engine";
import {
  createCpu,
  callFunction,
  pokeMem,
  peekMem,
  disposeCpu,
} from "./binary-oracle-lib.js";
import type { CpuSession } from "./binary-oracle-lib.js";

// ─── Addresses ───────────────────────────────────────────────────────────────

const FUN_121B8  = 0x000121b8;

// ALL callee addresses to stub with RTS
const ALL_CALLEE_ADDRS: number[] = [
  0x0001bab2, // FUN_1BAB2 spritePosUpdate1BAB2
  0x0001cc62, // FUN_1CC62 spriteProject1CC62
  0x0001c676, // FUN_1C676 spriteBracketLerp1C676
  0x00012886, // FUN_12886 swapLongPair
  0x0001b5c2, // FUN_1B5C2 stateSub1B5C2
  0x00029cce, // FUN_29CCE (not implemented)
  0x0001bc88, // FUN_1BC88 (not implemented)
  0x00014e92, // FUN_14E92 scriptSlotBboxTest14E92
  0x000175c8, // FUN_175C8 stringViewportHit175C8
  0x0001881c, // FUN_1881C stateSub1881C
  0x0001924e, // FUN_1924E (not implemented)
  0x00019d94, // FUN_19D94 bboxHitTest19D94
  0x0001365c, // FUN_1365C objectRenderUpdate1365C
  0x000160f6, // FUN_160F6 stateDispatch160F6
  0x0001b9cc, // FUN_1B9CC spriteHelper1B9CC
  0x0001c014, // FUN_1C014 spriteRotate1C014
  0x0001281c, // FUN_1281C objectEnter1281C
  0x0001706c, // FUN_1706C positionUpdate
  0x00025c74, // FUN_25C74 (not implemented)
  0x00018a1e, // FUN_18A1E computeSpriteCoords_v1
  0x00018e6c, // FUN_18E6C slotInsertSorted18E6C
  0x00025bae, // FUN_25BAE objectStateEntry25BAE
  0x00015884, // FUN_15884 soundPair15884
  0x000158ac, // FUN_158AC soundCmdSend158AC
  0x00015bd0, // FUN_15BD0 stateSub15BD0
  0x00025df6, // FUN_25DF6 trackballApplyDelta
  0x00025e7c, // FUN_25E7C vectorScale
  0x000285b0, // FUN_285B0 helper285B0
  0x000264aa, // FUN_264AA (inner of objectEnter1281C)
];

// Object & globals layout
const OBJ_BASE    = 0x00401e00; // generic non-player obj (not 0x400018 / 0x4000FA)
const PLAYER_BASE = 0x00400018; // player 1 (isPlayer = true)
const OBJ_SIZE    = 0x60;

const GLOBALS_BASE = 0x00400660; // covers 0x400660..0x4006A3
const GLOBALS_SIZE = 0x44;

const GAMEMODE_ADDR = 0x00400394; // word

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Patch all callee addresses with RTS (0x4E75). */
function patchAllSubs(cpu: CpuSession): void {
  for (const addr of ALL_CALLEE_ADDRS) {
    pokeMem(cpu, addr,     1, 0x4e);
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
  obj: number[];
  globals: number[];
  gameModeWord: number;
}

function snapshotBinary(cpu: CpuSession, objBase: number): Snapshot {
  const obj: number[] = [];
  for (let i = 0; i < OBJ_SIZE; i++) {
    obj.push(peekMem(cpu, objBase + i, 1) & 0xff);
  }
  const globals: number[] = [];
  for (let i = 0; i < GLOBALS_SIZE; i++) {
    globals.push(peekMem(cpu, GLOBALS_BASE + i, 1) & 0xff);
  }
  const gameModeWord =
    ((peekMem(cpu, GAMEMODE_ADDR, 1) & 0xff) << 8) |
    (peekMem(cpu, GAMEMODE_ADDR + 1, 1) & 0xff);
  return { obj, globals, gameModeWord };
}

function snapshotTs(
  state: ReturnType<typeof stateNs.emptyGameState>,
  objBase: number,
): Snapshot {
  const objOff  = objBase        - 0x400000;
  const globOff = GLOBALS_BASE   - 0x400000;
  const gmOff   = GAMEMODE_ADDR  - 0x400000;
  const obj: number[] = [];
  for (let i = 0; i < OBJ_SIZE; i++) {
    obj.push(state.workRam[objOff + i] ?? 0);
  }
  const globals: number[] = [];
  for (let i = 0; i < GLOBALS_SIZE; i++) {
    globals.push(state.workRam[globOff + i] ?? 0);
  }
  const gameModeWord =
    (((state.workRam[gmOff] ?? 0) << 8) | (state.workRam[gmOff + 1] ?? 0)) & 0xffff;
  return { obj, globals, gameModeWord };
}

/** All TS subs → no-op / returns-0, matching full RTS patches. */
const ALL_NOOP_SUBS: helperNs.Helper121B8Subs = {
  fun_1bab2: () => { /* no-op */ },
  fun_1cc62: () => 0,
  fun_1c676: () => { /* no-op */ },
  fun_12886: () => { /* no-op */ },
  fun_1b5c2: () => { /* no-op */ },
  fun_29cce: () => { /* no-op */ },
  fun_1bc88: () => 0,
  fun_14e92: () => { /* no-op */ },
  fun_175c8: () => { /* no-op */ },
  fun_1881c: () => { /* no-op */ },
  fun_1924e: () => { /* no-op */ },
  fun_19d94: () => { /* no-op */ },
  fun_1365c: () => { /* no-op */ },
  fun_160f6: () => { /* no-op */ },
  fun_1b9cc: () => { /* no-op */ },
  fun_1c014: () => { /* no-op */ },
  fun_1281c: () => 0,
  fun_1706c: () => { /* no-op */ },
  fun_25c74: () => { /* no-op */ },
  fun_18a1e: () => { /* no-op */ },
  fun_18e6c: () => { /* no-op */ },
  fun_25bae: () => { /* no-op */ },
  fun_15884: () => { /* no-op */ },
  fun_158ac: () => { /* no-op */ },
  fun_15bd0: () => { /* no-op */ },
  fun_25df6: () => { /* no-op */ },
  fun_25e7c: () => { /* no-op */ },
  fun_285b0: () => { /* no-op */ },
};

interface FailRecord {
  suite: string;
  tc: number;
  reason: string;
  objBase: number;
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
  patchAllSubs(cpu);

  let totalOk = 0;
  const failHolder: { value: FailRecord | null } = { value: null };

  const rng = makeRng(0x121b8);
  const rb = (): number => Math.floor(rng() * 256) & 0xff;

  /** Write obj + globals + game-mode to both Musashi and TS state. */
  function setupCase(
    objBase: number,
    objBytes: number[],
    globalBytes: number[],
    gameModeWord: number,
  ): void {
    // Binary (Musashi)
    for (let i = 0; i < OBJ_SIZE; i++) {
      pokeMem(cpu, objBase + i, 1, objBytes[i] ?? 0);
    }
    for (let i = 0; i < GLOBALS_SIZE; i++) {
      pokeMem(cpu, GLOBALS_BASE + i, 1, globalBytes[i] ?? 0);
    }
    pokeMem(cpu, GAMEMODE_ADDR,     1, (gameModeWord >>> 8) & 0xff);
    pokeMem(cpu, GAMEMODE_ADDR + 1, 1,  gameModeWord        & 0xff);
    cpu.system.setRegister("sp", 0x401f00);

    // TS workRam
    const offObj  = objBase      - 0x400000;
    const offGlob = GLOBALS_BASE - 0x400000;
    const offGm   = GAMEMODE_ADDR - 0x400000;
    for (let i = 0; i < OBJ_SIZE; i++) {
      stateInst.workRam[offObj + i] = objBytes[i] ?? 0;
    }
    for (let i = 0; i < GLOBALS_SIZE; i++) {
      stateInst.workRam[offGlob + i] = globalBytes[i] ?? 0;
    }
    stateInst.workRam[offGm]     = (gameModeWord >>> 8) & 0xff;
    stateInst.workRam[offGm + 1] =  gameModeWord        & 0xff;
  }

  function runOneCase(
    suite: string,
    tc: number,
    objBase: number,
    objBytes: number[],
    globalBytes: number[],
    gameModeWord: number,
  ): boolean {
    setupCase(objBase, objBytes, globalBytes, gameModeWord);

    // Run binary (all subs are patched to RTS)
    callFunction(cpu, FUN_121B8, [objBase]);
    const binSnap = snapshotBinary(cpu, objBase);

    // Run TS (all subs are no-op/returns-0)
    helperNs.helper121B8(stateInst, { program: romBuf } as never, objBase, ALL_NOOP_SUBS);
    const tsSnap = snapshotTs(stateInst, objBase);

    // Compare
    let reason = "";
    for (let i = 0; i < OBJ_SIZE && reason === ""; i++) {
      if (binSnap.obj[i] !== tsSnap.obj[i]) {
        reason = `obj[0x${i.toString(16)}] bin=0x${binSnap.obj[i]!.toString(16)} ts=0x${tsSnap.obj[i]!.toString(16)}`;
      }
    }
    for (let i = 0; i < GLOBALS_SIZE && reason === ""; i++) {
      if (binSnap.globals[i] !== tsSnap.globals[i]) {
        const addr = GLOBALS_BASE + i;
        reason = `glob[0x${addr.toString(16)}] bin=0x${binSnap.globals[i]!.toString(16)} ts=0x${tsSnap.globals[i]!.toString(16)}`;
      }
    }
    if (binSnap.gameModeWord !== tsSnap.gameModeWord && reason === "") {
      reason = `gameMode bin=0x${binSnap.gameModeWord.toString(16)} ts=0x${tsSnap.gameModeWord.toString(16)}`;
    }

    if (reason === "") return true;
    if (failHolder.value === null) {
      failHolder.value = { suite, tc, reason, objBase };
    }
    return false;
  }

  function genObj(): number[] { return new Array(OBJ_SIZE).fill(0).map(() => rb()); }
  function genGlobals(): number[] { return new Array(GLOBALS_SIZE).fill(0).map(() => rb()); }

  // ─── Suite A: random (all subs stubbed) ──────────────────────────────────
  console.log(`\n=== helper121B8 (FUN_000121B8) — Suite A: random/all-stubbed — ${perSuite} cases ===`);
  let okA = 0;
  for (let i = 0; i < perSuite; i++) {
    const obj = genObj();
    const globals = genGlobals();
    const gm = Math.floor(rng() * 6);
    if (runOneCase("A", i, OBJ_BASE, obj, globals, gm)) okA++;
  }
  console.log(`  Match: ${okA}/${perSuite} = ${((okA / perSuite) * 100).toFixed(1)}%`);
  totalOk += okA;

  // Suite B: forced "in-range" (small z, vz=0).
  // - spriteProject1CC62 returns 0
  // - D0 = 0 - obj.z; if obj.z is small (0x100) -> D0 = -0x100 < 0 < 0x100000 -> in-range.
  console.log(`\n=== Suite B: in-range + no-bounce — ${perSuite} cases ===`);
  let okB = 0;
  for (let i = 0; i < perSuite; i++) {
    const obj = genObj();
    // Force in-range: z small
    obj[0x14] = 0; obj[0x15] = 0; obj[0x16] = 0x01; obj[0x17] = 0;
    // Force vz = 0 to avoid big z drift
    obj[0x08] = 0; obj[0x09] = 0; obj[0x0a] = 0; obj[0x0b] = 0;
    // Force obj[0x36] = 0 (no gravity bounce state)
    obj[0x36] = 0;
    // Force d1w in [4..0x11c] to avoid bounce:
    // d1w = word(0x400692) - word(0x400690) + 0x88
    // But 0x400690/692 are set by spritePosUpdate1BAB2 (stubbed!)
    // With stub: spritePosUpdate1BAB2 does nothing → 0x400690/692 keep their
    // initial values from setup. Set them so d1w is in safe range.
    // Set worldX=0x0100 → globals[0x30..0x31] = 0x01 0x00
    // Set worldY=0x0100 → globals[0x32..0x33] = 0x01 0x00
    // d1w = 0x0100 - 0x0100 + 0x88 = 0x88 → safe [4..0x11c]
    const globals = genGlobals();
    // worldX (0x400690 = offset 0x30 in globals region 0x400660)
    globals[0x30] = 0x01; globals[0x31] = 0x00;
    // worldY (0x400692 = offset 0x32)
    globals[0x32] = 0x01; globals[0x33] = 0x00;
    const gm = Math.floor(rng() * 6);
    if (runOneCase("B", i, OBJ_BASE, obj, globals, gm)) okB++;
  }
  console.log(`  Match: ${okB}/${perSuite} = ${((okB / perSuite) * 100).toFixed(1)}%`);
  totalOk += okB;

  // ─── Suite C: "out-of-range" non-player ──────────────────────────────────
  // D0 (post-RTS-stub) = 0xFF (from moveq #0xFF,D0 at 0x1223C)
  // D0 -= obj.z → 0xFF - obj.z
  // For out-of-range: need D0_signed > 0x100000
  // 0xFF - obj.z > 0x100000 → obj.z < 0xFF - 0x100000 = 0xFFFF00FF - 0x100000 (wraps!)
  // Actually 0xFF - obj.z as signed 32-bit:
  // If obj.z = 0, D0 = 0xFF > 0x100000? 0xFF = 255 < 1048576 → no, in-range!
  // If obj.z = 0x80000000 (= -2^31): D0 = 0xFF - 0x80000000 = 0x8000_00FF - ... wraps
  // 0xFF - 0x80000000 mod 2^32 = 0x800000FF
  // As signed: 0x800000FF = -2147483393 < 0 < 0x100000 → in-range!
  // For out-of-range (D0_signed > 0x100000):
  // With D0_in = 0xFF, need D0_in - obj.z > 0x100000 as signed
  // 0xFF - obj.z > 0x100000 → 0xFF - 0x100000 > obj.z → obj.z < -0xFFF01 (very negative)
  // OR wraps around: obj.z in very small range
  // Actually this is complex. Let me use obj.z = 0xFFFF0000 (large unsigned = small signed negative)
  // D0 = 0xFF - 0xFFFF0000 = 0xFF + 0x00010000 = 0x000100FF
  // As signed: 0x000100FF = 65791 < 0x100000 → still in-range!
  //
  // It seems hard to force out-of-range with all subs stubbed because D0 starts at 0xFF.
  // Actually: with spritePosUpdate1BAB2 stubbed to RTS, D0 is preserved...
  // But BEFORE the first jsr (A3) call, D0 was set to 0xFF.
  // After jsr (A3) with RTS: D0 = 0xFF (unchanged, since RTS doesn't touch D0).
  // Then clr.l -(SP) → pushes 0 but doesn't change D0.
  // Then jsr $1CC62.l with RTS: D0 = 0xFF (unchanged).
  // sub.l (0x14,A2),D0 → D0 = 0xFF - obj.z
  // For D0_signed > 0x100000: 0xFF - obj.z > 0x100000 when obj.z < 0xFF - 0x100000
  // As unsigned: obj.z < 0xFFEFFF (= 16,711,679)
  // But also: 0xFF - obj.z as signed depends on whether it wraps
  // If obj.z > 0xFF: D0 = 0xFF - obj.z as unsigned = huge number > 0x80000000 → negative signed
  // → ble (signed) is taken (negative <= 0x100000) → in-range!
  // So with D0_in = 0xFF, sub.l anything > 0xFF gives negative → always in-range?
  // Unless obj.z = 0 → D0 = 0xFF < 0x100000 → in-range
  // Unless obj.z = 0x01..0xFF → D0 = 0xFE..0x00 < 0x100000 → in-range
  // Unless obj.z is 0xFF + 0x100001 = 0x100100: D0 = 0xFF - 0x100100 = 0xFFFF00FF (negative)
  // → negative < 0x100000 → in-range
  // So with RTS stub for spritePosUpdate1BAB2 AND spriteProject1CC62:
  // D0 = 0xFF is always < 0x100000 regardless of obj.z!
  // This means the out-of-range path is NEVER taken with full RTS stubs.
  // Suite C will test the same path as Suite B.
  console.log(`\n=== Suite C: varied state bytes (0x58 dispatch) — ${perSuite} cases ===`);
  let okC = 0;
  const stateByteSamples = [0x2d, 0x2e, 0x3b, 0x38, 0x39, 0x3a, 0x2f, 0x30, 0x31, 0x10, 0x17, 0x37, 0x00, 0x65, 0x0a];
  for (let i = 0; i < perSuite; i++) {
    const obj = genObj();
    // Force obj[0x58] to interesting state bytes
    obj[0x58] = stateByteSamples[i % stateByteSamples.length] ?? 0;
    // Force obj[0x36] = 0 (no gravity bounce)
    obj[0x36] = 0;
    // Force z small (in-range)
    obj[0x14] = 0; obj[0x15] = 0; obj[0x16] = 0; obj[0x17] = 0;
    // Force d1w in safe range
    const globals = genGlobals();
    globals[0x30] = 0x01; globals[0x31] = 0x00;
    globals[0x32] = 0x01; globals[0x33] = 0x00;
    const gm = Math.floor(rng() * 6);
    if (runOneCase("C", i, OBJ_BASE, obj, globals, gm)) okC++;
  }
  console.log(`  Match: ${okC}/${perSuite} = ${((okC / perSuite) * 100).toFixed(1)}%`);
  totalOk += okC;

  // ─── Suite D: player address edge cases ──────────────────────────────────
  const sizeD = perSuite + remainder;
  console.log(`\n=== Suite D: player (0x400018) + obj[0x1A] early exits — ${sizeD} cases ===`);
  let okD = 0;
  const PLAYER_OFF = PLAYER_BASE - 0x400000;
  for (let i = 0; i < sizeD; i++) {
    const obj = genObj();
    const globals = genGlobals();
    // Safe d1w
    globals[0x30] = 0x01; globals[0x31] = 0x00;
    globals[0x32] = 0x01; globals[0x33] = 0x00;
    obj[0x36] = 0;
    obj[0x14] = 0; obj[0x15] = 0; obj[0x16] = 0; obj[0x17] = 0;

    if (i % 4 === 0) {
      // obj[0x1A] = 4 → early exit after state dispatch
      obj[0x1a] = 0x04;
    } else if (i % 4 === 1) {
      // obj[0x58] = 0x0A → early exit
      obj[0x58] = 0x0a;
    } else if (i % 4 === 2) {
      // obj[0x1B] = various sub-states
      obj[0x1b] = (i & 3) as number;
    } else {
      // random state
    }

    const gm = Math.floor(rng() * 6);

    // Write to binary + TS for player address
    for (let j = 0; j < OBJ_SIZE; j++) {
      pokeMem(cpu, PLAYER_BASE + j, 1, obj[j] ?? 0);
    }
    for (let j = 0; j < GLOBALS_SIZE; j++) {
      pokeMem(cpu, GLOBALS_BASE + j, 1, globals[j] ?? 0);
    }
    pokeMem(cpu, GAMEMODE_ADDR,     1, 0);
    pokeMem(cpu, GAMEMODE_ADDR + 1, 1, gm);
    cpu.system.setRegister("sp", 0x401f00);

    for (let j = 0; j < OBJ_SIZE; j++) {
      stateInst.workRam[PLAYER_OFF + j] = obj[j] ?? 0;
    }
    for (let j = 0; j < GLOBALS_SIZE; j++) {
      stateInst.workRam[GLOBALS_BASE - 0x400000 + j] = globals[j] ?? 0;
    }
    stateInst.workRam[GAMEMODE_ADDR - 0x400000]     = 0;
    stateInst.workRam[GAMEMODE_ADDR - 0x400000 + 1] = gm;

    callFunction(cpu, FUN_121B8, [PLAYER_BASE]);
    const binSnap = snapshotBinary(cpu, PLAYER_BASE);

    helperNs.helper121B8(stateInst, { program: romBuf } as never, PLAYER_BASE, ALL_NOOP_SUBS);
    const tsSnap = snapshotTs(stateInst, PLAYER_BASE);

    let reason = "";
    for (let j = 0; j < OBJ_SIZE && reason === ""; j++) {
      if (binSnap.obj[j] !== tsSnap.obj[j]) {
        reason = `obj[0x${j.toString(16)}] bin=0x${binSnap.obj[j]!.toString(16)} ts=0x${tsSnap.obj[j]!.toString(16)}`;
      }
    }
    for (let j = 0; j < GLOBALS_SIZE && reason === ""; j++) {
      if (binSnap.globals[j] !== tsSnap.globals[j]) {
        const addr = GLOBALS_BASE + j;
        reason = `glob[0x${addr.toString(16)}] bin=0x${binSnap.globals[j]!.toString(16)} ts=0x${tsSnap.globals[j]!.toString(16)}`;
      }
    }
    if (binSnap.gameModeWord !== tsSnap.gameModeWord && reason === "") {
      reason = `gameMode bin=0x${binSnap.gameModeWord.toString(16)} ts=0x${tsSnap.gameModeWord.toString(16)}`;
    }

    if (reason === "") {
      okD++;
    } else if (failHolder.value === null) {
      failHolder.value = { suite: "D", tc: i, reason, objBase: PLAYER_BASE };
    }
  }
  console.log(`  Match: ${okD}/${sizeD} = ${((okD / sizeD) * 100).toFixed(1)}%`);
  totalOk += okD;

  // ─── Summary ─────────────────────────────────────────────────────────────
  console.log(`\n=== TOTAL: ${totalOk}/${total} = ${((totalOk / total) * 100).toFixed(1)}% ===`);
  if (failHolder.value !== null) {
    const f = failHolder.value;
    console.log(`  First fail (suite ${f.suite} tc=${f.tc}): ${f.reason}`);
    console.log(`  objBase=0x${f.objBase.toString(16)}`);
  }

  disposeCpu(cpu);
  exit(totalOk === total ? 0 : 1);
}

main().catch(e => {
  console.error(e);
  exit(1);
});
