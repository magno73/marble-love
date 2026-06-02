#!/usr/bin/env node
/**
 * test-pf-scroll-emit-26e14-parity.ts — differential FUN_26E14 vs pfScrollEmit26E14.
 *
 * For N test cases:
 *   1. Setup workRam fields:
 *      - 0x4003AE (AV control word, random)
 *      - 0x4003F6/FA/FE/402 (long pointers — random but provided for consistency)
 *   2. Setup spriteRam[0..0x400] random (both pages 0 / +0x200).
 *   3. callFunction(0x26E14, [arg]) — push 1 long arg.
 *   4. pfScrollEmit26E14(state, arg)
 *      - workRam[0x3AE..0x3B1] (AV new word)
 *      - workRam[0x3F6..0x405] (4 long pointers)
 *      - spriteRam[0..0x400]
 *
 * Usage: npx tsx packages/cli/src/test-pf-scroll-emit-26e14-parity.ts [N]
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import { state as stateNs, pfScrollEmit26E14 as pfEmit } from "@marble-love/engine";
import {
  createCpu,
  callFunction,
  pokeMem,
  peekMem,
  disposeCpu,
} from "./binary-oracle-lib.js";

const FUN_PF_EMIT = 0x00026e14;

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) >>> 0;
    return ((s >>> 16) & 0xffff) / 0x10000;
  };
}

async function main(): Promise<void> {
  const n = Number(process.argv[2] ?? "500");
  const rom = readFileSync(resolve("ghidra_project/marble_program.bin"));
  const state = stateNs.emptyGameState();
  const cpu = await createCpu({ rom, state });
  const rng = makeRng(0x26e14);

  console.log(`\n=== pfScrollEmit26E14 (FUN_26E14) — ${n} cases ===`);
  let ok = 0;
  let firstFail: { tc: number; addr: number; bin: number; ts: number } | null = null;

  for (let i = 0; i < n; i++) {
    cpu.system.setRegister("sp", 0x401f00);

    // Random setup
    const av = Math.floor(rng() * 0x10000) & 0xffff;
    // Arg long signed: uses range [-0x10000, 0x10000) to cover negatives
    const argSigned = Math.floor((rng() - 0.5) * 0x20000) | 0;
    const argLong = argSigned >>> 0; // unsigned 32-bit per push

    pokeMem(cpu, 0x004003ae, 2, av);
    state.workRam[0x3ae] = (av >>> 8) & 0xff;
    state.workRam[0x3af] = av & 0xff;

    // Random init for the 4 long pointers; the function overwrites them anyway.
    const pre3b0 = Math.floor(rng() * 0x10000) & 0xffff;
    pokeMem(cpu, 0x004003b0, 2, pre3b0);
    state.workRam[0x3b0] = (pre3b0 >>> 8) & 0xff;
    state.workRam[0x3b1] = pre3b0 & 0xff;

    for (const off of [0x3f6, 0x3fa, 0x3fe, 0x402]) {
      const v = Math.floor(rng() * 0x100000000) >>> 0;
      pokeMem(cpu, 0x00400000 + off, 4, v);
      state.workRam[off] = (v >>> 24) & 0xff;
      state.workRam[off + 1] = (v >>> 16) & 0xff;
      state.workRam[off + 2] = (v >>> 8) & 0xff;
      state.workRam[off + 3] = v & 0xff;
    }

    // Setup spriteRam (0xA02000-0xA023FF, 1024 byte = both rotation
    // layouts). Random.
    for (let j = 0; j < 0x400; j++) {
      const v = Math.floor(rng() * 256);
      pokeMem(cpu, 0x00a02000 + j, 1, v);
      state.spriteRam[j] = v;
    }

    // 30%: stop iter early. Compute the ORIGINAL page (orig AV, not toggled)
    // and set cmpWord[k] = k at the cmp ptr.
    if (rng() < 0.3) {
      const stopIter = Math.floor(rng() * 60);
      const offOld = (av & 8) << 6; // (av & 8) << 5 * 2 == << 6  → 0 o 0x200
      const cmpAddr = 0x00a02000 + 0x180 + offOld + stopIter * 2;
      pokeMem(cpu, cmpAddr, 2, stopIter);
      const localOff = 0x180 + offOld + stopIter * 2;
      state.spriteRam[localOff] = (stopIter >>> 8) & 0xff;
      state.spriteRam[localOff + 1] = stopIter & 0xff;
    }

    callFunction(cpu, FUN_PF_EMIT, [argLong]);
    pfEmit.pfScrollEmit26E14(state, argSigned);

    let match = true;
    let firstDiff = -1;
    let binVal = 0;
    let tsVal = 0;

    // Diff workRam: 0x3AE..0x3B1 (AV new) + 0x3F6..0x405 (4 long ptrs)
    const workRanges: [number, number][] = [
      [0x3ae, 0x3b2], // 4 byte (av + new)
      [0x3f6, 0x406], // 16 byte (4 long ptr)
    ];
    outer: for (const [lo, hi] of workRanges) {
      for (let j = lo; j < hi; j++) {
        const b = peekMem(cpu, 0x00400000 + j, 1);
        const t = state.workRam[j] ?? 0;
        if (b !== t) {
          match = false; firstDiff = 0x00400000 + j; binVal = b; tsVal = t;
          break outer;
        }
      }
    }
    // Diff spriteRam[0..0x400]
    if (match) {
      for (let j = 0; j < 0x400; j++) {
        const b = peekMem(cpu, 0x00a02000 + j, 1);
        const t = state.spriteRam[j] ?? 0;
        if (b !== t) {
          match = false; firstDiff = 0x00a02000 + j; binVal = b; tsVal = t;
          break;
        }
      }
    }

    if (match) ok++;
    else if (firstFail === null) {
      firstFail = { tc: i, addr: firstDiff, bin: binVal, ts: tsVal };
    }
  }

  console.log(`  Match: ${ok}/${n} = ${((ok / n) * 100).toFixed(1)}%`);
  if (firstFail) {
    const { tc, addr, bin, ts } = firstFail;
    console.log(`  First fail tc=${tc}: @ 0x${addr.toString(16)}: bin=0x${bin.toString(16)} ts=0x${ts.toString(16)}`);
  }

  disposeCpu(cpu);
  exit(ok === n ? 0 : 1);
}

main().catch(e => { console.error(e); exit(1); });
