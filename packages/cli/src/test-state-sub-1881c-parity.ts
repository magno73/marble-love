#!/usr/bin/env node
/**
 * test-state-sub-1881c-parity.ts — differential FUN_0001881C vs
 * `stateSub1881C`.
 *
 * FUN_0001881C (342 byte): "entity-vs-table proximity reactor". Itera 36
 * matches spawn bytes @ 0x400697/0x400699 and runs one of two branches:
 *
 *   - **math/sound**: if both `byte((long@684>>19))`, `byte((long@688>>19))`
 *     e `entity[0x14].w` matchano, applica damping (entity[0..3]>>1)±0x6000
 *   - **reflect**: if signed word distance (`entity[0x14] - entry[0x6]`) < 12,
 *
 * entity[0xc]=long@684 e entity[0x10]=long@688.
 *
 * **Strategia parity**:
 *   - `FUN_00013A98` (RNG @ 0x4003A6) **lasciato live**: replicato
 *   - `FUN_000158AC` (sound) **patched** with a "capture sentinel" payload
 *     of commands captured through `subs.soundCommand`.
 *   - Compare:
 *       * `*0x004003A6` (RNG seed) post-call.
 *       * D0 return value (0 / 1 depending on match).
 *
 * **Suite** (4 × 125 = 500):
 *   - C: forced match-first-3 (some active entries with key bytes that
 *
 * Uso: npx tsx packages/cli/src/test-state-sub-1881c-parity.ts [N]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import {
  state as stateNs,
  stateSub1881C as sub1881CNs,
  wrap,
} from "@marble-love/engine";
import {
  createCpu,
  callFunction,
  pokeMem,
  peekMem,
  disposeCpu,
} from "./binary-oracle-lib.js";
import type { CpuSession } from "./binary-oracle-lib.js";

const FUN_1881C = 0x0001881c;
const FUN_158AC = 0x000158ac;
const RNG_SEED_ADDR = 0x004003a6;

const ENTITY_BASE = 0x00401e00;
const ENTITY_SIZE = 0x40;

const TABLE_BASE = 0x00401650;
const TABLE_SIZE = 0x240; // 36 × 16

const GAME_MODE_ADDR = 0x00400394; // word
const SECONDARY_GATE_ADDR = 0x00400760; // byte
const SPAWN_BYTE0_ADDR = 0x00400697; // byte
const SPAWN_BYTE1_ADDR = 0x00400699; // byte
const WORLD_X_ADDR = 0x00400684; // long
const WORLD_Y_ADDR = 0x00400688; // long

const CAPTURE_ADDR = 0x00401ffe;
const SENTINEL_NOT_CALLED = 0xff;

/**
 * Patch FUN_158AC: capture il byte LSB of the long arg → workRam[0x401FFE].
 *   move.b (0x7,SP), D0   ; 10 2F 00 07
 *   move.b D0, $00401FFE  ; 13 C0 00 40 1F FE
 *   rts                   ; 4E 75
 */
function patchSubs(rom: Uint8Array): void {
  rom[FUN_158AC + 0x0] = 0x10; rom[FUN_158AC + 0x1] = 0x2f;
  rom[FUN_158AC + 0x2] = 0x00; rom[FUN_158AC + 0x3] = 0x07;
  rom[FUN_158AC + 0x4] = 0x13; rom[FUN_158AC + 0x5] = 0xc0;
  rom[FUN_158AC + 0x6] = 0x00; rom[FUN_158AC + 0x7] = 0x40;
  rom[FUN_158AC + 0x8] = 0x1f; rom[FUN_158AC + 0x9] = 0xfe;
  rom[FUN_158AC + 0xa] = 0x4e; rom[FUN_158AC + 0xb] = 0x75;
}

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) >>> 0;
    return ((s >>> 16) & 0xffff) / 0x10000;
  };
}

interface Snapshot {
  entity: number[]; // 0x40 byte
  rngSeed: number;  // u16 @ 0x4003A6
  retD0: number;
  capture: number;
}

function snapshotBinary(cpu: CpuSession, retD0: number): Snapshot {
  const entity: number[] = [];
  for (let i = 0; i < ENTITY_SIZE; i++) {
    entity.push(peekMem(cpu, ENTITY_BASE + i, 1) & 0xff);
  }
  return {
    entity,
    rngSeed: peekMem(cpu, RNG_SEED_ADDR, 2) & 0xffff,
    retD0: retD0 | 0,
    capture: peekMem(cpu, CAPTURE_ADDR, 1) & 0xff,
  };
}

