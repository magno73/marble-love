#!/usr/bin/env node
/**
 * test-game-main-gate-parity.ts — differential FUN_28972 vs gameMainGate.
 *
 *   - FUN_2893C (debounce): replicato inline in TS
 *   - FUN_28D02 (control callback): patched a immediate `rts`
 *
 * potential infinite `bra .`. To avoid hang/spin in tests, set:
 *
 *   - workRam @ 0x4003A8, 0x4003AA, 0x4003AC (debounce state)
 *   - workRam @ 0x400390 (game state word)
 *   - workRam @ 0x400396 (object count word)
 *
 * Uso: npx tsx packages/cli/src/test-game-main-gate-parity.ts [N]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import { state as stateNs, gameMainGate as gateModule } from "@marble-love/engine";
import {
  createCpu,
  callFunction,
  pokeMem,
  peekMem,
  disposeCpu,
} from "./binary-oracle-lib.js";
import type { CpuSession } from "./binary-oracle-lib.js";

const FUN_MAIN_GATE = 0x00028972;
const FUN_GATE_CHECK = 0x000001cc; // → FUN_472A (jmp). Patch a `moveq #1,D0; rts`
const FUN_CONTROL = 0x00028d02;    // patch a `rts`

const MMIO_INPUT_ADDR = 0xf60001;

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) >>> 0;
    return ((s >>> 16) & 0xffff) / 0x10000;
  };
}

function patchBinary(cpu: CpuSession): void {
  // FUN_01CC: replace `jmp 0x472A.l` (4E F9 00 00 47 2A) with
  //   moveq #1, D0  (70 01)
  //   rts            (4E 75)
  //   ... (remaining 2 bytes unreachable, leave as-is)
  pokeMem(cpu, FUN_GATE_CHECK + 0, 1, 0x70);
  pokeMem(cpu, FUN_GATE_CHECK + 1, 1, 0x01);
  pokeMem(cpu, FUN_GATE_CHECK + 2, 1, 0x4e);
  pokeMem(cpu, FUN_GATE_CHECK + 3, 1, 0x75);
  // FUN_28D02: replace first 2 bytes with `rts` (4E 75)
  pokeMem(cpu, FUN_CONTROL + 0, 1, 0x4e);
  pokeMem(cpu, FUN_CONTROL + 1, 1, 0x75);

  // wait_loop @ 0x28A22: change `bne.b +8` (66 08) → `bra.b +8` (60 08).
  pokeMem(cpu, 0x28a22, 1, 0x60);
}

async function main(): Promise<void> {
  const n = Number(process.argv[2] ?? "200");

  const romPath = resolve("ghidra_project/marble_program.bin");
  if (!existsSync(romPath)) {
    console.error(`error: ROM blob not found at ${romPath}`);
    exit(3);
  }
  const rom = readFileSync(romPath);

  const stateInst = stateNs.emptyGameState();
  const cpu = await createCpu({ rom, state: stateInst });
  patchBinary(cpu);

  const rng = makeRng(0xa1ce);

  // gateCheck stub matching the patched binary (always returns 1)
  const gateCheck = (_arg: number): number => 1;

  function runOneCase(
    setup: () => { mmioInput: number },
    extraFields: [string, number, number][] = [],
  ): { matched: boolean; firstFail: { field: string; addr: number; bin: number; ts: number } | null } {
    cpu.system.setRegister("sp", 0x401f00);

    // Generic state randomizer (avoid both bits 0+1 of *0x4003AA → no hang)
    const prevInput = Math.floor(rng() * 256) & 0xff;
    let debounced = Math.floor(rng() * 256) & 0xff;
    // Force at least one of bits 0/1 to 0 to avoid pause-hang
    if ((debounced & 0x03) === 0x03) debounced &= ~0x01;
    const fallingEdges = Math.floor(rng() * 256) & 0xff;
    const gameStateWord = rng() < 0.5 ? 1 : Math.floor(rng() * 0x10000) & 0xffff;
    const objCount = Math.floor(rng() * 0x10000) & 0xffff;

    pokeMem(cpu, 0x4003a8, 1, prevInput);
    pokeMem(cpu, 0x4003aa, 1, debounced);
    pokeMem(cpu, 0x4003ac, 1, fallingEdges);
    pokeMem(cpu, 0x400390, 2, gameStateWord);
    pokeMem(cpu, 0x400396, 2, objCount);
    stateInst.workRam[0x3a8] = prevInput;
    stateInst.workRam[0x3aa] = debounced;
    stateInst.workRam[0x3ac] = fallingEdges;
    stateInst.workRam[0x390] = (gameStateWord >>> 8) & 0xff;
    stateInst.workRam[0x391] = gameStateWord & 0xff;
    stateInst.workRam[0x396] = (objCount >>> 8) & 0xff;
    stateInst.workRam[0x397] = objCount & 0xff;

    const { mmioInput } = setup();

    pokeMem(cpu, MMIO_INPUT_ADDR, 1, mmioInput);

    callFunction(cpu, FUN_MAIN_GATE, []);
    gateModule.gameMainGate(stateInst, { mmioInput, gateCheck });

    const baseFields: [string, number, number][] = [
      ["prevInput", 0x4003a8, 0x3a8],
      ["debounced", 0x4003aa, 0x3aa],
      ["fallingEdges", 0x4003ac, 0x3ac],
      ["gameState_hi", 0x400390, 0x390],
      ["gameState_lo", 0x400391, 0x391],
      ["count_hi", 0x400396, 0x396],
      ["count_lo", 0x400397, 0x397],
    ];
    for (const f of [...baseFields, ...extraFields]) {
      const [name, abs, off] = f;
      const b = peekMem(cpu, abs, 1);
      const t = stateInst.workRam[off] ?? 0;
      if (b !== t) return { matched: false, firstFail: { field: name, addr: abs, bin: b, ts: t } };
    }
    return { matched: true, firstFail: null };
  }

  // ─── Suite A: MMIO bit 6 = 1 (early exit, only Block A/B) ─────────────
  console.log(`\n=== gameMainGate (FUN_28972) — Suite A: MMIO bit 6 = 1 — ${n} casi ===`);
  let okA = 0;
  let failA: { case: number; field: string; addr: number; bin: number; ts: number } | null = null;
  for (let i = 0; i < n; i++) {
    const { matched, firstFail } = runOneCase(() => ({
      mmioInput: 0x40 | (Math.floor(rng() * 256) & 0xff),
    }));
    if (matched) okA++;
    else if (failA === null && firstFail) failA = { case: i, ...firstFail };
  }
  console.log(`  Match: ${okA}/${n} = ${((okA / n) * 100).toFixed(1)}%`);
  if (failA) console.log(`  First fail: case ${failA.case}, ${failA.field} @ 0x${failA.addr.toString(16)}: bin=0x${failA.bin.toString(16)} ts=0x${failA.ts.toString(16)}`);

  // ─── Suite B: MMIO bit 6 = 0 (Block C entry, spin patched) ───────────
  // Setup: ensure obj[0] e obj[1] hanno state non-0 e non-2 per esercitare il
  console.log(`\n=== gameMainGate (FUN_28972) — Suite B: MMIO bit 6 = 0 — ${n} casi ===`);
  let okB = 0;
  let failB: { case: number; field: string; addr: number; bin: number; ts: number } | null = null;
  for (let i = 0; i < n; i++) {
    // Random obj setup for both objects
    for (let j = 0; j < 2; j++) {
      const objAddr = 0x400018 + j * 0xe2;
      const objOff = objAddr - 0x400000;
      const stateByte = Math.floor(rng() * 6) & 0xff;
      const outer = Math.floor(rng() * 0x200) & 0xffff; // 0..511 to test clamp at 0x168
      pokeMem(cpu, objAddr + 0x18, 1, stateByte);
      pokeMem(cpu, objAddr + 0x6a, 1, (outer >>> 8) & 0xff);
      pokeMem(cpu, objAddr + 0x6b, 1, outer & 0xff);
      stateInst.workRam[objOff + 0x18] = stateByte;
      stateInst.workRam[objOff + 0x6a] = (outer >>> 8) & 0xff;
      stateInst.workRam[objOff + 0x6b] = outer & 0xff;
    }
    // Reset *0x4003B2
    pokeMem(cpu, 0x4003b2, 1, 0);
    stateInst.workRam[0x3b2] = 0;

    const extraFields: [string, number, number][] = [
      ["control_3b2", 0x4003b2, 0x3b2],
      ["obj0_state", 0x400030, 0x30], // 0x400018 + 0x18
      ["obj0_t_hi", 0x400082, 0x82],   // 0x400018 + 0x6a
      ["obj0_t_lo", 0x400083, 0x83],
      ["obj1_state", 0x400112, 0x112], // 0x400018 + 0xE2 + 0x18 = 0x400112
      ["obj1_t_hi", 0x400164, 0x164],
      ["obj1_t_lo", 0x400165, 0x165],
    ];

    const { matched, firstFail } = runOneCase(
      () => ({
        mmioInput: Math.floor(rng() * 256) & 0xbf, // bit 6 always 0
      }),
      extraFields,
    );
    if (matched) okB++;
    else if (failB === null && firstFail) failB = { case: i, ...firstFail };
  }
  console.log(`  Match: ${okB}/${n} = ${((okB / n) * 100).toFixed(1)}%`);
  if (failB) console.log(`  First fail: case ${failB.case}, ${failB.field} @ 0x${failB.addr.toString(16)}: bin=0x${failB.bin.toString(16)} ts=0x${failB.ts.toString(16)}`);

  disposeCpu(cpu);
  exit((okA === n && okB === n) ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  exit(1);
});
