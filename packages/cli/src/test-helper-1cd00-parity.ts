#!/usr/bin/env node
/**
 * test-helper-1cd00-parity.ts — differential FUN_0001CD00 vs `helper1CD00`.
 *
 * `FUN_0001CD00` (874 byte): "Marble-vs-wall 3D bbox collision + velocity
 * response". Dato puntatore entity (A2), puntatore shape-source (A1), e
 * indice shape (D1.b 0..6 o 0xFF), effettua hit-test 3D e risponde con
 * rimbalzo / kill o no-op.
 *
 * **Strategia stub** (sub callee stubbed a RTS per parity deterministica):
 *   - `FUN_0001216A` (absLong): stub → RTS; TS: usa `defaultAbsLong` interno.
 *     NOTE: con RTS stub D0 non viene aggiornato da absLong, quindi il check
 *     cmpi.l #$100000 confronta il vecchio D0 (= indice*4 dal lookup tabella
 *     nella maggior parte dei casi, o altro residuo). Per semplicità, questo
 *     test evita i casi dove mode36==2, lasciando absLong no-stubbed (le due
 *     implementazioni sono equivalenti purché absLong non abbia side effects,
 *     il che è corretto).
 *   - `FUN_00015884` (soundPair): stub → RTS; TS: no-op.
 *   - `FUN_000158AC` (soundCmdSend): stub → RTS; TS: no-op.
 *   - `FUN_00015BD0` (stateSub15BD0): stub → RTS; TS: no-op.
 *   - `FUN_00025BAE` (objectStateEntry25BAE): stub → RTS; TS: no-op.
 *
 * **Compare range** per ogni test:
 *   - `entity[0..0x5F]` (96 byte): velocità + copia globali + flag kill
 *   - return value `D0` (long)
 *
 * **Suite** (500 casi, 4 × 125):
 *   - A: random globali/entity/shape-source, index 0..6 casuale.
 *   - B: index = 0xFF → sempre early-exit return 0.
 *   - C: forzato per essere in-bbox (hit garantito set 1) con index 0..6.
 *   - D: entity speciali (0x400018, 0x4000FA) + varie configurazioni edge.
 *
 * Uso: npx tsx packages/cli/src/test-helper-1cd00-parity.ts [N]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import {
  state as stateNs,
  helper1CD00 as ns,
} from "@marble-love/engine";
import {
  createCpu,
  callFunction,
  pokeMem,
  peekMem,
  disposeCpu,
} from "./binary-oracle-lib.js";
import type { CpuSession } from "./binary-oracle-lib.js";

const FUN_1CD00 = 0x0001cd00;
const FUN_15884 = 0x00015884;
const FUN_158AC = 0x000158ac;
const FUN_15BD0 = 0x00015bd0;
const FUN_25BAE = 0x00025bae;

// ─── Memory layout ─────────────────────────────────────────────────────────

/** Entity struct for most tests (workRam absolute address). */
const ENTITY_BASE = 0x00401000;
/** Entity struct compare size. */
const ENTITY_COMPARE_SIZE = 0x60;

/** Shape-source struct (A1 argument). */
const SHAPE_SRC_BASE = 0x00401100;
const SHAPE_SRC_SIZE = 0x20;

/** Globals region: 0x400684..0x400695 (normals + world pos). */
const GLOBALS_BASE = 0x00400684;
const GLOBALS_SIZE = 0x12;

// ─── Stub patching ─────────────────────────────────────────────────────────

function patchRts(cpu: CpuSession, addr: number): void {
  pokeMem(cpu, addr + 0, 1, 0x4e);
  pokeMem(cpu, addr + 1, 1, 0x75);
}

function patchSubs(cpu: CpuSession): void {
  // Note: FUN_1216A (absLong) is NOT patched to RTS because:
  // With RTS stub, D0 is not set to abs(arg) before the cmpi check,
  // making the comparison non-deterministic. Our TS uses defaultAbsLong
  // which matches the real implementation.
  patchRts(cpu, FUN_15884);
  patchRts(cpu, FUN_158AC);
  patchRts(cpu, FUN_15BD0);
  patchRts(cpu, FUN_25BAE);
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) >>> 0;
    return ((s >>> 16) & 0xffff) / 0x10000;
  };
}

