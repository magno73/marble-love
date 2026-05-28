#!/usr/bin/env node
/**
 * test-sound-dispatch-send-parity.ts — differential FUN_3E1A vs soundDispatchSend.
 *
 *
 * Setup:
 *   - argLong on the stack
 *   - *0x401FFC (long) = ackPtr (struct A2 base) — workRam-safe
 *   - *(A2+0xA), *(A2+0xB) = byte status + complement
 *   - *0x401FF5/F6/F7 = accumulator state random
 *
 *
 * Uso: npx tsx packages/cli/src/test-sound-dispatch-send-parity.ts [N]
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import { state as stateNs, soundDispatchSend as soundDispatchSendNs, bus as busNs } from "@marble-love/engine";
import {
  createCpu,
  callFunction,
  pokeMem,
  peekMem,
  disposeCpu,
} from "./binary-oracle-lib.js";

const FUN = 0x00003e1a;

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) >>> 0;
    return ((s >>> 16) & 0xffff) / 0x10000;
  };
}

async function main(): Promise<void> {
  const n = Number(process.argv[2] ?? "300");
  const rom = readFileSync(resolve("ghidra_project/marble_program.bin"));
  const stateInst = stateNs.emptyGameState();
  const tsRom = busNs.emptyRomImage();
  tsRom.program.set(rom.subarray(0, tsRom.program.length));
  const cpu = await createCpu({ rom, state: stateInst });
  const rng = makeRng(0x3e1a);

  console.log(`\n=== soundDispatchSend (FUN_3E1A) — ${n} casi ===`);
  let ok = 0;
  let firstFail: { tc: number; addr: number; bin: number; ts: number } | null = null;

  // Range workRam-safe per la struct A2: scegliamo 0x401D00 (region 29, NON
  const a2Addr = 0x00401d00;

  for (let i = 0; i < n; i++) {
    cpu.system.setRegister("sp", 0x401f00);

    const arg = (Math.floor(rng() * 0xffff) << 16) >>> 0 | Math.floor(rng() * 0xffff);

    // Setup ackPtr @ 0x401FFC
    pokeMem(cpu, 0x00401FFC, 4, a2Addr);
    stateInst.workRam[0x1ffc] = (a2Addr >>> 24) & 0xff;
    stateInst.workRam[0x1ffd] = (a2Addr >>> 16) & 0xff;
    stateInst.workRam[0x1ffe] = (a2Addr >>> 8) & 0xff;
    stateInst.workRam[0x1fff] = a2Addr & 0xff;

    // Setup struct A2 fields
    // 50%: status valid (D3 < 0xE0); 30%: status >= 0xE0 (early return);
    // 20%: complement mismatch (D3 = 0)
    let statusByte: number;
    let complByte: number;
    const choose = rng();
    if (choose < 0.5) {
      statusByte = Math.floor(rng() * 0xe0); // < 0xE0
      complByte = (~statusByte) & 0xff;
    } else if (choose < 0.8) {
      statusByte = 0xe0 + Math.floor(rng() * 0x20); // >= 0xE0
      complByte = (~statusByte) & 0xff;
    } else {
      statusByte = Math.floor(rng() * 256);
      complByte = Math.floor(rng() * 256); // mismatch likely
    }
    pokeMem(cpu, a2Addr + 0x0a, 1, statusByte);
    pokeMem(cpu, a2Addr + 0x0b, 1, complByte);
    stateInst.workRam[(a2Addr - 0x400000) + 0x0a] = statusByte;
    stateInst.workRam[(a2Addr - 0x400000) + 0x0b] = complByte;

    // Init carry slots (A2+0x00..0x02) e increment slots (A2+0x14..0x16) random
    for (let j = 0; j < 0x18; j++) {
      const v = Math.floor(rng() * 256);
      pokeMem(cpu, a2Addr + j, 1, v);
      stateInst.workRam[(a2Addr - 0x400000) + j] = v;
    }
    pokeMem(cpu, a2Addr + 0x0a, 1, statusByte);
    pokeMem(cpu, a2Addr + 0x0b, 1, complByte);
    stateInst.workRam[(a2Addr - 0x400000) + 0x0a] = statusByte;
    stateInst.workRam[(a2Addr - 0x400000) + 0x0b] = complByte;

    // Accumulator random
    const ff5 = Math.floor(rng() * 256);
    const ff6 = Math.floor(rng() * 256);
    const ff7 = Math.floor(rng() * 256);
    pokeMem(cpu, 0x00401FF5, 1, ff5);
    pokeMem(cpu, 0x00401FF6, 1, ff6);
    pokeMem(cpu, 0x00401FF7, 1, ff7);
    stateInst.workRam[0x1ff5] = ff5;
    stateInst.workRam[0x1ff6] = ff6;
    stateInst.workRam[0x1ff7] = ff7;

    callFunction(cpu, FUN, [arg]);
    soundDispatchSendNs.soundDispatchSend(stateInst, tsRom, arg);

    let match = true;
    const ranges: ReadonlyArray<readonly [number, number]> = [
      [0x1ff5, 0x1fff], // accumulator + ackPtr (0x1FFC) area
      [a2Addr - 0x400000, a2Addr - 0x400000 + 0x18], // struct A2
    ];
    outer: for (const [start, end] of ranges) {
      for (let j = start; j < end; j++) {
        const b = peekMem(cpu, 0x00400000 + j, 1);
        const t = stateInst.workRam[j] ?? 0;
        if (b !== t) {
          match = false;
          if (firstFail === null) {
            firstFail = { tc: i, addr: 0x00400000 + j, bin: b, ts: t };
          }
          break outer;
        }
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
