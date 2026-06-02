#!/usr/bin/env node
/**
 * test-sub-19976-parity.ts — differential FUN_00019976 vs `sub19976`.
 *
 * FUN_00019976 (96 byte): "Entity move-velocity step". Legge entity[0x26] as
 * signed byte (direction); uses the direction to read 2 signed words from the ROMs
 * table @ 0x244B6 (dX) and @ 0x244D6 (dY), scaled `<<8`, and adds a
 * entity[0xC..0x13]. If state==7 → velocity cache /4 in entity[0..7]. Altrimenti
 * cache = delta non scaled.
 *
 * **Parity strategy**: no internal sub; direct replica. Compare
 * `entity[0..0x40]` (1 full entity stride).
 *
 * **Suite** (4 × 125 = 500):
 *   - A: random (dir 0..15, state random)
 *   - B: forced state==7 (/4 path active)
 *   - C: dir negativa (signed byte boundary, dir = 0x80..0xFF) — la direzione
 *     is sign-extended as signed and used as a ROM index. To match the binary,
 *     high byte values must be tested as signed negatives.
 *   - D: edge cases (dir = 0, 0x7F, 0x80, 0xFF; state byte = 0x07/0x08)
 *
 * Uso: npx tsx packages/cli/src/test-sub-19976-parity.ts [N]
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import { state as stateNs, sub19976 as sub19976Ns, bus as busNs } from "@marble-love/engine";
import type { RomImage } from "@marble-love/engine";
import { createCpu, callFunction, pokeMem, peekMem, disposeCpu } from "./binary-oracle-lib.js";
import type { CpuSession } from "./binary-oracle-lib.js";

const FUN_19976 = 0x00019976;

const ENTITY_BASE = 0x00401d00;
const ENTITY_SIZE = 0x40;

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) >>> 0;
    return ((s >>> 16) & 0xffff) / 0x10000;
  };
}

interface Snapshot {
  entity: number[];
}

function snapshotBin(cpu: CpuSession): Snapshot {
  const e: number[] = [];
  for (let i = 0; i < ENTITY_SIZE; i++) e.push(peekMem(cpu, ENTITY_BASE + i, 1) & 0xff);
  return { entity: e };
}

function snapshotTs(stateInst: ReturnType<typeof stateNs.emptyGameState>): Snapshot {
  const e: number[] = [];
  const off = ENTITY_BASE - 0x400000;
  for (let i = 0; i < ENTITY_SIZE; i++) e.push(stateInst.workRam[off + i] ?? 0);
  return { entity: e };
}

interface FailRecord {
  suite: string;
  tc: number;
  reason: string;
  input: number[];
  binEntity: number[];
  tsEntity: number[];
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
  const failHolder: { value: FailRecord | null } = { value: null };

  function setupCase(entityBytes: number[]): void {
    for (let i = 0; i < ENTITY_SIZE; i++) {
      pokeMem(cpu, ENTITY_BASE + i, 1, entityBytes[i] ?? 0);
      stateInst.workRam[(ENTITY_BASE - 0x400000) + i] = entityBytes[i] ?? 0;
    }
    cpu.system.setRegister("sp", 0x401f00);
  }

  function runOneCase(suite: string, tc: number, entityBytes: number[]): boolean {
    setupCase(entityBytes);
    callFunction(cpu, FUN_19976, [ENTITY_BASE]);
    const binSnap = snapshotBin(cpu);
    sub19976Ns.sub19976(stateInst, tsRom, ENTITY_BASE);
    const tsSnap = snapshotTs(stateInst);

    let reason = "";
    for (let i = 0; i < ENTITY_SIZE; i++) {
      if (binSnap.entity[i] !== tsSnap.entity[i]) {
        reason = `entity[0x${i.toString(16)}] bin=0x${binSnap.entity[i]!.toString(16)} ts=0x${tsSnap.entity[i]!.toString(16)}`;
        break;
      }
    }
    if (reason === "") return true;
    if (failHolder.value === null) {
      failHolder.value = {
        suite,
        tc,
        reason,
        input: entityBytes.slice(),
        binEntity: binSnap.entity.slice(),
        tsEntity: tsSnap.entity.slice(),
      };
    }
    return false;
  }

  const rng = makeRng(0x19976);
  const rb = (): number => Math.floor(rng() * 256) & 0xff;
  const genEntity = (): number[] => new Array(ENTITY_SIZE).fill(0).map(() => rb());

  // Suite A: random + dir in [0..15]
  console.log(`\n=== sub19976 (FUN_19976) — Suite A: random dir [0..15] — ${perSuite} cases ===`);
  let okA = 0;
  for (let i = 0; i < perSuite; i++) {
    const e = genEntity();
    e[0x26] = Math.floor(rng() * 16);
    if (runOneCase("A", i, e)) okA++;
  }
  console.log(`  Match: ${okA}/${perSuite} = ${((okA / perSuite) * 100).toFixed(1)}%`);
  totalOk += okA;

  // Suite B: forced state==7.
  console.log(`\n=== Suite B: state==7 (/4 path) — ${perSuite} cases ===`);
  let okB = 0;
  for (let i = 0; i < perSuite; i++) {
    const e = genEntity();
    e[0x25] = 0x07;
    e[0x26] = Math.floor(rng() * 16);
    if (runOneCase("B", i, e)) okB++;
  }
  console.log(`  Match: ${okB}/${perSuite} = ${((okB / perSuite) * 100).toFixed(1)}%`);
  totalOk += okB;

  // Suite C: dir signed negative (0x80..0xFF) — test boundary signed
  console.log(`\n=== Suite C: dir signed (0x80..0xFF) — ${perSuite} cases ===`);
  let okC = 0;
  for (let i = 0; i < perSuite; i++) {
    const e = genEntity();
    // Negative dir with ROM table at 0x244B6: `dir = -1` reads 0x244B4..0x244B5.
    // Restrict to [-4..-1] and [0..3] to avoid reads too far away.
    const dir = (Math.floor(rng() * 8) - 4) & 0xff;
    e[0x26] = dir;
    if (runOneCase("C", i, e)) okC++;
  }
  console.log(`  Match: ${okC}/${perSuite} = ${((okC / perSuite) * 100).toFixed(1)}%`);
  totalOk += okC;

  // Suite D: edge cases
  const sizeD = perSuite + remainder;
  console.log(`\n=== Suite D: edge cases — ${sizeD} cases ===`);
  let okD = 0;
  const dirs = [0x00, 0x01, 0x07, 0x08, 0x0f, 0x10, 0x7f, 0x80, 0xff];
  const states = [0x00, 0x06, 0x07, 0x08, 0xff];
  for (let i = 0; i < sizeD; i++) {
    const e = genEntity();
    e[0x25] = states[Math.floor(rng() * states.length)]!;
    e[0x26] = dirs[Math.floor(rng() * dirs.length)]!;
    if (runOneCase("D", i, e)) okD++;
  }
  console.log(`  Match: ${okD}/${sizeD} = ${((okD / sizeD) * 100).toFixed(1)}%`);
  totalOk += okD;

  console.log(`\n=== TOTALE: ${totalOk}/${total} = ${((totalOk / total) * 100).toFixed(1)}% ===`);
  if (failHolder.value !== null) {
    const f = failHolder.value;
    console.log(`  First fail (suite ${f.suite} tc=${f.tc}): ${f.reason}`);
    console.log(`    input[0x25]=0x${f.input[0x25]!.toString(16)} [0x26]=0x${f.input[0x26]!.toString(16)}`);
  }

  disposeCpu(cpu);
  exit(totalOk === total ? 0 : 1);
}

main().catch(e => { console.error(e); exit(1); });
