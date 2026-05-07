#!/usr/bin/env node
/**
 * test-or-flags-5248-smoke.ts — smoke tests per `orFlags5248`.
 *
 * Verifica 5 casi deterministici (senza ROM/binary oracle):
 *   1. OR con maschera 0x3 su valore zero → result = 0x3.
 *   2. OR con maschera 0 → no-op, valore preservato.
 *   3. OR cumulativo: due chiamate successive accumulano bit.
 *   4. OR con 0xFFFFFFFF → tutti i bit settati.
 *   5. OR con maschera che sovrappone bit già settati → idempotente.
 */

import { exit } from "node:process";
import { state as stateNs, orFlags5248 as ns } from "@marble-love/engine";

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

function getFlags(s: ReturnType<typeof stateNs.emptyGameState>): number {
  const r = s.workRam;
  return (
    (((r[ns.STATUS_FLAGS_OFF] ?? 0) << 24) |
      ((r[ns.STATUS_FLAGS_OFF + 1] ?? 0) << 16) |
      ((r[ns.STATUS_FLAGS_OFF + 2] ?? 0) << 8) |
      (r[ns.STATUS_FLAGS_OFF + 3] ?? 0)) >>>
    0
  );
}

function setFlags(s: ReturnType<typeof stateNs.emptyGameState>, v: number): void {
  const n = v >>> 0;
  s.workRam[ns.STATUS_FLAGS_OFF] = (n >>> 24) & 0xff;
  s.workRam[ns.STATUS_FLAGS_OFF + 1] = (n >>> 16) & 0xff;
  s.workRam[ns.STATUS_FLAGS_OFF + 2] = (n >>> 8) & 0xff;
  s.workRam[ns.STATUS_FLAGS_OFF + 3] = n & 0xff;
}

// ─── Test 1: OR 0x3 su valore zero ───────────────────────────────────────────
console.log("\nTest 1: OR 0x3 su valore zero");
{
  const s = makeState();
  // workRam parte a zero; flags @ 0x1F5E = 0
  ns.orFlags5248(s, 3);
  const v = getFlags(s);
  assert(v === 0x3, `flags = 0x${v.toString(16)} (expected 0x3)`);
}

// ─── Test 2: OR con maschera 0 → no-op ───────────────────────────────────────
console.log("\nTest 2: OR maschera 0 → no-op");
{
  const s = makeState();
  setFlags(s, 0xdeadbeef);
  ns.orFlags5248(s, 0);
  const v = getFlags(s);
  assert(v === 0xdeadbeef, `flags = 0x${v.toString(16)} (expected 0xdeadbeef)`);
}

// ─── Test 3: OR cumulativo accumula bit ───────────────────────────────────────
console.log("\nTest 3: OR cumulativo (0x1 poi 0x2 poi 0x4)");
{
  const s = makeState();
  ns.orFlags5248(s, 0x1);
  ns.orFlags5248(s, 0x2);
  ns.orFlags5248(s, 0x4);
  const v = getFlags(s);
  assert(v === 0x7, `flags = 0x${v.toString(16)} (expected 0x7)`);
}

// ─── Test 4: OR 0xFFFFFFFF → tutti i bit a 1 ─────────────────────────────────
console.log("\nTest 4: OR 0xFFFFFFFF");
{
  const s = makeState();
  ns.orFlags5248(s, 0xffffffff);
  const v = getFlags(s);
  assert(v === 0xffffffff, `flags = 0x${v.toString(16)} (expected 0xffffffff)`);
}

// ─── Test 5: OR idempotente (bit già settati) ─────────────────────────────────
console.log("\nTest 5: OR idempotente");
{
  const s = makeState();
  setFlags(s, 0x00ff00ff);
  ns.orFlags5248(s, 0x00ff00ff); // stesso valore
  const v = getFlags(s);
  assert(v === 0x00ff00ff, `flags = 0x${v.toString(16)} (expected 0x00ff00ff)`);
}

// ─── Summary ──────────────────────────────────────────────────────────────────
console.log(`\n=== smoke: ${passed} passed, ${failed} failed ===`);
exit(failed > 0 ? 1 : 0);
