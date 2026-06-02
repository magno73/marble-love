#!/usr/bin/env node
/**
 * test-player-slot-iter-118d2-parity.ts — differential `FUN_118D2` vs
 * `playerSlotIter118D2`.
 *
 * All 6 JSR targets are patched to RTS on the binary side; the TS side
 * uses stub no-ops. We compare workRam (slot fields + globals) and
 * colorRam (all 0x40 observable words) for 500 random cases.
 */

import { readFileSync } from "node:fs";
import { exit } from "node:process";

import {
  bus as busNs,
  playerSlotIter118D2 as fn118D2Ns,
  state as stateNs,
} from "@marble-love/engine";
import { callFunction, createCpu, disposeCpu, peekMem, pokeMem } from "./binary-oracle-lib.js";
import {
  findRomBlobPath,
  makeRng,
  patchRts,
} from "./main-loop-init-parity-lib.js";

const FUN_118D2 = 0x000118d2;
const WORK_RAM_BASE = 0x00400000;
const PAL_RAM_BASE = 0x00b00000;

// All JSR targets inside FUN_118D2 — patched to RTS on both sides.
const PATCHED_JSRS = [
  0x00000142,  // text render (jsr 0x142)
  0x00028e3c,  // format-and-render score (jsr 0x28e3c)
  0x00028db8,  // vblank wait
  0x000158ac,  // sound cmd send
  0x00016ec6,  // level dispatcher
  0x00028608,  // addToObjectAccumAndFlag
] as const;

// workRam byte offsets to compare after each run.
// Covers: slot fields for slots 0 and 1, plus globals.
const SLOT_FIELDS = [0xd8, 0x71, 0x70] as const;
const SLOT0_BASE = 0x18; // SLOT_TABLE_BASE - WORK_RAM_BASE = 0x400018 - 0x400000
const SLOT1_BASE = SLOT0_BASE + 0xe2;

const WORK_COMPARE_OFFSETS: number[] = [
  // Slot 0 fields
  ...SLOT_FIELDS.map((f) => SLOT0_BASE + f),
  // Slot 1 fields
  ...SLOT_FIELDS.map((f) => SLOT1_BASE + f),
  // Globals
  0x394, 0x395, // *0x400394 (level index)
  0x396, 0x397, // *0x400396 (slot count)
];

// colorRam byte offsets to compare (covers all addresses touched by FUN_118D2).
// colorRam offset = absolute - PAL_RAM_BASE = absolute - 0xB00000.
const COLOR_OFFSETS: number[] = [
  0x00, 0x01, // B00000
  0x06, 0x07, // B00006
  0x08, 0x09, // B00008
  0x0e, 0x0f, // B0000E
  0x10, 0x11, // B00010
  0x12, 0x13, // B00012
  0x16, 0x17, // B00016
  0x18, 0x19, // B00018
  0x1a, 0x1b, // B0001A
  0x1e, 0x1f, // B0001E
  0x3a, 0x3b, // B0003A
];

function writeBothByte(
  cpu: Awaited<ReturnType<typeof createCpu>>,
  binState: ReturnType<typeof stateNs.emptyGameState>,
  tsState: ReturnType<typeof stateNs.emptyGameState>,
  addr: number,
  value: number,
): void {
  const v = value & 0xff;
  pokeMem(cpu, addr, 1, v);
  if (addr >= WORK_RAM_BASE && addr < WORK_RAM_BASE + 0x2000) {
    binState.workRam[addr - WORK_RAM_BASE] = v;
    tsState.workRam[addr - WORK_RAM_BASE] = v;
  }
  if (addr >= PAL_RAM_BASE && addr < PAL_RAM_BASE + 0x800) {
    binState.colorRam[addr - PAL_RAM_BASE] = v;
    tsState.colorRam[addr - PAL_RAM_BASE] = v;
  }
}

function writeBothWord(
  cpu: Awaited<ReturnType<typeof createCpu>>,
  binState: ReturnType<typeof stateNs.emptyGameState>,
  tsState: ReturnType<typeof stateNs.emptyGameState>,
  addr: number,
  value: number,
): void {
  writeBothByte(cpu, binState, tsState, addr, value >>> 8);
  writeBothByte(cpu, binState, tsState, addr + 1, value);
}

