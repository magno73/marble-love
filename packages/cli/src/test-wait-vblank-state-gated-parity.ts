#!/usr/bin/env node
/**
 * test-wait-vblank-state-gated-parity.ts — differential FUN_28DB8 vs
 * waitVblankStateGated.
 *
 * su cambio di game state word (`*0x400390`). Convenzione caller (cfr.
 * `0x10848`, `0x108E8`, ...):
 *   pea     (count).w
 *   jsr     0x00028DB8.l
 *   addq.l  #4, SP
 *
 * *0x400016; spin tst.b/beq; addq.b #1, *0x4003F0). To avoid the
 *
 * **Branch coverage** (8 corner case + ~492 random):
 *   0: count = 0  → loop non parte
 *   1: count = 1, no abort
 *   2: count = -1 (signed) → loop non parte
 *   3: count = 0x8000 (signed = -32768) → loop non parte
 *   5: count = 8, no abort, loByte with bit 7 set (sext_w = 0xFF80)
 *   7: count = 4, no abort, counter wrap (prev=0xFD)
 *
 * **Output confrontato**:
 *   - workRam[0x3F0] (counter byte, side effect principale)
 *   - workRam[0x390..0x391] (must stay unchanged except abort case)
 *
 * Uso: npx tsx packages/cli/src/test-wait-vblank-state-gated-parity.ts [N]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import {
  state as stateNs,
  waitVblankStateGated as wvNs,
} from "@marble-love/engine";
import {
  createCpu,
  pokeMem,
  peekMem,
  disposeCpu,
} from "./binary-oracle-lib.js";

const FUN_WAIT_GATED = 0x00028db8;
const VBLANK_MAILBOX_ADDR = 0x00400016;
const VBLANK_COUNTER_ADDR = 0x004003f0;
const STATE_WORD_ADDR = 0x00400390; // BE word: hi=0x390, lo=0x391
const SENTINEL_RET = 0xcafebabe >>> 0;

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) >>> 0;
    return ((s >>> 16) & 0xffff) / 0x10000;
  };
}

interface Case {
  countWord: number; // 16 bit (low word)
  loByte: number; // initial state low byte (0x400391)
  hiByte: number; // initial state high byte (0x400390)
  /**
   */
  abortAtIter: number;
  prevCounter: number;
}

