#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import { state as stateNs, stringTrim } from "@marble-love/engine";
import { createCpu, callFunction, pokeMem, peekMem, disposeCpu } from "./binary-oracle-lib.js";

const FUN_TRIM = 0x00028f28;
const FUN_FIND = 0x000172c2;

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (s * 1103515245 + 12345) >>> 0; return ((s >>> 16) & 0xffff) / 0x10000; };
}

async function main(): Promise<void> {
  const n = Number(process.argv[2] ?? "300");
  const rom = readFileSync(resolve("ghidra_project/marble_program.bin"));
  const stateInst = stateNs.emptyGameState();
  const cpu = await createCpu({ rom, state: stateInst });
  const r = rng(0xab12);

  console.log(`\n=== trimTrailingSpace (FUN_28F28) — ${n} cases ===`);
  let ok1 = 0;
  for (let i = 0; i < n; i++) {
    cpu.system.setRegister("sp", 0x401f00);
    const STR = 0x00401D00;
    const slen = 4 + Math.floor(r() * 8);
    const bytes: number[] = [];
    for (let j = 0; j < slen; j++) {
      bytes.push(r() < 0.3 ? 0x20 : (0x41 + Math.floor(r() * 26)));
    }
    bytes.push(0);
    for (let j = 0; j < bytes.length; j++) {
      pokeMem(cpu, STR + j, 1, bytes[j] ?? 0);
      stateInst.workRam[(STR - 0x400000) + j] = bytes[j] ?? 0;
    }
    const maxLen = Math.floor(r() * (slen + 4));
    callFunction(cpu, FUN_TRIM, [STR, maxLen]);
    stringTrim.trimTrailingSpace(stateInst, STR, maxLen);
    let m = true;
    for (let j = 0; j < bytes.length; j++) {
      if (peekMem(cpu, STR + j, 1) !== (stateInst.workRam[(STR - 0x400000) + j] ?? 0)) {
        m = false; break;
      }
    }
    if (m) ok1++;
  }
  console.log(`  Match: ${ok1}/${n} = ${((ok1/n)*100).toFixed(1)}%`);

  console.log(`\n=== findLastActiveSlot (FUN_172C2) — ${n} cases ===`);
  let ok2 = 0;
  for (let i = 0; i < n; i++) {
    cpu.system.setRegister("sp", 0x401f00);
    // Setup 7 slots @ 0x401482, stride 0x42, byte+0x18 random 0/non-0
    for (let s = 0; s < 7; s++) {
      const addr = 0x401482 + s * 0x42;
      const v = (r() < 0.5) ? 0 : Math.floor(r() * 256);
      pokeMem(cpu, addr + 0x18, 1, v);
      stateInst.workRam[(addr - 0x400000) + 0x18] = v;
    }
    const binR = callFunction(cpu, FUN_FIND, []);
    const tsR = stringTrim.findLastActiveSlot(stateInst);
    if ((binR.d0 >>> 0) === (tsR >>> 0)) ok2++;
  }
  console.log(`  Match: ${ok2}/${n} = ${((ok2/n)*100).toFixed(1)}%`);

  disposeCpu(cpu);
  exit((ok1 === n && ok2 === n) ? 0 : 1);
}

main().catch(e => { console.error(e); exit(1); });
