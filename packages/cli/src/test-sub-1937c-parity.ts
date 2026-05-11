#!/usr/bin/env node
/**
 * test-sub-1937c-parity.ts — differential FUN_0001937C vs `sub1937C`.
 *
 * FUN_0001937C (90 byte): "Entity position validator". Legge x = entity[0xC..0xD]
 * (word) e y = entity[0x10..0x11] (word), chiama FUN_193D8 (proximity check su
 * array @ 0x401890, 9 × 0x28) e FUN_19460 (grid bitmap ROM @ 0x24496). Ritorna
 * 1 se OR è non-zero (= "bloccata"), 0 se entrambi 0 (= "libera").
 *
 * **Strategia parity**:
 *   - FUN_193D8 (proximity) **lasciato live**: implementato in `sub-1937c.ts`
 *     come `sub193D8ProximityCheck`.
 *   - FUN_19460 (grid bitmap) **lasciato live**: in `sub-1937c.ts` come
 *     `sub19460GridBitmap`.
 *
 * Compare:
 *   - Return value D0 (signed long da call binary)
 *   - `entity[0x0..0x40]` (no scritture attese dalla funzione, ma controlla che
 *     non ci siano side-effect indesiderati su workRam).
 *   - `proxArray @ 0x401890..0x401A28` (9 entry × 0x28; no scritture attese).
 *
 * **Suite** (4 × 125 = 500):
 *   - A: random — entity + 9 prox entries random
 *   - B: pos in range grid valido (x,y >> 3 - bias in [0..0xF])
 *   - C: entity con prox-array vicino (forzato match)
 *   - D: edge cases (entity self-pointer, status 0/non-0, kind 2)
 *
 * Uso: npx tsx packages/cli/src/test-sub-1937c-parity.ts [N]
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import { state as stateNs, sub1937C as sub1937CNs, bus as busNs } from "@marble-love/engine";
import type { RomImage } from "@marble-love/engine";
import { createCpu, callFunction, pokeMem, peekMem, disposeCpu } from "./binary-oracle-lib.js";
import type { CpuSession } from "./binary-oracle-lib.js";

const FUN_1937C = 0x0001937c;

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
  ret: number;
  entity: number[];
  prox: number[];
}

function snapshotBin(cpu: CpuSession, ret: number): Snapshot {
  const e: number[] = [];
  for (let i = 0; i < ENTITY_SIZE; i++) e.push(peekMem(cpu, ENTITY_BASE + i, 1) & 0xff);
  const p: number[] = [];
  for (let i = 0; i < PROX_BYTES; i++) p.push(peekMem(cpu, PROX_ARRAY_BASE + i, 1) & 0xff);
  return { ret, entity: e, prox: p };
}

function snapshotTs(stateInst: ReturnType<typeof stateNs.emptyGameState>, ret: number): Snapshot {
  const e: number[] = [];
  const offE = ENTITY_BASE - 0x400000;
  for (let i = 0; i < ENTITY_SIZE; i++) e.push(stateInst.workRam[offE + i] ?? 0);
  const p: number[] = [];
  const offP = PROX_ARRAY_BASE - 0x400000;
  for (let i = 0; i < PROX_BYTES; i++) p.push(stateInst.workRam[offP + i] ?? 0);
  return { ret, entity: e, prox: p };
}

interface FailRecord {
  suite: string;
  tc: number;
  reason: string;
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
    const binRet = callFunction(cpu, FUN_1937C, [ENTITY_BASE]).d0 >>> 0;
    const binSnap = snapshotBin(cpu, binRet);
    const tsRet = sub1937CNs.sub1937C(stateInst, tsRom, ENTITY_BASE) >>> 0;
    const tsSnap = snapshotTs(stateInst, tsRet);

    let reason = "";
    if (binSnap.ret !== tsSnap.ret) {
      reason = `ret bin=0x${binSnap.ret.toString(16)} ts=0x${tsSnap.ret.toString(16)}`;
    } else {
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
    }
    if (reason === "") return true;
    if (failHolder.value === null) failHolder.value = { suite, tc, reason };
    return false;
  }

  const rng = makeRng(0x1937c);
  const rb = (): number => Math.floor(rng() * 256) & 0xff;
  const genEntity = (): number[] => new Array(ENTITY_SIZE).fill(0).map(() => rb());
  const genProx = (): number[] => new Array(PROX_BYTES).fill(0).map(() => rb());

  // Suite A: random
  console.log(`\n=== sub1937C (FUN_1937C) — Suite A: random — ${perSuite} casi ===`);
  let okA = 0;
  for (let i = 0; i < perSuite; i++) {
    if (runOneCase("A", i, genEntity(), genProx())) okA++;
  }
  console.log(`  Match: ${okA}/${perSuite} = ${((okA / perSuite) * 100).toFixed(1)}%`);
  totalOk += okA;

  // Suite B: pos in range grid valido (x,y >> 3 in valid grid)
  console.log(`\n=== Suite B: pos in grid range — ${perSuite} casi ===`);
  let okB = 0;
  for (let i = 0; i < perSuite; i++) {
    const e = genEntity();
    // x,y tale che (x >> 3) - 0x59 in [0..0xF] e (y >> 3) - 0x5A in [0..0xF].
    // → x_byte in [0x59..0x68] → x_word in [0x59*8 .. 0x68*8] = [0x2c8..0x340].
    const xw = (0x59 + Math.floor(rng() * 0x10)) * 8 + Math.floor(rng() * 8);
    const yw = (0x5a + Math.floor(rng() * 0x10)) * 8 + Math.floor(rng() * 8);
    e[0x0c] = (xw >> 8) & 0xff;
    e[0x0d] = xw & 0xff;
    e[0x10] = (yw >> 8) & 0xff;
    e[0x11] = yw & 0xff;
    if (runOneCase("B", i, e, genProx())) okB++;
  }
  console.log(`  Match: ${okB}/${perSuite} = ${((okB / perSuite) * 100).toFixed(1)}%`);
  totalOk += okB;

  // Suite C: entity close to prox entries
  console.log(`\n=== Suite C: prox match likely — ${perSuite} casi ===`);
  let okC = 0;
  for (let i = 0; i < perSuite; i++) {
    const e = genEntity();
    const prox = genProx();
    // Posiziona entity e prox entry 0 a coordinate vicine.
    const baseX = 0x100 + Math.floor(rng() * 0x200);
    const baseY = 0x100 + Math.floor(rng() * 0x200);
    e[0x0c] = (baseX >> 8) & 0xff;
    e[0x0d] = baseX & 0xff;
    e[0x10] = (baseY >> 8) & 0xff;
    e[0x11] = baseY & 0xff;
    // prox[0]: status=1, kind!=2, pos = baseX+5, baseY+3
    prox[0x18] = 0x01;
    prox[0x1a] = 0x00;
    prox[0x0c] = (((baseX + 5) >> 8) & 0xff);
    prox[0x0d] = (baseX + 5) & 0xff;
    prox[0x10] = (((baseY + 3) >> 8) & 0xff);
    prox[0x11] = (baseY + 3) & 0xff;
    if (runOneCase("C", i, e, prox)) okC++;
  }
  console.log(`  Match: ${okC}/${perSuite} = ${((okC / perSuite) * 100).toFixed(1)}%`);
  totalOk += okC;

  // Suite D: edge cases — self-pointer, status edges, kind edges
  const sizeD = perSuite + remainder;
  console.log(`\n=== Suite D: edge cases — ${sizeD} casi ===`);
  let okD = 0;
  for (let i = 0; i < sizeD; i++) {
    const e = genEntity();
    const prox = genProx();
    // Random per ogni entry: forza kind=2 o status=0 in alcuni slot.
    for (let j = 0; j < PROX_ARRAY_COUNT; j++) {
      const r = Math.floor(rng() * 4);
      if (r === 0) prox[j * PROX_ENTRY_SIZE + 0x18] = 0; // status=0 (skip)
      else if (r === 1) prox[j * PROX_ENTRY_SIZE + 0x1a] = 2; // kind=2 (skip)
      else prox[j * PROX_ENTRY_SIZE + 0x18] = 0x01;
    }
    if (runOneCase("D", i, e, prox)) okD++;
  }
  console.log(`  Match: ${okD}/${sizeD} = ${((okD / sizeD) * 100).toFixed(1)}%`);
  totalOk += okD;

  console.log(`\n=== TOTALE: ${totalOk}/${total} = ${((totalOk / total) * 100).toFixed(1)}% ===`);
  if (failHolder.value !== null) {
    console.log(`  First fail (suite ${failHolder.value.suite} tc=${failHolder.value.tc}): ${failHolder.value.reason}`);
  }

  disposeCpu(cpu);
  exit(totalOk === total ? 0 : 1);
}

main().catch(e => { console.error(e); exit(1); });
