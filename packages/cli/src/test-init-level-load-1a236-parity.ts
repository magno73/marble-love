#!/usr/bin/env node
/**
 * test-init-level-load-1a236-parity.ts — differential FUN_1A236 vs initLevelLoad1A236.
 *
 *
 *   1. Patch each entry point of the 4 subs with
 *        `addq.b #1, sentinel.l ; rts`     (8 byte)
 *        - 4 sentinel byte (0x4003E0..0x4003E3)
 *   3. Run `initLevelLoad1A236()` with 4 callbacks that increment
 *      the stessi 4 sentinel byte in `state.workRam`.
 *
 * Pattern variation per case:
 *     read-modify-write).
 *
 * Uso: npx tsx packages/cli/src/test-init-level-load-1a236-parity.ts [N]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import {
  state as stateNs,
  initLevelLoad1A236 as illNs,
  bus as busNs,
} from "@marble-love/engine";
import {
  createCpu,
  callFunction,
  pokeMem,
  peekMem,
  disposeCpu,
} from "./binary-oracle-lib.js";

const FUN_1A236 = 0x0001a236;

// Sub-function entry points patchati a stub.
const SUB_CLEAR_ALPHA_TILES = 0x00028c7e; // FUN_28C7E
const SUB_CLEAR_MO_ALPHA = 0x00012174; // FUN_12174
const SUB_FUN_16F6C = 0x00016f6c; // FUN_16F6C
const SUB_PALETTE_INIT_LEVEL = 0x0001a41e; // FUN_1A41E

// Sentinel slot in work RAM (uno per stub).
const SENTINEL_BASE = 0x004003e0;
const SENT_CLEAR_ALPHA_TILES = SENTINEL_BASE + 0;
const SENT_CLEAR_MO_ALPHA = SENTINEL_BASE + 1;
const SENT_FUN_16F6C = SENTINEL_BASE + 2;
const SENT_PALETTE_INIT_LEVEL = SENTINEL_BASE + 3;

const GLOB_GAME_MODE = 0x00400394;
const GLOB_SLAPSTIC_INDEX = 0x00400662;
const GLOB_COUNTER_FLAG = 0x00400664;
const GLOB_LEVEL_PTR_DST = 0x00400474;

const SUBS_LIST = [
  { name: "clearAlphaTiles", entry: SUB_CLEAR_ALPHA_TILES, sentinel: SENT_CLEAR_ALPHA_TILES },
  { name: "clearMoAlphaRam", entry: SUB_CLEAR_MO_ALPHA, sentinel: SENT_CLEAR_MO_ALPHA },
  { name: "fun16F6C", entry: SUB_FUN_16F6C, sentinel: SENT_FUN_16F6C },
  { name: "paletteInitLevel", entry: SUB_PALETTE_INIT_LEVEL, sentinel: SENT_PALETTE_INIT_LEVEL },
] as const;

/**
 * Encode `addq.b #1, (sentinelAddr).l ; rts` (8 byte) in `rom` a `entry`.
 */
function patchStubAddq(rom: Buffer, entry: number, sentinelAddr: number): void {
  // addq.b #1, abs.l → 0x52 0x39
  rom[entry + 0] = 0x52;
  rom[entry + 1] = 0x39;
  rom[entry + 2] = (sentinelAddr >>> 24) & 0xff;
  rom[entry + 3] = (sentinelAddr >>> 16) & 0xff;
  rom[entry + 4] = (sentinelAddr >>> 8) & 0xff;
  rom[entry + 5] = sentinelAddr & 0xff;
  // rts
  rom[entry + 6] = 0x4e;
  rom[entry + 7] = 0x75;
}

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) >>> 0;
    return ((s >>> 16) & 0xffff) / 0x10000;
  };
}

interface FailRecord {
  i: number;
  field: string;
  bin: number;
  ts: number;
  scratch: number;
}

