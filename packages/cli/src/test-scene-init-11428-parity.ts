#!/usr/bin/env node
/**
 * test-scene-init-11428-parity.ts — differential FUN_00011428 vs sceneInit11428.
 *
 *
 *   1. Patch each entry point of the 6 subs with
 *        `addq.b #1, sentinel.l ; rts`     (8 byte)
 *      i 6 sentinel post-call.
 *   3. Run `sceneInit11428()` with 6 callbacks that increment the
 *      stessi 6 byte in `state.workRam`.
 *
 * Uso: npx tsx packages/cli/src/test-scene-init-11428-parity.ts [N]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import {
  state as stateNs,
  sceneInit11428 as sceneNs,
} from "@marble-love/engine";
import {
  createCpu,
  callFunction,
  pokeMem,
  peekMem,
  disposeCpu,
} from "./binary-oracle-lib.js";

const FUN_11428 = 0x00011428;

// Sub-function entry points patchati a stub.
const SUB_VBLANK_ACK = 0x00028dea;
const SUB_CLEAR_PALETTE = 0x000121a6;
const SUB_CLEAR_MO_ALPHA = 0x00012174;
const SUB_INIT_FN_PTRS = 0x00028580;
const SUB_FILL_LOOP = 0x00028c7e;
const SUB_SCENE_OBJ_INIT = 0x00028ca6;

// Sentinel byte slot in work RAM (uno per stub, 6 totali).
const SENTINEL_BASE = 0x004003e0;
const SENT_VBLANK_ACK = SENTINEL_BASE + 0;
const SENT_CLEAR_PALETTE = SENTINEL_BASE + 1;
const SENT_CLEAR_MO_ALPHA = SENTINEL_BASE + 2;
const SENT_INIT_FN_PTRS = SENTINEL_BASE + 3;
const SENT_FILL_LOOP = SENTINEL_BASE + 4;
const SENT_SCENE_OBJ_INIT = SENTINEL_BASE + 5;

const SUBS_LIST = [
  { name: "vblankAck", entry: SUB_VBLANK_ACK, sentinel: SENT_VBLANK_ACK },
  { name: "clearPaletteRam", entry: SUB_CLEAR_PALETTE, sentinel: SENT_CLEAR_PALETTE },
  { name: "clearMoAlphaRam", entry: SUB_CLEAR_MO_ALPHA, sentinel: SENT_CLEAR_MO_ALPHA },
  { name: "initFnPointers", entry: SUB_INIT_FN_PTRS, sentinel: SENT_INIT_FN_PTRS },
  { name: "fillLoop", entry: SUB_FILL_LOOP, sentinel: SENT_FILL_LOOP },
  { name: "sceneObjInit", entry: SUB_SCENE_OBJ_INIT, sentinel: SENT_SCENE_OBJ_INIT },
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

  // Pre-patch ROM buffer with addq+rts stubs at each of the 6 entry points.
  for (const sub of SUBS_LIST) {
    patchStubAddq(romBuf, sub.entry, sub.sentinel);
  }

  const stateInst = stateNs.emptyGameState();
  const cpu = await createCpu({ rom: romBuf, state: stateInst });

  console.log(`\n=== sceneInit11428 (FUN_00011428) — ${n} casi ===`);
  const rng = makeRng(0x11428);

  // TS subs that increment sentinel slots in workRam.
  const incSent = (s: typeof stateInst, off: number): void => {
    const a = off - 0x400000;
    s.workRam[a] = ((s.workRam[a] ?? 0) + 1) & 0xff;
  };
  const subs: sceneNs.SceneInit11428Subs = {
    vblankAck: (s) => incSent(s, SENT_VBLANK_ACK),
    clearPaletteRam: (s) => incSent(s, SENT_CLEAR_PALETTE),
    clearMoAlphaRam: (s) => incSent(s, SENT_CLEAR_MO_ALPHA),
    initFnPointers: (s) => incSent(s, SENT_INIT_FN_PTRS),
    fillLoop: (s) => incSent(s, SENT_FILL_LOOP),
    sceneObjInit: (s) => incSent(s, SENT_SCENE_OBJ_INIT),
  };

  let ok = 0;
  let firstFail: FailRecord | null = null;

  // (0..255) to exercise +1 wraparound and verify that the orchestrator
  for (let i = 0; i < n; i++) {
    cpu.system.setRegister("sp", 0x401f00);

    // Initial scratch bytes: random for each sentinel.
    const scratch = new Uint8Array(6);
    for (let k = 0; k < 6; k++) {
      const v = Math.floor(rng() * 256) & 0xff;
      scratch[k] = v;
      pokeMem(cpu, SENTINEL_BASE + k, 1, v);
      stateInst.workRam[(SENTINEL_BASE - 0x400000) + k] = v;
    }

    callFunction(cpu, FUN_11428, []);
    // Esegui TS
    sceneNs.sceneInit11428(stateInst, subs);

    let fail: FailRecord | null = null;
    for (let k = 0; k < 6; k++) {
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
