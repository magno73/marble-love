#!/usr/bin/env node
/**
 * test-hud-frame-init-283c2-parity.ts — differential FUN_000283C2 vs
 * `hudFrameInit283C2` TS replica.
 *
 *      0x23C74/0x23CA4.
 *
 * `test-get-alpha-tile-addr-parity.ts` e `test-format-and-render-28e00-parity.ts`).
 *
 * `hudFrameInit283C2`, confrontiamo the intero alpha RAM (4 KB) byte-by-byte.
 * Setup random:
 *   - rotation flag @ 0x401F42 ∈ [0..7] (esercita branch rotation in
 *     `getAlphaTileAddr` e `setAlphaTile`)
 *   - player count @ 0x400396 in {1, 2, 0, 3} (1 -> 1P branch, others -> 2P)
 *   - alpha RAM init: random pattern 0..255 on each byte (per esercitare
 *     write-over)
 *   - workRam[0x1F42] set explicitly; the rest of the workRam too
 *
 * Suite:
 *   A: rotation=0 1P (typical case, layout standard 64×30)
 *   B: rotation=0 2P
 *   C: rotation 1..7, count random 0..3 (esercita rotation branch +
 *      bne 1P selector)
 *   D: count edge cases (0, 1, 2, 65535) + rotation random
 *
 * Uso: npx tsx packages/cli/src/test-hud-frame-init-283c2-parity.ts [N]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import {
  state as stateNs,
  hudFrameInit283C2 as hudNs,
  bus as busNs,
} from "@marble-love/engine";
import type { RomImage } from "@marble-love/engine";
import {
  createCpu,
  callFunction,
  pokeMem,
  peekMem,
  disposeCpu,
} from "./binary-oracle-lib.js";

const FUN_283C2 = 0x000283c2;

const PLAYER_COUNT_ADDR = 0x00400396;
const ROTATION_ADDR = 0x00401f42;
const ALPHA_RAM_BASE = 0xa03000;
const ALPHA_RAM_SIZE = 0x1000; // 4 KB

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) >>> 0;
    return ((s >>> 16) & 0xffff) / 0x10000;
  };
}

interface CaseSetup {
  playerCount: number; // word @ 0x400396
  rotation: number;    // word @ 0x401F42
  alphaSeed: number;   // seed for alpha RAM random init
}

interface FailRecord {
  suite: string;
  tc: number;
  offset: number;
  bin: number;
  ts: number;
  setup: CaseSetup;
}

async function main(): Promise<void> {
  const total = Number(process.argv[2] ?? "500");

  const romPath = resolve("ghidra_project/marble_program.bin");
  if (!existsSync(romPath)) {
    console.error(`error: ROM blob not found at ${romPath}`);
    exit(3);
  }
  const rom = readFileSync(romPath);

  const stateInst = stateNs.emptyGameState();
  const cpu = await createCpu({ rom, state: stateInst });

  const tsRom: RomImage = busNs.emptyRomImage();
  tsRom.program.set(rom.subarray(0, tsRom.program.length));

  let totalOk = 0;
  const failHolder: { value: FailRecord | null } = { value: null };

  function setupCase(setup: CaseSetup): void {
    // 1) player count word
    pokeMem(cpu, PLAYER_COUNT_ADDR, 2, setup.playerCount & 0xffff);
    stateInst.workRam[PLAYER_COUNT_ADDR - 0x400000] =
      (setup.playerCount >>> 8) & 0xff;
    stateInst.workRam[PLAYER_COUNT_ADDR - 0x400000 + 1] =
      setup.playerCount & 0xff;

    // 2) rotation flag word
    pokeMem(cpu, ROTATION_ADDR, 2, setup.rotation & 0xffff);
    stateInst.workRam[ROTATION_ADDR - 0x400000] =
      (setup.rotation >>> 8) & 0xff;
    stateInst.workRam[ROTATION_ADDR - 0x400000 + 1] =
      setup.rotation & 0xff;

    // 3) alpha RAM random init (sincronizzato bin↔TS).
    const r = makeRng(setup.alphaSeed);
    for (let j = 0; j < ALPHA_RAM_SIZE; j++) {
      const b = Math.floor(r() * 256) & 0xff;
      pokeMem(cpu, ALPHA_RAM_BASE + j, 1, b);
      stateInst.alphaRam[j] = b;
    }
  }

  function runOneCase(suite: string, tc: number, setup: CaseSetup): boolean {
    cpu.system.setRegister("sp", 0x401f00);
    setupCase(setup);

    // BIN: callFunction (0 args, 0 ret per FUN_283C2)
    callFunction(cpu, FUN_283C2, []);

    // TS: replica
    hudNs.hudFrameInit283C2(stateInst, tsRom);

    for (let j = 0; j < ALPHA_RAM_SIZE; j++) {
      const b = peekMem(cpu, ALPHA_RAM_BASE + j, 1) & 0xff;
      const t = stateInst.alphaRam[j] ?? 0;
      if (b !== t) {
        if (failHolder.value === null) {
          failHolder.value = {
            suite,
            tc,
            offset: j,
            bin: b,
            ts: t,
            setup,
          };
        }
        return false;
      }
    }
    return true;
  }

  // ─── Suite A: rotation=0, 1P ──────────────────────────────────────────
  const sizeA = Math.floor(total / 4);
  console.log(`\n=== hudFrameInit283C2 (FUN_283C2) — Suite A: rot=0 1P — ${sizeA} cases ===`);
  let okA = 0;
  {
    const rng = makeRng(0x283c2a);
    for (let i = 0; i < sizeA; i++) {
      const setup: CaseSetup = {
        playerCount: 1,
        rotation: 0,
        alphaSeed: Math.floor(rng() * 0x100000000) >>> 0,
      };
      if (runOneCase("A", i, setup)) okA++;
    }
    console.log(`  Match: ${okA}/${sizeA} = ${((okA / sizeA) * 100).toFixed(1)}%`);
    totalOk += okA;
  }

  // ─── Suite B: rotation=0, 2P ──────────────────────────────────────────
  const sizeB = Math.floor(total / 4);
  console.log(`\n=== Suite B: rot=0 2P — ${sizeB} cases ===`);
  let okB = 0;
  {
    const rng = makeRng(0x283c2b);
    for (let i = 0; i < sizeB; i++) {
      const setup: CaseSetup = {
        playerCount: 2,
        rotation: 0,
        alphaSeed: Math.floor(rng() * 0x100000000) >>> 0,
      };
      if (runOneCase("B", i, setup)) okB++;
    }
    console.log(`  Match: ${okB}/${sizeB} = ${((okB / sizeB) * 100).toFixed(1)}%`);
    totalOk += okB;
  }

  // ─── Suite C: rotation 1..7, count random 0..3 ────────────────────────
  const sizeC = Math.floor(total / 4);
  console.log(`\n=== Suite C: rot 1..7 random count — ${sizeC} cases ===`);
  let okC = 0;
  {
    const rng = makeRng(0x283c2c);
    for (let i = 0; i < sizeC; i++) {
      const setup: CaseSetup = {
        playerCount: Math.floor(rng() * 4), // 0..3
        rotation: 1 + Math.floor(rng() * 7), // 1..7
        alphaSeed: Math.floor(rng() * 0x100000000) >>> 0,
      };
      if (runOneCase("C", i, setup)) okC++;
    }
    console.log(`  Match: ${okC}/${sizeC} = ${((okC / sizeC) * 100).toFixed(1)}%`);
    totalOk += okC;
  }

  // ─── Suite D: edge cases (count 0, 1, 2, 0xFFFF) + rotation random ────
  const sizeD = total - sizeA - sizeB - sizeC;
  console.log(`\n=== Suite D: edge cases (count 0/1/2/0xFFFF) — ${sizeD} cases ===`);
  let okD = 0;
  {
    const rng = makeRng(0x283c2d);
    const counts = [0, 1, 2, 0xffff];
    for (let i = 0; i < sizeD; i++) {
      const setup: CaseSetup = {
        playerCount: counts[i % counts.length]!,
        rotation: Math.floor(rng() * 8),
        alphaSeed: Math.floor(rng() * 0x100000000) >>> 0,
      };
      if (runOneCase("D", i, setup)) okD++;
    }
    console.log(`  Match: ${okD}/${sizeD} = ${((okD / sizeD) * 100).toFixed(1)}%`);
    totalOk += okD;
  }

  console.log(`\n=== TOTALE: ${totalOk}/${total} = ${((totalOk / total) * 100).toFixed(1)}% ===`);
  if (failHolder.value !== null) {
    const f = failHolder.value;
    console.log(
      `  First fail (suite ${f.suite} tc=${f.tc}): alpha+0x${f.offset.toString(16)} ` +
      `bin=0x${f.bin.toString(16)} ts=0x${f.ts.toString(16)}`,
    );
    console.log(
      `    setup: count=0x${f.setup.playerCount.toString(16)} ` +
      `rot=0x${f.setup.rotation.toString(16)} ` +
      `alphaSeed=0x${f.setup.alphaSeed.toString(16)}`,
    );
  }

  disposeCpu(cpu);
  exit(totalOk === total ? 0 : 1);
}

main().catch((e: unknown) => {
  console.error(e);
  exit(1);
});
