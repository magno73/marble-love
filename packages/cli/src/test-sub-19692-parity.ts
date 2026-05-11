#!/usr/bin/env node
/**
 * test-sub-19692-parity.ts — differential FUN_00019692 vs `sub19692`.
 *
 * FUN_00019692 (164 byte): "Entity move-and-validate retry loop (heavy)".
 * Variante di FUN_198BC chiamata in coda da FUN_1960E (case 0 di dispatcher
 * 194BA). Tenta move via FUN_19976 + validate via FUN_1937C; se il 1° validate
 * fallisce (libera/skip) restore pos & return. Se passa, loop fino a 12 iter
 * ruotando entity[0x26] di step (1 se state==7, altrimenti 4). Esce con
 * marker stuck (entity[0x26]=0x10, entity[0..7]=0) se loop esaurito.
 *
 * **Differenze da FUN_198BC**:
 *   - NO pre-decrement entity[0x26].
 *   - NO save direzione originale (no D4).
 *   - NO cycle-back check.
 *   - Max iter = 0xC (12), non 9.
 *
 * **Strategia parity**:
 *   - FUN_19976 **lasciato live** (replica `sub19976`).
 *   - FUN_1937C **lasciato live** (replica `sub1937C`).
 *   - Compare: entity[0..0x28] + proxArray[0x401890..0x401a28].
 *
 * **Suite** (4 × 125 = 500):
 *   - A: random
 *   - B: state==7 forzato
 *   - C: pos in zona valida grid (validate path varied)
 *   - D: edge cases (counter saturation, state boundaries, marker 0x10)
 *
 * Uso: npx tsx packages/cli/src/test-sub-19692-parity.ts [N]
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import {
  state as stateNs,
  sub19692 as sub19692Ns,
  sub19976 as sub19976Ns,
  sub1937C as sub1937CNs,
  bus as busNs,
} from "@marble-love/engine";
import type { RomImage } from "@marble-love/engine";
import { createCpu, callFunction, pokeMem, peekMem, disposeCpu } from "./binary-oracle-lib.js";
import type { CpuSession } from "./binary-oracle-lib.js";

const FUN_19692 = 0x00019692;

const ENTITY_BASE = 0x00401e00;
const ENTITY_SIZE = 0x28;

const PROX_ARRAY_BASE = 0x00401890;
const PROX_ARRAY_COUNT = 9;
const PROX_ENTRY_SIZE = 0x28;
const PROX_BYTES = PROX_ARRAY_COUNT * PROX_ENTRY_SIZE;

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) >>> 0;
    return ((s >>> 16) & 0xffff) / 0x10000;
  };
}

interface Snapshot {
  entity: number[];
  prox: number[];
}

function snapshotBin(cpu: CpuSession): Snapshot {
  const e: number[] = [];
  for (let i = 0; i < ENTITY_SIZE; i++) e.push(peekMem(cpu, ENTITY_BASE + i, 1) & 0xff);
  const p: number[] = [];
  for (let i = 0; i < PROX_BYTES; i++) p.push(peekMem(cpu, PROX_ARRAY_BASE + i, 1) & 0xff);
  return { entity: e, prox: p };
}

function snapshotTs(stateInst: ReturnType<typeof stateNs.emptyGameState>): Snapshot {
  const e: number[] = [];
  const offE = ENTITY_BASE - 0x400000;
  for (let i = 0; i < ENTITY_SIZE; i++) e.push(stateInst.workRam[offE + i] ?? 0);
  const p: number[] = [];
  const offP = PROX_ARRAY_BASE - 0x400000;
  for (let i = 0; i < PROX_BYTES; i++) p.push(stateInst.workRam[offP + i] ?? 0);
  return { entity: e, prox: p };
}

interface FailRecord {
  suite: string;
  tc: number;
  reason: string;
  input: number[];
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

  function setupCase(entityBytes: number[], proxBytes: number[]): void {
    for (let i = 0; i < ENTITY_SIZE; i++) {
      pokeMem(cpu, ENTITY_BASE + i, 1, entityBytes[i] ?? 0);
      stateInst.workRam[(ENTITY_BASE - 0x400000) + i] = entityBytes[i] ?? 0;
    }
    for (let i = 0; i < proxBytes.length; i++) {
      pokeMem(cpu, PROX_ARRAY_BASE + i, 1, proxBytes[i] ?? 0);
      stateInst.workRam[(PROX_ARRAY_BASE - 0x400000) + i] = proxBytes[i] ?? 0;
    }
    cpu.system.setRegister("sp", 0x401f00);
  }

  function runOneCase(suite: string, tc: number, entityBytes: number[], proxBytes: number[]): boolean {
    setupCase(entityBytes, proxBytes);
    callFunction(cpu, FUN_19692, [ENTITY_BASE]);
    const binSnap = snapshotBin(cpu);

    sub19692Ns.sub19692(stateInst, ENTITY_BASE, {
      fun_19976: (s, a) => sub19976Ns.sub19976(s, tsRom, a),
      fun_1937c: (s, a) => sub1937CNs.sub1937C(s, tsRom, a),
    });
    const tsSnap = snapshotTs(stateInst);

    let reason = "";
    for (let i = 0; i < ENTITY_SIZE; i++) {
      if (binSnap.entity[i] !== tsSnap.entity[i]) {
        reason = `entity[0x${i.toString(16)}] bin=0x${binSnap.entity[i]!.toString(16)} ts=0x${tsSnap.entity[i]!.toString(16)}`;
        break;
      }
    }
    if (reason === "") {
      for (let i = 0; i < PROX_BYTES; i++) {
        if (binSnap.prox[i] !== tsSnap.prox[i]) {
          reason = `prox[0x${i.toString(16)}] bin=0x${binSnap.prox[i]!.toString(16)} ts=0x${tsSnap.prox[i]!.toString(16)}`;
          break;
        }
      }
    }
    if (reason === "") return true;
    if (failHolder.value === null) {
      failHolder.value = { suite, tc, reason, input: entityBytes.slice() };
    }
    return false;
  }

  const rng = makeRng(0x19692);
  const rb = (): number => Math.floor(rng() * 256) & 0xff;
  const genEntity = (): number[] => new Array(ENTITY_SIZE).fill(0).map(() => rb());
  const genProx = (): number[] => new Array(PROX_BYTES).fill(0).map(() => rb());

  // Suite A: random
  console.log(`\n=== sub19692 (FUN_19692) — Suite A: random — ${perSuite} casi ===`);
  let okA = 0;
  for (let i = 0; i < perSuite; i++) {
    if (runOneCase("A", i, genEntity(), genProx())) okA++;
  }
  console.log(`  Match: ${okA}/${perSuite} = ${((okA / perSuite) * 100).toFixed(1)}%`);
  totalOk += okA;

  // Suite B: state==7 forzato
  console.log(`\n=== Suite B: forced state==7 (step=1, apply ogni iter) — ${perSuite} casi ===`);
  let okB = 0;
  for (let i = 0; i < perSuite; i++) {
    const e = genEntity();
    e[0x25] = 0x07;
    e[0x26] = Math.floor(rng() * 0x10);
    if (runOneCase("B", i, e, genProx())) okB++;
  }
  console.log(`  Match: ${okB}/${perSuite} = ${((okB / perSuite) * 100).toFixed(1)}%`);
  totalOk += okB;

  // Suite C: pos in grid valido
  console.log(`\n=== Suite C: pos in grid range — ${perSuite} casi ===`);
  let okC = 0;
  for (let i = 0; i < perSuite; i++) {
    const e = genEntity();
    const x = 0x100 + Math.floor(rng() * 0x200);
    const y = 0x100 + Math.floor(rng() * 0x200);
    e[0x0c] = (x >>> 8) & 0xff;
    e[0x0d] = x & 0xff;
    e[0x0e] = 0;
    e[0x0f] = 0;
    e[0x10] = (y >>> 8) & 0xff;
    e[0x11] = y & 0xff;
    e[0x12] = 0;
    e[0x13] = 0;
    e[0x26] = Math.floor(rng() * 0x10);
    if (runOneCase("C", i, e, genProx())) okC++;
  }
  console.log(`  Match: ${okC}/${perSuite} = ${((okC / perSuite) * 100).toFixed(1)}%`);
  totalOk += okC;

  // Suite D: edge cases
  const sizeD = perSuite + remainder;
  console.log(`\n=== Suite D: edge cases — ${sizeD} casi ===`);
  let okD = 0;
  const stateBytes = [0x00, 0x01, 0x06, 0x07, 0x08, 0x09, 0xff];
  const counterBytes = [0x00, 0x01, 0x07, 0x08, 0x0f, 0x10, 0x11, 0xff];
  for (let i = 0; i < sizeD; i++) {
    const e = genEntity();
    e[0x25] = stateBytes[Math.floor(rng() * stateBytes.length)]!;
    e[0x26] = counterBytes[Math.floor(rng() * counterBytes.length)]!;
    if (runOneCase("D", i, e, genProx())) okD++;
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
