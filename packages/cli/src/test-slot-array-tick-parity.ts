#!/usr/bin/env node
/**
 *
 *
 *
 * Strategia (analogo a `test-state-sub-2678-parity.ts`):
 *   1. Patch FUN_14966 to a custom thunk that logs the received long arg into
 *      a work-RAM ring buffer @ 0x401FE0 (4 longs), with counter @ 0x401FF8.
 *      in 0x401FE0 (long-buffer di 4 entry).
 *      0x4013C2, 0x401422].
 *   3. Run TS with a callback that emits the same log -> compare workRam
 *      bit-by-bit (incluso ring-buffer + counter).
 *
 * Il thunk patch (32 byte, < dimensione di FUN_14966) sostituisce l'header:
 *   movea.l #0x00401FE0, A0       ; 207C 0040 1FE0          (6 byte)
 *   move.l  0x00401FF8.l, D1      ; 2239 0040 1FF8          (6 byte)
 *   adda.l  D1, A0                ; D1C1                    (2 byte) ; A0 += D1*1 (long)
 *   move.l  4(SP), (A0)           ; 20EF 0004               (4 byte) ; *(A0) = arg
 *   addq.l  #4, 0x00401FF8.l      ; 58B9 0040 1FF8          (6 byte) ; counter += 4
 *   rts                           ; 4E75                    (2 byte)
 *  Totale = 26 byte.
 *
 *     (0x401300..0x40142F per coprire i 4 slot + qualche byte di guardia,
 *      and 0x401FE0..0x401FFB for the ring buffer) to prove that
 *
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import { state as stateNs, slotArrayTick as tickNs } from "@marble-love/engine";
import {
  createCpu,
  callFunction,
  pokeMem,
  peekMem,
  disposeCpu,
} from "./binary-oracle-lib.js";
import type { CpuSession } from "./binary-oracle-lib.js";

const FUN_1493C = 0x0001493c;
const FUN_14966 = 0x00014966;

/** Indirizzi della ring-buffer in work-RAM (offset 0x1FE0..0x1FFB). */
const RING_COUNTER = 0x00401ff8;

/** Patch FUN_14966 col thunk-logger (26 byte). */
function patchFun14966(cpu: CpuSession): void {
  const bytes = [
    // movea.l #0x00401FE0, A0
    0x20, 0x7c, 0x00, 0x40, 0x1f, 0xe0,
    // move.l 0x00401FF8.l, D1
    0x22, 0x39, 0x00, 0x40, 0x1f, 0xf8,
    // adda.l D1, A0      (D1C1)
    0xd1, 0xc1,
    // move.l 4(SP), (A0) (20EF 0004)
    0x20, 0xef, 0x00, 0x04,
    // addq.l #4, 0x00401FF8.l (58B9 0040 1FF8)
    0x58, 0xb9, 0x00, 0x40, 0x1f, 0xf8,
    // rts (4E75)
    0x4e, 0x75,
  ];
  for (let i = 0; i < bytes.length; i++) {
    pokeMem(cpu, FUN_14966 + i, 1, bytes[i]!);
  }
}

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) >>> 0;
    return ((s >>> 16) & 0xffff) / 0x10000;
  };
}

/** Setup work-RAM zona-di-interesse + ring-buffer. */
function setupWorkRam(
  state: ReturnType<typeof stateNs.emptyGameState>,
  cpu: CpuSession,
  bytes: Map<number, number>,
): void {
  for (const [absAddr, val] of bytes) {
    pokeMem(cpu, absAddr, 1, val);
    state.workRam[(absAddr - 0x400000) >>> 0] = val;
  }
}

function resetWatchedZones(
  state: ReturnType<typeof stateNs.emptyGameState>,
  cpu: CpuSession,
): void {
  for (let a = 0x00401300; a < 0x00401440; a++) {
    pokeMem(cpu, a, 1, 0);
    state.workRam[a - 0x400000] = 0;
  }
  // Ring buffer (0x401FE0..0x401FFB)
  for (let a = 0x00401fe0; a < 0x00401ffc; a++) {
    pokeMem(cpu, a, 1, 0);
    state.workRam[a - 0x400000] = 0;
  }
}

