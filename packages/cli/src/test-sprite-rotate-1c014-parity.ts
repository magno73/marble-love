#!/usr/bin/env node
/**
 * test-sprite-rotate-1c014-parity.ts — differential FUN_0001C014 vs
 * `spriteRotate1C014`.
 *
 * FUN_0001C014 (1546 byte): "sprite rotation matrix builder + vertex
 * transform + sort + slot-fill". Aggiorna la matrice 3×3 dell'oggetto sprite
 * in `A2+0x74..0xA3`, trasforma 8 vertici, li ordina, scrive 4 slot in
 * `A2+0xA4`.
 *
 * **Strategia parity**:
 *   - Argomento: long (indirizzo oggetto) pushato cdecl.
 *   - Oggetto @ 0x401200 in workRam (fisso, lontano da altri globals).
 *   - Sub JSR: nessuna sub da stubbbare (FUN_1C61E = lerpFromRom è replicato
 *     bit-perfect; FUN_0001CABA non è chiamata da C014).
 *   - Compare workRam:
 *       - matrice 3×3 + cols espansi 3..7: A2+0x74..0xA3 (48 byte = 24 word×2)
 *       - slot output: A2+0xA4..0xC3 (32 byte = 4 slot × 8 byte, usiamo 4×6=24)
 *         Nota: stride è 6 byte per slot, 4 slot → 24 byte.
 *       - CA counter: A2+0xCA (1 byte).
 *
 * **Suite**:
 *   - A: random tutto (flag@+58, velocity, matrix cols, base coords, gameMode).
 *   - B: force velocity idle (flag@+58=0xA) → slot-only path.
 *   - C: force gameMode=4 con velocità non-nulla → special angle branch.
 *   - D: edge cases (velocità ±max, angoli 0, matrice identità/zero).
 *
 * Uso: npx tsx packages/cli/src/test-sprite-rotate-1c014-parity.ts [N]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import {
  state as stateNs,
  bus as busNs,
  spriteRotate1C014 as rotNs,
} from "@marble-love/engine";
import type { RomImage } from "@marble-love/engine";
import {
  createCpu,
  callFunction,
  pokeMem,
  peekMem,
  disposeCpu,
} from "./binary-oracle-lib.js";
import type { CpuSession } from "./binary-oracle-lib.js";

const FUN_1C014 = 0x0001c014;
const OBJ_ADDR = 0x00401200; // workRam address of object struct (cdecl arg)
const OBJ_OFF = OBJ_ADDR - 0x400000; // workRam offset

// ─── Compare region ────────────────────────────────────────────────────────

// We compare:
//   rotation matrix 3×3 + derived cols 3..7: A2+0x74..A2+0xA3 = 48 bytes
//   slot output: A2+0xA4..A2+0xBB = 24 bytes (4×6)
//   CA counter: A2+0xCA = 1 byte
const COMPARE_RANGES: Array<{ label: string; start: number; size: number }> = [
  { label: "mat[0x74..0xA3]", start: 0x74, size: 48 },
  { label: "slots[0xA4..0xBB]", start: 0xa4, size: 24 },
  { label: "ca[0xCA]", start: 0xca, size: 1 },
];

// ─── Object struct layout (bytes to setup) ─────────────────────────────────
// We set up the full object struct range (0x00..0xCF, 208 bytes).
const OBJ_SIZE = 0xd4;

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) >>> 0;
    return ((s >>> 16) & 0xffff) / 0x10000;
  };
}

function setupObj(
  state: ReturnType<typeof stateNs.emptyGameState>,
  cpu: CpuSession,
  bytes: number[],
): void {
  for (let i = 0; i < OBJ_SIZE; i++) {
    const v = bytes[i] ?? 0;
    pokeMem(cpu, OBJ_ADDR + i, 1, v);
    state.workRam[OBJ_OFF + i] = v;
  }
}

function setupGameMode(
  state: ReturnType<typeof stateNs.emptyGameState>,
  cpu: CpuSession,
  gm: number,
): void {
  pokeMem(cpu, 0x400394, 2, gm & 0xffff);
  state.workRam[0x394] = (gm >>> 8) & 0xff;
  state.workRam[0x395] = gm & 0xff;
}

interface FailRecord {
  suite: string;
  tc: number;
  label: string;
  offset: number;
  bin: number;
  ts: number;
}

function compareRanges(
  state: ReturnType<typeof stateNs.emptyGameState>,
  cpu: CpuSession,
): FailRecord | null {
  for (const rng of COMPARE_RANGES) {
    for (let i = 0; i < rng.size; i++) {
      const binB = peekMem(cpu, OBJ_ADDR + rng.start + i, 1);
      const tsB = state.workRam[OBJ_OFF + rng.start + i] ?? 0;
      if (binB !== tsB) {
        return {
          suite: "",
          tc: 0,
          label: rng.label,
          offset: rng.start + i,
          bin: binB,
          ts: tsB,
        };
      }
    }
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
  const romBuf = readFileSync(romPath);

  const state = stateNs.emptyGameState();
  const cpu = await createCpu({ rom: romBuf, state });

  // Load ROM into TS RomImage
  const tsRom: RomImage = busNs.emptyRomImage();
  tsRom.program.set(romBuf.subarray(0, tsRom.program.length));

  const rb = makeRng(0x1c014);
  const randByte = (): number => Math.floor(rb() * 256) & 0xff;

  let totalOk = 0;
  let firstFail: FailRecord | null = null;

  function runOne(
    suite: string,
    tc: number,
    objBytes: number[],
    gm: number,
  ): boolean {
    cpu.system.setRegister("sp", 0x401f00);
    setupObj(state, cpu, objBytes);
    setupGameMode(state, cpu, gm);

    // Binary: call FUN_1C014(OBJ_ADDR) → single long arg
    callFunction(cpu, FUN_1C014, [OBJ_ADDR]);

    // TS: call with workRam already set up above
    rotNs.spriteRotate1C014(state, tsRom, OBJ_OFF);

    const fail = compareRanges(state, cpu);
    if (fail !== null) {
      if (firstFail === null) {
        firstFail = { ...fail, suite, tc };
      }
      return false;
    }
    return true;
  }

  // ─── Suite A: fully random ─────────────────────────────────────────────
  console.log(`\n=== spriteRotate1C014 (FUN_0001C014) — Suite A: random — ${perSuite} casi ===`);
  let okA = 0;
  for (let i = 0; i < perSuite; i++) {
    const obj = Array.from({ length: OBJ_SIZE }, () => randByte());
    // Ensure CA counter is 0..7 (avoid spurious byte)
    obj[0xca] = Math.floor(rb() * 3) & 0xff; // 0,1,2 to match loop range
    const gm = [0, 1, 2, 4][Math.floor(rb() * 4)]!;
    if (runOne("A", i, obj, gm)) okA++;
  }
  console.log(`  Match: ${okA}/${perSuite} = ${((okA / perSuite) * 100).toFixed(1)}%`);
  totalOk += okA;

  // ─── Suite B: force idle (flag@+0x58=0xA) ─────────────────────────────
  console.log(`\n=== Suite B: idle flag (flag@+58=0xA) — ${perSuite} casi ===`);
  let okB = 0;
  for (let i = 0; i < perSuite; i++) {
    const obj = Array.from({ length: OBJ_SIZE }, () => randByte());
    obj[0x58] = 0x0a; // idle
    obj[0xca] = Math.floor(rb() * 3) & 0xff;
    const gm = Math.floor(rb() * 2) === 0 ? 0 : 4;
    if (runOne("B", i, obj, gm)) okB++;
  }
  console.log(`  Match: ${okB}/${perSuite} = ${((okB / perSuite) * 100).toFixed(1)}%`);
  totalOk += okB;

  // ─── Suite C: gameMode=4 with nonzero velocity ────────────────────────
  console.log(`\n=== Suite C: gameMode=4 + nonzero velocity — ${perSuite} casi ===`);
  let okC = 0;
  for (let i = 0; i < perSuite; i++) {
    const obj = Array.from({ length: OBJ_SIZE }, () => randByte());
    obj[0x58] = 0x00; // not idle
    // Set nonzero velocity X
    const vx = (randByte() + 1) << 4;
    obj[0x00] = (vx >>> 24) & 0xff;
    obj[0x01] = (vx >>> 16) & 0xff;
    obj[0x02] = (vx >>> 8) & 0xff;
    obj[0x03] = vx & 0xff;
    obj[0xca] = Math.floor(rb() * 3) & 0xff;
    if (runOne("C", i, obj, 4)) okC++;
  }
  console.log(`  Match: ${okC}/${perSuite} = ${((okC / perSuite) * 100).toFixed(1)}%`);
  totalOk += okC;

  // ─── Suite D: edge cases ──────────────────────────────────────────────
  const sizeD = perSuite + remainder;
  console.log(`\n=== Suite D: edge cases — ${sizeD} casi ===`);
  const edgeW = [0x0000, 0x0001, 0x0040, 0x4000, 0x7fff, 0x8000, 0xc000, 0xffff];
  let okD = 0;
  for (let i = 0; i < sizeD; i++) {
    const obj = Array.from({ length: OBJ_SIZE }, () => randByte());
    // Force matrix cols to edge values
    for (let c = 0; c < 3; c++) {
      for (let r = 0; r < 3; r++) {
        const w = edgeW[Math.floor(rb() * edgeW.length)]!;
        obj[0x74 + c * 0x10 + r * 2] = (w >>> 8) & 0xff;
        obj[0x74 + c * 0x10 + r * 2 + 1] = w & 0xff;
      }
    }
    obj[0xca] = Math.floor(rb() * 3) & 0xff;
    const gm = [0, 4][Math.floor(rb() * 2)]!;
    if (runOne("D", i, obj, gm)) okD++;
  }
  console.log(`  Match: ${okD}/${sizeD} = ${((okD / sizeD) * 100).toFixed(1)}%`);
  totalOk += okD;

  // ─── Summary ───────────────────────────────────────────────────────────
  console.log(`\n=== TOTALE: ${totalOk}/${total} = ${((totalOk / total) * 100).toFixed(1)}% ===`);
  if (firstFail !== null) {
    const f: FailRecord = firstFail;
    console.log(
      `  First fail (suite ${f.suite} tc=${f.tc}) ${f.label} @ A2+0x${f.offset.toString(16)}: ` +
        `bin=0x${f.bin.toString(16).padStart(2, "0")} ts=0x${f.ts.toString(16).padStart(2, "0")}`,
    );
  }

  disposeCpu(cpu);
  exit(totalOk === total ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  exit(1);
});
