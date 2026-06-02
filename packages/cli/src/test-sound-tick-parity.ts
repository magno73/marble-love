#!/usr/bin/env node
/**
 * test-sound-tick-parity.ts — differential FUN_4CA0 vs soundTick wrapper.
 *
 * Limitation: FUN_4CA0 calls 3 sub-functions:
 *   - FUN_3E1A (dispatch send)
 *   - FUN_4DCC (sound chip writer, GROSSA, NON replicata)
 *   - FUN_4C3E (status check)
 *
 * To test the wrapper in isolation, patch all 3 binary subs
 * with an immediate `rts` (0x4E75). Then compare workRam state.
 *
 * Uso: npx tsx packages/cli/src/test-sound-tick-parity.ts [N]
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import { state as stateNs, soundTick as soundTickNs } from "@marble-love/engine";
import {
  createCpu,
  callFunction,
  pokeMem,
  peekMem,
  disposeCpu,
} from "./binary-oracle-lib.js";

const FUN_SOUND = 0x00004ca0;
const FUN_3E1A = 0x00003e1a;
const FUN_4DCC = 0x00004dcc;
const FUN_4C3E = 0x00004c3e;

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) >>> 0;
    return ((s >>> 16) & 0xffff) / 0x10000;
  };
}

async function main(): Promise<void> {
  const n = Number(process.argv[2] ?? "200");
  const rom = Buffer.from(readFileSync(resolve("ghidra_project/marble_program.bin")));

  // Patch ROM: stub sub-functions with `rts` (0x4E75) to isolate the wrapper.
  // For FUN_4C3E we want D0=1 (status ok). Patch the prologue:
  //   moveq #1,D0  → 0x7001 (2 byte)
  //   rts          → 0x4E75 (2 byte)
  // 4 byte totali. Allineato a entry FUN_4C3E.
  rom[FUN_3E1A] = 0x4e; rom[FUN_3E1A + 1] = 0x75;
  rom[FUN_4DCC] = 0x4e; rom[FUN_4DCC + 1] = 0x75;
  rom[FUN_4C3E] = 0x70; rom[FUN_4C3E + 1] = 0x01; // moveq #1,D0
  rom[FUN_4C3E + 2] = 0x4e; rom[FUN_4C3E + 3] = 0x75; // rts

  const stateInst = stateNs.emptyGameState();
  const cpu = await createCpu({ rom, state: stateInst });
  const rng = makeRng(0x4ca0);

  console.log(`\n=== soundTick (FUN_4CA0 wrapper, stub subs) — ${n} casi ===`);
  let ok = 0;
  let firstFail: { tc: number; addr: number; bin: number; ts: number } | null = null;

  for (let i = 0; i < n; i++) {
    cpu.system.setRegister("sp", 0x401f00);

    const cmd = Math.floor(rng() * 256);
    const lastSent = Math.floor(rng() * 256);
    const retry = Math.floor(rng() * 256);

    pokeMem(cpu, 0x00401F44, 1, cmd);
    pokeMem(cpu, 0x00401F45, 1, lastSent);
    pokeMem(cpu, 0x00401FF4, 1, retry);
    stateInst.workRam[0x1f44] = cmd;
    stateInst.workRam[0x1f45] = lastSent;
    stateInst.workRam[0x1ff4] = retry;

    callFunction(cpu, FUN_SOUND, []);
    soundTickNs.soundTick(stateInst);

    let match = true;
    for (const off of [0x1f44, 0x1f45, 0x1ff4]) {
      const b = peekMem(cpu, 0x00400000 + off, 1);
      const t = stateInst.workRam[off] ?? 0;
      if (b !== t) {
        match = false;
        if (firstFail === null) {
          firstFail = { tc: i, addr: 0x00400000 + off, bin: b, ts: t };
        }
        break;
      }
    }
    if (match) ok++;
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