/** Read entire watch zone as concatenated bytes (per facile diff). */
function readWatchZone(
  cpu: CpuSession,
): { slotZone: Uint8Array; ringZone: Uint8Array; counter: number } {
  const slotZone = new Uint8Array(0x140);
  for (let i = 0; i < slotZone.length; i++) {
    slotZone[i] = peekMem(cpu, 0x00401300 + i, 1) & 0xff;
  }
  const ringZone = new Uint8Array(0x1c);
  for (let i = 0; i < ringZone.length; i++) {
    ringZone[i] = peekMem(cpu, 0x00401fe0 + i, 1) & 0xff;
  }
  const counter = peekMem(cpu, RING_COUNTER, 4) >>> 0;
  return { slotZone, ringZone, counter };
}

function readWatchZoneTs(
  state: ReturnType<typeof stateNs.emptyGameState>,
): { slotZone: Uint8Array; ringZone: Uint8Array; counter: number } {
  const slotZone = new Uint8Array(0x140);
  for (let i = 0; i < slotZone.length; i++) {
    slotZone[i] = state.workRam[0x1300 + i] ?? 0;
  }
  const ringZone = new Uint8Array(0x1c);
  for (let i = 0; i < ringZone.length; i++) {
    ringZone[i] = state.workRam[0x1fe0 + i] ?? 0;
  }
  const counter =
    (((state.workRam[0x1ff8] ?? 0) << 24) |
      ((state.workRam[0x1ff9] ?? 0) << 16) |
      ((state.workRam[0x1ffa] ?? 0) << 8) |
      (state.workRam[0x1ffb] ?? 0)) >>>
    0;
  return { slotZone, ringZone, counter };
}

function diffBytes(
  a: Uint8Array,
  b: Uint8Array,
  offBase: number,
): { offset: number; bin: number; ts: number } | null {
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    if (a[i] !== b[i]) return { offset: offBase + i, bin: a[i]!, ts: b[i]! };
  }
  if (a.length !== b.length) {
    return { offset: offBase + len, bin: a[len] ?? -1, ts: b[len] ?? -1 };
  }
  return null;
}

/**
 *   - Incrementa counter di 4 (long) @ workRam[0x1FF8]
 */
