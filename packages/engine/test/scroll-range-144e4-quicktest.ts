#!/usr/bin/env node
/**
 * Quick standalone test for scroll-range-144e4.ts without vitest.
 * Run: npx tsx packages/engine/test/scroll-range-144e4-quicktest.ts
 */

import { scrollRange144E4 } from "../src/scroll-range-144e4.js";
import { emptyGameState } from "../src/state.js";
import { emptyRomImage } from "../src/bus.js";
import type { GameState } from "../src/state.js";
import type { RomImage } from "../src/bus.js";

const WRAM = 0x400000;
let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string): void {
  if (condition) {
    passed++;
    console.log(`  PASS: ${msg}`);
  } else {
    failed++;
    console.error(`  FAIL: ${msg}`);
  }
}

function writeU16(state: GameState, addr: number, v: number): void {
  state.workRam[addr - WRAM] = (v >>> 8) & 0xff;
  state.workRam[addr - WRAM + 1] = v & 0xff;
}

function writeU32(state: GameState, addr: number, v: number): void {
  state.workRam[addr - WRAM] = (v >>> 24) & 0xff;
  state.workRam[addr - WRAM + 1] = (v >>> 16) & 0xff;
  state.workRam[addr - WRAM + 2] = (v >>> 8) & 0xff;
  state.workRam[addr - WRAM + 3] = v & 0xff;
}

function setMode(state: GameState, mode: number): void {
  writeU16(state, 0x400394, mode);
}

function setStatePtrInRam(state: GameState, boundary: number): void {
  const ptrValue = 0x401000;
  writeU32(state, 0x400474, ptrValue);
  writeU16(state, ptrValue + 0x10, boundary & 0xffff);
}

/** Add sentinel so scriptRectDispatch12DFA exits immediately (avoids infinite loop with empty ROM). */
function addRomSentinel(rom: RomImage): void {
  rom.program[0] = 0xff;
}

// Test 1: Early exit when d3 == d2
{
  const s = emptyGameState();
  const rom = emptyRomImage();
  // No sentinel needed — early exit before dispatch
  setMode(s, 3);
  setStatePtrInRam(s, 0);
  let called = false;
  scrollRange144E4(s, rom, 0x0010, 0x0010, { fun_15a12: () => { called = true; } });
  assert(!called, "T1: early exit when from == to (same scaled)");
}

// Test 2: Scaling math
{
  const s = emptyGameState();
  const rom = emptyRomImage();
  addRomSentinel(rom);
  setMode(s, 0);
  setStatePtrInRam(s, 0); // boundary = 0

  // from = 0x0020 = 32, d3 = 32>>4 = 2
  // to = 0x0000 = 0, d2 = 0>>4 = 0
  // d3 != d2 → dispatch
  const args: number[] = [];
  scrollRange144E4(s, rom, 0x0020, 0x0000, {
    fun_15a12: (_st, d3, d2) => { args.push(d3, d2); },
  });
  assert(args[0] === 2 && args[1] === 0, `T2: scaling d3=2, d2=0, got ${args[0]}, ${args[1]}`);
}

// Test 3: Boundary from state
{
  const s = emptyGameState();
  const rom = emptyRomImage();
  addRomSentinel(rom);
  setMode(s, 0);
  setStatePtrInRam(s, 0x10); // boundary = 16

  // from = 0x20, to = 0x00
  // d3 = (32-16)>>4 = 1, d2 = (0-16)>>4 = -1 → 0xFF
  const args: number[] = [];
  scrollRange144E4(s, rom, 0x0020, 0x0000, {
    fun_15a12: (_st, d3, d2) => { args.push(d3, d2); },
  });
  assert(args[0] === 1 && args[1] === 0xff, `T3: boundary subtract d3=1, d2=0xff, got ${args[0]}, ${args[1]}`);
}

