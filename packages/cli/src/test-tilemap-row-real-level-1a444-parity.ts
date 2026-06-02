#!/usr/bin/env node
/**
 * test-tilemap-row-real-level-1a444-parity.ts — differential FUN_1A444 vs TS
 * using the real Marble level descriptors after FUN_16EC6 has prepared globals.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import {
  bus as busNs,
  applySlapsticBank,
  levelDispatcher16EC6 as levelNs,
  state as stateNs,
  tilemapRowBuild1A444 as rowNs,
} from "@marble-love/engine";
import { callFunction, createCpu, disposeCpu, peekMem, pokeMem } from "./binary-oracle-lib.js";

const FUN_1A444 = 0x0001a444;
const FUN_2FFB8 = 0x0002ffb8;
const FUN_2BC5C = 0x0002bc5c;
const WORK_RAM_BASE = 0x00400000;
const PF_BASE = 0x00a00000;

function findRomBlobPath(): string {
  const candidates = [
    process.env.MARBLE_ROM_BLOB,
    resolve("ghidra_project/marble_program.bin"),
    resolve("../marble-love/ghidra_project/marble_program.bin"),
  ].filter((p): p is string => p !== undefined && p.length > 0);
  for (const p of candidates) if (existsSync(p)) return p;
  throw new Error("ROM blob not found");
}

function pokeByte(cpu: Awaited<ReturnType<typeof createCpu>>, addr: number, value: number): void {
  pokeMem(cpu, addr, 1, value & 0xff);
}

function syncStateToCpu(cpu: Awaited<ReturnType<typeof createCpu>>, s: ReturnType<typeof stateNs.emptyGameState>): void {
  for (let i = 0; i < s.workRam.length; i++) pokeByte(cpu, WORK_RAM_BASE + i, s.workRam[i] ?? 0);
  for (let i = 0; i < s.playfieldRam.length; i++) pokeByte(cpu, PF_BASE + i, s.playfieldRam[i] ?? 0);
}

function cloneState(src: ReturnType<typeof stateNs.emptyGameState>): ReturnType<typeof stateNs.emptyGameState> {
  const s = stateNs.emptyGameState();
  s.workRam.set(src.workRam);
  s.playfieldRam.set(src.playfieldRam);
  s.spriteRam.set(src.spriteRam);
  s.alphaRam.set(src.alphaRam);
  s.colorRam.set(src.colorRam);
  return s;
}

async function main(): Promise<void> {
  const n = Number(process.argv[2] ?? "6");
  const rom = readFileSync(findRomBlobPath());
  const tsRom = busNs.emptyRomImage();
  applySlapsticBank.loadRomBlob(tsRom, rom);
  const cpuState = stateNs.emptyGameState();
  const cpu = await createCpu({ rom: tsRom.program, state: cpuState });
  for (const addr of [FUN_2FFB8, FUN_2BC5C]) {
    pokeMem(cpu, addr, 1, 0x4e);
    pokeMem(cpu, addr + 1, 1, 0x75);
  }

  let ok = 0;
  let firstFail: { level: number; kind: string; off: number; bin: number; ts: number } | null = null;
  for (let level = 0; level < n; level++) {
    const prep = stateNs.emptyGameState();
    prep.playfieldRam.fill(0);
    prep.workRam[0x394] = (level >>> 8) & 0xff;
    prep.workRam[0x395] = level & 0xff;
    levelNs.levelDispatcher16EC6(prep, tsRom, {
      fun_2ffb8: () => undefined,
      fun_2ff28: () => undefined,
      fun_1a444: () => undefined,
    });

    const ts = cloneState(prep);
    syncStateToCpu(cpu, prep);
    cpu.system.setRegister("sp", 0x401f00);

    const result = callFunction(cpu, FUN_1A444, [], 200_000_000);
    rowNs.buildTilemapRows1A444(ts, tsRom, { fun_2ffb8: () => undefined });

    let match = true;
    let firstPf: { off: number; bin: number; ts: number } | null = null;
    let firstWork: { off: number; bin: number; ts: number } | null = null;
    for (let off = 0; off < 0x2000; off++) {
      const bin = peekMem(cpu, PF_BASE + off, 1);
      const tsByte = ts.playfieldRam[off] ?? 0;
      if (bin !== tsByte) {
        firstPf ??= { off, bin, ts: tsByte };
        firstFail ??= { level, kind: "pf", off, bin, ts: tsByte };
        match = false;
        break;
      }
    }
    for (let off = 0; off < 0x1c48; off++) {
      const bin = peekMem(cpu, WORK_RAM_BASE + off, 1);
      const tsByte = ts.workRam[off] ?? 0;
      if (bin !== tsByte) {
        firstWork ??= { off, bin, ts: tsByte };
        if (match) firstFail ??= { level, kind: "work", off, bin, ts: tsByte };
        match = false;
        break;
      }
    }
    if (!match) {
      let binNz = 0;
      let tsNz = 0;
      for (let off = 0; off < 0x2000; off++) {
        if (peekMem(cpu, PF_BASE + off, 1) !== 0) binNz++;
        if ((ts.playfieldRam[off] ?? 0) !== 0) tsNz++;
      }
      const pfDiffs: Array<{ off: number; bin: number; ts: number }> = [];
      for (let off = 0; off < 0x2000 && pfDiffs.length < 12; off++) {
        const bin = peekMem(cpu, PF_BASE + off, 1);
        const tsByte = ts.playfieldRam[off] ?? 0;
        if (bin !== tsByte) pfDiffs.push({ off, bin, ts: tsByte });
      }
      console.log(
        `  level ${level}: firstPf=${firstPf ? JSON.stringify(firstPf) : "none"} ` +
          `firstWork=${firstWork ? JSON.stringify(firstWork) : "none"} ` +
          `cycles=${result.cycles} pc=0x${cpu.system.getRegisters().pc.toString(16)} binNz=${binNz} tsNz=${tsNz}`,
      );
      console.log(`    pfDiffs=${JSON.stringify(pfDiffs)}`);
    }
    if (match) ok++;
  }

  console.log(`\n=== buildTilemapRows1A444 real levels — ${n} cases ===`);
  console.log(`  Match: ${ok}/${n} = ${((ok / n) * 100).toFixed(1)}%`);
  if (firstFail) console.log(`  First fail: ${JSON.stringify(firstFail)}`);
  disposeCpu(cpu);
  exit(ok === n ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  exit(1);
});
