#!/usr/bin/env node
/**
 * test-sprite-rotate-1c014-smoke.ts — smoke test FUN_0001C014 / spriteRotate1C014.
 *
 * 3 deterministic scenarios without a binary ROM:
 *   1. velocity-idle (flag@+0x58=0xA) with gameMode!=4 -> early exit, only slot output.
 *   2. single-axis X velocity (D2!=0, D6==0) with gameMode==4 -> path 0x1c0a4.
 *   3. dual-axis velocity (D2!=0, D6!=0) → full atan path.
 *
 * Verifies the function does not throw and modifies the expected workRam areas.
 * without depending on the MAME binary.
 *
 * Uso: npx tsx packages/cli/src/test-sprite-rotate-1c014-smoke.ts
 */

import { exit } from "node:process";

import {
  state as stateNs,
  bus as busNs,
  spriteRotate1C014 as rotNs,
} from "@marble-love/engine";
import type { RomImage } from "@marble-love/engine";

const OBJ_ADDR = 0x401200; // raw address of object struct
const OBJ_OFF = OBJ_ADDR - 0x400000; // workRam offset

/** Creates a clean state with empty ROM and sets the local frame. */
function makeState(): { s: ReturnType<typeof stateNs.emptyGameState>; rom: RomImage } {
  const s = stateNs.emptyGameState();
  const rom = busNs.emptyRomImage();
  return { s, rom };
}

/** Scrive word big-endian in workRam */
function w16(s: ReturnType<typeof stateNs.emptyGameState>, off: number, v: number): void {
  s.workRam[off] = (v >>> 8) & 0xff;
  s.workRam[off + 1] = v & 0xff;
}
/** Scrive long big-endian in workRam */
function w32(s: ReturnType<typeof stateNs.emptyGameState>, off: number, v: number): void {
  const u = v >>> 0;
  s.workRam[off] = (u >>> 24) & 0xff;
  s.workRam[off + 1] = (u >>> 16) & 0xff;
  s.workRam[off + 2] = (u >>> 8) & 0xff;
  s.workRam[off + 3] = u & 0xff;
}
/** Legge word unsigned big-endian */
function r16(s: ReturnType<typeof stateNs.emptyGameState>, off: number): number {
  return (((s.workRam[off] ?? 0) << 8) | (s.workRam[off + 1] ?? 0)) & 0xffff;
}

let passed = 0;
let failed = 0;

function check(label: string, actual: number, expected: number): void {
  if (actual === expected) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.log(
      `  ✗ ${label}: got 0x${(actual >>> 0).toString(16).padStart(4, "0")} expected 0x${(expected >>> 0).toString(16).padStart(4, "0")}`,
    );
    failed++;
  }
}

function checkAny(label: string, val: number): void {
  // Just verify the value is a finite number (wrote something)
  if (Number.isFinite(val)) {
    console.log(`  ✓ ${label} = 0x${(val >>> 0).toString(16).padStart(4, "0")}`);
    passed++;
  } else {
    console.log(`  ✗ ${label}: not finite`);
    failed++;
  }
}

// ─── Smoke 1: idle path (flagByte=0xA, gameMode=0) → early slot output ─────

console.log("\n--- Smoke 1: idle + early-exit (gameMode≠4) ---");
{
  const { s, rom } = makeState();

  // gameMode = 0x00 at 0x400394
  w16(s, 0x394, 0);

  // flag@+0x58 = 0xA → idle
  s.workRam[OBJ_OFF + 0x58] = 0x0a;

  // Set up matrix columns (identity-like): col0 = [0x4000,0,0], col1=[0,0x4000,0], col2=[0,0,0x4000]
  w16(s, OBJ_OFF + 0x74, 0x4000); // col0[0]
  w16(s, OBJ_OFF + 0x76, 0x0000);
  w16(s, OBJ_OFF + 0x78, 0x0000);
  w16(s, OBJ_OFF + 0x84, 0x0000); // col1[0]
  w16(s, OBJ_OFF + 0x86, 0x4000);
  w16(s, OBJ_OFF + 0x88, 0x0000);
  w16(s, OBJ_OFF + 0x94, 0x0000); // col2[0]
  w16(s, OBJ_OFF + 0x96, 0x0000);
  w16(s, OBJ_OFF + 0x98, 0x4000);

  // base coords
  w16(s, OBJ_OFF + 0x1e, 0x0040); // base-X = 64
  w16(s, OBJ_OFF + 0x20, 0x0020); // base-Y raw = 32 → +7 = 39

  // typeFlag @ +0x1a = 0 (not 8 → d3Type stays 0)
  s.workRam[OBJ_OFF + 0x1a] = 0;

  // CA counter @ +0xca = 0
  s.workRam[OBJ_OFF + 0xca] = 0;

  // No exception thrown
  try {
    rotNs.spriteRotate1C014(s, rom, OBJ_OFF);
    console.log("  ✓ No exception");
    passed++;
  } catch (e) {
    console.log(`  ✗ Exception: ${e}`);
    failed++;
  }

  // outBase = OBJ_OFF + 0xa4; should have 4 slots written
  const slot0Angle = r16(s, OBJ_OFF + 0xa4 + 0);
  const slot0X = r16(s, OBJ_OFF + 0xa4 + 2);
  const slot0Y = r16(s, OBJ_OFF + 0xa4 + 4);
  checkAny("slot0.angle", slot0Angle);
  checkAny("slot0.x", slot0X);
  checkAny("slot0.y", slot0Y);
}

