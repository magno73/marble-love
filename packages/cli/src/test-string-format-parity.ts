#!/usr/bin/env node
/**
 * test-string-format-parity.ts — differential FUN_3A08 vs formatHex.
 *
 * Per N (value, bufEnd, numDigits, showSpaces) random:
 *   1. Reset 64 byte di scratch
 *   2. callFunction(0x3A08, [value, bufEnd, numDigits, showSpaces])
 *   3. formatHex TS sullo stesso state
 *   4. Confronta scratch byte-by-byte
 *
 * Uso: npx tsx packages/cli/src/test-string-format-parity.ts [N]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import { state as stateNs, stringFormat, bus as busNs } from "@marble-love/engine";
import type { RomImage } from "@marble-love/engine";
import {
  createCpu,
  pokeMem,
  peekMem,
  disposeCpu,
} from "./binary-oracle-lib.js";
import type { CpuSession } from "./binary-oracle-lib.js";

const FUN_FORMAT_HEX = 0x00003a08;
const FUN_SET_ALPHA_TILE = 0x00003784;
const FUN_STRCPY = 0x00001d74;
const SENTINEL = 0xCAFEBABE >>> 0;

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) >>> 0;
    return ((s >>> 16) & 0xffff) / 0x10000;
  };
}

/** Call FUN_3A08 con 4 long args (cdecl 68k). */
function callFormatHex(
  cpu: CpuSession,
  value: number,
  bufEnd: number,
  numDigits: number,
  showSpaces: number,
): void {
  const sys = cpu.system;
  let sp = sys.getRegisters().sp;
  // Push RTL: showSpaces, numDigits, bufEnd, value
  sp = (sp - 4) >>> 0; sys.write(sp, 4, showSpaces >>> 0);
  sp = (sp - 4) >>> 0; sys.write(sp, 4, numDigits >>> 0);
  sp = (sp - 4) >>> 0; sys.write(sp, 4, bufEnd >>> 0);
  sp = (sp - 4) >>> 0; sys.write(sp, 4, value >>> 0);
  sp = (sp - 4) >>> 0; sys.write(sp, 4, SENTINEL);
  sys.setRegister("sp", sp);
  sys.setRegister("pc", FUN_FORMAT_HEX);
  for (let i = 0; i < 20_000; i++) {
    if (sys.getRegisters().pc === SENTINEL) break;
    sys.step();
  }
  // Pop sentinel + 16 byte (4 long args)
  sys.setRegister("sp", (sys.getRegisters().sp + 4 + 16) >>> 0);
}

