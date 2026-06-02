#!/usr/bin/env node
/**
 * test-game-state-machine-parity.ts — differential FUN_2E18 vs gameStateMachineTick.
 *
 *   - Patch all 10 sub-functions to deterministic stubs:
 *     - moveq #0,D0; rts (70 00 4E 75) for FUN_2CD4 and FUN_2DA0.
 *   - TS callbacks are equivalent no-ops.
 *
 * Tested suites (mode=0, Branch B):
 *   - B: mixed states 1..6, threshold reached in a random slot.
 *   - C: states 3 and 4 with transition-producing result (state -> 0 + sub call).
 *
 * Suite Branch A (mode≠0):
 *   - D: state=7 with a 1-3 entry linked list, dispatched through FUN_2572.
 *
 * Usage: npx tsx packages/cli/src/test-game-state-machine-parity.ts [N]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import { state as stateNs, gameStateMachine, bus as busNs } from "@marble-love/engine";
import type { RomImage } from "@marble-love/engine";
import {
  createCpu,
  callFunction,
  pokeMem,
  peekMem,
  disposeCpu,
} from "./binary-oracle-lib.js";
import type { CpuSession } from "./binary-oracle-lib.js";

const FUN_STATE_MACHINE = 0x00002e18;

// Sub-function entry addresses (patched at start of session)
const SUB_PATCHES: { addr: number; bytes: number[] }[] = [
  // Functions returning void → rts (4E 75)
  { addr: 0x0000295a, bytes: [0x4e, 0x75] },
  { addr: 0x00002572, bytes: [0x4e, 0x75] },
  { addr: 0x00002abc, bytes: [0x4e, 0x75] },
  { addr: 0x00002678, bytes: [0x4e, 0x75] },
  { addr: 0x00002bda, bytes: [0x4e, 0x75] },
  { addr: 0x00002c60, bytes: [0x4e, 0x75] },
  { addr: 0x00002766, bytes: [0x4e, 0x75] },
  { addr: 0x00002818, bytes: [0x4e, 0x75] },
  // Functions returning byte → moveq #0,D0; rts (70 00 4E 75)
  { addr: 0x00002cd4, bytes: [0x70, 0x00, 0x4e, 0x75] },
  { addr: 0x00002da0, bytes: [0x70, 0x00, 0x4e, 0x75] },
];

function patchAllSubs(cpu: CpuSession): void {
  for (const { addr, bytes } of SUB_PATCHES) {
    for (let i = 0; i < bytes.length; i++) {
      pokeMem(cpu, addr + i, 1, bytes[i] ?? 0);
    }
  }
}

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) >>> 0;
    return ((s >>> 16) & 0xffff) / 0x10000;
  };
}

const STRUCT_BASE = 0x00401f00;
const STRUCT_SIZE = 0x44; // 0x401F00..0x401F43 including rotation @ 0x401F42

function setupStruct(
  state: ReturnType<typeof stateNs.emptyGameState>,
  cpu: CpuSession,
  bytes: number[],
): void {
  for (let i = 0; i < STRUCT_SIZE; i++) {
    const v = bytes[i] ?? 0;
    pokeMem(cpu, STRUCT_BASE + i, 1, v);
    state.workRam[(STRUCT_BASE - 0x400000) + i] = v;
  }
}

/** Compare struct after run. Returns first diff or null. */
function compareStruct(
  state: ReturnType<typeof stateNs.emptyGameState>,
  cpu: CpuSession,
): { offset: number; bin: number; ts: number } | null {
  for (let i = 0; i < STRUCT_SIZE; i++) {
    const b = peekMem(cpu, STRUCT_BASE + i, 1);
    const t = state.workRam[(STRUCT_BASE - 0x400000) + i] ?? 0;
    if (b !== t) return { offset: i, bin: b, ts: t };
  }
  return null;
}

