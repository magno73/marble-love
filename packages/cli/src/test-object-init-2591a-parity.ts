#!/usr/bin/env node
/**
 * test-object-init-2591a-parity.ts — differential FUN_0002591A vs
 * objectInit2591A.
 *
 *
 *   - FUN_262B2  → `rts`                           (no-op)
 *   - FUN_1BAB2  → `rts`                           (no-op)
 *   - FUN_1CC62  → `moveq #0,D0; rts`              (return 0)
 *   - FUN_25B40  → `rts`                           (no-op)
 *   - FUN_1B9CC  → `rts`                           (no-op)
 *   - FUN_13966  → `rts`                           (no-op)
 *
 *
 * Parity strategy:
 *        - objPtr in {0x401000, 0x401100, ..., 0x401C00} (12 candidates)
 *        - globals @ 0x400462 (long), 0x400466 (long), 0x400472 (byte)
 *   3. Run TS objectInit2591A on the workRam mirror.
 *
 * Usage: npx tsx packages/cli/src/test-object-init-2591a-parity.ts [N]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exit } from "node:process";

import {
  state as stateNs,
  objectInit2591A as oi2591aNs,
} from "@marble-love/engine";
import {
  createCpu,
  callFunction,
  pokeMem,
  peekMem,
  disposeCpu,
} from "./binary-oracle-lib.js";

const FUN_2591A = 0x0002591a;
const FUN_262B2 = 0x000262b2;
const FUN_1BAB2 = 0x0001bab2;
const FUN_1CC62 = 0x0001cc62;
const FUN_25B40 = 0x00025b40;
const FUN_1B9CC = 0x0001b9cc;
const FUN_13966 = 0x00013966;

const WORK_RAM_BASE = 0x00400000;
const WORK_RAM_SIZE = 0x2000;

// Pointer candidates (well within workRam, lascia margin per stack a 0x401F00).
const PTR_CANDIDATES = [
  0x00401000, 0x00401100, 0x00401200, 0x00401300,
  0x00401400, 0x00401500, 0x00401600, 0x00401700,
  0x00401800, 0x00401900, 0x00401a00, 0x00401b00,
  0x00401c00,
] as const;

/**
 * Patch a singthe ROMs entry point with the specified byte pattern (in
 */
function patchRomBytes(
  rom: Buffer,
  entry: number,
  bytes: readonly number[],
): void {
  for (let i = 0; i < bytes.length; i++) {
    rom[entry + i] = bytes[i]! & 0xff;
  }
}

/** Patch all 6 subs to a deterministic stub. */
function patchSubsRom(rom: Buffer): void {
  // `rts` = 4E 75 (2 byte). For FUN_262B2, FUN_1BAB2, FUN_25B40, FUN_1B9CC,
  // FUN_13966 — we don't care about the return value.
  const rtsOnly = [0x4e, 0x75];
  patchRomBytes(rom, FUN_262B2, rtsOnly);
  patchRomBytes(rom, FUN_1BAB2, rtsOnly);
  patchRomBytes(rom, FUN_25B40, rtsOnly);
  patchRomBytes(rom, FUN_1B9CC, rtsOnly);
  patchRomBytes(rom, FUN_13966, rtsOnly);

  // FUN_1CC62: `moveq #0, D0; rts` = 70 00 4E 75 (4 byte). D0 = 0 →
  patchRomBytes(rom, FUN_1CC62, [0x70, 0x00, 0x4e, 0x75]);
}

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) >>> 0;
    return ((s >>> 16) & 0xffff) / 0x10000;
  };
}

interface FailRecord {
  i: number;
  ptr: number;
  field: string;
  bin: number;
  ts: number;
}

