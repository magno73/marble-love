#!/usr/bin/env node
/**
 * test-thunk-10042-smoke.ts — smoke tests for `thunk10042` (FUN_00010042).
 *
 * entirely to `trackballClampFlags28468`. The smoke tests here verify:
 *      (accumulators at 0, input at 0) → flags = 0xF003 → sext = -4093.
 *      (e.g. 0x0050 > 0x40 → clamp to 0x40) and the thunk reflects the change.
 *
 * Usage: npx tsx packages/cli/src/test-thunk-10042-smoke.ts
 */

import { exit } from "node:process";

import {
  state as stateNs,
  thunk10042 as ns,
  trackballClampFlags28468 as cfNs,
} from "@marble-love/engine";

let passed = 0;
let failed = 0;

function check(desc: string, got: unknown, expected: unknown): void {
  if (got === expected) {
    console.log(`  PASS: ${desc}`);
    passed++;
  } else {
    console.error(
      `  FAIL: ${desc} — got 0x${(Number(got) >>> 0).toString(16)}, expected 0x${(Number(expected) >>> 0).toString(16)}`,
    );
    failed++;
  }
}

function writeWord(r: Uint8Array, off: number, v: number): void {
  const u = v & 0xffff;
  r[off] = (u >>> 8) & 0xff;
  r[off + 1] = u & 0xff;
}
function readWord(r: Uint8Array, off: number): number {
  const w = (((r[off] ?? 0) << 8) | (r[off + 1] ?? 0)) & 0xffff;
  return w >= 0x8000 ? w - 0x10000 : w;
}

const inputs0 = {
  mmioInputByte: 0,
  p1X: 0,
  p1Y: 0,
  p2X: 0,
  p2Y: 0,
};

console.log("\n=== thunk10042 (FUN_00010042) smoke tests ===\n");

{
  const s1 = stateNs.emptyGameState();
  const s2 = stateNs.emptyGameState();

  const retThunk = ns.thunk10042(s1, inputs0);
  const retDirect = cfNs.trackballClampFlags28468(s2, inputs0);

  check("smoke1: thunk retval == direct FUN_28468", retThunk, retDirect);
  // With accumulators=0 and input=0: flags=0xF003 unchanged -> sext16(0xF003) = -4093
  // mmioInputByte=0 → debounce clears bits 0 and 1 → flags = 0xF003 & 0xFFFE & 0xFFFD = 0xF000
  // sext16(0xF000) = -4096
  check("smoke1: retval = -4096 (0xF000 sign-extended, input bits cleared)", retThunk, -4096);
  check("smoke1: accumX unchanged (input zero)", readWord(s1.workRam, cfNs.ACCUM_X_OFF), 0);
  check("smoke1: accumY unchanged (input zero)", readWord(s1.workRam, cfNs.ACCUM_Y_OFF), 0);
}

{
  const s = stateNs.emptyGameState();
  // Set accumX = 0x0050 (> PRE_CLAMP_LIMIT 0x40).
  writeWord(s.workRam, cfNs.ACCUM_X_OFF, 0x0050);
  // accumY = -0x50 < -0x40 → clamp to -0x40
  writeWord(s.workRam, cfNs.ACCUM_Y_OFF, 0xffb0); // -0x50 in u16

  const ret = ns.thunk10042(s, inputs0);

  // post-wrap: 0x40 > 0x18 → 0x40 - 0x18 = 0x28, bit12 cleared → flags &= ~0x1000
  const expectedX = 0x28;
  check("smoke2: accumX post-thunk = 0x28 (clamped 0x40 → wrap -0x18)", readWord(s.workRam, cfNs.ACCUM_X_OFF), expectedX);
  // accumY clamped to -0x40, then delta=0 → -0x40 < -0x18 → -0x40+0x18 = -0x28, bit13 cleared
  const expectedY = -0x28;
  check("smoke2: accumY post-thunk = -0x28 (clamped -0x40 → wrap +0x18)", readWord(s.workRam, cfNs.ACCUM_Y_OFF), expectedY);
  // flags start: 0xF000 (input bits 0/1 cleared by debounce with mmio=0)
  // X+ wrap → clear bit 12: 0xF000 & 0xEFFF = 0xE000
  // Y- wrap → clear bit 14: 0xE000 & 0xBFFF = 0xA000
  // sext16(0xA000) = -24576
  check("smoke2: retval = -24576 (flags 0xA000 sext)", ret, -24576);
}

console.log(`\nSmoke: ${passed} passed, ${failed} failed`);
exit(failed > 0 ? 1 : 0);
