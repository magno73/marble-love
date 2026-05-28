#!/usr/bin/env node
/**
 * test-state-dispatch-160f6-parity.ts — differential FUN_000160F6 vs
 * `stateDispatch160F6`.
 *
 * `FUN_000160F6` (1378 byte, 0x0160F6–0x016658): trackball navigation
 * dispatcher. Updates object movement based on trackball delta
 * e input direzionali.
 *
 * **Stub injection**:
 *   `FUN_000158AC` (sound command) is patched to a thunk logger that
 *   writes the long arg to `0x401E00` and increments the counter at `0x401E04`.
 *   The ROM speed table @ 0x2398c is read directly from the ROM blob
 *   through `romByte`.
 *
 *   Layout stub FUN_158AC (20 byte):
 *     movea.l #0x00401E00, A0    ; 207C 0040 1E00  (6 byte)
 *     move.l  0x00401E04.l, D1   ; 2239 0040 1E04  (6 byte)
 *     move.l  (4,SP), (0,A0,D1) ; nope: usa addq e move sequenziale
 *   Simplify with a fixed-slot log (max 4 calls):
 *     movea.l #0x00401E00, A0         ; 207C 0040 1E00  (6 byte)
 *     move.l  0x00401E04.l, D1        ; 2239 0040 1E04  (6 byte)
 *     move.l  (4,SP), (0,A0,D1.l*1)  ; 20B1 1804       (4 byte)
 *     addq.l  #4, 0x00401E04.l        ; 54B9 0040 1E04  (6 byte)
 *     rts                              ; 4E75             (2 byte)
 *     → totale 24 byte
 *
 * FUN_158AC @ 0x000158AC: size reale ~40 byte → ampiamente abbastanza.
 *
 * **Suites** (4 x 125 = 500 cases):
 *   A: randomly generated D2 (randomized input with varied in-range tile/vel)
 *   B: idle→lock path (D2=0, diff > 0x60000, charcode vari)
 *   C: state 1 (moving) with various dirMask and romByte values
 *   D: edge cases (state 2 lock, charcode outside whitelist, tile boundary)
 *
 * **Zone confrontate**: struct + globals 0x66a–0x682 + sound log
 *   (0x401E00..0x401E07) + counter (0x401E04).
 *
 * Uso: npx tsx packages/cli/src/test-state-dispatch-160f6-parity.ts [N]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import {
  state as stateNs,
  stateDispatch160F6 as ns,
} from "@marble-love/engine";
import {
  createCpu,
  callFunction,
  pokeMem,
  peekMem,
  disposeCpu,
} from "./binary-oracle-lib.js";
import type { CpuSession } from "./binary-oracle-lib.js";

const FUN_ADDR = 0x000160f6;
const FUN_158AC = 0x000158ac;

/** Sound log ring in workRam (max 4 calls × 4 byte = 16 byte). */
const SOUND_LOG_BASE = 0x00401e00;
const SOUND_LOG_CTR  = 0x00401e04; // long counter (next slot byte offset)

/** Struct pointer in workRam. */
const STRUCT_PTR = 0x00401000;
/** Tile-X pointer in workRam. */
const TILE_X_PTR = 0x00401100;
/** Tile-Y pointer in workRam. */
const TILE_Y_PTR = 0x00401200;

const WR_BASE = 0x400000;

/**
 * Patch FUN_158AC a un thunk-logger (24 byte).
 * The thunk writes arg long (4,SP) into ring @ SOUND_LOG_BASE + counter,
 * then increments the counter by 4.
 */
function patchFun158AC(cpu: CpuSession): void {
  const bytes = [
    // movea.l #0x00401E00, A0           (207C 0040 1E00)
    0x20, 0x7c, 0x00, 0x40, 0x1e, 0x00,
    // move.l  0x00401E04.l, D1          (2239 0040 1E04)
    0x22, 0x39, 0x00, 0x40, 0x1e, 0x04,
    // move.l  (4,SP), (0,A0,D1.l*1)    (20B1 1804)
    0x20, 0xb1, 0x18, 0x04,
    // addq.l  #4, 0x00401E04.l          (54B9 0040 1E04)
    0x54, 0xb9, 0x00, 0x40, 0x1e, 0x04,
    // rts                               (4E75)
    0x4e, 0x75,
  ];
  for (let i = 0; i < bytes.length; i++) {
    pokeMem(cpu, FUN_158AC + i, 1, bytes[i]!);
  }
}

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) >>> 0;
    return ((s >>> 16) & 0xffff) / 0x10000;
  };
}

