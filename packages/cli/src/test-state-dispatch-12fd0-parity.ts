#!/usr/bin/env node
/**
 * test-state-dispatch-12fd0-parity.ts — differential FUN_12FD0 vs
 * `stateDispatch12FD0`.
 *
 *
 * **Strategia stub injection**:
 *
 *   1. **FUN_12D46** (40 bytes @ 0x12D46): replaced with a stub (26 bytes)
 *      il counter @ 0x401904 di +4.
 *
 *      Layout stub (26 byte):
 *        movea.l  #$401900, A0         ; 207C 0040 1900   (6 byte)
 *        move.l   $401904.l, D1        ; 2239 0040 1904   (6 byte)
 *        adda.l   D1, A0               ; D1C1             (2 byte)
 *        move.l   (4,SP), (A0)         ; 20AF 0004        (4 byte)
 *        addq.l   #4, $401904.l        ; 54B9 0040 1904   (6 byte)
 *        rts                           ; 4E75             (2 byte)
 *
 *   2. **FUN_11AC2** (22 bytes @ 0x11AC2): replaced with a stub (8 bytes)
 *      that increments byte counter @ 0x401908 by 1.
 *
 *      Layout stub (8 byte):
 *        addq.b   #1, $401908.l        ; 5439 0040 1908   (6 byte)
 *        rts                           ; 4E75             (2 byte)
 *
 *   3. **FUN_13068** (very large @ 0x13068): replaced with a stub (26 bytes)
 *
 *      Layout stub (26 byte):
 *        movea.l  #$401910, A0         ; 207C 0040 1910   (6 byte)
 *        move.l   $401974.l, D1        ; 2239 0040 1974   (6 byte)
 *        adda.l   D1, A0               ; D1C1             (2 byte)
 *        move.l   (4,SP), (A0)         ; 20AF 0004        (4 byte)
 *        addq.l   #4, $401974.l        ; 58B9 0040 1974   (6 byte)
 *        rts                           ; 4E75             (2 byte)
 *
 *   0x401900..0x401903  — last arg a fun_12d46 (long BE)
 *   0x401974..0x401977  — counter ring fun_13068 (long BE)
 *
 *   - C: gameMode!=2 (varie combinazioni di flag75c/75e)
 *
 *
 * Uso: npx tsx packages/cli/src/test-state-dispatch-12fd0-parity.ts [N]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import {
  state as stateNs,
  stateDispatch12FD0 as ns,
} from "@marble-love/engine";
import {
  createCpu,
  callFunction,
  pokeMem,
  peekMem,
  disposeCpu,
} from "./binary-oracle-lib.js";
import type { CpuSession } from "./binary-oracle-lib.js";

const FUN_12FD0 = 0x00012fd0;
const FUN_12D46 = 0x00012d46;
const FUN_11AC2 = 0x00011ac2;
const FUN_13068 = 0x00013068;

const WRAM = 0x00400000;

// ─── Logging memory layout ──────────────────────────────────────────────────

/** Last arg pushed to fun_12d46 (long BE, 4 bytes). */
const SLOT_12D46_ARG  = 0x00401900;
/** Call counter for fun_12d46 (long BE, 4 bytes). Counter += 4 per call. */
const SLOT_12D46_CTR  = 0x00401904;
/** Call counter for fun_11ac2 (byte, 1 byte). Counter += 1 per call. */
const SLOT_11AC2_CTR  = 0x00401908;
/** Ring buffer base for fun_13068 args (25×4=100 bytes). */
const RING_13068_BASE = 0x00401910;
/** Ring counter for fun_13068 (long BE, 4 bytes). Counter += 4 per call.
 *  NOTE: placed AFTER ring buffer end to avoid overlap:
 *  ring uses 0x401910..0x401973 (100 bytes), counter at 0x401974. */
const RING_13068_CTR  = 0x00401974;

/** Total logging zone to compare (0x401900..0x401977 = 120 bytes). */
const LOG_BASE = SLOT_12D46_ARG;
const LOG_SIZE = 0x78; // 0x401900..0x401977

// Workram offsets
const LOG_OFF          = LOG_BASE - WRAM;   // 0x1900
const SLOT_12D46_ARG_OFF = SLOT_12D46_ARG - WRAM;
const SLOT_12D46_CTR_OFF = SLOT_12D46_CTR - WRAM;
const SLOT_11AC2_CTR_OFF = SLOT_11AC2_CTR - WRAM;
const RING_13068_BASE_OFF = RING_13068_BASE - WRAM;
const RING_13068_CTR_OFF  = RING_13068_CTR - WRAM;  // 0x1974

