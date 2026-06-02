#!/usr/bin/env node
/**
 * test-state-sub-19baa-parity.ts — differential FUN_00019BAA vs
 * `stateSub19BAA`.
 *
 * FUN_00019BAA (490 byte, 0x019BAA-0x019D94): "per-frame entity tick". Gated
 * on `*0x400394.w == 4`, optional spawn dispatcher (`FUN_00019A40` every 8
 * frames), then iterates entity table @ 0x4019F8 (10 x 0x38), applying for each
 * (rng-driven), movement-block (Y += vel + depth check), AI-block
 * (FUN_19E42), and conditional sound trigger (FUN_158AC).
 *
 * **Parity strategy**:
 *     in `rng.ts`.
 *   - `FUN_00019A40` (spawn dispatcher) **stubbed with RTS**.
 *   - `FUN_00018F46` **stubbed with RTS**.
 *   - `FUN_0001BB08` (sprite-set-XY) **stubbed with RTS**.
 *   - `FUN_0001CC62` (sprite-project) **stubbed with `moveq #0,D0; rts`**
 *   - `FUN_00019E42` (marble-cell-dispatch) **stubbed with RTS**.
 *   - `FUN_000158AC` (sound) **stubbed with RTS**.
 *   - Compare:
 *       * `*0x004019F8..0x004019F8 + 0x230` (10 entity × 0x38 = 0x230 byte)
 *       * `*0x004003A6` (RNG seed) post-call
 *
 * **Suite** (4 × 125 = 500):
 *   - A: random — full random entity table + random globals
 *   - D: edge — high state, vel pivot, substate==2, mix for recheck path
 *
 * Usage: npx tsx packages/cli/src/test-state-sub-19baa-parity.ts [N]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import {
  state as stateNs,
  stateSub19BAA as sub19BAANs,
  bus as busNs,
  wrap,
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

const FUN_19BAA = 0x00019baa;
const FUN_19A40 = 0x00019a40;
const FUN_18F46 = 0x00018f46;
const FUN_1BB08 = 0x0001bb08;
const FUN_1CC62 = 0x0001cc62;
const FUN_19E42 = 0x00019e42;
const FUN_158AC = 0x000158ac;
const RNG_SEED_ADDR = 0x004003a6;

const ENTITY_TABLE_BASE = 0x004019f8;
const ENTITY_STRIDE = 0x38;
const ENTITY_COUNT = 10;
const TABLE_SIZE = ENTITY_STRIDE * ENTITY_COUNT; // 0x230

const GAME_MODE_ADDR = 0x00400394;
const SPAWN_ENABLE_ADDR = 0x00400762;
const FRAME_COUNTER_ADDR = 0x00400010;

/**
 * Patch JSR-stub. RTS = 0x4E75 (2 byte). FUN_1CC62 needs 4 bytes
 * (`moveq #0,D0` 0x7000 + `rts` 0x4E75) to guarantee deterministic D0 = 0.
 */
function patchSubs(cpu: CpuSession): void {
  // Plain RTS stubs.
  for (const addr of [FUN_19A40, FUN_18F46, FUN_1BB08, FUN_19E42, FUN_158AC]) {
    pokeMem(cpu, addr + 0, 1, 0x4e);
    pokeMem(cpu, addr + 1, 1, 0x75);
  }
  // FUN_1CC62: `moveq #0,D0; rts` (return 0 in D0).
  pokeMem(cpu, FUN_1CC62 + 0, 1, 0x70); // moveq high byte
  pokeMem(cpu, FUN_1CC62 + 1, 1, 0x00); // moveq low byte (imm = 0)
  pokeMem(cpu, FUN_1CC62 + 2, 1, 0x4e); // rts high
  pokeMem(cpu, FUN_1CC62 + 3, 1, 0x75); // rts low
}

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) >>> 0;
    return ((s >>> 16) & 0xffff) / 0x10000;
  };
}

interface Snapshot {
  table: number[]; // 0x230 byte
  rngSeed: number;
  // Globals that could be modified indirectly (no-op in stubbed
  // mode, but check invariance of the three gate scalars).
  gameMode: number;
  spawnEnable: number;
  frameCounter: number;
}

function snapshotBinary(cpu: CpuSession): Snapshot {
  const table: number[] = [];
  for (let i = 0; i < TABLE_SIZE; i++) {
    table.push(peekMem(cpu, ENTITY_TABLE_BASE + i, 1) & 0xff);
  }
  return {
    table,
    rngSeed: peekMem(cpu, RNG_SEED_ADDR, 2) & 0xffff,
    gameMode: peekMem(cpu, GAME_MODE_ADDR, 2) & 0xffff,
    spawnEnable: peekMem(cpu, SPAWN_ENABLE_ADDR, 1) & 0xff,
    frameCounter: peekMem(cpu, FRAME_COUNTER_ADDR, 4) >>> 0,
  };
}

