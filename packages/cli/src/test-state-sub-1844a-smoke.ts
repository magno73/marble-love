#!/usr/bin/env node
/**
 * test-state-sub-1844a-smoke.ts — smoke tests per `stateSub1844A`.
 *
 * Run 5 deterministic cases without ROM (no binary oracle) to verify:
 *   1. Early-out when gameMode != 3.
 *   2. Early-out when byte760 == 0.
 *   3. Decrement path: timer > 1 → decrementato, no insert.
 *   4. Insert path: timer == 1 → decrementato a 0 → insert triggered, timer
 *      risettato a 0xFFFF, entry[0x8..0xB] = 0x21342.
 *   5. Ptr-walk path: timer == -1 → ptr avanzato di 4.
 */

import { exit } from "node:process";
import { state as stateNs, bus as busNs, stateSub1844A as ns } from "@marble-love/engine";

let passed = 0;
let failed = 0;

function assert(cond: boolean, msg: string): void {
  if (cond) {
    console.log(`  PASS: ${msg}`);
    passed++;
  } else {
    console.error(`  FAIL: ${msg}`);
    failed++;
  }
}

function makeState(): ReturnType<typeof stateNs.emptyGameState> {
  return stateNs.emptyGameState();
}
function makeRom(): ReturnType<typeof busNs.emptyRomImage> {
  return busNs.emptyRomImage();
}

function setWord(state: ReturnType<typeof stateNs.emptyGameState>, off: number, v: number): void {
  state.workRam[off] = (v >>> 8) & 0xff;
  state.workRam[off + 1] = v & 0xff;
}
function setLong(state: ReturnType<typeof stateNs.emptyGameState>, off: number, v: number): void {
  state.workRam[off] = (v >>> 24) & 0xff;
  state.workRam[off + 1] = (v >>> 16) & 0xff;
  state.workRam[off + 2] = (v >>> 8) & 0xff;
  state.workRam[off + 3] = v & 0xff;
}
function getLong(state: ReturnType<typeof stateNs.emptyGameState>, off: number): number {
  return (
    ((state.workRam[off] ?? 0) << 24) |
    ((state.workRam[off + 1] ?? 0) << 16) |
    ((state.workRam[off + 2] ?? 0) << 8) |
    (state.workRam[off + 3] ?? 0)
  ) >>> 0;
}
function getWord(state: ReturnType<typeof stateNs.emptyGameState>, off: number): number {
  return (((state.workRam[off] ?? 0) << 8) | (state.workRam[off + 1] ?? 0)) & 0xffff;
}

// ─── Test 1: early-out gameMode != 3 ─────────────────────────────────────────

console.log("\nTest 1: early-out (gameMode != 3)");
{
  const s = makeState(); const rom = makeRom();
  setWord(s, ns.GAME_MODE_OFFSET, 0); // != 3
  s.workRam[ns.SECONDARY_GATE_OFFSET] = 0xff;
  const r = ns.stateSub1844A(s, rom);
  assert(r.earlyOut === true, "earlyOut = true");
  assert(r.entries.length === 0, "entries = []");
}

// ─── Test 2: early-out byte760 == 0 ──────────────────────────────────────────

console.log("\nTest 2: early-out (byte760 == 0)");
{
  const s = makeState(); const rom = makeRom();
  setWord(s, ns.GAME_MODE_OFFSET, 3);
  s.workRam[ns.SECONDARY_GATE_OFFSET] = 0; // gate fails
  const r = ns.stateSub1844A(s, rom);
  assert(r.earlyOut === true, "earlyOut = true");
  assert(r.soundCalls === 0, "soundCalls = 0");
}

// ─── Test 3: decrement path (timer > 1) ──────────────────────────────────────

console.log("\nTest 3: decrement path (timer = 5 → 4)");
{
  const s = makeState(); const rom = makeRom();
  setWord(s, ns.GAME_MODE_OFFSET, 3);
  s.workRam[ns.SECONDARY_GATE_OFFSET] = 1;
  // Set first entry timer = 5, rest = 0xFFFF (ptr-walk path, won't fire)
  const e0 = ns.SLOT_TABLE_OFFSET;
  setWord(s, e0 + ns.ENTRY_TIMER_OFF, 5);
  for (let i = 1; i < ns.SLOT_ENTRY_COUNT; i++) {
    setWord(s, ns.SLOT_TABLE_OFFSET + i * ns.SLOT_ENTRY_STRIDE + ns.ENTRY_TIMER_OFF, 0xffff);
  }
  let insertCalled = false;
  const r = ns.stateSub1844A(s, rom, { fun_18e6c: () => { insertCalled = true; } });
  assert(r.earlyOut === false, "earlyOut = false");
  assert(getWord(s, e0 + ns.ENTRY_TIMER_OFF) === 4, "timer decremented to 4");
  assert(!insertCalled, "insert NOT called");
  assert(r.entries[0]?.path === "decrement", "entry[0].path = decrement");
}