// ─── Stub bytes ──────────────────────────────────────────────────────────────

/** Stub for FUN_12D46 (26 bytes): logs arg to 0x401900+counter, counter+=4. */
function patchFun12D46(cpu: CpuSession): void {
  const bytes = [
    // movea.l #$401900, A0         ; 207C 0040 1900
    0x20, 0x7c, 0x00, 0x40, 0x19, 0x00,
    // move.l $401904.l, D1         ; 2239 0040 1904
    0x22, 0x39, 0x00, 0x40, 0x19, 0x04,
    // adda.l D1, A0                ; D1C1
    0xd1, 0xc1,
    // move.l (4,SP), (A0)          ; 20AF 0004
    0x20, 0xaf, 0x00, 0x04,
    // addq.l #4, $401904.l         ; 58B9 0040 1904  (0x58 = addq.l #4)
    0x58, 0xb9, 0x00, 0x40, 0x19, 0x04,
    // rts                          ; 4E75
    0x4e, 0x75,
  ];
  for (let i = 0; i < bytes.length; i++) pokeMem(cpu, FUN_12D46 + i, 1, bytes[i]!);
}

/** Stub for FUN_11AC2 (8 bytes): increments byte @ 0x401908. */
function patchFun11AC2(cpu: CpuSession): void {
  const bytes = [
    // addq.b #1, $401908.l         ; 5239 0040 1908  (0x52 = addq.b #1)
    0x52, 0x39, 0x00, 0x40, 0x19, 0x08,
    // rts                          ; 4E75
    0x4e, 0x75,
  ];
  for (let i = 0; i < bytes.length; i++) pokeMem(cpu, FUN_11AC2 + i, 1, bytes[i]!);
}

/** Stub for FUN_13068 (26 bytes): logs arg to ring @ 0x401910+counter, counter+=4.
 *  Ring buffer: 0x401910..0x401973 (25×4=100 bytes).
 *  Counter at 0x401974 (AFTER ring end to avoid overlap). */
function patchFun13068(cpu: CpuSession): void {
  const bytes = [
    // movea.l #$401910, A0         ; 207C 0040 1910
    0x20, 0x7c, 0x00, 0x40, 0x19, 0x10,
    // move.l $401974.l, D1         ; 2239 0040 1974
    0x22, 0x39, 0x00, 0x40, 0x19, 0x74,
    // adda.l D1, A0                ; D1C1
    0xd1, 0xc1,
    // move.l (4,SP), (A0)          ; 20AF 0004
    0x20, 0xaf, 0x00, 0x04,
    // addq.l #4, $401974.l         ; 58B9 0040 1974  (0x58 = addq.l #4)
    0x58, 0xb9, 0x00, 0x40, 0x19, 0x74,
    // rts                          ; 4E75
    0x4e, 0x75,
  ];
  for (let i = 0; i < bytes.length; i++) pokeMem(cpu, FUN_13068 + i, 1, bytes[i]!);
}

function patchAllSubs(cpu: CpuSession): void {
  patchFun12D46(cpu);
  patchFun11AC2(cpu);
  patchFun13068(cpu);
}

// ─── RNG ─────────────────────────────────────────────────────────────────────

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1103515245) + 12345) >>> 0;
    return ((s >>> 16) & 0xffff) / 0x10000;
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

type State = ReturnType<typeof stateNs.emptyGameState>;

function pokeByteBoth(state: State, cpu: CpuSession, abs: number, v: number): void {
  const b = v & 0xff;
  pokeMem(cpu, abs, 1, b);
  state.workRam[abs - WRAM] = b;
}

function pokeWordBoth(state: State, cpu: CpuSession, abs: number, v: number): void {
  const hi = (v >>> 8) & 0xff;
  const lo = v & 0xff;
  pokeMem(cpu, abs, 1, hi);
  pokeMem(cpu, abs + 1, 1, lo);
  state.workRam[abs - WRAM] = hi;
  state.workRam[abs - WRAM + 1] = lo;
}

/** Clear the logging zone in both binary and TS state. */
function resetLogZone(state: State, cpu: CpuSession): void {
  for (let i = 0; i < LOG_SIZE; i++) {
    pokeMem(cpu, LOG_BASE + i, 1, 0);
    state.workRam[LOG_OFF + i] = 0;
  }
}