async function main(): Promise<void> {
  const n = Number(process.argv[2] ?? "300");

  const romPath = resolve("ghidra_project/marble_program.bin");
  if (!existsSync(romPath)) {
    console.error(`error: ROM blob not found at ${romPath}`);
    exit(3);
  }
  const rom = readFileSync(romPath);

  const state = stateNs.emptyGameState();
  const cpu = await createCpu({ rom, state });

  console.log(`\n=== formatHex (FUN_3A08) — ${n} casi ===`);

  const rng = makeRng(0xface);
  const SCRATCH_ADDR = 0x401d00;
  const SCRATCH_SIZE = 0x40; // 64 byte
  let ok = 0;
  let firstFail: { value: number; bufEnd: number; numDigits: number; showSpaces: number; offset: number; bin: number; ts: number } | null = null;

  for (let i = 0; i < n; i++) {
    cpu.system.setRegister("sp", 0x401f00);

    // Random params
    const value = Math.floor(rng() * 0x100000000) >>> 0;
    const numDigits = 1 + Math.floor(rng() * 8); // 1..8
    const showSpaces = rng() < 0.5 ? 0 : 1;
    const offset = Math.floor(rng() * (SCRATCH_SIZE - numDigits - 2));
    const bufEnd = SCRATCH_ADDR + offset;

    // Fill scratch with sentinel 0x55
    for (let j = 0; j < SCRATCH_SIZE; j++) {
      pokeMem(cpu, SCRATCH_ADDR + j, 1, 0x55);
      state.workRam[(SCRATCH_ADDR - 0x400000) + j] = 0x55;
    }

    callFormatHex(cpu, value, bufEnd, numDigits, showSpaces);
    stringFormat.formatHex(state, value, bufEnd, numDigits, showSpaces);

    let m = true;
    for (let j = 0; j < SCRATCH_SIZE; j++) {
      const b = peekMem(cpu, SCRATCH_ADDR + j, 1);
      const t = state.workRam[(SCRATCH_ADDR - 0x400000) + j] ?? 0;
      if (b !== t) {
        m = false;
        if (firstFail === null) firstFail = {
          value, bufEnd, numDigits, showSpaces, offset: j, bin: b, ts: t,
        };
        break;
      }
    }
    if (m) ok++;
  }
  console.log(`  Match: ${ok}/${n} = ${((ok / n) * 100).toFixed(1)}%`);
  if (firstFail) {
    const { value, bufEnd, numDigits, showSpaces, offset, bin, ts } = firstFail;
    console.log(`  First fail: value=0x${value.toString(16)} bufEnd=0x${bufEnd.toString(16)} digits=${numDigits} showSp=${showSpaces}`);
    console.log(`    diff at scratch offset 0x${offset.toString(16)}: bin=0x${bin.toString(16)} ts=0x${ts.toString(16)}`);
  }

  // ─── setAlphaTile (FUN_3784) ─────────────────────────────────────────
  console.log(`\n=== setAlphaTile (FUN_3784) — ${n} casi ===`);
  // Build RomImage for TS (need rom.program)
  const tsRom: RomImage = busNs.emptyRomImage();
  tsRom.program.set(rom.subarray(0, tsRom.program.length));

  let ok2 = 0;
  let firstFail2: { args: number[]; binWord: number; tsWord: number; addr: number } | null = null;
  for (let i = 0; i < n; i++) {
    cpu.system.setRegister("sp", 0x401f00);

    // Random args. arg1 byte (col), arg2 byte (row), arg3 word (attrs), arg4 word (tile).
    const arg1 = Math.floor(rng() * 256) & 0xff;
    const arg2 = Math.floor(rng() * 0x29) & 0xff; // 0..40 to keep in alpha bounds
    const arg3 = Math.floor(rng() * 0x10000) & 0xffff;
    const arg4 = Math.floor(rng() * 0x10000) & 0xffff;
    // Random rotation flag (50% set vs not)
    const rotFlag = rng() < 0.5 ? 0 : (1 + Math.floor(rng() * 4));

    pokeMem(cpu, 0x401f42, 2, rotFlag);
    state.workRam[0x1f42] = (rotFlag >>> 8) & 0xff;
    state.workRam[0x1f43] = rotFlag & 0xff;

    // Clear alpha RAM scratch (entire 4KB)
    for (let j = 0; j < 0x1000; j += 2) {
      pokeMem(cpu, 0xa03000 + j, 2, 0);
      state.alphaRam[j] = 0;
      state.alphaRam[j + 1] = 0;
    }

    // Call binary (4 long args)
    const sys = cpu.system;
    let sp = sys.getRegisters().sp;
    sp = (sp - 4) >>> 0; sys.write(sp, 4, arg4 >>> 0);
    sp = (sp - 4) >>> 0; sys.write(sp, 4, arg3 >>> 0);
    sp = (sp - 4) >>> 0; sys.write(sp, 4, arg2 >>> 0);
    sp = (sp - 4) >>> 0; sys.write(sp, 4, arg1 >>> 0);
    sp = (sp - 4) >>> 0; sys.write(sp, 4, SENTINEL);
    sys.setRegister("sp", sp);
    sys.setRegister("pc", FUN_SET_ALPHA_TILE);
    for (let k = 0; k < 1000; k++) {
      if (sys.getRegisters().pc === SENTINEL) break;
      sys.step();
    }
    sys.setRegister("sp", (sys.getRegisters().sp + 4 + 16) >>> 0);

    // Run TS
    stringFormat.setAlphaTile(state, tsRom, arg1, arg2, arg3, arg4);

    // Compare alpha RAM (only check the area where binary wrote)
    let m = true;
    let firstDiffOffset = -1;
    for (let j = 0; j < 0x1000; j++) {
      const b = peekMem(cpu, 0xa03000 + j, 1);
      const t = state.alphaRam[j] ?? 0;
      if (b !== t) {
        m = false;
        if (firstDiffOffset === -1) firstDiffOffset = j;
        break;
      }
    }

    if (m) ok2++;
    else if (firstFail2 === null) {
      const wordOffset = firstDiffOffset & ~1;
      const binWord = peekMem(cpu, 0xa03000 + wordOffset, 2);
      const tsWord = ((state.alphaRam[wordOffset] ?? 0) << 8) | (state.alphaRam[wordOffset + 1] ?? 0);
      firstFail2 = { args: [arg1, arg2, arg3, arg4, rotFlag], binWord, tsWord, addr: 0xa03000 + wordOffset };
    }
  }
  console.log(`  Match: ${ok2}/${n} = ${((ok2 / n) * 100).toFixed(1)}%`);
  if (firstFail2) {
    const { args, binWord, tsWord, addr } = firstFail2;
    console.log(`  First fail: arg1=0x${args[0]!.toString(16)} arg2=0x${args[1]!.toString(16)} arg3=0x${args[2]!.toString(16)} arg4=0x${args[3]!.toString(16)} rotFlag=${args[4]}`);
    console.log(`    @ alpha 0x${addr.toString(16)}: bin=0x${binWord.toString(16)} ts=0x${tsWord.toString(16)}`);
  }

  // ─── strcpy (FUN_1D74) ────────────────────────────────────────────────
  console.log(`\n=== strcpy (FUN_1D74) — ${n} casi ===`);

  let ok3 = 0;
  let firstFail3: { srcLen: number; offset: number; bin: number; ts: number } | null = null;

  for (let i = 0; i < n; i++) {
    cpu.system.setRegister("sp", 0x401f00);

    // Random length 0..62; random src/dst offsets
    const srcLen = Math.floor(rng() * 63);
    const srcOff = Math.floor(rng() * (SCRATCH_SIZE - srcLen - 1));
    const dstOff = Math.floor(rng() * (SCRATCH_SIZE - srcLen - 1));
    const SRC_BASE = 0x401D00;
    const DST_BASE = 0x401D80; // 128 byte separati per evitare overlap totale
    const srcAddr = SRC_BASE + srcOff;
    const dstAddr = DST_BASE + dstOff;

    // Fill SRC area with random non-zero bytes + null at end, DST with sentinel 0x77
    for (let j = 0; j < SCRATCH_SIZE; j++) {
      // src side
      const srcRel = j;
      let srcByte = 0x77;
      if (srcRel >= srcOff && srcRel < srcOff + srcLen) {
        srcByte = 1 + Math.floor(rng() * 254); // 1..254 (no NUL)
      } else if (srcRel === srcOff + srcLen) {
        srcByte = 0; // null terminator
      }
      pokeMem(cpu, SRC_BASE + j, 1, srcByte);
      state.workRam[(SRC_BASE - 0x400000) + j] = srcByte;
      // dst side
      pokeMem(cpu, DST_BASE + j, 1, 0x77);
      state.workRam[(DST_BASE - 0x400000) + j] = 0x77;
    }

    // Call binary: strcpy(dst, src) — 2 long args
    const sys = cpu.system;
    let sp = sys.getRegisters().sp;
    sp = (sp - 4) >>> 0; sys.write(sp, 4, srcAddr >>> 0);
    sp = (sp - 4) >>> 0; sys.write(sp, 4, dstAddr >>> 0);
    sp = (sp - 4) >>> 0; sys.write(sp, 4, SENTINEL);
    sys.setRegister("sp", sp);
    sys.setRegister("pc", FUN_STRCPY);
    for (let k = 0; k < 100_000; k++) {
      if (sys.getRegisters().pc === SENTINEL) break;
      sys.step();
    }
    sys.setRegister("sp", (sys.getRegisters().sp + 4 + 8) >>> 0);

    // Run TS (no rom needed: src in workRam)
    stringFormat.strcpy(state, null, dstAddr, srcAddr);

    let m = true;
    for (let j = 0; j < SCRATCH_SIZE; j++) {
      const b = peekMem(cpu, DST_BASE + j, 1);
      const t = state.workRam[(DST_BASE - 0x400000) + j] ?? 0;
      if (b !== t) {
        m = false;
        if (firstFail3 === null) firstFail3 = { srcLen, offset: j, bin: b, ts: t };
        break;
      }
    }
    if (m) ok3++;
  }
  console.log(`  Match: ${ok3}/${n} = ${((ok3 / n) * 100).toFixed(1)}%`);
  if (firstFail3) {
    const { srcLen, offset, bin, ts } = firstFail3;
    console.log(`  First fail: srcLen=${srcLen}`);
    console.log(`    diff at dst offset 0x${offset.toString(16)}: bin=0x${bin.toString(16)} ts=0x${ts.toString(16)}`);
  }

  disposeCpu(cpu);
  exit((ok === n && ok2 === n && ok3 === n) ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  exit(1);
});
