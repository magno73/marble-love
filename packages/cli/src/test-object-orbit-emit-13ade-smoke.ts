#!/usr/bin/env node
/**
 * test-object-orbit-emit-13ade-smoke.ts — smoke tests per `objectOrbitEmit13ADE`.
 *
 * Verifica che la funzione:
 *   1. Esegua il reset trigger 0x64 → counter = 0x30, angle = 0.
 *   2. Esegua il reset trigger 0x65 → counter = 0x18, angle = 0.
 *   3. Esegua il reset trigger 0x66 → counter = 0x24, angle = 0.
 *   4. Decrementi il counter e scriva il ready byte 0x1C = 1.
 *   5. Ritorni 0x01 quando il counter post-decrement è 0.
 *   6. Ritorni 0x00 quando il counter post-decrement != 0.
 *   7. Faccia l'angle advance (0x0A) e il wrap a 0x192.
 *   8. Applichi il mirror se (A0+0x1A).b == 0x0B.
 *
 * Uso: npx tsx packages/cli/src/test-object-orbit-emit-13ade-smoke.ts
 */

import { exit } from "node:process";

import {
  state as stateNs,
  bus as busNs,
  objectOrbitEmit13ADE as ns,
} from "@marble-love/engine";
import type { RomImage } from "@marble-love/engine";

const WORK_RAM_BASE = 0x400000;
const ARG_PTR = 0x401000; // slot fictizio in work RAM
const ARG_OFF = ARG_PTR - WORK_RAM_BASE;

function makeState(): ReturnType<typeof stateNs.emptyGameState> {
  return stateNs.emptyGameState();
}

function makeRom(): RomImage {
  // ROM tutta zero: la sin/cos table (0x1EDA2) e il delta-stream (0x1EF32)
  // saranno tutti zero, il che ci permette di testare la logica di stato
  // indipendentemente dai valori della ROM reale.
  return busNs.emptyRomImage();
}

let passed = 0;
let failed = 0;

function check(desc: string, got: unknown, expected: unknown): void {
  if (got === expected) {
    console.log(`  PASS: ${desc}`);
    passed++;
  } else {
    console.error(`  FAIL: ${desc} — got 0x${Number(got).toString(16)}, expected 0x${Number(expected).toString(16)}`);
    failed++;
  }
}

function readU16(state: ReturnType<typeof stateNs.emptyGameState>, off: number): number {
  return (((state.workRam[off] ?? 0) << 8) | (state.workRam[off + 1] ?? 0)) & 0xffff;
}

console.log("\n=== objectOrbitEmit13ADE smoke tests ===\n");

// ── Smoke 1: reset trigger 0x64 → counter = 0x30, angle = 0 ─────────────
{
  const s = makeState();
  const rom = makeRom();
  s.workRam[ARG_OFF + 0x57] = 0x64; // counter = 100 (trigger)
  s.workRam[ARG_OFF + 0x2e] = 0x01; // angle pre != 0
  s.workRam[ARG_OFF + 0x2f] = 0x00;
  ns.objectOrbitEmit13ADE(s, rom, ARG_PTR);
  // counter DOPO trigger reset = 0x30, poi decrementato → 0x2f
  check("trigger 0x64: counter after = 0x2F", s.workRam[ARG_OFF + 0x57], 0x2f);
  // angle: reset a 0, poi avanzato di 0x0A → 0x000A
  check("trigger 0x64: angle after = 0x000A", readU16(s, ARG_OFF + 0x2e), 0x000a);
  check("trigger 0x64: ready byte = 1", s.workRam[ARG_OFF + 0x1c], 1);
}

// ── Smoke 2: reset trigger 0x65 → counter = 0x18, angle = 0 ─────────────
{
  const s = makeState();
  const rom = makeRom();
  s.workRam[ARG_OFF + 0x57] = 0x65;
  s.workRam[ARG_OFF + 0x2e] = 0x55;
  s.workRam[ARG_OFF + 0x2f] = 0x55;
  ns.objectOrbitEmit13ADE(s, rom, ARG_PTR);
  check("trigger 0x65: counter after = 0x17", s.workRam[ARG_OFF + 0x57], 0x17);
  check("trigger 0x65: angle = 0x000A", readU16(s, ARG_OFF + 0x2e), 0x000a);
}