function snapshotTs(state: ReturnType<typeof stateNs.emptyGameState>): Snapshot {
  const table: number[] = [];
  const off = ENTITY_TABLE_BASE - 0x400000;
  for (let i = 0; i < TABLE_SIZE; i++) {
    table.push(state.workRam[off + i] ?? 0);
  }
  const rd16 = (a: number): number =>
    (((state.workRam[a] ?? 0) << 8) | (state.workRam[a + 1] ?? 0)) & 0xffff;
  const rd32 = (a: number): number =>
    (((state.workRam[a] ?? 0) << 24) |
      ((state.workRam[a + 1] ?? 0) << 16) |
      ((state.workRam[a + 2] ?? 0) << 8) |
      (state.workRam[a + 3] ?? 0)) >>>
    0;
  return {
    table,
    rngSeed: (state.rng.seed as unknown as number) & 0xffff,
    gameMode: rd16(0x394),
    spawnEnable: state.workRam[0x762] ?? 0,
    frameCounter: rd32(0x10),
  };
}

interface FailRecord {
  suite: string;
  tc: number;
  reason: string;
  binTable: number[];
  tsTable: number[];
  binSeed: number;
  tsSeed: number;
  inputTable: number[];
  inputSeed: number;
  inputGameMode: number;
  inputSpawnEnable: number;
  inputFrameCounter: number;
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
  const rom = readFileSync(romPath);

  const stateInst = stateNs.emptyGameState();
  const cpu = await createCpu({ rom, state: stateInst });
  patchSubs(cpu);

  const tsRom: RomImage = busNs.emptyRomImage();
  tsRom.program.set(rom.subarray(0, tsRom.program.length));

  let totalOk = 0;
  const failHolder: { value: FailRecord | null } = { value: null };

  function setupCase(
    tableBytes: number[],
    rngSeed: number,
    gameMode: number,
    spawnEnable: number,
    frameCounter: number,
  ): void {
    // BINARY: write entity table + globals + RNG seed.
    for (let i = 0; i < TABLE_SIZE; i++) {
      pokeMem(cpu, ENTITY_TABLE_BASE + i, 1, tableBytes[i] ?? 0);
    }
    pokeMem(cpu, RNG_SEED_ADDR, 2, rngSeed & 0xffff);
    pokeMem(cpu, GAME_MODE_ADDR, 2, gameMode & 0xffff);
    pokeMem(cpu, SPAWN_ENABLE_ADDR, 1, spawnEnable & 0xff);
    pokeMem(cpu, FRAME_COUNTER_ADDR, 4, frameCounter >>> 0);
    cpu.system.setRegister("sp", 0x401f00);

    // TS: same setup.
    const off = ENTITY_TABLE_BASE - 0x400000;
    for (let i = 0; i < TABLE_SIZE; i++) {
      stateInst.workRam[off + i] = tableBytes[i] ?? 0;
    }
    stateInst.rng.seed = wrap.as_u32(rngSeed & 0xffff);
    stateInst.rng.callsThisFrame = wrap.as_u32(0);
    stateInst.workRam[0x394] = (gameMode >>> 8) & 0xff;
    stateInst.workRam[0x395] = gameMode & 0xff;
    stateInst.workRam[0x762] = spawnEnable & 0xff;
    stateInst.workRam[0x10] = (frameCounter >>> 24) & 0xff;
    stateInst.workRam[0x11] = (frameCounter >>> 16) & 0xff;
    stateInst.workRam[0x12] = (frameCounter >>> 8) & 0xff;
    stateInst.workRam[0x13] = frameCounter & 0xff;
  }

