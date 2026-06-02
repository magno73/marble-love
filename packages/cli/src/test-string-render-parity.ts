#!/usr/bin/env node
/**
 * test-string-render-parity.ts — differential FUN_2572 vs renderStringChain.
 *
 * 262 byte pure leaf. Setup:
 *   - Linked list of entry in workRam scratch
 *   - String terminated by 0
 *   - Globals @ 0x401F00, 0x401F3A, 0x401F42 random
 *   - attr word random
 *
 * Output: 4 KB of written alpha RAM plus verification.
 *
 * Usage: npx tsx packages/cli/src/test-string-render-parity.ts [N]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import { state as stateNs, stringRender, bus as busNs } from "@marble-love/engine";
import type { RomImage } from "@marble-love/engine";
import {
  createCpu,
  callFunction,
  pokeMem,
  peekMem,
  disposeCpu,
} from "./binary-oracle-lib.js";

const FUN_RENDER = 0x00002572;

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) >>> 0;
    return ((s >>> 16) & 0xffff) / 0x10000;
  };
}

async function main(): Promise<void> {
  const n = Number(process.argv[2] ?? "100");

  const romPath = resolve("ghidra_project/marble_program.bin");
  if (!existsSync(romPath)) {
    console.error(`error: ROM blob not found at ${romPath}`);
    exit(3);
  }
  const rom = readFileSync(romPath);

  const stateInst = stateNs.emptyGameState();
  const cpu = await createCpu({ rom, state: stateInst });

  const tsRom: RomImage = busNs.emptyRomImage();
  tsRom.program.set(rom.subarray(0, tsRom.program.length));

  console.log(`\n=== renderStringChain (FUN_2572) — ${n} cases ===`);

  const rng = makeRng(0x5aff);
  const STRUCT_ADDR = 0x00401D00; // entry 1
  const STRING_ADDR = 0x00401D40; // string scratch (8+ chars)

  let ok = 0;
  let firstFail: { case: number; offset: number; bin: number; ts: number } | null = null;

  for (let i = 0; i < n; i++) {
    cpu.system.setRegister("sp", 0x401f00);

    // valF00 = 0 guarantees immediate chain end (marker=0 + valF00=0 = sum 0 <= 1).
    // Without this, the chain advance walks random memory.
    const valF00 = 0;
    const tick = Math.floor(rng() * 0x10000) & 0xffff;
    const rotation = Math.floor(rng() * 8) & 0xffff; // rotation 0..7
    const attr = Math.floor(rng() * 0x10000) & 0xffff;
    pokeMem(cpu, 0x00401F00, 2, valF00);
    pokeMem(cpu, 0x00401F3A, 2, tick);
    pokeMem(cpu, 0x00401F42, 2, rotation);
    stateInst.workRam[0x1F00] = (valF00 >>> 8) & 0xff;
    stateInst.workRam[0x1F01] = valF00 & 0xff;
    stateInst.workRam[0x1F3A] = (tick >>> 8) & 0xff;
    stateInst.workRam[0x1F3B] = tick & 0xff;
    stateInst.workRam[0x1F42] = (rotation >>> 8) & 0xff;
    stateInst.workRam[0x1F43] = rotation & 0xff;

    // Setup entry struct @ STRUCT_ADDR (single entry, marker forces exit)
    // +0  byte: col
    // +1  byte: tickOffset
    // +2  long: stringPtr → STRING_ADDR
    // +6  byte: marker (= 0 to force exit immediately, since marker + valF00 <= 1)
    // +8  long: next ptr (irrelevant since we exit)
    const col = Math.floor(rng() * 32) & 0xff;          // small col
    const tickOff = (tick & 0xff);                       // make it likely "due"
    const marker = 0;                                    // chain end signal (with valF00 logic)
    pokeMem(cpu, STRUCT_ADDR + 0, 1, col);
    pokeMem(cpu, STRUCT_ADDR + 1, 1, tickOff);
    pokeMem(cpu, STRUCT_ADDR + 2, 4, STRING_ADDR);
    pokeMem(cpu, STRUCT_ADDR + 6, 1, marker);
    pokeMem(cpu, STRUCT_ADDR + 8, 4, 0); // next null
    stateInst.workRam[(STRUCT_ADDR - 0x400000) + 0] = col;
    stateInst.workRam[(STRUCT_ADDR - 0x400000) + 1] = tickOff;
    stateInst.workRam[(STRUCT_ADDR - 0x400000) + 2] = (STRING_ADDR >>> 24) & 0xff;
    stateInst.workRam[(STRUCT_ADDR - 0x400000) + 3] = (STRING_ADDR >>> 16) & 0xff;
    stateInst.workRam[(STRUCT_ADDR - 0x400000) + 4] = (STRING_ADDR >>> 8) & 0xff;
    stateInst.workRam[(STRUCT_ADDR - 0x400000) + 5] = STRING_ADDR & 0xff;
    stateInst.workRam[(STRUCT_ADDR - 0x400000) + 6] = marker;
    stateInst.workRam[(STRUCT_ADDR - 0x400000) + 7] = 0;
    stateInst.workRam[(STRUCT_ADDR - 0x400000) + 8] = 0;
    stateInst.workRam[(STRUCT_ADDR - 0x400000) + 9] = 0;
    stateInst.workRam[(STRUCT_ADDR - 0x400000) + 10] = 0;
    stateInst.workRam[(STRUCT_ADDR - 0x400000) + 11] = 0;

    // Setup string @ STRING_ADDR (5..10 random chars + null)
    const slen = 5 + Math.floor(rng() * 6);
    const strBytes: number[] = [];
    for (let j = 0; j < slen; j++) {
      // Mix of space, A-Z, lowercase, etc.
      const r = rng();
      let c: number;
      if (r < 0.2) c = 0x20;                                  // space
      else if (r < 0.7) c = 0x41 + Math.floor(rng() * 26);   // A-Z
      else c = 0x61 + Math.floor(rng() * 26);                // a-z
      strBytes.push(c & 0xff);
    }
    strBytes.push(0); // null terminator
    for (let j = 0; j < strBytes.length; j++) {
      pokeMem(cpu, STRING_ADDR + j, 1, strBytes[j] ?? 0);
      stateInst.workRam[(STRING_ADDR - 0x400000) + j] = strBytes[j] ?? 0;
    }

    // Reset alpha RAM (4 KB)
    for (let j = 0; j < 0x1000; j++) {
      pokeMem(cpu, 0xa03000 + j, 1, 0);
      stateInst.alphaRam[j] = 0;
    }

    // RUN BINARY (cdecl: 2 long args = structAddr, attrAsLong)
    callFunction(cpu, FUN_RENDER, [STRUCT_ADDR, attr]);

    // RUN TS
    stringRender.renderStringChain(stateInst, tsRom, STRUCT_ADDR, attr);

    // COMPARE alpha RAM (4KB)
    let matched = true;
    for (let j = 0; j < 0x1000; j++) {
      const b = peekMem(cpu, 0xa03000 + j, 1);
      const t = stateInst.alphaRam[j] ?? 0;
      if (b !== t) {
        matched = false;
        if (firstFail === null) {
          firstFail = { case: i, offset: j, bin: b, ts: t };
        }
        break;
      }
    }
    if (matched) ok++;
  }

  console.log(`  Match: ${ok}/${n} = ${((ok / n) * 100).toFixed(1)}%`);
  if (firstFail) {
    const { case: c, offset, bin, ts } = firstFail;
    console.log(`  First fail: case ${c} @ alpha+0x${offset.toString(16)}: bin=0x${bin.toString(16)} ts=0x${ts.toString(16)}`);
    // Dump alpha[0..end] difference range around offset
    const start = Math.max(0, offset - 8);
    const end = Math.min(0x1000, offset + 16);
    let row = `  bin: `;
    for (let k = start; k < end; k++) row += peekMem(cpu, 0xa03000 + k, 1).toString(16).padStart(2, "0") + " ";
    console.log(row);
    row = `  ts:  `;
    for (let k = start; k < end; k++) row += (stateInst.alphaRam[k] ?? 0).toString(16).padStart(2, "0") + " ";
    console.log(row);
  }

  disposeCpu(cpu);
  exit(ok === n ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  exit(1);
});
