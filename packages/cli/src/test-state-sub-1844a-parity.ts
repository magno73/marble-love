#!/usr/bin/env node
/**
 * test-state-sub-1844a-parity.ts — differential FUN_0001844A vs
 * `stateSub1844A`.
 *
 * FUN_0001844A (610 byte): "Slot-table tick — timer decrement, insert-sorted
 * trigger, pointer-walk advance, sprite-coord update, 3-bucket sound dispatch".
 * Gated da `*0x400394 == 3` e `*0x400760 != 0`. Itera 36 entry × 16 byte
 * @ 0x401650.
 *
 * **Strategia parity**:
 *   - `FUN_00013A98` (RNG) **lasciato live**.
 *   - `FUN_00018E6C` (slotInsertSorted) **patched to RTS**: side effects on
 *     correct call triggering and writes to entry[0x8] and entry[0x2].
 *   - `FUN_00018F46` (timer-reset callback) **patchato RTS**.
 *   - `FUN_00018972` (computeSpriteCoords_v4) **patchato RTS**.
 *   - `FUN_0001584C` (soundCommand via A3=0x158AC) **patched with capture**:
 *
 * **Snapshot comparato**:
 *   - `workRam[0x1650..0x188F]` (slot-table 576 byte — timer, ptr-walk ptr)
 *   - `workRam[0x4003A6]` (RNG seed u16)
 *   - sound capture @ 0x401FFE
 *
 * **Suite** (4 × 125 = 500):
 *   - B: forced early-out (gameMode != 3 o byte760 == 0)
 *   - D: forced ptr-walk path (timer == -1 entries)
 *
 * Uso: npx tsx packages/cli/src/test-state-sub-1844a-parity.ts [N]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import {
  state as stateNs,
  bus as busNs,
  stateSub1844A as sub1844ANs,
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

const FUN_1844A  = 0x0001844a;
const FUN_18E6C  = 0x00018e6c;
const FUN_18F46  = 0x00018f46;
const FUN_18972  = 0x00018972;
const FUN_158AC  = 0x0001584c; // actual soundCommand entry, A3 = 0x158ac
const RNG_SEED_ADDR   = 0x004003a6;
const WORK_RAM_BASE   = 0x00400000;
const GAME_MODE_ADDR  = 0x00400394;
const GATE760_ADDR    = 0x00400760;
const SELECTOR_ADDR   = 0x00400764;
const SLOT_TABLE_ADDR = 0x00401650;
const SLOT_TABLE_BYTES = 0x24 * 0x10; // 576
const CAPTURE_ADDR    = 0x00401ffe;
const SENTINEL_NOT_CALLED = 0xaa;

// ─── Patch subs ─────────────────────────────────────────────────────────────

/**
 * Patch 3 JSR targets with RTS, and FUN_158AC with capture thunk:
 *   move.b (7,SP), D0   ; 10 2F 00 07  — load LSB of long arg (push via pea)
 *   move.b D0, $401FFE  ; 13 C0 00 40 1F FE
 *   rts                 ; 4E 75
 */
function patchSubs(rom: Uint8Array): void {
  // RTS stubs
  for (const addr of [FUN_18E6C, FUN_18F46, FUN_18972]) {
    rom[addr + 0] = 0x4e;
    rom[addr + 1] = 0x75;
  }
  // soundCommand capture thunk @ FUN_158AC (address used as A3 = 0x158ac)
  // The binary does `pea (A0); jsr (A3)` so arg is long at (4,SP) after jsr.
  // We want the function pointer arg (4-byte long pushed by caller).
  // We just capture the low byte of the pointer (SP+7).
  rom[FUN_158AC + 0x0] = 0x10; rom[FUN_158AC + 0x1] = 0x2f;
  rom[FUN_158AC + 0x2] = 0x00; rom[FUN_158AC + 0x3] = 0x07;
  rom[FUN_158AC + 0x4] = 0x13; rom[FUN_158AC + 0x5] = 0xc0;
  rom[FUN_158AC + 0x6] = 0x00; rom[FUN_158AC + 0x7] = 0x40;
  rom[FUN_158AC + 0x8] = 0x1f; rom[FUN_158AC + 0x9] = 0xfe;
  rom[FUN_158AC + 0xa] = 0x4e; rom[FUN_158AC + 0xb] = 0x75;
}

