#!/usr/bin/env node
/**
 * test-obj-dirty-dispatch-28624-parity.ts — differential FUN_00028624 vs
 * `objDirtyDispatch28624` TS replica.
 *
 * `FUN_00028624` (140 byte) itera D2 = 0..count-1 (count = word @ 0x400396),
 * `FUN_00028E3C` with 6 derived long args. On loop completion: clear bitmap.
 *
 *   - In TS, `objDirtyDispatch28624` receives a `renderStringHelper` sub that
 *     increments the same byte in `state.workRam[0x3E0]`.
 *       2. bitmap byte @ 0x40039C (DEVE essere 0 in entrambi i lati).
 *       3. count word @ 0x400396 unchanged.
 *       4. 64 bytes of workRam scratch around 0x39C (bitmap + sentinel +
 *
 *   - bitmap byte @ 0x40039C random (0..255).
 *
 * Uso: npx tsx packages/cli/src/test-obj-dirty-dispatch-28624-parity.ts [N]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import {
  state as stateNs,
  objDirtyDispatch28624 as dispatchNs,
} from "@marble-love/engine";
import {
  createCpu,
  callFunction,
  pokeMem,
  peekMem,
  disposeCpu,
} from "./binary-oracle-lib.js";

const FUN_28624 = 0x00028624;
const FUN_28E3C = 0x00028e3c;

const OBJECTS_BASE_ADDR = 0x00400018;
const OBJECT_STRIDE = 0xe2;
const COUNT_ADDR = 0x00400396;
const BITMAP_ADDR = 0x0040039c;

// Sentinel byte slot in work RAM (= count of executed jsr 28E3C calls).
const SENTINEL_ADDR = 0x004003e0;

const ROM_TABLE_ADDR = 0x00023d3a;

/**
 * Encode `addq.b #1, (abs).l ; rts` (8 byte) in `rom` a `entry`.
 * - addq.b #1, (xxxx).l → 0x52 0x39 + abs long
 * - rts                 → 0x4E 0x75
 */
