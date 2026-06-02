#!/usr/bin/env node
/**
 * test-string-clear-parity.ts — differential FUN_2678 + FUN_2ABC.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import { state as stateNs, stringClear, bus as busNs } from "@marble-love/engine";
import type { RomImage } from "@marble-love/engine";
import { createCpu, callFunction, pokeMem, peekMem, disposeCpu } from "./binary-oracle-lib.js";

const FUN_REMOVE = 0x00002678;
const FUN_CLEAR = 0x00002abc;

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (s * 1103515245 + 12345) >>> 0; return ((s >>> 16) & 0xffff) / 0x10000; };
}

async function main(): Promise<void> {
  const n = Number(process.argv[2] ?? "200");
  const rom = readFileSync(resolve("ghidra_project/marble_program.bin"));
  const stateInst = stateNs.emptyGameState();
  const cpu = await createCpu({ rom, state: stateInst });
  const tsRom: RomImage = busNs.emptyRomImage();
  tsRom.program.set(rom.subarray(0, tsRom.program.length));

  const r = rng(0xab12);
  const STRUCT = 0x00401D00, STRING_ADDR = 0x00401D40;

  // ─── FUN_2ABC: clearStringChain ─────────────────────────────────
  console.log(`\n=== clearStringChain (FUN_2ABC) — ${n} cases ===`);
  let okC = 0, failC: any = null;
  for (let i = 0; i < n; i++) {
    cpu.system.setRegister("sp", 0x401f00);
    pokeMem(cpu, 0x00401F00, 2, 0); // valF00 = 0 (chain end)
    pokeMem(cpu, 0x00401F42, 2, Math.floor(r() * 8));
    stateInst.workRam[0x1F00] = 0; stateInst.workRam[0x1F01] = 0;
    const rot = Math.floor(r() * 8);
    stateInst.workRam[0x1F42] = 0; stateInst.workRam[0x1F43] = rot;
    pokeMem(cpu, 0x00401F42, 2, rot);

    const col = Math.floor(r() * 32) & 0xff;
    const tickOff = Math.floor(r() * 32) & 0xff;
    pokeMem(cpu, STRUCT + 0, 1, col);
    pokeMem(cpu, STRUCT + 1, 1, tickOff);
    pokeMem(cpu, STRUCT + 2, 4, STRING_ADDR);
    pokeMem(cpu, STRUCT + 6, 1, 0); // marker = 0
    pokeMem(cpu, STRUCT + 8, 4, 0);
    stateInst.workRam[0x1D00] = col; stateInst.workRam[0x1D01] = tickOff;
    stateInst.workRam[0x1D02] = 0; stateInst.workRam[0x1D03] = 0x40;
    stateInst.workRam[0x1D04] = 0x1D; stateInst.workRam[0x1D05] = 0x40;
    stateInst.workRam[0x1D06] = 0; stateInst.workRam[0x1D07] = 0;
    stateInst.workRam[0x1D08] = 0; stateInst.workRam[0x1D09] = 0;
    stateInst.workRam[0x1D0A] = 0; stateInst.workRam[0x1D0B] = 0;

    const slen = 3 + Math.floor(r() * 8);
    const strBytes: number[] = [];
    for (let j = 0; j < slen; j++) strBytes.push(0x40 + Math.floor(r() * 60));
    strBytes.push(0);
    for (let j = 0; j < strBytes.length; j++) {
      pokeMem(cpu, STRING_ADDR + j, 1, strBytes[j] ?? 0);
      stateInst.workRam[(STRING_ADDR - 0x400000) + j] = strBytes[j] ?? 0;
    }

    // Pre-fill alpha with sentinel
    for (let j = 0; j < 0x1000; j++) {
      pokeMem(cpu, 0xa03000 + j, 1, 0xCC);
      stateInst.alphaRam[j] = 0xCC;
    }

    callFunction(cpu, FUN_CLEAR, [STRUCT]);
    stringClear.clearStringChain(stateInst, tsRom, STRUCT);

    let m = true;
    for (let j = 0; j < 0x1000; j++) {
      if (peekMem(cpu, 0xa03000 + j, 1) !== (stateInst.alphaRam[j] ?? 0)) {
        m = false;
        if (failC === null) failC = { case: i, offset: j };
        break;
      }
    }
    if (m) okC++;
  }
  console.log(`  Match: ${okC}/${n} = ${((okC/n)*100).toFixed(1)}%`);
  if (failC) console.log(`  First fail: case ${failC.case} @ alpha+0x${failC.offset.toString(16)}`);

  // ─── FUN_2678: removeFromSlots ─────────────────────────────────
  console.log(`\n=== removeFromSlots (FUN_2678) — ${n} cases ===`);
  let okR = 0, failR: any = null;
  for (let i = 0; i < n; i++) {
    cpu.system.setRegister("sp", 0x401f00);
    // Setup slot data array @ 0x401F04..F13 (4 longs)
    // Make slot 1 == arg, others random
    const targetPtr = STRUCT;
    const slots = [
      Math.floor(r() * 0x10000),
      targetPtr,
      Math.floor(r() * 0x10000),
      Math.floor(r() * 0x10000),
    ];
    for (let j = 0; j < 4; j++) {
      pokeMem(cpu, 0x401F04 + j*4, 4, slots[j] ?? 0);
      const v = slots[j] ?? 0;
      stateInst.workRam[0x1F04 + j*4] = (v >>> 24) & 0xff;
      stateInst.workRam[0x1F04 + j*4 + 1] = (v >>> 16) & 0xff;
      stateInst.workRam[0x1F04 + j*4 + 2] = (v >>> 8) & 0xff;
      stateInst.workRam[0x1F04 + j*4 + 3] = v & 0xff;
    }
    // Set states 1..4
    for (let j = 0; j < 4; j++) {
      pokeMem(cpu, 0x401F1C + j, 1, 1 + j);
      stateInst.workRam[0x1F1C + j] = 1 + j;
    }
    // Setup struct (chain ends immediately)
    pokeMem(cpu, 0x00401F00, 2, 0);
    pokeMem(cpu, 0x00401F42, 2, 0);
    stateInst.workRam[0x1F00] = 0; stateInst.workRam[0x1F01] = 0;
    stateInst.workRam[0x1F42] = 0; stateInst.workRam[0x1F43] = 0;
    pokeMem(cpu, STRUCT + 0, 1, 0);  // col=0
    pokeMem(cpu, STRUCT + 1, 1, 0);  // tickOff=0
    pokeMem(cpu, STRUCT + 2, 4, STRING_ADDR);
    pokeMem(cpu, STRUCT + 6, 1, 0); // marker=0
    pokeMem(cpu, STRING_ADDR, 1, 0); // empty string
    stateInst.workRam[0x1D00] = 0; stateInst.workRam[0x1D01] = 0;
    stateInst.workRam[0x1D02] = 0; stateInst.workRam[0x1D03] = 0x40;
    stateInst.workRam[0x1D04] = 0x1D; stateInst.workRam[0x1D05] = 0x40;
    stateInst.workRam[0x1D06] = 0;
    stateInst.workRam[(STRING_ADDR - 0x400000)] = 0;

    callFunction(cpu, FUN_REMOVE, [targetPtr]);
    stringClear.removeFromSlots(stateInst, tsRom, targetPtr);

    let m = true;
    // Compare struct @ 0x401F04..F1F (data + state)
    for (let k = 0; k < 0x1C; k++) {
      const off = 0x1F04 + k;
      if (peekMem(cpu, 0x400000 + off, 1) !== (stateInst.workRam[off] ?? 0)) {
        m = false;
        if (failR === null) failR = { case: i, offset: off };
        break;
      }
    }
    if (m) okR++;
  }
  console.log(`  Match: ${okR}/${n} = ${((okR/n)*100).toFixed(1)}%`);
  if (failR) console.log(`  First fail: case ${failR.case} @ workRam+0x${failR.offset.toString(16)}`);

  disposeCpu(cpu);
  exit((okC === n && okR === n) ? 0 : 1);
}

main().catch(e => { console.error(e); exit(1); });
