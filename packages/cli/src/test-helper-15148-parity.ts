#!/usr/bin/env node
/**
 * test-helper-15148-parity.ts — differential parity test:
 * `FUN_00015148` (M68k via musashi-wasm) vs `helper15148` (TS replica).
 *
 * ## Strategy
 *
 * All sub-calls (FUN_15460, FUN_15670, FUN_158AC, FUN_15884, FUN_1BB08,
 * FUN_1CC62, FUN_25BAE, FUN_25E7C, FUN_14DEC) are patched to `rts` in
 * Musashi and replaced with no-op stubs in TS, isolating FUN_15148's own
 * struct mutations.
 *
 * ## Comparison
 *
 * Full struct bytes (0x60 bytes at structPtr) compared between binary and TS.
 *
 * ## Suites (5 × 100 = 500 cases)
 *
 *   A: kind 0 — waypoint NOT reached
 *   B: kind 0 — waypoint IS reached (curr_anim != 0x20C18)
 *   C: kind 1 — velocity computation
 *   D: kind 2 — vectorScale patched (vel=0 → kind=4 path)
 *   E: kinds 3,4,5,6
 *
 * Usage: npx tsx packages/cli/src/test-helper-15148-parity.ts [N=500]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import {
  state as stateNs,
  bus as busNs,
  helper15148 as ns,
} from "@marble-love/engine";
import type { RomImage } from "@marble-love/engine";
import {
  createCpu,
  callFunction,
  pokeMem,
  peekMem,
  disposeCpu,
} from "./binary-oracle-lib.js";
import type { CpuSession } from "./binary-oracle-lib.js";

const FUN_15148 = 0x00015148;
const FUN_15460 = 0x00015460;
const FUN_15670 = 0x00015670;
const FUN_158AC = 0x000158ac;
const FUN_15884 = 0x00015884;
const FUN_1BB08 = 0x0001bb08;
const FUN_1CC62 = 0x0001cc62;
const FUN_25BAE = 0x00025bae;
const FUN_25E7C = 0x00025e7c;
const FUN_14DEC = 0x00014dec;

const WRAM          = 0x00400000;
const STRUCT_STRIDE = 0x60;
const STRUCT_BASE   = 0x00401800;
const STRUCT_COUNT  = 4;

// Data areas (safe from struct and sp conflict)
const WP_DATA_AREA  = 0x00401a00; // waypoint/target data
const OBJ_BASE      = 0x00400018; // object array (first entry)
const SP_INIT       = 0x00401ff0; // stack pointer (top of workRam area)

// ─── Stub utilities ───────────────────────────────────────────────────────────

function applyRts(cpu: CpuSession, addr: number): void {
  pokeMem(cpu, addr, 1, 0x4e);
  pokeMem(cpu, addr + 1, 1, 0x75);
}

function applyAllStubs(cpu: CpuSession): void {
  applyRts(cpu, FUN_15460);
  applyRts(cpu, FUN_15670);
  applyRts(cpu, FUN_158AC);
  applyRts(cpu, FUN_15884);
  applyRts(cpu, FUN_1BB08);
  applyRts(cpu, FUN_1CC62);
  applyRts(cpu, FUN_25BAE);
  applyRts(cpu, FUN_25E7C);
  applyRts(cpu, FUN_14DEC);
}

// ─── RNG ──────────────────────────────────────────────────────────────────────

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1103515245) + 12345) >>> 0;
    return ((s >>> 16) & 0xffff) / 0x10000;
  };
}

// ─── Memory helpers (write to BOTH binary and TS state) ───────────────────────

type State = ReturnType<typeof stateNs.emptyGameState>;

function poke1(state: State, cpu: CpuSession, addr: number, v: number): void {
  const u = v & 0xff;
  pokeMem(cpu, addr, 1, u);
  state.workRam[addr - WRAM] = u;
}

function poke4(state: State, cpu: CpuSession, addr: number, v: number): void {
  const u = v >>> 0;
  pokeMem(cpu, addr, 4, u);
  const o = addr - WRAM;
  state.workRam[o]     = (u >>> 24) & 0xff;
  state.workRam[o + 1] = (u >>> 16) & 0xff;
  state.workRam[o + 2] = (u >>> 8)  & 0xff;
  state.workRam[o + 3] =  u         & 0xff;
}

// ─── State comparison ─────────────────────────────────────────────────────────

interface Diff { what: string; bin: number; ts: number; }

function compareStruct(state: State, cpu: CpuSession, structPtr: number): Diff | null {
  for (let i = 0; i < STRUCT_STRIDE; i++) {
    const binVal = peekMem(cpu, structPtr + i, 1);
    const tsVal  = state.workRam[structPtr - WRAM + i] ?? 0;
    if (binVal !== tsVal) {
      return { what: `struct[0x${i.toString(16).padStart(2, "0")}]`, bin: binVal, ts: tsVal };
    }
  }
  return null;
}

// ─── Test runner ──────────────────────────────────────────────────────────────

interface FailRecord { suite: string; i: number; structPtr: number; kind: number; diff: Diff; }

async function main(): Promise<void> {
  const total    = Number(process.argv[2] ?? "500");
  const perSuite = Math.floor(total / 5);

  const romPath = resolve("ghidra_project/marble_program.bin");
  if (!existsSync(romPath)) { console.error(`error: ROM not found at ${romPath}`); exit(3); }
  const romBuf = readFileSync(romPath);

  const stateInst = stateNs.emptyGameState();
  const cpu = await createCpu({ rom: romBuf, state: stateInst });
  applyAllStubs(cpu);

  const tsRom: RomImage = busNs.emptyRomImage();
  tsRom.program.set(romBuf.subarray(0, tsRom.program.length));

  const rng = makeRng(0x15148_15148);
  const failHolder: { value: FailRecord | null } = { value: null };
  let totalOk = 0;

  function rb(): number { return Math.floor(rng() * 256); }
  function rl32(): number { return (rb() | (rb() << 8) | (rb() << 16) | (rb() << 24)) >>> 0; }
  function pickStruct(): number { return STRUCT_BASE + Math.floor(rng() * STRUCT_COUNT) * STRUCT_STRIDE; }

  /** Zero all struct slots in binary and TS. */
  function clearAll(): void {
    for (let i = 0; i < STRUCT_COUNT; i++) {
      const base = STRUCT_BASE + i * STRUCT_STRIDE;
      for (let j = 0; j < STRUCT_STRIDE; j++) {
        pokeMem(cpu, base + j, 1, 0);
        stateInst.workRam[base - WRAM + j] = 0;
      }
    }
    // Clear data area (waypoint/target/obj)
    for (let j = 0; j < 0x100; j++) {
      pokeMem(cpu, WP_DATA_AREA + j, 1, 0);
      stateInst.workRam[WP_DATA_AREA - WRAM + j] = 0;
    }
    for (let j = 0; j < 0x60; j++) {
      pokeMem(cpu, OBJ_BASE + j, 1, 0);
      stateInst.workRam[OBJ_BASE - WRAM + j] = 0;
    }
  }

  /**
   * Run one test: setup via `setup()` (writes to both binary and TS), then
   * run binary and TS, compare struct.
   */
  function runOne(suite: string, i: number, sPtr: number, kind: number, setup: () => void): number {
    clearAll();
    cpu.system.setRegister("sp", SP_INIT);
    setup();
    // Run binary
    callFunction(cpu, FUN_15148, [sPtr >>> 0]);
    // Run TS
    ns.helper15148(stateInst, tsRom, sPtr, {
      fun_15460: (_s, _sp) => undefined,
      fun_15670: (_s, _sp) => undefined,
      fun_158ac: (_s, _cmd) => undefined,
      fun_15884: (_s) => undefined,
      fun_1bb08: (_s, _a) => undefined,
      fun_1cc62: (_s, _a) => 0,
      fun_25bae: (_s, _a, _c) => undefined,
      fun_25e7c: (_s, _r, _a, _m) => undefined,
      fun_14dec: (_s, _a) => undefined,
    });
    const diff = compareStruct(stateInst, cpu, sPtr);
    if (diff !== null && failHolder.value === null) {
      failHolder.value = { suite, i, structPtr: sPtr, kind, diff };
    }
    return diff === null ? 1 : 0;
  }

  // ─── Suite A: kind=0, waypoint NOT reached ────────────────────────────────
  console.log(`\n=== Suite A: kind=0 waypoint not reached — ${perSuite} casi ===`);
  let okA = 0;
  for (let i = 0; i < perSuite; i++) {
    const sPtr = pickStruct();
    okA += runOne("A", i, sPtr, 0, () => {
      poke1(stateInst, cpu, sPtr + 0x1a, 0);

      const posX = rl32();
      const posY = rl32();
      poke4(stateInst, cpu, sPtr + 0x0c, posX);
      poke4(stateInst, cpu, sPtr + 0x10, posY);

      // cellX/Y from posX/Y >> 19
      const cellX = ((posX | 0) >> 19) & 0xff;
      const cellY = ((posY | 0) >> 19) & 0xff;

      // Waypoint at WP_DATA_AREA: x DIFFERS from cellX
      const wpPtr = WP_DATA_AREA;
      const wpX = (cellX + 1 + rb()) & 0xff; // ensure different
      const wpY = (cellY + 1 + rb()) & 0xff;
      poke1(stateInst, cpu, wpPtr + 0, wpX);
      poke1(stateInst, cpu, wpPtr + 1, wpY);
      poke1(stateInst, cpu, wpPtr + 2, rb() & 0x03);
      poke4(stateInst, cpu, sPtr + 0x4e, wpPtr);

      // Secondary target at WP_DATA_AREA+4: also differs
      const tpPtr = WP_DATA_AREA + 4;
      poke1(stateInst, cpu, tpPtr + 0, (cellX + 2 + rb()) & 0xff);
      poke1(stateInst, cpu, tpPtr + 1, (cellY + 2 + rb()) & 0xff);
      poke1(stateInst, cpu, tpPtr + 2, rb() & 0x03);
      poke4(stateInst, cpu, sPtr + 0x4a, tpPtr);

      // curr_anim != 0x20C18
      poke4(stateInst, cpu, sPtr + 0x5c, 0x00020c00 + rb() * 4);
    });
  }
  console.log(`  Match: ${okA}/${perSuite} = ${((okA / perSuite) * 100).toFixed(1)}%`);
  totalOk += okA;

  // ─── Suite B: kind=0, waypoint IS reached ────────────────────────────────
  console.log(`\n=== Suite B: kind=0 waypoint reached — ${perSuite} casi ===`);
  let okB = 0;
  for (let i = 0; i < perSuite; i++) {
    const sPtr = pickStruct();
    okB += runOne("B", i, sPtr, 0, () => {
      // kind can be 0,1,2,3 (we'll write 0 for simplicity)
      const kindByte = rb() % 4;
      poke1(stateInst, cpu, sPtr + 0x1a, kindByte);

      // Make pos encode specific cell (small values for clarity)
      const cellX = (rb() & 0x1f) - 16; // -16..15
      const cellY = (rb() & 0x1f) - 16;
      poke4(stateInst, cpu, sPtr + 0x0c, (cellX << 19) >>> 0);
      poke4(stateInst, cpu, sPtr + 0x10, (cellY << 19) >>> 0);

      // Waypoint MATCHES current cell
      const wpPtr = WP_DATA_AREA;
      poke1(stateInst, cpu, wpPtr + 0, cellX & 0xff);
      poke1(stateInst, cpu, wpPtr + 1, cellY & 0xff);
      poke1(stateInst, cpu, wpPtr + 2, rb() & 0x07);
      poke4(stateInst, cpu, sPtr + 0x4e, wpPtr);

      // curr_anim != 0x20C18 (triggers full update path)
      poke4(stateInst, cpu, sPtr + 0x5c, 0x00020c00);

      // Secondary target (4a): at WP_DATA_AREA+0x10
      const tpPtr = WP_DATA_AREA + 0x10;
      poke1(stateInst, cpu, tpPtr + 0, (cellX + 1) & 0xff);
      poke1(stateInst, cpu, tpPtr + 1, (cellY + 1) & 0xff);
      poke1(stateInst, cpu, tpPtr + 2, rb() & 0x03);
      poke4(stateInst, cpu, sPtr + 0x4a, tpPtr);
    });
  }
  console.log(`  Match: ${okB}/${perSuite} = ${((okB / perSuite) * 100).toFixed(1)}%`);
  totalOk += okB;

  // ─── Suite C: kind=1, velocity computation ───────────────────────────────
  console.log(`\n=== Suite C: kind=1 velocity toward target — ${perSuite} casi ===`);
  let okC = 0;
  for (let i = 0; i < perSuite; i++) {
    const sPtr = pickStruct();
    okC += runOne("C", i, sPtr, 1, () => {
      poke1(stateInst, cpu, sPtr + 0x1a, 1);
      // Use index 0 → ROM table[0x1eff6+0] = 0x00400018
      poke1(stateInst, cpu, sPtr + 0x56, 0);
      poke1(stateInst, cpu, sPtr + 0x57, 0);

      // Target obj @ 0x400018
      const tPosX = rl32();
      const tPosY = rl32();
      poke4(stateInst, cpu, OBJ_BASE + 0x0c, tPosX);
      poke4(stateInst, cpu, OBJ_BASE + 0x10, tPosY);

      // Self pos: close to target (diff in cell coordinates 0..63)
      const selfPosX = (tPosX + ((rb() & 0x3f) << 19)) >>> 0;
      const selfPosY = (tPosY + ((rb() & 0x3f) << 19)) >>> 0;
      poke4(stateInst, cpu, sPtr + 0x0c, selfPosX);
      poke4(stateInst, cpu, sPtr + 0x10, selfPosY);
    });
  }
  console.log(`  Match: ${okC}/${perSuite} = ${((okC / perSuite) * 100).toFixed(1)}%`);
  totalOk += okC;

  // ─── Suite D: kind=2, vel=0 → kind=4 path ────────────────────────────────
  console.log(`\n=== Suite D: kind=2 vel=0 → kind=4 — ${perSuite} casi ===`);
  let okD = 0;
  for (let i = 0; i < perSuite; i++) {
    const sPtr = pickStruct();
    okD += runOne("D", i, sPtr, 2, () => {
      poke1(stateInst, cpu, sPtr + 0x1a, 2);
      // VX=0, VY=0 (vectorScale is patched to rts → stays 0 → kind=4 path)
      poke4(stateInst, cpu, sPtr + 0x00, 0);
      poke4(stateInst, cpu, sPtr + 0x04, 0);
    });
  }
  console.log(`  Match: ${okD}/${perSuite} = ${((okD / perSuite) * 100).toFixed(1)}%`);
  totalOk += okD;

  // ─── Suite E: kinds 3, 4, 5, 6 ────────────────────────────────────────────
  const perE = total - perSuite * 4;
  console.log(`\n=== Suite E: kinds 3/4/5/6 — ${perE} casi ===`);
  let okE = 0;
  for (let i = 0; i < perE; i++) {
    const kindChoices = [3, 4, 5, 6];
    const kind = kindChoices[Math.floor(rng() * kindChoices.length)]!;
    const sPtr = pickStruct();
    okE += runOne("E", i, sPtr, kind, () => {
      poke1(stateInst, cpu, sPtr + 0x1a, kind);

      const posX = rl32();
      const posY = rl32();
      poke4(stateInst, cpu, sPtr + 0x0c, posX);
      poke4(stateInst, cpu, sPtr + 0x10, posY);

      if (kind === 5) {
        // (0x56,sPtr).w = 0 → index 0 → 0x400018
        poke1(stateInst, cpu, sPtr + 0x56, 0);
        poke1(stateInst, cpu, sPtr + 0x57, 0);
      }

      if (kind === 3) {
        // Same as kind=0 but with random waypoints (unlikely to match cellX)
        const wpPtr = WP_DATA_AREA;
        poke1(stateInst, cpu, wpPtr + 0, rb());
        poke1(stateInst, cpu, wpPtr + 1, rb());
        poke1(stateInst, cpu, wpPtr + 2, rb() & 0x03);
        poke4(stateInst, cpu, sPtr + 0x4e, wpPtr);
        const tpPtr = WP_DATA_AREA + 0x10;
        poke1(stateInst, cpu, tpPtr + 0, rb());
        poke1(stateInst, cpu, tpPtr + 1, rb());
        poke1(stateInst, cpu, tpPtr + 2, rb() & 0x03);
        poke4(stateInst, cpu, sPtr + 0x4a, tpPtr);
        poke4(stateInst, cpu, sPtr + 0x5c, 0x00020c00 + rb() * 4);
      }
    });
  }
  console.log(`  Match: ${okE}/${perE} = ${((okE / perE) * 100).toFixed(1)}%`);
  totalOk += okE;

  // ─── Summary ──────────────────────────────────────────────────────────────
  console.log(`\n=== TOTALE: ${totalOk}/${total} = ${((totalOk / total) * 100).toFixed(2)}% ===`);

  if (failHolder.value !== null) {
    const f = failHolder.value;
    console.error(`\nPRIMO FAIL: suite=${f.suite} caso=${f.i} structPtr=0x${f.structPtr.toString(16)} kind=${f.kind}`);
    console.error(`  diff: ${f.diff.what} bin=0x${f.diff.bin.toString(16)} ts=0x${f.diff.ts.toString(16)}`);
  }

  disposeCpu(cpu);

  if (totalOk < total) {
    console.error(`\nPARITY FAIL: ${total - totalOk} casi falliti su ${total}`);
    exit(1);
  }

  console.log("\nAll parity checks passed.");
}

main().catch((err: unknown) => { console.error(err); exit(1); });
