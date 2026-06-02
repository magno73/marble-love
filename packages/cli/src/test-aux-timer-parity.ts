#!/usr/bin/env node
/**
 * test-aux-timer-parity.ts — differential FUN_10146 vs auxTimer.
 *
 *   - 0x4003B2 byte (active flag)
 *   - 0x4003B4 byte (counter)
 *   - 0x4003B8 word (countdown)
 *
 *   - queue head/tail in 0..15 (random; ~30% empty)
 *   - 16 random bytes in the buffer (with bias toward 0xFF and multiples of 8 for
 *     cover i branch sensitive)
 *   - random countdown word (with bias toward 0)
 *   - random active flag byte (with bias toward 0x00 / 0x40)
 *
 *
 * Uso: npx tsx packages/cli/src/test-aux-timer-parity.ts [N]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import { state as stateNs, auxTimer as atNs } from "@marble-love/engine";
import {
  createCpu,
  callFunction,
  pokeMem,
  peekMem,
  disposeCpu,
} from "./binary-oracle-lib.js";

const FUN_AUX_TIMER = 0x00010146;

const QUEUE_BASE = 0x00401f44;
const QUEUE_HEAD_ADDR = QUEUE_BASE + 0x12;
const QUEUE_TAIL_ADDR = QUEUE_BASE + 0x13;
const QUEUE_DATA_ADDR = QUEUE_BASE + 0x02;

const ACTIVE_ADDR = 0x004003b2;
const COUNTER_ADDR = 0x004003b4;
const COUNTDOWN_ADDR = 0x004003b8; // word, big-endian

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) >>> 0;
    return ((s >>> 16) & 0xffff) / 0x10000;
  };
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

  console.log(`\n=== auxTimer (FUN_10146) — ${n} cases ===`);

  const rng = makeRng(0xa11dec0d);
  let ok = 0;
  let firstFail: {
    i: number;
    head: number;
    tail: number;
    bufHead: number;
    countdown: number;
    active: number;
    counter: number;
    binHead: number;
    binActive: number;
    binCounter: number;
    binCountdown: number;
    tsHead: number;
    tsActive: number;
    tsCounter: number;
    tsCountdown: number;
  } | null = null;

  for (let i = 0; i < n; i++) {
    cpu.system.setRegister("sp", 0x401f00);

    // Pattern-driven first 8 cases to cover i branches chiave:
    //   0: empty queue
    //   1: countdown!=0, byte 0xFF (clear path)
    //   2: countdown!=0, byte 0x42 (fall-through, counter++)
    //   3: countdown==0, active=0x40, byte 0x08 (reset pair)
    //   4: countdown==0, active=0x40, byte 0x09 (counter++)
    //   5: countdown==0, active=0,    byte 0x00 (counter++)
    //   6: counter wrap (0xFF -> 0)
    let head: number, tail: number, buf0: number;
    let countdown: number, active: number, counter: number;

    if (i === 0) {
      head = 5; tail = 5; buf0 = 0;
      countdown = 0x012c; active = 0x40; counter = 0x10;
    } else if (i === 1) {
      head = 0; tail = 1; buf0 = 0xff;
      countdown = 0x012c; active = 0x40; counter = 0x10;
    } else if (i === 2) {
      head = 0; tail = 1; buf0 = 0x42;
      countdown = 0x012c; active = 0x00; counter = 0x10;
    } else if (i === 3) {
      head = 0; tail = 1; buf0 = 0x08;
      countdown = 0x0000; active = 0x40; counter = 0x10;
    } else if (i === 4) {
      head = 0; tail = 1; buf0 = 0x09;
      countdown = 0x0000; active = 0x40; counter = 0x10;
    } else if (i === 5) {
      head = 0; tail = 1; buf0 = 0x00;
      countdown = 0x0000; active = 0x00; counter = 0x10;
    } else if (i === 6) {
      head = 0; tail = 1; buf0 = 0x42;
      countdown = 0x0000; active = 0x00; counter = 0xff;
    } else if (i === 7) {
      head = 0; tail = 1; buf0 = 0xff;
      countdown = 0x0001; active = 0x40; counter = 0x33;
    } else {
      // Random
      head = Math.floor(rng() * 16);
      tail = Math.floor(rng() * 16);
      // ~25% empty
      if (rng() < 0.25) tail = head;
      const r = rng();
      if (r < 0.2) buf0 = 0xff;
      else if (r < 0.4) buf0 = (Math.floor(rng() * 32) * 8) & 0xff; // multipli of 8
      else buf0 = Math.floor(rng() * 256) & 0xff;
      countdown = rng() < 0.3 ? 0 : Math.floor(rng() * 0x10000) & 0xffff;
      // Active flag: bias toward 0x00 and 0x40.
      const ar = rng();
      if (ar < 0.4) active = 0x00;
      else if (ar < 0.7) active = 0x40;
      else active = Math.floor(rng() * 256) & 0xff;
      // Counter: bias toward 0xFE/0xFF for wrap.
      const cr = rng();
      if (cr < 0.2) counter = 0xff;
      else if (cr < 0.3) counter = 0xfe;
      else counter = Math.floor(rng() * 256) & 0xff;
    }

    // Random background buffer (the 16 bytes), but ensure buffer[head] = buf0.
    const buffer = new Array(16).fill(0).map(() => Math.floor(rng() * 256) & 0xff);
    if (head !== tail) buffer[head] = buf0;
    const bufHeadValue = buffer[head] ?? 0;

    // ─── Setup binary side ───────────────────────────────────────────────
    pokeMem(cpu, QUEUE_HEAD_ADDR, 1, head);
    pokeMem(cpu, QUEUE_TAIL_ADDR, 1, tail);
    for (let j = 0; j < 16; j++) {
      pokeMem(cpu, QUEUE_DATA_ADDR + j, 1, buffer[j] ?? 0);
    }
    pokeMem(cpu, ACTIVE_ADDR, 1, active);
    pokeMem(cpu, COUNTER_ADDR, 1, counter);
    pokeMem(cpu, COUNTDOWN_ADDR, 2, countdown);

    // ─── Setup TS side (mirror via state.workRam) ────────────────────────
    state.workRam[0x1f44 + 0x12] = head;
    state.workRam[0x1f44 + 0x13] = tail;
    for (let j = 0; j < 16; j++) {
      state.workRam[0x1f44 + 0x02 + j] = buffer[j] ?? 0;
    }
    state.workRam[0x3b2] = active;
    state.workRam[0x3b4] = counter;
    state.workRam[0x3b8] = (countdown >>> 8) & 0xff;
    state.workRam[0x3b9] = countdown & 0xff;

    // ─── Run binary ──────────────────────────────────────────────────────
    callFunction(cpu, FUN_AUX_TIMER, []);
    const binHead = peekMem(cpu, QUEUE_HEAD_ADDR, 1) & 0xff;
    const binActive = peekMem(cpu, ACTIVE_ADDR, 1) & 0xff;
    const binCounter = peekMem(cpu, COUNTER_ADDR, 1) & 0xff;
    const binCountdown = peekMem(cpu, COUNTDOWN_ADDR, 2) & 0xffff;

    // ─── Run TS ──────────────────────────────────────────────────────────
    atNs.auxTimer(state);
    const tsHead = state.workRam[0x1f44 + 0x12] ?? 0;
    const tsActive = state.workRam[0x3b2] ?? 0;
    const tsCounter = state.workRam[0x3b4] ?? 0;
    const tsCountdown =
      (((state.workRam[0x3b8] ?? 0) << 8) | (state.workRam[0x3b9] ?? 0)) & 0xffff;

    const match =
      binHead === tsHead &&
      binActive === tsActive &&
      binCounter === tsCounter &&
      binCountdown === tsCountdown;
    if (match) {
      ok++;
    } else if (firstFail === null) {
      firstFail = {
        i,
        head,
        tail,
        bufHead: bufHeadValue,
        countdown,
        active,
        counter,
        binHead,
        binActive,
        binCounter,
        binCountdown,
        tsHead,
        tsActive,
        tsCounter,
        tsCountdown,
      };
    }
  }

  console.log(`  Match: ${ok}/${n} = ${((ok / n) * 100).toFixed(1)}%`);
  if (firstFail) {
    console.log(`  First fail @ case ${firstFail.i}:`);
    console.log(
      `    inputs: head=${firstFail.head} tail=${firstFail.tail} buf[head]=0x${firstFail.bufHead.toString(16)}`,
    );
    console.log(
      `            countdown=0x${firstFail.countdown.toString(16)} active=0x${firstFail.active.toString(16)} counter=0x${firstFail.counter.toString(16)}`,
    );
    console.log(
      `    bin: head=${firstFail.binHead} active=0x${firstFail.binActive.toString(16)} counter=0x${firstFail.binCounter.toString(16)} countdown=0x${firstFail.binCountdown.toString(16)}`,
    );
    console.log(
      `    ts : head=${firstFail.tsHead} active=0x${firstFail.tsActive.toString(16)} counter=0x${firstFail.tsCounter.toString(16)} countdown=0x${firstFail.tsCountdown.toString(16)}`,
    );
  }

  disposeCpu(cpu);
  exit(ok === n ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  exit(1);
});