function snapshotTs(
  state: ReturnType<typeof stateNs.emptyGameState>,
  retD0: number,
  capture: number,
): Snapshot {
  const entity: number[] = [];
  const off = ENTITY_BASE - 0x400000;
  for (let i = 0; i < ENTITY_SIZE; i++) {
    entity.push(state.workRam[off + i] ?? 0);
  }
  return {
    entity,
    rngSeed: (state.rng.seed as unknown as number) & 0xffff,
    retD0: retD0 | 0,
    capture: capture & 0xff,
  };
}

interface FailRecord {
  suite: string;
  tc: number;
  reason: string;
  binEntity: number[];
  tsEntity: number[];
  binSeed: number;
  tsSeed: number;
  binRet: number;
  tsRet: number;
  binCapture: number;
  tsCapture: number;
  inputDigest: string;
}

interface CaseInput {
  entity: number[];          // 0x40 byte
  table: number[];           // 0x240 byte
  spawnB0: number;           // *0x400697
  spawnB1: number;           // *0x400699
  long684: number;           // *0x400684
  long688: number;           // *0x400688
  gameMode: number;          // *0x400394 word
  byte760: number;           // *0x400760 byte
  rngSeed: number;
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
  const rom = Uint8Array.from(readFileSync(romPath));
  patchSubs(rom);

  const stateInst = stateNs.emptyGameState();
  const cpu = await createCpu({ rom, state: stateInst });

  let totalOk = 0;
  const failHolder: { value: FailRecord | null } = { value: null };

  function setupCase(inp: CaseInput): void {
    for (let i = 0; i < ENTITY_SIZE; i++) {
      pokeMem(cpu, ENTITY_BASE + i, 1, inp.entity[i] ?? 0);
    }
    for (let i = 0; i < TABLE_SIZE; i++) {
      pokeMem(cpu, TABLE_BASE + i, 1, inp.table[i] ?? 0);
    }
    pokeMem(cpu, SPAWN_BYTE0_ADDR, 1, inp.spawnB0);
    pokeMem(cpu, SPAWN_BYTE1_ADDR, 1, inp.spawnB1);
    pokeMem(cpu, WORLD_X_ADDR, 4, inp.long684 >>> 0);
    pokeMem(cpu, WORLD_Y_ADDR, 4, inp.long688 >>> 0);
    pokeMem(cpu, GAME_MODE_ADDR, 2, inp.gameMode & 0xffff);
    pokeMem(cpu, SECONDARY_GATE_ADDR, 1, inp.byte760 & 0xff);
    pokeMem(cpu, RNG_SEED_ADDR, 2, inp.rngSeed & 0xffff);
    pokeMem(cpu, CAPTURE_ADDR, 1, SENTINEL_NOT_CALLED);
    cpu.system.setRegister("sp", 0x401f00);

    // TS: same setup.
    const offE = ENTITY_BASE - 0x400000;
    for (let i = 0; i < ENTITY_SIZE; i++) {
      stateInst.workRam[offE + i] = inp.entity[i] ?? 0;
    }
    const offT = TABLE_BASE - 0x400000;
    for (let i = 0; i < TABLE_SIZE; i++) {
      stateInst.workRam[offT + i] = inp.table[i] ?? 0;
    }
    stateInst.workRam[SPAWN_BYTE0_ADDR - 0x400000] = inp.spawnB0 & 0xff;
    stateInst.workRam[SPAWN_BYTE1_ADDR - 0x400000] = inp.spawnB1 & 0xff;
    // long684/688 BE
    {
      const off = WORLD_X_ADDR - 0x400000;
      stateInst.workRam[off] = (inp.long684 >>> 24) & 0xff;
      stateInst.workRam[off + 1] = (inp.long684 >>> 16) & 0xff;
      stateInst.workRam[off + 2] = (inp.long684 >>> 8) & 0xff;
      stateInst.workRam[off + 3] = inp.long684 & 0xff;
    }
    {
      const off = WORLD_Y_ADDR - 0x400000;
      stateInst.workRam[off] = (inp.long688 >>> 24) & 0xff;
      stateInst.workRam[off + 1] = (inp.long688 >>> 16) & 0xff;
      stateInst.workRam[off + 2] = (inp.long688 >>> 8) & 0xff;
      stateInst.workRam[off + 3] = inp.long688 & 0xff;
    }
    {
      const off = GAME_MODE_ADDR - 0x400000;
      stateInst.workRam[off] = (inp.gameMode >>> 8) & 0xff;
      stateInst.workRam[off + 1] = inp.gameMode & 0xff;
    }
    stateInst.workRam[SECONDARY_GATE_ADDR - 0x400000] = inp.byte760 & 0xff;
    stateInst.workRam[CAPTURE_ADDR - 0x400000] = SENTINEL_NOT_CALLED;

    stateInst.rng.seed = wrap.as_u32(inp.rngSeed & 0xffff);
    stateInst.rng.callsThisFrame = wrap.as_u32(0);
  }

