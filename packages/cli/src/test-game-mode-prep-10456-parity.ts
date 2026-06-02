#!/usr/bin/env node
/**
 * test-game-mode-prep-10456-parity.ts — differential FUN_10456 vs gameModePrep10456.
 *
 *
 * Uso:
 *   bun packages/cli/src/test-game-mode-prep-10456-parity.ts [N=500]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import { bus as busNs, state as stateNs, gameModePrep10456 as prep10456Ns } from "@marble-love/engine";
import { callFunction, createCpu, disposeCpu, peekMem, pokeMem } from "./binary-oracle-lib.js";

const FUN_10456 = 0x00010456;
const WRAM_BASE = busNs.WORK_RAM_BASE;
const WRAM_SIZE = busNs.WORK_RAM_END - busNs.WORK_RAM_BASE;

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
    resolve("../../marble-love/ghidra_project/marble_program.bin"),
    resolve("../../../ghidra_project/marble_program.bin"),
  ].filter((p): p is string => p !== undefined && p.length > 0);
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  throw new Error(
    "ROM blob not found; set MARBLE_ROM_BLOB or keep ghidra_project/marble_program.bin in the repo.",
  );
}

/** Write a byte to both the binary CPU memory and the TS workRam. */
function writeBothByte(
  cpu: Awaited<ReturnType<typeof createCpu>>,
  state: ReturnType<typeof stateNs.emptyGameState>,
  addr: number,
  value: number,
): void {
  const v = value & 0xff;
  pokeMem(cpu, addr, 1, v);
  if (addr >= WRAM_BASE && addr < WRAM_BASE + WRAM_SIZE) {
    state.workRam[addr - WRAM_BASE] = v;
  }
}

/** Write a word to both CPU and TS state. */
function writeBothWord(
  cpu: Awaited<ReturnType<typeof createCpu>>,
  state: ReturnType<typeof stateNs.emptyGameState>,
  addr: number,
  value: number,
): void {
  const hi = (value >>> 8) & 0xff;
  const lo = value & 0xff;
  pokeMem(cpu, addr, 2, value & 0xffff);
  if (addr >= WRAM_BASE && addr < WRAM_BASE + WRAM_SIZE) {
    state.workRam[addr - WRAM_BASE] = hi;
    state.workRam[addr - WRAM_BASE + 1] = lo;
  }
}

async function main(): Promise<void> {
  const n = Number(process.argv[2] ?? "500");
  const rom = readFileSync(findRomBlobPath());

  const stateInst = stateNs.emptyGameState();
  const cpu = await createCpu({ rom, state: stateInst });
  const rng = makeRng(0x10456);

  let ok = 0;
  let firstFail: {
    caseNo: number;
    offset: number;
    bin: number;
    ts: number;
    mode: number;
    dc: number;
  } | null = null;

  for (let i = 0; i < n; i++) {
    cpu.system.setRegister("sp", 0x401f00);

    // Randomise [0x400396].w — player mode (0..3)
    const mode = Math.floor(rng() * 4);
    writeBothWord(cpu, stateInst, 0x00400396, mode);

    // Randomise [0x4003dc].b — source byte for mask op
    const dc = Math.floor(rng() * 256);
    writeBothByte(cpu, stateInst, 0x004003dc, dc);

    // Scatter random noise into regions the function modifies so we detect
    // stale-data false positives. Regions: slot0 (0x400018..0x4000f9),
    // slot1 (0x4000fa..0x4001db), 0x40098c area, globals.
    const noiseAddrs = [
      0x4000d4, 0x4000d5, 0x4000d6, 0x4000d7, // slot0+0xbc
      0x4000ea, 0x4000eb,                       // slot0+0xd2
      0x400030, 0x400031, 0x400032,             // slot0+0x18/0x19/0x1a
      0x4001b6, 0x4001b7, 0x4001b8, 0x4001b9,  // slot1+0xbc
      0x4001cc, 0x4001cd,                       // slot1+0xd2
      0x400112, 0x400113, 0x400114,             // slot1+0x18/0x19/0x1a
      0x400996, 0x4009a2,                       // 0x40098c+0+0xa, +12+0xa
      0x4003a4, 0x4003ba, 0x4003e0,
      0x400010, 0x400011, 0x400012, 0x400013,
      0x4003e8, 0x400398,
      0x400654, 0x400656, 0x400658,
    ];
    for (const addr of noiseAddrs) {
      const v = Math.floor(rng() * 256);
      writeBothByte(cpu, stateInst, addr, v);
    }

    // Run binary
    callFunction(cpu, FUN_10456, []);

    // Run TS
    prep10456Ns.gameModePrep10456(stateInst);

    // Compare work RAM, excluding the stack save area.
    //
    // FUN_00010456 opens with `movem.l d2-d3, -(a7)` which pushes 8 bytes
    // at SP-8..SP-1 = 0x401ef8..0x401eff (SP=0x401f00). Those bytes reflect
    // whatever D2/D3 were at call time and are popped on return — they are an
    // implementation detail of the binary and not part of the logical output.
    // Our TS implementation correctly does not write to the stack.
    const SP = 0x401f00;
    const STACK_SAVE_START = SP - 8; // 0x401ef8
    const STACK_SAVE_END   = SP - 1; // 0x401eff
    const stackOffStart = STACK_SAVE_START - WRAM_BASE; // 0x1ef8
    const stackOffEnd   = STACK_SAVE_END   - WRAM_BASE; // 0x1eff

    let match = true;
    for (let j = 0; j < WRAM_SIZE; j++) {
      // Skip the 8 bytes the binary uses for register save/restore
      if (j >= stackOffStart && j <= stackOffEnd) continue;
      const binVal = peekMem(cpu, WRAM_BASE + j, 1);
      const tsVal = stateInst.workRam[j] ?? 0;
      if (binVal !== tsVal) {
        firstFail ??= { caseNo: i, offset: j, bin: binVal, ts: tsVal, mode, dc };
        match = false;
        break;
      }
    }
    if (match) ok++;

    // Re-sync TS workRam from binary for next iteration (keep them in step)
    const ramSnapshot = cpu.system.readBytes(WRAM_BASE, WRAM_SIZE);
    stateInst.workRam.set(ramSnapshot);
  }

  console.log(`\n=== gameModePrep10456 (FUN_10456) — ${n} cases ===`);
  console.log(`  Match: ${ok}/${n} = ${((ok / n) * 100).toFixed(1)}%`);
  if (firstFail) {
    console.log(`  First fail: ${JSON.stringify(firstFail)}`);
    console.log(`    addr: 0x${(WRAM_BASE + firstFail.offset).toString(16).padStart(8, "0")}`);
  }
  disposeCpu(cpu);
  exit(ok === n ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  exit(1);
});
