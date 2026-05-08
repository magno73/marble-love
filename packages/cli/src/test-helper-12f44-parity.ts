#!/usr/bin/env node
/**
 * test-helper-12f44-parity.ts — differential FUN_12F44 vs `helper12F44`.
 *
 * `FUN_00012F44` (37 istr, 139 byte): dispatcher mode-0/mode-1/no-op su un
 * record di slot in work RAM.
 *
 * **Strategia parity**:
 *   - Setup: un record di slot @ slot_base (variabile per test case).
 *   - Setup ROM lookup-table @ 0x1F0E2 puntante a 16 rect-slot @ 0x4001DC
 *     (uguale a `test-helper-18f46-parity.ts`) per il path mode-1.
 *   - Per ogni test case:
 *       1. Genera un seed per il record di slot (campi 0x00..0x55 random).
 *       2. Sceglie (slotPtr, mode, scriptPtr) random tra i casi d'interesse.
 *       3. Copia il seed in Musashi RAM e in state.workRam.
 *       4. Esegue `callFunction(0x12F44, [slotPtr, mode, scriptPtr])`.
 *       5. Esegue `helper12F44(state, rom, slotPtr, mode, scriptPtr)`.
 *       6. Confronta le aree rilevanti di workRam:
 *            - Il record di slot (0x56 byte).
 *            - I globali 0x400974, 0x400978, 0x40075C.
 *            - Il byte-array draw-list @ 0x4003BC (32 byte).
 *            - L'area rect-slot @ 0x4001DC (0x1B2 byte).
 *
 * Uso: npx tsx packages/cli/src/test-helper-12f44-parity.ts [N]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import {
  state as stateNs,
  bus as busNs,
  helper12F44 as helper12F44Ns,
} from "@marble-love/engine";
import {
  createCpu,
  callFunction,
  pokeMem,
  peekMem,
  disposeCpu,
} from "./binary-oracle-lib.js";
import type { CpuSession } from "./binary-oracle-lib.js";

const FUN_12F44 = 0x00012f44;

const WORK_RAM_BASE = 0x00400000;
const WORK_RAM_SIZE = 0x2000;

// Slot table: 25 slot @ 0x400A9C stride 0x56.
const SLOT_TABLE_BASE = 0x400a9c;
const SLOT_STRIDE     = 0x56;
const SLOT_COUNT      = 25;

// Globali toccati dal mode-1.
const GLOBAL_974      = 0x400974;
const GLOBAL_978      = 0x400978;
const GLOBAL_75C      = 0x40075c;

// Byte-array draw-list.
const BYTE_ARRAY_ABS  = 0x004003bc;
const BYTE_ARRAY_LEN  = 0x20;

// Rect-slot area per FUN_18F46.
const RECT_SLOT_ABS    = 0x004001dc;
const RECT_SLOT_STRIDE = 0x0e;
const RECT_SLOT_COUNT  = 16;
const RECT_AREA_LEN    = 0x1b2;

// ROM lookup table per FUN_18F46.
const ROM_LOOKUP_OFF  = 0x1f0e2;

/** Setup ROM lookup table @ 0x1F0E2 → 16 rect-slot entries in workRam. */
function setupRomLookup(romView: Uint8Array): void {
  for (let i = 0; i < RECT_SLOT_COUNT; i++) {
    const ptr = (RECT_SLOT_ABS + i * RECT_SLOT_STRIDE) >>> 0;
    const off = ROM_LOOKUP_OFF + i * 4;
    romView[off]     = (ptr >>> 24) & 0xff;
    romView[off + 1] = (ptr >>> 16) & 0xff;
    romView[off + 2] = (ptr >>> 8)  & 0xff;
    romView[off + 3] =  ptr         & 0xff;
  }
}

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) >>> 0;
    return ((s >>> 16) & 0xffff) / 0x10000;
  };
}

/** Legge n byte da Musashi a partire da abs. */
function readBin(cpu: CpuSession, abs: number, len: number): Uint8Array {
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i++) out[i] = peekMem(cpu, abs + i, 1) & 0xff;
  return out;
}

/** Legge n byte da state.workRam a partire da abs. */
function readTs(
  state: ReturnType<typeof stateNs.emptyGameState>,
  abs: number,
  len: number,
): Uint8Array {
  const out = new Uint8Array(len);
  const off = abs - WORK_RAM_BASE;
  for (let i = 0; i < len; i++) out[i] = state.workRam[off + i] ?? 0;
  return out;
}

/** Primo mismatch o null. */
function diffBytes(
  a: Uint8Array,
  b: Uint8Array,
): { offset: number; aV: number; bV: number } | null {
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    if (a[i] !== b[i]) return { offset: i, aV: a[i]!, bV: b[i]! };
  }
  return null;
}