// Test 4: Mode 3, d3 < 0x29 && d2 >= 0x29 → bannerHelper(9) called
{
  const s = emptyGameState();
  const rom = emptyRomImage();
  addRomSentinel(rom);
  setMode(s, 3);
  setStatePtrInRam(s, 0);
  writeU32(s, 0x400408, 0x0040040c); // set valid palette queue ptr
  scrollRange144E4(s, rom, 0x0280, 0x0290);
  // paletteQueuePush writes at 0x40040c, increments ptr to 0x40040d
  const ptr408 = (
    ((s.workRam[0x408] ?? 0) << 24) |
    ((s.workRam[0x409] ?? 0) << 16) |
    ((s.workRam[0x40a] ?? 0) << 8) |
    (s.workRam[0x40b] ?? 0)
  ) >>> 0;
  assert(ptr408 === 0x0040040d, `T4: mode 3 d3<0x29 d2>=0x29 → banner(9) called, ptr=0x${ptr408.toString(16)}`);
}

// Test 5: Mode 3, d3 >= 0x29 && d2 < 0x29 → banner(8)
{
  const s = emptyGameState();
  const rom = emptyRomImage();
  addRomSentinel(rom);
  setMode(s, 3);
  setStatePtrInRam(s, 0);
  writeU32(s, 0x400408, 0x0040040c);
  // d3 = 0x29, d2 = 0x28 → banner(8)
  scrollRange144E4(s, rom, 0x0290, 0x0280);
  const ptr408 = (
    ((s.workRam[0x408] ?? 0) << 24) |
    ((s.workRam[0x409] ?? 0) << 16) |
    ((s.workRam[0x40a] ?? 0) << 8) |
    (s.workRam[0x40b] ?? 0)
  ) >>> 0;
  assert(ptr408 === 0x0040040d, `T5: mode 3 d3>=0x29 d2<0x29 → banner(8) called, ptr=0x${ptr408.toString(16)}`);
}

// Test 6: Mode 3, both < 0x29 → no banner
{
  const s = emptyGameState();
  const rom = emptyRomImage();
  addRomSentinel(rom);
  setMode(s, 3);
  setStatePtrInRam(s, 0);
  writeU32(s, 0x400408, 0x0040040c);
  // d3 = 0x10, d2 = 0x20 → both < 0x29
  scrollRange144E4(s, rom, 0x0100, 0x0200);
  const ptr408 = (
    ((s.workRam[0x408] ?? 0) << 24) |
    ((s.workRam[0x409] ?? 0) << 16) |
    ((s.workRam[0x40a] ?? 0) << 8) |
    (s.workRam[0x40b] ?? 0)
  ) >>> 0;
  // paletteQueuePush NOT called → ptr stays at 0x40040c
  assert(ptr408 === 0x0040040c, `T6: mode 3 both<0x29 → no banner, ptr=0x${ptr408.toString(16)}`);
}

// Test 7: Mode 4, d3 NOT in [1D..38] AND d2 in [1D..38] → fun_18ffa
{
  const s = emptyGameState();
  const rom = emptyRomImage();
  addRomSentinel(rom);
  setMode(s, 4);
  setStatePtrInRam(s, 0);
  // d3 = 0x10, d2 = 0x20
  let called18ffa = false;
  scrollRange144E4(s, rom, 0x0100, 0x0200, { fun_18ffa: () => { called18ffa = true; } });
  assert(called18ffa, "T7: mode 4 fun_18ffa called");
}

// Test 8: Mode 4, d3 in [1D..38] AND d2 NOT → fun_190ee
{
  const s = emptyGameState();
  const rom = emptyRomImage();
  addRomSentinel(rom);
  setMode(s, 4);
  setStatePtrInRam(s, 0);
  // d3 = 0x20, d2 = 0x10
  let called190ee = false;
  scrollRange144E4(s, rom, 0x0200, 0x0100, { fun_190ee: () => { called190ee = true; } });
  assert(called190ee, "T8: mode 4 fun_190ee called");
}

