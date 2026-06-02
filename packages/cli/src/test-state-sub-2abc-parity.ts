#!/usr/bin/env node
/**
 * test-state-sub-2abc-parity.ts — differential FUN_2ABC vs stateSub2ABC.
 *
 * scheduler. Args: 1 long on the stack (`arg1Long` = pointer to struct entry).
 *
 *     `sext(byte@A0+6) + sext(*0x401F00) > 1`.
 *     la corrispondente word in the alpha tilemap @ 0xA03000.
 *
 * Strategia:
 *   - Setup must guarantee valid setup for:
 *       a) `*0x401F42` (rotation, in [0..3] to cover real ROM tables)
 *       b) `*0x401F00` (VAL_F00, signed)
 *       c) struct @ STRUCT_ADDR: with the, tickOff, stringPtr (long), marker,
 *          nextPtr (long)
 *       e) chain of entry (to cover chain-walk)
 *
 * Suite testate:
 *   - C: rot=0..3, single entry with signed with the/tickOff (including negatives)
 *   - D: chain walk: 2-3 entry collegate via marker + nextPtr
 *
 * Uso: npx tsx packages/cli/src/test-state-sub-2abc-parity.ts [N]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import { state as stateNs, stateSub2ABC as sub2abcNs, bus as busNs } from "@marble-love/engine";
import type { RomImage } from "@marble-love/engine";
import {
  createCpu,
  callFunction,
  pokeMem,
  peekMem,
  disposeCpu,
} from "./binary-oracle-lib.js";
import type { CpuSession } from "./binary-oracle-lib.js";

const FUN_2ABC = 0x00002abc;

const ALPHA_BASE = 0xa03000;
const ALPHA_SIZE = 0x1000; // 4 KB

const VAL_F00_ADDR = 0x00401f00;
const ROTATION_ADDR = 0x00401f42;

// Struct/string addresses in workRam (avoid 0x401F00..0x401F3F state struct)
const STRUCT_ADDRS = [0x00401d00, 0x00401d20, 0x00401d40] as const;
const STRING_ADDRS = [0x00401d80, 0x00401da0, 0x00401dc0] as const;

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) >>> 0;
    return ((s >>> 16) & 0xffff) / 0x10000;
  };
}

function fillAlpha(
  state: ReturnType<typeof stateNs.emptyGameState>,
  cpu: CpuSession,
  fillByte: number,
): void {
  for (let i = 0; i < ALPHA_SIZE; i++) {
    pokeMem(cpu, ALPHA_BASE + i, 1, fillByte);
    state.alphaRam[i] = fillByte;
  }
}

function setupEntry(
  state: ReturnType<typeof stateNs.emptyGameState>,
  cpu: CpuSession,
  structAddr: number,
  col: number,
  tickOff: number,
  stringAddr: number,
  marker: number,
  nextPtr: number,
): void {
  const writes: Array<[number, 1 | 2 | 4, number]> = [
    [structAddr + 0, 1, col & 0xff],
    [structAddr + 1, 1, tickOff & 0xff],
    [structAddr + 2, 4, stringAddr >>> 0],
    [structAddr + 6, 1, marker & 0xff],
    [structAddr + 7, 1, 0],
    [structAddr + 8, 4, nextPtr >>> 0],
  ];
  for (const [a, sz, v] of writes) pokeMem(cpu, a, sz, v);

  // Mirror in workRam
  const wOff = structAddr - 0x400000;
  state.workRam[wOff + 0] = col & 0xff;
  state.workRam[wOff + 1] = tickOff & 0xff;
  state.workRam[wOff + 2] = (stringAddr >>> 24) & 0xff;
  state.workRam[wOff + 3] = (stringAddr >>> 16) & 0xff;
  state.workRam[wOff + 4] = (stringAddr >>> 8) & 0xff;
  state.workRam[wOff + 5] = stringAddr & 0xff;
  state.workRam[wOff + 6] = marker & 0xff;
  state.workRam[wOff + 7] = 0;
  state.workRam[wOff + 8] = (nextPtr >>> 24) & 0xff;
  state.workRam[wOff + 9] = (nextPtr >>> 16) & 0xff;
  state.workRam[wOff + 10] = (nextPtr >>> 8) & 0xff;
  state.workRam[wOff + 11] = nextPtr & 0xff;
}

function setupString(
  state: ReturnType<typeof stateNs.emptyGameState>,
  cpu: CpuSession,
  stringAddr: number,
  bytes: number[],
): void {
  for (let i = 0; i < bytes.length; i++) {
    pokeMem(cpu, stringAddr + i, 1, bytes[i] ?? 0);
    state.workRam[(stringAddr - 0x400000) + i] = bytes[i] ?? 0;
  }
}

/** Set rotation/VAL_F00 in both. */
function setupGlobals(
  state: ReturnType<typeof stateNs.emptyGameState>,
  cpu: CpuSession,
  rotation: number,
  valF00: number,
): void {
  pokeMem(cpu, ROTATION_ADDR, 2, rotation & 0xffff);
  pokeMem(cpu, VAL_F00_ADDR, 2, valF00 & 0xffff);
  state.workRam[0x1f42] = (rotation >>> 8) & 0xff;
  state.workRam[0x1f43] = rotation & 0xff;
  state.workRam[0x1f00] = (valF00 >>> 8) & 0xff;
  state.workRam[0x1f01] = valF00 & 0xff;
}

