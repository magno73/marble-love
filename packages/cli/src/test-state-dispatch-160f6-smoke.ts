#!/usr/bin/env node
/**
 * test-state-dispatch-160f6-smoke.ts — smoke tests per `stateDispatch160F6`.
 *
 * ROM binaria:
 *      snapshots saved, impulse written, sound emitted).
 *      snapshots updated, impulse written.
 *
 * Usage: npx tsx packages/cli/src/test-state-dispatch-160f6-smoke.ts
 */

import { exit } from "node:process";

import {
  state as stateNs,
  stateDispatch160F6 as ns,
} from "@marble-love/engine";

const WR_BASE = 0x400000;
const STRUCT = 0x401000;
const TILE_X = 0x401100;
const TILE_Y = 0x401200;
const SO = STRUCT - WR_BASE; // struct offset in workRam
const TXO = TILE_X - WR_BASE;

function makeState(): ReturnType<typeof stateNs.emptyGameState> {
  return stateNs.emptyGameState();
}

function writeW(r: Uint8Array, off: number, v: number): void {
  r[off] = (v >>> 8) & 0xff; r[off + 1] = v & 0xff;
}
function writeL(r: Uint8Array, off: number, v: number): void {
  const u = v >>> 0;
  r[off] = (u >>> 24) & 0xff; r[off + 1] = (u >>> 16) & 0xff;
  r[off + 2] = (u >>> 8) & 0xff; r[off + 3] = u & 0xff;
}
function readL(r: Uint8Array, off: number): number {
  return (
    (((r[off] ?? 0) << 24) | ((r[off + 1] ?? 0) << 16) |
     ((r[off + 2] ?? 0) << 8) | (r[off + 3] ?? 0))
  ) >>> 0; // unsigned
}
function readW(r: Uint8Array, off: number): number {
  const w = (((r[off] ?? 0) << 8) | (r[off + 1] ?? 0)) & 0xffff;
  return w >= 0x8000 ? w - 0x10000 : w;
}

let passed = 0;
let failed = 0;

function check(desc: string, got: unknown, expected: unknown): void {
  if (got === expected) {
    console.log(`  PASS: ${desc}`);
    passed++;
  } else {
    console.error(
      `  FAIL: ${desc} — got 0x${Number(got).toString(16)}, expected 0x${Number(expected).toString(16)}`,
    );
    failed++;
  }
}

console.log("\n=== stateDispatch160F6 (FUN_000160F6) smoke tests ===\n");

{
  const s = makeState();
  const r = s.workRam;
  // pos14=0, prevTimer=0 → diff=0 <= 0x60000
  r[SO + 0x36] = 0x00;
  r[SO + 0x58] = 0x20;
  writeL(r, SO + 0x14, 0);
  ns.stateDispatch160F6(s, STRUCT, TILE_X, TILE_Y, 0);
  check("smoke1: state stays 0", r[SO + 0x36], 0x00);
  check("smoke1: impulse stays 0", readL(r, SO + 0x08), 0);
}

// ── Smoke 2: D2==0, diff > 0x60000 → idle→locked ────────────────────────────
{
  const s = makeState();
  const r = s.workRam;
  r[SO + 0x36] = 0x00;
  r[SO + 0x58] = 0x17; // in whitelist but not 0x12/0x20 → sound
  // pos14 = 0x70000, prevTimer = 0 → diff = 0x70000 > 0x60000
  writeL(r, SO + 0x14, 0x70000);
  writeW(r, 0x696, 0x0003); // accumXPrev word
  writeW(r, 0x698, 0x0007); // accumYPrev word
  let soundCalled = false;
  ns.stateDispatch160F6(s, STRUCT, TILE_X, TILE_Y, 0, {
    soundCommand: (cmd) => { soundCalled = cmd === ns.SOUND_CMD; },
  });
  check("smoke2: state = 2 (locked)", r[SO + 0x36], 0x02);
  check("smoke2: impulse = 0xffffa000", readL(r, SO + 0x08), 0xffffa000);
  check("smoke2: snapshotX saved", readW(r, SO + 0x2e), 0x0003);
  check("smoke2: snapshotY saved", readW(r, SO + 0x30), 0x0007);
  check("smoke2: sound emitted", soundCalled, true);
}

// ── Smoke 3: D2 != 0, charcode NOT in whitelist → no-op ──────────────────────
{
  const s = makeState();
  const r = s.workRam;
  r[SO + 0x36] = 0x00;
  r[SO + 0x58] = 0x01; // not in whitelist
  r[0x66c] = 0x01;
  writeW(r, TXO, 3);  // tileX = 3
  writeW(r, 0x674, 2); // velLeft = 2
  // accumXPrev=accumXCur=0 → D3=0
  ns.stateDispatch160F6(s, STRUCT, TILE_X, TILE_Y, 0);
  check("smoke3: state stays 0 (charcode not in whitelist)", r[SO + 0x36], 0x00);
}

