#!/usr/bin/env node
/**
 * test-state-sub-1b5c2-parity.ts — differential FUN_0001B5C2 vs
 * `stateSub1B5C2`.
 *
 * FUN_0001B5C2 (838 byte, 0x1B5C2-0x1B908): "position-steering applicator".
 * Applies absLong / negateIfPositive to D3 (x) and D4 (y) of the struct A2 based on
 * 8 conditional blocks (cardinal flags, gate word, direction bitmap).
 *
 * **Parity strategy**:
 *   - FUN_0001B5B4 (negateIfPositive, A4) and FUN_0001B5A6 (absLong) are
 *     **non-stubbed** ROM subs (left live in the binary).
 *   - FUN_000158AC (sound cmd) **stubbed with RTS** (side-effect-only).
 *   - Call the function body from 0x1B5F6 (first known instruction) after
 *     faking the saved frame on the stack (8 dummy longs to satisfy the
 *     `movem.l (SP)+,...` of the epilogue) and pre-setting the registers D2/D3/A2/A3/A4.
 *   - A4 = 0x1B5B4 (fixed address of negateIfPositive in ROM).
 *   - Compare: the entire workRam [0x400000..0x402000) excl. stack area.
 *
 * **Suite** (4 × 125 = 500):
 *   A: random — random globals + random struct + random bitmap
 *   B: all direction flags off - no active block
 *   C: forced gate active + all cardinals active — maximum coverage
 *   D: edge - extreme values (0x80000000, 0, -1, velocity pivot)
 *
 * Usage: npx tsx packages/cli/src/test-state-sub-1b5c2-parity.ts [N]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import {
  state as stateNs,
  stateSub1B5C2 as sub1B5C2Ns,
} from "@marble-love/engine";
import {
  createCpu,
  pokeMem,
  peekMem,
  disposeCpu,
} from "./binary-oracle-lib.js";
import type { CpuSession } from "./binary-oracle-lib.js";

// ─── Addresses ──────────────────────────────────────────────────────────────

/** First instruction of function body (after unknown prologue). */
const FUN_1B5C2_BODY = 0x0001b5f6;
/** negateIfPositive (A4 in the original function). */
const FUN_1B5B4 = 0x0001b5b4;
/** FUN_000158AC — sound cmd sender, stubbed with RTS. */
const FUN_158AC = 0x000158ac;

const WORK_RAM_BASE = 0x00400000;
const WORK_RAM_SIZE = 0x2000;

// ─── Globals layout ─────────────────────────────────────────────────────────

const sub = sub1B5C2Ns;

const OFFSETS = {
  CHG_X:        sub.CHG_X_OFF,
  CHG_Y:        sub.CHG_Y_OFF,
  FLAG_PX:      sub.FLAG_PX_OFF,
  FLAG_PY:      sub.FLAG_PY_OFF,
  FLAG_NX:      sub.FLAG_NX_OFF,
  FLAG_NY:      sub.FLAG_NY_OFF,
  GATE_PX:      sub.GATE_PX_OFF,
  GATE_PY:      sub.GATE_PY_OFF,
  GATE_NX:      sub.GATE_NX_OFF,
  GATE_NY:      sub.GATE_NY_OFF,
  GATE_7C:      sub.GATE_7C_OFF,
  GATE_7E:      sub.GATE_7E_OFF,
  GATE_80:      sub.GATE_80_OFF,
  GATE_82:      sub.GATE_82_OFF,
  X_SRC:        sub.STRUCT_X_SRC_OFF,
  Y_SRC:        sub.STRUCT_Y_SRC_OFF,
  GATE_A0:      sub.GATE_A0_OFF,
  TRACK_X_CUR:  sub.TRACK_X_CUR_OFF,
  TRACK_X_BASE: sub.TRACK_X_BASE_OFF,
  TRACK_Y_CUR:  sub.TRACK_Y_CUR_OFF,
  TRACK_Y_BASE: sub.TRACK_Y_BASE_OFF,
};

// ─── Stub ────────────────────────────────────────────────────────────────────