function randByte(rng: () => number): number {
  return Math.floor(rng() * 256) & 0xff;
}

function randWord(rng: () => number): number {
  return Math.floor(rng() * 0x10000) & 0xffff;
}

/** Write bytes into both binary oracle and TS GameState. */
function writeBytes(
  state: ReturnType<typeof stateNs.emptyGameState>,
  cpu: CpuSession,
  base: number,
  bytes: number[],
): void {
  for (let i = 0; i < bytes.length; i++) {
    const v = bytes[i] ?? 0;
    pokeMem(cpu, base + i, 1, v);
    state.workRam[base - 0x400000 + i] = v;
  }
}

/** Compare memory zone. Returns null on match, diff on mismatch. */
function compareZone(
  state: ReturnType<typeof stateNs.emptyGameState>,
  cpu: CpuSession,
  base: number,
  size: number,
  label: string,
): { label: string; offset: number; bin: number; ts: number } | null {
  for (let i = 0; i < size; i++) {
    const binVal = peekMem(cpu, base + i, 1);
    const tsVal = state.workRam[base - 0x400000 + i] ?? 0;
    if (binVal !== tsVal) {
      return { label, offset: base + i, bin: binVal, ts: tsVal };
    }
  }
  return null;
}

// ─── TS no-op subs ─────────────────────────────────────────────────────────

const NO_OP_SUBS: ns.Helper1CD00Subs = {
  soundPair15884: () => {},
  soundCmdSend158AC: () => {},
  stateSub15BD0: () => {},
  objectStateEntry25BAE: () => {},
  // absLong: not injected → uses defaultAbsLong (matches real FUN_1216A)
};

// ─── Main ──────────────────────────────────────────────────────────────────

interface CaseSetup {
  entityPtrAbs: number;
  shapeSrcBytes: number[];
  entityBytes: number[];
  globalsBytes: number[];
  indexLong: number;
}