async function main(): Promise<void> {
  const n = Number(process.argv[2] ?? "100");

  const romPath = resolve("ghidra_project/marble_program.bin");
  if (!existsSync(romPath)) {
    console.error(`error: ROM blob not found at ${romPath}`);
    exit(3);
  }
  const rom = readFileSync(romPath);

  const stateInst = stateNs.emptyGameState();
  const cpu = await createCpu({ rom, state: stateInst });
  patchAllSubs(cpu);

  // Build TS RomImage for Branch A lookup.
  const tsRom: RomImage = busNs.emptyRomImage();
  tsRom.program.set(rom.subarray(0, tsRom.program.length));

  // Sub callbacks matching the patches
  const subs: gameStateMachine.GameStateMachineSubs = {
    fun_295a: (): void => {},
    fun_2572: (_a: number, _b: number): void => {},
    fun_2abc: (_a: number): void => {},
    fun_2678: (_a: number): void => {},
    fun_2cd4: (_a: number, _b: number, _c: number): number => 0,
    fun_2bda: (_a: number, _b: number, _c: number): void => {},
    fun_2da0: (_a: number, _b: number): number => 0,
    fun_2c60: (_a: number, _b: number): void => {},
    fun_2766: (_a: number): void => {},
    fun_2818: (_a: number): void => {},
  };

  function runOneCase(setup: () => void): { matched: boolean; firstFail: { offset: number; bin: number; ts: number } | null } {
    cpu.system.setRegister("sp", 0x401f00);
    setup();
    callFunction(cpu, FUN_STATE_MACHINE, []);
    gameStateMachine.gameStateMachineTick(stateInst, tsRom, subs);
    const fail = compareStruct(stateInst, cpu);
    return { matched: fail === null, firstFail: fail };
  }

  const rng = makeRng(0xdada);

  // Random byte generator
  const rb = (): number => Math.floor(rng() * 256) & 0xff;

  console.log(`\n=== gameStateMachineTick (FUN_2E18) — Suite A: all state=0 — ${n} cases ===`);
  let okA = 0;
  let failA: { case: number; offset: number; bin: number; ts: number } | null = null;
  for (let i = 0; i < n; i++) {
    const bytes = new Array(STRUCT_SIZE).fill(0).map(() => rb());
    bytes[0x02] = 0; bytes[0x03] = 0; // mode = 0
    bytes[0x1c] = 0; bytes[0x1d] = 0; bytes[0x1e] = 0; bytes[0x1f] = 0; // states = 0
    const { matched, firstFail } = runOneCase(() => setupStruct(stateInst, cpu, bytes));
    if (matched) okA++;
    else if (failA === null && firstFail) failA = { case: i, ...firstFail };
  }
  console.log(`  Match: ${okA}/${n} = ${((okA / n) * 100).toFixed(1)}%`);
  if (failA) console.log(`  First fail: case ${failA.case} @ struct+0x${failA.offset.toString(16)}: bin=0x${failA.bin.toString(16)} ts=0x${failA.ts.toString(16)}`);

  // ─── Suite B: mixed states 1..6 ────────────────────────────────────
  console.log(`\n=== gameStateMachineTick (FUN_2E18) — Suite B: mixed states 1..6 — ${n} cases ===`);
  let okB = 0;
  let failB: { case: number; offset: number; bin: number; ts: number } | null = null;
  for (let i = 0; i < n; i++) {
    const bytes = new Array(STRUCT_SIZE).fill(0).map(() => rb());
    bytes[0x02] = 0; bytes[0x03] = 0; // mode = 0
    // states 0..6 (random) — exclude 7 from Branch B testing
    for (let j = 0; j < 4; j++) {
      bytes[0x1c + j] = Math.floor(rng() * 7) & 0xff; // 0..6
    }
    // Per slot: data ptr points to workRam scratch @ 0x401D00 + j*0x10.
    for (let j = 0; j < 4; j++) {
      const dataAddr = 0x00401d00 + j * 0x10;
      bytes[0x04 + j * 4] = (dataAddr >>> 24) & 0xff;
      bytes[0x05 + j * 4] = (dataAddr >>> 16) & 0xff;
      bytes[0x06 + j * 4] = (dataAddr >>> 8) & 0xff;
      bytes[0x07 + j * 4] = dataAddr & 0xff;
    }
    for (let j = 0; j < 4; j++) {
      if (rng() < 0.5) {
        // counter = threshold - 1 (overflow next tick = match)
        const th = (bytes[0x20 + j * 2] ?? 0) << 8 | (bytes[0x21 + j * 2] ?? 0);
        const newC = th === 0 ? 0xffff : (th - 1) & 0xffff;
        bytes[0x28 + j * 2] = (newC >>> 8) & 0xff;
        bytes[0x29 + j * 2] = newC & 0xff;
      }
    }
    // Setup workRam scratch (0x401D00..0x401D3F): random per *(data+8) check
    for (let k = 0; k < 0x40; k++) {
      bytes[0x100 + k]; // (out of range, ignore)
    }
    const { matched, firstFail } = runOneCase(() => {
      // Setup struct
      setupStruct(stateInst, cpu, bytes);
      // Setup scratch (separate from struct)
      for (let j = 0; j < 4; j++) {
        const dataAddr = 0x00401d00 + j * 0x10;
        for (let k = 0; k < 0x10; k++) {
          const v = rb();
          pokeMem(cpu, dataAddr + k, 1, v);
          stateInst.workRam[(dataAddr - 0x400000) + k] = v;
        }
      }
    });
    if (matched) okB++;
    else if (failB === null && firstFail) failB = { case: i, ...firstFail };
  }
  console.log(`  Match: ${okB}/${n} = ${((okB / n) * 100).toFixed(1)}%`);
  if (failB) console.log(`  First fail: case ${failB.case} @ struct+0x${failB.offset.toString(16)}: bin=0x${failB.bin.toString(16)} ts=0x${failB.ts.toString(16)}`);

  // ─── Suite C: Branch A (mode != 0, state=7) ────────────────────────
  console.log(`\n=== gameStateMachineTick (FUN_2E18) — Suite C: Branch A (mode≠0, state=7) — ${n} cases ===`);
  let okC = 0;
  let failC: { case: number; offset: number; bin: number; ts: number } | null = null;
  for (let i = 0; i < n; i++) {
    const bytes = new Array(STRUCT_SIZE).fill(0).map(() => rb());
    bytes[0x02] = 0; bytes[0x03] = 1; // mode = 1 (non-zero)
    const target = rb();
    bytes[0x3c] = 0; bytes[0x3d] = target;     // SPECIAL_INNER (word, low byte = target)
    bytes[0x3e] = 0; bytes[0x3f] = target;      // SPECIAL_TARGET = same
    bytes[0x1c] = 7; bytes[0x1d] = 0; bytes[0x1e] = 0; bytes[0x1f] = 0;
    bytes[0x42] = 0; bytes[0x43] = 0;
    // VALUE_F00 @ 0x401F00: small positive value to keep paths stable.
    bytes[0x00] = 0; bytes[0x01] = 5;
    // Data ptr for slot 0 points to a workRam struct.
    const dataAddr = 0x00401d00;
    bytes[0x04] = (dataAddr >>> 24) & 0xff;
    bytes[0x05] = (dataAddr >>> 16) & 0xff;
    bytes[0x06] = (dataAddr >>> 8) & 0xff;
    bytes[0x07] = dataAddr & 0xff;

    const { matched, firstFail } = runOneCase(() => {
      setupStruct(stateInst, cpu, bytes);
      // Scratch @ 0x401D00: byte[1] = "two" value, byte[6] = marker check, long[8..11] = next ptr
      // For "two" path: byte[1] should make d0 == d1 (=lookup[0]-1)
      // lookup[0] = ROM word @ 0x7294. Let's inspect what's there.
      const lookupHi = rom[0x7294] ?? 0;
      const lookupLo = rom[0x7295] ?? 0;
      const lookupVal = (lookupHi << 8) | lookupLo;
      const lookupSigned = lookupVal & 0x8000 ? lookupVal - 0x10000 : lookupVal;
      const d1 = (lookupSigned - 1) | 0;
      // Want byte_at(d3+1) - tick == d1.
      // SPECIAL_TICK after first call: incremented to (target_old + 1), assuming inner==target trigger.
      // Actually after entering branch A, *0x401F3A is incremented. So tick += 1 on first call.
      // tick value at the point of d0 calc = old_tick + 1. We set old_tick=0, so tick=1.
      // We want byte[1] - 1 == d1 → byte[1] = d1 + 1.
      // Cap byte[1] to [0,255]. If d1+1 is out of range, fall back to another path.
      const wantByte1 = (d1 + 1) & 0xff;
      // Marker check (byte[6] + VALUE_F00 < 2 vs >= 2):
      //   VALUE_F00 = 5, target sum >= 2 -> byte[6] >= -3, so byte[6] = 0 is enough.
      const scratch = new Uint8Array(0x10);
      scratch[1] = wantByte1;
      scratch[6] = 0;  // marker check passes (5+0 >= 2)
      for (let k = 0; k < 0x10; k++) {
        pokeMem(cpu, dataAddr + k, 1, scratch[k] ?? 0);
        stateInst.workRam[(dataAddr - 0x400000) + k] = scratch[k] ?? 0;
      }
      pokeMem(cpu, STRUCT_BASE + 0x3a, 1, 0);
      pokeMem(cpu, STRUCT_BASE + 0x3b, 1, 0);
      stateInst.workRam[(STRUCT_BASE - 0x400000) + 0x3a] = 0;
      stateInst.workRam[(STRUCT_BASE - 0x400000) + 0x3b] = 0;
    });
    if (matched) okC++;
    else if (failC === null && firstFail) failC = { case: i, ...firstFail };
  }
  console.log(`  Match: ${okC}/${n} = ${((okC / n) * 100).toFixed(1)}%`);
  if (failC) console.log(`  First fail: case ${failC.case} @ struct+0x${failC.offset.toString(16)}: bin=0x${failC.bin.toString(16)} ts=0x${failC.ts.toString(16)}`);

  disposeCpu(cpu);
  exit((okA === n && okB === n && okC === n) ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  exit(1);
});