function patchSubs(cpu: CpuSession): void {
  // FUN_158AC: RTS stub.
  pokeMem(cpu, FUN_158AC + 0, 1, 0x4e);
  pokeMem(cpu, FUN_158AC + 1, 1, 0x75);
}

// ─── RNG ─────────────────────────────────────────────────────────────────────

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) >>> 0;
    return ((s >>> 16) & 0xffff) / 0x10000;
  };
}

// ─── Call helpers ─────────────────────────────────────────────────────────────

const SENTINEL = 0xcafebabe >>> 0;
/** Number of saved registers in the prologue movem: D2-D6, A2-A4 = 8. */
const SAVE_FRAME_REGS = 8;

/**
 * Run the body of FUN_0001B5C2 starting at 0x1B5F6, with:
 *   - stack frame fake (8 long per `movem.l (SP)+` of the epilogue)
 *   - D2 = d2Addr, D3 = d3Val, A2 = a2Addr, A3 = a3Addr, A4 = FUN_1B5B4
 *   - sentinel return address above the fake frame
 *
 * Reuse the `callFunction` pattern but without stack args.
 */
function callBody(
  cpu: CpuSession,
  a2Addr: number,
  a3Addr: number,
  d2Addr: number,
  d3Val: number,
): void {
  const sys = cpu.system;
  const sp = 0x401edc;

  // The body starts after the prologue, so SP points at the saved movem frame
  // and the RTS return address sits just above that frame.
  for (let i = 0; i < SAVE_FRAME_REGS; i++) {
    sys.write(sp + i * 4, 4, 0xdeadbeef);
  }
  sys.write(sp + SAVE_FRAME_REGS * 4, 4, SENTINEL);

  sys.setRegister("sp", sp);
  sys.setRegister("pc", FUN_1B5C2_BODY);

  // Set input registers.
  sys.setRegister("d2", d2Addr >>> 0);   // D2 holds the word-addr for exg trick
  sys.setRegister("d3", d3Val >>> 0);    // D3 = initial x (= *A2, set by caller before fn)
  sys.setRegister("a2", a2Addr >>> 0);   // A2 = struct ptr
  sys.setRegister("a3", a3Addr >>> 0);   // A3 = bitmap ptr
  sys.setRegister("a4", FUN_1B5B4);      // A4 = negateIfPositive fn

  // Run until sentinel. Step instruction-by-instruction so the transient PC
  // value immediately after RTS cannot be skipped by a burst run.
  const maxInstructions = 2_000;
  for (let i = 0; i < maxInstructions; i++) {
    if (sys.getRegisters().pc === SENTINEL) break;
    sys.step();
    if (sys.getRegisters().pc === SENTINEL) break;
  }

  // Pop: sentinel already consumed by RTS. Stack pointer is correct.
  // But `callFunction` pops manually; here it was already popped by `rts`.
}

// ─── Snapshot ─────────────────────────────────────────────────────────────────

/** Region to compare: full workRam minus stack zone. */
const STACK_LOW = 0x1ec0;
const STACK_HIGH = 0x1f10;

function diffWorkRam(
  cpu: CpuSession,
  state: ReturnType<typeof stateNs.emptyGameState>,
): number[] {
  const diffs: number[] = [];
  for (let k = 0; k < WORK_RAM_SIZE; k++) {
    if (k >= STACK_LOW && k < STACK_HIGH) continue;
    const binByte = peekMem(cpu, WORK_RAM_BASE + k, 1) & 0xff;
    const tsByte = (state.workRam[k] ?? 0) & 0xff;
    if (binByte !== tsByte) {
      diffs.push(k);
      if (diffs.length >= 16) break;
    }
  }
  return diffs;
}

// ─── Test case setup ──────────────────────────────────────────────────────────

interface TestCase {
  /** workRam bytes to inject. */
  ram: Uint8Array;
  /** a2Addr (absolute). */
  a2Addr: number;
  /** a3Addr (absolute). */
  a3Addr: number;
  /** d2Addr (absolute). */
  d2Addr: number;
}