function buildCase(i: number, rng: () => number): Case {
  if (i === 0) {
    return { countWord: 0, loByte: 0x05, hiByte: 0x00, abortAtIter: 0, prevCounter: 0x10 };
  }
  if (i === 1) {
    return { countWord: 1, loByte: 0x05, hiByte: 0x00, abortAtIter: 0, prevCounter: 0x10 };
  }
  if (i === 2) {
    return { countWord: 0xffff, loByte: 0x05, hiByte: 0x00, abortAtIter: 0, prevCounter: 0x10 };
  }
  if (i === 3) {
    return { countWord: 0x8000, loByte: 0x05, hiByte: 0x00, abortAtIter: 0, prevCounter: 0x10 };
  }
  if (i === 4) {
    return { countWord: 5, loByte: 0x07, hiByte: 0x00, abortAtIter: 3, prevCounter: 0x00 };
  }
  if (i === 5) {
    return { countWord: 8, loByte: 0x80, hiByte: 0xff, abortAtIter: 0, prevCounter: 0x00 };
  }
  if (i === 6) {
    return { countWord: 1, loByte: 0x07, hiByte: 0x00, abortAtIter: 1, prevCounter: 0x00 };
  }
  if (i === 7) {
    return { countWord: 4, loByte: 0x05, hiByte: 0x00, abortAtIter: 0, prevCounter: 0xfd };
  }

  // Random
  const cMag = Math.floor(rng() * 33);
  const countWord = (rng() < 0.5 ? cMag : (-cMag) & 0xffff) & 0xffff;

  const loByte = Math.floor(rng() * 256) & 0xff;
  const hr = rng();
  const hiByte = hr < 0.5 ? 0x00 : hr < 0.7 ? 0xff : Math.floor(rng() * 256) & 0xff;

  const cs = countWord & 0x8000 ? countWord - 0x10000 : countWord;
  let abortAtIter = 0;
  if (cs > 0 && rng() < 0.3) {
    abortAtIter = 1 + Math.floor(rng() * cs);
  }

  const cr = rng();
  const prevCounter =
    cr < 0.2 ? 0xff : cr < 0.4 ? 0xfe : Math.floor(rng() * 256) & 0xff;

  return { countWord, loByte, hiByte, abortAtIter, prevCounter };
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

  // tst.b/beq spin in FUN_28DEA). Manteniamo anche un counter di tick
  let mailboxReads = 0;
  let currentAbortAtIter = 0;
  let currentLoByte = 0;
  let currentAbortFired = false;

  const dispose = cpu.system.onMemoryRead((event) => {
    if (event.addr === VBLANK_MAILBOX_ADDR && event.size === 1) {
      // does not fire → fall-through to the spin's return.
      cpu.system.writeRaw8(VBLANK_MAILBOX_ADDR, 0x01);

      mailboxReads++;
      // Trigger abort: each FUN_28DEA call performs exactly 2 reads of
      if (
        !currentAbortFired &&
        currentAbortAtIter > 0 &&
        mailboxReads === 2 * currentAbortAtIter - 1
      ) {
        currentAbortFired = true;
        cpu.system.writeRaw8(STATE_WORD_ADDR + 1, currentLoByte ^ 0x55);
      }
    }
  });

  console.log(`\n=== waitVblankStateGated (FUN_28DB8) — ${n} casi ===`);

  const rng = makeRng(0xc0ffee42);
  let ok = 0;
  let firstFail: {
    i: number;
    c: Case;
    binCounter: number;
    binStateLo: number;
    binD0w: number;
    binIters: number;
    tsCounter: number;
    tsStateLo: number;
    tsD0w: number;
    tsIters: number;
  } | null = null;

  for (let i = 0; i < n; i++) {
    const c = buildCase(i, rng);

    // ─── Setup binary side ───────────────────────────────────────────
    pokeMem(cpu, VBLANK_MAILBOX_ADDR, 1, 0);
    pokeMem(cpu, VBLANK_COUNTER_ADDR, 1, c.prevCounter);
    pokeMem(cpu, STATE_WORD_ADDR, 1, c.hiByte);
    pokeMem(cpu, STATE_WORD_ADDR + 1, 1, c.loByte);

    // Reset injection state
    mailboxReads = 0;
    currentAbortAtIter = c.abortAtIter;
    currentLoByte = c.loByte;
    currentAbortFired = false;

    // Setup stack: SP a 0x401E80, push arg long, push sentinel.
    const countSigned =
      c.countWord & 0x8000 ? c.countWord - 0x10000 : c.countWord;
    const argLong = countSigned >>> 0;

    const initialSp = 0x401e80;
    cpu.system.setRegister("sp", initialSp);
    let sp = initialSp;
    sp = (sp - 4) >>> 0;
    cpu.system.write(sp, 4, argLong);
    sp = (sp - 4) >>> 0;
    cpu.system.write(sp, 4, SENTINEL_RET);
    cpu.system.setRegister("sp", sp);
    cpu.system.setRegister("pc", FUN_WAIT_GATED);
    // Pre-fill D0/D2/D3 with sentinels to detect undocumented
    // Only D0w (low word) for parity.
    cpu.system.setRegister("d0", 0xdeadbeef);
    cpu.system.setRegister("d2", 0x11111111);
    cpu.system.setRegister("d3", 0x22222222);

    const MAX_STEPS = 200_000;
    let stepCount = 0;
    while (stepCount < MAX_STEPS) {
      if (cpu.system.getRegisters().pc === SENTINEL_RET) break;
      cpu.system.step();
      stepCount++;
    }
    // Pop sentinel + arg long
    cpu.system.setRegister("sp", (cpu.system.getRegisters().sp + 8) >>> 0);

    const binCounter = peekMem(cpu, VBLANK_COUNTER_ADDR, 1) & 0xff;
    const binStateLo = peekMem(cpu, STATE_WORD_ADDR + 1, 1) & 0xff;
    const binD0w = cpu.system.getRegisters().d0 & 0xffff;
    const binIters = (binCounter - c.prevCounter) & 0xff;

    if (process.env.WVSG_DEBUG) {
      console.log(
        `  case ${i}: count=0x${c.countWord.toString(16)} sig=${countSigned} loByte=0x${c.loByte.toString(16)}` +
          ` hiByte=0x${c.hiByte.toString(16)} abort=${c.abortAtIter} prevCnt=0x${c.prevCounter.toString(16)}` +
          ` → binCnt=0x${binCounter.toString(16)} binStateLo=0x${binStateLo.toString(16)}` +
          ` binD0w=0x${binD0w.toString(16)} binIters=${binIters} steps=${stepCount}`,
      );
    }

    // ─── Setup TS side (mirror via state.workRam) ────────────────────
    state.workRam[0x16] = 0;
    state.workRam[0x3f0] = c.prevCounter;
    state.workRam[0x390] = c.hiByte;
    state.workRam[0x391] = c.loByte;

    const tsResult = wvNs.waitVblankStateGated(
      state,
      c.countWord,
      c.abortAtIter,
    );
    const tsCounter = state.workRam[0x3f0] ?? 0;
    const tsD0w = tsResult.d0w & 0xffff;
    const tsIters = tsResult.iterations;

    // Per il binary: il low byte di *0x400390 dovrebbe essere = c.loByte
    // modified during wait). Injection fires only if the loop
    // injection does not fire -> byte unchanged.
    const tsStateLoExpected = currentAbortFired
      ? c.loByte ^ 0x55
      : c.loByte;

    const match =
      binCounter === tsCounter &&
      binStateLo === tsStateLoExpected &&
      binD0w === tsD0w &&
      binIters === tsIters;
    if (match) {
      ok++;
    } else if (firstFail === null) {
      firstFail = {
        i,
        c,
        binCounter,
        binStateLo,
        binD0w,
        binIters,
        tsCounter,
        tsStateLo: tsStateLoExpected,
        tsD0w,
        tsIters,
      };
    }
  }

  dispose();

  console.log(`  Match: ${ok}/${n} = ${((ok / n) * 100).toFixed(1)}%`);
  if (firstFail) {
    const f = firstFail;
    console.log(`  First fail @ case ${f.i}:`);
    console.log(
      `    inputs: count=0x${f.c.countWord.toString(16)} loByte=0x${f.c.loByte.toString(16)}` +
        ` hiByte=0x${f.c.hiByte.toString(16)} abortAtIter=${f.c.abortAtIter}` +
        ` prevCnt=0x${f.c.prevCounter.toString(16)}`,
    );
    console.log(
      `    bin: counter=0x${f.binCounter.toString(16)} stateLo=0x${f.binStateLo.toString(16)}` +
        ` D0w=0x${f.binD0w.toString(16)} iters=${f.binIters}`,
    );
    console.log(
      `    ts : counter=0x${f.tsCounter.toString(16)} stateLoExpected=0x${f.tsStateLo.toString(16)}` +
        ` D0w=0x${f.tsD0w.toString(16)} iters=${f.tsIters}`,
    );
  }

  disposeCpu(cpu);
  exit(ok === n ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  exit(1);
});