  function runOneCase(suite: string, tc: number, inp: CaseInput): boolean {
    setupCase(inp);

    const binResult = callFunction(cpu, FUN_1881C, [ENTITY_BASE]);
    const binSnap = snapshotBinary(cpu, binResult.d0);

    let tsCapture = SENTINEL_NOT_CALLED;
    const tsRet = sub1881CNs.stateSub1881C(stateInst, ENTITY_BASE, {
      soundCommand: cmd => {
        tsCapture = cmd & 0xff;
      },
    }).result;
    stateInst.workRam[CAPTURE_ADDR - 0x400000] = tsCapture;

    const tsSnap = snapshotTs(stateInst, tsRet, tsCapture);

    let reason = "";
    if (binSnap.retD0 !== tsSnap.retD0) {
      reason = `retD0 bin=0x${binSnap.retD0.toString(16)} ts=0x${tsSnap.retD0.toString(16)}`;
    } else if (binSnap.rngSeed !== tsSnap.rngSeed) {
      reason = `rngSeed bin=0x${binSnap.rngSeed.toString(16)} ts=0x${tsSnap.rngSeed.toString(16)}`;
    } else if (binSnap.capture !== tsSnap.capture) {
      reason = `capture bin=0x${binSnap.capture.toString(16)} ts=0x${tsSnap.capture.toString(16)}`;
    } else {
      for (let i = 0; i < ENTITY_SIZE; i++) {
        if (binSnap.entity[i] !== tsSnap.entity[i]) {
          reason = `entity[0x${i.toString(16)}] bin=0x${binSnap.entity[i]!.toString(16)} ts=0x${tsSnap.entity[i]!.toString(16)}`;
          break;
        }
      }
    }
    if (reason === "") return true;
    if (failHolder.value === null) {
      const digest = `gm=0x${inp.gameMode.toString(16)} b760=0x${inp.byte760.toString(16)} sb0=0x${inp.spawnB0.toString(16)} sb1=0x${inp.spawnB1.toString(16)} l684=0x${(inp.long684 >>> 0).toString(16)} l688=0x${(inp.long688 >>> 0).toString(16)} seed=0x${inp.rngSeed.toString(16)}`;
      failHolder.value = {
        suite,
        tc,
        reason,
        binEntity: binSnap.entity.slice(),
        tsEntity: tsSnap.entity.slice(),
        binSeed: binSnap.rngSeed,
        tsSeed: tsSnap.rngSeed,
        binRet: binSnap.retD0,
        tsRet: tsSnap.retD0,
        binCapture: binSnap.capture,
        tsCapture: tsSnap.capture,
        inputDigest: digest,
      };
    }
    return false;
  }

  const rng = makeRng(0x1881c);
  const rb = (): number => Math.floor(rng() * 256) & 0xff;
  const rl = (): number => (rng() * 0x100000000) >>> 0;
  const rw = (): number => Math.floor(rng() * 0x10000) & 0xffff;

  function genTable(activeProb: number, fixed?: { spawnB0?: number; spawnB1?: number; word?: number; }): number[] {
    const t = new Array(TABLE_SIZE).fill(0).map(() => rb());
    for (let i = 0; i < 36; i++) {
      const e = i * 16;
      if (rng() < activeProb) {
        t[e + 2] = 0xff; t[e + 3] = 0xff;
      } else {
        if (t[e + 2] === 0xff && t[e + 3] === 0xff) t[e + 2] = 0x00;
      }
      if (fixed?.spawnB0 !== undefined) t[e + 4] = fixed.spawnB0 & 0xff;
      if (fixed?.spawnB1 !== undefined) t[e + 5] = fixed.spawnB1 & 0xff;
      if (fixed?.word !== undefined) {
        t[e + 6] = (fixed.word >>> 8) & 0xff;
        t[e + 7] = fixed.word & 0xff;
      }
    }
    return t;
  }

  function baseInput(): CaseInput {
    return {
      entity: new Array(ENTITY_SIZE).fill(0).map(() => rb()),
      table: new Array(TABLE_SIZE).fill(0).map(() => rb()),
      spawnB0: rb(),
      spawnB1: rb(),
      long684: rl(),
      long688: rl(),
      gameMode: 0x0003,
      byte760: 0xff,
      rngSeed: rw(),
    };
  }