function applyCase(
  cpu: CpuSession,
  state: ReturnType<typeof stateNs.emptyGameState>,
  tc: TestCase,
): void {
  for (let k = 0; k < WORK_RAM_SIZE; k++) {
    const b = (tc.ram[k] ?? 0) & 0xff;
    pokeMem(cpu, WORK_RAM_BASE + k, 1, b);
    state.workRam[k] = b;
  }
}

/** Read x long from workRam at A2 offset. */
function readX(ram: Uint8Array, a2Off: number): number {
  return (
    (((ram[a2Off] ?? 0) << 24) |
      ((ram[a2Off + 1] ?? 0) << 16) |
      ((ram[a2Off + 2] ?? 0) << 8) |
      (ram[a2Off + 3] ?? 0)) >>> 0
  );
}

function ww(ram: Uint8Array, off: number, v: number): void {
  ram[off] = (v >>> 8) & 0xff;
  ram[off + 1] = v & 0xff;
}
function wl(ram: Uint8Array, off: number, v: number): void {
  const x = v >>> 0;
  ram[off] = (x >>> 24) & 0xff;
  ram[off + 1] = (x >>> 16) & 0xff;
  ram[off + 2] = (x >>> 8) & 0xff;
  ram[off + 3] = x & 0xff;
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface FailInfo {
  suite: string;
  tc: number;
  diffs: number[];
  a2: number;
  a3: number;
  d2: number;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

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

  const state = stateNs.emptyGameState();
  const cpu = await createCpu({ rom, state });
  patchSubs(cpu);

  const rng = makeRng(0x1b5c2);
  const rb = (): number => Math.floor(rng() * 256) & 0xff;
  const rw = (): number => Math.floor(rng() * 0x10000) & 0xffff;
  const rl32 = (): number => Math.floor(rng() * 0x100000000) >>> 0;

  /** Safe workRam address in [0x400100..0x401C00), aligned 4. */
  function safeAddr(): number {
    return WORK_RAM_BASE + 0x100 + (Math.floor(rng() * 0x1b00 / 4) * 4);
  }

  function makeRamBlob(): Uint8Array {
    const r = new Uint8Array(WORK_RAM_SIZE);
    for (let i = 0; i < WORK_RAM_SIZE; i++) r[i] = rb();
    return r;
  }

  let totalOk = 0;
  let firstFail: FailInfo | null = null;

  function runCase(
    suite: string,
    tc: number,
    testCase: TestCase,
  ): boolean {
    applyCase(cpu, state, testCase);
    cpu.system.setRegister("sp", 0x401f00);

    const a2Off = testCase.a2Addr - WORK_RAM_BASE;
    const d3Val = readX(testCase.ram, a2Off);

    // Run binary from body.
    callBody(cpu, testCase.a2Addr, testCase.a3Addr, testCase.d2Addr, d3Val);

    // Run TS.
    sub1B5C2Ns.stateSub1B5C2(
      state,
      testCase.a2Addr,
      testCase.a3Addr,
      testCase.d2Addr,
      { fun_158ac: () => {} },
    );

    const diffs = diffWorkRam(cpu, state);
    if (diffs.length === 0) return true;
    if (firstFail === null) {
      firstFail = {
        suite,
        tc,
        diffs,
        a2: testCase.a2Addr,
        a3: testCase.a3Addr,
        d2: testCase.d2Addr,
      };
    }
    return false;
  }

  // ─── Suite A: full random ────────────────────────────────────────────────
  console.log(`\n=== stateSub1B5C2 (FUN_0001B5C2) — Suite A: random — ${perSuite} cases ===`);
  let okA = 0;
  for (let i = 0; i < perSuite; i++) {
    const ram = makeRamBlob();
    const a2 = safeAddr();
    const a3 = safeAddr();
    const d2 = safeAddr();
    // Ensure a2, a3, d2 are within workRam bounds including struct fields (+0x10).
    if (okA === 0 && i < 5) {
      // Force some basic setup for early cases.
      ram[a2 - WORK_RAM_BASE] = 0xff;
      ram[a2 - WORK_RAM_BASE + 1] = 0x00;
    }
    if (runCase("A", i, { ram, a2Addr: a2, a3Addr: a3, d2Addr: d2 })) okA++;
  }
  console.log(`  Match: ${okA}/${perSuite} = ${((okA / perSuite) * 100).toFixed(1)}%`);
  totalOk += okA;

  // ─── Suite B: all flags off — no blocks should fire ──────────────────────
  console.log(`\n=== Suite B: all direction flags off — ${perSuite} cases ===`);
  let okB = 0;
  for (let i = 0; i < perSuite; i++) {
    const ram = makeRamBlob();
    const a2 = safeAddr();
    const a3 = safeAddr();
    const d2 = safeAddr();
    // Turn off all direction flags + bitmap = 0.
    ram[OFFSETS.FLAG_PX] = 0;
    ram[OFFSETS.FLAG_PY] = 0;
    ram[OFFSETS.FLAG_NX] = 0;
    ram[OFFSETS.FLAG_NY] = 0;
    ram[a3 - WORK_RAM_BASE] = 0; // bitmap = 0
    // CHG_X/CHG_Y might be pre-set (random): keep random to exercise sound path.
    if (runCase("B", i, { ram, a2Addr: a2, a3Addr: a3, d2Addr: d2 })) okB++;
  }
  console.log(`  Match: ${okB}/${perSuite} = ${((okB / perSuite) * 100).toFixed(1)}%`);
  totalOk += okB;

  // ─── Suite C: all gates active + all cardinals on + varied bitmap ─────────
  console.log(`\n=== Suite C: gates active + all cardinals on — ${perSuite} cases ===`);
  let okC = 0;
  for (let i = 0; i < perSuite; i++) {
    const ram = makeRamBlob();
    const a2 = safeAddr();
    const a3 = safeAddr();
    const d2 = safeAddr();
    // Activate all gates (value = 5).
    ww(ram, OFFSETS.GATE_PX, 5);
    ww(ram, OFFSETS.GATE_PY, 5);
    ww(ram, OFFSETS.GATE_NX, 5);
    ww(ram, OFFSETS.GATE_NY, 5);
    ww(ram, OFFSETS.GATE_7C, 5);
    ww(ram, OFFSETS.GATE_7E, 5);
    ww(ram, OFFSETS.GATE_80, 5);
    ww(ram, OFFSETS.GATE_82, 5);
    ww(ram, OFFSETS.GATE_A0, 6);  // wa0=6 > 4 for blk2a path
    // Cardinal flags: random in [1,2].
    ram[OFFSETS.FLAG_PX] = (Math.floor(rng() * 2) + 1) & 0xff;
    ram[OFFSETS.FLAG_PY] = (Math.floor(rng() * 2) + 1) & 0xff;
    ram[OFFSETS.FLAG_NX] = (Math.floor(rng() * 2) + 1) & 0xff;
    ram[OFFSETS.FLAG_NY] = (Math.floor(rng() * 2) + 1) & 0xff;
    // Bitmap: all bits.
    ram[a3 - WORK_RAM_BASE] = rw() & 0xff;
    // D2 word: alternately < 4, == 4, > 4.
    ww(ram, d2 - WORK_RAM_BASE, [2, 4, 6][Math.floor(rng() * 3)]!);
    // Delta: D5/D6 = {-1, 0, 1, random}.
    const d5opts = [0xffff, 0x0001, 0x0000, rw()];
    const d6opts = [0xffff, 0x0001, 0x0000, rw()];
    ww(ram, OFFSETS.TRACK_X_CUR, d5opts[Math.floor(rng() * 4)]!);
    ww(ram, OFFSETS.TRACK_X_BASE, 0);
    ww(ram, OFFSETS.TRACK_Y_CUR, d6opts[Math.floor(rng() * 4)]!);
    ww(ram, OFFSETS.TRACK_Y_BASE, 0);
    // Struct x/y: various signed values.
    wl(ram, a2 - WORK_RAM_BASE, rl32());
    wl(ram, a2 - WORK_RAM_BASE + 4, rl32());
    if (runCase("C", i, { ram, a2Addr: a2, a3Addr: a3, d2Addr: d2 })) okC++;
  }
  console.log(`  Match: ${okC}/${perSuite} = ${((okC / perSuite) * 100).toFixed(1)}%`);
  totalOk += okC;

  // ─── Suite D: edge cases ─────────────────────────────────────────────────
  const sizeD = perSuite + remainder;
  console.log(`\n=== Suite D: edge cases (INT_MIN, 0x80000000, vel pivot) — ${sizeD} cases ===`);
  let okD = 0;
  const edgeVals = [0x80000000, 0xffff8000, 0xffff0001, 0x00000001, 0x00000000, 0xffffffff];
  for (let i = 0; i < sizeD; i++) {
    const ram = makeRamBlob();
    const a2 = safeAddr();
    const a3 = safeAddr();
    const d2 = safeAddr();
    // Struct: pick edge values.
    wl(ram, a2 - WORK_RAM_BASE, edgeVals[Math.floor(rng() * edgeVals.length)]!);
    wl(ram, a2 - WORK_RAM_BASE + 4, edgeVals[Math.floor(rng() * edgeVals.length)]!);
    // All gates active.
    ww(ram, OFFSETS.GATE_PX, 5);
    ww(ram, OFFSETS.GATE_PY, 5);
    ww(ram, OFFSETS.GATE_NX, 5);
    ww(ram, OFFSETS.GATE_NY, 5);
    ww(ram, OFFSETS.GATE_7C, 5);
    ww(ram, OFFSETS.GATE_7E, 5);
    ww(ram, OFFSETS.GATE_80, 5);
    ww(ram, OFFSETS.GATE_82, 5);
    ww(ram, OFFSETS.GATE_A0, rng() < 0.5 ? 6 : 2); // above/below 4
    // D2 word: alternately in/out of range.
    ww(ram, d2 - WORK_RAM_BASE, rng() < 0.5 ? 2 : 6);
    // Cardinals: random in [0..4].
    for (const off of [OFFSETS.FLAG_PX, OFFSETS.FLAG_PY, OFFSETS.FLAG_NX, OFFSETS.FLAG_NY]) {
      ram[off] = Math.floor(rng() * 5) & 0xff;
    }
    // Bitmap: all bits possible.
    ram[a3 - WORK_RAM_BASE] = rb();
    // Delta: edge values for D5/D6.
    const d5 = [0xffff, 0x0001, 0x0000][Math.floor(rng() * 3)]!;
    const d6 = [0xffff, 0x0001, 0x0000][Math.floor(rng() * 3)]!;
    ww(ram, OFFSETS.TRACK_X_CUR, d5);
    ww(ram, OFFSETS.TRACK_X_BASE, 0);
    ww(ram, OFFSETS.TRACK_Y_CUR, d6);
    ww(ram, OFFSETS.TRACK_Y_BASE, 0);
    // CHG_X/CHG_Y: sometimes pre-set.
    if (rng() < 0.3) ram[OFFSETS.CHG_X] = 1;
    if (rng() < 0.3) ram[OFFSETS.CHG_Y] = 1;
    if (runCase("D", i, { ram, a2Addr: a2, a3Addr: a3, d2Addr: d2 })) okD++;
  }
  console.log(`  Match: ${okD}/${sizeD} = ${((okD / sizeD) * 100).toFixed(1)}%`);
  totalOk += okD;

  console.log(`\n=== TOTAL: ${totalOk}/${total} = ${((totalOk / total) * 100).toFixed(1)}% ===`);
  if (firstFail !== null) {
    const f = firstFail as FailInfo;
    console.log(`  First fail (suite ${f.suite} tc=${f.tc}):`);
    console.log(`    a2=0x${f.a2.toString(16)} a3=0x${f.a3.toString(16)} d2=0x${f.d2.toString(16)}`);
    console.log(`    diff @ workRam offsets: ${f.diffs.map((d: number) => `0x${d.toString(16)}`).join(", ")}`);
  }

  disposeCpu(cpu);
  exit(totalOk === total ? 0 : 1);
}

main().catch(e => {
  console.error(e);
  exit(1);
});