function patchStubAddq(rom: Buffer, entry: number, sentinelAddr: number): void {
  rom[entry + 0] = 0x52;
  rom[entry + 1] = 0x39;
  rom[entry + 2] = (sentinelAddr >>> 24) & 0xff;
  rom[entry + 3] = (sentinelAddr >>> 16) & 0xff;
  rom[entry + 4] = (sentinelAddr >>> 8) & 0xff;
  rom[entry + 5] = sentinelAddr & 0xff;
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

interface CaseSetup {
  count: number;
  bitmap: number;
  sentinelInit: number;
  objArg1: number[]; // long per ogni obj 0..count-1
}

interface FailRecord {
  i: number;
  field: string;
  bin: number;
  ts: number;
  setup: CaseSetup;
}

async function main(): Promise<void> {
  const n = Number(process.argv[2] ?? "500");

  const romPath = resolve("ghidra_project/marble_program.bin");
  if (!existsSync(romPath)) {
    console.error(`error: ROM blob not found at ${romPath}`);
    exit(3);
  }
  const romBuf = Buffer.from(readFileSync(romPath));

  // Pre-patch FUN_28E3C → addq.b #1, sentinel.l ; rts.
  patchStubAddq(romBuf, FUN_28E3C, SENTINEL_ADDR);

  const stateInst = stateNs.emptyGameState();
  const cpu = await createCpu({ rom: romBuf, state: stateInst });

  // Leggiamo 16 byte (count max nei test = 8, ma teniamo margine).
  const romTab = new Uint8Array(16);
  for (let k = 0; k < 16; k++) {
    romTab[k] = romBuf[ROM_TABLE_ADDR + k] ?? 0;
  }

  console.log(`\n=== objDirtyDispatch28624 (FUN_00028624) — ${n} casi ===`);
  const rng = makeRng(0x28624);

  const subs: dispatchNs.ObjDirtyDispatch28624Subs = {
    renderStringHelper: (s) => {
      const off = SENTINEL_ADDR - 0x400000;
      s.workRam[off] = ((s.workRam[off] ?? 0) + 1) & 0xff;
    },
  };

  let ok = 0;
  let firstFail: FailRecord | null = null;

  for (let i = 0; i < n; i++) {
    cpu.system.setRegister("sp", 0x401f00);

    // Setup setup random
    const count = Math.floor(rng() * 9);
    const bitmap = Math.floor(rng() * 256) & 0xff;
    const sentinelInit = Math.floor(rng() * 256) & 0xff;
    const objArg1: number[] = [];
    for (let k = 0; k < count; k++) {
      objArg1.push(Math.floor(rng() * 0x100000000) >>> 0);
    }
    const setup: CaseSetup = { count, bitmap, sentinelInit, objArg1 };

    // count word
    pokeMem(cpu, COUNT_ADDR, 2, count & 0xffff);
    stateInst.workRam[COUNT_ADDR - 0x400000] = (count >>> 8) & 0xff;
    stateInst.workRam[COUNT_ADDR - 0x400000 + 1] = count & 0xff;
    // bitmap byte
    pokeMem(cpu, BITMAP_ADDR, 1, bitmap);
    stateInst.workRam[BITMAP_ADDR - 0x400000] = bitmap;
    // sentinel byte
    pokeMem(cpu, SENTINEL_ADDR, 1, sentinelInit);
    stateInst.workRam[SENTINEL_ADDR - 0x400000] = sentinelInit;

    for (let k = 0; k < count; k++) {
      const objAddr = OBJECTS_BASE_ADDR + k * OBJECT_STRIDE;
      const arg1 = objArg1[k] ?? 0;
      pokeMem(cpu, objAddr + 0xbc, 4, arg1 >>> 0);
      const off = objAddr - 0x400000 + 0xbc;
      stateInst.workRam[off] = (arg1 >>> 24) & 0xff;
      stateInst.workRam[off + 1] = (arg1 >>> 16) & 0xff;
      stateInst.workRam[off + 2] = (arg1 >>> 8) & 0xff;
      stateInst.workRam[off + 3] = arg1 & 0xff;
    }

    callFunction(cpu, FUN_28624, []);

    // ── Esegui TS ──────────────────────────────────────────────────────
    dispatchNs.objDirtyDispatch28624(stateInst, romTab, subs);

    let fail: FailRecord | null = null;

    // 1) sentinel byte (popcount + sentinelInit, mod 256)
    const sentBin = peekMem(cpu, SENTINEL_ADDR, 1) & 0xff;
    const sentTs = stateInst.workRam[SENTINEL_ADDR - 0x400000] ?? 0;
    if (sentBin !== sentTs) {
      fail = {
        i,
        field: "sentinel",
        bin: sentBin,
        ts: sentTs,
        setup,
      };
    }

    // 2) bitmap byte must be 0 on both sides.
    if (fail === null) {
      const bmBin = peekMem(cpu, BITMAP_ADDR, 1) & 0xff;
      const bmTs = stateInst.workRam[BITMAP_ADDR - 0x400000] ?? 0;
      if (bmBin !== 0 || bmTs !== 0) {
        fail = {
          i,
          field: "bitmap_cleared",
          bin: bmBin,
          ts: bmTs,
          setup,
        };
      }
    }

    if (fail === null) {
      const cBin = peekMem(cpu, COUNT_ADDR, 2) & 0xffff;
      const cTs =
        ((stateInst.workRam[COUNT_ADDR - 0x400000] ?? 0) << 8) |
        (stateInst.workRam[COUNT_ADDR - 0x400000 + 1] ?? 0);
      if (cBin !== count || cTs !== count) {
        fail = { i, field: "count_word", bin: cBin, ts: cTs, setup };
      }
    }

    // bitmap has only 8 bits set.
    if (fail === null) {
      let popcount = 0;
      const limit = Math.min(count, 8);
      for (let b = 0; b < limit; b++) {
        if ((bitmap >> b) & 1) popcount++;
      }
      const expected = (sentinelInit + popcount) & 0xff;
      if (sentBin !== expected) {
        fail = {
          i,
          field: "sentinel_expected",
          bin: sentBin,
          ts: expected,
          setup,
        };
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
      `    ${f.field}: bin=0x${f.bin.toString(16)} ts=0x${f.ts.toString(16)}`,
    );
    console.log(
      `    setup: count=${f.setup.count} bitmap=0x${f.setup.bitmap.toString(16)} ` +
        `sentinelInit=0x${f.setup.sentinelInit.toString(16)}`,
    );
  }

  disposeCpu(cpu);
  exit(ok === n ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  exit(1);
});
