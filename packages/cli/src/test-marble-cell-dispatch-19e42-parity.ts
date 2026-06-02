#!/usr/bin/env node
/**
 * test-marble-cell-dispatch-19e42-parity.ts —
 * differential FUN_00019E42 vs `marbleCellDispatch19E42`.
 *
 * **Strategia**:
 * dispatch") with two key differences:
 *      o azzerare 3 word @ `entity[0x26, 0x2C, 0x32]` (MISS).
 *
 * To test in isolation, patch `FUN_000264AA` with a stub:
 *
 *     20 2F 00 08    ; move.l (8,SP), D0   ; D0 = mode (= 3)
 *     4E 75          ; rts
 *
 *   - workRam @ 0x400690..0x400693 (POS_X/Y globals)
 *   - struct @ A1..A1+0x40 (including A1+0x20 packed long, A1+0x26..0x33 clear)
 *
 * Suite testate (4 × 125 = 500):
 *   - A: HUD random + struct random + ptr random (fully random)
 *   - C: w0/w2/w4/HUD estremi (signed overflow)
 *
 * Uso: npx tsx packages/cli/src/test-marble-cell-dispatch-19e42-parity.ts [N]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import {
  state as stateNs,
  marbleCellDispatch19E42 as ns,
} from "@marble-love/engine";
import {
  createCpu,
  callFunction,
  pokeMem,
  peekMem,
  disposeCpu,
} from "./binary-oracle-lib.js";

const FUN_19E42 = 0x00019e42;
const FUN_264AA = 0x000264aa;

/** Stub bytes per `FUN_264AA`: `move.l (8,SP),D0` ; `rts`. */
const STUB_BYTES = [0x20, 0x2f, 0x00, 0x08, 0x4e, 0x75] as const;

const HUD_OFFSET_ADDR = 0x0040097e;
const POS_X_ADDR = 0x00400690;

/** Slot pointers candidates per la struct (work RAM, lontani da globals). */
const PTR_CHOICES = [
  0x00401000,
  0x004012a0,
  0x00401500,
  0x004017c0,
  0x00401a00,
  0x00401d00,
] as const;

const STRUCT_SIZE = 0x40;

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) >>> 0;
    return ((s >>> 16) & 0xffff) / 0x10000;
  };
}

interface FailRecord {
  suite: string;
  i: number;
  structPtr: number;
  hud: number;
  w0: number;
  w2: number;
  w4: number;
  reason: string;
  binVal: number;
  tsVal: number;
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

  // Patch FUN_264AA with the stub.
  for (let i = 0; i < STUB_BYTES.length; i++) {
    pokeMem(cpu, FUN_264AA + i, 1, STUB_BYTES[i]!);
  }

  let totalOk = 0;
  const failHolder: { value: FailRecord | null } = { value: null };

  function setHud(rng: () => number): number {
    const v = Math.floor(rng() * 0x10000) & 0xffff;
    pokeMem(cpu, HUD_OFFSET_ADDR, 1, (v >>> 8) & 0xff);
    pokeMem(cpu, HUD_OFFSET_ADDR + 1, 1, v & 0xff);
    stateInst.workRam[0x97e] = (v >>> 8) & 0xff;
    stateInst.workRam[0x97f] = v & 0xff;
    return v;
  }

  function setupStruct(structPtr: number, bytes: number[]): void {
    for (let i = 0; i < STRUCT_SIZE; i++) {
      const v = bytes[i] ?? 0;
      pokeMem(cpu, structPtr + i, 1, v);
      stateInst.workRam[(structPtr - 0x400000) + i] = v;
    }
  }

  /** Compare struct + globals POS_X/Y + HUD. Return first diff or null. */
  function compareAll(
    structPtr: number,
  ): { what: string; bin: number; ts: number } | null {
    for (let i = 0; i < STRUCT_SIZE; i++) {
      const b = peekMem(cpu, structPtr + i, 1);
      const t = stateInst.workRam[(structPtr - 0x400000) + i] ?? 0;
      if (b !== t) {
        return { what: `struct+0x${i.toString(16)}`, bin: b, ts: t };
      }
    }
    for (let i = 0; i < 4; i++) {
      const b = peekMem(cpu, POS_X_ADDR + i, 1);
      const t = stateInst.workRam[0x690 + i] ?? 0;
      if (b !== t) {
        return { what: `pos[0x${(0x690 + i).toString(16)}]`, bin: b, ts: t };
      }
    }
    // HUD must not have been corrupted (read-only).
    for (let i = 0; i < 2; i++) {
      const b = peekMem(cpu, HUD_OFFSET_ADDR + i, 1);
      const t = stateInst.workRam[0x97e + i] ?? 0;
      if (b !== t) {
        return { what: `hud[0x${(0x97e + i).toString(16)}]`, bin: b, ts: t };
      }
    }
    return null;
  }

