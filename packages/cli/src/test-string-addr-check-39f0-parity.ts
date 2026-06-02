#!/usr/bin/env node
/**
 * test-string-addr-check-39f0-parity.ts — differential FUN_0039F0 vs isKnownStringAddr.
 *
 *   2. isKnownStringAddr(addr) — TS
 *
 * Note: callFunction does not expose CCR. Use an in-memory micro-wrapper that
 *
 * we check the Z flag from getRegisters().ccr (bit 2).
 *
 * Usage: npx tsx packages/cli/src/test-string-addr-check-39f0-parity.ts [N]
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import { stringAddrCheck39F0, state as stateNs } from "@marble-love/engine";
import { createCpu, disposeCpu } from "./binary-oracle-lib.js";
import type { CpuSession } from "./binary-oracle-lib.js";

const FUN = 0x000039f0;
const SENTINEL = 0xcafebabe >>> 0;

function callWithA1(cpu: CpuSession, addr: number): boolean {
  const sys = cpu.system;
  // Setup stack: push sentinel return address
  let sp = 0x401f00;
  sp = (sp - 4) >>> 0;
  sys.write(sp, 4, SENTINEL);
  sys.setRegister("sp", sp);
  sys.setRegister("pc", FUN);
  sys.setRegister("a1", addr >>> 0);

  for (let i = 0; i < 20; i++) {
    if (sys.getRegisters().pc === SENTINEL) break;
    sys.step();
  }

  const sr: number = sys.getRegisters().sr;
  return (sr & 0x4) !== 0;
}

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
  const stateInst = stateNs.emptyGameState();
  const cpu = await createCpu({ rom, state: stateInst });

  console.log(`\n=== isKnownStringAddr (FUN_0039F0) — ${n} cases ===`);

  const rng = makeRng(0x39f039f0);

  const knownAddrs: number[] = [0x3850, 0x385c, 0x3868];
  // Known addresses that must return false (adjacent and others).
  const negAddrs: number[] = [0x384e, 0x3852, 0x385a, 0x385e, 0x3866, 0x386a, 0x0000, 0xffffffff >>> 0];

  let ok = 0;
  let failAddr = -1;
  let failBinZ = false;
  let failTsZ = false;

  const testAddr = (addr: number): boolean => {
    const binZ = callWithA1(cpu, addr);
    const tsZ = stringAddrCheck39F0.isKnownStringAddr(addr);
    const match = binZ === tsZ;
    if (match) ok++;
    else if (failAddr === -1) { failAddr = addr; failBinZ = binZ; failTsZ = tsZ; }
    return match;
  };

  // Smoke: 3 known and 8 negative
  for (const a of knownAddrs) testAddr(a);
  for (const a of negAddrs) testAddr(a);

  // Random cases: the bulk of the 500 samples.
  const remaining = n - knownAddrs.length - negAddrs.length;
  for (let i = 0; i < remaining; i++) {
    let addr: number;
    if (rng() < 0.3) {
      const bases = [0x3850, 0x385c, 0x3868];
      const base = bases[Math.floor(rng() * 3)]!;
      addr = (base + Math.floor((rng() - 0.5) * 16)) >>> 0;
    } else {
      addr = (Math.floor(rng() * 0x100000)) >>> 0;
    }
    testAddr(addr);
  }

  const total = knownAddrs.length + negAddrs.length + Math.max(0, remaining);
  console.log(`  Match: ${ok}/${total} = ${((ok / total) * 100).toFixed(1)}%`);
  if (failAddr >= 0) {
    console.log(`  First fail: addr=0x${(failAddr).toString(16).padStart(8, "0")} bin_Z=${failBinZ} ts_Z=${failTsZ}`);
  }

  disposeCpu(cpu);
  exit(ok === total ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  exit(1);
});