// ─── Snapshot ────────────────────────────────────────────────────────────────

interface Snapshot {
  slotTable: number[]; // 576 byte
  rngSeed: number;     // u16
  capture: number;     // byte @ 0x401FFE
}

function snapshotBinary(cpu: CpuSession): Snapshot {
  const slotTable: number[] = [];
  for (let i = 0; i < SLOT_TABLE_BYTES; i++) {
    slotTable.push(peekMem(cpu, SLOT_TABLE_ADDR + i, 1) & 0xff);
  }
  return {
    slotTable,
    rngSeed: peekMem(cpu, RNG_SEED_ADDR, 2) & 0xffff,
    capture: peekMem(cpu, CAPTURE_ADDR, 1) & 0xff,
  };
}

function snapshotTs(
  state: ReturnType<typeof stateNs.emptyGameState>,
  tsCapture: number,
): Snapshot {
  const wr = state.workRam;
  const tableOff = SLOT_TABLE_ADDR - WORK_RAM_BASE;
  const slotTable: number[] = [];
  for (let i = 0; i < SLOT_TABLE_BYTES; i++) {
    slotTable.push(wr[tableOff + i] ?? 0);
  }
  return {
    slotTable,
    rngSeed: (state.rng.seed as unknown as number) & 0xffff,
    capture: tsCapture & 0xff,
  };
}

// ─── Case definition ─────────────────────────────────────────────────────────

interface CaseInput {
  gameMode: number;    // u16 @ 0x400394
  byte760: number;     // u8  @ 0x400760
  selectorPtr: number; // u32 @ 0x400764
  slotTable: number[]; // 576 byte pre-fill
  rngSeed: number;     // u16
}