  function runOneCase(
    suite: string,
    tc: number,
    tableBytes: number[],
    rngSeed: number,
    gameMode: number,
    spawnEnable: number,
    frameCounter: number,
  ): boolean {
    setupCase(tableBytes, rngSeed, gameMode, spawnEnable, frameCounter);

    callFunction(cpu, FUN_19BAA, []);
    const binSnap = snapshotBinary(cpu);

    sub19BAANs.stateSub19BAA(stateInst, tsRom, {
      fun_19a40: () => {
        // no-op (stubbed RTS).
      },
      fun_18f46: () => {
        // no-op.
      },
      fun_1bb08: () => {
        // no-op.
      },
      fun_1cc62: () => 0, // matching `moveq #0,D0; rts`.
      fun_19e42: () => {
        // no-op.
      },
      fun_158ac: () => {
        // no-op.
      },
    });
    const tsSnap = snapshotTs(stateInst);

    let reason = "";
    if (binSnap.rngSeed !== tsSnap.rngSeed) {
      reason = `rngSeed bin=0x${binSnap.rngSeed.toString(16)} ts=0x${tsSnap.rngSeed.toString(16)}`;
    } else {
      for (let i = 0; i < TABLE_SIZE; i++) {
        if (binSnap.table[i] !== tsSnap.table[i]) {
          const slot = Math.floor(i / ENTITY_STRIDE);
          const fld = i % ENTITY_STRIDE;
          reason = `entity[${slot}][0x${fld.toString(16)}] bin=0x${binSnap.table[i]!.toString(16)} ts=0x${tsSnap.table[i]!.toString(16)}`;
          break;
        }
      }
    }
    if (reason === "") return true;
    if (failHolder.value === null) {
      failHolder.value = {
        suite,
        tc,
        reason,
        binTable: binSnap.table.slice(),
        tsTable: tsSnap.table.slice(),
        binSeed: binSnap.rngSeed,
        tsSeed: tsSnap.rngSeed,
        inputTable: tableBytes.slice(),
        inputSeed: rngSeed,
        inputGameMode: gameMode,
        inputSpawnEnable: spawnEnable,
        inputFrameCounter: frameCounter,
      };
    }
    return false;
  }

  const rng = makeRng(0x19baa);
  const rb = (): number => Math.floor(rng() * 256) & 0xff;
  const rs = (): number => Math.floor(rng() * 0x10000) & 0xffff;
  const rl = (): number => Math.floor(rng() * 0x100000000) >>> 0;

  /**
   * Generates an entity table. `forceActive` controls the frequency of
   * `entity[0x18]==1`. `safeScriptPtr` uses a ROM addr for scriptPtr.
   */
  function genTable(
    forceActiveProb: number,
    safeScriptPtr: boolean,
  ): number[] {
    const t = new Array(TABLE_SIZE).fill(0).map(() => rb());
    for (let s = 0; s < ENTITY_COUNT; s++) {
      const off = s * ENTITY_STRIDE;
      // entity[0x18]: probabilistic active.
      t[off + 0x18] = rng() < forceActiveProb ? 1 : 0;
      if (safeScriptPtr) {
        const ptr = (0x10000 + Math.floor(rng() * 0x30000)) & ~3;
        t[off + 0x1c] = (ptr >>> 24) & 0xff;
        t[off + 0x1d] = (ptr >>> 16) & 0xff;
        t[off + 0x1e] = (ptr >>> 8) & 0xff;
        t[off + 0x1f] = ptr & 0xff;
      }
    }
    return t;
  }

  // ─── Suite A: random — gate match (game mode = 4) ────────────────────
  console.log(
    `\n=== stateSub19BAA (FUN_00019BAA) — Suite A: random (game-mode=4) — ${perSuite} cases ===`,
  );
  let okA = 0;
  for (let i = 0; i < perSuite; i++) {
    const t = genTable(0.5, true);
    const seed = rs();
    if (runOneCase("A", i, t, seed, 4, rb(), rl())) okA++;
  }
  console.log(`  Match: ${okA}/${perSuite} = ${((okA / perSuite) * 100).toFixed(1)}%`);
  totalOk += okA;

  // ─── Suite B: gate-out (game mode != 4) ─────────────────────────────
  console.log(
    `\n=== Suite B: gate-out (game-mode != 4) — ${perSuite} cases ===`,
  );
  let okB = 0;
  for (let i = 0; i < perSuite; i++) {
    const t = genTable(0.5, true);
    const seed = rs();
    // Pick game mode in {0,1,2,3,5,6,7} (not 4).
    const modes = [0, 1, 2, 3, 5, 6, 7];
    const gm = modes[Math.floor(rng() * modes.length)]!;
    if (runOneCase("B", i, t, seed, gm, rb(), rl())) okB++;
  }
  console.log(`  Match: ${okB}/${perSuite} = ${((okB / perSuite) * 100).toFixed(1)}%`);
  totalOk += okB;