// Test 9: Mode 4, d3 NOT in [3..1B] AND d2 in [3..1B] → write 1 to 0x400762
{
  const s = emptyGameState();
  const rom = emptyRomImage();
  addRomSentinel(rom);
  setMode(s, 4);
  setStatePtrInRam(s, 0);
  s.workRam[0x400762 - WRAM] = 0x00;
  // d3 = 0x20 (> 0x1B), d2 = 0x10 (in [3..1B])
  scrollRange144E4(s, rom, 0x0200, 0x0100, { fun_190ee: () => {} });
  assert(s.workRam[0x400762 - WRAM] === 1, `T9: mode 4 write 1 to 0x400762, got ${s.workRam[0x400762 - WRAM]}`);
}

// Test 10: Mode 4, d3 in [3..1B] AND d2 NOT → write 0
{
  const s = emptyGameState();
  const rom = emptyRomImage();
  addRomSentinel(rom);
  setMode(s, 4);
  setStatePtrInRam(s, 0);
  s.workRam[0x400762 - WRAM] = 0x01;
  // d3 = 0x10 (in [3..1B]), d2 = 0x20 (> 0x1B)
  scrollRange144E4(s, rom, 0x0100, 0x0200, { fun_18ffa: () => {} });
  assert(s.workRam[0x400762 - WRAM] === 0, `T10: mode 4 write 0 to 0x400762, got ${s.workRam[0x400762 - WRAM]}`);
}

// Test 11: Mode 4, both in [3..1B] → no write
{
  const s = emptyGameState();
  const rom = emptyRomImage();
  addRomSentinel(rom);
  setMode(s, 4);
  setStatePtrInRam(s, 0);
  s.workRam[0x400762 - WRAM] = 0xAA;
  // d3 = 0x08, d2 = 0x10 — both in [3..1B], different
  scrollRange144E4(s, rom, 0x0080, 0x0100);
  assert(s.workRam[0x400762 - WRAM] === 0xAA, `T11: mode 4 both in [3..1B] → no write, got ${s.workRam[0x400762 - WRAM]}`);
}

// Test 12: All 4 dispatchers called in order
{
  const s = emptyGameState();
  const rom = emptyRomImage();
  addRomSentinel(rom);
  setMode(s, 0);
  setStatePtrInRam(s, 0);
  const order: string[] = [];
  scrollRange144E4(s, rom, 0x0020, 0x0000, {
    fun_15a12: () => { order.push("15a12"); },
    fun_14c46: () => { order.push("14c46"); },
    fun_17346: () => { order.push("17346"); },
  });
  assert(
    order[0] === "15a12" && order[1] === "14c46" && order[2] === "17346",
    `T12: dispatch order, got ${order.join(",")}`
  );
}

// Test 13: ROM-based boundary
{
  const s = emptyGameState();
  const rom = emptyRomImage();
  addRomSentinel(rom);
  setMode(s, 0);
  const ptrValue = 0x10000;
  writeU32(s, 0x400474, ptrValue);
  rom.program[ptrValue + 0x10] = 0x00;
  rom.program[ptrValue + 0x11] = 0x10; // boundary = 16
  // from = 0x0020, d3 = (32-16)>>4 = 1
  // to = 0x0000, d2 = (0-16)>>4 = -1 = 0xFF
  const args: number[] = [];
  scrollRange144E4(s, rom, 0x0020, 0x0000, {
    fun_15a12: (_st, d3, d2) => { args.push(d3, d2); },
  });
  assert(args[0] === 1 && args[1] === 0xff, `T13: ROM-based boundary, got ${args[0]}, ${args[1]}`);
}

// Test 14: undefined rom uses boundary=0
{
  const s = emptyGameState();
  setMode(s, 0);
  let sub15Called = false;
  scrollRange144E4(s, undefined, 0x0100, 0x0000, {
    fun_15a12: () => { sub15Called = true; },
  });
  assert(sub15Called, "T14: undefined rom dispatches (boundary=0)");
}

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
else process.exit(0);
