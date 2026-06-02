#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import { state as stateNs, rleExpand } from "@marble-love/engine";
import { createCpu, callFunction, pokeMem, peekMem, disposeCpu } from "./binary-oracle-lib.js";

const FUN = 0x00018fd0;

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (s * 1103515245 + 12345) >>> 0; return ((s >>> 16) & 0xffff) / 0x10000; };
}

async function main(): Promise<void> {
  const n = Number(process.argv[2] ?? "500");
  const romPath = [
    process.env.MARBLE_ROM_BLOB,
    resolve("ghidra_project/marble_program.bin"),
    resolve("../marble-love/ghidra_project/marble_program.bin"),
  ].find((p): p is string => p !== undefined && existsSync(p));
  if (romPath === undefined) throw new Error("ROM blob not found");
  const rom = readFileSync(romPath);
  const stateInst = stateNs.emptyGameState();
  const cpu = await createCpu({ rom, state: stateInst });
  const r = rng(0xab7c);

  console.log(`\n=== rleExpand (FUN_18FD0) — ${n} cases ===`);
  let ok = 0;
  for (let i = 0; i < n; i++) {
    cpu.system.setRegister("sp", 0x401f00);
    // Setup chain: *0x400474 = 0x00401D00 (ptr to header)
    // *(0x00401D00 + 0xC) = 0x00401D80 (ptr to source data)
    pokeMem(cpu, 0x00400474, 4, 0x00401D00);
    pokeMem(cpu, 0x00401D0C, 4, 0x00401D80);
    stateInst.workRam[0x474] = 0; stateInst.workRam[0x475] = 0x40;
    stateInst.workRam[0x476] = 0x1D; stateInst.workRam[0x477] = 0x00;
    stateInst.workRam[0x1D0C] = 0; stateInst.workRam[0x1D0D] = 0x40;
    stateInst.workRam[0x1D0E] = 0x1D; stateInst.workRam[0x1D0F] = 0x80;

    // Generate small RLE source (1-4 pairs, then 0 terminator)
    const numPairs = 1 + Math.floor(r() * 4);
    let totalCount = 0;
    let dataAddr = 0x1D80;
    for (let p = 0; p < numPairs; p++) {
      const cnt = 1 + Math.floor(r() * 5); // 1..5
      if (totalCount + cnt > 64) break;
      totalCount += cnt;
      const val = Math.floor(r() * 0x10000);
      pokeMem(cpu, 0x00400000 + dataAddr, 2, cnt);
      pokeMem(cpu, 0x00400000 + dataAddr + 2, 2, val);
      stateInst.workRam[dataAddr] = (cnt >>> 8) & 0xff;
      stateInst.workRam[dataAddr + 1] = cnt & 0xff;
      stateInst.workRam[dataAddr + 2] = (val >>> 8) & 0xff;
      stateInst.workRam[dataAddr + 3] = val & 0xff;
      dataAddr += 4;
    }
    // Null terminator (count = 0)
    pokeMem(cpu, 0x00400000 + dataAddr, 2, 0);
    stateInst.workRam[dataAddr] = 0;
    stateInst.workRam[dataAddr + 1] = 0;

    // Pre-fill destination 0x478 with sentinel
    for (let j = 0; j < 0x100; j++) {
      pokeMem(cpu, 0x00400478 + j, 1, 0x55);
      stateInst.workRam[0x478 + j] = 0x55;
    }

    callFunction(cpu, FUN, []);
    rleExpand.rleExpand(stateInst);

    let m = true;
    for (let j = 0; j < 0x100; j++) {
      if (peekMem(cpu, 0x00400478 + j, 1) !== (stateInst.workRam[0x478 + j] ?? 0)) {
        m = false; break;
      }
    }
    if (m) ok++;
  }
  console.log(`  Match: ${ok}/${n} = ${((ok/n)*100).toFixed(1)}%`);
  disposeCpu(cpu);
  exit(ok === n ? 0 : 1);
}

main().catch(e => { console.error(e); exit(1); });