async function main(): Promise<void> {
  const romPath = resolve("ghidra_project/marble_program.bin");
  if (!existsSync(romPath)) {
    console.error(`error: ROM blob not found at ${romPath}`);
    exit(3);
  }
  const rom = readFileSync(romPath);

  const total = Number(process.argv[2] ?? "500");
  const perSuite = Math.floor(total / 4);
  const remainder = total - perSuite * 4;

  const stateInst = stateNs.emptyGameState();
  const cpu = await createCpu({ rom, state: stateInst });
  patchSubs(cpu);

  let totalOk = 0;

  interface FailInfo {
    suite: string;
    tc: number;
    setup: CaseSetup;
    diff:
      | { label: string; offset: number; bin: number; ts: number }
      | { label: "return"; bin: number; ts: number };
  }
  const failHolder: { value: FailInfo | null } = { value: null };

  function runOneCase(suite: string, tc: number, setup: CaseSetup): boolean {
    // Reset SP for each run
    stateInst.workRam.fill(0, ENTITY_BASE - 0x400000, ENTITY_BASE - 0x400000 + ENTITY_COMPARE_SIZE + 0x20);
    cpu.system.setRegister("sp", 0x401f00);

    // Write memory regions
    writeBytes(stateInst, cpu, GLOBALS_BASE, setup.globalsBytes);
    writeBytes(stateInst, cpu, SHAPE_SRC_BASE, setup.shapeSrcBytes);
    writeBytes(stateInst, cpu, setup.entityPtrAbs, setup.entityBytes);

    // Run binary
    const binResult = callFunction(cpu, FUN_1CD00, [
      setup.entityPtrAbs >>> 0,
      SHAPE_SRC_BASE >>> 0,
      setup.indexLong >>> 0,
    ]);

    // Run TS (on same stateInst which was synced from writes)
    const tsResult = ns.helper1CD00(
      stateInst,
      setup.entityPtrAbs >>> 0,
      SHAPE_SRC_BASE >>> 0,
      setup.indexLong >>> 0,
      NO_OP_SUBS,
    );

    // Compare return value
    const binD0 = (binResult.d0 >>> 0) & 0xffffffff;
    const tsD0 = (tsResult >>> 0) & 0xffffffff;
    if (binD0 !== tsD0) {
      if (failHolder.value === null) {
        failHolder.value = {
          suite, tc, setup,
          diff: { label: "return", bin: binD0, ts: tsD0 },
        };
      }
      return false;
    }

    // Compare entity region
    const entityDiff = compareZone(
      stateInst, cpu,
      setup.entityPtrAbs, ENTITY_COMPARE_SIZE,
      "entity",
    );
    if (entityDiff !== null) {
      if (failHolder.value === null) {
        failHolder.value = { suite, tc, setup, diff: entityDiff };
      }
      return false;
    }

    return true;
  }

  const rng = makeRng(0x1cd00);

  function makeGlobals(): number[] {
    return Array.from({ length: GLOBALS_SIZE }, () => randByte(rng));
  }

  function makeShapeSrc(overrides?: {
    worldX?: number; worldY?: number; worldZ?: number;
  }): number[] {
    const b = Array.from({ length: SHAPE_SRC_SIZE }, () => randByte(rng));
    if (overrides?.worldX !== undefined) {
      b[0x0c] = (overrides.worldX >>> 8) & 0xff;
      b[0x0d] = overrides.worldX & 0xff;
    }
    if (overrides?.worldY !== undefined) {
      b[0x10] = (overrides.worldY >>> 8) & 0xff;
      b[0x11] = overrides.worldY & 0xff;
    }
    if (overrides?.worldZ !== undefined) {
      b[0x14] = (overrides.worldZ >>> 8) & 0xff;
      b[0x15] = overrides.worldZ & 0xff;
    }
    return b;
  }

  function makeEntity(overrides?: {
    mode36?: number; val14?: number; val2a?: number;
  }): number[] {
    const b = Array.from({ length: ENTITY_COMPARE_SIZE }, () => randByte(rng));
    if (overrides?.mode36 !== undefined) b[0x36] = overrides.mode36 & 0xff;
    if (overrides?.val14 !== undefined) {
      const v = overrides.val14 >>> 0;
      b[0x14] = (v >>> 24) & 0xff; b[0x15] = (v >>> 16) & 0xff;
      b[0x16] = (v >>> 8) & 0xff; b[0x17] = v & 0xff;
    }
    if (overrides?.val2a !== undefined) {
      const v = overrides.val2a >>> 0;
      b[0x2a] = (v >>> 24) & 0xff; b[0x2b] = (v >>> 16) & 0xff;
      b[0x2c] = (v >>> 8) & 0xff; b[0x2d] = v & 0xff;
    }
    return b;
  }

  // ── Suite A: random globali/entity/shape-source, index 0..6 casuale ────
  console.log(`\n=== helper1CD00 (FUN_1CD00) — Suite A: random — ${perSuite} casi ===`);
  let okA = 0;
  for (let i = 0; i < perSuite; i++) {
    const indexByte = Math.floor(rng() * 7); // 0..6
    const setup: CaseSetup = {
      entityPtrAbs: ENTITY_BASE,
      shapeSrcBytes: makeShapeSrc(),
      entityBytes: makeEntity(),
      globalsBytes: makeGlobals(),
      indexLong: indexByte,
    };
    if (runOneCase("A", i, setup)) okA++;
  }
  console.log(`  Match: ${okA}/${perSuite} = ${((okA / perSuite) * 100).toFixed(1)}%`);
  totalOk += okA;

  // ── Suite B: index=0xFF → early-exit return 0 ─────────────────────────
  console.log(`\n=== Suite B: index=0xFF (early-exit) — ${perSuite} casi ===`);
  let okB = 0;
  for (let i = 0; i < perSuite; i++) {
    const setup: CaseSetup = {
      entityPtrAbs: ENTITY_BASE,
      shapeSrcBytes: makeShapeSrc(),
      entityBytes: makeEntity(),
      globalsBytes: makeGlobals(),
      indexLong: 0xff,
    };
    if (runOneCase("B", i, setup)) okB++;
  }
  console.log(`  Match: ${okB}/${perSuite} = ${((okB / perSuite) * 100).toFixed(1)}%`);
  totalOk += okB;

  // ── Suite C: in-bbox forzato (hit garantito set 1), index casuale ──────
  // Shape[0] bbox: x=[-8,8], y=[-4,36], z=[-16,32]
  // x1 = (A1[0xC]+8) - worldX = 0 if worldX = (A1[0xC]+8)
  // Place worldX = (A1[0xC]+8) so x1=0 which is in [-8,8]
  console.log(`\n=== Suite C: in-bbox forzato — ${perSuite} casi ===`);
  let okC = 0;
  for (let i = 0; i < perSuite; i++) {
    const wX = randWord(rng);
    const wY = randWord(rng);
    const wZ = randWord(rng);
    const shapeSrc = makeShapeSrc({ worldX: wX, worldY: wY, worldZ: wZ });
    const globals = makeGlobals();
    // worldX at globals[0x0C..0x0D] (0x400690 - 0x400684 = 0xC)
    const worldXVal = (wX + 8) & 0xffff;
    const worldYVal = (wY + 8) & 0xffff;
    const worldZVal = wZ & 0xffff;
    globals[0x0c] = (worldXVal >>> 8) & 0xff; globals[0x0d] = worldXVal & 0xff;
    globals[0x0e] = (worldYVal >>> 8) & 0xff; globals[0x0f] = worldYVal & 0xff;
    globals[0x10] = (worldZVal >>> 8) & 0xff; globals[0x11] = worldZVal & 0xff;

    const indexByte = Math.floor(rng() * 7);
    const setup: CaseSetup = {
      entityPtrAbs: ENTITY_BASE,
      shapeSrcBytes: shapeSrc,
      entityBytes: makeEntity(),
      globalsBytes: globals,
      indexLong: indexByte,
    };
    if (runOneCase("C", i, setup)) okC++;
  }
  console.log(`  Match: ${okC}/${perSuite} = ${((okC / perSuite) * 100).toFixed(1)}%`);
  totalOk += okC;

  // ── Suite D: edge cases (entità speciali, mode36=2) ───────────────────
  const sizeD = perSuite + remainder;
  console.log(`\n=== Suite D: edge cases — ${sizeD} casi ===`);
  let okD = 0;
  for (let i = 0; i < sizeD; i++) {
    const mode = i % 5;
    let entityPtr = ENTITY_BASE;
    const entityOvr: Parameters<typeof makeEntity>[0] = {};

    if (mode === 0) {
      entityPtr = 0x00400018;
    } else if (mode === 1) {
      entityPtr = 0x004000fa;
    } else if (mode === 2) {
      // mode36=2, val14 >> val2a → likely triggers kill path
      entityOvr.mode36 = 2;
      entityOvr.val14 = 0x00300000;
      entityOvr.val2a = 0x00000000;
    } else if (mode === 3) {
      // mode36=2, but val14 - val2a <= 0x100000 → negation path
      entityOvr.mode36 = 2;
      entityOvr.val14 = 0x00000100;
      entityOvr.val2a = 0x00000000;
    }
    // else: fully random

    const indexByte = i % 7;
    const setup: CaseSetup = {
      entityPtrAbs: entityPtr,
      shapeSrcBytes: makeShapeSrc(),
      entityBytes: makeEntity(entityOvr),
      globalsBytes: makeGlobals(),
      indexLong: indexByte,
    };
    if (runOneCase("D", i, setup)) okD++;
  }
  console.log(`  Match: ${okD}/${sizeD} = ${((okD / sizeD) * 100).toFixed(1)}%`);
  totalOk += okD;

  // ── Report ────────────────────────────────────────────────────────────
  console.log(
    `\n=== TOTALE: ${totalOk}/${total} = ${((totalOk / total) * 100).toFixed(1)}% ===`,
  );
  if (failHolder.value !== null) {
    const f = failHolder.value;
    const d = f.diff;
    if ("offset" in d) {
      console.log(
        `  First fail (suite ${f.suite} tc=${f.tc}): ${d.label} @ 0x${d.offset.toString(16)} ` +
        `bin=0x${d.bin.toString(16)} ts=0x${d.ts.toString(16)} ` +
        `entityPtr=0x${f.setup.entityPtrAbs.toString(16)} index=0x${f.setup.indexLong.toString(16)}`,
      );
    } else {
      console.log(
        `  First fail (suite ${f.suite} tc=${f.tc}): return ` +
        `bin=0x${d.bin.toString(16)} ts=0x${d.ts.toString(16)} ` +
        `entityPtr=0x${f.setup.entityPtrAbs.toString(16)} index=0x${f.setup.indexLong.toString(16)}`,
      );
    }
  }

  disposeCpu(cpu);
  exit(totalOk === total ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  exit(1);
});
