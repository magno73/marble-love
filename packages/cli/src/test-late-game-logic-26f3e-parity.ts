#!/usr/bin/env node
/**
 * test-late-game-logic-26f3e-parity.ts — differential FUN_26F3E vs lateGameLogic26F3E.
 *
 *   - Use an entity list with valid indices (0x00..0x1E) that point to structs
 *     workRam noti (da ROM lookup table).
 *   - Randomize the contents of entity structs (rect buffers in workRam).
 *
 * **Scope**: copre phase 1 (bufferFill), phase 3 (cursor setup), phase 4
 *
 * Uso: npx tsx packages/cli/src/test-late-game-logic-26f3e-parity.ts [N]
 *      default N=500
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import {
  state as stateNs,
  bus as busNs,
  lateGameLogic26F3E as lgNs,
} from "@marble-love/engine";
import {
  createCpu,
  callFunction,
  pokeMem,
  peekMem,
  disposeCpu,
} from "./binary-oracle-lib.js";
import type { CpuSession } from "./binary-oracle-lib.js";

const FUN_26F3E = 0x00026f3e;

const WORK_RAM_BASE = 0x00400000;
const WORK_RAM_SIZE = 0x2000;
const SPRITE_RAM_BASE = 0x00a02000;
const SPRITE_RAM_SIZE = 0x1000;


/** Entity indices that are valid (point to workRam struct from ROM lookup). */
const VALID_ENTITY_INDICES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14] as const;

/** ROM lookup table base. */
const ROM_LOOKUP_BASE = 0x1f0e2;

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) >>> 0;
    return ((s >>> 16) & 0x7fff) / 0x8000;
  };
}

function findRomBlobPath(): string {
  const candidates = [
    process.env.MARBLE_ROM_BLOB,
    resolve("ghidra_project/marble_program.bin"),
    resolve("../marble-love/ghidra_project/marble_program.bin"),
  ].filter((p): p is string => p !== undefined && p.length > 0);
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  throw new Error(
    "ROM blob not found; set MARBLE_ROM_BLOB or put it at ghidra_project/marble_program.bin"
  );
}

function pokeRegion(cpu: CpuSession, absBase: number, buf: Uint8Array): void {
  for (let i = 0; i < buf.length; i++) {
    pokeMem(cpu, absBase + i, 1, buf[i]!);
  }
}

function peekRegion(cpu: CpuSession, absBase: number, len: number): Uint8Array {
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    out[i] = peekMem(cpu, absBase + i, 1);
  }
  return out;
}