// ─── Test 4: insert path (timer == 1 → 0 → insert triggered) ─────────────────

console.log("\nTest 4: insert path (timer = 1 → insert)");
{
  const s = makeState(); const rom = makeRom();
  setWord(s, ns.GAME_MODE_OFFSET, 3);
  s.workRam[ns.SECONDARY_GATE_OFFSET] = 1;
  const e0 = ns.SLOT_TABLE_OFFSET;
  setWord(s, e0 + ns.ENTRY_TIMER_OFF, 1); // timer == 1
  s.workRam[e0 + ns.ENTRY_SUB_IDX_OFF] = 0x05; // subIdx = 5
  for (let i = 1; i < ns.SLOT_ENTRY_COUNT; i++) {
    setWord(s, ns.SLOT_TABLE_OFFSET + i * ns.SLOT_ENTRY_STRIDE + ns.ENTRY_TIMER_OFF, 5);
  }
  let insertTypeCode = -1;
  let insertSubIdx = -1;
  const r = ns.stateSub1844A(s, rom, {
    fun_18e6c: (tc: number, si: number) => { insertTypeCode = tc; insertSubIdx = si; },
  });
  assert(r.earlyOut === false, "earlyOut = false");
  assert(insertTypeCode === 0x29, `insert typeCode = 0x29 (got 0x${insertTypeCode.toString(16)})`);
  assert(insertSubIdx === 5, `insert subIdx = 5 (got ${insertSubIdx})`);
  assert(getWord(s, e0 + ns.ENTRY_TIMER_OFF) === 0xffff, "timer reset to 0xFFFF");
  assert(getLong(s, e0 + ns.ENTRY_PTR_WALK_OFF) === ns.PTR_WALK_INIT,
    `entry[0x8..0xB] = 0x21342 (got 0x${getLong(s, e0 + ns.ENTRY_PTR_WALK_OFF).toString(16)})`);
  assert(r.entries[0]?.path === "insert", "entry[0].path = insert");
}

// ─── Test 5: ptr-walk path (timer == -1, ptr advances) ───────────────────────

console.log("\nTest 5: ptr-walk path (timer = -1 → ptr += 4)");
{
  const s = makeState(); const rom = makeRom();
  setWord(s, ns.GAME_MODE_OFFSET, 3);
  s.workRam[ns.SECONDARY_GATE_OFFSET] = 1;
  const e0 = ns.SLOT_TABLE_OFFSET;
  setWord(s, e0 + ns.ENTRY_TIMER_OFF, 0xffff); // timer == -1
  const initPtr = 0x00021342;
  setLong(s, e0 + ns.ENTRY_PTR_WALK_OFF, initPtr);
  // ROM at initPtr + 4 is 0 (not sentinel 0xFFFFFFFF) → no sentinel trigger
  for (let i = 1; i < ns.SLOT_ENTRY_COUNT; i++) {
    setWord(s, ns.SLOT_TABLE_OFFSET + i * ns.SLOT_ENTRY_STRIDE + ns.ENTRY_TIMER_OFF, 5);
  }
  const r = ns.stateSub1844A(s, rom);
  assert(r.earlyOut === false, "earlyOut = false");
  const newPtr = getLong(s, e0 + ns.ENTRY_PTR_WALK_OFF);
  assert(newPtr === (initPtr + 4) >>> 0,
    `ptr advanced by 4: 0x${newPtr.toString(16)} == 0x${((initPtr + 4) >>> 0).toString(16)}`);
  assert(r.entries[0]?.path === "ptr_walk_no_sentinel", "path = ptr_walk_no_sentinel");
}

// ─── Summary ──────────────────────────────────────────────────────────────────

console.log(`\n=== smoke: ${passed} passed, ${failed} failed ===`);
exit(failed > 0 ? 1 : 0);
