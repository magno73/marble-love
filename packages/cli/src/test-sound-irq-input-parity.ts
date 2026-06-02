#!/usr/bin/env node
/**
 * test-sound-irq-input-parity.ts — differential FUN_4D1A vs soundIrqInputTick.
 *
 * via callFunction (which uses a sentinel return address + rts), patch it by
 * replacing `rte` with `rts` (0x4E75) at ROM offset 0x4D66.
 *
 *
 * Usage: npx tsx packages/cli/src/test-sound-irq-input-parity.ts [N]
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import { state as stateNs, soundIrqInput } from "@marble-love/engine";
import {
  createCpu,
  callFunction,
  pokeMem,
  peekMem,
  disposeCpu,
} from "./binary-oracle-lib.js";

const FUN = 0x00004d1a;
const RTE_OFF = 0x4d66; // offset of `rte` in FUN_4D1A
// Offset of the absolute long address of the instruction `move.b (0xFC0001).l,(A0)` @ 0x4D5C.
const MMIO_ADDR_PATCH_OFF = 0x4d5e; // bytes 0x4D5E..0x4D61 = 4-byte abs addr

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) >>> 0;
    return ((s >>> 16) & 0xffff) / 0x10000;
  };
}

async function main(): Promise<void> {
  const n = Number(process.argv[2] ?? "1000");
  const rom = Buffer.from(readFileSync(resolve("ghidra_project/marble_program.bin")));

  // Patch RTE → RTS to allow sentinel-based callFunction
  rom[RTE_OFF] = 0x4e;
  rom[RTE_OFF + 1] = 0x75;

  // Control the source byte through pokeMem instead of depending on the audio CPU.
  rom[MMIO_ADDR_PATCH_OFF] = 0x00;
  rom[MMIO_ADDR_PATCH_OFF + 1] = 0x40;
  rom[MMIO_ADDR_PATCH_OFF + 2] = 0x04;
  rom[MMIO_ADDR_PATCH_OFF + 3] = 0x40;

  const stateInst = stateNs.emptyGameState();
  const cpu = await createCpu({ rom, state: stateInst });
  const rng = makeRng(0x4d1a);

  console.log(`\n=== soundIrqInputTick (FUN_4D1A) — ${n} cases ===`);
  let ok = 0;
  let firstFail: { tc: number; addr: number; bin: number; ts: number } | null = null;

  for (let i = 0; i < n; i++) {
    cpu.system.setRegister("sp", 0x401f00);

    const mmioByte = Math.floor(rng() * 256);
    const idx = Math.floor(rng() * 16); // 0..15 valid idx
    const cnt = Math.floor(rng() * 256);

    // 30% chance: ack pending — ackPtr points into workRam-safe (0x401D00..0x401EFF)
    let ackPtr = 0;
    if (rng() < 0.3) {
      ackPtr = (0x00401d00 + Math.floor(rng() * 0x100)) >>> 0;
    }

    // Setup state: workRam @ 0x1F44-0x1F5D
    pokeMem(cpu, 0x00401F57, 1, idx);
    pokeMem(cpu, 0x00401F58, 1, cnt);
    pokeMem(cpu, 0x00401F5A, 4, ackPtr);
    stateInst.workRam[0x1f57] = idx;
    stateInst.workRam[0x1f58] = cnt;
    stateInst.workRam[0x1f5a] = (ackPtr >>> 24) & 0xff;
    stateInst.workRam[0x1f5b] = (ackPtr >>> 16) & 0xff;
    stateInst.workRam[0x1f5c] = (ackPtr >>> 8) & 0xff;
    stateInst.workRam[0x1f5d] = ackPtr & 0xff;

    for (let j = 0; j < 0x10; j++) {
      pokeMem(cpu, 0x00401F46 + j, 1, 0xCC);
      stateInst.workRam[0x1f46 + j] = 0xCC;
    }

    pokeMem(cpu, 0x00400440, 1, mmioByte);

    callFunction(cpu, FUN, []);
    soundIrqInput.soundIrqInputTick(stateInst, mmioByte);

    let match = true;
    for (let j = 0x1f44; j <= 0x1f5f; j++) {
      const b = peekMem(cpu, 0x00400000 + j, 1);
      const t = stateInst.workRam[j] ?? 0;
      if (b !== t) {
        match = false;
        if (firstFail === null) {
          firstFail = { tc: i, addr: 0x00400000 + j, bin: b, ts: t };
        }
        break;
      }
    }
    if (match && ackPtr !== 0 && ackPtr >= 0x00400000 && ackPtr < 0x00402000) {
      const b = peekMem(cpu, ackPtr, 1);
      const t = stateInst.workRam[ackPtr - 0x00400000] ?? 0;
      if (b !== t) {
        match = false;
        if (firstFail === null) {
          firstFail = { tc: i, addr: ackPtr, bin: b, ts: t };
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