async function main(): Promise<void> {
  const n = Number(process.argv[2] ?? "500");
  const romBlob = readFileSync(findRomBlobPath());

  const tsRom = busNs.emptyRomImage();
  tsRom.program.set(romBlob.subarray(0, tsRom.program.length));

  const tsState = stateNs.emptyGameState();
  const cpu = await createCpu({ rom: romBlob, state: tsState });

  const rng = makeRng(0x26f3e);

  // Read ROM to get entity struct addresses from the lookup table:
  const romBytes = readFileSync(findRomBlobPath());
  function romL(off: number): number {
    return (((romBytes[off] ?? 0) << 24) | ((romBytes[off+1] ?? 0) << 16) |
            ((romBytes[off+2] ?? 0) << 8) | (romBytes[off+3] ?? 0)) >>> 0;
  }
  // Entity struct pointers for indices 0..14:
  const entityPtrs = VALID_ENTITY_INDICES.map(idx => romL(ROM_LOOKUP_BASE + idx * 4));

  let ok = 0;
  type FailRec = {
    caseNo: number;
    region: "workRam" | "spriteRam";
    offset: number;
    bin: number;
    ts: number;
  };
  let firstFail: FailRec | null = null;

  for (let i = 0; i < n; i++) {
    // 1. Start from all-zero workRam and sprite RAM:
    const wram = new Uint8Array(WORK_RAM_SIZE); // all zeros
    const spram = new Uint8Array(SPRITE_RAM_SIZE); // all zeros

    // 2. Build entity list at 0x4003BC: use random subset of valid indices, then SENTINEL
    const entityCount = 1 + (Math.floor(rng() * 4));  // 1..4 entities
    for (let e = 0; e < entityCount; e++) {
      const idx = VALID_ENTITY_INDICES[Math.floor(rng() * VALID_ENTITY_INDICES.length)]!;
      wram[0x3bc + e] = idx;
    }
    wram[0x3bc + entityCount] = 0xff; // SENTINEL

    // 3. Randomize entity struct contents (14 bytes each) at each entity ptr.
    //    We randomize bytes [2..13] (bbox area) and set byte[0] = valid type code.
    //    Byte[1] = subIdx = 0 (to keep sub-object lookups deterministic).
    for (const ptr of entityPtrs) {
      const off = ptr - WORK_RAM_BASE;
      if (off < 0 || off + 14 > WORK_RAM_SIZE) continue;
      // typeCode = 0 (sentinel = skip in dispatch) → bufferFill sets 0x7FFF fields
      wram[off] = 0x00; // typeCode 0
      wram[off + 1] = 0x00; // subIdx 0
      for (let b = 2; b < 14; b++) {
        wram[off + b] = Math.floor(rng() * 256) & 0xff;
      }
    }

    // 4. Randomize 0x4003AE (XOR mask base):
    wram[0x3ae] = Math.floor(rng() * 2) === 0 ? 0x00 : 0x08;
    wram[0x3af] = 0;

    // 5. Disable sort (0x4003E2 = 1):
    wram[0x3e2] = 1;

    // 6. Randomize 0x4003BC entity struct contents for type 0x2C dispatch:
    //    workRam @ 0x400A9C (subIdx=0 for 0x2C type) = 10 bytes
    for (let b = 0; b < 10; b++) {
      wram[0xa9c + b] = Math.floor(rng() * 256) & 0xff;
    }

    // 7. Sync to binary oracle:
    pokeRegion(cpu, WORK_RAM_BASE, wram);
    pokeRegion(cpu, SPRITE_RAM_BASE, spram);

    // 8. Call binary FUN_26F3E:
    cpu.system.setRegister("sp", 0x00401f80);
    callFunction(cpu, FUN_26F3E, [], 5_000_000);

    // 9. Read binary state:
    const binWorkRam   = peekRegion(cpu, WORK_RAM_BASE, WORK_RAM_SIZE);
    const binSpriteRam = peekRegion(cpu, SPRITE_RAM_BASE, SPRITE_RAM_SIZE);

    // 10. Sync to TS state:
    tsState.workRam.set(wram);
    tsState.spriteRam.set(spram);

    // 11. Call TS function:
    lgNs.lateGameLogic26F3E(tsState, tsRom);

    // 12. Compare workRam (skip 0x1E00..0x1FFF stack frame area):
    let match = true;
    for (let j = 0; j < 0x1e00 && match; j++) {
      const b = binWorkRam[j] ?? 0;
      const t = tsState.workRam[j] ?? 0;
      if (b !== t) {
        firstFail ??= { caseNo: i, region: "workRam", offset: j, bin: b, ts: t };
        match = false;
      }
    }

    // 13. Compare spriteRam:
    for (let j = 0; j < SPRITE_RAM_SIZE && match; j++) {
      const b = binSpriteRam[j] ?? 0;
      const t = tsState.spriteRam[j] ?? 0;
      if (b !== t) {
        firstFail ??= { caseNo: i, region: "spriteRam", offset: j, bin: b, ts: t };
        match = false;
      }
    }

    if (match) ok++;
  }


  console.log(`\n=== lateGameLogic26F3E (FUN_26F3E) — ${n} cases ===`);
  console.log(`  Match: ${ok}/${n} = ${((ok / n) * 100).toFixed(1)}%`);
  if (firstFail) {
    console.log(`  First fail: ${JSON.stringify(firstFail)}`);
    console.log(`  Hint: ${firstFail.region} offset ${firstFail.offset.toString(16)} ` +
      `(abs=${(firstFail.region === "workRam" ? WORK_RAM_BASE : SPRITE_RAM_BASE) + firstFail.offset}): ` +
      `binary=${firstFail.bin.toString(16)} ts=${firstFail.ts.toString(16)}`);
  }

  disposeCpu(cpu);
  exit(ok === n ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  exit(1);
});
