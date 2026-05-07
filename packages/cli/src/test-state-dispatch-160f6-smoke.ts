#!/usr/bin/env node
/**
 * test-state-dispatch-160f6-smoke.ts — smoke tests per `stateDispatch160F6`.
 *
 * Verifica le invarianti fondamentali di `FUN_000160F6` (1378 byte) senza
 * ROM binaria:
 *   1. D2 == 0, stato idle, diff <= 0x60000 → no scritture (no-op).
 *   2. D2 == 0, stato idle, diff > 0x60000 → idle→locked (stato 0x02,
 *      snapshot salvate, impulso scritto, sound emesso).
 *   3. D2 != 0, charcode non in whitelist → stato invariato (no-op).
 *   4. D2 != 0 (Left), charcode 0x20 (in whitelist) → stato 1, dir=1,
 *      snapshot aggiornate, impulso scritto.
 *   5. Stato già 2 (locked), D2 == 0 → nessuna modifica (protezione lock).
 *   6. Stato 1 (moving), D5/D6 >= 2 → no velocity update (early-exit loop).
 *   7. Stato 1, D5/D6 < 2, bit 0 in dirMask, romByte restituisce valore > 0
 *      → position_14 aggiornato.
 *   8. Stato 1, A1 == -1 dopo loop (nessun bit in dirMask) → transizione lock.
 *
 * Uso: npx tsx packages/cli/src/test-state-dispatch-160f6-smoke.ts
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

// ── Smoke 1: D2==0, diff <= 0x60000, stato idle → no-op ─────────────────────
{
  const s = makeState();
  const r = s.workRam;
  // Tutti i delta e input a 0 → D2=0
  // pos14=0, prevTimer=0 → diff=0 <= 0x60000
  r[SO + 0x36] = 0x00;
  r[SO + 0x58] = 0x20;
  writeL(r, SO + 0x14, 0);
  ns.stateDispatch160F6(s, STRUCT, TILE_X, TILE_Y, 0);
  check("smoke1: stato rimane 0", r[SO + 0x36], 0x00);
  check("smoke1: impulso rimane 0", readL(r, SO + 0x08), 0);
}

// ── Smoke 2: D2==0, diff > 0x60000 → idle→locked ────────────────────────────
{
  const s = makeState();
  const r = s.workRam;
  r[SO + 0x36] = 0x00;
  r[SO + 0x58] = 0x17; // in whitelist ma non 0x12/0x20 → sound
  // pos14 = 0x70000, prevTimer = 0 → diff = 0x70000 > 0x60000
  writeL(r, SO + 0x14, 0x70000);
  // Scrivi snapshot accumulator @0x400696/0x400698
  writeW(r, 0x696, 0x0003); // accumXPrev word
  writeW(r, 0x698, 0x0007); // accumYPrev word
  let soundCalled = false;
  ns.stateDispatch160F6(s, STRUCT, TILE_X, TILE_Y, 0, {
    soundCommand: (cmd) => { soundCalled = cmd === ns.SOUND_CMD; },
  });
  check("smoke2: stato = 2 (locked)", r[SO + 0x36], 0x02);
  check("smoke2: impulso = 0xffffa000", readL(r, SO + 0x08), 0xffffa000);
  check("smoke2: snapshotX salvato", readW(r, SO + 0x2e), 0x0003);
  check("smoke2: snapshotY salvato", readW(r, SO + 0x30), 0x0007);
  check("smoke2: sound emesso", soundCalled, true);
}

// ── Smoke 3: D2 != 0, charcode NON in whitelist → no-op ──────────────────────
{
  const s = makeState();
  const r = s.workRam;
  r[SO + 0x36] = 0x00;
  r[SO + 0x58] = 0x01; // non in whitelist
  // Attiva input Left: *0x40066c = 1 (<3), tileX=3 (<4), D3=0(!=1), velLeft=2 (in [0,3])
  r[0x66c] = 0x01;
  writeW(r, TXO, 3);  // tileX = 3
  writeW(r, 0x674, 2); // velLeft = 2
  // accumXPrev=accumXCur=0 → D3=0
  ns.stateDispatch160F6(s, STRUCT, TILE_X, TILE_Y, 0);
  check("smoke3: stato rimane 0 (charcode non in whitelist)", r[SO + 0x36], 0x00);
}

// ── Smoke 4: D2 != 0 (Left), charcode 0x20 → stato 1, dir=1 ─────────────────
{
  const s = makeState();
  const r = s.workRam;
  r[SO + 0x36] = 0x00;
  r[SO + 0x58] = 0x20; // in whitelist
  r[SO + 0x37] = 0xff; // dir corrente diverso da D2=1 → trigger aggiornamento
  // Attiva input Left
  r[0x66c] = 0x01;
  writeW(r, TXO, 3);   // tileX = 3 (< 4)
  writeW(r, 0x674, 2); // velLeft = 2
  writeW(r, 0x696, 0x0010); // accumXPrev snapshot
  writeW(r, 0x698, 0x0020); // accumYPrev snapshot
  ns.stateDispatch160F6(s, STRUCT, TILE_X, TILE_Y, 0);
  check("smoke4: stato = 1 (moving)", r[SO + 0x36], 0x01);
  check("smoke4: dirMask = 1 (Left)", r[SO + 0x37], 0x01);
  check("smoke4: impulso = 0xffffa000", readL(r, SO + 0x08), 0xffffa000);
  check("smoke4: snapshotX = accumXPrev", readW(r, SO + 0x2e), 0x0010);
  check("smoke4: snapshotY = accumYPrev", readW(r, SO + 0x30), 0x0020);
}

// ── Smoke 5: stato 2 (locked), D2==0 → nessuna modifica ──────────────────────
{
  const s = makeState();
  const r = s.workRam;
  r[SO + 0x36] = 0x02;  // locked
  writeL(r, SO + 0x08, 0xdeadbeef);
  ns.stateDispatch160F6(s, STRUCT, TILE_X, TILE_Y, 0);
  check("smoke5: stato rimane 2", r[SO + 0x36], 0x02);
  check("smoke5: impulso non modificato", readL(r, SO + 0x08), 0xdeadbeef >>> 0);
}

// ── Smoke 6: stato 1, D5/D6 >= 2 → early exit dal loop ──────────────────────
{
  const s = makeState();
  const r = s.workRam;
  r[SO + 0x36] = 0x01;   // moving
  r[SO + 0x37] = 0x01;   // dirMask = Left
  // Forza D5 >= 2: accumXPrev=0, snapshotX=5 → rawD5 = -5 → abs=5 >= 2
  writeW(r, 0x696, 0);   // accumXPrev
  writeW(r, SO + 0x2e, 5); // snapshotX = 5
  writeW(r, 0x698, 0);
  writeW(r, SO + 0x30, 0);
  writeL(r, SO + 0x14, 0xCAFEBABE);
  ns.stateDispatch160F6(s, STRUCT, TILE_X, TILE_Y, 0);
  check("smoke6: position_14 non modificato (D5>=2 early exit)", readL(r, SO + 0x14), 0xCAFEBABE >>> 0);
}

// ── Smoke 7: stato 1, D2 matches dir37 (skip update), inner loop → update ─────
// Per raggiungere l'inner loop con stato=1 bisogna che movAllowed=true e dir37==D2.
// Setup: input Left attivo (D2=1), dirMask=1, stato=1 → dir37==D2 → skip update.
{
  const s = makeState();
  const r = s.workRam;
  r[SO + 0x36] = 0x01;
  r[SO + 0x37] = 0x01;   // bit0 = Left (dir già aggiornata = D2)
  r[SO + 0x58] = 0x20;
  // Input Left attivo → D2=1 (bit0)
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
  check("smoke7: position_14 aggiornato (+0x10000)", readL(r, SO + 0x14), 0x10000);
}

// ── Smoke 8: miss → locked (via D2!=0 + charcode non in whitelist) ────────────
// Il path "miss" (no candidato → lock) richiede stato=1 e dirMask=0.
// Per avere stato=1 con dirMask=0 e D2!=0: charcode NON in whitelist con D2!=0
// → il ramo "else { if D2!=0: skip }" non modifica lo stato.
// Allora la check state==1 passa → inner loop con dirMask=0 → nessun candidato.
{
  const s = makeState();
  const r = s.workRam;
  r[SO + 0x36] = 0x01;   // stato = 1 (pre-existing)
  r[SO + 0x37] = 0x00;   // dirMask = 0 → nessun candidato nel loop
  r[SO + 0x58] = 0x01;   // NOT in whitelist → movAllowed=false, D2!=0 → skip idle branch
  // Input Left attivo → D2=1
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
  check("smoke8: stato = 2 (miss → locked)", r[SO + 0x36], 0x02);
  check("smoke8: impulso = 0xffffa000 (miss)", readL(r, SO + 0x08), 0xffffa000);
  // charcode=0x01 != 0x12/0x20 → sound emesso
  check("smoke8: sound emesso su miss", soundCalled, true);
}

console.log(`\nSmoke: ${passed} passed, ${failed} failed`);
exit(failed > 0 ? 1 : 0);
