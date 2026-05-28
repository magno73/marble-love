#!/usr/bin/env node
/**
 * test-pf-scroll-parity.ts — differential FUN_26D8A vs pfScrollUpdate.
 *
 * Per N test cases:
 *   1. Setup workRam fields: 0x02 (scroll Y), 0x04 (flip flag),
 *      0x0A (speed byte), 0x3AE (AV control).
 *   2. Setup spriteRam: tile words @ 0xA02000+, cmp words @ 0xA02180+
 *      (optionally with cmpWord = D3 at some index -> exit loop).
 *   3. callFunction(0x26D8A) — no args, no return.
 *   4. pfScrollUpdate(state)
 *   5. Confronta workRam[0x02..0x03] e spriteRam[0..0x300] byte-by-byte.
 *
 * Uso: npx tsx packages/cli/src/test-pf-scroll-parity.ts [N]
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import { state as stateNs, pfScroll } from "@marble-love/engine";
import {
  createCpu,
  callFunction,
  pokeMem,
  peekMem,
  disposeCpu,
} from "./binary-oracle-lib.js";

const FUN_PF_SCROLL = 0x00026d8a;

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
  const rng = makeRng(0x26d8a);

  console.log(`\n=== pfScrollUpdate (FUN_26D8A) — ${n} casi ===`);
  let ok = 0;
  let firstFail: { tc: number; addr: number; bin: number; ts: number } | null = null;

  for (let i = 0; i < n; i++) {
    cpu.system.setRegister("sp", 0x401f00);

    // Setup workRam: scroll fields random
    const speed = Math.floor(rng() * 256) & 0xff;
    const flip = rng() < 0.3 ? 0xff : Math.floor(rng() * 256);
    const scrollY = Math.floor(rng() * 0x10000) & 0xffff;
    const av = Math.floor(rng() * 0x10000) & 0xffff;

    pokeMem(cpu, 0x0040000A, 1, speed);
    pokeMem(cpu, 0x00400004, 1, flip);
    pokeMem(cpu, 0x00400002, 2, scrollY);
    pokeMem(cpu, 0x004003AE, 2, av);

    state.workRam[0x0A] = speed;
    state.workRam[0x04] = flip;
    state.workRam[0x02] = (scrollY >>> 8) & 0xff;
    state.workRam[0x03] = scrollY & 0xff;
    state.workRam[0x3AE] = (av >>> 8) & 0xff;
    state.workRam[0x3AF] = av & 0xff;

    // Setup spriteRam (0xA02000-0xA022FF, 768 byte = abbastanza per entrambi
    // i layout di rotazione). Random tile words.
    for (let j = 0; j < 0x300; j++) {
      const v = Math.floor(rng() * 256);
      pokeMem(cpu, 0x00a02000 + j, 1, v);
      state.spriteRam[j] = v;
    }

    // Optional: 30% chance di setting up cmp values per fare exit early
    // (forziamo cmpWord[k] = k a un indice random k in [0, 60))
    if (rng() < 0.3) {
      const stopIter = Math.floor(rng() * 60);
      const a1Base = 0x180 + ((av & 8) << 5) * 2;
      pokeMem(cpu, 0x00a02000 + a1Base + stopIter * 2, 2, stopIter);
      state.spriteRam[a1Base + stopIter * 2] = (stopIter >>> 8) & 0xff;
      state.spriteRam[a1Base + stopIter * 2 + 1] = stopIter & 0xff;
    }

    callFunction(cpu, FUN_PF_SCROLL, []);
    pfScroll.pfScrollUpdate(state);

    let match = true;
    let firstDiff = -1;
    let binVal = 0;
    let tsVal = 0;

    // Diff workRam[0x02..0x03] (scroll Y latched)
    for (let j = 2; j < 4; j++) {
      const b = peekMem(cpu, 0x00400000 + j, 1);
      const t = state.workRam[j] ?? 0;
      if (b !== t) {
        match = false; firstDiff = 0x00400000 + j; binVal = b; tsVal = t;
        break;
      }
    }
    // Diff spriteRam[0..0x300]
    if (match) {
      for (let j = 0; j < 0x300; j++) {
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