{
  const s = makeState();
  const r = s.workRam;
  r[SO + 0x36] = 0x00;
  r[SO + 0x58] = 0x20; // in whitelist
  r[SO + 0x37] = 0xff;
  r[0x66c] = 0x01;
  writeW(r, TXO, 3);   // tileX = 3 (< 4)
  writeW(r, 0x674, 2); // velLeft = 2
  writeW(r, 0x696, 0x0010); // accumXPrev snapshot
  writeW(r, 0x698, 0x0020); // accumYPrev snapshot
  ns.stateDispatch160F6(s, STRUCT, TILE_X, TILE_Y, 0);
  check("smoke4: state = 1 (moving)", r[SO + 0x36], 0x01);
  check("smoke4: dirMask = 1 (Left)", r[SO + 0x37], 0x01);
  check("smoke4: impulse = 0xffffa000", readL(r, SO + 0x08), 0xffffa000);
  check("smoke4: snapshotX = accumXPrev", readW(r, SO + 0x2e), 0x0010);
  check("smoke4: snapshotY = accumYPrev", readW(r, SO + 0x30), 0x0020);
}

{
  const s = makeState();
  const r = s.workRam;
  r[SO + 0x36] = 0x02;  // locked
  writeL(r, SO + 0x08, 0xdeadbeef);
  ns.stateDispatch160F6(s, STRUCT, TILE_X, TILE_Y, 0);
  check("smoke5: state stays 2", r[SO + 0x36], 0x02);
  check("smoke5: impulse not modified", readL(r, SO + 0x08), 0xdeadbeef >>> 0);
}

{
  const s = makeState();
  const r = s.workRam;
  r[SO + 0x36] = 0x01;   // moving
  r[SO + 0x37] = 0x01;   // dirMask = Left
  writeW(r, 0x696, 0);   // accumXPrev
  writeW(r, SO + 0x2e, 5); // snapshotX = 5
  writeW(r, 0x698, 0);
  writeW(r, SO + 0x30, 0);
  writeL(r, SO + 0x14, 0xCAFEBABE);
  ns.stateDispatch160F6(s, STRUCT, TILE_X, TILE_Y, 0);
  check("smoke6: position_14 unchanged (D5>=2 early exit)", readL(r, SO + 0x14), 0xCAFEBABE >>> 0);
}

{
  const s = makeState();
  const r = s.workRam;
  r[SO + 0x36] = 0x01;
  r[SO + 0x37] = 0x01;
  r[SO + 0x58] = 0x20;
  r[0x66c] = 0x01;        // inputLeft = 1 (non-zero, < 3)
  writeW(r, TXO, 2);      // tileX = 2 (< 4 → condizione Left soddisfatta)
  writeW(r, 0x674, 2);    // velLeft = 2 (in [0,3])
  // D3 = accumXCur - accumXPrev = 0 != 1 → condizione D3!=1 soddisfatta
  writeW(r, 0x696, 5);    // accumXPrev
  writeW(r, 0x69a, 5);    // accumXCur = same → D3=0
  writeW(r, 0x698, 0);
  writeW(r, 0x69c, 0);
  // D5=0, D6=0: accumPrev == snapshot
  writeW(r, SO + 0x2e, 5); // snapshotX = accumXPrev
  writeW(r, SO + 0x30, 0);
  writeL(r, SO + 0x14, 0);
  // Loop: isolated=1 (Left), D5=0 → D1w=tileX=2, D2w=5.
  // tableIdx=2 (D1w<5, D1w<=D2w, D2w>=5 → use D1w).
  // romByte(0x2398c+2) = 1 → mag=1.
  // bestMag=1, bestVel=velLeft=2.
  // D0l=1, D1l=2, diff=1>0 → pos14 += 1<<16 = 0x10000
  ns.stateDispatch160F6(s, STRUCT, TILE_X, TILE_Y, 0, {
    romByte: (_addr) => 1,
  });
  check("smoke7: position_14 updated (+0x10000)", readL(r, SO + 0x14), 0x10000);
}

// ── Smoke 8: miss → locked (via D2!=0 + charcode not in whitelist) ────────────
{
  const s = makeState();
  const r = s.workRam;
  r[SO + 0x36] = 0x01;
  r[SO + 0x37] = 0x00;
  r[SO + 0x58] = 0x01;   // NOT in whitelist → movAllowed=false, D2!=0 → skip idle branch
  r[0x66c] = 0x01;
  writeW(r, TXO, 2);
  writeW(r, 0x674, 2);
  writeW(r, 0x696, 5); writeW(r, 0x69a, 5);
  writeW(r, 0x698, 0); writeW(r, 0x69c, 0);
  // D5=0: accumXPrev == snapshotX
  writeW(r, SO + 0x2e, 5);
  writeW(r, SO + 0x30, 0);
  let soundCalled = false;
  ns.stateDispatch160F6(s, STRUCT, TILE_X, TILE_Y, 0, {
    soundCommand: (cmd) => { soundCalled = cmd === ns.SOUND_CMD; },
  });
  check("smoke8: state = 2 (miss → locked)", r[SO + 0x36], 0x02);
  check("smoke8: impulse = 0xffffa000 (miss)", readL(r, SO + 0x08), 0xffffa000);
  // charcode=0x01 != 0x12/0x20 → sound emitted
  check("smoke8: sound emitted on miss", soundCalled, true);
}

console.log(`\nSmoke: ${passed} passed, ${failed} failed`);
exit(failed > 0 ? 1 : 0);