/** Compare LOG_SIZE bytes of logging zone. */
function compareLog(
  state: State,
  cpu: CpuSession,
): { offset: number; bin: number; ts: number } | null {
  for (let i = 0; i < LOG_SIZE; i++) {
    const bin = peekMem(cpu, LOG_BASE + i, 1) & 0xff;
    const ts = state.workRam[LOG_OFF + i] ?? 0;
    if (bin !== ts) return { offset: i, bin, ts };
  }
  return null;
}

// ─── TS subs that mirror the binary stubs ─────────────────────────────────────

function makeSubs(state: State): ns.StateDispatch12FD0Subs {
  const r = state.workRam;

  const readU32 = (off: number): number =>
    (((r[off] ?? 0) << 24) | ((r[off + 1] ?? 0) << 16) | ((r[off + 2] ?? 0) << 8) | (r[off + 3] ?? 0)) >>> 0;

  const writeU32 = (off: number, val: number): void => {
    const u = val >>> 0;
    r[off] = (u >>> 24) & 0xff;
    r[off + 1] = (u >>> 16) & 0xff;
    r[off + 2] = (u >>> 8) & 0xff;
    r[off + 3] = u & 0xff;
  };

  return {
    /** Mirror of binary stub: writes arg to 0x401900+counter, counter+=4. */
    fun_12d46: (romScriptPtr: number) => {
      const ctr = readU32(SLOT_12D46_CTR_OFF);
      // Write arg at base + counter offset
      const dest = SLOT_12D46_ARG_OFF + ctr;
      writeU32(dest, romScriptPtr);
      writeU32(SLOT_12D46_CTR_OFF, (ctr + 4) >>> 0);
    },
    /** Mirror of binary stub: increments byte at 0x401908. */
    fun_11ac2: () => {
      r[SLOT_11AC2_CTR_OFF] = ((r[SLOT_11AC2_CTR_OFF] ?? 0) + 1) & 0xff;
    },
    /** Mirror of binary stub: writes arg to ring @ 0x401910+counter, counter+=4. */
    fun_13068: (slotPtr: number) => {
      const ctr = readU32(RING_13068_CTR_OFF);
      const dest = RING_13068_BASE_OFF + ctr;
      writeU32(dest, slotPtr);
      writeU32(RING_13068_CTR_OFF, (ctr + 4) >>> 0);
    },
  };
}

// ─── Test case execution ──────────────────────────────────────────────────────

interface FailRecord {
  suite: string;
  tc: number;
  diff: { offset: number; bin: number; ts: number };
  setup: Record<string, number>;
}

