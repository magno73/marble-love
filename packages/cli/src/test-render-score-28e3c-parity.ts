#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import { renderScore28E3C as scoreNs, state as stateNs } from "@marble-love/engine";
import { createCpu, disposeCpu, peekMem, pokeMem, type CpuSession } from "./binary-oracle-lib.js";

const FUN_28E3C = 0x00028e3c;
const FUN_0112 = 0x00000112;
const FUN_28F28 = 0x00028f28;
const FUN_28F62 = 0x00028f62;
const WORK = 0x00400000;
const SENT_FMT = 0x004003e0;
const SENT_TRIM = 0x004003e1;
const SENT_RENDER = 0x004003e2;
const SENTINEL_RET = 0x00c0ffee;

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) >>> 0;
    return ((s >>> 16) & 0xffff) / 0x10000;
  };
}

function romPath(): string {
  const candidates = [
    process.env.MARBLE_ROM_BLOB,
    resolve("ghidra_project/marble_program.bin"),
    resolve("../marble-love/ghidra_project/marble_program.bin"),
  ].filter((p): p is string => p !== undefined && p.length > 0);
  for (const p of candidates) if (existsSync(p)) return p;
  throw new Error("ROM blob not found");
}

function patchStubAddq(rom: Buffer, entry: number, sentinelAddr: number): void {
  rom[entry + 0] = 0x52;
  rom[entry + 1] = 0x39;
  rom[entry + 2] = (sentinelAddr >>> 24) & 0xff;
  rom[entry + 3] = (sentinelAddr >>> 16) & 0xff;
  rom[entry + 4] = (sentinelAddr >>> 8) & 0xff;
  rom[entry + 5] = sentinelAddr & 0xff;
  rom[entry + 6] = 0x4e;
  rom[entry + 7] = 0x75;
}

function callExact(session: CpuSession, addr: number, args: readonly number[]): void {
  const sys = session.system;
  let sp = 0x00401f00;
  for (let i = args.length - 1; i >= 0; i--) {
    sp = (sp - 4) >>> 0;
    sys.write(sp, 4, args[i]! >>> 0);
  }
  sp = (sp - 4) >>> 0;
  sys.write(sp, 4, SENTINEL_RET);
  sys.setRegister("sp", sp);
  sys.setRegister("pc", addr);
  for (let i = 0; i < 10_000; i++) {
    if (sys.getRegisters().pc === SENTINEL_RET) break;
    sys.step();
  }
  if (sys.getRegisters().pc !== SENTINEL_RET) throw new Error("FUN_28E3C did not return");
}

function inc(state: ReturnType<typeof stateNs.emptyGameState>, addr: number): void {
  const off = addr - WORK;
  state.workRam[off] = ((state.workRam[off] ?? 0) + 1) & 0xff;
}

async function main(): Promise<void> {
  const n = Number(process.argv[2] ?? "500");
  const rom = Buffer.from(readFileSync(romPath()));
  patchStubAddq(rom, FUN_0112, SENT_FMT);
  patchStubAddq(rom, FUN_28F28, SENT_TRIM);
  patchStubAddq(rom, FUN_28F62, SENT_RENDER);
  const cpu = await createCpu({ rom, state: stateNs.emptyGameState() });
  const ts = stateNs.emptyGameState();
  const r = rng(0x28e3c);
  let ok = 0;
  let firstFail: { caseNo: number; sent: number; bin: number; ts: number; selector: number } | null = null;

  for (let i = 0; i < n; i++) {
    ts.workRam.fill(0);
    for (let j = 0; j < 0x2000; j++) pokeMem(cpu, WORK + j, 1, 0);
    pokeMem(cpu, 0x0040041e, 4, 0x00401000);
    ts.workRam[0x41e] = 0x00;
    ts.workRam[0x41f] = 0x40;
    ts.workRam[0x420] = 0x10;
    ts.workRam[0x421] = 0x00;

    const selector = i % 3 === 0 ? 2 : Math.floor(r() * 8);
    const args = [
      Math.floor(r() * 0x100000000) >>> 0,
      selector,
      Math.floor(r() * 0x10000),
      Math.floor(r() * 0x10000),
      Math.floor(r() * 0x10000),
      Math.floor(r() * 0x10000),
    ];
    callExact(cpu, FUN_28E3C, args);
    scoreNs.renderScore28E3C(ts, args[0]!, args[1]!, args[2]!, args[3]!, args[4]!, args[5]!, {
      numberFormatter: () => inc(ts, SENT_FMT),
      trimTrailingSpace: () => inc(ts, SENT_TRIM),
      renderStringEntry28F62: () => inc(ts, SENT_RENDER),
    });

    let match = true;
    for (const sent of [SENT_FMT, SENT_TRIM, SENT_RENDER]) {
      const bin = peekMem(cpu, sent, 1) & 0xff;
      const tsv = ts.workRam[sent - WORK] ?? 0;
      if (bin !== tsv) {
        firstFail ??= { caseNo: i, sent, bin, ts: tsv, selector };
        match = false;
      }
    }
    if (match) ok++;
  }
  console.log(`\n=== renderScore28E3C (FUN_28E3C) — ${n} casi ===`);
  console.log(`  Match: ${ok}/${n} = ${((ok / n) * 100).toFixed(1)}%`);
  if (firstFail) console.log(`  First fail: ${JSON.stringify(firstFail)}`);
  disposeCpu(cpu);
  exit(ok === n ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  exit(1);
});
