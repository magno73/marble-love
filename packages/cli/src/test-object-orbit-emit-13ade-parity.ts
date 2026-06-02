#!/usr/bin/env node
/**
 * test-object-orbit-emit-13ade-parity.ts — differential FUN_00013ADE vs
 * `objectOrbitEmit13ADE`.
 *
 * `FUN_00013ADE` (602 byte) emette 9 sprite entries su traiettoria circolare
 * using a sin/cos table @ 0x1EDA2 and a delta-stream @ 0x1EF32, with:
 *   - reset trigger su counter ∈ {0x64, 0x65, 0x66}
 *   - mirror su (A0+0x1A).b == 0x0B
 *   - angolo advance of 0x0A (modulo 0x192) per call
 *   - emit [charcode, x, y] records with bounds checking
 *
 * Random setup for each case:
 *   - `(A0+0x57).b` random (counter, include trigger values to cover i path)
 *   - `(A0+0x1a).b` random (mirror gate)
 *   - `(A0+0x2e).w` random (angolo iniziale)
 *   - `(A0+0x1e).l` random (coords source)
 *   - workRam/ROM pre-zeroed on the output fields
 *
 * Confronto:
 *   - D0 (low byte: 0x01 o 0x00)
 *   - byte `(A0+0x57)` (counter post)
 *   - word `(A0+0x2e)` (angolo post)
 *   - byte `(A0+0x1c)` (ready mark)
 *   - 4 record × 6 byte @ `(A0+0xA4)..(A0+0xBB)`
 *   - 4 record × 6 byte @ `(A0+0x38)..(A0+0x4F)`
 *
 * Uso: npx tsx packages/cli/src/test-object-orbit-emit-13ade-parity.ts [N]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import {
  state as stateNs,
  bus as busNs,
  objectOrbitEmit13ADE as ns,
} from "@marble-love/engine";
import type { RomImage } from "@marble-love/engine";
import {
  createCpu,
  callFunction,
  pokeMem,
  peekMem,
  disposeCpu,
} from "./binary-oracle-lib.js";

const FUN_13ADE = 0x00013ade;
const SLOT_PTR_TABLE = 0x0001f016;
const SLOT_COUNT = 0x19;

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) >>> 0;
    return ((s >>> 16) & 0xffff) / 0x10000;
  };
}

function readU32BE(buf: Uint8Array, off: number): number {
  return (
    (((buf[off] ?? 0) << 24) |
      ((buf[off + 1] ?? 0) << 16) |
      ((buf[off + 2] ?? 0) << 8) |
      (buf[off + 3] ?? 0)) >>>
    0
  );
}

async function main(): Promise<void> {
  const n = Number(process.argv[2] ?? "500");

  const romPath = resolve("ghidra_project/marble_program.bin");
  if (!existsSync(romPath)) {
    console.error(`error: ROM blob not found at ${romPath}`);
    exit(3);
  }
  const romBuf = readFileSync(romPath);

  const stateInst = stateNs.emptyGameState();
  const cpu = await createCpu({ rom: romBuf, state: stateInst });

  // Mirror ROM into the TS RomImage.
  const tsRom: RomImage = busNs.emptyRomImage();
  tsRom.program.set(romBuf.subarray(0, tsRom.program.length));

  // Decode the 25 table pointers at 0x1F016 once.
  const slotPtrs: number[] = [];
  for (let i = 0; i < SLOT_COUNT; i++) {
    slotPtrs.push(readU32BE(romBuf, SLOT_PTR_TABLE + i * 4));
  }

  console.log(`\n=== objectOrbitEmit13ADE (FUN_00013ADE) — ${n} cases ===`);

  const rng = makeRng(0x13ade);
  let ok = 0;
  let firstFail: {
    i: number;
    argPtr: number;
    counterPre: number;
    mirrorByte: number;
    angleInit: number;
    binD0: number;
    tsD0: number;
    diffField: string | undefined;
    binVal: number | undefined;
    tsVal: number | undefined;
  } | null = null;

  for (let i = 0; i < n; i++) {
    cpu.system.setRegister("sp", 0x401f00);

    // Use canonical slots as argPtr to guarantee writes land in valid work RAM.
    const argSlotIdx = Math.floor(rng() * SLOT_COUNT) % SLOT_COUNT;
    const argPtr = slotPtrs[argSlotIdx]!;
    const argOff = argPtr - 0x400000;

    // Pattern coverage:
    //   0: counter = 0x64 (trigger reset 0x30)
    //   1: counter = 0x65 (trigger reset 0x18)
    //   2: counter = 0x66 (trigger reset 0x24)
    //   3: counter = 0x01 (D0 = 1 path)
    //   4: mirror byte = 0x0B
    //   default: random
    let counterPre: number;
    if (i === 0) counterPre = 0x64;
    else if (i === 1) counterPre = 0x65;
    else if (i === 2) counterPre = 0x66;
    else if (i === 3) counterPre = 0x01;
    else counterPre = Math.floor(rng() * 256) & 0xff;

    const mirrorByte = (i === 4 || rng() < 0.3) ? 0x0b : (Math.floor(rng() * 256) & 0xff);
    const angleInit = Math.floor(rng() * 0x192) & 0xffff;
    const coordsLong = Math.floor(rng() * 0x100000000) >>> 0;

    // ── PRE-CLEAR + SETUP ──────────────────────────────────────────
    // Clear output fields for all slots to avoid interference.
    for (let sIdx = 0; sIdx < SLOT_COUNT; sIdx++) {
      const slot = slotPtrs[sIdx]!;
      const slotOff = slot - 0x400000;
      const ranges: Array<[number, number]> = [
        [0x1c, 1],
        [0x38, 24], // 4 record da 6 byte
        [0xa4, 24], // 4 record da 6 byte
      ];
      for (const [off, size] of ranges) {
        for (let k = 0; k < size; k++) {
          pokeMem(cpu, slot + off + k, 1, 0);
          stateInst.workRam[slotOff + off + k] = 0;
        }
      }
    }

    // Setup argPtr fields.
    pokeMem(cpu, argPtr + 0x57, 1, counterPre);
    stateInst.workRam[argOff + 0x57] = counterPre;

    pokeMem(cpu, argPtr + 0x1a, 1, mirrorByte);
    stateInst.workRam[argOff + 0x1a] = mirrorByte;

    // Angolo (word).
    pokeMem(cpu, argPtr + 0x2e, 1, (angleInit >>> 8) & 0xff);
    pokeMem(cpu, argPtr + 0x2f, 1, angleInit & 0xff);
    stateInst.workRam[argOff + 0x2e] = (angleInit >>> 8) & 0xff;
    stateInst.workRam[argOff + 0x2f] = angleInit & 0xff;

    // Coords long @ A0+0x1E.
    for (let k = 0; k < 4; k++) {
      const b = (coordsLong >>> ((3 - k) * 8)) & 0xff;
      pokeMem(cpu, argPtr + 0x1e + k, 1, b);
      stateInst.workRam[argOff + 0x1e + k] = b;
    }

    // ── RUN ───────────────────────────────────────────────────────
    const r = callFunction(cpu, FUN_13ADE, [argPtr]);
    const binD0 = r.d0 >>> 0;

    const tsD0 = ns.objectOrbitEmit13ADE(stateInst, tsRom, argPtr) >>> 0;

    // ── COMPARE ───────────────────────────────────────────────────
    let match = true;
    let diffField: string | undefined;
    let binVal: number | undefined;
    let tsVal: number | undefined;

    // D0 low byte.
    if ((binD0 & 0xff) !== (tsD0 & 0xff)) {
      match = false;
      diffField = "D0.b";
      binVal = binD0 & 0xff;
      tsVal = tsD0 & 0xff;
    }

    // Counter post (0x57).
    if (match) {
      const bin57 = peekMem(cpu, argPtr + 0x57, 1) & 0xff;
      const ts57 = stateInst.workRam[argOff + 0x57] ?? 0;
      if (bin57 !== ts57) {
        match = false;
        diffField = "+0x57 (counter post)";
        binVal = bin57;
        tsVal = ts57;
      }
    }

    // Angolo post (0x2E word = 2 byte).
    if (match) {
      for (let k = 0; k < 2; k++) {
        const binV = peekMem(cpu, argPtr + 0x2e + k, 1) & 0xff;
        const tsV = stateInst.workRam[argOff + 0x2e + k] ?? 0;
        if (binV !== tsV) {
          match = false;
          diffField = `+0x${(0x2e + k).toString(16).toUpperCase()} (angle)`;
          binVal = binV;
          tsVal = tsV;
          break;
        }
      }
    }

    // Ready byte (0x1C).
    if (match) {
      const bin1c = peekMem(cpu, argPtr + 0x1c, 1) & 0xff;
      const ts1c = stateInst.workRam[argOff + 0x1c] ?? 0;
      if (bin1c !== ts1c) {
        match = false;
        diffField = "+0x1C (ready)";
        binVal = bin1c;
        tsVal = ts1c;
      }
    }

    // Record output: 24 byte @ +0x38 and 24 byte @ +0xA4.
    if (match) {
      for (const baseOff of [0x38, 0xa4]) {
        if (!match) break;
        for (let k = 0; k < 24; k++) {
          const offMem = argPtr + baseOff + k;
          const offRam = argOff + baseOff + k;
          const binV = peekMem(cpu, offMem, 1) & 0xff;
          const tsV = stateInst.workRam[offRam] ?? 0;
          if (binV !== tsV) {
            match = false;
            diffField = `+0x${(baseOff + k).toString(16).toUpperCase()}`;
            binVal = binV;
            tsVal = tsV;
            break;
          }
        }
      }
    }

    if (match) {
      ok++;
    } else if (firstFail === null) {
      firstFail = {
        i,
        argPtr,
        counterPre,
        mirrorByte,
        angleInit,
        binD0,
        tsD0,
        diffField,
        binVal,
        tsVal,
      };
    }
  }

  console.log(`  Match: ${ok}/${n} = ${((ok / n) * 100).toFixed(1)}%`);
  if (firstFail) {
    console.log(`  First fail @ case ${firstFail.i}:`);
    console.log(
      `    argPtr=0x${firstFail.argPtr.toString(16)} counterPre=0x${firstFail.counterPre.toString(16)} mirrorByte=0x${firstFail.mirrorByte.toString(16)} angle=0x${firstFail.angleInit.toString(16)}`,
    );
    console.log(
      `    binD0=0x${firstFail.binD0.toString(16)} tsD0=0x${firstFail.tsD0.toString(16)}`,
    );
    if (firstFail.diffField !== undefined) {
      console.log(
        `    diff ${firstFail.diffField}: bin=0x${(firstFail.binVal ?? 0).toString(16)} ts=0x${(firstFail.tsVal ?? 0).toString(16)}`,
      );
    }
  }

  disposeCpu(cpu);
  exit(ok === n ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  exit(1);
});