async function main(): Promise<void> {
  const total = Number(process.argv[2] ?? "500");
  const perSuite = Math.floor(total / 5);
  const extraE = total - perSuite * 4;

  const romPath = resolve("ghidra_project/marble_program.bin");
  if (!existsSync(romPath)) {
    console.error(`error: ROM blob not found at ${romPath}`);
    exit(3);
  }
  const rom = readFileSync(romPath);

  const state = stateNs.emptyGameState();
  const cpu = await createCpu({ rom, state });
  patchAllSubs(cpu);

  const subs = makeSubs(state);
  const rng = makeRng(0x12fd0);
  const rb = (): number => Math.floor(rng() * 256) & 0xff;
  const rw = (): number => Math.floor(rng() * 0x10000) & 0xffff;

  let totalOk = 0;
  const failHolder: { value: FailRecord | null } = { value: null };

  const OBJ_BASE = 0x00400018;
  const OBJ_STRIDE_VAL = 0xe2;

  function setupObjArray(objCount: number): void {
    pokeWordBoth(state, cpu, 0x400396, objCount);
    for (let i = 0; i < objCount; i++) {
      const base = OBJ_BASE + i * OBJ_STRIDE_VAL;
      // clear both active and state bytes
      pokeByteBoth(state, cpu, base + 0x18, 0);
      pokeByteBoth(state, cpu, base + 0x1b, 0);
    }
  }

  function setObj(
    idx: number,
    active: number,
    stateVal: number,
  ): void {
    const base = OBJ_BASE + idx * OBJ_STRIDE_VAL;
    pokeByteBoth(state, cpu, base + 0x18, active);
    pokeByteBoth(state, cpu, base + 0x1b, stateVal);
  }

  function runOne(
    suite: string,
    tc: number,
    setup: Record<string, number>,
  ): boolean {
    cpu.system.setRegister("sp", 0x401f00);
    resetLogZone(state, cpu);

    // Apply setup
    pokeWordBoth(state, cpu, 0x400394, setup["gameMode"] ?? 0);
    pokeByteBoth(state, cpu, 0x40075c, setup["flag75c"] ?? 0);
    pokeByteBoth(state, cpu, 0x40075e, setup["flag75e"] ?? 0);

    const objCount = setup["objCount"] ?? 0;
    setupObjArray(objCount);
    for (let i = 0; i < objCount; i++) {
      setObj(i, setup[`obj${i}_active`] ?? 0, setup[`obj${i}_state`] ?? 0);
    }

    // Run binary
    callFunction(cpu, FUN_12FD0, []);
    // Run TS
    ns.stateDispatch12FD0(state, subs);

    const diff = compareLog(state, cpu);
    if (diff !== null) {
      if (failHolder.value === null) {
        failHolder.value = { suite, tc, diff, setup };
      }
      return false;
    }
    return true;
  }

  // ── Suite A: gameMode=2, dispatch triggered ────────────────────────────
  console.log(`\n=== stateDispatch12FD0 (FUN_12FD0) — Suite A: gameMode=2 dispatch — ${perSuite} casi ===`);
  let okA = 0;
  for (let i = 0; i < perSuite; i++) {
    const objCount = 1 + Math.floor(rng() * 4); // 1..4 objects
    const dispIdx = Math.floor(rng() * objCount);
    const dispState = rng() > 0.5 ? 0x09 : 0x0a;
    const setup: Record<string, number> = {
      gameMode: 2,
      flag75e: 0xff,
      flag75c: rb(),
      objCount,
    };
    for (let j = 0; j < objCount; j++) {
      setup[`obj${j}_active`] = j === dispIdx ? 1 : rb() & 1;
      setup[`obj${j}_state`] = j === dispIdx ? dispState : rb();
    }
    if (runOne("A", i, setup)) okA++;
  }
  console.log(`  Match: ${okA}/${perSuite} = ${((okA / perSuite) * 100).toFixed(1)}%`);
  totalOk += okA;

  // ── Suite B: gameMode=2, no dispatch (various blocking conditions) ─────
  console.log(`\n=== Suite B: gameMode=2 no-dispatch — ${perSuite} casi ===`);
  let okB = 0;
  for (let i = 0; i < perSuite; i++) {
    const variant = i % 4;
    const objCount = 1 + Math.floor(rng() * 3);
    const setup: Record<string, number> = {
      gameMode: 2,
      flag75c: rb(),
      objCount,
    };
    for (let j = 0; j < objCount; j++) {
      if (variant === 0) {
        // All inactive
        setup["flag75e"] = 0xff;
        setup[`obj${j}_active`] = 0;
        setup[`obj${j}_state`] = 0x09;
      } else if (variant === 1) {
        // flag75e == 0
        setup["flag75e"] = 0;
        setup[`obj${j}_active`] = 1;
        setup[`obj${j}_state`] = 0x09;
      } else if (variant === 2) {
        // Wrong state
        setup["flag75e"] = 0xff;
        setup[`obj${j}_active`] = 1;
        // state not 9 or 10
        let st = rb();
        while (st === 0x09 || st === 0x0a) st = rb();
        setup[`obj${j}_state`] = st;
      } else {
        // Random mix — no dispatch state
        setup["flag75e"] = rb();
        setup[`obj${j}_active`] = 1;
        setup[`obj${j}_state`] = rb() & 0x07; // 0..7, not 9/10
      }
    }
    if (runOne("B", i, setup)) okB++;
  }
  console.log(`  Match: ${okB}/${perSuite} = ${((okB / perSuite) * 100).toFixed(1)}%`);
  totalOk += okB;

  // ── Suite C: gameMode != 2 ─────────────────────────────────────────────
  console.log(`\n=== Suite C: gameMode != 2 — ${perSuite} casi ===`);
  let okC = 0;
  for (let i = 0; i < perSuite; i++) {
    let mode = rw();
    while (mode === 2) mode = rw();
    const objCount = Math.floor(rng() * 4);
    const setup: Record<string, number> = {
      gameMode: mode,
      flag75e: rb(),
      flag75c: rb(),
      objCount,
    };
    for (let j = 0; j < objCount; j++) {
      setup[`obj${j}_active`] = 1;
      setup[`obj${j}_state`] = 0x09;
    }
    if (runOne("C", i, setup)) okC++;
  }
  console.log(`  Match: ${okC}/${perSuite} = ${((okC / perSuite) * 100).toFixed(1)}%`);
  totalOk += okC;

  // ── Suite D: flag75c variations, 25 slot calls ─────────────────────────
  console.log(`\n=== Suite D: flag75c variations + 25 slot calls — ${perSuite} casi ===`);
  let okD = 0;
  for (let i = 0; i < perSuite; i++) {
    const flag75c = i % 3 === 0 ? 0 : (i % 3 === 1 ? 0x01 : rb());
    const setup: Record<string, number> = {
      gameMode: rw(),
      flag75e: rb(),
      flag75c,
      objCount: 0,
    };
    if (runOne("D", i, setup)) okD++;
  }
  console.log(`  Match: ${okD}/${perSuite} = ${((okD / perSuite) * 100).toFixed(1)}%`);
  totalOk += okD;

  // ── Suite E: edge cases ───────────────────────────────────────────────
  console.log(`\n=== Suite E: edge cases — ${extraE} casi ===`);
  let okE = 0;
  const edgeCases: Array<Record<string, number>> = [
    // objCount = 0 with gameMode=2
    { gameMode: 2, flag75e: 1, flag75c: 1, objCount: 0 },
    // gameMode=2, all obj inactive, flag75c on
    { gameMode: 2, flag75e: 1, flag75c: 0xff, objCount: 2, obj0_active: 0, obj0_state: 9, obj1_active: 0, obj1_state: 10 },
    // gameMode=2, 1 obj active state=9, flag75e=0
    { gameMode: 2, flag75e: 0, flag75c: 0, objCount: 1, obj0_active: 1, obj0_state: 9 },
    // gameMode=3, same obj setup
    { gameMode: 3, flag75e: 1, flag75c: 1, objCount: 1, obj0_active: 1, obj0_state: 10 },
    // gameMode=2, first matching obj at index 2
    { gameMode: 2, flag75e: 1, flag75c: 0, objCount: 4, obj0_active: 0, obj0_state: 9, obj1_active: 1, obj1_state: 5, obj2_active: 1, obj2_state: 9, obj3_active: 1, obj3_state: 9 },
    // gameMode=2, state=0x0a (10) triggers
    { gameMode: 2, flag75e: 1, flag75c: 0, objCount: 1, obj0_active: 1, obj0_state: 0x0a },
    // both flags on, gameMode=0
    { gameMode: 0, flag75e: 1, flag75c: 1, objCount: 0 },
    // gameMode=2, max object index
    { gameMode: 2, flag75e: 1, flag75c: 0, objCount: 3, obj0_active: 0, obj0_state: 9, obj1_active: 0, obj1_state: 10, obj2_active: 1, obj2_state: 9 },
    // flag75c = 0xff
    { gameMode: 0, flag75e: 0, flag75c: 0xff, objCount: 0 },
    // gameMode=2, active obj state != 9 or 10 -> no dispatch
    { gameMode: 2, flag75e: 1, flag75c: 1, objCount: 2, obj0_active: 1, obj0_state: 0x08, obj1_active: 1, obj1_state: 0x0b },
  ];
  for (let i = 0; i < extraE; i++) {
    const setup = edgeCases[i % edgeCases.length]!;
    // Add some random variation for cases beyond static list
    const effectiveSetup: Record<string, number> = i < edgeCases.length
      ? { ...setup }
      : {
          gameMode: i % 2 === 0 ? 2 : rw() & 0xf,
          flag75e: rb(),
          flag75c: rb(),
          objCount: Math.floor(rng() * 3),
          obj0_active: rb() & 1,
          obj0_state: rb(),
          obj1_active: rb() & 1,
          obj1_state: rb(),
          obj2_active: rb() & 1,
          obj2_state: rb(),
        };
    if (runOne("E", i, effectiveSetup)) okE++;
  }
  console.log(`  Match: ${okE}/${extraE} = ${((okE / extraE) * 100).toFixed(1)}%`);
  totalOk += okE;

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log(`\n=== TOTALE: ${totalOk}/${total} = ${((totalOk / total) * 100).toFixed(1)}% ===`);
  if (failHolder.value !== null) {
    const f = failHolder.value;
    console.log(
      `  First fail (suite ${f.suite} tc=${f.tc}): ` +
      `log+0x${f.diff.offset.toString(16)} bin=0x${f.diff.bin.toString(16)} ts=0x${f.diff.ts.toString(16)}\n` +
      `  setup: ${JSON.stringify(f.setup)}`,
    );
  }

  disposeCpu(cpu);
  exit(totalOk === total ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  exit(1);
});