async function main(): Promise<void> {
  const n = Number(process.argv[2] ?? "500");

  const romPath = resolve("ghidra_project/marble_program.bin");
  if (!existsSync(romPath)) {
    console.error(`error: ROM blob not found at ${romPath}`);
    exit(3);
  }
  const romBuf = Buffer.from(readFileSync(romPath));

  // Pre-patch ROM with stubs for all 6 subs.
  patchSubsRom(romBuf);

  const stateInst = stateNs.emptyGameState();
  const cpu = await createCpu({ rom: romBuf, state: stateInst });

  console.log(`\n=== objectInit2591A (FUN_0002591A) — ${n} cases ===`);
  console.log(
    `  (FUN_262B2/1BAB2/25B40/1B9CC/13966 patched → rts; FUN_1CC62 → moveq #0,D0;rts)`,
  );

  const rng = makeRng(0x2591a);
  const rb = (): number => Math.floor(rng() * 256) & 0xff;
  const rl = (): number =>
    ((Math.floor(rng() * 0x10000) << 16) | Math.floor(rng() * 0x10000)) >>> 0;
  const pickPtr = (): number =>
    PTR_CANDIDATES[Math.floor(rng() * PTR_CANDIDATES.length)]!;

  let ok = 0;
  let firstFail: FailRecord | null = null;

  // Field offsets for the check post-call.
  const FIELDS_LONG_ZERO = [0x00, 0x04, 0x08, 0x22, 0x26] as const;
  const FIELDS_BYTE_ZERO = [0x36, 0x56, 0x58] as const;

  // Neighbors: offsets not touched by direct writes, for no-spill checks.
  const NEIGHBORS = [
    0x18, 0x19, 0x1a, 0x1c, 0x1d, 0x21, 0x2a, 0x35, 0x37, 0x55, 0x57, 0x59,
  ] as const;

  for (let i = 0; i < n; i++) {
    cpu.system.setRegister("sp", 0x401f00);

    const ptr = pickPtr();
    const off = ptr - WORK_RAM_BASE;

    // Random globals
    const g462 = rl();
    const g466 = rl();
    const g472 = rb();

    const scratchObj = new Uint8Array(0x80);
    for (let k = 0; k < 0x80; k++) scratchObj[k] = rb();
    const neighborSentinels: Record<number, number> = {};
    for (let idx = 0; idx < NEIGHBORS.length; idx++) {
      const nOff = NEIGHBORS[idx]!;
      const v = (0xc0 + idx) & 0xff;
      neighborSentinels[nOff] = v;
      scratchObj[nOff] = v;
    }

    // ── Setup binary side ──────────────────────────────────────────────
    // Globals
    pokeMem(cpu, WORK_RAM_BASE + 0x462, 4, g462);
    pokeMem(cpu, WORK_RAM_BASE + 0x466, 4, g466);
    pokeMem(cpu, WORK_RAM_BASE + 0x472, 1, g472);
    // Pre-existing 0x400696 / 0x400698 random
    const g696Pre = rb() & 0xff;
    const g698Pre = rb() & 0xff;
    pokeMem(cpu, WORK_RAM_BASE + 0x696, 2, (g696Pre << 8) | (rb() & 0xff));
    pokeMem(cpu, WORK_RAM_BASE + 0x698, 2, (g698Pre << 8) | (rb() & 0xff));

    // Object scratch
    for (let k = 0; k < 0x80; k++) {
      pokeMem(cpu, ptr + k, 1, scratchObj[k]!);
    }

    // ── Mirror into state.workRam ──────────────────────────────────────
    for (let k = 0; k < WORK_RAM_SIZE; k++) stateInst.workRam[k] = 0;
    // Globals in the mirror
    stateInst.workRam[0x462] = (g462 >>> 24) & 0xff;
    stateInst.workRam[0x463] = (g462 >>> 16) & 0xff;
    stateInst.workRam[0x464] = (g462 >>> 8) & 0xff;
    stateInst.workRam[0x465] = g462 & 0xff;
    stateInst.workRam[0x466] = (g466 >>> 24) & 0xff;
    stateInst.workRam[0x467] = (g466 >>> 16) & 0xff;
    stateInst.workRam[0x468] = (g466 >>> 8) & 0xff;
    stateInst.workRam[0x469] = g466 & 0xff;
    stateInst.workRam[0x472] = g472;
    // Mirror pre-existing 0x400696/0x400698, though TS overwrites them.
    stateInst.workRam[0x696] = peekMem(cpu, WORK_RAM_BASE + 0x696, 1) & 0xff;
    stateInst.workRam[0x697] = peekMem(cpu, WORK_RAM_BASE + 0x697, 1) & 0xff;
    stateInst.workRam[0x698] = peekMem(cpu, WORK_RAM_BASE + 0x698, 1) & 0xff;
    stateInst.workRam[0x699] = peekMem(cpu, WORK_RAM_BASE + 0x699, 1) & 0xff;
    // Object scratch in the mirror
    for (let k = 0; k < 0x80; k++) {
      stateInst.workRam[off + k] = scratchObj[k]!;
    }

    // ── Run binary ─────────────────────────────────────────────────────
    callFunction(cpu, FUN_2591A, [ptr]);

    // ── Run TS ─────────────────────────────────────────────────────────
    oi2591aNs.objectInit2591A(stateInst, ptr, {
      fun_1B9CC: () => {
        /* patched to rts in the binary side */
      },
    });

    let fail: FailRecord | null = null;

    // Long zero fields
    for (const fOff of FIELDS_LONG_ZERO) {
      const bin = peekMem(cpu, ptr + fOff, 4) >>> 0;
      const ts =
        (((stateInst.workRam[off + fOff] ?? 0) << 24) |
          ((stateInst.workRam[off + fOff + 1] ?? 0) << 16) |
          ((stateInst.workRam[off + fOff + 2] ?? 0) << 8) |
          (stateInst.workRam[off + fOff + 3] ?? 0)) >>>
        0;
      if (bin !== ts || bin !== 0) {
        fail = {
          i,
          ptr,
          field: `longZero@+0x${fOff.toString(16)}`,
          bin,
          ts,
        };
        break;
      }
    }
    if (fail) {
      if (firstFail === null) firstFail = fail;
      continue;
    }

    // Long shifted: A2[+0xC] = (g462 << 16) >>> 0
    {
      const bin = peekMem(cpu, ptr + 0x0c, 4) >>> 0;
      const ts =
        (((stateInst.workRam[off + 0x0c] ?? 0) << 24) |
          ((stateInst.workRam[off + 0x0d] ?? 0) << 16) |
          ((stateInst.workRam[off + 0x0e] ?? 0) << 8) |
          (stateInst.workRam[off + 0x0f] ?? 0)) >>>
        0;
      const expected = (g462 << 16) >>> 0;
      if (bin !== ts || bin !== expected) {
        fail = { i, ptr, field: "shiftX@+0x0C", bin, ts };
      }
    }
    if (fail) {
      if (firstFail === null) firstFail = fail;
      continue;
    }

    // Long shifted: A2[+0x10] = (g466 << 16) >>> 0
    {
      const bin = peekMem(cpu, ptr + 0x10, 4) >>> 0;
      const ts =
        (((stateInst.workRam[off + 0x10] ?? 0) << 24) |
          ((stateInst.workRam[off + 0x11] ?? 0) << 16) |
          ((stateInst.workRam[off + 0x12] ?? 0) << 8) |
          (stateInst.workRam[off + 0x13] ?? 0)) >>>
        0;
      const expected = (g466 << 16) >>> 0;
      if (bin !== ts || bin !== expected) {
        fail = { i, ptr, field: "shiftY@+0x10", bin, ts };
      }
    }
    if (fail) {
      if (firstFail === null) firstFail = fail;
      continue;
    }

    // A2[+0x14] = FUN_1CC62 ret = 0 (stub)
    {
      const bin = peekMem(cpu, ptr + 0x14, 4) >>> 0;
      const ts =
        (((stateInst.workRam[off + 0x14] ?? 0) << 24) |
          ((stateInst.workRam[off + 0x15] ?? 0) << 16) |
          ((stateInst.workRam[off + 0x16] ?? 0) << 8) |
          (stateInst.workRam[off + 0x17] ?? 0)) >>>
        0;
      if (bin !== ts || bin !== 0) {
        fail = { i, ptr, field: "fun1CC62Ret@+0x14", bin, ts };
      }
    }
    if (fail) {
      if (firstFail === null) firstFail = fail;
      continue;
    }

    // A2[+0x1B] = g472 byte
    {
      const bin = peekMem(cpu, ptr + 0x1b, 1) & 0xff;
      const ts = stateInst.workRam[off + 0x1b] ?? 0;
      if (bin !== ts || bin !== g472) {
        fail = { i, ptr, field: "byteFrom472@+0x1B", bin, ts };
      }
    }
    if (fail) {
      if (firstFail === null) firstFail = fail;
      continue;
    }

    // Byte zero fields
    for (const fOff of FIELDS_BYTE_ZERO) {
      const bin = peekMem(cpu, ptr + fOff, 1) & 0xff;
      const ts = stateInst.workRam[off + fOff] ?? 0;
      if (bin !== ts || bin !== 0) {
        fail = { i, ptr, field: `byteZero@+0x${fOff.toString(16)}`, bin, ts };
        break;
      }
    }
    if (fail) {
      if (firstFail === null) firstFail = fail;
      continue;
    }

    // Globals @ 0x400696, 0x400698 ← 0xFFFF (word)
    {
      const bin696 = peekMem(cpu, WORK_RAM_BASE + 0x696, 2) & 0xffff;
      const ts696 =
        (((stateInst.workRam[0x696] ?? 0) << 8) |
          (stateInst.workRam[0x697] ?? 0)) &
        0xffff;
      if (bin696 !== ts696 || bin696 !== 0xffff) {
        fail = { i, ptr, field: "global@0x400696", bin: bin696, ts: ts696 };
      }
    }
    if (fail) {
      if (firstFail === null) firstFail = fail;
      continue;
    }
    {
      const bin698 = peekMem(cpu, WORK_RAM_BASE + 0x698, 2) & 0xffff;
      const ts698 =
        (((stateInst.workRam[0x698] ?? 0) << 8) |
          (stateInst.workRam[0x699] ?? 0)) &
        0xffff;
      if (bin698 !== ts698 || bin698 !== 0xffff) {
        fail = { i, ptr, field: "global@0x400698", bin: bin698, ts: ts698 };
      }
    }
    if (fail) {
      if (firstFail === null) firstFail = fail;
      continue;
    }

    // Neighbor sentinels must not change.
    let neighborFail: FailRecord | null = null;
    for (const nOff of NEIGHBORS) {
      const expected = neighborSentinels[nOff]!;
      const bin = peekMem(cpu, ptr + nOff, 1) & 0xff;
      const ts = stateInst.workRam[off + nOff] ?? 0;
      if (bin !== ts || bin !== expected) {
        neighborFail = {
          i,
          ptr,
          field: `neighbor@+0x${nOff.toString(16)}`,
          bin,
          ts,
        };
        break;
      }
    }
    if (neighborFail) {
      if (firstFail === null) firstFail = neighborFail;
      continue;
    }

    ok++;
  }

  console.log(`  Match: ${ok}/${n} = ${((ok / n) * 100).toFixed(1)}%`);
  if (firstFail) {
    const f = firstFail;
    console.log(`  First fail @ case ${f.i} ptr=0x${f.ptr.toString(16)}:`);
    console.log(
      `    ${f.field}: bin=0x${f.bin.toString(16)} ts=0x${f.ts.toString(16)}`,
    );
  }

  disposeCpu(cpu);
  exit(ok === n ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  exit(1);
});