async function main(): Promise<void> {
  const n = Number(process.argv[2] ?? "500");

  const romPath = resolve("ghidra_project/marble_program.bin");
  if (!existsSync(romPath)) {
    console.error(`error: ROM blob not found at ${romPath}`);
    exit(3);
  }
  const romBuf = Buffer.from(readFileSync(romPath));

  // Pre-patch ROM buffer with addq+rts stubs at each of the 4 entry points.
  for (const sub of SUBS_LIST) {
    patchStubAddq(romBuf, sub.entry, sub.sentinel);
  }

  const romView = busNs.emptyRomImage();
  romView.program.set(romBuf);

  const stateInst = stateNs.emptyGameState();
  const cpu = await createCpu({ rom: romBuf, state: stateInst });

  console.log(`\n=== initLevelLoad1A236 (FUN_1A236) — ${n} cases ===`);
  const rng = makeRng(0x1a236);
  const rb = (): number => Math.floor(rng() * 256) & 0xff;

  // TS subs that increment sentinel slots in workRam.
  const incSent = (s: typeof stateInst, off: number): void => {
    const a = off - 0x400000;
    s.workRam[a] = ((s.workRam[a] ?? 0) + 1) & 0xff;
  };
  const subs: illNs.InitLevelLoad1A236Subs = {
    clearAlphaTiles: (s) => incSent(s, SENT_CLEAR_ALPHA_TILES),
    clearMoAlphaRam: (s) => incSent(s, SENT_CLEAR_MO_ALPHA),
    fun16F6C: (s) => incSent(s, SENT_FUN_16F6C),
    paletteInitLevel: (s) => incSent(s, SENT_PALETTE_INIT_LEVEL),
  };

  let ok = 0;
  let firstFail: FailRecord | null = null;

  for (let i = 0; i < n; i++) {
    cpu.system.setRegister("sp", 0x401f00);

    const preGameMode = ((rb() << 8) | rb()) & 0xffff;
    const preSlapstic = ((rb() << 8) | rb()) & 0xffff;
    const preCounter = ((rb() << 8) | rb()) & 0xffff;
    pokeMem(cpu, GLOB_GAME_MODE, 2, preGameMode);
    pokeMem(cpu, GLOB_SLAPSTIC_INDEX, 2, preSlapstic);
    pokeMem(cpu, GLOB_COUNTER_FLAG, 2, preCounter);
    stateInst.workRam[GLOB_GAME_MODE - 0x400000] = (preGameMode >>> 8) & 0xff;
    stateInst.workRam[GLOB_GAME_MODE - 0x400000 + 1] = preGameMode & 0xff;
    stateInst.workRam[GLOB_SLAPSTIC_INDEX - 0x400000] = (preSlapstic >>> 8) & 0xff;
    stateInst.workRam[GLOB_SLAPSTIC_INDEX - 0x400000 + 1] = preSlapstic & 0xff;
    stateInst.workRam[GLOB_COUNTER_FLAG - 0x400000] = (preCounter >>> 8) & 0xff;
    stateInst.workRam[GLOB_COUNTER_FLAG - 0x400000 + 1] = preCounter & 0xff;

    // Pre-fill dirty of the level pointer dst (long).
    const preLevelDst = ((rb() << 24) | (rb() << 16) | (rb() << 8) | rb()) >>> 0;
    pokeMem(cpu, GLOB_LEVEL_PTR_DST, 4, preLevelDst);
    stateInst.workRam[GLOB_LEVEL_PTR_DST - 0x400000 + 0] = (preLevelDst >>> 24) & 0xff;
    stateInst.workRam[GLOB_LEVEL_PTR_DST - 0x400000 + 1] = (preLevelDst >>> 16) & 0xff;
    stateInst.workRam[GLOB_LEVEL_PTR_DST - 0x400000 + 2] = (preLevelDst >>> 8) & 0xff;
    stateInst.workRam[GLOB_LEVEL_PTR_DST - 0x400000 + 3] = preLevelDst & 0xff;

    // Random pre-fill for the 4 sentinel bytes, exercising +1 wrap.
    const scratch = new Uint8Array(4);
    for (let k = 0; k < 4; k++) {
      const v = rb();
      scratch[k] = v;
      pokeMem(cpu, SENTINEL_BASE + k, 1, v);
      stateInst.workRam[(SENTINEL_BASE - 0x400000) + k] = v;
    }

    callFunction(cpu, FUN_1A236, []);
    // Esegui TS
    illNs.initLevelLoad1A236(stateInst, romView, subs);

    let fail: FailRecord | null = null;

    const checks: Array<{ name: string; addr: number; size: 2 | 4 }> = [
      { name: "gameMode", addr: GLOB_GAME_MODE, size: 2 },
      { name: "slapsticIdx", addr: GLOB_SLAPSTIC_INDEX, size: 2 },
      { name: "counterFlag", addr: GLOB_COUNTER_FLAG, size: 2 },
      { name: "levelPtrDst", addr: GLOB_LEVEL_PTR_DST, size: 4 },
    ];
    for (const c of checks) {
      for (let off = 0; off < c.size; off++) {
        const b = peekMem(cpu, c.addr + off, 1) & 0xff;
        const t = stateInst.workRam[(c.addr - 0x400000) + off] ?? 0;
        if (b !== t) {
          fail = {
            i,
            field: `${c.name}+${off}`,
            bin: b,
            ts: t,
            scratch: 0,
          };
          break;
        }
      }
      if (fail) break;
    }

    if (fail === null) {
      // 4 sentinel bytes; each must be == (scratch+1) & 0xff.
      for (let k = 0; k < 4; k++) {
        const expected = ((scratch[k] ?? 0) + 1) & 0xff;
        const b = peekMem(cpu, SENTINEL_BASE + k, 1) & 0xff;
        const t = stateInst.workRam[(SENTINEL_BASE - 0x400000) + k] ?? 0;
        if (b !== t || b !== expected) {
          fail = {
            i,
            field: SUBS_LIST[k]?.name ?? `sentinel${k}`,
            bin: b,
            ts: t,
            scratch: scratch[k] ?? 0,
          };
          break;
        }
      }
    }

    if (fail === null) {
      ok++;
    } else if (firstFail === null) {
      firstFail = fail;
    }
  }

  console.log(`  Match: ${ok}/${n} = ${((ok / n) * 100).toFixed(1)}%`);
  if (firstFail) {
    const f = firstFail;
    console.log(`  First fail @ case ${f.i}`);
    console.log(
      `    ${f.field}: scratch=0x${f.scratch.toString(16)} ` +
        `bin=0x${f.bin.toString(16)} ts=0x${f.ts.toString(16)}`,
    );
  }

  disposeCpu(cpu);
  exit(ok === n ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  exit(1);
});