/** Compare alpha RAM. Returns first diff or null. */
function compareAlpha(
  state: ReturnType<typeof stateNs.emptyGameState>,
  cpu: CpuSession,
): { offset: number; bin: number; ts: number } | null {
  for (let i = 0; i < ALPHA_SIZE; i++) {
    const b = peekMem(cpu, ALPHA_BASE + i, 1);
    const t = state.alphaRam[i] ?? 0;
    if (b !== t) return { offset: i, bin: b, ts: t };
  }
  return null;
}

async function main(): Promise<void> {
  const total = Number(process.argv[2] ?? "500");
  const perSuite = Math.floor(total / 4);
  const remainder = total - perSuite * 4;

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

  let totalOk = 0;
  interface FailRecord {
    suite: string;
    tc: number;
    offset: number;
    bin: number;
    ts: number;
    info: string;
  }
  const failHolder: { value: FailRecord | null } = { value: null };

  function runOneCase(
    suite: string,
    tc: number,
    setup: () => string,
    structAddr: number,
  ): boolean {
    cpu.system.setRegister("sp", 0x401f00);
    fillAlpha(stateInst, cpu, 0xcc);
    const info = setup();

    callFunction(cpu, FUN_2ABC, [structAddr]);
    sub2abcNs.stateSub2ABC(stateInst, tsRom, structAddr);

    const fail = compareAlpha(stateInst, cpu);
    if (fail === null) return true;
    if (failHolder.value === null) {
      failHolder.value = {
        suite,
        tc,
        offset: fail.offset,
        bin: fail.bin,
        ts: fail.ts,
        info,
      };
    }
    return false;
  }

  const rng = makeRng(0x2abc);
  const ri = (max: number): number => Math.floor(rng() * max);

  console.log(`\n=== stateSub2ABC (FUN_2ABC) — Suite A: rot=0, single entry — ${perSuite} cases ===`);
  let okA = 0;
  for (let i = 0; i < perSuite; i++) {
    const ok = runOneCase("A", i, () => {
      const col = ri(32); // small unsigned per evitare overflow alpha
      const tickOff = ri(32);
      const slen = 1 + ri(8);
      const bytes: number[] = [];
      for (let j = 0; j < slen; j++) bytes.push(0x40 + ri(60));
      bytes.push(0);
      setupGlobals(stateInst, cpu, 0, 0);
      setupEntry(stateInst, cpu, STRUCT_ADDRS[0], col, tickOff, STRING_ADDRS[0], 0, 0);
      setupString(stateInst, cpu, STRING_ADDRS[0], bytes);
      return `col=${col} tickOff=${tickOff} slen=${slen}`;
    }, STRUCT_ADDRS[0]);
    if (ok) okA++;
  }
  console.log(`  Match: ${okA}/${perSuite} = ${((okA / perSuite) * 100).toFixed(1)}%`);
  totalOk += okA;

  console.log(`\n=== Suite B: rot=1, single entry — ${perSuite} cases ===`);
  let okB = 0;
  for (let i = 0; i < perSuite; i++) {
    const ok = runOneCase("B", i, () => {
      const col = ri(32);
      const tickOff = ri(32);
      const slen = 1 + ri(8);
      const bytes: number[] = [];
      for (let j = 0; j < slen; j++) bytes.push(0x40 + ri(60));
      bytes.push(0);
      setupGlobals(stateInst, cpu, 1, 0);
      setupEntry(stateInst, cpu, STRUCT_ADDRS[0], col, tickOff, STRING_ADDRS[0], 0, 0);
      setupString(stateInst, cpu, STRING_ADDRS[0], bytes);
      return `col=${col} tickOff=${tickOff} slen=${slen}`;
    }, STRUCT_ADDRS[0]);
    if (ok) okB++;
  }
  console.log(`  Match: ${okB}/${perSuite} = ${((okB / perSuite) * 100).toFixed(1)}%`);
  totalOk += okB;

  // ─── Suite C: rot=0..3, signed with the/tickOff (negative inclusi) ─────────
  console.log(`\n=== Suite C: rot mixed, signed col/tickOff — ${perSuite} cases ===`);
  let okC = 0;
  for (let i = 0; i < perSuite; i++) {
    const ok = runOneCase("C", i, () => {
      // (stride 0 per rot=2 → infinite loop). We use rot in {0, 1, 3}.
      const rotChoices = [0, 1, 3];
      const rot = rotChoices[ri(3)] ?? 0;
      // with the signed in [-8, 7] per stare in alpha range
      const col = (ri(16) - 8) & 0xff;
      const tickOff = (ri(16) - 8) & 0xff;
      const slen = 1 + ri(4);
      const bytes: number[] = [];
      for (let j = 0; j < slen; j++) bytes.push(0x40 + ri(60));
      bytes.push(0);
      setupGlobals(stateInst, cpu, rot, 0);
      setupEntry(stateInst, cpu, STRUCT_ADDRS[0], col, tickOff, STRING_ADDRS[0], 0, 0);
      setupString(stateInst, cpu, STRING_ADDRS[0], bytes);
      return `rot=${rot} col=0x${col.toString(16)} tickOff=0x${tickOff.toString(16)} slen=${slen}`;
    }, STRUCT_ADDRS[0]);
    if (ok) okC++;
  }
  console.log(`  Match: ${okC}/${perSuite} = ${((okC / perSuite) * 100).toFixed(1)}%`);
  totalOk += okC;

  // ─── Suite D: chain walk (2-3 entry) ──────────────────────────────────
  const sizeD = perSuite + remainder;
  console.log(`\n=== Suite D: chain walk (multi-entry) — ${sizeD} cases ===`);
  let okD = 0;
  for (let i = 0; i < sizeD; i++) {
    const ok = runOneCase("D", i, () => {
      const rotChoices = [0, 1, 3];
      const rot = rotChoices[ri(3)] ?? 0;
      // VAL_F00: condition `marker + valF00 > 1` → continua. `<=1` → stop.
      // Use VAL_F00 = -2 with random marker in [0..7]:
      //   marker=0 → -2 → stop
      //   marker=1 → -1 → stop
      //   marker=2 → 0 → stop
      //   marker=3 → 1 → stop
      //   marker=4 → 2 → continua
      //   marker=5 → 3 → continua
      // Mix various to coverage.
      const valF00 = (ri(8) - 4) & 0xffff; // -4..3
      const numEntries = 1 + ri(3); // 1..3
      let info = `rot=${rot} valF00=0x${valF00.toString(16)} entries=${numEntries}`;

      // Costruisci numEntries entry collegate.
      // Marker per entry [0..numEntries-2]: high (per continuare) → marker=10
      // L'ultima ha marker=0 (per terminare).
      for (let e = 0; e < numEntries; e++) {
        const isLast = e === numEntries - 1;
        const col = ri(16);
        const tickOff = ri(16);
        const slen = 1 + ri(3);
        const bytes: number[] = [];
        for (let j = 0; j < slen; j++) bytes.push(0x40 + ri(60));
        bytes.push(0);
        const marker = isLast ? 0 : 10; // marker high per chain walk
        const nextPtr = isLast ? 0 : (STRUCT_ADDRS[e + 1] ?? 0);
        setupEntry(
          stateInst,
          cpu,
          STRUCT_ADDRS[e] ?? 0,
          col,
          tickOff,
          STRING_ADDRS[e] ?? 0,
          marker,
          nextPtr,
        );
        setupString(stateInst, cpu, STRING_ADDRS[e] ?? 0, bytes);
      }
      setupGlobals(stateInst, cpu, rot, valF00);
      return info;
    }, STRUCT_ADDRS[0]);
    if (ok) okD++;
  }
  console.log(`  Match: ${okD}/${sizeD} = ${((okD / sizeD) * 100).toFixed(1)}%`);
  totalOk += okD;

  console.log(`\n=== TOTALE: ${totalOk}/${total} = ${((totalOk / total) * 100).toFixed(1)}% ===`);
  if (failHolder.value !== null) {
    const { suite, tc, offset, bin, ts, info } = failHolder.value;
    console.log(
      `  First fail (suite ${suite} tc=${tc}): @ alpha+0x${offset.toString(16)} ` +
      `bin=0x${bin.toString(16)} ts=0x${ts.toString(16)} | ${info}`,
    );
  }

  disposeCpu(cpu);
  exit(totalOk === total ? 0 : 1);
}

main().catch(e => {
  console.error(e);
  exit(1);
});
