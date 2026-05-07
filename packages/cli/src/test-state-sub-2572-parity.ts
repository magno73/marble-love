#!/usr/bin/env node
/**
 * test-state-sub-2572-parity.ts — differential FUN_2572 vs stateSub2572.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import { bus as busNs, state as stateNs, stateSub2572 as sub2572Ns } from "@marble-love/engine";
import { callFunction, createCpu, disposeCpu, peekMem, pokeMem } from "./binary-oracle-lib.js";

const FUN_2572 = 0x00002572;
const STRUCT = 0x00401d00;
const STRING_ADDR = 0x00401d40;

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) >>> 0;
    return ((s >>> 16) & 0xffff) / 0x10000;
  };
}

function findRomBlobPath(): string {
  const candidates = [
    process.env.MARBLE_ROM_BLOB,
    resolve("ghidra_project/marble_program.bin"),
    resolve("../marble-love/ghidra_project/marble_program.bin"),
  ].filter((p): p is string => p !== undefined && p.length > 0);
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  throw new Error("ROM blob not found; set MARBLE_ROM_BLOB or keep ghidra_project/marble_program.bin in the repo.");
}

function writeBothByte(
  cpu: Awaited<ReturnType<typeof createCpu>>,
  binState: ReturnType<typeof stateNs.emptyGameState>,
  tsState: ReturnType<typeof stateNs.emptyGameState>,
  addr: number,
  value: number,
): void {
  const v = value & 0xff;
  pokeMem(cpu, addr, 1, v);
  if (addr >= 0x00400000 && addr < 0x00402000) {
    binState.workRam[addr - 0x00400000] = v;
    tsState.workRam[addr - 0x00400000] = v;
  } else if (addr >= 0x00a03000 && addr < 0x00a04000) {
    binState.alphaRam[addr - 0x00a03000] = v;
    tsState.alphaRam[addr - 0x00a03000] = v;
  }
}

async function main(): Promise<void> {
  const n = Number(process.argv[2] ?? "500");
  const rom = readFileSync(findRomBlobPath());
  const tsRom = busNs.emptyRomImage();
  tsRom.program.set(rom.subarray(0, tsRom.program.length));

  const binState = stateNs.emptyGameState();
  const tsState = stateNs.emptyGameState();
  const cpu = await createCpu({ rom, state: binState });
  const rng = makeRng(0x2572);

  let ok = 0;
  let firstFail: { caseNo: number; kind: string; bin: number; ts: number; rot: number } | null = null;

  for (let i = 0; i < n; i++) {
    cpu.system.setRegister("sp", 0x401f00);
    const valF00 = 0;
    const tick = Math.floor(rng() * 0x10000) & 0xffff;
    const rot = Math.floor(rng() * 8);
    const attr = Math.floor(rng() * 0x10000) & 0xffff;
    const col = Math.floor(rng() * 32) & 0xff;
    const tickOff = tick & 0xff;
    const slen = 5 + Math.floor(rng() * 6);

    pokeMem(cpu, 0x00401f00, 2, valF00);
    pokeMem(cpu, 0x00401f3a, 2, tick);
    pokeMem(cpu, 0x00401f42, 2, rot);
    for (const st of [binState, tsState]) {
      st.workRam[0x1f00] = (valF00 >>> 8) & 0xff;
      st.workRam[0x1f01] = valF00 & 0xff;
      st.workRam[0x1f3a] = (tick >>> 8) & 0xff;
      st.workRam[0x1f3b] = tick & 0xff;
      st.workRam[0x1f42] = (rot >>> 8) & 0xff;
      st.workRam[0x1f43] = rot & 0xff;
    }

    writeBothByte(cpu, binState, tsState, STRUCT + 0, col);
    writeBothByte(cpu, binState, tsState, STRUCT + 1, tickOff);
    pokeMem(cpu, STRUCT + 2, 4, STRING_ADDR);
    for (const st of [binState, tsState]) {
      st.workRam[0x1d02] = 0;
      st.workRam[0x1d03] = 0x40;
      st.workRam[0x1d04] = 0x1d;
      st.workRam[0x1d05] = 0x40;
    }
    writeBothByte(cpu, binState, tsState, STRUCT + 6, 0);
    pokeMem(cpu, STRUCT + 8, 4, 0);
    for (const st of [binState, tsState]) {
      st.workRam[0x1d08] = 0;
      st.workRam[0x1d09] = 0;
      st.workRam[0x1d0a] = 0;
      st.workRam[0x1d0b] = 0;
    }

    for (let j = 0; j < slen; j++) {
      const r = rng();
      const ch = r < 0.2 ? 0x20 : r < 0.7 ? 0x41 + Math.floor(rng() * 26) : 0x61 + Math.floor(rng() * 26);
      writeBothByte(cpu, binState, tsState, STRING_ADDR + j, ch);
    }
    writeBothByte(cpu, binState, tsState, STRING_ADDR + slen, 0);

    for (let j = 0; j < 0x1000; j++) writeBothByte(cpu, binState, tsState, 0x00a03000 + j, 0);

    const binR = callFunction(cpu, FUN_2572, [STRUCT, attr]);
    const tsR = sub2572Ns.stateSub2572(tsState, tsRom, STRUCT, attr);

    let match = (binR.d0 >>> 0) === (tsR >>> 0);
    if (!match) firstFail ??= { caseNo: i, kind: "d0", bin: binR.d0 >>> 0, ts: tsR >>> 0, rot };

    for (let j = 0; match && j < 0x1000; j++) {
      const bin = peekMem(cpu, 0x00a03000 + j, 1);
      const ts = tsState.alphaRam[j] ?? 0;
      if (bin !== ts) {
        firstFail ??= { caseNo: i, kind: `alpha@${j}`, bin, ts, rot };
        match = false;
      }
    }
    if (match) ok++;
  }

  console.log(`\n=== stateSub2572 (FUN_2572) — ${n} casi ===`);
  console.log(`  Match: ${ok}/${n} = ${((ok / n) * 100).toFixed(1)}%`);
  if (firstFail) console.log(`  First fail: ${JSON.stringify(firstFail)}`);
  disposeCpu(cpu);
  exit(ok === n ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  exit(1);
});