  // ─── Suite A: random ─────────────────────────────────────────────────
  console.log(
    `\n=== stateSub1881C (FUN_0001881C) — Suite A: random — ${perSuite} cases ===`,
  );
  let okA = 0;
  for (let i = 0; i < perSuite; i++) {
    const inp = baseInput();
    if (runOneCase("A", i, inp)) okA++;
  }
  console.log(`  Match: ${okA}/${perSuite} = ${((okA / perSuite) * 100).toFixed(1)}%`);
  totalOk += okA;

  // ─── Suite B: early-out (gameMode != 3) ──────────────────────────────
  console.log(
    `\n=== Suite B: forced early-out (gameMode != 3 OR byte760==0) — ${perSuite} cases ===`,
  );
  let okB = 0;
  for (let i = 0; i < perSuite; i++) {
    const inp = baseInput();
    // 50/50: gameMode != 3 OR byte760 == 0
    if ((i & 1) === 0) inp.gameMode = (rw() & 0xffff) === 3 ? 0 : (rw() & 0xffff);
    else inp.byte760 = 0;
    if (inp.gameMode === 3 && inp.byte760 !== 0) inp.gameMode = 0; // garantisci early-out
    if (runOneCase("B", i, inp)) okB++;
  }
  console.log(`  Match: ${okB}/${perSuite} = ${((okB / perSuite) * 100).toFixed(1)}%`);
  totalOk += okB;

  // ─── Suite C: forced match-first-3 (some active entries with key bytes spawn) ──
  console.log(
    `\n=== Suite C: forced match-first-3 (varies by level) — ${perSuite} cases ===`,
  );
  let okC = 0;
  for (let i = 0; i < perSuite; i++) {
    const inp = baseInput();
    inp.gameMode = 3;
    inp.byte760 = 0xff;
    inp.spawnB0 = rb();
    inp.spawnB1 = rb();
    inp.table = genTable(0.3, {
      spawnB0: inp.spawnB0,
      spawnB1: inp.spawnB1,
      word: rw(),
    });
    if (runOneCase("C", i, inp)) okC++;
  }
  console.log(`  Match: ${okC}/${perSuite} = ${((okC / perSuite) * 100).toFixed(1)}%`);
  totalOk += okC;

  // ─── Suite D: forced match-all-6 (math branch) ───────────────────────
  const sizeD = perSuite + remainder;
  console.log(
    `\n=== Suite D: forced math branch (RNG side effects) — ${sizeD} cases ===`,
  );
  let okD = 0;
  for (let i = 0; i < sizeD; i++) {
    const inp = baseInput();
    inp.gameMode = 3;
    inp.byte760 = 0xff;
    const k0 = rb();
    const k1 = rb();
    // long684 = k0 << 19 (puro), shift 19 = byte k0 in low byte
    inp.long684 = (k0 << 19) >>> 0;
    inp.long688 = (k1 << 19) >>> 0;
    inp.spawnB0 = k0;
    inp.spawnB1 = k1;
    // entity[0x14..0x15] = word
    const w = rw();
    inp.entity[0x14] = (w >>> 8) & 0xff;
    inp.entity[0x15] = w & 0xff;
    inp.table = genTable(0.4, { spawnB0: k0, spawnB1: k1, word: w });
    if (runOneCase("D", i, inp)) okD++;
  }
  console.log(`  Match: ${okD}/${sizeD} = ${((okD / sizeD) * 100).toFixed(1)}%`);
  totalOk += okD;

  console.log(
    `\n=== TOTALE: ${totalOk}/${total} = ${((totalOk / total) * 100).toFixed(1)}% ===`,
  );
  if (failHolder.value !== null) {
    const f = failHolder.value;
    console.log(`  First fail (suite ${f.suite} tc=${f.tc}): ${f.reason}`);
    console.log(`    input: ${f.inputDigest}`);
    console.log(`    binRet=0x${f.binRet.toString(16)} tsRet=0x${f.tsRet.toString(16)}`);
    console.log(`    binSeedAfter=0x${f.binSeed.toString(16)} tsSeedAfter=0x${f.tsSeed.toString(16)}`);
    console.log(`    binCapture=0x${f.binCapture.toString(16)} tsCapture=0x${f.tsCapture.toString(16)}`);
    // Stampa primi N byte differenti
    let diffs = 0;
    for (let i = 0; i < ENTITY_SIZE && diffs < 8; i++) {
      if (f.binEntity[i] !== f.tsEntity[i]) {
        console.log(
          `    entity[0x${i.toString(16)}] bin=0x${f.binEntity[i]!.toString(16)} ts=0x${f.tsEntity[i]!.toString(16)}`,
        );
        diffs++;
      }
    }
  }

  disposeCpu(cpu);
  exit(totalOk === total ? 0 : 1);
}

main().catch(e => {
  console.error(e);
  exit(1);
});