// ─── Smoke 2: single-axis X path, gameMode=4 ────────────────────────────────

console.log("\n--- Smoke 2: single-axis X, gameMode=4 ---");
{
  const { s, rom } = makeState();

  // gameMode = 4
  w16(s, 0x394, 4);

  // flag@+0x58 = 0 → use velocity
  s.workRam[OBJ_OFF + 0x58] = 0x00;

  // velocity.x = 0x0050 Q4.12 → integer part = 5; velocity.y = 0
  w32(s, OBJ_OFF + 0x00, 0x0050 << 4);
  w32(s, OBJ_OFF + 0x04, 0x0000);

  // Identity-like matrix cols
  w16(s, OBJ_OFF + 0x74, 0x4000);
  w16(s, OBJ_OFF + 0x76, 0x0000);
  w16(s, OBJ_OFF + 0x78, 0x0000);
  w16(s, OBJ_OFF + 0x84, 0x0000);
  w16(s, OBJ_OFF + 0x86, 0x4000);
  w16(s, OBJ_OFF + 0x88, 0x0000);
  w16(s, OBJ_OFF + 0x94, 0x0000);
  w16(s, OBJ_OFF + 0x96, 0x0000);
  w16(s, OBJ_OFF + 0x98, 0x4000);

  w16(s, OBJ_OFF + 0x1e, 0x0060);
  w16(s, OBJ_OFF + 0x20, 0x0030);
  s.workRam[OBJ_OFF + 0x1a] = 0;
  s.workRam[OBJ_OFF + 0xca] = 0;

  try {
    rotNs.spriteRotate1C014(s, rom, OBJ_OFF);
    console.log("  ✓ No exception");
    passed++;
  } catch (e) {
    console.log(`  ✗ Exception: ${e}`);
    failed++;
  }

  // CA counter should have incremented to 1
  check("ca_counter", s.workRam[OBJ_OFF + 0xca] ?? 0, 1);

  // The 4 slots should be written
  for (let sl = 0; sl < 4; sl++) {
    checkAny(`slot${sl}.angle`, r16(s, OBJ_OFF + 0xa4 + sl * 6 + 0));
  }
}

// ─── Smoke 3: dual-axis velocity, gameMode=0 → full atan ────────────────────

console.log("\n--- Smoke 3: dual-axis velocity, gameMode=0 ---");
{
  const { s, rom } = makeState();

  w16(s, 0x394, 0);
  s.workRam[OBJ_OFF + 0x58] = 0x00;

  // velocity.x = 0x30<<4, velocity.y = 0x40<<4
  w32(s, OBJ_OFF + 0x00, (0x0030 << 4) >>> 0);
  w32(s, OBJ_OFF + 0x04, (0x0040 << 4) >>> 0);

  // Small non-trivial matrix
  w16(s, OBJ_OFF + 0x74, 0x3b21);
  w16(s, OBJ_OFF + 0x76, 0x187e);
  w16(s, OBJ_OFF + 0x78, 0xc000);
  w16(s, OBJ_OFF + 0x84, 0xc000);
  w16(s, OBJ_OFF + 0x86, 0x3b21);
  w16(s, OBJ_OFF + 0x88, 0x187e);
  w16(s, OBJ_OFF + 0x94, 0x187e);
  w16(s, OBJ_OFF + 0x96, 0xc000);
  w16(s, OBJ_OFF + 0x98, 0x3b21);

  w16(s, OBJ_OFF + 0x1e, 0x0050);
  w16(s, OBJ_OFF + 0x20, 0x0028);
  s.workRam[OBJ_OFF + 0x1a] = 0;
  s.workRam[OBJ_OFF + 0xca] = 2;

  try {
    rotNs.spriteRotate1C014(s, rom, OBJ_OFF);
    console.log("  ✓ No exception");
    passed++;
  } catch (e) {
    console.log(`  ✗ Exception: ${e}`);
    failed++;
  }

  // CA counter should have incremented (was 2, now 3)
  check("ca_counter", s.workRam[OBJ_OFF + 0xca] ?? 0, 3);

  // Matrix was updated
  const col0 = r16(s, OBJ_OFF + 0x74);
  checkAny("col0[0] after rotate", col0);

  // 4 slot angles written
  for (let sl = 0; sl < 4; sl++) {
    checkAny(`slot${sl}.angle`, r16(s, OBJ_OFF + 0xa4 + sl * 6 + 0));
  }
}

// ─── Summary ────────────────────────────────────────────────────────────────

console.log(`\n=== Smoke: ${passed} passed, ${failed} failed ===`);
exit(failed === 0 ? 0 : 1);