async function main(): Promise<void> {
  const n = Number(process.argv[2] ?? "500");
  const romBuf = readFileSync(findRomBlobPath());
  const tsRom = busNs.emptyRomImage();
  tsRom.program.set(romBuf.subarray(0, tsRom.program.length));

  const binState = stateNs.emptyGameState();
  const tsState = stateNs.emptyGameState();
  const cpu = await createCpu({ rom: romBuf, state: binState });

  // Patch all JSR targets to RTS.
  for (const addr of PATCHED_JSRS) {
    patchRts(romBuf, addr);
    pokeMem(cpu, addr, 1, 0x4e);
    pokeMem(cpu, addr + 1, 1, 0x75);
  }

  const rng = makeRng(0x118d2);

  let ok = 0;
  let firstFail: { caseNo: number; kind: string; bin: number; ts: number } | null = null;

  for (let i = 0; i < n; i++) {
    // Reset SP
    cpu.system.setRegister("sp", 0x401f00);

    // Zero all workRam and colorRam on both sides
    for (let j = 0; j < 0x2000; j++) {
      writeBothByte(cpu, binState, tsState, WORK_RAM_BASE + j, 0);
    }
    for (let j = 0; j < 0x800; j++) {
      writeBothByte(cpu, binState, tsState, PAL_RAM_BASE + j, 0);
    }

    // Randomise *0x400394 (level index word, 1..8 typical range)
    const levelVal = 1 + Math.floor(rng() * 8);
    writeBothWord(cpu, binState, tsState, WORK_RAM_BASE + 0x394, levelVal);

    // Randomise *0x400396 (slot count, 0, 1, or 2)
    const slotCount = Math.floor(rng() * 3); // 0, 1, or 2
    writeBothWord(cpu, binState, tsState, WORK_RAM_BASE + 0x396, slotCount);

    // Randomise slot states and score fields for up to 2 slots
    for (let si = 0; si < 2; si++) {
      const base = WORK_RAM_BASE + SLOT0_BASE + si * 0xe2;
      // Randomise state byte (0x18 field): 0..4
      const slotStateVal = Math.floor(rng() * 5);
      writeBothByte(cpu, binState, tsState, base + 0x18, slotStateVal);
      // Randomise score field (0x6A word)
      const scoreHigh = Math.floor(rng() * 0x100);
      const scoreLow = Math.floor(rng() * 0x100);
      writeBothByte(cpu, binState, tsState, base + 0x6a, scoreHigh);
      writeBothByte(cpu, binState, tsState, base + 0x6b, scoreLow);
      // Randomise pre-existing values of mutated fields to ensure writes land
      writeBothByte(cpu, binState, tsState, base + 0xd8, Math.floor(rng() * 0x100));
      writeBothByte(cpu, binState, tsState, base + 0x70, Math.floor(rng() * 0x100));
      writeBothByte(cpu, binState, tsState, base + 0x71, Math.floor(rng() * 0x100));
    }

    // Run binary
    callFunction(cpu, FUN_118D2, [], 2_000_000);
    // Run TS (all subs no-op since JSRs are patched to RTS)
    fn118D2Ns.playerSlotIter118D2(tsState, tsRom);

    // Compare workRam
    let match = true;
    for (const off of WORK_COMPARE_OFFSETS) {
      const bin = peekMem(cpu, WORK_RAM_BASE + off, 1);
      const ts = tsState.workRam[off] ?? 0;
      if (bin !== ts) {
        firstFail ??= { caseNo: i, kind: `work@0x${off.toString(16).padStart(4, "0")}`, bin, ts };
        match = false;
        break;
      }
    }

    // Compare colorRam
    if (match) {
      for (const off of COLOR_OFFSETS) {
        const bin = peekMem(cpu, PAL_RAM_BASE + off, 1);
        const ts = tsState.colorRam[off] ?? 0;
        if (bin !== ts) {
          firstFail ??= { caseNo: i, kind: `color@0x${off.toString(16).padStart(4, "0")}`, bin, ts };
          match = false;
          break;
        }
      }
    }

    if (match) ok++;
  }

  console.log(`\n=== playerSlotIter118D2 (FUN_118D2) — ${n} cases ===`);
  console.log(`  Match: ${ok}/${n} = ${((ok / n) * 100).toFixed(1)}%`);
  if (firstFail) console.log(`  First fail: ${JSON.stringify(firstFail)}`);
  disposeCpu(cpu);
  exit(ok === n ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  exit(1);
});