  // ─── Suite C: forced active + state-advance trigger ─────────────────
  console.log(
    `\n=== Suite C: all active + bias toward script-advance — ${perSuite} cases ===`,
  );
  let okC = 0;
  for (let i = 0; i < perSuite; i++) {
    const t = genTable(1.0, true); // all active
    for (let s = 0; s < ENTITY_COUNT; s++) {
      const off = s * ENTITY_STRIDE;
      t[off + 0x24] = 0xff;
      t[off + 0x25] = Math.floor(rng() * 8);
      // entity[0x1A]: random in {0, 1, 2}.
      t[off + 0x1a] = Math.floor(rng() * 3);
      // entity[0x1B]: timer — mix of 0 and 1.
      t[off + 0x1b] = Math.floor(rng() * 4);
      // entity[0x4]: vel pivot vs random.
      if (rng() < 0.3) {
        t[off + 0x4] = 0xff;
        t[off + 0x5] = 0xfe;
        t[off + 0x6] = 0x00;
        t[off + 0x7] = 0x00;
      }
    }
    const seed = rs();
    if (runOneCase("C", i, t, seed, 4, rb(), rl())) okC++;
  }
  console.log(`  Match: ${okC}/${perSuite} = ${((okC / perSuite) * 100).toFixed(1)}%`);
  totalOk += okC;

  // ─── Suite D: edge cases (substate=2, recheck path, sound trigger) ──
  const sizeD = perSuite + remainder;
  console.log(
    `\n=== Suite D: edge cases (recheck path + sound-gate) — ${sizeD} cases ===`,
  );
  let okD = 0;
  for (let i = 0; i < sizeD; i++) {
    const t = genTable(0.8, true);
    for (let s = 0; s < ENTITY_COUNT; s++) {
      const off = s * ENTITY_STRIDE;
      if (rng() < 0.5) t[off + 0x1a] = 2;
      // entity[0x14] (depth): sometimes 0, sometimes negative, sometimes positive.
      const d = rng();
      if (d < 0.33) {
        // 0 → cc62 returns 0, cmp 0,0 → ble true → no clamp
        t[off + 0x14] = 0;
        t[off + 0x15] = 0;
        t[off + 0x16] = 0;
        t[off + 0x17] = 0;
      } else if (d < 0.66) {
        // negative: 0xFF000000
        t[off + 0x14] = 0xff;
      }
      // X.w >> 3 < 0x35 → X.w < 0x1A8 (≈ 424).
      if (rng() < 0.5) {
        const xw = Math.floor(rng() * 0x180);
        t[off + 0x0c] = (xw >>> 8) & 0xff;
        t[off + 0x0d] = xw & 0xff;
      }
      // entity[0x22]: screen Y in [0, 0xF0).
      if (rng() < 0.5) {
        const sy = Math.floor(rng() * 0xf0);
        t[off + 0x22] = (sy >>> 8) & 0xff;
        t[off + 0x23] = sy & 0xff;
      }
    }
    const seed = rs();
    if (runOneCase("D", i, t, seed, 4, rb(), rl())) okD++;
  }
  console.log(`  Match: ${okD}/${sizeD} = ${((okD / sizeD) * 100).toFixed(1)}%`);
  totalOk += okD;

  console.log(
    `\n=== TOTAL: ${totalOk}/${total} = ${((totalOk / total) * 100).toFixed(1)}% ===`,
  );
  if (failHolder.value !== null) {
    const f = failHolder.value;
    console.log(`  First fail (suite ${f.suite} tc=${f.tc}): ${f.reason}`);
    console.log(`    rngSeed bin=0x${f.binSeed.toString(16)} ts=0x${f.tsSeed.toString(16)}`);
    console.log(`    inputSeed=0x${f.inputSeed.toString(16)} gameMode=0x${f.inputGameMode.toString(16)} spawnEnable=0x${f.inputSpawnEnable.toString(16)} frameCounter=0x${f.inputFrameCounter.toString(16)}`);
    for (let i = 0; i < TABLE_SIZE; i++) {
      if (f.binTable[i] !== f.tsTable[i]) {
        const slot = Math.floor(i / ENTITY_STRIDE);
        console.log(`    slot ${slot} diff @ 0x${(i % ENTITY_STRIDE).toString(16)}: bin=0x${f.binTable[i]!.toString(16)} ts=0x${f.tsTable[i]!.toString(16)}`);
        // Print whole entity for this slot.
        const slotOff = slot * ENTITY_STRIDE;
        const inB = Array.from(f.binTable.slice(slotOff, slotOff + ENTITY_STRIDE), x => x.toString(16).padStart(2, "0")).join(" ");
        const inT = Array.from(f.tsTable.slice(slotOff, slotOff + ENTITY_STRIDE), x => x.toString(16).padStart(2, "0")).join(" ");
        const inI = Array.from(f.inputTable.slice(slotOff, slotOff + ENTITY_STRIDE), x => x.toString(16).padStart(2, "0")).join(" ");
        console.log(`      input: ${inI}`);
        console.log(`      bin:   ${inB}`);
        console.log(`      ts:    ${inT}`);
        break;
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