interface FailRecord {
  suite: string;
  tc: number;
  reason: string;
  inputDigest: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) >>> 0;
    return ((s >>> 16) & 0xffff) / 0x10000;
  };
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
  const romBytes = readFileSync(romPath);
  const romPatched = Uint8Array.from(romBytes);
  patchSubs(romPatched);

  const romImage: RomImage = busNs.emptyRomImage();
  romImage.program.set(romBytes.subarray(0, romImage.program.length));

  const stateInst = stateNs.emptyGameState();
  const cpu = await createCpu({ rom: romPatched, state: stateInst });

  let totalOk = 0;
  const failHolder: { value: FailRecord | null } = { value: null };

  const rng = makeRng(0x1844a);
  const rb = (): number => Math.floor(rng() * 256) & 0xff;
  const rw = (): number => Math.floor(rng() * 0x10000) & 0xffff;
  const rl = (): number => (rng() * 0x100000000) >>> 0;

  function makeSlotTable(timerMode: "random" | "countdown" | "walk" | "mixed"): number[] {
    const t = new Array(SLOT_TABLE_BYTES).fill(0).map(() => rb());
    for (let i = 0; i < 0x24; i++) {
      const e = i * 0x10;
      if (timerMode === "random") {
        // keep random
      } else if (timerMode === "countdown") {
        // positive timer (>= 0 signed): ensure bit15 = 0
        t[e + 2] = rb() & 0x7f;
        t[e + 3] = rb();
        // Avoid 0xFFFF sentinel accidentally
        if (t[e + 2] === 0 && t[e + 3] === 0) t[e + 3] = 1;
      } else if (timerMode === "walk") {
        // timer == -1 (0xFFFF)
        t[e + 2] = 0xff;
        t[e + 3] = 0xff;
        // Set entry[0x8..0xB] to a ROM-area pointer (0x21342 + k*4 range)
        // that won't be sentinel (ROM at those addrs is not 0xFFFFFFFF).
        const ptrVal = 0x00021342 + i * 0x40;
        t[e + 8]  = (ptrVal >>> 24) & 0xff;
        t[e + 9]  = (ptrVal >>> 16) & 0xff;
        t[e + 10] = (ptrVal >>> 8) & 0xff;
        t[e + 11] = ptrVal & 0xff;
      } else {
        // mixed: alternate
        if ((i & 1) === 0) {
          t[e + 2] = rb() & 0x7f;
          t[e + 3] = rb();
          if (t[e + 2] === 0 && t[e + 3] === 0) t[e + 3] = 2;
        } else {
          t[e + 2] = 0xff;
          t[e + 3] = 0xff;
          const ptrVal = 0x00021342 + i * 0x40;
          t[e + 8]  = (ptrVal >>> 24) & 0xff;
          t[e + 9]  = (ptrVal >>> 16) & 0xff;
          t[e + 10] = (ptrVal >>> 8) & 0xff;
          t[e + 11] = ptrVal & 0xff;
        }
      }
    }
    return t;
  }

  function setupCase(inp: CaseInput): void {
    // ── BINARY setup ──
    const wr = stateInst.workRam;

    // clear slot table area in both binary and TS
    for (let i = 0; i < SLOT_TABLE_BYTES; i++) {
      pokeMem(cpu, SLOT_TABLE_ADDR + i, 1, inp.slotTable[i] ?? 0);
    }
    pokeMem(cpu, GAME_MODE_ADDR, 2, inp.gameMode & 0xffff);
    pokeMem(cpu, GATE760_ADDR, 1, inp.byte760 & 0xff);
    pokeMem(cpu, SELECTOR_ADDR, 4, inp.selectorPtr >>> 0);
    pokeMem(cpu, RNG_SEED_ADDR, 2, inp.rngSeed & 0xffff);
    pokeMem(cpu, CAPTURE_ADDR, 1, SENTINEL_NOT_CALLED);
    cpu.system.setRegister("sp", 0x401f00);

    // ── TS setup ──
    const tableOff = SLOT_TABLE_ADDR - WORK_RAM_BASE;
    for (let i = 0; i < SLOT_TABLE_BYTES; i++) {
      wr[tableOff + i] = (inp.slotTable[i] ?? 0) & 0xff;
    }
    wr[GAME_MODE_ADDR - WORK_RAM_BASE]     = (inp.gameMode >>> 8) & 0xff;
    wr[GAME_MODE_ADDR - WORK_RAM_BASE + 1] = inp.gameMode & 0xff;
    wr[GATE760_ADDR - WORK_RAM_BASE]       = inp.byte760 & 0xff;
    const ptrOff = SELECTOR_ADDR - WORK_RAM_BASE;
    wr[ptrOff]     = (inp.selectorPtr >>> 24) & 0xff;
    wr[ptrOff + 1] = (inp.selectorPtr >>> 16) & 0xff;
    wr[ptrOff + 2] = (inp.selectorPtr >>> 8)  & 0xff;
    wr[ptrOff + 3] = inp.selectorPtr & 0xff;
    stateInst.rng.seed = wrap.as_u32(inp.rngSeed & 0xffff);
    stateInst.rng.callsThisFrame = wrap.as_u32(0);
  }

  function runOneCase(suite: string, tc: number, inp: CaseInput): boolean {
    setupCase(inp);

    callFunction(cpu, FUN_1844A, []);
    const binSnap = snapshotBinary(cpu);

    let tsCapture = SENTINEL_NOT_CALLED;
    sub1844ANs.stateSub1844A(stateInst, romImage, {
      fun_18e6c: () => {},
      fun_18f46: () => {},
      fun_18972: () => {},
      soundCommand: (ptrArg: number) => {
        // Mirror binary capture: low byte of ptrArg (matches SP+7 = low byte)
        tsCapture = ptrArg & 0xff;
      },
    });
    const tsSnap = snapshotTs(stateInst, tsCapture);

    let reason = "";
    if (binSnap.rngSeed !== tsSnap.rngSeed) {
      reason = `rngSeed bin=0x${binSnap.rngSeed.toString(16)} ts=0x${tsSnap.rngSeed.toString(16)}`;
    } else if (binSnap.capture !== tsSnap.capture) {
      reason = `capture bin=0x${binSnap.capture.toString(16)} ts=0x${tsSnap.capture.toString(16)}`;
    } else {
      for (let i = 0; i < SLOT_TABLE_BYTES; i++) {
        if (binSnap.slotTable[i] !== tsSnap.slotTable[i]) {
          const entryIdx = Math.floor(i / 0x10);
          const fieldOff = i % 0x10;
          reason =
            `slot[${entryIdx}].off[0x${fieldOff.toString(16)}] ` +
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
        inputDigest: `gm=0x${inp.gameMode.toString(16)} b760=0x${inp.byte760.toString(16)} seed=0x${inp.rngSeed.toString(16)}`,
      };
    }
    return false;
  }

  // ─── Suite A: random ─────────────────────────────────────────────────────
  console.log(`\n=== stateSub1844A (FUN_0001844A) — Suite A: random — ${perSuite} casi ===`);
  let okA = 0;
  for (let i = 0; i < perSuite; i++) {
    const inp: CaseInput = {
      gameMode: (Math.random() < 0.5) ? 3 : (rw() & 0xffff),
      byte760: rb(),
      selectorPtr: 0x00024000 + Math.floor(rng() * 0x100) * 4,
      slotTable: makeSlotTable("random"),
      rngSeed: rw(),
    };
    if (runOneCase("A", i, inp)) okA++;
  }
  console.log(`  Match: ${okA}/${perSuite} = ${((okA / perSuite) * 100).toFixed(1)}%`);
  totalOk += okA;

  // ─── Suite B: forced early-out ────────────────────────────────────────────
  console.log(`\n=== Suite B: forced early-out — ${perSuite} casi ===`);
  let okB = 0;
  for (let i = 0; i < perSuite; i++) {
    const useMode = (i & 1) === 0;
    const inp: CaseInput = {
      gameMode: useMode ? (rw() === 3 ? 0 : rw()) : 3,
      byte760: useMode ? (rb() & 0xff) : 0,
      selectorPtr: rl(),
      slotTable: makeSlotTable("random"),
      rngSeed: rw(),
    };
    // Ensure gate fails
    if (inp.gameMode === 3 && inp.byte760 !== 0) inp.gameMode = 0;
    if (runOneCase("B", i, inp)) okB++;
  }
  console.log(`  Match: ${okB}/${perSuite} = ${((okB / perSuite) * 100).toFixed(1)}%`);
  totalOk += okB;

  // ─── Suite C: timer countdown path ────────────────────────────────────────
  console.log(`\n=== Suite C: timer countdown path — ${perSuite} casi ===`);
  let okC = 0;
  for (let i = 0; i < perSuite; i++) {
    const inp: CaseInput = {
      gameMode: 3,
      byte760: 0xff,
      selectorPtr: 0x00024000 + Math.floor(rng() * 0x100) * 2,
      slotTable: makeSlotTable("countdown"),
      rngSeed: rw(),
    };
    if (runOneCase("C", i, inp)) okC++;
  }
  console.log(`  Match: ${okC}/${perSuite} = ${((okC / perSuite) * 100).toFixed(1)}%`);
  totalOk += okC;

  // ─── Suite D: ptr-walk path ───────────────────────────────────────────────
  const sizeD = perSuite + remainder;
  console.log(`\n=== Suite D: ptr-walk path (timer == -1) — ${sizeD} casi ===`);
  let okD = 0;
  for (let i = 0; i < sizeD; i++) {
    const mode = i % 3;
    const inp: CaseInput = {
      gameMode: 3,
      byte760: 0xff,
      selectorPtr: 0x00024000 + Math.floor(rng() * 0x100) * 2,
      slotTable: mode === 0 ? makeSlotTable("walk")
               : mode === 1 ? makeSlotTable("mixed")
               : makeSlotTable("countdown"),
      rngSeed: rw(),
    };
    if (runOneCase("D", i, inp)) okD++;
  }
  console.log(`  Match: ${okD}/${sizeD} = ${((okD / sizeD) * 100).toFixed(1)}%`);
  totalOk += okD;

  // ─── Summary ─────────────────────────────────────────────────────────────
  console.log(
    `\n=== TOTALE: ${totalOk}/${total} = ${((totalOk / total) * 100).toFixed(1)}% ===`,
  );
  if (failHolder.value !== null) {
    const f = failHolder.value;
    console.log(`  First fail (suite ${f.suite} tc=${f.tc}): ${f.reason}`);
    console.log(`    input: ${f.inputDigest}`);
  }

  void rl;
  disposeCpu(cpu);
  exit(totalOk === total ? 0 : 1);
}

main().catch(e => {
  console.error(e);
  exit(1);
});
