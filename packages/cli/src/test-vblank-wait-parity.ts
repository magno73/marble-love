#!/usr/bin/env node
/**
 * test-vblank-wait-parity.ts — differential FUN_000052B8 vs waitVblank.
 *
 * (seen for example @ 0x5D02..0x5D0C):
 *
 *   pea     (0xa).w        ; arg long (low word = count)
 *   jsr     0x000052b8.l   ; busy-wait
 *   addq.l  0x4,SP         ; pop arg
 *
 * Internally:
 *   move.w  (0xa,SP),D0w
 *   bra     test
 * loop:
 *   move.l  (0x401FF8).l,D2
 *   inner: move.l (0x401FF8).l,D1; cmp D2,D1; beq inner
 *   subq.w  #1,D0w
 * test:  tst.w D0w; bgt loop
 *
 * outer loop.
 *
 * **Output compared**: D0w (low word of D0) and workRam unchanged.
 *
 * **Distribution**:
 *
 * Usage: npx tsx packages/cli/src/test-vblank-wait-parity.ts [N]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import { state as stateNs, vblankWait as vwNs } from "@marble-love/engine";
import {
  createCpu,
  pokeMem,
  disposeCpu,
} from "./binary-oracle-lib.js";

const FUN_VBLANK_WAIT = 0x000052b8;
const VBLANK_COUNTER_ADDR = 0x00401ff8;
const SENTINEL_RET = 0xcafebabe >>> 0;

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) >>> 0;
    return ((s >>> 16) & 0xffff) / 0x10000;
  };
}

interface Snapshot {
  bytes: Uint8Array;
}

function snapshotWorkRam(cpu: ReturnType<typeof createCpu> extends Promise<infer S> ? S : never): Snapshot {
  // Read entire work RAM 0x400000..0x401FFF (8 KB)
  const bytes = cpu.system.readBytes(0x400000, 0x2000);
  return { bytes };
}

function workRamDiffers(
  a: Uint8Array,
  b: Uint8Array,
  ignores: ReadonlyArray<readonly [off: number, len: number]>,
): number {
  for (let i = 0; i < a.length; i++) {
    let masked = false;
    for (const [off, len] of ignores) {
      if (i >= off && i < off + len) {
        masked = true;
        break;
      }
    }
    if (masked) continue;
    if (a[i] !== b[i]) return i;
  }
  return -1;
}

async function main(): Promise<void> {
  const n = Number(process.argv[2] ?? "500");

  const romPath = resolve("ghidra_project/marble_program.bin");
  if (!existsSync(romPath)) {
    console.error(`error: ROM blob not found at ${romPath}`);
    exit(3);
  }
  const rom = readFileSync(romPath);

  const state = stateNs.emptyGameState();
  const cpu = await createCpu({ rom, state });

  // We use writeRaw8 to bypass callbacks/MMIO and write directly
  let injectionsActive = true;
  let injectCount = 0;
  let injectedValue = 0;
  const dispose = cpu.system.onMemoryRead((event) => {
    if (!injectionsActive) return;
    if (event.addr === VBLANK_COUNTER_ADDR && event.size === 4) {
      injectedValue = (injectedValue + 1) >>> 0;
      cpu.system.writeRaw8(VBLANK_COUNTER_ADDR + 0, (injectedValue >>> 24) & 0xff);
      cpu.system.writeRaw8(VBLANK_COUNTER_ADDR + 1, (injectedValue >>> 16) & 0xff);
      cpu.system.writeRaw8(VBLANK_COUNTER_ADDR + 2, (injectedValue >>> 8) & 0xff);
      cpu.system.writeRaw8(VBLANK_COUNTER_ADDR + 3, injectedValue & 0xff);
      injectCount++;
    }
  });

  console.log(`\n=== waitVblank (FUN_000052B8) — ${n} cases ===`);

  const rng = makeRng(0xdeadbeef);
  let ok = 0;
  let firstFail: {
    i: number;
    countWord: number;
    binD0w: number;
    tsD0w: number;
    workRamMismatchOff: number;
  } | null = null;

  for (let i = 0; i < n; i++) {
    let countWord: number;
    if (i === 0) {
      countWord = 0;
    } else if (i === 1) {
      countWord = 1;
    } else if (i === 2) {
      countWord = -1 & 0xffff;
    } else if (i === 3) {
      countWord = 0x8000; // -32768 signed
    } else if (i === 4) {
      countWord = 0x7fff;
    } else if (i % 2 === 0) {
      // count signed <= 0: range [-32768..0]
      countWord = Math.floor(rng() * 0x8001) | 0; // 0..0x8000
      if (countWord !== 0) countWord = (-countWord) & 0xffff;
    } else {
      countWord = (Math.floor(rng() * 16) + 1) & 0xffff;
    }

    // About 65k counter reads are too slow with the callback. Skip
    let runOnBinary = true;
    if (i === 4) {
      const tsD0w = vwNs.waitVblank(state, countWord) & 0xffff;
      if (tsD0w === 0) ok++;
      else if (firstFail === null) {
        firstFail = { i, countWord, binD0w: -1, tsD0w, workRamMismatchOff: -1 };
      }
      runOnBinary = false;
    }
    if (!runOnBinary) continue;

    // Pre-zero of the counter @ 0x401FF8 and reset injectedValue
    pokeMem(cpu, VBLANK_COUNTER_ADDR, 4, 0);
    injectedValue = 0;

    const countSigned = (countWord & 0x8000) ? countWord - 0x10000 : countWord;
    const argLong = countSigned >>> 0;

    // Setup stack: SP a 0x401E80, push arg long, push sentinel return.
    const initialSp = 0x401e80;
    cpu.system.setRegister("sp", initialSp);
    let sp = initialSp;
    sp = (sp - 4) >>> 0;
    cpu.system.write(sp, 4, argLong);
    sp = (sp - 4) >>> 0;
    cpu.system.write(sp, 4, SENTINEL_RET);
    cpu.system.setRegister("sp", sp);
    cpu.system.setRegister("pc", FUN_VBLANK_WAIT);
    // Pre-fill D0/D1 with sentinels to detect undocumented clobbering.
    cpu.system.setRegister("d0", 0xdeadbeef);
    cpu.system.setRegister("d1", 0xcafedab0);

    // are in the "before" and do not produce false mismatches).
    const before = snapshotWorkRam(cpu);

    const injBefore = injectCount;
    const MAX_STEPS = 200_000;
    let stepCount = 0;
    while (stepCount < MAX_STEPS) {
      if (cpu.system.getRegisters().pc === SENTINEL_RET) break;
      cpu.system.step();
      stepCount++;
    }
    // Pop sentinel + arg long (SP back to initialSp).
    cpu.system.setRegister("sp", (cpu.system.getRegisters().sp + 8) >>> 0);

    const binD0 = cpu.system.getRegisters().d0 >>> 0;
    const binD0w = binD0 & 0xffff;
    if (process.env.VBW_DEBUG) {
      const finalPc = cpu.system.getRegisters().pc;
      console.log(
        `  case ${i}: countWord=0x${countWord.toString(16)} arg=0x${argLong.toString(16)} steps=${stepCount}` +
        ` injReads=${injectCount - injBefore} binD0=0x${binD0.toString(16)} binD0w=0x${binD0w.toString(16)} finalPC=0x${finalPc.toString(16)}`,
      );
    }

    const after = snapshotWorkRam(cpu);
    // Ignore VBLANK counter region @ 0x1FF8..0x1FFB, modified
    // due to the injection during the execution of the busy-wait).
    const wramMismatch = workRamDiffers(before.bytes, after.bytes, [
      [0x1ff8, 4],
    ]);

    // TS run
    const tsD0w = vwNs.waitVblank(state, countWord) & 0xffff;

    const match = binD0w === tsD0w && wramMismatch === -1;
    if (match) {
      ok++;
    } else if (firstFail === null) {
      firstFail = {
        i,
        countWord,
        binD0w,
        tsD0w,
        workRamMismatchOff: wramMismatch,
      };
    }
  }

  injectionsActive = false;
  dispose();

  console.log(`  Match: ${ok}/${n} = ${((ok / n) * 100).toFixed(1)}%`);
  if (firstFail) {
    console.log(`  First fail @ case ${firstFail.i}:`);
    console.log(
      `    countWord=0x${firstFail.countWord.toString(16)}`
        + ` (signed=${(firstFail.countWord & 0x8000) ? firstFail.countWord - 0x10000 : firstFail.countWord})`,
    );
    console.log(
      `    bin D0w=0x${firstFail.binD0w.toString(16)}` +
      `   ts D0w=0x${firstFail.tsD0w.toString(16)}` +
      `   workRam mismatch off=${firstFail.workRamMismatchOff}`,
    );
  }

  disposeCpu(cpu);
  exit(ok === n ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  exit(1);
});