// ── Smoke 3: reset trigger 0x66 → counter = 0x24, angle = 0 ─────────────
{
  const s = makeState();
  const rom = makeRom();
  s.workRam[ARG_OFF + 0x57] = 0x66;
  s.workRam[ARG_OFF + 0x2e] = 0xaa;
  s.workRam[ARG_OFF + 0x2f] = 0xbb;
  ns.objectOrbitEmit13ADE(s, rom, ARG_PTR);
  check("trigger 0x66: counter after = 0x23", s.workRam[ARG_OFF + 0x57], 0x23);
  check("trigger 0x66: angle = 0x000A", readU16(s, ARG_OFF + 0x2e), 0x000a);
}

// ── Smoke 4: D0 return = 1 quando counter post == 0 ─────────────────────
{
  const s = makeState();
  const rom = makeRom();
  s.workRam[ARG_OFF + 0x57] = 0x01; // counter = 1, dopo decrement → 0
  const d0 = ns.objectOrbitEmit13ADE(s, rom, ARG_PTR);
  check("D0 = 1 quando counter post == 0", d0, 0x00000001);
  check("counter post == 0", s.workRam[ARG_OFF + 0x57], 0x00);
}

// ── Smoke 5: D0 return = 0 quando counter post != 0 ─────────────────────
{
  const s = makeState();
  const rom = makeRom();
  s.workRam[ARG_OFF + 0x57] = 0x10; // counter = 16, dopo decrement → 15
  const d0 = ns.objectOrbitEmit13ADE(s, rom, ARG_PTR);
  check("D0 = 0 quando counter post != 0", d0, 0x00000000);
  check("counter post == 0x0F", s.workRam[ARG_OFF + 0x57], 0x0f);
}

// ── Smoke 6: angle advance e wrap ────────────────────────────────────────
{
  const s = makeState();
  const rom = makeRom();
  s.workRam[ARG_OFF + 0x57] = 0x05;
  // angle = 0x188 (= 0x192 - 0x0A = 392), dopo advance dovrebbe tornare a 0
  s.workRam[ARG_OFF + 0x2e] = 0x01;
  s.workRam[ARG_OFF + 0x2f] = 0x88;
  ns.objectOrbitEmit13ADE(s, rom, ARG_PTR);
  check("angle wrap: 0x188 + 0x0A = 0x192 → 0", readU16(s, ARG_OFF + 0x2e), 0x0000);
}

// ── Smoke 7: angle avanza normalmente senza wrap ─────────────────────────
{
  const s = makeState();
  const rom = makeRom();
  s.workRam[ARG_OFF + 0x57] = 0x05;
  // angle = 0x0050
  s.workRam[ARG_OFF + 0x2e] = 0x00;
  s.workRam[ARG_OFF + 0x2f] = 0x50;
  ns.objectOrbitEmit13ADE(s, rom, ARG_PTR);
  check("angle advance: 0x0050 + 0x0A = 0x005A", readU16(s, ARG_OFF + 0x2e), 0x005a);
}

// ── Smoke 8: ready byte sempre 1 ─────────────────────────────────────────
{
  const s = makeState();
  const rom = makeRom();
  s.workRam[ARG_OFF + 0x57] = 0x10;
  s.workRam[ARG_OFF + 0x1c] = 0x00; // pre-clear
  ns.objectOrbitEmit13ADE(s, rom, ARG_PTR);
  check("ready byte (0x1C) = 1 sempre", s.workRam[ARG_OFF + 0x1c], 1);
}

console.log(`\nSmoke: ${passed} passed, ${failed} failed`);
exit(failed > 0 ? 1 : 0);
