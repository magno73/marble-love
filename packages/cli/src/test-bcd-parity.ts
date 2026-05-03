#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import { state as stateNs, bcd } from "@marble-love/engine";
import { createCpu, callFunction, disposeCpu } from "./binary-oracle-lib.js";

const FUN = 0x00003a6a;

async function main(): Promise<void> {
  const n = Number(process.argv[2] ?? "500");
  const rom = readFileSync(resolve("ghidra_project/marble_program.bin"));
  const stateInst = stateNs.emptyGameState();
  const cpu = await createCpu({ rom, state: stateInst });

  let s = 0xdead0001;
  const r = (): number => { s = (s * 1103515245 + 12345) >>> 0; return ((s >>> 16) & 0xffff) / 0x10000; };

  console.log(`\n=== binToBcd (FUN_3A6A) — ${n} casi ===`);
  let ok = 0;
  let fail: any = null;
  // Edge cases first
  const edges = [0, 1, 9, 10, 99, 100, 999, 9999, 99999999, 0xFFFFFFFF];
  for (let i = 0; i < n; i++) {
    cpu.system.setRegister("sp", 0x401f00);
    const v = i < edges.length ? edges[i]! : Math.floor(r() * 100000000);
    const bin = callFunction(cpu, FUN, [v]);
    const ts = bcd.binToBcd(v);
    if ((bin.d0 >>> 0) === (ts >>> 0)) ok++;
    else if (fail === null) fail = { v, bin: bin.d0 >>> 0, ts: ts >>> 0 };
  }
  console.log(`  Match: ${ok}/${n} = ${((ok/n)*100).toFixed(1)}%`);
  if (fail) console.log(`  First fail: v=${fail.v} bin=0x${fail.bin.toString(16)} ts=0x${fail.ts.toString(16)}`);

  disposeCpu(cpu);
  exit(ok === n ? 0 : 1);
}

main().catch(e => { console.error(e); exit(1); });