const rb = (rng: () => number): number => Math.floor(rng() * 256) & 0xff;
const rw = (rng: () => number): number => Math.floor(rng() * 0x10000) & 0xffff;
const rl = (rng: () => number): number =>
  ((Math.floor(rng() * 0x10000) << 16) | Math.floor(rng() * 0x10000)) >>> 0;

/** Scrive word BE in cpu + workRam. */
function pokeWordBoth(
  state: ReturnType<typeof stateNs.emptyGameState>,
  cpu: CpuSession,
  abs: number,
  v: number,
): void {
  const u = v & 0xffff;
  const off = abs - WR_BASE;
  pokeMem(cpu, abs,     1, (u >>> 8) & 0xff);
  pokeMem(cpu, abs + 1, 1, u & 0xff);
  state.workRam[off]     = (u >>> 8) & 0xff;
  state.workRam[off + 1] = u & 0xff;
}

/** Scrive long BE in cpu + workRam. */
function pokeLongBoth(
  state: ReturnType<typeof stateNs.emptyGameState>,
  cpu: CpuSession,
  abs: number,
  v: number,
): void {
  const u = v >>> 0;
  const off = abs - WR_BASE;
  const b = [(u >>> 24) & 0xff, (u >>> 16) & 0xff, (u >>> 8) & 0xff, u & 0xff];
  for (let i = 0; i < 4; i++) {
    pokeMem(cpu, abs + i, 1, b[i]!);
    state.workRam[off + i] = b[i]!;
  }
}

/** Scrive byte in cpu + workRam. */
function pokeByteBoth(
  state: ReturnType<typeof stateNs.emptyGameState>,
  cpu: CpuSession,
  abs: number,
  v: number,
): void {
  pokeMem(cpu, abs, 1, v & 0xff);
  state.workRam[abs - WR_BASE] = v & 0xff;
}

/** Reset osservate zones. */
function resetZones(
  state: ReturnType<typeof stateNs.emptyGameState>,
  cpu: CpuSession,
): void {
  // Struct 0x401000..0x40107F
  for (let i = 0; i < 0x80; i++) {
    pokeMem(cpu, STRUCT_PTR + i, 1, 0);
    state.workRam[STRUCT_PTR - WR_BASE + i] = 0;
  }
  // tileX word
  for (let i = 0; i < 2; i++) {
    pokeMem(cpu, TILE_X_PTR + i, 1, 0);
    state.workRam[TILE_X_PTR - WR_BASE + i] = 0;
  }
  // tileY word
  for (let i = 0; i < 2; i++) {
    pokeMem(cpu, TILE_Y_PTR + i, 1, 0);
    state.workRam[TILE_Y_PTR - WR_BASE + i] = 0;
  }
  // Globals 0x400666..0x4006A4 (globals area)
  for (let i = 0x666; i < 0x6A4; i++) {
    pokeMem(cpu, WR_BASE + i, 1, 0);
    state.workRam[i] = 0;
  }
  // Sound log + counter
  for (let i = 0; i < 0x20; i++) {
    pokeMem(cpu, SOUND_LOG_BASE + i, 1, 0);
    state.workRam[SOUND_LOG_BASE - WR_BASE + i] = 0;
  }
}

/** Compare zone [abs..abs+size) between binary and TS workRam. */
function compareZone(
  state: ReturnType<typeof stateNs.emptyGameState>,
  cpu: CpuSession,
  abs: number,
  size: number,
  label: string,
): { offset: number; bin: number; ts: number; label: string } | null {
  for (let i = 0; i < size; i++) {
    const b = peekMem(cpu, abs + i, 1) & 0xff;
    const t = state.workRam[abs - WR_BASE + i] ?? 0;
    if (b !== t) return { offset: i, bin: b, ts: t, label };
  }
  return null;
}

interface FailRecord {
  suite: string;
  tc: number;
  diff: { offset: number; bin: number; ts: number; label: string };
}

