#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import { state as stateNs, stringStep, bus as busNs } from "@marble-love/engine";
import type { RomImage } from "@marble-love/engine";
import { createCpu, callFunction, pokeMem, peekMem, disposeCpu } from "./binary-oracle-lib.js";

const FUN_3 = 0x00002cd4;
const FUN_4 = 0x00002da0;

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (s * 1103515245 + 12345) >>> 0; return ((s >>> 16) & 0xffff) / 0x10000; };
}

async function main(): Promise<void> {
  const n = Number(process.argv[2] ?? "500");
  const rom = readFileSync(resolve("ghidra_project/marble_program.bin"));
  const stateInst = stateNs.emptyGameState();
  const cpu = await createCpu({ rom, state: stateInst });
  const tsRom: RomImage = busNs.emptyRomImage();
  tsRom.program.set(rom.subarray(0, tsRom.program.length));

  const STRUCT = 0x00401D00, STRING_ADDR = 0x00401D40;
  const r = rng(0x9999);

  function setupCommon(rot: number, col: number, tickOff: number, slen: number): number[] {
    pokeMem(cpu, 0x00401F42, 2, rot);
    stateInst.workRam[0x1F42] = 0; stateInst.workRam[0x1F43] = rot;
    pokeMem(cpu, STRUCT + 0, 1, col);
    pokeMem(cpu, STRUCT + 1, 1, tickOff);
    pokeMem(cpu, STRUCT + 2, 4, STRING_ADDR);
    stateInst.workRam[0x1D00] = col; stateInst.workRam[0x1D01] = tickOff;
    stateInst.workRam[0x1D02] = 0; stateInst.workRam[0x1D03] = 0x40;
    stateInst.workRam[0x1D04] = 0x1D; stateInst.workRam[0x1D05] = 0x40;
    const strBytes: number[] = [];
    for (let j = 0; j < slen; j++) strBytes.push(0x40 + Math.floor(r() * 60));
    strBytes.push(0);
    for (let j = 0; j < strBytes.length; j++) {
      pokeMem(cpu, STRING_ADDR + j, 1, strBytes[j] ?? 0);
      stateInst.workRam[(STRING_ADDR - 0x400000) + j] = strBytes[j] ?? 0;
    }
    return strBytes;
  }

  function clearAlpha(): void {
    for (let j = 0; j < 0x1000; j++) {
      pokeMem(cpu, 0xa03000 + j, 1, 0xCC);
      stateInst.alphaRam[j] = 0xCC;
    }
  }

  // Test FUN_2CD4
  console.log(`\n=== stepRenderState3 (FUN_2CD4) — ${n} casi ===`);
  let ok3 = 0;
  for (let i = 0; i < n; i++) {
    cpu.system.setRegister("sp", 0x401f00);
    const rot = Math.floor(r() * 8);
    const col = Math.floor(r() * 32);
    const tickOff = Math.floor(r() * 16);
    const slen = 5 + Math.floor(r() * 8);
    setupCommon(rot, col, tickOff, slen);
    clearAlpha();
    const charIdx = Math.floor(r() * (slen + 2)); // sometimes past end
    const attr = Math.floor(r() * 0x10000);

    const binR = callFunction(cpu, FUN_3, [STRUCT, attr, charIdx]);
    const tsR = stringStep.stepRenderState3(stateInst, tsRom, STRUCT, attr, charIdx);

    let m = (binR.d0 & 0xff) === tsR;
    if (m) {
      for (let j = 0; j < 0x1000; j++) {
        if (peekMem(cpu, 0xa03000 + j, 1) !== (stateInst.alphaRam[j] ?? 0)) { m = false; break; }
      }
    }
    if (m) ok3++;
  }
  console.log(`  Match: ${ok3}/${n} = ${((ok3/n)*100).toFixed(1)}%`);

  // Test FUN_2DA0
  console.log(`\n=== stepClearState4 (FUN_2DA0) — ${n} casi ===`);
  let ok4 = 0;
  for (let i = 0; i < n; i++) {
    cpu.system.setRegister("sp", 0x401f00);
    const rot = Math.floor(r() * 8);
    const col = Math.floor(r() * 32);
    const tickOff = Math.floor(r() * 16);
    const slen = 5 + Math.floor(r() * 8);
    setupCommon(rot, col, tickOff, slen);
    clearAlpha();
    const charIdx = Math.floor(r() * (slen + 2));

    const binR = callFunction(cpu, FUN_4, [STRUCT, charIdx]);
    const tsR = stringStep.stepClearState4(stateInst, tsRom, STRUCT, charIdx);

    let m = (binR.d0 & 0xff) === tsR;
    if (m) {
      for (let j = 0; j < 0x1000; j++) {
        if (peekMem(cpu, 0xa03000 + j, 1) !== (stateInst.alphaRam[j] ?? 0)) { m = false; break; }
      }
    }
    if (m) ok4++;
  }
  console.log(`  Match: ${ok4}/${n} = ${((ok4/n)*100).toFixed(1)}%`);

  disposeCpu(cpu);
  exit((ok3 === n && ok4 === n) ? 0 : 1);
}

main().catch(e => { console.error(e); exit(1); });