  function runOneCase(
    suite: string,
    i: number,
    structPtr: number,
    hud: number,
    bytes: number[],
  ): boolean {
    cpu.system.setRegister("sp", 0x401f00);

    // Re-applica patch periodicamente (safety contro overwrite accidentali).
    if (i % 100 === 0) {
      for (let k = 0; k < STUB_BYTES.length; k++) {
        pokeMem(cpu, FUN_264AA + k, 1, STUB_BYTES[k]!);
      }
    }

    setupStruct(structPtr, bytes);

    // Estrai w0/w2/w4 for the fail report.
    const off = (structPtr - 0x400000) >>> 0;
    const w0 =
      ((stateInst.workRam[off + 0xc] ?? 0) << 8) |
      (stateInst.workRam[off + 0xd] ?? 0);
    const w2 =
      ((stateInst.workRam[off + 0x10] ?? 0) << 8) |
      (stateInst.workRam[off + 0x11] ?? 0);
    const w4 =
      ((stateInst.workRam[off + 0x14] ?? 0) << 8) |
      (stateInst.workRam[off + 0x15] ?? 0);

    callFunction(cpu, FUN_19E42, [structPtr >>> 0]);

    ns.marbleCellDispatch19E42(stateInst, structPtr, {
      inner264AA: (_p: number, m: number): number => m >>> 0,
    });

    const diff = compareAll(structPtr);
    if (diff === null) return true;

    if (failHolder.value === null) {
      failHolder.value = {
        suite,
        i,
        structPtr,
        hud,
        w0,
        w2,
        w4,
        reason: diff.what,
        binVal: diff.bin,
        tsVal: diff.ts,
      };
    }
    return false;
  }

  const rng = makeRng(0x19e42);
  const rb = (): number => Math.floor(rng() * 256) & 0xff;
  const pickPtr = (): number =>
    PTR_CHOICES[Math.floor(rng() * PTR_CHOICES.length)]!;
  const pickFromArr = <T>(arr: readonly T[]): T =>
    arr[Math.floor(rng() * arr.length)]!;

  // ─── Suite A: random everything ─────────────────────────────────────
  console.log(
    `\n=== marbleCellDispatch19E42 (FUN_00019E42) — Suite A: random — ${perSuite} cases ===`,
  );
  let okA = 0;
  for (let i = 0; i < perSuite; i++) {
    const hud = setHud(rng);
    const bytes = new Array(STRUCT_SIZE).fill(0).map(() => rb());
    const structPtr = pickPtr();
    if (runOneCase("A", i, structPtr, hud, bytes)) okA++;
  }
  console.log(`  Match: ${okA}/${perSuite} = ${((okA / perSuite) * 100).toFixed(1)}%`);
  totalOk += okA;

  // Suite B: cellX forced into {0x29, 0x31, 0x39} to trigger the HIT path.
  console.log(
    `\n=== Suite B: cellX in {0x29, 0x31, 0x39} → mix HIT/MISS (cellY rng) — ${perSuite} cases ===`,
  );
  let okB = 0;
  const cellXSet = [0x29, 0x31, 0x39] as const;
  for (let i = 0; i < perSuite; i++) {
    const hud = setHud(rng);
    const bytes = new Array(STRUCT_SIZE).fill(0).map(() => rb());
    const cellX = pickFromArr(cellXSet);
    // Random cellY in [0..0x7F] and [0x80..0xFF] (signed range).
    const cellY = rb() & 0xff;
    const xWord = ((cellX << 3) & 0xffff) | (Math.floor(rng() * 8) & 0x7);
    const yWord = ((cellY << 3) & 0xffff) | (Math.floor(rng() * 8) & 0x7);
    bytes[0xc] = (xWord >>> 8) & 0xff;
    bytes[0xd] = xWord & 0xff;
    bytes[0x10] = (yWord >>> 8) & 0xff;
    bytes[0x11] = yWord & 0xff;
    const structPtr = pickPtr();
    if (runOneCase("B", i, structPtr, hud, bytes)) okB++;
  }
  console.log(`  Match: ${okB}/${perSuite} = ${((okB / perSuite) * 100).toFixed(1)}%`);
  totalOk += okB;

