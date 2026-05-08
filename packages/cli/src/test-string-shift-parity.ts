#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import { state as stateNs, stringShift, bus as busNs } from "@marble-love/engine";
import type { RomImage } from "@marble-love/engine";
import { createCpu, callFunction, pokeMem, peekMem, disposeCpu } from "./binary-oracle-lib.js";

const FUN_FORWARD = 0x00002766;
const FUN_BACKWARD = 0x00002818;

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

  const STRUCT = 0x00401D00, STRING_ADDR = 0x00401D40;
  const r = rng(0xfaaa);

  function runSuite(_label: string, funAddr: number, tsFn: (s: any, r: any, ptr: number) => void): { ok: number; fail: any } {
    let ok = 0;
    let firstFail: any = null;
    for (let i = 0; i < n; i++) {
      cpu.system.setRegister("sp", 0x401f00);
      const rot = Math.floor(r() * 8);
      const tickOff = Math.floor(r() * 16);
      const col = Math.floor(r() * 32);

      pokeMem(cpu, 0x00401F00, 2, 0);
      pokeMem(cpu, 0x00401F42, 2, rot);
      stateInst.workRam[0x1F00] = 0; stateInst.workRam[0x1F01] = 0;
      stateInst.workRam[0x1F42] = 0; stateInst.workRam[0x1F43] = rot;

      pokeMem(cpu, STRUCT + 0, 1, col);
      pokeMem(cpu, STRUCT + 1, 1, tickOff);
      pokeMem(cpu, STRUCT + 2, 4, STRING_ADDR);
      pokeMem(cpu, STRUCT + 6, 1, 0);
      pokeMem(cpu, STRUCT + 8, 4, 0);
      stateInst.workRam[0x1D00] = col; stateInst.workRam[0x1D01] = tickOff;
      stateInst.workRam[0x1D02] = 0; stateInst.workRam[0x1D03] = 0x40;
      stateInst.workRam[0x1D04] = 0x1D; stateInst.workRam[0x1D05] = 0x40;
      stateInst.workRam[0x1D06] = 0; stateInst.workRam[0x1D07] = 0;
      stateInst.workRam[0x1D08] = 0; stateInst.workRam[0x1D09] = 0;
      stateInst.workRam[0x1D0A] = 0; stateInst.workRam[0x1D0B] = 0;

      // Empty string (just to drive chain end via marker check)
      pokeMem(cpu, STRING_ADDR, 1, 0);
      stateInst.workRam[(STRING_ADDR - 0x400000)] = 0;

      // Pre-fill alpha with random bytes
      for (let j = 0; j < 0x1000; j++) {
        const v = Math.floor(r() * 256) & 0xff;
        pokeMem(cpu, 0xa03000 + j, 1, v);
        stateInst.alphaRam[j] = v;
      }

      callFunction(cpu, funAddr, [STRUCT]);
      tsFn(stateInst, tsRom, STRUCT);

      let m = true;
      for (let j = 0; j < 0x1000; j++) {
        if (peekMem(cpu, 0xa03000 + j, 1) !== (stateInst.alphaRam[j] ?? 0)) {
          m = false;
          if (firstFail === null) firstFail = { case: i, offset: j, rot, tickOff, col };
          break;
        }
      }
      if (m) ok++;
    }
    return { ok, fail: firstFail };
  }

  console.log(`\n=== shiftStringChainForward (FUN_2766) — ${n} casi ===`);
  const a = runSuite("forward", FUN_FORWARD, stringShift.shiftStringChainForward);
  console.log(`  Match: ${a.ok}/${n} = ${((a.ok/n)*100).toFixed(1)}%`);
  if (a.fail) console.log(`  First fail: ${JSON.stringify(a.fail)}`);

  console.log(`\n=== shiftStringChainBackward (FUN_2818) — ${n} casi ===`);
  const b = runSuite("backward", FUN_BACKWARD, stringShift.shiftStringChainBackward);
  console.log(`  Match: ${b.ok}/${n} = ${((b.ok/n)*100).toFixed(1)}%`);
  if (b.fail) console.log(`  First fail: ${JSON.stringify(b.fail)}`);

  disposeCpu(cpu);
  exit((a.ok === n && b.ok === n) ? 0 : 1);
}

main().catch(e => { console.error(e); exit(1); });