async function main(): Promise<void> {
  const total = Number(process.argv[2] ?? "500");

  const romPath = resolve("ghidra_project/marble_program.bin");
  if (!existsSync(romPath)) {
    console.error(`error: ROM blob not found at ${romPath}`);
    exit(3);
  }
  const romBuf = Buffer.from(readFileSync(romPath));

  // TS ROM image.
  const romView = busNs.emptyRomImage();
  const programLen = Math.min(romView.program.length, romBuf.length);
  romView.program.set(romBuf.subarray(0, programLen));
  // Override ROM lookup table.
  setupRomLookup(romView.program);

  const stateInst = stateNs.emptyGameState();
  const cpu = await createCpu({ rom: romBuf, state: stateInst });

  // Sync ROM lookup-table patches into Musashi ROM memory.
  for (let off = ROM_LOOKUP_OFF; off < ROM_LOOKUP_OFF + RECT_SLOT_COUNT * 4; off++) {
    pokeMem(cpu, off, 1, romView.program[off]!);
  }

  console.log(`\n=== helper12F44 (FUN_12F44) — ${total} casi ===`);

  const rng = makeRng(0x12f44);
  let ok = 0;

  interface FailRec {
    tc: number;
    slotIdx: number;
    mode: number;
    scriptPtr: number;
    where: string;
    offset: number;
    bin: number;
    ts: number;
  }
  let firstFail: FailRec | null = null;

  // Typecodetable/subtable per il byte-array draw-list (per realismo mode-1).
  const typeTable = new Uint8Array(RECT_SLOT_COUNT);
  const subTable  = new Uint8Array(RECT_SLOT_COUNT);

  for (let tc = 0; tc < total; tc++) {
    cpu.system.setRegister("sp", 0x401f00);

    // Rigeneora typeTable/subTable ogni test.
    for (let i = 0; i < RECT_SLOT_COUNT; i++) {
      typeTable[i] = Math.floor(rng() * 256) & 0xff;
      subTable[i]  = Math.floor(rng() * 256) & 0xff;
    }

    // Scegli slot index e mode.
    let slotIdx: number;
    let mode: number;
    let scriptPtr: number;
    let numActiveByteArr: number;

    if (tc === 0) {
      // mode-0, slot 0.
      slotIdx = 0; mode = 0; scriptPtr = 0x1d854; numActiveByteArr = 0;
    } else if (tc === 1) {
      // mode-1 con gate1e=1 (skip FUN_18F46), slot 0.
      slotIdx = 0; mode = 1; scriptPtr = 0; numActiveByteArr = 0;
    } else if (tc === 2) {
      // mode-1 con gate1e=0, match draw-list.
      slotIdx = 0; mode = 1; scriptPtr = 0; numActiveByteArr = 1;
    } else if (tc === 3) {
      // mode = -1 (0xFF sext) → no-op.
      slotIdx = 0; mode = 0xff; scriptPtr = 0xdeadbeef; numActiveByteArr = 0;
    } else if (tc === 4) {
      // mode = 2 → no-op.
      slotIdx = 0; mode = 2; scriptPtr = 0; numActiveByteArr = 0;
    } else if (tc === 5) {
      // mode-0, slot 24 (ultimo).
      slotIdx = 24; mode = 0; scriptPtr = 0x1e000; numActiveByteArr = 0;
    } else if (tc === 6) {
      // mode-1, A0 == *0x400974 → clear globals.
      slotIdx = 3; mode = 1; scriptPtr = 0; numActiveByteArr = 0;
    } else {
      // Random.
      slotIdx = Math.floor(rng() * SLOT_COUNT);
      mode = [0, 0, 1, 1, 0xff, 2, 0x7f, 0x80][Math.floor(rng() * 8)]!;
      scriptPtr = Math.floor(rng() * 0x100000) >>> 0;
      numActiveByteArr = Math.floor(rng() * (BYTE_ARRAY_LEN));
    }

    const slotPtr = (SLOT_TABLE_BASE + slotIdx * SLOT_STRIDE) >>> 0;

    // ─── Costruisci seed workRam ────────────────────────────────────────────
    const seedBuf = new Uint8Array(WORK_RAM_SIZE);

    // Riempi tutto il workRam con byte random (baseline caotica).
    for (let k = 0; k < WORK_RAM_SIZE; k++) {
      seedBuf[k] = Math.floor(rng() * 256) & 0xff;
    }

    // Setup byte-array draw-list coerente con typeTable/subTable.
    const baOff = BYTE_ARRAY_ABS - WORK_RAM_BASE;
    for (let i = 0; i < BYTE_ARRAY_LEN; i++) {
      if (i < numActiveByteArr) {
        const idx = Math.floor(rng() * RECT_SLOT_COUNT) & 0xff;
        seedBuf[baOff + i] = idx;
        const rectBase = RECT_SLOT_ABS - WORK_RAM_BASE + idx * RECT_SLOT_STRIDE;
        seedBuf[rectBase]     = typeTable[idx]!;
        seedBuf[rectBase + 1] = subTable[idx]!;
      } else {
        seedBuf[baOff + i] = 0xff;
      }
    }

    // Per mode-1 con gate1e=0 e numActiveByteArr > 0: usa il typeCode del
    // primo slot draw-list come typeCode del record di script-slot, così
    // FUN_18F46 trova la entry.
    if (mode === 1) {
      const slotOff = slotPtr - WORK_RAM_BASE;
      if (tc === 2 && numActiveByteArr > 0) {
        // Primo byte del byte-array = idx dello slot draw-list
        const drawIdx = seedBuf[baOff]!;
        // Imposta typeCode = typeTable[drawIdx], subIdx = subTable[drawIdx]
        seedBuf[slotOff + 0x1f] = typeTable[drawIdx]!;
        seedBuf[slotOff + 0x19] = subTable[drawIdx]!;
        seedBuf[slotOff + 0x1e] = 0x00; // gate1e = 0 → chiama FUN_18F46
      }

      // tc === 6: forza A0 == *0x400974
      if (tc === 6) {
        const ptr = slotPtr >>> 0;
        seedBuf[GLOBAL_974 - WORK_RAM_BASE]     = (ptr >>> 24) & 0xff;
        seedBuf[GLOBAL_974 - WORK_RAM_BASE + 1] = (ptr >>> 16) & 0xff;
        seedBuf[GLOBAL_974 - WORK_RAM_BASE + 2] = (ptr >>> 8)  & 0xff;
        seedBuf[GLOBAL_974 - WORK_RAM_BASE + 3] =  ptr         & 0xff;
        seedBuf[slotOff + 0x1e] = 0x01; // gate1e=1 per semplicità
      }
    }

    // Applica seed a Musashi e state.
    for (let k = 0; k < WORK_RAM_SIZE; k++) {
      pokeMem(cpu, WORK_RAM_BASE + k, 1, seedBuf[k]!);
      stateInst.workRam[k] = seedBuf[k]!;
    }

    // ─── Esegui binario ─────────────────────────────────────────────────────
    // callFunction RTL: argsLong[0]=slotPtr (SP+4), argsLong[1]=mode (SP+8),
    // argsLong[2]=scriptPtr (SP+C).
    callFunction(cpu, FUN_12F44, [slotPtr, mode >>> 0, scriptPtr >>> 0]);

    // ─── Esegui TS ──────────────────────────────────────────────────────────
    helper12F44Ns.helper12F44(stateInst, romView, slotPtr, mode, scriptPtr);

    // ─── Confronta ──────────────────────────────────────────────────────────
    // 1. Record di slot (0x56 byte).
    const binSlot = readBin(cpu, slotPtr, SLOT_STRIDE);
    const tsSlot  = readTs(stateInst, slotPtr, SLOT_STRIDE);
    const dSlot   = diffBytes(binSlot, tsSlot);

    // 2. Globali (12 byte: 974 long + 978 long + 75C byte, padding a 9 byte).
    const GLOBALS_START = GLOBAL_75C; // più basso
    const GLOBALS_LEN   = (GLOBAL_978 + 4) - GLOBAL_75C; // 0x400974 + 4 - 0x40075C
    const binGlob = readBin(cpu, GLOBALS_START, GLOBALS_LEN);
    const tsGlob  = readTs(stateInst, GLOBALS_START, GLOBALS_LEN);
    const dGlob   = diffBytes(binGlob, tsGlob);

    // 3. Byte-array draw-list (32 byte).
    const binBA   = readBin(cpu, BYTE_ARRAY_ABS, BYTE_ARRAY_LEN);
    const tsBA    = readTs(stateInst, BYTE_ARRAY_ABS, BYTE_ARRAY_LEN);
    const dBA     = diffBytes(binBA, tsBA);

    // 4. Rect-slot area (0x1B2 byte).
    const binRect = readBin(cpu, RECT_SLOT_ABS, RECT_AREA_LEN);
    const tsRect  = readTs(stateInst, RECT_SLOT_ABS, RECT_AREA_LEN);
    const dRect   = diffBytes(binRect, tsRect);

    if (dSlot === null && dGlob === null && dBA === null && dRect === null) {
      ok++;
    } else if (firstFail === null) {
      const d = dSlot ?? dGlob ?? dBA ?? dRect;
      const where =
        dSlot  ? "slot"     :
        dGlob  ? "globals"  :
        dBA    ? "byteArray" : "rectArea";
      firstFail = {
        tc,
        slotIdx,
        mode,
        scriptPtr,
        where,
        offset: d!.offset,
        bin:    d!.aV,
        ts:     d!.bV,
      };
    }
  }

  console.log(`  Match: ${ok}/${total} = ${((ok / total) * 100).toFixed(1)}%`);
  if (firstFail) {
    console.log(
      `  First fail tc=${firstFail.tc}` +
      ` slotIdx=${firstFail.slotIdx}` +
      ` mode=0x${firstFail.mode.toString(16)}` +
      ` scriptPtr=0x${firstFail.scriptPtr.toString(16)}`,
    );
    console.log(
      `    where=${firstFail.where}` +
      ` offset=0x${firstFail.offset.toString(16)}` +
      ` bin=0x${firstFail.bin.toString(16)}` +
      ` ts=0x${firstFail.ts.toString(16)}`,
    );
  }

  disposeCpu(cpu);
  exit(ok === total ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  exit(1);
});