  // ─── Suite C: w0/w2/w4/HUD estremi ──────────────────────────────────
  console.log(`\n=== Suite C: w0/w2/w4/HUD estremi — ${perSuite} cases ===`);
  let okC = 0;
  const extremes = [0x0000, 0x7fff, 0x8000, 0xffff, 0x8001, 0x7ffe, 0xfffc, 0x4000];
  for (let i = 0; i < perSuite; i++) {
    const hud = pickFromArr(extremes);
    pokeMem(cpu, HUD_OFFSET_ADDR, 1, (hud >>> 8) & 0xff);
    pokeMem(cpu, HUD_OFFSET_ADDR + 1, 1, hud & 0xff);
    stateInst.workRam[0x97e] = (hud >>> 8) & 0xff;
    stateInst.workRam[0x97f] = hud & 0xff;

    const bytes = new Array(STRUCT_SIZE).fill(0).map(() => rb());
    const w0 = pickFromArr(extremes);
    const w2 = pickFromArr(extremes);
    const w4 = pickFromArr(extremes);
    bytes[0xc] = (w0 >>> 8) & 0xff;
    bytes[0xd] = w0 & 0xff;
    bytes[0x10] = (w2 >>> 8) & 0xff;
    bytes[0x11] = w2 & 0xff;
    bytes[0x14] = (w4 >>> 8) & 0xff;
    bytes[0x15] = w4 & 0xff;
    const structPtr = pickPtr();
    if (runOneCase("C", i, structPtr, hud, bytes)) okC++;
  }
  console.log(`  Match: ${okC}/${perSuite} = ${((okC / perSuite) * 100).toFixed(1)}%`);
  totalOk += okC;

  const sizeD = perSuite + remainder;
  console.log(
    `\n=== Suite D: cellX outside {0x29, 0x31, 0x39} → MISS path — ${sizeD} cases ===`,
  );
  let okD = 0;
  for (let i = 0; i < sizeD; i++) {
    const hud = setHud(rng);
    const bytes = new Array(STRUCT_SIZE).fill(0).map(() => rb());
    let cellX = rb();
    while (cellX === 0x29 || cellX === 0x31 || cellX === 0x39) cellX = rb();
    const xWord = ((cellX << 3) & 0xffff) | (Math.floor(rng() * 8) & 0x7);
    bytes[0xc] = (xWord >>> 8) & 0xff;
    bytes[0xd] = xWord & 0xff;
    // y random
    const yWord = Math.floor(rng() * 0x10000) & 0xffff;
    bytes[0x10] = (yWord >>> 8) & 0xff;
    bytes[0x11] = yWord & 0xff;
    const structPtr = pickPtr();
    if (runOneCase("D", i, structPtr, hud, bytes)) okD++;
  }
  console.log(`  Match: ${okD}/${sizeD} = ${((okD / sizeD) * 100).toFixed(1)}%`);
  totalOk += okD;

  console.log(
    `\n=== TOTALE: ${totalOk}/${total} = ${((totalOk / total) * 100).toFixed(1)}% ===`,
  );
  if (failHolder.value !== null) {
    const f = failHolder.value;
    console.log(`  First fail (suite ${f.suite} i=${f.i}):`);
    console.log(
      `    structPtr=0x${f.structPtr.toString(16)} hud=0x${f.hud.toString(16)} ` +
        `w0=0x${f.w0.toString(16)} w2=0x${f.w2.toString(16)} w4=0x${f.w4.toString(16)}`,
    );
    console.log(
      `    @${f.reason}: bin=0x${f.binVal.toString(16)} ts=0x${f.tsVal.toString(16)}`,
    );
  }

  disposeCpu(cpu);
  exit(totalOk === total ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  exit(1);
});