async function main(): Promise<void> {
  const total = Number(process.argv[2] ?? "500");
  const perSuite = Math.floor(total / 4);
  const remainder = total - perSuite * 4;

  const romPath = resolve("ghidra_project/marble_program.bin");
  if (!existsSync(romPath)) {
    console.error(`error: ROM blob not found at ${romPath}`);
    exit(3);
  }
  const romBuf = readFileSync(romPath);

  const state = stateNs.emptyGameState();
  const cpu = await createCpu({ rom: romBuf, state });
  patchFun158AC(cpu);

  // TS subs: exact replica of the binary stubs.
  const subs: ns.StateDispatch160F6Subs = {
    soundCommand: (cmd) => {
      // Scrive cmd (long = cmd & 0xFF) nel ring @ SOUND_LOG_BASE + counter
      const r = state.workRam;
      const off = SOUND_LOG_CTR - WR_BASE;
      const ctr =
        (((r[off] ?? 0) << 24) | ((r[off + 1] ?? 0) << 16) |
         ((r[off + 2] ?? 0) << 8) | (r[off + 3] ?? 0)) >>> 0;
      const slot = (SOUND_LOG_BASE - WR_BASE) + ctr;
      const u = (cmd >>> 0);
      r[slot]     = (u >>> 24) & 0xff;
      r[slot + 1] = (u >>> 16) & 0xff;
      r[slot + 2] = (u >>> 8) & 0xff;
      r[slot + 3] = u & 0xff;
      const next = (ctr + 4) >>> 0;
      r[off]     = (next >>> 24) & 0xff;
      r[off + 1] = (next >>> 16) & 0xff;
      r[off + 2] = (next >>> 8) & 0xff;
      r[off + 3] = next & 0xff;
    },
    romByte: (addr) => (romBuf[addr] ?? 0) & 0xff,
  };

  let totalOk = 0;
  const failHolder: { value: FailRecord | null } = { value: null };

  function runCase(
    suite: string,
    tc: number,
    prevTimer: number,
  ): boolean {
    // state and cpu were set up by the caller before invoking this
    callFunction(cpu, FUN_ADDR, [
      STRUCT_PTR >>> 0,
      TILE_X_PTR >>> 0,
      TILE_Y_PTR >>> 0,
      prevTimer >>> 0,
    ]);
    ns.stateDispatch160F6(state, STRUCT_PTR, TILE_X_PTR, TILE_Y_PTR, prevTimer, subs);

    // Compare struct (0x80 byte), globals (0x666..0x6A4), sound log (0x20 byte)
    const checks: Array<[number, number, string]> = [
      [STRUCT_PTR, 0x80, "struct"],
      [WR_BASE + 0x666, 0x3e, "globals"],
      [SOUND_LOG_BASE, 0x20, "sound_log"],
    ];
    for (const [abs, size, label] of checks) {
      const d = compareZone(state, cpu, abs, size, label);
      if (d !== null) {
        if (failHolder.value === null)
          failHolder.value = { suite, tc, diff: d };
        return false;
      }
    }
    return true;
  }

  const rng = makeRng(0x160f6);

  // ── Suite A: movimento normale (D2 generato da input random) ─────────────
  console.log(`\n=== Suite A: D2 random (input vari) — ${perSuite} casi ===`);
  let okA = 0;
  for (let i = 0; i < perSuite; i++) {
    resetZones(state, cpu);
    // Random input bytes
    pokeByteBoth(state, cpu, WR_BASE + 0x66a, rb(rng) & 0x0f);
    pokeByteBoth(state, cpu, WR_BASE + 0x66c, rb(rng) % 4);
    pokeByteBoth(state, cpu, WR_BASE + 0x66e, rb(rng) % 4);
    pokeByteBoth(state, cpu, WR_BASE + 0x670, rb(rng) % 4);
    pokeByteBoth(state, cpu, WR_BASE + 0x672, rb(rng) % 4);
    // vel in [0,3]
    pokeWordBoth(state, cpu, WR_BASE + 0x674, rb(rng) & 0x03);
    pokeWordBoth(state, cpu, WR_BASE + 0x676, rb(rng) & 0x03);
    pokeWordBoth(state, cpu, WR_BASE + 0x678, rb(rng) & 0x03);
    pokeWordBoth(state, cpu, WR_BASE + 0x67a, rb(rng) & 0x03);
    pokeWordBoth(state, cpu, WR_BASE + 0x67c, rb(rng) & 0x03);
    pokeWordBoth(state, cpu, WR_BASE + 0x67e, rb(rng) & 0x03);
    pokeWordBoth(state, cpu, WR_BASE + 0x680, rb(rng) & 0x03);
    pokeWordBoth(state, cpu, WR_BASE + 0x682, rb(rng) & 0x03);
    // tileX/Y random 0..7
    pokeWordBoth(state, cpu, TILE_X_PTR, rb(rng) & 0x07);
    pokeWordBoth(state, cpu, TILE_Y_PTR, rb(rng) & 0x07);
    // accumXPrev/Cur: small delta
    const xPrev = rw(rng) & 0x1f;
    pokeWordBoth(state, cpu, WR_BASE + 0x696, xPrev);
    pokeWordBoth(state, cpu, WR_BASE + 0x69a, xPrev + (rb(rng) % 3) - 1);
    const yPrev = rw(rng) & 0x1f;
    pokeWordBoth(state, cpu, WR_BASE + 0x698, yPrev);
    pokeWordBoth(state, cpu, WR_BASE + 0x69c, yPrev + (rb(rng) % 3) - 1);
    // struct state=0, charcode from whitelist
    const wl = [...ns.CHARCODE_WHITELIST];
    const cc = wl[rb(rng) % wl.length]!;
    pokeByteBoth(state, cpu, STRUCT_PTR + 0x36, 0);
    pokeByteBoth(state, cpu, STRUCT_PTR + 0x58, cc);
    pokeByteBoth(state, cpu, STRUCT_PTR + 0x37, rb(rng));
    pokeLongBoth(state, cpu, STRUCT_PTR + 0x14, rl(rng));
    cpu.system.setRegister("sp", 0x401f00);
    if (runCase("A", i, 0)) okA++;
  }
  console.log(`  Match: ${okA}/${perSuite} = ${((okA / perSuite) * 100).toFixed(1)}%`);
  totalOk += okA;

  // ── Suite B: idle→lock (D2=0, diff > 0x60000) ─────────────────────────
  console.log(`\n=== Suite B: idle→lock (diff > 0x60000) — ${perSuite} casi ===`);
  let okB = 0;
  for (let i = 0; i < perSuite; i++) {
    resetZones(state, cpu);
    // Tutti gli input = 0 → D2=0
    // pos14 > prevTimer + 0x60000
    const prevT = rl(rng) & 0x0fffffff;
    const pos14 = (prevT + 0x70000 + (rl(rng) & 0xffff)) >>> 0;
    pokeLongBoth(state, cpu, STRUCT_PTR + 0x14, pos14);
    const wl = [...ns.CHARCODE_WHITELIST];
    const cc = wl[rb(rng) % wl.length]!;
    pokeByteBoth(state, cpu, STRUCT_PTR + 0x58, cc);
    pokeByteBoth(state, cpu, STRUCT_PTR + 0x36, 0x00);
    pokeWordBoth(state, cpu, WR_BASE + 0x696, rw(rng) & 0x1f);
    pokeWordBoth(state, cpu, WR_BASE + 0x698, rw(rng) & 0x1f);
    cpu.system.setRegister("sp", 0x401f00);
    if (runCase("B", i, prevT)) okB++;
  }
  console.log(`  Match: ${okB}/${perSuite} = ${((okB / perSuite) * 100).toFixed(1)}%`);
  totalOk += okB;

  // Suite C: state 1 (moving), D5/D6 in {0,1}, random dirMask.
  console.log(`\n=== Suite C: stato 1 moving, inner loop — ${perSuite} casi ===`);
  let okC = 0;
  for (let i = 0; i < perSuite; i++) {
    resetZones(state, cpu);
    pokeByteBoth(state, cpu, STRUCT_PTR + 0x36, 0x01);
    const dirMask = rb(rng);
    pokeByteBoth(state, cpu, STRUCT_PTR + 0x37, dirMask);
    pokeByteBoth(state, cpu, STRUCT_PTR + 0x58, 0x20);
    // D5 ∈ {0,1}: accumXPrev = snapshotX + {0,1}
    const snapX = rw(rng) & 0xff;
    const deltaX = rb(rng) & 0x01;
    const accumXPrev = (snapX + deltaX) & 0xffff;
    pokeWordBoth(state, cpu, WR_BASE + 0x696, accumXPrev);
    pokeWordBoth(state, cpu, STRUCT_PTR + 0x2e, snapX);
    // D6 ∈ {0,1}
    const snapY = rw(rng) & 0xff;
    const deltaY = rb(rng) & 0x01;
    const accumYPrev = (snapY + deltaY) & 0xffff;
    pokeWordBoth(state, cpu, WR_BASE + 0x698, accumYPrev);
    pokeWordBoth(state, cpu, STRUCT_PTR + 0x30, snapY);
    // vel words (non-zero)
    pokeWordBoth(state, cpu, WR_BASE + 0x674, rw(rng) & 0xff);
    pokeWordBoth(state, cpu, WR_BASE + 0x676, rw(rng) & 0xff);
    pokeWordBoth(state, cpu, WR_BASE + 0x678, rw(rng) & 0xff);
    pokeWordBoth(state, cpu, WR_BASE + 0x67a, rw(rng) & 0xff);
    pokeWordBoth(state, cpu, WR_BASE + 0x67c, rw(rng) & 0xff);
    pokeWordBoth(state, cpu, WR_BASE + 0x67e, rw(rng) & 0xff);
    pokeWordBoth(state, cpu, WR_BASE + 0x680, rw(rng) & 0xff);
    pokeWordBoth(state, cpu, WR_BASE + 0x682, rw(rng) & 0xff);
    // tileX/Y random 0..7
    pokeWordBoth(state, cpu, TILE_X_PTR, rb(rng) & 0x07);
    pokeWordBoth(state, cpu, TILE_Y_PTR, rb(rng) & 0x07);
    pokeLongBoth(state, cpu, STRUCT_PTR + 0x14, rl(rng));
    cpu.system.setRegister("sp", 0x401f00);
    if (runCase("C", i, 0)) okC++;
  }
  console.log(`  Match: ${okC}/${perSuite} = ${((okC / perSuite) * 100).toFixed(1)}%`);
  totalOk += okC;

  // Suite D: edge cases (state 2, charcode outside whitelist, etc.).
  const sizeD = perSuite + remainder;
  console.log(`\n=== Suite D: edge cases — ${sizeD} casi ===`);
  let okD = 0;
  for (let i = 0; i < sizeD; i++) {
    resetZones(state, cpu);
    const scenario = i % 4;
    if (scenario === 0) {
      // state 2 (locked), D2=0 -> no-op.
      pokeByteBoth(state, cpu, STRUCT_PTR + 0x36, 0x02);
      pokeLongBoth(state, cpu, STRUCT_PTR + 0x08, rl(rng));
    } else if (scenario === 1) {
      // charcode non in whitelist, D2 != 0
      pokeByteBoth(state, cpu, STRUCT_PTR + 0x36, 0x00);
      pokeByteBoth(state, cpu, STRUCT_PTR + 0x58, 0x01); // not whitelisted
      pokeByteBoth(state, cpu, WR_BASE + 0x66c, 0x01);  // Left active
      pokeWordBoth(state, cpu, WR_BASE + 0x674, 2);
      pokeWordBoth(state, cpu, TILE_X_PTR, 2);
    } else if (scenario === 2) {
      // state 1, D5=0, dirMask=0 -> lock.
      pokeByteBoth(state, cpu, STRUCT_PTR + 0x36, 0x01);
      pokeByteBoth(state, cpu, STRUCT_PTR + 0x37, 0x00);
      pokeByteBoth(state, cpu, STRUCT_PTR + 0x58, 0x17);
      pokeWordBoth(state, cpu, WR_BASE + 0x696, 0);
      pokeWordBoth(state, cpu, STRUCT_PTR + 0x2e, 0);
      pokeWordBoth(state, cpu, WR_BASE + 0x698, 0);
      pokeWordBoth(state, cpu, STRUCT_PTR + 0x30, 0);
    } else {
      // charcode 0x12/0x20 → no sound on lock
      pokeByteBoth(state, cpu, STRUCT_PTR + 0x36, 0x00);
      pokeByteBoth(state, cpu, STRUCT_PTR + 0x58, [0x12, 0x20][i % 2]!);
      pokeLongBoth(state, cpu, STRUCT_PTR + 0x14, 0x70000);
    }
    cpu.system.setRegister("sp", 0x401f00);
    if (runCase("D", i, 0)) okD++;
  }
  console.log(`  Match: ${okD}/${sizeD} = ${((okD / sizeD) * 100).toFixed(1)}%`);
  totalOk += okD;

  console.log(
    `\n=== TOTALE: ${totalOk}/${total} = ${((totalOk / total) * 100).toFixed(1)}% ===`,
  );
  if (failHolder.value !== null) {
    const f = failHolder.value;
    console.log(
      `  First fail (suite ${f.suite} tc=${f.tc}): ` +
      `${f.diff.label}+0x${f.diff.offset.toString(16)} ` +
      `bin=0x${f.diff.bin.toString(16)} ts=0x${f.diff.ts.toString(16)}`,
    );
  }

  disposeCpu(cpu);
  exit(totalOk === total ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  exit(1);
});
