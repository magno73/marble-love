#!/usr/bin/env node
/**
 * test-game-tick-timers-parity.ts — differential FUN_28A96 vs gameTickTimers.
 *
 * and `FUN_286EE` (HUD updater).
 *
 *     no-op equivalente.
 *
 *   - count word @ 0x400396 (1..6)
 *   - for each obj: random state, flag, type, timer struct (5 bytes)
 *   - global timer @ 0x40039E (5 byte random)
 *   - game state word @ 0x400390 random
 *
 * Uso: npx tsx packages/cli/src/test-game-tick-timers-parity.ts [N]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import { state as stateNs, gameTickTimers } from "@marble-love/engine";
import {
  createCpu,
  callFunction,
  pokeMem,
  peekMem,
  disposeCpu,
} from "./binary-oracle-lib.js";
import type { CpuSession } from "./binary-oracle-lib.js";

const FUN_TICK_TIMERS = 0x00028A96;
const FUN_HUD_UPDATER = 0x000286EE;

const OBJECTS_BASE_ADDR = 0x400018;
const OBJECT_STRIDE = 0xE2;
const COUNT_ADDR = 0x400396;
const GLOBAL_TIMER_ADDR = 0x40039E;
const GAME_STATE_ADDR = 0x400390;

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) >>> 0;
    return ((s >>> 16) & 0xffff) / 0x10000;
  };
}

function patchHudToRts(cpu: CpuSession): void {
  // 0x4E 0x75 = rts opcode in M68k. Patching FUN_286EE entry → immediate return.
  pokeMem(cpu, FUN_HUD_UPDATER, 1, 0x4e);
  pokeMem(cpu, FUN_HUD_UPDATER + 1, 1, 0x75);
}

interface ObjState {
  state: number; // +0x18
  flag: number;  // +0x19
  type: number;  // +0x1A
  // Cascading timer at +0x6A: outer (word), pad (byte), medium (byte), inner (byte)
  timerOuter: number; // word
  timerPad: number;   // byte at +0x6B
  timerMedium: number;
  timerInner: number;
  flag71: number;
}

function setupObj(state: ReturnType<typeof stateNs.emptyGameState>, cpu: CpuSession, idx: number, o: ObjState): void {
  const addr = OBJECTS_BASE_ADDR + idx * OBJECT_STRIDE;
  const off = addr - 0x400000;

  // +0x18 state
  pokeMem(cpu, addr + 0x18, 1, o.state); state.workRam[off + 0x18] = o.state;
  // +0x19 flag
  pokeMem(cpu, addr + 0x19, 1, o.flag); state.workRam[off + 0x19] = o.flag;
  // +0x1A type
  pokeMem(cpu, addr + 0x1A, 1, o.type); state.workRam[off + 0x1A] = o.type;
  // +0x6A timer struct
  pokeMem(cpu, addr + 0x6A, 1, (o.timerOuter >>> 8) & 0xff); state.workRam[off + 0x6A] = (o.timerOuter >>> 8) & 0xff;
  pokeMem(cpu, addr + 0x6B, 1, o.timerOuter & 0xff); state.workRam[off + 0x6B] = o.timerOuter & 0xff;
  pokeMem(cpu, addr + 0x6C, 1, o.timerMedium); state.workRam[off + 0x6C] = o.timerMedium;
  pokeMem(cpu, addr + 0x6D, 1, o.timerPad); state.workRam[off + 0x6D] = o.timerPad;
  pokeMem(cpu, addr + 0x6E, 1, o.timerInner); state.workRam[off + 0x6E] = o.timerInner;
  // +0x71
  pokeMem(cpu, addr + 0x71, 1, o.flag71); state.workRam[off + 0x71] = o.flag71;
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

  patchHudToRts(cpu);

  console.log(`\n=== gameTickTimers (FUN_28A96) — ${n} cases ===`);
  console.log(`  (FUN_286EE @ 0x${FUN_HUD_UPDATER.toString(16)} patched → rts)`);

  const rng = makeRng(0xfee15);
  let ok = 0;
  let firstFail: { case: number; offsetType: string; addr: number; bin: number; ts: number } | null = null;

  for (let i = 0; i < n; i++) {
    cpu.system.setRegister("sp", 0x401f00);

    // Reset workRam areas of interest
    // 1. game state word @ 0x400390
    const gameState = Math.floor(rng() * 0x10000) & 0xffff;
    pokeMem(cpu, GAME_STATE_ADDR, 2, gameState);
    stateInst.workRam[GAME_STATE_ADDR - 0x400000] = (gameState >>> 8) & 0xff;
    stateInst.workRam[GAME_STATE_ADDR - 0x400000 + 1] = gameState & 0xff;

    // 2. count word @ 0x400396 (1..5)
    const count = 1 + Math.floor(rng() * 5);
    pokeMem(cpu, COUNT_ADDR, 2, count);
    stateInst.workRam[COUNT_ADDR - 0x400000] = (count >>> 8) & 0xff;
    stateInst.workRam[COUNT_ADDR - 0x400000 + 1] = count & 0xff;

    // 3. clear all object struct bytes for the count we'll use (avoid bleed)
    for (let j = 0; j < count; j++) {
      const objBase = OBJECTS_BASE_ADDR + j * OBJECT_STRIDE;
      for (let k = 0; k < OBJECT_STRIDE; k++) {
        pokeMem(cpu, objBase + k, 1, 0);
        stateInst.workRam[(objBase - 0x400000) + k] = 0;
      }
    }

    // 4. setup random obj state per index
    for (let j = 0; j < count; j++) {
      const o: ObjState = {
        state: Math.floor(rng() * 4) & 0xff,           // 0..3 (1 triggers re-pass logic)
        flag: rng() < 0.5 ? 0 : Math.floor(rng() * 256) & 0xff, // 50% zero, 50% random
        type: Math.floor(rng() * 10) & 0xff,           // 0..9 (8 = skip, 6 = exclude in re-pass)
        timerOuter: Math.floor(rng() * 0x10000) & 0xffff,
        timerPad: Math.floor(rng() * 256) & 0xff,
        timerMedium: Math.floor(rng() * 256) & 0xff,   // can be 0 → instant cascade
        timerInner: rng() < 0.1 ? 0xFF : Math.floor(rng() * 6) & 0xff, // 10% disabled
        flag71: Math.floor(rng() * 256) & 0xff,
      };
      setupObj(stateInst, cpu, j, o);
    }

    // 5. global timer @ 0x40039E (5 byte random)
    const gOuter = Math.floor(rng() * 0x10000) & 0xffff;
    const gMed = Math.floor(rng() * 256) & 0xff;
    const gPad = Math.floor(rng() * 256) & 0xff;
    const gInner = rng() < 0.1 ? 0xFF : Math.floor(rng() * 6) & 0xff;
    pokeMem(cpu, GLOBAL_TIMER_ADDR, 1, (gOuter >>> 8) & 0xff);
    pokeMem(cpu, GLOBAL_TIMER_ADDR + 1, 1, gOuter & 0xff);
    pokeMem(cpu, GLOBAL_TIMER_ADDR + 2, 1, gMed);
    pokeMem(cpu, GLOBAL_TIMER_ADDR + 3, 1, gPad);
    pokeMem(cpu, GLOBAL_TIMER_ADDR + 4, 1, gInner);
    stateInst.workRam[GLOBAL_TIMER_ADDR - 0x400000] = (gOuter >>> 8) & 0xff;
    stateInst.workRam[GLOBAL_TIMER_ADDR - 0x400000 + 1] = gOuter & 0xff;
    stateInst.workRam[GLOBAL_TIMER_ADDR - 0x400000 + 2] = gMed;
    stateInst.workRam[GLOBAL_TIMER_ADDR - 0x400000 + 3] = gPad;
    stateInst.workRam[GLOBAL_TIMER_ADDR - 0x400000 + 4] = gInner;

    // 6. clear color RAM FX bytes (0xB0001E..0xB0001F and 0xB00016..0xB00017)
    for (const off of [0x16, 0x17, 0x1E, 0x1F]) {
      pokeMem(cpu, 0xB00000 + off, 1, 0);
      stateInst.colorRam[off] = 0;
    }

    // RUN BINARY
    callFunction(cpu, FUN_TICK_TIMERS, []);

    // RUN TS
    gameTickTimers.gameTickTimers(stateInst);

    // COMPARE: workRam regions of interest.
    // - All object structs we set up [OBJECTS_BASE .. OBJECTS_BASE + count*OBJECT_STRIDE]
    // - global timer @ GLOBAL_TIMER_ADDR (5 byte)
    // - game state word @ GAME_STATE_ADDR (2 byte)
    let matched = true;

    for (let j = 0; j < count && matched; j++) {
      const objBase = OBJECTS_BASE_ADDR + j * OBJECT_STRIDE;
      const objBaseOff = objBase - 0x400000;
      const fieldsToCheck: [string, number][] = [
        ["state", 0x18], ["flag", 0x19], ["type", 0x1A],
        ["timerHi", 0x6A], ["timerLo", 0x6B],
        ["timerMed", 0x6C], ["timerPad", 0x6D], ["timerInner", 0x6E],
        ["flag71", 0x71],
      ];
      for (const [name, off] of fieldsToCheck) {
        const b = peekMem(cpu, objBase + off, 1);
        const t = stateInst.workRam[objBaseOff + off] ?? 0;
        if (b !== t) {
          matched = false;
          if (firstFail === null) firstFail = { case: i, offsetType: `obj[${j}].${name}`, addr: objBase + off, bin: b, ts: t };
          break;
        }
      }
    }

    if (matched) {
      for (let k = 0; k < 5 && matched; k++) {
        const b = peekMem(cpu, GLOBAL_TIMER_ADDR + k, 1);
        const t = stateInst.workRam[GLOBAL_TIMER_ADDR - 0x400000 + k] ?? 0;
        if (b !== t) {
          matched = false;
          if (firstFail === null) firstFail = { case: i, offsetType: `globalTimer+${k}`, addr: GLOBAL_TIMER_ADDR + k, bin: b, ts: t };
        }
      }
    }

    if (matched) {
      for (let k = 0; k < 2 && matched; k++) {
        const b = peekMem(cpu, GAME_STATE_ADDR + k, 1);
        const t = stateInst.workRam[GAME_STATE_ADDR - 0x400000 + k] ?? 0;
        if (b !== t) {
          matched = false;
          if (firstFail === null) firstFail = { case: i, offsetType: `gameState+${k}`, addr: GAME_STATE_ADDR + k, bin: b, ts: t };
        }
      }
    }

    if (matched) {
      // colorRam FX bytes
      for (const off of [0x16, 0x17, 0x1E, 0x1F]) {
        const b = peekMem(cpu, 0xB00000 + off, 1);
        const t = stateInst.colorRam[off] ?? 0;
        if (b !== t) {
          matched = false;
          if (firstFail === null) firstFail = { case: i, offsetType: `colorRam+${off.toString(16)}`, addr: 0xB00000 + off, bin: b, ts: t };
          break;
        }
      }
    }

    if (matched) ok++;
  }

  console.log(`  Match: ${ok}/${n} = ${((ok / n) * 100).toFixed(1)}%`);
  if (firstFail) {
    const { case: c, offsetType, addr, bin, ts } = firstFail;
    console.log(`  First fail: case ${c}, ${offsetType} @ 0x${addr.toString(16)}: bin=0x${bin.toString(16)} ts=0x${ts.toString(16)}`);
  }

  disposeCpu(cpu);
  exit(ok === n ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  exit(1);
});