function makeLogger() {
  return (slotPtr: number, state: ReturnType<typeof stateNs.emptyGameState>): void => {
    const counter =
      (((state.workRam[0x1ff8] ?? 0) << 24) |
        ((state.workRam[0x1ff9] ?? 0) << 16) |
        ((state.workRam[0x1ffa] ?? 0) << 8) |
        (state.workRam[0x1ffb] ?? 0)) >>>
      0;
    const slot = (0x1fe0 + counter) >>> 0;
    state.workRam[slot] = (slotPtr >>> 24) & 0xff;
    state.workRam[slot + 1] = (slotPtr >>> 16) & 0xff;
    state.workRam[slot + 2] = (slotPtr >>> 8) & 0xff;
    state.workRam[slot + 3] = slotPtr & 0xff;
    const newCounter = (counter + 4) >>> 0;
    state.workRam[0x1ff8] = (newCounter >>> 24) & 0xff;
    state.workRam[0x1ff9] = (newCounter >>> 16) & 0xff;
    state.workRam[0x1ffa] = (newCounter >>> 8) & 0xff;
    state.workRam[0x1ffb] = newCounter & 0xff;
  };
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
  patchFun14966(cpu);

  const subs: tickNs.SlotArrayTickSubs = {
    fun_14966: makeLogger(),
  };

  console.log(`\n=== slotArrayTick (FUN_1493C) — ${total} casi ===`);

  const rng = makeRng(0x1493c);
  const rb = (): number => Math.floor(rng() * 256) & 0xff;

  let ok = 0;
  interface FailRecord {
    tc: number;
    where: string; // "slot"|"ring"|"counter"
    offset: number;
    bin: number;
    ts: number;
    expectedRing: number[];
  }
  let firstFail: FailRecord | null = null;

  for (let tc = 0; tc < total; tc++) {
    cpu.system.setRegister("sp", 0x401f00);

    // Reset then randomize the region of interest to prove that
    // (0x401302, 0x401362, ...) regardless of pre-call contents.
    resetWatchedZones(stateInst, cpu);
    const seed = new Map<number, number>();
    // Random fill slot zone (0x401300..0x40142F)
    for (let a = 0x00401300; a < 0x00401440; a++) {
      seed.set(a, rb());
    }
    // and increment; counter must start at 0 for the 4 writes at offsets 0,4,8,C.
    setupWorkRam(stateInst, cpu, seed);

    callFunction(cpu, FUN_1493C, []);
    const binZone = readWatchZone(cpu);

    // Run TS
    tickNs.slotArrayTick(stateInst, subs);
    const tsZone = readWatchZoneTs(stateInst);

    // Compara
    const diffSlot = diffBytes(binZone.slotZone, tsZone.slotZone, 0x401300);
    const diffRing = diffBytes(binZone.ringZone, tsZone.ringZone, 0x401fe0);
    const counterMatch = binZone.counter === tsZone.counter;
    if (diffSlot === null && diffRing === null && counterMatch) {
      ok++;
      if (tc === 0) {
        const expected = [0x00401302, 0x00401362, 0x004013c2, 0x00401422];
        const got: number[] = [];
        for (let i = 0; i < 4; i++) {
          const v =
            ((binZone.ringZone[i * 4]! << 24) |
              (binZone.ringZone[i * 4 + 1]! << 16) |
              (binZone.ringZone[i * 4 + 2]! << 8) |
              binZone.ringZone[i * 4 + 3]!) >>>
            0;
          got.push(v);
        }
        const seqOk = expected.every((v, i) => v === got[i]);
        if (!seqOk) {
          console.log(`  ERROR (tc=0): sequenza ring-buffer non attesa: got=${got.map(g=>g.toString(16))}`);
          ok--;
          if (firstFail === null) {
            firstFail = {
              tc: 0,
              where: "ring-sequence",
              offset: -1,
              bin: 0,
              ts: 0,
              expectedRing: got,
            };
          }
        }
        if (binZone.counter !== 16) {
          console.log(`  ERROR (tc=0): counter atteso 16 (4*4), got ${binZone.counter}`);
          ok--;
        }
      }
    } else if (firstFail === null) {
      const expected = [0x00401302, 0x00401362, 0x004013c2, 0x00401422];
      if (diffSlot !== null) {
        firstFail = { tc, where: "slot", offset: diffSlot.offset, bin: diffSlot.bin, ts: diffSlot.ts, expectedRing: expected };
      } else if (diffRing !== null) {
        firstFail = { tc, where: "ring", offset: diffRing.offset, bin: diffRing.bin, ts: diffRing.ts, expectedRing: expected };
      } else {
        firstFail = { tc, where: "counter", offset: -1, bin: binZone.counter, ts: tsZone.counter, expectedRing: expected };
      }
    }
  }

  console.log(`  Match: ${ok}/${total} = ${((ok / total) * 100).toFixed(1)}%`);
  if (firstFail) {
    console.log(`  First fail tc=${firstFail.tc} where=${firstFail.where}`);
    if (firstFail.offset >= 0) {
      console.log(`    @ 0x${firstFail.offset.toString(16)}: bin=0x${firstFail.bin.toString(16)} ts=0x${firstFail.ts.toString(16)}`);
    } else {
      console.log(`    bin=0x${firstFail.bin.toString(16)} ts=0x${firstFail.ts.toString(16)}`);
    }
  }

  disposeCpu(cpu);
  exit(ok === total ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  exit(1);
});
